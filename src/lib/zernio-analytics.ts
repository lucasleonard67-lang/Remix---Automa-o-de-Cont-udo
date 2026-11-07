// ---------------------------------------------------------------------------
// Normalização dos relatórios de analytics do Zernio (GET /v1/analytics,
// /v1/analytics/daily-metrics, /v1/accounts/follower-stats, best-time,
// post-timeline). Único lugar que conhece o formato cru: a API HTTP devolve
// camelCase em parte dos campos e o cliente gerado usa snake_case — aqui os
// dois são aceitos. Métrica ausente vira null (nunca 0 fabricado).
//
// Sem dependências do app: o arquivo roda em Node puro para o script de
// verificação (scratchpad) e nos componentes.
// ---------------------------------------------------------------------------

type Loose = Record<string, unknown>;

export const METRICS = [
  "reach",
  "impressions",
  "views",
  "likes",
  "comments",
  "saves",
  "shares",
  "clicks",
] as const;
export type Metric = (typeof METRICS)[number];

export const METRIC_LABELS: Record<Metric, string> = {
  reach: "Alcance",
  impressions: "Impressões",
  views: "Visualizações",
  likes: "Curtidas",
  comments: "Comentários",
  saves: "Salvamentos",
  shares: "Compartilhamentos",
  clicks: "Cliques",
};

export interface PostAnalytics extends Record<Metric, number | null> {
  engagementRate: number | null;
  lastUpdated: string | null;
}

export type SyncStatus = "synced" | "pending" | "unavailable" | null;

export type MediaType = "image" | "video" | "gif" | "document" | "carousel" | "text" | "unknown";

export const MEDIA_TYPE_LABELS: Record<MediaType, string> = {
  image: "Imagem",
  video: "Vídeo",
  gif: "GIF",
  document: "Documento",
  carousel: "Carrossel",
  text: "Texto",
  unknown: "—",
};

export interface PostPlatform {
  platform: string;
  status: string | null;
  platformPostId: string | null;
  accountId: string | null;
  accountUsername: string | null;
  analytics: PostAnalytics;
  syncStatus: SyncStatus;
  url: string | null;
  errorMessage: string | null;
}

export interface ZernioPost {
  id: string;
  latePostId: string | null;
  content: string;
  scheduledFor: string | null;
  publishedAt: string | null;
  /** publishedAt, ou scheduledFor como reserva — o que a tabela ordena. */
  date: string | null;
  status: string | null;
  analytics: PostAnalytics;
  platforms: PostPlatform[];
  platform: string | null;
  url: string | null;
  isExternal: boolean;
  thumbnailUrl: string | null;
  mediaType: MediaType;
  syncStatus: SyncStatus;
  accountUsername: string | null;
  accountId: string | null;
}

export interface Overview {
  totalPosts: number | null;
  publishedPosts: number | null;
  scheduledPosts: number | null;
  lastSync: string | null;
  staleAccountCount: number | null;
  syncTriggered: boolean;
}

export interface DailyPoint extends Record<Metric, number | null> {
  date: string;
}

export interface FollowerPoint {
  date: string;
  followers: number;
  /** ganhos e perdidos no dia, quando a fonte informa (metrics-sync grava) */
  gained?: number | null;
  lost?: number | null;
}

export interface FollowerSeries {
  accountId: string;
  platform: string | null;
  username: string | null;
  points: FollowerPoint[];
}

export interface TimelinePoint extends Record<Metric, number | null> {
  date: string;
}

export interface BestTimeSlot {
  /** 0 = domingo … 6 = sábado, já no fuso de quem olha */
  dayOfWeek: number;
  /** hora local 0–23 */
  hour: number | null;
  /** engajamento médio (curtidas + comentários + compartilhamentos + salvamentos) */
  score: number | null;
  postCount: number | null;
}

// ---------------------------------------------------------------------------
// Leitura tolerante (snake_case / camelCase)
// ---------------------------------------------------------------------------

function toCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

function isRecord(value: unknown): value is Loose {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Primeiro valor definido entre as chaves (cada uma testada em snake e camel). */
function read(source: Loose | null | undefined, ...keys: string[]): unknown {
  if (!source) return undefined;
  for (const key of keys) {
    for (const candidate of [key, toCamel(key)]) {
      const value = source[candidate];
      if (value !== undefined && value !== null) return value;
    }
  }
  return undefined;
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function arr(value: unknown): Loose[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

const EMPTY_ANALYTICS: PostAnalytics = {
  reach: null,
  impressions: null,
  views: null,
  likes: null,
  comments: null,
  saves: null,
  shares: null,
  clicks: null,
  engagementRate: null,
  lastUpdated: null,
};

export function normalizeAnalytics(raw: unknown): PostAnalytics {
  if (!isRecord(raw)) return { ...EMPTY_ANALYTICS };
  const out: PostAnalytics = { ...EMPTY_ANALYTICS };
  for (const metric of METRICS) out[metric] = num(read(raw, metric));
  out.engagementRate = num(read(raw, "engagement_rate"));
  out.lastUpdated = str(read(raw, "last_updated"));
  return out;
}

function normalizeSync(value: unknown): SyncStatus {
  return value === "synced" || value === "pending" || value === "unavailable" ? value : null;
}

function normalizeMediaType(value: unknown): MediaType {
  switch (value) {
    case "image":
    case "video":
    case "gif":
    case "document":
    case "carousel":
    case "text":
      return value;
    default:
      return "unknown";
  }
}

function normalizePlatform(raw: Loose): PostPlatform {
  return {
    platform: str(read(raw, "platform")) ?? "unknown",
    status: str(read(raw, "status")),
    platformPostId: str(read(raw, "platform_post_id")),
    accountId: str(read(raw, "account_id")),
    accountUsername: str(read(raw, "account_username")),
    analytics: normalizeAnalytics(read(raw, "analytics")),
    syncStatus: normalizeSync(read(raw, "sync_status")),
    url: str(read(raw, "platform_post_url")),
    errorMessage: str(read(raw, "error_message")),
  };
}

/** Métrica consolidada: a do post, ou a soma das plataformas quando o topo veio vazio. */
function mergeAnalytics(top: PostAnalytics, platforms: PostPlatform[]): PostAnalytics {
  const hasTop = METRICS.some((m) => top[m] !== null);
  if (hasTop || platforms.length === 0) return top;
  const merged: PostAnalytics = { ...EMPTY_ANALYTICS };
  for (const metric of METRICS) {
    const values = platforms.map((p) => p.analytics[metric]).filter((v): v is number => v !== null);
    merged[metric] = values.length ? values.reduce((a, b) => a + b, 0) : null;
  }
  const rates = platforms
    .map((p) => p.analytics.engagementRate)
    .filter((v): v is number => v !== null);
  merged.engagementRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
  merged.lastUpdated =
    platforms
      .map((p) => p.analytics.lastUpdated)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
  return merged;
}

export function normalizePost(raw: unknown): ZernioPost | null {
  if (!isRecord(raw)) return null;
  const id = str(read(raw, "_id", "id", "late_post_id"));
  if (!id) return null;
  const platforms = arr(read(raw, "platforms")).map(normalizePlatform);
  const first = platforms[0];
  const publishedAt = str(read(raw, "published_at"));
  const scheduledFor = str(read(raw, "scheduled_for"));
  const syncStatuses = platforms.map((p) => p.syncStatus);
  const syncStatus: SyncStatus = syncStatuses.includes("synced")
    ? "synced"
    : syncStatuses.includes("pending")
      ? "pending"
      : syncStatuses.includes("unavailable")
        ? "unavailable"
        : null;

  return {
    id,
    latePostId: str(read(raw, "late_post_id")),
    content: str(read(raw, "content")) ?? "",
    scheduledFor,
    publishedAt,
    date: publishedAt ?? scheduledFor,
    status: str(read(raw, "status")),
    analytics: mergeAnalytics(normalizeAnalytics(read(raw, "analytics")), platforms),
    platforms,
    platform: str(read(raw, "platform")) ?? first?.platform ?? null,
    url: str(read(raw, "platform_post_url")) ?? first?.url ?? null,
    isExternal: read(raw, "is_external") === true,
    thumbnailUrl: str(read(raw, "thumbnail_url")),
    mediaType: normalizeMediaType(read(raw, "media_type")),
    syncStatus,
    accountUsername: first?.accountUsername ?? null,
    accountId: first?.accountId ?? null,
  };
}

export function normalizeOverview(raw: unknown): Overview {
  const source = isRecord(raw) ? (read(raw, "overview") as Loose | undefined) : undefined;
  const staleness = source ? (read(source, "data_staleness") as Loose | undefined) : undefined;
  return {
    totalPosts: num(read(source, "total_posts")),
    publishedPosts: num(read(source, "published_posts")),
    scheduledPosts: num(read(source, "scheduled_posts")),
    lastSync: str(read(source, "last_sync")),
    staleAccountCount: num(read(staleness, "stale_account_count")),
    syncTriggered: read(staleness, "sync_triggered") === true,
  };
}

export function normalizePosts(raw: unknown): ZernioPost[] {
  const list = isRecord(raw) ? read(raw, "posts", "data") : raw;
  return dedupePosts(
    arr(list)
      .map(normalizePost)
      .filter((p): p is ZernioPost => p !== null),
  );
}

/**
 * O Zernio pode devolver a mesma publicação duas vezes (o post agendado por
 * ele e a importação externa do mesmo item). Mesmo link ou mesmo id na rede =
 * mesma publicação; sem esses, mesma conta + dia + texto. Fica a que tem
 * métrica sincronizada (ou a primeira).
 */
export function dedupePosts(posts: ZernioPost[]): ZernioPost[] {
  const keyOf = (p: ZernioPost): string | null => {
    const platformId = p.platforms.map((x) => x.platformPostId).find(Boolean);
    if (platformId) return `id:${p.platform ?? ""}:${platformId}`;
    if (p.url) return `url:${p.url}`;
    const day = p.date?.slice(0, 10);
    const text = p.content.trim();
    if (day && text) return `txt:${p.accountId ?? p.platform ?? ""}:${day}:${text}`;
    return null;
  };
  const byKey = new Map<string, number>();
  const out: ZernioPost[] = [];
  for (const post of posts) {
    const key = keyOf(post);
    if (key === null) {
      out.push(post);
      continue;
    }
    const at = byKey.get(key);
    if (at === undefined) {
      byKey.set(key, out.length);
      out.push(post);
    } else if (out[at].syncStatus !== "synced" && post.syncStatus === "synced") {
      out[at] = post;
    }
  }
  return out;
}

/** Aceita "2026-10-21", ISO completo ou epoch; devolve YYYY-MM-DD ou null. */
export function toDateKey(value: unknown): string | null {
  if (typeof value === "number") {
    const d = new Date(value < 1e12 ? value * 1000 : value);
    return Number.isNaN(d.getTime()) ? null : isoDate(d);
  }
  const text = str(value);
  if (!text) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  if (match) return match[1];
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : isoDate(d);
}

export function normalizeDaily(raw: unknown): DailyPoint[] {
  const list = isRecord(raw) ? read(raw, "daily_data", "daily", "data") : raw;
  const points: DailyPoint[] = [];
  for (const item of arr(list)) {
    const date = toDateKey(read(item, "date", "day"));
    if (!date) continue;
    const metrics = (read(item, "metrics") as Loose | undefined) ?? item;
    const point = { date } as DailyPoint;
    for (const metric of METRICS) point[metric] = num(read(metrics, metric));
    points.push(point);
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeFollowerPoints(list: unknown): FollowerPoint[] {
  return arr(list)
    .map((item): FollowerPoint | null => {
      const date = toDateKey(read(item, "date", "day"));
      const followers = num(read(item, "followers", "follower_count", "count", "value"));
      if (!date || followers === null) return null;
      return {
        date,
        followers,
        gained: num(read(item, "followers_gained", "gained", "follows")),
        lost: num(read(item, "followers_lost", "lost", "unfollows")),
      };
    })
    .filter((p): p is FollowerPoint => p !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Lê o formato { accounts, stats }; null quando a resposta não está nele. */
function followersFromStatsMap(raw: Loose): FollowerSeries[] | null {
  const stats = read(raw, "stats");
  const accounts = arr(read(raw, "accounts"));
  if (!isRecord(stats) && !accounts.some((a) => read(a, "current_followers") !== undefined))
    return null;
  const meta = new Map<string, Loose>();
  for (const account of accounts) {
    const id = str(read(account, "_id", "id", "account_id"));
    if (id) meta.set(id, account);
  }
  const ids = new Set<string>([...(isRecord(stats) ? Object.keys(stats) : []), ...meta.keys()]);
  const today = new Date().toISOString().slice(0, 10);
  const series: FollowerSeries[] = [];
  for (const id of ids) {
    const value = isRecord(stats) ? stats[id] : undefined;
    const list = Array.isArray(value)
      ? value
      : isRecord(value)
        ? read(value, "data", "stats", "history", "daily", "points")
        : undefined;
    const points = normalizeFollowerPoints(list);
    const account = meta.get(id);
    // conta sem histórico ainda: o total de hoje vira o primeiro ponto
    const current = num(read(account, "current_followers", "followers"));
    if (!points.length && current !== null) {
      points.push({ date: today, followers: current });
    }
    series.push({
      accountId: id,
      platform: str(read(account, "platform")),
      username: str(read(account, "username", "display_name", "name")),
      points,
    });
  }
  return series;
}

export function normalizeFollowerStats(raw: unknown): FollowerSeries[] {
  if (!isRecord(raw)) return [];
  // Formato atual do Zernio: { accounts: [resumo por conta], stats: { <id>: [{date, followers}] } }.
  // A série está em `stats`; `accounts` só traz nome, rede e o total de hoje.
  const byStats = followersFromStatsMap(raw);
  if (byStats) return byStats;
  const source = read(raw, "accounts", "stats", "data") ?? raw;
  const series: FollowerSeries[] = [];

  if (Array.isArray(source)) {
    const items = arr(source);
    // Formato A: lista de contas, cada uma com a própria série.
    const nested = items.filter((item) =>
      Array.isArray(read(item, "data", "stats", "history", "daily", "points")),
    );
    if (nested.length) {
      for (const item of nested) {
        series.push({
          accountId: str(read(item, "account_id", "_id", "id")) ?? `conta-${series.length + 1}`,
          platform: str(read(item, "platform")),
          username: str(read(item, "username", "account_username", "name")),
          points: normalizeFollowerPoints(
            read(item, "data", "stats", "history", "daily", "points"),
          ),
        });
      }
      return series;
    }
    // Formato B: lista plana {date, followers, accountId} → agrupa por conta.
    const groups = new Map<
      string,
      { platform: string | null; username: string | null; rows: Loose[] }
    >();
    for (const item of items) {
      const key = str(read(item, "account_id", "accountId")) ?? "conta";
      const group = groups.get(key) ?? {
        platform: str(read(item, "platform")),
        username: str(read(item, "username", "account_username")),
        rows: [],
      };
      group.rows.push(item);
      groups.set(key, group);
    }
    for (const [accountId, group] of groups) {
      series.push({
        accountId,
        platform: group.platform,
        username: group.username,
        points: normalizeFollowerPoints(group.rows),
      });
    }
    return series;
  }

  if (isRecord(source)) {
    // Formato C: mapa accountId → série (ou → {platform, data: [...]}).
    for (const [accountId, value] of Object.entries(source)) {
      if (accountId === "date_range" || accountId === "dateRange") continue;
      if (Array.isArray(value)) {
        series.push({
          accountId,
          platform: null,
          username: null,
          points: normalizeFollowerPoints(value),
        });
      } else if (isRecord(value)) {
        series.push({
          accountId,
          platform: str(read(value, "platform")),
          username: str(read(value, "username", "account_username")),
          points: normalizeFollowerPoints(
            read(value, "data", "stats", "history", "daily", "points"),
          ),
        });
      }
    }
  }
  return series;
}

// ---------------------------------------------------------------------------
// Leituras gravadas pela metrics-sync (tabelas de supabase/sql/analytics.sql).
// Linha `_all` de account_metrics_daily = soma do dia; linhas com account_id
// real = seguidores da conta. Métrica ausente continua null.
// ---------------------------------------------------------------------------

export interface AccountMetricsRow {
  account_id: string;
  platform: string | null;
  username?: string | null;
  day: string;
  followers?: number | string | null;
  followers_gained?: number | string | null;
  followers_lost?: number | string | null;
  impressions?: number | string | null;
  reach?: number | string | null;
  views?: number | string | null;
  likes?: number | string | null;
  comments?: number | string | null;
  shares?: number | string | null;
  saves?: number | string | null;
  clicks?: number | string | null;
}

/** Linhas `_all` (ou `_platform:<rede>`) → série diária, ordenada. */
export function dailyFromRows(rows: AccountMetricsRow[]): DailyPoint[] {
  const points: DailyPoint[] = [];
  for (const row of rows) {
    const date = toDateKey(row.day);
    if (!date) continue;
    const point = { date } as DailyPoint;
    for (const metric of METRICS) point[metric] = num(row[metric]);
    points.push(point);
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

/** Linhas por conta (followers não nulo) → uma série por conta, ordenada. */
export function followerSeriesFromRows(rows: AccountMetricsRow[]): FollowerSeries[] {
  const byAccount = new Map<string, FollowerSeries>();
  for (const row of rows) {
    if (row.account_id.startsWith("_")) continue;
    const date = toDateKey(row.day);
    const followers = num(row.followers);
    if (!date || followers === null) continue;
    const series = byAccount.get(row.account_id) ?? {
      accountId: row.account_id,
      platform: row.platform ?? null,
      username: row.username ?? null,
      points: [],
    };
    series.platform ??= row.platform ?? null;
    series.username ??= row.username ?? null;
    series.points.push({
      date,
      followers,
      gained: num(row.followers_gained),
      lost: num(row.followers_lost),
    });
    byAccount.set(row.account_id, series);
  }
  for (const series of byAccount.values()) {
    series.points.sort((a, b) => a.date.localeCompare(b.date));
  }
  return [...byAccount.values()];
}

/**
 * O banco cobre o período quando a primeira leitura é do início dele (1 dia de
 * folga: a sync grava ontem e hoje). Acima de 90 dias o Zernio não ajuda, então
 * qualquer leitura serve.
 */
export function coversRange(firstDate: string | null, fromDate: string, days: number): boolean {
  if (!firstDate) return false;
  if (days > 90) return true;
  const limit = isoDate(daysAgo(-1, new Date(`${fromDate}T12:00:00`)));
  return firstDate <= limit;
}

/** Soma as contas por dia; dia sem leitura de uma conta repete a última conhecida. */
/**
 * Soma das contas por dia. Começa no primeiro dia em que TODAS as contas já
 * têm leitura: antes disso a soma seria parcial (uma conta a 34, as outras
 * ainda sem número) e desenharia um "salto" de seguidores que nunca houve.
 */
export function mergeFollowerSeries(series: FollowerSeries[]): FollowerPoint[] {
  const active = series.filter((s) => s.points.length > 0);
  if (active.length === 0) return [];
  const start =
    active
      .map((s) => s.points[0].date)
      .sort()
      .at(-1) ?? "";
  const dates = new Set<string>();
  for (const s of active) for (const p of s.points) if (p.date >= start) dates.add(p.date);
  const sorted = [...dates].sort();
  const last = new Map<string, number>();
  for (const s of active) {
    // valor de cada conta na data de partida (último ponto até lá)
    const at = [...s.points].filter((p) => p.date <= start).at(-1);
    if (at) last.set(s.accountId, at.followers);
  }
  const result: FollowerPoint[] = [];
  for (const date of sorted) {
    let gained: number | null = 0;
    let lost: number | null = 0;
    for (const s of active) {
      const hit = s.points.find((p) => p.date === date);
      if (!hit) continue;
      last.set(s.accountId, hit.followers);
      gained = gained === null || hit.gained == null ? null : gained + hit.gained;
      lost = lost === null || hit.lost == null ? null : lost + hit.lost;
    }
    let total = 0;
    for (const value of last.values()) total += value;
    result.push({ date, followers: total, gained, lost });
  }
  return result;
}

/**
 * Saldo de seguidores do dia: ganhos − perdidos quando a fonte informa; senão a
 * diferença para o dia anterior (null no primeiro ponto, que não tem com o que
 * comparar). É o que vira as barras sob a linha de seguidores.
 */
export function followerBalance(points: FollowerPoint[]): Array<number | null> {
  return points.map((p, i) => {
    if (p.gained != null && p.lost != null) return p.gained - p.lost;
    if (i === 0) return null;
    return p.followers - points[i - 1].followers;
  });
}

export function latestFollowers(series: FollowerSeries): number | null {
  return series.points.at(-1)?.followers ?? null;
}

export function normalizeTimeline(raw: unknown): TimelinePoint[] {
  const list = isRecord(raw)
    ? read(raw, "timeline", "data", "points", "history", "snapshots")
    : raw;
  const points: TimelinePoint[] = [];
  for (const item of arr(list)) {
    const date = toDateKey(
      read(item, "date", "timestamp", "recorded_at", "collected_at", "created_at"),
    );
    if (!date) continue;
    const metrics = (read(item, "metrics", "analytics") as Loose | undefined) ?? item;
    const point = { date } as TimelinePoint;
    for (const metric of METRICS) point[metric] = num(read(metrics, metric));
    points.push(point);
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * GET /v1/analytics/best-time devolve `slots[]` com day_of_week 0 = SEGUNDA …
 * 6 = domingo e `hour` em UTC. Aqui vira 0 = domingo (como WEEKDAY_LABELS) e
 * hora local; virar a meia-noite muda o dia junto.
 * `utcOffsetMinutes` = minutos a leste de UTC (São Paulo: −180).
 */
export function normalizeBestTime(
  raw: unknown,
  utcOffsetMinutes = typeof Date !== "undefined" ? -new Date().getTimezoneOffset() : 0,
): BestTimeSlot[] {
  const list = isRecord(raw)
    ? read(raw, "best_times", "slots", "results", "recommendations", "data")
    : raw;
  return arr(list)
    .map((item): BestTimeSlot | null => {
      const day = num(read(item, "day_of_week", "day", "weekday"));
      if (day === null || day < 0 || day > 6) return null;
      let dayOfWeek = (Math.trunc(day) + 1) % 7; // segunda=0 → domingo=0
      const utcHour = num(read(item, "hour", "hour_of_day"));
      let hour: number | null = null;
      if (utcHour !== null) {
        const shifted = Math.trunc(utcHour) + Math.round(utcOffsetMinutes / 60);
        hour = ((shifted % 24) + 24) % 24;
        dayOfWeek = (((dayOfWeek + Math.floor(shifted / 24)) % 7) + 7) % 7;
      }
      return {
        dayOfWeek,
        hour,
        score: num(read(item, "score", "engagement", "avg_engagement", "average_engagement")),
        postCount: num(read(item, "post_count", "posts", "count")),
      };
    })
    .filter((s): s is BestTimeSlot => s !== null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function daysAgo(n: number, from = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() - n);
  return d;
}

/** `{fromDate, toDate}` em YYYY-MM-DD cobrindo os últimos `days` dias (hoje incluso). */
export function dateRange(days: number, now = new Date()): { fromDate: string; toDate: string } {
  return { fromDate: isoDate(daysAgo(days - 1, now)), toDate: isoDate(now) };
}

export function inRange(dateKey: string | null, from: string, to: string): boolean {
  return dateKey !== null && dateKey >= from && dateKey <= to;
}

// ---------------------------------------------------------------------------
// Agregações
// ---------------------------------------------------------------------------

/** Soma de uma métrica; null quando nenhuma linha traz o valor. */
export function sum<T extends Partial<Record<Metric, number | null>>>(
  rows: T[],
  metric: Metric,
): number | null {
  let total = 0;
  let seen = false;
  for (const row of rows) {
    const value = row[metric];
    if (typeof value === "number") {
      total += value;
      seen = true;
    }
  }
  return seen ? total : null;
}

export function mean(values: Array<number | null>): number | null {
  const valid = values.filter((v): v is number => typeof v === "number");
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

export interface Delta {
  diff: number | null;
  /** Variação relativa (0.18 = +18%); null sem base de comparação. */
  pct: number | null;
  trend: "up" | "down" | "flat";
}

export function delta(current: number | null, previous: number | null): Delta {
  if (current === null || previous === null) return { diff: null, pct: null, trend: "flat" };
  const diff = current - previous;
  const pct = previous === 0 ? null : diff / Math.abs(previous);
  return { diff, pct, trend: diff > 0 ? "up" : diff < 0 ? "down" : "flat" };
}

/** Janelas de 7 dias: atual = últimos 7 dias (hoje incluso); anterior = os 7 antes. */
export function weekWindows(now = new Date()) {
  const current = { from: isoDate(daysAgo(6, now)), to: isoDate(now) };
  const previous = { from: isoDate(daysAgo(13, now)), to: isoDate(daysAgo(7, now)) };
  return { current, previous };
}

export function sumInWindow(
  points: DailyPoint[],
  metric: Metric,
  window: { from: string; to: string },
): number | null {
  return sum(
    points.filter((p) => inRange(p.date, window.from, window.to)),
    metric,
  );
}

/** Semana atual vs anterior de uma métrica diária. */
export function weeklyDelta(points: DailyPoint[], metric: Metric, now = new Date()) {
  const { current, previous } = weekWindows(now);
  const cur = sumInWindow(points, metric, current);
  const prev = sumInWindow(points, metric, previous);
  return { current: cur, previous: prev, delta: delta(cur, prev) };
}

/**
 * Janelas do período do painel: atual = últimos `days` dias (hoje incluso);
 * anterior = os `days` dias antes. É a comparação "vs período anterior" de
 * Stripe/Shopify, não a semana fixa.
 */
export function periodWindows(days: number, now = new Date()) {
  const current = { from: isoDate(daysAgo(days - 1, now)), to: isoDate(now) };
  const previous = { from: isoDate(daysAgo(days * 2 - 1, now)), to: isoDate(daysAgo(days, now)) };
  return { current, previous };
}

/** Interações do dia = curtidas + comentários + salvamentos + compartilhamentos (só o que existe). */
export function interactionsOf(point: DailyPoint): number | null {
  const parts = [point.likes, point.comments, point.saves, point.shares].filter(
    (v): v is number => v !== null,
  );
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
}

export type StripMetric = Metric | "interactions";

function sumMetric(points: DailyPoint[], metric: StripMetric): number | null {
  if (metric !== "interactions") return sum(points, metric);
  const values = points.map(interactionsOf).filter((v): v is number => v !== null);
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
}

/** Período atual vs anterior de uma métrica diária (ou das interações). */
export function periodDelta(
  points: DailyPoint[],
  metric: StripMetric,
  days: number,
  now = new Date(),
) {
  const { current, previous } = periodWindows(days, now);
  const cur = sumMetric(
    points.filter((p) => inRange(p.date, current.from, current.to)),
    metric,
  );
  const prev = sumMetric(
    points.filter((p) => inRange(p.date, previous.from, previous.to)),
    metric,
  );
  return { current: cur, previous: prev, delta: delta(cur, prev) };
}

/** Seguidores: total hoje, ganhos no período e ganhos no período anterior. */
export function followerPeriod(points: FollowerPoint[], days: number, now = new Date()) {
  if (!points.length) {
    return { total: null, gained: null, previousGained: null, delta: delta(null, null) };
  }
  const at = (date: string): number | null => {
    let value: number | null = null;
    for (const p of points) {
      if (p.date <= date) value = p.followers;
      else break;
    }
    return value;
  };
  const { current, previous } = periodWindows(days, now);
  const total = points.at(-1)?.followers ?? null;
  const startCurrent = at(isoDate(daysAgo(days, now)));
  const startPrevious = at(isoDate(daysAgo(days * 2, now)));
  const gained = total !== null && startCurrent !== null ? total - startCurrent : null;
  const previousGained =
    startCurrent !== null && startPrevious !== null ? startCurrent - startPrevious : null;
  void current;
  void previous;
  return { total, gained, previousGained, delta: delta(gained, previousGained) };
}

/** Seguidores ganhos na semana (último valor − valor de 7 dias atrás) e na anterior. */
export function followerWeekly(points: FollowerPoint[], now = new Date()) {
  if (!points.length) {
    return { total: null, gained: null, previousGained: null, delta: delta(null, null) };
  }
  const at = (date: string): number | null => {
    let value: number | null = null;
    for (const p of points) {
      if (p.date <= date) value = p.followers;
      else break;
    }
    return value;
  };
  const total = points.at(-1)?.followers ?? null;
  const weekAgo = at(isoDate(daysAgo(7, now)));
  const twoWeeksAgo = at(isoDate(daysAgo(14, now)));
  const gained = total !== null && weekAgo !== null ? total - weekAgo : null;
  const previousGained = weekAgo !== null && twoWeeksAgo !== null ? weekAgo - twoWeeksAgo : null;
  return { total, gained, previousGained, delta: delta(gained, previousGained) };
}

/** Engajamento = curtidas + comentários + compartilhamentos + salvamentos (só o que existe). */
export function engagementOf(post: ZernioPost): number | null {
  const a = post.analytics;
  const parts = [a.likes, a.comments, a.shares, a.saves].filter((v): v is number => v !== null);
  return parts.length ? parts.reduce((x, y) => x + y, 0) : null;
}

/**
 * Taxa de engajamento de uma publicação sua, na MESMA fórmula que o Mercado
 * aplica aos concorrentes (_shared/market-score.ts): (curtidas + comentários +
 * views × 0,1) ÷ seguidores. null sem seguidores ou sem nenhuma métrica.
 */
export function engagementRate(post: ZernioPost, followers: number | null): number | null {
  if (!followers || followers <= 0) return null;
  const a = post.analytics;
  if (a.likes === null && a.comments === null && a.views === null) return null;
  return ((a.likes ?? 0) + (a.comments ?? 0) + (a.views ?? 0) * 0.1) / followers;
}

/** Seguidores no dia: o último ponto até a data; antes do primeiro ponto, o primeiro. */
export function followersAt(points: FollowerPoint[], date: string | null): number | null {
  if (!points.length) return null;
  let value: number | null = null;
  for (const p of points) {
    if (!date || p.date <= date) value = p.followers;
    else break;
  }
  return value ?? points[0].followers;
}

export function bestPost(posts: ZernioPost[]): ZernioPost | null {
  let best: ZernioPost | null = null;
  let bestScore = -1;
  for (const post of posts) {
    const score = engagementOf(post);
    if (score !== null && score > bestScore) {
      best = post;
      bestScore = score;
    }
  }
  return best;
}

const REASON_METRICS: Metric[] = ["saves", "shares", "comments", "likes", "reach", "views"];

function fmtRatio(ratio: number): string {
  return `${ratio.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}×`;
}

/** Uma frase com o motivo ("3× mais salvamentos que a média"). */
export function bestPostReason(post: ZernioPost, posts: ZernioPost[]): string {
  const others = posts.filter((p) => p.id !== post.id);
  if (!others.length) return "Única publicação com métricas no período.";
  let bestMetric: Metric | null = null;
  let bestRatio = 0;
  for (const metric of REASON_METRICS) {
    const own = post.analytics[metric];
    const avg = mean(others.map((p) => p.analytics[metric]));
    if (own === null || avg === null || avg <= 0) continue;
    const ratio = own / avg;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestMetric = metric;
    }
  }
  if (bestMetric && bestRatio >= 1.3) {
    return `${fmtRatio(bestRatio)} mais ${METRIC_LABELS[bestMetric].toLowerCase()} que a média.`;
  }
  return "Maior engajamento do período.";
}

export type AverageBand = "above" | "average" | "below";

export const AVERAGE_BAND_LABELS: Record<AverageBand, string> = {
  above: "Acima da média",
  average: "Na média",
  below: "Abaixo da média",
};

/** Compara o engajamento da peça com a média das demais do mesmo formato. */
export function compareToAverage(
  post: ZernioPost,
  peers: ZernioPost[],
): { band: AverageBand; ratio: number; sample: number } | null {
  const own = engagementOf(post);
  const sameFormat = peers.filter((p) => p.id !== post.id && p.mediaType === post.mediaType);
  const avg = mean(sameFormat.map(engagementOf));
  if (own === null || avg === null || !sameFormat.length) return null;
  const ratio = avg === 0 ? (own > 0 ? 2 : 1) : own / avg;
  const band: AverageBand = ratio >= 1.2 ? "above" : ratio <= 0.8 ? "below" : "average";
  return { band, ratio, sample: sameFormat.length };
}

// ---------------------------------------------------------------------------
// Insights v1 (sem IA) — frases calculadas no cliente
// ---------------------------------------------------------------------------

export const WEEKDAY_LABELS = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];

const FORMAT_PLURAL: Partial<Record<MediaType, string>> = {
  carousel: "Carrosséis",
  image: "Posts de imagem",
  video: "Vídeos",
  text: "Posts de texto",
  document: "Documentos",
};

/** "na quinta", "no sábado" — para frases como "engaja mais na quinta às 19h". */
export function weekdayPhrase(dayOfWeek: number): string {
  const name = WEEKDAY_LABELS[dayOfWeek]?.toLowerCase() ?? "";
  return dayOfWeek === 0 || dayOfWeek === 6 ? `no ${name}` : `na ${name}`;
}

export function insights(posts: ZernioPost[]): string[] {
  const out: string[] = [];
  const withMetrics = posts.filter((p) => engagementOf(p) !== null || p.analytics.views !== null);

  // 1. Formato que mais salva (carrossel vs imagem, ou os dois formatos mais usados).
  const byFormat = new Map<MediaType, ZernioPost[]>();
  for (const post of withMetrics) {
    if (post.mediaType === "unknown") continue;
    byFormat.set(post.mediaType, [...(byFormat.get(post.mediaType) ?? []), post]);
  }
  const formats = [...byFormat.entries()].filter(([, list]) => list.length >= 2);
  if (formats.length >= 2) {
    const perFormat = formats
      .map(([type, list]) => ({ type, saves: mean(list.map((p) => p.analytics.saves)) }))
      .filter((f): f is { type: MediaType; saves: number } => f.saves !== null);
    if (perFormat.length >= 2) {
      perFormat.sort((a, b) => b.saves - a.saves);
      const [top, second] = perFormat;
      if (second.saves > 0 && top.saves / second.saves >= 1.3) {
        out.push(
          `${FORMAT_PLURAL[top.type] ?? MEDIA_TYPE_LABELS[top.type]} têm ${fmtRatio(top.saves / second.saves)} mais salvamentos que ${(FORMAT_PLURAL[second.type] ?? MEDIA_TYPE_LABELS[second.type]).toLowerCase()}.`,
        );
      }
    }
  }

  // 2. Participação dos vídeos nas views.
  const totalViews = sum(
    withMetrics.map((p) => p.analytics),
    "views",
  );
  const videoViews = sum(
    withMetrics.filter((p) => p.mediaType === "video").map((p) => p.analytics),
    "views",
  );
  if (totalViews && videoViews !== null && totalViews > 0 && withMetrics.length >= 3) {
    const share = videoViews / totalViews;
    if (share >= 0.5 && share < 1) {
      const allInstagram = withMetrics
        .filter((p) => p.mediaType === "video")
        .every((p) => p.platform === "instagram");
      out.push(
        `${allInstagram ? "Reels" : "Vídeos"} trouxeram ${Math.round(share * 100)}% das views.`,
      );
    }
  }

  return out.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Ordenação e formatação
// ---------------------------------------------------------------------------

export type PostSortKey = "date" | Metric;

export function sortPosts(
  posts: ZernioPost[],
  key: PostSortKey,
  order: "asc" | "desc",
): ZernioPost[] {
  const dir = order === "asc" ? 1 : -1;
  return [...posts].sort((a, b) => {
    if (key === "date") {
      return (a.date ?? "").localeCompare(b.date ?? "") * dir;
    }
    const av = a.analytics[key];
    const bv = b.analytics[key];
    // Sem valor vai sempre para o fim, em qualquer direção.
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return (av - bv) * dir;
  });
}

const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("pt-BR");

export function formatNumber(
  value: number | null | undefined,
  mode: "compact" | "full" = "compact",
) {
  if (value === null || value === undefined) return "—";
  return mode === "full" || Math.abs(value) < 10_000 ? full.format(value) : compact.format(value);
}

export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;
}

export function formatSigned(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

/** Caminhos SVG (linha e área) de uma sparkline; null com menos de 2 pontos. */
export function sparkPath(
  values: Array<number | null>,
  width = 120,
  height = 34,
): { line: string; area: string } | null {
  const points = values
    .map((v, i) => (v === null ? null : { i, v }))
    .filter((p): p is { i: number; v: number } => p !== null);
  if (points.length < 2) return null;
  const min = Math.min(...points.map((p) => p.v));
  const max = Math.max(...points.map((p) => p.v));
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const pad = 2;
  const coords = points.map((p) => ({
    x: +(p.i * stepX).toFixed(2),
    y: +(height - pad - ((p.v - min) / span) * (height - pad * 2)).toFixed(2),
  }));
  const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x} ${c.y}`).join(" ");
  const area = `${line} L${coords.at(-1)!.x} ${height} L${coords[0].x} ${height} Z`;
  return { line, area };
}

/**
 * A mesma conta autorizada duas vezes no Zernio chega como duas séries (ids
 * diferentes, mesmo @ na mesma rede). Somadas, dobravam os seguidores (34 → 68).
 * Fica a série com mais leituras.
 */
export function dedupeFollowerSeries(series: FollowerSeries[]): FollowerSeries[] {
  const byKey = new Map<string, FollowerSeries>();
  for (const s of series) {
    const key = s.username
      ? `${s.platform ?? ""}:${s.username.toLowerCase()}`
      : `id:${s.accountId}`;
    const seen = byKey.get(key);
    if (!seen || s.points.length > seen.points.length) byKey.set(key, s);
  }
  return [...byKey.values()];
}

/**
 * Só as séries das contas conectadas de agora (a lista do Zernio já descarta a
 * autorização repetida da mesma conta). As leituras gravadas no banco nem
 * sempre trazem o @, então o filtro pelo id é o que segura a soma em dobro.
 */
export function onlyConnectedAccounts(
  series: FollowerSeries[] | undefined,
  accounts: Array<{ accountId: string }> | undefined,
): FollowerSeries[] | undefined {
  if (!series || !accounts?.length) return series;
  const ids = new Set(accounts.map((a) => a.accountId));
  const kept = series.filter((s) => ids.has(s.accountId));
  return kept.length ? kept : series;
}
