// video-remake — envio do vídeo de "Melhorar um vídeo meu".
//
// O bucket `renders` é privado e não tem política de escrita para o navegador:
// quem envia é o próprio navegador, mas por uma URL assinada que só esta função
// (service role) emite, para um caminho que ela escolhe. Assim nenhum usuário
// grava fora de director/uploads/ nem sobrescreve render de outro job.
//
// POST { action: 'upload_url', content_type: 'video/mp4' | 'video/quicktime' }
//   → { path, token }   (o front chama storage.uploadToSignedUrl(path, token, file))
//
// Só admin (mesma regra de quem cria job do Diretor).

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';
import { readEngineChoice } from '../_shared/director-core.ts';
import { hfConnected } from '../_shared/hf-mcp.ts';
import {
  type ClipArt, clipOfShot, computeEditModes, estimateLabel, NO_SCENES, type SceneEditMode, type SceneEditState,
  scopeOf, validateSceneEditRequest,
} from '../_shared/scene-edit.ts';
import { listActiveModels, resolveModel, sceneResolution, type VideoModelEntry } from '../_shared/video-catalog.ts';

const BUCKET = 'renders';
const EXTENSIONS: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  // quadro do vídeo (foto que fala quando a fala nova é maior que o vídeo)
  'image/jpeg': 'jpg',
  // amostra da voz de quem fala (clone da própria voz)
  'audio/wav': 'wav',
};

import { requireDrive } from '../_shared/drive-gate.ts';

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return errorResponse(405, 'invalid_input', 'Use POST.');

  const service = createServiceClient();
  try {
    const user = await getUser(req);
    if (!user) return errorResponse(401, 'unauthorized', 'Sessão inválida ou ausente.');
    const { data: isAdmin } = await service.rpc('has_role', { _user_id: user.id, _role: 'admin' });
    if (!isAdmin) return errorResponse(403, 'forbidden', 'Apenas admin.');

    const body = await req.json().catch(() => ({}));
    const semDrive = await requireDrive(service, 'video-remake', typeof body.action === 'string' ? body.action : '');
    if (semDrive) return semDrive;
    // Conferências de voz ANTES de gerar: plano do ElevenLabs clona? o Voice ID existe?
    if (body.action === 'voice_check' || body.action === 'voice_lookup') {
      const { data: key } = await service.rpc('get_vault_secret', { _name: 'ELEVEN_API_KEY' });
      if (!key) return jsonResponse({ ok: false, reason: 'Falta a chave do ElevenLabs em Config → Integrações.' });
      const headers = { 'xi-api-key': key as string };
      if (body.action === 'voice_check') {
        const r = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers });
        if (!r.ok) return jsonResponse({ ok: null, reason: `Não deu para conferir o plano do ElevenLabs (${r.status}).` });
        const sub = (await r.json()) as { can_use_instant_voice_cloning?: boolean; tier?: string };
        return jsonResponse({
          ok: sub.can_use_instant_voice_cloning === true,
          tier: sub.tier ?? null,
          reason: sub.can_use_instant_voice_cloning
            ? null
            : `Seu plano do ElevenLabs (${sub.tier ?? 'atual'}) não clona voz. O clone começa no plano Starter.`,
        });
      }
      const id = typeof body.voice_id === 'string' ? body.voice_id.trim() : '';
      if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return jsonResponse({ ok: false, reason: 'Voice ID inválido.' });
      const r = await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(id)}`, { headers });
      if (r.status === 404 || r.status === 400) return jsonResponse({ ok: false, reason: 'Esse Voice ID não existe no ElevenLabs.' });
      if (!r.ok) return jsonResponse({ ok: null, reason: `Não deu para conferir a voz (${r.status}).` });
      const v = (await r.json()) as { name?: string; labels?: { gender?: string } };
      return jsonResponse({ ok: true, name: v.name ?? id, gender: v.labels?.gender ?? null });
    }
    // Editar uma cena de um vídeo pronto (docs/hub-motor-contratos.md §10)
    if (body.action === 'scene_edit_options' || body.action === 'scene_edit' || body.action === 'scene_undo') {
      return await handleSceneEdit(service, body);
    }
    if (body.action !== 'upload_url') {
      return errorResponse(400, 'invalid_input', "action deve ser 'upload_url'.");
    }
    const ext = EXTENSIONS[typeof body.content_type === 'string' ? body.content_type : ''];
    if (!ext) return errorResponse(400, 'invalid_input', 'Envie um vídeo MP4 ou MOV (ou o quadro em JPG).');

    const path = `director/uploads/${crypto.randomUUID()}.${ext}`;
    const { data, error } = await service.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data?.token) {
      return errorResponse(500, 'internal', `Não foi possível preparar o envio: ${error?.message ?? 'sem token'}`);
    }
    return jsonResponse({ path, token: data.token });
  } catch (err) {
    return errorResponse(500, 'internal', err instanceof Error ? err.message : String(err));
  }
});

// ── Editar uma cena (§10): valida, estima e enfileira; o director-advance faz ─
// o trabalho no slot de edição (job continua 'done'; final_rebuilding = true).

type Service = ReturnType<typeof createServiceClient>;
type JobRow = {
  id: string;
  status: string;
  brief: Record<string, unknown>;
  config: Record<string, unknown>;
  artifacts: Record<string, unknown>;
};
type EditArts = {
  videos?: ClipArt[];
  scene_edits?: Record<string, SceneEditState>;
  video_versions?: Record<string, ClipArt[]>;
  edit_modes?: Record<string, SceneEditMode>;
  edit_modes_at?: string;
  edit_active?: Record<string, unknown> | null;
  edit_seq?: number;
  final_rebuilding?: boolean;
  final?: string;
};

async function loadJob(service: Service, id: unknown): Promise<JobRow | null> {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await service.from('director_jobs').select('id, status, brief, config, artifacts').eq('id', id).maybeSingle();
  return (data as JobRow | null) ?? null;
}

async function editModesFor(service: Service, job: JobRow): Promise<Record<string, SceneEditMode>> {
  const arts = (job.artifacts ?? {}) as EditArts;
  const mode = (job.config as { mode?: string } | null)?.mode ?? null;
  if (mode) return {};
  const v2v = (await listActiveModels(service).catch(() => [] as VideoModelEntry[])).filter((e) => e.capability === 'scene_v2v');
  const { data: token } = await service.rpc('get_vault_secret', { _name: 'REPLICATE_API_TOKEN' });
  const choice = readEngineChoice(job);
  const sceneEntry = choice.engine === 'replicate'
    ? await resolveModel(service, 'scene_i2v', choice.model_id).catch(() => null)
    : null;
  return computeEditModes({
    mode,
    videos: arts.videos ?? [],
    v2v,
    replicateConnected: typeof token === 'string' && token.length > 0,
    hfConnected: await hfConnected(service),
    engine: choice.engine === 'replicate' ? 'replicate' : 'higgsfield',
    sceneEntry,
    sceneResolution: sceneEntry ? sceneResolution(sceneEntry.limits, (job.config as { resolution?: unknown }).resolution) : undefined,
  });
}

/**
 * Grava artifacts só se o job continua pronto e sem edição em andamento (o
 * slot de edição do motor só toca jobs com final_rebuilding = true, então os
 * dois nunca escrevem ao mesmo tempo). false = perdeu a corrida.
 */
async function writeArtifacts(service: Service, job: JobRow, artifacts: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await service.from('director_jobs').update({ artifacts })
    .eq('id', job.id).eq('status', 'done')
    .or('artifacts->>final_rebuilding.is.null,artifacts->>final_rebuilding.eq.false')
    .select('id');
  if (error) throw new Error(error.message);
  return Boolean(data?.length);
}

async function handleSceneEdit(service: Service, body: Record<string, unknown>): Promise<Response> {
  const job = await loadJob(service, body.job_id);
  if (!job) return errorResponse(404, 'not_found', 'Vídeo não encontrado.');
  const arts = { ...(job.artifacts ?? {}) } as EditArts & Record<string, unknown>;
  const scenes = !(job.config as { mode?: string } | null)?.mode;

  if (body.action === 'scene_edit_options') {
    if (!scenes) return jsonResponse({ edit_modes: {}, edit_modes_at: null, reason: NO_SCENES });
    const modes = await editModesFor(service, job);
    const at = new Date().toISOString();
    if (job.status === 'done' && arts.final_rebuilding !== true) {
      await writeArtifacts(service, job, { ...arts, edit_modes: modes, edit_modes_at: at }).catch(() => false);
    }
    return jsonResponse({ edit_modes: modes, edit_modes_at: at });
  }

  if (!scenes) return errorResponse(400, 'invalid_input', NO_SCENES);
  if (job.status !== 'done' || !arts.final) return errorResponse(409, 'conflict', 'O vídeo ainda não está pronto.');
  if (arts.final_rebuilding === true) {
    return errorResponse(409, 'conflict', 'Já há uma edição em andamento neste vídeo. Espere terminar.');
  }
  const shot = Number(body.shot);
  const clip = Number.isInteger(shot) ? clipOfShot(arts.videos ?? [], shot) : null;
  if (!clip) return errorResponse(404, 'not_found', 'Cena não encontrada neste vídeo.');
  const scope = scopeOf(clip);
  const versions = arts.video_versions ?? {};
  const n = (arts.edit_seq ?? 0) + 1;
  const now = Date.now();

  if (body.action === 'scene_undo') {
    const stack = versions[String(clip.shot)] ?? [];
    const previous = stack[stack.length - 1];
    if (!previous) return errorResponse(400, 'invalid_input', 'Não há versão anterior desta cena.');
    const next = {
      ...arts,
      edit_seq: n,
      final_rebuilding: true,
      edit_active: { shot, anchor: clip.shot, kind: 'undo', prompt: '', n, scope, phase: 'assemble', clip: previous },
      scene_edits: {
        ...(arts.scene_edits ?? {}),
        [String(shot)]: { status: 'running', kind: 'undo', prompt: '', error: null, can_undo: true, scope, started_at: now },
      },
    };
    if (!(await writeArtifacts(service, job, next))) {
      return errorResponse(409, 'conflict', 'Já há uma edição em andamento neste vídeo. Espere terminar.');
    }
    return jsonResponse({ ok: true, scope });
  }

  const problem = validateSceneEditRequest(body.kind, body.prompt);
  if (problem) return errorResponse(400, 'invalid_input', problem);
  const kind = body.kind as 'edit' | 'redo';
  const prompt = (body.prompt as string | undefined)?.trim() ?? '';
  const modes = await editModesFor(service, job);
  const mode = modes[String(shot)];
  const option = mode?.[kind];
  if (!option?.available) {
    return errorResponse(400, 'invalid_input', option?.reason ?? 'Esta cena não pode ser editada agora.');
  }
  const next = {
    ...arts,
    edit_modes: modes,
    edit_modes_at: new Date(now).toISOString(),
    edit_seq: n,
    final_rebuilding: true,
    edit_active: {
      shot, anchor: clip.shot, kind, prompt, n, scope,
      model_id: kind === 'edit' ? mode.edit.model_id : null,
      phase: kind === 'redo' ? 'keyframe' : 'video',
    },
    scene_edits: {
      ...(arts.scene_edits ?? {}),
      [String(shot)]: {
        status: 'running', kind, prompt, error: null,
        can_undo: (versions[String(clip.shot)] ?? []).length > 0, scope, started_at: now,
      },
    },
  };
  if (!(await writeArtifacts(service, job, next))) {
    return errorResponse(409, 'conflict', 'Já há uma edição em andamento neste vídeo. Espere terminar.');
  }
  return jsonResponse({ ok: true, scope, estimate: { usd: option.usd, label: estimateLabel(option.usd) } });
}
