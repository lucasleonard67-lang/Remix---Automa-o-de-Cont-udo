import { useNavigate } from "@tanstack/react-router";
import { useEffect, type ChangeEvent } from "react";
import { AiChoiceLine } from "@/components/ai-choice-line";
import { AlertTriangle, Check, Clapperboard, Loader2 } from "lucide-react";

import { AngleSelector } from "@/components/angle-selector";
import { BrandIcon } from "@/components/brand-icon";
import { JobCard } from "@/components/video/job-card";
import { RemakeFlow, type RemakeOptionId } from "@/components/video/remake-flow";
import { VideoHub } from "@/components/video/video-hub";
import { ProgressRing, StageSegments } from "@/components/criar/job-progress";
import {
  pipelineFraction,
  stageDetail,
  stageTitle,
  stageViews,
} from "@/components/criar/job-stage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  CHANNEL_TYPE_LABELS,
  useChannels,
  useToggleChannel,
  type ChannelType,
} from "@/hooks/use-channels";
import { useDashboardSuggestions } from "@/hooks/use-dashboard-suggestions";
import type { DirectorJob } from "@/hooks/use-director-jobs";
import {
  type GenerationJob,
  type JobPieceSummary,
  useCancelJob,
} from "@/hooks/use-generation-jobs";
import type { VideoBrief } from "@/hooks/use-video-brief";
import {
  MARKET_FORMAT_LABELS,
  briefFromPost,
  formatEngagement,
  useMarketSummary,
} from "@/hooks/use-market";
import { channelBrand } from "@/lib/brands";
import { humanizeError } from "@/lib/humanize-error";
import { openIntegration } from "@/lib/integration-modal";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Passo 6 · Criar — tudo dentro do modal, sem sair:
//   1. formato(s): os canais que a marca ligou, em palavras de quem posta
//      (Instagram Post, Carrossel, Stories, Reel, X…); multi-seleção
//   2. tema em uma frase, com três sugestões (clicar preenche)
//   3. "Criar agora" (rodapé do fluxo) dispara a geração e ESTE passo vira o
//      progresso: anel, etapa atual, escolha de ângulo quando o motor pede,
//      erro com saída. Terminou → o fluxo avança sozinho para Publicar.
// Fechar o modal no meio não cancela nada: a geração segue no servidor.
// ---------------------------------------------------------------------------

const SUGGESTIONS = 3;
const COMPETITOR_SUGGESTIONS = 2;

/** Nome curto do formato, como a pessoa fala. */
const FORMAT_SHORT_LABELS: Record<ChannelType, string> = {
  instagram_post: "Post",
  instagram_carousel: "Carrossel",
  instagram_stories: "Stories",
  instagram_reel: "Reel",
  x_post: "X",
  threads_post: "Threads",
  linkedin_post: "LinkedIn",
  facebook_post: "Facebook",
};

/** Ordem em que os formatos aparecem (os do Instagram primeiro, como se usa). */
const FORMAT_ORDER: ChannelType[] = [
  "instagram_post",
  "instagram_carousel",
  "instagram_stories",
  "instagram_reel",
  "x_post",
  "threads_post",
  "linkedin_post",
  "facebook_post",
];

interface Suggestion {
  id: string;
  text: string;
  meta?: string;
  brief: string;
}

export interface StepCreateProps {
  brief: string;
  onBriefChange: (value: string) => void;
  formats: ReadonlySet<ChannelType>;
  onToggleFormat: (type: ChannelType) => void;
  /** Quando os canais carregam e nada foi escolhido, marca o primeiro. */
  onDefaultFormat: (type: ChannelType) => void;
  /** geração em andamento (ou terminada) disparada por este passo */
  job: GenerationJob | null;
  jobLoading: boolean;
  pieces: JobPieceSummary[];
  onRestart: () => void;
  /** A geração terminou (pronta, parou ou cancelada): o passo volta a ser escolha. */
  finished?: boolean;
  /** Abre a peça pronta da última geração (passo Publicar). */
  onOpenLast?: () => void;
  /** Vídeo dentro do fluxo: apresentador (briefing pré-gerado) ou melhorar um vídeo meu. */
  video: VideoMode;
  onVideoChange: (mode: VideoMode) => void;
  /** Briefing pré-gerado a partir do tema; editável antes de gerar. */
  videoBrief: VideoBrief | null;
  onVideoBriefChange: (brief: VideoBrief) => void;
  videoBriefPending: boolean;
  /** Produção do vídeo disparada por este passo (acompanhada aqui mesmo). */
  videoJob: DirectorJob | null;
  /** "Melhorar um vídeo meu" enfileirou: o fluxo decide o próximo passo. */
  onVideoCreated: () => void;
  /** Motivo de o vídeo com apresentador estar indisponível (Higgsfield não conectado). */
  videoBlocked?: string | null;
  /** Opções do remake escolhidas no hub (estilo, cena, pessoa, fala, idioma, legendas). */
  remakeOptions: RemakeOptionId[];
  onRemakeOptionsChange: (options: RemakeOptionId[]) => void;
}

export type VideoMode = "none" | "hub" | "presenter" | "remake";

// O passo é SEMPRE uma escolha: formato + tema. O progresso só toma o lugar do
// formulário enquanto a geração roda; terminou, o formulário volta com uma
// linha "última criação" em cima. Antes, uma geração pronta deixava o passo
// preso em "Pronto: 1 peça" e a pessoa não via onde escolher outro formato.
export function StepCreate(props: StepCreateProps) {
  if ((props.job && !props.finished) || props.jobLoading) return <CreateProgress {...props} />;
  return <CreateForm {...props} />;
}

// ── Formulário: formato + tema ───────────────────────────────────────────────

function CreateForm({
  brief,
  onBriefChange,
  formats,
  onToggleFormat,
  onDefaultFormat,
  job,
  pieces,
  finished,
  onOpenLast,
  video,
  onVideoChange,
  videoBrief,
  onVideoBriefChange,
  videoBriefPending,
  videoJob,
  onVideoCreated,
  videoBlocked = null,
  remakeOptions,
  onRemakeOptionsChange,
}: StepCreateProps) {
  const navigate = useNavigate();
  const { suggestions, isLoading } = useDashboardSuggestions();
  const market = useMarketSummary();
  const channels = useChannels();
  const toggleChannel = useToggleChannel();
  // TODOS os formatos aparecem, não só os canais ligados: a pessoa escolhe o
  // que quer criar e, se o canal estava desligado, ele liga no clique. Antes
  // a lista escondia os desligados e o fluxo parecia só saber fazer carrossel.
  const rows = channels.data ?? [];
  const all = FORMAT_ORDER.map((type) => ({ type, row: rows.find((row) => row.type === type) }));
  const enabled = all.filter((item) => item.row?.enabled).map((item) => item.type);
  // Padrão da casa: carrossel editorial. Se o canal estiver desligado, liga.
  const carousel = all.find((item) => item.type === "instagram_carousel");
  useEffect(() => {
    if (channels.isLoading || rows.length === 0 || formats.size > 0) return;
    if (carousel?.row && !carousel.row.enabled && !toggleChannel.isPending) {
      toggleChannel.mutate({ id: carousel.row.id, enabled: true });
    }
    onDefaultFormat(carousel?.row ? "instagram_carousel" : (enabled[0] ?? "instagram_carousel"));
    // só na carga dos canais; depois a escolha é da pessoa
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels.isLoading, rows.length]);
  const choose = (type: ChannelType, row: { id: string; enabled: boolean } | undefined) => {
    if (!row || row.enabled) {
      onToggleFormat(type);
      return;
    }
    toggleChannel.mutate(
      { id: row.id, enabled: true },
      {
        onSuccess: () => onToggleFormat(type),
        onError: (error) =>
          toast.error("Não foi possível ligar esse canal", { description: error.message }),
      },
    );
  };

  const versions: Suggestion[] = (market.data?.top_posts ?? [])
    .filter((post) => post.angle || post.caption)
    .slice(0, COMPETITOR_SUGGESTIONS)
    .map((post) => ({
      id: `market-${post.id}`,
      text: post.angle ?? post.caption ?? "",
      meta: [
        `Sua versão de @${post.handle}`,
        post.media_type ? MARKET_FORMAT_LABELS[post.media_type] : null,
        // taxa minúscula arredondava para "0% de engajamento": melhor omitir
        post.engagement != null && post.engagement >= 0.001
          ? `${formatEngagement(post.engagement)} de engajamento`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
      brief: briefFromPost(post),
    }));
  const radar: Suggestion[] = suggestions
    .filter((item) => item.kind === "radar")
    .map((item) => ({ id: item.id, text: item.text, meta: item.meta, brief: item.text }));
  const topics = [...versions, ...radar].slice(0, SUGGESTIONS);

  return (
    <div className="space-y-6">
      {finished && job ? (
        <div
          className="flex flex-wrap items-center gap-3 border-b border-[var(--via-border-soft)] pb-4 text-sm"
          data-testid="setup-ultima-criacao"
        >
          {pieces.length > 0 ? (
            <>
              <Check className="size-4 text-[var(--via-success)]" aria-hidden="true" />
              <span className="text-[var(--via-text-primary)]">
                Última criação pronta: {pieces.length === 1 ? "1 peça" : `${pieces.length} peças`}
              </span>
              {onOpenLast ? (
                <button
                  type="button"
                  onClick={onOpenLast}
                  className="font-medium text-[var(--via-accent)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]"
                >
                  Ver e publicar
                </button>
              ) : null}
            </>
          ) : (
            <>
              <AlertTriangle className="size-4 text-[var(--via-coral-dark)]" aria-hidden="true" />
              <span className="text-[var(--via-text-muted)]">
                A última criação {job.status === "cancelled" ? "foi cancelada" : "parou"}
                {job.error ? `: ${humanizeError(job.error)}` : "."}
              </span>
            </>
          )}
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--via-text-muted)]">
          O que você quer criar?
        </p>
        {channels.isLoading ? (
          <div className="flex gap-2">
            <Skeleton className="h-8 w-24 rounded-full" />
            <Skeleton className="h-8 w-28 rounded-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-[var(--via-text-muted)]">
            Os canais ainda não foram criados. Abra Marca → Canais e volte aqui.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Formatos da peça">
            {all.map(({ type, row }) => {
              const selected = formats.has(type);
              const off = !row?.enabled;
              const brand = channelBrand(type);
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => choose(type, row)}
                  disabled={!row || toggleChannel.isPending}
                  title={off ? "Canal desligado: clique para ligar e criar nele" : undefined}
                  data-testid={`setup-formato-${type}`}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-[background-color,border-color,color,transform] duration-[var(--via-dur)] ease-[var(--via-ease-snap)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)] active:scale-[0.98] disabled:cursor-not-allowed",
                    selected
                      ? "border-[var(--via-navy)] bg-[var(--via-navy)] text-white"
                      : off
                        ? "border-dashed border-[var(--via-border)] text-[var(--via-text-muted)] hover:border-[var(--via-navy-30)] hover:text-[var(--via-text-primary)]"
                        : "border-[var(--via-border)] text-[var(--via-text-primary)] hover:border-[var(--via-navy-30)]",
                  )}
                >
                  {brand ? (
                    <BrandIcon
                      name={brand}
                      className={cn("size-3.5", selected && "brightness-0 invert")}
                    />
                  ) : null}
                  {FORMAT_SHORT_LABELS[type]}
                  {selected ? <Check className="size-3.5" aria-hidden="true" /> : null}
                </button>
              );
            })}
            {/* vídeo tem produção própria (apresentador, cenas, voz) — mas
                acontece AQUI, no fluxo, não numa página à parte */}
            {([["hub", "Vídeo", Clapperboard]] as const).map(([mode, label, Icon]) => {
              const selected = video !== "none";
              const blocked = false;
              return (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={selected}
                  disabled={blocked}
                  title={blocked ? (videoBlocked ?? undefined) : undefined}
                  onClick={() => onVideoChange(selected ? "none" : mode)}
                  data-testid={`setup-formato-video-${mode}`}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-[background-color,border-color,color,transform] duration-[var(--via-dur)] ease-[var(--via-ease-snap)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)] active:scale-[0.98]",
                    selected
                      ? "border-[var(--via-navy)] bg-[var(--via-navy)] text-white"
                      : "border-[var(--via-border)] text-[var(--via-text-primary)] hover:border-[var(--via-navy-30)]",
                  )}
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  {label}
                  {selected ? <Check className="size-3.5" aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* com o briefing pronto, o aviso e o "Conectar" vão para o rodapé, junto do botão */}
      {video === "presenter" &&
      !videoBrief &&
      videoBlocked &&
      videoBlocked.startsWith("Vídeo precisa") ? (
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-[var(--via-text-muted)]">
          {videoBlocked}
          <button
            type="button"
            onClick={() => openIntegration("higgsfield")}
            className="font-medium text-[var(--via-accent)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]"
          >
            Conectar Higgsfield
          </button>
        </p>
      ) : null}

      {/* chip "Vídeo": o hub decide entre apresentador (briefing) e remake */}
      {video === "hub" ? (
        <VideoHub
          compact
          onRoute={(route, _have, model) => {
            if (route.action.kind === "studio") {
              // estúdios HeyGen/Higgsfield vivem em Vídeos → Novo
              void navigate({
                to: "/videos/novo",
                search: { rota: route.want, ...(model ? { modelo: model.id } : {}) },
              });
            } else if (route.action.kind === "remake") {
              onRemakeOptionsChange(route.action.options);
              onVideoChange("remake");
            } else if (route.action.kind === "director") {
              onVideoChange("presenter");
            }
          }}
        />
      ) : null}
      {video === "remake" ? (
        <RemakeFlow onCreated={onVideoCreated} initialOptions={remakeOptions} />
      ) : null}
      {video === "presenter" && videoJob ? <JobCard job={videoJob} /> : null}
      {video === "presenter" && !videoJob && videoBrief ? (
        <VideoBriefReview brief={videoBrief} onChange={onVideoBriefChange} />
      ) : null}
      {video === "presenter" && !videoJob && !videoBrief && videoBriefPending ? (
        <p
          className="inline-flex items-center gap-2 text-sm text-[var(--via-text-muted)]"
          role="status"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Montando o briefing com a voz da marca e os números do seu material…
        </p>
      ) : null}

      {video === "remake" || video === "hub" || videoJob ? null : (
        <>
          <AiChoiceLine />
          <div className="space-y-2">
            <Label htmlFor="setup-brief">Sobre o que é?</Label>
            <Textarea
              id="setup-brief"
              value={brief}
              onChange={(event) => onBriefChange(event.target.value)}
              placeholder="Ex.: 3 erros que todo iniciante comete ao começar"
              className="min-h-20 text-base md:text-base"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--via-text-muted)]">
              Sugestões
            </p>
            {isLoading || market.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : topics.length === 0 ? (
              <p className="text-sm text-[var(--via-text-muted)]">
                Sem sugestões ainda. Adicione concorrentes no Mercado ou feeds no Radar.
              </p>
            ) : (
              <ol className="divide-y divide-[var(--via-border-soft)] border-y border-[var(--via-border-soft)]">
                {topics.map((item, index) => {
                  const selected = brief.trim() === item.brief.trim();
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => onBriefChange(item.brief)}
                        aria-pressed={selected}
                        className="via-row-signature group flex w-full items-center gap-3 py-2.5 text-left transition-[background-color] hover:bg-[var(--via-navy-04)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]"
                      >
                        <span className="w-[2ch] shrink-0 font-mono text-base font-medium tabular-nums text-[var(--via-text-faint)]">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-[var(--via-text-primary)]">
                            {item.text}
                          </span>
                          {item.meta ? (
                            <span className="block truncate text-xs text-[var(--via-text-muted)]">
                              {item.meta}
                            </span>
                          ) : null}
                        </span>
                        <span
                          className={cn(
                            "inline-flex size-5 shrink-0 items-center justify-center rounded-full border transition-transform duration-[180ms] ease-[var(--via-ease-spring)]",
                            selected
                              ? "scale-100 border-[var(--via-navy)] bg-[var(--via-navy)] text-white"
                              : "scale-90 border-[var(--via-border)] text-transparent group-hover:border-[var(--via-navy-30)]",
                          )}
                          aria-hidden="true"
                        >
                          <Check className="size-3" />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Briefing do vídeo: nasce pronto, a pessoa só ajusta ──────────────────────

function VideoBriefReview({
  brief,
  onChange,
}: {
  brief: VideoBrief;
  onChange: (brief: VideoBrief) => void;
}) {
  const set = (key: keyof VideoBrief) => (event: ChangeEvent<HTMLInputElement>) =>
    onChange({ ...brief, [key]: event.target.value });
  return (
    <div className="space-y-4" data-testid="setup-video-brief">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--via-text-muted)]">
        Briefing pronto · {brief.objetivo} · {brief.tom}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="vb-smp">O que o vídeo defende</Label>
          <Input id="vb-smp" value={brief.smp} onChange={set("smp")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vb-numero">Número que prova</Label>
          <Input
            id="vb-numero"
            value={brief.numero_heroi}
            onChange={set("numero_heroi")}
            placeholder="Sem número no material: escreva um real"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vb-cta">Fala final</Label>
          <Input id="vb-cta" value={brief.cta} onChange={set("cta")} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="vb-publico">Para quem</Label>
          <Input id="vb-publico" value={brief.publico} onChange={set("publico")} />
        </div>
      </div>
    </div>
  );
}

// ── Progresso: a geração acontece aqui dentro ────────────────────────────────

function CreateProgress({ job, jobLoading, pieces, formats, onRestart }: StepCreateProps) {
  const cancelJob = useCancelJob();
  if (!job) {
    return (
      <div
        className="flex items-center gap-3 text-sm text-[var(--via-text-muted)]"
        aria-busy="true"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        {jobLoading ? "Começando a criar…" : "Procurando a sua criação…"}
      </div>
    );
  }
  const failed = job.status === "failed";
  const cancelled = job.status === "cancelled";
  const fraction = pipelineFraction(job);
  const detail = stageDetail(job);
  const chosen = [...formats].map((type) => CHANNEL_TYPE_LABELS[type]);

  return (
    <div className="space-y-5" data-testid="setup-criando">
      <div className="flex flex-wrap items-center gap-5">
        <ProgressRing
          fraction={fraction}
          failed={failed}
          label={`${stageTitle(job)}, ${Math.round(fraction * 100)}% da criação`}
        >
          {job.status === "done" || job.status === "awaiting_review" ? (
            <Check className="size-5 text-[var(--via-text-primary)]" aria-hidden="true" />
          ) : failed ? (
            <AlertTriangle className="size-5 text-[var(--via-coral-dark)]" aria-hidden="true" />
          ) : (
            <span className="font-mono text-sm font-medium tabular-nums text-[var(--via-text-primary)]">
              {Math.round(fraction * 100)}%
            </span>
          )}
        </ProgressRing>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-lg font-medium leading-tight tracking-[-0.02em] text-[var(--via-text-primary)]">
            {failed
              ? "A criação parou"
              : cancelled
                ? "Criação cancelada"
                : pieces.length
                  ? `Pronto: ${pieces.length === 1 ? "1 peça" : `${pieces.length} peças`}`
                  : stageTitle(job)}
          </p>
          {chosen.length ? (
            <p className="text-xs text-[var(--via-text-muted)]">{chosen.join(" · ")}</p>
          ) : null}
          {failed || detail ? (
            <p className="text-sm text-[var(--via-text-muted)]">
              {failed ? humanizeError(job.error ?? "") : detail}
            </p>
          ) : null}
          {!failed && !cancelled ? (
            <StageSegments views={stageViews(job)} withLabels className="max-w-md" />
          ) : null}
        </div>
      </div>

      {job.status === "awaiting_angle" ? <AngleSelector job={job} /> : null}

      {failed || cancelled ? (
        <Button variant="outline" size="sm" onClick={onRestart}>
          Tentar de novo
        </Button>
      ) : (
        /* A pessoa nunca fica presa esperando: pode mudar de ideia. "Criar outra
           coisa" libera o formulário e esta criação segue em segundo plano (o
           app avisa quando terminar); "Cancelar" para esta de vez. */
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={onRestart}>
            Criar outra coisa
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-[var(--via-coral-dark)] hover:text-[var(--via-coral-dark)]"
            disabled={cancelJob.isPending}
            onClick={() =>
              cancelJob.mutate(job.id, {
                onSuccess: () => {
                  toast.info("Criação cancelada.");
                  onRestart();
                },
                onError: (error) =>
                  toast.error("Não foi possível cancelar", {
                    description: humanizeError(error.message),
                  }),
              })
            }
          >
            Cancelar esta criação
          </Button>
          <span className="text-xs text-[var(--via-text-muted)]">
            Se mudar de ideia, esta criação continua em segundo plano e avisamos quando terminar.
          </span>
        </div>
      )}

      <blockquote className="line-clamp-2 border-l-2 border-[var(--via-border)] pl-3 text-xs text-[var(--via-text-muted)]">
        {job.prompt}
      </blockquote>
    </div>
  );
}
