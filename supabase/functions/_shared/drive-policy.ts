// _shared/drive-policy.ts — as decisões do arquivamento no Google Drive, sem rede.
// O que vai para o Drive, o que pode sair do storage e quando uma cópia é confiável.
// Guia: docs/google-drive.md.

export type DriveKind = 'video' | 'imagem' | 'audio' | 'documento';

/** Mais velho que isto, sem uso: pode sair do storage. */
export const MIN_AGE_DAYS = 7;
export const MIN_AGE_MS = MIN_AGE_DAYS * 24 * 3600 * 1000;

/**
 * Bloco do upload: múltiplo de 256 KiB, como o Drive exige. 8 MiB porque a edge tem
 * 256 MB de memória e cada bloco fica vivo até o coletor passar.
 */
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
/**
 * Bytes por execução. O MD5 em JS mediu cerca de 0,36 s para 128 MiB e a edge tem
 * 2 s de CPU por pedido; o que sobrar continua no tick seguinte.
 */
export const RUN_MAX_BYTES = 128 * 1024 * 1024;
/** Tempo de uma execução: abaixo dos 150 s do plano gratuito. */
export const RUN_BUDGET_MS = 100_000;
export const MAX_PURGES_PER_RUN = 25;
export const MAX_FILES_PER_RUN = 10;
/** Bloco do TUS do Supabase: tem que ser exatamente 6 MiB. */
export const RESTORE_CHUNK_BYTES = 6 * 1024 * 1024;
/** Reserva de uma linha por uma execução. */
export const LEASE_MS = 3 * 60 * 1000;
/** Arquivo em uso ou novo volta a ser olhado depois disto: não prende a fila dos outros. */
export const RECHECK_MS = 6 * 3600 * 1000;

const MIB = 1024 * 1024;
/** Vídeo e áudio pesam: entram a partir daqui. */
export const MIN_MEDIA_BYTES = MIB;
/** Imagem pequena abre em toda lista da Biblioteca: fica. */
export const MIN_IMAGE_BYTES = 5 * MIB;
/** Documento do Acervo: o texto já está nos chunks do banco. */
export const MIN_DOCUMENT_BYTES = 5 * MIB;

/**
 * Mapa dos buckets. Avatares, vozes e thumbs não são buckets próprios: moram em
 * brand-assets (avatars/, voices/) e renders (thumbs/).
 */
export const BUCKET_RULES: Record<string, string> = {
  renders: 'Vídeos, áudios e imagens gerados: é o que mais ocupa. Vão para o Drive, exceto fontes, miniaturas e arquivos pequenos.',
  'context-files': 'Originais do Acervo: só os grandes vão. O texto segue nos chunks do banco, e a busca não depende do arquivo.',
  'brand-assets': 'Fica inteiro: logo, fontes, fotos de avatar e amostras de voz entram em quase toda geração, ocupam pouco e vão para provedores por link longo.',
};

/** Buckets que a varredura lê. O resto fica de fora por padrão. */
export const ARCHIVABLE_BUCKETS = ['renders', 'context-files'];

export type Classification =
  | { archive: true; kind: DriveKind }
  | { archive: false; reason: string };

const EXT_KIND: Record<string, DriveKind> = {
  mp4: 'video', mov: 'video', webm: 'video', m4v: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio',
  png: 'imagem', jpg: 'imagem', jpeg: 'imagem', webp: 'imagem',
  pdf: 'documento', docx: 'documento', pptx: 'documento', xlsx: 'documento',
};

export function kindOf(path: string, mime?: string | null): DriveKind | null {
  const type = (mime ?? '').split('/')[0];
  if (type === 'video') return 'video';
  if (type === 'audio') return 'audio';
  if (type === 'image') return 'imagem';
  return EXT_KIND[path.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

export function classify(file: { bucket: string; path: string; size: number; mime?: string | null }): Classification {
  const { bucket, path, size, mime } = file;
  if (bucket === 'brand-assets') return { archive: false, reason: BUCKET_RULES['brand-assets'] };
  if (!ARCHIVABLE_BUCKETS.includes(bucket)) return { archive: false, reason: 'Bucket fora do mapa: nada sai sem regra.' };

  if (bucket === 'context-files') {
    if (size < MIN_DOCUMENT_BYTES) return { archive: false, reason: 'Documento pequeno do Acervo.' };
    return { archive: true, kind: kindOf(path, mime) ?? 'documento' };
  }

  if (path.startsWith('director/assets/')) return { archive: false, reason: 'Fonte das legendas: todo vídeo lê.' };
  if (path.startsWith('thumbs/')) return { archive: false, reason: 'Miniatura: toda lista lê.' };
  const kind = kindOf(path, mime);
  if (!kind || kind === 'documento') return { archive: false, reason: 'Arquivo de trabalho do motor.' };
  const minimum = kind === 'imagem' ? MIN_IMAGE_BYTES : MIN_MEDIA_BYTES;
  if (size < minimum) return { archive: false, reason: 'Arquivo pequeno.' };
  return { archive: true, kind };
}

/** Link rápido para o front: este caminho pode ter ido para o Drive? */
export function mayBeArchived(bucket: string, path: string): boolean {
  if (!ARCHIVABLE_BUCKETS.includes(bucket)) return false;
  return !path.startsWith('director/assets/') && !path.startsWith('thumbs/');
}

// ── verificação ──────────────────────────────────────────────────────────────

export interface DriveFileMeta {
  id: string;
  size?: string | number | null;
  md5Checksum?: string | null;
  trashed?: boolean | null;
  webViewLink?: string | null;
}

/** ETag do storage, sem aspas. Só é MD5 de verdade em upload de parte única. */
export function plainMd5(etag: string | null | undefined): string | null {
  const clean = (etag ?? '').replace(/^W\//, '').replaceAll('"', '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(clean) ? clean : null;
}

export type CopyCheck = { ok: true } | { ok: false; reason: string };

/** A cópia do Drive tem de ser igual ao que saiu do storage, em tamanho e md5. */
export function verifyCopy(
  expected: { size: number; md5: string | null; etag?: string | null },
  drive: DriveFileMeta | null,
): CopyCheck {
  if (!drive) return { ok: false, reason: 'Cópia não encontrada no Drive.' };
  if (drive.trashed) return { ok: false, reason: 'Cópia na lixeira do Drive.' };
  if (!expected.md5) return { ok: false, reason: 'Sem md5 para comparar.' };
  if (!drive.md5Checksum) return { ok: false, reason: 'O Drive ainda não informou o md5.' };
  if (drive.md5Checksum.toLowerCase() !== expected.md5.toLowerCase()) return { ok: false, reason: 'md5 diferente.' };
  if (drive.size === null || drive.size === undefined || Number(drive.size) !== expected.size) {
    return { ok: false, reason: 'Tamanho diferente.' };
  }
  const local = plainMd5(expected.etag);
  if (local && local !== expected.md5.toLowerCase()) return { ok: false, reason: 'O arquivo do storage não bate com a cópia.' };
  return { ok: true };
}

// ── apagar do storage ────────────────────────────────────────────────────────

export interface PurgeInput {
  now: number;
  /** interruptor do dono: app_settings.google_drive_archive.purge */
  enabled: boolean;
  row: {
    status: string;
    md5: string | null;
    size_bytes: number;
    source_updated_at: string | null;
    last_used_at: string | null;
    restored_at: string | null;
    drive_account: string | null;
  };
  local: { size: number; etag: string | null; updatedAt: string } | null;
  drive: DriveFileMeta | null;
  /** conta conectada agora */
  account: string | null;
  inUse: boolean;
}

export type PurgeDecision =
  | { purge: true }
  | { purge: false; reason: 'desligado' | 'estado' | 'sem_arquivo' | 'mudou' | 'conta' | 'copia' | 'novo' | 'em_uso'; detail?: string };

/**
 * A única porta para apagar. Tudo que não for certeza vira "não apaga". As regras
 * caras ficam por último, mas a ordem não muda o resultado: basta uma falhar.
 */
export function decidePurge(input: PurgeInput): PurgeDecision {
  const { row, local, drive, now } = input;
  if (!input.enabled) return { purge: false, reason: 'desligado' };
  if (row.status !== 'uploaded') return { purge: false, reason: 'estado' };
  if (!local) return { purge: false, reason: 'sem_arquivo' };
  if (!row.source_updated_at || Date.parse(row.source_updated_at) !== Date.parse(local.updatedAt)) {
    return { purge: false, reason: 'mudou' };
  }
  if (!row.drive_account || row.drive_account !== input.account) return { purge: false, reason: 'conta' };
  if (local.size !== row.size_bytes) return { purge: false, reason: 'mudou' };
  const check = verifyCopy({ size: local.size, md5: row.md5, etag: local.etag }, drive);
  if (!check.ok) return { purge: false, reason: 'copia', detail: check.reason };
  const lastTouch = Math.max(
    Date.parse(local.updatedAt) || now,
    row.last_used_at ? Date.parse(row.last_used_at) : 0,
    row.restored_at ? Date.parse(row.restored_at) : 0,
  );
  if (now - lastTouch <= MIN_AGE_MS) return { purge: false, reason: 'novo' };
  if (input.inUse) return { purge: false, reason: 'em_uso' };
  return { purge: true };
}

// ── em uso ───────────────────────────────────────────────────────────────────

export interface InUse {
  paths: Set<string>;
  prefixes: string[];
}

/** Todo texto dentro de um JSON: os caminhos de um job moram em dezenas de campos. */
export function collectStrings(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    if (value.length < 600) into.add(value.replace(/^storage:/, ''));
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, into);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, into);
  }
}

export function buildInUse(sources: { values: unknown[]; prefixes?: string[] }): InUse {
  const paths = new Set<string>();
  collectStrings(sources.values, paths);
  return { paths, prefixes: sources.prefixes ?? [] };
}

export function isInUse(inUse: InUse, path: string): boolean {
  return inUse.paths.has(path) || inUse.prefixes.some((prefix) => path.startsWith(prefix));
}

// ── protocolo ────────────────────────────────────────────────────────────────

/** `Range: bytes=0-524287` do 308 → próximo byte a enviar. Sem header, nada chegou. */
export function nextOffset(range: string | null): number {
  const match = /bytes=\d+-(\d+)/.exec(range ?? '');
  return match ? Number(match[1]) + 1 : 0;
}

/** Espera antes de tentar de novo: 5 min, 10, 20… até 6 h. */
export function backoffMs(attempts: number): number {
  return Math.min(5 * 60_000 * 2 ** Math.max(attempts - 1, 0), 6 * 3600_000);
}

/** Nome no Drive: legível e sem barra. O caminho completo vai na descrição. */
export function driveName(path: string): string {
  return path.replaceAll('/', '_').slice(-200);
}

export const FOLDER_LABEL: Record<DriveKind, string> = {
  video: 'Vídeos',
  imagem: 'Imagens',
  audio: 'Áudios',
  documento: 'Documentos',
};
export const ROOT_FOLDER = 'Content Engine';
