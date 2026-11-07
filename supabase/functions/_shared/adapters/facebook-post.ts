// _shared/adapters/facebook-post.ts — foto + legenda (texto ≤ 5000).
// Fonte: docs/07-contratos-backend.md §6.
//
// Texto único com a narrativa completa (camadas 4-8, CTA por ponte lógica).

import type { AdaptedContent, ChannelConfig, CoreContent } from '../types.ts';
import {
  type ChannelAdapter,
  blockContent,
  clampText,
  ctaText,
  joinNonEmpty,
} from './base.ts';

const DEFAULT_TEXT_MAX_CHARS = 5000;

function structure(core: CoreContent, config: ChannelConfig = {}): AdaptedContent {
  const textMax = config.text_max_chars ?? DEFAULT_TEXT_MAX_CHARS;

  const text = clampText(
    joinNonEmpty([
      core.hook.written,
      blockContent(core, 4),
      blockContent(core, 5),
      blockContent(core, 6),
      blockContent(core, 7),
      ctaText(core),
    ]),
    textMax,
  );

  return {
    channel_type: 'facebook_post',
    text,
    ...(core.image_brief ? { image_brief: core.image_brief } : {}),
  };
}

export const facebookPostAdapter: ChannelAdapter = {
  channel_type: 'facebook_post',
  limits: { chars: DEFAULT_TEXT_MAX_CHARS },
  aspect_ratio: '1:1',
  structure,
  render_spec: { kind: 'image-caption' },
  cutoff_score: 8,
};
