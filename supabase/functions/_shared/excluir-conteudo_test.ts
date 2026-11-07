import { assertEquals } from 'jsr:@std/assert@1';

import { arquivosDaPeca, arquivosExclusivos, pastasDoVideo, pecaOcupada, videoOcupado } from './excluir-conteudo.ts';

const carrossel = {
  render_path: 'renders/a.png',
  adapted_content: {
    image_path: 'img/capa.png',
    video: { path: 'director/1/final.mp4' },
    card: { image_path: 'img/card.png' },
    slides: [{ image_path: 'img/s0.png' }, { image_path: 'img/capa.png' }, {}],
    frames: [{ image_path: 'img/f0.png' }],
    slide_renders: [{ index: 0, path: 'final/0.png' }],
  },
};

Deno.test('junta todos os arquivos da peça sem repetir', () => {
  assertEquals(arquivosDaPeca(carrossel).sort(), [
    'director/1/final.mp4', 'final/0.png', 'img/capa.png', 'img/card.png', 'img/f0.png', 'img/s0.png', 'renders/a.png',
  ]);
});

Deno.test('peça sem arte não tem arquivo', () => {
  assertEquals(arquivosDaPeca({ render_path: null, adapted_content: { text: 'oi' } }), []);
  assertEquals(arquivosDaPeca({}), []);
});

Deno.test('arquivo usado por peça irmã fica', () => {
  const irma = { adapted_content: { image_path: 'img/capa.png' } };
  assertEquals(arquivosExclusivos(carrossel, [irma]).includes('img/capa.png'), false);
  assertEquals(arquivosExclusivos(carrossel, [irma]).includes('img/s0.png'), true);
});

Deno.test('peça gerando imagem ou vídeo espera', () => {
  assertEquals(pecaOcupada({ adapted_content: { slide_images_job: { status: 'running' } } }, false) !== null, true);
  assertEquals(pecaOcupada({ adapted_content: {} }, true) !== null, true);
  assertEquals(pecaOcupada({ adapted_content: { slide_images_job: { status: 'done' } } }, false), null);
});

Deno.test('vídeo só sai encerrado, sem envio aberto e sem uso', () => {
  const livre = { edicaoAberta: false, outroVideo: false };
  assertEquals(videoOcupado({ status: 'done' }, livre), null);
  assertEquals(videoOcupado({ status: 'failed' }, livre), null);
  assertEquals(videoOcupado({ status: 'muxing' }, livre) !== null, true);
  assertEquals(videoOcupado({ status: 'awaiting_approval' }, livre) !== null, true);
  assertEquals(videoOcupado({ status: 'done', artifacts: { instagram: { status: 'scheduled' } } }, livre) !== null, true);
  assertEquals(videoOcupado({ status: 'done', artifacts: { tiktok: { status: 'published' } } }, livre), null);
  assertEquals(videoOcupado({ status: 'done' }, { ...livre, edicaoAberta: true }) !== null, true);
  assertEquals(videoOcupado({ status: 'done' }, { ...livre, outroVideo: true }) !== null, true);
});

Deno.test('pasta sem id não entra', () => {
  assertEquals(pastasDoVideo('j1', ['e1']), ['director/j1/', 'edits/e1/']);
  assertEquals(pastasDoVideo('', ['']), []);
});
