import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildVideoCosts, jobTitle, newestVideos, pieceTitle, type JobRow, type ReelRow } from './video-costs.ts';

const editModel = 'claude-sonnet-5-5';
const job = (over: Partial<JobRow>): JobRow => ({
  id: 'j1', status: 'done', created_at: '2026-10-01T10:00:00Z', brief: {}, plan: null, config: {}, costs: {}, ...over,
});
const reel = (over: Partial<ReelRow>): ReelRow => ({
  id: 'r1', piece_id: 'p1', status: 'ready', created_at: '2026-10-02T10:00:00Z', estimated_cost_usd: null, actual_cost_usd: 0, title: 'Reel', ...over,
});
const build = (over: Partial<Parameters<typeof buildVideoCosts>[0]>) =>
  buildVideoCosts({ jobs: [], reels: [], predictions: [], edits: [], editModel, ...over });

Deno.test('job do Replicate soma cenas e edição, e lista os modelos', () => {
  const [v] = build({
    jobs: [job({ config: { engine: 'replicate', model_id: 'bytedance/seedance-2', ab_model_id: 'kwai/kling-3' }, costs: { replicate_usd_est: 1.5 } })],
    edits: [{ id: 'e1', source_kind: 'job', source_id: 'j1', source_path: 'x', status: 'ready', cost_usd: '0.1200', created_at: '2026-10-01T11:00:00Z' }],
  });
  assertEquals(v.usd_est, 1.62);
  assertEquals(v.modelos, ['bytedance/seedance-2', 'kwai/kling-3', editModel]);
  assertEquals(v.etapas.map((e) => [e.etapa, e.usd_est]), [['cenas', 1.5], ['edicao', 0.12]]);
  assertEquals(v.parcial, false);
});

Deno.test('crédito do Higgsfield fica à parte do dólar e é aproximado', () => {
  const [v] = build({ jobs: [job({ costs: { hf_credits_start: 1000, hf_credits_spent: 90.5 } })] });
  assertEquals(v.usd_est, null);
  assertEquals(v.creditos, 90.5);
  assertEquals(v.creditos_aproximados, true);
  assertEquals(v.parcial, false);
  assertEquals(v.modelos, ['higgsfield']);
});

Deno.test('job Higgsfield que falhou gastou crédito sem medir: parcial, nunca zero', () => {
  const [v] = build({ jobs: [job({ status: 'failed', costs: { hf_credits_start: 1000 } })] });
  assertEquals(v.status, 'falhou');
  assertEquals(v.creditos, null);
  assertEquals(v.parcial_motivos, ['creditos_sem_fim']);
});

Deno.test('saldo negativo por recarga no meio do job não vira crédito', () => {
  const [v] = build({ jobs: [job({ costs: { hf_credits_start: 10, hf_credits_spent: -500 } })] });
  assertEquals(v.creditos, null);
  assertEquals(v.parcial_motivos, ['creditos_sem_fim']);
});

Deno.test('HeyGen sem preço de catálogo marca parcial; com preço entra no avatar', () => {
  const [sem] = build({ jobs: [job({ config: { mode: 'avatar_video' }, costs: { heygen_seconds: 30, heygen_usd_est: null } })] });
  assertEquals(sem.tipo, 'avatar');
  assertEquals(sem.parcial_motivos, ['heygen_sem_preco']);
  const [com] = build({ jobs: [job({ config: { mode: 'video_agent' }, costs: { heygen_seconds: 30, heygen_usd_est: 0.9 } })] });
  assertEquals(com.tipo, 'video_agent');
  assertEquals(com.modelos, ['heygen/video-agent']);
  assertEquals(com.etapas[0], { etapa: 'avatar', modelo: 'heygen/video-agent', usd_est: 0.9, creditos: null });
});

Deno.test('remake lista cena, pessoa e voz', () => {
  const [v] = build({
    jobs: [job({ config: { mode: 'remake', remake: { scene_model_id: 'a/cena', person_model_id: 'a/pessoa', tts_model_id: 'a/voz' } }, costs: { replicate_usd_est: 2 } })],
  });
  assertEquals(v.tipo, 'remake');
  assertEquals(v.modelos, ['a/cena', 'a/pessoa', 'a/voz']);
});

Deno.test('vídeo em andamento é sempre parcial', () => {
  const [v] = build({ jobs: [job({ status: 'videos', costs: { replicate_usd_est: 1 } })] });
  assertEquals(v.status, 'andamento');
  assertEquals(v.parcial_motivos, ['em_andamento']);
});

Deno.test('vídeo terminado sem nenhum custo não vira US$ 0', () => {
  const [v] = build({ jobs: [job({ config: { engine: 'replicate' } })] });
  assertEquals(v.usd_est, null);
  assertEquals(v.parcial_motivos, ['sem_custo_registrado']);
});

Deno.test('Reel soma as predictions por etapa e modelo, preferindo o custo real', () => {
  const [v] = build({
    reels: [reel({ estimated_cost_usd: 9 })],
    predictions: [
      { project_id: 'r1', kind: 'scene_video', model_id: 'a/m', status: 'succeeded', cost_actual_usd: 1, cost_estimated_usd: 2 },
      { project_id: 'r1', kind: 'scene_video', model_id: 'a/m', status: 'failed', cost_actual_usd: null, cost_estimated_usd: '0.5' },
      { project_id: 'r1', kind: 'tts', model_id: 'b/voz', status: 'succeeded', cost_actual_usd: null, cost_estimated_usd: 0.25 },
      { project_id: 'r1', kind: 'scene_video', model_id: 'a/m', status: 'canceled', cost_actual_usd: null, cost_estimated_usd: 5 },
      { project_id: 'r1', kind: 'scene_video', model_id: 'c/fila', status: 'queued', cost_actual_usd: null, cost_estimated_usd: 5 },
    ],
  });
  assertEquals(v.usd_est, 1.75);
  assertEquals(v.modelos, ['a/m', 'b/voz']);
  assertEquals(v.parcial, false);
});

Deno.test('só o Reel traz piece_id, para abrir na biblioteca', () => {
  const list = build({ jobs: [job({ config: { engine: 'replicate' }, costs: { replicate_usd_est: 2 } })], reels: [reel({ estimated_cost_usd: 1 })] });
  assertEquals(list.map((v) => v.piece_id), [null, 'p1']);
});

Deno.test('corte fica com os mais recentes das três fontes, mesmo os baratos', () => {
  const row = (id: string, created_at: string) => ({ id, created_at });
  const out = newestVideos(
    [row('j-velho', '2026-01-01T00:00:00Z'), row('j-novo', '2026-10-03T00:00:00Z')],
    [row('r-novo', '2026-10-02T00:00:00Z')],
    [row('e-novo', '2026-10-01T00:00:00Z'), row('e-velho', '2026-01-02T00:00:00Z')],
    3,
  );
  assertEquals(out.cut, true);
  assertEquals([...out.jobs, ...out.reels, ...out.edits].map((r) => r.id), ['j-novo', 'r-novo', 'e-novo']);
  assertEquals(newestVideos([row('a', '2026-01-01T00:00:00Z')], [], [], 3).cut, false);
});

Deno.test('Reel sem predictions cai na estimativa e avisa', () => {
  const [v] = build({ reels: [reel({ estimated_cost_usd: '3.2000' })] });
  assertEquals(v.usd_est, 3.2);
  assertEquals(v.parcial_motivos, ['reel_so_estimativa']);
});

Deno.test('edição de arquivo solto vira linha própria; edição de job não duplica', () => {
  const list = build({
    jobs: [job({ config: { engine: 'replicate' }, costs: { replicate_usd_est: 1 } })],
    edits: [
      { id: 'e1', source_kind: 'job', source_id: 'j1', source_path: 'x', status: 'ready', cost_usd: 0.1, created_at: '2026-10-01T11:00:00Z' },
      { id: 'e2', source_kind: 'path', source_id: null, source_path: 'uploads/meu-video.mp4', status: 'ready', cost_usd: 0.2, created_at: '2026-10-03T11:00:00Z' },
    ],
  });
  assertEquals(list.map((v) => v.id), ['j1', 'e2']);
  assertEquals(list[1].titulo, 'meu-video.mp4');
});

Deno.test('ordem: mais caro primeiro, sem valor no fim', () => {
  const list = build({
    jobs: [
      job({ id: 'barato', config: { engine: 'replicate' }, costs: { replicate_usd_est: 1 } }),
      job({ id: 'caro', config: { engine: 'replicate' }, costs: { replicate_usd_est: 5 } }),
      job({ id: 'sem', config: { engine: 'replicate' } }),
    ],
  });
  assertEquals(list.map((v) => v.id), ['caro', 'barato', 'sem']);
});

Deno.test('letras só aparecem quando registradas', () => {
  const [v] = build({ jobs: [job({ config: { engine: 'replicate' }, costs: { replicate_usd_est: 1, eleven_chars: 1200 } })] });
  assertEquals(v.letras, 1200);
  const [w] = build({ jobs: [job({ config: { engine: 'replicate' }, costs: { replicate_usd_est: 1 } })] });
  assertEquals(w.letras, null);
  assertEquals(w.parcial, false);
});

Deno.test('títulos seguem a ordem das telas', () => {
  assertEquals(jobTitle({ plan: { concept: 'Conceito' }, brief: { title: 'T' } }), 'Conceito');
  assertEquals(jobTitle({ plan: null, brief: { smp: ' ', numero_heroi: '', objetivo: 'Vender', title: 'T' } }), 'Vender');
  assertEquals(jobTitle({ plan: null, brief: {} }), null);
  assertEquals(pieceTitle({ hook: { written: '\nGancho\nresto' }, idea: 'Ideia' }), 'Gancho');
  assertEquals(pieceTitle({ idea: 'Ideia' }), 'Ideia');
  assert(pieceTitle(null) === null);
});
