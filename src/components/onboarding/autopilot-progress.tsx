import { Link } from "@tanstack/react-router";
import { AlertTriangle, Check, CircleAlert, Loader2, Minus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AUTOPILOT_STEP_IDS,
  AUTOPILOT_STEP_LABELS,
  type AutopilotState,
  type AutopilotStep,
  type AutopilotStepStatus,
} from "@/hooks/use-brand-autopilot";
import { cn } from "@/lib/utils";
import { humanizeError } from "@/lib/humanize-error";

// ---------------------------------------------------------------------------
// Progresso ao vivo: Stepper vertical (atual com halo) + barra com brilho +
// resumo de uma frase por etapa concluída. Só transform/opacity animam.
// ---------------------------------------------------------------------------

const ENTER =
  "animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-[220ms] ease-[var(--via-ease-out)]";

export interface AutopilotProgressProps {
  state: AutopilotState;
  /** Erro de rede da chamada (o estado em si pode seguir `running`). */
  callError: string | null;
  retrying: boolean;
  onRetry: () => void;
}

export function AutopilotProgress({ state, callError, retrying, onRetry }: AutopilotProgressProps) {
  const steps = AUTOPILOT_STEP_IDS.map(
    (id) =>
      state.steps.find((step) => step.id === id) ?? {
        id,
        status: "pending" as const,
        summary: null,
        error: null,
        started_at: null,
        finished_at: null,
      },
  );
  const finished = steps.filter((step) => isFinished(step.status)).length;
  const percent = Math.round((finished / steps.length) * 100);
  const failed = state.status === "failed";
  const running = state.status === "running";

  return (
    <div className="space-y-8">
      <ProgressBar percent={percent} active={running} />

      <ol className="space-y-1" aria-label="Etapas da leitura">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className={cn("flex gap-4 py-3", ENTER)}
            style={{ animationDelay: `${index * 60}ms` }}
          >
            <StepMark status={step.status} />
            <div className="min-w-0 flex-1 space-y-1 pt-0.5">
              <p
                className={cn(
                  "text-sm",
                  step.status === "running" ? "font-medium text-foreground" : "text-foreground",
                  step.status === "pending" && "text-[var(--via-text-faint)]",
                )}
              >
                {AUTOPILOT_STEP_LABELS[step.id]}
              </p>
              {step.summary ? (
                <p
                  key={step.summary}
                  className="animate-in fade-in fill-mode-both text-sm text-[var(--via-text-muted)] duration-[180ms]"
                >
                  {step.summary}
                </p>
              ) : null}
              {step.error && step.status !== "running" ? (
                <p className="text-xs text-[var(--via-text-faint)]">{humanizeError(step.error)}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      {failed || callError ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
          <AlertTriangle className="size-4 text-destructive" aria-hidden="true" />
          <span className="text-sm text-foreground">
            {callError
              ? humanizeError(callError)
              : "A leitura parou. Você pode tentar de novo ou preencher à mão."}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/onboarding" search={{ modo: "manual" }}>
                Configurar manualmente
              </Link>
            </Button>
            <Button size="sm" onClick={onRetry} disabled={retrying}>
              {retrying ? "Tentando…" : "Tentar de novo"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function isFinished(status: AutopilotStepStatus): boolean {
  return (
    status === "done" || status === "skipped" || status === "needs_review" || status === "failed"
  );
}

function ProgressBar({ percent, active }: { percent: number; active: boolean }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label="Progresso da leitura"
      className="relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--via-navy-06)]"
    >
      <div
        className="h-full w-full origin-left rounded-full bg-[var(--via-navy)] transition-transform duration-700 ease-[var(--via-ease-out)]"
        style={{ transform: `scaleX(${Math.max(0.02, percent / 100)})` }}
      >
        {active ? (
          <span
            aria-hidden="true"
            className="via-autopilot-shine absolute inset-y-0 left-0 w-1/3 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.45),transparent)]"
          />
        ) : null}
      </div>
      <style>{`
        @keyframes via-autopilot-shine { from { transform: translateX(-100%); } to { transform: translateX(400%); } }
        .via-autopilot-shine { animation: via-autopilot-shine 1.6s var(--via-ease) infinite; }
      `}</style>
    </div>
  );
}

function StepMark({ status }: { status: AutopilotStep["status"] }) {
  const base = "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full";
  switch (status) {
    case "done":
      return (
        <span className={cn(base, "bg-[var(--via-navy)] text-white")} aria-hidden="true">
          <Check className="size-3.5" />
        </span>
      );
    case "running":
      return (
        <span
          className={cn(
            base,
            "border-2 border-[var(--via-navy)] text-[var(--via-navy)] shadow-[var(--via-shadow-focus)]",
          )}
          aria-hidden="true"
        >
          <Loader2 className="size-3.5 animate-spin" />
        </span>
      );
    case "skipped":
      return (
        <span
          className={cn(base, "border border-[var(--via-border)] text-[var(--via-text-faint)]")}
          aria-hidden="true"
        >
          <Minus className="size-3.5" />
        </span>
      );
    case "needs_review":
      return (
        <span
          className={cn(base, "border-2 border-[var(--via-navy)] text-[var(--via-navy)]")}
          aria-hidden="true"
        >
          <CircleAlert className="size-3.5" />
        </span>
      );
    case "failed":
      return (
        <span className={cn(base, "bg-destructive text-white")} aria-hidden="true">
          <AlertTriangle className="size-3.5" />
        </span>
      );
    default:
      return <span className={cn(base, "border border-[var(--via-border)]")} aria-hidden="true" />;
  }
}
