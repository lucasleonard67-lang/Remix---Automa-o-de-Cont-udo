import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { supabase } from "@/integrations/supabase/client";
import { getFunctionErrorMessage } from "@/lib/edge-functions";
import {
  coversRange,
  dailyFromRows,
  dateRange,
  dedupeFollowerSeries,
  onlyConnectedAccounts,
  followerSeriesFromRows,
  normalizeBestTime,
  normalizeDaily,
  normalizeFollowerStats,
  normalizeOverview,
  normalizePosts,
  normalizeTimeline,
  type AccountMetricsRow,
  type BestTimeSlot,
  type DailyPoint,
  type FollowerSeries,
  type Overview,
  type TimelinePoint,
  type ZernioPost,
} from "@/lib/zernio-analytics";

// ---------------------------------------------------------------------------
// Hooks da publicação real via Zernio (Eixo 1 — docs/10-plano-integracoes.md).
// Todo tráfego passa pela edge function zernio-proxy; a key NUNCA chega aqui.
// ---------------------------------------------------------------------------

export const ZERNIO_PLATFORMS = [
  "instagram",
  "twitter",
  "threads",
  "linkedin",
  "facebook",
] as const;
export type ZernioPlatform = (typeof ZERNIO_PLATFORMS)[number];

export const ZERNIO_PLATFORM_LABELS: Record<ZernioPlatform, string> = {
  instagram: "Instagram",
  twitter: "X (Twitter)",
  threads: "Threads",
  linkedin: "LinkedIn",
  facebook: "Facebook",
};

/** channel_type → platform Zernio (espelho de _shared/zernio.ts). */
export const CHANNEL_TO_ZERNIO_PLATFORM: Record<string, ZernioPlatform> = {
  instagram_post: "instagram",
  instagram_carousel: "instagram",
  instagram_stories: "instagram",
  // FALTAVA: sem esta linha o Reel não era mapeável a conta nenhuma — canal
  // habilitado, peça gerada, e nada para onde publicar.
  instagram_reel: "instagram",
  x_post: "twitter",
  threads_post: "threads",
  linkedin_post: "linkedin",
  facebook_post: "facebook",
};

export interface ZernioAccount {
  accountId: string;
  platform: string;
  name: string;
  username: string | null;
  avatar: string | null;
}

async function invokeZernio<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke("zernio-proxy", { body });
  if (error) {
    throw new Error(await getFunctionErrorMessage(error, fallback));
  }
  return data as T;
}

/**
 * Contas sociais conectadas no Zernio. `enabled` evita a chamada antes da key
 * estar configurada (a proxy responderia 400 zernio_not_configured).
 */
export function useZernioAccounts(enabled = true) {
  return useQuery({
    queryKey: ["zernio-accounts"],
    enabled,
    retry: false,
    queryFn: async (): Promise<ZernioAccount[]> => {
      const data = await invokeZernio<{ accounts: ZernioAccount[] }>(
        { action: "list-accounts" },
        "Não foi possível listar as contas conectadas.",
      );
      return dedupeAccounts(data.accounts ?? []);
    },
  });
}

/**
 * O Zernio devolve a MESMA conta duas vezes quando ela foi autorizada mais de
 * uma vez (ids diferentes, mesmo @ na mesma rede). Na tela isso vira "@marca ·
 * 34 seguidores" em dobro e um pedido de escolha de conta ao publicar. Fica a
 * primeira; sem @, o id é o que distingue.
 */
function dedupeAccounts(accounts: ZernioAccount[]): ZernioAccount[] {
  const seen = new Set<string>();
  return accounts.filter((account) => {
    const key = account.username
      ? `${account.platform}:${account.username.toLowerCase()}`
      : `${account.platform}:${account.accountId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** URL OAuth para conectar uma conta da plataforma (admin). Abrir em nova aba. */
export function useConnectUrl() {
  return useMutation({
    mutationFn: async (input: { platform: ZernioPlatform; redirectUrl?: string }) => {
      const data = await invokeZernio<{ url: string }>(
        {
          action: "connect-url",
          platform: input.platform,
          ...(input.redirectUrl ? { redirect_url: input.redirectUrl } : {}),
        },
        "Não foi possível gerar a URL de conexão.",
      );
      return data.url;
    },
  });
}

/** Registra (ou re-registra) o webhook de status no Zernio (admin). */
export function useSetupWebhook() {
  return useMutation({
    mutationFn: async () =>
      invokeZernio<{ ok: boolean; webhook_id: string | null }>(
        { action: "setup-webhook" },
        "Não foi possível ativar o aviso de status do Zernio.",
      ),
  });
}

// ---------------------------------------------------------------------------
// Publicação da peça
// ---------------------------------------------------------------------------

export type PublishStatus =
  "pending" | "scheduled" | "publishing" | "published" | "partial" | "failed" | "cancelled";

export interface PublishedPost {
  id: string;
  piece_id: string;
  request_id: string;
  zernio_post_id: string | null;
  platform: string;
  account_id: string;
  status: PublishStatus;
  scheduled_for: string | null;
  published_at: string | null;
  public_url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export const PUBLISH_STATUS_LABELS: Record<PublishStatus, string> = {
  pending: "Enviando",
  scheduled: "Agendada",
  publishing: "Publicando",
  published: "Publicada",
  partial: "Publicada em parte",
  failed: "Falha ao publicar",
  cancelled: "Cancelada",
};

function invalidatePublishState(queryClient: ReturnType<typeof useQueryClient>, pieceId?: string) {
  if (pieceId) {
    void queryClient.invalidateQueries({ queryKey: ["published-post", pieceId] });
    void queryClient.invalidateQueries({ queryKey: ["piece", pieceId] });
  }
  void queryClient.invalidateQueries({ queryKey: ["published-posts"] });
  void queryClient.invalidateQueries({ queryKey: ["pieces"] });
}

/** Publica agora ou agenda no Zernio (mode 'schedule' usa o scheduled_at da peça). */
export function usePublishPiece() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      pieceId: string;
      mode: "now" | "schedule";
      /** Obrigatória quando mais de uma conta aceita o formato da peça. */
      accountId?: string;
    }) => {
      const data = await invokeZernio<{ published_post: PublishedPost }>(
        {
          action: "publish",
          piece_id: input.pieceId,
          mode: input.mode,
          ...(input.accountId ? { account_id: input.accountId } : {}),
        },
        "Não foi possível publicar a peça.",
      );
      return data.published_post;
    },
    onSuccess: (_data, input) => invalidatePublishState(queryClient, input.pieceId),
  });
}

/** Reconciliação on-demand com o Zernio (1 chamada — ex.: ao abrir a peça). */
export function useSyncPublishStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (pieceId: string) => {
      const data = await invokeZernio<{ published_post: PublishedPost | null }>(
        { action: "get-status", piece_id: pieceId },
        "Não foi possível atualizar o status da publicação.",
      );
      return data.published_post;
    },
    onSuccess: (_data, pieceId) => invalidatePublishState(queryClient, pieceId),
  });
}

/** Retry de publicação com falha que JÁ existe no Zernio. */
export function useRetryPublish() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { publishedPostId: string; pieceId: string }) => {
      const data = await invokeZernio<{ published_post: PublishedPost }>(
        { action: "retry", published_post_id: input.publishedPostId },
        "Não foi possível tentar publicar de novo.",
      );
      return data.published_post;
    },
    onSuccess: (_data, input) => invalidatePublishState(queryClient, input.pieceId),
  });
}

/** Propaga o reagendamento ao Zernio (chamado junto do update de scheduled_at). */
export function useUpdateZernioSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      publishedPostId: string;
      pieceId: string;
      scheduledFor: string;
    }) => {
      const data = await invokeZernio<{ published_post: PublishedPost }>(
        {
          action: "update-schedule",
          published_post_id: input.publishedPostId,
          scheduled_for: input.scheduledFor,
        },
        "Não foi possível reagendar no Zernio.",
      );
      return data.published_post;
    },
    onSuccess: (_data, input) => invalidatePublishState(queryClient, input.pieceId),
  });
}

/** Cancela um agendamento pendente no Zernio. */
export function useCancelPublish() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { publishedPostId: string; pieceId: string }) => {
      const data = await invokeZernio<{ published_post: PublishedPost }>(
        { action: "cancel", published_post_id: input.publishedPostId },
        "Não foi possível cancelar o agendamento.",
      );
      return data.published_post;
    },
    onSuccess: (_data, input) => invalidatePublishState(queryClient, input.pieceId),
  });
}

// ---------------------------------------------------------------------------
// Analytics (Dashboard → Desempenho)
// ---------------------------------------------------------------------------

export type ZernioReport =
  | "overview"
  | "daily-metrics"
  | "follower-stats"
  | "best-time"
  | "post-timeline"
  | "posting-frequency"
  | "content-decay"
  | "ig-insights"
  | "ig-follower-history"
  | "demographics"
  | "tiktok-insights"
  | "youtube-insights";

export type AnalyticsRange = 7 | 30 | 90 | 365;

export const ANALYTICS_RANGE_LABELS: Record<AnalyticsRange, string> = {
  7: "7 dias",
  30: "30 dias",
  90: "90 dias",
  365: "1 ano",
};

/** Título do bloco Desempenho para o período. */
export function analyticsRangeTitle(range: AnalyticsRange): string {
  return range === 365 ? "Último ano" : `Últimos ${range} dias`;
}

// Leituras diárias gravadas pela metrics-sync (supabase/sql/analytics.sql).
// `account_metrics_daily` ainda não está nos types gerados — client não-tipado
// só neste módulo; erro de leitura (tabela ausente) vale como "sem histórico".
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const METRICS_COLUMNS =
  "account_id, platform, username, day, followers, followers_gained, followers_lost, impressions, reach, views, likes, comments, shares, saves, clicks";

async function readAccountRows(
  filter: { accountId: string } | { followers: true },
  fromDate: string,
): Promise<AccountMetricsRow[] | null> {
  let query = db.from("account_metrics_daily").select(METRICS_COLUMNS).gte("day", fromDate);
  query =
    "accountId" in filter
      ? query.eq("account_id", filter.accountId)
      : query.not("followers", "is", null);
  const { data, error } = await query.order("day", { ascending: true }).limit(5000);
  if (error) return null;
  return (data ?? []) as AccountMetricsRow[];
}

/**
 * Primeiro dia com leitura no banco (null = metrics-sync ainda não rodou ou a
 * tabela não existe). Decide se o período "1 ano" aparece.
 */
export function useMetricsHistory(enabled = true) {
  return useQuery({
    queryKey: ["metrics-history"],
    enabled,
    retry: false,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<{ firstDay: string | null }> => {
      const { data, error } = await db
        .from("account_metrics_daily")
        .select("day")
        .order("day", { ascending: true })
        .limit(1);
      if (error) return { firstDay: null };
      const first = (data as Array<{ day: string }> | null)?.[0]?.day ?? null;
      return { firstDay: first };
    },
  });
}

/** Períodos disponíveis: 7/30/90 sempre; "1 ano" só com histórico no banco. */
export function useAnalyticsRanges(enabled = true): AnalyticsRange[] {
  const history = useMetricsHistory(enabled);
  return history.data?.firstDay ? [7, 30, 90, 365] : [7, 30, 90];
}

/**
 * Relatório de analytics do Zernio (passthrough com allowlist na proxy).
 * `enabled=false` enquanto a key/contas não existem — o Dashboard mostra
 * EmptyState em vez de disparar chamadas que falham.
 */
export function useZernioAnalytics<T = Record<string, unknown>>(
  report: ZernioReport,
  params: Record<string, string | number> = {},
  enabled = true,
) {
  return useQuery({
    queryKey: ["zernio-analytics", report, params],
    enabled,
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<T> =>
      invokeZernio<T>(
        { action: "analytics", report, params },
        "Não foi possível carregar o relatório.",
      ),
  });
}

/** Publicações com métricas (GET /v1/analytics) nos últimos `days` dias. */
export function useZernioPosts(days: AnalyticsRange | number, enabled = true) {
  const range = dateRange(days);
  return useQuery({
    queryKey: ["zernio-analytics", "overview", range],
    enabled,
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<{ posts: ZernioPost[]; overview: Overview }> => {
      const raw = await invokeZernio<Record<string, unknown>>(
        {
          action: "analytics",
          report: "overview",
          params: { ...range, limit: 100, sortBy: "date", order: "desc" },
        },
        "Não foi possível carregar as publicações com métricas.",
      );
      return { posts: normalizePosts(raw), overview: normalizeOverview(raw) };
    },
  });
}

/** Um post específico do Zernio (peça publicada) — GET /v1/analytics?postId=. */
export function useZernioPost(zernioPostId: string | null | undefined) {
  return useQuery({
    queryKey: ["zernio-analytics", "post", zernioPostId],
    enabled: Boolean(zernioPostId),
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ZernioPost | null> => {
      const raw = await invokeZernio<Record<string, unknown>>(
        { action: "analytics", report: "overview", params: { postId: zernioPostId as string } },
        "Não foi possível carregar as métricas desta peça.",
      );
      const posts = normalizePosts(raw);
      return (
        posts.find((p) => p.id === zernioPostId || p.latePostId === zernioPostId) ??
        posts[0] ??
        null
      );
    },
  });
}

/**
 * Métricas somadas por dia. Banco primeiro (linha `_all` da metrics-sync) quando
 * ele cobre o período; senão GET /v1/analytics/daily-metrics, com o banco como
 * reserva se o Zernio falhar. Tabela vazia = comportamento de sempre.
 */
export function useZernioDaily(days: AnalyticsRange | number, enabled = true) {
  const range = dateRange(days);
  return useQuery({
    queryKey: ["zernio-analytics", "daily-metrics", range],
    enabled,
    retry: false,
    staleTime: 5 * 60 * 1000,
    // o metrics-sync relê o Zernio a cada 15 min; a tela acompanha
    refetchInterval: 15 * 60 * 1000,
    queryFn: async (): Promise<DailyPoint[]> => {
      const rows = await readAccountRows({ accountId: "_all" }, range.fromDate);
      const stored = rows ? dailyFromRows(rows) : [];
      // Acima de 90 dias o Zernio responde pelos 90 mais recentes e o banco pelo
      // resto; antes o banco valia sozinho e o alcance anterior à 1ª leitura sumia.
      const recent = days > 90 ? dateRange(90) : range;
      if (coversRange(stored[0]?.date ?? null, recent.fromDate, Math.min(days, 90))) return stored;
      try {
        const fresh = normalizeDaily(
          await invokeZernio<Record<string, unknown>>(
            { action: "analytics", report: "daily-metrics", params: recent },
            "Não foi possível carregar as métricas diárias.",
          ),
        );
        if (recent === range) return fresh;
        return [...stored.filter((p) => p.date < recent.fromDate), ...fresh];
      } catch (err) {
        if (stored.length) return stored;
        throw err;
      }
    },
  });
}

/**
 * Seguidores por dia e por conta. Banco primeiro (leitura diária da
 * metrics-sync) quando ele cobre o período; senão GET /v1/accounts/follower-stats,
 * com o banco como reserva se o Zernio falhar.
 */
export function useFollowerStats(days: AnalyticsRange | number, enabled = true) {
  const range = dateRange(days);
  return useQuery({
    queryKey: ["zernio-analytics", "follower-stats", range],
    enabled,
    retry: false,
    staleTime: 15 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
    queryFn: async (): Promise<FollowerSeries[]> => {
      const rows = await readAccountRows({ followers: true }, range.fromDate);
      const stored = rows ? dedupeFollowerSeries(followerSeriesFromRows(rows)) : [];
      const firstDay =
        stored
          .map((s) => s.points[0]?.date ?? null)
          .filter((d): d is string => d !== null)
          .sort()[0] ?? null;
      if (coversRange(firstDay, range.fromDate, days)) return stored;
      try {
        return dedupeFollowerSeries(
          normalizeFollowerStats(
            await invokeZernio<Record<string, unknown>>(
              {
                action: "analytics",
                report: "follower-stats",
                params: { ...range, granularity: "daily" },
              },
              "Não foi possível carregar os seguidores.",
            ),
          ),
        );
      } catch (err) {
        if (stored.length) return stored;
        throw err;
      }
    },
  });
}

/**
 * Seguidores das contas conectadas: a série de cada conta uma vez só. Use esta
 * em toda soma de seguidores (Início, Desempenho); a useFollowerStats crua
 * pode trazer a mesma conta duas vezes.
 */
export function useAccountFollowerStats(days: AnalyticsRange | number, enabled = true) {
  const accounts = useZernioAccounts(enabled);
  const stats = useFollowerStats(days, enabled);
  const data = useMemo(
    () => onlyConnectedAccounts(stats.data, accounts.data),
    [stats.data, accounts.data],
  );
  return { ...stats, data };
}

/** Evolução de um post ao longo dos dias (GET /v1/analytics/post-timeline). */
export function useZernioPostTimeline(postId: string | null | undefined) {
  return useQuery({
    queryKey: ["zernio-analytics", "post-timeline", postId],
    enabled: Boolean(postId),
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<TimelinePoint[]> =>
      normalizeTimeline(
        await invokeZernio<Record<string, unknown>>(
          { action: "analytics", report: "post-timeline", params: { postId: postId as string } },
          "Não foi possível carregar a linha do tempo da publicação.",
        ),
      ),
  });
}

/** Melhor horário para publicar, já calculado pelo Zernio. */
export function useZernioBestTime(enabled = true) {
  return useQuery({
    queryKey: ["zernio-analytics", "best-time"],
    enabled,
    retry: false,
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<BestTimeSlot[]> =>
      normalizeBestTime(
        await invokeZernio<Record<string, unknown>>(
          { action: "analytics", report: "best-time", params: {} },
          "Não foi possível calcular o melhor horário.",
        ),
      ),
  });
}

/**
 * Insights de conta por plataforma (Instagram: alcance/views/interações com
 * até 48h de atraso; TikTok: exige o escopo user.info.stats — 412 sem ele).
 * Devolve o payload cru: o consumidor decide o que ler.
 */
export function useZernioInsights(
  platform: "instagram" | "tiktok" | "youtube" | null | undefined,
  accountId: string | null | undefined,
  days: AnalyticsRange | number = 30,
) {
  const range = dateRange(days);
  const report: ZernioReport | null =
    platform === "instagram"
      ? "ig-insights"
      : platform === "tiktok"
        ? "tiktok-insights"
        : platform === "youtube"
          ? "youtube-insights"
          : null;
  const params: Record<string, string | number> =
    platform === "instagram"
      ? {
          accountId: accountId ?? "",
          metrics: "reach,views,accounts_engaged,total_interactions",
          since: range.fromDate,
          until: range.toDate,
          metric_type: "total_value",
        }
      : platform === "tiktok"
        ? {
            accountId: accountId ?? "",
            metrics: "follower_count,likes_count,video_count,followers_gained,followers_lost",
          }
        : { accountId: accountId ?? "" };
  return useQuery({
    queryKey: ["zernio-analytics", report, params],
    enabled: Boolean(report && accountId),
    retry: false,
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<Record<string, unknown>> =>
      invokeZernio<Record<string, unknown>>(
        { action: "analytics", report, params },
        "Não foi possível carregar os insights da conta.",
      ),
  });
}

// ---------------------------------------------------------------------------
// Vídeo do Diretor → Reel no Instagram. O estado volta em
// director_jobs.artifacts.instagram (Realtime de director_jobs atualiza o card).
// ---------------------------------------------------------------------------

export function usePublishDirectorInstagram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { jobId: string; caption: string }) =>
      invokeZernio(
        { action: "publish-director", job_id: input.jobId, caption: input.caption },
        "Não foi possível publicar o vídeo no Instagram.",
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["director-jobs"] }),
  });
}

export function useSyncDirectorInstagram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) =>
      invokeZernio(
        { action: "director-status", job_id: jobId },
        "Não foi possível consultar o status no Instagram.",
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["director-jobs"] }),
  });
}
