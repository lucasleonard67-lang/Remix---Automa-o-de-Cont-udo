import { assert, assertEquals } from 'jsr:@std/assert@1';

import { ANOTACOES, comAnotacoes } from './mcp-anotacoes.ts';

Deno.test('toda ferramenta do conector tem anotação', async () => {
  const codigo = await Deno.readTextFile(new URL('../mcp-server/index.ts', import.meta.url));
  const nomes = [...codigo.matchAll(/^\s+(?:\{ )?name: '([a-z_]+)'/gm)].map((m) => m[1]);
  assert(nomes.length > 20);
  for (const nome of nomes) assert(ANOTACOES[nome], `${nome} sem anotação`);
});

Deno.test('leitura e escrita saem nos campos certos', () => {
  const [ler, criar] = comAnotacoes([{ name: 'marca_ler' }, { name: 'carrossel_criar' }]);
  assertEquals(ler.annotations.readOnlyHint, true);
  assertEquals(criar.annotations.readOnlyHint, false);
  assertEquals(criar.annotations.destructiveHint, false);
  assertEquals(criar.title, 'Criar carrossel');
});
