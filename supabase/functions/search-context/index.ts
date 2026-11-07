// search-context — busca do Conteúdo de Contexto para a UI de /contexto.
// Contrato: docs/07-contratos-backend.md §3.10.
//
// POST { query, filters?, limit? } → 200 { results: [{item_id, title, kind, excerpt, score}] }
// Auth: autenticado (verify_jwt = true no gateway).
// Reusa _shared/retrieval.ts (busca híbrida pgvector + FTS + filtros) — a
// MESMA retrieval da saga. Somente leitura; zero escrita no banco.

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getUser } from '../_shared/supabase.ts';
import { enforceRateLimit } from '../_shared/rate-limit.ts';
import {
  hybridSearch,
  CONTEXT_KINDS,
  DEFAULT_MATCH_COUNT,
  type ContextKind,
  type RetrievalFilters,
} from '../_shared/retrieval.ts';
import { LlmError } from '../_shared/llm.ts';

const MAX_LIMIT = 50;
const EXCERPT_LENGTH = 240;
/** Teto da query enviada ao embeddings + websearch_to_tsquery (mesmo padrão de
 *  MAX_PROMPT_CHARS/MAX_BRIEF_CHARS das demais functions — evita prompt gigante). */
const MAX_QUERY_CHARS = 1000;

interface SearchContextRequest {
  query?: unknown;
  filters?: { kinds?: unknown; tags?: unknown };
  limit?: unknown;
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return errorResponse(405, 'invalid_input', 'Use POST.');
  }

  try {
    const user = await getUser(req);
    if (!user) {
      return errorResponse(401, 'unauthorized', 'Sessão inválida ou ausente.');
    }

    // Cota por usuário: esta operação gasta crédito de IA (migration 202607300013).
    const limited = await enforceRateLimit(user.id, 'search-context');
    if (limited) return limited;

    let body: SearchContextRequest;
    try {
      body = (await req.json()) as SearchContextRequest;
    } catch (_err) {
      return errorResponse(400, 'invalid_input', 'Body JSON inválido.');
    }

    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) {
      return errorResponse(400, 'invalid_input', 'Campo query é obrigatório e não pode ser vazio.');
    }
    if (query.length > MAX_QUERY_CHARS) {
      return errorResponse(
        400,
        'invalid_input',
        `Query acima do limite de ${MAX_QUERY_CHARS} caracteres.`,
      );
    }

    const filters: RetrievalFilters = {};
    if (body.filters?.kinds !== undefined) {
      if (
        !Array.isArray(body.filters.kinds) ||
        body.filters.kinds.some((k) => !CONTEXT_KINDS.includes(k as ContextKind))
      ) {
        return errorResponse(
          400,
          'invalid_input',
          `filters.kinds inválido — valores aceitos: ${CONTEXT_KINDS.join(', ')}.`,
        );
      }
      filters.kinds = body.filters.kinds as ContextKind[];
    }
    if (body.filters?.tags !== undefined) {
      if (
        !Array.isArray(body.filters.tags) ||
        body.filters.tags.some((t) => typeof t !== 'string')
      ) {
        return errorResponse(400, 'invalid_input', 'filters.tags deve ser um array de strings.');
      }
      filters.tags = body.filters.tags as string[];
    }

    let limit = DEFAULT_MATCH_COUNT;
    if (body.limit !== undefined) {
      const parsed = Number(body.limit);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
        return errorResponse(400, 'invalid_input', `limit deve ser um inteiro entre 1 e ${MAX_LIMIT}.`);
      }
      limit = parsed;
    }

    const matches = await hybridSearch(query, filters, limit);

    const results = matches.map((m) => ({
      item_id: m.item_id,
      title: m.title,
      kind: m.kind,
      excerpt: makeExcerpt(m.content),
      score: m.score,
    }));

    return jsonResponse({ results });
  } catch (err) {
    if (err instanceof LlmError) {
      // 402 créditos / 429 rate limit / 502 provider — repassa semanticamente (07 §1).
      const codeByStatus: Record<number, string> = {
        402: 'credits_exhausted',
        429: 'rate_limited',
        502: 'provider_error',
      };
      return errorResponse(err.status, codeByStatus[err.status] ?? 'internal_error', err.message);
    }
    console.error('[search-context] erro inesperado:', err);
    return errorResponse(500, 'internal_error', 'Falha inesperada na busca.');
  }
});

/** Início do chunk com melhor score, cortado em fronteira de palavra. */
function makeExcerpt(content: string): string {
  const clean = content.replace(/\s+/g, ' ').trim();
  if (clean.length <= EXCERPT_LENGTH) return clean;
  const cut = clean.slice(0, EXCERPT_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > EXCERPT_LENGTH / 2 ? lastSpace : EXCERPT_LENGTH)}…`;
}
