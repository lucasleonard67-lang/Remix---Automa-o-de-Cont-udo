import { assertEquals } from 'jsr:@std/assert@1';

import { provedorDaChamada, semApiPaga } from './llm.ts';

const claude = { driver: 'openai' as const, model: 'gpt-5' };
const gemini = { driver: 'lovable-gateway' as const, model: 'google/gemini-3-pro-image-preview' };

Deno.test('pelo conector, chave de API vira o incluso', () => {
  assertEquals(provedorDaChamada(claude, 'generator', true).driver, 'lovable-gateway');
  assertEquals(provedorDaChamada(claude, 'image', true).driver, 'lovable-gateway');
});

Deno.test('escolha inclusa continua; fora do conector, nada muda', () => {
  assertEquals(provedorDaChamada(gemini, 'image', true), gemini);
  assertEquals(provedorDaChamada(claude, 'generator', false), claude);
});

Deno.test('a marca atravessa o trabalho assíncrono', async () => {
  assertEquals(await semApiPaga(async () => { await Promise.resolve(); return 'ok'; }), 'ok');
});
