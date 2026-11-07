import { useQuery } from "@tanstack/react-query";
import { addDays, startOfDay } from "date-fns";
import { useMemo } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useScheduledPieces } from "@/hooks/use-content-pieces";
import { channelBrand, type BrandName } from "@/lib/brands";

// ---------------------------------------------------------------------------
// Próximos 7 dias — agendamentos por dia (peças com `scheduled_at` + posts do
// Zernio com `scheduled_for`/`published_at`), deduplicados por peça.
// ---------------------------------------------------------------------------

export interface WeekDay {
  date: Date;
  /** Peças distintas marcadas para o dia. */
  count: number;
  /** Plataformas das peças do dia (sem repetição, na ordem em que aparecem). */
  brands: BrandName[];
  isToday: boolean;
}

interface PostRow {
  piece_id: string;
  scheduled_for: string | null;
  published_at: string | null;
  status: string;
}

const DAYS = 7;

export function useDashboardWeek(): { days: WeekDay[]; total: number; isLoading: boolean } {
  // Começo do dia local; a janela fecha estável por hora para o cache não girar.
  const start = useMemo(() => startOfDay(new Date()), []);
  const end = useMemo(() => addDays(start, DAYS), [start]);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const pieces = useScheduledPieces(startIso, endIso);
  const posts = useQuery({
    queryKey: ["dashboard", "week-posts", startIso, endIso],
    staleTime: 60_000,
    queryFn: async (): Promise<PostRow[]> => {
      const { data, error } = await supabase
        .from("published_posts")
        .select("piece_id, scheduled_for, published_at, status")
        .in("status", ["pending", "scheduled", "publishing", "published"])
        .or(
          `and(scheduled_for.gte.${startIso},scheduled_for.lt.${endIso}),and(published_at.gte.${startIso},published_at.lt.${endIso})`,
        );
      if (error) throw new Error(error.message);
      return (data ?? []) as PostRow[];
    },
  });

  const days = useMemo(() => {
    const buckets: Array<Set<string>> = Array.from({ length: DAYS }, () => new Set());
    const brands: Array<Set<BrandName>> = Array.from({ length: DAYS }, () => new Set());
    const indexOf = (iso: string | null): number => {
      if (!iso) return -1;
      const when = new Date(iso).getTime();
      const idx = Math.floor((when - start.getTime()) / 86_400_000);
      return idx >= 0 && idx < DAYS ? idx : -1;
    };
    for (const piece of pieces.data ?? []) {
      const idx = indexOf(piece.scheduled_at);
      if (idx < 0) continue;
      buckets[idx].add(piece.id);
      const brand = channelBrand(piece.channel_type);
      if (brand) brands[idx].add(brand);
    }
    for (const post of posts.data ?? []) {
      const idx = indexOf(post.scheduled_for ?? post.published_at);
      if (idx >= 0) buckets[idx].add(post.piece_id);
    }
    return buckets.map((set, i) => ({
      date: addDays(start, i),
      count: set.size,
      brands: [...brands[i]],
      isToday: i === 0,
    }));
  }, [pieces.data, posts.data, start]);

  const total = days.reduce((sum, day) => sum + day.count, 0);
  return { days, total, isLoading: pieces.isLoading || posts.isLoading };
}
