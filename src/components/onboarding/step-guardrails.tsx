import { ShieldCheck } from "lucide-react";

import {
  GuardrailsFormFields,
  guardrailsCtaConflicts,
  sanitizeGuardrailsContent,
} from "@/components/brand/guardrails-form";
import { VersionedStepFooter } from "@/components/onboarding/versioned-step-footer";
import type { OnboardingStepProps } from "@/components/onboarding/types";
import { useWizardDirty } from "@/components/onboarding/use-wizard-dirty";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  normalizeGuardrailsContent,
  useVersionedEditor,
  type GuardrailsContent,
} from "@/hooks/use-versioned-brand";

// ---------------------------------------------------------------------------
// Passo 6 — guardrails: fonte única de regras duras, pré-preenchida pelo preset
// do nicho. Ativar aqui destrava a geração (junto com voz + bandeira).
// ---------------------------------------------------------------------------

export function StepGuardrails({
  advancing,
  onBack,
  onAdvance,
  onDirtyChange,
}: OnboardingStepProps) {
  const editor = useVersionedEditor<GuardrailsContent>(
    "guardrails",
    normalizeGuardrailsContent,
    sanitizeGuardrailsContent,
  );
  const conflicts = guardrailsCtaConflicts(editor.content);
  useWizardDirty(editor.dirty, onDirtyChange);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Defina o que a marca nunca escreve e quais CTAs pode usar. Toda peça é conferida contra
        estas regras antes de chegar a você.
      </p>

      <Alert>
        <ShieldCheck className="size-4" aria-hidden="true" />
        <AlertTitle>Último passo obrigatório</AlertTitle>
        <AlertDescription>
          Com voz, bandeira e regras da marca ativas e algum material em Contexto, você já pode
          gerar peças. Os próximos passos são ajustes.
        </AlertDescription>
      </Alert>

      {editor.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <GuardrailsFormFields content={editor.content} patch={editor.patch} />
      )}

      <VersionedStepFooter
        table="guardrails"
        editor={editor}
        sanitize={sanitizeGuardrailsContent}
        ready={conflicts.length === 0}
        hint="Há CTAs em permitidos e proibidos ao mesmo tempo. Remova de uma das listas."
        confirmLabel="Ativar e continuar"
        successMessage="Regras da marca ativadas — você já pode gerar peças"
        advancing={advancing}
        onBack={onBack}
        onAdvance={onAdvance}
      />
    </div>
  );
}
