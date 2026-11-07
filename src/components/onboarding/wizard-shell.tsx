import { Check, Circle, Lock, LogOut, PenLine } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  ONBOARDING_STEPS,
  type OnboardingProgress,
  type OnboardingStepMeta,
} from "@/hooks/use-onboarding";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// WizardShell (docs/05 §4.4): coluna esquerda com o stepper dos 9 passos
// (concluído ✓ · atual · bloqueado), área principal com o passo corrente e
// rodapé de navegação. Layout próprio — o wizard não usa a sidebar do app.
// ---------------------------------------------------------------------------

type StepState = "done" | "current" | "available" | "locked";

function stepState(meta: OnboardingStepMeta, current: number, completed: number[]): StepState {
  if (meta.step === current) return "current";
  if (completed.includes(meta.step)) return "done";
  // Passos já visitados (abaixo do maior progresso registrado) continuam abertos.
  return meta.step < current ? "available" : "locked";
}

export interface WizardShellProps {
  progress: OnboardingProgress;
  currentStep: number;
  onSelectStep: (step: number) => void;
  /** "Salvar e sair" só aparece quando sair é possível (mínimo viável atingido). */
  canExit: boolean;
  onExit: () => void;
  children: ReactNode;
}

export function WizardShell({
  progress,
  currentStep,
  onSelectStep,
  canExit,
  onExit,
  children,
}: WizardShellProps) {
  const meta = ONBOARDING_STEPS.find((item) => item.step === currentStep) ?? ONBOARDING_STEPS[0];
  const doneCount = progress.completed_steps.length;
  const percent = Math.round((doneCount / ONBOARDING_STEPS.length) * 100);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div className="flex items-center gap-2">
          <PenLine className="size-5 text-primary" aria-hidden="true" />
          <span className="text-sm font-medium tracking-tight text-foreground">
            {progress.brand_name || "Automação de Redes Sociais"}
          </span>
          <Badge variant="outline" className="font-normal text-muted-foreground">
            configuração inicial
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {doneCount} de {ONBOARDING_STEPS.length} passos concluídos
          </span>
          {canExit ? (
            <Button variant="ghost" size="sm" onClick={onExit}>
              <LogOut aria-hidden="true" />
              Salvar e sair
            </Button>
          ) : null}
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-8 px-6 py-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* Stepper — vertical no desktop, barra de progresso no mobile */}
        <nav aria-label="Passos do onboarding" className="hidden lg:block">
          <ol className="space-y-1">
            {ONBOARDING_STEPS.map((item) => {
              const state = stepState(item, currentStep, progress.completed_steps);
              const clickable = state !== "locked";
              return (
                <li key={item.step}>
                  <button
                    type="button"
                    onClick={() => clickable && onSelectStep(item.step)}
                    disabled={!clickable}
                    aria-current={state === "current" ? "step" : undefined}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                      state === "current" && "bg-[var(--via-navy-06)]",
                      clickable && state !== "current" && "hover:bg-[var(--via-navy-06)]",
                      // opacity apagava o texto (2.78 medido): bloqueado é COR, não transparência
                      !clickable && "cursor-default [&_span]:text-[var(--via-text-disabled)]",
                    )}
                  >
                    <StepIcon state={state} step={item.step} />
                    <span className="min-w-0">
                      <span
                        className={cn(
                          "block truncate text-sm",
                          state === "current"
                            ? "font-medium text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {item.title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.short}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="min-w-0 space-y-6">
          <div className="space-y-3 lg:hidden">
            <Progress value={percent} aria-label="Progresso do onboarding" />
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Passo {meta.step} de {ONBOARDING_STEPS.length}
            </p>
            <h1 className="mt-1 text-3xl text-foreground">{meta.title}</h1>
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}

function StepIcon({ state, step }: { state: StepState; step: number }) {
  if (state === "done") {
    return (
      <span
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
        aria-hidden="true"
      >
        <Check className="size-3" />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-primary text-xs font-medium text-primary"
        aria-hidden="true"
      >
        {step}
      </span>
    );
  }
  if (state === "locked") {
    return (
      <Lock className="mt-0.5 size-5 shrink-0 p-0.5 text-muted-foreground" aria-hidden="true" />
    );
  }
  return (
    <Circle className="mt-0.5 size-5 shrink-0 p-0.5 text-muted-foreground" aria-hidden="true" />
  );
}

// ---------------------------------------------------------------------------
// Rodapé de navegação do passo
// ---------------------------------------------------------------------------

export interface WizardFooterProps {
  onBack?: (() => void) | null;
  /** Mensagem do que falta para liberar o botão principal. */
  hint?: ReactNode;
  children: ReactNode;
}

export function WizardFooter({ onBack, hint, children }: WizardFooterProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      <div className="flex items-center gap-3">
        {onBack ? (
          <Button variant="ghost" onClick={onBack}>
            Voltar
          </Button>
        ) : (
          <span />
        )}
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
