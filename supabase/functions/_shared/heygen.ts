// _shared/heygen.ts — cliente da API v3 da HeyGen, compartilhado.
//
// Campos conferidos na spec oficial (developers.heygen.com/openapi/external-api.json,
// baixada em 2026-10-29) e em docs/catalogo-heygen.md. O que a spec não confirma
// está marcado TODO. Contrato com a tela: docs/hub-motor-contratos.md.
//
// A chave é a do workspace: HEYGEN_API_KEY no Vault (a mesma do Remake).
// Toda criação manda Idempotency-Key (a HeyGen repete a resposta original por
// 24 h): um retry de rede não paga duas vezes.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { NotConnectedError } from './not-connected.ts';

export const HEYGEN = 'https://api.heygen.com';

export class HeygenError extends Error {
  status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'HeygenError';
    this.status = status;
  }
}

export const HEYGEN_NOT_CONNECTED =
  'A HeyGen ainda não está conectada. Salve a chave em Config → Integrações → HeyGen ' +
  'e clique em "Retomar do checkpoint".';

/** Chave do workspace, ou null quando não está salva. */
export async function heygenKeyOrNull(service: SupabaseClient): Promise<string | null> {
  const { data } = await service.rpc('get_vault_secret', { _name: 'HEYGEN_API_KEY' });
  return typeof data === 'string' && data ? data : null;
}

export async function heygenKey(service: SupabaseClient): Promise<string> {
  const key = await heygenKeyOrNull(service);
  if (!key) throw new NotConnectedError('heygen', HEYGEN_NOT_CONNECTED);
  return key;
}

/**
 * Idempotency-Key a partir das partes (id do job, etapa, tentativa). A spec
 * aceita 1-255 caracteres de [A-Za-z0-9_:.-].
 */
export function idempotencyKey(...parts: (string | number)[]): string {
  return parts
    .map((p) => String(p).replace(/[^A-Za-z0-9_.-]/g, '-'))
    .join(':')
    .slice(0, 255);
}

/** Hash curto e estável (FNV-1a 32 bits) — para chave idempotente a partir de texto (URL do site). */
export function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

interface RequestOpts {
  idempotencyKey?: string;
  /** devolve o corpo inteiro (listas: data + next_token), não só `data` */
  raw?: boolean;
}

/** Pedido à API. Erro HTTP vira HeygenError "heygen <status>: <corpo>" (o tradutor da tela entende). */
export async function heygenRequest<T>(
  key: string,
  path: string,
  init?: RequestInit,
  opts: RequestOpts = {},
): Promise<T> {
  const headers: Record<string, string> = { 'X-Api-Key': key, 'Content-Type': 'application/json' };
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const res = await fetch(`${HEYGEN}${path}`, {
    ...init,
    headers: { ...headers, ...((init?.headers as Record<string, string> | undefined) ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) throw new HeygenError(`heygen ${res.status}: ${text.slice(0, 300)}`, res.status);
  if (opts.raw) return body as T;
  return ((body as { data?: T } | null)?.data ?? body) as T;
}

/** Status HTTP de um erro da HeyGen (inclusive os lançados antes desta classe existir). */
export function heygenStatus(err: unknown): number | null {
  if (err instanceof HeygenError && err.status != null) return err.status;
  const m = /heygen (\d{3}):/.exec(err instanceof Error ? err.message : String(err));
  return m ? Number(m[1]) : null;
}

/** 429 (limite de jobs simultâneos ou de taxa): quem chama espera o próximo tick. */
export function heygenBusy(err: unknown): boolean {
  return heygenStatus(err) === 429;
}

/** Erro da HeyGen → frase com o que fazer. `retry` = o job pode ser retomado. */
export function heygenHumanError(err: unknown, retry = true): Error {
  const status = heygenStatus(err);
  const raw = err instanceof Error ? err.message : String(err);
  const tail = retry ? ' e clique em "Retomar do checkpoint".' : '.';
  if (status === 401 || status === 403) {
    return new NotConnectedError('heygen', `A chave da HeyGen foi recusada. Salve uma chave válida em Config → Integrações → HeyGen${tail}`);
  }
  if (status === 402 || /insufficient_credit/i.test(raw)) {
    return new Error(`A HeyGen está sem créditos para este vídeo. Recarregue em app.heygen.com${tail}`);
  }
  if (status === 400 && /engine/i.test(raw)) {
    return new Error(
      'Este apresentador não aceita o motor escolhido na HeyGen. Escolha outro apresentador ou deixe o motor automático.',
    );
  }
  if (status === 429) {
    return new Error(`A HeyGen está com o limite de vídeos simultâneos ocupado. Espere os outros terminarem${tail}`);
  }
  return err instanceof Error ? err : new Error(raw);
}

// ── Avatares e looks ─────────────────────────────────────────────────────────

export type HeygenEngine = 'avatar_v' | 'avatar_iv' | 'avatar_iii';
export const HEYGEN_ENGINES: HeygenEngine[] = ['avatar_v', 'avatar_iv', 'avatar_iii'];
export type HeygenAvatarStatus = 'processing' | 'pending_consent' | 'completed' | 'failed';

export interface HeygenLook {
  id: string;
  name: string;
  group_id: string | null;
  avatar_type: 'studio_avatar' | 'digital_twin' | 'photo_avatar' | string;
  preview_image_url: string | null;
  preview_video_url: string | null;
  gender: string | null;
  default_voice_id: string | null;
  supported_api_engines: HeygenEngine[];
  preferred_orientation: string | null;
  status: HeygenAvatarStatus | null;
  error: string | null;
}

export interface HeygenGroup {
  id: string;
  name: string;
  default_voice_id: string | null;
  consent_status: 'pending' | 'accepted' | 'rejected' | null;
  status: HeygenAvatarStatus | null;
  error: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function errText(v: unknown): string | null {
  if (!v || typeof v !== 'object') return str(v);
  const e = v as { code?: unknown; message?: unknown };
  return str(e.message) ?? str(e.code);
}

/** AvatarLookItem (spec) → forma estável para a tela e o motor. */
export function normalizeLook(raw: unknown): HeygenLook {
  const r = (raw ?? {}) as Record<string, unknown>;
  const engines = Array.isArray(r.supported_api_engines)
    ? (r.supported_api_engines as unknown[]).filter((e): e is HeygenEngine =>
      HEYGEN_ENGINES.includes(e as HeygenEngine))
    : [];
  return {
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    group_id: str(r.group_id),
    avatar_type: String(r.avatar_type ?? ''),
    preview_image_url: str(r.preview_image_url),
    preview_video_url: str(r.preview_video_url),
    gender: str(r.gender),
    default_voice_id: str(r.default_voice_id),
    supported_api_engines: engines,
    preferred_orientation: str(r.preferred_orientation),
    status: (str(r.status) as HeygenAvatarStatus | null),
    error: errText(r.error),
  };
}

/**
 * consent_status do grupo. A spec só diz "string | null"; os valores pending/
 * accepted/rejected vêm da doc de guias (catalogo-heygen.md §1).
 * TODO: confirmar com um twin real; sinônimos tratados por segurança.
 */
export function consentState(v: unknown): HeygenGroup['consent_status'] {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  if (!s) return null;
  if (['accepted', 'approved', 'completed', 'granted'].includes(s)) return 'accepted';
  if (['rejected', 'declined', 'denied', 'failed'].includes(s)) return 'rejected';
  return 'pending';
}

export function normalizeGroup(raw: unknown): HeygenGroup {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    default_voice_id: str(r.default_voice_id),
    consent_status: consentState(r.consent_status),
    status: (str(r.status) as HeygenAvatarStatus | null),
    error: errText(r.error),
  };
}

const GROUP_VOICE_LOTS = 5;

/**
 * Preenche default_voice_id das looks que não a trazem com a voz do grupo
 * (GET /v3/avatars/{id}), um GET por grupo. Grupo que falhar deixa a look como
 * veio: a tela ainda pergunta por `heygen_group_voice`.
 */
export async function fillGroupVoices(
  looks: HeygenLook[],
  loadGroup: (groupId: string) => Promise<Pick<HeygenGroup, 'default_voice_id'>>,
): Promise<HeygenLook[]> {
  const groups = [...new Set(looks.flatMap((l) => (!l.default_voice_id && l.group_id ? [l.group_id] : [])))];
  const voices = new Map<string, string | null>();
  for (let i = 0; i < groups.length; i += GROUP_VOICE_LOTS) {
    const lot = groups.slice(i, i + GROUP_VOICE_LOTS);
    const settled = await Promise.allSettled(lot.map(loadGroup));
    settled.forEach((r, n) => {
      if (r.status === 'fulfilled') voices.set(lot[n], r.value.default_voice_id);
    });
  }
  return looks.map((l) =>
    l.default_voice_id || !l.group_id ? l : { ...l, default_voice_id: voices.get(l.group_id) ?? null }
  );
}

/**
 * Motor a mandar em POST /v3/videos: o pedido, se a look aceita; senão
 * avatar_iv, se aceita; senão o primeiro da lista. Lista vazia → null (não
 * manda `engine`; a HeyGen usa o padrão — mandar um não suportado dá 400).
 */
export function pickEngine(supported: string[], preferred?: string | null): HeygenEngine | null {
  const list = supported.filter((e): e is HeygenEngine => HEYGEN_ENGINES.includes(e as HeygenEngine));
  if (!list.length) return null;
  if (preferred && list.includes(preferred as HeygenEngine)) return preferred as HeygenEngine;
  if (list.includes('avatar_iv')) return 'avatar_iv';
  return list[0];
}

export interface LookQuery {
  ownership?: 'public' | 'private';
  avatar_type?: 'studio_avatar' | 'digital_twin' | 'photo_avatar';
  group_id?: string;
  limit?: number;
  token?: string;
}

export async function listLooks(key: string, q: LookQuery): Promise<{ looks: HeygenLook[]; next_token: string | null }> {
  const params = new URLSearchParams();
  if (q.ownership) params.set('ownership', q.ownership);
  if (q.avatar_type) params.set('avatar_type', q.avatar_type);
  if (q.group_id) params.set('group_id', q.group_id);
  params.set('limit', String(Math.min(50, Math.max(1, Math.round(q.limit ?? 24)))));
  if (q.token) params.set('token', q.token);
  const body = await heygenRequest<{ data?: unknown[]; has_more?: boolean; next_token?: string | null }>(
    key, `/v3/avatars/looks?${params}`, undefined, { raw: true },
  );
  return {
    looks: (body?.data ?? []).map(normalizeLook),
    next_token: body?.has_more === false ? null : str(body?.next_token),
  };
}

export async function getLook(key: string, lookId: string): Promise<HeygenLook> {
  return normalizeLook(await heygenRequest(key, `/v3/avatars/looks/${encodeURIComponent(lookId)}`));
}

export async function getGroup(key: string, groupId: string): Promise<HeygenGroup> {
  return normalizeGroup(await heygenRequest(key, `/v3/avatars/${encodeURIComponent(groupId)}`));
}

export type CreateAvatarInput =
  | { type: 'photo' | 'digital_twin'; name: string; url: string; groupId?: string | null }
  | {
    type: 'prompt';
    name: string;
    prompt: string;
    referenceUrls?: string[];
    /** look de referência visual (novo visual do mesmo avatar) */
    avatarId?: string | null;
    groupId?: string | null;
    aspectRatio?: string | null;
  };

export const PROMPT_MAX_CHARS = 1000;
export const PROMPT_MAX_REFS = 3;
export const PROMPT_ASPECT_RATIOS = ['auto', '16:9', '9:16', '1:1', '4:5', '5:4'] as const;

/**
 * Corpo de POST /v3/avatars: CreatePhotoAvatarRequest / CreateDigitalTwinRequest
 * (type, name, file, avatar_group_id) ou CreatePromptAvatarRequest (type,
 * name, prompt ≤1000, reference_images ≤3, avatar_id, avatar_group_id, aspect_ratio).
 */
export function buildCreateAvatarBody(input: CreateAvatarInput): Record<string, unknown> {
  const body: Record<string, unknown> = { type: input.type, name: input.name.slice(0, 100) };
  if (input.type === 'prompt') {
    body.prompt = input.prompt.slice(0, PROMPT_MAX_CHARS);
    const refs = (input.referenceUrls ?? []).slice(0, PROMPT_MAX_REFS);
    if (refs.length) body.reference_images = refs.map((url) => ({ type: 'url', url }));
    if (input.avatarId) body.avatar_id = input.avatarId;
    if (input.aspectRatio && (PROMPT_ASPECT_RATIOS as readonly string[]).includes(input.aspectRatio)) {
      body.aspect_ratio = input.aspectRatio;
    }
  } else {
    body.file = { type: 'url', url: input.url };
  }
  if (input.groupId) body.avatar_group_id = input.groupId;
  return body;
}

/** POST /v3/avatars. Resposta: avatar_item (look) + avatar_group. */
export async function createAvatar(
  key: string,
  input: CreateAvatarInput,
  idem: string,
): Promise<{ look: HeygenLook; group: HeygenGroup | null }> {
  const data = await heygenRequest<{ avatar_item?: unknown; avatar_group?: unknown }>(key, '/v3/avatars', {
    method: 'POST',
    body: JSON.stringify(buildCreateAvatarBody(input)),
  }, { idempotencyKey: idem });
  const look = normalizeLook(data?.avatar_item);
  if (!look.id) throw new HeygenError('A HeyGen não devolveu o id do avatar criado.');
  const group = data?.avatar_group ? normalizeGroup(data.avatar_group) : null;
  if (!look.group_id && group?.id) look.group_id = group.id;
  return { look, group };
}

// ── Looks extras (Look Packs / templates) ────────────────────────────────────

export interface LookTemplate {
  id: string;
  type: 'look_pack' | 'template' | string;
  name: string | null;
  gender: string | null;
  preview_image_url: string | null;
  looks_count: number;
}

export async function listLookTemplates(
  key: string,
  q: { type?: 'look_pack' | 'template'; gender?: 'male' | 'female'; limit?: number; token?: string },
): Promise<{ templates: LookTemplate[]; next_token: string | null }> {
  const params = new URLSearchParams();
  if (q.type) params.set('type', q.type);
  if (q.gender) params.set('gender', q.gender);
  params.set('limit', String(Math.min(50, Math.max(1, Math.round(q.limit ?? 20)))));
  if (q.token) params.set('token', q.token);
  const body = await heygenRequest<{ data?: Record<string, unknown>[]; has_more?: boolean; next_token?: string | null }>(
    key, `/v3/avatars/look-templates?${params}`, undefined, { raw: true },
  );
  return {
    templates: (body?.data ?? []).map((t) => ({
      id: String(t.id ?? ''),
      type: String(t.type ?? ''),
      name: str(t.name),
      gender: str(t.gender),
      preview_image_url: str(t.preview_image_url),
      looks_count: typeof t.looks_count === 'number' ? t.looks_count : 0,
    })),
    next_token: body?.has_more === false ? null : str(body?.next_token),
  };
}

/**
 * Corpo de POST /v3/avatars/looks: CreateLookPackLooksRequest (type look_pack,
 * reference_look_id, template_id, aspect_ratio 16:9|9:16) ou
 * CreateTemplateLooksRequest (type template, reference_look_id, template_id).
 * TODO: a spec só documenta aspect_ratio no look_pack; no template não vai.
 */
export function buildCreateLooksBody(input: {
  type: 'look_pack' | 'template'; referenceLookId: string; templateId: string; aspectRatio?: string | null;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    type: input.type,
    reference_look_id: input.referenceLookId.slice(0, 128),
    template_id: input.templateId.slice(0, 128),
  };
  if (input.type === 'look_pack' && (input.aspectRatio === '16:9' || input.aspectRatio === '9:16')) {
    body.aspect_ratio = input.aspectRatio;
  }
  return body;
}

export async function createLooks(
  key: string, body: Record<string, unknown>, idem: string,
): Promise<{ group_id: string | null; look_ids: string[] }> {
  const data = await heygenRequest<{ group_id?: string; looks?: { id?: string }[] }>(key, '/v3/avatars/looks', {
    method: 'POST',
    body: JSON.stringify(body),
  }, { idempotencyKey: idem });
  const ids = (data?.looks ?? []).map((l) => String(l?.id ?? '')).filter(Boolean);
  if (!ids.length) throw new HeygenError('A HeyGen não devolveu os visuais criados.');
  return { group_id: str(data?.group_id), look_ids: ids };
}

// ── Apagar ───────────────────────────────────────────────────────────────────

/** DELETE idempotente: 404 (já apagado) conta como sucesso. Devolve se apagou agora. */
async function heygenDelete(key: string, path: string): Promise<boolean> {
  try {
    await heygenRequest(key, path, { method: 'DELETE' });
    return true;
  } catch (err) {
    if (heygenStatus(err) === 404) return false;
    throw err;
  }
}

export const deleteAvatarGroup = (key: string, groupId: string) =>
  heygenDelete(key, `/v3/avatars/${encodeURIComponent(groupId)}`);
export const deleteAvatarLook = (key: string, lookId: string) =>
  heygenDelete(key, `/v3/avatars/looks/${encodeURIComponent(lookId)}`);
/** Só voz clonada nossa (a do twin): a de catálogo não é nossa e daria erro. */
export const deleteVoice = (key: string, voiceId: string) =>
  heygenDelete(key, `/v3/voices/${encodeURIComponent(voiceId)}`);

// ── Fala de teste ────────────────────────────────────────────────────────────

/** POST /v3/voices/speech (CreateSpeechV3Request): devolve a URL do áudio. */
export async function createSpeech(
  key: string, input: { text: string; voiceId: string; language?: string | null },
): Promise<{ audio_url: string; duration: number | null }> {
  const data = await heygenRequest<{ audio_url?: string; duration?: number }>(key, '/v3/voices/speech', {
    method: 'POST',
    body: JSON.stringify({
      text: input.text.slice(0, 5000),
      voice_id: input.voiceId,
      ...(input.language ? { language: input.language } : {}),
    }),
  });
  if (!data?.audio_url) throw new HeygenError('A HeyGen não devolveu o áudio de teste.');
  return { audio_url: data.audio_url, duration: typeof data.duration === 'number' ? data.duration : null };
}

/** Link de consentimento do twin (vale 24 h, uma gravação). */
export async function createConsent(
  key: string, groupId: string, idem: string,
): Promise<{ url: string | null; group: HeygenGroup }> {
  const data = await heygenRequest<{ url?: string | null; avatar_group?: unknown }>(
    key, `/v3/avatars/${encodeURIComponent(groupId)}/consent`,
    { method: 'POST', body: JSON.stringify({}) },
    { idempotencyKey: idem },
  );
  return { url: str(data?.url), group: normalizeGroup(data?.avatar_group) };
}

// ── Vídeo com avatar ─────────────────────────────────────────────────────────

export const ASPECT_RATIOS = ['9:16', '1:1', '4:5', '16:9'] as const;
export const RESOLUTIONS = ['720p', '1080p', '4k'] as const;
export const SCRIPT_MAX_CHARS = 5000;

export interface AvatarVideoInput {
  look: Pick<HeygenLook, 'id' | 'avatar_type' | 'supported_api_engines'>;
  engine?: string | null;
  script?: string | null;
  voice_id?: string | null;
  audio_url?: string | null;
  aspect_ratio?: string | null;
  resolution?: string | null;
  motion_prompt?: string | null;
  /** queimar legenda no próprio vídeo (estilo HeyGen) */
  burn_captions?: boolean;
  title?: string | null;
}

/**
 * Corpo de POST /v3/videos type 'avatar' (CreateVideoFromAvatar), só com o que
 * a combinação look × motor aceita:
 *   - script + voice_id OU audio_url (mutuamente exclusivos)
 *   - engine só se suportado (pickEngine); 4k só com avatar_iii
 *   - motion_prompt: photo avatar, ou twin com avatar_v
 *   - expressiveness: photo avatar com avatar_iv (rejeitado no avatar_v)
 */
export function buildAvatarVideoBody(input: AvatarVideoInput): { body: Record<string, unknown>; engine: HeygenEngine | null } {
  const engine = pickEngine(input.look.supported_api_engines, input.engine);
  const isPhoto = input.look.avatar_type === 'photo_avatar';
  const isTwin = input.look.avatar_type === 'digital_twin';
  const body: Record<string, unknown> = { type: 'avatar', avatar_id: input.look.id };
  if (input.title) body.title = input.title.slice(0, 200);
  if (input.audio_url) {
    body.audio_url = input.audio_url;
  } else {
    body.script = (input.script ?? '').slice(0, SCRIPT_MAX_CHARS);
    if (input.voice_id) body.voice_id = input.voice_id;
  }
  const aspect = (ASPECT_RATIOS as readonly string[]).includes(input.aspect_ratio ?? '') ? input.aspect_ratio : '9:16';
  body.aspect_ratio = aspect;
  let resolution = (RESOLUTIONS as readonly string[]).includes(input.resolution ?? '') ? input.resolution : '1080p';
  // 4k só no avatar_iii de twin ou estúdio; photo avatar no III não tem 4k
  if (resolution === '4k' && (engine !== 'avatar_iii' || isPhoto)) resolution = '1080p';
  body.resolution = resolution;
  if (engine) body.engine = { type: engine };
  const motion = (input.motion_prompt ?? '').trim().slice(0, 500);
  // o avatar_iii recusa motion_prompt e expressiveness (spec /v3/videos)
  if (motion && engine !== 'avatar_iii' && (isPhoto || (isTwin && engine === 'avatar_v'))) body.motion_prompt = motion;
  if (isPhoto && (engine === 'avatar_iv' || engine === null)) body.expressiveness = 'medium';
  // sem `caption` a HeyGen já devolve o SRT (subtitle_url); `style` também queima
  if (input.burn_captions) body.caption = { file_format: 'srt', style: 'default' };
  return { body, engine };
}

export async function createAvatarVideo(key: string, body: Record<string, unknown>, idem: string): Promise<string> {
  const data = await heygenRequest<{ video_id?: string }>(key, '/v3/videos', {
    method: 'POST',
    body: JSON.stringify(body),
  }, { idempotencyKey: idem });
  if (!data?.video_id) throw new HeygenError('A HeyGen não devolveu o id do vídeo.');
  return data.video_id;
}

export interface HeygenVideo {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | string;
  video_url: string | null;
  captioned_video_url: string | null;
  duration: number | null;
  failure_code: string | null;
  failure_message: string | null;
}

export async function getVideo(key: string, id: string): Promise<HeygenVideo> {
  const r = (await heygenRequest<Record<string, unknown>>(key, `/v3/videos/${encodeURIComponent(id)}`)) ?? {};
  return {
    id: String(r.id ?? id),
    status: String(r.status ?? ''),
    video_url: str(r.video_url),
    captioned_video_url: str(r.captioned_video_url),
    duration: typeof r.duration === 'number' ? r.duration : null,
    failure_code: str(r.failure_code),
    failure_message: str(r.failure_message),
  };
}

/** URL quando terminou (a legendada, se pedida e presente), null enquanto roda, erro na falha. */
export function videoResult(v: HeygenVideo, what: string, preferCaptioned = false): string | null {
  if (v.status === 'completed') {
    const url = (preferCaptioned ? v.captioned_video_url : null) ?? v.video_url;
    if (!url) throw new HeygenError(`A HeyGen terminou ${what} sem devolver o vídeo.`);
    return url;
  }
  if (v.status === 'failed') {
    const code = v.failure_code ? ` [${v.failure_code}]` : '';
    throw new HeygenError(`A HeyGen não conseguiu gerar ${what}${code}: ${v.failure_message ?? 'sem motivo informado'}.`);
  }
  return null;
}

// ── Video Agent ──────────────────────────────────────────────────────────────

export const AGENT_PROMPT_MAX = 10_000;
export const AGENT_MAX_FILES = 20;

export interface VideoAgentInput {
  prompt: string;
  avatar_id?: string | null;
  voice_id?: string | null;
  style_id?: string | null;
  brand_kit_id?: string | null;
  orientation?: 'portrait' | 'landscape' | null;
  file_urls?: string[];
}

/** Corpo de POST /v3/video-agents (CreateVideoAgentRequest), modo generate, sessão privada. */
export function buildVideoAgentBody(input: VideoAgentInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: input.prompt.slice(0, AGENT_PROMPT_MAX),
    mode: 'generate',
    visibility: 'private',
  };
  if (input.avatar_id) body.avatar_id = input.avatar_id;
  if (input.voice_id) body.voice_id = input.voice_id;
  if (input.style_id) body.style_id = input.style_id;
  if (input.brand_kit_id) body.brand_kit_id = input.brand_kit_id;
  body.orientation = input.orientation === 'landscape' ? 'landscape' : 'portrait';
  const files = (input.file_urls ?? []).slice(0, AGENT_MAX_FILES);
  if (files.length) body.files = files.map((url) => ({ type: 'url', url }));
  return body;
}

export interface AgentSession {
  session_id: string;
  status: 'thinking' | 'waiting_for_input' | 'reviewing' | 'generating' | 'completed' | 'failed' | string;
  progress: number;
  video_id: string | null;
  error: string | null;
}

function toSession(r: Record<string, unknown> | null): AgentSession {
  const x = r ?? {};
  return {
    session_id: String(x.session_id ?? ''),
    status: String(x.status ?? ''),
    progress: typeof x.progress === 'number' ? x.progress : 0,
    video_id: str(x.video_id),
    error: errText(x.error),
  };
}

/**
 * TODO: a spec não lista Idempotency-Key em POST /v3/video-agents; o header vai
 * mesmo assim (inócuo se ignorado). A proteção real é o checkpoint do
 * session_id em artifacts antes do próximo passo.
 */
export async function createVideoAgent(key: string, body: Record<string, unknown>, idem: string): Promise<AgentSession> {
  const s = toSession(await heygenRequest<Record<string, unknown>>(key, '/v3/video-agents', {
    method: 'POST',
    body: JSON.stringify(body),
  }, { idempotencyKey: idem }));
  if (!s.session_id) throw new HeygenError('A HeyGen não devolveu o id da sessão do Video Agent.');
  return s;
}

export async function getVideoAgent(key: string, sessionId: string): Promise<AgentSession> {
  return toSession(await heygenRequest<Record<string, unknown>>(key, `/v3/video-agents/${encodeURIComponent(sessionId)}`));
}

// ── Brand Kit ────────────────────────────────────────────────────────────────

export interface BrandKitState {
  id: string;
  status: 'loading' | 'completed' | 'error' | string;
}

export async function createBrandKit(key: string, url: string, name: string | null, idem: string): Promise<BrandKitState> {
  const data = await heygenRequest<{ brand_kit_id?: string; status?: string }>(key, '/v3/brand-kits', {
    method: 'POST',
    body: JSON.stringify({ url: url.slice(0, 2048), ...(name ? { name: name.slice(0, 256) } : {}) }),
  }, { idempotencyKey: idem });
  if (!data?.brand_kit_id) throw new HeygenError('A HeyGen não devolveu o id do brand kit.');
  return { id: data.brand_kit_id, status: data.status ?? 'loading' };
}

export async function getBrandKit(key: string, id: string): Promise<BrandKitState> {
  const data = await heygenRequest<{ brand_kit_id?: string; status?: string }>(key, `/v3/brand-kits/${encodeURIComponent(id)}`);
  return { id: data?.brand_kit_id ?? id, status: data?.status ?? 'loading' };
}

export interface ColorRoles {
  primary?: string;
  secondary?: string;
  tertiary?: string;
  accent?: string;
}

/**
 * Papéis de cor a partir da paleta do brand kit do app ({nome: hex}). Só hex
 * válido; nada → objeto vazio (quem chama não faz PATCH: color_roles substitui
 * tudo e um objeto vazio apagaria as cores lidas do site).
 */
export function colorRolesFromPalette(palette: Record<string, unknown> | null | undefined): ColorRoles {
  const p = palette ?? {};
  const hex = (k: string): string | undefined => {
    const v = typeof p[k] === 'string' ? (p[k] as string).trim() : '';
    const h = v.replace(/^#/, '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return /^[0-9a-fA-F]{6}$/.test(full) ? `#${full.toUpperCase()}` : undefined;
  };
  const roles: ColorRoles = {};
  const primary = hex('primary') ?? hex('brand');
  if (primary) roles.primary = primary;
  const secondary = hex('secondary');
  if (secondary) roles.secondary = secondary;
  const tertiary = hex('tertiary');
  if (tertiary) roles.tertiary = tertiary;
  const accent = hex('accent');
  if (accent) roles.accent = accent;
  return roles;
}

export async function patchBrandKitColors(key: string, id: string, roles: ColorRoles): Promise<void> {
  await heygenRequest(key, `/v3/brand-kits/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ color_roles: roles }),
  });
}

// ── Vozes ────────────────────────────────────────────────────────────────────

export interface HeygenVoice {
  voice_id: string;
  name: string;
  language: string;
  gender: string;
  preview_audio_url: string | null;
  /** motor salvo da voz; null = sem padrão utilizável para fala */
  default_engine: string | null;
  available_engines: string[];
}

export async function listVoices(
  key: string,
  q: { type?: 'public' | 'private'; language?: string; gender?: string; limit?: number; token?: string },
): Promise<{ voices: HeygenVoice[]; next_token: string | null }> {
  const params = new URLSearchParams();
  if (q.type) params.set('type', q.type);
  if (q.language) params.set('language', q.language);
  if (q.gender) params.set('gender', q.gender);
  params.set('limit', String(Math.min(100, Math.max(1, Math.round(q.limit ?? 50)))));
  if (q.token) params.set('token', q.token);
  const body = await heygenRequest<{ data?: Record<string, unknown>[]; has_more?: boolean; next_token?: string | null }>(
    key, `/v3/voices?${params}`, undefined, { raw: true },
  );
  return {
    voices: (body?.data ?? []).map((v) => ({
      voice_id: String(v.voice_id ?? ''),
      name: String(v.name ?? ''),
      language: String(v.language ?? ''),
      gender: String(v.gender ?? ''),
      preview_audio_url: str(v.preview_audio_url),
      default_engine: str(v.default_engine),
      available_engines: Array.isArray(v.available_engines) ? v.available_engines.map(String) : [],
    })),
    next_token: body?.has_more === false ? null : str(body?.next_token),
  };
}
