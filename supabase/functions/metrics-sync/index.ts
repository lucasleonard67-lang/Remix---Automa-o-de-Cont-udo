// metrics-sync — rotina de 15 em 15 min que lê o Zernio e grava as métricas no banco
// (supabase/sql/analytics.sql): seguidores por conta e soma do dia em
// account_metrics_daily; foto diária de cada publicação em post_metrics_daily.
// O Desempenho (Dashboard) lê essas tabelas primeiro e cai no Zernio ao vivo
// quando elas ainda não cobrem o período.
//
// POST {}                      → cron (invoke_metrics_sync, header x-cron-secret)
// POST { hop }                 → continuação disparada pela própria função
// → 200 { ok, skipped?, accounts, daily, posts, pages, remaining, continued }
//
// Dupla auth (verify_jwt=false; validação TODA interna), como fetch-rss:
// - header x-cron-secret == Vault METRICS_CRON_SECRET → cron
// - JWT de ADMIN (getUser + has_role)                 → execução manual
// Qualquer outra coisa → 401. Falha fechada: sem segredo no Vault, nega.
//
// Toda execução relê seguidores e a soma do dia (2-4 chamadas): é o que deixa o
// Dashboard em dia. A varredura dos posts (até ~48 chamadas) roda UMA vez por
// dia — `posts_day` marca o dia já varrido e as execuções seguintes pulam.
//
// Orçamento por execução: no máximo MAX_CALLS chamadas ao Zernio. O cursor
// (página dos posts dos últimos 90 dias) fica em app_settings.metrics_sync e a
// função se chama de novo (até MAX_HOPS vezes) até terminar o dia. Sem chave
// do Zernio a execução sai com `skipped` e não grava nada.
//
// Auto-registro de URL: toda execução faz upsert de app_settings.instance_url =
// env SUPABASE_URL — os invoke_*() do cron leem de lá.

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';
import { cacheThumb, thumbExists } from '../_shared/thumbs.ts';
import { ZernioError, zernioFetch } from '../_shared/zernio.ts';
import {
  daysAgo,
  isoDate,
  normalizeDaily,
  normalizeFollowerStats,
  normalizePosts,
  totalPages,
  METRICS,
  type DailyPoint,
  type FollowerSeries,
  type PostRow,
} from './normalize.ts';
import { segredoIgual } from '../_shared/segredo-igual.ts';

type Service = ReturnType<typeof createServiceClient>;

const SETTING_KEY = 'metrics_sync';
const CRON_SECRET_NAME = 'METRICS_CRON_SECRET';
/** Chamadas ao Zernio por execução. */
const MAX_CALLS = 6;
/** Continuações encadeadas por dia (6 chamadas × 8 = 48, sobra para ~1.800 posts). */
const MAX_HOPS = 8;
/** Janela dos posts com métricas. */
const POST_WINDOW_DAYS = 90;
const PAGE_SIZE = 50;
/** Plataformas lidas em separado no daily-metrics (além da soma). */
const MAX_PLATFORM_CALLS = 2;

type Cursor = {
  from_date: string;
  to_date: string;
  page: number;
  posts: number;
  pages: number;
};

type SyncState = {
  last_run_at?: string;
  last_ok_at?: string;
  last_error?: string | null;
  skipped?: string | null;
  cursor?: Cursor | null;
  last_counts?: { accounts: number; daily: number; posts: number };
  /** Dia (UTC) cuja varredura de posts já terminou. */
  posts_day?: string | null;
};

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return errorResponse(405, 'invalid_input', 'Use POST.');

  const service = createServiceClient();
  const cronSecret = await getSecret(service, CRON_SECRET_NAME);
  const caller = await resolveCaller(req, service, cronSecret);
  if (!caller) return errorResponse(401, 'unauthorized', 'x-cron-secret ou JWT de admin.');

  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text) as Record<string, unknown>;
  } catch (_err) {
    body = {};
  }
  const hop = typeof body.hop === 'number' && Number.isFinite(body.hop) ? Math.trunc(body.hop) : 0;

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  if (supabaseUrl) {
    await service
      .from('app_settings')
      .upsert({ key: 'instance_url', value: { url: supabaseUrl } }, { onConflict: 'key' });
  }

  const state = await loadState(service);
  const now = new Date().toISOString();

  const apiKey = await getSecret(service, 'ZERNIO_API_KEY');
  if (!apiKey) {
    await saveState(service, { ...state, last_run_at: now, skipped: 'zernio_not_configured', cursor: null });
    return jsonResponse({ ok: true, skipped: 'zernio_not_configured', accounts: 0, daily: 0, posts: 0, pages: 0, remaining: false });
  }

  try {
    const result = await run(service, apiKey, state);
    const finished = result.cursor === null;
    // Contagem do dia: contas e soma do dia vêm da primeira fatia; posts
    // acumulam fatia a fatia até o cursor zerar.
    const previous = result.startedCycle && !result.postsSkipped ? null : state.last_counts;
    const nextState: SyncState = {
      ...state,
      last_run_at: now,
      last_ok_at: finished ? now : state.last_ok_at,
      last_error: null,
      skipped: null,
      cursor: result.cursor,
      posts_day: result.postsDone ?? state.posts_day ?? null,
      last_counts: {
        accounts: result.startedCycle ? result.accounts : (previous?.accounts ?? 0),
        daily: result.startedCycle ? result.daily : (previous?.daily ?? 0),
        posts: (previous?.posts ?? 0) + result.posts,
      },
    };
    await saveState(service, nextState);

    let continued = false;
    if (!finished && hop < MAX_HOPS && cronSecret && supabaseUrl) {
      continued = scheduleContinuation(supabaseUrl, cronSecret, hop + 1);
    }

    return jsonResponse({
      ok: true,
      accounts: result.accounts,
      daily: result.daily,
      posts: result.posts,
      pages: result.pages,
      remaining: !finished,
      continued,
      hop,
    });
  } catch (err) {
    const message =
      err instanceof ZernioError
        ? `Zernio: ${err.message}`
        : err instanceof Error
          ? err.message
          : 'Falha inesperada ao sincronizar as métricas.';
    console.error('[metrics-sync]', message);
    await saveState(service, { ...state, last_run_at: now, last_error: message, skipped: null });
    if (err instanceof ZernioError) {
      return errorResponse(err.status >= 500 ? 502 : err.status, `zernio_${err.code}`, err.message);
    }
    return errorResponse(500, 'internal_error', message);
  }
});

// ── Auth / estado ────────────────────────────────────────────────────────────

async function resolveCaller(
  req: Request,
  service: Service,
  cronSecret: string | null,
): Promise<'cron' | 'admin' | null> {
  const provided = req.headers.get('x-cron-secret');
  if (provided) {
    return segredoIgual(provided, cronSecret) ? 'cron' : null;
  }
  const user = await getUser(req);
  if (!user) return null;
  const { data: isAdmin } = await service.rpc('has_role', { _user_id: user.id, _role: 'admin' });
  return isAdmin === true ? 'admin' : null;
}

async function getSecret(service: Service, name: string): Promise<string | null> {
  const { data, error } = await service.rpc('get_vault_secret', { _name: name });
  if (error) return null;
  const value = data as string | null;
  return value && value.length > 0 ? value : null;
}

async function loadState(service: Service): Promise<SyncState> {
  const { data } = await service.from('app_settings').select('value').eq('key', SETTING_KEY).maybeSingle();
  const value = data?.value;
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as SyncState) : {};
}

async function saveState(service: Service, state: SyncState): Promise<void> {
  const { error } = await service
    .from('app_settings')
    .upsert({ key: SETTING_KEY, value: state }, { onConflict: 'key' });
  if (error) console.warn('[metrics-sync] não gravou app_settings.metrics_sync:', error.message);
}

/** Dispara a próxima fatia sem esperar a resposta (a função atual já devolve). */
function scheduleContinuation(supabaseUrl: string, secret: string, hop: number): boolean {
  try {
    const pending = fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/metrics-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret },
      body: JSON.stringify({ hop }),
    }).then(
      () => undefined,
      (err) => console.warn('[metrics-sync] continuação falhou:', err instanceof Error ? err.message : err),
    );
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime) EdgeRuntime.waitUntil(pending);
    return true;
  } catch (err) {
    console.warn('[metrics-sync] continuação não disparou:', err instanceof Error ? err.message : err);
    return false;
  }
}

// ── Sincronização ────────────────────────────────────────────────────────────

type RunResult = {
  /** true quando esta fatia abriu o dia (leu contas e soma do dia). */
  startedCycle: boolean;
  accounts: number;
  daily: number;
  posts: number;
  pages: number;
  cursor: Cursor | null;
  /** dia da varredura de posts que terminou nesta execução */
  postsDone: string | null;
  /** posts já varridos hoje: só seguidores e soma do dia foram lidos */
  postsSkipped: boolean;
};

async function run(service: Service, apiKey: string, state: SyncState): Promise<RunResult> {
  const today = isoDate(new Date());
  const yesterday = isoDate(daysAgo(1));
  let calls = 0;
  // Cursor de outro dia é descartado: cada dia começa pelas contas.
  let cursor: Cursor | null = state.cursor && state.cursor.to_date === today ? state.cursor : null;
  const result: RunResult = {
    startedCycle: !cursor,
    accounts: 0,
    daily: 0,
    posts: 0,
    pages: 0,
    cursor: null,
    postsDone: null,
    postsSkipped: false,
  };

  if (!cursor) {
    // 1. Seguidores por conta (últimos 2 dias).
    const followersRaw = await zernioFetch(apiKey, '/v1/accounts/follower-stats', {
      query: { fromDate: yesterday, toDate: today, granularity: 'daily' },
    });
    calls++;
    const series = normalizeFollowerStats(followersRaw);
    result.accounts = await upsertFollowers(service, series);

    // 2. Soma do dia em todas as redes.
    const dailyRaw = await zernioFetch(apiKey, '/v1/analytics/daily-metrics', {
      query: { fromDate: yesterday, toDate: today },
    });
    calls++;
    result.daily += await upsertDaily(service, '_all', null, normalizeDaily(dailyRaw));

    // 3. Por plataforma, só quando há mais de uma rede conectada.
    const platforms = [...new Set(series.map((s) => s.platform).filter((p): p is string => Boolean(p)))];
    if (platforms.length > 1) {
      for (const platform of platforms.slice(0, MAX_PLATFORM_CALLS)) {
        if (calls >= MAX_CALLS - 1) break;
        try {
          const raw = await zernioFetch(apiKey, '/v1/analytics/daily-metrics', {
            query: { fromDate: yesterday, toDate: today, platform },
          });
          result.daily += await upsertDaily(service, `_platform:${platform}`, platform, normalizeDaily(raw));
        } catch (err) {
          console.warn(`[metrics-sync] daily-metrics ${platform} falhou:`, err instanceof Error ? err.message : err);
        }
        calls++;
      }
    }

    if (state.posts_day === today) {
      result.postsSkipped = true;
      return result;
    }

    cursor = {
      from_date: isoDate(daysAgo(POST_WINDOW_DAYS - 1)),
      to_date: today,
      page: 1,
      posts: 0,
      pages: 0,
    };
  }

  // 4. Posts dos últimos 90 dias, páginas de 50, só os sincronizados.
  while (calls < MAX_CALLS) {
    const raw = await zernioFetch(apiKey, '/v1/analytics', {
      query: {
        fromDate: cursor.from_date,
        toDate: cursor.to_date,
        limit: String(PAGE_SIZE),
        page: String(cursor.page),
        sortBy: 'date',
        order: 'desc',
      },
    });
    calls++;
    const posts = normalizePosts(raw);
    const written = await upsertPosts(service, posts, today);
    result.posts += written;
    result.pages++;
    cursor.posts += written;
    cursor.pages++;

    const known = totalPages(raw);
    const last = posts.length < PAGE_SIZE || (known !== null && cursor.page >= known);
    if (last) {
      result.postsDone = cursor.to_date;
      cursor = null;
      break;
    }
    cursor.page++;
  }

  result.cursor = cursor;
  return result;
}

async function upsertFollowers(service: Service, series: FollowerSeries[]): Promise<number> {
  const rows: Record<string, unknown>[] = [];
  const now = new Date().toISOString();
  for (const s of series) {
    if (s.accountId.startsWith('_')) continue;
    for (const p of s.points) {
      rows.push({
        account_id: s.accountId,
        platform: s.platform,
        username: s.username,
        day: p.date,
        followers: p.followers,
        followers_gained: p.gained,
        followers_lost: p.lost,
        synced_at: now,
      });
    }
  }
  if (!rows.length) return 0;
  const { error } = await service.from('account_metrics_daily').upsert(rows, { onConflict: 'account_id,day' });
  if (error) throw new Error(`Falha ao gravar seguidores: ${error.message}`);
  return rows.length;
}

async function upsertDaily(
  service: Service,
  accountId: string,
  platform: string | null,
  points: DailyPoint[],
): Promise<number> {
  const now = new Date().toISOString();
  const rows = points.map((p) => ({
    account_id: accountId,
    platform,
    day: p.date,
    impressions: p.impressions,
    reach: p.reach,
    views: p.views,
    likes: p.likes,
    comments: p.comments,
    shares: p.shares,
    saves: p.saves,
    clicks: p.clicks,
    interactions: sumOrNull([p.likes, p.comments, p.shares, p.saves]),
    synced_at: now,
  }));
  if (!rows.length) return 0;
  const { error } = await service.from('account_metrics_daily').upsert(rows, { onConflict: 'account_id,day' });
  if (error) throw new Error(`Falha ao gravar métricas do dia: ${error.message}`);
  return rows.length;
}

/** Teto de miniaturas baixadas por execução (cada uma é um fetch + upload). */
const THUMBS_PER_RUN = 20;

/**
 * Guarda a miniatura dos posts no bucket privado `renders` (thumbs/posts/<id>.jpg):
 * o CDN do Instagram não serve <img> para o navegador. Só os que ainda não
 * estão lá; falhar aqui não afeta as métricas.
 */
async function cachePostThumbs(service: Service, posts: PostRow[]): Promise<void> {
  let done = 0;
  for (const post of posts) {
    if (done >= THUMBS_PER_RUN) break;
    if (!post.thumbnailUrl) continue;
    const path = `thumbs/posts/${post.id}.jpg`;
    if (await thumbExists(service, path)) continue;
    await cacheThumb(service, post.thumbnailUrl, path);
    done++;
  }
}

async function upsertPosts(service: Service, posts: PostRow[], day: string): Promise<number> {
  // miniatura de TODO post com imagem (não só os com métrica sincronizada):
  // a tela mostra o post mesmo antes de as métricas chegarem
  await cachePostThumbs(service, posts);
  const synced = posts.filter((p) => p.syncStatus === 'synced' || p.platforms.some((x) => x.syncStatus === 'synced'));
  if (!synced.length) return 0;

  // Peça do Content Engine por zernio_post_id (quando a publicação saiu daqui).
  const pieceByPost = new Map<string, string>();
  const { data: links } = await service
    .from('published_posts')
    .select('zernio_post_id, piece_id')
    .in(
      'zernio_post_id',
      synced.map((p) => p.id),
    );
  for (const link of (links ?? []) as Array<{ zernio_post_id: string | null; piece_id: string }>) {
    if (link.zernio_post_id) pieceByPost.set(link.zernio_post_id, link.piece_id);
  }

  const now = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const post of synced) {
    const targets = post.platforms.length
      ? post.platforms
      : [{ platform: post.platform ?? 'unknown', accountId: post.accountId, url: post.url, syncStatus: post.syncStatus, analytics: post.analytics }];
    for (const target of targets) {
      const status = target.syncStatus ?? post.syncStatus;
      if (status !== 'synced') continue;
      const key = `${post.id}|${target.platform}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Métrica da plataforma; quando ela veio vazia, a do topo do post.
      const hasOwn = METRICS.some((m) => target.analytics[m] !== null);
      const a = hasOwn ? target.analytics : post.analytics;
      rows.push({
        zernio_post_id: post.id,
        piece_id: pieceByPost.get(post.id) ?? null,
        platform: target.platform,
        account_id: target.accountId,
        media_type: post.mediaType,
        day,
        published_at: post.publishedAt,
        content: post.content ? post.content.slice(0, 500) : null,
        url: target.url ?? post.url,
        impressions: a.impressions,
        reach: a.reach,
        likes: a.likes,
        comments: a.comments,
        shares: a.shares,
        saves: a.saves,
        clicks: a.clicks,
        views: a.views,
        engagement_rate: a.engagementRate,
        sync_status: 'synced',
        synced_at: now,
      });
    }
  }
  if (!rows.length) return 0;
  const { error } = await service
    .from('post_metrics_daily')
    .upsert(rows, { onConflict: 'zernio_post_id,platform,day' });
  if (error) throw new Error(`Falha ao gravar métricas das publicações: ${error.message}`);
  return rows.length;
}

function sumOrNull(values: Array<number | null>): number | null {
  const valid = values.filter((v): v is number => typeof v === 'number');
  return valid.length ? valid.reduce((a, b) => a + b, 0) : null;
}
