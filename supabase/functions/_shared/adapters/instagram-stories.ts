// _shared/adapters/instagram-stories.ts — sequência de 3-6 frames 9:16.
// Fonte: docs/07-contratos-backend.md §6.
//
// Mapeamento funil → frames: 'gancho' = camadas 1-3 comprimidas;
// 'desenvolvimento' = camadas 4-6; 'cta' = camadas 7-8.

import type { AdaptedContent, ChannelConfig, CoreContent, StoryFrame } from '../types.ts';
import {
  type ChannelAdapter,
  blockContent,
  ctaText,
  joinNonEmpty,
  splitInHalf,
} from './base.ts';

const DEFAULT_FRAMES = { min: 3, max: 6 } as const;

function structure(core: CoreContent, config: ChannelConfig = {}): AdaptedContent {
  const frameLimits = config.frames ?? DEFAULT_FRAMES;

  // Gancho: camadas 1-3 comprimidas (o gancho visual vira brief da arte).
  const ganchoText = joinNonEmpty([core.hook.written, core.hook.spoken], '\n');
  const ganchoBrief = core.image_brief ?? (core.hook.visual.trim() || undefined);

  // Desenvolvimento: camadas 4-6, um frame por camada não vazia.
  let devTexts = [4, 5, 6]
    .map((layer) => blockContent(core, layer))
    .filter((t) => t.length > 0);

  // CTA: camadas 7-8 (moral + autoridade/CTA por ponte lógica).
  const ctaFrameText = joinNonEmpty([blockContent(core, 7), ctaText(core)]);

  // Acima do máximo → funde os desenvolvimentos excedentes no último frame dev.
  const maxDev = Math.max(frameLimits.max - 2, 1);
  if (devTexts.length > maxDev) {
    const kept = devTexts.slice(0, maxDev - 1);
    kept.push(devTexts.slice(maxDev - 1).join('\n\n'));
    devTexts = kept;
  }

  // Abaixo do mínimo → divide o desenvolvimento mais longo (fallback: gancho).
  while (devTexts.length + 2 < frameLimits.min) {
    const pool = devTexts.length > 0 ? devTexts : [ganchoText];
    let longestIdx = 0;
    for (let i = 1; i < pool.length; i++) {
      if (pool[i].length > pool[longestIdx].length) longestIdx = i;
    }
    const halves = splitInHalf(pool[longestIdx]);
    if (!halves) break;
    if (devTexts.length > 0) devTexts.splice(longestIdx, 1, halves[0], halves[1]);
    else devTexts = [halves[1]];
  }

  const frames: StoryFrame[] = [];
  frames.push({
    index: 0,
    role: 'gancho',
    text: ganchoText,
    ...(ganchoBrief ? { image_brief: ganchoBrief } : {}),
  });
  for (const text of devTexts) {
    frames.push({ index: frames.length, role: 'desenvolvimento', text });
  }
  frames.push({ index: frames.length, role: 'cta', text: ctaFrameText });

  return { channel_type: 'instagram_stories', frames };
}

export const instagramStoriesAdapter: ChannelAdapter = {
  channel_type: 'instagram_stories',
  limits: { frames: DEFAULT_FRAMES },
  aspect_ratio: '9:16',
  structure,
  render_spec: { kind: 'frames', aspect_ratio: '9:16' },
  cutoff_score: 7,
};
