import { IntegrationGroups } from "@/components/integration-grid";
import { WizardFooter } from "@/components/onboarding/wizard-shell";
import type { OnboardingStepProps } from "@/components/onboarding/types";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Passo 2 — IA e integrações. A IA já vem ligada (Lovable AI), então o passo
// é opcional: cada serviço é um ladrilho que diz o que faz e quando o usuário
// vai precisar dele; clicar abre o modal com a chave. Mesma grade de Config,
// então o que se conecta aqui é o que a produção usa depois.
// ---------------------------------------------------------------------------

export function StepAiIntegrations({ advancing, onBack, onAdvance }: OnboardingStepProps) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        A IA já vem ligada: dá para continuar sem configurar nada. Clique em um serviço para
        conectar agora. Dá para mudar depois nas Integrações.
      </p>

      <IntegrationGroups />

      <WizardFooter onBack={onBack}>
        <Button onClick={() => void onAdvance()} disabled={advancing}>
          {advancing ? "Salvando…" : "Continuar"}
        </Button>
      </WizardFooter>
    </div>
  );
}
