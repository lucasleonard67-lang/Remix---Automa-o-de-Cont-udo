// ---------------------------------------------------------------------------
// Regras puras do layout editorial (docs/carrossel-editorial.md) para a peça
// que NÃO passou pelo escritor editorial: o adapter determinístico só entrega
// `text`, então a virada da capa e o número-chave do miolo saem daqui. E quais
// slides levam foto, para não pagar imagem que a arte não mostra.
// ---------------------------------------------------------------------------

const MONEY_OR_PERCENT =
  /R\$\s?\d[\d.,]*(?:\s(?:milhões|milhão|bilhões|bilhão|mil)(?![a-zà-ÿ]))?|\d[\d.,]*\s?%/;
const COUNT_WITH_UNIT = /\d[\d.,]*\s(?:milhões|milhão|bilhões|bilhão|mil)(?![a-zà-ÿ])/;
const THOUSANDS = /\d{1,3}(?:\.\d{3})+/;

/**
 * Negrito no número que importa: dinheiro ou %, depois contagem por extenso,
 * depois milhar. Ano, hora e número solto não são número-chave. Só um por
 * texto, e texto que já tem marcação fica como está.
 */
export function boldKeyNumber(text: string): string {
  if (text.includes("**")) return text;
  const found = [MONEY_OR_PERCENT, COUNT_WITH_UNIT, THOUSANDS]
    .map((re) => re.exec(text))
    .find(Boolean);
  if (!found) return text;
  const value = found[0].replace(/[.,]+$/, "");
  return `${text.slice(0, found.index)}**${value}**${text.slice(found.index + value.length)}`;
}

// Um [VERIFICAR: …] é uma peça só: pendência cortada no meio sumiria da arte.
const OUTSIDE_FLAG = "(?![^\\[]*\\])";
const SENTENCE_END = new RegExp(`(?<=[.!?…])\\s+${OUTSIDE_FLAG}`);

export function splitSentences(text: string): string[] {
  return text.split(SENTENCE_END).filter(Boolean);
}

/** Pausa em que uma frase única se divide em situação + virada. */
const PAUSE = new RegExp(`[,:;]\\s+${OUTSIDE_FLAG}|\\s[—–]\\s+${OUTSIDE_FLAG}`, "g");
const PAUSE_MIN = 18;

/**
 * Capa sem marcação: fica com as DUAS primeiras frases (a capa é manchete, não
 * resumo; a chamada e o resto do texto vivem no miolo) e a virada vai em
 * negrito: a frase com número, senão a segunda. Numa frase só, a virada é o
 * trecho depois da última pausa; sem pausa, o número-chave.
 */
export function coverHeadline(text: string): string {
  if (text.includes("**")) return text;
  const frases = splitSentences(text).slice(0, 2);
  if (frases.length >= 2) {
    const comNumero = frases.findIndex((f) => /\d/.test(f));
    const forte = comNumero >= 0 ? comNumero : 1;
    return frases.map((f, i) => (i === forte ? `**${f}**` : f)).join(" ");
  }
  const frase = frases[0] ?? text;
  let corte = -1;
  for (const m of frase.matchAll(PAUSE)) {
    if (m.index >= PAUSE_MIN) corte = m.index + m[0].length;
  }
  if (corte < 0 || corte >= frase.length) return boldKeyNumber(frase);
  return `${frase.slice(0, corte)}**${frase.slice(corte)}**`;
}

interface PhotoSlide {
  index: number;
  visual?: string;
  photo_promoted?: boolean;
}

/**
 * Quais slides pedem foto. O escritor editorial já decidiu (`visual`), e foto
 * em slide `none` ou de gráfico nunca apareceria na arte. Peça do adapter não
 * tem essa decisão: capa + até 3 do miolo, nunca dois seguidos nem o último.
 */
export function editorialPhotoIndexes(slides: PhotoSlide[]): number[] {
  const ordered = [...slides].sort((a, b) => a.index - b.index);
  const [capa] = ordered;
  if (!capa) return [];
  if (ordered.some((s) => s.visual !== undefined)) {
    const miolo = ordered.slice(1).filter((s) => s.visual === "photo" || s.photo_promoted === true);
    return [capa.index, ...miolo.map((s) => s.index)];
  }
  const picks = [capa.index];
  for (let i = 2; i < ordered.length - 1 && picks.length < 4; i += 2) picks.push(ordered[i].index);
  return picks;
}
