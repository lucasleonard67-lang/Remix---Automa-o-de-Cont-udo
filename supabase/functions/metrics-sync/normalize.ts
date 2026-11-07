// metrics-sync/normalize.ts — leitura tolerante dos relatórios do Zernio
// (espelho enxuto de src/lib/zernio-analytics.ts, que a edge não consegue
// importar). Aceita snake_case e camelCase; métrica ausente vira null — nunca 0.

type Loose = Record<string, unknown>;

export const METRICS = [
  'reach',
  'impressions',
  'views',
  'likes',
  'comments',
  'saves',
  'shares',
  'clicks',
] as const;
export type Metric = (typeof METRICS)[number];
export type MetricValues = Record<Metric, number | null>;

export type SyncStatus = 'synced' | 'pending' | 'unavailable' | null;

export interface DailyPoint extends MetricValues {
  date: string;
}

export interface FollowerPoint {
  date: string;
  followers: number;
  gained: number | null;
  lost: number | null;
}

export interface FollowerSeries {
  accountId: string;
  platform: string | null;
  username: string | null;
  points: FollowerPoint[];
}

export interface PostPlatformRow {
  platform: string;
  accountId: string | null;
  url: string | null;
  syncStatus: SyncStatus;
  analytics: MetricValues & { engagementRate: number | null };
}

export interface PostRow {
  id: string;
  content: string | null;
  publishedAt: string | null;
  mediaType: string | null;
  url: string | null;
  /** miniatura no CDN do Instagram (não carrega no navegador; metrics-sync guarda no bucket) */
  thumbnailUrl: string | null;
  syncStatus: SyncStatus;
  analytics: MetricValues & { engagementRate: number | null };
  platforms: PostPlatformRow[];
  platform: string | null;
  accountId: string | null;
}

// ── Leitura ──────────────────────────────────────────────────────────────────

function toCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

export function isRecord(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Primeiro valor definido entre as chaves (cada uma testada em snake e camel). */
export function read(source: Loose | null | undefined, ...keys: string[]): unknown {
  if (!source) return undefined;
  for (const key of keys) {
    for (const candidate of [key, toCamel(key)]) {
      const value = source[candidate];
      if (value !== undefined && value !== null) return value;
    }
  }
  return undefined;
}

export function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function arr(value: unknown): Loose[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function daysAgo(n: number, from = new Date()): Date {
  return new Date(from.getTime() - n * 86_400_000);
}

/** "2026-10-21", ISO completo ou epoch → YYYY-MM-DD; null quando não dá para ler. */
export function toDateKey(value: unknown): string | null {
  if (typeof value === 'number') {
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

function metricsOf(raw: unknown): MetricValues & { engagementRate: number | null } {
  const source = isRecord(raw) ? raw : undefined;
  const out = { engagementRate: null } as MetricValues & { engagementRate: number | null };
  for (const metric of METRICS) out[metric] = num(read(source, metric));
  out.engagementRate = num(read(source, 'engagement_rate'));
  return out;
}

function syncOf(value: unknown): SyncStatus {
  return value === 'synced' || value === 'pending' || value === 'unavailable' ? value : null;
}

// ── daily-metrics ────────────────────────────────────────────────────────────

export function normalizeDaily(raw: unknown): DailyPoint[] {
  const list = isRecord(raw) ? read(raw, 'daily_data', 'daily', 'data') : raw;
  const points: DailyPoint[] = [];
  for (const item of arr(list)) {
    const date = toDateKey(read(item, 'date', 'day'));
    if (!date) continue;
    const metrics = (read(item, 'metrics') as Loose | undefined) ?? item;
    const point = { date } as DailyPoint;
    for (const metric of METRICS) point[metric] = num(read(metrics, metric));
    points.push(point);
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

// ── follower-stats ───────────────────────────────────────────────────────────

function followerPoints(list: unknown): FollowerPoint[] {
  return arr(list)
    .map((item) => {
      const date = toDateKey(read(item, 'date', 'day'));
      const followers = num(read(item, 'followers', 'follower_count', 'count', 'value'));
      if (!date || followers === null) return null;
      return {
        date,
        followers,
        gained: num(read(item, 'followers_gained', 'gained', 'follows')),
        lost: num(read(item, 'followers_lost', 'lost', 'unfollows')),
      };
    })
    .filter((p): p is FollowerPoint => p !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Lê o formato { accounts, stats }; null quando a resposta não está nele. */
function followersFromStatsMap(raw: Loose): FollowerSeries[] | null {
  const stats = read(raw, 'stats');
  const accounts = arr(read(raw, 'accounts'));
  if (!isRecord(stats) && !accounts.some((a) => read(a, 'current_followers') !== undefined)) return null;
  const meta = new Map<string, Loose>();
  for (const account of accounts) {
    const id = str(read(account, '_id', 'id', 'account_id'));
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
        ? read(value, 'data', 'stats', 'history', 'daily', 'points')
        : undefined;
    const points = followerPoints(list);
    const account = meta.get(id);
    // conta sem histórico ainda: o total de hoje vira o primeiro ponto
    const current = num(read(account, 'current_followers', 'followers'));
    if (!points.length && current !== null) {
      points.push({ date: today, followers: current, gained: null, lost: null });
    }
    series.push({
      accountId: id,
      platform: str(read(account, 'platform')),
      username: str(read(account, 'username', 'display_name', 'name')),
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
  const source = read(raw, 'accounts', 'stats', 'data') ?? raw;
  const series: FollowerSeries[] = [];

  if (Array.isArray(source)) {
    const items = arr(source);
    const nested = items.filter((item) =>
      Array.isArray(read(item, 'data', 'stats', 'history', 'daily', 'points')),
    );
    if (nested.length) {
      for (const item of nested) {
        series.push({
          accountId: str(read(item, 'account_id', '_id', 'id')) ?? `conta-${series.length + 1}`,
          platform: str(read(item, 'platform')),
          username: str(read(item, 'username', 'account_username', 'name')),
          points: followerPoints(read(item, 'data', 'stats', 'history', 'daily', 'points')),
        });
      }
      return series;
    }
    const groups = new Map<string, { platform: string | null; username: string | null; rows: Loose[] }>();
    for (const item of items) {
      const key = str(read(item, 'account_id')) ?? 'conta';
      const group = groups.get(key) ?? {
        platform: str(read(item, 'platform')),
        username: str(read(item, 'username', 'account_username')),
        rows: [],
      };
      group.rows.push(item);
      groups.set(key, group);
    }
    for (const [accountId, group] of groups) {
      series.push({ accountId, platform: group.platform, username: group.username, points: followerPoints(group.rows) });
    }
    return series;
  }

  if (isRecord(source)) {
    for (const [accountId, value] of Object.entries(source)) {
      if (accountId === 'date_range' || accountId === 'dateRange') continue;
      if (Array.isArray(value)) {
        series.push({ accountId, platform: null, username: null, points: followerPoints(value) });
      } else if (isRecord(value)) {
        series.push({
          accountId,
          platform: str(read(value, 'platform')),
          username: str(read(value, 'username', 'account_username')),
          points: followerPoints(read(value, 'data', 'stats', 'history', 'daily', 'points')),
        });
      }
    }
  }
  return series;
}

// ── GET /v1/analytics (posts) ────────────────────────────────────────────────

function normalizePlatform(raw: Loose): PostPlatformRow {
  return {
    platform: str(read(raw, 'platform')) ?? 'unknown',
    accountId: str(read(raw, 'account_id')),
    url: str(read(raw, 'platform_post_url')),
    syncStatus: syncOf(read(raw, 'sync_status')),
    analytics: metricsOf(read(raw, 'analytics')),
  };
}

export function normalizePosts(raw: unknown): PostRow[] {
  const list = isRecord(raw) ? read(raw, 'posts', 'data') : raw;
  const out: PostRow[] = [];
  for (const item of arr(list)) {
    const id = str(read(item, '_id', 'id', 'late_post_id'));
    if (!id) continue;
    const platforms = arr(read(item, 'platforms')).map(normalizePlatform);
    const statuses = platforms.map((p) => p.syncStatus);
    const syncStatus: SyncStatus =
      syncOf(read(item, 'sync_status')) ??
      (statuses.includes('synced')
        ? 'synced'
        : statuses.includes('pending')
          ? 'pending'
          : statuses.includes('unavailable')
            ? 'unavailable'
            : null);
    out.push({
      id,
      content: str(read(item, 'content')),
      publishedAt: str(read(item, 'published_at')) ?? str(read(item, 'scheduled_for')),
      mediaType: str(read(item, 'media_type')),
      url: str(read(item, 'platform_post_url')) ?? platforms[0]?.url ?? null,
      thumbnailUrl: str(read(item, 'thumbnail_url')),
      syncStatus,
      analytics: metricsOf(read(item, 'analytics')),
      platforms,
      platform: str(read(item, 'platform')) ?? platforms[0]?.platform ?? null,
      accountId: platforms[0]?.accountId ?? null,
    });
  }
  return out;
}

/** Total de páginas, quando a API informa (pagination.totalPages / total_pages). */
export function totalPages(raw: unknown): number | null {
  if (!isRecord(raw)) return null;
  const pagination = (read(raw, 'pagination', 'meta') as Loose | undefined) ?? raw;
  return num(read(pagination, 'total_pages', 'pages'));
}
