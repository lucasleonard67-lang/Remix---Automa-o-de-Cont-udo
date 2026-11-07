// competitor-sync — módulo Mercado: concorrentes do Instagram e os posts
// públicos deles, lidos pelo Apify (token do cliente no Vault: APIFY_TOKEN) e
// pontuados no mesmo critério do Radar (_shared/market-score.ts). Grava o
// resumo pronto para o Dashboard em app_settings.market
// (_shared/market-summary.ts).
//
// Deploy config: verify_jwt = false — a validação é TODA interna, como em
// fetch-rss: header x-cron-secret == Vault MARKET_CRON_SECRET (cron diário,
// invoke_market_sync) OU JWT de ADMIN (getUser + has_role). Falha fechada.
//
// Cron: POST { action: 'sync' } com x-cron-secret → roda `sync` em lotes até
// `remaining` = 0 dentro do orçamento de tempo; se sobrar, a função se chama
// de novo (até MAX_HOPS) com o mesmo `before`. Grava last_run_at em
// app_settings.market. Sem APIFY_TOKEN sai com `skipped`.
//
// POST { action: 'list' }                          → { competitors, apify_configured }
// POST { action: 'add', handle }                   → { competitor }
// POST { action: 'remove', id }                    → { ok: true }
// POST { action: 'sync', competitor_id?, before? } → { synced: [{handle, posts, error}], remaining, warning }
//
// `sync` é RETOMÁVEL: processa até BATCH perfis por chamada (um run do Apify
// com os perfis em lote, uma chamada de IA por lote) e devolve `remaining` —
// a tela chama de novo até zerar. Sem `competitor_id`, entram os concorrentes
// ligados cuja última leitura é anterior a `before` (padrão: 30 min atrás);
// a tela manda `before = agora` no início de um "Sincronizar agora" e repete o
// mesmo valor até `remaining` = 0. Toda chamada que lê algo refaz o resumo.

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';
import { cacheThumb, isCachedThumb } from '../_shared/thumbs.ts';
import {
  ApifyError,
  fetchProfilePosts,
  fetchProfiles,
  normalizeHandle,
  type ApifyPost,
} from '../_shared/market-apify.ts';
import {
  aiWarning,
  engagementOf,
  engagementRank,
  hoursSince,
  loadBrandSummary,
  scoreBatchWithAi,
  virality,
  type LlmItem,
  type ScoreInput,
} from '../_shared/market-score.ts';
import {
  buildMarketSummary,
  saveMarketSummary,
  type CompetitorRow,
} from '../_shared/market-summary.ts';
import { segredoIgual } from '../_shared/segredo-igual.ts';

type Service = ReturnType<typeof createServiceClient>;

/** Perfis por chamada: um run do Apify com 2 perfis cabe no tempo da função. */
const BATCH = 2;
const POSTS_PER_PROFILE = 12;
const STALE_MINUTES = 30;
const MAX_COMPETITORS = 12;

/** Cron diário (invoke_market_sync): segredo do Vault e orçamento por chamada. */
const CRON_SECRET_NAME = 'MARKET_CRON_SECRET';
/** Não abre um lote novo depois disso (um lote do Apify leva ~20–60 s). */
const CRON_BUDGET_MS = 75_000;
/** Continuações encadeadas por dia (12 perfis ÷ 2 por lote cabem em 1–3 hops). */
const CRON_MAX_HOPS = 6;

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    if (req.method !== 'POST') return errorResponse(405, 'invalid_input', 'Use POST { action, ... }.');
    const service = createServiceClient();

    // Caminho do cron: segredo errado nunca cai no caminho de JWT.
    const cronSecret = req.headers.get('x-cron-secret');
    if (cronSecret) {
      const expected = await getSecret(service, CRON_SECRET_NAME);
      if (!expected || !segredoIgual(cronSecret, expected)) {
        return errorResponse(401, 'unauthorized', 'x-cron-secret inválido.');
      }
      let cronBody: Record<string, unknown> = {};
      try {
        const text = await req.text();
        if (text) cronBody = JSON.parse(text) as Record<string, unknown>;
      } catch (_err) {
        cronBody = {};
      }
      return await handleCronSync(service, cronBody, expected);
    }

    const user = await getUser(req);
    if (!user) return errorResponse(401, 'unauthorized', 'Sessão inválida ou ausente.');

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch (_err) {
      return errorResponse(400, 'invalid_input', 'Body JSON inválido.');
    }

    const { data: isAdmin, error: roleError } = await service.rpc('has_role', {
      _user_id: user.id,
      _role: 'admin',
    });
    if (roleError) {
      return errorResponse(500, 'internal_error', `Falha ao verificar papel: ${roleError.message}`);
    }
    if (isAdmin !== true) {
      return errorResponse(403, 'forbidden', 'Apenas administradores podem gerenciar os concorrentes.');
    }

    switch (body.action) {
      case 'list':
        return await handleList(service);
      case 'add':
        return await handleAdd(service, body.handle);
      case 'remove':
        return await handleRemove(service, body.id);
      case 'sync':
        return await handleSync(service, body);
      default:
        return errorResponse(400, 'invalid_input', `Action desconhecida: ${String(body.action)}.`);
    }
  } catch (err) {
    if (err instanceof ApifyError) return errorResponse(err.status, err.code, err.message);
    console.error('[competitor-sync] erro inesperado:', err instanceof Error ? err.message : err);
    return errorResponse(500, 'internal_error', 'Falha inesperada ao ler o mercado. Tente de novo.');
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getSecret(service: Service, name: string): Promise<string | null> {
  const { data, error } = await service.rpc('get_vault_secret', { _name: name });
  if (error) return null;
  const value = data as string | null;
  return value && value.length > 0 ? value : null;
}

async function loadCompetitors(service: Service): Promise<CompetitorRow[]> {
  const { data, error } = await service
    .from('competitors')
    .select('id, handle, name, avatar_url, followers, enabled, last_sync_at, last_error')
    .order('created_at');
  if (error) throw new Error(`Falha ao ler concorrentes: ${error.message}`);
  return (data ?? []) as CompetitorRow[];
}

async function refreshSummary(service: Service): Promise<void> {
  const zernioKey = await getSecret(service, 'ZERNIO_API_KEY');
  const summary = await buildMarketSummary(service, zernioKey);
  await saveMarketSummary(service, summary);
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function handleList(service: Service): Promise<Response> {
  const [competitors, token] = await Promise.all([loadCompetitors(service), getSecret(service, 'APIFY_TOKEN')]);
  return jsonResponse({ competitors, apify_configured: Boolean(token) });
}

async function handleAdd(service: Service, rawHandle: unknown): Promise<Response> {
  const handle = typeof rawHandle === 'string' ? normalizeHandle(rawHandle) : null;
  if (!handle) {
    return errorResponse(400, 'invalid_input', 'Informe o @ do perfil no Instagram (letras, números, ponto e sublinhado).');
  }
  const existing = await loadCompetitors(service);
  if (existing.some((c) => c.handle === handle)) {
    return errorResponse(409, 'duplicate', `@${handle} já está na sua lista de concorrentes.`);
  }
  if (existing.length >= MAX_COMPETITORS) {
    return errorResponse(
      400,
      'limit_reached',
      `Você já acompanha ${MAX_COMPETITORS} concorrentes. Remova um para adicionar outro.`,
    );
  }
  const { data, error } = await service
    .from('competitors')
    .insert({ handle, platform: 'instagram' })
    .select('id, handle, name, avatar_url, followers, enabled, last_sync_at, last_error')
    .single();
  if (error) throw new Error(`Falha ao adicionar concorrente: ${error.message}`);
  return jsonResponse({ competitor: data });
}

async function handleRemove(service: Service, rawId: unknown): Promise<Response> {
  if (typeof rawId !== 'string' || !rawId) return errorResponse(400, 'invalid_input', 'Informe o concorrente a remover.');
  const { error } = await service.from('competitors').delete().eq('id', rawId);
  if (error) throw new Error(`Falha ao remover concorrente: ${error.message}`);
  // Resumo sem o perfil removido (não depende do Apify).
  try {
    await refreshSummary(service);
  } catch (err) {
    console.warn('[competitor-sync] resumo após remoção falhou:', err instanceof Error ? err.message : err);
  }
  return jsonResponse({ ok: true });
}

type SyncOutcome = {
  synced: Array<{ id: string; handle: string; posts: number; error: string | null }>;
  remaining: number;
  warning: string | null;
};

async function handleSync(service: Service, body: Record<string, unknown>): Promise<Response> {
  const outcome = await syncBatch(service, body);
  return outcome instanceof Response ? outcome : jsonResponse(outcome);
}

/** Um lote de `sync`; devolve a Response de erro quando não dá para rodar. */
async function syncBatch(service: Service, body: Record<string, unknown>): Promise<Response | SyncOutcome> {
  const token = await getSecret(service, 'APIFY_TOKEN');
  if (!token) {
    return errorResponse(
      400,
      'apify_not_configured',
      'Conecte o Apify em Config → Integrações para ler os posts dos concorrentes.',
    );
  }

  const all = await loadCompetitors(service);
  const enabled = all.filter((c) => c.enabled);
  const beforeIso =
    typeof body.before === 'string' && !Number.isNaN(new Date(body.before).getTime())
      ? new Date(body.before).toISOString()
      : new Date(Date.now() - STALE_MINUTES * 60_000).toISOString();

  let queue: CompetitorRow[];
  if (typeof body.competitor_id === 'string' && body.competitor_id) {
    queue = enabled.filter((c) => c.id === body.competitor_id);
    if (queue.length === 0) return errorResponse(404, 'not_found', 'Esse concorrente não está mais na lista.');
  } else {
    queue = enabled
      .filter((c) => !c.last_sync_at || c.last_sync_at < beforeIso)
      .sort((a, b) => (a.last_sync_at ?? '').localeCompare(b.last_sync_at ?? ''));
  }
  if (queue.length === 0) {
    await refreshSummary(service);
    return { synced: [], remaining: 0, warning: null };
  }

  const batch = queue.slice(0, BATCH);
  const now = new Date().toISOString();

  // 1. Apify: um run com os perfis do lote. Erro geral (token, créditos,
  //    timeout) sobe como ApifyError → resposta com código; o perfil fica
  //    com last_error para a tela mostrar.
  let profiles;
  try {
    profiles = await fetchProfiles(token, batch.map((c) => c.handle), POSTS_PER_PROFILE);
  } catch (err) {
    if (err instanceof ApifyError) {
      await Promise.all(
        batch.map((c) => service.from('competitors').update({ last_error: err.message, last_sync_at: now }).eq('id', c.id)),
      );
    }
    throw err;
  }

  // 2. Grava perfil + posts (métricas sempre; notas só para quem ainda não tem).
  const synced: Array<{ id: string; handle: string; posts: number; error: string | null }> = [];
  for (const competitor of batch) {
    const profile = profiles.find((p) => p.handle === competitor.handle) ?? profiles[batch.indexOf(competitor)];
    let posts: ApifyPost[] = profile?.posts ?? [];
    let error = profile?.error ?? null;
    if (!error && posts.length === 0) {
      try {
        posts = await fetchProfilePosts(token, competitor.handle, POSTS_PER_PROFILE);
      } catch (err) {
        error = err instanceof Error ? err.message : 'Não foi possível ler os posts deste perfil.';
      }
      if (!error && posts.length === 0) error = 'O perfil não tem posts públicos recentes.';
    }

    const followers = profile?.followers ?? competitor.followers ?? null;
    await service
      .from('competitors')
      .update({
        name: profile?.name ?? competitor.name,
        avatar_url: profile?.avatar_url ?? competitor.avatar_url,
        followers,
        last_sync_at: now,
        last_error: error,
      })
      .eq('id', competitor.id);

    // Foto do dia: é o que permite, com o tempo, comparar o CRESCIMENTO do
    // concorrente (nenhuma ferramenta tem isso sem gravar todo dia). Só com
    // leitura real do perfil; falhar aqui não derruba a leitura.
    if (profile?.followers != null) {
      const { error: snapError } = await service
        .from('competitor_metrics_daily')
        .upsert(
          { competitor_id: competitor.id, day: now.slice(0, 10), followers: profile.followers },
          { onConflict: 'competitor_id,day' },
        );
      if (snapError) console.warn('[competitor-sync] foto diária falhou:', snapError.message);
    }

    if (posts.length) {
      // Miniaturas: o CDN do Instagram não serve <img> para o navegador; o
      // servidor guarda no bucket privado `renders` (uma vez por post).
      const { data: known } = await service
        .from('competitor_posts')
        .select('platform_post_id, thumbnail_url')
        .in('platform_post_id', posts.map((p) => `ig:${p.platform_post_id}`));
      const cachedUrl = new Map<string, string>();
      for (const row of (known ?? []) as Array<{ platform_post_id: string; thumbnail_url: string | null }>) {
        if (isCachedThumb(row.thumbnail_url)) cachedUrl.set(row.platform_post_id, row.thumbnail_url as string);
      }
      const thumbs = new Map<string, string | null>();
      for (const p of posts) {
        const key = `ig:${p.platform_post_id}`;
        if (cachedUrl.has(key)) { thumbs.set(key, cachedUrl.get(key) ?? null); continue; }
        if (!p.thumbnail_url) { thumbs.set(key, null); continue; }
        thumbs.set(key, (await cacheThumb(service, p.thumbnail_url, `thumbs/market/${p.platform_post_id}.jpg`)) ?? p.thumbnail_url);
      }
      const rows = posts.map((p) => ({
        competitor_id: competitor.id,
        platform_post_id: `ig:${p.platform_post_id}`,
        url: p.url,
        caption: p.caption,
        media_type: p.media_type,
        thumbnail_url: thumbs.get(`ig:${p.platform_post_id}`) ?? p.thumbnail_url,
        posted_at: p.posted_at,
        likes: p.likes,
        comments: p.comments,
        views: p.views,
        engagement: engagementOf(p, followers),
        fetched_at: now,
      }));
      const { error: upsertError } = await service
        .from('competitor_posts')
        .upsert(rows, { onConflict: 'platform_post_id' });
      if (upsertError) console.warn('[competitor-sync] upsert de posts falhou:', upsertError.message);
    }
    synced.push({ id: competitor.id, handle: competitor.handle, posts: posts.length, error });
  }

  // 3. Notas (IA em UMA chamada por lote) para os posts sem nota.
  const warning = await scorePending(service, batch.map((c) => c.id));

  // 4. Resumo para o Dashboard.
  await refreshSummary(service);

  const remaining = queue.length - batch.length;
  return { synced, remaining, warning };
}

// ── Cron diário ──────────────────────────────────────────────────────────────

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

async function handleCronSync(
  service: Service,
  body: Record<string, unknown>,
  secret: string,
): Promise<Response> {
  const startedAt = Date.now();
  const hop = typeof body.hop === 'number' && Number.isFinite(body.hop) ? Math.trunc(body.hop) : 0;
  // O mesmo `before` em todas as fatias do dia: quem já foi lido não volta à fila.
  const before =
    typeof body.before === 'string' && !Number.isNaN(new Date(body.before).getTime())
      ? new Date(body.before).toISOString()
      : new Date(startedAt).toISOString();

  const token = await getSecret(service, 'APIFY_TOKEN');
  if (!token) {
    await markMarketRun(service, { skipped: 'apify_not_configured', error: null });
    return jsonResponse({ ok: true, skipped: 'apify_not_configured', synced: 0, remaining: 0 });
  }

  let rounds = 0;
  let synced = 0;
  let remaining = 0;
  let error: string | null = null;
  try {
    do {
      const outcome = await syncBatch(service, { before });
      if (outcome instanceof Response) {
        const payload = (await outcome.json().catch(() => null)) as { error?: { message?: string } } | null;
        error = payload?.error?.message ?? `competitor-sync respondeu ${outcome.status}.`;
        break;
      }
      rounds++;
      synced += outcome.synced.length;
      remaining = outcome.remaining;
    } while (remaining > 0 && Date.now() - startedAt < CRON_BUDGET_MS);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Falha inesperada ao ler o mercado.';
    console.error('[competitor-sync] cron:', error);
  }

  let continued = false;
  if (!error && remaining > 0 && hop < CRON_MAX_HOPS) {
    continued = scheduleContinuation(secret, { action: 'sync', before, hop: hop + 1 });
  }
  // Só a última fatia fecha a rodada (last_run_at); as outras não mexem no resumo.
  if (!continued) {
    await markMarketRun(service, { skipped: null, error });
  }

  return jsonResponse({ ok: !error, rounds, synced, remaining, continued, hop, error });
}

/** Mescla o estado da rodada em app_settings.market sem apagar o resumo. */
async function markMarketRun(
  service: Service,
  run: { skipped: string | null; error: string | null },
): Promise<void> {
  const { data } = await service.from('app_settings').select('value').eq('key', 'market').maybeSingle();
  const current =
    data?.value && typeof data.value === 'object' && !Array.isArray(data.value)
      ? (data.value as Record<string, unknown>)
      : {};
  const now = new Date().toISOString();
  const { error } = await service.from('app_settings').upsert(
    {
      key: 'market',
      value: {
        ...current,
        last_run_at: now,
        last_run_ok_at: run.error ? current.last_run_ok_at ?? null : now,
        last_run_error: run.error,
        last_run_skipped: run.skipped,
      },
    },
    { onConflict: 'key' },
  );
  if (error) console.warn('[competitor-sync] não gravou app_settings.market.last_run_at:', error.message);
}

/** Dispara a próxima fatia sem esperar a resposta (a função atual já devolve). */
function scheduleContinuation(secret: string, body: Record<string, unknown>): boolean {
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
  if (!supabaseUrl) return false;
  try {
    const pending = fetch(`${supabaseUrl}/functions/v1/competitor-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret },
      body: JSON.stringify(body),
    }).then(
      () => undefined,
      (err) => console.warn('[competitor-sync] continuação falhou:', err instanceof Error ? err.message : err),
    );
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime) EdgeRuntime.waitUntil(pending);
    return true;
  } catch (err) {
    console.warn('[competitor-sync] continuação não disparou:', err instanceof Error ? err.message : err);
    return false;
  }
}

// ── Pontuação ────────────────────────────────────────────────────────────────

type PendingRow = {
  id: string;
  competitor_id: string;
  caption: string | null;
  media_type: string | null;
  posted_at: string | null;
  likes: number | null;
  comments: number | null;
  views: number | null;
  engagement: number | string | null;
};

async function scorePending(service: Service, competitorIds: string[]): Promise<string | null> {
  const [{ data: pendingRaw }, { data: allRaw }, { data: compRaw }, brand] = await Promise.all([
    service
      .from('competitor_posts')
      .select('id, competitor_id, caption, media_type, posted_at, likes, comments, views, engagement')
      .in('competitor_id', competitorIds)
      .is('scored_at', null)
      .order('posted_at', { ascending: false, nullsFirst: false })
      .limit(30),
    service.from('competitor_posts').select('engagement').not('engagement', 'is', null).limit(1000),
    service.from('competitors').select('id, handle').in('id', competitorIds),
    loadBrandSummary(service),
  ]);
  const pending = (pendingRaw ?? []) as PendingRow[];
  if (pending.length === 0) return null;

  const allEngagement = ((allRaw ?? []) as Array<{ engagement: unknown }>)
    .map((r) => Number(r.engagement))
    .filter((n) => Number.isFinite(n));
  const handles = new Map(((compRaw ?? []) as Array<{ id: string; handle: string }>).map((c) => [c.id, c.handle]));

  let warning: string | null = null;
  let ai = new Map<string, LlmItem>();
  if (!brand) {
    warning = 'A nota de relevância só é calculada depois que a marca estiver definida em Marca (persona e estratégia).';
  } else {
    const inputs: ScoreInput[] = pending.map((p) => ({
      id: p.id,
      handle: handles.get(p.competitor_id) ?? 'concorrente',
      caption: p.caption,
      media_type: p.media_type,
      likes: p.likes,
      comments: p.comments,
      views: p.views,
      engagement: p.engagement === null ? null : Number(p.engagement),
    }));
    try {
      ai = await scoreBatchWithAi(brand, inputs);
    } catch (err) {
      console.warn('[competitor-sync] nota por IA falhou:', err instanceof Error ? err.message : err);
      warning = aiWarning(err);
    }
  }

  const now = new Date().toISOString();
  const updates = pending.map((p) => {
    const a = ai.get(p.id) ?? null;
    const eng = p.engagement === null ? null : Number(p.engagement);
    const v = virality({
      rank: engagementRank(Number.isFinite(eng as number) ? (eng as number) : null, allEngagement),
      hours: hoursSince(p.posted_at),
      heat: a ? a.heat : null,
    });
    const complete = Boolean(a) || !brand;
    return {
      id: p.id,
      patch: {
        relevance: a ? a.relevance : null,
        virality: v,
        topics: a?.topics ?? [],
        score_reason: a?.reason || null,
        angle: a?.angle || null,
        // Falha transitória da IA → fica pendente para a próxima sincronização.
        scored_at: complete ? now : null,
      },
    };
  });

  for (let i = 0; i < updates.length; i += 10) {
    const slice = updates.slice(i, i + 10);
    const results = await Promise.all(slice.map((u) => service.from('competitor_posts').update(u.patch).eq('id', u.id)));
    for (const r of results) if (r.error) console.warn('[competitor-sync] update de nota falhou:', r.error.message);
  }
  return warning;
}
