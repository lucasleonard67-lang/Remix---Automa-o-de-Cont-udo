// _shared/conversa.ts — a conversa entre o Claude da pessoa e a pessoa dentro de
// um pedido (roteiro ou montagem de vídeo). Um campo de mensagem, como num chat:
// o Claude pergunta quando precisa dela (login, chave, cena ao vivo, uma
// decisão); ela responde na mesma tela e o pedido volta para a fila dele.
// Guardada na própria linha do pedido (roteiro_pedidos.conversa ou
// video_edits.analysis.conversa). Nada aqui chama LLM.

export interface Mensagem {
  de: 'claude' | 'pessoa';
  texto: string;
  em: string;
}

export const MENSAGEM_MAX = 2000;
export const CONVERSA_MAX = 60;

export function lerConversa(bruto: unknown): Mensagem[] {
  if (!Array.isArray(bruto)) return [];
  return bruto
    .map((m) => (m ?? {}) as Record<string, unknown>)
    .filter((m) => (m.de === 'claude' || m.de === 'pessoa') && typeof m.texto === 'string' && typeof m.em === 'string')
    .map((m) => ({ de: m.de as Mensagem['de'], texto: String(m.texto), em: String(m.em) }));
}

/** A conversa com a mensagem nova no fim; as mais antigas saem quando passa do teto. */
export function comMensagem(conversa: unknown, de: Mensagem['de'], texto: string): Mensagem[] {
  const limpa = texto.trim().slice(0, MENSAGEM_MAX);
  return [...lerConversa(conversa), { de, texto: limpa, em: new Date().toISOString() }].slice(-CONVERSA_MAX);
}
