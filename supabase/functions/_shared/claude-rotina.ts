// _shared/claude-rotina.ts — a etapa Escrever pelo Claude da assinatura.
//
// O servidor não acessa a assinatura, mas pode acordar uma rotina da pessoa na nuvem da
// Anthropic. Ela lê a fila em conteudo_pedidos, escreve e entrega em carrossel_criar,
// pelo conector. Sem rotina, ou se ela não responder, a saga escreve como sempre.

import type { AngleOption, ChannelType } from './types.ts';

export const ROTINA_URL = 'CLAUDE_ROUTINE_URL';
export const ROTINA_TOKEN = 'CLAUDE_ROUTINE_TOKEN';
export const STATUS_DO_PEDIDO = ['created', 'generating'];

/** Por enquanto, a entrega do Claude é só carrossel. */
export const pedeSoCarrossel = (canais: readonly ChannelType[]) =>
  canais.length === 1 && canais[0] === 'instagram_carousel';

export function temaDoPedido(prompt: string, angulo: AngleOption | null): string {
  if (!angulo) return prompt;
  return [prompt, `Ângulo escolhido: ${angulo.title}`, angulo.hook ? `Gancho: ${angulo.hook}` : '']
    .filter(Boolean).join('\n');
}

/** true só se a rotina começou. Qualquer outra coisa devolve o trabalho à saga. */
export async function acordarRotina(
  entrada: { url: string; token: string; texto: string },
  buscar: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const r = await buscar(entrada.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${entrada.token}`,
        'anthropic-version': '2026-10-21',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: entrada.texto }),
      signal: AbortSignal.timeout(15_000),
    });
    await r.body?.cancel();
    if (!r.ok) console.warn('[claude-rotina] recusou:', r.status);
    return r.ok;
  } catch (err) {
    console.warn('[claude-rotina] sem resposta:', err instanceof Error ? err.message : err);
    return false;
  }
}
