// video-reconcile — rede de segurança do pipeline de vídeo.
// Spec: docs/11-video-replicate.md §3.5. Quarta função pública do projeto
// (verify_jwt=false): o pg_cron chama sem JWT. Auth dupla, igual ao fetch-rss —
// header x-cron-secret contra o Vault OU JWT de admin (botão "Retomar" da UI).
//
// O webhook é o caminho primário; esta função existe para o dia em que ele se
// perde (deploy quebrado, secret trocado, evento não entregue). Ela consulta o
// Replicate pelas predições ainda ativas e manda as terminais para o MESMO
// settlePrediction do webhook — um só caminho de conclusão, sem código duplicado.
//
// Detalhe que faz diferença: escreve em `last_checked_at`, NUNCA em `updated_at`.
// Se tocasse updated_at, rejuvenesceria a linha a cada 5 min e o watchdog
// (que mede idade absoluta) nunca dispararia — os dois se anulariam.

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';
import { getPrediction } from '../_shared/replicate.ts';
import { getReplicateToken, settlePrediction } from '../_shared/video-pipeline.ts';

/** Teto por execução: o cron roda a cada 5 min, não precisa varrer tudo de uma vez. */
const MAX_PER_RUN = 20;
/** Só reconsulta o que não é checado há mais de 1 min (evita bater na API à toa). */
const MIN_AGE_SECONDS = 60;

type PredictionRow = {
  id: string;
  provider_prediction_id: string | null;
  status: string;
  created_at: string;
};

async function isAuthorized(
  req: Request,
  service: ReturnType<typeof createServiceClient>,
): Promise<boolean> {
  const provided = req.headers.get('x-cron-secret');
  if (provided) {
    const { data } = await service.rpc('get_vault_secret', { _name: 'VIDEO_CRON_SECRET' });
    if (typeof data === 'string' && data.length > 0 && timingSafeEquals(provided, data)) {
      return true;
    }
    return false;
  }

  // Caminho humano: precisa ser admin (mesmo predicado do fetch-rss).
  const user = await getUser(req);
  if (!user) return false;
  const { data: isAdmin } = await service.rpc('has_role', { _user_id: user.id, _role: 'admin' });
  return isAdmin === true;
}

function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return errorResponse(405, 'invalid_input', 'Use POST.');
  }

  try {
    const service = createServiceClient();
    if (!(await isAuthorized(req, service))) {
      return errorResponse(401, 'unauthorized', 'Credencial ausente ou inválida.');
    }

    // Auto-registro da URL da instância: sem isso o invoke_video_reconcile do
    // pg_cron é no-op silencioso e a rede de segurança inteira não existe.
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (supabaseUrl) {
      await service
        .from('app_settings')
        .upsert({ key: 'instance_url', value: { url: supabaseUrl } }, { onConflict: 'key' });
    }

    const token = await getReplicateToken(service);
    if (!token) {
      return errorResponse(
        400,
        'replicate_not_configured',
        'REPLICATE_API_TOKEN ausente do Vault.',
      );
    }

    const cutoff = new Date(Date.now() - MIN_AGE_SECONDS * 1000).toISOString();
    const { data: pending } = await service
      .from('video_predictions')
      .select('id, provider_prediction_id, status, created_at')
      .in('status', ['submitted', 'processing', 'downloading'])
      .not('provider_prediction_id', 'is', null)
      .or(`last_checked_at.is.null,last_checked_at.lt.${cutoff}`)
      .order('created_at', { ascending: true })
      .limit(MAX_PER_RUN)
      .returns<PredictionRow[]>();

    let checked = 0;
    let settled = 0;
    const failures: string[] = [];

    for (const row of pending ?? []) {
      const providerId = row.provider_prediction_id as string;
      checked++;
      try {
        const prediction = await getPrediction(token, providerId);
        // Marca a checagem ANTES de concluir: se o settle demorar, a próxima
        // execução não repete a mesma linha.
        await service
          .from('video_predictions')
          .update({ last_checked_at: new Date().toISOString() })
          .eq('id', row.id);

        if (['succeeded', 'failed', 'canceled', 'aborted'].includes(prediction.status)) {
          await settlePrediction(service, token, prediction);
          settled++;
        }
      } catch (err) {
        failures.push(`${providerId}: ${err instanceof Error ? err.message : String(err)}`);
        await service
          .from('video_predictions')
          .update({ last_checked_at: new Date().toISOString() })
          .eq('id', row.id);
      }
    }

    // Heartbeat: a UI avisa quando o reconciliador some (é o detector do caso
    // "webhook secret errado", em que TODOS os eventos passam a dar 401 calado).
    await service.from('app_settings').upsert(
      {
        key: 'video_reconcile_heartbeat',
        value: { at: new Date().toISOString(), checked, settled },
      },
      { onConflict: 'key' },
    );

    if (failures.length > 0) {
      console.warn(`[video-reconcile] ${failures.length} consulta(s) falharam: ${failures[0]}`);
    }

    return jsonResponse({ checked, settled, failed: failures.length });
  } catch (err) {
    console.error('[video-reconcile] erro inesperado:', err instanceof Error ? err.message : err);
    return errorResponse(500, 'internal_error', 'Falha inesperada.');
  }
});
