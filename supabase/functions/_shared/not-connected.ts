// Erro tipado de "provedor não conectado": quem precisa reagir (ex.: pular a
// cena extra do A/B em vez de derrubar o job) classifica por instanceof, não
// por regex na mensagem.

export type ConnectableProvider = 'higgsfield' | 'replicate' | 'elevenlabs' | 'heygen';

export const PROVIDER_LABEL: Record<ConnectableProvider, string> = {
  higgsfield: 'Higgsfield',
  replicate: 'Replicate',
  elevenlabs: 'ElevenLabs',
  heygen: 'HeyGen',
};

export class NotConnectedError extends Error {
  provider: ConnectableProvider;
  constructor(provider: ConnectableProvider, message: string) {
    super(message);
    this.name = 'NotConnectedError';
    this.provider = provider;
  }
}
