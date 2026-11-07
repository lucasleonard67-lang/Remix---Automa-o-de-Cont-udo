import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Check, Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";

import { AngleSelector } from "@/components/angle-selector";
import { BrandIcon } from "@/components/brand-icon";
import { ProgressRing, StageSegments } from "@/components/criar/job-progress";
import {
  pipelineFraction,
  stageDetail,
  stageTitle,
  stageViews,
  withClaude,
} from "@/components/criar/job-stage";
import { StepPublish } from "@/components/setup/step-publish";
import { Button } from "@/components/ui/button";
import { CHANNEL_TYPE_LABELS } from "@/hooks/use-channels";
import { useCancelJob, useGenerationJob, useJobPieces } from "@/hooks/use-generation-jobs";
import { promptDeConteudo, urlDoClaude } from "@/lib/claude-prompt";
import { humanizeError } from "@/lib/humanize-error";
import { toast } from "@/lib/toast";

// ---------------------------------------------------------------------------
// A criação acontece AQUI, na própria tela Criar — sem ir para /criar/{id} nem
// para a Biblioteca. Três estados no mesmo lugar:
//   criando  → anel, etapa, formatos; escolha de ângulo quando o motor pede
//   parou    → motivo em português e "Tentar de novo"
//   pronto   → as peças com aprovar/publicar inline (StepPublish) e
//              "Criar outra"
// O id da geração fica em localStorage: recarregar a página volta aqui.
// ---------------------------------------------------------------------------

const POLL_MS = 4000;
const TERMINAL = new Set(["done", "failed", "cancelled"]);

export function CreationStage({ jobId, onRestart }: { jobId: string; onRestart: () => void }) {
  const jobQuery = useGenerationJob(jobId, { refetchInterval: POLL_MS });
  const job = jobQuery.data ?? null;
  const ready = job?.status === "awaiting_review" || job?.status === "done";
  const piecesQuery = useJobPieces(jobId, { enabled: ready });
  const pieces = piecesQuery.data ?? [];
  const terminal = job ? TERMINAL.has(job.status) : false;
  const cancelJob = useCancelJob();

  // geração apagada → volta ao formulário
  const cleared = useRef(false);
  useEffect(() => {
    if (!cleared.current && jobQuery.isSuccess && jobQuery.data === null) {
      cleared.current = true;
      onRestart();
    }
  }, [jobQuery.isSuccess, jobQuery.data, onRestart]);

  if (!job) {
    return (
      <div
        className="flex items-center gap-3 text-sm text-[var(--via-text-muted)]"
        aria-busy="true"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        {jobQuery.isLoading ? "Começando a criar…" : "Procurando a sua criação…"}
      </div>
    );
  }

  const failed = job.status === "failed";
  const cancelled = job.status === "cancelled";
  const fraction = pipelineFraction(job);
  const detail = stageDetail(job);

  return (
    <section className="space-y-6" aria-live="polite" data-testid="criacao">
      <div className="flex flex-wrap items-center gap-5">
        <ProgressRing
          fraction={fraction}
          failed={failed}
          label={`${stageTitle(job)}, ${Math.round(fraction * 100)}% da criação`}
        >
          {ready ? (
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
          <h2 className="text-lg font-medium leading-tight tracking-[-0.02em] text-[var(--via-text-primary)]">
            {failed
              ? "A criação parou"
              : cancelled
                ? "Criação cancelada"
                : ready && pieces.length
                  ? `Pronto: ${pieces.length === 1 ? "1 peça" : `${pieces.length} peças`}`
                  : stageTitle(job)}
          </h2>
          {ready && pieces.length ? (
            <p className="text-xs text-[var(--via-text-muted)]">
              {pieces.map((p) => CHANNEL_TYPE_LABELS[p.channel_type] ?? p.channel_type).join(" · ")}
            </p>
          ) : null}
          {failed || (detail && !ready) ? (
            <p className="text-sm text-[var(--via-text-muted)]">
              {failed ? humanizeError(job.error ?? "") : detail}
            </p>
          ) : null}
          {withClaude(job) ? (
            <Button asChild size="sm" className="mt-1">
              <a
                href={urlDoClaude(promptDeConteudo(job.id, job.prompt))}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="abrir-no-claude"
              >
                <BrandIcon name="claude" />
                Abrir no Claude
              </a>
            </Button>
          ) : !terminal && !ready ? (
            <StageSegments views={stageViews(job)} withLabels className="max-w-md" />
          ) : null}
        </div>
        {!terminal && !ready ? (
          <p className="text-xs text-[var(--via-text-muted)]">
            Pode sair — a criação continua e volta aqui.
          </p>
        ) : null}
      </div>

      {job.status === "awaiting_angle" ? <AngleSelector job={job} /> : null}

      {ready && pieces.length ? (
        <div className="space-y-5 border-t border-[var(--via-border-soft)] pt-5">
          <StepPublish preferPieceIds={pieces.map((p) => p.id)} />
          {pieces.length > 1 ? (
            <ul className="flex flex-wrap gap-2" aria-label="Todas as peças desta criação">
              {pieces.map((p) => (
                <li key={p.id}>
                  <Button asChild variant="outline" size="sm">
                    <Link to="/biblioteca/$pieceId" params={{ pieceId: p.id }}>
                      {CHANNEL_TYPE_LABELS[p.channel_type] ?? p.channel_type}
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {failed || cancelled ? (
          <Button onClick={onRestart}>Tentar de novo</Button>
        ) : ready ? (
          <Button variant="outline" onClick={onRestart}>
            Criar outra
          </Button>
        ) : (
          /* A pessoa nunca fica presa esperando: "Criar outra coisa" devolve o
             formulário (esta criação segue em segundo plano e o app avisa);
             "Cancelar" para esta de vez. */
          <>
            <Button variant="outline" size="sm" onClick={onRestart}>
              Criar outra coisa
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-[var(--via-coral-dark)] hover:text-[var(--via-coral-dark)]"
              disabled={cancelJob.isPending}
              onClick={() =>
                cancelJob.mutate(jobId, {
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
          </>
        )}
        <blockquote className="line-clamp-1 flex-1 border-l-2 border-[var(--via-border)] pl-3 text-xs text-[var(--via-text-muted)]">
          {job.prompt}
        </blockquote>
      </div>
    </section>
  );
}
