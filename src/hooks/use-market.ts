import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useAppSetting, useSecretStatus } from "@/hooks/use-app-settings";
import { getFunctionErrorMessage } from "@/lib/edge-functions";
import { toast } from "@/lib/toast";
import { dateRange } from "@/lib/zernio-analytics";

// ---------------------------------------------------------------------------
// Mercado (Dashboard): concorrentes do Instagram e os posts deles, lidos pelo
// Apify na edge function competitor-sync e pontuados no critério do Radar. O
// resumo pronto fica em app_settings.market; a lista de concorrentes vem da
// tabela `competitors` (leitura autenticada pela RLS; supabase/sql/market.sql).
// Toda escrita passa pela edge function (admin).
//
// TODO(types): `competitors` ainda não existe em integrations/supabase/types.ts
// — o Lovable regenera no deploy; remover o cast depois.
// ---------------------------------------------------------------------------

export type MarketFormat = "image" | "carousel" | "reel";

export const MARKET_FORMAT_LABELS: Record<MarketFormat, string> = {
  image: "Imagem",
  carousel: "Carrossel",
  reel: "Reel",
};

export interface Competitor {
  id: string;
  handle: string;
  name: string | null;
  avatar_url: string | null;
  followers: number | null;
  enabled: boolean;
  last_sync_at: string | null;
  last_error: string | null;
}

export interface MarketTopPost {
  id: string;
  handle: string;
  name: string | null;
  url: string | null;
  caption: string | null;
  media_type: MarketFormat | null;
  thumbnail_url: string | null;
  posted_at: string | null;
  likes: number | null;
  comments: number | null;
  views: number | null;
  /** (curtidas + comentários + views × 0,1) ÷ seguidores — fração, não %. */
  engagement: number | null;
  virality: number | null;
  relevance: number | null;
  topics: string[];
  score_reason: string | null;
  /** Ângulo sugerido para a marca fazer a própria versão. */
  angle: string | null;
}

export interface MarketSummary {
  synced_at: string;
  competitors: Array<{
    id: string;
    handle: string;
    name: string | null;
    avatar_url: string | null;
    followers: number | null;
    posts: number;
    avg_engagement: number | null;
    last_sync_at: string | null;
    last_error: string | null;
  }>;
  top_posts: MarketTopPost[];
  insights: string[];
  vs_me: {
    my_avg_engagement: number | null;
    market_avg_engagement: number | null;
    my_best_format: MarketFormat | null;
    market_best_format: MarketFormat | null;
    my_posts: number;
  } | null;
}

// `competitors` fora dos types gerados — client não-tipado só neste módulo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

async function invokeMarket<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke("competitor-sync", { body });
  if (error) throw new Error(await getFunctionErrorMessage(error, fallback));
  return data as T;
}

/** Apify conectado? (token no Vault, via store-secret status). */
export function useApifyConfigured(): { configured: boolean; isLoading: boolean } {
  const secrets = useSecretStatus();
  return {
    configured: secrets.data?.includes("APIFY_TOKEN") ?? false,
    isLoading: secrets.isLoading,
  };
}

/** Resumo pronto para o Dashboard (app_settings.market). */
export function useMarketSummary() {
  return useAppSetting<MarketSummary>("market");
}

/** Post de concorrente reduzido ao que o gráfico Concorrentes precisa. */
export interface CompetitorPostLite {
  competitor_id: string;
  posted_at: string | null;
  media_type: MarketFormat | null;
  /** mesma fração do MarketTopPost.engagement */
  engagement: number | null;
}

/** Posts dos concorrentes no período do gráfico (leitura direta: RLS libera select). */
export function useCompetitorPosts(days: number, enabled = true) {
  const { fromDate } = dateRange(days);
  return useQuery({
    queryKey: ["competitor-posts", fromDate],
    enabled,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<CompetitorPostLite[]> => {
      const { data, error } = await db
        .from("competitor_posts")
        .select("competitor_id, posted_at, media_type, engagement")
        .gte("posted_at", fromDate)
        .order("posted_at", { ascending: false })
        .limit(1000);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        competitor_id: String(r.competitor_id),
        posted_at: typeof r.posted_at === "string" ? r.posted_at : null,
        media_type: asFormat(r.media_type),
        // numeric do Postgres chega como texto
        engagement:
          r.engagement === null || r.engagement === undefined ? null : Number(r.engagement),
      }));
    },
  });
}

/** Foto diária dos seguidores de cada concorrente (competitor_metrics_daily). */
export interface CompetitorFollowerPoint {
  competitor_id: string;
  day: string;
  followers: number | null;
}

export function useCompetitorFollowerHistory(days: number, enabled = true) {
  const { fromDate } = dateRange(days);
  return useQuery({
    queryKey: ["competitor-followers", fromDate],
    enabled,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<CompetitorFollowerPoint[]> => {
      const { data, error } = await db
        .from("competitor_metrics_daily")
        .select("competitor_id, day, followers")
        .gte("day", fromDate)
        .order("day", { ascending: true })
        .limit(5000);
      // tabela ainda não aplicada na instância → sem histórico, sem erro na tela
      if (error) return [];
      return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        competitor_id: String(r.competitor_id),
        day: String(r.day),
        followers: r.followers === null || r.followers === undefined ? null : Number(r.followers),
      }));
    },
  });
}

function asFormat(v: unknown): MarketFormat | null {
  return v === "image" || v === "carousel" || v === "reel" ? v : null;
}

export function useCompetitors() {
  return useQuery({
    queryKey: ["competitors"],
    queryFn: async (): Promise<Competitor[]> => {
      const { data, error } = await db
        .from("competitors")
        .select("id, handle, name, avatar_url, followers, enabled, last_sync_at, last_error")
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as Competitor[];
    },
  });
}

export function useAddCompetitor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (handle: string): Promise<Competitor> => {
      const data = await invokeMarket<{ competitor: Competitor }>(
        { action: "add", handle },
        "Não foi possível adicionar o concorrente. Tente de novo.",
      );
      return data.competitor;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["competitors"] });
    },
  });
}

export function useRemoveCompetitor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await invokeMarket<{ ok: boolean }>(
        { action: "remove", id },
        "Não foi possível remover o concorrente. Tente de novo.",
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["competitors"] });
      void queryClient.invalidateQueries({ queryKey: ["app-settings", "market"] });
    },
  });
}

export interface SyncProgress {
  running: boolean;
  /** Perfis já lidos nesta rodada. */
  done: number;
  /** Total estimado (lidos + restantes informados pela função). */
  total: number;
  /** Aviso humano da última chamada (ex.: IA sem créditos). */
  warning: string | null;
  error: string | null;
}

type SyncResponse = {
  synced: Array<{ id: string; handle: string; posts: number; error: string | null }>;
  remaining: number;
  warning: string | null;
};

const IDLE: SyncProgress = { running: false, done: 0, total: 0, warning: null, error: null };

/**
 * Sincronização retomável: a função lê até 2 perfis por chamada e devolve
 * `remaining`; aqui repetimos com o mesmo `before` até zerar. `start(id)`
 * sincroniza um concorrente só (recém-adicionado).
 */
export function useSyncMarket() {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<SyncProgress>(IDLE);
  const active = useRef(false);

  const start = useCallback(
    async (competitorId?: string): Promise<void> => {
      if (active.current) return;
      active.current = true;
      setProgress({
        running: true,
        done: 0,
        total: competitorId ? 1 : 0,
        warning: null,
        error: null,
      });
      const before = new Date().toISOString();
      let done = 0;
      let warning: string | null = null;
      try {
        // Teto de chamadas por rodada: 12 concorrentes ÷ 2 por chamada.
        for (let i = 0; i < 8; i++) {
          const data = await invokeMarket<SyncResponse>(
            competitorId
              ? { action: "sync", competitor_id: competitorId }
              : { action: "sync", before },
            "Não foi possível ler os concorrentes agora. Tente de novo.",
          );
          done += data.synced.length;
          warning = data.warning;
          setProgress({
            running: data.remaining > 0,
            done,
            total: done + data.remaining,
            warning: data.warning,
            error: null,
          });
          void queryClient.invalidateQueries({ queryKey: ["competitors"] });
          void queryClient.invalidateQueries({ queryKey: ["app-settings", "market"] });
          if (competitorId || data.remaining <= 0) break;
        }
        // a leitura leva minutos e segue com o modal fechado: o fim tem de aparecer
        if (done > 0) {
          toast.success(
            competitorId
              ? "Posts do concorrente lidos"
              : `${done} ${done === 1 ? "concorrente lido" : "concorrentes lidos"}`,
            { description: warning ?? "O Mercado já mostra os resultados." },
          );
        }
      } catch (error) {
        setProgress((prev) => ({
          ...prev,
          running: false,
          error:
            error instanceof Error ? error.message : "Não foi possível ler os concorrentes agora.",
        }));
        void queryClient.invalidateQueries({ queryKey: ["competitors"] });
        throw error;
      } finally {
        active.current = false;
        setProgress((prev) => ({ ...prev, running: false }));
      }
    },
    [queryClient],
  );

  return { start, progress };
}

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

/** 1234 → "1,2 mil" · 2500000 → "2,5 mi" · null → "—". */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000)
    return `${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (value >= 10_000) return `${Math.round(value / 1000).toLocaleString("pt-BR")} mil`;
  if (value >= 1_000)
    return `${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return value.toLocaleString("pt-BR");
}

/** Fração → "3,4%" (uma casa abaixo de 10%, nenhuma acima). */
export function formatEngagement(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const pct = value * 100;
  return `${pct.toLocaleString("pt-BR", { maximumFractionDigits: pct >= 10 ? 0 : 1 })}%`;
}

/** Brief para "Criar a minha versão": resumo do post + ângulo da marca. */
export function briefFromPost(post: MarketTopPost): string {
  const format = post.media_type ? MARKET_FORMAT_LABELS[post.media_type].toLowerCase() : "post";
  const caption = post.caption ? post.caption.replace(/\s+/g, " ").slice(0, 160) : "";
  const parts = [
    `Referência: ${format} de @${post.handle}${caption ? ` — “${caption}”` : ""}.`,
    post.score_reason ? `Por que funcionou: ${post.score_reason}` : null,
    post.angle
      ? `Ângulo da marca: ${post.angle}`
      : "Fazer a nossa versão com a postura e as teses da marca, sem copiar.",
  ];
  return parts.filter(Boolean).join(" ").slice(0, 600);
}
