// _shared/stt.ts — palavras com tempo a partir da saída de um modelo STT do
// catálogo (capability `stt`, ex.: elevenlabs/scribe-v2 no Replicate).
//
// TODO: o schema de saída do scribe-v2 no Replicate não foi baixado
// (docs/catalogo-replicate.md). O parser aceita as formas comuns e devolve []
// para o resto — quem chama cai no Scribe v2 direto do ElevenLabs.

export type SttWord = { text: string; start: number; end: number };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function fromWordList(list: unknown[]): SttWord[] {
  const out: SttWord[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const w = raw as Record<string, unknown>;
    // ElevenLabs marca espaço e evento de áudio com `type`; só palavra entra
    if (typeof w.type === 'string' && w.type !== 'word') continue;
    const text = typeof w.text === 'string' ? w.text : typeof w.word === 'string' ? w.word : '';
    let start = num(w.start);
    let end = num(w.end);
    if ((start == null || end == null) && Array.isArray(w.timestamp)) {
      start = num(w.timestamp[0]);
      end = num(w.timestamp[1]);
    }
    if (!text.trim() || start == null || end == null) continue;
    out.push({ text: text.trim(), start, end: Math.max(start, end) });
  }
  return out;
}

/**
 * Formas aceitas: `{words:[{text|word,start,end,type?}]}`,
 * `{segments:[{words:[…]}]}`, `{chunks:[{text,timestamp:[s,e]}]}`, a lista
 * direto, ou tudo isso como string JSON.
 */
export function parseSttOutput(output: unknown): SttWord[] {
  if (typeof output === 'string') {
    const t = output.trim();
    if (!t.startsWith('{') && !t.startsWith('[')) return [];
    try {
      return parseSttOutput(JSON.parse(t));
    } catch {
      return [];
    }
  }
  if (Array.isArray(output)) {
    const direct = fromWordList(output);
    if (direct.length) return direct;
    return output.flatMap((seg) => parseSttOutput(seg));
  }
  if (!output || typeof output !== 'object') return [];
  const o = output as Record<string, unknown>;
  if (Array.isArray(o.words)) {
    const words = fromWordList(o.words);
    if (words.length) return words;
  }
  if (Array.isArray(o.segments)) return o.segments.flatMap((seg) => parseSttOutput(seg));
  if (Array.isArray(o.chunks)) return fromWordList(o.chunks);
  if (o.output !== undefined) return parseSttOutput(o.output);
  return [];
}
