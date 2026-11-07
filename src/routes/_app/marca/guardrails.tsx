import { createFileRoute } from "@tanstack/react-router";

import {
  GuardrailsFormFields,
  sanitizeGuardrailsContent,
} from "@/components/brand/guardrails-form";
import { VersionedEditorShell } from "@/components/versioned-editor-shell";
import {
  normalizeGuardrailsContent,
  useVersionedEditor,
  type GuardrailsContent,
} from "@/hooks/use-versioned-brand";

export const Route = createFileRoute("/_app/marca/guardrails")({
  component: GuardrailsEditorPage,
});

function GuardrailsEditorPage() {
  const editor = useVersionedEditor<GuardrailsContent>(
    "guardrails",
    normalizeGuardrailsContent,
    sanitizeGuardrailsContent,
  );

  return (
    <VersionedEditorShell
      table="guardrails"
      title="Regras da marca"
      description="O que a marca nunca escreve, quais CTAs usa e a nota mínima para aprovar uma peça."
      editor={editor}
    >
      <GuardrailsFormFields
        content={editor.content}
        patch={editor.patch}
        readOnly={!editor.isAdmin}
      />
    </VersionedEditorShell>
  );
}
