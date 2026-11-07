// _shared/adapters/linkedin-post.ts — post com estrutura de 6 blocos.
// Fonte: docs/07-contratos-backend.md §6.
//
// Mapeamento funil → blocos: hook ← camadas 1-3 (gancho escrito); contexto ← 4;
// lista/insight ← 5-6 (lista = sentenças do ensino+prova; insight = virada);
// ponte ← 7 (moral aterrissa a ponte lógica); cta ← 8 + CTA da peça.
// text é a serialização final dos blocks (≤ 3000 chars).

import type { AdaptedContent, ChannelConfig, CoreContent } from '../types.ts';
import {
  type ChannelAdapter,
  blockContent,
  clampText,
  ctaText,
  joinNonEmpty,
  splitSentences,
} from './base.ts';

const DEFAULT_TEXT_MAX_CHARS = 3000;
const MAX_LIST_ITEMS = 5;

function structure(core: CoreContent, config: ChannelConfig = {}): AdaptedContent {
  const textMax = config.text_max_chars ?? DEFAULT_TEXT_MAX_CHARS;

  const blocks = {
    hook: core.hook.written.trim(),
    contexto: blockContent(core, 4),
    lista: splitSentences(blockContent(core, 6)).slice(0, MAX_LIST_ITEMS),
    insight: blockContent(core, 5),
    ponte: blockContent(core, 7),
    cta: ctaText(core),
  };

  const text = clampText(
    joinNonEmpty([
      blocks.hook,
      blocks.contexto,
      blocks.lista.map((item) => `• ${item}`).join('\n'),
      blocks.insight,
      blocks.ponte,
      blocks.cta,
    ]),
    textMax,
  );

  return {
    channel_type: 'linkedin_post',
    blocks,
    text,
    ...(core.image_brief ? { image_brief: core.image_brief } : {}),
  };
}

export const linkedinPostAdapter: ChannelAdapter = {
  channel_type: 'linkedin_post',
  limits: { chars: DEFAULT_TEXT_MAX_CHARS },
  aspect_ratio: '1:1',
  structure,
  render_spec: { kind: 'image-caption' },
  cutoff_score: 9,
};
