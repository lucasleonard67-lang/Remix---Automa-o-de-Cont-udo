// _shared/rate-limit.ts — cota por usuário nas operações que gastam crédito de IA.
//
// O laço INTERNO da saga já é limitado (max_rewrites), mas nada limitava o número de
// INVOCAÇÕES: um script trivial esvaziava o saldo de IA da instância (ou a fatura da
// key BYO). A contabilidade vive no banco (migration 202607300013): a RPC
// `consume_rate_limit(_user_id, _action)` checa e registra no MESMO statement — não há
// janela entre contar e gravar — e os tetos ficam em `app_settings.rate_limits`,
// editáveis por admin em /config sem redeploy.
//
// Uso, logo após autenticar e ANTES de qualquer trabalho caro:
//
//   const limited = await enforceRateLimit(user.id, 'generate-content');
//   if (limited) return limited;

import { errorResponse } from './cors.ts';
import { createServiceClient } from './supabase.ts';

interface RateLimitVerdict {
  allowed: boolean;
  remaining: number | null;
  retry_after_seconds?: number;
}

/** Formata a espera em português, com a unidade que fizer sentido. */
function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} segundo${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minuto${minutes === 1 ? '' : 's'}`;
}

/**
 * Consome uma unidade da cota. Retorna a Response 429 pronta quando o teto foi
 * atingido, ou `null` quando pode seguir.
 *
 * Falha FECHADA: se a RPC falhar (contador fora do ar, permissão), a operação NÃO
 * segue. Toda ação contada aqui gasta crédito pago (IA, imagem, vídeo, publicação);
 * sem o contador não há teto, e um laço esvaziaria a conta do provedor.
 */
export async function enforceRateLimit(userId: string, action: string): Promise<Response | null> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc('consume_rate_limit', {
      _user_id: userId,
      _action: action,
    });

    if (error) {
      console.error(`[rate-limit] falha ao consultar cota de ${action}: ${error.message}`);
      return unavailable(action);
    }

    const verdict = data as RateLimitVerdict | null;
    if (!verdict || verdict.allowed) return null;

    const wait = verdict.retry_after_seconds
      ? ` Tente de novo em ${formatWait(verdict.retry_after_seconds)}.`
      : '';
    console.warn(`[rate-limit] ${userId} atingiu a cota de ${action}`);

    return errorResponse(
      429,
      'rate_limited',
      `Você atingiu o limite de uso desta operação nesta instância.${wait}` +
        ' Um administrador pode ajustar os limites em Configurações.',
      { action, retry_after_seconds: verdict.retry_after_seconds ?? null },
    );
  } catch (err) {
    console.error(`[rate-limit] erro inesperado em ${action}:`, err);
    return unavailable(action);
  }
}

/** Contador fora do ar: recusa com frase de "tente de novo" (503), sem gastar. */
function unavailable(action: string): Response {
  return errorResponse(
    503,
    'rate_limit_unavailable',
    'Não deu para conferir o limite de uso agora. Tente de novo em instantes.',
    { action },
  );
}
