import { assertEquals } from 'jsr:@std/assert@1';

import {
  aplicarEdicao, comUnidade, desempilhar, empilhar, HISTORICO_MAX, montarInstrucoes, montarPedido, numerosNovos,
  unidadesDaPeca,
  type EdicaoDoModelo, type Historico, type UnidadeEditavel,
} from './editar-slide.ts';

const miolo: UnidadeEditavel = { index: 3, text: 'Título\nTexto.', title: 'Título', paragraphs: ['Texto.'], visual: 'none' };
const capa: UnidadeEditavel = { index: 0, text: 'Gancho', paragraphs: ['Gancho'], visual: 'photo', image_path: 'capa.png', photo_promoted: true };
const pedido = (extra: Partial<EdicaoDoModelo> = {}): EdicaoDoModelo => ({
  title: 'Novo título', paragraphs: ['Parágrafo novo.'], foto: 'manter', image_brief: '',
  grafico: 'manter', chart_label: '', chart_bars: [], ...extra,
});

Deno.test('muda só o texto do slide e preserva o resto', () => {
  const r = aplicarEdicao({ ...miolo, role: 'desenvolvimento' }, pedido(), 'instagram_carousel', []);
  assertEquals(r.unidade?.title, 'Novo título');
  assertEquals(r.unidade?.text, 'Novo título\nParágrafo novo.');
  assertEquals(r.unidade?.role, 'desenvolvimento');
  assertEquals(r.gerarFoto, false);
});

Deno.test('capa fica sem manchete separada e não perde a foto', () => {
  const r = aplicarEdicao(capa, pedido({ title: 'ignorado', paragraphs: ['Gancho novo com **virada**.'] }), 'instagram_carousel', []);
  assertEquals(r.unidade?.text, 'Gancho novo com **virada**.');
  assertEquals(r.unidade?.title, undefined);
  assertEquals(r.unidade?.image_path, 'capa.png');
});

Deno.test('capa não aceita remover foto nem gráfico', () => {
  assertEquals(typeof aplicarEdicao(capa, pedido({ foto: 'remover' }), 'instagram_carousel', []).erro, 'string');
  const barras = [{ label: 'a', value: 1 }, { label: 'b', value: 2 }, { label: 'c', value: 3 }];
  assertEquals(typeof aplicarEdicao(capa, pedido({ grafico: 'trocar', chart_bars: barras }), 'instagram_carousel', []).erro, 'string');
});

Deno.test('trocar foto pede geração e respeita o limite do formato', () => {
  const ok = aplicarEdicao(miolo, pedido({ foto: 'trocar', image_brief: 'prateleira cheia' }), 'instagram_carousel', []);
  assertEquals(ok.gerarFoto, true);
  assertEquals(ok.unidade?.visual, 'photo');
  const cheias = [1, 2, 4].map((index) => ({ ...miolo, index, visual: 'photo' as const }));
  assertEquals(typeof aplicarEdicao(miolo, pedido({ foto: 'trocar', image_brief: 'x' }), 'instagram_carousel', cheias).erro, 'string');
});

Deno.test('remover foto limpa os campos', () => {
  const r = aplicarEdicao({ ...miolo, visual: 'photo', image_path: 'a.png', image_brief: 'b' }, pedido({ foto: 'remover' }), 'instagram_carousel', []);
  assertEquals(r.unidade?.visual, 'none');
  assertEquals(r.unidade?.image_path, undefined);
});

Deno.test('gráfico: número de barras e um por peça', () => {
  const barras = [{ label: 'a', value: 1 }, { label: 'b', value: 2 }, { label: 'c', value: 3 }];
  assertEquals(aplicarEdicao(miolo, pedido({ grafico: 'trocar', chart_bars: barras }), 'instagram_carousel', []).unidade?.visual, 'chart');
  assertEquals(typeof aplicarEdicao(miolo, pedido({ grafico: 'trocar', chart_bars: barras.slice(0, 2) }), 'instagram_carousel', []).erro, 'string');
  const outro = { ...miolo, index: 5, visual: 'chart' as const };
  assertEquals(typeof aplicarEdicao(miolo, pedido({ grafico: 'trocar', chart_bars: barras }), 'instagram_carousel', [outro]).erro, 'string');
});

Deno.test('texto vazio e título vazio não passam', () => {
  assertEquals(typeof aplicarEdicao(miolo, pedido({ paragraphs: ['  '] }), 'instagram_carousel', []).erro, 'string');
  assertEquals(typeof aplicarEdicao(miolo, pedido({ title: ' ' }), 'instagram_carousel', []).erro, 'string');
});

Deno.test('stories fecha a manchete com ponto', () => {
  assertEquals(aplicarEdicao(miolo, pedido(), 'instagram_stories', []).unidade?.title, 'Novo título.');
});

Deno.test('acha número novo sem confundir pontuação', () => {
  assertEquals(numerosNovos('Foram 30% em 2025.', 'Em 2025, vendeu 10%.'), ['30']);
  assertEquals(numerosNovos('R$ 2.554 lojas.', 'são 2.554 lojas'), []);
});

Deno.test('coloca a unidade no lugar e invalida só o PNG dela', () => {
  const adapted = { slides: [capa, miolo], slide_renders: [{ index: 0, path: 'a' }, { index: 3, path: 'b' }] };
  const novo = comUnidade(adapted, 'instagram_carousel', { ...miolo, text: 'x' });
  assertEquals((novo.slides as UnidadeEditavel[])[1].text, 'x');
  assertEquals((novo.slides as UnidadeEditavel[])[0].text, 'Gancho');
  assertEquals(novo.slide_renders, [{ index: 0, path: 'a' }]);
});

Deno.test('post usa o card', () => {
  assertEquals(unidadesDaPeca({ card: miolo }, 'instagram_post').length, 1);
  assertEquals((comUnidade({ card: miolo }, 'instagram_post', { ...miolo, text: 'y' }).card as UnidadeEditavel).text, 'y');
  assertEquals(unidadesDaPeca({ text: 'x' }, 'x_post'), []);
});

Deno.test('desfazer volta em ordem e o histórico tem teto', () => {
  let h: Historico = {};
  for (let i = 0; i < HISTORICO_MAX + 2; i++) h = empilhar(h, 3, { ...miolo, text: String(i) });
  assertEquals(h['3'].length, HISTORICO_MAX);
  const { historico, anterior } = desempilhar(h, 3);
  assertEquals(anterior?.text, String(HISTORICO_MAX + 1));
  assertEquals(historico['3'].length, HISTORICO_MAX - 1);
  assertEquals(desempilhar({}, 1).anterior, null);
});

Deno.test('a receita manda preencher as barras quando pedem gráfico, mesmo sem número na peça', () => {
  const instrucoes = montarInstrucoes('instagram_carousel', miolo);
  assertEquals(instrucoes.includes('chart_bars NUNCA vai vazio: 3 a 6 barras'), true);
  assertEquals(instrucoes.includes('Se não houver número, decida você'), true);
  assertEquals(instrucoes.includes('NUNCA invente'), false);
});

Deno.test('o pedido leva o texto inteiro das outras unidades, de onde saem os números', () => {
  const vizinha: UnidadeEditavel = { index: 1, text: 'Vendas\nSubiram 32% em 2025.', title: 'Vendas', paragraphs: ['Subiram 32% em 2025.'], visual: 'none' };
  const pedidoTexto = montarPedido({ instrucao: 'troque a foto por um gráfico', unidade: miolo, vizinhas: [vizinha], tese: '' });
  assertEquals(pedidoTexto.includes('Subiram 32% em 2025.'), true);
});
