import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
import { aceiteDe, pedidoDeRemake, pedidoDeVideo, somarCustos, type PedidoDeVideo } from './mcp-criar.ts';

const ID = '11111111-1111-4111-8111-111111111111';
const ok = (v: PedidoDeVideo | string) => {
  if (typeof v === 'string') throw new Error(v);
  return v;
};
const briefing = { objetivo: 'o', publico: 'p', smp: 's', numero_heroi: '40%', tom: 't', cta: 'c' };

Deno.test('modelo do Higgsfield que o motor não roda é recusado', () => {
  for (const modelo of ['higgsfield/seedance_2_5', 'higgsfield/cinematic_studio_video_4_0', 'seedance_2_5']) {
    const r = pedidoDeVideo({ rota: 'cenas', briefing, duracao_s: 30, modelo });
    assert(typeof r === 'string' && r.includes('higgsfield/cinematic_studio_3_0'));
  }
});

Deno.test('avatar grava o mesmo config da tela', () => {
  const p = ok(pedidoDeVideo({ rota: 'avatar', look_id: 'look', roteiro: 'Olá. Tudo bem?', voz: { brand_voice_id: ID, provider: 'heygen' } }));
  assertEquals(p.brief, { title: 'Olá.' });
  assertEquals(p.config, {
    mode: 'avatar_video',
    avatar_video: {
      provider: 'heygen', script: 'Olá. Tudo bem?', aspect_ratio: '9:16', look_id: 'look',
      voice: { provider: 'heygen', brand_voice_id: ID },
    },
  });
});

Deno.test('foto pelo Replicate exige apresentador e usa o modelo', () => {
  assertEquals(typeof pedidoDeVideo({ rota: 'foto', roteiro: 'x' }), 'string');
  const p = ok(pedidoDeVideo({ rota: 'foto', apresentador_id: ID, roteiro: 'x', modelo: 'replicate/prunaai/p-video-avatar' }));
  assertEquals((p.config.avatar_video as Record<string, unknown>).model_id, 'prunaai/p-video-avatar');
  assertEquals((p.config.avatar_video as Record<string, unknown>).provider, 'replicate');
});

Deno.test('agente valida a ideia', () => {
  assertEquals(typeof pedidoDeVideo({ rota: 'agente', ideia: ' ' }), 'string');
  assertEquals(ok(pedidoDeVideo({ rota: 'agente', ideia: 'Um Reel' })).config.mode, 'video_agent');
});

Deno.test('cenas pedem o briefing inteiro e não param em aprovação', () => {
  assertEquals(pedidoDeVideo({ rota: 'cenas', briefing: { ...briefing, cta: '' }, duracao_s: 30 }), 'Faltam no briefing: cta.');
  assertEquals(typeof pedidoDeVideo({ rota: 'cenas', briefing, duracao_s: 500 }), 'string');
  assertEquals(typeof pedidoDeVideo({ rota: 'apresentador', briefing, duracao_s: 30 }), 'string');
  const p = ok(pedidoDeVideo({ rota: 'cenas', briefing, duracao_s: 30, modelo: 'replicate/bytedance/seedance-2.0' }));
  assertEquals(p.config.engine, 'replicate');
  assertEquals(p.config.model_id, 'bytedance/seedance-2.0');
  assertEquals(p.config.auto_approve_keyframes, true);
  assertEquals(p.config.mode, undefined);
  assertEquals(ok(pedidoDeVideo({ rota: 'cenas', briefing, duracao_s: 30, modelo: 'higgsfield/cinematic_studio_3_0' })).config.engine, 'higgsfield');
});

Deno.test('rota desconhecida não vira job', () => {
  assertEquals(typeof pedidoDeVideo({ rota: 'x' }), 'string');
});

Deno.test('remake usa o validador do motor', () => {
  assertEquals(typeof pedidoDeRemake('a.mp4', 45, { estilo: 'cinema' }), 'string');
  assertEquals(typeof pedidoDeRemake('a.mp4', 20, {}), 'string');
  assertEquals(typeof pedidoDeRemake('a.mp4', 20, { estilo: 'inventado' }), 'string');
  const p = ok(pedidoDeRemake('a.mp4', 20, { traduzir_para: 'en', legenda: true }));
  assertEquals(p.config.mode, 'remake');
  assertEquals(p.config.captions, true);
  assertEquals((p.config.remake as Record<string, unknown>).translate, 'en');
});

Deno.test('aceite muda com o pedido e com o custo', () => {
  const pedido = { rota: 'avatar', roteiro: 'a' };
  assertEquals(aceiteDe(pedido, 1), aceiteDe({ ...pedido }, 1));
  assertNotEquals(aceiteDe(pedido, 1), aceiteDe(pedido, 2));
  assertNotEquals(aceiteDe(pedido, 1), aceiteDe({ ...pedido, roteiro: 'b' }, 1));
  assert(aceiteDe(pedido, null));
});

Deno.test('custo sem preço não some da conta', () => {
  assertEquals(somarCustos([{ nome: 'a', usd: 0.101 }, { nome: 'b', usd: null }]), { usd_estimado: 0.11, sem_preco: ['b'] });
  assertEquals(somarCustos([{ nome: 'b', usd: null }]), { usd_estimado: null, sem_preco: ['b'] });
});
