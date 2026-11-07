// video-edit — núcleo puro do "Aprimorar com IA" (contrato: docs/hub-motor-contratos.md §11).
// O Claude escolhe operações deste menu; aqui elas são validadas e compiladas,
// de forma determinística, num filtro ffmpeg. Nada de shell vindo do modelo:
// todo número é limitado e todo texto passa por escape antes de entrar no filtro.

import { factIsGrounded, wordSpan, type Attachment, type Source } from './video-motion.ts';

export type Word = { text: string; start: number; end: number; brk?: boolean };

/** Trecho marcado por palavras; o compilador acha o tempo final depois dos cortes. */
type Span = { word_from: number; word_to: number };
export type SplitItem = Span & { attachment_index: number; side: 'top' | 'bottom' };
export type ImageItem = Span & { attachment_index: number; position: 'top' | 'middle' | 'bottom' | 'full' };
export type FactItem = Span & { value: string; label: string; source: string; position: 'top' | 'middle' | 'bottom' };
export type TitleItem = Span & { text: string; position: 'top' | 'middle' | 'bottom' };

export type Op =
  | { type: 'trim_silences'; pad_ms?: number; min_gap_ms?: number }
  | { type: 'cut_words'; word_idxs: number[]; reason?: string }
  | { type: 'hook_first'; word_from: number; word_to: number }
  | { type: 'punch_in'; zoom?: number }
  | { type: 'speed'; ranges: { word_from: number; word_to: number; factor: number }[] }
  | { type: 'captions'; style?: string; position?: string }
  | { type: 'voice_clean' }
  | { type: 'music_duck'; volume_db?: number }
  | { type: 'loudness' }
  | { type: 'brand_intro'; seconds?: number }
  | { type: 'brand_watermark'; corner?: 'tr' | 'tl' | 'br' | 'bl'; opacity?: number }
  | { type: 'brand_outro'; seconds?: number; cta?: string }
  | { type: 'lower_third'; name: string; role?: string; at_s?: number }
  | { type: 'color'; preset: 'neutral' | 'warm' | 'cool' | 'punch' }
  | { type: 'split_screen'; items: SplitItem[] }
  | { type: 'image_overlay'; items: ImageItem[] }
  | { type: 'fact_card'; items: FactItem[] }
  | { type: 'title'; items: TitleItem[] };

export const OP_TYPES = [
  'trim_silences', 'cut_words', 'hook_first', 'punch_in', 'speed', 'captions', 'voice_clean',
  'music_duck', 'loudness', 'brand_intro', 'brand_watermark', 'brand_outro', 'lower_third', 'color',
  'split_screen', 'image_overlay', 'fact_card', 'title',
] as const;

export const SUGGESTION_IDS = ['clean', 'tight', 'hook', 'brand', 'sound', 'surprise'] as const;
export const MAX_SUGGESTIONS = 4;
export const HOOK_MAX_S = 4;
/** Fora desta faixa a fala e a boca degradam (docs/editor-por-prompt/motores-de-controle.md). */
export const SPEED_MIN = 0.85;
export const SPEED_MAX = 1.25;
const XFADE_S = 0.01;
/** O filtro vai num argumento só; o Linux limita cada um a 128 KB (~350 caracteres por trecho). */
const MAX_SEGMENTS = 300;
const DUCK_TERMS = 80;
export const W = 1080;
export const H = 1920;

/** Efeitos marcados na fala: o plano pode trazer vários, cada um no seu momento. */
export const ITEM_OPS = ['split_screen', 'image_overlay', 'fact_card', 'title'] as const;
type ItemOp = Extract<Op, { type: (typeof ITEM_OPS)[number] }>;
export const isItemOp = (o: Op): o is ItemOp => (ITEM_OPS as readonly string[]).includes(o.type);

/** Junta os itens na op do mesmo tipo: o compilador usa uma de cada. */
export function addItems(ops: Op[], op: ItemOp) {
  const same = ops.find((o) => o.type === op.type) as ItemOp | undefined;
  if (same) (same.items as unknown[]).push(...op.items);
  else ops.push(op);
}

const clamp = (n: unknown, lo: number, hi: number, dflt: number) => {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : dflt;
  return Math.min(hi, Math.max(lo, v));
};
const isIdx = (n: unknown, len: number): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < len;
const cleanText = (t: unknown, max: number) =>
  // eslint-disable-next-line no-control-regex -- tira caracteres de controle do texto que vai para o vídeo
  String(t ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

const list = (v: unknown) => (Array.isArray(v) ? v : []) as Record<string, unknown>[];
const spanOf = (it: Record<string, unknown>, n: number): Span | null =>
  isIdx(it.word_from, n) && isIdx(it.word_to, n) && (it.word_to as number) >= (it.word_from as number)
    ? { word_from: it.word_from as number, word_to: it.word_to as number } : null;
const hostOf = (s: Source) => {
  try {
    return new URL(s.url).hostname.replace(/^www\./, '').slice(0, 70);
  } catch {
    return cleanText(s.title, 70);
  }
};

export type Brand = {
  logo: boolean;          // há logo (com alfa) disponível como entrada 1
  primary: string;        // #RRGGBB
  accent?: string;        // #RRGGBB
  handle?: string | null; // @perfil
  font?: string | null;   // família da fonte de título (ASS); null = Montserrat ExtraBold, a que vai para o sandbox
};

export type EditContext = {
  words: Word[];
  duration: number;       // duração do original (s)
  hasAudio?: boolean;     // false = vídeo mudo (o compilador gera silêncio)
  hasMusic: boolean;      // há trilha separada para mixar
  captionsBurned: boolean;// o original já tem legenda queimada
  brand: Brand;
  attachments?: Attachment[];
  sources?: Source[];
};

/**
 * Valida e normaliza as ops vindas do Claude ou da tela. Devolve as ops
 * aplicáveis (com limites aplicados) e a frase do primeiro problema, se houver.
 * Ops inválidas NUNCA passam: o compilador só vê o que sai daqui.
 */
export function normalizeOps(raw: unknown, ctx: EditContext): { ops: Op[]; error: string | null } {
  if (!Array.isArray(raw) || raw.length === 0) return { ops: [], error: 'Escolha ao menos uma sugestão.' };
  const n = ctx.words.length;
  const seen = new Set<string>();
  const ops: Op[] = [];
  for (const o of raw as Record<string, unknown>[]) {
    const type = String(o?.type ?? '');
    if (!(OP_TYPES as readonly string[]).includes(type)) return { ops: [], error: 'Operação inválida.' };
    if (seen.has(type) && !(ITEM_OPS as readonly string[]).includes(type)) continue; // uma de cada tipo
    seen.add(type);
    switch (type) {
      case 'trim_silences':
        if (!n) return { ops: [], error: 'Este vídeo não tem fala para cortar.' };
        ops.push({ type, pad_ms: clamp(o.pad_ms, 40, 200, 80), min_gap_ms: clamp(o.min_gap_ms, 250, 1500, 400) });
        break;
      case 'cut_words': {
        const idxs = Array.isArray(o.word_idxs) ? [...new Set(o.word_idxs.filter((i) => isIdx(i, n)))] as number[] : [];
        if (!idxs.length) continue;
        if (idxs.length > n * 0.4) return { ops: [], error: 'Operação inválida.' }; // corte demais = plano ruim
        ops.push({ type, word_idxs: idxs.sort((a, b) => a - b), reason: cleanText(o.reason, 120) });
        break;
      }
      case 'hook_first': {
        if (!isIdx(o.word_from, n) || !isIdx(o.word_to, n) || o.word_to < o.word_from) return { ops: [], error: 'Operação inválida.' };
        const len = ctx.words[o.word_to as number].end - ctx.words[o.word_from as number].start;
        if (len > HOOK_MAX_S || len <= 0) return { ops: [], error: 'Operação inválida.' };
        if (o.word_from === 0) continue; // já está na frente
        ops.push({ type, word_from: o.word_from as number, word_to: o.word_to as number });
        break;
      }
      case 'punch_in':
        ops.push({ type, zoom: clamp(o.zoom, 1.05, 1.2, 1.12) });
        break;
      case 'speed': {
        const ranges = (Array.isArray(o.ranges) ? o.ranges : [])
          .filter((r: Record<string, unknown>) => isIdx(r?.word_from, n) && isIdx(r?.word_to, n) && (r.word_to as number) >= (r.word_from as number))
          .map((r: Record<string, unknown>) => ({
            word_from: r.word_from as number, word_to: r.word_to as number, factor: clamp(r.factor, SPEED_MIN, SPEED_MAX, 1.1),
          }))
          .sort((a, b) => a.word_from - b.word_from)
          .filter((r, i, a) => i === 0 || r.word_from > a[i - 1].word_to);
        if (ranges.length) ops.push({ type, ranges });
        break;
      }
      case 'captions':
        if (ctx.captionsBurned || !n) continue;
        ops.push({ type, style: cleanText(o.style, 20) || 'caps', position: cleanText(o.position, 10) || 'bottom' });
        break;
      case 'split_screen': {
        const items = list(o.items).flatMap((it) => {
          const span = spanOf(it, n);
          const att = ctx.attachments?.[Number(it.attachment_index)];
          if (!span || !att || att.kind === 'audio') return [];
          return [{ ...span, attachment_index: Number(it.attachment_index), side: it.side === 'top' ? 'top' as const : 'bottom' as const }];
        });
        if (items.length) addItems(ops, { type, items });
        break;
      }
      case 'image_overlay': {
        const items = list(o.items).flatMap((it) => {
          const span = spanOf(it, n);
          const att = ctx.attachments?.[Number(it.attachment_index)];
          if (!span || att?.kind !== 'image') return [];
          const position = ['top', 'middle', 'bottom', 'full'].includes(String(it.position)) ? it.position as ImageItem['position'] : 'middle';
          return [{ ...span, attachment_index: Number(it.attachment_index), position }];
        });
        if (items.length) addItems(ops, { type, items });
        break;
      }
      case 'fact_card': {
        const items = list(o.items).flatMap((it) => {
          const span = spanOf(it, n);
          const value = cleanText(it.value, 24), label = cleanText(it.label, 90);
          // normalizar de novo não perde a fonte já resolvida
          const known = typeof it.source === 'string' && it.source;
          const source = ctx.sources?.[Number(it.source_index)];
          if (!span || !value || (!known && !factIsGrounded(value, label, source))) return [];
          const position = ['top', 'bottom'].includes(String(it.position)) ? it.position as FactItem['position'] : 'middle';
          return [{ ...span, value, label, position, source: known ? cleanText(it.source, 70) : hostOf(source!) }];
        });
        if (items.length) addItems(ops, { type, items });
        break;
      }
      case 'title': {
        const items = list(o.items).flatMap((it) => {
          const span = spanOf(it, n);
          const text = cleanText(it.text, 90);
          if (!span || !text) return [];
          const position = ['middle', 'bottom'].includes(String(it.position)) ? it.position as TitleItem['position'] : 'top';
          return [{ ...span, text, position }];
        });
        if (items.length) addItems(ops, { type, items });
        break;
      }
      case 'voice_clean':
      case 'loudness':
        ops.push({ type } as Op);
        break;
      case 'music_duck':
        if (!ctx.hasMusic) continue;
        ops.push({ type, volume_db: clamp(o.volume_db, -24, -12, -18) });
        break;
      case 'brand_intro':
        if (!ctx.brand.logo) continue;
        if (n && ctx.words[0].start < 2) {
          return { ops: [], error: 'A abertura com logo não entra antes de um gancho falado. Use o encerramento.' };
        }
        ops.push({ type, seconds: clamp(o.seconds, 1, 1.5, 1.2) });
        break;
      case 'brand_watermark': {
        if (!ctx.brand.logo) continue;
        const corner = ['tr', 'tl', 'br', 'bl'].includes(String(o.corner)) ? o.corner as 'tr' : 'tr';
        ops.push({ type, corner, opacity: clamp(o.opacity, 0.5, 0.85, 0.7) });
        break;
      }
      case 'brand_outro':
        if (!ctx.brand.logo) continue;
        ops.push({ type, seconds: clamp(o.seconds, 1.5, 3, 2), cta: cleanText(o.cta, 40) });
        break;
      case 'lower_third': {
        const name = cleanText(o.name, 40);
        if (!name) continue;
        ops.push({ type, name, role: cleanText(o.role, 50), at_s: clamp(o.at_s, 0, Math.max(0, ctx.duration - 3), 1) });
        break;
      }
      case 'color':
        ops.push({ type, preset: (['neutral', 'warm', 'cool', 'punch'].includes(String(o.preset)) ? o.preset : 'neutral') as 'neutral' });
        break;
    }
  }
  if (!ops.some((o) => o.type === 'loudness')) ops.push({ type: 'loudness' }); // sempre no fim (§11.4)
  return { ops, error: null };
}

// ── linha do tempo ───────────────────────────────────────────────────────────
/** Trecho do original que vai para a saída, na ordem da saída. */
export type Segment = { start: number; end: number; speed: number; hook?: boolean };

const opOf = <T extends Op['type']>(ops: Op[], t: T) => ops.find((o) => o.type === t) as Extract<Op, { type: T }> | undefined;

function subtract(keep: [number, number][], cut: [number, number]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of keep) {
    if (cut[1] <= a || cut[0] >= b) { out.push([a, b]); continue; }
    if (cut[0] > a) out.push([a, cut[0]]);
    if (cut[1] < b) out.push([cut[1], b]);
  }
  return out;
}

/**
 * Trechos mantidos, na ordem final. Respiros: só as faixas com fala (+ folga),
 * juntando lacunas menores que `min_gap_ms`. Vícios: a palavra sai inteira,
 * da metade da lacuna anterior até a metade da seguinte (sem cortar vizinhas).
 */
export function buildSegments(ops: Op[], ctx: EditContext): Segment[] {
  const { words, duration } = ctx;
  let keep: [number, number][] = [[0, duration]];

  const trim = opOf(ops, 'trim_silences');
  if (trim && words.length) {
    const pad = (trim.pad_ms ?? 80) / 1000;
    // vídeo longo com muita pausa: a lacuna mínima sobe até caber no teto de cortes
    for (let gap = (trim.min_gap_ms ?? 400) / 1000; ; gap *= 1.3) {
      const spans: [number, number][] = [];
      for (const w of words) {
        const a = Math.max(0, w.start - pad), b = Math.min(duration, w.end + pad);
        const last = spans[spans.length - 1];
        if (last && a - last[1] < gap) last[1] = Math.max(last[1], b);
        else spans.push([a, b]);
      }
      keep = spans;
      if (spans.length <= MAX_SEGMENTS) break;
    }
  }

  const cut = opOf(ops, 'cut_words');
  if (cut) {
    for (const i of cut.word_idxs) {
      const w = words[i];
      const a = i > 0 ? (words[i - 1].end + w.start) / 2 : Math.max(0, w.start - 0.05);
      const b = i < words.length - 1 ? (w.end + words[i + 1].start) / 2 : Math.min(duration, w.end + 0.05);
      keep = subtract(keep, [a, b]);
    }
  }
  keep = keep.filter(([a, b]) => b - a >= 0.12);

  // gancho: os pedaços dentro da frase vão para a frente, o resto segue em ordem
  const hook = opOf(ops, 'hook_first');
  let ordered = keep;
  let hookCount = 0;
  if (hook) {
    const ha = words[hook.word_from].start - 0.06, hb = words[hook.word_to].end + 0.06;
    const inHook: [number, number][] = [], rest: [number, number][] = [];
    for (const [a, b] of keep) {
      const ia = Math.max(a, ha), ib = Math.min(b, hb);
      if (ib - ia >= 0.12) inHook.push([ia, ib]);
      for (const piece of subtract([[a, b]], [ha, hb])) if (piece[1] - piece[0] >= 0.12) rest.push(piece);
    }
    if (inHook.length) { ordered = [...inHook, ...rest]; hookCount = inHook.length; }
  }

  // velocidade: parte os trechos nas bordas das faixas aceleradas
  const speed = opOf(ops, 'speed');
  const fast = (speed?.ranges ?? []).map((r) => ({ a: words[r.word_from].start, b: words[r.word_to].end, f: r.factor }));
  const segs: Segment[] = [];
  for (const [k, [a, b]] of ordered.entries()) {
    const hooked = k < hookCount ? { hook: true } : {};
    const cuts = [a, b, ...fast.flatMap((r) => [r.a, r.b]).filter((t) => t > a && t < b)].sort((x, y) => x - y);
    for (let i = 0; i < cuts.length - 1; i++) {
      const s = cuts[i], e = cuts[i + 1];
      if (e - s < 0.05) continue;
      const mid = (s + e) / 2;
      const f = fast.find((r) => mid >= r.a && mid <= r.b)?.f ?? 1;
      const prev = segs[segs.length - 1];
      // fragmento curto colado no anterior (borda de faixa acelerada) vira parte dele
      if (prev && e - s < 0.12 && Math.abs(prev.end - s) < 1e-6 && !prev.hook === !hooked.hook) { prev.end = r3(e); continue; }
      segs.push({ start: r3(s), end: r3(e), speed: f, ...hooked });
    }
  }
  return segs.length ? segs : [{ start: 0, end: r3(duration), speed: 1 }];
}

export const segmentsDuration = (segs: Segment[]) => segs.reduce((t, s) => t + (s.end - s.start) / s.speed, 0);

const WORD_MIN_S = 0.05;

/**
 * Tempos do STT podem vir fora de ordem, sem duração ou sobrepostos. Sai em ordem,
 * cada palavra com duração e terminando antes de a próxima começar.
 */
export function cleanWords(words: Word[]): Word[] {
  const out: Word[] = [];
  const valid = words.filter((w) => assText(String(w.text ?? '')) && Number.isFinite(w.start) && Number.isFinite(w.end));
  for (const w of [...valid].sort((a, b) => a.start - b.start)) {
    const prev = out[out.length - 1];
    const start = prev ? Math.max(w.start, prev.start + WORD_MIN_S) : Math.max(0, w.start);
    if (prev) prev.end = r3(Math.min(prev.end, start));
    out.push({ ...w, start: r3(start), end: r3(Math.max(w.end, start + WORD_MIN_S)) });
  }
  return out;
}

/** Palavras retimadas para a saída (para a legenda nova). Palavra cortada some. */
export function retimeWords(words: Word[], segs: Segment[], offset = 0): Word[] {
  const out: Word[] = [];
  const ordered = [...words].sort((a, b) => a.start - b.start);
  let t = offset;
  segs.forEach((s, i) => {
    // pulo no original (gancho, corte longo): a legenda não emenda os dois lados
    let brk = i > 0 && Math.abs(s.start - segs[i - 1].end) > 0.5;
    for (const w of ordered) {
      const mid = (w.start + w.end) / 2;
      if (mid < s.start || mid >= s.end) continue;
      out.push({
        ...(brk ? { brk: true } : {}),
        text: w.text,
        start: r3(t + (Math.max(w.start, s.start) - s.start) / s.speed),
        end: r3(t + (Math.min(w.end, s.end) - s.start) / s.speed),
      });
      brk = false;
    }
    t += (s.end - s.start) / s.speed;
  });
  return cleanWords(out);
}

/** Duração prevista da saída: QA compara com o ffprobe (±0,3 s). */
export function expectedDuration(ops: Op[], ctx: EditContext): number {
  const segs = buildSegments(ops, ctx);
  return r3(segmentsDuration(segs) + (opOf(ops, 'brand_intro')?.seconds ?? 0) + (opOf(ops, 'brand_outro')?.seconds ?? 0));
}

// ── compilador ───────────────────────────────────────────────────────────────
const COLOR: Record<string, string> = {
  neutral: 'eq=contrast=1.03:saturation=1.04',
  warm: 'eq=contrast=1.04:saturation=1.06,colorbalance=rs=0.04:bs=-0.04',
  cool: 'eq=contrast=1.04:saturation=1.03,colorbalance=rs=-0.03:bs=0.04',
  punch: 'eq=contrast=1.08:saturation=1.12',
};
const hex = (c: string) => (/^#[0-9a-fA-F]{6}$/.test(c) ? `0x${c.slice(1)}` : '0x111111');
/** Texto para evento ASS: sem tags de override nem quebras. */
export const assText = (t: string) => t.replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim();
const assT = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;
};
/** #RRGGBB → &H00BBGGRR (cor de estilo ASS) */
const assColor = (c: string) => (/^#[0-9a-fA-F]{6}$/.test(c) ? `&H00${c.slice(5, 7)}${c.slice(3, 5)}${c.slice(1, 3)}`.toUpperCase() : '&H00111111');

/**
 * Textos da marca (lower third e encerramento) em ASS, na linha do tempo da
 * SAÍDA. libass já roda no sandbox (legendas do Diretor); drawtext não é
 * garantido em toda build do ffmpeg. null = nada a escrever.
 */
const CARD_Y: Record<FactItem['position'], number> = { top: 200, middle: 760, bottom: 1120 };
const CARD_H = 370;
const assInline = (c: string) => {
  const hexa = /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#FFD400';
  return `&H${hexa.slice(5, 7)}${hexa.slice(3, 5)}${hexa.slice(1, 3)}&`.toUpperCase();
};

export function brandAss(ops: Op[], ctx: EditContext): string | null {
  const lt = opOf(ops, 'lower_third'), outro = opOf(ops, 'brand_outro');
  const intro = opOf(ops, 'brand_intro')?.seconds ?? 0;
  const ev: string[] = [];
  const segs = buildSegments(ops, ctx);
  const total0 = expectedDuration(ops, ctx);
  const at = (s: Span) => wordSpan(s.word_from, s.word_to, ctx.words, segs, intro, total0 - (outro?.seconds ?? 0));
  for (const it of opOf(ops, 'title')?.items ?? []) {
    const t = at(it);
    if (!t) continue;
    const style = it.text.length > 45 ? `TitleS${it.position}` : `Title${it.position}`;
    ev.push(`Dialogue: 1,${assT(t.start)},${assT(t.end)},${style},,0,0,0,,{\\q0\\fad(180,120)}${assText(it.text)}`);
  }
  for (const it of opOf(ops, 'fact_card')?.items ?? []) {
    const t = at(it);
    if (!t) continue;
    const y = CARD_Y[it.position];
    const accent = assInline(ctx.brand.accent ?? ctx.brand.primary);
    // o número fica em uma linha: quebrado, cairia em cima do rótulo
    const room = (W - 112 - 64) / textWidth(it.value, 96);
    const fit = room < 1 ? `\\fscx${Math.floor(room * 100)}` : '';
    ev.push(`Dialogue: 2,${assT(t.start)},${assT(t.end)},CardValue,,0,0,0,,{\\pos(112,${y + 34})\\c${accent}${fit}}${assText(it.value)}`);
    ev.push(`Dialogue: 2,${assT(t.start)},${assT(t.end)},CardLabel,,0,0,0,,{\\pos(112,${y + 158})}${assText(it.label)}`);
    ev.push(`Dialogue: 2,${assT(t.start)},${assT(t.end)},CardSource,,0,0,0,,{\\pos(112,${y + 304})}${assText(`Fonte: ${it.source}`)}`);
  }
  if (lt) {
    const a = intro + (lt.at_s ?? 1);
    ev.push(`Dialogue: 0,${assT(a)},${assT(a + 3)},LtName,,0,0,0,,${assText(lt.name)}`);
    if (lt.role) ev.push(`Dialogue: 0,${assT(a)},${assT(a + 3)},LtRole,,0,0,0,,${assText(lt.role)}`);
  }
  if (outro) {
    const total = expectedDuration(ops, ctx), a = total - (outro.seconds ?? 2);
    if (ctx.brand.handle) ev.push(`Dialogue: 0,${assT(a)},${assT(total)},Handle,,0,0,0,,${assText(ctx.brand.handle)}`);
    if (outro.cta) ev.push(`Dialogue: 0,${assT(a)},${assT(total)},Cta,,0,0,0,,${assText(outro.cta)}`);
  }
  if (!ev.length) return null;
  const f = assText(ctx.brand.font ?? '') || 'Montserrat ExtraBold';
  const st = (name: string, size: number, align: number, l: number, v: number, r = 60) =>
    `Style: ${name},${f},${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,${align},${l},${r},${v},1`;
  const title = (name: string, size: number, align: number, v: number) =>
    `Style: ${name},${f},${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,5,3,${align},64,64,${v},1`;
  return [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    st('LtName', 58, 7, 96, 1404), st('LtRole', 40, 7, 96, 1478),
    st('Handle', 54, 8, 60, 1100), st('Cta', 64, 8, 60, 1200),
    title('Titletop', 96, 8, 240), title('Titlemiddle', 96, 5, 0), title('Titlebottom', 96, 2, 560),
    title('TitleStop', 72, 8, 240), title('TitleSmiddle', 72, 5, 0), title('TitleSbottom', 72, 2, 560),
    st('CardValue', 96, 7, 112, 0, 64), st('CardLabel', 44, 7, 112, 0, 96), st('CardSource', 30, 7, 112, 0, 96), '',
    '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text', ...ev, '',
  ].join('\n');
}

/** Arquivos presentes na pasta de trabalho do sandbox (nomes fixos, sem caminho). */
export type Assets = {
  logo?: boolean; logoKey?: string | null; music?: boolean; fonts?: boolean; ass?: boolean; brandAss?: boolean;
  /** Arquivo de cada anexo usado, por índice; nomes fixos gerados pelo motor. */
  files?: Record<number, string>;
};

export type Compiled = { filter: string; inputArgs: string; seconds: number };

/**
 * Filtro completo + entradas do ffmpeg. O filtro vai por arquivo
 * (`-filter_complex "$(cat filter.txt)"`, que serve para ffmpeg 6 e 7+).
 * Logo entra como UM quadro: entrada infinita (`-loop 1`) não deixa o ffmpeg
 * terminar; o overlay repete o último quadro. O gancho entra como entrada
 * própria com `-ss`: tirá-lo da entrada 0 obrigaria o ffmpeg a guardar na
 * memória todos os quadros até chegar nele.
 */
export function compileEdit(ops: Op[], ctx: EditContext, assets: Assets): Compiled {
  const segs = buildSegments(ops, ctx);
  const punch = opOf(ops, 'punch_in');
  const seconds = expectedDuration(ops, ctx);
  const fontsdir = assets.fonts ? ':fontsdir=fonts' : '';
  const hasAudio = ctx.hasAudio !== false;
  const lines: string[] = [];
  const inputs = ['-i src.mp4'];
  const addInput = (arg: string) => inputs.push(arg) - 1;

  const hookSegs = segs.filter((s) => s.hook);
  const hookBase = hookSegs.length ? Math.max(0, Math.min(...hookSegs.map((s) => s.start)) - 0.1) : 0;
  const hookEnd = hookSegs.length ? Math.max(...hookSegs.map((s) => s.end)) + 0.1 : 0;
  const hookInput = hookSegs.length ? addInput(`-ss ${r3(hookBase)} -t ${r3(hookEnd - hookBase)} -i src.mp4`) : 0;

  const base = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30`;
  segs.forEach((s, i) => {
    const inp = s.hook ? hookInput : 0;
    const off = s.hook ? hookBase : 0;
    const from = r3(s.start - off), to = r3(s.end - off);
    const z = punch && i % 2 === 1 ? punch.zoom ?? 1.12 : 1;
    const zoom = z > 1 ? `,crop=trunc(iw/${z}/2)*2:trunc(ih/${z}/2)*2,scale=${W}:${H}` : '';
    const vs = s.speed !== 1 ? `,setpts=PTS/${s.speed}` : '';
    const as = s.speed !== 1 ? `,atempo=${s.speed}` : '';
    const len = (s.end - s.start) / s.speed;
    const fade = segs.length > 1
      ? `,afade=t=in:d=${XFADE_S},afade=t=out:st=${r3(Math.max(0, len - XFADE_S))}:d=${XFADE_S}` : '';
    lines.push(`[${inp}:v]trim=start=${from}:end=${to},setpts=PTS-STARTPTS,${base}${zoom}${vs},setsar=1[v${i}]`);
    lines.push(hasAudio
      ? `[${inp}:a]atrim=start=${from}:end=${to},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo${as}${fade}[a${i}]`
      : `anullsrc=r=48000:cl=stereo,atrim=duration=${r3(len)}[a${i}]`);
  });
  lines.push(`${segs.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${segs.length}:v=1:a=1[vc][ac]`);

  // logo: um quadro repartido entre marca d'água, abertura e encerramento
  const wm = opOf(ops, 'brand_watermark'), intro = opOf(ops, 'brand_intro'), outro = opOf(ops, 'brand_outro');
  const wmOn = !!wm && !!assets.logo, introOn = !!intro && !!assets.logo, outroOn = !!outro && !!assets.logo;
  const logoUses = [wmOn && '[lgw]', introOn && '[lgi]', outroOn && '[lgo]'].filter(Boolean) as string[];
  if (logoUses.length) {
    const li = addInput('-i logo.png');
    const key = assets.logoKey && /^#[0-9a-fA-F]{6}$/.test(assets.logoKey) ? `,colorkey=${hex(assets.logoKey)}:0.14:0.08` : '';
    lines.push(`[${li}:v]format=rgba${key},split=${logoUses.length}${logoUses.join('')}`);
  }

  // vídeo: cor → tela dividida e imagens → caixas → legenda → lower third → marca d'água
  let v = 'vc';
  const color = opOf(ops, 'color');
  if (color) { lines.push(`[${v}]${COLOR[color.preset]}[vcol]`); v = 'vcol'; }

  // sem abertura aqui: esta parte do filtro corre antes de ela entrar
  const introS = opOf(ops, 'brand_intro')?.seconds ?? 0;
  const body = r3(seconds - introS - (opOf(ops, 'brand_outro')?.seconds ?? 0));
  const span = (s: Span) => wordSpan(s.word_from, s.word_to, ctx.words, segs, 0, body);
  const media = (index: number, seconds: number) => {
    const file = assets.files?.[index];
    if (!file) return null;
    const image = ctx.attachments?.[index]?.kind === 'image';
    // repetir no filtro, não na entrada: `-loop 1` com imagem corrompida nunca termina
    return { input: addInput(`-i ${file}`), image, hold: image ? `loop=loop=-1:size=1,trim=duration=${seconds},` : '' };
  };
  let fx = 0;
  for (const it of opOf(ops, 'split_screen')?.items ?? []) {
    const t = span(it);
    const m = t && media(it.attachment_index, r3(t.end - t.start));
    if (!t || !m) continue;
    const id = fx++;
    const time = `${m.hold || `trim=duration=${r3(t.end - t.start)},`}setpts=PTS-STARTPTS+${t.start}/TB`;
    lines.push(`[${m.input}:v]${time},scale=${W}:${H / 2}:force_original_aspect_ratio=increase,crop=${W}:${H / 2},fps=30,format=yuv420p[fx${id}]`);
    lines.push(`[${v}][fx${id}]overlay=0:${it.side === 'top' ? 0 : H / 2}:enable='between(t,${t.start},${t.end})':eof_action=pass[vfx${id}]`);
    v = `vfx${id}`;
  }
  for (const it of opOf(ops, 'image_overlay')?.items ?? []) {
    const t = span(it);
    const m = t && media(it.attachment_index, r3(t.end - t.start));
    if (!t || !m) continue;
    const id = fx++;
    const fit = it.position === 'full'
      ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`
      : `scale=${W - 120}:1240:force_original_aspect_ratio=decrease`;
    const y = { top: '200', middle: '(H-h)/2', bottom: 'H-h-520', full: '0' }[it.position];
    lines.push(`[${m.input}:v]${m.hold}setpts=PTS-STARTPTS+${t.start}/TB,${fit},format=rgba,fade=t=in:st=${t.start}:d=0.25:alpha=1[fx${id}]`);
    lines.push(`[${v}][fx${id}]overlay=(W-w)/2:${y}:enable='between(t,${t.start},${t.end})':eof_action=pass[vfx${id}]`);
    v = `vfx${id}`;
  }
  for (const it of opOf(ops, 'fact_card')?.items ?? []) {
    const t = span(it);
    if (!t) continue;
    const id = fx++, y = CARD_Y[it.position], when = `enable='between(t,${t.start},${t.end})'`;
    lines.push(`[${v}]drawbox=x=64:y=${y}:w=952:h=${CARD_H}:color=0x0b1220@0.94:t=fill:${when},` +
      `drawbox=x=64:y=${y}:w=14:h=${CARD_H}:color=${hex(ctx.brand.accent ?? ctx.brand.primary)}:t=fill:${when}[vfx${id}]`);
    v = `vfx${id}`;
  }
  if (opOf(ops, 'captions') && assets.ass) { lines.push(`[${v}]subtitles=subs.ass${fontsdir}[vsub]`); v = 'vsub'; }
  const lt = opOf(ops, 'lower_third');
  if (lt && assets.brandAss) {
    const a = lt.at_s ?? 1;
    lines.push(`[${v}]drawbox=x=60:y=1380:w=760:h=${lt.role ? 170 : 110}:color=${hex(ctx.brand.primary)}@0.92:t=fill:` +
      `enable='between(t,${a},${a + 3})'[vlt]`);
    v = 'vlt';
  }
  if (wmOn) {
    const pos = { tr: 'W-w-60:200', tl: '60:200', br: 'W-w-60:H-h-420', bl: '60:H-h-420' }[wm!.corner ?? 'tr'];
    lines.push(`[lgw]scale=${Math.round(W * 0.14)}:-1,colorchannelmixer=aa=${wm!.opacity ?? 0.7}[wm]`);
    lines.push(`[${v}][wm]overlay=${pos}:enable='gte(t,3)'[vwm]`);
    v = 'vwm';
  }

  // abertura e encerramento são trechos à parte, concatenados nas pontas
  const parts: string[] = [];
  if (introOn) {
    const d = intro!.seconds ?? 1.2;
    lines.push(`[0:v]trim=end=0.1,setpts=PTS-STARTPTS,${base},boxblur=24:2,tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d},setpts=PTS-STARTPTS[ibg]`);
    lines.push(`[lgi]scale=${Math.round(W * 0.5)}:-1,fps=30,tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d},setpts=PTS-STARTPTS,fade=t=in:d=0.25:alpha=1[ilg]`);
    lines.push(`[ibg][ilg]overlay=(W-w)/2:(H-h)/2:shortest=1,` +
      `drawbox=c=${hex(ctx.brand.primary)}@0.55:t=fill:enable='between(t,0,0.12)',fps=30,setsar=1[vin]`);
    lines.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${d}[ain]`);
    parts.push('[vin][ain]');
  }
  parts.push(`[${v}][ac]`);
  if (outroOn) {
    const d = outro!.seconds ?? 2;
    lines.push(`color=c=${hex(ctx.brand.primary)}:s=${W}x${H}:r=30:d=${d}[obg]`);
    lines.push(`[lgo]scale=${Math.round(W * 0.42)}:-1[olg]`);
    lines.push(`[obg][olg]overlay=(W-w)/2:(H-h)/2-160:eof_action=repeat,fade=t=in:d=0.3,setsar=1[vot]`);
    lines.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${d}[aot]`);
    parts.push('[vot][aot]');
  }
  let a = 'ac';
  if (parts.length > 1) {
    lines.push(`${parts.join('')}concat=n=${parts.length}:v=1:a=1[vfull][afull]`);
    v = 'vfull'; a = 'afull';
  }
  if (assets.brandAss) { lines.push(`[${v}]subtitles=brand.ass${fontsdir}[vbt]`); v = 'vbt'; }
  lines.push(`[${v}]format=yuv420p[vout]`);

  // áudio: voz limpa → trilha com ducking → loudnorm
  if (opOf(ops, 'voice_clean')) { lines.push(`[${a}]highpass=f=80,afftdn=nf=-25,deesser=i=0.4[avc]`); a = 'avc'; }
  const duck = opOf(ops, 'music_duck');
  if (duck && assets.music) {
    const mi = addInput('-stream_loop -1 -i music.mp3');
    // volume pelos tempos da fala: sidechaincompress junto com vídeo trava o ffmpeg 6
    const talk: [number, number][] = [];
    for (const w of retimeWords(ctx.words, segs, introS)) {
      const last = talk[talk.length - 1];
      if (last && w.start - last[1] < 0.4) last[1] = w.end;
      else talk.push([w.start, w.end]);
    }
    // a expressão do ffmpeg aceita menos de 100 somas: trechos separados, um filtro por bloco
    let gain = '';
    for (let i = 0; i < talk.length; i += DUCK_TERMS) {
      const under = talk.slice(i, i + DUCK_TERMS).map(([from, to]) => `clip(min(t-${r3(from - 0.12)},${r3(to + 0.3)}-t)/0.1,0,1)`).join('+');
      gain += `,volume='1-0.75*min(1,${under})':eval=frame`;
    }
    lines.push(`[${mi}:a]atrim=duration=${seconds},asetpts=PTS-STARTPTS,volume=${duck.volume_db ?? -18}dB,aresample=48000,aformat=channel_layouts=stereo${gain}[abed]`);
    lines.push(`[${a}][abed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[amix]`);
    a = 'amix';
  }
  if (outro) {
    lines.push(`[${a}]afade=t=out:st=${r3(Math.max(0, seconds - (outro.seconds ?? 2) - 0.4))}:d=0.4[afo]`);
    a = 'afo';
  }
  lines.push(`[${a}]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[aout]`);
  return { filter: lines.join(';\n'), inputArgs: inputs.join(' '), seconds };
}

// ── legenda nova ─────────────────────────────────────────────────────────────
/** Área útil do Reels em 1080×1920: o Instagram cobre o topo, a base e a coluna de botões. */
export const SAFE = { top: 220, bottom: 1500, side: 120 };
export const CAP_SIZE = 86;
/** 840 px: cerca de 20 maiúsculas neste corpo. Vale a largura medida, não a contagem. */
export const CAP_MAX_W = W - SAFE.side * 2;
/** Tempo mínimo de um texto na tela: menos que isso ninguém lê. */
export const CAP_MIN_S = 0.7;
/** Atrasada além de CAP_LATE_S, a legenda encurta até CAP_FAST_S para alcançar a fala. */
const CAP_LATE_S = 0.3;
export const CAP_FAST_S = 0.35;
/** Base fixa de cada faixa (`\an2\pos`), a mesma do início ao fim do vídeo. */
export const CAP_LANES = { bottom: 1220, center: 1010, top: 490 } as const;
type Lane = keyof typeof CAP_LANES;
/** Até aqui a palavra encolhe na horizontal, sem mudar a altura; passou disso, ela parte. */
const CAP_MIN_SCALE = 0.7;
const CAP_OUTLINE = 6;
const CAP_HOLD_S = 0.15;
export const capBox = (lane: Lane) => ({ top: CAP_LANES[lane] - 100, bottom: CAP_LANES[lane] + 12 });

// Avanço dos glifos da Montserrat ExtraBold, em milésimos do em. O libass divide o
// corpo pelas métricas win da fonte: a letra sai bem menor que o Fontsize do ASS.
const ASS_EM = 1000 / (1109 + 453);
const EM_UPPER = [786, 769, 730, 826, 672, 642, 770, 806, 339, 557, 752, 610, 954, 806, 846, 737, 846, 740, 647, 635, 786, 766, 1184, 737, 693, 679];
const EM_LOWER = [628, 695, 603, 698, 642, 406, 705, 696, 313, 320, 677, 313, 1045, 696, 666, 695, 695, 443, 547, 447, 692, 620, 956, 619, 620, 556];
const emOf = (c: string) => {
  const code = c.charCodeAt(0);
  if (code >= 65 && code <= 90) return EM_UPPER[code - 65];
  if (code >= 97 && code <= 122) return EM_LOWER[code - 97];
  if (/\d/.test(c)) return 700;
  if (c === ' ') return 291;
  return /[.,:;!'-]/.test(c) ? 400 : 1000;
};
/** Largura do texto em px, com o contorno, no corpo pedido. */
export const textWidth = (text: string, size = CAP_SIZE) =>
  [...text.normalize('NFD').replace(/\p{M}/gu, '')].reduce((t, c) => t + emOf(c), 0) * size * ASS_EM / 1000;
const capWidth = (text: string) => textWidth(text) + CAP_OUTLINE * 2;

/** Palavra que nem encolhida cabe vira pedaços com hífen, repartindo o tempo dela. */
function splitLong(w: Word): Word[] {
  if (capWidth(w.text) * CAP_MIN_SCALE <= CAP_MAX_W) return [w];
  const parts: string[] = [];
  let part = '';
  for (const c of w.text) {
    if (capWidth(`${part}${c}-`) > CAP_MAX_W) { parts.push(`${part}-`); part = ''; }
    part += c;
  }
  parts.push(part);
  const step = (w.end - w.start) / parts.length;
  return parts.map((text, i) => ({
    ...(i ? {} : w), text, start: r3(w.start + i * step), end: r3(w.start + (i + 1) * step),
  }));
}

/** Região da tela ocupada por outro texto, na linha do tempo da legenda. */
export type CaptionBlock = { start: number; end: number; top: number; bottom: number };
export type Cue = { start: number; end: number; words: Word[] };

const hits = (lane: Lane, b: CaptionBlock) => b.top < capBox(lane).bottom && capBox(lane).top < b.bottom;

/** Título e dado na tela: o que a legenda não pode tocar. */
export function captionBlocks(ops: Op[], ctx: EditContext): CaptionBlock[] {
  const segs = buildSegments(ops, ctx);
  const body = r3(segmentsDuration(segs));
  const at = (s: Span) => wordSpan(s.word_from, s.word_to, ctx.words, segs, 0, body);
  const titles = (opOf(ops, 'title')?.items ?? []).flatMap((it) => {
    const t = at(it);
    if (!t) return [];
    const size = it.text.length > 45 ? 72 : 96;
    const height = Math.ceil(textWidth(it.text, size) * 1.15 / (W - 128)) * size * 1.25;
    const top = { top: 240, middle: (H - height) / 2, bottom: 1360 - height }[it.position];
    return [{ ...t, top, bottom: top + height }];
  });
  const cards = (opOf(ops, 'fact_card')?.items ?? []).flatMap((it) => {
    const t = at(it);
    return t ? [{ ...t, top: CARD_Y[it.position], bottom: CARD_Y[it.position] + CARD_H }] : [];
  });
  return [...titles, ...cards];
}

/** A faixa pedida ou a primeira livre no vídeo todo. A legenda não troca de lugar no meio. */
export function pickLane(position: string | undefined, blocks: CaptionBlock[]): Lane {
  const wanted: Lane = position === 'top' ? 'top' : position === 'center' || position === 'middle' ? 'center' : 'bottom';
  const lanes: Lane[] = [wanted, 'bottom', 'center', 'top'];
  return lanes.find((lane) => !blocks.some((b) => hits(lane, b))) ?? wanted;
}

/**
 * Regras que fazem a legenda não falhar: um texto por vez, sempre uma linha que
 * cabe na área útil, CAP_MIN_S na tela (o seguinte espera, sem se atrasar demais) e
 * nada em cima de um bloco. Sem faixa livre, a legenda some enquanto o bloco aparece.
 */
export function captionCues(raw: Word[], opts: { duration?: number; blocks?: CaptionBlock[]; lane?: Lane } = {}): Cue[] {
  const groups: Word[][] = [];
  for (const w of cleanWords(raw).flatMap(splitLong)) {
    const g = groups[groups.length - 1];
    const fits = g && capWidth([...g, w].map((x) => x.text).join(' ')) <= CAP_MAX_W;
    const room = g && (g.length < 4 || w.start - g[0].start < CAP_MIN_S);
    if (g && fits && room && !w.brk && w.start - g[g.length - 1].end < 0.6) g.push(w);
    else groups.push([w]);
  }
  const cues: Cue[] = [];
  groups.forEach((words, n) => {
    const start = Math.max(words[0].start, cues[cues.length - 1]?.end ?? 0);
    const next = groups[n + 1]?.[0].start ?? Number.POSITIVE_INFINITY;
    const earliest = start + (start - words[0].start > CAP_LATE_S ? CAP_FAST_S : CAP_MIN_S);
    const end = Math.max(earliest, Math.min(words[words.length - 1].end + CAP_HOLD_S, next));
    // lacuna curta entre dois textos vira piscada: o anterior fica até o próximo
    cues.push({ start, end: next > end && next - end < 0.12 ? next : end, words });
  });
  // perto do fim do vídeo o texto recua, para não perder o tempo mínimo
  let limit = opts.duration ?? Number.POSITIVE_INFINITY;
  for (const cue of [...cues].reverse()) {
    const shown = Math.min(cue.end - cue.start, CAP_MIN_S);
    cue.end = Math.min(cue.end, limit);
    cue.start = Math.max(0, Math.min(cue.start, cue.end - shown));
    limit = cue.start;
  }
  const floor = Math.min(CAP_FAST_S, opts.duration ?? CAP_FAST_S);
  const lane = opts.lane ?? 'bottom';
  const blocks = (opts.blocks ?? []).filter((b) => hits(lane, b));
  return cues.flatMap((cue) =>
    blocks.reduce((keep, b) => subtract(keep, [b.start, b.end]), [[cue.start, cue.end]] as [number, number][])
      .filter(([a, b]) => b - a >= floor - 1e-6)
      .map(([start, end]) => ({ start: r3(start), end: r3(end), words: cue.words })));
}

/** Legenda palavra a palavra, com a palavra falada na cor de destaque da marca. */
export function captionsAss(words: Word[], opts: {
  accent: string; style?: string; position?: string; blocks?: CaptionBlock[]; duration?: number;
}): string {
  const caps = opts.style !== 'karaoke';
  const blocks = opts.blocks ?? [];
  const lane = pickLane(opts.position, blocks);
  const accent = /^#[0-9a-fA-F]{6}$/.test(opts.accent) ? opts.accent : '#FFD400';
  const tag = `&H${accent.slice(5, 7)}${accent.slice(3, 5)}${accent.slice(1, 3)}&`.toUpperCase();
  const shown = words.map((w) => ({ ...w, text: assText(caps ? String(w.text ?? '').toUpperCase() : String(w.text ?? '')) }));
  const ev: string[] = [];
  const cs = (t: number) => Math.round(t * 100);
  for (const cue of captionCues(shown, { duration: opts.duration, blocks, lane })) {
    // \pos fixa o ponto, o que também desliga o empilhamento do ASS; \q2 proíbe quebra
    const scale = Math.min(1, CAP_MAX_W / capWidth(cue.words.map((w) => w.text).join(' ')));
    const place = `{\\an2\\pos(${W / 2},${CAP_LANES[lane]})\\q2${scale < 1 ? `\\fscx${Math.floor(scale * 100)}` : ''}}`;
    cue.words.forEach((w, i) => {
      const from = i === 0 ? cue.start : Math.max(w.start, cue.start);
      const to = i < cue.words.length - 1 ? Math.min(cue.words[i + 1].start, cue.end) : cue.end;
      if (cs(from) >= cs(to)) return;
      const text = cue.words.map((x, j) => (j === i ? `{\\c${tag}}${x.text}{\\c&HFFFFFF&}` : x.text)).join(' ');
      ev.push(`Dialogue: 0,${assT(cs(from) / 100)},${assT(cs(to) / 100)},Cap,,0,0,0,,${place}${text}`);
    });
  }
  return [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 2', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Cap,Montserrat ExtraBold,${CAP_SIZE},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,${CAP_OUTLINE},0,2,0,0,0,1`, '',
    '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text', ...ev, '',
  ].join('\n');
}

/** subs.ass de uma edição, ou null sem a operação captions. */
export function editCaptions(ops: Op[], ctx: EditContext, accent: string): string | null {
  const op = opOf(ops, 'captions');
  if (!op) return null;
  const segs = buildSegments(ops, ctx);
  return captionsAss(retimeWords(ctx.words, segs), {
    accent, style: op.style, position: op.position, blocks: captionBlocks(ops, ctx), duration: r3(segmentsDuration(segs)),
  });
}

// ── comandos do sandbox ──────────────────────────────────────────────────────
export const SANDBOX_MAX_CHARS = 16000;

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const workdir = (id: string) => `/tmp/edit-${id.replace(/[^a-zA-Z0-9-]/g, '')}`;
const get = (url: string, file: string) => `curl -fsS -o ${file} ${q(url)}`;
const put = (url: string, file: string, type: string) =>
  `{ code=$(curl -sS -X PUT -H 'Content-Type: ${type}' -H 'x-upsert: true' --data-binary @${file} -w '%{http_code}' -o /dev/null ${q(url)}); ` +
  `[ "$code" = "200" ] || { echo "upload:$code"; exit 1; }; }`;
const checked = (cmd: string) => {
  if (cmd.length > SANDBOX_MAX_CHARS) throw new Error(`comando do sandbox com ${cmd.length} caracteres`);
  return cmd;
};
const ffprobeVal = (entries: string, file: string, extra = '') =>
  `ffprobe -v error ${extra} -show_entries ${entries} -of csv=p=0 ${file}`;

/** Quadros igualmente espaçados: tira e envia um por URL. `$D` já tem a duração. */
const frameSteps = (urls: string[], file: string, stem: string) => urls.flatMap((url, i) => {
  const at = `$(LC_ALL=C awk "BEGIN{printf \\"%.3f\\", $D*${((i + 0.5) / urls.length).toFixed(4)}}")`;
  return [
    `ffmpeg -hide_banner -loglevel error -y -ss ${at} -i ${file} -frames:v 1 -vf scale=360:-2 -q:v 5 ${stem}${i}.jpg`,
    put(url, `${stem}${i}.jpg`, 'image/jpeg'),
  ];
});

/** Análise: duração, áudio leve para o STT, 8 quadros e o estado do logo. */
export function analyzeCommand(p: {
  id: string; sourceUrl: string; audioUploadUrl: string; frameUploadUrls: string[]; logoUrl?: string;
}): string {
  const d = workdir(p.id);
  return checked([
    'set -e', `rm -rf ${d}`, `mkdir -p ${d}`, `cd ${d}`, get(p.sourceUrl, 'src.mp4'),
    `D=$(${ffprobeVal('format=duration', 'src.mp4')})`,
    `A=$(${ffprobeVal('stream=codec_type', 'src.mp4', '-select_streams a')} | head -1)`,
    `V=$(${ffprobeVal('stream=width,height', 'src.mp4', '-select_streams v:0')} | head -1)`,
    `echo "PROBE:$D|$A|$V"`,
    ...frameSteps(p.frameUploadUrls, 'src.mp4', 'f'),
    `if [ -n "$A" ]; then ffmpeg -hide_banner -loglevel error -y -i src.mp4 -vn -ac 1 -ar 16000 -c:a aac -b:a 48k audio.m4a; ${put(p.audioUploadUrl, 'audio.m4a', 'audio/mp4')}; fi`,
    ...(p.logoUrl ? [
      get(p.logoUrl, 'logo.bin'),
      `L=$(${ffprobeVal('stream=pix_fmt', 'logo.bin', '-select_streams v:0')} | head -1)`,
      `K=$(ffmpeg -v error -i logo.bin -frames:v 1 -vf crop=1:1:0:0,format=rgb24 -f rawvideo - | od -An -tx1 | tr -d ' \\n')`,
      `echo "LOGO:$L|$K"`,
    ] : []),
    `cd /`, `rm -rf ${d}`, `echo ANALYZE_OK`,
  ].join(' && '));
}

/** Renderização + dados da conferência (duração, áudio, loudness, 4 quadros). */
export function renderCommand(p: {
  id: string; sourceUrl: string; filterUrl: string; uploadUrl: string; frameUploadUrls: string[];
  inputArgs: string; logoUrl?: string; musicUrl?: string; fontUrls?: Record<string, string>; assUrl?: string; brandAssUrl?: string;
  /** Anexos usados: nome do arquivo na pasta → URL assinada. */
  fileUrls?: Record<string, string>;
}): string {
  const d = workdir(p.id);
  return checked([
    'set -e', `rm -rf ${d}`, `mkdir -p ${d}/fonts`, `cd ${d}`,
    get(p.sourceUrl, 'src.mp4'), get(p.filterUrl, 'filter.txt'),
    ...(p.logoUrl ? [get(p.logoUrl, 'logo.png')] : []),
    ...(p.musicUrl ? [get(p.musicUrl, 'music.mp3')] : []),
    ...Object.entries(p.fileUrls ?? {}).map(([name, url]) => get(url, name)),
    ...Object.entries(p.fontUrls ?? {}).map(([name, url]) => get(url, `fonts/${name}`)),
    ...(p.assUrl ? [get(p.assUrl, 'subs.ass')] : []),
    ...(p.brandAssUrl ? [get(p.brandAssUrl, 'brand.ass')] : []),
    `ffmpeg -hide_banner -loglevel error -y ${p.inputArgs} -filter_complex "$(cat filter.txt)" -map '[vout]' -map '[aout]' ` +
      `-c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -ar 48000 -movflags +faststart out.mp4`,
    `D=$(${ffprobeVal('format=duration', 'out.mp4')})`,
    `A=$(${ffprobeVal('stream=codec_type', 'out.mp4', '-select_streams a')} | head -1)`,
    `I=$(ffmpeg -hide_banner -nostats -i out.mp4 -af ebur128 -f null - 2>&1 | grep -E '^ +I:' | tail -1 | awk '{print $2}')`,
    `echo "QA:$D|$A|$I"`,
    ...frameSteps(p.frameUploadUrls, 'out.mp4', 'q'),
    put(p.uploadUrl, 'out.mp4', 'video/mp4'),
    `cd /`, `rm -rf ${d}`, `echo EDIT_OK`,
  ].join(' && '));
}

export const pollCommand = (log: string, exit: string) =>
  `if [ -f ${exit} ]; then echo "EXITCODE:$(cat ${exit})"; fi; tail -n 30 ${log} 2>/dev/null`;

export function parseBackground(out: string): { log: string; exit: string } | null {
  const log = out.match(/Combined output:\s*(\S+)/)?.[1];
  const exit = out.match(/Exit status \(written when done\):\s*(\S+)/)?.[1];
  return log && exit ? { log, exit } : null;
}

export function parseAnalysis(out: string) {
  const m = out.match(/PROBE:([^|\s]*)\|([^|\s]*)\|(\S*)/);
  const duration = Number(m?.[1]);
  if (!m || !Number.isFinite(duration) || duration <= 0) return null;
  const [width, height] = (m[3] ?? '').split(',').map(Number);
  const logo = out.match(/LOGO:([^|\s]*)\|([0-9a-f]{6})?/);
  const hasAlpha = logo ? /rgba|bgra|argb|abgr|yuva|ya8|ya16|pal8/.test(logo[1]) : false;
  return {
    duration, hasAudio: m[2] === 'audio', width: width || null, height: height || null,
    logoKey: logo && !hasAlpha && logo[2] ? `#${logo[2]}` : null,
  };
}

export function parseQa(out: string) {
  const m = out.match(/QA:([^|\s]*)\|([^|\s]*)\|(\S*)/);
  if (!m) return null;
  const lufs = Number(m[3]);
  // 0 LUFS não existe em fala normalizada: é medição que falhou, não o áudio
  const measured = m[3] && Number.isFinite(lufs) && lufs < 0;
  return { duration: Number(m[1]), hasAudio: m[2] === 'audio', lufs: measured ? lufs : null };
}

/**
 * Conferência determinística (§11.5). Lista vazia = passou. A tolerância cresce
 * com o número de cortes: cada trecho arredonda para um quadro inteiro.
 */
export function qaChecks(
  qa: { duration: number; hasAudio: boolean; lufs: number | null },
  expected: { seconds: number; segments: number; speech: boolean; audio?: boolean },
): string[] {
  const issues: string[] = [];
  const tol = Math.max(0.3, expected.segments * 0.04);
  if (!(Math.abs(qa.duration - expected.seconds) <= tol)) issues.push(`duração ${qa.duration}s, esperado ${expected.seconds}s`);
  if (!qa.hasAudio && expected.audio !== false) issues.push('sem áudio');
  if (expected.speech && qa.lufs != null && (qa.lufs < -16 || qa.lufs > -12)) issues.push(`loudness ${qa.lufs} LUFS`);
  return issues;
}

/** Comando do probe (§8 / §11.2): só leitura, sem custo. */
export const PROBE_COMMAND =
  `echo NODE:$(node -v 2>/dev/null || echo none); ` +
  `echo CHROME:$(which chromium chromium-browser google-chrome google-chrome-stable 2>/dev/null | head -1); ` +
  `ffmpeg -hide_banner -version | head -1; ` +
  `ffmpeg -hide_banner -filters 2>/dev/null | grep -E ' (ass|subtitles|sidechaincompress|afftdn|deesser|silencedetect|overlay|drawtext|loudnorm|colorbalance|colorkey|ebur128) ' || true`;

export function parseProbe(out: string) {
  const has = (f: string) => new RegExp(`\\s${f}\\s`).test(out);
  const node = out.match(/NODE:(\S+)/)?.[1] ?? 'none';
  const chrome = out.match(/CHROME:(\S+)/)?.[1] ?? null;
  return {
    node: node === 'none' ? null : node,
    chrome,
    ffmpeg: out.match(/ffmpeg version (\S+)/)?.[1] ?? null,
    filters: Object.fromEntries(
      ['ass', 'subtitles', 'sidechaincompress', 'afftdn', 'deesser', 'silencedetect', 'overlay', 'drawtext', 'loudnorm', 'colorbalance', 'colorkey', 'ebur128']
        .map((f) => [f, has(f)]),
    ) as Record<string, boolean>,
    hyperframes_ready: !!chrome && /^v(2[2-9]|[3-9]\d)\./.test(node),
  };
}
