import { SETUP_FLOW_STEPS } from "@/components/setup/setup-steps";
import type { SetupFlowStep } from "@/hooks/use-onboarding";
import { SuccessCheck } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Stepper horizontal do fluxo de configuração: concluído com check, atual com
// fio navy (`.ce-step-current`), futuros em contorno. "Concluído" é o que o passo
// de fato entregou (`completed`), não "veio antes do atual": passo pulado fica
// com o número. A linha entre os passos cresce em scaleX (220ms) e o check se
// desenha quando o passo fecha (.ce-check) — só transform/opacity/stroke.
// ---------------------------------------------------------------------------

export interface SetupStepperProps {
  current: SetupFlowStep;
  /** Maior passo já alcançado — até ele, dá para voltar clicando. */
  reached: SetupFlowStep;
  /** Passos cujo resultado existe (marca lida, redes ligadas…). */
  completed: ReadonlySet<SetupFlowStep>;
  onSelect: (step: SetupFlowStep) => void;
}

export function SetupStepper({ current, reached, completed, onSelect }: SetupStepperProps) {
  const total = SETUP_FLOW_STEPS.length;
  return (
    <ol className="flex" aria-label="Passos da configuração">
      {SETUP_FLOW_STEPS.map((item, index) => {
        const isCurrent = item.step === current;
        const done = completed.has(item.step) && !isCurrent;
        const clickable = item.step <= reached && !isCurrent;
        const previous = index > 0 ? SETUP_FLOW_STEPS[index - 1].step : null;
        const prevDone = previous !== null && completed.has(previous) && previous !== current;
        return (
          <li
            key={item.step}
            className="relative flex min-w-0 flex-1 flex-col items-center text-center"
            aria-current={isCurrent ? "step" : undefined}
          >
            {index > 0 ? <Connector side="left" on={prevDone} /> : null}
            {index < total - 1 ? <Connector side="right" on={done} /> : null}
            <button
              type="button"
              onClick={() => clickable && onSelect(item.step)}
              disabled={!clickable}
              className={cn(
                "group relative z-10 flex flex-col items-center gap-2 rounded-[var(--via-radius-md)] px-1 focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]",
                !clickable && "cursor-default",
              )}
            >
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full font-mono text-[11px] font-medium tabular-nums transition-transform duration-[180ms] ease-[var(--via-ease-snap)]",
                  done
                    ? "bg-[var(--via-navy)] text-white"
                    : isCurrent
                      ? "ce-step-current border border-[var(--via-navy)] bg-[var(--via-surface)] text-[var(--via-text-primary)]"
                      : "border border-[var(--via-border)] bg-[var(--via-surface)] text-[var(--via-text-faint)]",
                  clickable && "group-hover:scale-105 group-active:scale-95",
                )}
              >
                {done ? <SuccessCheck key="check" className="size-3.5" /> : item.step}
                {done ? <span className="sr-only">Concluído</span> : null}
              </span>
              <span
                className={cn(
                  "text-xs leading-snug",
                  done || isCurrent
                    ? "text-[var(--via-text-primary)]"
                    : "text-[var(--via-text-muted)]",
                  isCurrent && "font-medium",
                )}
              >
                {item.label}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Metade da linha entre dois passos; a cor "cresce" da esquerda quando o passo fecha. */
function Connector({ side, on }: { side: "left" | "right"; on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute top-3 h-px bg-[var(--via-border)]",
        side === "left" ? "left-0 right-1/2" : "left-1/2 right-0",
      )}
    >
      <span
        className={cn(
          "absolute inset-0 origin-left bg-[var(--via-navy)] transition-transform duration-[220ms] ease-[var(--via-ease-out)]",
          on ? "scale-x-100" : "scale-x-0",
        )}
      />
    </span>
  );
}
