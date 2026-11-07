import type { OnboardingPatch, OnboardingProgress } from "@/hooks/use-onboarding";

/**
 * Contrato comum dos 9 passos do wizard. Cada passo valida e grava o que é
 * seu; `onAdvance` fecha o passo (marca concluído, recalcula o mínimo viável
 * e avança `current_step`) numa única escrita em `app_settings`.
 */
export interface OnboardingStepProps {
  progress: OnboardingProgress;
  /** Escrita do progresso em andamento (desabilita os botões do rodapé). */
  advancing: boolean;
  /** `null` no primeiro passo. */
  onBack: (() => void) | null;
  onAdvance: (patch?: OnboardingPatch) => Promise<void>;
  goToStep: (step: number) => void;
  /**
   * Passos com formulário local (4-7) publicam aqui se há alterações não
   * salvas — o wizard confirma antes de desmontar o passo. Use `useWizardDirty`.
   */
  onDirtyChange: (dirty: boolean) => void;
}
