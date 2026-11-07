import { createFileRoute } from "@tanstack/react-router";

import { PersonaFormFields, sanitizePersonaContent } from "@/components/brand/persona-form";
import { VersionedEditorShell } from "@/components/versioned-editor-shell";
import {
  normalizePersonaContent,
  useVersionedEditor,
  type PersonaContent,
} from "@/hooks/use-versioned-brand";

export const Route = createFileRoute("/_app/marca/persona")({
  component: PersonaEditorPage,
});

function PersonaEditorPage() {
  const editor = useVersionedEditor<PersonaContent>(
    "brand_persona",
    normalizePersonaContent,
    sanitizePersonaContent,
  );

  return (
    <VersionedEditorShell
      table="brand_persona"
      title="Persona"
      description="Como a marca fala: tom, vocabulário, opiniões e exemplos que toda peça segue."
      editor={editor}
    >
      <PersonaFormFields content={editor.content} patch={editor.patch} readOnly={!editor.isAdmin} />
    </VersionedEditorShell>
  );
}
