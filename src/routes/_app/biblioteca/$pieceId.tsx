import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import {
  Archive,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ImageIcon,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { useFlash } from "@/hooks/use-feedback";
import { toast } from "@/lib/toast";
import "@/components/analytics/analytics.css";

import { AuditChips } from "@/components/audit-chips";
import { PieceResult } from "@/components/analytics/piece-result";
import { BlockHeading, StateLine } from "@/components/analytics/shared";
import { CarouselSlideRender } from "@/components/carousel-slide-render";
import { ProgressRing } from "@/components/criar/job-progress";
import { Reveal, useCountUp } from "@/components/dashboard/motion";
import { PageEyebrow } from "@/components/page-header";
import { PublishBlock } from "@/components/publish-block";
import { ReelProjectView } from "@/components/reel/reel-project-view";
import { ThreadPreview } from "@/components/thread-preview";
import { TweetCardRender, type TweetCardBrand } from "@/components/tweet-card-render";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FeedbackLabel } from "@/components/ui/feedback";
import { SlideEditor } from "@/components/biblioteca/slide-editor";
import { Button, buttonVariants } from "@/components/ui/button";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { CHANNEL_TYPE_LABELS, type ChannelType } from "@/hooks/use-channels";
import {
  JUDGE_RULE_LABELS,
  PIECE_STATUS_LABELS,
  adaptedContentToText,
  getAdaptedFields,
  pieceImageBrief,
  pieceShape,
  useContentPiece,
  useGenerateImage,
  useGenerateSlideImages,
  usePieceContextItems,
  usePieceImageUrl,
  usePieceRealtime,
  useRegeneratePiece,
  useSaveSlideRenders,
  useSchedulePiece,
  useUpdatePieceStatus,
  useUploadRender,
  type AdaptedFields,
  type ContentPiece,
  type PieceStatus,
  type SlideImagesJob,
  type StoryFrame,
  type TweetCardSlide,
} from "@/hooks/use-content-pieces";
import { usePublishedPost } from "@/hooks/use-published-posts";
import { useCancelPublish, useUpdateZernioSchedule } from "@/hooks/use-zernio";
import { useSignedUrl } from "@/hooks/use-storage";
import { avisoDoDrive, useDeletePiece } from "@/hooks/use-delete-content";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useTweetCardBrand } from "@/hooks/use-tweet-card-brand";
import { normalizeBrandKitContent, useActiveVersion } from "@/hooks/use-versioned-brand";
import { type CarouselArt } from "@/lib/carousel-art";
import { editorialPhotoIndexes } from "@/lib/carousel-editorial";
import { brandFontsReady, fontesFaltando } from "@/lib/brand-fonts";
import { supabase } from "@/integrations/supabase/client";
import { signedUrl } from "@/lib/storage-restore";
import {
  buildCarouselZip,
  downloadBlob,
  exportNodeToPng,
  type TweetCardAspect,
} from "@/lib/render-export";
import { cn } from "@/lib/utils";
import { humanizeError } from "@/lib/humanize-error";

export const Route = createFileRoute("/_app/biblioteca/$pieceId")({
  component: PieceDetailPage,
});

const TWEET_CARD_CHANNELS: readonly ChannelType[] = [
  "instagram_post",
  "instagram_carousel",
  "instagram_stories",
];

const STORY_ROLE_LABELS: Record<StoryFrame["role"], string> = {
  gancho: "Gancho",
  desenvolvimento: "Desenvolvimento",
  cta: "Chamada",
};

// ---------------------------------------------------------------------------
// Detalhe da peça na linguagem do kit: cabeçalho grande (ícone do canal uma
// vez, estado como chip, data), a decisão em pílula no topo, a pré-visualização
// num painel de vidro e, ao lado, Revisão (anel + critérios), Publicação e
// Resultado como seções abertas. Origem e base da peça ficam recolhidas.
// ---------------------------------------------------------------------------

function PieceDetailPage() {
  const { pieceId } = Route.useParams();
  const pieceQuery = useContentPiece(pieceId);
  const piece = pieceQuery.data ?? null;

  // Brand kit + persona ativos alimentam o TweetCardRender (tokens visuais).
  const brand = useTweetCardBrand();

  if (pieceQuery.isLoading) {
    return (
      <div className="w-full space-y-8" aria-hidden="true">
        <div className="flex items-start gap-4">
          <Skeleton className="size-12 rounded-[14px]" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-5 w-40" />
          </div>
        </div>
        <div className="@container">
          <div className="grid gap-8 @3xl:grid-cols-[minmax(0,1fr)_340px]">
            <Skeleton className="h-[480px] w-full rounded-[var(--via-radius-lg)]" />
            <div className="space-y-4">
              <Skeleton className="h-28 w-full rounded-[var(--via-radius-lg)]" />
              <Skeleton className="h-40 w-full rounded-[var(--via-radius-lg)]" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (pieceQuery.isError || !piece) {
    return (
      <div className="via-tile via-tile--atmos ce-chart-empty flex flex-col items-center gap-4 !px-6 !py-10 text-center">
        <p className="text-base font-medium text-[var(--via-text-primary)]">Peça não encontrada</p>
        <p className="max-w-sm text-sm text-[var(--via-text-muted)]">
          Ela pode ter sido removida ou o link está incorreto.
        </p>
        <Button asChild className="rounded-full">
          <Link to="/biblioteca">Voltar para a Biblioteca</Link>
        </Button>
      </div>
    );
  }

  return <PieceDetail piece={piece} brand={brand} />;
}

function PieceDetail({ piece, brand }: { piece: ContentPiece; brand: TweetCardBrand }) {
  const adapted = getAdaptedFields(piece);
  const isTweetCard = TWEET_CARD_CHANNELS.includes(piece.channel_type);
  const isCarousel = piece.channel_type === "instagram_carousel";
  const isStories = piece.channel_type === "instagram_stories";
  const isPost = piece.channel_type === "instagram_post";
  /**
   * Reel: a peça não tem card nem slides para pré-visualizar — a coluna da
   * esquerda vira a produção de vídeo (docs/11-video-replicate.md §5).
   */
  const isReel = piece.channel_type === "instagram_reel";
  /** Canais com deck de fotos IA (batch por unidade: slide, frame ou card). */
  const isPhotoDeck = isCarousel || isStories || isPost;

  // A saída do canal (ZIP no carrossel/stories, PNG no card, copiar o texto
  // onde não há arte). Em rascunho a decisão é a ação principal; em aprovada
  // e publicada, publicar; só em rejeitada/arquivada a saída vira a principal.
  const temExport = isTweetCard;
  const temAspecto = isPost || isCarousel;
  const exportVariant =
    piece.status === "rejected" || piece.status === "archived" ? "default" : "outline";

  // Aspect do card (post/carrossel alternam 4:5 e 1:1; stories é sempre 9:16).
  const [aspectChoice, setAspectChoice] = useState<TweetCardAspect>("4:5");
  const aspect: TweetCardAspect =
    piece.channel_type === "instagram_stories" ? "9:16" : aspectChoice;

  const exportRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const uploadRender = useUploadRender();

  // Imagem de IA opcional (generate-image → adapted_content.image_path).
  const imageUrl = usePieceImageUrl(piece).data ?? null;
  const imageBrief = pieceImageBrief(piece);
  const generateImage = useGenerateImage();

  // Canais com deck geram foto POR UNIDADE (seção abaixo da prévia) e sem
  // image_brief não há o que gerar — nos dois casos o item some do menu. Se o
  // menu ficaria vazio, o botão "⋯" também não aparece.
  const podeGerarImagem = !isPhotoDeck && !isReel && Boolean(imageBrief);
  const temMenu = temExport || podeGerarImagem;

  // ── Deck de fotos por unidade: slides (carrossel), frames (stories), card ──
  const deckUnits: Array<TweetCardSlide | StoryFrame> = isCarousel
    ? [...(adapted.slides ?? [])].sort((a, b) => a.index - b.index)
    : isStories
      ? [...(adapted.frames ?? [])].sort((a, b) => a.index - b.index)
      : isPost && adapted.card
        ? [adapted.card]
        : [];
  const [deckIndex, setDeckIndex] = useState(0);
  const slideJob = isPhotoDeck ? adapted.slide_images_job : undefined;
  const batchRunning = slideJob?.status === "running";
  // Realtime da peça: o batch grava adapted_content foto a foto.
  // pedido de slide ao Claude: a entrega chega pelo conector, fora desta aba
  const pedidoAoClaude = Boolean(piece.adapted_content.pedido_claude);
  usePieceRealtime(piece.id, { poll: Boolean(batchRunning) || pedidoAoClaude });
  // Visual do deck: 'brand' (default — fundo de MARCA determinístico da paleta
  // + foto IA detalhada no bloco abaixo do texto) ou 'background' (foto IA
  // full-bleed atrás do texto, opcional).
  const [slideImageMode, setSlideImageMode] = useState<"brand" | "background">("brand");
  // ARTE do carrossel: vem do design system da MARCA (brand_kit.art), não da
  // peça e não da tela — "não tem que ter seletor no carrossel".
  const brandKit = normalizeBrandKitContent(useActiveVersion("brand_kit").data?.content ?? null);
  const carouselArt = brandKit.art;
  // O preview acompanha a composição do batch mais recente.
  const batchComposition = slideJob?.composition;
  useEffect(() => {
    if (batchComposition) {
      setSlideImageMode(batchComposition === "background" ? "background" : "brand");
    }
  }, [batchComposition]);
  const saveSlideRenders = useSaveSlideRenders();

  // Export do carrossel: área escondida montando TODOS os slides com foto.
  const [exportSlides, setExportSlides] = useState<Array<{
    index: number;
    text: string;
    url: string | null;
    promoted: boolean;
    artRendered: boolean;
    editorial?: TweetCardSlide;
  }> | null>(null);
  const exportNodesRef = useRef(new Map<number, HTMLDivElement>());

  /**
   * Rasteriza TODAS as unidades do deck como na prévia e devolve os PNGs na
   * ordem de publicação. Serve o ZIP e a publicação: a arte que sai é a que
   * está na tela, nunca uma exportação antiga.
   */
  const renderDeckArts = async (): Promise<Array<{ index: number; blob: Blob }>> => {
    try {
      // 1. Signed URL por unidade com foto (imperativo — fora do ciclo de hooks).
      const prepared = await Promise.all(
        deckUnits.map(async (slide) => {
          let url: string | null = null;
          if (slide.image_path) {
            url = await signedUrl("renders", slide.image_path, 3600).catch(() => null);
          }
          // o export tem que sair IGUAL ao preview: leva a marca de promoção
          const promoted = "photo_promoted" in slide ? slide.photo_promoted === true : false;
          // o export tem que sair IGUAL ao preview, inclusive na capa de arte
          const artRendered =
            "cover_art_rendered" in slide ? slide.cover_art_rendered === true : false;
          // e com a estrutura editorial (manchete, parágrafos, foto/gráfico)
          const editorial =
            "title" in slide || "paragraphs" in slide ? (slide as TweetCardSlide) : undefined;
          return { index: slide.index, text: slide.text, url, promoted, artRendered, editorial };
        }),
      );
      // As fontes da pele TÊM que estar carregadas antes de rasterizar.
      if (isCarousel) {
        await brandFontsReady(brand.typography?.heading, brand.typography?.body);
        const faltando = fontesFaltando(brand.typography?.heading, brand.typography?.body);
        if (faltando.length > 0) {
          toast.warning("Fontes da marca não carregaram", {
            description: `${faltando.join(", ")} — as artes vão sair com outra fonte. Recarregue a página e exporte de novo.`,
          });
        }
      }

      exportNodesRef.current.clear();
      setExportSlides(prepared);

      // 2. Espera os N cards montarem e as fotos carregarem na área escondida.
      await waitForExportNodes(exportNodesRef.current, prepared.length);

      // 3. Exporta cada card na ordem de publicação.
      const renders: Array<{ index: number; blob: Blob }> = [];
      for (const slide of prepared) {
        const node = exportNodesRef.current.get(slide.index);
        if (!node)
          throw new Error(
            `O slide ${slide.index + 1} não carregou. Recarregue a página e tente de novo.`,
          );
        const blob = await exportNodeToPng(node, {
          aspect,
          // Pele com tipografia própria não pode cair em fonte de sistema
          // calada: melhor o erro na cara do que um ZIP com a arte errada.
          allowFontFallback: !isCarousel,
        });
        renders.push({ index: slide.index, blob });
      }
      return renders;
    } finally {
      setExportSlides(null);
    }
  };

  const exportCarouselZip = async () => {
    if (exporting || deckUnits.length === 0) return;
    setExporting(true);
    try {
      const renders = await renderDeckArts();

      // 4. ZIP com as artes numeradas + legenda.txt (stories não têm legenda).
      const zip = await buildCarouselZip(renders, adapted.caption);
      downloadBlob(zip, `${isStories ? "stories" : "carrossel"}-${piece.id.slice(0, 8)}.zip`);

      // 5. Persiste as artes no bucket + adapted_content.slide_renders.
      try {
        await saveSlideRenders.mutateAsync({ pieceId: piece.id, renders });
        toast.success(isStories ? "Stories exportados" : "Carrossel exportado", {
          description: `${renders.length} artes no ZIP, também salvas na peça.`,
        });
      } catch (uploadError) {
        toast.error("ZIP baixado, mas as artes não foram salvas na peça", {
          description: uploadError instanceof Error ? uploadError.message : undefined,
        });
      }
    } catch (error) {
      toast.error(
        isStories
          ? "Não foi possível exportar os stories"
          : "Não foi possível exportar o carrossel",
        {
          description: error instanceof Error ? error.message : undefined,
        },
      );
    } finally {
      setExporting(false);
    }
  };

  /**
   * Antes de publicar no Instagram: gera e salva as artes sozinho, como estão
   * na prévia. A pessoa não precisa exportar nada antes.
   */
  const prepareArts = async (): Promise<void> => {
    if (batchRunning) {
      throw new Error("As fotos ainda estão sendo geradas. Aguarde e publique de novo.");
    }
    if (exporting) throw new Error("Uma exportação está em andamento. Aguarde e publique de novo.");
    setExporting(true);
    try {
      if (isCarousel || isStories) {
        if (deckUnits.length === 0) throw new Error("Esta peça ainda não tem slides.");
        const renders = await renderDeckArts();
        await saveSlideRenders.mutateAsync({ pieceId: piece.id, renders });
        return;
      }
      const node = exportRef.current;
      if (!node) throw new Error("A prévia da arte não carregou. Recarregue a página.");
      if (isCarousel) {
        await brandFontsReady(brand.typography?.heading, brand.typography?.body);
      }
      const blob = await exportNodeToPng(node, { aspect, allowFontFallback: !isCarousel });
      await uploadRender.mutateAsync({ pieceId: piece.id, blob });
    } finally {
      setExporting(false);
    }
  };

  const runGenerateImage = () => {
    if (!imageBrief || generateImage.isPending) return;
    // Aviso de INÍCIO, não só de fim: o menu fecha ao selecionar e leva junto
    // o spinner — o toast persistente é o sinal de que há algo rodando.
    const emCurso = toast.loading("Gerando a imagem…", {
      description: "Leva alguns segundos. Você pode continuar revisando.",
    });
    generateImage.mutate(
      { pieceId: piece.id },
      {
        onSuccess: () =>
          toast.success(imageUrl ? "Nova imagem gerada" : "Imagem gerada", {
            id: emCurso,
            description: "Ela já aparece na prévia da peça.",
          }),
        onError: (error) =>
          toast.error("Não foi possível gerar a imagem", {
            id: emCurso,
            description: error.message,
          }),
      },
    );
  };

  // pelo botão, a confirmação fica no próprio botão; pelo menu (que fecha), vai em toast
  const [copied, flashCopied] = useFlash();
  const copyText = (fromMenu = false) => {
    const text = adaptedContentToText(piece.channel_type, adapted);
    if (!text) {
      toast.error("Nada para copiar", {
        description: "O texto deste canal ainda não foi gerado. Aguarde a geração terminar.",
      });
      return;
    }
    void navigator.clipboard.writeText(text).then(
      () =>
        fromMenu
          ? toast.success("Texto copiado", { description: "Texto da peça com a legenda." })
          : flashCopied(),
      () =>
        toast.error("Não foi possível copiar o texto", {
          description: "Permita o acesso à área de transferência no navegador e tente de novo.",
        }),
    );
  };

  const exportPng = async () => {
    const node = exportRef.current;
    if (!node || exporting) return;
    setExporting(true);
    try {
      if (isCarousel) {
        await brandFontsReady(brand.typography?.heading, brand.typography?.body);
      }
      const blob = await exportNodeToPng(node, { aspect, allowFontFallback: !isCarousel });
      downloadBlob(blob, `tweet-card-${piece.id.slice(0, 8)}.png`);
      try {
        await uploadRender.mutateAsync({ pieceId: piece.id, blob });
        toast.success("PNG exportado", {
          description: "Arquivo baixado e salvo na peça.",
        });
      } catch (uploadError) {
        toast.error("PNG baixado, mas não foi salvo na peça", {
          description: uploadError instanceof Error ? uploadError.message : undefined,
        });
      }
    } catch (error) {
      toast.error("Não foi possível exportar o PNG", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setExporting(false);
    }
  };

  const temPreview = isReel || hasPreview(piece.channel_type, adapted, deckUnits.length);
  const forma = pieceShape(piece);
  const deckLabel = (item: TweetCardSlide | StoryFrame, index: number, total: number) => {
    if (isStories) {
      const role = (item as StoryFrame).role;
      const roleLabel = STORY_ROLE_LABELS[role] ?? role ?? "";
      return `Frame ${index + 1} de ${total}${roleLabel ? ` · ${roleLabel}` : ""}`;
    }
    if (isPost) return "Card do post";
    const fecho = (item as TweetCardSlide).role === "cta" ? " · Fecho" : "";
    return `Slide ${index + 1} de ${total}${fecho}`;
  };

  return (
    // `@container` vai no ENVOLTÓRIO, não na grade: um elemento não consulta a
    // si próprio, então `@3xl:grid-cols` nunca valeria.
    <div className="@container w-full space-y-8">
      <Reveal index={0}>
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <div className="min-w-0 space-y-2">
              <PageEyebrow />
              <h1 className="text-3xl font-medium tracking-[-0.025em] text-[var(--via-text-primary)]">
                {CHANNEL_TYPE_LABELS[piece.channel_type] ?? piece.channel_type}
              </h1>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-[var(--via-text-muted)]">
                <PieceStatusChip status={piece.status} />
                {forma ? <span>{forma}</span> : null}
                <span className="tabular-nums">
                  gerada em {format(new Date(piece.created_at), "dd/MM/yyyy HH:mm")}
                </span>
                {piece.scheduled_at && piece.status !== "published" ? (
                  <span className="tabular-nums">
                    sai {format(new Date(piece.scheduled_at), "dd/MM 'às' HH:mm")}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* DECISÃO no topo: quem revisa dezenas por dia não pode rolar a
                peça inteira para alcançar Aprovar. */}
            {piece.status === "draft" ? <Decision piece={piece} /> : null}

            {isCarousel || isStories ? (
              <Button
                variant={exportVariant}
                onClick={() => void exportCarouselZip()}
                // Durante o batch de fotos o ZIP sairia com artes parciais.
                disabled={exporting || batchRunning}
                title={batchRunning ? "Aguarde as fotos ficarem prontas para exportar" : undefined}
              >
                {exporting || batchRunning ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Download aria-hidden="true" />
                )}
                {isStories ? "Exportar stories (ZIP)" : "Exportar carrossel (ZIP)"}
              </Button>
            ) : isTweetCard ? (
              <Button variant={exportVariant} onClick={() => void exportPng()} disabled={exporting}>
                {exporting ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Download aria-hidden="true" />
                )}
                Exportar PNG
              </Button>
            ) : (
              // Sem arte para exportar (reel, thread, LinkedIn), copiar É a saída.
              <Button variant={exportVariant} onClick={() => copyText()}>
                <FeedbackLabel done={copied} doneLabel="Copiado">
                  <Copy aria-hidden="true" />
                  Copiar texto
                </FeedbackLabel>
              </Button>
            )}

            {temMenu ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Mais ações">
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {temExport ? (
                    <DropdownMenuItem onSelect={() => copyText(true)}>
                      <Copy aria-hidden="true" />
                      Copiar texto
                    </DropdownMenuItem>
                  ) : null}
                  {podeGerarImagem ? (
                    <DropdownMenuItem
                      onSelect={runGenerateImage}
                      disabled={generateImage.isPending}
                    >
                      {generateImage.isPending ? (
                        <Loader2 className="animate-spin" aria-hidden="true" />
                      ) : (
                        <ImageIcon aria-hidden="true" />
                      )}
                      {imageUrl ? "Gerar outra imagem" : "Gerar imagem"}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </header>
      </Reveal>

      <div className="grid gap-8 @3xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Coluna esquerda — pré-visualização por canal */}
        <Reveal index={1} className="min-w-0 space-y-8">
          {isReel ? (
            <ReelProjectView pieceId={piece.id} />
          ) : !temPreview ? (
            <AdaptedMissing />
          ) : (
            <section
              aria-label="Pré-visualização"
              className="via-tile via-tile--atmos ce-chart-empty space-y-4 !p-4 sm:!p-6"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="via-eyebrow">Pré-visualização</p>
                {temAspecto ? (
                  <div role="group" aria-label="Proporção do card" className="flex gap-1.5">
                    {(["4:5", "1:1"] as const).map((value) => (
                      <ChoiceChip
                        key={value}
                        selected={aspectChoice === value}
                        onClick={() => setAspectChoice(value)}
                      >
                        {value}
                      </ChoiceChip>
                    ))}
                  </div>
                ) : null}
              </div>

              {isPhotoDeck && deckUnits.length > 0 ? (
                <DeckViewer
                  slides={deckUnits}
                  index={deckIndex}
                  onIndex={setDeckIndex}
                  labelOf={deckLabel}
                  render={(current, safeIndex, currentImageUrl) =>
                    isCarousel ? (
                      <CarouselSlideRender
                        ref={exportRef}
                        text={current.text}
                        brand={brand}
                        aspect={aspect}
                        index={safeIndex}
                        total={deckUnits.length}
                        imageUrl={currentImageUrl}
                        photoPromoted={"photo_promoted" in current ? current.photo_promoted : false}
                        artRendered={
                          "cover_art_rendered" in current ? current.cover_art_rendered : false
                        }
                        art={carouselArt}
                        slide={current as TweetCardSlide}
                      />
                    ) : carouselArt.layout === "editorial" ? (
                      <CarouselSlideRender
                        ref={exportRef}
                        format={isStories ? "story" : "post"}
                        text={current.text}
                        brand={brand}
                        aspect={aspect}
                        index={safeIndex}
                        total={deckUnits.length}
                        imageUrl={currentImageUrl}
                        photoPromoted={"photo_promoted" in current ? current.photo_promoted : false}
                        art={carouselArt}
                        slide={current as TweetCardSlide}
                      />
                    ) : (
                      <TweetCardRender
                        ref={exportRef}
                        text={current.text}
                        brand={brand}
                        aspect={aspect}
                        imageUrl={currentImageUrl}
                        imageMode={slideImageMode === "background" ? "background" : "inline"}
                        background={slideImageMode === "brand" ? "brand" : "plain"}
                        imagePlaceholder={Boolean(current.image_brief) && !current.image_path}
                      />
                    )
                  }
                  // Peças antigas têm UMA imagem em adapted_content.image_path
                  // (caminho single legado) — sem o fallback ela sumiria do preview.
                  fallbackImageUrl={imageUrl}
                />
              ) : (
                <ChannelPreview
                  piece={piece}
                  adapted={adapted}
                  brand={brand}
                  aspect={aspect}
                  exportRef={exportRef}
                  imageUrl={imageUrl}
                />
              )}
            </section>
          )}

          {deckUnits.length > 0 && piece.status !== "rejected" && piece.status !== "archived" ? (
            <SlideEditor
              key={Math.min(deckIndex, deckUnits.length - 1)}
              piece={piece}
              index={deckUnits[Math.min(deckIndex, deckUnits.length - 1)].index}
              unidade={adapted.frames?.length ? "quadro" : "slide"}
            />
          ) : null}

          {isPhotoDeck && deckUnits.length > 0 ? (
            <DeckPhotos
              piece={piece}
              slides={deckUnits}
              current={deckUnits[Math.min(deckIndex, deckUnits.length - 1)]}
              slideJob={slideJob}
              isCarousel={isCarousel}
              art={carouselArt}
              imageMode={slideImageMode}
              onImageModeChange={setSlideImageMode}
            />
          ) : null}

          {/* Canais sem tweet-card não têm onde embutir a imagem: ela aparece
              como bloco próprio, logo abaixo da prévia do texto. */}
          {imageUrl && !isTweetCard ? (
            <section className="space-y-3" aria-label="Imagem da peça">
              <p className="via-eyebrow">Imagem</p>
              <FadeImage
                src={imageUrl}
                alt="Imagem gerada por IA para esta peça"
                className="w-full rounded-[var(--via-radius-md)] object-cover shadow-[var(--via-shadow-md)]"
              />
            </section>
          ) : null}

          {adapted.caption ? (
            <section className="space-y-3" aria-label="Legenda">
              <p className="via-eyebrow">Legenda</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--via-text-body)]">
                {adapted.caption}
              </p>
            </section>
          ) : null}
        </Reveal>

        {/* Coluna direita — revisão, publicação, resultado, origem */}
        <Reveal index={2} className="space-y-8">
          <ReviewSection piece={piece} />

          {piece.status === "approved" || piece.status === "published" ? (
            <section aria-labelledby="publicacao-title" className="space-y-4">
              <BlockHeading eyebrow="Publicação" id="publicacao-title" />
              {piece.status === "approved" ? <SchedulePieceBlock piece={piece} /> : null}
              <PublishBlock piece={piece} prepareArts={isPhotoDeck ? prepareArts : undefined} />
            </section>
          ) : null}

          {/* Métricas do post no Zernio — só aparece com published_posts.zernio_post_id. */}
          <PieceResult pieceId={piece.id} />

          <MoreActions piece={piece} />
          <OriginDisclosure piece={piece} />
          <CoreContentDisclosure piece={piece} />
        </Reveal>
      </div>

      {/* Área ESCONDIDA do export do carrossel: monta todos os cards em tamanho
          base (540px → scale 1) fora da viewport; o export lê cada node. Não
          usa display:none — html-to-image precisa de layout real. */}
      {exportSlides ? (
        <div
          aria-hidden="true"
          style={{
            position: "fixed",
            left: -10_000,
            top: 0,
            width: 540,
            pointerEvents: "none",
          }}
        >
          {exportSlides.map((slide) =>
            isCarousel ? (
              <CarouselSlideRender
                key={slide.index}
                ref={(node) => {
                  if (node) exportNodesRef.current.set(slide.index, node);
                  else exportNodesRef.current.delete(slide.index);
                }}
                text={slide.text}
                brand={brand}
                aspect={aspect}
                index={slide.index}
                total={exportSlides.length}
                imageUrl={slide.url}
                photoPromoted={slide.promoted}
                artRendered={slide.artRendered}
                art={carouselArt}
                slide={slide.editorial}
              />
            ) : carouselArt.layout === "editorial" ? (
              <CarouselSlideRender
                key={slide.index}
                ref={(node) => {
                  if (node) exportNodesRef.current.set(slide.index, node);
                  else exportNodesRef.current.delete(slide.index);
                }}
                format={isStories ? "story" : "post"}
                text={slide.text}
                brand={brand}
                aspect={aspect}
                index={slide.index}
                total={exportSlides.length}
                imageUrl={slide.url}
                photoPromoted={slide.promoted}
                art={carouselArt}
                slide={slide.editorial}
              />
            ) : (
              <TweetCardRender
                key={slide.index}
                ref={(node) => {
                  if (node) exportNodesRef.current.set(slide.index, node);
                  else exportNodesRef.current.delete(slide.index);
                }}
                text={slide.text}
                brand={brand}
                aspect={aspect}
                imageUrl={slide.url}
                imageMode={slideImageMode === "background" ? "background" : "inline"}
                background={slideImageMode === "brand" ? "brand" : "plain"}
              />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Há o que pré-visualizar para este canal? (o Reel não passa por aqui) */
function hasPreview(channel: ChannelType, adapted: AdaptedFields, deckSize: number): boolean {
  switch (channel) {
    case "instagram_post":
    case "instagram_carousel":
    case "instagram_stories":
      return deckSize > 0;
    case "x_post":
    case "threads_post":
    case "facebook_post":
      return Boolean(adapted.text);
    case "linkedin_post":
      return Boolean(adapted.blocks || adapted.text);
    default:
      return false;
  }
}

/**
 * Espera os nodes do export montarem e TODAS as fotos carregarem (polling —
 * o setState da área escondida não expõe um "pronto" síncrono). 30s: as fotos
 * vêm de signed URLs sem cache na primeira carga.
 */
async function waitForExportNodes(
  nodes: Map<number, HTMLDivElement>,
  expected: number,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (nodes.size === expected) {
      const images = [...nodes.values()].flatMap((node) => [...node.querySelectorAll("img")]);
      const ready = images.every((img) => img.complete && img.naturalWidth > 0);
      if (ready) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("As fotos dos slides demoraram para carregar. Clique em exportar de novo.");
}

function PieceStatusChip({ status }: { status: PieceStatus }) {
  return (
    <span
      className={cn(
        "via-meta-chip",
        status === "published" && "!border-transparent !bg-[var(--via-navy)] !text-white",
        status === "rejected" &&
          "!border-transparent !bg-[rgba(184,92,92,0.12)] !text-[var(--via-coral-dark)]",
        status === "archived" && "!text-[var(--via-text-muted)]",
      )}
    >
      {PIECE_STATUS_LABELS[status]}
    </span>
  );
}

/** Imagem que aparece com fade (opacity, 220ms) quando termina de carregar. */
function FadeImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (ref.current?.complete) setLoaded(true);
  }, [src]);
  return (
    <img
      ref={ref}
      src={src}
      alt={alt}
      onLoad={() => setLoaded(true)}
      className={cn(
        "transition-opacity duration-[var(--via-dur)] ease-[var(--via-ease-out)]",
        loaded ? "opacity-100" : "opacity-0",
        className,
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Previews por canal (docs/05 §4.2)
// ---------------------------------------------------------------------------

interface PreviewProps {
  piece: ContentPiece;
  adapted: AdaptedFields;
  brand: TweetCardBrand;
  aspect: TweetCardAspect;
  exportRef: RefObject<HTMLDivElement | null>;
  /** Signed URL da imagem de IA da peça (null enquanto não foi gerada). */
  imageUrl: string | null;
}

function ChannelPreview({ piece, adapted, brand, aspect, exportRef, imageUrl }: PreviewProps) {
  switch (piece.channel_type) {
    case "instagram_post": {
      if (!adapted.card?.text) return <AdaptedMissing />;
      return (
        <PreviewFrame>
          <TweetCardRender
            ref={exportRef}
            text={adapted.card.text}
            brand={brand}
            aspect={aspect}
            imageUrl={imageUrl}
            imagePlaceholder={Boolean(adapted.card.image_brief)}
          />
        </PreviewFrame>
      );
    }
    case "x_post":
    case "threads_post": {
      if (!adapted.text) return <AdaptedMissing />;
      return (
        <ThreadPreview
          text={adapted.text}
          thread={adapted.thread ?? []}
          brand={brand}
          imagePath={adapted.image_path}
        />
      );
    }
    case "linkedin_post":
      return <LinkedinPreview adapted={adapted} />;
    case "facebook_post": {
      if (!adapted.text) return <AdaptedMissing />;
      return (
        <p className="mx-auto max-w-[540px] whitespace-pre-wrap text-sm leading-relaxed text-[var(--via-text-primary)]">
          {adapted.text}
        </p>
      );
    }
    // Carrossel/stories passam pelo DeckViewer; o Reel pela produção de vídeo.
    default:
      return <AdaptedMissing />;
  }
}

/** Painel de vidro do kit: uma frase e uma ação. */
function AdaptedMissing() {
  return (
    <div className="via-tile via-tile--atmos ce-chart-empty flex flex-col items-center gap-4 !px-6 !py-10 text-center">
      <p className="text-base font-medium text-[var(--via-text-primary)]">
        Texto deste canal ainda não gerado
      </p>
      <p className="max-w-sm text-sm text-[var(--via-text-muted)]">
        A geração ainda pode estar adaptando a peça.
      </p>
      <Button asChild variant="outline" className="rounded-full">
        <Link to="/">Criar outra peça</Link>
      </Button>
    </div>
  );
}

function PreviewFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[540px] overflow-hidden rounded-[14px] shadow-[var(--via-shadow-md)]">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deck (carrossel/stories/card): navegação por setas, cada troca entra com fade
// ---------------------------------------------------------------------------

function DeckViewer({
  slides,
  index,
  onIndex,
  labelOf,
  render,
  fallbackImageUrl,
}: {
  slides: Array<TweetCardSlide | StoryFrame>;
  index: number;
  onIndex: (next: number) => void;
  labelOf: (item: TweetCardSlide | StoryFrame, index: number, total: number) => string;
  render: (
    current: TweetCardSlide | StoryFrame,
    safeIndex: number,
    currentImageUrl: string | null,
  ) => ReactNode;
  /** Imagem única legada (adapted_content.image_path) — usada quando a unidade não tem foto própria. */
  fallbackImageUrl?: string | null;
}) {
  const safeIndex = Math.min(index, slides.length - 1);
  const current = slides[safeIndex];
  // Foto do slide corrente (signed URL cacheada por path); sem foto própria,
  // cai na imagem única legada da peça.
  const currentImageUrl =
    useSignedUrl("renders", current?.image_path ?? null).data ?? fallbackImageUrl ?? null;

  if (!current) return <AdaptedMissing />;

  return (
    <div className="space-y-4">
      <div key={safeIndex} className="ce-reveal">
        <PreviewFrame>{render(current, safeIndex, currentImageUrl)}</PreviewFrame>
      </div>

      {slides.length > 1 ? (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="icon"
            className="size-9"
            onClick={() => onIndex(Math.max(0, safeIndex - 1))}
            disabled={safeIndex === 0}
            aria-label="Anterior"
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span className="min-w-40 text-center text-xs tabular-nums text-[var(--via-text-muted)]">
            {labelOf(current, safeIndex, slides.length)}
            {current.image_path ? " · com foto" : ""}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="size-9"
            onClick={() => onIndex(Math.min(slides.length - 1, safeIndex + 1))}
            disabled={safeIndex === slides.length - 1}
            aria-label="Próximo"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <p className="text-center text-xs text-[var(--via-text-muted)]">
          {labelOf(current, safeIndex, slides.length)}
          {current.image_path ? " · com foto" : ""}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fotos do deck — seção aberta abaixo da prévia (07 §3.5 scope 'slides')
// ---------------------------------------------------------------------------

function DeckPhotos({
  piece,
  slides,
  current,
  slideJob,
  isCarousel,
  art,
  imageMode,
  onImageModeChange,
}: {
  piece: ContentPiece;
  slides: Array<TweetCardSlide | StoryFrame>;
  current: TweetCardSlide | StoryFrame;
  slideJob: SlideImagesJob | undefined;
  /** Carrossel usa a arte dedicada (capa full-bleed + miolo sólido). */
  isCarousel: boolean;
  /** Vocabulário de arte da MARCA — igual para toda peça. */
  art: CarouselArt;
  imageMode: "brand" | "background";
  onImageModeChange: (mode: "brand" | "background") => void;
}) {
  const generateSlides = useGenerateSlideImages();
  const unidadeLabel = isCarousel ? "slide" : "frame";

  const withPhoto = slides.filter((slide) => slide.image_path).length;
  // Design system gráfico (photo_slot 'none'): o ornamento É a arte e a foto
  // nunca aparece. Gerar imagem aí é queimar crédito num arquivo que ninguém vê.
  const artSemFoto = isCarousel && art.photo_slot === "none";
  const running = slideJob?.status === "running";
  const failedIndexes = slideJob?.status === "error" ? (slideJob.failed_indexes ?? []) : [];

  // Carrossel editorial: capa + até 3 slides do miolo (nunca dois seguidos,
  // nunca o último), como no padrão da casa. As fotos do miolo vivem num bloco
  // abaixo do texto, então o brief é de cena concreta ("inline").
  const editorial = isCarousel && art.layout === "editorial";
  const editorialIndexes = editorialPhotoIndexes(slides);

  const startBatch = (slideIndexes?: number[]) => {
    if (generateSlides.isPending || running || artSemFoto) return;
    const indexes = slideIndexes?.length ? slideIndexes : editorial ? editorialIndexes : undefined;
    generateSlides.mutate(
      {
        pieceId: piece.id,
        ...(indexes?.length ? { slideIndexes: indexes } : {}),
        // A geração OBEDECE o modo do deck. Carrossel clássico: a única foto
        // que entra na arte é a da CAPA, full-bleed → brief atmosférico.
        composition: editorial
          ? "inline"
          : isCarousel || imageMode === "background"
            ? "background"
            : "inline",
      },
      {
        onSuccess: (data) => {
          toast.success("Gerando fotos", {
            description: `${data.total} ${data.total === 1 ? "foto" : "fotos"} a caminho. Cada uma aparece no slide assim que fica pronta.`,
          });
        },
        onError: (error) => {
          toast.error("Não foi possível gerar as fotos", { description: error.message });
        },
      },
    );
  };

  const progresso = slideJob ? Math.round((slideJob.done / Math.max(slideJob.total, 1)) * 100) : 0;

  return (
    <section aria-labelledby="fotos-title" className="space-y-4">
      <BlockHeading
        eyebrow="Fotos"
        title={`${withPhoto}/${slides.length} com foto`}
        id="fotos-title"
        aside={
          isCarousel || art.layout === "editorial" ? (
            /* Sem controle visual aqui de propósito: composição, fundo e
               tratamento da foto são do design system da marca. */
            <Link
              to="/marca/brand-kit"
              className="text-xs text-[var(--via-text-muted)] underline-offset-4 hover:text-[var(--via-text-primary)] hover:underline"
            >
              Arte definida na identidade visual
            </Link>
          ) : (
            <div role="group" aria-label="Composição da foto" className="flex gap-1.5">
              {(
                [
                  ["brand", "Fundo de marca"],
                  ["background", "Foto de fundo"],
                ] as const
              ).map(([mode, label]) => (
                <ChoiceChip
                  key={mode}
                  selected={imageMode === mode}
                  onClick={() => onImageModeChange(mode)}
                >
                  {label}
                </ChoiceChip>
              ))}
            </div>
          )
        }
      />

      {running && slideJob ? (
        <div className="space-y-1.5" role="status">
          <p className="inline-flex items-center gap-1.5 text-xs tabular-nums text-[var(--via-text-muted)]">
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            Gerando fotos ({slideJob.done}/{slideJob.total})…
          </p>
          <span className="via-bar !max-w-none">
            <span
              className="via-bar__fill transition-[width] duration-[var(--via-t-slow)] ease-[var(--via-ease-out)]"
              style={{ width: `${progresso}%` }}
            />
          </span>
        </div>
      ) : null}

      {slideJob?.status === "error" ? (
        <StateLine className="text-xs !text-[var(--via-coral-dark)]">
          {slideJob.error
            ? humanizeError(slideJob.error)
            : "Algumas fotos falharam. Clique em Tentar de novo."}
        </StateLine>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => startBatch()}
          disabled={generateSlides.isPending || running || artSemFoto}
        >
          {generateSlides.isPending || running ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <ImageIcon aria-hidden="true" />
          )}
          {editorial
            ? withPhoto === 0
              ? `Gerar fotos (${editorialIndexes.length})`
              : "Gerar fotos de novo"
            : isCarousel
              ? withPhoto === 0
                ? "Gerar arte da capa"
                : "Gerar nova capa"
              : withPhoto === 0
                ? `Gerar fotos (${slides.length})`
                : "Gerar todas de novo"}
        </Button>
        {failedIndexes.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => startBatch(failedIndexes)}
            disabled={generateSlides.isPending || running || artSemFoto}
          >
            <RefreshCw aria-hidden="true" />
            Tentar de novo ({failedIndexes.length})
          </Button>
        ) : null}
        {/* na capa o botão principal já faz isso — dois botões idênticos confundem */}
        {slides.length > 1 && !(isCarousel && current.index === 0) ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => startBatch([current.index])}
            disabled={generateSlides.isPending || running || artSemFoto}
            className="text-[var(--via-text-muted)]"
            data-testid="regerar-unidade"
          >
            <RefreshCw aria-hidden="true" />
            {current.image_path
              ? `Gerar nova foto do ${unidadeLabel} ${current.index + 1}`
              : `Gerar foto do ${unidadeLabel} ${current.index + 1}`}
          </Button>
        ) : null}
      </div>

      {artSemFoto ? (
        <p className="text-xs text-[var(--via-text-muted)]" data-testid="arte-sem-foto">
          A identidade visual da marca não usa foto no carrossel. Para ter foto na capa, mude o
          lugar da foto em Marca → Identidade visual → Arte do carrossel.
        </p>
      ) : isCarousel ? (
        <StateLine className="text-xs">
          A capa é gerada como arte completa, com a manchete dentro da imagem. Para pôr foto em
          outro slide, abra o slide e clique em Gerar foto.
        </StateLine>
      ) : (
        <StateLine className="text-xs">
          Fundo de marca: cores da marca e a foto abaixo do texto. Foto de fundo: a foto ocupa o
          card inteiro. Ao trocar, gere as fotos de novo.
        </StateLine>
      )}
    </section>
  );
}

/** Blocos formatados do LinkedIn (hook/contexto/lista/insight/ponte/cta). */
function LinkedinPreview({ adapted }: { adapted: AdaptedFields }) {
  const blocks = adapted.blocks;
  if (!blocks && !adapted.text) return <AdaptedMissing />;
  return (
    <div className="mx-auto max-w-[540px] space-y-4 text-sm leading-relaxed text-[var(--via-text-primary)]">
      {blocks ? (
        <>
          {blocks.hook ? <p className="font-medium">{blocks.hook}</p> : null}
          {blocks.contexto ? <p className="whitespace-pre-wrap">{blocks.contexto}</p> : null}
          {blocks.lista?.length ? (
            <ul className="list-disc space-y-1 pl-5">
              {blocks.lista.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          ) : null}
          {blocks.insight ? <p className="whitespace-pre-wrap">{blocks.insight}</p> : null}
          {blocks.ponte ? <p className="whitespace-pre-wrap">{blocks.ponte}</p> : null}
          {blocks.cta ? <p className="font-medium">{blocks.cta}</p> : null}
        </>
      ) : (
        <p className="whitespace-pre-wrap">{adapted.text}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revisão — nota em anel, critérios como micro-barras, conferências como chips
// ---------------------------------------------------------------------------

function ReviewSection({ piece }: { piece: ContentPiece }) {
  const judge = piece.audit?.judge;
  const score = judge && typeof judge.score === "number" ? judge.score : null;
  const shown = useCountUp(score);
  const criterios = judge
    ? [
        ...(judge.rules ?? []).map((rule) => ({
          label: JUDGE_RULE_LABELS[rule.rule] ?? rule.rule,
          passed: rule.passed,
          note: rule.note,
        })),
        { label: "Voz da marca", passed: judge.voice_pass, note: undefined },
        { label: "Ponte para a oferta", passed: judge.bridge_logical, note: undefined },
      ]
    : [];

  return (
    <section aria-labelledby="revisao-title" className="space-y-4">
      <BlockHeading eyebrow="Revisão" id="revisao-title" />

      <div className="flex items-center gap-4">
        <ProgressRing
          fraction={score === null ? 0 : score / 10}
          label={score === null ? "Nota pendente" : `Nota ${score} de 10`}
          failed={judge?.verdict === "rewrite"}
        >
          <span className="font-mono text-sm font-medium tabular-nums text-[var(--via-text-primary)]">
            {score === null ? "—" : (shown ?? 0)}
          </span>
        </ProgressRing>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-[var(--via-text-primary)]">
            {score === null
              ? "Avaliação pendente"
              : judge?.verdict === "approve"
                ? "Pronta para aprovar"
                : "Precisa ser reescrita"}
          </p>
          {judge?.diagnosis?.[0] ? (
            <p className="line-clamp-2 text-xs text-[var(--via-text-muted)]">
              {judge.diagnosis[0]}
            </p>
          ) : null}
        </div>
      </div>

      {criterios.length > 0 ? (
        <ul className="space-y-1.5" aria-label="Critérios da avaliação">
          {criterios.map((criterio) => (
            <li
              key={criterio.label}
              className="flex items-center justify-between gap-3 text-xs"
              title={criterio.note}
            >
              <span
                className={
                  criterio.passed ? "text-[var(--via-text-body)]" : "text-[var(--via-coral-dark)]"
                }
              >
                {criterio.label}
                <span className="sr-only">: {criterio.passed ? "ok" : "a melhorar"}</span>
              </span>
              <span className="via-bar !w-20 shrink-0" aria-hidden="true">
                <span
                  className={cn(
                    "via-bar__fill via-bar__fill--grow",
                    !criterio.passed && "via-bar__fill--down",
                  )}
                  style={{ width: criterio.passed ? "100%" : "28%" }}
                />
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <AuditChips audit={piece.audit} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Decisão — aprovar / rejeitar (só em revisão), nos mesmos diálogos de sempre
// ---------------------------------------------------------------------------

function Decision({ piece }: { piece: ContentPiece }) {
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const updateStatus = useUpdatePieceStatus();

  return (
    <>
      <Button onClick={() => setApproveOpen(true)} disabled={updateStatus.isPending}>
        <ThumbsUp aria-hidden="true" />
        Aprovar
      </Button>
      <Button
        variant="ghost"
        onClick={() => setRejectOpen(true)}
        disabled={updateStatus.isPending}
        className="text-[var(--via-coral-dark)] hover:text-[var(--via-coral-dark)]"
      >
        <ThumbsDown aria-hidden="true" />
        Rejeitar
      </Button>

      <VerdictDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        piece={piece}
        verdict="approved"
      />
      <VerdictDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        piece={piece}
        verdict="rejected"
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Mais ações — regenerar / arquivar
// ---------------------------------------------------------------------------

function MoreActions({ piece }: { piece: ContentPiece }) {
  const updateStatus = useUpdatePieceStatus();
  // Arquivar peça com post ATIVO no Zernio precisa cancelar lá primeiro —
  // senão o Zernio publica sozinho no horário e o webhook tenta ressuscitá-la.
  const { data: publishedPost } = usePublishedPost(piece.id);
  const cancelActivePublish = useCancelPublish();
  const activePublish =
    publishedPost && ["pending", "scheduled", "publishing"].includes(publishedPost.status)
      ? publishedPost
      : null;
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { isAdmin } = useIsAdmin();
  const deletePiece = useDeletePiece();
  const navigate = useNavigate();
  const [regenerateOpen, setRegenerateOpen] = useState(false);

  const archiveLocal = () => {
    updateStatus.mutate(
      { pieceId: piece.id, status: "archived" },
      {
        onSuccess: () =>
          toast.success(activePublish ? "Envio cancelado e peça arquivada" : "Peça arquivada"),
        onError: (error) =>
          toast.error("Não foi possível arquivar", { description: error.message }),
      },
    );
  };

  const archive = () => {
    if (activePublish) {
      cancelActivePublish.mutate(
        { publishedPostId: activePublish.id, pieceId: piece.id },
        {
          onSuccess: archiveLocal,
          onError: (error) =>
            toast.error("Não foi possível cancelar o envio agendado", {
              description: `${error.message} A peça não foi arquivada. Tente de novo.`,
            }),
        },
      );
      return;
    }
    archiveLocal();
  };

  const removeLocal = () =>
    deletePiece.mutate(piece.id, {
      onSuccess: ({ drive_pendente }) => {
        toast.success("Peça excluída", { description: avisoDoDrive(drive_pendente) });
        void navigate({ to: "/biblioteca", search: (prev) => prev });
      },
      onError: (error) => toast.error("Não foi possível excluir", { description: error.message }),
    });

  const remove = () => {
    if (!activePublish) return removeLocal();
    cancelActivePublish.mutate(
      { publishedPostId: activePublish.id, pieceId: piece.id },
      {
        onSuccess: removeLocal,
        onError: (error) =>
          toast.error("Não foi possível cancelar o envio agendado", {
            description: `${error.message} A peça não foi excluída. Tente de novo.`,
          }),
      },
    );
  };

  const archived = piece.status === "archived";
  if (archived && !isAdmin) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-[var(--via-border-soft)] pt-5">
      {archived ? null : (
        <>
          <Button variant="outline" size="sm" onClick={() => setRegenerateOpen(true)}>
            <RefreshCw aria-hidden="true" />
            Gerar nova versão
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-[var(--via-text-muted)]"
            onClick={() => setArchiveOpen(true)}
            disabled={updateStatus.isPending}
          >
            <Archive aria-hidden="true" />
            Arquivar
          </Button>
        </>
      )}
      {isAdmin ? (
        <Button
          variant="outline"
          size="sm"
          className="border-destructive text-destructive"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 aria-hidden="true" />
          Excluir
        </Button>
      ) : null}

      <RegenerateDialog piece={piece} open={regenerateOpen} onOpenChange={setRegenerateOpen} />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta peça?</AlertDialogTitle>
            <AlertDialogDescription>
              {activePublish ? "O envio agendado será cancelado. " : ""}A peça e os arquivos saem
              daqui e não voltam.
              {piece.status === "published" ? " O post continua na rede." : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={remove}
              disabled={deletePiece.isPending || cancelActivePublish.isPending}
            >
              {deletePiece.isPending || cancelActivePublish.isPending ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar esta peça?</AlertDialogTitle>
            <AlertDialogDescription>
              {activePublish ? "O envio agendado desta peça será cancelado. " : ""}A peça vai para
              Arquivadas, com o histórico preservado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={archive}
              disabled={updateStatus.isPending || cancelActivePublish.isPending}
            >
              {updateStatus.isPending || cancelActivePublish.isPending ? "Arquivando…" : "Arquivar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Origem e base da peça — recolhidas (não decidem nada; ficam a um clique)
// ---------------------------------------------------------------------------

function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="border-t border-[var(--via-border-soft)] pt-4"
    >
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md py-1 text-left focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]">
        <span className="via-eyebrow">{title}</span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-[var(--via-text-muted)] transition-transform duration-[var(--via-dur)]",
            open && "rotate-180",
          )}
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-4 pt-3 text-sm">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function MetaField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[var(--via-text-muted)]">{label}</dt>
      <dd
        className={cn(
          "min-w-0 text-right text-[var(--via-text-primary)]",
          mono && "truncate font-mono text-xs",
        )}
        title={mono ? value : undefined}
      >
        {value}
      </dd>
    </div>
  );
}

function OriginDisclosure({ piece }: { piece: ContentPiece }) {
  const version = (value: number | null) => (value == null ? "—" : `v${value}`);
  const contextIds = piece.context_ids;
  const itemsQuery = usePieceContextItems(contextIds);
  const items = itemsQuery.data ?? [];
  const resolvedIds = new Set(items.map((item) => item.id));
  const missingIds = contextIds.filter((id) => !resolvedIds.has(id));

  return (
    <Disclosure title="Origem">
      <dl className="space-y-2">
        <MetaField label="Persona" value={version(piece.persona_version)} />
        <MetaField label="Bandeira" value={version(piece.strategy_version)} />
        <MetaField label="Regras da marca" value={version(piece.guardrails_version)} />
        <MetaField label="Identidade visual" value={version(piece.brand_kit_version)} />
        <MetaField label="Versão do gerador" value={piece.engine_version ?? "—"} />
        <div className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-[var(--via-text-muted)]">Geração</dt>
          <dd className="min-w-0 truncate text-right font-mono text-xs">
            <Link
              to="/criar/$jobId"
              params={{ jobId: piece.job_id }}
              className="text-[var(--via-text-primary)] underline-offset-4 hover:underline"
              title={piece.job_id}
              data-testid="piece-geracao-link"
            >
              {piece.job_id}
            </Link>
          </dd>
        </div>
        {piece.render_path ? <MetaField label="Arte salva" value={piece.render_path} mono /> : null}
      </dl>

      <div className="space-y-2">
        <p className="text-xs font-medium text-[var(--via-text-muted)]">Contexto usado</p>
        {contextIds.length === 0 ? (
          <p className="text-[var(--via-text-muted)]">Nenhum item de Contexto nesta peça.</p>
        ) : itemsQuery.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <ul className="space-y-1.5">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  to="/contexto/$itemId"
                  params={{ itemId: item.id }}
                  className="text-[var(--via-text-primary)] underline-offset-4 hover:underline"
                >
                  {item.title}
                </Link>
              </li>
            ))}
            {missingIds.map((id) => (
              <li key={id} className="font-mono text-xs text-[var(--via-text-muted)]" title={id}>
                {id.slice(0, 8)}… (item removido do Contexto)
              </li>
            ))}
          </ul>
        )}
      </div>
    </Disclosure>
  );
}

function CoreContentDisclosure({ piece }: { piece: ContentPiece }) {
  const core = piece.core_content ?? {};
  const blocks = [...(core.funnel_blocks ?? [])].sort((a, b) => a.layer - b.layer);
  const vazio = !core.idea && !core.hook?.written && blocks.length === 0 && !core.cta;

  return (
    <Disclosure title="Base da peça">
      {core.idea ? (
        <div>
          <p className="text-xs font-medium text-[var(--via-text-muted)]">Ideia</p>
          <p className="mt-1 text-[var(--via-text-primary)]">{core.idea}</p>
        </div>
      ) : null}
      {core.hook?.written ? (
        <div>
          <p className="text-xs font-medium text-[var(--via-text-muted)]">Gancho</p>
          <p className="mt-1 text-[var(--via-text-primary)]">{core.hook.written}</p>
          {core.hook.visual ? (
            <p className="mt-1 text-xs text-[var(--via-text-muted)]">Visual: {core.hook.visual}</p>
          ) : null}
        </div>
      ) : null}
      {blocks.length > 0 ? (
        <div className="space-y-3">
          <p className="text-xs font-medium text-[var(--via-text-muted)]">Estrutura do texto</p>
          <ol className="space-y-3 border-l border-[var(--via-border-soft)] pl-3">
            {blocks.map((block) => (
              <li key={block.layer}>
                <p className="text-xs font-medium text-[var(--via-text-muted)]">
                  Parte {block.layer} — {block.name}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[var(--via-text-primary)]">
                  {block.content}
                </p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {core.proof?.claim ? (
        <div>
          <p className="text-xs font-medium text-[var(--via-text-muted)]">Prova central</p>
          <p className="mt-1 text-[var(--via-text-primary)]">{core.proof.claim}</p>
          {core.proof.context_item_id ? (
            <Link
              to="/contexto/$itemId"
              params={{ itemId: core.proof.context_item_id }}
              className="text-xs text-[var(--via-text-muted)] underline-offset-4 hover:underline"
            >
              ver fonte no Contexto
            </Link>
          ) : null}
        </div>
      ) : null}
      {core.verify_flags?.length ? (
        <div>
          <p className="text-xs font-medium text-[var(--via-text-primary)]">
            A confirmar antes de aprovar [VERIFICAR]
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-[var(--via-text-primary)]">
            {core.verify_flags.map((flag, index) => (
              <li key={index}>{flag}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {core.cta ? (
        <div>
          <p className="text-xs font-medium text-[var(--via-text-muted)]">Chamada para ação</p>
          <p className="mt-1 text-[var(--via-text-primary)]">{core.cta}</p>
        </div>
      ) : null}
      {vazio ? (
        <p className="text-[var(--via-text-muted)]">A base desta peça ainda não está disponível.</p>
      ) : null}
    </Disclosure>
  );
}

// ---------------------------------------------------------------------------
// Agendamento local (F5.4) — a data coloca a peça no Calendário
// ---------------------------------------------------------------------------

function SchedulePieceBlock({ piece }: { piece: ContentPiece }) {
  const schedulePiece = useSchedulePiece();
  // Se a peça já tem post AGENDADO no Zernio, reagendar/remover precisa propagar
  // — senão o calendário local e o Zernio divergem (Zernio primeiro, local depois).
  const { data: publishedPost } = usePublishedPost(piece.id);
  const updateZernioSchedule = useUpdateZernioSchedule();
  const cancelPublish = useCancelPublish();
  const zernioScheduled = publishedPost?.status === "scheduled" ? publishedPost : null;
  // datetime-local trabalha em hora LOCAL sem timezone; converte de/para ISO.
  const toLocalInput = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [value, setValue] = useState(() =>
    piece.scheduled_at ? toLocalInput(piece.scheduled_at) : "",
  );

  const pending =
    schedulePiece.isPending || updateZernioSchedule.isPending || cancelPublish.isPending;

  const saveLocal = (scheduledAt: string) => {
    schedulePiece.mutate(
      { pieceId: piece.id, scheduledAt },
      {
        onSuccess: () =>
          toast.success("Publicação agendada", {
            description: zernioScheduled
              ? "O envio também foi reagendado."
              : "A peça aparece no Calendário na data marcada.",
          }),
        onError: (error) =>
          toast.error(
            zernioScheduled
              ? "Envio reagendado, mas o Calendário não atualizou"
              : "Não foi possível agendar",
            {
              description: zernioScheduled
                ? `${error.message} Clique em Reagendar de novo para atualizar o Calendário.`
                : error.message,
            },
          ),
      },
    );
  };

  const save = () => {
    if (!value || pending) return;
    const scheduledAt = new Date(value).toISOString();
    if (zernioScheduled) {
      updateZernioSchedule.mutate(
        { publishedPostId: zernioScheduled.id, pieceId: piece.id, scheduledFor: scheduledAt },
        {
          onSuccess: () => saveLocal(scheduledAt),
          onError: (error) =>
            toast.error("Não foi possível reagendar o envio", {
              description: `${error.message} Nada foi alterado. Tente de novo.`,
            }),
        },
      );
      return;
    }
    saveLocal(scheduledAt);
  };

  const clearLocal = () => {
    schedulePiece.mutate(
      { pieceId: piece.id, scheduledAt: null },
      {
        onSuccess: () => {
          setValue("");
          toast.success(zernioScheduled ? "Envio cancelado e data removida" : "Data removida");
        },
        onError: (error) =>
          toast.error("Não foi possível remover a data", { description: error.message }),
      },
    );
  };

  const clear = () => {
    if (pending) return;
    if (zernioScheduled) {
      cancelPublish.mutate(
        { publishedPostId: zernioScheduled.id, pieceId: piece.id },
        {
          onSuccess: clearLocal,
          onError: (error) =>
            toast.error("Não foi possível cancelar o envio", {
              description: `${error.message} A data foi mantida. Tente de novo.`,
            }),
        },
      );
      return;
    }
    clearLocal();
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="schedule-at" className="text-xs font-medium text-[var(--via-text-muted)]">
        Data e hora
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="schedule-at"
          type="datetime-local"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="h-10 min-w-[12rem] flex-1 rounded-full bg-[var(--via-glass-card)] px-4 text-sm tabular-nums"
        />
        <Button variant="outline" onClick={save} disabled={!value || pending}>
          {piece.scheduled_at ? "Reagendar" : "Agendar"}
        </Button>
      </div>
      {piece.scheduled_at ? (
        <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--via-text-muted)]">
          <span className="tabular-nums">
            Agendada para {format(new Date(piece.scheduled_at), "dd/MM/yyyy 'às' HH:mm")}
          </span>
          <button
            type="button"
            onClick={clear}
            className="cursor-pointer underline-offset-4 transition-colors hover:text-[var(--via-coral-dark)] hover:underline"
          >
            Remover
          </button>
        </p>
      ) : (
        <StateLine className="text-xs">
          A data coloca a peça no Calendário. Para sair sozinha no horário, use Agendar envio.
        </StateLine>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diálogos — veredito e nova versão (mesmos fluxos de sempre)
// ---------------------------------------------------------------------------

/** Dialog de aprovação (notas opcionais) / rejeição (notas obrigatórias). */
function VerdictDialog({
  piece,
  verdict,
  open,
  onOpenChange,
}: {
  piece: ContentPiece;
  verdict: "approved" | "rejected";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateStatus = useUpdatePieceStatus();
  const [notes, setNotes] = useState("");
  const isReject = verdict === "rejected";

  const handleOpenChange = (next: boolean) => {
    if (next) setNotes("");
    onOpenChange(next);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (updateStatus.isPending) return;
    if (isReject && !notes.trim()) {
      toast.error("Escreva o motivo da rejeição para continuar.");
      return;
    }
    updateStatus.mutate(
      { pieceId: piece.id, status: verdict, notes: notes.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(isReject ? "Peça rejeitada" : "Peça aprovada", {
            description: isReject
              ? "O motivo orienta as próximas gerações."
              : "Agora você pode agendar a peça.",
          });
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error(isReject ? "Não foi possível rejeitar" : "Não foi possível aprovar", {
            description: error.message,
          });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isReject ? "Rejeitar peça" : "Aprovar peça"}</DialogTitle>
          <DialogDescription>
            {isReject
              ? "Explique o que não funcionou. Isso orienta as próximas gerações."
              : "Se quiser, anote o que funcionou nesta peça."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="verdict-notes">
              {isReject ? "Motivo (obrigatório)" : "Comentário (opcional)"}
            </Label>
            <Textarea
              id="verdict-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={
                isReject
                  ? "Ex.: gancho genérico, a prova não sustenta a tese…"
                  : "Ex.: gancho forte, boa ligação com a oferta…"
              }
              className="min-h-24"
              required={isReject}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={updateStatus.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant={isReject ? "destructive" : "default"}
              disabled={updateStatus.isPending || (isReject && !notes.trim())}
            >
              {updateStatus.isPending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Check aria-hidden="true" />
              )}
              {isReject ? "Rejeitar" : "Aprovar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Dialog de regeneração guiada → regenerate-piece {piece_id, instruction}. */
function RegenerateDialog({
  piece,
  open,
  onOpenChange,
}: {
  piece: ContentPiece;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const regenerate = useRegeneratePiece();
  const [instruction, setInstruction] = useState("");

  const handleOpenChange = (next: boolean) => {
    if (next) setInstruction("");
    onOpenChange(next);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (regenerate.isPending) return;
    const trimmed = instruction.trim();
    if (!trimmed) {
      toast.error("Escreva o que mudar na nova versão.");
      return;
    }
    regenerate.mutate(
      { pieceId: piece.id, instruction: trimmed },
      {
        onSuccess: () => {
          toast.success("Nova versão em geração", {
            description:
              "Acompanhe em Criar. Quando ficar pronta, ela entra em revisão e esta peça é arquivada.",
          });
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error("Não foi possível gerar a nova versão", { description: error.message });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Gerar nova versão</DialogTitle>
          <DialogDescription>
            Diga o que mudar. A nova versão passa pelas mesmas conferências antes da revisão.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="regenerate-instruction">O que mudar</Label>
            <Textarea
              id="regenerate-instruction"
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="Ex.: mais provocador, mais curto, troque a prova por um caso de saúde…"
              className="min-h-24"
              required
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={regenerate.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={regenerate.isPending || !instruction.trim()}>
              {regenerate.isPending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw aria-hidden="true" />
              )}
              Gerar versão
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
