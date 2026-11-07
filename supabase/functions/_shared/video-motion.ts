// video-motion — efeitos de motion do "Editar com Claude" (docs/editor-por-prompt/render-e-motion.md).
// O Claude marca cada efeito por índice de palavra; aqui eles viram tempos do vídeo
// final, já com os cortes do ffmpeg, e o plano do render-worker. Núcleo puro.

import type { Segment, Word } from './video-edit.ts';

/** Mesmo piso de SPEED_MIN: em câmera lenta a pausa estica e não é salto. */
const SLOWEST = 0.85;

export const MAX_ATTACHMENTS = 8;
/** Limites do render-worker (compose.py): conferidos antes de gastar o ffmpeg. */
export const MAX_DURATION_S = 180;
export const MAX_CAPTION_WORDS = 600;
const MIN_LAYER_S = 1.5;
const LAST_WORD_HOLD_S = 0.25;
const MAX_IMAGES = 6;
const END_CARD_MAX_S = 4;
/** Em vídeo curto, o encerramento não cobre a fala. */
const END_CARD_MAX_SHARE = 0.4;

export type AttachmentKind = 'video' | 'image' | 'audio';
export type Attachment = { path: string; kind: AttachmentKind };
export type Source = { title: string; url: string; text: string };

export type MotionLayer =
  | { type: 'hook'; word_from: number; word_to: number; text: string; emphasis: string; position: string }
  | { type: 'lower_third'; word_from: number; word_to: number; title: string; position: string }
  | { type: 'fact_card'; word_from: number; word_to: number; value: string; label: string; source_index: number; position: string }
  | { type: 'captions'; position: string }
  | { type: 'end_card'; text: string; seconds: number }
  | { type: 'split_screen'; word_from: number; word_to: number; attachment_index: number }
  | { type: 'picture_in_picture'; word_from: number; word_to: number; attachment_index: number; corner: string }
  | { type: 'cutout'; word_from: number; word_to: number; attachment_index: number; spot: string };

export type MotionPlan = { layers: MotionLayer[]; music: boolean };

export type WorkerPlan = {
  duration: number;
  source_audio: boolean;
  brand: { accent: string; ink: string; ground: string };
  music?: { volume: number };
  layers: Record<string, unknown>[];
};

export type WorkerAssets = { broll_path?: string; music_path?: string; image_paths: string[] };

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Corta por caractere inteiro (nunca no meio de um emoji) e, se der, entre palavras. */
export function clean(t: unknown, max: number): string {
  // eslint-disable-next-line no-control-regex -- tira caracteres de controle do texto que vai para o vídeo
  const text = String(t ?? '').replace(/[\u0000-\u001f]/g, ' ').trim();
  const chars = [...text];
  if (chars.length <= max) return text;
  const cut = chars.slice(0, max).join('');
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trim();
}
const isHex = (c: string) => /^#[0-9a-fA-F]{6}$/.test(c);

/** Momento do vídeo final de um instante do original; null se o trecho foi cortado. */
export function finalTime(t: number, segs: Segment[], offset = 0): number | null {
  let at = offset;
  for (const s of segs) {
    if (t >= s.start && t < s.end) return r3(at + (t - s.start) / s.speed);
    at += (s.end - s.start) / s.speed;
  }
  return null;
}

/** Início e fim, no vídeo final, de um trecho de palavras; palavras cortadas ficam de fora. */
export function wordSpan(
  from: number, to: number, words: Word[], segs: Segment[], offset: number, duration: number,
): { start: number; end: number } | null {
  // gancho separa palavras vizinhas: fica o maior pedaço contínuo, não o intervalo entre eles
  let times: number[] = [], run: number[] = [], prev: { src: number; out: number } | null = null;
  for (let i = Math.max(0, from); i <= Math.min(to, words.length - 1); i++) {
    const w = words[i], src = (w.start + w.end) / 2;
    const t = finalTime(src, segs, offset);
    if (t == null) continue;
    if (prev && (t < prev.out || t - prev.out > (src - prev.src) / SLOWEST + 0.5)) run = [];
    run.push(t);
    if (run.length > times.length) times = [...run];
    prev = { src, out: t };
  }
  if (!times.length) return null;
  const start = Math.max(0, r3(Math.min(...times) - 0.15));
  const end = Math.min(duration, r3(Math.max(Math.max(...times) + LAST_WORD_HOLD_S, start + MIN_LAYER_S)));
  return end > start ? { start, end } : null;
}

/** Números inteiros do texto, sem pontuação: "19,8" e "19.8" são o mesmo número. */
const numbersIn = (s: string) => [...s.matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => m[0].replace(/[.,]/g, ''));

/** O card precisa de um número, e todo número dele precisa estar na fonte. */
export function factIsGrounded(value: string, label: string, source: Source | undefined): boolean {
  if (!source || !numbersIn(value).length) return false;
  const known = new Set(numbersIn(source.text));
  return numbersIn(`${value} ${label}`).every((n) => known.has(n));
}

const sourceLabel = (s: Source) => {
  try {
    return clean(new URL(s.url).hostname.replace(/^www\./, ''), 70);
  } catch {
    return clean(s.title, 70);
  }
};

const SLOTS: Record<string, string[]> = {
  hook: ['top', 'middle', 'bottom'],
  fact_card: ['middle', 'top', 'bottom'],
  lower_third: ['bottom', 'top'],
};
const FIXED_SLOT: Record<string, (l: Record<string, unknown>) => string | null> = {
  cutout: (l) => (l.spot === 'top' ? 'top' : 'middle'),
  picture_in_picture: (l) => (String(l.corner).startsWith('top') ? 'top' : 'bottom'),
  captions: (l) => String(l.position ?? 'bottom'),
};

/**
 * Dois efeitos no mesmo lugar e ao mesmo tempo ficariam ilegíveis: o segundo muda
 * para um lugar livre; sem lugar, sai da lista e a tela avisa.
 */
export function placeLayers(layers: Record<string, unknown>[], dropped: string[]): Record<string, unknown>[] {
  type Taken = { slot: string; start: number; end: number };
  const taken: Taken[] = [];
  const spanOf = (l: Record<string, unknown>) =>
    l.type === 'captions' ? { start: 0, end: Number.POSITIVE_INFINITY } : { start: Number(l.start), end: Number(l.end) };
  const free = (slot: string, s: { start: number; end: number }) =>
    !taken.some((t) => t.slot === slot && s.start < t.end && t.start < s.end);

  for (const layer of layers) {
    const slot = FIXED_SLOT[String(layer.type)]?.(layer);
    if (slot) taken.push({ slot, ...spanOf(layer) });
  }
  return layers.filter((layer) => {
    const options = SLOTS[String(layer.type)];
    if (!options) return true;
    const span = spanOf(layer);
    const wanted = String(layer.position);
    const slot = [wanted, ...options].find((s) => options.includes(s) && free(s, span));
    if (!slot) { dropped.push('Um efeito saiu porque não coube na tela junto com os outros.'); return false; }
    layer.position = slot;
    taken.push({ slot, ...span });
    return true;
  });
}

const attachmentAt = (list: Attachment[], index: number, kind: AttachmentKind) =>
  list[index]?.kind === kind ? list[index] : undefined;

/**
 * Plano do Claude → plano do render-worker. O que não dá para cumprir sai da
 * lista e vira uma frase em `dropped`, para a tela dizer o que ficou de fora.
 */
export function compileMotion(input: {
  plan: MotionPlan;
  words: Word[];
  retimed: Word[];
  segs: Segment[];
  offset: number;
  duration: number;
  captionsBurned: boolean;
  sourceAudio: boolean;
  attachments: Attachment[];
  sources: Source[];
  brand: { primary: string; accent: string };
}): { worker: WorkerPlan; assets: WorkerAssets; dropped: string[] } {
  const { plan, words, retimed, segs, offset, duration, attachments, sources } = input;
  const layers: Record<string, unknown>[] = [];
  const dropped: string[] = [];
  const assets: WorkerAssets = { image_paths: [] };
  const span = (l: { word_from: number; word_to: number }) => wordSpan(l.word_from, l.word_to, words, segs, offset, duration);

  for (const layer of plan.layers) {
    switch (layer.type) {
      case 'captions': {
        if (input.captionsBurned) { dropped.push('A legenda já está no vídeo.'); break; }
        const list = retimed.map((w) => ({ ...(w.brk ? { brk: true } : {}), text: clean(w.text, 40), start: w.start, end: Math.min(w.end, duration) }))
          .filter((w) => w.text && w.end > w.start);
        if (list.length) layers.push({ type: 'captions', words: list, position: layer.position });
        else dropped.push('Este vídeo não tem fala para legendar.');
        break;
      }
      case 'end_card': {
        const text = clean(layer.text, 60);
        if (!text) { dropped.push('O encerramento veio sem texto.'); break; }
        const seconds = Math.min(END_CARD_MAX_S, Math.max(1.5, layer.seconds || 3), duration * END_CARD_MAX_SHARE);
        layers.push({ type: 'end_card', start: r3(duration - seconds), end: duration, text });
        break;
      }
      case 'hook':
      case 'lower_third':
      case 'fact_card':
      case 'split_screen':
      case 'picture_in_picture':
      case 'cutout': {
        const at = span(layer);
        if (!at) { dropped.push('Um efeito caía num trecho cortado.'); break; }
        if (layer.type === 'hook') {
          const text = clean(layer.text, 90);
          if (!text) { dropped.push('Um título veio vazio.'); break; }
          layers.push({ ...at, type: 'hook', text, emphasis: clean(layer.emphasis, 40) || undefined, position: layer.position });
        } else if (layer.type === 'lower_third') {
          const title = clean(layer.title, 60);
          if (!title) { dropped.push('Um nome veio vazio.'); break; }
          layers.push({ ...at, type: 'lower_third', title, position: layer.position });
        } else if (layer.type === 'fact_card') {
          const source = sources[layer.source_index];
          const value = clean(layer.value, 24), label = clean(layer.label, 90);
          if (!factIsGrounded(value, label, source)) { dropped.push('Um dado ficou de fora porque a fonte não confirmou.'); break; }
          layers.push({ ...at, type: 'fact_card', value, label, source: sourceLabel(source!), position: layer.position });
        } else if (layer.type === 'cutout') {
          const image = attachmentAt(attachments, layer.attachment_index, 'image');
          if (!image) { dropped.push('Falta enviar a imagem do recorte.'); break; }
          const known = assets.image_paths.indexOf(image.path);
          if (known < 0 && assets.image_paths.length === MAX_IMAGES) { dropped.push(`Até ${MAX_IMAGES} imagens por vídeo.`); break; }
          if (known < 0) assets.image_paths.push(image.path);
          layers.push({ ...at, type: 'cutout', image: (known < 0 ? assets.image_paths.length : known + 1), spot: layer.spot });
        } else {
          const video = attachmentAt(attachments, layer.attachment_index, 'video');
          if (!video) { dropped.push('Falta enviar o vídeo desse efeito.'); break; }
          if (assets.broll_path && assets.broll_path !== video.path) { dropped.push('Por enquanto, um vídeo extra por edição.'); break; }
          assets.broll_path = video.path;
          layers.push(layer.type === 'split_screen'
            ? { ...at, type: 'split_screen', media: 'broll' }
            : { ...at, type: 'picture_in_picture', media: 'broll', corner: layer.corner });
        }
        break;
      }
    }
  }

  const track = plan.music ? attachments.find((a) => a.kind === 'audio') : undefined;
  if (track) assets.music_path = track.path;
  else if (plan.music) dropped.push('Falta enviar a música.');

  return {
    worker: {
      duration: r3(duration),
      source_audio: input.sourceAudio,
      brand: {
        accent: isHex(input.brand.accent) ? input.brand.accent : '#ff5a3c',
        ink: '#ffffff',
        ground: isHex(input.brand.primary) ? input.brand.primary : '#0b1220',
      },
      ...(track ? { music: { volume: 0.3 } } : {}),
      layers: placeLayers(layers, dropped),
    },
    assets,
    dropped,
  };
}
