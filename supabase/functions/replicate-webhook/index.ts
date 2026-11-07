// replicate-webhook — receptor das predições concluídas do Replicate.
// Spec: docs/11-video-replicate.md §3.4. Terceira função pública do projeto
// (verify_jwt=false no supabase/config.toml): o Replicate não tem JWT nosso.
//
// Segurança: assinatura no padrão svix (headers webhook-id / webhook-timestamp /
// webhook-signature) validada contra REPLICATE_WEBHOOK_SECRET do Vault, em tempo
// constante, com anti-replay de 5 min e ANTES de qualquer efeito colateral. Sem
// secret configurado → 401 a tudo (falha fechada), igual ao zernio-webhook.
//
// Por que o webhook é o caminho PRIMÁRIO (e não o poll do ciclo anterior): a
// invocação de edge function tem teto de ~7,5 min e vídeo leva minutos. Aqui
// nada espera: o evento chega, a gente responde 200 na hora e faz o trabalho
// pesado no waitUntil. Fechar a aba não perde nada.

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { getPrediction, verifyReplicateSignature } from '../_shared/replicate.ts';
import { getReplicateToken, settlePrediction } from '../_shared/video-pipeline.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

/** O payload `completed` traz input + logs completos — cap generoso de propósito:
 *  recusar um evento legítimo por tamanho perderia o vídeo até o reconciliador. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

let cachedSecret: { value: string; expires: number } | null = null;

async function getWebhookSecret(
  service: ReturnType<typeof createServiceClient>,
): Promise<string | null> {
  if (cachedSecret && cachedSecret.expires > Date.now()) return cachedSecret.value;
  const { data, error } = await service.rpc('get_vault_secret', {
    _name: 'REPLICATE_WEBHOOK_SECRET',
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
    // ── Checagens baratas antes de tocar o banco (endpoint é público) ────────
    if (!req.headers.get('webhook-signature') || !req.headers.get('webhook-id')) {
      return errorResponse(401, 'unauthorized', 'Assinatura ausente.');
    }
    const contentLength = Number(req.headers.get('content-length') ?? '0');
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return errorResponse(413, 'invalid_input', 'Corpo grande demais.');
    }

    const service = createServiceClient();
    const secret = await getWebhookSecret(service);
    if (!secret) {
      return errorResponse(401, 'unauthorized', 'Webhook não configurado.');
    }

    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return errorResponse(413, 'invalid_input', 'Corpo grande demais.');
    }
    if (!(await verifyReplicateSignature(req.headers, rawBody, secret))) {
      console.warn('[replicate-webhook] assinatura inválida — evento descartado');
      return errorResponse(401, 'unauthorized', 'Assinatura inválida.');
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch (_err) {
      return errorResponse(400, 'invalid_input', 'Body JSON inválido.');
    }

    const providerId = typeof payload.id === 'string' ? payload.id : null;
    if (!providerId) {
      return jsonResponse({ ok: true, ignored: 'sem_id' });
    }

    // ── Resolução da linha: id do provider e, se preciso, ADOÇÃO pelo ?pid= ──
    // O pid cobre a janela em que o worker morre entre o POST no Replicate e o
    // UPDATE do provider_prediction_id. Sem ele, o evento seria descartado e o
    // retry pagaria de novo por um vídeo que já existe.
    const { data: found } = await service
      .from('video_predictions')
      .select('id, status')
      .eq('provider_prediction_id', providerId)
      .maybeSingle();

    let row = found as { id: string; status: string } | null;

    if (!row) {
      const pid = new URL(req.url).searchParams.get('pid');
      if (pid) {
        const { data: adopted } = await service
          .from('video_predictions')
          .update({ provider_prediction_id: providerId })
          .eq('id', pid)
          .is('provider_prediction_id', null)
          .select('id, status')
          .maybeSingle();
        row = adopted as { id: string; status: string } | null;
        if (row) {
          console.warn(`[replicate-webhook] predição órfã adotada pelo pid: ${pid}`);
        }
      }
    }

    // Predição de outra instância ou já finalizada: 200 sempre — devolver erro
    // só alimentaria o retry do Replicate sem nunca resolver.
    if (!row) return jsonResponse({ ok: true, ignored: 'desconhecida' });
    if (['succeeded', 'failed', 'canceled'].includes(row.status)) {
      return jsonResponse({ ok: true, ignored: `already_${row.status}` });
    }

    // ── Resposta imediata; trabalho pesado em background ─────────────────────
    const task = (async () => {
      try {
        const token = await getReplicateToken(service);
        if (!token) {
          console.error('[replicate-webhook] REPLICATE_API_TOKEN ausente do Vault');
          return;
        }
        // Relê a predição da API: o corpo do webhook é confiável, mas reler
        // garante o `version` efetivo e o output final sem depender do formato
        // do evento.
        const prediction = await getPrediction(token, providerId);
        await settlePrediction(service, token, prediction);
      } catch (err) {
        console.error(
          `[replicate-webhook] falha ao concluir ${providerId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    })();

    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime) EdgeRuntime.waitUntil(task);
    else await task;

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error('[replicate-webhook] erro inesperado:', err instanceof Error ? err.message : err);
    return errorResponse(500, 'internal_error', 'Falha inesperada.');
  }
});
