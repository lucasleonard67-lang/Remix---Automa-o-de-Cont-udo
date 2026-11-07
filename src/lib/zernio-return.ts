// Volta da autorização do Zernio. A autorização abre numa aba nova; quando o
// Zernio devolve essa aba para /conectado, ela avisa a aba do app pelo
// BroadcastChannel e se fecha. A aba do app atualiza a lista de contas sozinha
// e a pessoa segue no mesmo passo — sem "volte e clique em Atualizar".

const CHANNEL = "ce-zernio-connected";

export interface ZernioConnected {
  platform: string | null;
  username: string | null;
}

/** Rota que recebe a volta do Zernio (src/routes/conectado.tsx). */
export function zernioReturnUrl(): string {
  return `${window.location.origin}/conectado`;
}

export function announceZernioConnected(payload: ZernioConnected): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage(payload);
  channel.close();
}

/** Escuta contas conectadas em outra aba; devolve a função que para de escutar. */
export function onZernioConnected(listener: (payload: ZernioConnected) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent<ZernioConnected>) => listener(event.data);
  return () => channel.close();
}
