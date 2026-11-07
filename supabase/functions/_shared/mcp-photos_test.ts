import { assertEquals } from 'jsr:@std/assert@1';
import { comFotos, erroDaUrl, tipoDaImagem } from './mcp-photos.ts';

// DNS de mentira: exemplo.com.br é público, interno.exemplo.com.br aponta para 10.x
const dns = (host: string, type: 'A' | 'AAAA') =>
  Promise.resolve(type === 'AAAA' ? [] : host === 'interno.exemplo.com.br' ? ['10.0.0.7'] : ['93.184.216.34']);

Deno.test('erroDaUrl aceita https público e barra rede interna', async () => {
  assertEquals(await erroDaUrl('https://exemplo.com.br/foto.jpg', dns), null);
  for (const url of [
    'http://exemplo.com/a.jpg',
    'https://localhost/a.jpg',
    'https://localhost./a.jpg',
    'https://169.254.169.254/latest',
    'https://[::1]/a.jpg',
    'https://intranet/a.jpg',
    'https://db.internal/a.jpg',
    'https://interno.exemplo.com.br/a.jpg',
    'nao-e-url',
  ]) {
    assertEquals(typeof (await erroDaUrl(url, dns)), 'string', url);
  }
});

Deno.test('tipoDaImagem olha os bytes', () => {
  assertEquals(tipoDaImagem(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))?.ext, 'png');
  assertEquals(tipoDaImagem(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.ext, 'jpg');
  assertEquals(tipoDaImagem(new TextEncoder().encode('RIFFxxxxWEBPVP8 '))?.ext, 'webp');
  assertEquals(tipoDaImagem(new TextEncoder().encode('<html>não é imagem')), null);
});

Deno.test('comFotos: capa pura, miolo promovido, gráfico continua gráfico', () => {
  const slides = [
    { index: 0, visual: 'photo', cover_art_rendered: true },
    { index: 1, visual: 'none' },
    { index: 2, visual: 'chart' },
    { index: 3, visual: 'none' },
  ];
  const fotos = new Map([[0, 'c.png'], [1, 'a.png'], [2, 'b.png']]);
  assertEquals(comFotos(slides, fotos), [
    { index: 0, visual: 'photo', cover_art_rendered: false, image_path: 'c.png' },
    { index: 1, visual: 'photo', image_path: 'a.png', photo_promoted: true },
    { index: 2, visual: 'chart', image_path: 'b.png', photo_promoted: true },
    { index: 3, visual: 'none' },
  ]);
});
