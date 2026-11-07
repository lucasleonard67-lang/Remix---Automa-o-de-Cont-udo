import type { CarouselArt } from "@/lib/carousel-art";
import type { TweetCardAspect } from "@/lib/render-export";
import {
  getAdaptedFields,
  pieceHeadline,
  type AdaptedFields,
  type ContentPiece,
  type SlideImageComposition,
  type SlideRender,
  type TweetCardSlide,
} from "@/hooks/use-content-pieces";

// ---------------------------------------------------------------------------
// O que a capa de uma peça mostra. Mesma escolha do detalhe da peça: o PNG
// final quando existe, senão o renderer do formato, senão o texto. Em revisão
// o texto ainda muda e o PNG não acompanha, então a capa pinta do texto.
// ---------------------------------------------------------------------------

/** Um slide, quadro ou card. `render` é o PNG final; `photo`, a foto de entrada. */
export interface CoverUnit {
  index: number;
  text: string;
  render: string | null;
  photo: string | null;
  promoted: boolean;
  artRendered: boolean;
  slide?: TweetCardSlide;
}

export type CoverPlan =
  | {
      kind: "deck";
      renderer: "chassis" | "tweet";
      format: "carousel" | "story" | "post";
      aspect: TweetCardAspect;
      composition: SlideImageComposition;
      units: CoverUnit[];
    }
  | { kind: "video"; path: string; text: string }
  | { kind: "text"; text: string; photo: string | null; surface: "plain" | "brand" };

/** No quadro da galeria, além disso a letra some. */
const TEXT_MAX = 280;

type DeckSource = {
  index: number;
  text?: string;
  image_path?: string;
  photo_promoted?: boolean;
  cover_art_rendered?: boolean;
};

function path(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function byIndex<T extends { index: number }>(items: T[] | undefined): T[] {
  return Array.isArray(items) ? [...items].sort((a, b) => a.index - b.index) : [];
}

function toUnits(
  sources: DeckSource[],
  adapted: AdaptedFields,
  renderOf: (index: number) => string | null,
): CoverUnit[] {
  // peça antiga tem uma imagem só, em adapted_content.image_path
  const legacyPhoto = path(adapted.image_path);
  const units = sources.map((source) => ({
    index: source.index,
    text: shortText(source.text ?? ""),
    render: renderOf(source.index),
    photo: path(source.image_path) ?? legacyPhoto,
    promoted: source.photo_promoted === true,
    artRendered: source.cover_art_rendered === true,
    slide: source as TweetCardSlide,
  }));
  return units.filter((unit) => unit.text.trim() || unit.render);
}

/** Texto da própria peça, para os canais de texto e para quando a arte falha. */
export function coverText(piece: ContentPiece): string {
  const adapted = getAdaptedFields(piece);
  const beats = byIndex(adapted.script?.beats)
    .map((beat) => beat.narration?.trim())
    .filter(Boolean);
  const text = beats.join("\n\n") || adapted.text?.trim() || adapted.blocks?.hook?.trim();
  return text || pieceHeadline(piece);
}

function shortText(text: string): string {
  if (text.length <= TEXT_MAX) return text;
  const cut = text.slice(0, TEXT_MAX);
  const space = cut.lastIndexOf(" ");
  return `${space > 0 ? cut.slice(0, space) : cut}…`;
}

export function coverPlan(piece: ContentPiece, art: CarouselArt): CoverPlan {
  const adapted = getAdaptedFields(piece);
  const text = shortText(coverText(piece));
  const fallback: CoverPlan = {
    kind: "text",
    text,
    photo: path(adapted.image_path),
    // mesmo fundo da amostra de cada formato em /criar
    surface:
      piece.channel_type === "x_post" || piece.channel_type === "threads_post" ? "plain" : "brand",
  };
  const renders: SlideRender[] = Array.isArray(adapted.slide_renders) ? adapted.slide_renders : [];
  const editing = piece.status === "draft";
  const deckRender = (index: number) =>
    editing ? null : path(renders.find((render) => render.index === index)?.path);
  const composition = adapted.slide_images_job?.composition ?? "inline";
  const editorial = art.layout === "editorial";

  switch (piece.channel_type) {
    case "instagram_reel": {
      const video = path(adapted.video?.path);
      return video ? { kind: "video", path: video, text } : fallback;
    }
    case "instagram_carousel": {
      const units = toUnits(byIndex(adapted.slides), adapted, deckRender);
      if (units.length === 0) return fallback;
      return {
        kind: "deck",
        renderer: "chassis",
        format: "carousel",
        aspect: "4:5",
        composition,
        units,
      };
    }
    case "instagram_stories": {
      const units = toUnits(byIndex(adapted.frames), adapted, deckRender);
      if (units.length === 0) return fallback;
      return {
        kind: "deck",
        renderer: editorial ? "chassis" : "tweet",
        format: "story",
        aspect: "9:16",
        composition,
        units,
      };
    }
    case "instagram_post": {
      if (!adapted.card) return fallback;
      const units = toUnits([adapted.card], adapted, () =>
        editing ? null : path(piece.render_path),
      );
      if (units.length === 0) return fallback;
      return {
        kind: "deck",
        renderer: editorial ? "chassis" : "tweet",
        format: "post",
        aspect: "4:5",
        composition,
        units,
      };
    }
    default:
      return fallback;
  }
}
