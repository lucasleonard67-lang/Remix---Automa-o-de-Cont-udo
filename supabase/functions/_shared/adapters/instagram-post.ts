// _shared/adapters/instagram-post.ts — post único estilo tweet-card + legenda.
// Fonte: docs/07-contratos-backend.md §6.
//
// O card carrega o gancho (camadas 1-2); a legenda carrega a narrativa
// (camadas 4-8, com CTA por ponte lógica no fim).

import type { AdaptedContent, ChannelConfig, CoreContent, TweetCardSlide } from '../types.ts';
import {
  type ChannelAdapter,
  blockContent,
  clampText,
  ctaText,
  joinNonEmpty,
} from './base.ts';

const DEFAULT_TEXT_MAX_CHARS = 280;
const DEFAULT_CAPTION_MAX_CHARS = 2200;

function structure(core: CoreContent, config: ChannelConfig = {}): AdaptedContent {
  const textMax = config.text_max_chars ?? DEFAULT_TEXT_MAX_CHARS;
  const captionMax = config.caption_max_chars ?? DEFAULT_CAPTION_MAX_CHARS;

  const card: TweetCardSlide = {
    index: 0,
    text: clampText(core.hook.written || core.hook.visual, textMax),
    ...(core.image_brief ? { image_brief: core.image_brief } : {}),
  };

  const caption = clampText(
    joinNonEmpty([
      blockContent(core, 4),
      blockContent(core, 5),
      blockContent(core, 6),
      blockContent(core, 7),
      ctaText(core),
    ]),
    captionMax,
  );

  return { channel_type: 'instagram_post', card, caption };
}

export const instagramPostAdapter: ChannelAdapter = {
  channel_type: 'instagram_post',
  limits: {
    chars: DEFAULT_TEXT_MAX_CHARS,
    caption_chars: DEFAULT_CAPTION_MAX_CHARS,
  },
  aspect_ratio: '4:5',                       // config pode trocar para 1:1
  structure,
  render_spec: { kind: 'tweet-card', layout: 'single', aspect_ratio: '4:5' },
  // Hashtags liberadas SOMENTE no lint da caption (campo de metadado do canal).
  lint_overrides: { allow_hashtags: true },
  cutoff_score: 8,
};
