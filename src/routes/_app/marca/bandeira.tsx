import { createFileRoute } from "@tanstack/react-router";

import { StrategyFormFields, sanitizeStrategyContent } from "@/components/brand/strategy-form";
import { VersionedEditorShell } from "@/components/versioned-editor-shell";
import {
  normalizeStrategyContent,
  useVersionedEditor,
  type StrategyContent,
} from "@/hooks/use-versioned-brand";

export const Route = createFileRoute("/_app/marca/bandeira")({
  component: StrategyEditorPage,
});

function StrategyEditorPage() {
  const editor = useVersionedEditor<StrategyContent>(
    "brand_strategy",
    normalizeStrategyContent,
    sanitizeStrategyContent,
  );

  return (
    <VersionedEditorShell
      table="brand_strategy"
      title="Bandeira"
      description="O que a marca defende: promessa, teses, cliente ideal e mix de peças."
      editor={editor}
    >
      <StrategyFormFields
        content={editor.content}
        patch={editor.patch}
        readOnly={!editor.isAdmin}
      />
    </VersionedEditorShell>
  );
}
