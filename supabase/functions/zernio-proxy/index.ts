// zernio-proxy — única função que fala com a API Zernio (publicação real, Eixo 1
// de docs/10-plano-integracoes.md). A key sai do Vault (ZERNIO_API_KEY) e JAMAIS
// chega ao browser; o frontend só conversa com esta função.
//
// POST { action, ... } — actions:
//   connect-url     {platform, redirect_url?}          [admin] → { url }
//   list-accounts   {}                                          → { accounts: [...] }
//   setup-webhook   {}                                  [admin] → { ok, webhook_id }
//   publish         {piece_id, mode:'now'|'schedule'}           → { published_post: {...} }
//   get-status      {piece_id}                                  → { published_post: {...} | null }
//   retry           {published_post_id}                         → { published_post: {...} }
//   update-schedule {published_post_id, scheduled_for}          → { published_post: {...} }
//   cancel          {published_post_id}                         → { published_post: {...} }
//   analytics       {report, params?}                           → passthrough (allowlist)
//   publish-director {job_id, caption?}                         → { instagram: {...} }
//   director-status  {job_id}                                   → { instagram: {...} | null }
//
// Decisões (docs/10 Eixo 1):
// - Agendamento delegado ao Zernio (scheduledFor); sem pg_cron publisher.
// - Mídia sempre via /v1/media/presign (bucket renders é privado).
// - Idempotência: x-request-id = published_posts.request_id (estável por linha);
//   409 duplicate_content adota details.existingPostId quando é da MESMA peça.
// - Status assíncrono chega pelo zernio-webhook + Realtime; get-status é só
//   reconciliação on-demand (1 chamada ao abrir a peça, nunca polling).

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, createUserClient, getUser } from '../_shared/supabase.ts';
import { enforceRateLimit } from '../_shared/rate-limit.ts';
import { publishablePath } from '../_shared/publishable-video.ts';
import {
  ZernioError,
  zernioFetch,
  uploadMedia,
  CHANNEL_TO_PLATFORM,
  toPublishStatus,
  extractPlatformResult,
  mergeDirectorInstagram,
  type DirectorInstagramState,
} from '../_shared/zernio.ts';

type Json = Record<string, unknown>;
type ServiceClient = ReturnType<typeof createServiceClient>;

const CONNECT_PLATFORMS = ['instagram', 'twitter', 'threads', 'linkedin', 'facebook'] as const;

/** Eventos post.* que o setup-webhook assina (post.recycled fora — não usamos). */
const WEBHOOK_EVENTS = [
  'post.scheduled',
  'post.published',
  'post.failed',
  'post.partial',
  'post.cancelled',
  'post.platform.published',
  'post.platform.failed',
];

/** Allowlist de relatórios de analytics → rota GET da API (docs/10 Eixo 1 bônus). */
const ANALYTICS_ROUTES: Record<string, string> = {
  overview: '/v1/analytics',
  'daily-metrics': '/v1/analytics/daily-metrics',
  'follower-stats': '/v1/accounts/follower-stats',
  'best-time': '/v1/analytics/best-time',
  'post-timeline': '/v1/analytics/post-timeline',
  'posting-frequency': '/v1/analytics/posting-frequency',
  'content-decay': '/v1/analytics/content-decay',
  'ig-insights': '/v1/analytics/instagram/account-insights',
  'ig-follower-history': '/v1/analytics/instagram/follower-history',
  demographics: '/v1/analytics/instagram/demographics',
  'tiktok-insights': '/v1/analytics/tiktok/account-insights',
  'youtube-insights': '/v1/analytics/youtube/account-insights',
};

/** Parâmetros de query aceitos nos relatórios (docs.zernio.com/api/analytics). */
const ANALYTICS_PARAMS = new Set([
  'postId',
  'platform',
  'accountId',
  'accountIds',
  'fromDate',
  'toDate',
  'limit',
  'page',
  'sortBy',
  'order',
  'granularity',
  'metrics',
  'since',
  'until',
  'metric_type',
  'period',
  'days',
  'timezone',
]);

import { downloadRestoring } from '../_shared/drive-restore.ts';

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const user = await getUser(req);
    if (!user) return errorResponse(401, 'unauthorized', 'Sessão inválida ou ausente.');

    if (req.method !== 'POST') {
      return errorResponse(405, 'invalid_input', 'Use POST { action, ... }.');
    }

    let body: Json;
    try {
      body = (await req.json()) as Json;
    } catch (_err) {
      return errorResponse(400, 'invalid_input', 'Body JSON inválido.');
    }
    const action = body.action;

    const service = createServiceClient();
    const apiKey = await getZernioKey(service);
    if (!apiKey) {
      return errorResponse(
        400,
        'zernio_not_configured',
        'ZERNIO_API_KEY não configurada. Grave a key em Config → Integrações.',
      );
    }

    // Cota: 'publish' tem teto próprio (caro/irreversível); as demais chamadas
    // que batem na API Zernio compartilham 'zernio-read' — sem isso qualquer
    // usuário autenticado queimaria a cota da key da instância em loop.
    const readLimited = ['list-accounts', 'get-status', 'retry', 'analytics', 'director-status'].includes(
      String(action),
    )
      ? await enforceRateLimit(user.id, 'zernio-read')
      : null;
    if (readLimited) return readLimited;

    switch (action) {
      case 'connect-url':
        return await requireAdmin(service, user.id) ?? await handleConnectUrl(service, apiKey, body);
      case 'list-accounts':
        return await handleListAccounts(apiKey);
      case 'setup-webhook':
        return await requireAdmin(service, user.id) ?? await handleSetupWebhook(service, apiKey, req);
      // Publicar, repetir, reagendar e cancelar são do admin: aprovar e publicar
      // ficam com quem administra a instância; o usuário comum cria e revisa.
      case 'publish': {
        const forbidden = await requireAdmin(service, user.id);
        if (forbidden) return forbidden;
        const limited = await enforceRateLimit(user.id, 'zernio-publish');
        if (limited) return limited;
        return await handlePublish(service, apiKey, body, user.id);
      }
      case 'get-status':
        return await handleGetStatus(service, apiKey, body);
      case 'retry':
        return await requireAdmin(service, user.id) ?? await handleRetry(service, apiKey, body);
      case 'update-schedule':
        return await requireAdmin(service, user.id) ?? await handleUpdateSchedule(service, apiKey, body);
      case 'cancel':
        return await requireAdmin(service, user.id) ?? await handleCancel(service, apiKey, body);
      case 'analytics':
        return await handleAnalytics(apiKey, body);
      case 'publish-director': {
        const forbidden = await requireAdmin(service, user.id);
        if (forbidden) return forbidden;
        const limited = await enforceRateLimit(user.id, 'zernio-publish');
        if (limited) return limited;
        return await handlePublishDirector(service, apiKey, body);
      }
      case 'director-status':
        return await handleDirectorStatus(service, apiKey, body);
      default:
        return errorResponse(400, 'invalid_input', `Action desconhecida: ${String(action)}.`);
    }
  } catch (err) {
    if (err instanceof ZernioError) {
      // Erro da API Zernio não tratado pela action — repassa sem vazar headers.
      return errorResponse(err.status >= 500 ? 502 : err.status, `zernio_${err.code}`, err.message);
    }
    console.error('[zernio-proxy] erro inesperado:', err instanceof Error ? err.message : err);
    return errorResponse(500, 'internal_error', 'Falha inesperada.');
  }
});

// ── Helpers de auth/config ───────────────────────────────────────────────────

/** Retorna a resposta 403 quando o usuário NÃO é admin; null quando é. */
async function requireAdmin(service: ServiceClient, userId: string): Promise<Response | null> {
  const { data: isAdmin, error } = await service.rpc('has_role', {
    _user_id: userId,
    _role: 'admin',
  });
  if (error) {
    return errorResponse(500, 'internal_error', `Falha ao verificar papel: ${error.message}`);
  }
  return isAdmin === true
    ? null
    : errorResponse(403, 'forbidden', 'Apenas administradores podem executar esta ação.');
}

async function getZernioKey(service: ServiceClient): Promise<string | null> {
  const { data, error } = await service.rpc('get_vault_secret', { _name: 'ZERNIO_API_KEY' });
  if (error) return null;
  const value = data as string | null;
  return value && value.length > 0 ? value : null;
}

/** Lê app_settings.zernio ({profile_id, webhook_id, timezone}). */
async function getZernioSettings(service: ServiceClient): Promise<Json> {
  const { data } = await service
    .from('app_settings')
    .select('value')
    .eq('key', 'zernio')
    .maybeSingle();
  return ((data?.value ?? {}) as Json);
}

async function patchZernioSettings(service: ServiceClient, patch: Json): Promise<void> {
  const current = await getZernioSettings(service);
  const { error } = await service
    .from('app_settings')
    .upsert({ key: 'zernio', value: { ...current, ...patch } }, { onConflict: 'key' });
  if (error) throw new Error(`Falha ao gravar app_settings.zernio: ${error.message}`);
}

/**
 * Garante o profile Zernio da instância (single-tenant = 1 profile).
 * 409 profile_name_conflict → adota details.existingProfileId (spec /v1/profiles).
 */
async function ensureProfile(service: ServiceClient, apiKey: string): Promise<string> {
  const settings = await getZernioSettings(service);
  if (typeof settings.profile_id === 'string' && settings.profile_id) {
    return settings.profile_id;
  }

  let profileId: string | null = null;
  try {
    const created = await zernioFetch(apiKey, '/v1/profiles', {
      method: 'POST',
      body: { name: 'Content Engine' },
    });
    const profile = (created.profile ?? created) as Json;
    profileId = (profile._id ?? profile.id) as string | null;
  } catch (err) {
    if (err instanceof ZernioError && err.status === 409) {
      const details = (err.details ?? {}) as Json;
      profileId = (details.existingProfileId as string | undefined) ?? null;
    }
    if (!profileId) throw err;
  }

  if (!profileId) {
    throw new ZernioError(502, 'profile_create_failed', 'Zernio não devolveu o id do profile.');
  }
  await patchZernioSettings(service, { profile_id: profileId });
  return profileId;
}

// ── Actions: contas e webhook ────────────────────────────────────────────────

async function handleConnectUrl(
  service: ServiceClient,
  apiKey: string,
  body: Json,
): Promise<Response> {
  const platform = body.platform;
  if (typeof platform !== 'string' || !(CONNECT_PLATFORMS as readonly string[]).includes(platform)) {
    return errorResponse(
      400,
      'invalid_input',
      `Plataforma inválida. Aceitas: ${CONNECT_PLATFORMS.join(', ')}.`,
    );
  }

  const profileId = await ensureProfile(service, apiKey);
  const query: Record<string, string> = { profileId };
  if (typeof body.redirect_url === 'string' && body.redirect_url) {
    query.redirect_url = body.redirect_url;
  }

  const result = await zernioFetch(apiKey, `/v1/connect/${platform}`, { query });
  const url = (result.authUrl ?? result.url) as string | undefined;
  if (!url) {
    return errorResponse(502, 'zernio_invalid_response', 'Zernio não devolveu a URL de conexão.');
  }
  return jsonResponse({ url });
}

async function handleListAccounts(apiKey: string): Promise<Response> {
  const result = await zernioFetch(apiKey, '/v1/accounts');
  const rawAccounts = Array.isArray(result.accounts)
    ? (result.accounts as Json[])
    : Array.isArray(result)
      ? (result as unknown as Json[])
      : [];

  const accounts = rawAccounts.map((a) => ({
    accountId: String(a._id ?? a.id ?? a.accountId ?? ''),
    platform: String(a.platform ?? ''),
    name: String(a.name ?? a.username ?? a.displayName ?? ''),
    username: typeof a.username === 'string' ? a.username : null,
    avatar: typeof a.avatar === 'string' ? a.avatar : (typeof a.profilePicture === 'string' ? a.profilePicture : null),
  })).filter((a) => a.accountId && a.platform);

  return jsonResponse({ accounts });
}

/**
 * Gera o secret do webhook, grava no Vault (via client AUTENTICADO do admin —
 * store_vault_secret revalida admin por auth.uid()) e registra/atualiza a
 * subscription no Zernio apontando para a zernio-webhook pública.
 */
async function handleSetupWebhook(
  service: ServiceClient,
  apiKey: string,
  req: Request,
): Promise<Response> {
  const secretBytes = new Uint8Array(32);
  crypto.getRandomValues(secretBytes);
  const secret = Array.from(secretBytes, (b) => b.toString(16).padStart(2, '0')).join('');

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const webhookUrl = `${supabaseUrl}/functions/v1/zernio-webhook`;
  const settings = await getZernioSettings(service);

  const payload = {
    name: 'Content Engine',
    url: webhookUrl,
    secret,
    events: WEBHOOK_EVENTS,
  };

  // ORDEM IMPORTA: registra no Zernio PRIMEIRO; o Vault só muda com 2xx.
  // A ordem inversa deixava o Vault com secret novo e o Zernio assinando com o
  // antigo quando o registro falhava — todos os webhooks passariam a dar 401.
  let webhookId = typeof settings.webhook_id === 'string' ? settings.webhook_id : null;
  if (webhookId) {
    try {
      await zernioFetch(apiKey, '/v1/webhooks/settings', {
        method: 'PUT',
        body: { id: webhookId, ...payload },
      });
    } catch (err) {
      // Subscription sumiu do lado do Zernio (deletada no painel) → recria.
      if (err instanceof ZernioError && err.status === 404) {
        webhookId = null;
      } else {
        throw err;
      }
    }
  }
  if (!webhookId) {
    const created = await zernioFetch(apiKey, '/v1/webhooks/settings', {
      method: 'POST',
      body: payload,
    });
    const webhook = (created.webhook ?? created) as Json;
    webhookId = (webhook._id ?? webhook.id) as string | null;
  }

  const userClient = createUserClient(req);
  const { error: storeError } = await userClient.rpc('store_vault_secret', {
    _name: 'ZERNIO_WEBHOOK_SECRET',
    _value: secret,
  });
  if (storeError) {
    // Zernio já assina com o secret novo — sem ele no Vault o webhook nega
    // tudo. Erro pede re-execução (idempotente: PUT na mesma subscription).
    return errorResponse(
      500,
      'internal_error',
      `Webhook registrado no Zernio, mas falhou ao gravar o secret no Vault: ${storeError.message}. Execute "Configurar webhook" de novo.`,
    );
  }

  await patchZernioSettings(service, { webhook_id: webhookId });
  return jsonResponse({ ok: true, webhook_id: webhookId });
}

// ── Action: publish ──────────────────────────────────────────────────────────

type PieceRow = {
  id: string;
  channel_type: string;
  status: string;
  scheduled_at: string | null;
  render_path: string | null;
  adapted_content: Json;
};

/** Sentinela: mais de uma conta aceita o formato e ninguém escolheu. */
const AMBIGUOUS = '__ambiguous__';

/**
 * Conta de destino do formato.
 *
 * O modelo era FORMATO → uma conta (`channels.config.zernio_account_id`), que
 * prendia "Reel" a um único perfil. Agora é a CONTA que declara os formatos que
 * aceita (`app_settings.zernio_account_formats`): qualquer conta conectada pode
 * receber Reel, desde que o suporte esteja marcado.
 *
 * Precedência: conta pedida explicitamente → contas que declaram o formato →
 * mapeamento antigo por canal (compatibilidade com o que já está configurado).
 */
async function resolveAccountId(
  service: ServiceClient,
  channelType: string,
  requested: unknown,
): Promise<string | null> {
  if (typeof requested === 'string' && requested) return requested;

  const { data: setting } = await service
    .from('app_settings')
    .select('value')
    .eq('key', 'zernio_account_formats')
    .maybeSingle();
  const mapa = (setting?.value ?? {}) as Record<string, { formats?: string[] }>;
  const aceitam = Object.entries(mapa)
    .filter(([, v]) => Array.isArray(v?.formats) && v.formats.includes(channelType))
    .map(([id]) => id);
  if (aceitam.length === 1) return aceitam[0];
  if (aceitam.length > 1) return AMBIGUOUS;

  const { data: channel } = await service
    .from('channels')
    .select('config')
    .eq('type', channelType)
    .maybeSingle();
  const legado = ((channel?.config ?? {}) as Record<string, unknown>).zernio_account_id;
  return typeof legado === 'string' && legado ? legado : null;
}

async function handlePublish(
  service: ServiceClient,
  apiKey: string,
  body: Json,
  userId: string,
): Promise<Response> {
  const pieceId = body.piece_id;
  const mode = body.mode === 'schedule' ? 'schedule' : 'now';
  if (typeof pieceId !== 'string' || !pieceId) {
    return errorResponse(400, 'invalid_input', 'piece_id é obrigatório.');
  }

  // 1. Peça aprovada + canal mapeado ─────────────────────────────────────────
  const { data: piece, error: pieceError } = await service
    .from('content_pieces')
    .select('id, channel_type, status, scheduled_at, render_path, adapted_content')
    .eq('id', pieceId)
    .maybeSingle<PieceRow>();
  if (pieceError || !piece) {
    return errorResponse(404, 'not_found', 'Peça não encontrada.');
  }
  if (piece.status !== 'approved') {
    return errorResponse(409, 'piece_not_approved', 'Só peças aprovadas podem ser publicadas.');
  }
  if (mode === 'schedule') {
    if (!piece.scheduled_at) {
      return errorResponse(400, 'not_scheduled', 'Defina a data/hora no calendário antes de agendar.');
    }
    if (new Date(piece.scheduled_at).getTime() <= Date.now()) {
      return errorResponse(400, 'schedule_in_past', 'O horário agendado já passou — atualize o agendamento.');
    }
  }

  if (piece.channel_type === 'instagram_reel') {
    return errorResponse(
      400,
      'reel_without_video',
      'Este Reel ainda não tem vídeo. Para publicar vídeo, use Vídeos → Publicar no Instagram.',
    );
  }
  const platform = CHANNEL_TO_PLATFORM[piece.channel_type];
  if (!platform) {
    return errorResponse(400, 'channel_unsupported', `Canal ${piece.channel_type} não publica via Zernio.`);
  }

  const accountId = await resolveAccountId(service, piece.channel_type, body.account_id);
  if (accountId === AMBIGUOUS) {
    return errorResponse(
      400,
      'account_ambiguous',
      'Mais de uma conta aceita este formato — escolha a conta ao publicar.',
    );
  }
  if (typeof accountId !== 'string' || !accountId) {
    return errorResponse(
      400,
      'channel_not_mapped',
      'Nenhuma conta Zernio aceita este formato. Marque o formato numa conta em Config → Integrações.',
    );
  }

  // 2. Resolve a mídia ANTES de criar a linha (validação barata primeiro) ─────
  let mediaPaths: string[];
  try {
    mediaPaths = resolveMediaPaths(piece);
  } catch (err) {
    return errorResponse(400, 'media_missing', err instanceof Error ? err.message : String(err));
  }

  // 3. Linha de published_posts (claim single-flight via unique parcial) ─────
  //    Linha 'failed' sem zernio_post_id é reaproveitada (retry pré-Zernio
  //    mantém o request_id → idempotência de 5 min do Zernio ainda vale).
  const { data: latest } = await service
    .from('published_posts')
    .select('*')
    .eq('piece_id', piece.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let row: Json;
  if (latest && latest.status === 'failed' && !latest.zernio_post_id) {
    // `.eq('status','failed')` fecha a corrida do duplo clique neste ramo:
    // a segunda requisição encontra a linha já em 'pending' e sai com 409.
    const { data: reused, error: reuseError } = await service
      .from('published_posts')
      .update({
        status: 'pending',
        error: null,
        platform,
        account_id: accountId,
        scheduled_for: mode === 'schedule' ? piece.scheduled_at : null,
      })
      .eq('id', latest.id)
      .eq('status', 'failed')
      .select()
      .maybeSingle();
    if (reuseError) {
      return errorResponse(500, 'internal_error', `Falha ao reusar tentativa: ${reuseError.message}`);
    }
    if (!reused) {
      return errorResponse(
        409,
        'publish_in_flight',
        'Esta peça já tem uma publicação em andamento ou agendada.',
      );
    }
    row = reused as Json;
  } else {
    const { data: inserted, error: insertError } = await service
      .from('published_posts')
      .insert({
        piece_id: piece.id,
        platform,
        account_id: accountId,
        status: 'pending',
        scheduled_for: mode === 'schedule' ? piece.scheduled_at : null,
        created_by: userId,
      })
      .select()
      .single();
    if (insertError) {
      // 23505 no índice parcial = já existe tentativa ativa desta peça
      if (insertError.code === '23505') {
        return errorResponse(
          409,
          'publish_in_flight',
          'Esta peça já tem uma publicação em andamento ou agendada.',
        );
      }
      return errorResponse(500, 'internal_error', `Falha ao registrar publicação: ${insertError.message}`);
    }
    row = inserted as Json;
  }

  // 4. Upload da mídia (bucket privado → presign público estável do Zernio) ──
  try {
    const mediaUrls: string[] = [];
    for (const path of mediaPaths) {
      const blob = await downloadRestoring(service, 'renders', path);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const filename = path.split('/').pop() ?? 'render.png';
      mediaUrls.push(await uploadMedia(apiKey, { filename, contentType: 'image/png', bytes }));
    }

    // 5. Monta e envia o post ────────────────────────────────────────────────
    const settings = await getZernioSettings(service);
    const timezone = typeof settings.timezone === 'string' ? settings.timezone : 'America/Sao_Paulo';
    const postBody = buildPostBody(piece, platform, accountId, mediaUrls, {
      mode,
      scheduledAt: piece.scheduled_at,
      timezone,
      publishedPostId: row.id as string,
    });

    let created: Json;
    try {
      created = await zernioFetch(apiKey, '/v1/posts', {
        method: 'POST',
        body: postBody,
        headers: { 'x-request-id': row.request_id as string },
      });
    } catch (err) {
      // Dedup por hash de conteúdo (24h). Só adotamos o post existente quando
      // há PROVA de que ele é desta peça — adotar post alheio deixaria cancel/
      // update-schedule mexerem num agendamento que não é nosso.
      if (err instanceof ZernioError && err.status === 409) {
        const details = (err.details ?? {}) as Json;
        const existingPostId = details.existingPostId as string | undefined;
        if (!existingPostId) throw err;

        const duplicateError = new ZernioError(
          409,
          'duplicate_content',
          'O Zernio bloqueou: conteúdo idêntico publicado nas últimas 24h. Varie a legenda ou a mídia para republicar de propósito.',
        );

        const { data: owner } = await service
          .from('published_posts')
          .select('*')
          .eq('zernio_post_id', existingPostId)
          .maybeSingle();

        if (owner && owner.piece_id === piece.id) {
          // O post já pertence a OUTRA linha desta peça (retry após linha nova
          // criada). Adotar aqui violaria o unique de zernio_post_id — devolve
          // a linha dona sincronizada e descarta a linha recém-criada.
          if (owner.id !== (row.id as string)) {
            await service.from('published_posts').delete().eq('id', row.id as string);
            const synced = await syncFromZernio(service, apiKey, owner as Json);
            return jsonResponse({ published_post: synced });
          }
          created = { post: { id: existingPostId, status: mode === 'schedule' ? 'scheduled' : 'publishing' } };
        } else if (owner) {
          // Post de outra peça — erro real de conteúdo duplicado.
          throw duplicateError;
        } else {
          // Sem linha dona: pode ser um post NOSSO órfão (update pós-create
          // falhou) ou um post criado fora do Content Engine. A metadata que
          // enviamos no createPost é a prova de posse.
          let adopt = false;
          try {
            const found = await zernioFetch(apiKey, `/v1/posts/${existingPostId}`);
            const foundPost = (found.post ?? found) as Json;
            const metadata = (foundPost.metadata ?? {}) as Json;
            adopt = metadata.piece_id === piece.id;
          } catch (_lookupErr) {
            adopt = false;
          }
          if (!adopt) throw duplicateError;
          created = { post: { id: existingPostId, status: mode === 'schedule' ? 'scheduled' : 'publishing' } };
        }
      } else {
        throw err;
      }
    }

    // Retry idempotente ≤5min devolve 200 com existingPost no corpo.
    const post = (created.existingPost ?? created.post ?? created) as Json;
    const zernioPostId = (post.id ?? post._id) as string | undefined;
    if (!zernioPostId) {
      throw new Error('Zernio não devolveu o id do post criado.');
    }

    const { publishedUrl } = extractPlatformResult(post);
    const status = mode === 'schedule'
      ? 'scheduled'
      : toPublishStatus(post.status as string | undefined) === 'published'
        ? 'published'
        : 'publishing';

    const patch: Json = {
      zernio_post_id: zernioPostId,
      status,
      raw: post,
      error: null,
    };
    if (publishedUrl) patch.public_url = publishedUrl;
    if (status === 'published') patch.published_at = new Date().toISOString();

    // Guarda de corrida: o webhook pode ter confirmado 'published' ANTES deste
    // update (post.published chega em milissegundos no publishNow). Só a linha
    // ainda em 'pending' aceita o patch completo; senão preenche apenas os
    // campos que o webhook não conhece, sem rebaixar o status.
    const { data: updated, error: updateError } = await service
      .from('published_posts')
      .update(patch)
      .eq('id', row.id as string)
      .eq('status', 'pending')
      .select()
      .maybeSingle();
    if (updateError) {
      throw new Error(`Post criado no Zernio (${zernioPostId}) mas falhou ao gravar: ${updateError.message}`);
    }

    let finalRow = updated as Json | null;
    if (!finalRow) {
      const { data: filled } = await service
        .from('published_posts')
        .update({ zernio_post_id: zernioPostId })
        .eq('id', row.id as string)
        .is('zernio_post_id', null)
        .select()
        .maybeSingle();
      if (!filled) {
        const { data: current } = await service
          .from('published_posts')
          .select('*')
          .eq('id', row.id as string)
          .single();
        finalRow = current as Json;
      } else {
        finalRow = filled as Json;
      }
    }

    if ((finalRow?.status as string) === 'published') {
      // Nunca ressuscitar peça arquivada/rejeitada — só a aprovada promove.
      await service
        .from('content_pieces')
        .update({ status: 'published' })
        .eq('id', piece.id)
        .in('status', ['approved', 'published']);
    }

    return jsonResponse({ published_post: finalRow });
  } catch (err) {
    // Falha em qualquer etapa pós-claim: marca a linha e devolve o erro.
    const message = err instanceof ZernioError
      ? `${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
    await service
      .from('published_posts')
      .update({ status: 'failed', error: message })
      .eq('id', row.id as string);
    const status = err instanceof ZernioError ? (err.status >= 500 ? 502 : err.status) : 500;
    const code = err instanceof ZernioError ? `zernio_${err.code}` : 'publish_failed';
    return errorResponse(status, code, message);
  }
}

// ── Vídeo do Diretor → Reel ──────────────────────────────────────────────────
// Um vídeo único no Instagram vira Reel sozinho (docs.zernio.com/platforms/
// instagram/fields: contentType só existe para 'story'). Estado em
// director_jobs.artifacts.instagram; o zernio-webhook acha o job pela
// metadata.director_job_id.

const DIRECTOR_IG_ACTIVE = ['pending', 'publishing', 'published'];

async function handlePublishDirector(
  service: ServiceClient,
  apiKey: string,
  body: Json,
): Promise<Response> {
  const jobId = body.job_id;
  if (typeof jobId !== 'string' || !jobId) {
    return errorResponse(400, 'invalid_input', 'job_id é obrigatório.');
  }
  const caption = typeof body.caption === 'string' ? body.caption.trim().slice(0, 2200) : '';

  const { data: job } = await service
    .from('director_jobs')
    .select('id, status, artifacts, updated_at')
    .eq('id', jobId)
    .maybeSingle();
  if (!job) return errorResponse(404, 'not_found', 'Vídeo não encontrado.');
  if (job.status !== 'done') {
    return errorResponse(409, 'job_not_done', 'Só vídeos concluídos podem ser publicados.');
  }
  const artifacts = (job.artifacts ?? {}) as Json;
  const finalPath = publishablePath(artifacts);
  if (!finalPath) {
    return errorResponse(400, 'media_missing', 'O vídeo ainda não tem o MP4 final.');
  }
  const current = artifacts.instagram as DirectorInstagramState | undefined;
  if (current && DIRECTOR_IG_ACTIVE.includes(current.status)) {
    return errorResponse(
      409,
      'publish_in_flight',
      current.status === 'published'
        ? 'Este vídeo já foi publicado no Instagram.'
        : 'Este vídeo já está sendo publicado no Instagram.',
    );
  }

  const accountId = await resolveAccountId(service, 'instagram_reel', body.account_id);
  if (accountId === AMBIGUOUS) {
    return errorResponse(
      400,
      'account_ambiguous',
      'Mais de uma conta aceita Reels — deixe o formato Instagram Reel marcado em só uma conta (Config → Integrações).',
    );
  }
  if (typeof accountId !== 'string' || !accountId) {
    return errorResponse(
      400,
      'channel_not_mapped',
      'Nenhuma conta aceita Reels. Marque "Instagram Reel" na conta em Config → Integrações.',
    );
  }

  // Claim single-flight: só quem ainda vê o mesmo updated_at grava 'pending'.
  // Falha sem post criado reaproveita o request_id (idempotência do Zernio).
  const requestId = current?.status === 'failed' && !current.zernio_post_id && current.request_id
    ? current.request_id
    : crypto.randomUUID();
  const pending: DirectorInstagramState = {
    status: 'pending',
    request_id: requestId,
    account_id: accountId,
    error: null,
  };
  const { data: claimed } = await service
    .from('director_jobs')
    .update({ artifacts: { ...artifacts, instagram: pending } })
    .eq('id', jobId)
    .eq('updated_at', job.updated_at)
    .select('id')
    .maybeSingle();
  if (!claimed) {
    return errorResponse(409, 'publish_in_flight', 'O vídeo mudou agora há pouco — atualize a página.');
  }

  try {
    const blob = await downloadRestoring(service, 'renders', finalPath);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const videoUrl = await uploadMedia(apiKey, { filename: `${jobId}.mp4`, contentType: 'video/mp4', bytes });

    const created = await zernioFetch(apiKey, '/v1/posts', {
      method: 'POST',
      body: {
        content: caption,
        mediaItems: [{ type: 'video', url: videoUrl }],
        platforms: [{ platform: 'instagram', accountId, platformSpecificData: { isAiGenerated: true } }],
        metadata: { director_job_id: jobId },
        publishNow: true,
      },
      headers: { 'x-request-id': requestId },
    });

    const post = (created.existingPost ?? created.post ?? created) as Json;
    const zernioPostId = (post.id ?? post._id) as string | undefined;
    if (!zernioPostId) throw new Error('Zernio não devolveu o id do post criado.');
    const { publishedUrl } = extractPlatformResult(post);
    const published = toPublishStatus(post.status as string | undefined) === 'published';

    const state = await mergeDirectorInstagram(service, jobId, {
      status: published ? 'published' : 'publishing',
      zernio_post_id: zernioPostId,
      url: publishedUrl,
      published_at: published ? new Date().toISOString() : null,
    });
    return jsonResponse({ instagram: state });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await mergeDirectorInstagram(service, jobId, { status: 'failed', error: message });
    const status = err instanceof ZernioError ? (err.status >= 500 ? 502 : err.status) : 500;
    const code = err instanceof ZernioError ? `zernio_${err.code}` : 'publish_failed';
    return errorResponse(status, code, message);
  }
}

/** Reconciliação on-demand (botão "Atualizar") — cobre webhook não configurado. */
async function handleDirectorStatus(
  service: ServiceClient,
  apiKey: string,
  body: Json,
): Promise<Response> {
  const jobId = body.job_id;
  if (typeof jobId !== 'string' || !jobId) {
    return errorResponse(400, 'invalid_input', 'job_id é obrigatório.');
  }
  const { data: job } = await service
    .from('director_jobs')
    .select('artifacts')
    .eq('id', jobId)
    .maybeSingle();
  const current = ((job?.artifacts ?? {}) as Json).instagram as DirectorInstagramState | undefined;
  if (!current?.zernio_post_id || current.status === 'published') {
    return jsonResponse({ instagram: current ?? null });
  }
  const found = await zernioFetch(apiKey, `/v1/posts/${current.zernio_post_id}`);
  const post = (found.post ?? found) as Json;
  const { publishedUrl, error } = extractPlatformResult(post);
  const status = toPublishStatus(post.status as string | undefined);
  const state = await mergeDirectorInstagram(service, jobId, {
    status: status === 'published' ? 'published' : status === 'failed' ? 'failed' : 'publishing',
    url: publishedUrl,
    ...(status === 'failed' ? { error: error ?? 'Publicação falhou no Instagram (sem detalhe do Zernio).' } : {}),
    ...(status === 'published' ? { published_at: new Date().toISOString() } : {}),
  });
  return jsonResponse({ instagram: state });
}

/**
 * Resolve os paths (bucket renders) da mídia por canal. Lança com mensagem
 * acionável quando a arte obrigatória ainda não foi exportada/persistida.
 */
function resolveMediaPaths(piece: PieceRow): string[] {
  const adapted = piece.adapted_content ?? {};

  switch (piece.channel_type) {
    case 'instagram_post': {
      // Arte única do tweet-card: persistida em render_path pelo "Exportar PNG".
      if (!piece.render_path) {
        throw new Error('A arte desta peça ainda não foi gerada. Abra a peça na Biblioteca e publique por lá.');
      }
      return [piece.render_path];
    }
    case 'instagram_carousel':
    case 'instagram_stories': {
      // Artes por unidade: persistidas em adapted_content.slide_renders pelo export ZIP.
      const renders = Array.isArray(adapted.slide_renders)
        ? (adapted.slide_renders as Array<{ index: number; path: string }>)
        : [];
      if (renders.length === 0) {
        throw new Error(
          'As artes desta peça ainda não foram geradas. Abra a peça na Biblioteca e publique por lá.',
        );
      }
      return [...renders].sort((a, b) => a.index - b.index).map((r) => r.path);
    }
    default:
      // Canais de texto publicam sem mídia no MVP.
      return [];
  }
}

/** Monta o body do POST /v1/posts por canal (docs/10 Eixo 1, mapa canal→plataforma). */
function buildPostBody(
  piece: PieceRow,
  platform: string,
  accountId: string,
  mediaUrls: string[],
  opts: { mode: 'now' | 'schedule'; scheduledAt: string | null; timezone: string; publishedPostId: string },
): Json {
  const adapted = piece.adapted_content ?? {};
  let content = '';
  let platformSpecificData: Json | undefined;

  switch (piece.channel_type) {
    case 'instagram_post':
    case 'instagram_carousel':
      content = typeof adapted.caption === 'string' ? adapted.caption : '';
      break;
    case 'instagram_stories':
      // Stories não têm legenda. ATENÇÃO (validar no E2E com conta real): a
      // spec não garante que N mediaItems + contentType 'story' viram N stories
      // — se o Zernio publicar só a primeira, dividir em N posts (request_id
      // derivado por frame) é o follow-up registrado em docs/10.
      content = '';
      platformSpecificData = { contentType: 'story' };
      break;
    case 'x_post':
    case 'threads_post': {
      const text = typeof adapted.text === 'string' ? adapted.text : '';
      const thread = Array.isArray(adapted.thread) ? (adapted.thread as string[]) : [];
      content = text;
      if (thread.length > 0) {
        // threadItems[0] é o post raiz; o content de topo vira só display.
        platformSpecificData = {
          threadItems: [text, ...thread].map((t) => ({ content: t })),
        };
      }
      break;
    }
    case 'linkedin_post':
    case 'facebook_post':
      content = typeof adapted.text === 'string' ? adapted.text : '';
      break;
  }

  const body: Json = {
    content,
    platforms: [
      {
        platform,
        accountId,
        ...(platformSpecificData ? { platformSpecificData } : {}),
      },
    ],
    // metadata ecoada nos webhooks — mapeia o evento de volta à nossa linha.
    metadata: { piece_id: piece.id, published_post_id: opts.publishedPostId },
  };
  if (mediaUrls.length > 0) {
    body.mediaItems = mediaUrls.map((url) => ({ url, type: 'image' }));
  }
  if (opts.mode === 'schedule') {
    body.scheduledFor = opts.scheduledAt;
    body.timezone = opts.timezone;
  } else {
    body.publishNow = true;
  }
  return body;
}

// ── Actions: status/retry/reagendar/cancelar ─────────────────────────────────

async function loadPublishedPost(
  service: ServiceClient,
  id: unknown,
): Promise<{ row: Json | null; response: Response | null }> {
  if (typeof id !== 'string' || !id) {
    return { row: null, response: errorResponse(400, 'invalid_input', 'published_post_id é obrigatório.') };
  }
  const { data } = await service.from('published_posts').select('*').eq('id', id).maybeSingle();
  if (!data) {
    return { row: null, response: errorResponse(404, 'not_found', 'Registro de publicação não encontrado.') };
  }
  return { row: data as Json, response: null };
}

/** Sincroniza a linha com o estado real do post no Zernio (reconciliação on-demand). */
async function syncFromZernio(
  service: ServiceClient,
  apiKey: string,
  row: Json,
): Promise<Json> {
  if (!row.zernio_post_id) return row;

  let result: Json;
  try {
    result = await zernioFetch(apiKey, `/v1/posts/${row.zernio_post_id}`);
  } catch (err) {
    // Post apagado do lado do Zernio (painel/expurgo): sem isto a linha ativa
    // ficaria presa para sempre em scheduled/publishing.
    if (err instanceof ZernioError && err.status === 404) {
      const { data: gone } = await service
        .from('published_posts')
        .update({
          status: 'cancelled',
          error: 'Post não existe mais no Zernio (apagado fora da Automação de Redes Sociais).',
        })
        .eq('id', row.id as string)
        .select()
        .single();
      return (gone ?? row) as Json;
    }
    throw err;
  }
  const post = (result.post ?? result) as Json;
  const status = toPublishStatus(post.status as string | undefined);
  const { publishedUrl, error } = extractPlatformResult(post);

  const patch: Json = { status, raw: post };
  if (publishedUrl) patch.public_url = publishedUrl;
  if (error) patch.error = error;
  if (status === 'published') {
    patch.published_at = (post.publishedAt as string | undefined) ?? new Date().toISOString();
  }

  const { data: updated } = await service
    .from('published_posts')
    .update(patch)
    .eq('id', row.id as string)
    .select()
    .single();

  if (status === 'published') {
    await service.from('content_pieces').update({ status: 'published' }).eq('id', row.piece_id as string);
  }
  return (updated ?? row) as Json;
}

async function handleGetStatus(
  service: ServiceClient,
  apiKey: string,
  body: Json,
): Promise<Response> {
  const pieceId = body.piece_id;
  if (typeof pieceId !== 'string' || !pieceId) {
    return errorResponse(400, 'invalid_input', 'piece_id é obrigatório.');
  }
  const { data: latest } = await service
    .from('published_posts')
    .select('*')
    .eq('piece_id', pieceId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return jsonResponse({ published_post: null });

  // Estados terminais não precisam de chamada; não-terminais reconciliam 1x.
  const terminal = ['published', 'cancelled'];
  const row = latest as Json;
  if (terminal.includes(row.status as string) || !row.zernio_post_id) {
    return jsonResponse({ published_post: row });
  }
  return jsonResponse({ published_post: await syncFromZernio(service, apiKey, row) });
}

async function handleRetry(
  service: ServiceClient,
  apiKey: string,
  body: Json,
): Promise<Response> {
  const { row, response } = await loadPublishedPost(service, body.published_post_id);
  if (response) return response;
  const r = row as Json;

  if (r.status !== 'failed' && r.status !== 'partial') {
    return errorResponse(409, 'not_retryable', 'Só publicações com falha podem ser retentadas.');
  }
  if (!r.zernio_post_id) {
    return errorResponse(
      409,
      'retry_via_publish',
      'Esta tentativa falhou antes de chegar ao Zernio — use "Publicar" de novo na peça.',
    );
  }

  await zernioFetch(apiKey, `/v1/posts/${r.zernio_post_id}/retry`, { method: 'POST' });
  const { data: updated } = await service
    .from('published_posts')
    .update({ status: 'publishing', error: null })
    .eq('id', r.id as string)
    .select()
    .single();
  return jsonResponse({ published_post: updated ?? r });
}

async function handleUpdateSchedule(
  service: ServiceClient,
  apiKey: string,
  body: Json,
): Promise<Response> {
  const { row, response } = await loadPublishedPost(service, body.published_post_id);
  if (response) return response;
  const r = row as Json;

  const scheduledFor = body.scheduled_for;
  if (typeof scheduledFor !== 'string' || Number.isNaN(Date.parse(scheduledFor))) {
    return errorResponse(400, 'invalid_input', 'scheduled_for inválido (ISO 8601).');
  }
  if (r.status !== 'scheduled') {
    return errorResponse(409, 'not_scheduled', 'Só publicações agendadas podem ser reagendadas.');
  }

  const settings = await getZernioSettings(service);
  const timezone = typeof settings.timezone === 'string' ? settings.timezone : 'America/Sao_Paulo';

  // Zernio primeiro; só então o espelho local (mutation tudo-ou-nada — docs/10).
  await zernioFetch(apiKey, `/v1/posts/${r.zernio_post_id}`, {
    method: 'PUT',
    body: { scheduledFor, timezone },
  });

  const { data: updated } = await service
    .from('published_posts')
    .update({ scheduled_for: scheduledFor })
    .eq('id', r.id as string)
    .select()
    .single();
  return jsonResponse({ published_post: updated ?? r });
}

async function handleCancel(
  service: ServiceClient,
  apiKey: string,
  body: Json,
): Promise<Response> {
  const { row, response } = await loadPublishedPost(service, body.published_post_id);
  if (response) return response;
  const r = row as Json;

  if (r.status !== 'scheduled' && r.status !== 'pending') {
    return errorResponse(409, 'not_cancellable', 'Só agendamentos pendentes podem ser cancelados.');
  }

  if (r.zernio_post_id) {
    // DELETE remove o post agendado do Zernio (spec /v1/posts/{postId}).
    // 404 = já não existe lá → cancelar localmente é o resultado desejado.
    try {
      await zernioFetch(apiKey, `/v1/posts/${r.zernio_post_id}`, { method: 'DELETE' });
    } catch (err) {
      if (!(err instanceof ZernioError && err.status === 404)) throw err;
    }
  }

  const { data: updated } = await service
    .from('published_posts')
    .update({ status: 'cancelled' })
    .eq('id', r.id as string)
    .select()
    .single();
  return jsonResponse({ published_post: updated ?? r });
}

// ── Action: analytics (passthrough com allowlist) ────────────────────────────

async function handleAnalytics(apiKey: string, body: Json): Promise<Response> {
  const report = body.report;
  if (typeof report !== 'string' || !(report in ANALYTICS_ROUTES)) {
    return errorResponse(
      400,
      'invalid_input',
      `Relatório fora da allowlist. Aceitos: ${Object.keys(ANALYTICS_ROUTES).join(', ')}.`,
    );
  }

  // Só pares da allowlist, com valor escalar curto, viram query (nada de path
  // traversal/objetos; chave fora da lista é descartada em silêncio).
  const query: Record<string, string> = {};
  const params = (body.params ?? {}) as Json;
  for (const [k, v] of Object.entries(params)) {
    if (!ANALYTICS_PARAMS.has(k)) continue;
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    const value = String(v).trim();
    if (!value || value.length > 200) continue;
    query[k] = value;
  }

  const result = await zernioFetch(apiKey, ANALYTICS_ROUTES[report], { query });
  return jsonResponse(result);
}
