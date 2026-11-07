// zernio-webhook — receptor dos eventos post.* do Zernio (Eixo 1 de
// docs/10-plano-integracoes.md). ÚNICA função pública do projeto
// (verify_jwt=false no supabase/config.toml): o Zernio não tem JWT nosso.
//
// Segurança: HMAC-SHA256 do corpo cru contra ZERNIO_WEBHOOK_SECRET (Vault,
// gerado pelo setup-webhook do zernio-proxy), comparação em tempo constante.
// Sem secret configurado → 401 a TUDO (falha fechada); assinatura inválida →
// 401 sem nenhum side effect.
//
// Fluxo: evento → resolve published_posts (metadata.published_post_id ecoada,
// fallback zernio_post_id) → transição de status → content_pieces.status =
// 'published' quando confirmar. A UI recebe via Realtime da tabela — este
// endpoint responde 200 rápido e nunca chama o Zernio de volta.

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { toPublishStatus, extractPlatformResult, mergeDirectorInstagram } from '../_shared/zernio.ts';

type Json = Record<string, unknown>;

/** Corpo máximo aceito — evento post.* real tem poucos KB. */
const MAX_BODY_BYTES = 256 * 1024;

// Cache do secret (TTL curto): endpoint público não paga 1 RPC ao Postgres por
// request anônimo; a rotação via setup-webhook propaga em até 60s.
let cachedSecret: { value: string; expires: number } | null = null;

async function getWebhookSecret(service: ReturnType<typeof createServiceClient>): Promise<string | null> {
  if (cachedSecret && cachedSecret.expires > Date.now()) return cachedSecret.value;
  const { data, error } = await service.rpc('get_vault_secret', {
    _name: 'ZERNIO_WEBHOOK_SECRET',
  });
  if (error || typeof data !== 'string' || data.length === 0) return null;
  cachedSecret = { value: data, expires: Date.now() + 60_000 };
  return data;
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return errorResponse(405, 'invalid_input', 'Use POST.');
  }

  try {
    // ── Checagens BARATAS antes de tocar banco (endpoint é público) ─────────
    const signature = req.headers.get('x-zernio-signature') ?? '';
    if (!/^(sha256=)?[0-9a-fA-F]{64}$/.test(signature.trim())) {
      return errorResponse(401, 'unauthorized', 'Assinatura ausente ou malformada.');
    }
    const contentLength = Number(req.headers.get('content-length') ?? '0');
    if (!Number.isFinite(contentLength) || contentLength > MAX_BODY_BYTES) {
      return errorResponse(413, 'invalid_input', 'Corpo grande demais.');
    }

    const service = createServiceClient();

    // ── Autenticação: HMAC do corpo cru, falha fechada ──────────────────────
    const secret = await getWebhookSecret(service);
    if (!secret) {
      return errorResponse(401, 'unauthorized', 'Webhook não configurado.');
    }

    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return errorResponse(413, 'invalid_input', 'Corpo grande demais.');
    }
    if (!(await verifySignature(rawBody, signature, secret))) {
      console.warn('[zernio-webhook] assinatura inválida — evento descartado');
      return errorResponse(401, 'unauthorized', 'Assinatura inválida.');
    }

    let payload: Json;
    try {
      payload = JSON.parse(rawBody) as Json;
    } catch (_err) {
      return errorResponse(400, 'invalid_input', 'Body JSON inválido.');
    }

    const event = typeof payload.event === 'string' ? payload.event : '';
    if (event === 'webhook.test') {
      return jsonResponse({ ok: true });
    }
    if (!event.startsWith('post.')) {
      // Evento fora do escopo assinado — ack para não acumular retry no Zernio.
      return jsonResponse({ ok: true, ignored: event });
    }

    const post = (payload.post ?? {}) as Json;
    const zernioPostId = (post.id ?? post._id) as string | undefined;
    const metadata = (post.metadata ?? {}) as Json;

    // ── Resolve a linha: metadata ecoada primeiro, id do post como fallback ──
    let row: Json | null = null;
    const publishedPostId = metadata.published_post_id;
    if (typeof publishedPostId === 'string' && publishedPostId) {
      const { data } = await service
        .from('published_posts')
        .select('*')
        .eq('id', publishedPostId)
        .maybeSingle();
      row = (data as Json | null) ?? null;
    }
    if (!row && zernioPostId) {
      const { data } = await service
        .from('published_posts')
        .select('*')
        .eq('zernio_post_id', zernioPostId)
        .maybeSingle();
      row = (data as Json | null) ?? null;
    }
    if (!row && typeof metadata.director_job_id === 'string' && metadata.director_job_id) {
      // Vídeo do Diretor publicado como Reel: estado em director_jobs.artifacts.instagram.
      const patch = buildPatch(event, post);
      if (!patch || !['published', 'failed'].includes(patch.status as string)) {
        return jsonResponse({ ok: true, ignored: event });
      }
      await mergeDirectorInstagram(service, metadata.director_job_id, {
        status: patch.status as 'published' | 'failed',
        url: (patch.public_url as string | undefined) ?? null,
        error: (patch.error as string | undefined) ?? null,
        published_at: (patch.published_at as string | undefined) ?? null,
        ...(zernioPostId ? { zernio_post_id: zernioPostId } : {}),
      });
      return jsonResponse({ ok: true });
    }
    if (!row) {
      // Post desconhecido (criado fora do Content Engine) — ack e ignora.
      return jsonResponse({ ok: true, ignored: 'unknown_post' });
    }

    // ── Transição ────────────────────────────────────────────────────────────
    const patch = buildPatch(event, post);
    if (!patch) {
      return jsonResponse({ ok: true, ignored: event });
    }

    // Estados TERMINAIS nunca são rebaixados por redelivery atrasada: um
    // post.scheduled reentregue após o cancel ressuscitaria a linha apontando
    // para um post que já foi deletado do Zernio.
    const TERMINAL = ['published', 'cancelled'];
    if (TERMINAL.includes(row.status as string) && patch.status !== row.status) {
      return jsonResponse({ ok: true, ignored: `already_${row.status}` });
    }

    // Preenche o zernio_post_id se a linha ainda não tinha (corrida com o proxy).
    if (!row.zernio_post_id && zernioPostId) {
      patch.zernio_post_id = zernioPostId;
    }

    const { error: updateError } = await service
      .from('published_posts')
      .update(patch)
      .eq('id', row.id as string);
    if (updateError) {
      // 23505 = o unique parcial de "1 ativa por peça" barrou a redelivery de
      // um estado velho (a peça já tem tentativa nova). 500 aqui alimentaria
      // retry infinito do Zernio — o evento obsoleto é ack'ado e descartado.
      if ((updateError as { code?: string }).code === '23505') {
        return jsonResponse({ ok: true, ignored: 'stale_transition' });
      }
      console.error(`[zernio-webhook] update falhou (${event}): ${updateError.message}`);
      return errorResponse(500, 'internal_error', 'Falha ao gravar transição.');
    }

    if (patch.status === 'published') {
      // Nunca ressuscita peça arquivada/rejeitada — só aprovada promove.
      await service
        .from('content_pieces')
        .update({ status: 'published' })
        .eq('id', row.piece_id as string)
        .in('status', ['approved', 'published']);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error('[zernio-webhook] erro inesperado:', err instanceof Error ? err.message : err);
    return errorResponse(500, 'internal_error', 'Falha inesperada.');
  }
});

/** Patch de published_posts por evento; null = evento sem transição mapeada. */
function buildPatch(event: string, post: Json): Json | null {
  const { publishedUrl, error } = extractPlatformResult(post);

  switch (event) {
    case 'post.published':
    case 'post.platform.published': {
      const patch: Json = {
        status: 'published',
        published_at: (post.publishedAt as string | undefined) ?? new Date().toISOString(),
        raw: post,
        error: null,
      };
      if (publishedUrl) patch.public_url = publishedUrl;
      return patch;
    }
    case 'post.failed':
    case 'post.platform.failed':
      return {
        status: 'failed',
        error: error ?? 'Publicação falhou na plataforma (sem detalhe do Zernio).',
        raw: post,
      };
    case 'post.partial':
      return { status: 'partial', error, raw: post };
    case 'post.scheduled':
      return { status: 'scheduled', raw: post };
    case 'post.cancelled':
      return { status: 'cancelled', raw: post };
    default:
      return null;
  }
}

/**
 * HMAC-SHA256(corpo cru, secret) em hex vs header X-Zernio-Signature
 * (aceita com ou sem prefixo "sha256="), comparação em tempo constante.
 */
async function verifySignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  const provided = signatureHeader.replace(/^sha256=/i, '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(provided)) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('');

  // Comparação em tempo constante (mesmo comprimento garantido pelo regex acima).
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}
