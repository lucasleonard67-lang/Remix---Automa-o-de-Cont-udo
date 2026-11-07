import { assertEquals } from 'jsr:@std/assert@1';

import { acordarRotina, pedeSoCarrossel, temaDoPedido } from './claude-rotina.ts';

const entrada = { url: 'https://api.test/fire', token: 'tok', texto: 'pedido' };

Deno.test('só carrossel vai para a rotina', () => {
  assertEquals(pedeSoCarrossel(['instagram_carousel']), true);
  assertEquals(pedeSoCarrossel(['instagram_carousel', 'instagram_post']), false);
  assertEquals(pedeSoCarrossel([]), false);
});

Deno.test('o ângulo escolhido entra no pedido', () => {
  const tema = temaDoPedido('Latido no passeio', { id: 'a', title: 'O mito do cão bravo', hook: 'É medo' });
  assertEquals(tema.includes('O mito do cão bravo'), true);
  assertEquals(tema.includes('É medo'), true);
  assertEquals(temaDoPedido('Tema', null), 'Tema');
});

Deno.test('dispara com o token e a versão da API', async () => {
  let cabecalhos: Headers | null = null;
  const ok = await acordarRotina(entrada, (_u, init) => {
    cabecalhos = new Headers(init?.headers);
    return Promise.resolve(new Response('{}'));
  });
  assertEquals(ok, true);
  assertEquals(cabecalhos!.get('authorization'), 'Bearer tok');
  assertEquals(cabecalhos!.get('anthropic-version'), '2026-10-21');
});

Deno.test('recusa e queda devolvem o trabalho à saga', async () => {
  assertEquals(await acordarRotina(entrada, () => Promise.resolve(new Response('x', { status: 429 }))), false);
  assertEquals(await acordarRotina(entrada, () => Promise.reject(new Error('rede'))), false);
});
