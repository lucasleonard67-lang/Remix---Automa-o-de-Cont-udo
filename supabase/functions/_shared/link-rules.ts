// _shared/link-rules.ts — regras puras do leitor de links do Radar (sem rede e
// sem Deno, testadas no vitest em src/lib/link-rules.test.ts). Desenho em
// docs/contexto (aba Link).

import { htmlToText } from './html-texto.ts';

export type LinkPlatform = 'instagram' | 'x' | 'youtube' | 'tiktok' | 'site';

export interface ClassifiedLink {
  url: string;
  platform: LinkPlatform;
  /** Autor quando o próprio endereço diz. */
  owner: string | null;
}

export interface Article {
  title: string | null;
  description: string | null;
  image: string | null;
  text: string;
}

/** Abaixo disso a página não tem texto de verdade (login, app, bloqueio). */
export const MIN_ARTICLE_CHARS = 200;
export const MAX_LINK_TEXT_CHARS = 3000;

function octets(host: string): number[] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return m ? m.slice(1).map(Number) : null;
}

/** Endereço que só existe dentro da rede: o servidor nunca busca isso. */
export function isPrivateAddress(raw: string): boolean {
  const host = raw.toLowerCase().replace(/^\[|\]$/g, '');
  if (host.includes(':')) {
    if (host === '::' || host === '::1') return true;
    if (/^f[cd]/.test(host) || /^fe[89ab]/.test(host)) return true;
    const mapped = host.match(/^::ffff:(.+)$/);
    // ::/96 (compatível com IPv4) nunca é destino público
    if (!mapped) return host.startsWith('::');
    if (mapped[1].includes('.')) return isPrivateAddress(mapped[1]);
    const hex = mapped[1].match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (!hex) return true;
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    return isPrivateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  const ip = octets(host);
  if (!ip) return false;
  const [a, b] = ip;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** Só http(s), porta padrão, com domínio público. */
export function isPublicUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password || url.port) return false;
  // "localhost." e "x.local." são o mesmo nome sem o ponto final
  const host = url.hostname.toLowerCase().replace(/\.+$/, '');
  if (isPrivateAddress(host)) return false;
  if (host.startsWith('[') || octets(host)) return true;
  return (
    host.includes('.') &&
    !/\.(local|localhost|internal|intranet|lan|home|corp)$/.test(host) &&
    !host.endsWith('.supabase.co')
  );
}

const bare = (host: string) => host.toLowerCase().replace(/^(www|m|mobile|vm)\./, '');

/** Reconhece a origem do link. Sem esquema, assume https. null = não é um link. */
export function classifyLink(raw: string): ClassifiedLink | null {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  if (!isPublicUrl(candidate)) return null;

  const url = new URL(candidate);
  url.hash = '';
  const host = bare(url.hostname);
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'instagram.com') {
    const kinds = ['p', 'reel', 'reels', 'tv'];
    const at = parts.findIndex((part) => kinds.includes(part));
    if (at === -1 || !parts[at + 1]) return { url: url.toString(), platform: 'site', owner: null };
    return {
      url: `https://www.instagram.com/${parts[at]}/${parts[at + 1]}/`,
      platform: 'instagram',
      owner: at === 1 ? parts[0].toLowerCase() : null,
    };
  }
  if ((host === 'x.com' || host === 'twitter.com') && parts[1] === 'status' && parts[2]) {
    return {
      url: `https://x.com/${parts[0]}/status/${parts[2]}`,
      platform: 'x',
      owner: parts[0].toLowerCase(),
    };
  }
  if (host === 'youtube.com' || host === 'youtu.be') {
    const id =
      host === 'youtu.be'
        ? parts[0]
        : url.searchParams.get('v') ?? (['shorts', 'live'].includes(parts[0]) ? parts[1] : null);
    if (id) return { url: `https://www.youtube.com/watch?v=${id}`, platform: 'youtube', owner: null };
  }
  if (host === 'tiktok.com') {
    const owner = parts[0]?.startsWith('@') ? parts[0].slice(1).toLowerCase() : null;
    url.search = '';
    return { url: url.toString(), platform: 'tiktok', owner };
  }
  return { url: url.toString(), platform: 'site', owner: null };
}

function metaContent(html: string, names: string[]): string | null {
  for (const tag of html.match(/<meta\s[^>]*>/gi) ?? []) {
    const name = tag.match(/\s(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (!name || !names.includes(name)) continue;
    const content = tag.match(/\scontent\s*=\s*"([^"]*)"/i)?.[1] ?? tag.match(/\scontent\s*=\s*'([^']*)'/i)?.[1];
    const text = content ? htmlToText(content).trim() : '';
    if (text) return text;
  }
  return null;
}

function mainBlock(html: string): string {
  const clean = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const longest = (tag: string) =>
    [...clean.matchAll(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'))]
      .map((m) => m[0])
      .sort((a, b) => b.length - a.length)[0];
  return longest('article') ?? longest('main') ?? clean.match(/<body\b[\s\S]*/i)?.[0] ?? clean;
}

/** Título, resumo, imagem e texto principal de uma página. */
export function articleFromHtml(html: string, baseUrl: string): Article {
  const title =
    metaContent(html, ['og:title', 'twitter:title']) ??
    htmlToText(html.match(/<title[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? '') ??
    null;
  const rawImage = metaContent(html, ['og:image', 'twitter:image']);
  let image: string | null = null;
  if (rawImage) {
    try {
      const absolute = new URL(rawImage, baseUrl).toString();
      image = isPublicUrl(absolute) ? absolute : null;
    } catch {
      image = null;
    }
  }
  return {
    title: title || null,
    description: metaContent(html, ['og:description', 'description', 'twitter:description']),
    image,
    text: htmlToText(mainBlock(html)),
  };
}

/** Tira o rodapé que o feed do Reddit cola em todo post. */
export function feedBody(text: string | null): string | null {
  const body = (text ?? '').replace(/\s*submitted by\s+\/u\/\S+[\s\S]*$/i, '').trim();
  return body || null;
}

/** Texto do post no HTML que o oEmbed do X devolve. */
export function xPostText(html: string): string {
  const paragraph = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '';
  return htmlToText(paragraph).replace(/\s*(?:https?:\/\/)?pic\.(?:twitter|x)\.com\/\S+/g, '').trim();
}

/** Junta título e corpo sem repetir, no tamanho que cabe no briefing. */
export function linkCaption(title: string | null, body: string | null, maxChars = MAX_LINK_TEXT_CHARS): string {
  const head = (title ?? '').trim();
  const rest = (body ?? '').trim();
  const text = head && rest && !rest.toLowerCase().startsWith(head.toLowerCase()) ? `${head}\n\n${rest}` : rest || head;
  return text.slice(0, maxChars).trim();
}
