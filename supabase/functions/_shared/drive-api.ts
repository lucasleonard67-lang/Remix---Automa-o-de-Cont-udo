// _shared/drive-api.ts — conversa com o Google. Só HTTP; o `fetch` vem de fora para o
// teste simular o Google inteiro. Tudo o que lê ou grava estado passa por DriveIo.

import type { Md5State } from './md5.ts';
import { FOLDER_LABEL, nextOffset, ROOT_FOLDER, type DriveFileMeta, type DriveKind, type InUse } from './drive-policy.ts';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FILE_FIELDS = 'id,size,md5Checksum,trashed,webViewLink';

/** Guardado em director_state, chave google_drive. O refresh token fica no Vault. */
export interface DriveConnection {
  connected: boolean;
  broken?: boolean;
  email?: string | null;
  permission_id?: string | null;
  access_token?: string | null;
  expires_at?: number | null;
  /** id das pastas: `root` e uma por tipo */
  folders?: Partial<Record<DriveKind | 'root', string>>;
  connected_at?: string;
  /** Credencial no hub central. Sem ela, a conexão é das antigas e renova direto. */
  hub_token?: string | null;
}

export type DriveRowStatus = 'pending' | 'uploaded' | 'purged' | 'restoring' | 'kept' | 'gone';

export interface DriveRow {
  id: string;
  bucket: string;
  path: string;
  kind: DriveKind;
  status: DriveRowStatus;
  size_bytes: number;
  mime_type: string | null;
  md5: string | null;
  source_etag: string | null;
  source_updated_at: string | null;
  drive_file_id: string | null;
  drive_link: string | null;
  drive_account: string | null;
  drive_email: string | null;
  session_uri: string | null;
  uploaded_bytes: number;
  hash_state: Md5State | null;
  tus_url: string | null;
  last_used_at: string | null;
  restored_at: string | null;
  attempts: number;
}

export interface StoredObject {
  size: number;
  mime: string | null;
  etag: string | null;
  updatedAt: string;
}

export interface Candidate extends StoredObject {
  bucket: string;
  path: string;
  known: boolean;
}

/** Tudo o que o motor precisa do mundo. makeDriveIo liga no Supabase; o teste, em memória. */
export interface DriveIo {
  fetch: typeof fetch;
  now(): number;
  sleep(ms: number): Promise<void>;
  credentials(): Promise<{ clientId: string; clientSecret: string } | null>;
  /** Hub central e o endereço desta instância. */
  hub?: { url: string; instancia: string };
  refreshToken(): Promise<string | null>;
  storeRefreshToken(value: string): Promise<void>;
  connection(): Promise<DriveConnection | null>;
  saveConnection(next: DriveConnection | null): Promise<void>;
  purgeEnabled(): Promise<boolean>;
  saveLastRun(run: LastRun): Promise<void>;
  /** O banco não vê nenhum objeto, mas o storage tem arquivos: permissão, não vazio. */
  storageBlind(): Promise<boolean>;
  row(bucket: string, path: string): Promise<DriveRow | null>;
  rowById(id: string): Promise<DriveRow | null>;
  patchRow(id: string, fields: Partial<Record<keyof DriveRow | string, unknown>>): Promise<void>;
  /** Reserva por lease; null se outra execução está com a linha. */
  claimRow(id: string): Promise<DriveRow | null>;
  addRows(rows: Partial<DriveRow>[]): Promise<void>;
  candidates(limit: number): Promise<Candidate[]>;
  dueForUpload(limit: number): Promise<DriveRow[]>;
  dueForPurge(limit: number): Promise<DriveRow[]>;
  object(bucket: string, path: string): Promise<StoredObject | null>;
  signRead(bucket: string, path: string): Promise<string>;
  removeObject(bucket: string, path: string): Promise<void>;
  /** Paths em uso. Erro aqui cancela os apagamentos da execução. */
  inUse(): Promise<InUse>;
  tusEndpoint: string;
  storageKey: string;
}

/** Resultado da última varredura, em director_state. É o que o modal mostra. */
export interface LastRun {
  at: string;
  registered?: number;
  purged?: number;
  uploaded?: number;
  bytes?: number;
  errors?: number;
  skipped?: string;
  error?: string | null;
  storage_blind?: boolean;
}

/** Sem conexão utilizável: revogada, expirada ou nunca feita. */
export class DriveDisconnected extends Error {
  constructor() {
    super('Google Drive não conectado.');
    this.name = 'DriveDisconnected';
  }
}

export async function revokeToken(io: Pick<DriveIo, 'fetch'>, token: string): Promise<boolean> {
  const r = await io.fetch(REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  });
  await r.body?.cancel();
  return r.ok;
}

export async function exchangeCode(
  io: Pick<DriveIo, 'fetch'>,
  input: { code: string; verifier: string; redirectUri: string; clientId: string; clientSecret: string },
): Promise<{ ok: boolean; status: number; payload: Record<string, unknown> }> {
  const r = await io.fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code_verifier: input.verifier,
    }),
  });
  return { ok: r.ok, status: r.status, payload: await r.json().catch(() => ({})) };
}

export interface TokenRenovado {
  ok: boolean;
  status: number;
  payload: { access_token?: string; expires_in?: number; error?: string };
}

export async function refreshDirect(
  io: Pick<DriveIo, 'fetch'>,
  creds: { clientId: string; clientSecret: string },
  refresh: string,
): Promise<TokenRenovado> {
  const r = await io.fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }),
  });
  return { ok: r.ok, status: r.status, payload: await r.json().catch(() => ({})) };
}

/** O hub guarda a chave do Google: a instância manda o refresh token e recebe o acesso. */
async function refreshPeloHub(io: DriveIo, hubToken: string, refresh: string): Promise<TokenRenovado> {
  if (!io.hub) throw new Error('renovar token do Drive: hub não configurado');
  const r = await io.fetch(io.hub.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ acao: 'renovar', instancia: io.hub.instancia, hub_token: hubToken, refresh_token: refresh }),
  });
  if (!r.ok) {
    await r.body?.cancel();
    return { ok: false, status: r.status, payload: {} };
  }
  return await r.json() as TokenRenovado;
}

/** Access token válido; renova sozinho. `invalid_grant` derruba a conexão: bloqueia gerar. */
export async function accessToken(io: DriveIo, force = false): Promise<string> {
  const conn = await io.connection();
  if (!conn?.connected || conn.broken) throw new DriveDisconnected();
  if (!force && conn.access_token && (conn.expires_at ?? 0) - io.now() > 60_000) return conn.access_token;

  const refresh = await io.refreshToken();
  if (!refresh) throw new DriveDisconnected();
  let renovado: TokenRenovado;
  if (conn.hub_token) {
    renovado = await refreshPeloHub(io, conn.hub_token, refresh);
  } else {
    const creds = await io.credentials();
    if (!creds) throw new DriveDisconnected();
    renovado = await refreshDirect(io, creds, refresh);
  }
  const { payload } = renovado;
  if (payload.error === 'invalid_grant' || payload.error === 'unauthorized_client') {
    await io.saveConnection({ ...conn, broken: true, access_token: null, expires_at: null });
    throw new DriveDisconnected();
  }
  if (!renovado.ok || !payload.access_token) throw new Error(`renovar token do Drive: ${renovado.status}`);
  await io.saveConnection({
    ...conn,
    access_token: payload.access_token,
    expires_at: io.now() + (payload.expires_in ?? 3600) * 1000,
  });
  return payload.access_token;
}

/** Chamada autenticada. 401 renova e tenta uma vez. */
async function driveFetch(io: DriveIo, url: string, init: RequestInit = {}): Promise<Response> {
  const call = async (token: string) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return await io.fetch(url, { ...init, headers });
  };
  const first = await call(await accessToken(io));
  if (first.status !== 401) return first;
  await first.body?.cancel();
  return await call(await accessToken(io, true));
}

export async function aboutUser(io: DriveIo): Promise<{ email: string | null; permissionId: string | null }> {
  const r = await driveFetch(io, `${DRIVE_API}/about?fields=user(emailAddress,permissionId)`);
  if (!r.ok) throw new Error(`Drive about: ${r.status}`);
  const data = await r.json() as { user?: { emailAddress?: string; permissionId?: string } };
  return { email: data.user?.emailAddress ?? null, permissionId: data.user?.permissionId ?? null };
}

/** null = o arquivo não existe para esta conta (apagado, ou de outra conta). */
export async function getFile(io: DriveIo, id: string): Promise<DriveFileMeta | null> {
  const r = await driveFetch(io, `${DRIVE_API}/files/${encodeURIComponent(id)}?fields=${FILE_FIELDS}`);
  if (r.status === 404) {
    await r.body?.cancel();
    return null;
  }
  if (!r.ok) throw new Error(`Drive files.get: ${r.status}`);
  return await r.json() as DriveFileMeta;
}

/** Lixeira, não exclusão: cópia que não serve mais ainda pode ser recuperada pela pessoa. */
export async function trashFile(io: DriveIo, id: string): Promise<void> {
  const r = await driveFetch(io, `${DRIVE_API}/files/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
  await r.body?.cancel();
}

async function findFolder(io: DriveIo, name: string, parent: string | null): Promise<string | null> {
  const clauses = [`name = '${name}'`, `mimeType = '${FOLDER_MIME}'`, 'trashed = false'];
  if (parent) clauses.push(`'${parent}' in parents`);
  const r = await driveFetch(io, `${DRIVE_API}/files?q=${encodeURIComponent(clauses.join(' and '))}&fields=files(id)&pageSize=1`);
  if (!r.ok) throw new Error(`Drive files.list: ${r.status}`);
  const data = await r.json() as { files?: { id: string }[] };
  return data.files?.[0]?.id ?? null;
}

async function createFolder(io: DriveIo, name: string, parent: string | null): Promise<string> {
  const r = await driveFetch(io, `${DRIVE_API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parent ? { parents: [parent] } : {}) }),
  });
  if (!r.ok) throw new Error(`Drive criar pasta: ${r.status}`);
  return (await r.json() as { id: string }).id;
}

/** Pasta "Content Engine" e a subpasta do tipo. Acha antes de criar: reconectar não duplica. */
export async function folderFor(io: DriveIo, kind: DriveKind): Promise<string> {
  const conn = await io.connection();
  if (!conn) throw new DriveDisconnected();
  const folders = { ...conn.folders };
  if (folders[kind]) return folders[kind]!;
  folders.root ??= (await findFolder(io, ROOT_FOLDER, null)) ?? (await createFolder(io, ROOT_FOLDER, null));
  const label = FOLDER_LABEL[kind];
  folders[kind] = (await findFolder(io, label, folders.root)) ?? (await createFolder(io, label, folders.root));
  // o access token pode ter sido renovado no meio: relê para não voltar o antigo
  const latest = await io.connection();
  if (latest) await io.saveConnection({ ...latest, folders });
  return folders[kind]!;
}

export async function ensureFolders(io: DriveIo): Promise<void> {
  for (const kind of Object.keys(FOLDER_LABEL) as DriveKind[]) await folderFor(io, kind);
}

export async function forgetFolders(io: DriveIo): Promise<void> {
  const conn = await io.connection();
  if (conn) await io.saveConnection({ ...conn, folders: {} });
}

export async function startUpload(
  io: DriveIo,
  input: { name: string; description: string; parent: string; mime: string; size: number },
): Promise<string> {
  const r = await driveFetch(io, `${UPLOAD_API}?uploadType=resumable`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': input.mime,
      'X-Upload-Content-Length': String(input.size),
    },
    body: JSON.stringify({ name: input.name, description: input.description, parents: [input.parent] }),
  });
  const location = r.headers.get('location');
  await r.body?.cancel();
  if (r.status === 404) {
    // a pessoa apagou a pasta: o próximo tick cria de novo
    await forgetFolders(io);
    throw new Error('Pasta do Drive não encontrada.');
  }
  if (!r.ok || !location) throw new Error(`Drive abrir upload: ${r.status}`);
  return location;
}

export type UploadState =
  | { state: 'partial'; offset: number }
  | { state: 'done'; fileId: string }
  | { state: 'expired' }
  /** 4xx definitivo: este arquivo, nesta sessão, não vai. */
  | { state: 'rejected'; status: number };

async function readUploadResponse(r: Response): Promise<UploadState> {
  if (r.status === 308) {
    await r.body?.cancel();
    return { state: 'partial', offset: nextOffset(r.headers.get('range')) };
  }
  if (r.status === 200 || r.status === 201) {
    const data = await r.json() as { id?: string };
    if (!data.id) throw new Error('Drive terminou o upload sem id.');
    return { state: 'done', fileId: data.id };
  }
  await r.body?.cancel();
  if (r.status === 404 || r.status === 410) return { state: 'expired' };
  // 5xx e 403 de limite: a sessão continua; o próximo tick consulta o offset
  if (r.status >= 500 || r.status === 403 || r.status === 429) throw new Error(`Drive upload: ${r.status}`);
  return { state: 'rejected', status: r.status };
}

export async function uploadStatus(io: DriveIo, session: string, total: number): Promise<UploadState> {
  const r = await io.fetch(session, { method: 'PUT', headers: { 'Content-Range': `bytes */${total}` } });
  return await readUploadResponse(r);
}

export async function uploadChunk(
  io: DriveIo,
  session: string,
  chunk: Uint8Array<ArrayBuffer>,
  offset: number,
  total: number,
): Promise<UploadState> {
  const r = await io.fetch(session, {
    method: 'PUT',
    headers: { 'Content-Range': `bytes ${offset}-${offset + chunk.length - 1}/${total}` },
    body: chunk,
  });
  return await readUploadResponse(r);
}

/** Lê um intervalo sem nunca segurar mais que `length` bytes. */
export async function readRange(
  fetcher: typeof fetch,
  url: string,
  from: number,
  length: number,
  headers: Record<string, string> = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const r = await fetcher(url, { headers: { ...headers, Range: `bytes=${from}-${from + length - 1}` } });
  if (r.status !== 206 && !(r.status === 200 && from === 0)) {
    await r.body?.cancel();
    throw new Error(`leitura em blocos: ${r.status}`);
  }
  const out = new Uint8Array(length);
  let filled = 0;
  const reader = r.body!.getReader();
  while (filled < length) {
    const { done, value } = await reader.read();
    if (done) break;
    const take = Math.min(value.length, length - filled);
    out.set(value.subarray(0, take), filled);
    filled += take;
  }
  await reader.cancel().catch(() => {});
  return filled === length ? out : out.subarray(0, filled);
}

/** Bloco do arquivo no Drive. */
export async function downloadRange(io: DriveIo, id: string, from: number, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const token = await accessToken(io);
  return await readRange(io.fetch, `${DRIVE_API}/files/${encodeURIComponent(id)}?alt=media`, from, length, {
    Authorization: `Bearer ${token}`,
  });
}
