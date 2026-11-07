// video-edit — "Aprimorar com IA": o Claude assiste ao vídeo, sugere melhorias de
// um menu fechado e o motor edita no sandbox do Higgsfield, sem tocar no original.
// Contrato: docs/hub-motor-contratos.md §11. Fases: _shared/video-edit-engine.ts.
//
// Quem avança a edição é a própria edge: a ação responde na hora e segue em
// background; perto do limite de tempo ela chama a si mesma (`tick`) com o mesmo
// Authorization. Linha que ficar parada cai no watchdog (video-edits.sql).
//
// `plan` é o "Editar com Claude": pedido por voz ou texto vira um plano que a pessoa
// confere; efeitos de motion vão para o render-worker (Modal), o resto segue no sandbox.
//
// Deploy config: verify_jwt = false. A validação é interna (JWT de admin ou
// x-cron-secret): com o gateway exigindo JWT, o tick de minuto nunca chegaria aqui.

import { visionJson, type VisionPart } from '../_shared/llm.ts';
import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';
import { hfConnected, mcp, type Service } from '../_shared/hf-mcp.ts';
import { estimateLabel } from '../_shared/scene-edit.ts';
import { NotConnectedError } from '../_shared/not-connected.ts';
import { loadWebSearchSettings, webSearchChain } from '../_shared/web-search.ts';
import { expectedDuration, normalizeOps, parseProbe, PROBE_COMMAND, type Op } from '../_shared/video-edit.ts';
import { EDIT_MODEL,
  ACTIVE_STATUSES, advanceEdit, ANALYSIS_USD, EditBlocked, editContext, motionUsd, sanitizePlan, editedArtifact, opsOfSuggestions, PLAN_USD, planOfSteps, QA_USD, sourceFacts, usableLogo,
  type BrandInfo, type EditIo, type EditRow, type WorkerStatus,
  planHasCaptions,
} from '../_shared/video-edit-engine.ts';
import { MAX_ATTACHMENTS, MAX_CAPTION_WORDS, MAX_DURATION_S, type Attachment, type AttachmentKind, type Source } from '../_shared/video-motion.ts';

import { deliveredPath, deliveryIssues, deliveryProbe, finalDeliveryPath, isMp4Head, MIN_DELIVERY_BYTES, parseDelivery, RENDER_HOLD_MS, RENDER_RECIPE } from '../_shared/video-receita.ts';

import { driveRequired, requireDrive } from '../_shared/drive-gate.ts';
import { acordarRotina, ROTINA_TOKEN, ROTINA_URL } from '../_shared/claude-rotina.ts';
import { RECEITA_DA_MONTAGEM } from '../_shared/roteiro.ts';

/** A receita de montagem mais o que é técnico do envio (o resto da RENDER_RECIPE é de Reels 9:16). */
const RECEITA_DA_MONTAGEM_RENDER = `${RECEITA_DA_MONTAGEM}

PREPARO E ENVIO
- video_render traz source_url (o vídeo do apresentador), anexos (as cenas ao vivo e gravações que a pessoa enviou), marca (cor, destaque, fonte, logo) e envio. Baixe tudo com curl -fL; link vencido, chame video_render de novo.
- video_ver traz a transcrição por palavra (índice, palavra, início e fim em segundos) e quadros: é por ela que você acha o tempo de cada passo.
- O formato final é o do plano (plano.formato). Entregue o MP4 por PUT em envio.url com content-type video/mp4 e chame video_entregar com fontes e ficou_de_fora.`;
import { ArchivedFileError, downloadRestoring, signRestoring } from '../_shared/drive-restore.ts';
import { segredoIgual } from '../_shared/segredo-igual.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const BUCKET = 'renders';
const BRAND_BUCKET = 'brand-assets';
const LEASE_MS = 3 * 60 * 1000;
const RUN_BUDGET_MS = 100 * 1000;
/** Uma chamada externa não pode prender a execução além do que a edge aguenta. */
const CALL_TIMEOUT_MS = 90 * 1000;
const STEP_PAUSE_MS = 5000;
const AUTO_WINDOW_MS = 6 * 3600 * 1000;
const FONT = {
  name: 'Montserrat-ExtraBold.ttf',
  fallback: 'https://raw.githubusercontent.com/JulietaUla/Montserrat/master/fonts/ttf/Montserrat-ExtraBold.ttf',
};
const SAFE_PATH = /^(?!.*\.\.)[\w./-]+\.(mp4|mov|webm|m4v)$/i;
const MAX_REQUEST_CHARS = 2000;
/** Transcrição de um vídeo pelo conector: o resto do plano é do Claude da pessoa. */
const EXTERNAL_OPEN_USD = 0.02;
const UPLOAD_TYPES: Record<string, { ext: string; kind: AttachmentKind }> = {
  'video/mp4': { ext: 'mp4', kind: 'video' },
  'video/quicktime': { ext: 'mov', kind: 'video' },
  'image/png': { ext: 'png', kind: 'image' },
  'image/jpeg': { ext: 'jpg', kind: 'image' },
  'image/webp': { ext: 'webp', kind: 'image' },
  'audio/mpeg': { ext: 'mp3', kind: 'audio' },
  'audio/mp3': { ext: 'mp3', kind: 'audio' },
  'audio/wav': { ext: 'wav', kind: 'audio' },
  'audio/x-wav': { ext: 'wav', kind: 'audio' },
  'audio/wave': { ext: 'wav', kind: 'audio' },
  'audio/mp4': { ext: 'm4a', kind: 'audio' },
  'audio/x-m4a': { ext: 'm4a', kind: 'audio' },
};
const KIND_BY_EXT: Record<string, AttachmentKind> = Object.fromEntries(
  Object.values(UPLOAD_TYPES).map((t) => [t.ext, t.kind]),
);
const UPLOAD_PATH = /^edits\/uploads\/[0-9a-f-]{36}\.([a-z0-9]+)$/;

const vault = async (service: Service, name: string): Promise<string | null> => {
  const { data } = await service.rpc('get_vault_secret', { _name: name });
  return (data as string) || null;
};

async function workerFetch(service: Service, path: string, init: RequestInit = {}): Promise<Response> {
  const [base, token] = await Promise.all([vault(service, 'RENDER_WORKER_URL'), vault(service, 'RENDER_WORKER_TOKEN')]);
  if (!base || !token) throw new Error('render-worker sem URL ou token no Vault');
  return await fetch(`${base.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  });
}

/** Arquivo no Drive sem poder voltar: a edição para com a frase pronta, não com erro técnico. */
function archivedToBlocked(err: unknown): never {
  throw err instanceof ArchivedFileError ? new EditBlocked(err.message) : err;
}

function makeIo(service: Service): EditIo {
  const io: EditIo = {
    async patchEdit(id, fields) {
      const { error } = await service.from('video_edits').update(fields).eq('id', id);
      if (error) throw new Error(`patch edit: ${error.message}`);
    },
    async brand(): Promise<BrandInfo> {
      const [{ data: kit }, { data: channels }] = await Promise.all([
        service.from('brand_kit').select('content').eq('status', 'active').maybeSingle(),
        service.from('channels').select('config').eq('enabled', true),
      ]);
      const content = (kit?.content ?? {}) as {
        palette?: Record<string, string>; logo_path?: string | null; logo_alpha_path?: string | null;
      };
      const palette = content.palette ?? {};
      const handle = ((channels ?? []) as { config: Record<string, unknown> | null }[])
        .map((c) => c.config?.handle ?? c.config?.username).find((h) => typeof h === 'string' && h) as string | undefined;
      return {
        primary: palette.primary ?? '#111111',
        accent: palette.accent ?? palette.primary ?? '#FFD400',
        logoPath: content.logo_alpha_path ?? content.logo_path ?? null,
        handle: handle ? (handle.startsWith('@') ? handle : `@${handle}`) : null,
        font: null,
      };
    },
    async sourceContext(edit) {
      if (edit.source_kind !== 'job') {
        const id = /^edits\/([^/]+)\/(?:out|motion)\.mp4$/.exec(edit.source_path)?.[1];
        if (!id) return { objective: null, captionsBurned: false };
        const { data } = await service.from('video_edits').select('plan').eq('id', id).maybeSingle();
        return { objective: null, captionsBurned: planHasCaptions(data?.plan) };
      }
      const { data } = await service.from('director_jobs').select('brief, config, artifacts').eq('id', edit.source_id!).maybeSingle();
      return sourceFacts(data ?? {});
    },
    async sign(path, opts) {
      const bucket = opts?.bucket === 'brand' ? BRAND_BUCKET : BUCKET;
      return await signRestoring(service, bucket, path, opts?.expiresIn ?? 7200).catch(archivedToBlocked);
    },
    async signUpload(path) {
      await service.storage.from(BUCKET).remove([path]).catch(() => {});
      const { data, error } = await service.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
      if (error || !data?.signedUrl) throw new Error(`signUpload ${path}: ${error?.message}`);
      return data.signedUrl;
    },
    async putObject(path, body, contentType) {
      const { error } = await service.storage.from(BUCKET).upload(path, body, { contentType, upsert: true });
      if (error) throw new Error(`upload ${path}: ${error.message}`);
    },
    async getObject(path) {
      const data = await downloadRestoring(service, BUCKET, path).catch(archivedToBlocked);
      return new Uint8Array(await data.arrayBuffer());
    },
    async fontUrls() {
      const url = await io.sign(`director/assets/fonts/${FONT.name}`).catch(() => FONT.fallback);
      return { [FONT.name]: url };
    },
    sandbox: (command, opts) => mcp(service, 'sandbox_exec', { command, ...opts }),
    async stt(audio) {
      const key = await vault(service, 'ELEVEN_API_KEY');
      if (!key) throw new NotConnectedError('elevenlabs', 'Conecte o ElevenLabs em Integrações para o Claude ouvir o vídeo.');
      const form = new FormData();
      form.append('model_id', 'scribe_v2');
      form.append('tag_audio_events', 'true');
      form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/mp4' }), 'audio.m4a');
      const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST', headers: { 'xi-api-key': key }, body: form, signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      if (!r.ok) throw new Error(`stt ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return await r.json();
    },
    async modelo(body) {
      // O motor monta o pedido em blocos (texto + quadros); o gateway incluso responde.
      const mensagem = (body.messages as Array<{ content?: unknown }> | undefined)?.[0];
      const blocos = Array.isArray(mensagem?.content) ? (mensagem!.content as Array<Record<string, unknown>>) : [];
      const parts: VisionPart[] = blocos.flatMap<VisionPart>((b) => {
        if (b.type === 'text' && typeof b.text === 'string') return [{ type: 'text' as const, text: b.text }];
        const source = b.source as { media_type?: string; data?: string } | undefined;
        if (b.type === 'image' && source?.data) {
          return [{ type: 'image' as const, media_type: source.media_type ?? 'image/jpeg', data: source.data }];
        }
        return [];
      });
      const schema = ((body.output_config as { format?: { schema?: Record<string, unknown> } } | undefined)?.format?.schema) ?? {};
      const { text, usage } = await visionJson({
        model: String(body.model ?? EDIT_MODEL),
        system: String(body.system ?? ''),
        parts,
        schema,
        max_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : undefined,
      });
      return { stop_reason: 'end_turn', usage, content: [{ type: 'text', text }] };
    },
    async markEdited(edit, path) {
      if (edit.source_kind !== 'job') return;
      const { data } = await service.from('director_jobs').select('artifacts').eq('id', edit.source_id!).single();
      const artifacts = { ...(data?.artifacts as Record<string, unknown>), edited: editedArtifact(edit, path) };
      const { error } = await service.from('director_jobs').update({ artifacts }).eq('id', edit.source_id!);
      if (error) throw new Error(`markEdited: ${error.message}`);
    },
    async search(query) {
      const result = await webSearchChain(query, await loadWebSearchSettings());
      if (result.status !== 'ok') return [];
      const { sources, digest } = result.outcome;
      return sources.slice(0, 4).map((s): Source => ({ title: s.title || s.url, url: s.url, text: s.snippet || digest }));
    },
    async workerSubmit(body) {
      const r = await workerFetch(service, '/submit', { method: 'POST', body: JSON.stringify(body) });
      const text = await r.text();
      if (r.status === 400) {
        const detail = (() => {
          try {
            return (JSON.parse(text) as { detail?: unknown }).detail;
          } catch {
            return null;
          }
        })();
        if (typeof detail === 'string') throw new EditBlocked(detail);
      }
      if (!r.ok) throw new Error(`worker ${r.status}: ${text.slice(0, 300)}`);
      return (JSON.parse(text) as { call_id: string }).call_id;
    },
    async workerStatus(callId) {
      const r = await workerFetch(service, `/status?call_id=${encodeURIComponent(callId)}`);
      if (!r.ok) throw new Error(`worker status ${r.status}`);
      return await r.json() as WorkerStatus;
    },
  };
  return io;
}

// ── avanço ───────────────────────────────────────────────────────────────────
async function claim(service: Service, id: string): Promise<EditRow | null> {
  const cutoff = new Date(Date.now() - LEASE_MS).toISOString();
  const { data } = await service.from('video_edits')
    .update({ claimed_by: 'edge', claimed_at: new Date().toISOString() })
    .eq('id', id)
    .or(`claimed_by.is.null,claimed_at.lt.${cutoff}`)
    .select('*')
    .maybeSingle();
  return data as EditRow | null;
}

/**
 * Quem passa o bastão é a própria edge, com credencial de servidor: o token da
 * pessoa pode vencer no meio de um render longo.
 */
async function batonHeaders(service: Service, auth: Headers): Promise<Headers> {
  const secret = await vault(service, 'VIDEO_CRON_SECRET');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret || !serviceKey) return auth;
  return new Headers({
    'content-type': 'application/json', authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'x-cron-secret': secret,
  });
}

/** Roda a edição até o repouso ou até o limite do tempo; aí passa o bastão. */
async function drive(service: Service, id: string, auth: Headers): Promise<void> {
  const io = makeIo(service);
  const until = Date.now() + RUN_BUDGET_MS;
  while (Date.now() < until) {
    const edit = await claim(service, id);
    if (!edit) return; // outra execução está com a edição
    const more = await advanceEdit(io, edit);
    await service.from('video_edits').update({ claimed_by: null }).eq('id', id);
    if (!more) {
      await acordarSePedidoAberto(service, id).catch((err) => console.warn('[video-edit] acordar rotina:', err));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, STEP_PAUSE_MS));
  }
  // credencial de servidor primeiro; se o gateway recusar, tenta a da pessoa
  const server = await batonHeaders(service, auth);
  for (const headers of [server, server, auth]) {
    const passed = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/video-edit`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'tick', edit_id: id }),
    }).then(async (r) => { await r.body?.cancel(); return r.ok; }).catch(() => false);
    if (passed) return;
    await new Promise((resolve) => setTimeout(resolve, STEP_PAUSE_MS));
  }
  console.error('[video-edit] bastão não passou:', id);
}

/**
 * Pedido pelo conector pronto para o Claude da pessoa (status suggested com
 * request): acorda a rotina dela uma vez. Sem rotina, o pedido espera a próxima
 * conversa dela, como sempre.
 */
async function acordarSePedidoAberto(service: Service, id: string): Promise<void> {
  const { data } = await service.from('video_edits').select('status, analysis').eq('id', id).maybeSingle();
  const edit = data as { status: string; analysis: Record<string, unknown> } | null;
  if (!edit || edit.status !== 'suggested' || !edit.analysis?.external || !edit.analysis?.request || edit.analysis?.acordou !== undefined) return;
  const [url, token] = await Promise.all([vault(service, ROTINA_URL), vault(service, ROTINA_TOKEN)]);
  if (!url || !token) return;
  const acordou = await acordarRotina({ url, token, texto: `Vídeo ${id}` });
  await service.from('video_edits').update({ analysis: { ...edit.analysis, acordou } }).eq('id', id);
}

function background(task: Promise<unknown>): void {
  const guarded = task.catch((err) => console.error('[video-edit] background:', err));
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime) EdgeRuntime.waitUntil(guarded);
}

function forwardHeaders(req: Request): Headers {
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const name of ['Authorization', 'apikey', 'x-cron-secret']) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

// ── teto mensal ──────────────────────────────────────────────────────────────
async function overBudget(service: Service, extraUsd: number): Promise<Response | null> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const [{ data: spent }, { data: edits }, { data: cap }] = await Promise.all([
    service.rpc('video_month_spend_usd'),
    service.from('video_edits').select('cost_usd').gte('created_at', start.toISOString()),
    service.from('app_settings').select('value').eq('key', 'video_budget').maybeSingle(),
  ]);
  const total = Number(spent ?? 0) + ((edits ?? []) as { cost_usd: number }[]).reduce((s, e) => s + Number(e.cost_usd), 0);
  const limit = Number((cap?.value as { monthly_cap_usd?: number } | null)?.monthly_cap_usd ?? 100);
  if (total + extraUsd <= limit) return null;
  return errorResponse(402, 'video_budget_exhausted',
    `Esta edição passaria do teto mensal de US$ ${limit.toFixed(2)} (já usados US$ ${total.toFixed(2)}). Um administrador pode ajustar em Configurações.`);
}

// ── ações ────────────────────────────────────────────────────────────────────
type Body = Record<string, unknown>;

async function readEdit(service: Service, id: unknown): Promise<EditRow | null> {
  if (typeof id !== 'string') return null;
  const { data } = await service.from('video_edits').select('*').eq('id', id).maybeSingle();
  return data as EditRow | null;
}

/** Vídeo novo ou em andamento no mesmo original: nunca duas edições em paralelo. */
async function activeOn(service: Service, edit: Pick<EditRow, 'source_path'>, exceptId?: string): Promise<boolean> {
  const { data } = await service.from('video_edits').select('id')
    .eq('source_path', edit.source_path).in('status', ACTIVE_STATUSES);
  return ((data ?? []) as { id: string }[]).some((row) => row.id !== exceptId);
}

async function createAnalysis(
  service: Service, source: { kind: 'job' | 'path'; id: string | null; path: string }, createdBy: string | null, auto: boolean,
): Promise<string> {
  const { data, error } = await service.from('video_edits').insert({
    source_kind: source.kind, source_id: source.id, source_path: source.path, created_by: createdBy, auto,
  }).select('id').single();
  if (error || !data) throw new Error(`insert: ${error?.message}`);
  return data.id as string;
}

type Resolved = { kind: 'job' | 'path'; id: string | null; path: string };

async function resolveSource(service: Service, body: Body): Promise<Resolved | Response> {
  const source = (body.source ?? {}) as { job_id?: string; path?: string };
  let resolved: Resolved;
  if (typeof source.job_id === 'string') {
    const { data: job } = await service.from('director_jobs').select('id, status, artifacts').eq('id', source.job_id).maybeSingle();
    if (!job) return errorResponse(404, 'not_found', 'Vídeo não encontrado.');
    const arts = (job.artifacts ?? {}) as { final?: string; final_rebuilding?: boolean };
    if (job.status !== 'done' || !arts.final || arts.final_rebuilding) {
      return errorResponse(409, 'not_ready', 'O vídeo ainda não está pronto.');
    }
    resolved = { kind: 'job', id: job.id as string, path: arts.final };
  } else if (typeof source.path === 'string' && SAFE_PATH.test(source.path)) {
    try {
      await signRestoring(service, BUCKET, source.path, 60);
    } catch (err) {
      if (err instanceof ArchivedFileError) return errorResponse(409, 'file_archived', err.message);
      return errorResponse(404, 'not_found', 'Vídeo não encontrado.');
    }
    resolved = { kind: 'path', id: null, path: source.path };
  } else {
    return errorResponse(404, 'not_found', 'Vídeo não encontrado.');
  }
  return resolved;
}

async function missingConnection(service: Service): Promise<Response | null> {
  if (!(await hfConnected(service))) return errorResponse(400, 'higgsfield_not_connected', 'Conecte o Higgsfield para editar.');
  if (!(await vault(service, 'ELEVEN_API_KEY'))) return errorResponse(400, 'elevenlabs_not_connected', 'Conecte o ElevenLabs em Integrações para o Claude ouvir o vídeo.');
  return null;
}

async function suggest(service: Service, body: Body, userId: string | null, req: Request): Promise<Response> {
  const resolved = await resolveSource(service, body);
  if (resolved instanceof Response) return resolved;

  const { data: open } = await service.from('video_edits').select('id, status')
    .eq('source_path', resolved.path).in('status', [...ACTIVE_STATUSES, 'suggested'])
    .order('created_at', { ascending: false }).limit(1);
  const current = (open ?? [])[0] as { id: string } | undefined;
  if (current) return jsonResponse({ edit_id: current.id });

  const missing = await missingConnection(service);
  if (missing) return missing;
  const blocked = await overBudget(service, ANALYSIS_USD);
  if (blocked) return blocked;

  const id = await createAnalysis(service, resolved, userId, false);
  background(drive(service, id, forwardHeaders(req)));
  return jsonResponse({ edit_id: id }, 202);
}

async function renderReady(service: Service): Promise<boolean> {
  return Boolean((await vault(service, 'RENDER_WORKER_URL')) && (await vault(service, 'RENDER_WORKER_TOKEN')));
}

function readAttachments(raw: unknown): Attachment[] | null {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > MAX_ATTACHMENTS) return null;
  const out: Attachment[] = [];
  for (const path of list) {
    const ext = typeof path === 'string' ? path.match(UPLOAD_PATH)?.[1] : undefined;
    const kind = ext ? KIND_BY_EXT[ext] : undefined;
    if (!kind) return null;
    out.push({ path: path as string, kind });
  }
  return out;
}

/** Pedido por voz ou texto: reaproveita a análise do vídeo quando ela já existe. */
async function plan(service: Service, body: Body, userId: string | null, req: Request): Promise<Response> {
  const request = typeof body.request === 'string' ? body.request.trim().slice(0, MAX_REQUEST_CHARS) : '';
  if (!request) return errorResponse(400, 'invalid_request', 'Diga o que você quer mudar no vídeo.');
  const attachments = readAttachments(body.attachments);
  if (!attachments) return errorResponse(400, 'invalid_attachments', 'Um dos arquivos enviados não é válido.');
  const resolved = await resolveSource(service, body);
  if (resolved instanceof Response) return resolved;
  if (await activeOn(service, { source_path: resolved.path })) {
    return errorResponse(409, 'edit_running', 'Já há uma edição em andamento neste vídeo.');
  }
  // pelo conector, quem pensa é o Claude da pessoa: aqui só se prepara o vídeo
  const viaConnector = body.via === 'connector';
  if (!viaConnector) {
    const missing = await missingConnection(service);
    if (missing) return missing;
  }
  const blocked = await overBudget(service, viaConnector ? EXTERNAL_OPEN_USD : PLAN_USD);
  if (blocked) return blocked;

  const { data: queued } = await service.from('video_edits').select('id')
    .eq('source_path', resolved.path).eq('status', 'suggested').eq('analysis->>external', 'true')
    .not('analysis->>request', 'is', null).is('analysis->draft', null).limit(1);
  if (viaConnector && queued?.length) {
    return errorResponse(409, 'request_open', 'Já há um pedido aberto para este vídeo.');
  }

  const { data: prior } = await service.from('video_edits').select('id, analysis')
    .eq('source_path', resolved.path).not('analysis->words', 'is', null)
    .order('created_at', { ascending: false }).limit(1);
  const base = (prior ?? [])[0] as Pick<EditRow, 'id' | 'analysis'> | undefined;
  // plano de produção escrito pelo Claude da pessoa (roteiro pela tela Vídeos): vai inteiro ao conector
  const plano = viaConnector && body.plano && typeof body.plano === 'object' ? body.plano : undefined;
  // montagem pelo plano: quem transcreve e monta é o Claude da pessoa, no computador dela;
  // sem Higgsfield ou ElevenLabs o pedido abre do mesmo jeito, só sem a transcrição pronta
  const semAnalise = Boolean(plano) && !base && (!(await hfConnected(service)) || !(await vault(service, 'ELEVEN_API_KEY')));
  if (viaConnector && !base && !plano) {
    if (!(await hfConnected(service))) return errorResponse(400, 'higgsfield_not_connected', 'Conecte o Higgsfield para editar.');
    if (!(await vault(service, 'ELEVEN_API_KEY'))) return errorResponse(400, 'elevenlabs_not_connected', 'Conecte o ElevenLabs para o Claude ouvir o vídeo.');
  }
  // pedido novo pesquisa de novo; `external` é só de quem veio pelo conector
  const priorAnalysis: (EditRow['analysis'] & { plano?: unknown }) | undefined = base?.analysis;
  const { suggestions: _s, draft: _d, sources: _f, external: _e, claim: _c, plano: _p, ...known } = priorAnalysis ?? {};
  const reuse = base ? { ...known, frames_from: base.analysis.frames_from ?? base.id } : {};
  const { data, error } = await service.from('video_edits').insert({
    source_kind: resolved.kind, source_id: resolved.id, source_path: resolved.path, created_by: userId,
    status: viaConnector && (base || semAnalise) ? 'suggested' : 'analyzing',
    analysis: {
      ...reuse, request, attachments, render_ready: await renderReady(service),
      ...(viaConnector ? { external: true } : {}), ...(plano ? { plano } : {}),
    },
  }).select('id').single();
  if (error || !data) throw new Error(`insert: ${error?.message}`);
  if (!(viaConnector && (base || semAnalise))) background(drive(service, data.id as string, forwardHeaders(req)));
  else background(acordarSePedidoAberto(service, data.id as string));
  return jsonResponse({ edit_id: data.id }, 202);
}

/**
 * Conector MCP: abre o vídeo para o Claude da própria pessoa. Só transcreve e tira
 * quadros; não chama a API do Claude. Com análise anterior, nem isso.
 */
async function externalOpen(service: Service, body: Body, req: Request): Promise<Response> {
  const resolved = await resolveSource(service, body);
  if (resolved instanceof Response) return resolved;
  if (await activeOn(service, { source_path: resolved.path })) {
    return errorResponse(409, 'edit_running', 'Já há uma edição em andamento neste vídeo. Veja de novo em instantes.');
  }
  // reabrir o mesmo vídeo não esconde um plano nem uma versão da tela
  const { data: open } = await service.from('video_edits').select('id')
    .eq('source_path', resolved.path).eq('status', 'suggested').eq('analysis->>external', 'true')
    .order('created_at', { ascending: false }).limit(1);
  const opened = (open ?? [])[0] as { id: string } | undefined;
  if (opened) return jsonResponse({ edit_id: opened.id });
  const { data: prior } = await service.from('video_edits').select('id, analysis')
    .eq('source_path', resolved.path).not('analysis->words', 'is', null)
    .order('created_at', { ascending: false }).limit(1);
  const base = (prior ?? [])[0] as Pick<EditRow, 'id' | 'analysis'> | undefined;
  if (!base) {
    const blocked = await overBudget(service, EXTERNAL_OPEN_USD);
    if (blocked) return blocked;
    if (!(await hfConnected(service))) return errorResponse(400, 'higgsfield_not_connected', 'Conecte o Higgsfield para editar.');
    if (!(await vault(service, 'ELEVEN_API_KEY'))) return errorResponse(400, 'elevenlabs_not_connected', 'Conecte o ElevenLabs para transcrever o vídeo.');
  }
  const { suggestions: _s, draft: _d, sources: _f, request: _r, claim: _c, ...known } = base?.analysis ?? {};
  const analysis = { ...(base ? { ...known, frames_from: base.analysis.frames_from ?? base.id } : {}), external: true };
  const { data, error } = await service.from('video_edits').insert({
    source_kind: resolved.kind, source_id: resolved.id, source_path: resolved.path, analysis,
    status: base ? 'suggested' : 'analyzing',
  }).select('id').single();
  if (error || !data) throw new Error(`insert: ${error?.message}`);
  if (!base) background(drive(service, data.id as string, forwardHeaders(req)));
  return jsonResponse({ edit_id: data.id }, 202);
}

/** Conector MCP: o plano montado pelo Claude da pessoa entra pelo mesmo `apply`. */
async function externalApply(service: Service, body: Body, req: Request): Promise<Response> {
  const edit = await readEdit(service, body.edit_id);
  if (!edit) return errorResponse(404, 'not_found', 'Edição não encontrada.');
  if (!edit.analysis.duration_s) return errorResponse(409, 'not_analyzed', 'O vídeo ainda não foi analisado.');
  if (ACTIVE_STATUSES.includes(edit.status) || (await activeOn(service, edit))) {
    return errorResponse(409, 'edit_running', 'Já há uma edição em andamento neste vídeo.');
  }
  // pedido cancelado ou já atendido não gera outra versão nem outro render
  if (edit.analysis.request && edit.status !== 'suggested') {
    return errorResponse(409, 'request_closed', 'Este pedido já foi atendido ou cancelado.');
  }
  const ready = await renderReady(service);
  const brand = await makeIo(service).brand();
  const ctx = editContext(edit.analysis, { logo: !!usableLogo(brand.logoPath), primary: brand.primary, handle: brand.handle, font: brand.font });
  const sources = (Array.isArray(body.sources) ? body.sources : []).slice(0, 8).map((raw): Source => {
    const s = (raw ?? {}) as Record<string, unknown>;
    return { title: String(s.title ?? '').slice(0, 200), url: String(s.url ?? '').slice(0, 500), text: String(s.text ?? '').slice(0, 4000) };
  });
  const clean = sanitizePlan({ summary: '', steps: body.steps, not_possible: [] }, { ...ctx, sources }, ready);
  if (!clean.steps.length) {
    // pedido sem saída encerra aqui: senão o Claude da pessoa pega o mesmo pedido de novo
    if (edit.analysis.request) {
      await makeIo(service).patchEdit(edit.id, {
        status: 'failed', error: clean.not_possible[0] ?? 'Não deu para atender este pedido.',
      });
    }
    return jsonResponse({ applied: false, not_possible: clean.not_possible }, 400);
  }
  const motion = clean.steps.some((s) => s.layers.length || s.music);
  const draft = { ...clean, sources, usd: motion ? motionUsd(ctx.duration) : 0, duration_after: ctx.duration };
  await makeIo(service).patchEdit(edit.id, { analysis: { ...edit.analysis, draft } });
  const applied = await apply(service, { edit_id: edit.id, steps: clean.steps.map((_, i) => i) }, null, req);
  if (!applied.ok) return applied;
  const result = await applied.json() as Record<string, unknown>;
  return jsonResponse({ ...result, applied: true, not_possible: clean.not_possible }, 202);
}

/** Entrega ao Claude da pessoa o que ele precisa para renderizar no ambiente dele. */
async function externalRender(service: Service, body: Body): Promise<Response> {
  const edit = await readEdit(service, body.edit_id);
  if (!edit) return errorResponse(404, 'not_found', 'Edição não encontrada.');
  if (edit.status !== 'suggested') return errorResponse(409, 'not_open', 'Abra o vídeo de novo em video_abrir.');
  const sign = (path: string, bucket = BUCKET) => signRestoring(service, bucket, path, 6 * 3600);
  const { data, error } = await service.storage.from(BUCKET).createSignedUploadUrl(deliveredPath(edit.id), { upsert: true });
  if (error || !data) throw new Error(`entrega: ${error?.message}`);
  const io = makeIo(service);
  // render demora mais que a reserva do pedido: ele não volta à fila no meio
  const now = Date.now();
  await io.patchEdit(edit.id, {
    analysis: { ...edit.analysis, claim: { at: now, attempts: edit.analysis.claim?.attempts ?? 0, render_until: now + RENDER_HOLD_MS } },
  });
  const brand = await io.brand();
  const logo = usableLogo(brand.logoPath);
  // pedido de montagem pelo plano (roteiro escrito pelo Claude da pessoa): a receita é a da montagem
  const plano = (edit.analysis as { plano?: unknown }).plano;
  return jsonResponse({
    receita: plano ? RECEITA_DA_MONTAGEM_RENDER : RENDER_RECIPE,
    ...(plano ? { plano } : {}),
    source_url: await sign(edit.source_path),
    anexos: await Promise.all((edit.analysis.attachments ?? []).map(async (a) => ({ tipo: a.kind, url: await sign(a.path) }))),
    marca: { cor: brand.primary, destaque: brand.accent, fonte: brand.font, handle: brand.handle, logo_url: logo ? await sign(logo, BRAND_BUCKET) : null },
    envio: { url: data.signedUrl, metodo: 'PUT', content_type: 'video/mp4' },
  });
}

/** Recebe o MP4 do Claude: confere o arquivo e vira a versão editada. */
async function externalDeliver(service: Service, body: Body): Promise<Response> {
  const edit = await readEdit(service, body.edit_id);
  if (!edit) return errorResponse(404, 'not_found', 'Edição não encontrada.');
  if (edit.status !== 'suggested') return errorResponse(409, 'not_open', 'Esta edição já foi encerrada.');
  const path = deliveredPath(edit.id);
  const { data } = await service.storage.from(BUCKET).createSignedUrl(path, 300);
  const head = data ? await fetch(data.signedUrl, { headers: { range: 'bytes=0-11' } }) : null;
  const bytes = head?.ok ? new Uint8Array(await head.arrayBuffer()) : new Uint8Array();
  const size = Number(head?.headers.get('content-range')?.split('/')[1]);
  if (!isMp4Head(bytes) || !(size >= MIN_DELIVERY_BYTES)) return errorResponse(400, 'no_video', 'Não encontrei um MP4 válido no envio.');
  // o sandbox mede quando está ligado; sem ele, a versão fica marcada como não medida
  const measured = await mcp(service, 'sandbox_exec', { command: deliveryProbe(data!.signedUrl), timeout_seconds: 60 })
    .then((out) => parseDelivery(String(out))).catch(() => null);
  const formatoDoPlano = (edit.analysis as { plano?: { formato?: string } }).plano?.formato;
  const formato = formatoDoPlano === '16:9' || formatoDoPlano === '1:1' ? formatoDoPlano : '9:16';
  const issues = measured ? deliveryIssues(measured, edit.analysis.duration_s ?? 0, formato) : [];
  if (issues.length) return errorResponse(400, 'bad_video', issues.join(' '));
  const final = finalDeliveryPath(edit.id);
  const { error } = await service.storage.from(BUCKET).copy(path, final);
  if (error) throw new Error(`entrega: ${error.message}`);
  const sources = (Array.isArray(body.fontes) ? body.fontes : []).slice(0, 8).map((raw): Source => {
    const s = (raw ?? {}) as Record<string, unknown>;
    return { title: String(s.title ?? '').slice(0, 200), url: String(s.url ?? '').slice(0, 500), text: String(s.text ?? '').slice(0, 4000) };
  });
  const dropped = (Array.isArray(body.ficou_de_fora) ? body.ficou_de_fora : []).slice(0, 8).map((t) => String(t).slice(0, 160));
  const io = makeIo(service);
  await io.markEdited(edit, final);
  await io.patchEdit(edit.id, {
    status: 'ready', output_path: final, error: null, plan: { ops: [], sources, dropped },
    qa: { ...measured, ok: measured ? true : null, measured: Boolean(measured), bytes: size, notes: ['Renderizado pelo Claude da pessoa.'] } as unknown as EditRow['qa'],
  });
  return jsonResponse({ ready: true });
}

/** Envio de vídeo, imagem ou áudio para usar na edição. */
async function uploadUrl(service: Service, body: Body): Promise<Response> {
  const type = UPLOAD_TYPES[String(body.content_type)];
  if (!type) return errorResponse(400, 'invalid_type', 'Envie vídeo MP4 ou MOV, imagem PNG ou áudio MP3, WAV ou M4A.');
  const path = `edits/uploads/${crypto.randomUUID()}.${type.ext}`;
  const { data, error } = await service.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`upload_url: ${error?.message}`);
  return jsonResponse({ path, token: data.token, kind: type.kind });
}

async function apply(service: Service, body: Body, userId: string | null, req: Request): Promise<Response> {
  const edit = await readEdit(service, body.edit_id);
  if (!edit) return errorResponse(404, 'not_found', 'Edição não encontrada.');
  if (ACTIVE_STATUSES.includes(edit.status) || (await activeOn(service, edit))) {
    return errorResponse(409, 'edit_running', 'Já há uma edição em andamento neste vídeo.');
  }
  const added = readAttachments(body.attachments);
  const attachments = [...(edit.analysis.attachments ?? []), ...(added ?? [])];
  if (!added || attachments.length > MAX_ATTACHMENTS) return errorResponse(400, 'invalid_attachments', 'Um dos arquivos enviados não é válido.');
  // o produto não usa a API do Claude: o motor confere por máquina, sem custo
  edit.analysis = { ...edit.analysis, attachments, external: true };
  const draft = edit.analysis.draft;
  const manual = Array.isArray(body.ops) && Boolean(edit.analysis.words);
  if (!edit.analysis.suggestions && !draft && !manual) return errorResponse(409, 'not_analyzed', 'O vídeo ainda não foi analisado.');

  const brand = await makeIo(service).brand();
  const ctx = editContext(edit.analysis, { logo: !!usableLogo(brand.logoPath), primary: brand.primary, handle: brand.handle, font: brand.font });
  const ids = Array.isArray(body.suggestion_ids) ? (body.suggestion_ids as string[]) : [];
  const fromDraft = Boolean(draft && Array.isArray(body.steps));
  const picked = fromDraft ? planOfSteps(draft!, (body.steps as unknown[]).filter((n): n is number => typeof n === 'number')) : null;
  // ajuste fino mantém os efeitos da versão de onde veio
  const motion = picked?.motion ?? edit.plan?.motion;
  const sources = picked ? draft!.sources : edit.plan?.sources;
  const motionOn = Boolean(motion && (motion.layers.length || motion.music));
  if (picked && !picked.ops.length && !motionOn) return errorResponse(400, 'invalid_ops', 'Escolha ao menos um item do plano.');
  const raw = picked ? picked.ops : Array.isArray(body.ops) ? body.ops : opsOfSuggestions(edit.analysis, ids);
  const { ops, error } = picked && !picked.ops.length ? { ops: [] as Op[], error: null } : normalizeOps(raw, ctx);
  if (error) return errorResponse(400, 'invalid_ops', error);
  if (motionOn && !(await renderReady(service))) {
    return errorResponse(400, 'render_not_connected', 'Conecte o render de vídeo em Integrações.');
  }
  if (motionOn && (ops.length ? expectedDuration(ops, ctx) : ctx.duration) > MAX_DURATION_S) {
    return errorResponse(400, 'video_too_long', `Efeitos de motion funcionam em vídeos de até ${MAX_DURATION_S / 60} minutos.`);
  }
  if (motion?.layers.some((l) => l.type === 'captions') && ctx.words.length > MAX_CAPTION_WORDS) {
    return errorResponse(400, 'too_many_words', 'Este vídeo tem fala demais para a legenda animada. Tire a legenda do plano.');
  }

  const usd = draft?.usd ?? 0;
  const blocked = await overBudget(service, usd);
  if (blocked) return blocked;

  const plan = {
    ops, ...(ids.length ? { suggestion_ids: ids } : {}),
    ...(Array.isArray(body.steps) ? { steps: body.steps } : {}),
    ...(motionOn ? { motion, sources } : {}),
  };
  let id = edit.id;
  if (edit.status === 'suggested') {
    await makeIo(service).patchEdit(id, { status: 'queued', plan, analysis: edit.analysis, error: null });
  } else {
    // ajuste fino: edição nova, sempre a partir do original
    const { data, error: insertError } = await service.from('video_edits').insert({
      source_kind: edit.source_kind, source_id: edit.source_id, source_path: edit.source_path,
      analysis: edit.analysis, plan, status: 'queued', created_by: userId,
    }).select('id').single();
    if (insertError || !data) throw new Error(`insert: ${insertError?.message}`);
    id = data.id as string;
  }
  background(drive(service, id, forwardHeaders(req)));
  return jsonResponse({ edit_id: id, estimate: { usd, label: estimateLabel(usd) } }, 202);
}

async function revert(service: Service, body: Body): Promise<Response> {
  const edit = await readEdit(service, body.edit_id);
  if (!edit) return errorResponse(404, 'not_found', 'Edição não encontrada.');
  if (edit.source_kind === 'job') {
    const { data } = await service.from('director_jobs').select('artifacts').eq('id', edit.source_id!).single();
    const artifacts = { ...(data?.artifacts as Record<string, unknown>) };
    if ((artifacts.edited as { edit_id?: string } | undefined)?.edit_id === edit.id) {
      delete artifacts.edited;
      await service.from('director_jobs').update({ artifacts }).eq('id', edit.source_id!);
    }
  }
  await service.from('video_edits').update({ status: 'reverted' }).eq('id', edit.id);
  return jsonResponse({ ok: true });
}

async function status(service: Service, body: Body): Promise<Response> {
  const edit = await readEdit(service, body.edit_id);
  if (!edit) return errorResponse(404, 'not_found', 'Edição não encontrada.');
  const output_url = edit.output_path && edit.status === 'ready'
    ? await makeIo(service).sign(edit.output_path, { expiresIn: 21600 }).catch(() => undefined) : undefined;
  return jsonResponse({
    status: edit.status, suggestions: edit.analysis.suggestions, plan: edit.plan, output_url,
    qa: edit.qa, error: edit.error, cost_usd: edit.cost_usd,
  });
}

/** §8: o que o sandbox tem. O Scribe só roda com `scribe: true` (cobra ~US$ 0,01). */
async function probe(service: Service, body: Body): Promise<Response> {
  const raw = await mcp(service, 'sandbox_exec', { command: PROBE_COMMAND, timeout_seconds: 60 });
  const result: Record<string, unknown> = { sandbox: { ...parseProbe(raw), raw } };
  if (body.scribe === true) {
    const { data: job } = await service.from('director_jobs').select('artifacts').eq('id', String(body.job_id)).maybeSingle();
    const path = (job?.artifacts as { final?: string } | undefined)?.final;
    if (!path) return errorResponse(404, 'not_found', 'Vídeo não encontrado.');
    const io = makeIo(service);
    const stt = await io.stt(await io.getObject(path));
    const words = stt.words ?? [];
    result.scribe = {
      events: words.filter((w) => w.type === 'audio_event').map((w) => w.text),
      types: [...new Set(words.map((w) => w.type))],
      sample: words.slice(0, 40),
    };
  }
  return jsonResponse(result);
}

/** `video_edit.auto`: vídeo que acabou de ficar pronto ganha a edição recomendada. */
async function sweepAuto(service: Service, req: Request): Promise<void> {
  const { data: setting } = await service.from('app_settings').select('value').eq('key', 'video_edit').maybeSingle();
  if ((setting?.value as { auto?: boolean } | null)?.auto !== true) return;
  // automático também não gera sem Drive; a tela mostra quem precisa conectar
  if (await driveRequired(service)) return;
  const since = new Date(Date.now() - AUTO_WINDOW_MS).toISOString();
  const { data: jobs } = await service.from('director_jobs').select('id, artifacts')
    .eq('status', 'done').is('config->>excluido_em', null).gte('updated_at', since).order('updated_at', { ascending: false }).limit(10);
  for (const job of (jobs ?? []) as { id: string; artifacts: { final?: string; final_rebuilding?: boolean } }[]) {
    if (!job.artifacts?.final || job.artifacts.final_rebuilding) continue;
    const { data: existing } = await service.from('video_edits').select('id').eq('source_id', job.id).limit(1);
    if (existing?.length) continue;
    if (await overBudget(service, ANALYSIS_USD + QA_USD)) return;
    const id = await createAnalysis(service, { kind: 'job', id: job.id, path: job.artifacts.final }, null, true);
    background(drive(service, id, forwardHeaders(req)));
    return; // uma por tick
  }
}

async function tick(service: Service, body: Body, req: Request): Promise<Response> {
  if (typeof body.edit_id === 'string') {
    background(drive(service, body.edit_id, forwardHeaders(req)));
    return jsonResponse({ ok: true }, 202);
  }
  const { data } = await service.from('video_edits').select('id').in('status', ACTIVE_STATUSES)
    .order('updated_at', { ascending: true }).limit(1);
  const next = (data ?? [])[0] as { id: string } | undefined;
  if (next) background(drive(service, next.id, forwardHeaders(req)));
  await sweepAuto(service, req);
  return jsonResponse({ ok: true, resumed: next?.id ?? null }, 202);
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Use POST.');

  const service = createServiceClient();
  let userId: string | null = null;
  let authorized = false;
  const provided = req.headers.get('x-cron-secret');
  if (provided) authorized = segredoIgual(provided, await vault(service, 'VIDEO_CRON_SECRET'));
  // chamada de servidor para servidor (director-advance abre a montagem): a chave de serviço basta
  if (!authorized) {
    const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const chave = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    authorized = segredoIgual(bearer, chave);
  }
  if (!authorized) {
    const user = await getUser(req);
    if (user) {
      const { data: isAdmin } = await service.rpc('has_role', { _user_id: user.id, _role: 'admin' });
      authorized = Boolean(isAdmin);
      userId = user.id;
    }
  }
  if (!authorized) {
    return userId
      ? errorResponse(403, 'forbidden', 'Só administradores editam vídeos.')
      : errorResponse(401, 'unauthorized', 'Sessão inválida ou ausente.');
  }

  const body = await req.json().catch(() => ({})) as Body;
  try {
    const semDrive = await requireDrive(service, 'video-edit', typeof body.action === 'string' ? body.action : '');
    if (semDrive) return semDrive;
    switch (body.action) {
      case 'suggest': return await suggest(service, body, userId, req);
      case 'plan': return await plan(service, body, userId, req);
      case 'upload_url': return await uploadUrl(service, body);
      case 'external_open': return await externalOpen(service, body, req);
      case 'external_apply': return await externalApply(service, body, req);
      case 'external_budget': return (await overBudget(service, Number(body.extra_usd) || 0)) ?? jsonResponse({ ok: true });
      case 'external_render': return await externalRender(service, body);
      case 'external_deliver': return await externalDeliver(service, body);
      case 'apply': return await apply(service, body, userId, req);
      case 'status': return await status(service, body);
      case 'revert': return await revert(service, body);
      case 'probe': return await probe(service, body);
      case 'tick': return await tick(service, body, req);
      default: return errorResponse(400, 'invalid_action', 'Ação desconhecida.');
    }
  } catch (err) {
    console.error('[video-edit]', err);
    if (err instanceof NotConnectedError) return errorResponse(400, 'not_connected', err.message);
    if (err instanceof ArchivedFileError) return errorResponse(409, 'file_archived', err.message);
    return errorResponse(500, 'video_edit_failed', 'Não deu para concluir agora. Tente de novo em instantes.');
  }
});
