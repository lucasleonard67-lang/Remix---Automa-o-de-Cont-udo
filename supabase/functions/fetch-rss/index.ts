// fetch-rss — coleta os feeds RSS ativos do Radar, grava o estado de cada fonte
// e dá nota (relevância × tendência) às notícias novas.
//
// Módulos: parse.ts (parser RSS/Atom/RDF puro) · fetch-feed.ts (download +
// motivo de erro em pt-BR) · score.ts (relevance/virality/topics via llm.ts).
//
// POST { feed_id?: uuid, score?: boolean }
//   → 200 { ok, totalNew, scored, pending, warning, results: [{ feed_id, feed, fetched, new } | { feed_id, feed, error }] }
//
// Dupla auth (verify_jwt=false; validação TODA interna):
// - header x-cron-secret == Vault RSS_CRON_SECRET  → cron (invoke_fetch_rss)
// - JWT de ADMIN (getUser + has_role)              → botão "Atualizar agora"
// Qualquer outra coisa → 401. Falha fechada: sem secret no Vault, o caminho
// do cron nega tudo.
//
// Por que cada fonte falha sozinha: uma falha (site fora, URL errada, 400 da
// Globo para caminho inexistente) é gravada em rss_feeds.last_error e NÃO
// interrompe as outras. A tela mostra o motivo no ladrilho da fonte.
//
// Auto-registro de URL (lição do remix): toda execução faz upsert de
// app_settings.instance_url = env SUPABASE_URL — o invoke_fetch_rss() do cron
// lê de lá, nunca de URL hardcoded.

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';
import { fetchFeed } from './fetch-feed.ts';
import { scorePendingItems } from './score.ts';
import { segredoIgual } from '../_shared/segredo-igual.ts';

type ServiceClient = ReturnType<typeof createServiceClient>;

/** Fontes baixadas ao mesmo tempo. 4 mantém 10 feeds dentro de ~2 timeouts. */
const FEED_CONCURRENCY = 4;

type FeedRow = { id: string; url: string; name: string; active: boolean };

type FeedResult =
  | { feed_id: string; feed: string; fetched: number; new: number }
  | { feed_id: string; feed: string; error: string };

// ── Auth ─────────────────────────────────────────────────────────────────────

/** 'cron' | 'admin' | null (não autorizado). */
async function resolveCaller(req: Request, service: ServiceClient): Promise<'cron' | 'admin' | null> {
  const cronSecret = req.headers.get('x-cron-secret');
  if (cronSecret) {
    const { data } = await service.rpc('get_vault_secret', { _name: 'RSS_CRON_SECRET' });
    if (segredoIgual(cronSecret, data)) return 'cron';
    return null; // secret errado nunca cai no caminho de JWT
  }

  const user = await getUser(req);
  if (!user) return null;
  const { data: isAdmin } = await service.rpc('has_role', { _user_id: user.id, _role: 'admin' });
  return isAdmin === true ? 'admin' : null;
}

// ── Coleta de uma fonte ──────────────────────────────────────────────────────

async function collectFeed(service: ServiceClient, feed: FeedRow): Promise<FeedResult> {
  const now = new Date().toISOString();
  const result = await fetchFeed(feed.url);

  if (!result.ok) {
    console.warn(`[fetch-rss] ${feed.name}: ${result.code}${result.status ? ' ' + result.status : ''} — ${feed.url}`);
    await service
      .from('rss_feeds')
      .update({ last_fetched_at: now, last_error: result.reason, last_error_at: now })
      .eq('id', feed.id);
    return { feed_id: feed.id, feed: feed.name, error: result.reason };
  }

  const rows = result.items.map((it) => ({
    feed_id: feed.id,
    guid: it.guid,
    title: it.title,
    link: it.link,
    description: it.description,
    published_at: it.published_at,
  }));

  // Dedupe: UNIQUE(feed_id,guid) + ignoreDuplicates — item repetido não conta.
  const { error: upErr, count } = await service
    .from('rss_items')
    .upsert(rows, { onConflict: 'feed_id,guid', ignoreDuplicates: true, count: 'exact' });

  if (upErr) {
    console.error(`[fetch-rss] ${feed.name}: upsert falhou — ${upErr.message}`);
    const reason =
      'O feed abriu, mas não conseguimos guardar as notícias. Tente “Atualizar agora” em instantes; se repetir, avise o administrador.';
    await service
      .from('rss_feeds')
      .update({ last_fetched_at: now, last_error: reason, last_error_at: now })
      .eq('id', feed.id);
    return { feed_id: feed.id, feed: feed.name, error: reason };
  }

  await service
    .from('rss_feeds')
    .update({
      last_fetched_at: now,
      last_ok_at: now,
      last_error: null,
      last_error_at: null,
      last_item_count: rows.length,
    })
    .eq('id', feed.id);

  return { feed_id: feed.id, feed: feed.name, fetched: rows.length, new: count ?? 0 };
}

/** Pool simples: roda `fn` sobre `items` com no máximo `limit` em voo. */
async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function readBody(req: Request): Promise<{ feed_id?: string; score?: boolean }> {
  try {
    const text = await req.text();
    if (!text.trim()) return {};
    const json = JSON.parse(text) as Record<string, unknown>;
    return {
      feed_id: typeof json.feed_id === 'string' ? json.feed_id : undefined,
      score: typeof json.score === 'boolean' ? json.score : undefined,
    };
  } catch {
    return {};
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return errorResponse(405, 'invalid_input', 'Use POST.');
  }

  try {
    const service = createServiceClient();
    const caller = await resolveCaller(req, service);
    if (!caller) {
      return errorResponse(401, 'unauthorized', 'Apenas o cron interno ou administradores.');
    }
    const body = await readBody(req);

    // Auto-registro da URL da instância (o cron lê de app_settings)
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    if (supabaseUrl) {
      await service
        .from('app_settings')
        .upsert({ key: 'instance_url', value: { url: supabaseUrl } }, { onConflict: 'key' });
    }

    // Kill switch do cron (o botão da UI ignora — admin pediu explicitamente)
    if (caller === 'cron') {
      const { data: radar } = await service
        .from('app_settings')
        .select('value')
        .eq('key', 'radar')
        .maybeSingle();
      if ((radar?.value as { fetch_enabled?: boolean } | null)?.fetch_enabled === false) {
        return jsonResponse({ ok: true, skipped: 'fetch_enabled=false', totalNew: 0, scored: 0, results: [] });
      }
    }

    let feedsQuery = service.from('rss_feeds').select('id, url, name, active');
    // Uma fonte específica (botão "Testar" do modal) roda mesmo desligada.
    feedsQuery = body.feed_id ? feedsQuery.eq('id', body.feed_id) : feedsQuery.eq('active', true);
    const { data: feeds, error: feedsError } = await feedsQuery;
    if (feedsError) {
      return errorResponse(500, 'internal_error', `Falha ao listar feeds: ${feedsError.message}`);
    }

    const results = await mapWithLimit((feeds ?? []) as FeedRow[], FEED_CONCURRENCY, (feed) =>
      collectFeed(service, feed).catch((err) => {
        // Último anteparo: um bug numa fonte não derruba a resposta inteira.
        console.error(`[fetch-rss] ${feed.name}: erro inesperado —`, err instanceof Error ? err.message : err);
        return {
          feed_id: feed.id,
          feed: feed.name,
          error: 'Falha inesperada ao ler esta fonte. Tentamos de novo na próxima atualização.',
        } satisfies FeedResult;
      }),
    );

    const totalNew = results.reduce((acc, r) => acc + ('new' in r ? r.new : 0), 0);

    // Notas das notícias novas (e do que ficou pendente de rodadas anteriores).
    let scored = 0;
    let pending = 0;
    let warning: string | null = null;
    if (body.score !== false) {
      try {
        const summary = await scorePendingItems(service);
        scored = summary.scored;
        pending = summary.pending;
        warning = summary.warning;
      } catch (err) {
        console.error('[fetch-rss] score falhou:', err instanceof Error ? err.message : err);
        warning = 'As notas das notícias não foram calculadas agora; a próxima atualização tenta de novo.';
      }
    }

    const failed = results.filter((r) => 'error' in r).length;
    console.info(
      `[fetch-rss] ${caller}: ${feeds?.length ?? 0} fontes (${failed} com erro), ${totalNew} novas, ${scored} pontuadas, ${pending} pendentes`,
    );
    return jsonResponse({ ok: true, totalNew, scored, pending, warning, results });
  } catch (err) {
    console.error('[fetch-rss] erro inesperado:', err instanceof Error ? err.message : err);
    return errorResponse(500, 'internal_error', 'Falha inesperada.');
  }
});
