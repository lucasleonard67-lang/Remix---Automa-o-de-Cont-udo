import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';

import {
  abrirEstado, eHub, HUB_PADRAO, instanciaAutorizada, instanciaValida, selarEstado, tokenConfere,
  tokenDaInstancia, urlDoGoogle, voltaParaInstancia,
} from './drive-hub.ts';

const A = 'https://abcdefghijklmnopqrst.supabase.co';
const HUB_I = 'https://rpsyfmvwdmzykggcwnoc.supabase.co';

Deno.test('só aceita endereço de projeto', () => {
  assert(instanciaValida(A));
  for (const ruim of ['http://abcdefghijklmnopqrst.supabase.co', `${A}/x`, 'https://evil.test', 'https://a.supabase.co.evil.test', null]) {
    assertFalse(instanciaValida(ruim), String(ruim));
  }
});

Deno.test('instância precisa estar na lista; o hub entra sozinho', () => {
  assert(instanciaAutorizada(A, HUB_PADRAO, [A]));
  assertFalse(instanciaAutorizada(A, HUB_PADRAO, []));
  assertFalse(instanciaAutorizada(A, HUB_PADRAO, null));
  assert(instanciaAutorizada(HUB_I, HUB_PADRAO, null));
  assert(eHub(HUB_PADRAO, HUB_I));
  assertFalse(eHub(HUB_PADRAO, A));
});

Deno.test('token da instância não vale para outra nem com outro segredo', async () => {
  const token = await tokenDaInstancia('s', A);
  assert(await tokenConfere('s', A, token));
  assertFalse(await tokenConfere('s', HUB_I, token));
  assertFalse(await tokenConfere('outro', A, token));
  assertFalse(await tokenConfere('s', A, undefined));
});

Deno.test('estado: volta inteiro, recusa adulterado e vencido', async () => {
  const selado = await selarEstado('s', { instancia: A, state: 'abc', expira: 2000 });
  assertEquals(await abrirEstado('s', selado, 1000), { instancia: A, state: 'abc' });
  assertEquals(await abrirEstado('s', selado, 3000), null);
  assertEquals(await abrirEstado('outro', selado, 1000), null);
  const [corpo, assinatura] = selado.split('.');
  assertEquals(await abrirEstado('s', `${corpo}x.${assinatura}`, 1000), null);
  assertEquals(await abrirEstado('s', 'lixo', 1000), null);
});

Deno.test('URL do Google usa o hub como retorno e pede acesso offline com PKCE', () => {
  const url = new URL(urlDoGoogle({ clientId: 'c', hub: HUB_PADRAO, escopo: 'e', selado: 'x.y', challenge: 'ch' }));
  assertEquals(url.searchParams.get('redirect_uri'), HUB_PADRAO);
  assertEquals(url.searchParams.get('access_type'), 'offline');
  assertEquals(url.searchParams.get('code_challenge_method'), 'S256');
  assertEquals(url.searchParams.get('state'), 'x.y');
});

Deno.test('volta para a instância com código ou recusa', () => {
  const ok = new URL(voltaParaInstancia(A, 'st', 'cod', null));
  assertEquals(ok.pathname, '/functions/v1/google-drive');
  assertEquals(ok.searchParams.get('code'), 'cod');
  assertEquals(new URL(voltaParaInstancia(A, 'st', null, 'access_denied')).searchParams.get('error'), 'access_denied');
});
