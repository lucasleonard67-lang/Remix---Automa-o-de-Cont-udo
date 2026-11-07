// Volta da autorização do Google. Ela abre em outra aba; ao cair em /conectado?drive=
// a aba avisa o app pelo BroadcastChannel e se fecha. Mesmo desenho de zernio-return.

const CHANNEL = "ce-google-drive";

export const DRIVE_OUTCOME: Record<string, string> = {
  conectado: "Google Drive conectado",
  recusado: "A autorização foi recusada.",
  expirado: "O tempo para autorizar acabou. Clique em Conectar de novo.",
  sem_permissao: "Marque a permissão do Google Drive na tela do Google e tente de novo.",
  falhou: "O Google não confirmou a conexão. Clique em Conectar de novo.",
};

export function announceDriveReturn(outcome: string): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage(outcome);
  channel.close();
}

export function onDriveReturn(listener: (outcome: string) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent<string>) => listener(event.data);
  return () => channel.close();
}
