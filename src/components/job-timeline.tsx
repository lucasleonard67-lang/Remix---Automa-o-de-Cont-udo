import {
  AlertTriangle,
  Ban,
  Check,
  ChevronRight,
  Globe,
  Loader2,
  Minus,
  RotateCcw,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import {
  useJobPieces,
  useResumeJob,
  type GenerationJob,
  type JobStatus,
  type JobTimings,
  type TimedStage,
} from "@/hooks/use-generation-jobs";
import { cn } from "@/lib/utils";
import { humanizeError } from "@/lib/humanize-error";

// ---------------------------------------------------------------------------
// Etapas visuais da máquina de estados do job (docs/05-rotas-e-modulos.md §4.1):
// Classificar → Ângulo → Contexto → [Pesquisa] → Gerar → Auditar → Adaptar → Revisão.
// linting/grounding/judging colapsam em "Auditar"; rewriting volta a "Gerar".
// "Pesquisa" (etapa researching) só aparece quando o job pediu pesquisa web.
// ---------------------------------------------------------------------------

type StepKey =
  "classify" | "angle" | "context" | "research" | "generate" | "audit" | "adapt" | "review";

type StepState = "pending" | "running" | "waiting" | "done" | "failed" | "skipped";

const ALL_STEPS: Array<{ key: StepKey; label: string }> = [
  { key: "classify", label: "Tema" },
  { key: "angle", label: "Ângulo" },
  { key: "context", label: "Contexto" },
  { key: "research", label: "Pesquisa" },
  { key: "generate", label: "Escrever" },
  { key: "audit", label: "Conferir" },
  { key: "adapt", label: "Adaptar" },
  { key: "review", label: "Revisão" },
];

/** Passos visíveis para o job: "Pesquisa" só quando foi pedida. */
function stepsForJob(job: GenerationJob): Array<{ key: StepKey; label: string }> {
  return job.web_research?.requested
    ? ALL_STEPS
    : ALL_STEPS.filter((step) => step.key !== "research");
}

const STATUS_TO_STEP: Partial<Record<JobStatus, StepKey>> = {
  created: "classify",
  classifying: "classify",
  awaiting_angle: "angle",
  retrieving: "context",
  researching: "research",
  generating: "generate",
  rewriting: "generate",
  linting: "audit",
  grounding: "audit",
  judging: "audit",
  adapting: "adapt",
  awaiting_review: "review",
};

/** Etapa de `timings` que comprova a conclusão do passo visual. */
const STEP_DONE_TIMING: Partial<Record<StepKey, TimedStage>> = {
  classify: "classifying",
  context: "retrieving",
  research: "researching",
  generate: "generating",
  audit: "judging",
  adapt: "adapting",
};

const AUDIT_SUBSTAGE_LABELS: Partial<Record<JobStatus, string>> = {
  linting: "regras da marca",
  grounding: "fatos",
  judging: "qualidade",
};

function formatMs(ms: number | undefined): string | null {
  if (!ms || !Number.isFinite(ms)) return null;
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Duração agregada do passo visual a partir da telemetria por etapa. */
function stepDuration(key: StepKey, timings: JobTimings): string | null {
  switch (key) {
    case "classify":
      return formatMs(timings.classifying?.ms);
    case "context":
      return formatMs(timings.retrieving?.ms);
    case "research":
      return formatMs(timings.researching?.ms);
    case "generate": {
      const total = (timings.generating?.ms ?? 0) + (timings.rewriting?.ms ?? 0);
      return formatMs(total);
    }
    case "audit": {
      const total =
        (timings.linting?.ms ?? 0) + (timings.grounding?.ms ?? 0) + (timings.judging?.ms ?? 0);
      return formatMs(total);
    }
    case "adapt":
      return formatMs(timings.adapting?.ms);
    default:
      return null;
  }
}

/**
 * Passo onde a falha aconteceu: primeiro passo executável sem telemetria de
 * conclusão (o checkpoint grava o timing ao fim de cada etapa — aproximação).
 */
function failedStepKey(job: GenerationJob, steps: Array<{ key: StepKey }>): StepKey {
  for (const step of steps) {
    const timingKey = STEP_DONE_TIMING[step.key];
    if (!timingKey) continue; // angle/review não "falham"
    if (!job.timings?.[timingKey]) return step.key;
  }
  return "adapt";
}

function computeStepStates(
  job: GenerationJob,
  steps: Array<{ key: StepKey; label: string }>,
): Record<StepKey, StepState> {
  const states = Object.fromEntries(steps.map((step) => [step.key, "pending"])) as Record<
    StepKey,
    StepState
  >;
  const angleSkipped = job.classification ? !job.classification.needs_angle_choice : false;
  const researchSkipped = Boolean(job.web_research?.skipped);

  const applyOverrides = (boundaryIndex: number) => {
    if (angleSkipped && boundaryIndex > steps.findIndex((s) => s.key === "angle")) {
      states.angle = "skipped";
    }
    const researchIndex = steps.findIndex((s) => s.key === "research");
    if (researchIndex >= 0 && researchSkipped && boundaryIndex > researchIndex) {
      states.research = "skipped";
    }
  };

  const markUpTo = (boundary: StepKey, boundaryState: StepState) => {
    const boundaryIndex = steps.findIndex((step) => step.key === boundary);
    steps.forEach((step, index) => {
      if (index < boundaryIndex) states[step.key] = "done";
      else if (index === boundaryIndex) states[step.key] = boundaryState;
    });
    applyOverrides(boundaryIndex);
  };

  if (job.status === "done") {
    steps.forEach((step) => (states[step.key] = "done"));
    applyOverrides(steps.length);
    return states;
  }

  if (job.status === "failed") {
    markUpTo(failedStepKey(job, steps), "failed");
    return states;
  }

  if (job.status === "cancelled") {
    // Congela o progresso onde parou; o restante fica pendente (esmaecido).
    markUpTo(failedStepKey(job, steps), "pending");
    return states;
  }

  const activeStep = STATUS_TO_STEP[job.status] ?? "classify";
  const activeState: StepState =
    job.status === "awaiting_angle" || job.status === "awaiting_review" ? "waiting" : "running";
  markUpTo(activeStep, activeState);
  return states;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

// Chips de etapa no vocabulário de "Primeiros passos": concluída = navy cheio,
// atual = halo do kit, pendente = contorno suave em texto fraco.
const STATE_CLASSES: Record<StepState, string> = {
  pending: "border-[var(--via-border-soft)] bg-[var(--via-surface)] text-[var(--via-text-faint)]",
  running:
    "ce-step-current border-[var(--via-navy)] bg-[var(--via-surface)] font-medium text-[var(--via-text-primary)]",
  waiting:
    "ce-step-current border-[var(--via-navy)] bg-[var(--via-surface)] font-medium text-[var(--via-text-primary)]",
  done: "border-transparent bg-[var(--via-navy)] text-white",
  failed: "border-[var(--via-coral)] bg-[var(--via-surface)] text-[var(--via-coral-dark)]",
  skipped:
    "border-dashed border-[var(--via-border-soft)] bg-[var(--via-surface)] text-[var(--via-text-faint)]",
};

function StepIcon({ state }: { state: StepState }) {
  switch (state) {
    case "running":
      return <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden="true" />;
    case "waiting":
      // o pulso fica no ÍCONE: no contêiner ele derrubava o texto a 50% de
      // opacidade (2.31 medido em "avalie na Biblioteca")
      return <Loader2 className="size-3.5 animate-pulse text-primary" aria-hidden="true" />;
    case "done":
      return <Check className="size-3.5 text-current" aria-hidden="true" />;
    case "failed":
      return <AlertTriangle className="size-3.5" aria-hidden="true" />;
    case "skipped":
      return <Minus className="size-3.5" aria-hidden="true" />;
    default:
      return <span className="block size-1.5 rounded-full bg-current" aria-hidden="true" />;
  }
}

/** Detalhe contextual exibido sob o rótulo do passo. */
function stepDetail(key: StepKey, state: StepState, job: GenerationJob): string | null {
  if (key === "angle") {
    if (state === "waiting") return "escolha abaixo";
    if (state === "skipped") return "automático";
    if (job.selected_angle?.title) return job.selected_angle.title;
    return null;
  }
  if (key === "audit" && state === "running") {
    return AUDIT_SUBSTAGE_LABELS[job.status] ?? null;
  }
  if (key === "generate" && job.status === "rewriting" && state === "running") {
    return `tentativa ${Math.max(job.attempt, 1)}/2`;
  }
  if (key === "context" && state === "done" && job.context_ids.length > 0) {
    return `${job.context_ids.length} ${job.context_ids.length === 1 ? "item" : "itens"}`;
  }
  if (key === "research") {
    if (state === "skipped") return "pulada";
    if (state === "done" && job.web_research?.sources?.length) {
      const n = job.web_research.sources.length;
      return `${n} ${n === 1 ? "fonte" : "fontes"}`;
    }
  }
  if (key === "review" && state === "waiting") return "clique para revisar";
  return stepDuration(key, job.timings ?? {});
}

/**
 * Para onde cada fase leva. Atalho de navegação, não enfeite: só devolve
 * destino quando a fase concluiu (ou espera ação) E o destino existe de fato.
 * Classificar/Ângulo/Pesquisa não ganham link — a escolha de ângulo e as
 * fontes já estão nesta mesma página, logo abaixo.
 */
type Destino = {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
  titulo: string;
};

function stepTarget(
  key: StepKey,
  state: StepState,
  job: GenerationJob,
  pieces: Array<{ id: string }>,
): Destino | null {
  if (state !== "done" && state !== "waiting") return null; // nada de link em falha/pendente
  const peca = pieces.length === 1 ? pieces[0] : null;
  switch (key) {
    case "context":
      return job.context_ids.length > 0
        ? { to: "/contexto", titulo: "Ver os itens de Contexto usados" }
        : null;
    case "review":
      // o exemplo do pedido: a fase de aprovação leva à área de aprovação
      return { to: "/biblioteca", search: { status: "draft" }, titulo: "Revisar na Biblioteca" };
    case "generate":
    case "audit":
    case "adapt":
      if (peca) {
        return {
          to: "/biblioteca/$pieceId",
          params: { pieceId: peca.id },
          titulo: key === "audit" ? "Ver a conferência na peça" : "Abrir a peça",
        };
      }
      return pieces.length > 1
        ? { to: "/biblioteca", search: { status: "draft" }, titulo: "Ver as peças na Biblioteca" }
        : null;
    default:
      return null;
  }
}

interface JobTimelineProps {
  job: GenerationJob;
}

/**
 * Linha de etapas da saga do job (`/criar` zona 2) — estado atual pulsando,
 * tempos por etapa via `timings`, reescrita com contador de tentativa e
 * falha com "Tentar de novo" (resume-job). Alimentada por Realtime.
 */
export function JobTimeline({ job }: JobTimelineProps) {
  const resumeJob = useResumeJob();
  const steps = stepsForJob(job);
  const states = computeStepStates(job, steps);
  const pieces = useJobPieces(job.id).data ?? [];

  const retry = () => {
    if (resumeJob.isPending) return;
    resumeJob.mutate(
      { job_id: job.id },
      {
        onSuccess: () => {
          toast.success("Geração retomada", {
            description: "Ela continua da última etapa concluída.",
          });
        },
        onError: (error) => {
          toast.error("Não foi possível retomar", { description: error.message });
        },
      },
    );
  };

  return (
    <div className="space-y-3">
      <ol className="flex flex-wrap items-center gap-y-2">
        {steps.map((step, index) => {
          const state = states[step.key];
          const detail = stepDetail(step.key, state, job);
          const destino = stepTarget(step.key, state, job, pieces);
          const conteudo = (
            <>
              <StepIcon state={state} />
              <span className="text-xs font-medium leading-tight">{step.label}</span>
              {detail ? (
                <span
                  className="max-w-28 truncate text-xs font-normal leading-tight opacity-80"
                  title={detail}
                >
                  {detail}
                </span>
              ) : null}
            </>
          );
          const base = cn(
            "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors duration-[var(--via-dur)]",
            STATE_CLASSES[state],
          );
          return (
            <li key={step.key} className="flex items-center">
              {destino ? (
                <Link
                  to={destino.to}
                  params={destino.params}
                  search={destino.search}
                  title={destino.titulo}
                  aria-label={`${step.label} — ${destino.titulo}`}
                  className={cn(
                    base,
                    "ce-tile cursor-pointer",
                    "focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]",
                  )}
                >
                  {conteudo}
                </Link>
              ) : (
                <div className={base}>{conteudo}</div>
              )}
              {index < steps.length - 1 ? (
                <ChevronRight
                  className="mx-0.5 size-3 shrink-0 text-muted-foreground/50"
                  aria-hidden="true"
                />
              ) : null}
            </li>
          );
        })}
      </ol>

      <WebResearchNote job={job} />

      {job.status === "rewriting" ? (
        <span className="via-meta-chip">
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          reescrevendo para melhorar a nota — tentativa {Math.max(job.attempt, 1)}/2
        </span>
      ) : null}

      {job.status === "cancelled" ? (
        <span className="via-meta-chip">
          <Ban className="size-3" aria-hidden="true" />
          Geração cancelada
        </span>
      ) : null}

      {job.status === "failed" ? (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <AlertTriangle
            className="size-4 shrink-0 text-[var(--via-coral-dark)]"
            aria-hidden="true"
          />
          <p className="min-w-0 flex-1 text-sm text-[var(--via-text-body)]">
            {job.error ? humanizeError(job.error) : "Motivo não informado."} Clique em Tentar de
            novo para continuar de onde parou.
          </p>
          <Button variant="outline" size="sm" onClick={retry} disabled={resumeJob.isPending}>
            {resumeJob.isPending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw aria-hidden="true" />
            )}
            Tentar de novo
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Resultado da pesquisa web do job: fontes encontradas (links) ou o motivo de
 * ter sido pulada. Só renderiza quando a etapa aconteceu (ou foi pulada).
 */
function WebResearchNote({ job }: { job: GenerationJob }) {
  const research = job.web_research;
  if (!research?.requested) return null;

  if (research.skipped) {
    return (
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Globe className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Pesquisa web pulada (
          {research.error ? humanizeError(research.error) : "serviço indisponível"}). A peça usou só
          o seu Contexto.
        </span>
      </p>
    );
  }

  // quem falhou antes de alguém responder: sem isto o failover é invisível e a
  // instância fica com um provedor quebrado no topo da ordem sem ninguém notar
  const falhas = research.attempts ?? [];

  const sources = research.sources ?? [];
  if (sources.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Globe className="size-3.5" aria-hidden="true" />
        Fontes da pesquisa web{research.provider ? ` (${research.provider})` : ""}
      </p>
      {falhas.length > 0 ? (
        <p className="text-xs leading-tight text-muted-foreground">
          {falhas.map((f) => f.provider).join(", ")} {falhas.length === 1 ? "falhou" : "falharam"}.
          A busca foi feita no {research.provider}.
        </p>
      ) : null}
      <ul className="flex flex-wrap gap-1.5">
        {sources.map((source) => (
          <li key={source.url}>
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              title={source.url}
              className="via-meta-chip ce-tile max-w-56 truncate hover:text-[var(--via-text-primary)]"
            >
              {source.title || source.url}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
