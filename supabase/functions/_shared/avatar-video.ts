// _shared/avatar-video.ts — lanes "Avatar fala o roteiro" (config.mode =
// 'avatar_video') e "Só a ideia → vídeo pronto" (config.mode = 'video_agent'),
// mais o avatar HeyGen do apresentador (brand_avatars.provider_refs.heygen) e o
// brand kit HeyGen (director_state.heygen_brand_kit).
//
// Contrato com a tela: docs/hub-motor-contratos.md §1-§4. Aqui ficam a
// validação e as decisões puras (testadas) e os dois helpers de I/O que o
// avatar-studio e o director-advance compartilham.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  AGENT_MAX_FILES, AGENT_PROMPT_MAX, ASPECT_RATIOS, colorRolesFromPalette, createBrandKit, getBrandKit, getGroup,
  getLook, type HeygenGroup, type HeygenLook, idempotencyKey, patchBrandKitColors, RESOLUTIONS, SCRIPT_MAX_CHARS,
  shortHash,
} from './heygen.ts';

const MODEL_SLUG_RE = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

// ── config dos jobs ──────────────────────────────────────────────────────────

export interface AvatarVideoConfig {
  provider?: 'heygen' | 'replicate' | null;
  look_id?: string | null;
  presenter_id?: string | null;
  /** linha talking_avatar do catálogo (provider replicate) */
  model_id?: string | null;
  script?: string | null;
  voice?: { provider?: 'elevenlabs' | 'heygen' | null; voice_id?: string | null; brand_voice_id?: string | null } | null;
  engine?: string | null;
  aspect_ratio?: string | null;
  resolution?: string | null;
  motion_prompt?: string | null;
}

export interface VideoAgentConfig {
  prompt?: string | null;
  presenter_id?: string | null;
  look_id?: string | null;
  voice_id?: string | null;
  /** voz salva (brand_voices); só HeyGen do catálogo vale no agente */
  brand_voice_id?: string | null;
  orientation?: 'portrait' | 'landscape' | null;
  style_id?: string | null;
  /** padrão true */
  brand_kit?: boolean | null;
  /** "<bucket>:<path>", bucket renders ou brand-assets */
  file_paths?: string[] | null;
}

export const MOTION_PROMPT_MAX = 500;
export const FILE_BUCKETS = ['renders', 'brand-assets'] as const;

/** Primeira frase de erro para a pessoa, ou null. */
export function validateAvatarVideo(cfg: AvatarVideoConfig): string | null {
  const script = clean(cfg.script);
  if (!script || script.length > SCRIPT_MAX_CHARS) return 'O roteiro precisa ter de 1 a 5.000 caracteres.';
  const provider = cfg.provider ?? 'heygen';
  if (provider !== 'heygen' && provider !== 'replicate') return 'Escolha um provedor de avatar válido.';
  const look = clean(cfg.look_id);
  const presenter = clean(cfg.presenter_id);
  const voiceProvider = cfg.voice?.provider ?? 'elevenlabs';
  if (voiceProvider !== 'elevenlabs' && voiceProvider !== 'heygen') return 'Escolha uma voz da lista.';
  if (presenter && !UUID_RE.test(presenter)) return 'Escolha quem apresenta o vídeo.';
  if (provider === 'replicate') {
    if (!presenter) return 'Escolha quem apresenta o vídeo.';
    if (voiceProvider === 'heygen') return 'A voz HeyGen só funciona com avatar HeyGen.';
    if (clean(cfg.model_id) && !MODEL_SLUG_RE.test(clean(cfg.model_id))) return 'Escolha um modelo da lista.';
  } else {
    // look + presenter = um visual (principal ou extra) desse apresentador
    if (!look && !presenter) return 'Escolha quem apresenta o vídeo.';
  }
  if (cfg.aspect_ratio && !(ASPECT_RATIOS as readonly string[]).includes(cfg.aspect_ratio)) {
    return 'Formato de vídeo inválido. Escolha de novo.';
  }
  if (cfg.resolution && !(RESOLUTIONS as readonly string[]).includes(cfg.resolution)) {
    return 'Formato de vídeo inválido. Escolha de novo.';
  }
  if (clean(cfg.motion_prompt).length > MOTION_PROMPT_MAX) {
    return `A instrução de movimento pode ter até ${MOTION_PROMPT_MAX} caracteres.`;
  }
  return null;
}

/** "renders:director/uploads/x.jpg" → {bucket, path}; null se inválido. */
export function parseFileRef(ref: unknown): { bucket: string; path: string } | null {
  const s = clean(ref);
  const i = s.indexOf(':');
  if (i <= 0) return null;
  const bucket = s.slice(0, i);
  const path = s.slice(i + 1);
  if (!(FILE_BUCKETS as readonly string[]).includes(bucket)) return null;
  if (!path || path.includes('..') || path.startsWith('/')) return null;
  return { bucket, path };
}

export function validateVideoAgent(cfg: VideoAgentConfig): string | null {
  const prompt = clean(cfg.prompt);
  if (!prompt || prompt.length > AGENT_PROMPT_MAX) return 'Descreva o vídeo em até 10.000 caracteres.';
  if (clean(cfg.presenter_id) && !UUID_RE.test(clean(cfg.presenter_id))) return 'Escolha quem apresenta o vídeo.';
  if (cfg.orientation && cfg.orientation !== 'portrait' && cfg.orientation !== 'landscape') {
    return 'Formato de vídeo inválido. Escolha de novo.';
  }
  const files = cfg.file_paths ?? [];
  if (!Array.isArray(files)) return 'Arquivo anexado inválido.';
  if (files.length > AGENT_MAX_FILES) return `Anexe até ${AGENT_MAX_FILES} arquivos.`;
  if (files.some((f) => !parseFileRef(f))) return 'Arquivo anexado inválido.';
  return null;
}

// ── avatar HeyGen do apresentador (brand_avatars.provider_refs.heygen) ───────
// Formato canônico (docs/hub-motor-contratos.md §8.1). A base — group_id,
// look_id, status, supported_api_engines, preview_image_url, default_voice_id —
// é o que todo consumidor lê; o resto é estado do construtor.

export type HeygenAvatarKind = 'photo' | 'digital_twin' | 'prompt';

export interface HeygenExtraLook {
  id: string;
  status: string | null;
  preview_image_url: string | null;
  supported_api_engines: string[];
  source: 'prompt' | 'look_pack' | 'template';
}

export interface HeygenRef {
  group_id: string | null;
  look_id: string;
  status: 'processing' | 'pending_consent' | 'completed' | 'failed';
  supported_api_engines: string[];
  preview_image_url: string | null;
  default_voice_id: string | null;
  type: HeygenAvatarKind;
  consent_status: 'pending' | 'accepted' | 'rejected' | null;
  consent_url: string | null;
  consent_url_at: number | null;
  error: string | null;
  ready: boolean;
  /** visuais extras do mesmo avatar (heygen_new_look) */
  looks: HeygenExtraLook[];
  /** tentativa de criação (entra na Idempotency-Key) */
  attempt: number;
  /** tentativa do link de consentimento */
  consent_attempt: number;
  updated_at: string;
  /** só type 'prompt': o pedido da criação, para o "gerar de novo" */
  prompt?: string | null;
  reference_paths?: string[];
  aspect_ratio?: string | null;
}

/** Ref inicial a partir da resposta de POST /v3/avatars. */
export function newHeygenRef(
  type: HeygenAvatarKind, look: HeygenLook, group: HeygenGroup | null, attempt: number,
): HeygenRef {
  return refFromHeygen({
    group_id: look.group_id,
    look_id: look.id,
    status: 'processing',
    supported_api_engines: [],
    preview_image_url: null,
    default_voice_id: null,
    type,
    consent_status: type === 'digital_twin' ? 'pending' : null,
    consent_url: null,
    consent_url_at: null,
    error: null,
    ready: false,
    looks: [],
    attempt,
    consent_attempt: 0,
    updated_at: new Date().toISOString(),
  }, look, group);
}

/**
 * Ref atualizado a partir da look e (twin) do grupo. Pronto = look completed e,
 * no twin, consentimento que não esteja pendente nem recusado. TODO: a spec
 * não fixa os valores de consent_status; a look também vira pending_consent
 * enquanto falta a autorização (AvatarStatus), o que cobre o caso nulo.
 */
export function refFromHeygen(prev: HeygenRef, look: HeygenLook | null, group: HeygenGroup | null): HeygenRef {
  const status = (look?.status ?? group?.status ?? prev.status) as HeygenRef['status'];
  const consent = prev.type === 'digital_twin' ? (group?.consent_status ?? prev.consent_status) : null;
  const ready = status === 'completed' &&
    (prev.type !== 'digital_twin' || (consent !== 'pending' && consent !== 'rejected'));
  return {
    ...prev,
    group_id: look?.group_id ?? group?.id ?? prev.group_id,
    status: status ?? 'processing',
    consent_status: consent,
    supported_api_engines: look?.supported_api_engines?.length ? look.supported_api_engines : prev.supported_api_engines,
    preview_image_url: look?.preview_image_url ?? prev.preview_image_url,
    default_voice_id: group?.default_voice_id ?? look?.default_voice_id ?? prev.default_voice_id,
    error: status === 'failed' ? (look?.error ?? group?.error ?? prev.error ?? 'sem motivo informado') : null,
    ready,
    updated_at: new Date().toISOString(),
  };
}

/** Atualiza os visuais extras com as looks lidas (as que não vieram ficam como estão). */
export function mergeExtraLooks(ref: HeygenRef, fresh: HeygenLook[]): HeygenRef {
  const byId = new Map(fresh.map((l) => [l.id, l]));
  return {
    ...ref,
    looks: ref.looks.map((x) => {
      const l = byId.get(x.id);
      return l
        ? {
          ...x,
          status: l.status ?? x.status,
          preview_image_url: l.preview_image_url ?? x.preview_image_url,
          supported_api_engines: l.supported_api_engines.length ? l.supported_api_engines : x.supported_api_engines,
        }
        : x;
    }),
  };
}

/**
 * Lê provider_refs.heygen nos dois formatos: o de 29/10 (`engines`, sem
 * preview_image_url/looks) e o canônico. null quando não há avatar HeyGen.
 */
export function heygenRefOf(providerRefs: unknown): HeygenRef | null {
  const raw = ((providerRefs ?? {}) as { heygen?: Record<string, unknown> }).heygen;
  if (!raw || typeof raw !== 'object' || typeof raw.look_id !== 'string' || !raw.look_id) return null;
  const { engines, ...rest } = raw as Record<string, unknown> & { engines?: unknown };
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const supported = list(rest.supported_api_engines);
  const type = rest.type === 'digital_twin' || rest.type === 'prompt' ? rest.type : 'photo';
  return {
    ...(rest as unknown as HeygenRef),
    type,
    group_id: typeof rest.group_id === 'string' ? rest.group_id : null,
    supported_api_engines: supported.length ? supported : list(engines),
    preview_image_url: typeof rest.preview_image_url === 'string' ? rest.preview_image_url : null,
    default_voice_id: typeof rest.default_voice_id === 'string' ? rest.default_voice_id : null,
    looks: Array.isArray(rest.looks) ? (rest.looks as HeygenExtraLook[]) : [],
    reference_paths: Array.isArray(rest.reference_paths) ? list(rest.reference_paths) : undefined,
    attempt: typeof rest.attempt === 'number' ? rest.attempt : 0,
    consent_attempt: typeof rest.consent_attempt === 'number' ? rest.consent_attempt : 0,
  };
}

/**
 * Grava provider_refs.heygen relendo a coluna antes (a lane do Higgsfield
 * grava provider_refs.higgsfield na mesma coluna): só a chave heygen muda.
 * `ref = null` remove a chave.
 */
export async function saveHeygenRef(service: SupabaseClient, avatarId: string, ref: HeygenRef | null): Promise<void> {
  const { data, error: readErr } = await service.from('brand_avatars').select('provider_refs').eq('id', avatarId).maybeSingle();
  if (readErr) throw new Error(readErr.message);
  const refs: Record<string, unknown> = { ...((data as { provider_refs?: Record<string, unknown> } | null)?.provider_refs ?? {}) };
  if (ref) refs.heygen = ref;
  else delete refs.heygen;
  const { error } = await service.from('brand_avatars').update({ provider_refs: refs }).eq('id', avatarId);
  if (error) throw new Error(error.message);
}

export const PRESENTER_BUCKET = 'brand-assets';
const PREVIEW_MAX_BYTES = 15 * 1024 * 1024;

/**
 * Avatar nascido na HeyGen sem foto no cadastro: baixa a preview para
 * brand-assets/avatars/<id>/heygen-preview.<ext> e grava em
 * reference_image_path (só se vazio). É o que o Replicate e o element do
 * Higgsfield usam como foto. Falha aqui não derruba quem chamou.
 */
export async function ensurePreviewPhoto(service: SupabaseClient, avatarId: string, previewUrl: string | null): Promise<string | null> {
  if (!previewUrl) return null;
  const { data } = await service.from('brand_avatars').select('reference_image_path').eq('id', avatarId).maybeSingle();
  const current = (data as { reference_image_path?: string | null } | null)?.reference_image_path;
  if (current) return null;
  const r = await fetch(previewUrl, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`preview HeyGen ${r.status}`);
  const type = (r.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim();
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > PREVIEW_MAX_BYTES) throw new Error('preview HeyGen vazia ou grande demais');
  const path = `avatars/${avatarId}/heygen-preview.${ext}`;
  const { error: upErr } = await service.storage.from(PRESENTER_BUCKET).upload(path, bytes, { contentType: type, upsert: true });
  if (upErr) throw new Error(`upload preview: ${upErr.message}`);
  // só grava se continua vazio (a pessoa pode ter subido foto no meio)
  const { error } = await service.from('brand_avatars').update({ reference_image_path: path })
    .eq('id', avatarId).is('reference_image_path', null);
  if (error) throw new Error(error.message);
  return path;
}

/**
 * Lê na HeyGen a look principal, o grupo (twin) e os visuais extras ainda em
 * processamento; grava e devolve o ref e a look. Look pronta → copia a
 * preview como foto do cadastro, se faltar.
 */
export async function refreshHeygenRef(
  service: SupabaseClient, key: string, avatarId: string, prev: HeygenRef,
): Promise<{ ref: HeygenRef; look: HeygenLook }> {
  const look = await getLook(key, prev.look_id);
  const groupId = look.group_id ?? prev.group_id;
  const group = prev.type === 'digital_twin' && groupId ? await getGroup(key, groupId) : null;
  let ref = refFromHeygen(prev, look, group);
  const pending = ref.looks.filter((l) => l.status !== 'completed' && l.status !== 'failed');
  if (pending.length) {
    const fresh: HeygenLook[] = [];
    for (const l of pending.slice(0, 10)) {
      try {
        fresh.push(await getLook(key, l.id));
      } catch (err) {
        console.warn('[heygen] visual extra:', err instanceof Error ? err.message : err);
      }
    }
    ref = mergeExtraLooks(ref, fresh);
  }
  await saveHeygenRef(service, avatarId, ref);
  if (ref.status === 'completed') {
    await ensurePreviewPhoto(service, avatarId, look.preview_image_url)
      .catch((err) => console.warn('[heygen] preview → foto:', err instanceof Error ? err.message : err));
  }
  return { ref, look };
}

// ── voz padrão do avatar (brand_avatars.voice.heygen_voice) ──────────────────

export interface SavedHeygenVoice {
  provider?: 'twin' | 'elevenlabs' | 'heygen' | string | null;
  voice_id?: string | null;
}

export interface VoiceChoice {
  provider: 'elevenlabs' | 'heygen';
  /** heygen: voice_id HeyGen; elevenlabs: Voice ID ElevenLabs ou null (regra atual da marca) */
  voice_id: string | null;
  source: 'job' | 'avatar' | 'default';
}

const ELEVEN_ID_RE = /^[A-Za-z0-9]{10,40}$/;

/** Lê voice.heygen_voice do apresentador; formato inválido → null. */
export function savedHeygenVoice(voice: unknown): SavedHeygenVoice | null {
  const v = ((voice ?? {}) as { heygen_voice?: unknown }).heygen_voice;
  if (!v || typeof v !== 'object') return null;
  const x = v as SavedHeygenVoice;
  if (x.provider !== 'twin' && x.provider !== 'elevenlabs' && x.provider !== 'heygen') return null;
  return { provider: x.provider, voice_id: clean(x.voice_id) || null };
}

/**
 * Voz do vídeo de avatar. Ordem: a voz do job (voice_id explícito) → a voz
 * padrão do avatar (heygen_voice; twin = a voz clonada) → o comportamento de
 * antes (provedor do job; HeyGen sem id = voz padrão da look; ElevenLabs sem
 * id = regra da marca). Um job que escolheu só o provedor não recebe a voz
 * salva de outro provedor.
 */
export function chooseAvatarVoice(
  job: { provider?: string | null; voice_id?: string | null } | null | undefined,
  saved: SavedHeygenVoice | null,
  twinVoice: string | null,
  lookVoice: string | null,
): VoiceChoice {
  const jobProvider = job?.provider === 'heygen' ? 'heygen' : job?.provider === 'elevenlabs' ? 'elevenlabs' : null;
  const jobId = clean(job?.voice_id);
  if (jobId) return { provider: jobProvider ?? 'elevenlabs', voice_id: jobId, source: 'job' };
  if (saved) {
    const kind = saved.provider === 'elevenlabs' ? 'elevenlabs' : 'heygen';
    const fits = !jobProvider || jobProvider === kind;
    const id = saved.provider === 'twin' ? twinVoice : saved.voice_id ?? null;
    const valid = saved.provider === 'elevenlabs' ? Boolean(id && ELEVEN_ID_RE.test(id)) : Boolean(id);
    if (fits && valid) return { provider: kind, voice_id: id, source: 'avatar' };
  }
  const provider = jobProvider ?? 'elevenlabs';
  return { provider, voice_id: provider === 'heygen' ? lookVoice : null, source: 'default' };
}

/** Visual escolhido pertence ao avatar HeyGen do apresentador (principal ou extra)? */
export function lookBelongsTo(ref: HeygenRef, lookId: string): boolean {
  return ref.look_id === lookId || ref.looks.some((l) => l.id === lookId);
}

// ── brand kit HeyGen (director_state.heygen_brand_kit) ───────────────────────

export interface BrandKitRecord {
  id: string;
  status: string;
  site: string;
  colors_synced: boolean;
  attempt: number;
  updated_at: string;
}

async function readState<T>(service: SupabaseClient, key: string): Promise<T | null> {
  const { data } = await service.from('director_state').select('value').eq('key', key).maybeSingle();
  const v = (data as { value?: unknown } | null)?.value;
  return v && typeof v === 'object' ? (v as T) : null;
}

async function writeState(service: SupabaseClient, key: string, value: unknown): Promise<void> {
  const { error } = await service.from('director_state').upsert({ key, value }, { onConflict: 'key' });
  if (error) throw new Error(`director_state ${key}: ${error.message}`);
}

/** Site da marca (onboarding: app_settings.brand_autopilot.input.site). */
export async function brandSite(service: SupabaseClient): Promise<string | null> {
  const { data } = await service.from('app_settings').select('value').eq('key', 'brand_autopilot').maybeSingle();
  const site = clean(((data as { value?: { input?: { site?: unknown } } } | null)?.value?.input?.site));
  return /^https?:\/\//i.test(site) ? site : null;
}

/**
 * Garante o brand kit HeyGen: cria a partir do site (POST /v3/brand-kits) se
 * não existe, falhou ou `refresh`; consulta enquanto `loading`; quando
 * `completed`, aplica uma vez as cores da paleta do brand kit do app (PATCH
 * color_roles). Sem site → { kit: anterior ou null, reason }.
 */
export async function ensureBrandKit(
  service: SupabaseClient, key: string, opts: { refresh?: boolean } = {},
): Promise<{ kit: BrandKitRecord | null; reason: string | null }> {
  let kit = await readState<BrandKitRecord>(service, 'heygen_brand_kit');
  const needsCreate = !kit?.id || kit.status === 'error' || opts.refresh;
  if (needsCreate) {
    const site = await brandSite(service);
    if (!site) {
      return { kit: kit?.id ? kit : null, reason: 'A marca ainda não tem site cadastrado. Informe o site no onboarding da marca.' };
    }
    const attempt = kit ? (kit.attempt ?? 0) + 1 : 0;
    const created = await createBrandKit(key, site, null, idempotencyKey('brand_kit', shortHash(site), attempt));
    kit = {
      id: created.id, status: created.status, site, colors_synced: false, attempt, updated_at: new Date().toISOString(),
    };
    await writeState(service, 'heygen_brand_kit', kit);
    return { kit, reason: null };
  }
  if (kit!.status === 'loading') {
    const now = await getBrandKit(key, kit!.id);
    kit = { ...kit!, status: now.status, updated_at: new Date().toISOString() };
  }
  if (kit!.status === 'completed' && !kit!.colors_synced) {
    const { data } = await service.from('brand_kit').select('content').eq('status', 'active').maybeSingle();
    const palette = (data as { content?: { palette?: Record<string, unknown> } } | null)?.content?.palette;
    const roles = colorRolesFromPalette(palette);
    // color_roles substitui tudo: sem cor válida, mantém as que a HeyGen leu do site
    if (Object.keys(roles).length) await patchBrandKitColors(key, kit!.id, roles);
    kit = { ...kit!, colors_synced: true, updated_at: new Date().toISOString() };
  }
  await writeState(service, 'heygen_brand_kit', kit);
  return { kit: kit!, reason: null };
}
