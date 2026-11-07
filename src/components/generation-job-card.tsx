import { Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Ban,
  Check,
  ChevronDown,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";

import { AngleSelector } from "@/components/angle-selector";
import { ChannelIcon } from "@/components/criar/channel-tiles";
import { ProgressRing, StageSegments } from "@/components/criar/job-progress";
import {
  pipelineFraction,
  stageDetail,
  stageTitle,
  stageViews,
} from "@/components/criar/job-stage";
import { JobTimeline } from "@/components/job-timeline";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CHANNEL_TYPE_LABELS } from "@/hooks/use-channels";
import { PIECE_STATUS_LABELS, type PieceStatus } from "@/hooks/use-content-pieces";
import {
  CANCELLABLE_JOB_STATUSES,
  JOB_STATUS_LABELS,
  PROCESSING_JOB_STATUSES,
  isTerminalStatus,
  useCancelJob,
  useJobPieces,
  useResumeJob,
  type GenerationJob,
  type JobStatus,
} from "@/hooks/use-generation-jobs";
import { humanizeError } from "@/lib/humanize-error";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Uma geração em dois formatos do kit: a LINHA (`/criar`, lista) com anel +
// segmentos e uma ação no lugar, e o DETALHE (`/criar/$jobId`) com o painel
// de progresso, a trilha fina, o briefing, o ângulo e as peças em ladrilhos.
// ---------------------------------------------------------------------------

const PROCESSING_SET: ReadonlySet<JobStatus> = new Set(PROCESSING_JOB_STATUSES);
const CANCELLABLE_SET: ReadonlySet<JobStatus> = new Set(CANCELLABLE_JOB_STATUSES);

export function JobStatusChip({ status }: { status: JobStatus }) {
  const label = JOB_STATUS_LABELS[status] ?? status;
  return (
    <span className="via-meta-chip">
      {PROCESSING_SET.has(status) ? (
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
      ) : null}
      {label}
    </span>
  );
}

function useResume(jobId: string) {
  const resumeJob = useResumeJob();
  const retry = () => {
    if (resumeJob.isPending) return;
    resumeJob.mutate(
      { job_id: jobId },
      {
        onSuccess: () =>
          toast.success("Geração retomada", {
            description: "Ela continua da última etapa concluída.",
          }),
        onError: (error) => toast.error("Não foi possível retomar", { description: error.message }),
      },
    );
  };
  return { retry, pending: resumeJob.isPending };
}

// ---------------------------------------------------------------------------
// Linha da lista
// ---------------------------------------------------------------------------

export function JobRow({ job }: { job: GenerationJob }) {
  const [angleOpen, setAngleOpen] = useState(false);
  const { retry, pending: retrying } = useResume(job.id);

  const terminal = isTerminalStatus(job.status);
  const failed = job.status === "failed";
  const needsAngle = job.status === "awaiting_angle";
  const title = job.prompt.split("\n")[0].trim() || "Peça sem tema";
  const channels = (job.classification?.channel_types ?? []).map(
    (type) => CHANNEL_TYPE_LABELS[type] ?? type,
  );

  return (
    <article
      className="via-row-card via-row-signature rounded-[var(--via-radius-md)] !px-4 !py-3"
      aria-label={title}
    >
      <div className="flex items-center gap-4">
        {terminal ? (
          <TerminalMark status={job.status} />
        ) : (
          <ProgressRing
            size="sm"
            fraction={pipelineFraction(job)}
            label={`${stageTitle(job)}, ${Math.round(pipelineFraction(job) * 100)}% da geração`}
          >
            {PROCESSING_SET.has(job.status) ? (
              <Loader2
                className="size-3.5 animate-spin text-[var(--via-text-muted)]"
                aria-hidden="true"
              />
            ) : null}
          </ProgressRing>
        )}

        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm font-medium text-[var(--via-text-primary)]"
            title={job.prompt}
          >
            {title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--via-text-muted)]">
            <JobStatusChip status={job.status} />
            <span>
              {formatDistanceToNow(new Date(job.created_at), { addSuffix: true, locale: ptBR })}
            </span>
            {channels.length > 0 ? <span className="truncate">{channels.join(" · ")}</span> : null}
          </div>
          {failed && job.error ? (
            <p className="mt-1 truncate text-xs text-[var(--via-text-muted)]" title={job.error}>
              {humanizeError(job.error)}
            </p>
          ) : null}
          {!terminal ? <StageSegments views={stageViews(job)} className="mt-2.5 max-w-xs" /> : null}
        </div>

        {failed ? (
          <Button size="sm" variant="outline" onClick={retry} disabled={retrying}>
            {retrying ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw aria-hidden="true" />
            )}
            Retomar
          </Button>
        ) : needsAngle ? (
          <Button
            size="sm"
            aria-expanded={angleOpen}
            aria-controls={`angle-${job.id}`}
            onClick={() => setAngleOpen((value) => !value)}
          >
            Escolher ângulo
            <ChevronDown
              className={cn(
                "transition-transform duration-[var(--via-dur)]",
                angleOpen && "rotate-180",
              )}
              aria-hidden="true"
            />
          </Button>
        ) : (
          <Button asChild size="sm" variant="outline">
            <Link to="/criar/$jobId" params={{ jobId: job.id }}>
              Abrir<span className="sr-only"> página da postagem</span>
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        )}
      </div>

      {needsAngle && angleOpen ? (
        <div id={`angle-${job.id}`} className="mt-4 border-t border-[var(--via-border-soft)] pt-4">
          <AngleSelector job={job} />
        </div>
      ) : null}
    </article>
  );
}

/** Estado final no poço de ícone do kit: concluída, falhou, cancelada. */
function TerminalMark({ status }: { status: JobStatus }) {
  return (
    <span className="ce-tile-well" aria-hidden="true">
      {status === "done" ? (
        <Check className="size-4 text-[var(--via-text-primary)]" />
      ) : status === "failed" ? (
        <AlertCircle className="size-4 text-[var(--via-coral-dark)]" />
      ) : (
        <Ban className="size-4 text-[var(--via-text-muted)]" />
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Detalhe (página da postagem)
// ---------------------------------------------------------------------------

export function JobDetail({ job }: { job: GenerationJob }) {
  const cancelJob = useCancelJob();
  const views = stageViews(job);
  const fraction = pipelineFraction(job);
  const detail = stageDetail(job);
  const failed = job.status === "failed";
  const cancellable = CANCELLABLE_SET.has(job.status);
  const showPieces = job.status === "awaiting_review" || job.status === "done";

  const cancel = () => {
    if (cancelJob.isPending) return;
    cancelJob.mutate(job.id, {
      onSuccess: () => toast.success("Geração cancelada"),
      onError: (error) => toast.error("Não foi possível cancelar", { description: error.message }),
    });
  };

  return (
    <div className="space-y-8">
      <section
        aria-labelledby="job-stage-title"
        className="via-tile via-tile--atmos ce-chart-empty !p-5 sm:!p-6"
      >
        <div className="flex flex-wrap items-center gap-5">
          <ProgressRing
            fraction={fraction}
            failed={failed}
            label={`${stageTitle(job)}, ${Math.round(fraction * 100)}% da geração`}
          >
            {job.status === "done" ? (
              <Check className="size-5 text-[var(--via-text-primary)]" aria-hidden="true" />
            ) : failed ? (
              <AlertTriangle className="size-5 text-[var(--via-coral-dark)]" aria-hidden="true" />
            ) : job.status === "cancelled" ? (
              <Ban className="size-5 text-[var(--via-text-muted)]" aria-hidden="true" />
            ) : (
              <span className="font-mono text-sm font-medium tabular-nums text-[var(--via-text-primary)]">
                {Math.round(fraction * 100)}%
              </span>
            )}
          </ProgressRing>

          <div className="min-w-0 flex-1 space-y-2.5">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--via-text-muted)]">
              Geração
            </p>
            <h2
              id="job-stage-title"
              className="text-lg font-medium leading-tight tracking-[-0.02em] text-[var(--via-text-primary)] sm:text-xl"
            >
              {stageTitle(job)}
            </h2>
            {detail ? <p className="text-sm text-[var(--via-text-muted)]">{detail}</p> : null}
            <StageSegments views={views} withLabels className="max-w-md" />
          </div>

          {cancellable ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={cancel}
              disabled={cancelJob.isPending}
              className="text-[var(--via-text-muted)] hover:text-[var(--via-coral-dark)]"
            >
              {cancelJob.isPending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <XCircle aria-hidden="true" />
              )}
              Cancelar geração
            </Button>
          ) : null}
        </div>

        <div className="mt-5">
          <JobTimeline job={job} />
        </div>
      </section>

      <section aria-labelledby="job-brief-title" className="space-y-1.5">
        <p id="job-brief-title" className="via-eyebrow">
          Briefing
        </p>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--via-text-body)]">
          {job.prompt}
        </p>
      </section>

      {job.status === "awaiting_angle" ? <AngleSelector job={job} /> : null}
      {showPieces ? <JobPieces jobId={job.id} /> : null}
    </div>
  );
}

function JobPieces({ jobId }: { jobId: string }) {
  const piecesQuery = useJobPieces(jobId);
  const pieces = piecesQuery.data ?? [];

  return (
    <section aria-labelledby="job-pieces-title" className="space-y-3">
      <p id="job-pieces-title" className="via-eyebrow">
        Peças
      </p>
      {piecesQuery.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
          {Array.from({ length: 2 }).map((_, index) => (
            <Skeleton key={index} className="h-[4.75rem] w-full rounded-[var(--via-radius-lg)]" />
          ))}
        </div>
      ) : pieces.length === 0 ? (
        <p className="text-sm text-[var(--via-text-muted)]">
          Salvando as peças. Elas aparecem aqui em instantes.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {pieces.map((piece, index) => {
            const status = PIECE_STATUS_LABELS[piece.status as PieceStatus] ?? piece.status;
            return (
              <li
                key={piece.id}
                className="ce-reveal"
                style={{ "--ce-reveal-delay": `${index * 60}ms` } as React.CSSProperties}
              >
                <Link
                  to="/biblioteca/$pieceId"
                  params={{ pieceId: piece.id }}
                  className="via-tile via-tile--atmos via-tile--lift ce-tile group flex h-full w-full items-start gap-3 rounded-[var(--via-radius-lg)] !p-4 text-left focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]"
                >
                  <span className="ce-tile-well">
                    <ChannelIcon type={piece.channel_type} className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2 text-sm font-medium text-[var(--via-text-primary)]">
                      <span className="truncate">
                        {CHANNEL_TYPE_LABELS[piece.channel_type] ?? piece.channel_type}
                      </span>
                      <ArrowRight
                        className="size-4 shrink-0 text-[var(--via-text-faint)] transition-transform duration-[var(--via-dur)] group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-[var(--via-text-muted)]">
                      {status}
                      {piece.status === "draft" ? " · aprove ou edite na Biblioteca" : ""}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
