import { Wand2 } from "lucide-react";
import { useState } from "react";

import { BrandKitFormFields, sanitizeBrandKitContent } from "@/components/brand/brand-kit-form";
import { DesignSystemPaths, type DesignSystemPath } from "@/components/brand/design-system-paths";
import { VersionedStepFooter } from "@/components/onboarding/versioned-step-footer";
import type { OnboardingStepProps } from "@/components/onboarding/types";
import { useWizardDirty } from "@/components/onboarding/use-wizard-dirty";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  normalizeBrandKitContent,
  useVersionedEditor,
  type BrandKitContent,
} from "@/hooks/use-versioned-brand";

// ---------------------------------------------------------------------------
// Passo 7 — DESIGN SYSTEM, faseado (ponto 12 do plano docs/14).
//
// Antes o passo despejava o formulário inteiro de uma vez. Agora são duas
// fases, nunca as duas ao mesmo tempo: escolher UM caminho de partida, e só
// então revisar o rascunho — com o caminho percorrido nomeado no topo e a
// troca de caminho como ação explícita, não menu sempre presente.
// ---------------------------------------------------------------------------

export function StepBrandKit({ advancing, onBack, onAdvance, onDirtyChange }: OnboardingStepProps) {
  const editor = useVersionedEditor<BrandKitContent>(
    "brand_kit",
    normalizeBrandKitContent,
    sanitizeBrandKitContent,
  );
  useWizardDirty(editor.dirty, onDirtyChange);

  const [escolha, setEscolha] = useState<{
    caminho: DesignSystemPath;
    origem: string;
    rationale?: string;
  } | null>(null);

  const rodape = (
    <VersionedStepFooter
      table="brand_kit"
      editor={editor}
      sanitize={sanitizeBrandKitContent}
      ready
      confirmLabel="Ativar e continuar"
      successMessage="Identidade visual ativada"
      skipLabel="Pular por enquanto"
      advancing={advancing}
      onBack={onBack}
      onAdvance={onAdvance}
    />
  );

  if (editor.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (!escolha) {
    return (
      <div className="space-y-6">
        <DesignSystemPaths onEscolher={setEscolha} patch={editor.patch} />
        {rodape}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Alert>
        <Wand2 className="size-4" aria-hidden="true" />
        <AlertTitle>
          {escolha.caminho === "manual"
            ? "Montagem manual"
            : `Proposta a partir de ${escolha.origem}`}
        </AlertTitle>
        <AlertDescription className="space-y-2">
          {escolha.rationale ? <p>{escolha.rationale}</p> : null}
          <p>
            Nada foi ativado ainda. Revise abaixo e clique em “Ativar e continuar”.{" "}
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={() => setEscolha(null)}
            >
              Escolher outro caminho
            </button>
            .
          </p>
        </AlertDescription>
      </Alert>

      <BrandKitFormFields content={editor.content} patch={editor.patch} />
      {rodape}
    </div>
  );
}
