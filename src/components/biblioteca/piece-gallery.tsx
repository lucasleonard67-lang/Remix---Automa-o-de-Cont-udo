import { useEffect, useRef, useState, type CSSProperties } from "react";

import { PieceTile } from "@/components/biblioteca/piece-tile";
import type { ContentPiece } from "@/hooks/use-content-pieces";
import { useTweetCardBrand } from "@/hooks/use-tweet-card-brand";
import { normalizeBrandKitContent, useActiveVersion } from "@/hooks/use-versioned-brand";

// ---------------------------------------------------------------------------
// Galeria da Biblioteca. A arte de cada peça é pesada, então a grade entra aos
// poucos, conforme a pessoa rola: a primeira leva pinta rápido, e nada some.
// ---------------------------------------------------------------------------

const LEVA = 24;

export const PIECE_GRID =
  "grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(210px,1fr))]";

export function PieceGallery({ pieces, search }: { pieces: ContentPiece[]; search: string }) {
  const brand = useTweetCardBrand();
  const art = normalizeBrandKitContent(useActiveVersion("brand_kit").data?.content ?? null).art;
  const [shown, setShown] = useState(LEVA);
  const fim = useRef<HTMLDivElement>(null);
  const falta = shown < pieces.length;

  // a busca filtra a mesma galeria: volta à primeira leva sem refazer a entrada
  useEffect(() => setShown(LEVA), [search]);

  // recria a cada leva: o observer só avisa em mudança, e o fim pode continuar à vista
  useEffect(() => {
    const node = fim.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setShown((n) => n + LEVA);
      },
      { rootMargin: "600px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [falta, shown]);

  return (
    <>
      <ol className={PIECE_GRID} data-testid="galeria-pecas" aria-label="Peças">
        {pieces.slice(0, shown).map((piece, index) => (
          <li
            key={piece.id}
            className="ce-reveal min-w-0"
            style={{ "--ce-reveal-delay": `${Math.min(index % LEVA, 8) * 60}ms` } as CSSProperties}
          >
            <PieceTile piece={piece} brand={brand} art={art} />
          </li>
        ))}
      </ol>
      {falta ? <div ref={fim} className="h-px" aria-hidden="true" /> : null}
    </>
  );
}
