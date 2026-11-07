// _shared/cors.ts — CORS + helpers de resposta JSON padronizados.
// Toda function: preflight primeiro, corsHeaders em TODA resposta (inclusive erros).
// Fonte: docs/07-contratos-backend.md §1 (envelope de erro) e §8 (CORS).

export const corsHeaders = {
  // Single-tenant; restringir ao domínio do deploy é (proposta — validar).
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
} as const;

/** Retorna a resposta de preflight quando o request é OPTIONS; senão null. */
export function handlePreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  return null;
}

/** Resposta JSON com CORS. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Envelope de erro único de 07-contratos-backend.md §1:
 * { error: { code, message, details? } }
 */
export function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): Response {
  const error: Record<string, unknown> = { code, message };
  if (details !== undefined) error.details = details;
  return jsonResponse({ error }, status);
}
