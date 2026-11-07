// _shared/thumbs.ts — guarda uma miniatura externa no Storage.
//
// O CDN do Instagram bloqueia <img> de outra origem (CORP same-origin), então
// o front não consegue mostrar thumbnail_url direto. O servidor baixa a imagem
// uma vez e grava no bucket PRIVADO `renders` (o workspace do Lovable não
// permite bucket público); o front lê por URL assinada. Quem guarda devolve um
// marcador `storage:<caminho>` no lugar da URL do CDN. Falha nunca derruba a
// leitura: devolve null e quem chama mantém o que tinha.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const THUMBS_BUCKET = 'renders';
export const THUMB_MARKER = 'storage:';
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

/** Já existe no bucket? (lista a pasta procurando o nome). */
export async function thumbExists(service: SupabaseClient, path: string): Promise<boolean> {
  const slash = path.lastIndexOf('/');
  const folder = path.slice(0, slash);
  const name = path.slice(slash + 1);
  const { data, error } = await service.storage.from(THUMBS_BUCKET).list(folder, { search: name, limit: 1 });
  return !error && (data ?? []).some((f) => f.name === name);
}

/**
 * Baixa `sourceUrl` e grava em `path` (upsert). Devolve o marcador
 * `storage:<path>`, ou null quando não deu (sem rede, não é imagem, grande
 * demais, sem permissão).
 */
export async function cacheThumb(
  service: SupabaseClient,
  sourceUrl: string,
  path: string,
): Promise<string | null> {
  try {
    const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return null;
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > MAX_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null;
    const { error } = await service.storage
      .from(THUMBS_BUCKET)
      .upload(path, bytes, { contentType: type, upsert: true, cacheControl: '86400' });
    if (error) {
      console.warn('[thumbs] upload falhou:', path, error.message);
      return null;
    }
    return `${THUMB_MARKER}${path}`;
  } catch (err) {
    console.warn('[thumbs] não guardou', path, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Já é uma miniatura guardada por nós? */
export function isCachedThumb(url: string | null | undefined): boolean {
  return Boolean(url && url.startsWith(THUMB_MARKER));
}
