// _shared/link-reader.ts — lê um link colado sem chave e sem custo: página do
// site, ou as rotas públicas de incorporação das redes. Falhou ou veio sem
// texto, o erro `link_needs_text` pede a legenda e o fluxo segue
// (aba Link do Contexto).
//
// O endereço vem do usuário: cada salto do redirecionamento passa por
// isPublicUrl e pela resolução de DNS antes de o servidor buscar. safeFetch é
// a mesma porta para toda função que busca URL de fora (site da marca, feed,
// foto do conector).
//
// Limite conhecido: o fetch resolve o nome de novo depois da conferência, então
// um DNS que troca de resposta entre as duas consultas (rebinding) não é pego.

import {
  articleFromHtml,
  classifyLink,
  isPrivateAddress,
  isPublicUrl,
  linkCaption,
  MAX_LINK_TEXT_CHARS,
  MIN_ARTICLE_CHARS,
  xPostText,
  type ClassifiedLink,
  type LinkPlatform,
} from './link-rules.ts';

const TIMEOUT_MS = 12_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5',
  'Accept-Language': 'en,pt-BR;q=0.8',
};

export class LinkError extends Error {
  status: number;
  code: 'invalid_link' | 'link_needs_text';
  constructor(status: number, code: LinkError['code'], message: string) {
    super(message);
    this.name = 'LinkError';
    this.status = status;
    this.code = code;
  }
}

export interface LinkContent {
  url: string;
  platform: LinkPlatform;
  owner: string;
  text: string;
  image: string | null;
}

const NEEDS_TEXT: Record<LinkPlatform, string> = {
  instagram: 'O Instagram não liberou esse post. Cole a legenda aqui para seguir.',
  x: 'O X não liberou esse post. Cole o texto aqui para seguir.',
  youtube: 'O YouTube não liberou esse vídeo. Cole a descrição aqui para seguir.',
  tiktok: 'O TikTok não libera a legenda. Cole o texto aqui para seguir.',
  site: 'Esse site não liberou o texto. Cole o conteúdo aqui para seguir.',
};

const needsText = (platform: LinkPlatform) => new LinkError(422, 'link_needs_text', NEEDS_TEXT[platform]);

/** Consulta de DNS (A ou AAAA). Injetável nos testes. */
export type ResolveDns = (host: string, type: 'A' | 'AAAA', signal?: AbortSignal) => Promise<string[]>;

const denoResolveDns: ResolveDns | null =
  typeof Deno !== 'undefined' && typeof Deno.resolveDns === 'function'
    ? (host, type, signal) => Deno.resolveDns(host, type, signal ? { signal } : undefined)
    : null;

/** Erro do ambiente (runtime sem DNS liberado), não do nome consultado. */
const DNS_UNAVAILABLE = new Set(['NotSupported', 'PermissionDenied', 'NotCapable']);
let warnedNoDns = false;

type HostVerdict = 'public' | 'private' | 'unresolved';

/**
 * Para onde o nome aponta. Nome que não resolve não é buscado. Só quando o
 * runtime não deixa consultar DNS vale a checagem do endereço (isPublicUrl)
 * sozinha, com aviso no log.
 */
async function checkHost(
  rawHost: string,
  opts: { resolve?: ResolveDns | null; signal?: AbortSignal },
): Promise<HostVerdict> {
  const host = rawHost.toLowerCase().replace(/\.+$/, '');
  if (host.startsWith('[') || host.includes(':') || /^[\d.]+$/.test(host)) {
    return isPrivateAddress(host) ? 'private' : 'public';
  }
  const resolve = opts.resolve === undefined ? denoResolveDns : opts.resolve;
  const answers = resolve
    ? await Promise.allSettled([resolve(host, 'A', opts.signal), resolve(host, 'AAAA', opts.signal)])
    : [];
  opts.signal?.throwIfAborted();
  const addresses = answers.flatMap((a) => (a.status === 'fulfilled' ? a.value : []));
  if (addresses.length > 0) return addresses.some(isPrivateAddress) ? 'private' : 'public';
  const noDns = answers.every(
    (a) => a.status === 'rejected' && DNS_UNAVAILABLE.has((a.reason as Error | null)?.name ?? ''),
  );
  if (!noDns) return 'unresolved';
  if (!warnedNoDns) {
    warnedNoDns = true;
    console.warn('[link-reader] runtime sem consulta de DNS: só o endereço da URL é conferido');
  }
  return 'public';
}

/** O nome só resolve para endereços públicos? */
export async function hostIsPublic(
  host: string,
  opts: { resolve?: ResolveDns | null; signal?: AbortSignal } = {},
): Promise<boolean> {
  return (await checkHost(host, opts)) === 'public';
}

export interface SafeFetchOptions {
  headers?: HeadersInit;
  /** Teto da cadeia inteira (todos os saltos). */
  timeoutMs?: number;
  /** 0 = redirecionamento é erro. */
  maxRedirects?: number;
  /** Recusa http:// em qualquer salto. */
  httpsOnly?: boolean;
  resolve?: ResolveDns | null;
  fetch?: typeof fetch;
}

/** O destino (ou um salto do redirecionamento) não é público. */
export class BlockedUrlError extends Error {
  url: string;
  constructor(url: string, message = 'URL de rede interna não é aceita.') {
    super(message);
    this.name = 'BlockedUrlError';
    this.url = url;
  }
}

/** URL com formato público (e https, se pedido)? Sem rede. */
function publicShape(raw: string, httpsOnly?: boolean): boolean {
  return isPublicUrl(raw) && (!httpsOnly || new URL(raw).protocol === 'https:');
}

/** URL que o servidor pode buscar agora: endereço público e DNS só para fora. */
export async function isPublicDestination(
  raw: string,
  opts: Pick<SafeFetchOptions, 'httpsOnly' | 'resolve'> & { signal?: AbortSignal } = {},
): Promise<boolean> {
  return publicShape(raw, opts.httpsOnly) && (await hostIsPublic(new URL(raw).hostname, opts));
}

/**
 * GET com redirecionamento conferido salto a salto (isPublicUrl + DNS em cada
 * um). Devolve a resposta final, que pode não ser 2xx; o corpo fica com quem
 * chamou. BlockedUrlError quando algum salto aponta para dentro; nome que não
 * resolve sai como o erro de DNS do próprio fetch ("failed to lookup address"),
 * que as telas já traduzem.
 */
export async function safeFetch(start: string, opts: SafeFetchOptions = {}): Promise<{ response: Response; url: string }> {
  const signal = AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS);
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const doFetch = opts.fetch ?? fetch;
  let current = start;
  for (let hop = 0; ; hop++) {
    if (!publicShape(current, opts.httpsOnly)) throw new BlockedUrlError(current);
    const host = new URL(current).hostname;
    const verdict = await checkHost(host, { resolve: opts.resolve, signal });
    if (verdict === 'private') throw new BlockedUrlError(current);
    if (verdict === 'unresolved') throw new TypeError(`dns error: failed to lookup address information (${host})`);
    const response = await doFetch(current, { headers: opts.headers, redirect: 'manual', signal });
    const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
    if (!location) return { response, url: current };
    void response.body?.cancel().catch(() => undefined);
    if (hop >= maxRedirects) {
      throw new Error(maxRedirects === 0 ? 'a URL redireciona para outro endereço' : 'a URL redirecionou vezes demais');
    }
    current = new URL(location, current).toString();
  }
}

async function readBody(res: Response): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const bytes = new Uint8Array(Math.min(total, MAX_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, bytes.length - offset);
    bytes.set(part, offset);
    offset += part.length;
  }
  return new TextDecoder().decode(bytes);
}

/** GET de texto pelo safeFetch. null = não deu para ler. */
async function safeGet(start: string): Promise<{ url: string; body: string } | null> {
  let res: Response;
  let url: string;
  try {
    ({ response: res, url } = await safeFetch(start, { headers: HEADERS }));
  } catch {
    return null;
  }
  const type = (res.headers.get('content-type') ?? '').toLowerCase();
  if (!res.ok || !/text\/|html|json|xml/.test(type)) {
    void res.body?.cancel().catch(() => undefined);
    return null;
  }
  return { url, body: await readBody(res) };
}

async function oembed(endpoint: string): Promise<Record<string, unknown> | null> {
  const page = await safeGet(endpoint);
  if (!page) return null;
  try {
    const data = JSON.parse(page.body) as unknown;
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const slug = (name: string) => name.toLowerCase().replace(/^@/, '').replace(/\s+/g, '').slice(0, 60);

async function readInstagram(link: ClassifiedLink): Promise<LinkContent> {
  const data = await oembed(`https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(link.url)}`);
  const text = str(data?.title);
  if (!text) throw needsText('instagram');
  const owner = str(data?.author_name) ?? link.owner ?? 'instagram';
  return { url: link.url, platform: 'instagram', owner: slug(owner), text: linkCaption(null, text), image: str(data?.thumbnail_url) };
}

async function readX(link: ClassifiedLink): Promise<LinkContent> {
  const data = await oembed(`https://publish.x.com/oembed?omit_script=1&url=${encodeURIComponent(link.url)}`);
  const text = xPostText(str(data?.html) ?? '');
  if (!text) throw needsText('x');
  return { url: link.url, platform: 'x', owner: link.owner ?? 'x', text: linkCaption(null, text), image: null };
}

async function readYoutube(link: ClassifiedLink): Promise<LinkContent> {
  const data = await oembed(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(link.url)}`);
  const title = str(data?.title);
  if (!title) throw needsText('youtube');
  const page = await safeGet(link.url);
  const description = page ? articleFromHtml(page.body, link.url).description : null;
  return {
    url: link.url,
    platform: 'youtube',
    owner: slug(str(data?.author_name) ?? 'youtube'),
    text: linkCaption(title, description),
    image: str(data?.thumbnail_url),
  };
}

async function readTiktok(link: ClassifiedLink): Promise<LinkContent> {
  const data = await oembed(`https://www.tiktok.com/oembed?url=${encodeURIComponent(link.url)}`);
  const text = str(data?.title);
  if (!text) throw needsText('tiktok');
  const owner = link.owner ?? slug(str(data?.author_unique_id) ?? 'tiktok');
  return { url: link.url, platform: 'tiktok', owner, text: linkCaption(null, text), image: str(data?.thumbnail_url) };
}

async function readSite(link: ClassifiedLink, maxChars: number): Promise<LinkContent> {
  const page = await safeGet(link.url);
  if (!page) throw needsText('site');
  const article = articleFromHtml(page.body, page.url);
  const body = article.text.length >= MIN_ARTICLE_CHARS ? article.text : null;
  if (!body) throw needsText('site');
  return {
    url: page.url,
    platform: 'site',
    owner: new URL(page.url).hostname.replace(/^www\./, '').toLowerCase(),
    text: linkCaption(article.title, body, maxChars),
    image: article.image,
  };
}

const READERS: Record<LinkPlatform, (link: ClassifiedLink, maxChars: number) => Promise<LinkContent>> = {
  instagram: readInstagram,
  x: readX,
  youtube: readYoutube,
  tiktok: readTiktok,
  site: readSite,
};

/** `pasted` é o texto que a pessoa colou depois de `link_needs_text`. */
export async function readLink(raw: string, pasted?: string | null, maxChars = MAX_LINK_TEXT_CHARS): Promise<LinkContent> {
  const link = classifyLink(raw);
  if (!link) throw new LinkError(400, 'invalid_link', 'Esse link não abre. Confira e cole de novo.');
  const text = pasted?.trim();
  if (text) {
    const host = new URL(link.url).hostname.replace(/^www\./, '').toLowerCase();
    return {
      url: link.url,
      platform: link.platform,
      owner: link.owner ?? (link.platform === 'site' ? host : link.platform),
      text: text.slice(0, MAX_LINK_TEXT_CHARS),
      image: null,
    };
  }
  return await READERS[link.platform](link, maxChars);
}
