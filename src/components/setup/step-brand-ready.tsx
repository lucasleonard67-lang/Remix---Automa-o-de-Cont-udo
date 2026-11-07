import { AutopilotProgress } from "@/components/onboarding/autopilot-progress";
import { AutopilotReview } from "@/components/onboarding/autopilot-review";
import type { AutopilotState } from "@/hooks/use-brand-autopilot";

// ---------------------------------------------------------------------------
// Passo 5 · Marca pronta — progresso enquanto a leitura roda; revisão compacta
// quando termina. Falhou: o próprio progresso oferece "Tentar de novo" e
// "Configurar manualmente".
// ---------------------------------------------------------------------------

export interface StepBrandReadyProps {
  state: AutopilotState | null;
  callError: string | null;
  retrying: boolean;
  onRetry: () => void;
}

export function StepBrandReady({ state, callError, retrying, onRetry }: StepBrandReadyProps) {
  if (!state || state.status === "idle") {
    return (
      <p className="text-sm text-[var(--via-text-muted)]">
        A leitura ainda não começou. Volte a Sua marca e clique em “Ler minha marca”.
      </p>
    );
  }

  if (state.status === "done") {
    return <AutopilotReview state={state} onStart={() => undefined} compact />;
  }

  return (
    <AutopilotProgress state={state} callError={callError} retrying={retrying} onRetry={onRetry} />
  );
}
