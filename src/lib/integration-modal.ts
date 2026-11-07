import type { IntegrationId } from "@/lib/integrations";

// Canal mínimo para abrir o modal de uma integração de qualquer lugar do app
// ("Conectar redes sociais", ações do assistente, ?integracao= no Config).
// Regra do produto: clicar numa ação abre a ação ali mesmo, nunca manda o
// usuário para uma página descobrir o que fazer. O host que escuta é o
// <IntegrationModalHost /> em integration-grid.tsx, montado no layout logado.

type Listener = (id: IntegrationId) => void;
const listeners = new Set<Listener>();

export function openIntegration(id: IntegrationId): void {
  listeners.forEach((listener) => listener(id));
}

export function subscribeIntegrationModal(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
