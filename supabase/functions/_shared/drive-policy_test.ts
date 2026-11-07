// Decisões puras do arquivamento: nenhuma chamada de rede.

import { assert, assertEquals } from 'jsr:@std/assert@1';

import {
  backoffMs, buildInUse, classify, decidePurge, driveName, isInUse, mayBeArchived, MIN_AGE_MS, nextOffset, plainMd5, UPLOAD_CHUNK_BYTES, verifyCopy,
  type PurgeInput,
} from './drive-policy.ts';

const MIB = 1024 * 1024;
const MD5 = '900150983cd24fb0d6963f7d28e17f72';

Deno.test('classify: renders vai do maior para o Drive; fonte, miniatura e pequeno ficam', () => {
  assertEquals(classify({ bucket: 'renders', path: 'director/j1/final.mp4', size: 80 * MIB }), { archive: true, kind: 'video' });
  assertEquals(classify({ bucket: 'renders', path: 'edits/e1/out.mp4', size: 2 * MIB, mime: 'video/mp4' }), { archive: true, kind: 'video' });
  assertEquals(classify({ bucket: 'renders', path: 'director/j1/tts.mp3', size: 3 * MIB }), { archive: true, kind: 'audio' });
  assertEquals(classify({ bucket: 'renders', path: 'p1/slide-1.png', size: 8 * MIB }), { archive: true, kind: 'imagem' });
  assert(!classify({ bucket: 'renders', path: 'p1/slide-1.png', size: 2 * MIB }).archive);
  assert(!classify({ bucket: 'renders', path: 'director/assets/fonts/Montserrat-ExtraBold.ttf', size: 9 * MIB }).archive);
  assert(!classify({ bucket: 'renders', path: 'thumbs/market/x.jpg', size: 9 * MIB }).archive);
  assert(!classify({ bucket: 'renders', path: 'director/j1/final.mp4', size: 400 * 1024 }).archive);
  assert(!classify({ bucket: 'renders', path: 'director/j1/subs.ass', size: 3 * MIB }).archive);
});

Deno.test('classify: brand-assets fica inteiro e bucket desconhecido não sai', () => {
  assert(!classify({ bucket: 'brand-assets', path: 'avatars/a1/ref-1.jpg', size: 30 * MIB }).archive);
  assert(!classify({ bucket: 'brand-assets', path: 'voices/v1/sample.wav', size: 30 * MIB }).archive);
  assert(!classify({ bucket: 'brand-assets', path: 'logos/logo.png', size: 30 * MIB }).archive);
  assert(!classify({ bucket: 'outro', path: 'x.mp4', size: 30 * MIB }).archive);
});

Deno.test('classify: no Acervo só o original grande vai', () => {
  assertEquals(classify({ bucket: 'context-files', path: 'u1/1-aula.pdf', size: 20 * MIB }), { archive: true, kind: 'documento' });
  assert(!classify({ bucket: 'context-files', path: 'u1/1-nota.pdf', size: MIB }).archive);
});

Deno.test('mayBeArchived: o front não pergunta pelo que nunca sai', () => {
  assert(mayBeArchived('renders', 'director/j1/final.mp4'));
  assert(!mayBeArchived('brand-assets', 'logos/logo.png'));
  assert(!mayBeArchived('renders', 'director/assets/fonts/a.ttf'));
  assert(!mayBeArchived('renders', 'thumbs/a.jpg'));
});

Deno.test('verifyCopy: tamanho e md5 têm de bater; o resto reprova', () => {
  const expected = { size: 100, md5: MD5 };
  assertEquals(verifyCopy(expected, { id: '1', size: '100', md5Checksum: MD5 }), { ok: true });
  assertEquals(verifyCopy(expected, { id: '1', size: '100', md5Checksum: MD5.toUpperCase() }), { ok: true });
  assert(!verifyCopy(expected, null).ok);
  assert(!verifyCopy(expected, { id: '1', size: '100', md5Checksum: MD5, trashed: true }).ok);
  assert(!verifyCopy(expected, { id: '1', size: '99', md5Checksum: MD5 }).ok);
  assert(!verifyCopy(expected, { id: '1', size: '100' }).ok);
  assert(!verifyCopy(expected, { id: '1', md5Checksum: MD5 }).ok);
  assert(!verifyCopy(expected, { id: '1', size: '100', md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e' }).ok);
  assert(!verifyCopy({ size: 100, md5: null }, { id: '1', size: '100', md5Checksum: MD5 }).ok);
});

Deno.test('verifyCopy: ETag de parte única confere; de multipart é ignorado', () => {
  assertEquals(plainMd5(`"${MD5}"`), MD5);
  assertEquals(plainMd5('"abc123-4"'), null);
  const drive = { id: '1', size: 100, md5Checksum: MD5 };
  assert(verifyCopy({ size: 100, md5: MD5, etag: `"${MD5}"` }, drive).ok);
  assert(verifyCopy({ size: 100, md5: MD5, etag: '"abc-3"' }, drive).ok);
  assert(!verifyCopy({ size: 100, md5: MD5, etag: '"d41d8cd98f00b204e9800998ecf8427e"' }, drive).ok);
});

function input(overrides: Partial<PurgeInput> = {}, row: Partial<PurgeInput['row']> = {}): PurgeInput {
  const now = Date.parse('2026-10-30T12:00:00Z');
  const old = new Date(now - MIN_AGE_MS - 1000).toISOString();
  return {
    now,
    enabled: true,
    row: {
      status: 'uploaded', md5: MD5, size_bytes: 100, source_updated_at: old, last_used_at: null, restored_at: null, drive_account: 'conta-1',
      ...row,
    },
    local: { size: 100, etag: null, updatedAt: old },
    drive: { id: 'f', size: '100', md5Checksum: MD5 },
    account: 'conta-1',
    inUse: false,
    ...overrides,
  };
}

const reasonOf = (i: PurgeInput) => {
  const decision = decidePurge(i);
  return decision.purge ? 'apaga' : decision.reason;
};

Deno.test('decidePurge: só apaga com tudo certo', () => {
  assertEquals(reasonOf(input()), 'apaga');
});

Deno.test('decidePurge: cada trava sozinha impede', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  const recent = new Date(now - 1000).toISOString();
  assertEquals(reasonOf(input({ enabled: false })), 'desligado');
  assertEquals(reasonOf(input({ inUse: true })), 'em_uso');
  assertEquals(reasonOf(input({ local: null })), 'sem_arquivo');
  assertEquals(reasonOf(input({ drive: null })), 'copia');
  assertEquals(reasonOf(input({ drive: { id: 'f', size: '100', md5Checksum: MD5, trashed: true } })), 'copia');
  assertEquals(reasonOf(input({ drive: { id: 'f', size: '99', md5Checksum: MD5 } })), 'copia');
  assertEquals(reasonOf(input({ account: 'conta-2' })), 'conta');
  assertEquals(reasonOf(input({}, { status: 'pending' })), 'estado');
  assertEquals(reasonOf(input({}, { last_used_at: recent })), 'novo');
  assertEquals(reasonOf(input({}, { restored_at: recent })), 'novo');
  assertEquals(reasonOf(input({ local: { size: 100, etag: null, updatedAt: recent } })), 'mudou');
  assertEquals(reasonOf(input({ local: { size: 101, etag: null, updatedAt: input().local!.updatedAt } })), 'mudou');
});

Deno.test('decidePurge: exatamente 7 dias ainda não sai; precisa ser mais', () => {
  const base = input();
  const at = new Date(base.now - MIN_AGE_MS).toISOString();
  assertEquals(reasonOf(input({ local: { size: 100, etag: null, updatedAt: at } }, { source_updated_at: at })), 'novo');
});

Deno.test('em uso: acha caminhos em qualquer campo e por prefixo do job', () => {
  const inUse = buildInUse({
    values: [{ artifacts: { final: 'director/j1/final.mp4', scenes: [{ video: 'edits/e/out.mp4' }], thumb: 'storage:thumbs/a.jpg' } }],
    prefixes: ['director/j2/'],
  });
  assert(isInUse(inUse, 'director/j1/final.mp4'));
  assert(isInUse(inUse, 'edits/e/out.mp4'));
  assert(isInUse(inUse, 'thumbs/a.jpg'));
  assert(isInUse(inUse, 'director/j2/cena.mp4'));
  assert(!isInUse(inUse, 'director/j3/final.mp4'));
});

Deno.test('protocolo: bloco múltiplo de 256 KiB, Range do 308, espera e nome', () => {
  assertEquals(UPLOAD_CHUNK_BYTES % (256 * 1024), 0);
  assertEquals(nextOffset('bytes=0-524287'), 524288);
  assertEquals(nextOffset(null), 0);
  assertEquals(backoffMs(1), 300_000);
  assertEquals(backoffMs(2), 600_000);
  assertEquals(backoffMs(30), 6 * 3600_000);
  assertEquals(driveName('director/j1/final.mp4'), 'director_j1_final.mp4');
});
