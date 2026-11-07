// Catálogo de formatos do criador (sem JSX): nome curto, ordem de leitura e
// o que sai de cada um. Compartilhado pelos chips da home e pelos ladrilhos
// de /criar.

import { CHANNEL_TYPES, type ChannelType } from "@/hooks/use-channels";
import type { CarouselArt } from "@/lib/carousel-art";
import type { TweetCardAspect } from "@/lib/render-export";

/** Nome curto do formato (o catálogo tem o nome completo, "Instagram Post"). */
export const FORMAT_LABELS: Record<ChannelType, string> = {
  instagram_post: "Post",
  instagram_carousel: "Carrossel",
  instagram_stories: "Stories",
  instagram_reel: "Reel",
  x_post: "X",
  threads_post: "Threads",
  linkedin_post: "LinkedIn",
  facebook_post: "Facebook",
};

/** Ordem de leitura: Instagram primeiro (post → carrossel → stories → reel). */
export const FORMAT_ORDER: readonly ChannelType[] = [
  "instagram_post",
  "instagram_carousel",
  "instagram_stories",
  "instagram_reel",
  ...CHANNEL_TYPES.filter((type) => !type.startsWith("instagram_")),
];

/** Formatos estáticos (peça de texto/arte): o Reel é vídeo e vive no hub. */
export const STATIC_FORMATS: readonly ChannelType[] = FORMAT_ORDER.filter(
  (type) => type !== "instagram_reel",
);

/** Faixa do que sai, espelhando os adapters (_shared/adapters/*) e o caminho
 * editorial (_shared/editorial-carousel.ts); `channels.config` sobrescreve. */
type Range = { min: number; max: number };

function readRange(value: unknown): Range | null {
  if (!value || typeof value !== "object") return null;
  const { min, max } = value as Record<string, unknown>;
  return typeof min === "number" && typeof max === "number" ? { min, max } : null;
}

function readAspect(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return fallback;
}

const span = ({ min, max }: Range) => (min === max ? `${min}` : `${min}–${max}`);

/** O que você recebe, curto: "7–10 slides 4:5", "1 imagem 4:5", "post + thread de até 4". */
export function formatYield(
  type: ChannelType,
  config: Record<string, unknown> | null | undefined,
  art: CarouselArt,
): string {
  const c = config ?? {};
  const editorial = art.layout === "editorial";
  switch (type) {
    case "instagram_carousel": {
      // editorial: capa + 6 a 8 de miolo + fecho
      const slides = readRange(c.slides) ?? (editorial ? { min: 8, max: 10 } : { min: 7, max: 10 });
      return `${span(slides)} slides ${readAspect(c.aspect_ratio, "4:5")}`;
    }
    case "instagram_stories": {
      const frames = readRange(c.frames) ?? (editorial ? { min: 4, max: 5 } : { min: 3, max: 6 });
      return `${span(frames)} telas 9:16`;
    }
    case "instagram_post":
      return `1 imagem ${readAspect(c.aspect_ratio, "4:5")}`;
    case "x_post":
    case "threads_post": {
      const max = typeof c.thread_max_posts === "number" ? c.thread_max_posts : 4;
      return `Post + thread de até ${max}`;
    }
    case "linkedin_post":
      return `Texto + card ${readAspect(c.aspect_ratio, "1:1")}`;
    case "facebook_post":
      return `Texto + imagem ${readAspect(c.aspect_ratio, "1:1")}`;
    case "instagram_reel":
      return "Vídeo 9:16";
  }
}

/** Tempo típico de geração (texto + arte), arredondado para cima. */
export const FORMAT_MINUTES: Record<ChannelType, number> = {
  instagram_carousel: 3,
  instagram_stories: 2,
  instagram_post: 1,
  instagram_reel: 5,
  x_post: 1,
  threads_post: 1,
  linkedin_post: 1,
  facebook_post: 1,
};

/** Proporção da peça: o ladrilho centraliza a amostra no mesmo quadro 4:5. */
export function previewAspect(type: ChannelType, art: CarouselArt): TweetCardAspect {
  if (type === "instagram_stories") return "9:16";
  if (type === "x_post" || type === "threads_post" || type === "linkedin_post") return "1:1";
  if (type === "instagram_post" && art.layout !== "editorial") return "1:1";
  return "4:5";
}
