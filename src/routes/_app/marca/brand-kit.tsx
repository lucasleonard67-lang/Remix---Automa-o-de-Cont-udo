import { createFileRoute } from "@tanstack/react-router";
import { Wand2 } from "lucide-react";
import { useState } from "react";

import { BrandKitFormFields, sanitizeBrandKitContent } from "@/components/brand/brand-kit-form";
import { BrandSourceTiles, type BrandProposal } from "@/components/brand/brand-source-tiles";
import { VersionedEditorShell } from "@/components/versioned-editor-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  normalizeBrandKitContent,
  useVersionedEditor,
  type BrandKitContent,
} from "@/hooks/use-versioned-brand";

export const Route = createFileRoute("/_app/marca/brand-kit")({
  component: BrandKitEditorPage,
});

function BrandKitEditorPage() {
  const editor = useVersionedEditor<BrandKitContent>(
    "brand_kit",
    normalizeBrandKitContent,
    sanitizeBrandKitContent,
  );

  // A proposta de identidade vive aqui, não só no onboarding: o brand kit é
  // revisitado, e a capacidade não deveria ficar presa num passo do wizard que
  // se atravessa uma vez só. Quatro origens, uma por ladrilho; o que volta é
  // rascunho até "Ativar versão".
  const [proposta, setProposta] = useState<BrandProposal | null>(null);

  return (
    <VersionedEditorShell
      table="brand_kit"
      title="Identidade visual"
      description="Cores, fontes, logo e fotos que toda arte gerada segue. Edite e clique em “Ativar versão”."
      editor={editor}
    >
      {editor.isAdmin ? (
        <section aria-labelledby="origem-identidade" className="space-y-3">
          <div className="space-y-1">
            <h2 id="origem-identidade" className="text-sm font-medium text-foreground">
              De onde vem a sua identidade visual?
            </h2>
            <p className="text-sm text-muted-foreground">
              Escolha uma origem. Você revisa a proposta antes de ativar.
            </p>
          </div>
          <BrandSourceTiles
            patch={editor.patch}
            applied={proposta?.source ?? null}
            onApplied={setProposta}
          />
          {proposta ? (
            <Alert>
              <Wand2 className="size-4" aria-hidden="true" />
              <AlertTitle>Proposta a partir de {proposta.origem}</AlertTitle>
              <AlertDescription className="space-y-2">
                {proposta.rationale ? <p>{proposta.rationale}</p> : null}
                <p>Nada foi ativado. Revise abaixo e clique em “Ativar versão”.</p>
              </AlertDescription>
            </Alert>
          ) : null}
        </section>
      ) : null}

      <BrandKitFormFields
        content={editor.content}
        patch={editor.patch}
        readOnly={!editor.isAdmin}
      />
    </VersionedEditorShell>
  );
}
