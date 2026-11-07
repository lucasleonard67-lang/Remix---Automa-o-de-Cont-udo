// _shared/market-apify.ts — leitura dos posts públicos de perfis do Instagram
// via Apify (ator apify/instagram-scraper), para o módulo Mercado.
//
// Regras:
// - O token (APIFY_TOKEN) vem SEMPRE do Vault via get_vault_secret pelo caller;
//   este módulo só recebe o valor já resolvido e nunca o loga.
// - Uma execução síncrona por lote de perfis:
//   POST https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items
//   Com resultsType = 'details' cada item é um perfil (followersCount,
//   fullName, profilePicUrl) com `latestPosts` (os ~12 mais recentes) — um só
//   run devolve seguidores e posts. Se o perfil vier sem latestPosts, o caller
//   pode pedir resultsType = 'posts' (um item por post) com fetchProfilePosts.
// - Tudo defensivo: o shape dos itens muda com o tempo (likesCount = -1 quando
//   o autor esconde curtidas; views em videoViewCount OU videoPlayCount).

const APIFY_BASE = 'https://api.apify.com/v2';
const ACTOR = 'apify~instagram-scraper';
/** Tempo máximo do run no Apify (s) — abaixo do teto da edge function. */
const RUN_TIMEOUT_S = 100;
/** Tempo máximo da requisição HTTP (ms), um pouco acima do run. */
const HTTP_TIMEOUT_MS = 115_000;

export class ApifyError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApifyError';
    this.status = status;
    this.code = code;
  }
}

export type MarketMediaType = 'image' | 'carousel' | 'reel';

export interface ApifyPost {
  platform_post_id: string;
  url: string | null;
  caption: string | null;
  media_type: MarketMediaType;
  thumbnail_url: string | null;
  posted_at: string | null;
  likes: number | null;
  comments: number | null;
  views: number | null;
  /** @ do autor quando o item vem solto (resultsType = posts). */
  owner: string | null;
}

export interface ApifyProfile {
  handle: string;
  name: string | null;
  avatar_url: string | null;
  followers: number | null;
  posts: ApifyPost[];
  /** Motivo humanizado quando o perfil não pôde ser lido (privado, inexistente…). */
  error: string | null;
}

type Loose = Record<string, unknown>;

function isRecord(v: unknown): v is Loose {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function str(v: unknown, max = 4000): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}
function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
/** Contador do Instagram: -1 = escondido pelo autor → null (nunca 0 fabricado). */
function count(v: unknown): number | null {
  const n = num(v);
  return n === null || n < 0 ? null : Math.round(n);
}

export function normalizeHandle(raw: string): string | null {
  let h = raw.trim().toLowerCase();
  const m = h.match(/instagram\.com\/([a-z0-9._]+)/i);
  if (m) h = m[1];
  h = h.replace(/^@/, '').replace(/\/+$/, '');
  if (!/^[a-z0-9._]{1,30}$/.test(h)) return null;
  return h;
}

export function profileUrl(handle: string): string {
  return `https://www.instagram.com/${handle}/`;
}

function mediaType(item: Loose): MarketMediaType {
  const t = String(item.type ?? item.productType ?? '').toLowerCase();
  const children = Array.isArray(item.childPosts) ? item.childPosts.length : 0;
  if (t === 'sidecar' || t === 'carousel' || children > 1) {
    return 'carousel';
  }
  if (t === 'video' || t === 'reel' || t === 'clips' || typeof item.videoUrl === 'string') return 'reel';
  return 'image';
}

export function normalizePost(raw: unknown): ApifyPost | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.shortCode, 80) ?? str(raw.id, 80);
  if (!id) return null;
  const url =
    str(raw.url, 500) ??
    (typeof raw.shortCode === 'string' ? `https://www.instagram.com/p/${raw.shortCode}/` : null);
  const posted = str(raw.timestamp, 40);
  const postedAt = posted && !Number.isNaN(new Date(posted).getTime()) ? new Date(posted).toISOString() : null;
  const views = count(raw.videoViewCount) ?? count(raw.videoPlayCount) ?? count(raw.igPlayCount) ?? count(raw.playCount);
  return {
    platform_post_id: id,
    url,
    caption: str(raw.caption, 2200),
    media_type: mediaType(raw),
    thumbnail_url: str(raw.displayUrl, 1000) ?? (Array.isArray(raw.images) ? str(raw.images[0], 1000) : null),
    posted_at: postedAt,
    likes: count(raw.likesCount),
    comments: count(raw.commentsCount),
    views,
    owner: str(raw.ownerUsername, 60)?.toLowerCase() ?? null,
  };
}

/** Mensagem pt-BR para os erros por item que o ator devolve. */
function itemError(raw: Loose): string | null {
  const e = raw.error ?? raw.errorDescription;
  if (typeof e !== 'string' || !e.trim()) return null;
  const lower = e.toLowerCase();
  if (lower.includes('private')) return 'Perfil privado — só perfis públicos podem ser lidos.';
  if (lower.includes('not found') || lower.includes('no_items') || lower.includes('does not exist')) {
    return 'Perfil não encontrado. Confira o @ e tente de novo.';
  }
  if (lower.includes('restricted') || lower.includes('login')) {
    return 'O Instagram limitou a leitura deste perfil agora. Tente de novo mais tarde.';
  }
  return `O Apify não conseguiu ler este perfil (${e.slice(0, 120)}).`;
}

function normalizeProfile(raw: Loose, requested: string): ApifyProfile {
  const handle = str(raw.username, 60)?.toLowerCase() ?? requested;
  const latest = Array.isArray(raw.latestPosts) ? raw.latestPosts : [];
  const posts = latest.map(normalizePost).filter((p): p is ApifyPost => p !== null);
  return {
    handle,
    name: str(raw.fullName, 120),
    avatar_url: str(raw.profilePicUrlHD, 1000) ?? str(raw.profilePicUrl, 1000),
    followers: count(raw.followersCount),
    posts,
    error: itemError(raw),
  };
}

async function runActor(token: string, input: Loose): Promise<unknown[]> {
  const url = new URL(`${APIFY_BASE}/acts/${ACTOR}/run-sync-get-dataset-items`);
  url.searchParams.set('token', token);
  url.searchParams.set('timeout', String(RUN_TIMEOUT_S));
  url.searchParams.set('format', 'json');
  url.searchParams.set('clean', 'true');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new ApifyError(
      504,
      aborted ? 'apify_timeout' : 'apify_unreachable',
      aborted
        ? 'O Apify demorou demais para responder. Tente de novo em alguns minutos.'
        : 'Não foi possível falar com o Apify agora. Tente de novo em alguns minutos.',
    );
  }
  clearTimeout(timer);

  const text = await response.text();
  let payload: unknown = [];
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (_err) {
      payload = null;
    }
  }

  if (!response.ok) {
    const err = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
    const type = typeof err.type === 'string' ? err.type : `http_${response.status}`;
    const message = typeof err.message === 'string' ? err.message : '';
    if (response.status === 401 || response.status === 403) {
      throw new ApifyError(
        400,
        'apify_unauthorized',
        'O Apify recusou o token. Cole um token válido em Config → Integrações → Apify.',
      );
    }
    if (response.status === 402) {
      throw new ApifyError(
        402,
        'apify_credits',
        'Os créditos da sua conta Apify acabaram. Recarregue em console.apify.com e tente de novo.',
      );
    }
    if (response.status === 408) {
      throw new ApifyError(504, 'apify_timeout', 'O Apify demorou demais para ler os perfis. Tente de novo.');
    }
    console.error(`[market-apify] ${response.status} ${type}: ${message.slice(0, 200)}`);
    throw new ApifyError(
      502,
      'apify_error',
      `O Apify respondeu com erro (${response.status}). Tente de novo; se repetir, confira a conta em console.apify.com.`,
    );
  }

  return Array.isArray(payload) ? payload : [];
}

/**
 * Lê perfis (seguidores, nome, avatar) e os últimos posts de cada um num só
 * run. Devolve um ApifyProfile por handle pedido — perfil que não voltou no
 * dataset vem com `error` preenchido.
 */
export async function fetchProfiles(
  token: string,
  handles: string[],
  resultsLimit = 12,
): Promise<ApifyProfile[]> {
  const items = await runActor(token, {
    directUrls: handles.map(profileUrl),
    resultsType: 'details',
    resultsLimit,
    addParentData: false,
  });

  const byHandle = new Map<string, ApifyProfile>();
  for (const raw of items) {
    if (!isRecord(raw)) continue;
    // Item de erro do ator: traz inputUrl + error, sem username.
    const requested =
      str(raw.username, 60)?.toLowerCase() ??
      (typeof raw.inputUrl === 'string' ? normalizeHandle(raw.inputUrl) : null) ??
      handles[0];
    const profile = normalizeProfile(raw, requested);
    const prev = byHandle.get(profile.handle);
    // Dois itens para o mesmo perfil (raro): fica o que tem posts.
    if (!prev || profile.posts.length > prev.posts.length) byHandle.set(profile.handle, profile);
  }

  return handles.map(
    (h) =>
      byHandle.get(h) ?? {
        handle: h,
        name: null,
        avatar_url: null,
        followers: null,
        posts: [],
        error: 'Perfil não encontrado. Confira o @ e tente de novo.',
      },
  );
}

/** Fallback: só os posts (um item por post) quando o perfil veio sem latestPosts. */
export async function fetchProfilePosts(
  token: string,
  handle: string,
  resultsLimit = 12,
): Promise<ApifyPost[]> {
  const items = await runActor(token, {
    directUrls: [profileUrl(handle)],
    resultsType: 'posts',
    resultsLimit,
    addParentData: false,
  });
  return items.map(normalizePost).filter((p): p is ApifyPost => p !== null);
}
