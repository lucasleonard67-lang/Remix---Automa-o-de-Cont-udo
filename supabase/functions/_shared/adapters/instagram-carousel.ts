// _shared/adapters/instagram-carousel.ts — 7-10 slides estilo tweet-card + legenda.
// Fonte: docs/07-contratos-backend.md §6 (regras por adapter; mapeamento funil).
//
// Mapeamento funil → slides: camadas 1-2 no slide de capa; 3-6 distribuídas nos
// slides do meio; 7-8 nos slides finais (a marca só aparece de verdade nas
// camadas 7-8 — regra de ouro preservada pelo adapter).

import type { AdaptedContent, ChannelConfig, CoreContent, TweetCardSlide } from '../types.ts';
import {
  type ChannelAdapter,
  blockContent,
  clampText,
  clampToSentence,
  ctaText,
  joinNonEmpty,
  packIntoUnits,
  splitInHalf,
} from './base.ts';

const DEFAULT_SLIDES = { min: 7, max: 10 } as const;
const DEFAULT_SLIDE_MAX_CHARS = 280;
const DEFAULT_CAPTION_MAX_CHARS = 2200;

function structure(core: CoreContent, config: ChannelConfig = {}): AdaptedContent {
  const slideLimits = config.slides ?? DEFAULT_SLIDES;
  const slideMax = config.slide_max_chars ?? DEFAULT_SLIDE_MAX_CHARS;
  const captionMax = config.caption_max_chars ?? DEFAULT_CAPTION_MAX_CHARS;

  // Capa: camadas 1-2 (o gancho visual vira brief da arte da capa quando a
  // peça não traz image_brief próprio).
  const texts: string[] = [clampToSentence(core.hook.written || core.hook.visual, slideMax)];

  // Meio: camadas 3-6, cada bloco empacotado em unidades ≤ slideMax.
  for (const layer of [3, 4, 5, 6]) {
    const content = blockContent(core, layer);
    if (content.length > 0) texts.push(...packIntoUnits(content, slideMax));
  }

  // Finais: camada 7 (moral/tese) e camada 8 + CTA (ponte lógica).
  const layer7 = blockContent(core, 7);
  if (layer7.length > 0) texts.push(...packIntoUnits(layer7, slideMax));
  const finale = ctaText(core);
  if (finale.length > 0) texts.push(...packIntoUnits(finale, slideMax));

  // Excedeu o máximo → funde o excedente no último slide (respeitando o limite).
  let slidesTexts = texts.filter((t) => t.length > 0);
  if (slidesTexts.length > slideLimits.max) {
    const kept = slidesTexts.slice(0, slideLimits.max - 1);
    const rest = slidesTexts.slice(slideLimits.max - 1).join(' ');
    kept.push(clampToSentence(rest, slideMax));
    slidesTexts = kept;
  }

  // Abaixo do mínimo → divide o slide mais longo até atingir o mínimo (ou até
  // não haver mais o que dividir — texto curto demais não trava o adapter).
  while (slidesTexts.length < slideLimits.min) {
    let longestIdx = 0;
    for (let i = 1; i < slidesTexts.length; i++) {
      if (slidesTexts[i].length > slidesTexts[longestIdx].length) longestIdx = i;
    }
    const halves = splitInHalf(slidesTexts[longestIdx]);
    if (!halves) break;
    slidesTexts.splice(longestIdx, 1, halves[0], halves[1]);
  }

  const coverBrief = core.image_brief ?? (core.hook.visual.trim() || undefined);
  const slides: TweetCardSlide[] = slidesTexts.map((text, index) => ({
    index,
    text,
    ...(index === 0 && coverBrief ? { image_brief: coverBrief } : {}),
  }));

  // Legenda: ideia + moral + CTA (os slides já carregam a narrativa completa).
  const caption = clampText(
    joinNonEmpty([core.idea, layer7, core.cta]),
    captionMax,
  );

  return { channel_type: 'instagram_carousel', slides, caption };
}

export const instagramCarouselAdapter: ChannelAdapter = {
  channel_type: 'instagram_carousel',
  limits: {
    chars: DEFAULT_SLIDE_MAX_CHARS,
    caption_chars: DEFAULT_CAPTION_MAX_CHARS,
    slides: DEFAULT_SLIDES,
  },
  aspect_ratio: '4:5',
  structure,
  render_spec: { kind: 'tweet-card', layout: 'slides', aspect_ratio: '4:5' },
  // Hashtags liberadas SOMENTE no lint da caption (campo de metadado do canal);
  // slides seguem a regra global.
  lint_overrides: { allow_hashtags: true },
  cutoff_score: 8,
};
