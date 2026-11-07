// "Editar com Claude" sem rede: Claude, sandbox, busca e worker simulados; as fases são reais.
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  advanceEdit, motionPath, outputPath, planHasCaptions, planOfSteps, requestState, sanitizePlan, sourceFacts, technicalDetail, type EditIo, type EditRow, type PlanDraft, type WorkerStatus,
} from './video-edit-engine.ts';

const ID = '00000000-0000-4000-8000-000000000001';
const WORDS = Array.from({ length: 12 }, (_, i) => ({ text: `w${i}`, start: i + 0.1, end: i + 0.9 }));
const CTX = { words: WORDS, duration: 12, hasMusic: false, captionsBurned: false, brand: { logo: false, primary: '#111111' } };

const hook = { type: 'hook', word_from: 0, word_to: 3, text: 'Título forte', emphasis: 'forte', position: 'top' };
const PLAN = {
  summary: 'Vou colocar um título e cortar respiros.',
  steps: [
    { title: 'Colocar título', detail: 'No começo.', ops: [], layers: [hook] },
    { title: 'Cortar respiros', detail: 'Tira as pausas.', ops: [{ type: 'trim_silences', pad_ms: 80, min_gap_ms: 400 }], layers: [] },
    { title: 'Inválido', detail: 'Fora do menu.', ops: [{ type: 'apagar_tudo' }], layers: [] },
    { title: 'Vazio', detail: 'Sem efeito.', ops: [], layers: [] },
  ],
  not_possible: ['Trocar o fundo.'],
};

function world(row: Partial<EditRow>, opts: { status?: WorkerStatus[]; submit?: () => string } = {}) {
  let current: EditRow = {
    id: ID, source_kind: 'job', source_id: 'j', source_path: 'final.mp4', status: 'queued', analysis: {}, plan: null,
    artifacts: {}, output_path: null, qa: null, cost_usd: 0, error: null, auto: false, ...row,
  };
  const submitted: Record<string, unknown>[] = [];
  const edited: string[] = [];
  const statuses = [...(opts.status ?? [])];
  const asked: Record<string, unknown>[] = [];
  const queue: unknown[] = [];
  const io = {
    patchEdit: (_: string, f: Partial<EditRow>) => { current = { ...current, ...f }; return Promise.resolve(); },
    brand: () => Promise.resolve({ primary: '#111111', accent: '#ff0000', logoPath: null, handle: null, font: null }),
    sourceContext: () => Promise.resolve({ objective: null, captionsBurned: false }),
    sign: (p: string) => Promise.resolve(`https://x.supabase.co/${p}`),
    signUpload: (p: string) => Promise.resolve(`https://x.supabase.co/up/${p}`),
    putObject: () => Promise.resolve(),
    getObject: () => Promise.resolve(new Uint8Array([1])),
    fontUrls: () => Promise.resolve({}),
    sandbox: (cmd: string, o: { background?: boolean }) => Promise.resolve(
      o.background ? 'Combined output: /tmp/l\nExit status (written when done): /tmp/e' : 'EXITCODE:0\nQA:9.5|audio|-14.2\nEDIT_OK',
    ),
    stt: () => Promise.resolve({ words: [] }),
    modelo: (body: Record<string, unknown>) => {
      asked.push(body);
      return Promise.resolve({ stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 100 },
        content: [{ type: 'text', text: JSON.stringify(queue.shift() ?? { ok: true, issues: [], fixed_ops: [] }) }] });
    },
    markEdited: (_: EditRow, p: string) => { edited.push(p); return Promise.resolve(); },
    search: () => Promise.resolve([{ title: 'OMS', url: 'https://who.int', text: '32%' }]),
    workerSubmit: (b: Record<string, unknown>) => { submitted.push(b); return Promise.resolve(opts.submit?.() ?? 'call-1'); },
    workerStatus: () => Promise.resolve(statuses.shift() ?? { status: 'running' }),
  } as unknown as EditIo;
  return { io, get row() { return current; }, submitted, edited, asked, queue };
}

const READY: WorkerStatus = { status: 'ready', duration: 12, has_audio: true, lufs: -14.3 };

Deno.test('sourceFacts: objetivo vem de onde cada lane guarda', () => {
  assertEquals(sourceFacts({ brief: { objetivo: 'vender' } }).objective, 'vender');
  assertEquals(sourceFacts({ config: { avatar_video: { script: 'roteiro' } } }).objective, 'roteiro');
  assertEquals(sourceFacts({ config: { video_agent: { prompt: 'ideia' } } }).objective, 'ideia');
  assertEquals(sourceFacts({}).objective, null);
});

Deno.test('sourceFacts: legenda queimada por lane', () => {
  assertEquals(sourceFacts({ config: {} }).captionsBurned, true);
  assertEquals(sourceFacts({ config: { captions: false } }).captionsBurned, false);
  assertEquals(sourceFacts({ config: { video_agent: { prompt: 'x' } } }).captionsBurned, false);
  assertEquals(sourceFacts({ config: { avatar_video: {}, captions: true }, artifacts: { avatar: {} } }).captionsBurned, false);
  assertEquals(sourceFacts({ config: { avatar_video: {}, captions: true }, artifacts: { avatar: { captions_by: 'heygen' } } }).captionsBurned, true);
  assertEquals(sourceFacts({ config: { video_agent: {}, captions: true }, artifacts: { agent: { captions_by: 'sandbox' } } }).captionsBurned, true);
});

Deno.test('sanitizePlan: fica só o que é aplicável', () => {
  const clean = sanitizePlan(PLAN, CTX);
  assertEquals(clean.steps.map((s) => s.title), ['Colocar título', 'Cortar respiros']);
  assertEquals(clean.not_possible, ['Trocar o fundo.', 'Inválido: Operação inválida.']);
});

Deno.test('sanitizePlan: sem render, fica o que o ffmpeg faz e a tela explica o resto', () => {
  const clean = sanitizePlan({
    ...PLAN,
    steps: [
      { title: 'Legendar', detail: '', ops: [{ type: 'captions', style: 'karaoke', position: 'bottom' }], layers: [] },
      { title: 'Título', detail: '', ops: [], layers: [hook] },
      { title: 'Música', detail: '', ops: [], layers: [], music: true },
    ],
  }, CTX, false);
  assertEquals(clean.steps.map((s) => s.title), ['Legendar']);
  assert(clean.not_possible[0].includes('render de motion'));
});

Deno.test('efeito em vídeo sem fala explica por que saiu', () => {
  const clean = sanitizePlan({
    ...PLAN, not_possible: [],
    steps: [{ title: 'Título', detail: '', ops: [{ type: 'title', items: [{ word_from: 0, word_to: 1, text: 'A', position: 'top' }] }], layers: [] }],
  }, { ...CTX, words: [] });
  assertEquals(clean.steps, []);
  assert(clean.not_possible[0].includes('precisa de fala'));
});

Deno.test('item que só normaliza o volume não vira promessa no plano', () => {
  const clean = sanitizePlan({ ...PLAN, steps: [{ title: 'Marca', detail: '', ops: [{ type: 'brand_watermark' }], layers: [] }] }, CTX);
  assertEquals(clean.steps, []);
});

Deno.test('sem render: regra de legenda não se contradiz e a tela recebe o aviso por campo', async () => {
  const w = world({ status: 'analyzing', analysis: { request: 't', words: WORDS, duration_s: 12, frames_from: 'a', has_audio: true, render_ready: false, sources: [] } });
  w.queue.push({ ...PLAN, not_possible: ['Sem título animado.'], steps: [{ title: 'Respiros', detail: '', ops: [{ type: 'trim_silences' }], layers: [] }] });
  await advanceEdit(w.io, w.row);
  assertEquals(w.row.analysis.draft?.needs_render, true);
  const system = String(w.asked[0].system);
  assert(!system.includes('Nunca use a operação captions'));
  assert(!system.includes('__CAPTIONS_RULE__'));
});

Deno.test('com render, a regra de legenda por motion continua', async () => {
  const w = world({ status: 'analyzing', analysis: { request: 't', words: WORDS, duration_s: 12, frames_from: 'a', has_audio: true, sources: [] } });
  w.queue.push(PLAN);
  await advanceEdit(w.io, w.row);
  assert(String(w.asked[0].system).includes('Nunca use a operação captions'));
});

Deno.test('fila do conector: reserva, desistência e validade', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  const at = '2026-10-30T11:00:00Z';
  assertEquals(requestState({}, at, now), 'free');
  assertEquals(requestState({ claim: { at: now - 60_000, attempts: 1 } }, at, now), 'claimed');
  assertEquals(requestState({ claim: { at: now - 11 * 60_000, attempts: 1 } }, at, now), 'free');
  assertEquals(requestState({ claim: { at: now - 11 * 60_000, attempts: 3 } }, at, now), 'gave_up');
  assertEquals(requestState({}, '2026-10-29T10:00:00Z', now), 'expired');
});

Deno.test('detalhe técnico não guarda URL assinada', () => {
  assertEquals(technicalDetail(new Error('curl https://x.co/a?token=1 falhou')), 'curl [url] falhou');
});

Deno.test('conector: conferência é da máquina, sem chamar a API do Claude', async () => {
  const w = world({ status: 'checking', analysis: { external: true, words: WORDS, duration_s: 12 }, plan: { ops: [] }, qa: { duration: 12, hasAudio: true, lufs: -14 },
    artifacts: { expected: { seconds: 12, segments: 1, speech: true }, motion: { call_id: 'c', submitted_at: 1, path: 'm.mp4' } } });
  await advanceEdit(w.io, w.row);
  assertEquals(w.row.status, 'ready');
  assertEquals(w.row.output_path, 'm.mp4');
  assertEquals(w.asked.length, 0);
});

Deno.test('conector: conferência reprovada falha sem custo de API', async () => {
  const w = world({ status: 'checking', analysis: { external: true, words: WORDS, duration_s: 12 }, plan: { ops: [] }, qa: { duration: 5, hasAudio: true, lufs: -14 },
    artifacts: { expected: { seconds: 12, segments: 1, speech: true } } });
  await advanceEdit(w.io, w.row);
  assertEquals(w.row.status, 'failed');
  assertEquals(w.asked.length, 0);
  assertEquals(w.edited, []);
});

Deno.test('falha guarda a causa técnica na linha', async () => {
  const w = world({ status: 'queued', analysis: { words: WORDS, duration_s: 12, has_audio: true }, plan: { ops: [] } });
  (w.io as unknown as { brand: () => Promise<never> }).brand = () => Promise.reject(new Error('causa real'));
  await advanceEdit(w.io, w.row);
  assertEquals(w.row.status, 'failed');
  assertEquals(w.row.artifacts.last_error, 'causa real');
});

Deno.test('sanitizePlan: legenda vai por motion, nunca por op, e o motivo aparece', () => {
  const clean = sanitizePlan({ ...PLAN, steps: [{ title: 'L', detail: '', ops: [{ type: 'captions' }], layers: [] }] }, CTX);
  assertEquals(clean.steps, []);
  assert(clean.not_possible.some((t) => t.includes('captions em layers')));
});

Deno.test('planOfSteps: tirar um item tira as operações dele', () => {
  const draft = { ...sanitizePlan(PLAN, CTX), sources: [], usd: 0, duration_after: 12 } as PlanDraft;
  const picked = planOfSteps(draft, [0]);
  assertEquals(picked.ops, []);
  assertEquals(picked.motion.layers.length, 1);
});

Deno.test('planOfSteps: mesma operação em dois itens soma, e a música sai com o item dela', () => {
  const step = (over: Partial<PlanDraft['steps'][number]>) => ({ title: 't', detail: 'd', ops: [], layers: [], music: false, ...over });
  const draft = {
    summary: '', not_possible: [], sources: [], usd: 0, duration_after: 12,
    steps: [
      step({ ops: [{ type: 'cut_words', word_idxs: [5, 1] }] }),
      step({ ops: [{ type: 'cut_words', word_idxs: [2] }] }),
      step({ music: true }),
    ],
  } as PlanDraft;
  assertEquals(planOfSteps(draft, [0, 1]), {
    ops: [{ type: 'cut_words', word_idxs: [1, 2, 5] }], motion: { layers: [], music: false },
  });
  assertEquals(planOfSteps(draft, [2]).motion.music, true);
});

Deno.test('sem nada para o worker: corte fica; sem corte, falha dizendo o motivo', async () => {
  const motion = { layers: [{ type: 'captions', position: 'bottom' }], music: false };
  const analysis = { words: WORDS, duration_s: 12, has_audio: true, captions_burned: true };
  const only = world({ analysis, plan: { ops: [], motion } as unknown as EditRow['plan'] });
  await advanceEdit(only.io, only.row);
  assertEquals(only.row.status, 'failed');
  assertEquals(only.row.error, 'A legenda já está no vídeo.');

  const cut = world({ analysis, plan: { ops: [{ type: 'cut_words', word_idxs: [2] }], motion } as unknown as EditRow['plan'] });
  await advanceEdit(cut.io, cut.row);
  await advanceEdit(cut.io, cut.row);
  assertEquals(cut.row.status, 'checking');
  assertEquals(cut.submitted, []);
});

Deno.test('rede instável no status do worker não derruba a edição', async () => {
  const w = world({ status: 'rendering', artifacts: { motion: { call_id: 'c', submitted_at: Date.now(), path: 'p' } } });
  (w.io as unknown as { workerStatus: () => Promise<never> }).workerStatus = () => Promise.reject(new Error('rede'));
  await advanceEdit(w.io, w.row);
  assertEquals(w.row.status, 'rendering');
  assertEquals(w.row.artifacts.motion?.poll_errors, 1);
});

Deno.test('vídeo mudo só com título passa na conferência', async () => {
  const w = world({ analysis: { words: [], duration_s: 12, has_audio: false }, plan: { ops: [], motion: { layers: [{ type: 'end_card', text: 'Siga', seconds: 3 }], music: false } } as unknown as EditRow['plan'] },
    { status: [{ status: 'ready', duration: 12, has_audio: false, lufs: null }] });
  await advanceEdit(w.io, w.row);
  await advanceEdit(w.io, w.row);
  await advanceEdit(w.io, w.row);
  assertEquals(w.row.status, 'ready');
});

Deno.test('pedido com análise reaproveitada: pesquisa, plano e custo, sem sandbox', async () => {
  const w = world({ status: 'analyzing', analysis: { request: 'título', words: WORDS, duration_s: 12, frames_from: 'antigo', has_audio: true } });
  w.queue.push({ queries: ['dado'] }, PLAN);
  assert(await advanceEdit(w.io, w.row));
  assertEquals(w.row.status, 'analyzing');
  assertEquals(w.row.analysis.sources?.length, 1);
  assert(await advanceEdit(w.io, w.row));
  assertEquals(w.row.status, 'suggested');
  assertEquals(w.row.analysis.draft?.steps.length, 2);
  assertEquals(w.row.analysis.draft?.sources.length, 1);
  assert(Number(w.row.cost_usd) > 0);
  const content = (w.asked[1].messages as { content: { type: string; text?: string }[] }[])[0].content;
  assert(content.some((c) => c.text?.includes('[0] OMS')));
});

Deno.test('só motion: vai ao worker sobre o original e fica pronto', async () => {
  const motion = { layers: [hook], music: false };
  const w = world({ analysis: { words: WORDS, duration_s: 12, has_audio: true }, plan: { ops: [], motion } as EditRow['plan'] }, { status: [{ status: 'running' }, READY] });
  await advanceEdit(w.io, w.row);
  assertEquals(w.row.status, 'rendering');
  const body = w.submitted[0] as { job_id: string; plan: { duration: number }; assets: { source_url: string }; upload_url: string; frame_upload_urls: string[] };
  assertEquals(body.job_id, ID);
  assertEquals(body.plan.duration, 12);
  assert(body.assets.source_url.endsWith('final.mp4'));
  assert(body.upload_url.endsWith(motionPath(ID)));
  assertEquals(body.frame_upload_urls.length, 4);
  await advanceEdit(w.io, w.row);
  assertEquals(w.row.status, 'rendering');
  await advanceEdit(w.io, w.row);
  assertEquals(w.row.status, 'checking');
  await advanceEdit(w.io, w.row);
  assertEquals(w.row.status, 'ready');
  assertEquals(w.row.output_path, motionPath(ID));
  assertEquals(w.edited, [motionPath(ID)]);
});

Deno.test('cortes + motion: ffmpeg primeiro, worker sobre o vídeo cortado e com tempos novos', async () => {
  const motion = { layers: [{ ...hook, word_from: 6, word_to: 7 }], music: false };
  const ops = [{ type: 'cut_words', word_idxs: [2, 3] }];
  const w = world({ analysis: { words: WORDS, duration_s: 12, has_audio: true }, plan: { ops, motion } as unknown as EditRow['plan'] }, { status: [READY] });
  await advanceEdit(w.io, w.row);
  assertEquals(w.row.status, 'rendering');
  assertEquals(w.submitted.length, 0);
  await advanceEdit(w.io, w.row);
  const body = w.submitted[0] as { assets: { source_url: string }; plan: { duration: number; layers: { start: number }[] } };
  assert(body.assets.source_url.endsWith(outputPath(ID)));
  assertEquals(body.plan.duration, 9.5);
  assert(body.plan.layers[0].start < 6, `início ${body.plan.layers[0].start} devia recuar com o corte`);
});

Deno.test('worker falhou: edição falha e o original fica intacto', async () => {
  const w = world({ status: 'rendering', artifacts: { motion: { call_id: 'c', submitted_at: Date.now(), path: 'p' } } }, { status: [{ status: 'failed', error: 'x' }] });
  assertEquals(await advanceEdit(w.io, w.row), false);
  assertEquals(w.row.status, 'failed');
  assertEquals(w.edited, []);
});

Deno.test('worker passou do prazo: falha em vez de esperar para sempre', async () => {
  const w = world({ status: 'rendering', artifacts: { motion: { call_id: 'c', submitted_at: 0, path: 'p' } } });
  await advanceEdit(w.io, w.row);
  assertEquals(w.row.status, 'failed');
});

Deno.test('edição nova sobre vídeo editado sabe que a legenda já foi queimada', () => {
  assertEquals(planHasCaptions({ ops: [{ type: 'captions' }] }), true);
  assertEquals(planHasCaptions({ motion: { layers: [{ type: 'captions' }] } }), true);
  assertEquals(planHasCaptions({ ops: [{ type: 'color' }] }), false);
  assertEquals(planHasCaptions(null), false);
});

Deno.test('dois títulos em itens diferentes entram os dois', () => {
  const title = (i: number, text: string) => ({ title: text, detail: '', ops: [{ type: 'title', items: [{ word_from: i, word_to: i + 1, text, position: 'top' }] }], layers: [] });
  const clean = sanitizePlan({ ...PLAN, not_possible: [], steps: [title(0, 'Um'), title(6, 'Dois')] }, CTX);
  const { ops } = planOfSteps({ ...clean, sources: [] } as unknown as PlanDraft, [0, 1]);
  const merged = ops.find((o) => o.type === 'title') as { items: { text: string }[] };
  assertEquals(merged.items.map((i) => i.text), ['Um', 'Dois']);
});

Deno.test('fonte escrita no plano não libera dado sem fonte real', () => {
  const clean = sanitizePlan({
    ...PLAN, not_possible: [],
    steps: [{ title: 'Dado', detail: '', ops: [{ type: 'fact_card', items: [{ word_from: 0, word_to: 1, value: '99%', label: 'inventado', source: 'inventado.com' }] }], layers: [] }],
  }, CTX);
  assertEquals(clean.steps, []);
  assert(clean.not_possible[0].includes('fonte'));
});

Deno.test('efeito que sai diz o motivo certo, mesmo com outro efeito no item', () => {
  const clean = sanitizePlan({
    ...PLAN, not_possible: [],
    steps: [
      { title: 'Cor e título', detail: '', ops: [{ type: 'color', preset: 'warm' }, { type: 'title', items: [{ word_from: 0, word_to: 1, text: 'A' }] }], layers: [] },
      { title: 'Fim', detail: '', ops: [{ type: 'brand_outro' }], layers: [] },
    ],
  }, { ...CTX, words: [] });
  assert(clean.not_possible.some((t) => t.includes('Cor e título') && t.includes('precisa de fala')));
  assert(clean.not_possible.some((t) => t.includes('Fim') && t.includes('logo')));
});

Deno.test('render em andamento segura o pedido além da reserva', () => {
  const at = Date.now() - 3_600_000;
  assertEquals(requestState({ claim: { at, attempts: 3, render_until: Date.now() + 1000 } }, new Date().toISOString()), 'claimed');
  assertEquals(requestState({ claim: { at, attempts: 3 } }, new Date().toISOString()), 'gave_up');
});

Deno.test('música do motion tira o music_duck do mesmo plano', () => {
  const step = { title: 'Música', detail: '', ops: [{ type: 'music_duck' as const }], layers: [], music: true };
  const { ops, motion } = planOfSteps({ summary: '', steps: [step], not_possible: [], sources: [], usd: 0, duration_after: 1 } as unknown as PlanDraft, [0]);
  assertEquals(ops, []);
  assertEquals(motion.music, true);
});
