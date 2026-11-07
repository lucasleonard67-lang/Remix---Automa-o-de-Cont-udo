import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { PublishedPost } from "@/hooks/use-zernio";

// ---------------------------------------------------------------------------
// Leitura de published_posts (Eixo 1). Escrita é exclusiva do backend
// (zernio-proxy/zernio-webhook via service role); aqui só query + Realtime.
// ---------------------------------------------------------------------------

/** Última tentativa de publicação da peça (linha mais recente). */
export function usePublishedPost(pieceId: string | undefined) {
  return useQuery({
    queryKey: ["published-post", pieceId],
    enabled: Boolean(pieceId),
    queryFn: async (): Promise<PublishedPost | null> => {
      const { data, error } = await supabase
        .from("published_posts")
        .select("*")
        .eq("piece_id", pieceId as string)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as PublishedPost | null) ?? null;
    },
  });
}

/** Todas as publicações de um conjunto de peças (calendário/Biblioteca). */
export function usePublishedPostsMap(pieceIds: string[]) {
  const key = [...pieceIds].sort().join(",");
  return useQuery({
    queryKey: ["published-posts", key],
    enabled: pieceIds.length > 0,
    queryFn: async (): Promise<Map<string, PublishedPost>> => {
      const { data, error } = await supabase
        .from("published_posts")
        .select("*")
        .in("piece_id", pieceIds)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      // Ordem ascendente + Map: a linha mais RECENTE de cada peça prevalece.
      const map = new Map<string, PublishedPost>();
      for (const row of (data ?? []) as PublishedPost[]) {
        map.set(row.piece_id, row);
      }
      return map;
    },
  });
}

/** Últimas publicações confirmadas (Dashboard → Desempenho). */
export function useRecentPublishedPosts(limit = 5) {
  return useQuery({
    queryKey: ["published-posts", "recent", limit],
    queryFn: async (): Promise<PublishedPost[]> => {
      const { data, error } = await supabase
        .from("published_posts")
        .select("*")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []) as PublishedPost[];
    },
  });
}

/**
 * Realtime de published_posts da peça: o zernio-webhook grava a transição e a
 * UI atualiza sozinha — zero polling (regra do projeto).
 */
export function usePublishedPostRealtime(pieceId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!pieceId) return;
    const channel = supabase
      .channel(`published-post-${pieceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "published_posts",
          filter: `piece_id=eq.${pieceId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["published-post", pieceId] });
          void queryClient.invalidateQueries({ queryKey: ["published-posts"] });
          // O webhook também pode ter promovido a peça para 'published'.
          void queryClient.invalidateQueries({ queryKey: ["piece", pieceId] });
          void queryClient.invalidateQueries({ queryKey: ["pieces"] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [pieceId, queryClient]);
}
