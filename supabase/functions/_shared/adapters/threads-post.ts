// _shared/adapters/threads-post.ts — idem X com limites próprios (≤ 500).
// Fonte: docs/07-contratos-backend.md §6.

import type { AdaptedContent, ChannelConfig, CoreContent } from '../types.ts';
import { type ChannelAdapter, microblogMainText, microblogThread } from './base.ts';

const DEFAULT_TEXT_MAX_CHARS = 500;
const DEFAULT_THREAD_MAX_POSTS = 4;

function structure(core: CoreContent, config: ChannelConfig = {}): AdaptedContent {
  const chars = config.text_max_chars ?? DEFAULT_TEXT_MAX_CHARS;
  const maxPosts = config.thread_max_posts ?? DEFAULT_THREAD_MAX_POSTS;

  const text = microblogMainText(core, chars);
  const thread = microblogThread(core, chars, maxPosts);

  return {
    channel_type: 'threads_post',
    text,
    ...(thread ? { thread } : {}),
    ...(core.image_brief ? { image_brief: core.image_brief } : {}),
  };
}

export const threadsPostAdapter: ChannelAdapter = {
  channel_type: 'threads_post',
  limits: { chars: DEFAULT_TEXT_MAX_CHARS },
  aspect_ratio: '1:1',
  structure,
  render_spec: { kind: 'image-caption' },
  cutoff_score: 8,
};
