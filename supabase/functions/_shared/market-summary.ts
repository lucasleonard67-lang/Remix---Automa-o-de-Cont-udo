// _shared/market-summary.ts — monta o resumo pronto para o Dashboard
// (app_settings.market) a partir das tabelas competitors/competitor_posts e,
// quando há Zernio, compara com os posts do próprio cliente (últimos 30 dias).
//
// Shape gravado (lido por src/hooks/use-market.ts):
// {
//   synced_at,
//   competitors: [{ id, handle, name, avatar_url, followers, posts, avg_engagement, last_error }],
//   top_posts:   [...8 posts com notas],
//   insights:    [...até 3 frases],
//   vs_me: { my_avg_engagement, market_avg_engagement, my_best_format, market_best_format } | null
// }

import type { createServiceClient } from './supabase.ts';
import { zernioFetch } from './zernio.ts';
import { engagementOf } from './market-score.ts';

type Service = ReturnType<typeof createServiceClient>;

export const MARKET_SETTING_KEY = 'market';

export type MarketFormat = 'image' | 'carousel' | 'reel';

export interface CompetitorRow {
  id: string;
  handle: string;
  name: string | null;
  avatar_url: string | null;
  followers: number | null;
  enabled: boolean;
  last_sync_at: string | null;
  last_error: string | null;
}

export interface CompetitorPostRow {
  id: string;
  competitor_id: string;
  platform_post_id: string;
  url: string | null;
  caption: string | null;
  media_type: string | null;
  thumbnail_url: string | null;
  posted_at: string | null;
  likes: number | null;
  comments: number | null;
  views: number | null;
  engagement: number | string | null;
  virality: number | null;
  relevance: number | null;
  topics: string[] | null;
  score_reason: string | null;
  angle: string | null;
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
  engagement: number | null;
  virality: number | null;
  relevance: number | null;
  topics: string[];
  score_reason: string | null;
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

const FORMAT_LABEL: Record<MarketFormat, string> = { image: 'imagens', carousel: 'carrosséis', reel: 'reels' };

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function mean(values: Array<number | null>): number | null {
  const ok = values.filter((v): v is number => v !== null);
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
}

function asFormat(v: string | null | undefined): MarketFormat | null {
  return v === 'image' || v === 'carousel' || v === 'reel' ? v : null;
}

/** Formato com maior engajamento médio (precisa de ≥2 posts no formato). */
function bestFormat(rows: Array<{ format: MarketFormat | null; engagement: number | null }>): MarketFormat | null {
  const groups = new Map<MarketFormat, number[]>();
  for (const r of rows) {
    if (!r.format || r.engagement === null) continue;
    const g = groups.get(r.format) ?? [];
    g.push(r.engagement);
    groups.set(r.format, g);
  }
  let best: MarketFormat | null = null;
  let bestAvg = -1;
  for (const [format, values] of groups) {
    if (values.length < 2) continue;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    if (avg > bestAvg) {
      bestAvg = avg;
      best = format;
    }
  }
  if (best) return best;
  // Sem engajamento calculável: o formato mais usado.
  const counts = new Map<MarketFormat, number>();
  for (const r of rows) if (r.format) counts.set(r.format, (counts.get(r.format) ?? 0) + 1);
  for (const [format, n] of counts) {
    if (n > bestAvg) {
      bestAvg = n;
      best = format;
    }
  }
  return best;
}

function pct(v: number): string {
  return `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: v * 100 >= 10 ? 0 : 1 })}%`;
}

function ratio(a: number, b: number): string {
  return `${(a / b).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}×`;
}

// ── Insights (determinísticos: sem chamada extra de IA) ──────────────────────

function buildInsights(
  competitors: MarketSummary['competitors'],
  posts: Array<CompetitorPostRow & { handle: string; engagementNum: number | null; format: MarketFormat | null }>,
  vsMe: MarketSummary['vs_me'],
): string[] {
  const out: string[] = [];

  // 1. Formato que mais rende no mercado.
  const byFormat = new Map<MarketFormat, number[]>();
  for (const p of posts) {
    if (!p.format || p.engagementNum === null) continue;
    const g = byFormat.get(p.format) ?? [];
    g.push(p.engagementNum);
    byFormat.set(p.format, g);
  }
  const formats = [...byFormat.entries()]
    .filter(([, v]) => v.length >= 2)
    .map(([f, v]) => ({ f, avg: v.reduce((a, b) => a + b, 0) / v.length }))
    .sort((a, b) => b.avg - a.avg);
  if (formats.length >= 2 && formats[1].avg > 0) {
    out.push(
      `Entre os concorrentes, ${FORMAT_LABEL[formats[0].f]} rendem ${ratio(formats[0].avg, formats[1].avg)} o engajamento de ${FORMAT_LABEL[formats[1].f]}.`,
    );
  } else if (formats.length === 1) {
    out.push(`Os concorrentes publicam quase só ${FORMAT_LABEL[formats[0].f]} — há espaço para outro formato.`);
  }

  // 2. Quem lidera em engajamento relativo.
  const ranked = competitors
    .filter((c) => c.avg_engagement !== null && c.posts > 0)
    .sort((a, b) => (b.avg_engagement ?? 0) - (a.avg_engagement ?? 0));
  if (ranked.length) {
    const top = ranked[0];
    const followers =
      top.followers !== null ? ` com ${top.followers.toLocaleString('pt-BR')} seguidores` : '';
    out.push(`@${top.handle} lidera em engajamento: ${pct(top.avg_engagement ?? 0)} por post${followers}.`);
  }

  // 3. Assunto mais frequente entre os posts que mais rendem.
  const topicCount = new Map<string, number>();
  for (const p of posts.slice(0, 12)) for (const t of p.topics ?? []) topicCount.set(t, (topicCount.get(t) ?? 0) + 1);
  const topTopic = [...topicCount.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topTopic && topTopic[1] >= 2) {
    out.push(`“${topTopic[0]}” aparece em ${topTopic[1]} dos posts que mais rendem — vale uma peça sua sobre isso.`);
  }

  // 4. Comparação direta, se houver.
  if (out.length < 3 && vsMe && vsMe.my_avg_engagement !== null && vsMe.market_avg_engagement !== null && vsMe.market_avg_engagement > 0) {
    const mine = vsMe.my_avg_engagement;
    const market = vsMe.market_avg_engagement;
    out.push(
      mine >= market
        ? `Seu engajamento médio (${pct(mine)}) está acima do mercado (${pct(market)}).`
        : `Seu engajamento médio (${pct(mine)}) está abaixo do mercado (${pct(market)}) — teste o formato que mais rende para eles.`,
    );
  }

  return out.slice(0, 3);
}

// ── Você × mercado (Zernio, últimos 30 dias) ─────────────────────────────────

type Loose = Record<string, unknown>;
function isRecord(v: unknown): v is Loose {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function read(src: Loose | undefined, ...keys: string[]): unknown {
  if (!src) return undefined;
  for (const k of keys) {
    for (const c of [k, k.replace(/_([a-z0-9])/g, (_m, ch: string) => ch.toUpperCase())]) {
      const v = src[c];
      if (v !== undefined && v !== null) return v;
    }
  }
  return undefined;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function myFollowers(apiKey: string, fromDate: string, toDate: string): Promise<number | null> {
  try {
    const raw = await zernioFetch(apiKey, '/v1/accounts/follower-stats', {
      query: { fromDate, toDate, granularity: 'daily' },
    });
    const source = (read(raw, 'accounts', 'stats', 'data') ?? raw) as unknown;
    let total = 0;
    let found = false;
    const takeLast = (points: unknown) => {
      if (!Array.isArray(points)) return;
      const last = [...points].reverse().find((p) => isRecord(p) && toNum(read(p, 'followers', 'count', 'value')) !== null);
      if (last && isRecord(last)) {
        total += toNum(read(last, 'followers', 'count', 'value')) ?? 0;
        found = true;
      }
    };
    if (Array.isArray(source)) {
      for (const item of source) {
        if (!isRecord(item)) continue;
        const nested = read(item, 'data', 'stats', 'history', 'daily', 'points');
        if (Array.isArray(nested)) takeLast(nested);
      }
      if (!found) takeLast(source);
    } else if (isRecord(source)) {
      for (const value of Object.values(source)) {
        if (Array.isArray(value)) takeLast(value);
        else if (isRecord(value)) takeLast(read(value, 'data', 'stats', 'history', 'daily', 'points'));
      }
    }
    return found && total > 0 ? total : null;
  } catch (err) {
    console.warn('[market] follower-stats falhou:', err instanceof Error ? err.message : err);
    return null;
  }
}

function zernioFormat(v: unknown): MarketFormat | null {
  switch (v) {
    case 'image':
      return 'image';
    case 'carousel':
      return 'carousel';
    case 'video':
    case 'gif':
      return 'reel';
    default:
      return null;
  }
}

async function myPosts(apiKey: string): Promise<{ engagement: number | null; format: MarketFormat | null }[] | null> {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);
  const fromDate = isoDay(from);
  const toDate = isoDay(to);
  let raw: Loose;
  try {
    raw = await zernioFetch(apiKey, '/v1/analytics', {
      query: { fromDate, toDate, limit: '100', sortBy: 'date', order: 'desc' },
    });
  } catch (err) {
    console.warn('[market] analytics do Zernio falhou:', err instanceof Error ? err.message : err);
    return null;
  }
  const list = read(raw, 'posts', 'data');
  const items = Array.isArray(list) ? list.filter(isRecord) : [];
  if (items.length === 0) return [];
  const followers = await myFollowers(apiKey, fromDate, toDate);

  return items.map((item) => {
    let analytics = isRecord(read(item, 'analytics')) ? (read(item, 'analytics') as Loose) : undefined;
    const platforms = Array.isArray(read(item, 'platforms')) ? (read(item, 'platforms') as unknown[]).filter(isRecord) : [];
    if (!analytics || toNum(read(analytics, 'likes')) === null) {
      const first = platforms.find((p) => isRecord(read(p, 'analytics')));
      if (first) analytics = read(first, 'analytics') as Loose;
    }
    const likes = toNum(read(analytics, 'likes'));
    const comments = toNum(read(analytics, 'comments'));
    const views = toNum(read(analytics, 'views'));
    let engagement = followers ? engagementOf({ likes, comments, views }, followers) : null;
    if (engagement === null) {
      // Sem seguidores lidos: a taxa do próprio Zernio (em %, quando vem).
      const rate = toNum(read(analytics, 'engagement_rate'));
      if (rate !== null) engagement = rate > 1 ? rate / 100 : rate;
    }
    return { engagement, format: zernioFormat(read(item, 'media_type')) };
  });
}

// ── Orquestração ─────────────────────────────────────────────────────────────

export async function buildMarketSummary(
  service: Service,
  zernioKey: string | null,
): Promise<MarketSummary> {
  const [{ data: compRaw }, { data: postRaw }] = await Promise.all([
    service.from('competitors').select('id, handle, name, avatar_url, followers, enabled, last_sync_at, last_error').order('created_at'),
    service
      .from('competitor_posts')
      .select('id, competitor_id, platform_post_id, url, caption, media_type, thumbnail_url, posted_at, likes, comments, views, engagement, virality, relevance, topics, score_reason, angle')
      .order('posted_at', { ascending: false, nullsFirst: false })
      .limit(600),
  ]);
  const competitors = ((compRaw ?? []) as CompetitorRow[]).filter((c) => c.enabled);
  const byId = new Map(competitors.map((c) => [c.id, c]));
  const posts = ((postRaw ?? []) as CompetitorPostRow[])
    .filter((p) => byId.has(p.competitor_id))
    .map((p) => ({
      ...p,
      handle: byId.get(p.competitor_id)!.handle,
      engagementNum: toNum(p.engagement),
      format: asFormat(p.media_type),
    }));

  const compSummary: MarketSummary['competitors'] = competitors.map((c) => {
    const mine = posts.filter((p) => p.competitor_id === c.id);
    return {
      id: c.id,
      handle: c.handle,
      name: c.name,
      avatar_url: c.avatar_url,
      followers: c.followers,
      posts: mine.length,
      avg_engagement: mean(mine.map((p) => p.engagementNum)),
      last_sync_at: c.last_sync_at,
      last_error: c.last_error,
    };
  });

  const ranked = [...posts].sort((a, b) => {
    const pa = ((a.relevance ?? 0) * (a.virality ?? 0)) / 100 || (a.virality ?? 0) * 0.5;
    const pb = ((b.relevance ?? 0) * (b.virality ?? 0)) / 100 || (b.virality ?? 0) * 0.5;
    if (pb !== pa) return pb - pa;
    return (b.engagementNum ?? 0) - (a.engagementNum ?? 0);
  });

  const top_posts: MarketTopPost[] = ranked.slice(0, 8).map((p) => ({
    id: p.id,
    handle: p.handle,
    name: byId.get(p.competitor_id)?.name ?? null,
    url: p.url,
    caption: p.caption ? p.caption.replace(/\s+/g, ' ').slice(0, 220) : null,
    media_type: p.format,
    thumbnail_url: p.thumbnail_url,
    posted_at: p.posted_at,
    likes: p.likes,
    comments: p.comments,
    views: p.views,
    engagement: p.engagementNum,
    virality: p.virality,
    relevance: p.relevance,
    topics: p.topics ?? [],
    score_reason: p.score_reason,
    angle: p.angle,
  }));

  const marketAvg = mean(posts.map((p) => p.engagementNum));
  const marketBest = bestFormat(posts.map((p) => ({ format: p.format, engagement: p.engagementNum })));

  let vs_me: MarketSummary['vs_me'] = null;
  if (zernioKey) {
    const mine = await myPosts(zernioKey);
    if (mine !== null) {
      vs_me = {
        my_avg_engagement: mean(mine.map((m) => m.engagement)),
        market_avg_engagement: marketAvg,
        my_best_format: bestFormat(mine),
        market_best_format: marketBest,
        my_posts: mine.length,
      };
    }
  }

  return {
    synced_at: new Date().toISOString(),
    competitors: compSummary,
    top_posts,
    insights: buildInsights(compSummary, ranked, vs_me),
    vs_me,
  };
}

export async function saveMarketSummary(service: Service, summary: MarketSummary): Promise<void> {
  // O cron grava `last_run_*` na mesma chave; um "Sincronizar agora" manual
  // não pode apagar essa trilha — preserva o que começa com last_run_.
  const { data: current } = await service
    .from('app_settings')
    .select('value')
    .eq('key', MARKET_SETTING_KEY)
    .maybeSingle();
  const kept = Object.fromEntries(
    Object.entries((current?.value ?? {}) as Record<string, unknown>).filter(([k]) =>
      k.startsWith('last_run_'),
    ),
  );
  const { error } = await service
    .from('app_settings')
    .upsert({ key: MARKET_SETTING_KEY, value: { ...kept, ...summary } }, { onConflict: 'key' });
  if (error) throw new Error(`Falha ao gravar app_settings.market: ${error.message}`);
}
