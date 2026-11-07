// _shared/adapters/x-post.ts — texto ≤ 280 + thread opcional (base microblog).
// Fonte: docs/07-contratos-backend.md §6.
//
// Mapeamento funil: hook + virada + prova comprimidos no texto principal;
// thread opcional carrega ensino/moral; CTA na última unidade.

import type { AdaptedContent, ChannelConfig, CoreContent } from '../types.ts';
import { type ChannelAdapter, microblogMainText, microblogThread } from './base.ts';

const DEFAULT_TEXT_MAX_CHARS = 280;
const DEFAULT_THREAD_MAX_POSTS = 4;

function structure(core: CoreContent, config: ChannelConfig = {}): AdaptedContent {
  const chars = config.text_max_chars ?? DEFAULT_TEXT_MAX_CHARS;
  const maxPosts = config.thread_max_posts ?? DEFAULT_THREAD_MAX_POSTS;

  const text = microblogMainText(core, chars);
  const thread = microblogThread(core, chars, maxPosts);

  return {
    channel_type: 'x_post',
    text,
    ...(thread ? { thread } : {}),
    ...(core.image_brief ? { image_brief: core.image_brief } : {}),
  };
}

export const xPostAdapter: ChannelAdapter = {
  channel_type: 'x_post',
  limits: { chars: DEFAULT_TEXT_MAX_CHARS },
  aspect_ratio: '1:1',                       // imagem, quando houver
  structure,
  render_spec: { kind: 'image-caption' },
  cutoff_score: 8,
};
