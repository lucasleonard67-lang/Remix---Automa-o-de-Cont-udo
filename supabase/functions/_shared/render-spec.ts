// _shared/render-spec.ts — tipos do render_spec de cada adapter.
// Fonte: docs/07-contratos-backend.md §6 (união discriminada do render).
//
// Consumidos pelo FRONTEND (espelho em src/lib/engine-types.ts): o tweet-card é
// render determinístico client-side (componente React + tokens do brand_kit →
// PNG no browser); nenhuma edge function desenha card. O adapter apenas DEFINE
// o template via render_spec. Módulo puro: só tipos.

export type AspectRatio = '4:5' | '1:1' | '9:16';

export type RenderSpec =
  | { kind: 'tweet-card'; layout: 'single' | 'slides'; aspect_ratio: '4:5' | '1:1' }
  | { kind: 'frames'; aspect_ratio: '9:16' }
  | { kind: 'image-caption' }                // foto (IA opcional) + legenda, sem card
  | { kind: 'reel'; aspect_ratio: '9:16' };  // mp4 montado pelo pipeline de vídeo (11-video-replicate.md)

export type RenderKind = RenderSpec['kind'];
