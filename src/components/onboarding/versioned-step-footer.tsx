import { useState, type ReactNode } from "react";
import { toast } from "@/lib/toast";

import { WizardFooter } from "@/components/onboarding/wizard-shell";
import { FeedbackLabel } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { useSaveAndActivate } from "@/hooks/use-onboarding";
import type { VersionedBrandTable, VersionedEditor } from "@/hooks/use-versioned-brand";

// ---------------------------------------------------------------------------
// Rodapé comum dos passos que ativam um documento versionado (5 bandeira,
// 6 guardrails, 7 brand kit): salvar rascunho · confirmar (salva + ativa +
// avança) · pular (opcional).
// ---------------------------------------------------------------------------

export interface VersionedStepFooterProps<T> {
  table: VersionedBrandTable;
  editor: VersionedEditor<T>;
  sanitize: (content: T) => T;
  /** Validação mínima do passo — desabilita o botão de confirmar. */
  ready: boolean;
  hint?: ReactNode;
  confirmLabel: string;
  successMessage: string;
  /** Passos opcionais (brand kit) podem avançar sem ativar versão. */
  skipLabel?: string;
  advancing: boolean;
  onBack: (() => void) | null;
  onAdvance: () => Promise<void>;
}

export function VersionedStepFooter<T>({
  table,
  editor,
  sanitize,
  ready,
  hint,
  confirmLabel,
  successMessage,
  skipLabel,
  advancing,
  onBack,
  onAdvance,
}: VersionedStepFooterProps<T>) {
  const activate = useSaveAndActivate<T>(table);
  const [confirming, setConfirming] = useState(false);
  const busy = advancing || confirming || activate.isPending;

  const confirm = async () => {
    if (!ready || busy) return;
    setConfirming(true);
    try {
      await activate.run(sanitize(editor.content));
      toast.success(successMessage);
      await onAdvance();
    } catch (error) {
      toast.retry("Não foi possível ativar a versão", {
        description: error instanceof Error ? error.message : undefined,
        onRetry: () => void confirm(),
      });
    } finally {
      setConfirming(false);
    }
  };

  return (
    <WizardFooter onBack={onBack} hint={ready ? undefined : hint}>
      {skipLabel ? (
        <Button variant="ghost" onClick={() => void onAdvance()} disabled={busy}>
          {skipLabel}
        </Button>
      ) : null}
      <Button
        variant="outline"
        onClick={editor.onSaveDraft}
        disabled={!editor.dirty || editor.saving || busy}
      >
        <FeedbackLabel done={editor.saved} doneLabel="Rascunho salvo">
          {editor.saving ? "Salvando…" : "Salvar rascunho"}
        </FeedbackLabel>
      </Button>
      <Button onClick={() => void confirm()} disabled={!ready || busy}>
        {busy ? "Ativando…" : confirmLabel}
      </Button>
    </WizardFooter>
  );
}
