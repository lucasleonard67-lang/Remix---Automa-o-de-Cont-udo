import { assertEquals } from 'jsr:@std/assert@1';
import { ACOES_DO_CONECTOR, CONECTOR_USUARIO, usuarioDoConector } from './conector-interno.ts';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const cliente = (segredo: string | null, admin: boolean) => ({
  rpc: (nome: string) => Promise.resolve({ data: nome === 'get_vault_secret' ? segredo : admin }),
});
const pedido = (headers: Record<string, string>) => new Request('https://x.test', { method: 'POST', headers });

Deno.test('aceita só segredo certo e usuário admin', async () => {
  const headers = { 'x-cron-secret': 'certo', [CONECTOR_USUARIO]: ADMIN };
  assertEquals(await usuarioDoConector(pedido(headers), cliente('certo', true)), ADMIN);
  assertEquals(await usuarioDoConector(pedido(headers), cliente('outro', true)), null);
  assertEquals(await usuarioDoConector(pedido(headers), cliente(null, true)), null);
  assertEquals(await usuarioDoConector(pedido(headers), cliente('certo', false)), null);
});

Deno.test('sem cabeçalhos completos, não vira chamada interna', async () => {
  assertEquals(await usuarioDoConector(pedido({ [CONECTOR_USUARIO]: ADMIN }), cliente('certo', true)), null);
  assertEquals(await usuarioDoConector(pedido({ 'x-cron-secret': 'certo' }), cliente('certo', true)), null);
  assertEquals(await usuarioDoConector(pedido({ 'x-cron-secret': 'certo', [CONECTOR_USUARIO]: 'x' }), cliente('certo', true)), null);
});

Deno.test('o conector não apaga nem arquiva', () => {
  for (const acao of ['archive', 'heygen_delete', 'voice_delete', 'heygen_twin', 'voice_clone', 'voice_set_default']) {
    assertEquals(ACOES_DO_CONECTOR.includes(acao), false);
  }
});

Deno.test('toda ação liberada existe no avatar-studio', async () => {
  const codigo = await Deno.readTextFile(new URL('../avatar-studio/index.ts', import.meta.url));
  for (const acao of ACOES_DO_CONECTOR) assertEquals(codigo.includes(`case '${acao}':`), true, acao);
});
