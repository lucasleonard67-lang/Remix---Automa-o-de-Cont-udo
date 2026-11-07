// _shared/drive-archive.ts — a varredura: copia para o Drive, confere e só então apaga.
//
// Idempotente e retomável. Cada linha de drive_files anda sozinha: sessão do Drive,
// bytes confirmados e estado do MD5 ficam no banco, então um vídeo maior que o limite
// de uma execução continua no tick seguinte. Nada é lido inteiro para a memória.
//
// Ordem de cada execução: registra o que é novo → apaga o que já pode sair → envia,
// do maior para o menor. Falha em qualquer ponto nunca apaga.

import { Md5 } from './md5.ts';
import {
  accessToken, DriveDisconnected, folderFor, getFile, readRange, startUpload, trashFile, uploadChunk, uploadStatus,
  type Candidate, type DriveIo, type DriveRow, type LastRun, type StoredObject,
} from './drive-api.ts';
import {
  backoffMs, classify, decidePurge, driveName, isInUse, kindOf, MAX_FILES_PER_RUN, MAX_PURGES_PER_RUN, RECHECK_MS, RUN_BUDGET_MS, RUN_MAX_BYTES,
  UPLOAD_CHUNK_BYTES, verifyCopy, type InUse,
} from './drive-policy.ts';

const CANDIDATES_PER_RUN = 100;

export interface SweepReport {
  registered: number;
  purged: number;
  uploaded: number;
  bytes: number;
  errors: number;
  skipped?: string;
  /** a última falha da rodada, para a tela */
  error?: string;
  /** nenhum candidato porque o banco não enxerga o storage */
  storage_blind?: boolean;
}

interface Budget {
  until: number;
  bytesLeft: number;
}

const FRESH_UPLOAD = { session_uri: null, uploaded_bytes: 0, hash_state: null };

/** O arquivo mudou no storage: a cópia antiga perde o sentido e o ciclo recomeça. */
async function restartRow(io: DriveIo, row: DriveRow, local: StoredObject, error: string | null = null): Promise<void> {
  if (row.drive_file_id) await trashFile(io, row.drive_file_id).catch(() => {});
  const verdict = classify({ bucket: row.bucket, path: row.path, size: local.size, mime: local.mime });
  await io.patchRow(row.id, {
    ...FRESH_UPLOAD,
    status: verdict.archive ? 'pending' : 'kept',
    reason: verdict.archive ? null : verdict.reason,
    kind: verdict.archive ? verdict.kind : row.kind,
    size_bytes: local.size,
    mime_type: local.mime,
    source_etag: local.etag,
    source_updated_at: local.updatedAt,
    md5: null,
    drive_file_id: null,
    drive_link: null,
    drive_account: null,
    drive_email: null,
    archived_at: null,
    purged_at: null,
    last_error: error,
    claimed_at: null,
  });
}

/**
 * Linha completa para drive_files. Todas as linhas têm as mesmas colunas: o upsert em
 * lote do PostgREST grava NULL no que faltar em uma delas, e `kind` é not null.
 */
export function newRow(item: Candidate): Partial<DriveRow> & { reason: string | null } {
  const verdict = classify({ bucket: item.bucket, path: item.path, size: item.size, mime: item.mime });
  return {
    bucket: item.bucket,
    path: item.path,
    status: verdict.archive ? 'pending' : 'kept',
    kind: verdict.archive ? verdict.kind : kindOf(item.path, item.mime) ?? 'documento',
    reason: verdict.archive ? null : verdict.reason,
    size_bytes: item.size,
    mime_type: item.mime,
    source_etag: item.etag,
    source_updated_at: item.updatedAt,
  };
}

/** Linha nova para o que apareceu; mudança no storage recomeça o que já existia. */
async function register(io: DriveIo): Promise<{ registered: number; seen: number }> {
  const candidates = await io.candidates(CANDIDATES_PER_RUN);
  const fresh: Partial<DriveRow>[] = [];
  for (const item of candidates) {
    if (item.known) {
      const row = await io.row(item.bucket, item.path);
      if (row) await restartRow(io, row, item);
      continue;
    }
    fresh.push(newRow(item));
  }
  if (fresh.length) await io.addRows(fresh);
  return { registered: fresh.length, seen: candidates.length };
}

type Note = (message: string) => void;

async function finishUpload(io: DriveIo, row: DriveRow, md5: Md5, fileId: string, local: StoredObject, note: Note): Promise<boolean> {
  const file = await getFile(io, fileId);
  const check = verifyCopy({ size: local.size, md5: md5.digest(), etag: local.etag }, file);
  if (!check.ok) {
    await trashFile(io, fileId).catch(() => {});
    await failRow(io, row, check.reason, FRESH_UPLOAD);
    note(check.reason);
    return false;
  }
  const conn = await io.connection();
  await io.patchRow(row.id, {
    ...FRESH_UPLOAD,
    status: 'uploaded',
    md5: md5.digest(),
    drive_file_id: fileId,
    drive_link: file?.webViewLink ?? null,
    drive_account: conn?.permission_id ?? null,
    drive_email: conn?.email ?? null,
    archived_at: new Date(io.now()).toISOString(),
    attempts: 0,
    last_error: null,
    claimed_at: null,
  });
  return true;
}

async function failRow(io: DriveIo, row: DriveRow, message: string, extra: Record<string, unknown> = {}): Promise<void> {
  const attempts = row.attempts + 1;
  await io.patchRow(row.id, {
    ...extra,
    attempts,
    last_error: message.slice(0, 300),
    next_try_at: new Date(io.now() + backoffMs(attempts)).toISOString(),
    claimed_at: null,
  });
}

/**
 * Envia o que couber no orçamento. O hash só anda sobre bytes que o Drive CONFIRMOU:
 * se ele guardou menos do que recebeu, o estado não fica à frente do arquivo.
 */
async function uploadStep(io: DriveIo, row: DriveRow, budget: Budget, note: Note): Promise<'done' | 'more' | 'stop'> {
  const local = await io.object(row.bucket, row.path);
  if (!local) {
    await io.patchRow(row.id, { ...FRESH_UPLOAD, status: 'gone', claimed_at: null });
    return 'stop';
  }
  if (Date.parse(local.updatedAt) !== Date.parse(row.source_updated_at ?? '') || local.size !== row.size_bytes) {
    await restartRow(io, row, local);
    return 'stop';
  }

  const total = local.size;
  let session = row.session_uri;
  if (!session) {
    session = await startUpload(io, {
      name: driveName(row.path),
      description: `Content Engine · ${row.bucket}/${row.path}`,
      parent: await folderFor(io, row.kind),
      mime: local.mime ?? 'application/octet-stream',
      size: total,
    });
    await io.patchRow(row.id, { ...FRESH_UPLOAD, session_uri: session });
  }

  const md5 = row.session_uri ? Md5.from(row.hash_state) : new Md5();
  const url = await io.signRead(row.bucket, row.path);
  let remote = row.session_uri ? await uploadStatus(io, session, total) : { state: 'partial' as const, offset: 0 };

  while (true) {
    // sessão vencida, ou o Drive voltou atrás do que o hash já contou: recomeça limpo
    // depois da espera, para um arquivo problemático não prender a fila dos outros
    if (remote.state === 'expired' || (remote.state === 'partial' && remote.offset < md5.length)) {
      await failRow(io, row, 'Sessão de envio do Drive vencida.', FRESH_UPLOAD);
      return 'stop';
    }
    if (remote.state === 'rejected') {
      const message = `O Drive recusou o envio (${remote.status}).`;
      await failRow(io, row, message, FRESH_UPLOAD);
      note(message);
      return 'stop';
    }

    // caiu entre o PUT e a gravação no banco: lê de novo só para alcançar o hash
    const confirmed = remote.state === 'done' ? total : remote.offset;
    while (md5.length < confirmed) {
      if (budget.bytesLeft <= 0 || io.now() >= budget.until) return await pause(io, row, md5);
      const length = Math.min(UPLOAD_CHUNK_BYTES, confirmed - md5.length);
      const piece = await readRange(io.fetch, url, md5.length, length);
      if (!piece.length) throw new Error('Leitura do storage voltou vazia.');
      md5.update(piece);
      budget.bytesLeft -= piece.length;
    }
    if (remote.state === 'done') {
      return await finishUpload(io, row, md5, remote.fileId, local, note) ? 'done' : 'stop';
    }
    await io.patchRow(row.id, { uploaded_bytes: remote.offset, hash_state: md5.snapshot() });
    if (budget.bytesLeft <= 0 || io.now() >= budget.until) return await pause(io, row, md5);

    const chunk = await readRange(io.fetch, url, remote.offset, Math.min(UPLOAD_CHUNK_BYTES, total - remote.offset));
    if (!chunk.length) throw new Error('Leitura do storage voltou vazia.');
    budget.bytesLeft -= chunk.length;
    const offset = remote.offset;
    remote = await uploadChunk(io, session, chunk, offset, total);
    if (remote.state === 'partial') {
      md5.update(chunk.subarray(0, Math.max(remote.offset - offset, 0)));
    } else if (remote.state === 'done') {
      md5.update(chunk);
    }
  }
}

async function pause(io: DriveIo, row: DriveRow, md5: Md5): Promise<'more'> {
  await io.patchRow(row.id, { hash_state: md5.snapshot(), claimed_at: null });
  return 'more';
}

async function purgeOne(io: DriveIo, row: DriveRow, inUse: InUse, account: string | null): Promise<boolean> {
  const file = row.drive_file_id ? await getFile(io, row.drive_file_id) : null;
  const local = await io.object(row.bucket, row.path);

  if (!local) {
    // saiu do storage e a gravação falhou, ou o app apagou: a cópia confere, registra
    const check = verifyCopy({ size: row.size_bytes, md5: row.md5 }, file);
    if (check.ok) await io.patchRow(row.id, { status: 'purged', claimed_at: null });
    else await failRow(io, row, check.reason);
    return false;
  }

  const decision = decidePurge({
    now: io.now(),
    enabled: true,
    row,
    local,
    drive: file,
    account,
    inUse: isInUse(inUse, row.path),
  });
  if (!decision.purge) {
    if (decision.reason === 'mudou') await restartRow(io, row, local);
    // o arquivo ainda está no storage: sem cópia válida, é só enviar de novo
    else if (decision.reason === 'copia' && (!file || file.trashed)) await restartRow(io, row, local, decision.detail ?? null);
    else if (decision.reason === 'copia' || decision.reason === 'conta') await failRow(io, row, decision.detail ?? 'Cópia em outra conta do Drive.');
    else await io.patchRow(row.id, { claimed_at: null, next_try_at: new Date(io.now() + RECHECK_MS).toISOString() });
    return false;
  }
  await io.removeObject(row.bucket, row.path);
  // sem confirmar a remoção, a linha continua 'uploaded' e tenta no próximo tick
  if (await io.object(row.bucket, row.path)) {
    await failRow(io, row, 'O storage não confirmou a remoção.');
    return false;
  }
  await io.patchRow(row.id, { status: 'purged', purged_at: new Date(io.now()).toISOString(), last_error: null, claimed_at: null });
  return true;
}

/** Tick da varredura. Sem Drive conectado, sai sem tocar em nada. */
export async function runSweep(io: DriveIo, limits: { budgetMs?: number; maxBytes?: number } = {}): Promise<SweepReport> {
  const report: SweepReport = { registered: 0, purged: 0, uploaded: 0, bytes: 0, errors: 0 };
  const conn = await io.connection();
  if (!conn?.connected || conn.broken) return { ...report, skipped: 'sem_drive' };

  const maxBytes = limits.maxBytes ?? RUN_MAX_BYTES;
  const budget: Budget = { until: io.now() + (limits.budgetMs ?? RUN_BUDGET_MS), bytesLeft: maxBytes };
  const note: Note = (message) => {
    report.errors++;
    report.error = message.slice(0, 300);
  };

  try {
    await accessToken(io);
    const { registered, seen } = await register(io);
    report.registered = registered;
    if (!seen && (await io.storageBlind().catch(() => false))) report.storage_blind = true;

    if (await io.purgeEnabled()) {
      // lista de uso indisponível: nesta execução ninguém sai do storage
      const inUse = await io.inUse().catch((err) => {
        console.error('[drive] lista de uso falhou; sem apagar:', err);
        return null;
      });
      if (inUse) {
        for (const due of await io.dueForPurge(MAX_PURGES_PER_RUN)) {
          if (io.now() >= budget.until) break;
          const row = await io.claimRow(due.id);
          if (!row || row.status !== 'uploaded') continue;
          try {
            if (await purgeOne(io, row, inUse, conn.permission_id ?? null)) report.purged++;
          } catch (err) {
            if (err instanceof DriveDisconnected) throw err;
            note(err instanceof Error ? err.message : String(err));
            await failRow(io, row, err instanceof Error ? err.message : String(err));
          }
        }
      }
    }

    let files = 0;
    while (files < MAX_FILES_PER_RUN && budget.bytesLeft > 0 && io.now() < budget.until) {
      const [due] = await io.dueForUpload(1);
      if (!due) break;
      const row = await io.claimRow(due.id);
      files++;
      // outra execução está com o primeiro da fila: ela segue, esta sai
      if (!row) break;
      if (row.status !== 'pending') continue;
      try {
        const step = await uploadStep(io, row, budget, note);
        if (step === 'done') report.uploaded++;
        // continua no próximo tick: a mesma linha seria a primeira da fila de novo
        if (step === 'more') break;
      } catch (err) {
        if (err instanceof DriveDisconnected) throw err;
        note(err instanceof Error ? err.message : String(err));
        await failRow(io, row, err instanceof Error ? err.message : String(err));
      }
    }
  } catch (err) {
    if (!(err instanceof DriveDisconnected)) throw err;
    return { ...report, bytes: maxBytes - budget.bytesLeft, skipped: 'sem_drive' };
  }
  return { ...report, bytes: maxBytes - budget.bytesLeft };
}

/** Roda e deixa registrado, com sucesso ou erro: a tela não fica no escuro. */
export async function recordedSweep(io: DriveIo): Promise<SweepReport | null> {
  const at = new Date(io.now()).toISOString();
  try {
    const report = await runSweep(io);
    const run: LastRun = { at, ...report, error: report.error ?? null };
    await io.saveLastRun(run).catch((err) => console.error('[drive] registrar rodada:', err));
    return report;
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    console.error('[drive] varredura:', error);
    await io.saveLastRun({ at, error }).catch(() => {});
    return null;
  }
}
