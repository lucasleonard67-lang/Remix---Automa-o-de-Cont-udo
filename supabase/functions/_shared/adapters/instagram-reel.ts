// _shared/adapters/instagram-reel.ts — roteiro de Reel em beats (gancho/desenvolvimento/cta).
// Fonte: docs/11-video-replicate.md §2.7 e §4.5.
//
// O adapter produz só o EDITORIAL (script.beats[] + caption) — auditado pela mesma saga dos
// demais canais. A PRODUÇÃO (cenas, TTS, keyframes, vídeo) é outra camada (video_projects/
// video_scenes), disparada só depois de `awaiting_review`; este arquivo nunca fala com o
// Replicate nem grava `adapted_content.video` (esse ponteiro é escrito pelo pipeline de vídeo).
//
// Mapeamento funil → beats, específico de um formato FALADO: 'gancho' = camada 3 (gancho
// falado; cai para a 2, escrita, e depois para o hook do núcleo) — a camada 1 é o gancho
// VISUAL e viraria direção de câmera lida em voz alta pelo TTS. 'desenvolvimento' =
// camadas 4-7 (as 1-3 são o mesmo gancho em três formas), empacotadas em unidades
// ≤ `config.max_scenes` (default 6, piso 3 no total); 'cta' = camada 8 + core.cta
// (ponte lógica, mesmo helper `ctaText` dos outros adapters).
//
// A narração é texto FALADO — vira input do TTS —, então é limpa de hashtag/emoji/markdown/URL
// antes de virar beat. A legenda do post segue o padrão dos outros adapters (hashtags liberadas
// só nela, via lint_overrides).

import type { AdaptedContent, ChannelConfig, CoreContent, ReelBeat } from '../types.ts';
import {
  type ChannelAdapter,
  blockContent,
  clampText,
  ctaText,
  joinNonEmpty,
  splitSentences,
} from './base.ts';

const DEFAULT_TARGET_DURATION_S = 30;
const DEFAULT_MAX_SCENES = 6;
const MIN_BEATS = 3;                  // gancho + ≥1 desenvolvimento + cta
const DEFAULT_CAPTION_MAX_CHARS = 2200;
const ON_SCREEN_TEXT_MAX_CHARS = 60;

// Ritmo de fala pt-BR (§4.5 do doc): duration_target_s ≈ palavras / 2,5.
const WORDS_PER_SECOND = 2.5;
const MIN_BEAT_DURATION_S = 3;
// Teto por cena: o modelo de vídeo primário (scene_i2v) aceita no máximo 12s (§1.3 do doc).
const MAX_BEAT_DURATION_S = 12;
// O teto em PALAVRAS é o que vale de verdade: a narração vira áudio, e a duração do
// áudio comanda a cena. Beat que passa disso produziria vídeo curto com fala longa.
const MAX_WORDS_PER_BEAT = Math.floor(MAX_BEAT_DURATION_S * WORDS_PER_SECOND);

const URL_RE = /https?:\/\/\S+|www\.\S+/giu;
const MD_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
const MD_MARKUP_RE = /[*_`~#>]+/g;
const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

/**
 * Limpa o texto do funil para virar narração FALADA: sem hashtag, emoji, markdown ou URL — o
 * TTS leria tudo isso em voz alta. Determinístico, sem heurística de "sentido".
 */
function cleanNarration(text: string): string {
  let t = text.replace(MD_LINK_RE, '$1');  // [texto](url) → texto
  t = t.replace(URL_RE, '');
  t = t.replace(HASHTAG_RE, '');
  t = t.replace(EMOJI_RE, '');
  t = t.replace(MD_MARKUP_RE, '');
  t = t.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
  return dropDanglingFragments(t.trim());
}

/** Preposição/verbo de chamada solto no fim da frase — o que sobra de "Veja mais em <url>"
 *  depois que a URL sai. Sem isto o TTS lê "Veja mais em" e cai no silêncio. */
const DANGLING_RE =
  /\b(?:em|no|na|nos|nas|ao|à|para|pra|de|do|da|com|por|via|até|aqui|acesse|veja|confira|link|leia)\s*[:,–—-]*\s*$/iu;

function dropDanglingFragments(text: string): string {
  const kept = splitSentences(text).filter((sentence) => {
    const bare = sentence.replace(/[.!?]+$/u, '').trim();
    return bare.length > 0 && !DANGLING_RE.test(bare);
  });
  return kept.length > 0 ? kept.join(' ') : text;
}

function countWords(text: string): number {
  return text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
}

/** Duração REAL da fala, sem teto — é o que precisa ser comparado com o limite. */
function speechSeconds(text: string): number {
  const words = countWords(text);
  return words === 0 ? 0 : Math.round((words / WORDS_PER_SECOND) * 2) / 2;
}

/** Duração declarada do beat (piso 3s, teto 12s). Só é honesta porque o TEXTO já
 *  foi cortado para caber — aplicar o teto ao número sem cortar a fala faria o
 *  campo mentir, e a duração do áudio é o que comanda a cena lá no pipeline. */
function estimateDuration(text: string): number {
  return Math.min(MAX_BEAT_DURATION_S, Math.max(MIN_BEAT_DURATION_S, speechSeconds(text)));
}

/** Corta em fronteira de FRASE até caber no orçamento de palavras. */
function fitToWords(text: string, maxWords: number): string {
  if (countWords(text) <= maxWords) return text;
  const kept: string[] = [];
  let total = 0;
  for (const sentence of splitSentences(text)) {
    const words = countWords(sentence);
    if (total + words > maxWords) break;
    kept.push(sentence);
    total += words;
  }
  // Frase única maior que o beat inteiro: aí não há fronteira para respeitar.
  if (kept.length === 0) return text.trim().split(/\s+/).slice(0, maxWords).join(' ');
  return kept.join(' ');
}

/**
 * Igual ao fitToWords, mas preservando o FIM. É o corte certo para o CTA: quando
 * a fala não cabe, o que não pode sumir é o pedido ("manda mensagem"), não a
 * credencial que vem antes dele.
 */
function fitToWordsKeepingEnd(text: string, maxWords: number): string {
  if (countWords(text) <= maxWords) return text;
  const sentences = splitSentences(text);
  const kept: string[] = [];
  let total = 0;
  for (let i = sentences.length - 1; i >= 0; i--) {
    const words = countWords(sentences[i]);
    if (total + words > maxWords) break;
    kept.unshift(sentences[i]);
    total += words;
  }
  if (kept.length === 0) {
    const words = text.trim().split(/\s+/);
    return words.slice(Math.max(0, words.length - maxWords)).join(' ');
  }
  return kept.join(' ');
}

/** Empacota o texto em unidades que CABEM na fala de um beat. */
function packByWords(text: string, maxWords: number): string[] {
  const units: string[] = [];
  let current = '';
  for (const sentence of splitSentences(text)) {
    const candidate = current.length > 0 ? `${current} ${sentence}` : sentence;
    if (countWords(candidate) <= maxWords) {
      current = candidate;
      continue;
    }
    if (current.length > 0) units.push(current);
    current = countWords(sentence) <= maxWords ? sentence : fitToWords(sentence, maxWords);
  }
  if (current.length > 0) units.push(current);
  return units;
}

function structure(core: CoreContent, config: ChannelConfig = {}): AdaptedContent {
  const targetDurationS = config.target_duration_s ?? DEFAULT_TARGET_DURATION_S;
  const maxScenes = Math.max(MIN_BEATS, config.max_scenes ?? DEFAULT_MAX_SCENES);
  const desiredMiddle = Math.max(1, maxScenes - 2);

  // Gancho FALADO (camada 3). Reel é formato falado: a camada 1 é o gancho VISUAL
  // (direção de câmera — "close-up em um calendário…") e seria lida em voz alta
  // pelo TTS se virasse narração. Fallbacks: gancho escrito (2) e o hook do núcleo.
  const ganchoText = fitToWords(
    cleanNarration(blockContent(core, 3) || blockContent(core, 2) || core.hook.written),
    MAX_WORDS_PER_BEAT,
  );

  // CTA: camada 8 + core.cta por ponte lógica (mesmo helper dos demais adapters).
  const ctaBeatText = fitToWordsKeepingEnd(cleanNarration(ctaText(core)), MAX_WORDS_PER_BEAT);

  // Desenvolvimento: camadas 4-7 (contexto → virada → ensino+prova → moral).
  // As camadas 1-3 são as três formas do MESMO gancho — incluí-las aqui repetiria
  // a abertura dentro do corpo do Reel.
  const devLayers = [4, 5, 6, 7]
    .map((layer) => cleanNarration(blockContent(core, layer)))
    .filter((t) => t.length > 0);
  const devBody = joinNonEmpty(devLayers, '\n\n');

  // Cada unidade já nasce CABENDO na fala de um beat. Nunca fundir unidades para
  // "caber no orçamento": fundir aumenta a fala do beat e o teto de 12s passaria a
  // esconder o excesso, gerando um vídeo curto com áudio longo.
  let middle = devBody.length > 0 ? packByWords(devBody, MAX_WORDS_PER_BEAT) : [];
  if (middle.length === 0) {
    // Funil sem desenvolvimento (degenerado) — usa a ideia para não cair abaixo do piso de beats.
    const fallback = fitToWords(cleanNarration(core.idea), MAX_WORDS_PER_BEAT);
    middle = [fallback.length > 0 ? fallback : 'Desenvolvimento.'];
  }

  // Além do número de cenas permitido → o excedente SAI (Reel é formato curto;
  // o texto completo continua na legenda e nos outros canais da mesma peça).
  if (middle.length > desiredMiddle) middle = middle.slice(0, desiredMiddle);

  // Ainda acima do orçamento de duração → descarta os últimos desenvolvimentos.
  // Gancho e CTA nunca são cortados: são o que sustenta a peça.
  const budgetOf = (units: string[]) =>
    speechSeconds(ganchoText) +
    units.reduce((acc, text) => acc + speechSeconds(text), 0) +
    speechSeconds(ctaBeatText);
  while (budgetOf(middle) > targetDurationS && middle.length > 1) {
    middle.pop();
  }

  const beats: ReelBeat[] = [];
  const pushBeat = (role: ReelBeat['role'], narration: string) => {
    const firstSentence = splitSentences(narration)[0];
    const onScreenText = firstSentence ? clampText(firstSentence, ON_SCREEN_TEXT_MAX_CHARS) : undefined;
    beats.push({
      index: beats.length,
      role,
      narration,
      ...(onScreenText ? { on_screen_text: onScreenText } : {}),
      duration_target_s: estimateDuration(narration),
    });
  };

  pushBeat('gancho', ganchoText);
  for (const text of middle) pushBeat('desenvolvimento', text);
  pushBeat('cta', ctaBeatText);

  // Legenda do post (abaixo do vídeo) — mesmo tratamento do carrossel: ideia + moral + CTA,
  // hashtags liberadas só aqui (lint_overrides), nunca na narração.
  const captionMax = config.caption_max_chars ?? DEFAULT_CAPTION_MAX_CHARS;
  const caption = clampText(
    joinNonEmpty([core.idea, blockContent(core, 7), ctaText(core)]),
    captionMax,
  );

  // Camada 1 = gancho VISUAL. Não vira fala (o TTS leria a direção de câmera em
  // voz alta), mas também não se joga fora: é direção de arte que o funil já
  // produziu e que o diretor de cenas usa na abertura.
  const visualHook = blockContent(core, 1).trim();

  return {
    channel_type: 'instagram_reel',
    script: {
      target_duration_s: targetDurationS,
      beats,
      ...(visualHook.length > 0 ? { visual_hook: visualHook } : {}),
    },
    caption,
  };
}

export const instagramReelAdapter: ChannelAdapter = {
  channel_type: 'instagram_reel',
  limits: { caption_chars: DEFAULT_CAPTION_MAX_CHARS },
  aspect_ratio: '9:16',
  structure,
  render_spec: { kind: 'reel', aspect_ratio: '9:16' },
  // Hashtags liberadas SOMENTE na legenda (campo de metadado do canal); a narração já sai
  // limpa por construção do structure(), então o override não vaza para o texto falado.
  lint_overrides: { allow_hashtags: true },
  cutoff_score: 8,
};
