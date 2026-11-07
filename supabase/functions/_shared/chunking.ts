// _shared/chunking.ts — limpeza + chunking do pipeline de ingestão RAG.
// Fonte: docs/06-arquitetura-ia.md §5.1 — janelas de ~800-1200 chars com
// overlap de ~150, quebrando preferencialmente em parágrafo/sentença;
// kinds 'case' e 'offer' são curtos e viram 1 chunk.

export interface ChunkingOptions {
  /** Tamanho mínimo antes de procurar ponto de quebra (default 800). */
  minSize?: number;
  /** Tamanho máximo de um chunk (default 1200). */
  maxSize?: number;
  /** Overlap aproximado entre chunks consecutivos (default 150). */
  overlap?: number;
}

const DEFAULTS: Required<ChunkingOptions> = { minSize: 800, maxSize: 1200, overlap: 150 };

/** Kinds curtos que preservam o item inteiro em 1 chunk (metadata fica intacta). */
const SINGLE_CHUNK_KINDS = new Set(['case', 'offer']);

/** Entidades HTML nomeadas comuns, incluindo os acentos usados em pt-BR. */
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  aacute: 'á', agrave: 'à', acirc: 'â', atilde: 'ã', auml: 'ä',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
  iacute: 'í', igrave: 'ì', icirc: 'î', iuml: 'ï',
  oacute: 'ó', ograve: 'ò', ocirc: 'ô', otilde: 'õ', ouml: 'ö',
  uacute: 'ú', ugrave: 'ù', ucirc: 'û', uuml: 'ü',
  ccedil: 'ç', ntilde: 'ñ',
  hellip: '…', mdash: '—', ndash: '–',
  ldquo: '"', rdquo: '"', lsquo: "'", rsquo: "'",
};

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return ' ';
  try {
    return String.fromCodePoint(code);
  } catch (_err) {
    return ' ';
  }
}

/**
 * Limpeza de texto: strip de HTML/boilerplate, decodificação de entidades
 * comuns, remoção de timestamps de transcrição (SRT/VTT) e normalização
 * de whitespace.
 */
export function cleanText(raw: string): string {
  let text = raw ?? '';

  // Strip de HTML apenas quando o conteúdo parece HTML.
  if (/<[a-z][\s\S]*?>/i.test(text)) {
    text = text
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|ul|ol|tr|table|section|article|blockquote|pre)>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ');
  }

  // Entidades HTML: numéricas (decimal/hex) + nomeadas comuns (incl. acentos pt-BR).
  text = text
    .replace(/&#(\d+);/g, (_m, n: string) => safeCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => safeCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);

  // Boilerplate de transcrição: cabeçalho WEBVTT, ranges SRT/VTT
  // (00:00:12,000 --> 00:00:15,000) e timestamps inline tipo [12:34].
  text = text
    .replace(/^WEBVTT[^\n]*\n?/i, '')
    .replace(
      /\[?\b\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?\]?\s*-->\s*\[?\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?\]?/g,
      ' ',
    )
    .replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, ' ')
    .replace(/\(\d{1,2}:\d{2}(?::\d{2})?\)/g, ' ');

  // Normalização de whitespace.
  text = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

/**
 * Chunking com janela ~minSize..maxSize e overlap, preferindo quebras em
 * fronteira de parágrafo, depois sentença, depois palavra.
 * `kind` = context_kind do item; 'case'/'offer' retornam 1 chunk.
 */
export function chunkText(text: string, kind?: string, options?: ChunkingOptions): string[] {
  const { minSize, maxSize, overlap } = { ...DEFAULTS, ...options };
  const clean = (text ?? '').trim();
  if (!clean) return [];
  if (kind && SINGLE_CHUNK_KINDS.has(kind)) return [clean];
  if (clean.length <= maxSize) return [clean];

  const chunks: string[] = [];
  let start = 0;

  while (start < clean.length) {
    let end = Math.min(start + maxSize, clean.length);

    if (end < clean.length) {
      end = findBreak(clean, start + minSize, end);
    }

    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;

    // Overlap: recua ~overlap chars e alinha o início na próxima fronteira
    // de palavra para não começar chunk no meio de uma palavra.
    let next = Math.max(end - overlap, start + 1);
    const wordBoundary = clean.indexOf(' ', next);
    if (wordBoundary !== -1 && wordBoundary < end) next = wordBoundary + 1;
    start = next;
  }

  return chunks;
}

/**
 * Encontra o melhor ponto de quebra em [minPos, maxPos):
 * parágrafo ('\n\n') > fim de sentença > quebra de linha > espaço > corte duro.
 */
function findBreak(text: string, minPos: number, maxPos: number): number {
  const window = text.slice(minPos, maxPos);

  const paragraph = window.lastIndexOf('\n\n');
  if (paragraph !== -1) return minPos + paragraph;

  const sentenceEnd = lastSentenceEnd(window);
  if (sentenceEnd !== -1) return minPos + sentenceEnd;

  const newline = window.lastIndexOf('\n');
  if (newline !== -1) return minPos + newline;

  const space = window.lastIndexOf(' ');
  if (space !== -1) return minPos + space;

  return maxPos;
}

/** Índice logo após o último fim de sentença (. ! ? …, com fecho opcional) dentro de `window`; -1 se não houver. */
function lastSentenceEnd(window: string): number {
  const re = /[.!?…]["')\]]?(?=\s)/g;
  let last = -1;
  let match: RegExpExecArray | null;
  while ((match = re.exec(window)) !== null) {
    last = match.index + match[0].length;
  }
  return last;
}
