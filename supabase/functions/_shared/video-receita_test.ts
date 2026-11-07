import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { deliveredPath, deliveryIssues, deliveryProbe, isMp4Head, parseDelivery } from './video-receita.ts';

const head = (text: string) => new TextEncoder().encode(text);

Deno.test('só aceita arquivo que começa como MP4', () => {
  assertEquals(isMp4Head(head('\0\0\0 ftypisom')), true);
  assertEquals(isMp4Head(head('<html><body>')), false);
  assertEquals(isMp4Head(head('ab')), false);
});

Deno.test('entrega não sobrescreve o render do produto', () => {
  assertEquals(deliveredPath('a'), 'edits/a/claude.mp4');
});

const OUT = '{"streams":[{"codec_type":"video","width":1080,"height":1920},{"codec_type":"audio"}],"format":{"duration":"20.000000"}}';

Deno.test('mede a entrega pelo ffprobe', () => {
  assertEquals(parseDelivery(OUT), { duration: 20, hasAudio: true, width: 1080, height: 1920 });
  assertEquals(parseDelivery('command not found'), null);
});

Deno.test('recusa vídeo sem áudio, deitado ou curto demais', () => {
  const bom = { duration: 20, hasAudio: true, width: 1080, height: 1920 };
  assertEquals(deliveryIssues(bom, 30), []);
  assertEquals(deliveryIssues({ ...bom, hasAudio: false }, 30), ['O vídeo veio sem áudio.']);
  assertEquals(deliveryIssues({ ...bom, width: 1920, height: 1080 }, 30), ['O vídeo precisa ser vertical.']);
  assertEquals(deliveryIssues({ ...bom, duration: 1 }, 30), ['O vídeo ficou curto demais para ser este conteúdo.']);
});

Deno.test('aspa na URL não escapa do comando', () => {
  assertEquals(deliveryProbe("https://a/b'c").endsWith("'https://a/b'\\''c'"), true);
});

Deno.test('entrega pelo plano aceita 16:9 e recusa vertical fora do formato', () => {
  const horizontal = { hasAudio: true, width: 1920, height: 1080, duration: 60 };
  assertEquals(deliveryIssues(horizontal, 60, '16:9'), []);
  assertEquals(deliveryIssues(horizontal, 60), ['O vídeo precisa ser vertical.']);
  assertEquals(deliveryIssues({ ...horizontal, width: 1080, height: 1920 }, 60, '16:9'), ['O vídeo precisa sair em 16:9, como no plano.']);
});
