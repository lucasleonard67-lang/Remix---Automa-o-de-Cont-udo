import { assertEquals } from 'jsr:@std/assert@1';

import { claudeArte, dimensoes, extrairSvg } from './claude-arte.ts';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#123"/></svg>';

Deno.test('tira o SVG de resposta com texto em volta', () => {
  assertEquals(extrairSvg(`Aqui está:\n\`\`\`svg\n${SVG}\n\`\`\``), SVG);
  assertEquals(extrairSvg('sem desenho'), null);
});

Deno.test('recusa o que busca algo fora ou roda código', () => {
  for (const ruim of [
    '<svg><script>alert(1)</script></svg>',
    '<svg><foreignObject></foreignObject></svg>',
    '<svg><image href="https://x.test/a.png"/></svg>',
    '<svg><a href="https://x.test"></a></svg>',
    '<svg><use href="data:image/svg+xml;base64,AA"/></svg>',
  ]) assertEquals(extrairSvg(ruim), null, ruim);
});

Deno.test('lê o tamanho pedido e tem padrão', () => {
  assertEquals(dimensoes('1024x1536'), { largura: 1024, altura: 1536 });
  assertEquals(dimensoes(undefined), { largura: 1024, altura: 1024 });
});

Deno.test('desenho do modelo vira PNG de verdade', async () => {
  let pedido = '';
  const arte = await claudeArte({ prompt: 'prateleira', size: '200x300' }, ({ user }) => {
    pedido = user;
    return Promise.resolve(SVG);
  });
  assertEquals(pedido.includes('0 0 200 300'), true);
  assertEquals(arte?.mime, 'image/png');
  const bytes = Uint8Array.from(atob(arte!.b64), (c) => c.charCodeAt(0));
  assertEquals([...bytes.slice(1, 4)], [80, 78, 71]);
});

Deno.test('resposta sem SVG devolve null', async () => {
  assertEquals(await claudeArte({ prompt: 'x' }, () => Promise.resolve('não consigo')), null);
});
