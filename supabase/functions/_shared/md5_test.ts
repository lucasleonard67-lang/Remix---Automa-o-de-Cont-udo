import { assertEquals } from 'jsr:@std/assert@1';
import { createHash } from 'node:crypto';

import { Md5 } from './md5.ts';

const text = (value: string) => new TextEncoder().encode(value);

Deno.test('md5: vetores da RFC 1321', () => {
  assertEquals(new Md5().digest(), 'd41d8cd98f00b204e9800998ecf8427e');
  assertEquals(new Md5().update(text('abc')).digest(), '900150983cd24fb0d6963f7d28e17f72');
  assertEquals(
    new Md5().update(text('12345678901234567890123456789012345678901234567890123456789012345678901234567890')).digest(),
    '57edf4a22be3c955ac49da2e2107b67a',
  );
});

Deno.test('md5: bate com o nativo em todos os tamanhos em volta do bloco', () => {
  for (const size of [1, 55, 56, 57, 63, 64, 65, 119, 120, 121, 1000]) {
    const bytes = crypto.getRandomValues(new Uint8Array(size));
    assertEquals(new Md5().update(bytes).digest(), createHash('md5').update(bytes).digest('hex'), `tamanho ${size}`);
  }
});

Deno.test('md5: para no banco e continua na execução seguinte', () => {
  const bytes = crypto.getRandomValues(new Uint8Array(60_000));
  let md5 = new Md5();
  for (const end of [13, 64, 5000, 5001, 59_999, 60_000]) {
    md5.update(bytes.subarray(md5.length, end));
    md5 = Md5.from(JSON.parse(JSON.stringify(md5.snapshot())));
  }
  assertEquals(md5.length, 60_000);
  assertEquals(md5.digest(), createHash('md5').update(bytes).digest('hex'));
});

Deno.test('md5: digest não muda o estado', () => {
  const md5 = new Md5().update(text('ab'));
  md5.digest();
  assertEquals(md5.update(text('c')).digest(), '900150983cd24fb0d6963f7d28e17f72');
});
