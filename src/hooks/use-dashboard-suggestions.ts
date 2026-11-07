import { useQuery } from "@tanstack/react-query";
import { differenceInCalendarDays } from "date-fns";
import { useMemo } from "react";

import { supabase } from "@/integrations/supabase/client";
import { CHANNEL_TYPE_LABELS, useChannels, type ChannelType } from "@/hooks/use-channels";
import type { PieceStage } from "@/hooks/use-content-pieces";
import { useIsAdmin } from "@/hooks/use-is-admin";
import type { RssItem } from "@/hooks/use-rss";
import type { CreateKind } from "@/components/criar/create-search";

// ---------------------------------------------------------------------------
// Sugestões de hoje — geradas no cliente, sem IA (v1: instantâneo e barato).
// Fontes: Radar (notícias novas), canais ligados parados e a fila de revisão.
// ---------------------------------------------------------------------------

export type SuggestionAction =
  | { to: "/"; search: { radar?: string; brief?: string; kind?: CreateKind; video?: true } }
  | { to: "/biblioteca"; search: { status?: PieceStage } };

export interface DashboardSuggestion {
  id: string;
  kind: "radar" | "channel" | "review";
  /** Frase principal, curta. */
  text: string;
  /** Contexto (fonte, idade). Opcional. */
  meta?: string;
  actionLabel: string;
  action: SuggestionAction;
  /** Notas do Radar (0–100). Presente só em sugestões vindas do Radar. */
  score?: RadarScore;
  /** Base da nota (só Radar): fonte e data, sem formatar. */
  source?: string | null;
  publishedAt?: string | null;
}

export interface RadarScore {
  relevance: number | null;
  virality: number | null;
  /** Por que a nota, em uma frase (quando o Radar já avaliou). */
  reason: string | null;
}

/** Dias sem peça a partir dos quais um canal ligado vira sugestão. */
const CHANNEL_GAP_DAYS = 5;
const MAX_SUGGESTIONS = 3;

export type RadarRow = RssItem & Record<string, unknown>;

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Ordenação: `priority` (relevance × virality, calculada no banco) quando a
 * coluna existir; senão a soma das notas; senão a data. O select é `*`, então
 * nada quebra enquanto o SQL de notas não foi aplicado — as chaves só não vêm.
 */
function radarScore(item: RadarRow): number {
  const priority = numberOrNull(item.priority);
  if (priority !== null) return priority;
  const relevance = numberOrNull(item.relevance);
  const virality = numberOrNull(item.virality);
  if (relevance !== null || virality !== null) return (relevance ?? 0) + (virality ?? 0);
  return Number.NEGATIVE_INFINITY;
}

function radarScoreOf(item: RadarRow): RadarScore {
  return {
    relevance: numberOrNull(item.relevance),
    virality: numberOrNull(item.virality),
    reason: typeof item.score_reason === "string" && item.score_reason ? item.score_reason : null,
  };
}

/** Notícias novas do Radar (não usadas, não dispensadas); cache compartilhado com /criar. */
export function useFreshRadarItems() {
  return useQuery({
    queryKey: ["dashboard", "radar-fresh"],
    staleTime: 60_000,
    queryFn: async (): Promise<RadarRow[]> => {
      const { data, error } = await supabase
        .from("rss_items")
        .select("*, rss_feeds(name)")
        .is("used_in_job_id", null)
        .is("dismissed_at", null)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(12);
      // Radar sem feed ou sem permissão não derruba o Dashboard.
      if (error) return [];
      return (data ?? []) as unknown as RadarRow[];
    },
  });
}

interface LastPieceByChannel {
  channel: ChannelType;
  lastAt: string | null;
}

function useLastPieceByChannel() {
  return useQuery({
    queryKey: ["dashboard", "last-piece-by-channel"],
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase
        .from("content_pieces")
        .select("channel_type, created_at")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw new Error(error.message);
      const last: Record<string, string> = {};
      for (const row of data ?? []) {
        if (!last[row.channel_type]) last[row.channel_type] = row.created_at;
      }
      return last;
    },
  });
}

function useOldestDraft() {
  return useQuery({
    queryKey: ["dashboard", "oldest-draft"],
    staleTime: 30_000,
    queryFn: async (): Promise<{ count: number; oldestAt: string | null }> => {
      const { data, count, error } = await supabase
        .from("content_pieces")
        .select("created_at", { count: "exact" })
        .eq("status", "draft")
        .order("created_at", { ascending: true })
        .limit(1);
      if (error) throw new Error(error.message);
      return { count: count ?? 0, oldestAt: data?.[0]?.created_at ?? null };
    },
  });
}

/** Onde criar para o canal: Reel é vídeo (a rota /criar leva a /videos/novo). */
function searchForChannel(channel: ChannelType): { kind?: CreateKind; video?: true } {
  if (channel === "instagram_reel") return { video: true };
  return { kind: channel.startsWith("instagram_") ? "image" : "post" };
}

export function useDashboardSuggestions(): {
  suggestions: DashboardSuggestion[];
  /** Alguma sugestão do Radar já tem nota — o título vira "Com chance de viralizar". */
  hasScores: boolean;
  isLoading: boolean;
} {
  const radar = useFreshRadarItems();
  const channels = useChannels();
  const lastPiece = useLastPieceByChannel();
  const drafts = useOldestDraft();
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();

  const isLoading =
    radar.isLoading ||
    channels.isLoading ||
    lastPiece.isLoading ||
    drafts.isLoading ||
    adminLoading;

  const suggestions = useMemo(() => {
    const now = new Date();
    const out: DashboardSuggestion[] = [];

    // 1) Radar — maior score quando houver; senão o mais recente.
    const radarItems = [...(radar.data ?? [])].sort((a, b) => {
      const diff = radarScore(b) - radarScore(a);
      if (diff !== 0 && Number.isFinite(diff)) return diff;
      return (b.published_at ?? b.created_at).localeCompare(a.published_at ?? a.created_at);
    });
    const radarSuggestions: DashboardSuggestion[] = radarItems.slice(0, 2).map((item) => {
      const when = item.published_at ?? item.created_at;
      const age = differenceInCalendarDays(now, new Date(when));
      const ageLabel = age <= 0 ? "hoje" : age === 1 ? "ontem" : `há ${age} dias`;
      const source = item.rss_feeds?.name;
      return {
        id: `radar-${item.id}`,
        kind: "radar",
        text: item.title,
        meta: source ? `${source} · ${ageLabel}` : ageLabel,
        actionLabel: "Criar",
        action: { to: "/", search: { radar: item.id } },
        score: radarScoreOf(item),
        source: source ?? null,
        publishedAt: when,
      };
    });

    // 2) Canal ligado parado há mais de N dias (ou sem peça nenhuma).
    const gaps: Array<{ info: LastPieceByChannel; days: number }> = [];
    for (const channel of channels.data ?? []) {
      if (!channel.enabled) continue;
      // Reel é vídeo, e Vídeos é só de admin: para os outros, não é sugestão
      if (channel.type === "instagram_reel" && !isAdmin) continue;
      const lastAt = lastPiece.data?.[channel.type] ?? null;
      const days = lastAt
        ? differenceInCalendarDays(now, new Date(lastAt))
        : Number.POSITIVE_INFINITY;
      if (days >= CHANNEL_GAP_DAYS) gaps.push({ info: { channel: channel.type, lastAt }, days });
    }
    gaps.sort((a, b) => b.days - a.days);
    const gap = gaps[0];
    const channelSuggestion: DashboardSuggestion | null = gap
      ? {
          id: `channel-${gap.info.channel}`,
          kind: "channel",
          text: Number.isFinite(gap.days)
            ? `Faz ${gap.days} dias sem ${CHANNEL_TYPE_LABELS[gap.info.channel]}`
            : `Nenhuma peça para ${CHANNEL_TYPE_LABELS[gap.info.channel]} até agora`,
          meta: "Canal ligado em Marca → Canais",
          actionLabel: "Criar",
          action: { to: "/", search: searchForChannel(gap.info.channel) },
        }
      : null;

    // 3) Revisão — só quando há peça esperando.
    const draftCount = drafts.data?.count ?? 0;
    const oldestAt = drafts.data?.oldestAt;
    const reviewSuggestion: DashboardSuggestion | null =
      draftCount > 0 && oldestAt
        ? {
            id: "review",
            kind: "review",
            text:
              draftCount === 1
                ? "Uma peça espera sua revisão"
                : `${draftCount} peças esperam sua revisão`,
            meta: (() => {
              const days = differenceInCalendarDays(now, new Date(oldestAt));
              return days <= 0
                ? "A mais antiga chegou hoje"
                : `A mais antiga espera há ${days === 1 ? "1 dia" : `${days} dias`}`;
            })(),
            actionLabel: "Revisar",
            action: { to: "/biblioteca", search: { status: "draft" } },
          }
        : null;

    if (radarSuggestions[0]) out.push(radarSuggestions[0]);
    if (channelSuggestion) out.push(channelSuggestion);
    if (reviewSuggestion) out.push(reviewSuggestion);
    if (out.length < MAX_SUGGESTIONS && radarSuggestions[1]) out.push(radarSuggestions[1]);
    return out.slice(0, MAX_SUGGESTIONS);
  }, [radar.data, channels.data, lastPiece.data, drafts.data, isAdmin]);

  const hasScores = suggestions.some(
    (item) => item.score && (item.score.relevance !== null || item.score.virality !== null),
  );

  return { suggestions, hasScores, isLoading };
}
