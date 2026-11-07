// A trava de geração e o mapa dos pontos de entrada. Este teste lê o código das
// functions: ação nova sem classificar, ou ponto que perdeu a trava, reprova.

import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';

import {
  COVERED_FUNCTIONS, driveRequired, DRIVE_REQUIRED, EXEMPT_FUNCTIONS, FREE_ACTIONS, gatedAction, GATED_ENTRY_POINTS, requireDrive, type GatedFunction,
} from './drive-gate.ts';

const service = (result: { data: unknown; error: { message: string } | null } | Error) => ({
  rpc: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)),
});

Deno.test('driveRequired: só o banco dizendo true bloqueia', async () => {
  assert(await driveRequired(service({ data: true, error: null })));
  assertFalse(await driveRequired(service({ data: false, error: null })));
  // SQL ainda não aplicado ou banco fora: o produto não para
  assertFalse(await driveRequired(service({ data: null, error: { message: 'function does not exist' } })));
  assertFalse(await driveRequired(service(new Error('rede'))));
});

Deno.test('requireDrive: devolve 412 drive_required com a integração', async () => {
  const response = await requireDrive(service({ data: true, error: null }), 'generate-content');
  assertEquals(response?.status, 412);
  const body = await response!.json();
  assertEquals(body.error.code, DRIVE_REQUIRED);
  assertEquals(body.error.details, { integration: 'google_drive' });
});

Deno.test('requireDrive: sem a configuração do Google, ou conectado, não bloqueia', async () => {
  assertEquals(await requireDrive(service({ data: false, error: null }), 'generate-image'), null);
});

Deno.test('requireDrive: ação que não gera nunca consulta nem bloqueia', async () => {
  let asked = false;
  const spy = { rpc: () => { asked = true; return Promise.resolve({ data: true, error: null }); } };
  assertEquals(await requireDrive(spy, 'video-edit', 'status'), null);
  assertEquals(await requireDrive(spy, 'video-edit', 'revert'), null);
  assertFalse(asked);
  assert((await requireDrive(spy, 'video-edit', 'apply')) !== null);
});

Deno.test('gatedAction: ver, publicar e terminar seguem livres', () => {
  assert(gatedAction('generate-image'));
  assert(gatedAction('generate-video', 'start_production'));
  assertFalse(gatedAction('generate-video', 'approve_keyframes'));
  assertFalse(gatedAction('generate-video', 'assemble'));
  assertFalse(gatedAction('video-edit', 'external_deliver'));
  assertFalse(gatedAction('video-remake', 'scene_undo'));
  assert(gatedAction('mcp-server', 'gerar_conteudo'));
  assertFalse(gatedAction('mcp-server', 'video_ver'));
});

const source = (fn: string) => Deno.readTextFile(new URL(`../${fn}/index.ts`, import.meta.url));

/** Rótulos do primeiro `switch (<alvo>)`, por casamento de chaves. */
function switchLabels(code: string, target: string): string[] {
  const start = code.indexOf(`switch (${target})`);
  assert(start >= 0, `switch (${target}) não encontrado`);
  const open = code.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    if (code[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  return [...code.slice(open, end).matchAll(/case '([a-z_]+)'/g)].map((m) => m[1]);
}

const SWITCHES: Record<string, string> = {
  'generate-video': 'action',
  'video-edit': 'body.action',
  'avatar-studio': 'action',
  'mcp-server': 'nome',
};

Deno.test('mapa: toda ação das functions está classificada', async () => {
  for (const [fn, target] of Object.entries(SWITCHES)) {
    const rule = GATED_ENTRY_POINTS[fn as GatedFunction] as readonly string[];
    const known = new Set([...rule, ...FREE_ACTIONS[fn]]);
    for (const label of switchLabels(await source(fn), target)) {
      assert(known.has(label), `${fn}: ação '${label}' sem classificar em drive-gate.ts`);
    }
  }
});

Deno.test('mapa: nenhuma ação está nos dois lados', () => {
  for (const [fn, free] of Object.entries(FREE_ACTIONS)) {
    for (const action of free) assertFalse(gatedAction(fn as GatedFunction, action), `${fn}: ${action}`);
  }
});

Deno.test('mapa: cada ação existe mesmo no código da function', async () => {
  for (const [fn, rule] of Object.entries(GATED_ENTRY_POINTS)) {
    if (rule === '*') continue;
    const code = await source(fn);
    for (const action of rule) assert(code.includes(`'${action}'`), `${fn}: '${action}' sumiu do código`);
  }
});

Deno.test('cobertura: todo ponto de entrada chama a trava antes do trabalho', async () => {
  for (const fn of Object.keys(GATED_ENTRY_POINTS)) {
    const code = await source(fn);
    const call = fn === 'mcp-server' ? `gatedAction('mcp-server', nome)` : `requireDrive(`;
    assert(code.includes(call), `${fn}: sem trava`);
  }
});

Deno.test('cobertura: a trava vem antes do custo', async () => {
  const before = (code: string, a: string, b: string) => code.indexOf(a) >= 0 && code.indexOf(a) < code.indexOf(b);
  assert(before(await source('generate-content'), 'requireDrive(createServiceClient()', 'enforceRateLimit(user.id'));
  assert(before(await source('regenerate-piece'), 'requireDrive(createServiceClient()', 'enforceRateLimit(user.id'));
  assert(before(await source('video-brief'), 'requireDrive(createServiceClient()', 'enforceRateLimit(user.id'));
  assert(before(await source('video-edit'), `requireDrive(service, 'video-edit'`, `case 'suggest'`));
  assert(before(await source('avatar-studio'), `requireDrive(service, 'avatar-studio'`, `case 'create':`));
});

Deno.test('cobertura: automáticos pulam sem Drive', async () => {
  assert((await source('automation-tick')).includes('await driveRequired(service)'));
  assert(/sweepAuto[\s\S]*?driveRequired\(service\)/.test(await source('video-edit')));
});

Deno.test('cobertura: insert direto em director_jobs é barrado por trigger', async () => {
  const sql = await Deno.readTextFile(new URL('../../sql/google-drive.sql', import.meta.url));
  assert(/before insert on public\.director_jobs/.test(sql));
  assert(sql.includes(`raise exception '${DRIVE_REQUIRED}'`));
});

Deno.test('regra no banco: sem client id e secret não bloqueia; conexão caída bloqueia', async () => {
  const sql = await Deno.readTextFile(new URL('../../sql/google-drive.sql', import.meta.url));
  const body = sql.slice(sql.indexOf('function public.google_drive_required()'), sql.indexOf('revoke all on function public.google_drive_required()'));
  assert(body.includes(`get_vault_secret('GOOGLE_CLIENT_ID')`));
  assert(body.includes(`get_vault_secret('GOOGLE_CLIENT_SECRET')`));
  assert(body.includes('return false'));
  assert(body.includes(`conexao ->> 'broken'`));
});

Deno.test('cobertura: function nova sem decisão na trava reprova', async () => {
  const covered = new Set(COVERED_FUNCTIONS);
  for await (const entry of Deno.readDir(new URL('../', import.meta.url))) {
    if (!entry.isDirectory || entry.name === '_shared') continue;
    assert(covered.has(entry.name), `${entry.name}: decida em drive-gate.ts se gera mídia`);
  }
});

Deno.test('isentas têm motivo e não constam da trava', () => {
  for (const [fn, reason] of Object.entries(EXEMPT_FUNCTIONS)) {
    assert(reason.length > 0);
    assertFalse(fn in GATED_ENTRY_POINTS, fn);
  }
});

Deno.test('director-advance: job e edição de cena esperam a volta do Drive sem falhar', async () => {
  const code = await source('director-advance');
  const waits = code.match(/err\.code === 'restoring'\) return \{ advanced: 0, job: job\.id, waiting: 'drive' \}/g) ?? [];
  assertEquals(waits.length, 2);
  const copy = code.indexOf('copy(st.result_path, target)');
  assert(code.lastIndexOf('ensureLocal(service, BUCKET, st.result_path)', copy) > 0);
});

Deno.test('automation-tick: cota cumprida não grava skipped', async () => {
  const code = await source('automation-tick');
  const gate = code.indexOf('await driveRequired(service)');
  assert(code.indexOf('geradasHoje(service, gatilho.id)', gate) > gate);
});

Deno.test('google-drive: start só de admin; com arquivo só no Drive não revoga', async () => {
  const code = await source('google-drive');
  assert(/case 'start':[\s\S]{0,260}if \(!isAdmin\) return errorResponse\(403/.test(code));
  assert(code.includes('onlyInDrive > 0 ? false'));
});
