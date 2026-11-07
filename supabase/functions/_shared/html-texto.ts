// _shared/html-texto.ts — entidades HTML/XML e HTML → texto, sem dependências.
// Mora em _shared porque o empacotador do deploy não resolve import de
// _shared para dentro da pasta de outra função (link-rules importava de
// fetch-rss/parse.ts e quatro funções não subiam). fetch-rss/parse.ts reexporta.

// ── Entidades ────────────────────────────────────────────────────────────────

const ENTIDADES_HTML: Record<string, string> = {
  nbsp: ' ', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  hellip: '…', ndash: '–', mdash: '—', laquo: '«', raquo: '»',
  bull: '•', deg: '°', euro: '€', copy: '©', reg: '®',
  trade: '™', middot: '·',
  aacute: 'á', agrave: 'à', acirc: 'â', atilde: 'ã', auml: 'ä',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
  iacute: 'í', icirc: 'î', iuml: 'ï',
  oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö',
  uacute: 'ú', ucirc: 'û', uuml: 'ü',
  ccedil: 'ç', ntilde: 'ñ',
  Aacute: 'Á', Agrave: 'À', Acirc: 'Â', Atilde: 'Ã',
  Eacute: 'É', Ecirc: 'Ê', Iacute: 'Í',
  Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ',
  Uacute: 'Ú', Ccedil: 'Ç',
};

export function unwrapCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

export function decodeXmlEntities(s: string): string {
  // Duas passadas: feed republicado vem duplamente codificado (`&amp;ccedil;`).
  const passada = (t: string) =>
    t
      .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => safeCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_m, n) => safeCodePoint(Number(n)))
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&([a-zA-Z]+);/g, (m, nome) => ENTIDADES_HTML[nome] ?? m)
      .replace(/&amp;/g, '&');
  return passada(passada(unwrapCdata(s)));
}

function safeCodePoint(n: number): string {
  if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return '';
  try {
    return String.fromCodePoint(n);
  } catch {
    return '';
  }
}

/** Tira tags e espaços duplicados de um fragmento HTML (resumo da notícia). */
export function htmlToText(html: string): string {
  return decodeXmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}
