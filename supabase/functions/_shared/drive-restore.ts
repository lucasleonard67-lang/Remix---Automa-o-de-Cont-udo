// _shared/drive-restore.ts — o helper central da volta sob demanda.
//
// Todo mundo que precisa de um arquivo do storage passa por aqui. O caminho comum não
// muda nem ganha consulta: tenta o storage primeiro. Só quando o arquivo não está lá é
// que olha o registro e traz do Drive para o MESMO bucket e path, em blocos (TUS), com
// o progresso no banco: um vídeo grande continua na chamada seguinte.
//
// Sem Drive conectado ou arquivo apagado pela pessoa, sai ArchivedFileError com a frase
// pronta. O job mostra a frase e pode ser retomado; nada é marcado como perdido.

import { downloadRange, DriveDisconnected, getFile, type DriveIo, type DriveRow } from './drive-api.ts';
import { mayBeArchived, RESTORE_CHUNK_BYTES } from './drive-policy.ts';
import { makeDriveIo } from './drive-io.ts';

export type ArchivedCode = 'restoring' | 'failed' | 'no_drive' | 'wrong_account' | 'missing' | 'trashed' | 'changed';

const MESSAGES: Record<Exclude<ArchivedCode, 'wrong_account'>, string> = {
  restoring: 'Trazendo o arquivo do Google Drive. Tente de novo em instantes.',
  failed: 'Não deu para trazer o arquivo do Google Drive agora. Tente de novo.',
  no_drive: 'Este arquivo está no Google Drive, e o Drive não está conectado. Conecte em Integrações e tente de novo.',
  missing: 'Este arquivo não está mais no seu Google Drive. Se ele foi apagado, não dá para recuperar por aqui.',
  trashed: 'Este arquivo está na lixeira do seu Google Drive. Restaure lá e tente de novo.',
  changed: 'Este arquivo mudou no seu Google Drive e não confere mais com o original.',
};

export class ArchivedFileError extends Error {
  constructor(readonly code: ArchivedCode, email?: string | null) {
    super(
      code === 'wrong_account'
        ? `Este arquivo está em outra conta do Google Drive${email ? ` (${email})` : ''}. Conecte essa conta em Integrações.`
        : MESSAGES[code],
    );
    this.name = 'ArchivedFileError';
  }
}

export type RestoreResult = 'absent' | 'archived' | 'ready' | 'restoring';

const DEFAULT_BUDGET_MS = 75_000;
const WAIT_STEP_MS = 3000;

function metadataHeader(row: DriveRow): string {
  const fields: Record<string, string> = {
    bucketName: row.bucket,
    objectName: row.path,
    contentType: row.mime_type ?? 'application/octet-stream',
    cacheControl: '3600',
  };
  const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
  return Object.entries(fields).map(([key, value]) => `${key} ${b64(value)}`).join(',');
}

function tusHeaders(io: DriveIo, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${io.storageKey}`,
    apikey: io.storageKey,
    'Tus-Resumable': '1.0.0',
    ...extra,
  };
}

async function openTus(io: DriveIo, row: DriveRow): Promise<string> {
  const r = await io.fetch(io.tusEndpoint, {
    method: 'POST',
    headers: tusHeaders(io, {
      'Upload-Length': String(row.size_bytes),
      'Upload-Metadata': metadataHeader(row),
      'x-upsert': 'true',
    }),
  });
  await r.body?.cancel();
  const location = r.headers.get('location');
  if (r.status !== 201 || !location) throw new Error(`storage abrir envio: ${r.status}`);
  await io.patchRow(row.id, { tus_url: location });
  return location;
}

/** Offset no servidor; null quando a URL do envio venceu (valem 24 h). */
async function tusOffset(io: DriveIo, url: string): Promise<number | null> {
  const r = await io.fetch(url, { method: 'HEAD', headers: tusHeaders(io) });
  await r.body?.cancel();
  if (r.status === 404 || r.status === 410) return null;
  const offset = Number(r.headers.get('upload-offset'));
  if (!r.ok || !Number.isFinite(offset)) throw new Error(`storage consultar envio: ${r.status}`);
  return offset;
}

async function pullFromDrive(io: DriveIo, row: DriveRow, until: number): Promise<boolean> {
  const known = row.tus_url ? await tusOffset(io, row.tus_url) : null;
  const url = known === null ? await openTus(io, row) : row.tus_url!;
  let offset = known ?? 0;
  while (offset < row.size_bytes) {
    if (io.now() >= until) return false;
    const chunk = await downloadRange(io, row.drive_file_id!, offset, Math.min(RESTORE_CHUNK_BYTES, row.size_bytes - offset));
    if (!chunk.length) throw new Error('O Drive devolveu um bloco vazio.');
    const r = await io.fetch(url, {
      method: 'PATCH',
      headers: tusHeaders(io, { 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': String(offset) }),
      body: chunk,
    });
    await r.body?.cancel();
    if (r.status === 409) {
      // outra execução andou com o envio: pergunta onde está
      offset = await tusOffset(io, url) ?? 0;
      continue;
    }
    const next = Number(r.headers.get('upload-offset'));
    if (r.status !== 204 || !Number.isFinite(next)) throw new Error(`storage enviar bloco: ${r.status}`);
    offset = next;
  }
  return true;
}

async function markRestored(io: DriveIo, row: DriveRow): Promise<void> {
  const local = await io.object(row.bucket, row.path);
  if (!local || local.size !== row.size_bytes) throw new Error('O arquivo devolvido não confere com o registro.');
  const now = new Date(io.now()).toISOString();
  await io.patchRow(row.id, {
    status: 'uploaded',
    tus_url: null,
    restored_at: now,
    last_used_at: now,
    source_etag: local.etag,
    source_updated_at: local.updatedAt,
    last_error: null,
    claimed_at: null,
  });
}

async function waitForOther(io: DriveIo, row: DriveRow, until: number): Promise<RestoreResult> {
  while (io.now() < until) {
    await io.sleep(WAIT_STEP_MS);
    const current = await io.rowById(row.id);
    if (current?.status === 'uploaded') return 'ready';
    if (!current?.drive_file_id) return 'absent';
  }
  return 'restoring';
}

/**
 * Devolve o arquivo ao storage. `absent` = não é arquivo nosso no Drive: quem chamou
 * mantém o erro original. `dryRun` só informa, para a tela não trazer vídeo por listar.
 */
export async function restoreFile(
  io: DriveIo,
  bucket: string,
  path: string,
  options: { budgetMs?: number; dryRun?: boolean } = {},
): Promise<RestoreResult> {
  // tabela ainda não criada ou banco fora: quem chamou fica com o erro original
  const row = await io.row(bucket, path).catch(() => null);
  if (!row?.drive_file_id || row.status === 'pending') return 'absent';
  if (await io.object(bucket, path)) {
    if (row.status !== 'uploaded') await markRestored(io, row);
    return 'ready';
  }
  if (options.dryRun) return 'archived';

  const conn = await io.connection();
  if (!conn?.connected || conn.broken) throw new ArchivedFileError('no_drive');
  if (row.drive_account && conn.permission_id && row.drive_account !== conn.permission_id) {
    throw new ArchivedFileError('wrong_account', row.drive_email);
  }

  const until = io.now() + (options.budgetMs ?? DEFAULT_BUDGET_MS);
  try {
    const file = await getFile(io, row.drive_file_id);
    if (!file) throw new ArchivedFileError('missing');
    if (file.trashed) throw new ArchivedFileError('trashed');
    if ((row.md5 && file.md5Checksum !== row.md5) || Number(file.size) !== row.size_bytes) {
      throw new ArchivedFileError('changed');
    }

    const claimed = await io.claimRow(row.id);
    if (!claimed) return await waitForOther(io, row, until);
    await io.patchRow(row.id, { status: 'restoring' });
    if (!(await pullFromDrive(io, claimed, until))) {
      await io.patchRow(row.id, { status: 'purged', claimed_at: null });
      return 'restoring';
    }
    await markRestored(io, claimed);
    return 'ready';
  } catch (err) {
    await io.patchRow(row.id, {
      status: 'purged',
      claimed_at: null,
      last_error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
    }).catch(() => {});
    if (err instanceof DriveDisconnected) throw new ArchivedFileError('no_drive');
    throw err;
  }
}

/** Acesso ao storage que os helpers usam. Mínimo, para o teste simular. */
interface StorageClient {
  storage: {
    from(bucket: string): {
      createSignedUrl(path: string, expiresIn: number): PromiseLike<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
      download(path: string): PromiseLike<{ data: Blob | null; error: { message: string } | null }>;
    };
  };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<unknown>;
}

async function bringBack(service: StorageClient, bucket: string, path: string, io?: DriveIo): Promise<boolean> {
  if (!mayBeArchived(bucket, path)) return false;
  // sem o SQL aplicado, ou sem registro, o erro original continua valendo
  const engine = io ?? makeDriveIo(service as never);
  // só `restoring` é espera. Erro comum sobe com frase pronta: o job falha e fica retomável
  const result = await restoreFile(engine, bucket, path).catch((err) => {
    if (err instanceof ArchivedFileError) throw err;
    console.error('[drive] restore:', err);
    throw new ArchivedFileError('failed');
  });
  if (result === 'restoring') throw new ArchivedFileError('restoring');
  return result === 'ready';
}

function touch(service: StorageClient, bucket: string, path: string): void {
  if (!mayBeArchived(bucket, path)) return;
  void Promise.resolve(service.rpc('google_drive_touch', { _bucket: bucket, _path: path })).catch(() => {});
}

/** `createSignedUrl` que traz o arquivo do Drive quando precisa. */
export async function signRestoring(
  service: unknown,
  bucket: string,
  path: string,
  expiresIn: number,
  io?: DriveIo,
): Promise<string> {
  const client = service as StorageClient;
  const first = await client.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (first.data?.signedUrl) {
    touch(client, bucket, path);
    return first.data.signedUrl;
  }
  if (await bringBack(client, bucket, path, io)) {
    const second = await client.storage.from(bucket).createSignedUrl(path, expiresIn);
    if (second.data?.signedUrl) return second.data.signedUrl;
  }
  throw new Error(`sign ${path}: ${first.error?.message}`);
}

/** `download` que traz o arquivo do Drive quando precisa. */
export async function downloadRestoring(service: unknown, bucket: string, path: string, io?: DriveIo): Promise<Blob> {
  const client = service as StorageClient;
  const first = await client.storage.from(bucket).download(path);
  if (first.data) {
    touch(client, bucket, path);
    return first.data;
  }
  if (await bringBack(client, bucket, path, io)) {
    const second = await client.storage.from(bucket).download(path);
    if (second.data) return second.data;
  }
  throw new Error(`download ${path}: ${first.error?.message ?? 'vazio'}`);
}

/** Para `copy`, que não aceita URL: garante o arquivo no storage antes. */
export async function ensureLocal(service: unknown, bucket: string, path: string, io?: DriveIo): Promise<void> {
  await signRestoring(service, bucket, path, 60, io);
}
