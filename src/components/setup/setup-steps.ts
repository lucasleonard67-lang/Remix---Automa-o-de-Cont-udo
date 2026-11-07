import type { SetupFlowStep } from "@/hooks/use-onboarding";

/** Os sete passos do fluxo único de configuração, na ordem em que aparecem. */
export interface SetupStepMeta {
  step: SetupFlowStep;
  label: string;
  /** Linha de apoio no painel navy do assistente (o resultado do passo). */
  hint: string;
}

export const SETUP_FLOW_STEPS: SetupStepMeta[] = [
  { step: 1, label: "Sua marca", hint: "Site e Instagram" },
  { step: 2, label: "Redes", hint: "Onde a marca publica" },
  { step: 3, label: "Vídeo e voz", hint: "Quem aparece e quem narra" },
  { step: 4, label: "Mercado", hint: "Concorrentes para comparar" },
  { step: 5, label: "Marca pronta", hint: "Confira a leitura" },
  { step: 6, label: "Criar", hint: "A primeira peça" },
  { step: 7, label: "Publicar", hint: "No ar, na sua voz" },
];
