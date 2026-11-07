import { assert, assertEquals } from 'jsr:@std/assert@1';

import { CARROSSEL_RECEITA } from './carrossel-receita.ts';
import { checkWrittenCarousel, type WrittenCarousel } from './editorial-carousel.ts';
import { carrosselCriar, pecaDoCarrossel } from './mcp-carrossel.ts';
import type { GuardrailsContent } from './types.ts';

const guardrails = { allowed_ctas: [], banned_ctas: [], banned_metaphors: [], banned_punctuation: [], banned_words: [], channel_scope_overrides: {}, content: [], dosage_rules: [] } as unknown as GuardrailsContent;
const corpo = ['Primeiro parágrafo curto com o que aconteceu.', 'Depois veio o **número-chave** da história.'];
const texto = (title: string) => ({ title, paragraphs: corpo, visual: 'none' as const });
const foto = (title: string) => ({ title, paragraphs: corpo, visual: 'photo' as const, image_brief: 'A loja por dentro.' });
const barras = [2022, 2023, 2024, 2025].map((label, i) => ({ label: String(label), value: [100, 170, 270, 336][i], fonte: 'Empresa' }));

/** A sequência medida na referência: texto, foto, foto, texto, foto, texto, texto, gráfico. */
const referencia = (): WrittenCarousel => ({
  cover: { headline: 'Dois sócios abriram lojas no prédio. **A rede já vendeu R$ 336 milhões.**' },
  slides: [
    texto('Antes, eram máquinas.'), foto('A primeira loja.'), foto('A loja fica perto.'), texto('Abre a qualquer hora.'),
    foto('Pegou, pagou.'), texto('Quem garante?'), texto('Como cresceu.'),
    { title: 'De 100 pra 336.', paragraphs: [corpo[0]], visual: 'chart', chart: { label: 'vendas', bars: barras } },
  ],
  cta: { title: 'A loja fica onde o cliente está', paragraph: 'Quer uma no seu prédio? Chama a gente.', button: { kind: 'whatsapp', label: 'Chamar no WhatsApp' } },
});
const conferir = (escrito: WrittenCarousel, material = '') => checkWrittenCarousel(escrito, { guardrails, material });

Deno.test('a referência passa: duas fotos seguidas, gráfico e o fecho', () => {
  const { problemas, slides, fontes } = conferir(referencia());
  assertEquals(problemas, []);
  assertEquals(slides.length, 10);
  assertEquals(slides[8].chart?.bars.length, 4);
  assertEquals(slides[9].role, 'cta');
  assertEquals(slides[9].title, 'A loja fica onde o cliente está.');
  assertEquals(slides[9].cta, { kind: 'whatsapp', label: 'Chamar no WhatsApp' });
  assertEquals(slides[2].photo_promoted, true);
  assertEquals(fontes.length, 4);
  assertEquals('fonte' in slides[8].chart!.bars[0], false);
});

Deno.test('três fotos seguidas e quarta foto no miolo são recusadas', () => {
  const escrito = referencia();
  escrito.slides[3] = foto('Terceira seguida.');
  escrito.slides[5] = foto('Quarta.');
  const { problemas } = conferir(escrito);
  assert(problemas.some((p) => p.includes('2 fotos seguidas')));
  assert(problemas.some((p) => p.includes('3 fotos no miolo')));
});

Deno.test('número sem fonte precisa estar no material', () => {
  const escrito = referencia();
  const chart = escrito.slides[7].chart!;
  chart.bars = chart.bars.map(({ label, value }) => ({ label, value }));
  assert(conferir(escrito).problemas.some((p) => p.includes('não está no material')));
  assertEquals(conferir(escrito, 'Vendas: 100, 170, 270 e 336 milhões.').problemas, []);
});

Deno.test('nada é cortado: passar do limite vira problema', () => {
  const escrito = referencia();
  escrito.cover.headline = 'Sem negrito na capa.';
  escrito.slides[0].title = 'x'.repeat(71);
  escrito.slides[1].paragraphs = ['y'.repeat(241)];
  const { problemas } = conferir(escrito);
  assertEquals(problemas.length, 3);
});

Deno.test('[VERIFICAR e slides de menos são recusados', () => {
  const escrito = referencia();
  escrito.slides[0].paragraphs = ['Dado [VERIFICAR: fonte] aqui.'];
  assert(conferir(escrito).problemas.some((p) => p.includes('[VERIFICAR')));
  assert(conferir({ ...referencia(), slides: [texto('Um.')] }).problemas.some((p) => p.includes('slides depois da capa')));
});

Deno.test('sem conteúdo, devolve a receita sem tocar no banco', async () => {
  const resposta = await carrosselCriar({} as never, {});
  assertEquals(resposta, { receita: CARROSSEL_RECEITA });
  assert(CARROSSEL_RECEITA.includes('10 cards'));
});

Deno.test('a peça nasce rascunho, sem chip de fatos nem de juiz aprovado', () => {
  const linha = pecaDoCarrossel({
    jobId: 'j', tema: 'Tema', legenda: 'Legenda', headline: 'Gancho **forte**', slides: [{ index: 0 }], fontes: [], violacoes: [],
    versoes: { persona: 1, strategy: 2, guardrails: 3, brandKit: null },
  });
  assertEquals(linha.status, 'draft');
  assertEquals(linha.core_content.hook.written, 'Gancho forte');
  assertEquals(linha.adapted_content.channel_type, 'instagram_carousel');
  assertEquals(Object.keys(linha.audit), ['linter']);
});

Deno.test('sem fecho, ou com botão fora da lista, é problema', () => {
  const semFecho = referencia();
  delete semFecho.cta;
  assert(conferir(semFecho).problemas.some((p) => p.startsWith('Fecho: falta o card final')));
  const botao = referencia();
  botao.cta!.button = { kind: 'email' as 'site', label: 'x'.repeat(29) };
  const { problemas } = conferir(botao);
  assert(problemas.some((p) => p.includes('button.kind')));
  assert(problemas.some((p) => p.includes('button.label com 29')));
});
