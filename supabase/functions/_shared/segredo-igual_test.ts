import { assertEquals } from 'jsr:@std/assert@1';
import { segredoIgual } from './segredo-igual.ts';

Deno.test('segredo igual só quando é exatamente igual', () => {
  assertEquals(segredoIgual('abc123', 'abc123'), true);
  assertEquals(segredoIgual('abc124', 'abc123'), false);
  assertEquals(segredoIgual('abc12', 'abc123'), false);
  assertEquals(segredoIgual('abc1234', 'abc123'), false);
  assertEquals(segredoIgual('', ''), false);
  assertEquals(segredoIgual(null, 'abc'), false);
  assertEquals(segredoIgual('abc', undefined), false);
});
