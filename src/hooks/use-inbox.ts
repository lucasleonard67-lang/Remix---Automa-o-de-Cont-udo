import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import {
  buildInbox,
  type InboxAvatar,
  type InboxItem,
  type InboxPiece,
  type InboxRoteiro,
  type InboxVideo,
  type InboxVoice,
} from "@/lib/inbox";

// ---------------------------------------------------------------------------
// Lista do sino. Peça e vídeo atualizam na hora (TaskWatcher invalida ao
// receber o Realtime); avatar e voz não estão na publicação do Realtime, então
// a releitura a cada 30 s é quem os traz. Tabela ilegível para esta pessoa
// (RLS) só fica de fora da lista.
// ---------------------------------------------------------------------------

export const INBOX_KEY = ["inbox"];
const POLL_MS = 30_000;
const PER_TABLE = 15;

export function useInbox() {
  const { session } = useSession();
  return useQuery({
    queryKey: INBOX_KEY,
    enabled: Boolean(session),
    staleTime: 10_000,
    refetchInterval: POLL_MS,
    queryFn: async (): Promise<InboxItem[]> => {
      const read = <T>(table: string, columns: string) => {
        // `brand_voices` e as colunas jsonb: a lista só lê, com formato próprio
        const client = supabase as unknown as {
          from: (name: string) => {
            select: (cols: string) => {
              order: (
                col: string,
                options: { ascending: boolean },
              ) => {
                limit: (n: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
              };
            };
          };
        };
        return client
          .from(table)
          .select(columns)
          .order("updated_at", { ascending: false })
          .limit(PER_TABLE)
          .then(({ data, error }) => (error ? [] : ((data ?? []) as T[])));
      };
      const [pieces, videos, avatars, voices, roteiros] = await Promise.all([
        read<InboxPiece>("generation_jobs", "id, status, prompt, updated_at"),
        read<InboxVideo>("director_jobs", "id, status, brief, plan, updated_at"),
        read<InboxAvatar>("brand_avatars", "id, name, provider_refs, updated_at"),
        read<InboxVoice>("brand_voices", "id, name, status, updated_at"),
        read<InboxRoteiro>("roteiro_pedidos", "id, status, briefing, updated_at"),
      ]);
      return buildInbox({ pieces, videos, avatars, voices, roteiros });
    },
  });
}

/** Carimbo de leitura da pessoa. Primeira visita começa em "agora": sem histórico não lido. */
export function useInboxRead() {
  const { user } = useSession();
  const key = user ? `ce:avisos-lidos:${user.id}` : null;
  const [readAt, setReadAt] = useState<string | null>(null);

  useEffect(() => {
    if (!key) return;
    const now = new Date().toISOString();
    try {
      const stored = localStorage.getItem(key);
      if (!stored) localStorage.setItem(key, now);
      setReadAt(stored ?? now);
    } catch {
      setReadAt(now);
    }
  }, [key]);

  const markRead = useCallback(() => {
    const now = new Date().toISOString();
    setReadAt(now);
    if (!key) return;
    try {
      localStorage.setItem(key, now);
    } catch {
      // sem armazenamento, o carimbo vale até recarregar
    }
  }, [key]);

  return { readAt, markRead };
}
