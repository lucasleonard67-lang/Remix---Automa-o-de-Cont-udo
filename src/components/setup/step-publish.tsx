import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2, ThumbsUp } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { CarouselSlideRender } from "@/components/carousel-slide-render";
import { PublishBlock } from "@/components/publish-block";
import { TweetCardRender } from "@/components/tweet-card-render";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBrandAutopilotState } from "@/hooks/use-brand-autopilot";
import { CHANNEL_TYPE_LABELS } from "@/hooks/use-channels";
import {
  type ContentPiece,
  type StoryFrame,
  type TweetCardSlide,
  getAdaptedFields,
  isSamplePiece,
  pieceRowExcerpt,
  pieceShape,
  useContentPieces,
  useGenerateSlideImages,
  usePieceRealtime,
  useUpdatePieceStatus,
} from "@/hooks/use-content-pieces";
import { useSignedUrl } from "@/hooks/use-storage";
import { useTweetCardBrand } from "@/hooks/use-tweet-card-brand";
import { normalizeBrandKitContent, useActiveVersion } from "@/hooks/use-versioned-brand";
import { editorialPhotoIndexes } from "@/lib/carousel-editorial";
import { TWEET_CARD_DISPLAY_SIZES, type TweetCardAspect } from "@/lib/render-export";
import { toast } from "@/lib/toast";

// ---------------------------------------------------------------------------
// Passo 7 · Publicar: a peça que acabou de nascer no passo 6 (ou, sem ela, a
// mais recente pronta para sair — aprovada primeiro, senão a que espera
// revisão) e resolve dentro do fluxo: aprovar e publicar pelo PublishBlock.
// O stepper continua ali para voltar e mudar qualquer passo; abrir a peça
// inteira na Biblioteca fica como saída secundária.
// ---------------------------------------------------------------------------

/**
 * Só peças DESTA leitura da marca. Ler a marca de novo arquiva persona, voz e
 * regras antigas, mas as peças que elas geraram (inclusive as do teste de tom)
 * continuam na Biblioteca — e apareciam aqui como se fossem da marca nova.
 */
function pickPublishablePiece(
  pieces: ContentPiece[],
  prefer: string[],
  since: string | null,
): ContentPiece | null {
  const sinceMs = since ? Date.parse(since) : Number.NaN;
  // amostras do teste de tom nunca são "a sua peça", mesmo aprovadas
  const current = pieces.filter(
    (piece) =>
      !isSamplePiece(piece) && (Number.isNaN(sinceMs) || Date.parse(piece.created_at) >= sinceMs),
  );
  const mine = current.filter((piece) => prefer.includes(piece.id));
  const pool = mine.length ? mine : current;
  // o padrão da casa (carrossel) vem antes de qualquer outro formato do mesmo pedido
  const ordered = [...pool].sort(
    (a, b) =>
      Number(b.channel_type === "instagram_carousel") -
      Number(a.channel_type === "instagram_carousel"),
  );
  return (
    ordered.find((piece) => piece.status === "approved") ??
    ordered.find((piece) => piece.status === "draft") ??
    null
  );
}

export function StepPublish({
  preferPieceIds = [],
  onCreate,
}: {
  preferPieceIds?: string[];
  /** Sem peça desta marca: a única saída é criar (passo 6). */
  onCreate?: () => void;
}) {
  const pieces = useContentPieces();
  const updateStatus = useUpdatePieceStatus();
  const autopilot = useBrandAutopilotState();
  const piece = pickPublishablePiece(
    pieces.data ?? [],
    preferPieceIds,
    autopilot.data?.started_at ?? null,
  );

  // Carrossel editorial nasce só com texto; as fotos (capa + até 3 do miolo)
  // são pedidas aqui, sozinhas, assim que a peça aparece — a pessoa não tem
  // que saber que existe um botão na Biblioteca. Cada foto entra no slide
  // quando fica pronta (Realtime na peça).
  const generateSlides = useGenerateSlideImages();
  const queryClient = useQueryClient();
  const art = normalizeBrandKitContent(useActiveVersion("brand_kit").data?.content ?? null).art;
  const slides = useMemo(() => (piece ? (getAdaptedFields(piece).slides ?? []) : []), [piece]);
  const slideJob = piece ? getAdaptedFields(piece).slide_images_job : undefined;
  const running = slideJob?.status === "running";
  const editorialCarousel =
    piece?.channel_type === "instagram_carousel" && art.layout === "editorial";
  const semFotos = editorialCarousel && slides.length > 0 && slides.every((s) => !s.image_path);
  usePieceRealtime(piece?.id, { poll: Boolean(running) });
  const started = useRef<string | null>(null);
  useEffect(() => {
    if (!piece || !semFotos || running || slideJob?.status === "error") return;
    if (started.current === piece.id || generateSlides.isPending) return;
    started.current = piece.id;
    generateSlides.mutate(
      { pieceId: piece.id, slideIndexes: editorialPhotoIndexes(slides), composition: "inline" },
      {
        onError: (error) =>
          toast.error("Não foi possível gerar as fotos", { description: error.message }),
      },
    );
  }, [piece, semFotos, running, slideJob?.status, slides, generateSlides]);
  // a lista de peças não escuta o Realtime da peça: enquanto o lote roda,
  // relê a cada 4 s para as miniaturas ganharem as fotos
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(
      () => void queryClient.invalidateQueries({ queryKey: ["pieces"] }),
      4000,
    );
    return () => clearInterval(timer);
  }, [running, queryClient]);

  const approve = (target: ContentPiece) =>
    updateStatus.mutate(
      { pieceId: target.id, status: "approved" },
      {
        onSuccess: () => toast.success("Peça aprovada", { description: "Agora é só publicar." }),
        onError: (error) =>
          toast.retry("A peça não foi aprovada", {
            description: error.message,
            onRetry: () => approve(target),
          }),
      },
    );

  if (pieces.isLoading) return <Skeleton className="h-24 w-full rounded-xl" />;
  if (!piece) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-[var(--via-text-muted)]">
          Nenhuma peça desta marca ainda. As peças do teste de tom ficam na Biblioteca; a sua
          primeira peça é a que você escolher.
        </p>
        {onCreate ? <Button onClick={onCreate}>Criar a primeira peça</Button> : null}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <figure className="space-y-3">
        <figcaption className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--via-text-muted)]">
          {CHANNEL_TYPE_LABELS[piece.channel_type] ?? piece.channel_type}
          {pieceShape(piece) ? ` · ${pieceShape(piece)}` : ""}
        </figcaption>
        <PieceStrip piece={piece} />
        {running && slideJob ? (
          <p
            role="status"
            className="inline-flex items-center gap-1.5 text-xs tabular-nums text-[var(--via-text-muted)]"
          >
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            Gerando as fotos ({slideJob.done}/{slideJob.total})… cada uma entra no slide quando fica
            pronta.
          </p>
        ) : generateSlides.isPending ? (
          <p
            role="status"
            className="inline-flex items-center gap-1.5 text-xs text-[var(--via-text-muted)]"
          >
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            Pedindo as fotos do carrossel…
          </p>
        ) : null}
      </figure>

      {piece.status === "draft" ? (
        <Button onClick={() => approve(piece)} disabled={updateStatus.isPending}>
          {updateStatus.isPending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <ThumbsUp aria-hidden="true" />
          )}
          Aprovar
        </Button>
      ) : (
        <PublishBlock piece={piece} />
      )}

      <p className="text-xs text-[var(--via-text-faint)]">
        Quer ajustar antes?{" "}
        <Link
          to="/biblioteca/$pieceId"
          params={{ pieceId: piece.id }}
          className="text-[var(--via-text-muted)] underline underline-offset-4 hover:text-[var(--via-text-primary)]"
        >
          Abrir a peça inteira
        </Link>
      </p>
    </div>
  );
}

// ── Prévia: os slides da peça lado a lado, no mesmo desenho da Biblioteca ──

/** Largura da miniatura; o render nasce em 540px e encolhe por escala. */
/** 4:5 e 1:1 a 132px; 9:16 mais estreito (96px) para a tira ler como Stories, não como grade de Reels. */
const THUMB_WIDTH: Record<TweetCardAspect, number> = { "4:5": 132, "1:1": 132, "9:16": 96 };

function PieceStrip({ piece }: { piece: ContentPiece }) {
  const brand = useTweetCardBrand();
  const art = normalizeBrandKitContent(useActiveVersion("brand_kit").data?.content ?? null).art;
  const adapted = getAdaptedFields(piece);
  const isCarousel = piece.channel_type === "instagram_carousel";
  const aspect: TweetCardAspect = piece.channel_type === "instagram_stories" ? "9:16" : "4:5";
  const units: Array<TweetCardSlide | StoryFrame> = isCarousel
    ? [...(adapted.slides ?? [])].sort((a, b) => a.index - b.index)
    : piece.channel_type === "instagram_stories"
      ? [...(adapted.frames ?? [])].sort((a, b) => a.index - b.index)
      : adapted.card
        ? [adapted.card]
        : [];

  // Sem arte (thread, LinkedIn, X em texto, Reel): o começo do texto.
  if (units.length === 0) {
    return (
      <blockquote className="line-clamp-4 border-l-2 border-[var(--via-navy)] pl-4 text-sm leading-relaxed text-[var(--via-text-primary)]">
        {pieceRowExcerpt(piece)}
      </blockquote>
    );
  }

  const { width, height } = TWEET_CARD_DISPLAY_SIZES[aspect];
  const thumb = THUMB_WIDTH[aspect];
  const scale = thumb / width;
  return (
    <ol className="-mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pb-2" aria-label="Prévia da peça">
      {units.map((unit, index) => (
        <li
          key={unit.index}
          className="relative shrink-0 snap-start overflow-hidden rounded-[10px] shadow-[var(--via-shadow-md)]"
          style={{ width: thumb, height: height * scale }}
        >
          <div
            className="pointer-events-none absolute left-0 top-0 origin-top-left"
            style={{ width, height, transform: `scale(${scale})` }}
            aria-hidden="true"
          >
            <UnitRender
              unit={unit}
              index={index}
              total={units.length}
              format={
                isCarousel
                  ? "carousel"
                  : piece.channel_type === "instagram_stories"
                    ? "story"
                    : "post"
              }
              aspect={aspect}
              brand={brand}
              art={art}
            />
          </div>
          <span className="sr-only">{unit.text}</span>
        </li>
      ))}
    </ol>
  );
}

function UnitRender({
  unit,
  index,
  total,
  format,
  aspect,
  brand,
  art,
}: {
  unit: TweetCardSlide | StoryFrame;
  index: number;
  total: number;
  format: "carousel" | "story" | "post";
  aspect: TweetCardAspect;
  brand: ReturnType<typeof useTweetCardBrand>;
  art: ReturnType<typeof normalizeBrandKitContent>["art"];
}) {
  const imageUrl = useSignedUrl("renders", unit.image_path ?? null).data ?? null;
  // carrossel sempre; Stories e Post também, quando a marca usa o editorial
  return format === "carousel" || art.layout === "editorial" ? (
    <CarouselSlideRender
      format={format}
      text={unit.text}
      brand={brand}
      aspect={aspect}
      index={index}
      total={total}
      imageUrl={imageUrl}
      photoPromoted={"photo_promoted" in unit ? unit.photo_promoted : false}
      artRendered={"cover_art_rendered" in unit ? unit.cover_art_rendered : false}
      art={art}
      slide={unit as TweetCardSlide}
    />
  ) : (
    <TweetCardRender
      text={unit.text}
      brand={brand}
      aspect={aspect}
      imageUrl={imageUrl}
      background="brand"
      imagePlaceholder={Boolean(unit.image_brief) && !unit.image_path}
    />
  );
}
