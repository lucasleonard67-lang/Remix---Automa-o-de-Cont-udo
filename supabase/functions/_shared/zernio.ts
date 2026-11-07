// _shared/zernio.ts — client HTTP da API Zernio (publicação/agendamento real).
// 4º módulo autorizado a falar com API externa (depois de llm.ts, web-search.ts
// e do gateway de imagem) — docs/10-plano-integracoes.md Eixo 1.
//
// Regras:
// - A key (ZERNIO_API_KEY, formato sk_<64hex>) vem SEMPRE do Vault via
//   get_vault_secret pelo caller; este módulo só recebe o valor já resolvido.
// - Nunca logar a key nem repassar o header Authorization em erros.
// - Base URL da spec (servers[0]): https://zernio.com/api — paths /v1/*.

const ZERNIO_BASE = 'https://zernio.com/api';

/** Erro normalizado da API Zernio (envelope { error, ... } ou HTTP puro). */
export class ZernioError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ZernioError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type ZernioFetchOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Headers extras (ex.: x-request-id para idempotência do createPost). */
  headers?: Record<string, string>;
  /** Query string (valores são URL-encoded). */
  query?: Record<string, string>;
};

/**
 * Chamada autenticada à API Zernio. Lança ZernioError em qualquer status não-2xx
 * — o CALLER decide o que é recuperável (ex.: 409 duplicate_content no publish).
 */
export async function zernioFetch(
  apiKey: string,
  path: string,
  options: ZernioFetchOptions = {},
): Promise<Record<string, unknown>> {
  const url = new URL(`${ZERNIO_BASE}${path}`);
  for (const [k, v] of Object.entries(options.query ?? {})) {
    url.searchParams.set(k, v);
  }

  const response = await fetch(url.toString(), {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  let payload: Record<string, unknown> = {};
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch (_err) {
      payload = { raw: text };
    }
  }

  if (!response.ok) {
    const err = (payload.error ?? payload) as Record<string, unknown>;
    const code = typeof err.code === 'string'
      ? err.code
      : typeof payload.error === 'string'
        ? (payload.error as string)
        : `http_${response.status}`;
    const message = typeof err.message === 'string'
      ? err.message
      : typeof payload.message === 'string'
        ? (payload.message as string)
        : `Zernio respondeu ${response.status}.`;
    throw new ZernioError(response.status, code, message, payload.details ?? err.details ?? payload);
  }

  return payload;
}

/**
 * Sobe um arquivo para a mídia do Zernio via presign e devolve a URL pública
 * ESTÁVEL (media.zernio.com). Necessário porque o bucket `renders` é privado e
 * signed URL de 1h não sobrevive a um post agendado.
 */
export async function uploadMedia(
  apiKey: string,
  file: { filename: string; contentType: string; bytes: Uint8Array },
): Promise<string> {
  const presign = await zernioFetch(apiKey, '/v1/media/presign', {
    method: 'POST',
    body: {
      filename: file.filename,
      contentType: file.contentType,
      size: file.bytes.byteLength,
    },
  });

  const uploadUrl = presign.uploadUrl as string | undefined;
  const publicUrl = presign.publicUrl as string | undefined;
  if (!uploadUrl || !publicUrl) {
    throw new ZernioError(502, 'presign_invalid', 'Resposta do presign sem uploadUrl/publicUrl.');
  }

  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.contentType },
    // Uint8Array é BodyInit válido no Deno; cast pela definição DOM do tsc.
    body: file.bytes as unknown as BodyInit,
  });
  if (!put.ok) {
    throw new ZernioError(502, 'media_upload_failed', `Upload da mídia falhou (${put.status}).`);
  }

  return publicUrl;
}

/** Mapeia channel_type do Content Engine → platform do Zernio. */
export const CHANNEL_TO_PLATFORM: Record<string, string> = {
  instagram_post: 'instagram',
  instagram_carousel: 'instagram',
  instagram_stories: 'instagram',
  x_post: 'twitter',
  threads_post: 'threads',
  linkedin_post: 'linkedin',
  facebook_post: 'facebook',
};

/**
 * Normaliza o status de post do Zernio → publish_status do banco.
 * O vocabulário do Zernio é livre na spec (examples: scheduled/published/
 * failed/partial/publishing/draft/cancelled) — desconhecido vira 'publishing'
 * (estado não-terminal; o webhook/get-status corrige depois).
 */
export function toPublishStatus(zernioStatus: string | undefined): string {
  switch ((zernioStatus ?? '').toLowerCase()) {
    case 'published':
      return 'published';
    case 'scheduled':
    case 'draft':
      return 'scheduled';
    case 'failed':
      return 'failed';
    case 'partial':
      return 'partial';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    default:
      return 'publishing';
  }
}

/** Extrai a URL pública e o erro do primeiro alvo de plataforma de um post Zernio. */
export function extractPlatformResult(post: Record<string, unknown>): {
  publishedUrl: string | null;
  error: string | null;
} {
  const platforms = Array.isArray(post.platforms)
    ? (post.platforms as Array<Record<string, unknown>>)
    : [];
  const first = platforms[0] ?? {};
  const publishedUrl =
    (typeof first.publishedUrl === 'string' && first.publishedUrl) ||
    (typeof post.platformPostUrl === 'string' && post.platformPostUrl) ||
    null;
  const error = (typeof first.error === 'string' && first.error) || null;
  return { publishedUrl, error };
}

// ── Vídeo do Diretor → Reel no Instagram ─────────────────────────────────────
// Sem linha em published_posts (piece_id é NOT NULL): o estado mora em
// director_jobs.artifacts.instagram, como o TikTok mora em artifacts.tiktok.

export type DirectorInstagramState = {
  status: 'pending' | 'publishing' | 'published' | 'failed';
  request_id: string;
  account_id?: string;
  zernio_post_id?: string | null;
  url?: string | null;
  error?: string | null;
  published_at?: string | null;
};

type DirectorJobsClient = {
  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente do Supabase sem tipos gerados no Deno
  from: (table: string) => any;
};

/**
 * Mescla `patch` em artifacts.instagram do job. 'published' é terminal: uma
 * escrita atrasada (proxy depois do webhook) só completa campos, nunca rebaixa.
 */
export async function mergeDirectorInstagram(
  service: DirectorJobsClient,
  jobId: string,
  patch: Partial<DirectorInstagramState>,
): Promise<DirectorInstagramState | null> {
  const { data: job } = await service
    .from('director_jobs')
    .select('artifacts')
    .eq('id', jobId)
    .maybeSingle();
  if (!job) return null;
  const artifacts = (job.artifacts ?? {}) as Record<string, unknown>;
  const current = (artifacts.instagram ?? {}) as Partial<DirectorInstagramState>;
  const next = { ...current } as DirectorInstagramState;
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'status' && current.status === 'published' && value !== 'published') continue;
    if (value !== undefined && value !== null) (next as Record<string, unknown>)[key] = value;
    else if (key === 'error') next.error = null;
  }
  await service
    .from('director_jobs')
    .update({ artifacts: { ...artifacts, instagram: next } })
    .eq('id', jobId);
  return next;
}
