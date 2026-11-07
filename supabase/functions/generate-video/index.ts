// generate-video — porta única de comando do pipeline de Reels.
// Spec: docs/11-video-replicate.md §4.1. verify_jwt=true.
//
// Nada aqui espera vídeo renderizar: as ações criam/avançam estado e devolvem
// na hora. O progresso chega à UI por Realtime, alimentado pelo webhook.
//
// Dois PORTÕES DE CUSTO, de propósito:
//   1. create_storyboard é grátis (só LLM de texto) e o storyboard é editável;
//   2. start_production gera áudio + keyframes (centavos) e PARA em
//      keyframes_review — só approve_keyframes libera o vídeo (dólares).
// Centavos travando dólares é a proteção mais barata do desenho.

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, createUserClient, getUser } from '../_shared/supabase.ts';
import { enforceRateLimit } from '../_shared/rate-limit.ts';
import { chat } from '../_shared/llm.ts';
import {
  ReplicateError,
  fetchWebhookSigningSecret,
  getModel,
  versionExists,
} from '../_shared/replicate.ts';
import {
  billableDuration,
  estimateCostUsd,
  fitResolution,
  listActiveModels,
  resolveModel,
  splitModelId,
  type VideoCapability,
} from '../_shared/video-catalog.ts';
import {
  advanceProject,
  advanceScene,
  cancelProject,
  getReplicateToken,
  projectSpendUsd,
  recomputeProjectStatus,
  sha256,
} from '../_shared/video-pipeline.ts';
import {
  SCENE_DIRECTOR_SCHEMA,
  buildSceneDirectorMessages,
  type SceneDirectorOutput,
} from '../_shared/prompts/scene-director.ts';
import { beatSentences, planDecoupage } from '../_shared/decoupage.ts';
import type { AdaptedContent, ReelBeat } from '../_shared/types.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

type Json = Record<string, unknown>;
type ServiceClient = ReturnType<typeof createServiceClient>;

function background(task: Promise<unknown>): void {
  const guarded = task.catch((err) => {
    console.error('[generate-video] tarefa de fundo falhou:', err instanceof Error ? err.message : err);
  });
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime) EdgeRuntime.waitUntil(guarded);
  else void guarded;
}

import { requireDrive } from '../_shared/drive-gate.ts';

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const user = await getUser(req);
    if (!user) return errorResponse(401, 'unauthorized', 'Sessão inválida ou ausente.');
    if (req.method !== 'POST') return errorResponse(405, 'invalid_input', 'Use POST.');

    let body: Json;
    try {
      body = (await req.json()) as Json;
    } catch (_err) {
      return errorResponse(400, 'invalid_input', 'Body JSON inválido.');
    }

    const service = createServiceClient();
    const action = typeof body.action === 'string' ? body.action : '';

    const semDrive = await requireDrive(service, 'generate-video', action);
    if (semDrive) return semDrive;

    // Ações administrativas não dependem de token configurado.
    if (action === 'setup') return await handleSetup(req, service, user.id);
    if (action === 'validate_catalog') return await handleValidateCatalog(req, service, user.id);

    const token = await getReplicateToken(service);
    if (!token) {
      return errorResponse(
        400,
        'replicate_not_configured',
        'Token do Replicate não configurado. Grave a key em Config → Integrações.',
      );
    }

    switch (action) {
      case 'create_storyboard':
        return await handleCreateStoryboard(service, body, user.id);
      case 'update_scene':
        return await handleUpdateScene(service, body);
      case 'reorder_scenes':
        return await handleReorderScenes(service, body);
      case 'estimate':
        return await handleEstimate(service, body);
      case 'start_production':
        return await handleStartProduction(service, token, body, user.id);
      case 'approve_keyframes':
        return await handleApproveKeyframes(service, token, body, user.id);
      case 'regenerate_scene':
        return await handleRegenerateScene(service, token, body, user.id);
      case 'assemble':
        return await handleAssemble(service, token, body);
      case 'cancel':
        return await handleCancel(service, token, body);
      default:
        return errorResponse(400, 'invalid_input', `Ação desconhecida: "${action}".`);
    }
  } catch (err) {
    if (err instanceof ReplicateError) {
      return errorResponse(err.status >= 400 ? err.status : 502, err.code, err.message);
    }
    console.error('[generate-video] erro inesperado:', err instanceof Error ? err.message : err);
    return errorResponse(500, 'internal_error', 'Falha inesperada.');
  }
});

// ── setup / validate_catalog (admin) ─────────────────────────────────────────

async function requireAdmin(
  req: Request,
  service: ServiceClient,
  userId: string,
): Promise<Response | null> {
  const { data } = await service.rpc('has_role', { _user_id: userId, _role: 'admin' });
  if (data !== true) {
    return errorResponse(403, 'forbidden', 'Apenas administradores podem executar esta ação.');
  }
  return null;
}

/**
 * Busca o signing secret da conta no Replicate e guarda no Vault.
 *
 * Gotcha que mata esta ação se ignorado: store_vault_secret exige
 * has_role(auth.uid(), 'admin') e LANÇA exceção — com o service client
 * auth.uid() é null e falharia sempre. Por isso a RPC vai pelo client do
 * USUÁRIO (JWT do admin), exatamente como o store-secret faz.
 */
async function handleSetup(
  req: Request,
  service: ServiceClient,
  userId: string,
): Promise<Response> {
  const denied = await requireAdmin(req, service, userId);
  if (denied) return denied;

  const token = await getReplicateToken(service);
  if (!token) {
    return errorResponse(
      400,
      'replicate_not_configured',
      'Grave primeiro o REPLICATE_API_TOKEN em Config → Integrações.',
    );
  }

  const secret = await fetchWebhookSigningSecret(token);
  const userClient = createUserClient(req);
  const { error } = await userClient.rpc('store_vault_secret', {
    _name: 'REPLICATE_WEBHOOK_SECRET',
    _value: secret,
  });
  if (error) {
    return errorResponse(500, 'internal_error', `Falha ao gravar o secret: ${error.message}`);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (supabaseUrl) {
    await service
      .from('app_settings')
      .upsert({ key: 'instance_url', value: { url: supabaseUrl } }, { onConflict: 'key' });
  }

  return jsonResponse({ ok: true, webhook_configured: true });
}

/**
 * Confere cada modelo ativo contra a API real: o slug existe? o version_hash
 * bate com a latest? os placeholders do template correspondem a campos que o
 * modelo realmente aceita? É o gate de saída da fundação — nenhum modelo entra
 * em produção sem passar por aqui.
 */
async function handleValidateCatalog(
  req: Request,
  service: ServiceClient,
  userId: string,
): Promise<Response> {
  const denied = await requireAdmin(req, service, userId);
  if (denied) return denied;

  const token = await getReplicateToken(service);
  if (!token) {
    return errorResponse(400, 'replicate_not_configured', 'Token do Replicate não configurado.');
  }

  const models = await listActiveModels(service);
  const report: Array<Json> = [];

  for (const entry of models) {
    const { owner, name } = splitModelId(entry.model_id);
    const issues: string[] = [];
    try {
      const info = await getModel(token, owner, name);
      const properties = (info.inputSchema?.properties ?? {}) as Json;
      const known = new Set(Object.keys(properties));

      for (const field of Object.keys(entry.input_template)) {
        if (known.size > 0 && !known.has(field)) {
          issues.push(`campo "${field}" não existe no schema do modelo`);
        }
      }
      // Para community, o que importa NÃO é divergir da latest (pinar é o
      // desenho) e sim a versão fixada ter sido REMOVIDA pelo mantenedor — a
      // montagem inteira depende de três utilitários assim, sem fallback.
      if (entry.kind === 'community' && entry.version_hash) {
        const alive = await versionExists(token, owner, name, entry.version_hash);
        if (!alive) {
          issues.push(
            `a versão fixada ${entry.version_hash.slice(0, 12)}… não existe mais no Replicate`,
          );
        }
      }

      await service
        .from('video_models')
        .update({ last_validated_at: new Date().toISOString() })
        .eq('id', entry.id);

      report.push({
        capability: entry.capability,
        model_id: entry.model_id,
        ok: issues.length === 0,
        issues,
      });
    } catch (err) {
      report.push({
        capability: entry.capability,
        model_id: entry.model_id,
        ok: false,
        issues: [err instanceof Error ? err.message : String(err)],
      });
    }
  }

  const broken = report.filter((r) => r.ok === false).length;
  return jsonResponse({ checked: report.length, broken, report });
}

// ── Storyboard ───────────────────────────────────────────────────────────────

type PieceRow = {
  id: string;
  channel_type: string;
  status: string;
  core_content: Json | null;
  adapted_content: Json | null;
  audit: Json | null;
};

async function handleCreateStoryboard(
  service: ServiceClient,
  body: Json,
  userId: string,
): Promise<Response> {
  const pieceId = body.piece_id;
  if (typeof pieceId !== 'string' || !pieceId) {
    return errorResponse(400, 'invalid_input', 'piece_id é obrigatório.');
  }

  const { data: piece } = await service
    .from('content_pieces')
    .select('id, channel_type, status, core_content, adapted_content, audit')
    .eq('id', pieceId)
    .maybeSingle<PieceRow>();
  if (!piece) return errorResponse(404, 'not_found', 'Peça não encontrada.');
  if (piece.channel_type !== 'instagram_reel') {
    return errorResponse(400, 'invalid_input', 'Esta peça não é um Reel.');
  }

  const adapted = piece.adapted_content as unknown as Extract<
    AdaptedContent,
    { channel_type: 'instagram_reel' }
  > | null;
  const beats = adapted?.script?.beats ?? [];
  if (beats.length === 0) {
    return errorResponse(400, 'invalid_input', 'A peça não tem roteiro em beats.');
  }

  // Storyboard existente não é re-dirigido em silêncio (perderia edição humana).
  // Exceção: projeto SEM cenas é resto de uma tentativa que morreu no meio —
  // devolvê-lo como "pronto" deixaria a UI travada num storyboard vazio.
  const { data: existing } = await service
    .from('video_projects')
    .select('id, status')
    .eq('piece_id', pieceId)
    .maybeSingle<{ id: string; status: string }>();
  if (existing) {
    const { count } = await service
      .from('video_scenes')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', existing.id);
    if ((count ?? 0) > 0) {
      return jsonResponse({ project_id: existing.id, status: existing.status, reused: true });
    }
    await service.from('video_projects').delete().eq('id', existing.id);
  }

  // Apresentador: o escolhido na tela; `avatar_id: null` explícito = sem
  // apresentador (só b-roll); campo ausente = o padrão ativo da instância.
  let avatarId = typeof body.avatar_id === 'string' && body.avatar_id ? body.avatar_id : null;
  if (avatarId) {
    const { data: chosen } = await service
      .from('brand_avatars')
      .select('id')
      .eq('id', avatarId)
      .eq('status', 'active')
      .maybeSingle();
    if (!chosen) {
      return errorResponse(
        400,
        'invalid_input',
        'Esse apresentador não existe mais ou foi arquivado. Escolha outro e tente de novo.',
      );
    }
  } else if (!('avatar_id' in body)) {
    const { data: defaultAvatar } = await service
      .from('brand_avatars')
      .select('id')
      .eq('is_default', true)
      .eq('status', 'active')
      .maybeSingle();
    avatarId = (defaultAvatar as { id: string } | null)?.id ?? null;
  }

  const [{ data: persona }, { data: kit }] = await Promise.all([
    service.from('brand_persona').select('content').eq('status', 'active').maybeSingle(),
    service.from('brand_kit').select('content').eq('status', 'active').maybeSingle(),
  ]);
  const kitContent = ((kit as { content?: Json } | null)?.content ?? {}) as {
    palette?: Record<string, string>;
    negative_constraints?: string[];
  };

  const core = (piece.core_content ?? {}) as { idea?: string };

  const defaults = await settingJson(service, 'video_defaults', { shots_per_beat_max: 3 });
  const shotsPerBeatMax = Number(defaults.shots_per_beat_max ?? 3);

  // As frases são numeradas AQUI, pelo código. O diretor escolhe por índice e
  // nunca digita fala — assim "a soma dos planos é a fala auditada" é invariante
  // estrutural, não uma comparação de strings feita depois.
  const sentences = (beats as ReelBeat[]).flatMap((beat) =>
    beatSentences(beat).map((text, sentence_index) => ({
      beat_index: beat.index,
      sentence_index,
      text,
    })),
  );

  const avatarAppearance = avatarId ? await loadAvatarAppearance(service, avatarId) : undefined;

  const messages = buildSceneDirectorMessages({
    beats: beats as ReelBeat[],
    sentences,
    shots_per_beat_max: shotsPerBeatMax,
    ...(avatarAppearance ? { avatar_appearance: avatarAppearance } : {}),
    idea: typeof core.idea === 'string' ? core.idea : '',
    ...(adapted?.script?.visual_hook ? { visual_hook: adapted.script.visual_hook } : {}),
    // deno-lint-ignore no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- persona chega como JSON livre do banco
    persona: (((persona as { content?: Json } | null)?.content ?? {}) as any),
    palette: kitContent.palette,
    negative_constraints: kitContent.negative_constraints,
    has_avatar: Boolean(avatarId),
  });

  // O storyboard cresceu (conceito + mais planos com visual_prompt longo):
  // 4000 tokens truncava o JSON no meio e o parse falhava.
  const result = await chat({
    role_hint: 'generator',
    messages,
    schema: SCENE_DIRECTOR_SCHEMA,
    max_tokens: 12000,
  });
  const directed = result.parsed as SceneDirectorOutput | undefined;
  if (!directed?.shots) {
    return errorResponse(502, 'provider_error', 'O diretor de cenas não devolveu um storyboard.');
  }

  // A decupagem do LLM passa por validação determinística: escala repetida em
  // cortes vizinhos, eixo atravessado e descrição de tempo no prompt de imagem
  // são corrigidos aqui. Gramática pedida é sugestão; validada é contrato.
  const { shots, fixes } = planDecoupage(
    beats as ReelBeat[],
    directed.shots,
    Boolean(avatarId),
    shotsPerBeatMax,
  );
  if (fixes.length > 0) console.warn(`[generate-video] decupagem ajustada: ${fixes.join('; ')}`);

  const { data: project, error: projectError } = await service
    .from('video_projects')
    .insert({
      piece_id: pieceId,
      status: 'storyboard',
      avatar_id: avatarId,
      style_bible: directed.look_block ?? null,
      // O conceito visual (fio concreto do caso) alimenta os prompts de keyframe
      // — sem ele o b-roll degenera para "escritório genérico".
      settings: { concept: directed.concept ?? null },
      created_by: userId,
    })
    .select('id, status')
    .single();
  if (projectError) {
    if ((projectError as { code?: string }).code === '23505') {
      return errorResponse(409, 'video_in_flight', 'Já existe um projeto de vídeo para esta peça.');
    }
    return errorResponse(500, 'internal_error', `Falha ao criar o projeto: ${projectError.message}`);
  }

  const projectId = (project as { id: string }).id;

  // Uma linha por PLANO. A narração de cada plano foi remontada pelo código a
  // partir das frases escolhidas — o LLM nunca a digitou.
  const rows = await Promise.all(
    shots.map(async (shot, index) => ({
      project_id: projectId,
      scene_index: index,
      beat_index: shot.beat_index,
      shot_index: shot.shot_index,
      role: shot.role,
      type: shot.type,
      narration: shot.narration,
      narration_hash: await sha256(shot.narration),
      visual_prompt: shot.visual_prompt,
      duration_target_s: shot.duration_target_s,
      shot_function: shot.shot_function,
      shot_size: shot.size,
      shot_angle: shot.angle,
      shot_lens: shot.lens,
      shot_movement: shot.movement,
      status: 'planned',
    })),
  );

  const { error: scenesError } = await service.from('video_scenes').insert(rows);
  if (scenesError) {
    // Sem transação entre os dois inserts: se as cenas falham, o projeto tem que
    // sair junto, senão a próxima chamada encontra um projeto vazio e "reusa".
    await service.from('video_projects').delete().eq('id', projectId);
    return errorResponse(500, 'internal_error', `Falha ao criar as cenas: ${scenesError.message}`);
  }

  return jsonResponse({ project_id: projectId, status: 'storyboard', scenes: rows.length }, 201);
}

// ── Edição do storyboard (grátis) ────────────────────────────────────────────

async function handleUpdateScene(service: ServiceClient, body: Json): Promise<Response> {
  const sceneId = body.scene_id;
  if (typeof sceneId !== 'string') {
    return errorResponse(400, 'invalid_input', 'scene_id é obrigatório.');
  }
  const patch = (body.patch ?? {}) as Json;

  const { data: scene } = await service
    .from('video_scenes')
    .select('id, project_id, status, narration')
    .eq('id', sceneId)
    .maybeSingle<{ id: string; project_id: string; status: string; narration: string }>();
  if (!scene) return errorResponse(404, 'not_found', 'Cena não encontrada.');

  // Editar com predição em voo produziria um vídeo que não bate com o texto.
  const { count } = await service
    .from('video_predictions')
    .select('id', { count: 'exact', head: true })
    .eq('scene_id', sceneId)
    .in('status', ['queued', 'submitted', 'processing', 'downloading']);
  if ((count ?? 0) > 0) {
    return errorResponse(
      409,
      'scene_busy',
      'Esta cena está sendo gerada agora. Aguarde terminar (ou cancele) para editar.',
    );
  }

  const update: Json = {};
  if (typeof patch.visual_prompt === 'string') update.visual_prompt = patch.visual_prompt.trim();
  if (typeof patch.duration_target_s === 'number') {
    update.duration_target_s = Math.min(12, Math.max(3, patch.duration_target_s));
  }
  if (patch.type === 'avatar' || patch.type === 'broll') update.type = patch.type;

  if (typeof patch.narration === 'string' && patch.narration.trim() !== scene.narration) {
    // Com a decupagem, a narração de um PLANO é uma fatia da fala auditada, e o
    // invariante do storyboard é "a soma dos planos é exatamente o roteiro
    // aprovado". Editar a fatia aqui romperia isso em silêncio — o texto tem que
    // mudar no roteiro, que passa pelo juiz de novo.
    return errorResponse(
      409,
      'narration_locked',
      'A fala de um plano é uma fatia do roteiro auditado e não se edita aqui. ' +
        'Ajuste o roteiro da peça e monte o storyboard de novo.',
    );
  }

  if (Object.keys(update).length === 0) {
    return jsonResponse({ ok: true, unchanged: true });
  }

  // Cena já renderizada + edição = 'stale' (o vídeo antigo é preservado até
  // alguém regerar, para não sumir com o material sob os pés do usuário).
  if (['ready', 'keyframe_ready'].includes(scene.status)) update.status = 'stale';

  const { error } = await service.from('video_scenes').update(update).eq('id', sceneId);
  if (error) return errorResponse(500, 'internal_error', `Falha ao atualizar: ${error.message}`);

  await recomputeProjectStatus(service, scene.project_id);
  return jsonResponse({ ok: true, stale: update.status === 'stale' });
}

async function handleReorderScenes(service: ServiceClient, body: Json): Promise<Response> {
  const projectId = body.project_id;
  const order = body.order;
  if (typeof projectId !== 'string' || !Array.isArray(order)) {
    return errorResponse(400, 'invalid_input', 'project_id e order são obrigatórios.');
  }
  const { error } = await service.rpc('reorder_video_scenes', {
    _project_id: projectId,
    _order: order,
  });
  if (error) return errorResponse(500, 'internal_error', `Falha ao reordenar: ${error.message}`);
  return jsonResponse({ ok: true });
}

// ── Estimativa e produção ────────────────────────────────────────────────────

type SceneEstimate = {
  scene_id: string;
  scene_index: number;
  type: string;
  duration_s: number;
  usd: number;
};

async function estimateProject(
  service: ServiceClient,
  projectId: string,
  phase: 'prep' | 'video' | 'all',
): Promise<{ total_usd: number; per_scene: SceneEstimate[] }> {
  const { data: project } = await service
    .from('video_projects')
    .select('id, resolution, avatar_id')
    .eq('id', projectId)
    .maybeSingle<{ id: string; resolution: string; avatar_id: string | null }>();

  const { data: scenes } = await service
    .from('video_scenes')
    .select('id, scene_index, type, narration, duration_target_s, audio_duration_s, model_overrides')
    .eq('project_id', projectId)
    .order('scene_index')
    .returns<
      Array<{
        id: string;
        scene_index: number;
        type: 'avatar' | 'broll';
        narration: string;
        duration_target_s: number;
        audio_duration_s: number | null;
        model_overrides: Record<string, string> | null;
      }>
    >();

  const per_scene: SceneEstimate[] = [];
  let assemblySeconds = 0;

  for (const scene of scenes ?? []) {
    const seconds = Number(scene.audio_duration_s ?? scene.duration_target_s);
    let usd = 0;

    // Os overrides POR CENA entram na cotação. Sem isso, depois de um fallback
    // automático a tela cotava o primário e o run usava outro modelo com outro
    // preço — o usuário aprovava um número e pagava outro.
    if (phase === 'prep' || phase === 'all') {
      const tts = await resolveModel(service, 'tts', scene.model_overrides?.tts);
      const keyframe = await resolveModel(service, 'keyframe', scene.model_overrides?.keyframe);
      usd += estimateCostUsd(tts, { chars: scene.narration.length });
      usd += estimateCostUsd(keyframe, { images: 1 });
    }
    if (phase === 'video' || phase === 'all') {
      const capability: VideoCapability = scene.type === 'avatar' ? 'talking_avatar' : 'scene_i2v';
      const entry = await resolveModel(service, capability, scene.model_overrides?.scene_video);
      const billed = billableDuration(entry.limits, seconds);
      usd += estimateCostUsd(entry, { duration_s: billed, resolution: fitResolution(entry.limits, project?.resolution) });
      // O normalizador roda por SEGUNDO do clipe — clipe gerado, não fala.
      assemblySeconds += billed;
      if (scene.type === 'broll') {
        const merge = await resolveModel(service, 'util_audio_merge');
        usd += estimateCostUsd(merge, {});
      }
    }

    per_scene.push({
      scene_id: scene.id,
      scene_index: scene.scene_index,
      type: scene.type,
      duration_s: Number(seconds.toFixed(2)),
      usd: Number(usd.toFixed(4)),
    });
  }

  // Montagem: o normalizador é por segundo de vídeo e era estimado com basis
  // vazio — dava US$ 0,00 e escondia ~US$ 1,50 por passada de montagem.
  let total = per_scene.reduce((sum, s) => sum + s.usd, 0);
  if (phase === 'video' || phase === 'all') {
    const [normalize, concat] = await Promise.all([
      resolveModel(service, 'util_normalize'),
      resolveModel(service, 'util_concat'),
    ]);
    total += estimateCostUsd(normalize, { duration_s: assemblySeconds });
    total += estimateCostUsd(concat, { duration_s: assemblySeconds });
  }

  void project;
  return { total_usd: Number(total.toFixed(4)), per_scene };
}

async function handleEstimate(service: ServiceClient, body: Json): Promise<Response> {
  const projectId = body.project_id;
  if (typeof projectId !== 'string') {
    return errorResponse(400, 'invalid_input', 'project_id é obrigatório.');
  }
  const phase = body.phase === 'prep' || body.phase === 'video' ? body.phase : 'all';
  const estimate = await estimateProject(service, projectId, phase);
  const spent = await monthSpend(service);
  const budget = await budgetCap(service);
  return jsonResponse({
    estimate,
    budget: { month_spent_usd: spent, monthly_cap_usd: budget },
  });
}

async function monthSpend(service: ServiceClient): Promise<number> {
  const { data } = await service.rpc('video_month_spend_usd');
  return Number(data ?? 0);
}

async function budgetCap(service: ServiceClient): Promise<number> {
  const { data } = await service
    .from('app_settings')
    .select('value')
    .eq('key', 'video_budget')
    .maybeSingle();
  const value = (data as { value?: { monthly_cap_usd?: number } } | null)?.value;
  return Number(value?.monthly_cap_usd ?? 100);
}

async function guardBudget(service: ServiceClient, extraUsd: number): Promise<Response | null> {
  const [spent, cap] = await Promise.all([monthSpend(service), budgetCap(service)]);
  if (spent + extraUsd > cap) {
    return errorResponse(
      402,
      'video_budget_exhausted',
      `Este lote (US$ ${extraUsd.toFixed(2)}) passaria do teto mensal de US$ ${cap.toFixed(2)} ` +
        `(já usados US$ ${spent.toFixed(2)}). Um administrador pode ajustar em Configurações.`,
      { month_spent_usd: spent, monthly_cap_usd: cap, batch_usd: extraUsd },
    );
  }
  return null;
}

/**
 * Modelo escolhido no portão da tela: grava em `model_overrides[key]` das cenas
 * do projeto (todas, ou só as do tipo dado). Valida antes: o modelo tem de
 * estar ativo na capability, senão 400 — nada de rodar com um id inventado.
 */
async function applyModelChoice(
  service: ServiceClient,
  projectId: string,
  capability: VideoCapability,
  key: 'keyframe' | 'scene_video',
  modelId: unknown,
  sceneType?: 'avatar' | 'broll',
): Promise<Response | null> {
  if (typeof modelId !== 'string' || !modelId.trim()) return null;
  try {
    await resolveModel(service, capability, modelId);
  } catch {
    return errorResponse(400, 'invalid_input', `O modelo ${modelId} não está ativo para esta etapa.`);
  }
  let query = service.from('video_scenes').select('id, type, model_overrides').eq('project_id', projectId);
  if (sceneType) query = query.eq('type', sceneType);
  const { data: rows } = await query.returns<
    Array<{ id: string; type: string; model_overrides: Record<string, string> | null }>
  >();
  for (const row of rows ?? []) {
    await service
      .from('video_scenes')
      .update({ model_overrides: { ...(row.model_overrides ?? {}), [key]: modelId } })
      .eq('id', row.id);
  }
  return null;
}

async function handleStartProduction(
  service: ServiceClient,
  token: string,
  body: Json,
  userId: string,
): Promise<Response> {
  const projectId = body.project_id;
  if (typeof projectId !== 'string') {
    return errorResponse(400, 'invalid_input', 'project_id é obrigatório.');
  }

  const { data: project } = await service
    .from('video_projects')
    .select('id, status, piece_id')
    .eq('id', projectId)
    .maybeSingle<{ id: string; status: string; piece_id: string }>();
  if (!project) return errorResponse(404, 'not_found', 'Projeto não encontrado.');
  if (!['storyboard', 'attention'].includes(project.status)) {
    return errorResponse(409, 'project_busy', `O projeto já está em "${project.status}".`);
  }

  // Peça com [VERIFICAR] pendente não vira áudio: o grounding existe para isso.
  const { data: piece } = await service
    .from('content_pieces')
    .select('audit')
    .eq('id', project.piece_id)
    .maybeSingle();
  const flags = ((piece as { audit?: { verify_flags?: unknown[] } } | null)?.audit
    ?.verify_flags ?? []) as unknown[];
  if (flags.length > 0) {
    return errorResponse(
      409,
      'verify_flags_pending',
      `Esta peça ainda tem ${flags.length} marcação [VERIFICAR]. Resolva antes de produzir o vídeo.`,
    );
  }

  const limited = await enforceRateLimit(userId, 'video-project');
  if (limited) return limited;

  // modelo de quadro escolhido no portão (antes da estimativa: ela lê o override)
  const badKeyframe = await applyModelChoice(service, projectId, 'keyframe', 'keyframe', body.keyframe_model);
  if (badKeyframe) return badKeyframe;

  const estimate = await estimateProject(service, projectId, 'prep');
  const denied = await guardBudget(service, estimate.total_usd);
  if (denied) return denied;

  await service
    .from('video_projects')
    .update({ status: 'generating_audio', estimated_cost_usd: estimate.total_usd, error: null })
    .eq('id', projectId)
    .eq('status', project.status);

  // Cena em failed/stale volta para 'planned' ANTES de avançar: o orquestrador
  // ignora estados terminais de propósito (para não reagir a webhook atrasado),
  // então quem quer reiniciar precisa dizer isso explicitamente.
  await service
    .from('video_scenes')
    .update({ status: 'planned', error: null })
    .eq('project_id', projectId)
    .in('status', ['failed', 'stale']);

  const { data: scenes } = await service
    .from('video_scenes')
    .select('id')
    .eq('project_id', projectId)
    .eq('status', 'planned')
    .returns<Array<{ id: string }>>();

  background(
    (async () => {
      for (const scene of scenes ?? []) {
        await advanceScene(service, token, scene.id);
      }
    })(),
  );

  return jsonResponse({ project_id: projectId, status: 'generating_audio', estimate }, 202);
}

async function handleApproveKeyframes(
  service: ServiceClient,
  token: string,
  body: Json,
  userId: string,
): Promise<Response> {
  const projectId = body.project_id;
  if (typeof projectId !== 'string') {
    return errorResponse(400, 'invalid_input', 'project_id é obrigatório.');
  }

  const { data: project } = await service
    .from('video_projects')
    .select('id, status')
    .eq('id', projectId)
    .maybeSingle<{ id: string; status: string }>();
  if (!project) return errorResponse(404, 'not_found', 'Projeto não encontrado.');
  if (!['keyframes_review', 'attention'].includes(project.status)) {
    return errorResponse(
      409,
      'project_busy',
      `Os keyframes ainda não estão prontos (projeto em "${project.status}").`,
    );
  }

  const limited = await enforceRateLimit(userId, 'video-scene');
  if (limited) return limited;

  // modelos escolhidos no portão: cenas de imagem (scene_i2v) e cenas com o
  // apresentador falando (talking_avatar) têm catálogos diferentes
  const badScene = await applyModelChoice(service, projectId, 'scene_i2v', 'scene_video', body.scene_model, 'broll');
  if (badScene) return badScene;
  const badAvatar = await applyModelChoice(service, projectId, 'talking_avatar', 'scene_video', body.avatar_model, 'avatar');
  if (badAvatar) return badAvatar;

  const estimate = await estimateProject(service, projectId, 'video');
  const denied = await guardBudget(service, estimate.total_usd);
  if (denied) return denied;

  // A fase de vídeo SOMA na estimativa persistida. Antes, este número era
  // calculado, mostrado e descartado — estimated_cost_usd ficava só com a fase
  // prep (US$ 0,35) contra um real de US$ 3,55, e todo relatório
  // estimado-vs-real nascia errado.
  const { data: current } = await service
    .from('video_projects')
    .select('estimated_cost_usd')
    .eq('id', projectId)
    .maybeSingle<{ estimated_cost_usd: number | null }>();
  const combined = Number(current?.estimated_cost_usd ?? 0) + estimate.total_usd;

  // CAS: só sai de keyframes_review uma vez, mesmo com dois cliques.
  const { data: moved } = await service
    .from('video_projects')
    .update({ status: 'generating_scenes', estimated_cost_usd: Number(combined.toFixed(4)) })
    .eq('id', projectId)
    .eq('status', project.status)
    .select('id')
    .maybeSingle();
  if (!moved) return errorResponse(409, 'project_busy', 'A produção já foi liberada.');

  // Mesmo motivo do start_production: estado terminal precisa ser reaberto.
  await service
    .from('video_scenes')
    .update({ status: 'keyframe_ready', error: null })
    .eq('project_id', projectId)
    .eq('status', 'failed')
    .not('keyframe_path', 'is', null);

  const { data: scenes } = await service
    .from('video_scenes')
    .select('id')
    .eq('project_id', projectId)
    .in('status', ['keyframe_ready', 'planned'])
    .returns<Array<{ id: string }>>();

  background(
    (async () => {
      for (const scene of scenes ?? []) {
        await advanceScene(service, token, scene.id);
      }
    })(),
  );

  return jsonResponse({ project_id: projectId, status: 'generating_scenes', estimate }, 202);
}

/**
 * Regeneração parcial. `from` escolhe o ponto de reentrada: o caso real mais
 * comum é "o vídeo saiu ruim, mas o áudio e o keyframe estão ótimos" — não faz
 * sentido pagar tudo de novo.
 */
async function handleRegenerateScene(
  service: ServiceClient,
  token: string,
  body: Json,
  userId: string,
): Promise<Response> {
  const sceneId = body.scene_id;
  if (typeof sceneId !== 'string') {
    return errorResponse(400, 'invalid_input', 'scene_id é obrigatório.');
  }
  const from = ['audio', 'keyframe', 'video'].includes(body.from as string)
    ? (body.from as 'audio' | 'keyframe' | 'video')
    : 'video';

  const { data: scene } = await service
    .from('video_scenes')
    .select('id, project_id, status')
    .eq('id', sceneId)
    .maybeSingle<{ id: string; project_id: string; status: string }>();
  if (!scene) return errorResponse(404, 'not_found', 'Cena não encontrada.');

  const { data: project } = await service
    .from('video_projects')
    .select('id, status')
    .eq('id', scene.project_id)
    .maybeSingle<{ id: string; status: string }>();
  if (project?.status === 'assembling') {
    return errorResponse(
      409,
      'project_busy',
      'A montagem está em andamento — aguarde terminar para regerar uma cena.',
    );
  }

  const limited = await enforceRateLimit(userId, 'video-scene');
  if (limited) return limited;

  // Limpa só os artefatos a partir do ponto de reentrada (os anteriores ficam).
  const patch: Json = { status: 'planned', error: null, final_path: null };
  if (from === 'audio') {
    // O keyframe NÃO depende da duração da fala — regerar o áudio não precisa
    // pagar outro keyframe (US$ 0,08 por regeração, à toa).
    patch.audio_path = null;
    patch.audio_duration_s = null;
    patch.video_path = null;
  } else if (from === 'keyframe') {
    patch.keyframe_path = null;
    patch.video_path = null;
  } else {
    patch.video_path = null;
  }

  await service.from('video_scenes').update(patch).eq('id', sceneId);

  // A montagem anterior deixa de valer: o concat será refeito com a cena nova.
  // MARCAR como superada, nunca apagar — a linha é o registro do custo já pago,
  // e `video_month_spend_usd()` soma esta tabela. Apagar faria dinheiro gasto
  // sumir do teto mensal a cada regeneração.
  const supersededAt = new Date().toISOString();
  await service
    .from('video_predictions')
    .update({ superseded_at: supersededAt })
    .eq('project_id', scene.project_id)
    .eq('kind', 'concat')
    .eq('status', 'succeeded')
    .is('superseded_at', null);
  await service
    .from('video_predictions')
    .update({ superseded_at: supersededAt })
    .eq('scene_id', sceneId)
    .eq('kind', 'normalize')
    .eq('status', 'succeeded')
    .is('superseded_at', null);

  if (project && ['ready', 'scenes_ready'].includes(project.status)) {
    await service
      .from('video_projects')
      .update({ status: 'generating_scenes' })
      .eq('id', project.id);
  }

  background(advanceScene(service, token, sceneId));
  return jsonResponse({ ok: true, scene_id: sceneId, from }, 202);
}

async function handleAssemble(
  service: ServiceClient,
  token: string,
  body: Json,
): Promise<Response> {
  const projectId = body.project_id;
  if (typeof projectId !== 'string') {
    return errorResponse(400, 'invalid_input', 'project_id é obrigatório.');
  }

  // CAS: só entra em 'assembling' vindo de 'scenes_ready'. Sem isso, um
  // regenerate concorrente concatenaria um arquivo sendo substituído.
  const { data: moved } = await service
    .from('video_projects')
    .update({ status: 'assembling', error: null })
    .eq('id', projectId)
    .eq('status', 'scenes_ready')
    .select('id')
    .maybeSingle();
  if (!moved) {
    return errorResponse(
      409,
      'project_busy',
      'A montagem só começa com todas as cenas prontas e nenhuma outra em andamento.',
    );
  }

  background(advanceProject(service, token, projectId));
  return jsonResponse({ project_id: projectId, status: 'assembling' }, 202);
}

async function handleCancel(
  service: ServiceClient,
  token: string,
  body: Json,
): Promise<Response> {
  const projectId = body.project_id;
  if (typeof projectId !== 'string') {
    return errorResponse(400, 'invalid_input', 'project_id é obrigatório.');
  }
  const cancelled = await cancelProject(service, token, projectId);
  const spend = await projectSpendUsd(service, projectId);
  return jsonResponse({ ok: true, cancelled, spent_usd: spend });
}

/** Lê um bloco de app_settings com defaults, sem derrubar quando a chave falta. */
async function settingJson<T extends Record<string, unknown>>(
  service: ServiceClient,
  key: string,
  fallback: T,
): Promise<T> {
  const { data } = await service.from('app_settings').select('value').eq('key', key).maybeSingle();
  const value = (data as { value?: unknown } | null)?.value;
  return value && typeof value === 'object' ? ({ ...fallback, ...value } as T) : fallback;
}

/** Aparência do avatar — entra no look block para o diretor descrever a pessoa certa. */
async function loadAvatarAppearance(
  service: ServiceClient,
  avatarId: string,
): Promise<string | undefined> {
  const { data } = await service
    .from('brand_avatars')
    .select('appearance_prompt')
    .eq('id', avatarId)
    .maybeSingle<{ appearance_prompt: string | null }>();
  return data?.appearance_prompt ?? undefined;
}
