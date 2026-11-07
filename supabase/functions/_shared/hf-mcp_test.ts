// Testes do parser de URL de resultado do Higgsfield (sem rede).

import { assertEquals } from 'jsr:@std/assert@1';

import { resultUrl } from './hf-mcp.ts';

Deno.test('resultUrl: vídeo vence áudio no mesmo texto (caminho de geração intacto)', () => {
  const out = 'completed\naudio: https://cdn.hf.ai/ref.mp3\nresult: https://cdn.hf.ai/out.mp4?sig=1';
  assertEquals(resultUrl(out), 'https://cdn.hf.ai/out.mp4?sig=1');
});

Deno.test('resultUrl: aceita áudio e texto quando não há imagem/vídeo', () => {
  assertEquals(resultUrl('completed https://cdn.hf.ai/voz.wav'), 'https://cdn.hf.ai/voz.wav');
  assertEquals(resultUrl('completed https://cdn.hf.ai/nota.json?x=1'), 'https://cdn.hf.ai/nota.json?x=1');
  assertEquals(resultUrl('completed sem url'), null);
});
