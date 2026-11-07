import {
  StrategyFormFields,
  isStrategyReady,
  sanitizeStrategyContent,
} from "@/components/brand/strategy-form";
import { VersionedStepFooter } from "@/components/onboarding/versioned-step-footer";
import type { OnboardingStepProps } from "@/components/onboarding/types";
import { useWizardDirty } from "@/components/onboarding/use-wizard-dirty";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  normalizeStrategyContent,
  useVersionedEditor,
  type StrategyContent,
} from "@/hooks/use-versioned-brand";

// ---------------------------------------------------------------------------
// Passo 5 — bandeira: estratégia da marca, pré-preenchida pelo preset de nicho
// escolhido no passo 1 (rascunho). Confirmar salva e ativa a v1.
// ---------------------------------------------------------------------------

export function StepStrategy({
  progress,
  advancing,
  onBack,
  onAdvance,
  onDirtyChange,
}: OnboardingStepProps) {
  const editor = useVersionedEditor<StrategyContent>(
    "brand_strategy",
    normalizeStrategyContent,
    sanitizeStrategyContent,
  );
  useWizardDirty(editor.dirty, onDirtyChange);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Diga o que a marca defende e contra o que ela se posiciona. É isso que dá opinião às peças
          em vez de lugar-comum.
        </p>
        {progress.niche_template_slug && editor.draft ? (
          <Badge variant="outline" className="font-normal text-muted-foreground">
            pré-preenchido pelo modelo “{progress.niche_template_slug}”
          </Badge>
        ) : null}
      </div>

      {editor.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <StrategyFormFields content={editor.content} patch={editor.patch} />
      )}

      <VersionedStepFooter
        table="brand_strategy"
        editor={editor}
        sanitize={sanitizeStrategyContent}
        ready={isStrategyReady(editor.content)}
        hint="Para ativar, preencha a promessa, ao menos 1 tese e o perfil do cliente ideal."
        confirmLabel="Ativar e continuar"
        successMessage="Bandeira ativada"
        advancing={advancing}
        onBack={onBack}
        onAdvance={onAdvance}
      />
    </div>
  );
}
