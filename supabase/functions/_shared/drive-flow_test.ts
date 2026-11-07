// Simulação do fluxo inteiro com fetch falso: Google, storage e TUS em memória. O Drive
// falso segue o protocolo documentado (308 + Range, 256 KiB, status query, sessão 404),
// e os erros são injetados nos pontos onde o arquivo poderia se perder.

import { assert, assertEquals, assertFalse, assertRejects } from 'jsr:@std/assert@1';
import { createHash } from 'node:crypto';

import { accessToken, DriveDisconnected, type DriveConnection, type DriveIo, type DriveRow, type LastRun } from './drive-api.ts';
import { newRow, recordedSweep, runSweep } from './drive-archive.ts';
import { makeDriveIo } from './drive-io.ts';
import { buildInUse, classify, MIN_AGE_MS, RESTORE_CHUNK_BYTES, UPLOAD_CHUNK_BYTES, type InUse } from './drive-policy.ts';
import { ArchivedFileError, downloadRestoring, ensureLocal, restoreFile, signRestoring } from './drive-restore.ts';

const MIB = 1024 * 1024;
const DAY = 24 * 3600 * 1000;
const md5Of = (bytes: Uint8Array) => createHash('md5').update(bytes).digest('hex');

function randomBytes(size: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size);
  let x = size || 1;
  for (let i = 0; i < size; i += 4096) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x & 255;
    out[i + 1] = (x >> 8) & 255;
  }
  return out;
}

interface StoredFile {
  bytes: Uint8Array;
  mime: string;
  updatedAt: string;
  etag: string;
}

class World {
  clock = Date.parse('2026-10-30T12:00:00Z');
  objects = new Map<string, StoredFile>();
  rows = new Map<string, DriveRow & Record<string, unknown>>();
  drive = new Map<string, { bytes: Uint8Array; trashed: boolean; md5?: string; size?: number; name: string }>();
  sessions = new Map<string, { received: Uint8Array; used: number; total: number; name: string }>();
  tus = new Map<string, { key: string; total: number; received: Uint8Array; used: number; mime: string }>();
  conn: DriveConnection | null = { connected: true, email: 'dona@marca.com', permission_id: 'conta-1', access_token: 'tok', expires_at: this.clock + 3600_000, folders: {} };
  refresh: string | null = 'refresh-1';
  purge = true;
  inUseValue: InUse | Error = buildInUse({ values: [] });
  biggestPut = 0;
  tusChunks: number[] = [];
  removed: string[] = [];
  /** quantos bytes o Drive guarda de cada PUT; null = tudo */
  keepBytes: ((sent: number) => number) | null = null;
  failNextPatch = 0;
  corruptMd5 = false;
  refreshError: string | null = null;
  driveDown = false;
  removeNoop = false;
  lastRun: LastRun | null = null;
  blind = false;
  /** status fixo para todo PUT de bloco */
  putStatus: number | null = null;
  private seq = 0;

  put(bucket: string, path: string, bytes: Uint8Array, mime = 'video/mp4', ageDays = 10) {
    const updatedAt = new Date(this.clock - ageDays * DAY).toISOString();
    this.objects.set(`${bucket}/${path}`, { bytes, mime, updatedAt, etag: `"${md5Of(bytes).slice(0, 12)}-3"` });
  }

  row(path: string) {
    return [...this.rows.values()].find((r) => r.path === path)!;
  }

  respond(body: BodyInit | null, status = 200, headers: Record<string, string> = {}) {
    return new Response(status === 308 || status === 204 ? null : body, { status, headers });
  }

  json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  }

  ranged(bytes: Uint8Array, range: string | null) {
    const match = /bytes=(\d+)-(\d+)/.exec(range ?? '');
    if (!match) return new Response(bytes.slice(), { status: 200 });
    const end = Math.min(Number(match[2]) + 1, bytes.length);
    return new Response(bytes.slice(Number(match[1]), end), { status: 206 });
  }

  fetch: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);

    if (url.hostname === 'oauth2.googleapis.com') {
      if (this.refreshError) return this.json({ error: this.refreshError }, 400);
      return this.json({ access_token: `novo-${++this.seq}`, expires_in: 3600 });
    }

    if (url.hostname === 'storage.test') {
      const file = this.objects.get(decodeURIComponent(url.pathname.slice(6)));
      if (!file) return new Response('{}', { status: 404 });
      return this.ranged(file.bytes, headers.get('range'));
    }

    if (url.hostname === 'session.test') return this.session(url, init, headers);
    if (url.hostname === 'tus.test') return await this.tusRequest(url, method, init, headers);

    if (this.driveDown) return this.json({ error: 'fora' }, 503);

    if (url.pathname === '/upload/drive/v3/files') {
      const meta = JSON.parse(String(init.body));
      const id = `s${++this.seq}`;
      const total = Number(headers.get('x-upload-content-length'));
      this.sessions.set(id, { received: new Uint8Array(total), used: 0, total, name: meta.name });
      return new Response(null, { status: 200, headers: { location: `https://session.test/${id}` } });
    }
    if (url.pathname === '/drive/v3/files' && method === 'GET') return this.json({ files: [] });
    if (url.pathname === '/drive/v3/files' && method === 'POST') return this.json({ id: `pasta-${++this.seq}` });

    const id = /\/drive\/v3\/files\/([^/]+)/.exec(url.pathname)?.[1];
    const file = id ? this.drive.get(id) : undefined;
    if (id && !file) return this.json({ error: 'notFound' }, 404);
    if (id && file) {
      if (method === 'PATCH') {
        file.trashed = true;
        return this.json({ id });
      }
      if (url.searchParams.get('alt') === 'media') return this.ranged(file.bytes, headers.get('range'));
      return this.json({
        id,
        size: String(file.size ?? file.bytes.length),
        md5Checksum: file.md5 ?? (this.corruptMd5 ? 'd41d8cd98f00b204e9800998ecf8427e' : md5Of(file.bytes)),
        trashed: file.trashed,
        webViewLink: `https://drive.test/${id}`,
      });
    }
    throw new Error(`rota sem simulação: ${method} ${url}`);
  };

  private session(url: URL, init: RequestInit, headers: Headers): Response {
    const id = url.pathname.slice(1);
    const session = this.sessions.get(id);
    if (!session) return new Response(null, { status: 404 });
    const content = headers.get('content-range') ?? '';
    const finish = () => {
      const fileId = `f${++this.seq}`;
      this.drive.set(fileId, { bytes: session.received, trashed: false, name: session.name });
      this.sessions.delete(id);
      return this.json({ id: fileId }, 201);
    };
    if (content.startsWith('bytes */')) {
      if (session.used === session.total) return finish();
      return new Response(null, { status: 308, headers: session.used ? { range: `bytes=0-${session.used - 1}` } : {} });
    }
    if (this.putStatus) return new Response('{}', { status: this.putStatus });
    const start = Number(/bytes (\d+)-/.exec(content)?.[1]);
    const body = init.body as Uint8Array;
    this.biggestPut = Math.max(this.biggestPut, body.length);
    assertEquals(start, session.used, 'PUT fora de posição');
    const end = start + body.length;
    if (end < session.total) assertEquals(body.length % (256 * 1024), 0, 'bloco fora do múltiplo de 256 KiB');
    const keep = this.keepBytes ? this.keepBytes(body.length) : body.length;
    session.received.set(body.subarray(0, keep), start);
    session.used = start + keep;
    if (session.used === session.total) return finish();
    return new Response(null, { status: 308, headers: { range: `bytes=0-${session.used - 1}` } });
  }

  private async tusRequest(url: URL, method: string, init: RequestInit, headers: Headers): Promise<Response> {
    if (method === 'POST') {
      assertEquals(headers.get('tus-resumable'), '1.0.0');
      assertEquals(headers.get('x-upsert'), 'true');
      const meta = Object.fromEntries((headers.get('upload-metadata') ?? '').split(',').map((part) => {
        const [key, value] = part.split(' ');
        return [key, atob(value)];
      }));
      const id = `t${++this.seq}`;
      const total = Number(headers.get('upload-length'));
      this.tus.set(id, { key: `${meta.bucketName}/${meta.objectName}`, total, received: new Uint8Array(total), used: 0, mime: meta.contentType });
      return new Response(null, { status: 201, headers: { location: `https://tus.test/${id}` } });
    }
    const id = url.pathname.slice(1);
    const upload = this.tus.get(id);
    if (!upload) return new Response(null, { status: 404 });
    if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'upload-offset': String(upload.used) } });
    const body = init.body as Uint8Array;
    if (upload.used + body.length < upload.total) assertEquals(body.length, RESTORE_CHUNK_BYTES, 'TUS exige 6 MiB');
    this.tusChunks.push(body.length);
    assertEquals(Number(headers.get('upload-offset')), upload.used);
    upload.received.set(body, upload.used);
    upload.used += body.length;
    if (upload.used === upload.total) {
      this.objects.set(upload.key, {
        bytes: upload.received, mime: upload.mime, updatedAt: new Date(this.clock).toISOString(), etag: '"novo-2"',
      });
    }
    return new Response(null, { status: 204, headers: { 'upload-offset': String(upload.used) } });
  }

  io(): DriveIo {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- o dublê guarda o mundo do teste
    const world = this;
    const object = (bucket: string, path: string) => {
      const file = world.objects.get(`${bucket}/${path}`);
      return file ? { size: file.bytes.length, mime: file.mime, etag: file.etag, updatedAt: file.updatedAt } : null;
    };
    return {
      fetch: world.fetch,
      now: () => world.clock,
      sleep: () => { world.clock += 3000; return Promise.resolve(); },
      tusEndpoint: 'https://tus.test/novo',
      storageKey: 'chave',
      credentials: () => Promise.resolve({ clientId: 'id', clientSecret: 'segredo' }),
      refreshToken: () => Promise.resolve(world.refresh),
      storeRefreshToken: (value) => { world.refresh = value; return Promise.resolve(); },
      connection: () => Promise.resolve(world.conn),
      saveConnection: (next) => { world.conn = next; return Promise.resolve(); },
      purgeEnabled: () => Promise.resolve(world.purge),
      saveLastRun: (run) => { world.lastRun = run; return Promise.resolve(); },
      storageBlind: () => Promise.resolve(world.blind),
      row: (bucket, path) => Promise.resolve([...world.rows.values()].find((r) => r.bucket === bucket && r.path === path) ?? null),
      rowById: (id) => Promise.resolve(world.rows.get(id) ?? null),
      patchRow: (id, fields) => {
        if (world.failNextPatch > 0 && Number(fields.uploaded_bytes) > 0) {
          world.failNextPatch--;
          return Promise.reject(new Error('banco fora'));
        }
        Object.assign(world.rows.get(id)!, structuredClone(fields));
        return Promise.resolve();
      },
      claimRow: (id) => {
        const row = world.rows.get(id)!;
        if (row.claimed_at && world.clock - Date.parse(String(row.claimed_at)) < 180_000) return Promise.resolve(null);
        row.claimed_at = new Date(world.clock).toISOString();
        return Promise.resolve(structuredClone(row));
      },
      addRows: (rows) => {
        for (const row of rows) {
          const id = `r${++world.seq}`;
          world.rows.set(id, {
            id, kind: 'documento', md5: null, drive_file_id: null, drive_link: null, drive_account: null, drive_email: null, session_uri: null,
            uploaded_bytes: 0, hash_state: null, tus_url: null, last_used_at: null, restored_at: null, attempts: 0, next_try_at: new Date(0).toISOString(),
            claimed_at: null, ...row,
          } as DriveRow & Record<string, unknown>);
        }
        return Promise.resolve();
      },
      candidates: (limit) => {
        const out = [...world.objects.entries()]
          .filter(([key, file]) => key.startsWith('renders/') && file.bytes.length >= MIB && world.clock - Date.parse(file.updatedAt) > MIN_AGE_MS)
          .map(([key, file]) => {
            const path = key.slice('renders/'.length);
            const row = [...world.rows.values()].find((r) => r.path === path);
            return {
              row, bucket: 'renders', path, known: Boolean(row), size: file.bytes.length, mime: file.mime, etag: file.etag, updatedAt: file.updatedAt,
            };
          })
          .filter(({ row, updatedAt }) => !row || (['uploaded', 'purged', 'kept', 'gone'].includes(row.status) && row.source_updated_at !== updatedAt))
          .sort((a, b) => b.size - a.size)
          .slice(0, limit)
          .map(({ row: _row, ...item }) => item);
        return Promise.resolve(out);
      },
      dueForUpload: (limit) => Promise.resolve(
        [...world.rows.values()]
          .filter((r) => r.status === 'pending' && Date.parse(String(r.next_try_at)) <= world.clock)
          .sort((a, b) => b.size_bytes - a.size_bytes).slice(0, limit),
      ),
      dueForPurge: (limit) => Promise.resolve(
        [...world.rows.values()].filter((r) => r.status === 'uploaded' && Date.parse(String(r.next_try_at)) <= world.clock).slice(0, limit),
      ),
      object: (bucket, path) => Promise.resolve(object(bucket, path)),
      signRead: (bucket, path) => Promise.resolve(`https://storage.test/sign/${encodeURIComponent(`${bucket}/${path}`)}`),
      removeObject: (bucket, path) => {
        world.removed.push(path);
        if (!world.removeNoop) world.objects.delete(`${bucket}/${path}`);
        return Promise.resolve();
      },
      inUse: () => (world.inUseValue instanceof Error ? Promise.reject(world.inUseValue) : Promise.resolve(world.inUseValue)),
    };
  }

  /** Cliente do Supabase só com o que os helpers usam. */
  client() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- o dublê guarda o mundo do teste
    const world = this;
    return {
      storage: {
        from: (bucket: string) => ({
          createSignedUrl: (path: string) => Promise.resolve(
            world.objects.has(`${bucket}/${path}`)
              ? { data: { signedUrl: `https://storage.test/sign/${path}` }, error: null }
              : { data: null, error: { message: 'Object not found' } },
          ),
          download: (path: string) => {
            const file = world.objects.get(`${bucket}/${path}`);
            return Promise.resolve(file ? { data: new Blob([file.bytes.slice()]), error: null } : { data: null, error: { message: '{}' } });
          },
        }),
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    };
  }

  async sweepUntilQuiet(io: DriveIo, ticks = 30) {
    let last;
    for (let i = 0; i < ticks; i++) {
      this.clock += 60_000;
      last = await runSweep(io);
      const queued = [...this.rows.values()].some((r) => r.status === 'pending' && Date.parse(String(r.next_try_at)) <= this.clock);
      if (!last.bytes && !last.registered && !last.purged && !queued) break;
    }
    return last;
  }
}

const PATH = 'director/job-1/final.mp4';

Deno.test('ciclo: copia, confere, apaga, traz de volta e sai de novo sem reenviar', async () => {
  const world = new World();
  const io = world.io();
  const bytes = randomBytes(40 * MIB + 123);
  world.put('renders', PATH, bytes);

  await world.sweepUntilQuiet(io);
  const row = world.row(PATH);
  assertEquals(row.status, 'purged', String(row.last_error));
  assertFalse(world.objects.has(`renders/${PATH}`));
  assertEquals(row.md5, md5Of(bytes));
  const copy = world.drive.get(row.drive_file_id!)!;
  assertEquals(md5Of(copy.bytes), md5Of(bytes));
  assert(world.biggestPut <= UPLOAD_CHUNK_BYTES, 'nunca envia mais que um bloco');

  const url = await signRestoring(world.client(), 'renders', PATH, 3600, io);
  assert(url.startsWith('https://storage.test/'));
  assertEquals(md5Of(world.objects.get(`renders/${PATH}`)!.bytes), md5Of(bytes));
  assertEquals(world.row(PATH).status, 'uploaded');
  assert(world.tusChunks.every((size) => size <= RESTORE_CHUNK_BYTES));
  assertEquals(world.tusChunks.reduce((a, b) => a + b, 0), bytes.length);

  // devolvido: 6 dias depois ainda fica
  world.clock += 6 * DAY;
  await runSweep(io);
  assert(world.objects.has(`renders/${PATH}`));

  // passou de 7 dias sem uso: sai de novo, sem novo upload
  const files = world.drive.size;
  world.clock += 2 * DAY;
  await runSweep(io);
  assertEquals(world.row(PATH).status, 'purged');
  assertFalse(world.objects.has(`renders/${PATH}`));
  assertEquals(world.drive.size, files);
});

Deno.test('varredura repetida não duplica nada', async () => {
  const world = new World();
  const io = world.io();
  world.put('renders', PATH, randomBytes(3 * MIB));
  world.purge = false;
  await world.sweepUntilQuiet(io);
  await world.sweepUntilQuiet(io);
  assertEquals(world.drive.size, 1);
  assertEquals(world.rows.size, 1);
});

Deno.test('interruptor desligado: copia e confere, mas não apaga', async () => {
  const world = new World();
  const io = world.io();
  world.purge = false;
  world.put('renders', PATH, randomBytes(3 * MIB));
  await world.sweepUntilQuiet(io);
  assertEquals(world.row(PATH).status, 'uploaded');
  assert(world.objects.has(`renders/${PATH}`));
  assertEquals(world.removed, []);
});

Deno.test('maior primeiro; vídeo maior que uma execução continua nas seguintes', async () => {
  const world = new World();
  const io = world.io();
  world.purge = false;
  world.put('renders', 'pequeno.mp4', randomBytes(2 * MIB));
  world.put('renders', 'grande.mp4', randomBytes(300 * MIB));

  const first = await runSweep(io);
  assert(first.bytes <= 128 * MIB + UPLOAD_CHUNK_BYTES, `bytes ${first.bytes}`);
  assertEquals(world.row('grande.mp4').status, 'pending');
  assert(world.row('grande.mp4').hash_state, 'o hash fica no banco');
  assertEquals(world.row('pequeno.mp4').status, 'pending');

  await world.sweepUntilQuiet(io);
  assertEquals(world.row('grande.mp4').status, 'uploaded');
  assertEquals(world.row('pequeno.mp4').status, 'uploaded');
});

Deno.test('Drive guarda menos do que recebeu: o hash acompanha e o md5 fecha', async () => {
  const world = new World();
  const io = world.io();
  world.put('renders', PATH, randomBytes(40 * MIB));
  world.keepBytes = (sent) => (sent === UPLOAD_CHUNK_BYTES ? sent - 256 * 1024 : sent);
  world.purge = false;
  await world.sweepUntilQuiet(io);
  assertEquals(world.row(PATH).status, 'uploaded', String(world.row(PATH).last_error));
});

Deno.test('queda entre o PUT e o banco: retoma sem reenviar e o md5 fecha', async () => {
  const world = new World();
  const io = world.io();
  world.put('renders', PATH, randomBytes(40 * MIB));
  world.purge = false;
  world.failNextPatch = 1;
  await runSweep(io);
  const row = world.row(PATH);
  assert(row.last_error, 'a falha ficou registrada');
  world.clock += DAY;
  await world.sweepUntilQuiet(io);
  assertEquals(world.row(PATH).status, 'uploaded', String(world.row(PATH).last_error));
  assertEquals(world.drive.size, 1);
});

Deno.test('md5 diferente no Drive: nunca apaga, cópia vai para a lixeira e tenta depois', async () => {
  const world = new World();
  const io = world.io();
  world.put('renders', PATH, randomBytes(3 * MIB));
  world.corruptMd5 = true;
  await world.sweepUntilQuiet(io, 3);
  assert(world.objects.has(`renders/${PATH}`));
  assertEquals(world.removed, []);
  assertEquals(world.row(PATH).status, 'pending');
  assertEquals(world.row(PATH).last_error, 'md5 diferente.');
  assert([...world.drive.values()].every((file) => file.trashed));
});

Deno.test('copiado, mas Drive caiu na conferência final: não apaga', async () => {
  const world = new World();
  const io = world.io();
  world.purge = false;
  world.put('renders', PATH, randomBytes(3 * MIB));
  await world.sweepUntilQuiet(io);
  world.purge = true;
  world.driveDown = true;
  await runSweep(io);
  assert(world.objects.has(`renders/${PATH}`));
  assertEquals(world.removed, []);
  assertEquals(world.row(PATH).status, 'uploaded');
});

Deno.test('pessoa apagou a cópia antes da hora: envia de novo em vez de apagar', async () => {
  const world = new World();
  const io = world.io();
  world.purge = false;
  world.put('renders', PATH, randomBytes(3 * MIB));
  await world.sweepUntilQuiet(io);
  world.drive.delete(world.row(PATH).drive_file_id!);
  world.purge = true;
  await runSweep(io);
  assert(world.objects.has(`renders/${PATH}`));
  assertEquals(world.removed, []);
  assertEquals(world.row(PATH).status, 'uploaded', 'o mesmo tick já enviou de novo');
  assertEquals(world.drive.size, 1);
});

Deno.test('em uso: não apaga; lista de uso fora do ar: ninguém apaga', async () => {
  const world = new World();
  const io = world.io();
  world.put('renders', PATH, randomBytes(3 * MIB));
  world.inUseValue = buildInUse({ values: [{ final: PATH }] });
  await world.sweepUntilQuiet(io);
  await runSweep(io);
  assertEquals(world.row(PATH).status, 'uploaded');

  world.inUseValue = new Error('consulta falhou');
  await runSweep(io);
  assertEquals(world.row(PATH).status, 'uploaded');
  assertEquals(world.removed, []);

  world.inUseValue = buildInUse({ values: [] });
  world.clock += 7 * 3600_000;
  await runSweep(io);
  assertEquals(world.row(PATH).status, 'purged');
});

Deno.test('arquivo em uso não prende a fila dos menores', async () => {
  const world = new World();
  const io = world.io();
  for (let i = 0; i < 30; i++) world.put('renders', `grande-${i}.mp4`, randomBytes(4 * MIB));
  world.put('renders', 'menor.mp4', randomBytes(2 * MIB));
  world.inUseValue = { paths: new Set(), prefixes: ['grande-'] };
  await world.sweepUntilQuiet(io, 8);
  await runSweep(io);
  await runSweep(io);
  assertEquals(world.row('menor.mp4').status, 'purged');
  assertEquals(world.removed, ['menor.mp4']);
});

Deno.test('storage não confirma a remoção: fica uploaded, nada se perde', async () => {
  const world = new World();
  const io = world.io();
  world.removeNoop = true;
  world.put('renders', PATH, randomBytes(3 * MIB));
  await world.sweepUntilQuiet(io);
  await runSweep(io);
  assertEquals(world.row(PATH).status, 'uploaded');
  assertEquals(world.row(PATH).last_error, 'O storage não confirmou a remoção.');
});

Deno.test('render novo no mesmo caminho: cópia antiga sai e o ciclo recomeça', async () => {
  const world = new World();
  const io = world.io();
  world.purge = false;
  const before = randomBytes(3 * MIB);
  world.put('renders', PATH, before);
  await world.sweepUntilQuiet(io);
  const oldCopy = world.row(PATH).drive_file_id!;

  const after = randomBytes(5 * MIB);
  world.put('renders', PATH, after, 'video/mp4', 8);
  await world.sweepUntilQuiet(io);
  const row = world.row(PATH);
  assertEquals(row.status, 'uploaded');
  assertEquals(row.md5, md5Of(after));
  assert(world.drive.get(oldCopy)!.trashed);
});

Deno.test('objeto trocado no meio do upload: não mistura versões', async () => {
  const world = new World();
  const io = world.io();
  world.purge = false;
  world.put('renders', PATH, randomBytes(300 * MIB));
  await runSweep(io);
  assert(world.row(PATH).session_uri);
  const after = randomBytes(4 * MIB);
  world.put('renders', PATH, after, 'video/mp4', 8);
  await world.sweepUntilQuiet(io);
  assertEquals(world.row(PATH).status, 'uploaded', String(world.row(PATH).last_error));
  assertEquals(world.row(PATH).md5, md5Of(after));
});

Deno.test('sessão vencida (404): espera e recomeça sem erro', async () => {
  const world = new World();
  const io = world.io();
  world.purge = false;
  world.put('renders', PATH, randomBytes(300 * MIB));
  await runSweep(io);
  world.sessions.clear();
  await runSweep(io);
  assertEquals(world.row(PATH).session_uri, null);
  world.clock += 3600_000;
  await world.sweepUntilQuiet(io);
  assertEquals(world.row(PATH).status, 'uploaded', String(world.row(PATH).last_error));
});

Deno.test('sem Drive conectado: varredura não toca em nada e o produto segue local', async () => {
  const world = new World();
  world.conn = null;
  world.put('renders', PATH, randomBytes(3 * MIB));
  assertEquals((await runSweep(world.io())).skipped, 'sem_drive');
  assertEquals(world.rows.size, 0);
  assert(world.objects.has(`renders/${PATH}`));
});

Deno.test('depois de conectar, a varredura move o que já existia', async () => {
  const world = new World();
  const io = world.io();
  const saved = world.conn;
  world.conn = null;
  world.put('renders', PATH, randomBytes(3 * MIB));
  await runSweep(io);
  world.conn = saved;
  await world.sweepUntilQuiet(io);
  assertEquals(world.row(PATH).status, 'purged');
});

Deno.test('token: renova sozinho; revogado derruba a conexão e para a varredura', async () => {
  const world = new World();
  const io = world.io();
  world.conn!.expires_at = world.clock + 1000;
  assertEquals(await accessToken(io), 'novo-1');
  assertEquals(world.conn!.access_token, 'novo-1');

  world.conn!.expires_at = world.clock;
  world.refreshError = 'invalid_grant';
  await assertRejects(() => accessToken(io), DriveDisconnected);
  assertEquals(world.conn!.broken, true);
  assertEquals((await runSweep(io)).skipped, 'sem_drive');
});

Deno.test('token: conexão pelo hub renova sem chave do Google na instância', async () => {
  const world = new World();
  const pedidos: { url: string; corpo: Record<string, unknown> }[] = [];
  const io = {
    ...world.io(),
    credentials: () => Promise.resolve(null),
    hub: { url: 'https://hub.test/drive-hub', instancia: 'https://abcdefghijklmnopqrst.supabase.co' },
    fetch: (url: string | URL | Request, init?: RequestInit) => {
      pedidos.push({ url: String(url), corpo: JSON.parse(String(init?.body)) });
      return Promise.resolve(Response.json({ ok: true, status: 200, payload: { access_token: 'pelo-hub', expires_in: 3600 } }));
    },
  } as DriveIo;
  world.conn = { ...world.conn!, hub_token: 'tok', expires_at: world.clock };
  world.refresh = 'refresh-1';
  assertEquals(await accessToken(io), 'pelo-hub');
  assertEquals(pedidos[0].url, 'https://hub.test/drive-hub');
  assertEquals(pedidos[0].corpo.acao, 'renovar');
  assertEquals(pedidos[0].corpo.hub_token, 'tok');
  assertEquals(pedidos[0].corpo.refresh_token, 'refresh-1');
});

Deno.test('token: hub revogado derruba a conexão; hub fora do ar não', async () => {
  const world = new World();
  const conexao = { ...world.conn!, hub_token: 'tok', expires_at: world.clock };
  const com = (resposta: Response) => ({
    ...world.io(), credentials: () => Promise.resolve(null), hub: { url: 'https://hub.test', instancia: 'x' },
    fetch: () => Promise.resolve(resposta),
  }) as DriveIo;
  world.conn = { ...conexao };
  await assertRejects(() => accessToken(com(new Response('fora', { status: 503 }))));
  assertEquals(world.conn!.broken, undefined);
  await assertRejects(
    () => accessToken(com(Response.json({ ok: false, status: 400, payload: { error: 'invalid_grant' } }))),
    DriveDisconnected,
  );
  assertEquals(world.conn!.broken, true);
});

Deno.test('volta: fora do Drive, o erro original do storage continua', async () => {
  const world = new World();
  const error = await assertRejects(() => signRestoring(world.client(), 'renders', 'nada.mp4', 60, world.io()));
  assert(/not found/i.test((error as Error).message));
  await assertRejects(() => signRestoring(world.client(), 'brand-assets', 'logo.png', 60, world.io()));
});

Deno.test('volta: arquivo no storage nem consulta o registro', async () => {
  const world = new World();
  world.put('renders', PATH, randomBytes(MIB));
  const io = world.io();
  io.row = () => { throw new Error('não deveria consultar'); };
  assert(await signRestoring(world.client(), 'renders', PATH, 60, io));
});

async function archived(world: World, size = 3 * MIB) {
  const io = world.io();
  const bytes = randomBytes(size);
  world.put('renders', PATH, bytes);
  await world.sweepUntilQuiet(io);
  assertEquals(world.row(PATH).status, 'purged');
  return { io, bytes };
}

Deno.test('volta: sem Drive conectado, frase clara', async () => {
  const world = new World();
  const { io } = await archived(world);
  world.conn = { ...world.conn!, broken: true };
  const error = await assertRejects(() => signRestoring(world.client(), 'renders', PATH, 60, io), ArchivedFileError);
  assertEquals((error as ArchivedFileError).code, 'no_drive');
  assertEquals(world.row(PATH).status, 'purged', 'nada foi marcado como perdido');
});

Deno.test('volta: arquivo apagado ou na lixeira do Drive, frase clara', async () => {
  const world = new World();
  const { io } = await archived(world);
  const copy = world.row(PATH).drive_file_id!;
  world.drive.get(copy)!.trashed = true;
  const trashed = await assertRejects(() => downloadRestoring(world.client(), 'renders', PATH, io), ArchivedFileError);
  assertEquals((trashed as ArchivedFileError).code, 'trashed');
  world.drive.delete(copy);
  const missing = await assertRejects(() => ensureLocal(world.client(), 'renders', PATH, io), ArchivedFileError);
  assertEquals((missing as ArchivedFileError).code, 'missing');
});

Deno.test('volta: outra conta conectada não vira "arquivo apagado"', async () => {
  const world = new World();
  const { io } = await archived(world);
  world.conn = { ...world.conn!, permission_id: 'conta-2', email: 'outra@marca.com' };
  const error = await assertRejects(() => signRestoring(world.client(), 'renders', PATH, 60, io), ArchivedFileError);
  assertEquals((error as ArchivedFileError).code, 'wrong_account');
  assert(error.message.includes('dona@marca.com'));
});

Deno.test('volta: arquivo alterado no Drive não entra no lugar do original', async () => {
  const world = new World();
  const { io } = await archived(world);
  world.drive.get(world.row(PATH).drive_file_id!)!.md5 = 'd41d8cd98f00b204e9800998ecf8427e';
  const error = await assertRejects(() => signRestoring(world.client(), 'renders', PATH, 60, io), ArchivedFileError);
  assertEquals((error as ArchivedFileError).code, 'changed');
  assertFalse(world.objects.has(`renders/${PATH}`));
});

Deno.test('volta: vídeo grande continua na chamada seguinte, com o mesmo envio', async () => {
  const world = new World();
  const { io, bytes } = await archived(world, 40 * MIB);
  const slow = { ...io, now: () => { world.clock += 20_000; return world.clock; } };
  assertEquals(await restoreFile(slow, 'renders', PATH, { budgetMs: 60_000 }), 'restoring');
  assertFalse(world.objects.has(`renders/${PATH}`));
  const partial = world.tusChunks.length;
  assert(partial > 0);
  assertEquals(world.tus.size, 1);

  assertEquals(await restoreFile(io, 'renders', PATH), 'ready');
  assertEquals(world.tus.size, 1, 'retomou o mesmo envio');
  assertEquals(md5Of(world.objects.get(`renders/${PATH}`)!.bytes), md5Of(bytes));
  assertEquals(world.tusChunks.reduce((a, b) => a + b, 0), bytes.length, 'sem reenviar');
});

Deno.test('volta: dry run só informa e não traz', async () => {
  const world = new World();
  const { io } = await archived(world);
  assertEquals(await restoreFile(io, 'renders', PATH, { dryRun: true }), 'archived');
  assertFalse(world.objects.has(`renders/${PATH}`));
});

Deno.test('volta: duas chamadas juntas não abrem dois envios', async () => {
  const world = new World();
  const { io } = await archived(world, 12 * MIB);
  const [a, b] = await Promise.all([restoreFile(io, 'renders', PATH), restoreFile(io, 'renders', PATH)]);
  assertEquals([a, b].sort(), ['ready', 'ready']);
  assertEquals(world.tus.size, 1);
});

Deno.test('volta: job que espera recebe "restoring", sem falhar', async () => {
  const world = new World();
  const { io } = await archived(world, 40 * MIB);
  world.row(PATH).claimed_at = new Date(world.clock).toISOString();
  const waiting = { ...io, now: () => { world.clock += 30_000; return world.clock; } };
  const error = await assertRejects(() => signRestoring(world.client(), 'renders', PATH, 60, waiting), ArchivedFileError);
  assertEquals((error as ArchivedFileError).code, 'restoring');
});

Deno.test('classificação kept fica registrada e não volta à fila', async () => {
  const world = new World();
  const io = world.io();
  world.put('renders', 'thumbs/x.jpg', randomBytes(2 * MIB), 'image/jpeg');
  assertFalse(classify({ bucket: 'renders', path: 'thumbs/x.jpg', size: 2 * MIB }).archive);
  await runSweep(io);
  await runSweep(io);
  assertEquals(world.rows.size, 1);
  assertEquals(world.row('thumbs/x.jpg').status, 'kept');
  assertEquals(world.drive.size, 0);
});

/** Colunas not null de drive_files, lidas do SQL que vai para o banco. */
async function notNullColumns(): Promise<string[]> {
  const sql = await Deno.readTextFile(new URL('../../sql/google-drive.sql', import.meta.url));
  const table = sql.slice(sql.indexOf('create table if not exists public.drive_files'), sql.indexOf('unique (bucket, path)'));
  return [...table.matchAll(/^\s+(\w+) [^\n]*not null/gm)].map((match) => match[1]);
}

/**
 * Client que faz o que o PostgREST faz no upsert em lote: as colunas são a união das
 * chaves de todas as linhas e o que faltar em uma delas vira NULL, passando por cima
 * do default da tabela. O IO em memória escondia isso.
 */
function postgrestUpsert(required: string[], onRows: (rows: Record<string, unknown>[]) => void) {
  return {
    from: () => ({
      upsert: (rows: Record<string, unknown>[], options: { onConflict: string; ignoreDuplicates: boolean }) => {
        assertEquals(options, { onConflict: 'bucket,path', ignoreDuplicates: true });
        const columns = new Set(rows.flatMap((row) => Object.keys(row)));
        for (const row of rows) {
          for (const column of required) {
            if (columns.has(column) && (row[column] === undefined || row[column] === null)) {
              return Promise.resolve({ error: { message: `null value in column "${column}" violates not-null constraint` } });
            }
          }
          for (const key of columns) assert(key in row, `linha sem a coluna ${key}: virará NULL`);
        }
        onRows(rows);
        return Promise.resolve({ error: null });
      },
    }),
  };
}

Deno.test('upsert real: lote misturando kept e pending entra sem ferir not null', async () => {
  const world = new World();
  world.purge = false;
  const io = world.io();
  const captured: Record<string, unknown>[][] = [];
  const required = await notNullColumns();
  assert(required.includes('kind'), 'o teste precisa enxergar a coluna kind');
  const real = makeDriveIo(postgrestUpsert(required, (rows) => captured.push(rows)));
  const memory = io.addRows;
  io.addRows = async (rows) => {
    await real.addRows(rows);
    await memory(rows);
  };

  world.put('renders', 'thumbs/x.jpg', randomBytes(2 * MIB), 'image/jpeg');
  world.put('renders', 'director/assets/fonts/a.ttf', randomBytes(2 * MIB), 'font/ttf');
  world.put('renders', 'director/j/subs.ass', randomBytes(2 * MIB), 'text/plain');
  world.put('renders', PATH, randomBytes(3 * MIB));

  const report = await runSweep(io);
  assertEquals(report.errors, 0, report.error);
  assertEquals(captured[0].length, 4);
  assertEquals(world.row(PATH).status, 'uploaded');
  assertEquals(world.row('thumbs/x.jpg').status, 'kept');
  assertEquals(world.row('thumbs/x.jpg').kind, 'imagem');
  assertEquals(world.row('director/assets/fonts/a.ttf').kind, 'documento');
});

Deno.test('newRow: toda linha tem as mesmas chaves e kind nunca é nulo', () => {
  const base = { size: 2 * MIB, etag: null, updatedAt: '2026-01-01T00:00:00Z', known: false, bucket: 'renders' };
  const keep = newRow({ ...base, path: 'thumbs/a.bin', mime: null });
  const send = newRow({ ...base, path: 'a.mp4', mime: 'video/mp4' });
  assertEquals(Object.keys(keep).sort(), Object.keys(send).sort());
  assertEquals(keep.kind, 'documento');
  assertEquals(send.reason, null);
});

Deno.test('4xx persistente: backoff, sessão limpa e a fila segue para o próximo', async () => {
  const world = new World();
  const io = world.io();
  world.purge = false;
  world.put('renders', 'ruim.mp4', randomBytes(30 * MIB));
  world.put('renders', 'bom.mp4', randomBytes(3 * MIB));
  world.putStatus = 400;
  const first = await runSweep(io);
  assertEquals(first.error, 'O Drive recusou o envio (400).');
  const ruim = world.row('ruim.mp4');
  assertEquals(ruim.session_uri, null);
  assertEquals(ruim.attempts, 1);
  assert(Date.parse(String(ruim.next_try_at)) > world.clock, 'tem espera');
  assertEquals(world.row('bom.mp4').attempts, 1, 'o segundo também foi tentado na mesma rodada');

  world.putStatus = null;
  world.row('ruim.mp4').next_try_at = new Date(world.clock + 7 * DAY).toISOString();
  world.clock += 3600_000;
  await runSweep(io);
  assertEquals(world.row('bom.mp4').status, 'uploaded', 'o arquivo ruim não prende o outro');
  assertEquals(world.row('ruim.mp4').status, 'pending');
});

Deno.test('rodada fica registrada: contagens, erro e banco cego', async () => {
  const world = new World();
  const io = world.io();
  world.purge = false;
  world.put('renders', PATH, randomBytes(3 * MIB));
  await recordedSweep(io);
  assertEquals(world.lastRun?.uploaded, 1);
  assertEquals(world.lastRun?.error, null);
  assert(world.lastRun?.at);

  world.blind = true;
  world.objects.clear();
  await recordedSweep(io);
  assertEquals(world.lastRun?.storage_blind, true);

  const broken = { ...io, candidates: () => Promise.reject(new Error('rpc caiu')) };
  assertEquals(await recordedSweep(broken), null);
  assertEquals(world.lastRun?.error, 'rpc caiu');
});

Deno.test('volta: erro comum não vira espera; sai com frase e sem prender o job', async () => {
  const world = new World();
  const { io } = await archived(world, 12 * MIB);
  const failing = {
    ...io,
    fetch: ((input, init) => {
      if (String(input).startsWith('https://tus.test')) return Promise.resolve(new Response(null, { status: 500 }));
      return world.fetch(input, init);
    }) as typeof fetch,
  };
  const error = await assertRejects(() => signRestoring(world.client(), 'renders', PATH, 60, failing), ArchivedFileError);
  assertEquals((error as ArchivedFileError).code, 'failed');
  assertEquals(world.row(PATH).status, 'purged', 'dá para retomar');
  assertEquals(world.row(PATH).claimed_at, null);
  assert(await signRestoring(world.client(), 'renders', PATH, 60, io));
});
