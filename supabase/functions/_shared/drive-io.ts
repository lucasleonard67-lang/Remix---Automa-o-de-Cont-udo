// _shared/drive-io.ts — liga o motor do Drive no Supabase. O teste troca tudo isto por
// memória; aqui mora só o acesso a banco, Vault e storage.

import type { Candidate, DriveConnection, DriveIo, DriveRow, LastRun } from './drive-api.ts';
import { hubDaInstancia, instanciaAtual } from './drive-hub.ts';
import { ARCHIVABLE_BUCKETS, buildInUse, LEASE_MS, MIN_AGE_MS, MIN_MEDIA_BYTES } from './drive-policy.ts';

const ambiente = (nome: string) => Deno.env.get(nome);
const STATE_KEY = 'google_drive';
export const LAST_RUN_KEY = 'google_drive_last_run';

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Service = any;

const secret = async (service: Service, name: string): Promise<string | null> => {
  const { data } = await service.rpc('get_vault_secret', { _name: name });
  return (data as string) || null;
};

interface ObjectRow {
  size_bytes: number;
  mime_type: string | null;
  etag: string | null;
  source_updated_at: string;
}

const toObject = (row: ObjectRow) => ({
  size: Number(row.size_bytes),
  mime: row.mime_type,
  etag: row.etag,
  updatedAt: row.source_updated_at,
});

/** Status de jobs e edições que ainda vão ler os próprios arquivos. */
const DONE_JOB_STATUSES = '(done,failed,canceled)';
const OPEN_EDITS = ['analyzing', 'suggested', 'queued', 'rendering', 'checking'];
const CLOSED_PROJECT_STATUSES = '(ready,failed,cancelled)';
const OPEN_POSTS = ['pending', 'scheduled', 'publishing'];
/** Job concluído há pouco ainda pode estar publicando ou reeditando uma cena. */
const RECENT_MS = 24 * 3600 * 1000;

async function collectInUse(service: Service) {
  const check = <T>(result: { data: T; error: { message: string } | null }): T => {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  };
  const since = new Date(Date.now() - RECENT_MS).toISOString();
  const projects = await service.from('video_projects').select('id, final_video_path, final_meta')
    .not('status', 'in', CLOSED_PROJECT_STATUSES);
  const projectIds = check<{ id: string }[]>(projects).map((project) => project.id);
  const [activeJobs, recentJobs, edits, scenes, posts, scheduled] = await Promise.all([
    service.from('director_jobs').select('id, artifacts, config').not('status', 'in', DONE_JOB_STATUSES),
    service.from('director_jobs').select('id, artifacts, config').gte('updated_at', since),
    service.from('video_edits').select('id, source_path, output_path, artifacts, attachments:analysis->attachments').in('status', OPEN_EDITS),
    projectIds.length ? service.from('video_scenes').select('*').in('project_id', projectIds) : { data: [], error: null },
    service.from('published_posts').select('piece_id').in('status', OPEN_POSTS),
    service.from('content_pieces').select('id').gte('scheduled_at', new Date().toISOString()),
  ]);
  const pieceIds = [...new Set([
    ...check<{ piece_id: string }[]>(posts).map((p) => p.piece_id),
    ...check<{ id: string }[]>(scheduled).map((p) => p.id),
  ])];
  const pieces = pieceIds.length
    ? check(await service.from('content_pieces').select('render_path, adapted_content').in('id', pieceIds)) as unknown[]
    : [];
  const jobs = [
    ...check<{ id: string }[]>(activeJobs),
    ...check<{ id: string }[]>(recentJobs),
  ];
  return buildInUse({
    values: [jobs, check(edits), check(projects), check(scenes), pieces],
    prefixes: [
      ...jobs.map((job) => `director/${job.id}/`),
      ...check<{ id: string }[]>(edits).map((edit) => `edits/${edit.id}/`),
      ...pieceIds.map((id) => `${id}/`),
    ],
  });
}

export function makeDriveIo(service: Service): DriveIo {
  const base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
  return {
    fetch: (...args) => fetch(...args),
    hub: { url: hubDaInstancia(ambiente), instancia: instanciaAtual(ambiente) },
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    tusEndpoint: `${base}/storage/v1/upload/resumable`,
    storageKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',

    async credentials() {
      const [clientId, clientSecret] = await Promise.all([
        secret(service, 'GOOGLE_CLIENT_ID'), secret(service, 'GOOGLE_CLIENT_SECRET'),
      ]);
      return clientId && clientSecret ? { clientId, clientSecret } : null;
    },
    refreshToken: () => secret(service, 'GOOGLE_DRIVE_REFRESH_TOKEN'),
    async storeRefreshToken(value) {
      const { error } = await service.rpc('google_drive_store_refresh', { _value: value });
      if (error) throw new Error(`vault: ${error.message}`);
    },
    async connection() {
      const { data, error } = await service.from('director_state').select('value').eq('key', STATE_KEY).maybeSingle();
      if (error) throw new Error(error.message);
      return (data?.value as DriveConnection) ?? null;
    },
    async saveConnection(next) {
      const { error } = next
        ? await service.from('director_state').upsert({ key: STATE_KEY, value: next }, { onConflict: 'key' })
        : await service.from('director_state').delete().eq('key', STATE_KEY);
      if (error) throw new Error(`director_state: ${error.message}`);
    },
    async purgeEnabled() {
      const { data } = await service.from('app_settings').select('value').eq('key', 'google_drive_archive').maybeSingle();
      return (data?.value as { purge?: boolean } | null)?.purge === true;
    },
    async saveLastRun(run: LastRun) {
      const { error } = await service.from('director_state').upsert({ key: LAST_RUN_KEY, value: run }, { onConflict: 'key' });
      if (error) throw new Error(`director_state: ${error.message}`);
    },
    async storageBlind() {
      const { data, error } = await service.rpc('google_drive_objects_seen', { _buckets: ARCHIVABLE_BUCKETS });
      if (error || Number(data) > 0) return false;
      for (const bucket of ARCHIVABLE_BUCKETS) {
        const { data: files } = await service.storage.from(bucket).list('', { limit: 2 });
        const real = ((files ?? []) as { name: string }[]).filter((file) => file.name !== '.emptyFolderPlaceholder');
        if (real.length) return true;
      }
      return false;
    },
    async row(bucket, path) {
      const { data, error } = await service.from('drive_files').select('*').eq('bucket', bucket).eq('path', path).maybeSingle();
      if (error) throw new Error(error.message);
      return data as DriveRow | null;
    },
    async rowById(id) {
      const { data, error } = await service.from('drive_files').select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(error.message);
      return data as DriveRow | null;
    },
    async patchRow(id, fields) {
      const { error } = await service.from('drive_files').update(fields).eq('id', id);
      if (error) throw new Error(`drive_files: ${error.message}`);
    },
    async claimRow(id) {
      const cutoff = new Date(Date.now() - LEASE_MS).toISOString();
      const { data } = await service.from('drive_files')
        .update({ claimed_at: new Date().toISOString() })
        .eq('id', id)
        .or(`claimed_at.is.null,claimed_at.lt.${cutoff}`)
        .select('*')
        .maybeSingle();
      return data as DriveRow | null;
    },
    async addRows(rows) {
      const { error } = await service.from('drive_files').upsert(rows, { onConflict: 'bucket,path', ignoreDuplicates: true });
      if (error) throw new Error(`drive_files: ${error.message}`);
    },
    async candidates(limit) {
      const { data, error } = await service.rpc('google_drive_candidates', {
        _buckets: ARCHIVABLE_BUCKETS,
        _min_size: MIN_MEDIA_BYTES,
        _min_age: `${MIN_AGE_MS / 1000} seconds`,
        _limit: limit,
      });
      if (error) throw new Error(`candidatos: ${error.message}`);
      return ((data ?? []) as (ObjectRow & { bucket: string; path: string; known: boolean })[]).map((row): Candidate => ({
        ...toObject(row), bucket: row.bucket, path: row.path, known: row.known,
      }));
    },
    async dueForUpload(limit) {
      const { data, error } = await service.from('drive_files').select('*')
        .eq('status', 'pending').lte('next_try_at', new Date().toISOString())
        .order('size_bytes', { ascending: false }).limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []) as DriveRow[];
    },
    async dueForPurge(limit) {
      const cutoff = new Date(Date.now() - MIN_AGE_MS).toISOString();
      const { data, error } = await service.from('drive_files').select('*')
        .eq('status', 'uploaded').lte('next_try_at', new Date().toISOString())
        .lt('source_updated_at', cutoff)
        .or(`last_used_at.is.null,last_used_at.lt.${cutoff}`)
        .order('size_bytes', { ascending: false }).limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []) as DriveRow[];
    },
    async object(bucket, path) {
      const { data, error } = await service.rpc('google_drive_object', { _bucket: bucket, _path: path });
      if (error) throw new Error(`objeto: ${error.message}`);
      const row = ((data ?? []) as ObjectRow[])[0];
      return row ? toObject(row) : null;
    },
    async signRead(bucket, path) {
      const { data, error } = await service.storage.from(bucket).createSignedUrl(path, 3600);
      if (error || !data?.signedUrl) throw new Error(`assinar leitura: ${error?.message}`);
      return data.signedUrl;
    },
    async removeObject(bucket, path) {
      const { error } = await service.storage.from(bucket).remove([path]);
      if (error) throw new Error(`remover do storage: ${error.message}`);
    },
    inUse: () => collectInUse(service),
  };
}
