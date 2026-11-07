import type { EditOp, EditWord } from "@/hooks/use-video-edit";

// ---------------------------------------------------------------------------
// Painel de edição: traduz o plano aplicado em valores de tela e de volta.
// Os limites repetem os de `normalizeOps` (supabase/functions/_shared/video-edit.ts);
// o servidor continua sendo quem decide.
// ---------------------------------------------------------------------------

export const PANEL_LIMITS = {
  speed: { min: 0.85, max: 1.25, step: 0.05 },
  zoom: { min: 1.05, max: 1.2, step: 0.01 },
  padMs: { min: 40, max: 200, step: 10 },
  gapMs: { min: 250, max: 1500, step: 50 },
  logoOpacity: { min: 0.5, max: 0.85, step: 0.05 },
  musicDb: { min: -24, max: -12, step: 1 },
  outroSeconds: { min: 1.5, max: 3, step: 0.5 },
} as const;

export const COLORS = ["none", "neutral", "warm", "cool", "punch"] as const;
export const CORNERS = ["tl", "tr", "bl", "br"] as const;

export type PanelColor = (typeof COLORS)[number];
export type PanelCorner = (typeof CORNERS)[number];
export type Position = "top" | "middle" | "bottom";

interface Span {
  word_from: number;
  word_to: number;
}

export type Insert = Span & { id: string } & (
    | { kind: "title"; text: string; position: Position }
    | { kind: "fact"; value: string; label: string; source: string; position: Position }
    | {
        kind: "image";
        attachment_index: number;
        name: string;
        position: Position | "full";
      }
    | { kind: "split"; attachment_index: number; name: string; side: "top" | "bottom" }
  );

export interface PanelValues {
  speed: number;
  zoomOn: boolean;
  zoom: number;
  trimOn: boolean;
  padMs: number;
  gapMs: number;
  captionsOn: boolean;
  captionStyle: string;
  captionPosition: string;
  color: PanelColor;
  voiceClean: boolean;
  logoOn: boolean;
  logoCorner: PanelCorner;
  logoOpacity: number;
  outroOn: boolean;
  outroSeconds: number;
  outroCta: string;
  musicDb: number;
  inserts: Insert[];
}

/** O que o painel reescreve; o resto do plano segue intacto. */
const MANAGED = new Set([
  "punch_in",
  "trim_silences",
  "captions",
  "color",
  "voice_clean",
  "brand_watermark",
  "brand_outro",
  "music_duck",
  "title",
  "fact_card",
  "image_overlay",
  "split_screen",
  "speed",
  "loudness",
]);

type Fields = Record<string, unknown>;

const opOf = (ops: EditOp[], type: string): Fields | undefined =>
  ops.find((op) => op.type === type);
const num = (value: unknown, fallback: number) => (typeof value === "number" ? value : fallback);
const str = (value: unknown, fallback: string) =>
  typeof value === "string" && value ? value : fallback;
const itemsOf = (op: Fields | undefined) =>
  Array.isArray(op?.items) ? (op.items as Fields[]) : [];
const spanOf = (item: Fields) => ({
  word_from: num(item.word_from, 0),
  word_to: num(item.word_to, 0),
});

/** Velocidade do vídeo inteiro. Trecho isolado, pedido ao Claude, não vira valor do slider. */
function wholeSpeed(ops: EditOp[], wordCount: number): number {
  const ranges = opOf(ops, "speed")?.ranges;
  if (!Array.isArray(ranges) || ranges.length !== 1) return 1;
  const range = ranges[0] as Fields;
  return range.word_from === 0 && range.word_to === wordCount - 1 ? num(range.factor, 1) : 1;
}

function readInserts(ops: EditOp[]): Insert[] {
  const titles = itemsOf(opOf(ops, "title")).map((item, index): Insert => ({
    ...spanOf(item),
    id: `title-${index}`,
    kind: "title",
    text: str(item.text, ""),
    position: str(item.position, "top") as Position,
  }));
  const facts = itemsOf(opOf(ops, "fact_card")).map((item, index): Insert => ({
    ...spanOf(item),
    id: `fact-${index}`,
    kind: "fact",
    value: str(item.value, ""),
    label: str(item.label, ""),
    source: str(item.source, ""),
    position: str(item.position, "middle") as Position,
  }));
  const images = itemsOf(opOf(ops, "image_overlay")).map((item, index): Insert => ({
    ...spanOf(item),
    id: `image-${index}`,
    kind: "image",
    attachment_index: num(item.attachment_index, 0),
    name: "Imagem enviada",
    position: str(item.position, "middle") as Position,
  }));
  const splits = itemsOf(opOf(ops, "split_screen")).map((item, index): Insert => ({
    ...spanOf(item),
    id: `split-${index}`,
    kind: "split",
    attachment_index: num(item.attachment_index, 0),
    name: "Arquivo enviado",
    side: item.side === "top" ? "top" : "bottom",
  }));
  return [...titles, ...facts, ...images, ...splits];
}

export function readPanel(ops: EditOp[], wordCount: number): PanelValues {
  const zoom = opOf(ops, "punch_in");
  const trim = opOf(ops, "trim_silences");
  const captions = opOf(ops, "captions");
  const color = opOf(ops, "color");
  const logo = opOf(ops, "brand_watermark");
  const outro = opOf(ops, "brand_outro");
  const music = opOf(ops, "music_duck");
  return {
    speed: wholeSpeed(ops, wordCount),
    zoomOn: Boolean(zoom),
    zoom: num(zoom?.zoom, 1.12),
    trimOn: Boolean(trim),
    padMs: num(trim?.pad_ms, 80),
    gapMs: num(trim?.min_gap_ms, 400),
    captionsOn: Boolean(captions),
    captionStyle: str(captions?.style, "caps"),
    captionPosition: str(captions?.position, "bottom"),
    color: str(color?.preset, "none") as PanelColor,
    voiceClean: Boolean(opOf(ops, "voice_clean")),
    logoOn: Boolean(logo),
    logoCorner: str(logo?.corner, "tr") as PanelCorner,
    logoOpacity: num(logo?.opacity, 0.7),
    outroOn: Boolean(outro),
    outroSeconds: num(outro?.seconds, 2),
    outroCta: str(outro?.cta, ""),
    musicDb: num(music?.volume_db, -18),
    inserts: readInserts(ops),
  };
}

function insertOps(inserts: Insert[]): EditOp[] {
  const pick = <K extends Insert["kind"]>(kind: K) =>
    inserts.filter((item): item is Extract<Insert, { kind: K }> => item.kind === kind);
  const span = ({ word_from, word_to }: Span) => ({ word_from, word_to });
  const out: EditOp[] = [];
  const add = (type: string, items: Fields[]) => {
    if (items.length) out.push({ type, items });
  };
  add(
    "title",
    pick("title").map((it) => ({ ...span(it), text: it.text, position: it.position })),
  );
  add(
    "fact_card",
    pick("fact").map((it) => ({
      ...span(it),
      value: it.value,
      label: it.label,
      source: it.source,
      position: it.position,
    })),
  );
  add(
    "image_overlay",
    pick("image").map((it) => ({
      ...span(it),
      attachment_index: it.attachment_index,
      position: it.position,
    })),
  );
  add(
    "split_screen",
    pick("split").map((it) => ({
      ...span(it),
      attachment_index: it.attachment_index,
      side: it.side,
    })),
  );
  return out;
}

/** Plano novo: mantém o que o painel não controla e fecha com a normalização de áudio. */
export function buildOps(
  base: EditOp[],
  initial: PanelValues,
  values: PanelValues,
  context: { wordCount: number; hasMusic: boolean },
): EditOp[] {
  const ops: EditOp[] = base.filter((op) => !MANAGED.has(op.type));
  if (values.speed !== initial.speed) {
    if (values.speed !== 1) {
      ops.push({
        type: "speed",
        ranges: [{ word_from: 0, word_to: context.wordCount - 1, factor: values.speed }],
      });
    }
  } else {
    const kept = opOf(base, "speed");
    if (kept) ops.push(kept as EditOp);
  }
  if (values.zoomOn) ops.push({ type: "punch_in", zoom: values.zoom });
  if (values.trimOn) {
    ops.push({ type: "trim_silences", pad_ms: values.padMs, min_gap_ms: values.gapMs });
  }
  if (values.captionsOn) {
    ops.push({
      type: "captions",
      style: values.captionStyle,
      position: values.captionPosition,
    });
  }
  if (values.color !== "none") ops.push({ type: "color", preset: values.color });
  if (values.voiceClean) ops.push({ type: "voice_clean" });
  if (values.logoOn) {
    ops.push({
      type: "brand_watermark",
      corner: values.logoCorner,
      opacity: values.logoOpacity,
    });
  }
  if (values.outroOn) {
    ops.push({ type: "brand_outro", seconds: values.outroSeconds, cta: values.outroCta });
  }
  if (context.hasMusic) ops.push({ type: "music_duck", volume_db: values.musicDb });
  ops.push(...insertOps(values.inserts), { type: "loudness" });
  return ops;
}

export function insertReady(item: Insert): boolean {
  if (item.kind === "title") return Boolean(item.text.trim());
  if (item.kind === "fact") return Boolean(item.value.trim() && item.source.trim());
  return true;
}

/** Trecho inicial de um item novo: as palavras dos primeiros segundos após `fromWord`. */
export function defaultSpan(words: EditWord[], fromWord = 0, seconds = 3): Span {
  const word_from = Math.min(fromWord, Math.max(0, words.length - 1));
  const limit = (words[word_from]?.start ?? 0) + seconds;
  let word_to = word_from;
  while (word_to + 1 < words.length && words[word_to + 1].end <= limit) word_to += 1;
  return { word_from, word_to };
}

/** O trecho como a pessoa o reconhece: tempo e as palavras faladas. */
export function spanLabel(words: EditWord[], span: Span): { time: string; quote: string } {
  const first = words[span.word_from];
  const last = words[span.word_to];
  const said = words.slice(span.word_from, span.word_to + 1).map((word) => word.text.trim());
  const quote = said.length > 14 ? `${said.slice(0, 14).join(" ")}…` : said.join(" ");
  return { time: `${clock(first?.start ?? 0)} a ${clock(last?.end ?? 0)}`, quote };
}

function clock(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
