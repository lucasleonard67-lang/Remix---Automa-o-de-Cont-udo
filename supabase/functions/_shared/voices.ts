// _shared/voices.ts — construtor de voz: clientes ElevenLabs e HeyGen de voz,
// o registro brand_voices e `speechBytes` (fala por qualquer provedor).
//
// Contrato: docs/hub-motor-contratos.md §9; mapa: docs/construtor-de-voz.md.
// Campos conferidos na OpenAPI do ElevenLabs e na spec v3 da HeyGen (30/10).
// Nada aqui foi testado contra os provedores (§9.6 do contrato).

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { createSpeech, heygenKey, heygenRequest, heygenStatus } from './heygen.ts';

const ELEVEN = 'https://api.elevenlabs.io';
export const ELEVEN_ID_RE = /^[A-Za-z0-9]{10,40}$/;
export const VOICE_NAME_MAX = 60;
export const DESIGN_MIN = 20;
export const DESIGN_MAX = 1000;
/** abaixo disso o clone sai ruim nos dois provedores (o ideal é 60–120 s) */
export const CLONE_MIN_S = 10;
export const CLONE_MAX_BYTES = 100 * 1024 * 1024;

/** Erro com status HTTP e frase pronta para a tela (o avatar-studio repassa). */
export class VoiceError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'VoiceError';
    this.status = status;
    this.code = code;
  }
}

// ── ElevenLabs ───────────────────────────────────────────────────────────────

export class ElevenHttpError extends Error {
  status: number;
  detail: { status?: string; message?: string };
  constructor(status: number, raw: string) {
    let detail: { status?: string; message?: string } = {};
    try {
      const parsed = JSON.parse(raw).detail;
      detail = typeof parsed === 'string' ? { message: parsed } : (parsed ?? {});
    } catch { /* corpo não-JSON */ }
    super(`elevenlabs ${status}: ${(detail.message ?? raw).slice(0, 300)}`);
    this.status = status;
    this.detail = detail;
  }
}

async function eleven(key: string, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${ELEVEN}${path}`, {
    ...init,
    headers: { 'xi-api-key': key, ...((init.headers as Record<string, string> | undefined) ?? {}) },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new ElevenHttpError(res.status, await res.text());
  return res;
}

async function elevenJson<T>(key: string, path: string, init: RequestInit = {}): Promise<T> {
  return (await (await eleven(key, path, init)).json()) as T;
}

/** Erro do ElevenLabs → VoiceError com a frase e o status que o contrato promete. */
export function elevenHuman(err: unknown, step: string): Error {
  if (!(err instanceof ElevenHttpError)) return err instanceof Error ? err : new Error(String(err));
  const msg = err.detail.message ?? err.message;
  const st = err.detail.status ?? '';
  const perm = /missing the permission (\w+)/i.exec(msg)?.[1];
  if (perm) {
    return new VoiceError(412, 'not_connected',
      `A chave do ElevenLabs não tem a permissão "${perm}" para ${step}. Edite a chave em elevenlabs.io → API Keys.`);
  }
  if (/voice_limit_reached|voice limit|maximum amount of custom voices/i.test(`${st} ${msg}`)) {
    return new VoiceError(409, 'slots_full', 'As vagas de voz do ElevenLabs estão cheias. Apague uma voz em Vozes ou use a HeyGen.');
  }
  if (err.status === 402 || /quota/i.test(`${st} ${msg}`)) {
    return new VoiceError(402, 'no_credits', 'Os créditos do ElevenLabs acabaram.');
  }
  if (st === 'free_users_not_allowed' || /creator tier|subscription/i.test(msg)) {
    return new VoiceError(403, 'plan', 'Esta voz da biblioteca exige o plano Creator do ElevenLabs.');
  }
  if (err.status === 401) {
    return new VoiceError(412, 'not_connected', 'A chave do ElevenLabs é inválida ou foi revogada. Salve outra em Config → Integrações.');
  }
  if (err.status === 403) {
    return new VoiceError(403, 'plan', `O plano do ElevenLabs não permite ${step}.`);
  }
  if (err.status === 404) return new VoiceError(404, 'not_found', 'Essa voz não existe no ElevenLabs.');
  if (err.status === 429) return new VoiceError(429, 'rate_limited', 'O ElevenLabs pediu uma pausa. Tente de novo em alguns minutos.');
  return new VoiceError(502, 'elevenlabs_error', `O ElevenLabs falhou ao ${step} (${err.status}).`);
}

export interface ElevenSubscription {
  tier: string | null;
  voice_slots_used: number;
  voice_limit: number;
  can_use_instant_voice_cloning: boolean;
}

export async function elevenSubscription(key: string): Promise<ElevenSubscription> {
  const s = await elevenJson<Record<string, unknown>>(key, '/v1/user/subscription');
  return {
    tier: typeof s.tier === 'string' ? s.tier : null,
    voice_slots_used: Number(s.voice_slots_used ?? 0),
    voice_limit: Number(s.voice_limit ?? 0),
    can_use_instant_voice_cloning: s.can_use_instant_voice_cloning === true,
  };
}

/** Clone instantâneo (IVC): POST /v1/voices/add (multipart). */
export async function elevenCloneIVC(
  key: string,
  input: { name: string; bytes: Uint8Array; filename: string; contentType: string; gender?: string | null },
): Promise<string> {
  const form = new FormData();
  form.append('name', input.name.slice(0, VOICE_NAME_MAX));
  form.append('files', new File([input.bytes as unknown as BlobPart], input.filename, { type: input.contentType }));
  // labels aceita objeto ou string no multipart; vai como JSON
  form.append('labels', JSON.stringify({ language: 'pt', accent: 'brazilian', ...(input.gender ? { gender: input.gender } : {}) }));
  form.append('description', 'Voz da marca (Content Engine).');
  const body = await elevenJson<{ voice_id?: string }>(key, '/v1/voices/add', { method: 'POST', body: form });
  if (!body.voice_id) throw new Error('O ElevenLabs não devolveu o id da voz clonada.');
  return body.voice_id;
}

/** Texto pt-BR das prévias do Voice Design (a API pede 100–1.000 caracteres). */
export const DESIGN_PREVIEW_TEXT =
  'Olá! Que bom ter você aqui. Hoje eu vou mostrar, em poucos minutos, como a nossa solução resolve ' +
  'um problema real do seu dia a dia. Preparado? Então vamos juntos, passo a passo, sem complicação.';

export interface ElevenPreview {
  generated_voice_id: string;
  audio_base_64: string;
  media_type: string;
}

/** Voice Design: POST /v1/text-to-voice/design (eleven_ttv_v3, 3 prévias). */
export async function elevenDesign(key: string, description: string): Promise<ElevenPreview[]> {
  const body = await elevenJson<{ previews?: ElevenPreview[] }>(key, '/v1/text-to-voice/design', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      voice_description: description.slice(0, DESIGN_MAX),
      model_id: 'eleven_ttv_v3',
      text: DESIGN_PREVIEW_TEXT,
      loudness: 0.5,
      guidance_scale: 5,
    }),
  });
  return (body.previews ?? []).filter((p) => p?.generated_voice_id && p?.audio_base_64).slice(0, 3);
}

/** Salva a prévia escolhida: POST /v1/text-to-voice. */
export async function elevenDesignSave(
  key: string, input: { generated_voice_id: string; name: string; description: string; gender?: string | null },
): Promise<string> {
  const body = await elevenJson<{ voice_id?: string }>(key, '/v1/text-to-voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      voice_name: input.name.slice(0, VOICE_NAME_MAX),
      voice_description: input.description.slice(0, DESIGN_MAX),
      generated_voice_id: input.generated_voice_id,
      labels: { language: 'pt', ...(input.gender ? { gender: input.gender } : {}) },
    }),
  });
  if (!body.voice_id) throw new Error('O ElevenLabs não devolveu o id da voz salva.');
  return body.voice_id;
}

export interface LibraryVoice {
  ref: string;
  name: string;
  gender: string | null;
  accent: string | null;
  preview_url: string | null;
}

/** Biblioteca pt-BR: GET /v1/shared-voices. `ref` = "<public_owner_id>:<voice_id>". */
export async function elevenSharedVoices(
  key: string, q: { search?: string; gender?: string; page?: number },
): Promise<{ voices: LibraryVoice[]; has_more: boolean }> {
  const params = new URLSearchParams({ language: 'pt', locale: 'pt-BR', page_size: '30', page: String(q.page ?? 0) });
  if (q.search) params.set('search', q.search.slice(0, 100));
  if (q.gender) params.set('gender', q.gender);
  const body = await elevenJson<{ voices?: Record<string, unknown>[]; has_more?: boolean }>(key, `/v1/shared-voices?${params}`);
  return {
    voices: (body.voices ?? []).map((v) => ({
      ref: `${String(v.public_owner_id ?? '')}:${String(v.voice_id ?? '')}`,
      name: String(v.name ?? ''),
      gender: typeof v.gender === 'string' ? v.gender : null,
      accent: typeof v.accent === 'string' ? v.accent : null,
      preview_url: typeof v.preview_url === 'string' ? v.preview_url : null,
    })),
    has_more: body.has_more === true,
  };
}

/** Adiciona uma voz da biblioteca à conta: POST /v1/voices/add/{public_user_id}/{voice_id}. */
export async function elevenAddShared(key: string, ref: string, name: string): Promise<string> {
  const [owner, voice] = ref.split(':');
  if (!owner || !voice) throw new VoiceError(400, 'invalid_input', 'Escolha uma voz da lista.');
  const body = await elevenJson<{ voice_id?: string }>(
    key, `/v1/voices/add/${encodeURIComponent(owner)}/${encodeURIComponent(voice)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ new_name: name.slice(0, VOICE_NAME_MAX) }) },
  );
  return body.voice_id ?? voice;
}

export async function elevenGetVoice(
  key: string, id: string,
): Promise<{ voice_id: string; name: string; gender: string | null; preview_url: string | null }> {
  const v = await elevenJson<{ voice_id?: string; name?: string; labels?: { gender?: string }; preview_url?: string }>(
    key, `/v1/voices/${encodeURIComponent(id)}`,
  );
  return { voice_id: v.voice_id ?? id, name: v.name ?? id, gender: v.labels?.gender ?? null, preview_url: v.preview_url ?? null };
}

/** DELETE /v1/voices/{id}; 404 conta como já apagada (false). */
export async function elevenDeleteVoice(key: string, id: string): Promise<boolean> {
  try {
    await eleven(key, `/v1/voices/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return true;
  } catch (err) {
    if (err instanceof ElevenHttpError && err.status === 404) return false;
    throw err;
  }
}

/** TTS eleven_v3 em MP3 128 kbps (o mesmo da narração). */
export async function elevenTts(key: string, text: string, voiceId: string): Promise<Uint8Array> {
  const r = await eleven(key, `/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_v3', voice_settings: { stability: 0.5 } }),
  });
  return new Uint8Array(await r.arrayBuffer());
}

// ── HeyGen ───────────────────────────────────────────────────────────────────

/**
 * Corpo de POST /v3/models/audio/voices (CreateInstantAudioVoiceRequest):
 * mode instant, name ≤64, audio [AssetUrl], language, similarity, ruído, gênero.
 */
export function buildHeygenCloneBody(input: { name: string; url: string; gender?: string | null }): Record<string, unknown> {
  return {
    mode: 'instant',
    name: input.name.slice(0, 64),
    audio: [{ type: 'url', url: input.url }],
    language: 'pt',
    similarity: 'max',
    remove_background_noise: true,
    ...(input.gender === 'female' || input.gender === 'male' ? { gender: input.gender } : {}),
  };
}

/** Clone instantâneo HeyGen Voice (202 → voice_id; acompanha por heygenModelVoice). */
export async function heygenCloneVoice(
  key: string, input: { name: string; url: string; gender?: string | null }, idem: string,
): Promise<string> {
  const data = await heygenRequest<{ voice_id?: string }>(key, '/v3/models/audio/voices', {
    method: 'POST',
    body: JSON.stringify(buildHeygenCloneBody(input)),
  }, { idempotencyKey: idem });
  if (!data?.voice_id) throw new Error('A HeyGen não devolveu o id da voz clonada.');
  return data.voice_id;
}

export interface HeygenModelVoice {
  status: 'PENDING' | 'ACTIVE' | 'FAILED' | string;
  failure_reason: string | null;
  preview_audio_url: string | null;
}

export async function heygenModelVoice(key: string, id: string): Promise<HeygenModelVoice> {
  const v = await heygenRequest<Record<string, unknown>>(key, `/v3/models/audio/voices/${encodeURIComponent(id)}`);
  return {
    status: String(v?.status ?? ''),
    failure_reason: typeof v?.failure_reason === 'string' ? v.failure_reason : null,
    preview_audio_url: typeof v?.preview_audio_url === 'string' ? v.preview_audio_url : null,
  };
}

/** DELETE /v3/models/audio/voices/{id}; 404 conta como já apagada (false). */
export async function heygenDeleteModelVoice(key: string, id: string): Promise<boolean> {
  try {
    await heygenRequest(key, `/v3/models/audio/voices/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return true;
  } catch (err) {
    if (heygenStatus(err) === 404) return false;
    throw err;
  }
}

/** failure_reason do clone (VideoTTSVoiceFailureReason) → frase. */
export function heygenCloneFailure(reason: string | null): string {
  if (reason === 'INVALID_AUDIO' || reason === 'INSUFFICIENT_AUDIO') {
    return 'Não deu para usar esse áudio. Grave de novo num lugar quieto.';
  }
  return `A HeyGen não conseguiu criar a voz (${reason ?? 'sem motivo'}). Tente de novo.`;
}

/**
 * "Desenhar voz" da HeyGen: POST /v3/voices (DesignVoiceRequest). A spec diz
 * "matching voices": devolve vozes do catálogo parecidas, não uma voz nova.
 */
export async function heygenDesignVoices(
  key: string, input: { prompt: string; gender?: string | null },
): Promise<{ voice_id: string; name: string; gender: string | null; preview_audio_url: string | null }[]> {
  const data = await heygenRequest<{ voices?: Record<string, unknown>[] }>(key, '/v3/voices', {
    method: 'POST',
    body: JSON.stringify({
      prompt: input.prompt.slice(0, DESIGN_MAX),
      locale: 'pt-BR',
      ...(input.gender === 'female' || input.gender === 'male' ? { gender: input.gender } : {}),
    }),
  });
  return (data?.voices ?? []).slice(0, 3).map((v) => ({
    voice_id: String(v.voice_id ?? ''),
    name: String(v.name ?? ''),
    gender: typeof v.gender === 'string' ? v.gender : null,
    preview_audio_url: typeof v.preview_audio_url === 'string' ? v.preview_audio_url : null,
  })).filter((v) => v.voice_id);
}

/**
 * Fala de um clone HeyGen Voice: POST /v3/models/audio/tts em MP3 128 kbps a
 * 44,1 kHz (output_format), o mesmo formato que a narração e o remake medem.
 */
/**
 * Corpo de POST /v3/models/audio/tts. Todo clone daqui é instantâneo com
 * similarity max: a doc recomenda esse par com expressiveness_boost 0.5 (padrão
 * do Studio) para a voz mais fiel; o padrão da API é 1.0. Clone profissional
 * recusa o campo.
 */
export function buildHeygenTtsBody(input: { text: string; voiceId: string }): Record<string, unknown> {
  return {
    model: 'heygen-voice-1',
    voice_id: input.voiceId,
    text: input.text.slice(0, 5000),
    language: 'pt',
    expressiveness_boost: 0.5,
    output_format: { encoding: 'mp3', sample_rate_hertz: 44100, bitrate_bps: 128000 },
  };
}

export async function heygenModelTts(
  key: string, input: { text: string; voiceId: string },
): Promise<{ audio_url: string; duration: number | null }> {
  const data = await heygenRequest<{ audio_url?: string; duration?: number }>(key, '/v3/models/audio/tts', {
    method: 'POST',
    body: JSON.stringify(buildHeygenTtsBody(input)),
  });
  if (!data?.audio_url) throw new Error('A HeyGen não devolveu o áudio da fala.');
  return { audio_url: data.audio_url, duration: typeof data.duration === 'number' ? data.duration : null };
}

// ── voz como referência e speechBytes ────────────────────────────────────────

export interface VoiceRef {
  provider: 'elevenlabs' | 'heygen';
  voice_id: string;
  /** clone HeyGen Voice (fala por /v3/models/audio/tts); senão catálogo (/v3/voices/speech) */
  heygen_model?: boolean;
  gender?: string | null;
}

export interface BrandVoiceRow {
  id: string;
  name: string;
  provider: 'elevenlabs' | 'heygen';
  provider_voice_id: string | null;
  source: 'clone' | 'design' | 'library' | 'pasted' | 'twin';
  status: 'processing' | 'ready' | 'failed';
  error: string | null;
  gender: string | null;
  language: string;
  sample_path: string | null;
  preview_path: string | null;
  owned: boolean;
  is_default: boolean;
  attempt: number;
  created_at: string;
}

/** Voz pronta da tabela → referência para falar; null se não está pronta. */
export function voiceRefOf(row: Pick<BrandVoiceRow, 'provider' | 'provider_voice_id' | 'source' | 'status' | 'gender'> | null): VoiceRef | null {
  if (!row || row.status !== 'ready' || !row.provider_voice_id) return null;
  return {
    provider: row.provider,
    voice_id: row.provider_voice_id,
    heygen_model: row.provider === 'heygen' && row.source === 'clone',
    gender: row.gender,
  };
}

export interface SpeechResult {
  bytes: Uint8Array;
  content_type: string;
  /** duração informada pelo provedor (HeyGen); null = medir pelo MP3 */
  duration_s: number | null;
  /** MP3 CBR 128 kbps: a medição por bytes e o acolchoamento do CTA valem */
  mp3_128: boolean;
}

/**
 * Fala pelo provedor da voz. ElevenLabs passa pelo `eleven` de quem chama (o
 * director-advance tem a tradução de erro dele); HeyGen: clone HeyGen Voice
 * por /v3/models/audio/tts (MP3 128 kbps), catálogo por /v3/voices/speech
 * (formato não fixado na spec: usa a duração devolvida).
 */
export async function speechBytes(
  service: SupabaseClient,
  text: string,
  voice: VoiceRef,
  deps: { eleven: (text: string, voiceId: string) => Promise<Uint8Array> },
): Promise<SpeechResult> {
  if (voice.provider === 'elevenlabs') {
    return { bytes: await deps.eleven(text, voice.voice_id), content_type: 'audio/mpeg', duration_s: null, mp3_128: true };
  }
  const key = await heygenKey(service);
  const out = voice.heygen_model
    ? await heygenModelTts(key, { text, voiceId: voice.voice_id })
    : await createSpeech(key, { text, voiceId: voice.voice_id, language: 'pt' });
  const r = await fetch(out.audio_url, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`Não deu para baixar a fala da HeyGen (${r.status}).`);
  const contentType = (r.headers.get('content-type') ?? 'audio/mpeg').split(';')[0].trim() || 'audio/mpeg';
  return {
    bytes: new Uint8Array(await r.arrayBuffer()),
    content_type: contentType,
    duration_s: out.duration,
    mp3_128: Boolean(voice.heygen_model),
  };
}

// ── registro (brand_voices) ──────────────────────────────────────────────────

const VOICE_COLUMNS =
  'id, name, provider, provider_voice_id, source, status, error, gender, language, sample_path, preview_path, ' +
  'owned, is_default, attempt, created_at';

/** Uma voz; null se não existe — ou se a tabela ainda não foi criada (brand-voices.sql). */
export async function loadBrandVoice(service: SupabaseClient, id: unknown): Promise<BrandVoiceRow | null> {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await service.from('brand_voices').select(VOICE_COLUMNS).eq('id', id).maybeSingle();
  if (error) return null;
  return (data as unknown as BrandVoiceRow | null) ?? null;
}

/** A voz padrão pronta; null sem padrão ou sem a tabela (o caminho de hoje). */
export async function defaultBrandVoice(service: SupabaseClient): Promise<BrandVoiceRow | null> {
  const { data, error } = await service.from('brand_voices').select(VOICE_COLUMNS)
    .eq('is_default', true).eq('status', 'ready').limit(1);
  if (error) return null;
  return ((data ?? []) as unknown as BrandVoiceRow[])[0] ?? null;
}

/** Linha de brand_voices de uma voz do provedor; null sem linha ou sem a tabela. */
export async function findBrandVoice(
  service: SupabaseClient, provider: 'elevenlabs' | 'heygen', providerVoiceId: string | null | undefined,
): Promise<BrandVoiceRow | null> {
  if (!providerVoiceId) return null;
  const { data, error } = await service.from('brand_voices').select(VOICE_COLUMNS)
    .eq('provider', provider).eq('provider_voice_id', providerVoiceId).limit(1);
  if (error) return null;
  return ((data ?? []) as unknown as BrandVoiceRow[])[0] ?? null;
}

// ── decisões puras ───────────────────────────────────────────────────────────

export type VoicePath = 'own' | 'describe' | 'library' | 'paste';

export interface ProviderState {
  eleven: { connected: boolean; can_clone: boolean | null; slots_used: number | null; slot_limit: number | null };
  heygen: { connected: boolean };
}

export interface PathChoice {
  provider: 'elevenlabs' | 'heygen' | null;
  blocked_reason: string | null;
}

const NONE = 'Conecte o ElevenLabs ou a HeyGen para criar vozes.';

/** Provedor de cada caminho (docs/hub-motor-contratos.md §9.3). */
export function voicePaths(s: ProviderState, prefer?: 'heygen' | null): Record<VoicePath, PathChoice> {
  const el = s.eleven;
  const slotsFull = el.slots_used != null && el.slot_limit != null && el.slot_limit > 0 && el.slots_used >= el.slot_limit;
  const elevenClones = el.connected && el.can_clone === true && !slotsFull;
  let own: PathChoice;
  // num fluxo HeyGen, o clone nasce na HeyGen mesmo com o ElevenLabs disponível
  if (prefer === 'heygen' && s.heygen.connected) own = { provider: 'heygen', blocked_reason: null };
  else if (elevenClones) own = { provider: 'elevenlabs', blocked_reason: null };
  else if (s.heygen.connected) own = { provider: 'heygen', blocked_reason: null };
  else if (!el.connected) own = { provider: null, blocked_reason: NONE };
  else if (slotsFull) {
    own = { provider: null, blocked_reason: `As vagas de voz do ElevenLabs estão cheias (${el.slots_used}/${el.slot_limit}).` };
  } else own = { provider: null, blocked_reason: 'O plano do ElevenLabs não clona voz. Conecte a HeyGen para clonar de graça.' };
  const either: PathChoice = el.connected
    ? { provider: 'elevenlabs', blocked_reason: null }
    : s.heygen.connected
      ? { provider: 'heygen', blocked_reason: null }
      : { provider: null, blocked_reason: NONE };
  return {
    own,
    describe: either,
    library: either,
    paste: el.connected
      ? { provider: 'elevenlabs', blocked_reason: null }
      : { provider: null, blocked_reason: 'Colar um Voice ID precisa do ElevenLabs conectado.' },
  };
}

/** Duração de um WAV PCM pelo cabeçalho (byte rate do "fmt " ÷ tamanho do "data"); null se não for WAV. */
export function wavDurationSeconds(bytes: Uint8Array): number | null {
  if (bytes.byteLength < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= bytes.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ' && offset + 16 <= bytes.byteLength) byteRate = view.getUint32(offset + 16, true);
    if (id === 'data') {
      if (!byteRate) return null;
      const dataSize = Math.min(size, bytes.byteLength - offset - 8);
      return dataSize / byteRate;
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

/** `cost_label` de uma linha video_models (voice_create): verificado e 0 → grátis; não verificado → a confirmar. */
export function costLabel(cost: { usd?: number; verified?: boolean } | null | undefined, fallback: string): string {
  if (!cost) return fallback;
  if (cost.verified === false) return 'a confirmar';
  if (typeof cost.usd === 'number') return cost.usd === 0 ? 'grátis' : `US$ ${cost.usd.toFixed(2).replace('.', ',')}`;
  return fallback;
}

/**
 * Voz padrão da marca para a narração (posição 3 da ordem, §9.5): vale se
 * pronta e sem conflito de gênero. Gênero pedido e voz sem gênero conhecido:
 * não arrisca (mesma regra da ELEVEN_VOICE_ID).
 */
export function defaultFitsGender(row: Pick<BrandVoiceRow, 'gender'>, gender?: string | null): boolean {
  if (!gender) return true;
  return row.gender === gender;
}

/**
 * A voz salva do apresentador (heygen_voice, provider heygen) é um clone
 * HeyGen Voice de brand_voices? Então fala pela rota de áudio (o voice_id
 * desses clones só é garantido no TTS próprio). Voz de catálogo → null
 * (segue como voice_id).
 */
export function avatarVoiceAsClone(
  choice: { provider: string; voice_id: string | null; source: string },
  row: Pick<BrandVoiceRow, 'provider' | 'provider_voice_id' | 'source' | 'status' | 'gender'> | null,
): VoiceRef | null {
  if (choice.source !== 'avatar' || choice.provider !== 'heygen' || !choice.voice_id) return null;
  const ref = voiceRefOf(row);
  return ref && ref.heygen_model && ref.voice_id === choice.voice_id ? ref : null;
}
