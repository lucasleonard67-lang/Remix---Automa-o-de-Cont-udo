import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Miniaturas dos posts. O CDN do Instagram bloqueia <img> de outra origem
// (Cross-Origin-Resource-Policy: same-origin), então a URL que o Zernio e o
// Apify devolvem NUNCA carrega no navegador. O servidor (metrics-sync,
// competitor-sync) guarda a imagem no bucket privado `renders`, em
// thumbs/posts/<id>.jpg (seus) e thumbs/market/<id>.jpg (concorrentes); aqui
// se assinam as URLs em lote. Quem renderiza trata onError com placeholder.
// ---------------------------------------------------------------------------

const BUCKET = "renders";
const MARKER = "storage:";
const SIGN_SECONDS = 60 * 60;

/** URL do CDN do Instagram/Facebook? Nunca carrega no navegador. */
export function isBlockedCdn(url: string | null | undefined): boolean {
  return Boolean(url && /cdninstagram\.com|fbcdn\.net/.test(url));
}

/** Caminho no bucket da miniatura de um post seu (pelo id do Zernio). */
export function ownPostThumbPath(zernioPostId: string): string {
  return `thumbs/posts/${zernioPostId}.jpg`;
}

/**
 * De uma thumbnail_url guardada, o que fazer: assinar um caminho do bucket,
 * usar a URL como está (host servível) ou nada (CDN bloqueado).
 */
export function thumbSource(
  url: string | null | undefined,
): { path: string } | { url: string } | null {
  if (!url) return null;
  if (url.startsWith(MARKER)) return { path: url.slice(MARKER.length) };
  if (isBlockedCdn(url)) return null;
  return { url };
}

/** Assina vários caminhos de uma vez; devolve caminho → URL (ausentes ficam de fora). */
export function useSignedThumbs(paths: string[]) {
  const key = [...new Set(paths)].sort();
  return useQuery({
    queryKey: ["thumbs", key],
    enabled: key.length > 0,
    staleTime: (SIGN_SECONDS - 300) * 1000,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(key, SIGN_SECONDS);
      if (error) return {};
      const out: Record<string, string> = {};
      for (const item of data ?? []) {
        if (item.path && item.signedUrl && !item.error) out[item.path] = item.signedUrl;
      }
      return out;
    },
  });
}
