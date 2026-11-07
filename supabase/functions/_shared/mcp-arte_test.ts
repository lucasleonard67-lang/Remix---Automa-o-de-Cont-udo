import { assertEquals } from 'jsr:@std/assert@1';

import { artesDaPeca, enviarArte, tamanhoDaArte } from './mcp-arte.ts';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#123"/></svg>';
const peca = (extra: Record<string, unknown> = {}) => ({
  id: 'p1', status: 'draft', channel_type: 'instagram_carousel', updated_at: 't',
  adapted_content: { slides: [{ index: 0, text: 'Capa', image_brief: 'cena' }, { index: 1, text: 'B', visual: 'photo' }] },
  ...extra,
});

function falso(linha: unknown) {
  const gravado: { patch?: Record<string, unknown>; caminho?: string } = {};
  const consulta = {
    select: () => consulta, eq: () => consulta,
    maybeSingle: () => Promise.resolve({ data: linha }),
    update: (patch: Record<string, unknown>) => { gravado.patch = patch; return { eq: () => ({ eq: () => ({ select: () => Promise.resolve({ data: [{ id: 'p1' }], error: null }) }) }) }; },
  };
  return {
    gravado,
    service: {
      from: () => consulta,
      storage: { from: () => ({ upload: (c: string) => { gravado.caminho = c; return Promise.resolve({ error: null }); } }) },
    },
  };
}

Deno.test('tamanho segue o layout', () => {
  assertEquals(tamanhoDaArte('instagram_carousel', 0), { largura: 1200, altura: 900 });
  assertEquals(tamanhoDaArte('instagram_stories', 0), { largura: 1080, altura: 1080 });
  assertEquals(tamanhoDaArte('instagram_carousel', 3), { largura: 1200, altura: 675 });
});

Deno.test('lista o que falta com a cena pedida', () => {
  const artes = artesDaPeca(peca() as never);
  assertEquals(artes.map((a) => a.indice), [0, 1]);
  assertEquals(artes[0].cena, 'cena');
});

Deno.test('SVG vira PNG e entra só no slide certo', async () => {
  const { service, gravado } = falso(peca());
  const r = await enviarArte(service, { peca_id: 'p1', indice: 1, svg: SVG }) as { gravado: boolean };
  assertEquals(r.gravado, true);
  const slides = (gravado.patch!.adapted_content as { slides: { image_path?: string }[] }).slides;
  assertEquals(slides[0].image_path, undefined);
  assertEquals(slides[1].image_path, gravado.caminho);
});

Deno.test('recusa fora de rascunho, slide errado e SVG inseguro', async () => {
  assertEquals(typeof await enviarArte(falso(peca({ status: 'approved' })).service, { peca_id: 'p1', indice: 0, svg: SVG }), 'string');
  assertEquals(typeof await enviarArte(falso(peca()).service, { peca_id: 'p1', indice: 9, svg: SVG }), 'string');
  assertEquals(typeof await enviarArte(falso(peca()).service, { peca_id: 'p1', indice: 0, svg: '<svg><script>x</script></svg>' }), 'string');
});
