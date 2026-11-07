import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { aplicarTrocas, codigoDeAceite, custoDeOrigem, erroDeOrigem, falhouPago, jobRefeito, roteiroNovo, type JobOrigem } from './video-refazer.ts';

const JOB: JobOrigem = {
  id: 'a', brief: { title: 'x' }, costs: { heygen_usd_est: 2.4 }, artifacts: { avatar: { engine: 'avatar_v' } },
  config: { mode: 'avatar_video', captions: true, avatar_video: { script: 'Nos EUA, a PEUAL cresce. Os EUA lideram.', look_id: 'l' } },
};

Deno.test('troca a palavra inteira, todas as vezes', () => {
  assertEquals(aplicarTrocas('Nos EUA, a PEUAL. Os EUA.', [{ de: 'EUA', para: 'Estados Unidos' }]), {
    texto: 'Nos Estados Unidos, a PEUAL. Os Estados Unidos.', faltou: [],
  });
});

Deno.test('palavra que não está no roteiro para o pedido', () => {
  assertEquals(roteiroNovo(JOB, null, [{ de: 'ONU', para: 'Nações Unidas' }]).erro, 'Não encontrei no roteiro: ONU.');
});

Deno.test('pedido vazio ou igual não gera vídeo', () => {
  assertEquals(roteiroNovo(JOB, '', []).erro, 'Informe o roteiro novo ou as trocas.');
  assertEquals(roteiroNovo(JOB, 'Nos EUA, a PEUAL cresce. Os EUA lideram.', null).erro, 'O roteiro novo é igual ao atual.');
});

Deno.test('roteiro inteiro vale no lugar das trocas', () => {
  assertEquals(roteiroNovo(JOB, ' Texto novo ', [{ de: 'nada', para: 'x' }]), { texto: 'Texto novo', erro: null });
});

Deno.test('só avatar com roteiro pode refazer a fala', () => {
  assertEquals(erroDeOrigem(JOB), null);
  assertEquals(erroDeOrigem({ ...JOB, config: { mode: 'remake' } }), 'Este vídeo não foi feito com avatar lendo um roteiro.');
  assertEquals(erroDeOrigem({ ...JOB, config: { mode: 'avatar_video', avatar_video: {} } }), 'Este vídeo não guardou o roteiro.');
});

Deno.test('job novo mantém o avatar, troca a fala e não leva artefatos', () => {
  const novo = jobRefeito(JOB, 'Fala nova');
  assertEquals(novo.config.avatar_video, { script: 'Fala nova', look_id: 'l' });
  assertEquals(novo.config.captions, true);
  assertEquals(novo.config.refaz_de, 'a');
  assertEquals('artifacts' in novo, false);
  assertEquals((JOB.config.avatar_video as { script: string }).script.startsWith('Nos EUA'), true);
});

Deno.test('mostra provedor e preço do vídeo de origem', () => {
  const mesmo = (JOB.config.avatar_video as { script: string }).script;
  assertEquals(custoDeOrigem(JOB, mesmo), { provedor: 'heygen/avatar_v', usd_estimado: 2.4 });
  assertEquals(custoDeOrigem(JOB, mesmo + mesmo).usd_estimado, 4.8);
  assertEquals(custoDeOrigem({ ...JOB, costs: {} }, mesmo).usd_estimado, null);
});

Deno.test('trocas valem juntas, sem trocar o que já foi trocado', () => {
  const trocas = [{ de: 'Trump', para: 'Biden' }, { de: 'Biden', para: 'Trump' }];
  assertEquals(aplicarTrocas('Trump venceu Biden', trocas).texto, 'Biden venceu Trump');
  assertEquals(aplicarTrocas('um cafe\u0301 quente', [{ de: 'cafe', para: 'X' }]).faltou, ['cafe']);
});

Deno.test('título que veio do roteiro acompanha a fala nova', () => {
  const job = { ...JOB, brief: { title: 'Nos EUA, a PEUAL cresce.' } };
  assertEquals(jobRefeito(job, 'Nos Estados Unidos, cresce. Fim.').brief.title, 'Nos Estados Unidos, cresce.');
  assertEquals(jobRefeito(JOB, 'Outro. Fim.').brief.title, 'x');
});

Deno.test('voz sorteada na origem fica fixa; a escolhida não muda', () => {
  const job = { ...JOB, artifacts: { avatar: { voice_provider: 'elevenlabs', eleven_voice_id: 'v1' } } };
  assertEquals((jobRefeito(job, 'Novo').config.avatar_video as { voice: unknown }).voice, { provider: 'elevenlabs', voice_id: 'v1' });
  const escolhida = { ...job, config: { ...job.config, avatar_video: { script: 's', voice: { voice_id: 'minha' } } } };
  assertEquals((jobRefeito(escolhida, 'Novo').config.avatar_video as { voice: unknown }).voice, { voice_id: 'minha' });
});

Deno.test('falha depois de pago é retomada', () => {
  assertEquals(falhouPago({ status: 'failed', artifacts: { avatar: { pending: { id: '1' } } } }), true);
  assertEquals(falhouPago({ status: 'failed', artifacts: {} }), false);
  assertEquals(falhouPago({ status: 'done', artifacts: { avatar: { result_path: 'x' } } }), false);
});

Deno.test('aceite vale só para o roteiro e o custo mostrados', () => {
  const codigo = codigoDeAceite(JOB, 'Texto', 2.4);
  assertEquals(codigoDeAceite(JOB, 'Texto', 2.4), codigo);
  assertEquals(codigoDeAceite(JOB, 'Outro', 2.4) === codigo, false);
  assertEquals(codigoDeAceite(JOB, 'Texto', 9) === codigo, false);
});
