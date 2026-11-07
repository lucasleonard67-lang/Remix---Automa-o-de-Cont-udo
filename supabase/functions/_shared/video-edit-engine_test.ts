// Ponta a ponta das fases: o shell, o ffmpeg, o curl e os uploads são reais (servidor
// HTTP local); só Claude e Scribe são simulados. Precisa de ffmpeg com libass no PATH:
//   VIDEO_EDIT_E2E=1 PATH=<ffmpeg com libass>:$PATH deno test -A _shared/video-edit-engine_test.ts
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { advanceEdit, EDIT_FAILED, QA_FAILED, type EditIo, type EditRow } from './video-edit-engine.ts';
import { pollCommand } from './video-edit.ts';

const e2e = Deno.env.get('VIDEO_EDIT_E2E') === '1';
const run = async (cmd: string, args: string[]) => {
  const out = await new Deno.Command(cmd, { args, stdout: 'piped', stderr: 'piped' }).output();
  return { ok: out.success, text: new TextDecoder().decode(out.stdout) + new TextDecoder().decode(out.stderr) };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const word = (text: string, start: number, end: number) => ({ type: 'word', text, start, end });
const WORDS = [
  word('um', 0.5, 1.2), word('dois', 1.2, 2), word('tres', 2.3, 3.2), word('quatro', 3.2, 4),
  word('cinco', 6, 7), word('seis', 7, 8), word('sete', 8.2, 9.2), word('oito', 9.2, 10.5),
];

async function fixture(dir: string) {
  const speech = 'between(t,0.5,2)+between(t,2.3,4)+between(t,6,8)+between(t,8.2,10.5)';
  const a = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=30:d=12',
    '-f', 'lavfi', '-i', 'sine=f=440:r=48000:d=12', '-filter_complex', `[1:a]volume='if(${speech},1,0)':eval=frame[a]`,
    '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', `${dir}/renders/source.mp4`]);
  assert(a.ok, a.text);
  const b = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
    'color=c=white:s=400x200,drawbox=x=50:y=50:w=300:h=100:color=0x223366:t=fill', '-frames:v', '1', `${dir}/brand/logo.png`]);
  assert(b.ok, b.text);
}

type Harness = { io: EditIo; rows: Map<string, EditRow>; claude: Record<string, unknown>[]; edited: string[]; stop: () => Promise<void> };

async function harness(dir: string, opts: {
  suggestions: unknown[]; qaReplies: Record<string, unknown>[]; failSandboxPolls?: number;
}): Promise<Harness> {
  const ac = new AbortController();
  const server = Deno.serve({ port: 0, signal: ac.signal, onListen: () => {} }, async (req) => {
    const path = `${dir}${new URL(req.url).pathname}`;
    if (req.method === 'PUT') {
      await Deno.mkdir(path.replace(/\/[^/]+$/, ''), { recursive: true });
      await Deno.writeFile(path, new Uint8Array(await req.arrayBuffer()));
      return new Response('{}');
    }
    try { return new Response(await Deno.readFile(path)); } catch { return new Response('x', { status: 404 }); }
  });
  const base = `http://127.0.0.1:${server.addr.port}`;
  const rows = new Map<string, EditRow>();
  const claude: Record<string, unknown>[] = [];
  const edited: string[] = [];
  const qa = [...opts.qaReplies];
  let n = 0;
  let pollFailures = opts.failSandboxPolls ?? 0;
  const io: EditIo = {
    patchEdit: (id, fields) => { rows.set(id, { ...rows.get(id)!, ...fields }); return Promise.resolve(); },
    brand: () => Promise.resolve({ primary: '#E4572E', accent: '#FFD400', logoPath: 'logo.png', handle: '@marca', font: null }),
    sourceContext: () => Promise.resolve({ objective: 'teste', captionsBurned: false }),
    sign: (path, o) => Promise.resolve(`${base}/${o?.bucket === 'brand' ? 'brand' : 'renders'}/${path}`),
    signUpload: (path) => Promise.resolve(`${base}/renders/${path}`),
    putObject: async (path, body) => {
      await Deno.mkdir(`${dir}/renders/${path}`.replace(/\/[^/]+$/, ''), { recursive: true });
      await Deno.writeFile(`${dir}/renders/${path}`, body);
    },
    getObject: (path) => Deno.readFile(`${dir}/renders/${path}`),
    fontUrls: () => Promise.resolve({}),
    sandbox: async (command, o) => {
      if (o.background) {
        const id = ++n, log = `${dir}/bg${id}.log`, exit = `${dir}/bg${id}.exit`;
        await Deno.writeTextFile(`${dir}/bg${id}.sh`, command);
        new Deno.Command('sh', { args: ['-c', `sh ${dir}/bg${id}.sh > ${log} 2>&1; echo $? > ${exit}.tmp; mv ${exit}.tmp ${exit}`] }).spawn();
        return `Started.\nCombined output: ${log}\nExit status (written when done): ${exit}\n`;
      }
      if (pollFailures-- > 0) throw new Error('rede instável');
      return (await run('sh', ['-c', command])).text;
    },
    stt: (audio) => {
      assert(audio.length > 1000, 'áudio real do sandbox');
      return Promise.resolve({ words: [...WORDS, { type: 'audio_event', text: '(respira)', start: 4, end: 5 }] });
    },
    modelo: (body) => {
      claude.push(body);
      const content = (body.messages as { content: { type: string; source?: { data: string } }[] }[])[0].content;
      const images = content.filter((c) => c.type === 'image');
      const reply = images.length === 8 ? { suggestions: opts.suggestions } : qa.shift();
      assert(reply, 'resposta do Claude simulado');
      for (const i of images) assert(atob(i.source!.data).startsWith('\xff\xd8'), 'quadro é JPEG');
      return Promise.resolve({
        stop_reason: 'end_turn', usage: { input_tokens: 2000, output_tokens: 500 },
        content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(reply) }],
      });
    },
    markEdited: (_e, path) => { edited.push(path); return Promise.resolve(); },
  };
  return { io, rows, claude, edited, stop: async () => { ac.abort(); await server.finished; } };
}

const newRow = (id: string): EditRow => ({
  id, source_kind: 'job', source_id: 'job-1', source_path: 'source.mp4', status: 'analyzing', analysis: {}, plan: null,
  artifacts: {}, output_path: null, qa: null, cost_usd: 0, error: null, auto: false,
});

async function until(h: Harness, id: string, stops: string[]) {
  for (let i = 0; i < 600; i++) {
    const row = h.rows.get(id)!;
    if (stops.includes(row.status)) return row;
    await advanceEdit(h.io, row);
    if (stops.includes(h.rows.get(id)!.status)) return h.rows.get(id)!;
    await sleep(100);
  }
  throw new Error(`parado em ${h.rows.get(id)!.status}`);
}

const SUGGESTIONS = [
  { id: 'clean', title: 'Cortar respiros', gain: 'menos pausa', why: 'Há pausas longas.', recommended: true, ops: [{ type: 'trim_silences', pad_ms: 80, min_gap_ms: 400 }] },
  { id: 'brand', title: 'Assinar com a marca', gain: 'logo e CTA', why: 'Fecha o vídeo.', recommended: true, ops: [{ type: 'brand_outro', seconds: 2, cta: 'Siga a gente' }, { type: 'brand_watermark', corner: 'tr', opacity: 0.7 }] },
  { id: 'hook', title: 'Inventar', gain: 'x', why: 'x', recommended: true, ops: [{ type: 'apagar_tudo' }] },
];
const QA_OK = { ok: true, issues: [], fixed_ops: [] };

async function withDir(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir();
  await Deno.mkdir(`${dir}/renders`); await Deno.mkdir(`${dir}/brand`);
  await fixture(dir);
  try { await fn(dir); } finally { await Deno.remove(dir, { recursive: true }); }
}

Deno.test({ name: 'e2e: analisa, aplica, renderiza e entrega sem tocar no original', ignore: !e2e, sanitizeResources: false, sanitizeOps: false, fn: () => withDir(async (dir) => {
  const h = await harness(dir, { suggestions: SUGGESTIONS, qaReplies: [QA_OK], failSandboxPolls: 2 });
  const before = await Deno.readFile(`${dir}/renders/source.mp4`);
  h.rows.set('e1', newRow('e1'));
  const row = await until(h, 'e1', ['suggested', 'failed']);
  assertEquals(row.status, 'suggested', row.error ?? '');
  const s = row.analysis.suggestions!;
  assertEquals(s.map((x) => x.id), ['clean', 'brand']); // a de operação inventada caiu
  assertEquals(row.analysis.words!.length, 8); // audio_event não vira palavra
  assert(s[0].gain.includes('s de vídeo') && s[0].preview.after.duration_s < 12);
  assert(row.cost_usd > 0);
  const body = h.claude[0];
  assertEquals(body.model, 'claude-sonnet-5-5');
  assert(!('tool_choice' in body));

  const ops = s.flatMap((x) => x.ops);
  await h.io.patchEdit('e1', { status: 'queued', plan: { ops, suggestion_ids: ['clean', 'brand'] } });
  const done = await until(h, 'e1', ['ready', 'failed']);
  assertEquals(done.status, 'ready', `${done.error} ${JSON.stringify(done.qa)}`);
  assertEquals(h.edited, ['edits/e1/out.mp4']);
  const out = `${dir}/renders/edits/e1/out.mp4`;
  const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'csv=p=0', out]);
  assert(probe.text.includes('video,1080,1920') && probe.text.includes('audio'), probe.text);
  const qa = done.qa as { duration: number; lufs: number; ok: boolean };
  assert(qa.ok);
  assert(Math.abs(qa.duration - 10.76) < 0.5, String(qa.duration));
  assert(qa.lufs >= -16 && qa.lufs <= -12, String(qa.lufs));
  assertEquals(await Deno.readFile(`${dir}/renders/source.mp4`), before);
  await h.stop();
}) });

Deno.test({ name: 'e2e: Claude reprova, corrige uma vez e entrega', ignore: !e2e, sanitizeResources: false, sanitizeOps: false, fn: () => withDir(async (dir) => {
  const fixed = [{ type: 'trim_silences', pad_ms: 120, min_gap_ms: 400 }];
  const h = await harness(dir, { suggestions: SUGGESTIONS, qaReplies: [{ ok: false, issues: ['corte seco'], fixed_ops: fixed }, QA_OK] });
  h.rows.set('e2', newRow('e2'));
  const row = await until(h, 'e2', ['suggested', 'failed']);
  await h.io.patchEdit('e2', { status: 'queued', plan: { ops: row.analysis.suggestions![0].ops } });
  const done = await until(h, 'e2', ['ready', 'failed']);
  assertEquals(done.status, 'ready', done.error ?? '');
  assertEquals(done.artifacts.attempt, 1);
  assertEquals(done.plan!.ops!.find((o) => o.type === 'trim_silences'), fixed[0] as never);
  await h.stop();
}) });

Deno.test({ name: 'e2e: reprovado de novo falha com aviso e não marca a peça', ignore: !e2e, sanitizeResources: false, sanitizeOps: false, fn: () => withDir(async (dir) => {
  const bad = { ok: false, issues: ['texto cortado'], fixed_ops: [{ type: 'trim_silences', pad_ms: 120, min_gap_ms: 400 }] };
  const h = await harness(dir, { suggestions: SUGGESTIONS, qaReplies: [bad, bad] });
  h.rows.set('e3', newRow('e3'));
  const row = await until(h, 'e3', ['suggested', 'failed']);
  await h.io.patchEdit('e3', { status: 'queued', plan: { ops: row.analysis.suggestions![0].ops } });
  const done = await until(h, 'e3', ['ready', 'failed']);
  assertEquals(done.status, 'failed');
  assertEquals(done.error, QA_FAILED);
  assertEquals(h.edited, []);
  await h.stop();
}) });

Deno.test({ name: 'e2e: ffmpeg falhando vira falha humana', ignore: !e2e, sanitizeResources: false, sanitizeOps: false, fn: () => withDir(async (dir) => {
  const h = await harness(dir, { suggestions: SUGGESTIONS, qaReplies: [] });
  h.rows.set('e4', newRow('e4'));
  const row = await until(h, 'e4', ['suggested', 'failed']);
  await Deno.remove(`${dir}/renders/source.mp4`);
  await h.io.patchEdit('e4', { status: 'queued', plan: { ops: row.analysis.suggestions![0].ops } });
  const done = await until(h, 'e4', ['ready', 'failed']);
  assertEquals(done.status, 'failed');
  assertEquals(done.error, EDIT_FAILED);
  await h.stop();
}) });

Deno.test('pollCommand lê o exit e o log', async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/l`, 'EDIT_OK\n');
  await Deno.writeTextFile(`${dir}/e`, '0\n');
  const text = (await run('sh', ['-c', pollCommand(`${dir}/l`, `${dir}/e`)])).text;
  assert(text.includes('EXITCODE:0') && text.includes('EDIT_OK'));
  await Deno.remove(dir, { recursive: true });
});
