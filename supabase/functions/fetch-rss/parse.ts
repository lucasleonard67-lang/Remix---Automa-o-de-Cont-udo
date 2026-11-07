// fetch-rss/parse.ts — parser RSS 2.0 / Atom / RDF sem dependências e sem
// APIs do Deno (só string + TextDecoder), para rodar igual na edge e num
// script local de teste.
//
// O que o parser antigo errava e aqui está coberto:
// - tags com namespace (`<content:encoded>`, `<dc:date>`, `<media:title>`):
//   `<title[^>]*>` casava `<media:title>` e `<link[^>]*href` casava `<atom:link>`
//   do canal, então o item saía sem link e era descartado em silêncio;
// - CDATA aninhado em HTML, entidades duplas, `<link>` vazio do Atom;
// - XML em ISO-8859-1 declarado só no prólogo (decodeFeedBody);
// - `<item>` dentro de `<channel>` com comentários/`<![CDATA[` contendo `</item>`.

import { decodeXmlEntities, htmlToText } from '../_shared/html-texto.ts';
export { decodeXmlEntities, htmlToText };

export const MAX_ITEMS_PER_FEED = 40;

export type FeedItem = {
  guid: string;
  title: string;
  link: string;
  description: string | null;
  published_at: string | null;
  /** Miniatura e views, quando o feed traz (YouTube, Reddit). */
  image?: string | null;
  views?: number | null;
};

export type ParsedFeed = {
  kind: 'rss' | 'atom' | 'rdf';
  title: string | null;
  items: FeedItem[];
};

// Entidades e HTML → texto moram em _shared/html-texto.ts (reexportados aqui).

// ── Leitura de tags ──────────────────────────────────────────────────────────

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Conteúdo da primeira tag `<name>` (sem prefixo de namespace). `<title` NÃO
 * casa `<media:title>` nem `<titles>`: o nome vem precedido de `<` e seguido de
 * espaço, `>` ou `/`.
 */
function pickTag(xml: string, name: string): string | null {
  const n = escapeRe(name);
  const re = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${n}\\s*>`, 'i');
  const m = xml.match(re);
  if (!m) return null;
  const text = decodeXmlEntities(m[1]).trim();
  return text.length > 0 ? text : null;
}

/** Igual a pickTag, mas aceita a tag com qualquer prefixo (`content:encoded`, `dc:date`). */
function pickNs(xml: string, local: string): string | null {
  const n = escapeRe(local);
  const re = new RegExp(`<(?:[\\w-]+:)?${n}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${n}\\s*>`, 'i');
  const m = xml.match(re);
  if (!m) return null;
  const text = decodeXmlEntities(m[1]).trim();
  return text.length > 0 ? text : null;
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? decodeXmlEntities(m[1]).trim() || null : null;
}

/** Link do item: RSS `<link>texto</link>`; Atom `<link rel="alternate" href>`; RDF `rdf:about`. */
function pickLink(block: string): string | null {
  // 1) `<link>` sem prefixo com texto (RSS 2.0). Ignora `<atom:link rel="self">`.
  const plain = block.match(/<link(?:\s[^>]*)?>([\s\S]*?)<\/link\s*>/i);
  if (plain) {
    const text = decodeXmlEntities(plain[1]).trim();
    if (/^https?:\/\//i.test(text)) return text;
  }
  // 2) Atom: prefere rel="alternate" (ou sem rel); nunca rel="self"/"enclosure".
  const links = block.match(/<link(?:\s[^>]*)?\/?>/gi) ?? [];
  let fallback: string | null = null;
  for (const tag of links) {
    const href = attr(tag, 'href');
    if (!href || !/^https?:\/\//i.test(href)) continue;
    const rel = (attr(tag, 'rel') ?? 'alternate').toLowerCase();
    if (rel === 'alternate') return href;
    if (rel !== 'self' && rel !== 'enclosure' && rel !== 'replies' && !fallback) fallback = href;
  }
  if (fallback) return fallback;
  // 3) RDF: `<item rdf:about="...">`
  const about = block.match(/^<item[^>]*\srdf:about\s*=\s*["']([^"']+)["']/i);
  return about ? about[1] : null;
}

function parseDate(raw: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw.trim());
  if (Number.isNaN(d.getTime())) return null;
  // Datas no futuro distante ou antes de 2000 são lixo de feed, não notícia.
  const t = d.getTime();
  if (t > Date.now() + 36 * 3600_000 || t < Date.UTC(2000, 0, 1)) return null;
  return d.toISOString();
}

function mediaThumbnail(block: string): string | null {
  const tag = block.match(/<media:thumbnail\s[^>]*>/i)?.[0];
  return tag ? attr(tag, 'url') : null;
}

function mediaViews(block: string): number | null {
  const tag = block.match(/<media:statistics\s[^>]*>/i)?.[0];
  const views = tag ? Number(attr(tag, 'views')) : Number.NaN;
  return Number.isFinite(views) ? views : null;
}

// ── Blocos de item ───────────────────────────────────────────────────────────

/**
 * Separa os blocos `<item>…</item>` (ou `<entry>`) respeitando CDATA: um
 * `</item>` dentro de `<![CDATA[ … ]]>` não fecha o bloco.
 */
function splitBlocks(xml: string, tag: 'item' | 'entry'): string[] {
  const blocks: string[] = [];
  const open = new RegExp(`<${tag}(?=[\\s>])`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = open.exec(xml)) !== null) {
    const start = m.index;
    let pos = start;
    let end = -1;
    for (;;) {
      const cdata = xml.indexOf('<![CDATA[', pos);
      const close = xml.indexOf(`</${tag}`, pos);
      if (close === -1) break;
      if (cdata !== -1 && cdata < close) {
        const cdataEnd = xml.indexOf(']]>', cdata + 9);
        if (cdataEnd === -1) break;
        pos = cdataEnd + 3;
        continue;
      }
      end = xml.indexOf('>', close);
      break;
    }
    if (end === -1) break;
    blocks.push(xml.slice(start, end + 1));
    open.lastIndex = end + 1;
    if (blocks.length >= MAX_ITEMS_PER_FEED) break;
  }
  return blocks;
}

function stripChannelHead(xml: string): string {
  // Remove `<image>…</image>` do canal: tem <title>/<link> próprios e, em
  // feeds sem <item> bem formado, contaminava o primeiro bloco.
  return xml.replace(/<image(?:\s[^>]*)?>[\s\S]*?<\/image>/i, '');
}

// ── Entrada pública ──────────────────────────────────────────────────────────

export function parseFeed(xmlRaw: string): ParsedFeed {
  // BOM e lixo antes do prólogo (página de erro com XML embutido não passa).
  const xml = stripChannelHead(xmlRaw.replace(/^\uFEFF/, '').trimStart());

  const kind: ParsedFeed['kind'] = /<feed[\s>]/i.test(xml.slice(0, 4000))
    ? 'atom'
    : /<rdf:RDF[\s>]/i.test(xml.slice(0, 4000))
      ? 'rdf'
      : 'rss';

  const blocks = kind === 'atom' ? splitBlocks(xml, 'entry') : splitBlocks(xml, 'item');
  const channelTitle = pickTag(xml.slice(0, 20_000), 'title');

  const items: FeedItem[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    const title = htmlToText(pickTag(block, 'title') ?? '').replace(/\s+/g, ' ').trim();
    const link = pickLink(block) ?? '';
    if (!title || !link) continue;

    const guid = (pickTag(block, 'guid') ?? pickTag(block, 'id') ?? link).slice(0, 1000);
    if (seen.has(guid)) continue;
    seen.add(guid);

    const rawDesc =
      pickNs(block, 'encoded') ??
      pickTag(block, 'description') ??
      pickTag(block, 'summary') ??
      pickTag(block, 'content') ??
      pickNs(block, 'subtitle') ??
      pickNs(block, 'description');
    let description = rawDesc ? htmlToText(rawDesc) : '';
    // G1 e afins repetem o título no começo do HTML da descrição.
    if (description.toLowerCase().startsWith(title.toLowerCase())) {
      description = description.slice(title.length).replace(/^[\s:–—-]+/, '').trim();
    }

    const published_at = parseDate(
      pickTag(block, 'pubDate') ??
        pickTag(block, 'published') ??
        pickTag(block, 'updated') ??
        pickNs(block, 'date') ??
        pickTag(block, 'lastBuildDate'),
    );

    items.push({
      guid,
      title: title.slice(0, 500),
      link: link.slice(0, 1000),
      description: description ? description.slice(0, 5000) : null,
      published_at,
      image: mediaThumbnail(block),
      views: mediaViews(block),
    });
  }

  return { kind, title: channelTitle, items };
}

// ── Decodificação do corpo ───────────────────────────────────────────────────

/**
 * Decodifica os bytes do feed respeitando o charset do header HTTP ou do
 * prólogo XML. Globo/UOL servem UTF-8, mas muito portal regional ainda manda
 * ISO-8859-1 e aparecia como "Ã§Ã£o".
 */
export function decodeFeedBody(bytes: Uint8Array, contentType: string | null): string {
  const fromHeader = contentType?.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] ?? null;
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 512));
  const fromProlog = head.match(/<\?xml[^>]*encoding\s*=\s*["']([\w-]+)["']/i)?.[1] ?? null;
  const label = normalizeCharset(fromProlog ?? fromHeader ?? 'utf-8');
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function normalizeCharset(label: string): string {
  const l = label.toLowerCase();
  if (l === 'utf8') return 'utf-8';
  if (l === 'latin1' || l === 'iso8859-1' || l === 'iso_8859-1') return 'iso-8859-1';
  return l;
}

/** Heurística barata: isto parece um feed ou é uma página HTML/erro? */
export function looksLikeFeed(xml: string): boolean {
  const head = xml.slice(0, 6000);
  return /<(rss|feed|rdf:RDF)[\s>]/i.test(head) && !/<html[\s>]/i.test(head.slice(0, 600));
}
