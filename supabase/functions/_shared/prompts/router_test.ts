import { assertEquals } from 'jsr:@std/assert@1';

import { inferableChannels } from './router.ts';

Deno.test('inferableChannels: sem canal pedido, o Reel fica de fora mesmo ligado', () => {
  assertEquals(inferableChannels(['instagram_post', 'instagram_reel']), ['instagram_post']);
  assertEquals(inferableChannels(['instagram_post', 'instagram_reel'], []), ['instagram_post']);
});

Deno.test('inferableChannels: com canal pedido, nada muda', () => {
  assertEquals(
    inferableChannels(['instagram_post', 'instagram_reel'], ['instagram_reel']),
    ['instagram_post', 'instagram_reel'],
  );
});

Deno.test('inferableChannels: só o Reel ligado e nada pedido não sobra canal', () => {
  assertEquals(inferableChannels(['instagram_reel']), []);
});
