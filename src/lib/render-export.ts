import { toBlob } from "html-to-image";

// ---------------------------------------------------------------------------
// Export PNG do tweet-card (docs/05 §4.2 — "Baixar PNG" client-side).
// O node renderizado em tela tem o tamanho de display; o canvas de saída é
// fixado em 1080px de largura (padrão das plataformas) por aspect.
// ---------------------------------------------------------------------------

export type TweetCardAspect = "4:5" | "1:1" | "9:16";

/** Tamanho do node em tela (base do TweetCardRender, antes da escala CSS). */
export const TWEET_CARD_DISPLAY_SIZES: Record<TweetCardAspect, { width: number; height: number }> =
  {
    "4:5": { width: 540, height: 675 },
    "1:1": { width: 540, height: 540 },
    "9:16": { width: 540, height: 960 },
  };

/** Tamanho do PNG exportado (2x o display — 1080px de largura). */
export const EXPORT_SIZES: Record<TweetCardAspect, { width: number; height: number }> = {
  "4:5": { width: 1080, height: 1350 },
  "1:1": { width: 1080, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
};

/** Elementos com `data-export-exclude` ficam fora do PNG (ex.: placeholder). */
function exportFilter(node: HTMLElement): boolean {
  return !(node instanceof HTMLElement && node.dataset?.exportExclude !== undefined);
}

export interface ExportNodeToPngOptions {
  aspect: TweetCardAspect;
  /** Fallback de escala quando canvasWidth/Height não se aplicarem. */
  pixelRatio?: number;
  /**
   * Permite a segunda tentativa com `skipFonts`. Só é seguro quando a arte usa
   * a pilha de fontes do sistema (tweet-card, pele Casa). Uma pele com
   * tipografia própria — Bungee, VT323, Alfa Slab One — sairia com fonte
   * trocada e ninguém veria: aí é melhor propagar o erro. Default: true.
   */
  allowFontFallback?: boolean;
}

/**
 * Exporta o node como PNG determinístico. `canvasWidth/Height` fixam o tamanho
 * de saída por aspect; se o embed de fontes falhar (CSS cross-origin sem
 * CORS), tenta de novo com `skipFonts` — MAS só quando o chamador garante que
 * a arte não depende de fonte carregada (`allowFontFallback`).
 */
export async function exportNodeToPng(
  node: HTMLElement,
  options: ExportNodeToPngOptions,
): Promise<Blob> {
  const { width, height } = EXPORT_SIZES[options.aspect];
  const base = {
    // canvasWidth/Height JÁ são a saída final (1080px = padrão das
    // plataformas); com pixelRatio 2 o PNG saía 2160×2700 e 6 MB.
    pixelRatio: options.pixelRatio ?? 1,
    canvasWidth: width,
    canvasHeight: height,
    cacheBust: true,
    filter: exportFilter,
  };
  try {
    const blob = await toBlob(node, base);
    if (!blob) throw new Error("Canvas vazio.");
    return blob;
  } catch (error) {
    if (options.allowFontFallback === false) {
      throw new Error(
        `A arte usa tipografia própria e as fontes não puderam ser embutidas no PNG: ${
          error instanceof Error ? error.message : "falha no embed de fontes"
        }`,
      );
    }
    const blob = await toBlob(node, { ...base, skipFonts: true });
    if (!blob) throw new Error("Não foi possível gerar o PNG do card.");
    return blob;
  }
}

/** Dispara o download do blob no navegador. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Pacote do carrossel — ZIP com as N artes (01.png…NN.png) + legenda.txt
// ---------------------------------------------------------------------------

export interface CarouselZipSlide {
  index: number;
  blob: Blob;
}

/**
 * Monta o ZIP do carrossel: artes numeradas na ordem de publicação
 * (01.png, 02.png…) + legenda.txt quando houver caption. Import dinâmico do
 * jszip — só carrega a lib quando o usuário exporta.
 */
export async function buildCarouselZip(
  slides: CarouselZipSlide[],
  caption: string | null | undefined,
): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const ordered = [...slides].sort((a, b) => a.index - b.index);
  ordered.forEach((slide, position) => {
    const name = `${String(position + 1).padStart(2, "0")}.png`;
    zip.file(name, slide.blob);
  });
  if (caption?.trim()) {
    zip.file("legenda.txt", caption.trim());
  }
  return await zip.generateAsync({ type: "blob" });
}
