import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { CarouselSlideRender } from "@/components/carousel-slide-render";
import { TweetCardRender, type TweetCardBrand } from "@/components/tweet-card-render";
import type { ContentPiece } from "@/hooks/use-content-pieces";
import { useSignedUrl } from "@/hooks/use-storage";
import type { CarouselArt } from "@/lib/carousel-art";
import { coverPlan, type CoverPlan, type CoverUnit } from "@/lib/piece-cover";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Capa de uma peça na Biblioteca: a própria arte, no renderer do detalhe.
// Ocupa o quadro que o pai define; só pesa quando aparece na tela.
// A grade nunca traz arquivo de volta do Drive nem conta como uso: arquivada, a
// capa usa o texto.
// ---------------------------------------------------------------------------

const BUCKET = "renders";
const PREVIEW = { preview: true };
/** Antecipa a rolagem: a capa chega pronta sem carregar a grade inteira. */
const SEEN_MARGIN = "300px";
const SLIDE_MS = 1800;
/** Fora do zero: o Safari só pinta o primeiro quadro depois de um seek. */
const FIRST_FRAME_S = 0.1;

const LAYER =
  "absolute inset-0 flex items-center justify-center transition-opacity duration-[var(--via-dur)] ease-[var(--via-ease-out)]";

export interface PieceCoverProps {
  piece: ContentPiece;
  brand: TweetCardBrand;
  art: CarouselArt;
  /** Mouse ou foco no card: o Reel toca mudo, o carrossel passa os slides. */
  active?: boolean;
  className?: string;
}

/** Vale uma vez: a capa que apareceu fica montada ao voltar a rolagem. */
function useSeen<T extends Element>() {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setSeen(true);
        observer.disconnect();
      },
      { rootMargin: SEEN_MARGIN },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, seen };
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return reduced;
}

/**
 * Confere a foto antes de entregar ao renderer: ele não sabe cair no texto, e
 * trocar a foto depois faria a arte medir e saltar na grade.
 */
function useCheckedImage(url: string | undefined): { settled: boolean; src: string | null } {
  const [result, setResult] = useState<{ url: string; ok: boolean } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => live && setResult({ url, ok: true });
    image.onerror = () => live && setResult({ url, ok: false });
    image.src = url;
    return () => {
      live = false;
    };
  }, [url]);
  if (!url || result?.url !== url) return { settled: false, src: null };
  return { settled: true, src: result.ok ? url : null };
}

function TextCover({
  plan,
  brand,
}: {
  plan: Pick<Extract<CoverPlan, { kind: "text" }>, "text" | "photo" | "surface">;
  brand: TweetCardBrand;
}) {
  const url = useSignedUrl(BUCKET, plan.photo, 3600, PREVIEW);
  const image = useCheckedImage(url.data);
  if (plan.photo && !url.isError && !image.settled) return null;
  return (
    <TweetCardRender
      text={plan.text}
      brand={brand}
      aspect="4:5"
      imageUrl={image.src}
      background={plan.surface}
    />
  );
}

function VideoCover({
  plan,
  brand,
  active,
}: {
  plan: Extract<CoverPlan, { kind: "video" }>;
  brand: TweetCardBrand;
  active: boolean;
}) {
  const reduced = useReducedMotion();
  const url = useSignedUrl(BUCKET, plan.path, 3600, PREVIEW);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);
  const playing = active && !reduced;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      void video.play().catch(() => undefined);
      return;
    }
    video.pause();
    if (video.currentTime > FIRST_FRAME_S) video.currentTime = FIRST_FRAME_S;
  }, [playing, url.data]);

  if (failed || url.isError) {
    return <TextCover plan={{ text: plan.text, photo: null, surface: "brand" }} brand={brand} />;
  }
  if (!url.data) return null;
  return (
    <video
      ref={videoRef}
      src={`${url.data}#t=${FIRST_FRAME_S}`}
      muted
      loop
      playsInline
      preload="metadata"
      tabIndex={-1}
      onError={() => setFailed(true)}
      className="size-full object-contain"
    />
  );
}

function LiveUnit({
  unit,
  plan,
  total,
  position,
  brand,
  art,
}: {
  unit: CoverUnit;
  plan: Extract<CoverPlan, { kind: "deck" }>;
  total: number;
  position: number;
  brand: TweetCardBrand;
  art: CarouselArt;
}) {
  const url = useSignedUrl(BUCKET, unit.photo, 3600, PREVIEW);
  const image = useCheckedImage(url.data);
  if (unit.photo && !url.isError && !image.settled) return null;

  if (plan.renderer === "tweet") {
    const background = plan.composition === "background";
    return (
      <TweetCardRender
        text={unit.text}
        brand={brand}
        aspect={plan.aspect}
        imageUrl={image.src}
        imageMode={background ? "background" : "inline"}
        background={background ? "plain" : "brand"}
      />
    );
  }
  return (
    <CarouselSlideRender
      format={plan.format}
      text={unit.text}
      brand={brand}
      aspect={plan.aspect}
      index={position}
      total={total}
      imageUrl={image.src}
      photoPromoted={unit.promoted}
      artRendered={unit.artRendered}
      art={art}
      slide={unit.slide}
    />
  );
}

function CoverUnitView({ unit, live }: { unit: CoverUnit; live: ReactNode }) {
  const url = useSignedUrl(BUCKET, unit.render, 3600, PREVIEW);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (!unit.render || failed || url.isError) return live;
  if (!url.data) return null;
  return (
    <img
      src={url.data}
      alt=""
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
      className={cn(
        "size-full object-contain transition-opacity duration-[var(--via-dur)] ease-[var(--via-ease-out)]",
        loaded ? "opacity-100" : "opacity-0",
      )}
    />
  );
}

function DeckCover({
  plan,
  brand,
  art,
  active,
}: {
  plan: Extract<CoverPlan, { kind: "deck" }>;
  brand: TweetCardBrand;
  art: CarouselArt;
  active: boolean;
}) {
  const reduced = useReducedMotion();
  const total = plan.units.length;
  const moving = active && !reduced && total > 1;
  const [step, setStep] = useState(0);
  // monta um slide à frente: a troca nunca revela um quadro ainda vazio
  const [reach, setReach] = useState(1);

  useEffect(() => {
    if (!moving) {
      setStep(0);
      return;
    }
    const timer = setInterval(() => setStep((current) => (current + 1) % total), SLIDE_MS);
    return () => clearInterval(timer);
  }, [moving, total]);

  useEffect(() => {
    if (moving) setReach((current) => Math.max(current, Math.min(total, step + 2)));
  }, [moving, step, total]);

  return plan.units.slice(0, reach).map((unit, position) => (
    <div key={unit.index} className={cn(LAYER, position === step ? "opacity-100" : "opacity-0")}>
      <div
        className="h-full max-w-full min-w-0"
        style={{ aspectRatio: plan.aspect.replace(":", " / ") }}
      >
        <CoverUnitView
          unit={unit}
          live={
            <LiveUnit
              unit={unit}
              plan={plan}
              total={total}
              position={position}
              brand={brand}
              art={art}
            />
          }
        />
      </div>
    </div>
  ));
}

export function PieceCover({ piece, brand, art, active = false, className }: PieceCoverProps) {
  const { ref, seen } = useSeen<HTMLDivElement>();
  const plan = useMemo(() => coverPlan(piece, art), [piece, art]);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-testid="piece-cover"
      data-cover={plan.kind}
      className={cn(
        "pointer-events-none relative block size-full overflow-hidden bg-[var(--via-navy-04)]",
        className,
      )}
    >
      {!seen ? null : plan.kind === "deck" ? (
        <DeckCover plan={plan} brand={brand} art={art} active={active} />
      ) : plan.kind === "video" ? (
        <VideoCover plan={plan} brand={brand} active={active} />
      ) : (
        <TextCover plan={plan} brand={brand} />
      )}
    </div>
  );
}
