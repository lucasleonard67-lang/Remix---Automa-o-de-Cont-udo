import { Link } from "@tanstack/react-router";
import { PenLine } from "lucide-react";
import type { ReactNode } from "react";

import { AutopilotForm } from "@/components/onboarding/autopilot-form";
import { AutopilotProgress } from "@/components/onboarding/autopilot-progress";
import { AutopilotReview } from "@/components/onboarding/autopilot-review";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useBrandAutopilot,
  useBrandAutopilotRunner,
  type StartAutopilotInput,
} from "@/hooks/use-brand-autopilot";

// ---------------------------------------------------------------------------
// Onboarding automático ("autopilot"): três fases numa tela só — formulário
// (site + @), progresso ao vivo e revisão em uma página. O wizard de 9 passos
// continua disponível em "Configurar manualmente" (?modo=manual).
// ---------------------------------------------------------------------------

export interface StepAutopilotProps {
  brandName: string | null;
  /** "Começar a criar" — fecha a revisão e vai para o app. */
  onStartCreating: () => void;
}

export function StepAutopilot({ brandName, onStartCreating }: StepAutopilotProps) {
  const autopilot = useBrandAutopilot();
  const runner = useBrandAutopilotRunner(autopilot);
  const { state, start } = autopilot;

  const phase: "form" | "progress" | "review" =
    !state || state.status === "idle" ? "form" : state.status === "done" ? "review" : "progress";

  const handleStart = (input: StartAutopilotInput) => {
    start.mutate(input, { onError: () => undefined });
  };

  const host = state ? hostOf(state.input.site) : null;

  return (
    <AutopilotShell
      brandName={state?.review?.name ?? brandName}
      aside={
        phase === "form" ? (
          <Button variant="ghost" size="sm" asChild>
            <Link to="/onboarding" search={{ modo: "manual" }}>
              Configurar manualmente
            </Link>
          </Button>
        ) : null
      }
    >
      {phase === "form" ? (
        <div className="space-y-8">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--via-text-muted)]">
              Configuração inicial
            </p>
            <h1 className="text-3xl text-foreground">Comece pela sua marca</h1>
            <p className="max-w-xl text-sm text-[var(--via-text-muted)]">
              Cole o site e o Instagram. O sistema lê os dois, monta voz, posicionamento, regras e
              identidade visual, e você revisa no fim.
            </p>
          </div>
          <AutopilotForm
            pending={start.isPending}
            error={start.error ? start.error.message : null}
            onStart={handleStart}
          />
        </div>
      ) : null}

      {phase === "progress" && state ? (
        <div className="space-y-8">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--via-text-muted)]">
              {host ? `Lendo ${host}` : "Lendo sua marca"}
            </p>
            <h1 className="text-3xl text-foreground">Montando sua marca</h1>
            <p className="text-sm text-[var(--via-text-muted)]">
              Pode acompanhar aqui ou voltar depois — o progresso fica salvo.
            </p>
          </div>
          <AutopilotProgress
            state={state}
            callError={runner.stalled ? runner.error : null}
            retrying={autopilot.advance.isPending}
            onRetry={runner.retry}
          />
        </div>
      ) : null}

      {phase === "review" && state ? (
        <AutopilotReview state={state} onStart={onStartCreating} />
      ) : null}
    </AutopilotShell>
  );
}

function hostOf(site: string): string | null {
  try {
    return new URL(site).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function AutopilotShell({
  brandName,
  aside,
  children,
}: {
  brandName: string | null;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div className="flex items-center gap-2">
          <PenLine className="size-5 text-primary" aria-hidden="true" />
          <span className="text-sm font-medium tracking-tight text-foreground">
            {brandName || "Automação de Redes Sociais"}
          </span>
          <Badge variant="outline" className="font-normal text-muted-foreground">
            configuração inicial
          </Badge>
        </div>
        {aside}
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">{children}</main>
    </div>
  );
}
