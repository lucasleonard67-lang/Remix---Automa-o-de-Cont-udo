import { assertEquals } from 'jsr:@std/assert@1';

import { aspectoDaFoto, unidadesSemFoto } from './fotos-automaticas.ts';

Deno.test('carrossel: capa e os cards que pediram foto', () => {
  const slides = [{ index: 0 }, { index: 1, visual: 'none' }, { index: 2, visual: 'photo' }, { index: 3, visual: 'chart' }];
  assertEquals(unidadesSemFoto('instagram_carousel', { slides }), [0, 2]);
});

Deno.test('stories: toda tela leva foto, menos gráfico', () => {
  const frames = [{ index: 0 }, { index: 1, visual: 'photo' }, { index: 2, visual: 'none' }, { index: 3, visual: 'chart' }, { index: 4 }];
  assertEquals(unidadesSemFoto('instagram_stories', { frames }), [0, 1, 2, 4]);
});

Deno.test('post sempre leva foto, menos gráfico', () => {
  assertEquals(unidadesSemFoto('instagram_post', { card: { index: 0, visual: 'photo' } }), [0]);
  assertEquals(unidadesSemFoto('instagram_post', { card: { index: 0, visual: 'none' } }), [0]);
  assertEquals(unidadesSemFoto('instagram_post', { card: { index: 0, visual: 'chart' } }), []);
});

Deno.test('foto nasce no formato da caixa onde aparece', () => {
  assertEquals(aspectoDaFoto('slides', 0), '4:3');
  assertEquals(aspectoDaFoto('frames', 0), '1:1');
  assertEquals(aspectoDaFoto('slides', 3), '16:9');
  assertEquals(aspectoDaFoto('frames', 2), '16:9');
  assertEquals(aspectoDaFoto('card', 0), '16:9');
});

Deno.test('não refaz o que já tem foto e ignora outros canais', () => {
  assertEquals(unidadesSemFoto('instagram_carousel', { slides: [{ index: 0, image_path: 'a.png' }, { index: 1, visual: 'photo' }] }), [1]);
  assertEquals(unidadesSemFoto('x_post', { text: 'oi' }), []);
  assertEquals(unidadesSemFoto('instagram_carousel', {}), []);
});
