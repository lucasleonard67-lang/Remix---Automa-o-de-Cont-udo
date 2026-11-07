import { Link } from "@tanstack/react-router";
import { differenceInHours, formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertCircle,
  ArrowRight,
  Clapperboard,
  Eye,
  Loader2,
  PenLine,
  RefreshCw,
  Split,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Panel, PANEL_ITEM, PanelLink } from "@/components/dashboard/panel";
import { Button } from "@/components/ui/button";
import {
  directorStatusLabel,
  isJobActive,
  useDirectorJobs,
  useRetryDirectorJob,
  type DirectorJob,
} from "@/hooks/use-director-jobs";
import {
  JOB_STATUS_LABELS,
  PROCESSING_JOB_STATUSES,
  useGenerationJobs,
  type GenerationJob,
} from "@/hooks/use-generation-jobs";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { humanizeError } from "@/lib/humanize-error";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Produção: vídeos (Diretor) e peças numa fila só, do que pede a pessoa para o
// que só está rodando — no máximo 4 itens lado a lado ("+N na fila" e os links
// levam ao resto). Falha traz "Retomar" ali mesmo; esperar você leva ao
// lugar da decisão. Some o que fechou há mais de 7 dias.
// ---------------------------------------------------------------------------

const WINDOW_HOURS = 7 * 24;
const VISIBLE = 4;
const TICK_MS = 60_000;

type Row =
  | { kind: "video"; id: string; at: string; rank: number; job: DirectorJob }
  | { kind: "piece"; id: string; at: string; rank: number; job: GenerationJob };

// 0 = falhou · 1 = espera você · 2 = rodando
function videoRank(job: DirectorJob): number | null {
  if (job.status === "failed") return 0;
  if (job.status.startsWith("awaiting")) return 1;
  if (isJobActive(job)) return 2;
  return null;
}

function pieceRank(job: GenerationJob): number | null {
  if (job.status === "failed") return 0;
  if (job.status === "awaiting_angle" || job.status === "awaiting_review") return 1;
  if (PROCESSING_JOB_STATUSES.includes(job.status)) return 2;
  return null;
}

export function ProductionModule() {
  const { isAdmin } = useIsAdmin();
  const videos = useDirectorJobs(isAdmin);
  const pieces = useGenerationJobs();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const rows = useMemo(() => {
    const fresh = (at: string) => differenceInHours(now, new Date(at)) <= WINDOW_HOURS;
    const out: Row[] = [];
    if (isAdmin) {
      for (const job of videos.data ?? []) {
        const rank = videoRank(job);
        if (rank !== null && fresh(job.updated_at || job.created_at))
          out.push({ kind: "video", id: job.id, at: job.updated_at || job.created_at, rank, job });
      }
    }
    for (const job of pieces.data ?? []) {
      const rank = pieceRank(job);
      if (rank !== null && fresh(job.updated_at))
        out.push({ kind: "piece", id: job.id, at: job.updated_at, rank, job });
    }
    return out.sort((a, b) => a.rank - b.rank || b.at.localeCompare(a.at));
  }, [videos.data, pieces.data, isAdmin, now]);

  const failed = rows.filter((r) => r.rank === 0).length;
  const waiting = rows.filter((r) => r.rank === 1).length;
  const running = rows.filter((r) => r.rank === 2).length;
  const loading = pieces.isLoading || (isAdmin && videos.isLoading);
  const extra = rows.length - VISIBLE;

  return (
    <Panel
      label="Produção"
      testId="producao"
      // as contagens só aparecem quando a lista está cortada (senão repetem as linhas)
      aside={
        extra > 0 ? (
          <span className="flex items-center gap-1.5">
            {failed ? (
              <Pill tone="bad">
                {failed} {failed === 1 ? "falhou" : "falharam"}
              </Pill>
            ) : null}
            {waiting ? <Pill tone="wait">{waiting} para você</Pill> : null}
            {running ? <Pill tone="run">{running} rodando</Pill> : null}
          </span>
        ) : null
      }
      footer={
        <>
          {isAdmin ? <PanelLink to="/videos">Vídeos</PanelLink> : null}
          <PanelLink to="/biblioteca">Peças</PanelLink>
          {extra > 0 ? (
            <span className="ml-auto text-xs text-[var(--via-text-muted)] tabular-nums">
              +{extra} na fila
            </span>
          ) : null}
        </>
      }
    >
      {loading ? (
        <p className="text-sm text-[var(--via-text-muted)]">Carregando a fila…</p>
      ) : !rows.length ? (
        <p className="text-sm text-[var(--via-text-muted)]">
          Tudo em dia. O que você criar aparece aqui até ficar pronto.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {rows
            .slice(0, VISIBLE)
            .map((row) =>
              row.kind === "video" ? (
                <VideoLine key={`v-${row.id}`} job={row.job} />
              ) : (
                <PieceLine key={`p-${row.id}`} job={row.job} />
              ),
            )}
        </ul>
      )}
    </Panel>
  );
}

function Pill({ tone, children }: { tone: "bad" | "wait" | "run"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2 text-xs font-medium tabular-nums",
        tone === "bad" && "bg-[var(--via-coral)]/12 text-[var(--via-coral-dark)]",
        tone === "wait" && "bg-[var(--via-navy-06)] text-[var(--via-text-primary)]",
        tone === "run" && "text-[var(--via-text-muted)]",
      )}
    >
      {children}
    </span>
  );
}

function when(at: string) {
  return formatDistanceToNowStrict(new Date(at), { locale: ptBR, addSuffix: true });
}

function Line({
  icon,
  kind,
  title,
  status,
  at,
  bad,
  action,
}: {
  icon: React.ReactNode;
  kind: "Vídeo" | "Peça";
  title: string;
  status: string;
  at: string;
  bad?: boolean;
  action: React.ReactNode;
}) {
  return (
    <li className={cn(PANEL_ITEM, "flex min-h-32 min-w-0 flex-col gap-2")}>
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
          {icon}
        </span>
        <span className="min-w-0 truncate text-xs text-[var(--via-text-muted)]">
          {kind}
          {/* o estado some quando repete o título ("Quadros para aprovar") */}
          {status.toLowerCase() !== title.toLowerCase() ? (
            <>
              {" · "}
              <span className={cn(bad && "text-[var(--via-coral-dark)]")}>{status}</span>
            </>
          ) : null}
          {" · "}
          <span className="tabular-nums">{when(at)}</span>
        </span>
      </span>
      <span className="line-clamp-2 text-sm font-medium leading-snug text-[var(--via-text-primary)]">
        {title}
      </span>
      <span className="mt-auto flex justify-end">{action}</span>
    </li>
  );
}

const GO =
  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-sm font-medium text-[var(--via-text-primary)] transition-[gap] duration-200 hover:gap-2.5 focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]";

function VideoLine({ job }: { job: DirectorJob }) {
  const retry = useRetryDirectorJob();
  const failed = job.status === "failed";
  const waiting = job.status.startsWith("awaiting");
  const title =
    job.plan?.concept ||
    job.brief.title ||
    job.brief.smp ||
    job.brief.objetivo ||
    "Vídeo sem título";
  return (
    <Line
      kind="Vídeo"
      title={title}
      status={directorStatusLabel(job)}
      at={job.updated_at || job.created_at}
      bad={failed}
      icon={
        failed ? (
          <AlertCircle className="size-4 text-[var(--via-coral-dark)]" />
        ) : waiting ? (
          <Eye className="size-4 text-[var(--via-navy)]" />
        ) : (
          <Clapperboard className="size-4 text-[var(--via-text-muted)]" />
        )
      }
      action={
        failed ? (
          <Button
            size="sm"
            variant="outline"
            disabled={retry.isPending}
            aria-label={`Retomar: ${title}`}
            onClick={() =>
              retry.mutate(job, {
                onSuccess: () => toast.success("Produção retomada de onde parou."),
                onError: (err) =>
                  toast.error("Não deu para retomar", { description: humanizeError(err.message) }),
              })
            }
          >
            <RefreshCw className={cn(retry.isPending && "animate-spin")} aria-hidden="true" />{" "}
            Retomar
          </Button>
        ) : (
          <Link
            to="/videos"
            className={cn(GO, !waiting && "text-[var(--via-text-muted)]")}
            aria-label={`${waiting ? "Revisar" : "Ver"}: ${title}`}
          >
            {waiting ? "Revisar" : "Ver"}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        )
      }
    />
  );
}

function PieceLine({ job }: { job: GenerationJob }) {
  const failed = job.status === "failed";
  const angle = job.status === "awaiting_angle";
  const review = job.status === "awaiting_review";
  const topic = job.prompt.split("\n")[0].trim() || "Peça sem tema";
  return (
    <Line
      kind="Peça"
      title={topic}
      status={JOB_STATUS_LABELS[job.status]}
      at={job.updated_at}
      bad={failed}
      icon={
        failed ? (
          <AlertCircle className="size-4 text-[var(--via-coral-dark)]" />
        ) : angle ? (
          <Split className="size-4 text-[var(--via-navy)]" />
        ) : review ? (
          <Eye className="size-4 text-[var(--via-navy)]" />
        ) : (
          <span className="relative flex">
            <PenLine className="size-4 text-[var(--via-text-muted)]" />
            <Loader2 className="absolute -right-1.5 -bottom-1.5 size-2.5 animate-spin text-[var(--via-text-muted)]" />
          </span>
        )
      }
      action={
        <Link
          to="/criar/$jobId"
          params={{ jobId: job.id }}
          className={cn(GO, !failed && !angle && !review && "text-[var(--via-text-muted)]")}
          aria-label={`${angle ? "Escolher ângulo" : review ? "Revisar" : "Ver"}: ${topic}`}
        >
          {angle ? "Escolher ângulo" : review ? "Revisar" : "Ver"}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      }
    />
  );
}
