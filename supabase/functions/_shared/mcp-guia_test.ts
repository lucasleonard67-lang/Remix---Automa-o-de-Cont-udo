import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { capacidades, GUIA_DO_CONECTOR, type EstadoDaInstancia } from './mcp-guia.ts';

const tudo: EstadoDaInstancia = {
  conexoes: { heygen: true, higgsfield: true, replicate: true, elevenlabs: true },
  drive_bloqueia: false, canais: ['instagram_post'], avatares: 1, vozes: 1,
};
const achar = (estado: EstadoDaInstancia, id: string) => capacidades(estado).find((c) => c.id === id)!;

Deno.test('com tudo conectado, tudo disponível', () => {
  for (const c of capacidades(tudo)) assertEquals([c.id, c.falta], [c.id, []]);
});

Deno.test('diz o que falta, sem marcar disponível', () => {
  const semHeygen = { ...tudo, conexoes: { ...tudo.conexoes, heygen: false } };
  assertEquals(achar(semHeygen, 'video_avatar').disponivel, false);
  assertStringIncludes(achar(semHeygen, 'video_avatar').falta[0], 'HeyGen');
  assertEquals(achar(semHeygen, 'video_foto').disponivel, true);
  assertEquals(achar({ ...tudo, avatares: 0 }, 'video_foto').disponivel, false);
  assertEquals(achar({ ...tudo, canais: [] }, 'conteudo').disponivel, false);
});

Deno.test('Drive bloqueia o que gera e libera a leitura', () => {
  const travado = { ...tudo, drive_bloqueia: true };
  assertEquals(achar(travado, 'imagem').disponivel, false);
  assertEquals(achar(travado, 'marca_e_acervo').disponivel, true);
});

Deno.test('o guia manda perguntar, mostrar custo e não publicar', () => {
  for (const trecho of ['uma coisa de cada vez', 'aceite', 'custo', 'publicar', 'rascunho']) {
    assertStringIncludes(GUIA_DO_CONECTOR, trecho);
  }
  assert(GUIA_DO_CONECTOR.length < 2000);
});

Deno.test('toda ferramenta citada existe no conector', async () => {
  const codigo = await Deno.readTextFile(new URL('../mcp-server/index.ts', import.meta.url));
  for (const c of capacidades({ ...tudo })) {
    for (const f of c.ferramentas) assertStringIncludes(codigo, `name: '${f}'`);
  }
});
