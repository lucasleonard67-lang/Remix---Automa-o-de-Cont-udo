import type { CatalogExperience } from "@/hooks/use-video-models";
import { HUB_PROVIDER_LABEL } from "@/lib/video-hub";

// ---------------------------------------------------------------------------
// Exemplos do hub de vídeo: cada experiência mostra um vídeo público feito
// pelos provedores com quem trabalhamos (Replicate, Higgsfield, HeyGen),
// servido do CDN deles. Nada de vídeo da marca nem de banco de imagens.
// Toda URL abaixo foi conferida (200, video/mp4 ou image/jpeg) em 2026-10-30.
// Sem exemplo → a tela desenha o quadro neutro com o nome do modelo.
// ---------------------------------------------------------------------------

export type HubExampleProvider = "replicate" | "higgsfield" | "heygen";

export interface HubExample {
  provider: HubExampleProvider;
  /** nome do modelo/recurso do provedor que fez o vídeo */
  model: string;
  /** mp4 público no CDN do provedor */
  video_url: string;
  poster_url?: string;
  /** página do modelo no provedor (abre em nova aba) */
  source_url: string;
}

// HeyGen serve pelo ImageKit: `tr:w-540,q-60,du-10` corta para 10 s em 540 px
// (o original passa de 20 MB); `/ik-thumbnail.jpg` é o 1º quadro.
const HEYGEN = "https://dynamic.heygen.ai";
const heygenVideo = (path: string, width = 540) => `${HEYGEN}/tr:w-${width},q-60,du-10/www/${path}`;
const heygenPoster = (path: string, width = 540) =>
  `${HEYGEN}/tr:w-${width}/www/${path}/ik-thumbnail.jpg`;

export const HUB_EXAMPLES: Readonly<Partial<Record<CatalogExperience, HubExample>>> = {
  scenes: {
    provider: "replicate",
    model: "Kling 4.0",
    video_url:
      "https://tjzk.replicate.delivery/models_models_featured_image/f8d48df0-4af0-45c3-9862-326269c32316/replicate-prediction-wb8rq3a4f.mp4",
    source_url: "https://replicate.com/kwaivgi/kling-v4.0",
  },
  presenter_in_scenes: {
    provider: "higgsfield",
    model: "Seedance 2.5",
    video_url: "https://static.higgsfield.ai/seedance-2.5/v2/examples/example-916.mp4",
    source_url: "https://higgsfield.ai/seedance-2.5",
  },
  avatar_script: {
    provider: "heygen",
    model: "Avatares",
    video_url: heygenVideo("video/kenneth-legal_ZxHNhN9Kx.mp4"),
    poster_url: heygenPoster("video/kenneth-legal_ZxHNhN9Kx.mp4"),
    source_url: "https://www.heygen.com/avatars",
  },
  photo_presenter: {
    provider: "heygen",
    model: "Photo Avatar",
    video_url: heygenVideo("Translate-rebrand/Photo-Avatars-Hero.mp4"),
    poster_url: heygenPoster("Translate-rebrand/Photo-Avatars-Hero.mp4"),
    source_url: "https://www.heygen.com/photo-avatar",
  },
  digital_twin: {
    provider: "heygen",
    model: "Avatar com voz clonada",
    video_url: heygenVideo("video/Jared_CC_qUCGsmhRQ.mp4"),
    poster_url: heygenPoster("video/Jared_CC_qUCGsmhRQ.mp4"),
    source_url: "https://www.heygen.com/avatars",
  },
  idea_to_video: {
    provider: "heygen",
    model: "Video Agent",
    // original 2:1; mais largo para o recorte 9:16 não ficar borrado
    video_url: heygenVideo("Agent/carousel/agent-carousel.mp4", 960),
    poster_url: heygenPoster("Agent/carousel/agent-carousel.mp4", 960),
    source_url: "https://www.heygen.com/video-agent",
  },
  change_speech: {
    provider: "replicate",
    model: "Lipsync Precision",
    video_url:
      "https://replicate.delivery/xezq/OHcEEM5EkP48JtVnmKnlPWYAjZAtw6tZ8YfRhWoHc2hfuCcWA/tmp_2o2au6z.mp4",
    source_url: "https://replicate.com/heygen/lipsync-precision",
  },
  translate: {
    provider: "heygen",
    model: "Tradução",
    video_url: heygenVideo("video/Jack_French_YRTUxnnrR.mp4"),
    poster_url: heygenPoster("video/Jack_French_YRTUxnnrR.mp4"),
    source_url: "https://www.heygen.com/translate",
  },
  restyle: {
    provider: "replicate",
    model: "Aleph 2",
    video_url:
      "https://replicate.delivery/xezq/jtjw0NVscp67AFfY9tUfFihm9JixfpVQOu34DWV29JNsf7taB/tmpl_glajgl.mp4",
    source_url: "https://replicate.com/runwayml/aleph-2",
  },
  person_swap: {
    provider: "replicate",
    model: "P-Video Replace",
    video_url:
      "https://replicate.delivery/xezq/UseVXFMaWWwoKyUraOCeRkrjflzgXadpgi45taib1nHca8MtA/tmpvbo2bkhz.mp4",
    source_url: "https://replicate.com/prunaai/p-video-replace",
  },
  captions: {
    provider: "heygen",
    model: "Legendas",
    video_url: heygenVideo("video/tracy_cc_4_k_VZAWRZwFN.mp4"),
    poster_url: heygenPoster("video/tracy_cc_4_k_VZAWRZwFN.mp4"),
    source_url: "https://www.heygen.com",
  },
  reframe_upscale: {
    provider: "replicate",
    model: "Luma Reframe",
    video_url:
      "https://replicate.delivery/xezq/KSUvcJrFAHJ0IhsvD8eew2AvOesvFl85CqLfzjaMiaBfMfbNF/tmp5e959bwx.mp4",
    source_url: "https://replicate.com/luma/reframe-video",
  },
};

/** O exemplo da experiência, ou null (a tela mostra o quadro neutro). */
export function exampleFor(experience: CatalogExperience): HubExample | null {
  return HUB_EXAMPLES[experience] ?? null;
}

/** "Exemplo · Replicate · Kling 4.0" */
export function exampleCaption(example: HubExample): string {
  return `Exemplo · ${HUB_PROVIDER_LABEL[example.provider]} · ${example.model}`;
}
