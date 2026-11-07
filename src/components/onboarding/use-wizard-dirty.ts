import { useEffect } from "react";

/**
 * Publica o estado "há alterações não salvas" do passo para o wizard, que usa
 * o sinal para confirmar antes de trocar de passo (o corpo do passo desmonta
 * na navegação e o formulário local se perderia sem aviso).
 * Ao desmontar, o passo sempre se declara limpo.
 */
export function useWizardDirty(dirty: boolean, onDirtyChange: (dirty: boolean) => void): void {
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
}
