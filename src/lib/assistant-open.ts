// Canal mínimo para abrir o assistente flutuante de qualquer tela (ex.: "Não
// achou?" da Ajuda), no mesmo desenho de integration-modal.ts. Quem escuta é o
// <AssistantLauncher />, montado uma vez no layout logado.

type Listener = () => void;
const listeners = new Set<Listener>();

export function openAssistant(): void {
  listeners.forEach((listener) => listener());
}

export function subscribeAssistantOpen(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
