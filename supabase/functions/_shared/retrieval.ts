// _shared/retrieval.ts — busca híbrida do Conteúdo de Contexto.
// Fonte: docs/06-arquitetura-ia.md §5.2.
//
// Pipeline: embed da query (papel embeddings) → duas pernas em paralelo:
//   1. semântica: rpc match_context_chunks (pgvector, cosine — 202607290007_context.sql)
//   2. léxica:    rpc search_context_items_fts (OR entre lexemes + ts_rank_cd)
//
// A perna léxica JÁ FOI websearch_to_tsquery direto do PostgREST e devolvia
// zero em quase toda geração: websearch faz AND dos termos e a context_query do
// Roteador é um saco de 9-10 palavras-chave. A busca degradava em silêncio para
// só-vetorial, e o case citado no briefing não chegava ao Gerador (migration
// 202608290035 tem o diagnóstico medido).
// → fusão Reciprocal Rank Fusion (RRF, k=60) → dedupe por item_id → top-N.
//
// É a MESMA retrieval usada pela saga (F2) e pela UI (search-context) —
// garantia de que o que a UI encontra é o que o gerador encontraria.

import { createServiceClient } from './supabase.ts';
import { embed } from './llm.ts';

export type ContextKind = 'transcript' | 'post' | 'document' | 'reference' | 'case' | 'offer';

export const CONTEXT_KINDS: readonly ContextKind[] = [
  'transcript',
  'post',
  'document',
  'reference',
  'case',
  'offer',
] as const;

export interface RetrievalFilters {
  kinds?: ContextKind[];
  tags?: string[];
}

export interface RetrievalResult {
  item_id: string;
  /** Índice do melhor chunk do item, quando veio da perna vetorial (a RPC não retorna chunk_index). */
  chunk_index?: number;
  /** Conteúdo do melhor chunk (perna vetorial) ou início do body do item (só-FTS). */
  content: string;
  title: string;
  kind: ContextKind;
  metadata: Record<string, unknown>;
  /** Score fundido (RRF) — comparável apenas dentro do mesmo resultado. */
  score: number;
}

const RRF_K = 60;
/**
 * Piso de similaridade da perna VETORIAL.
 *
 * `match_context_chunks` devolve os N vizinhos mais próximos SEMPRE — não existe
 * limiar. Para uma consulta sem nada a ver com o acervo ("zzzz-inexistente"), ela
 * ainda entrega os itens menos distantes, e a tela os apresenta como resultado.
 * Pior que feio: o mesmo caminho alimenta a saga, então uma pauta fora do acervo
 * recebia "prova" que não prova nada.
 *
 * O valor é conservador de propósito. Deixar contexto de fora é o pior defeito
 * possível aqui (foi o que fez o Gerador provar com o case errado), então o piso
 * corta só o ruído evidente. A similaridade real de cada busca vai para o log
 * para calibrar com evidência, não com chute.
 */
const MIN_SIMILARITY = 0.2;
/** match_count default da retrieval (04-modelo-de-dados.md §6.8). */
export const DEFAULT_MATCH_COUNT = 12;

interface MatchChunkRow {
  chunk_id: string;
  item_id: string;
  content: string;
  similarity: number;
}

interface ItemRow {
  id: string;
  title: string;
  kind: ContextKind;
  metadata: Record<string, unknown> | null;
  body: string | null;
  tags: string[] | null;
}

export interface RetrievalOptions {
  /**
   * Tags EXCLUÍDAS do resultado (aplicadas nas duas pernas). A saga exclui
   * 'pesquisa-web': digests de pesquisa são material do job que os pediu — o
   * runResearching anexa o do próprio job explicitamente; deixá-los entrar
   * pela busca contaminaria jobs futuros com dado web desatualizado como se
   * fosse acervo curado da marca.
   */
  excludeTags?: string[];
}

/**
 * Busca híbrida (pgvector + FTS + filtros kind/tags) com fusão RRF k=60 e
 * dedupe por item_id. Retorna no máximo `limit` itens ordenados por score.
 */
export async function hybridSearch(
  query: string,
  filters?: RetrievalFilters,
  limit: number = DEFAULT_MATCH_COUNT,
  opts: RetrievalOptions = {},
): Promise<RetrievalResult[]> {
  const supabase = createServiceClient();
  const fetchCount = Math.max(limit * 2, 20);
  const kinds = filters?.kinds?.length ? filters.kinds : null;
  const tags = filters?.tags?.length ? filters.tags : null;
  const excludeTags = opts.excludeTags?.length ? opts.excludeTags : null;

  // Perna léxica (não depende do embedding — dispara já). A RPC devolve os
  // itens JÁ ordenados por ts_rank_cd, então o rank desta perna é real — antes
  // era a ordem de retorno do banco, porque o PostgREST não expõe ts_rank.
  const ftsPromise = supabase.rpc('search_context_items_fts', {
    query_text: query,
    match_count: fetchCount,
    filter_kinds: kinds,
    filter_tags: tags,
    exclude_tags: excludeTags,
  });

  // Perna semântica: embedding da query → match_context_chunks.
  const [queryEmbedding] = await embed([query]);
  const vecPromise = supabase.rpc('match_context_chunks', {
    query_embedding: queryEmbedding,
    match_count: fetchCount,
    filter_kinds: kinds,
    filter_tags: tags,
    // o descarte já acontecia depois da fusão; filtrar aqui evita que itens
    // excluídos gastem vagas do top-N e empurrem acervo elegível para fora
    exclude_tags: excludeTags,
  });

  const [firstVec, ftsRes] = await Promise.all([vecPromise, ftsPromise]);
  let vecRes = firstVec;

  // Compatibilidade de ordem de deploy: se a função ainda não tem exclude_tags
  // (migration 202608290035 não aplicada), repete sem o parâmetro. O descarte
  // por tag acontece de novo mais abaixo, sobre os detalhes — nada escapa.
  if (vecRes.error && /exclude_tags|does not exist|schema cache/i.test(vecRes.error.message)) {
    console.warn('[retrieval] match_context_chunks sem exclude_tags — repetindo sem o parâmetro.');
    vecRes = await supabase.rpc('match_context_chunks', {
      query_embedding: queryEmbedding,
      match_count: fetchCount,
      filter_kinds: kinds,
      filter_tags: tags,
    });
  }
  if (vecRes.error) {
    throw new Error(`match_context_chunks falhou: ${vecRes.error.message}`);
  }
  // A perna léxica DEGRADA, não derruba: ela é um reforço de precisão sobre a
  // vetorial. Se a RPC faltar (function deployada antes da migration) ou falhar,
  // a geração segue só com a semântica — pior recall, mas o job não morre.
  if (ftsRes.error) {
    console.warn(`[retrieval] perna léxica indisponível (${ftsRes.error.message}) — seguindo só com a semântica.`);
  }

  const vecRowsBrutas = (vecRes.data ?? []) as MatchChunkRow[];
  const melhorSim = vecRowsBrutas[0]?.similarity ?? 0;
  const vecRows = vecRowsBrutas.filter((row) => row.similarity >= MIN_SIMILARITY);
  console.info(
    `[retrieval] "${query.slice(0, 60)}" → vetorial: ${vecRowsBrutas.length} bruto, ` +
      `${vecRows.length} acima de ${MIN_SIMILARITY} (melhor ${melhorSim.toFixed(3)}); ` +
      `léxica: ${(ftsRes.error ? [] : (ftsRes.data ?? [])).length}`,
  );
  const ftsRows = (ftsRes.error ? [] : ftsRes.data ?? []) as Array<{ item_id: string; rank: number }>;

  // ── Fusão RRF (k=60) com dedupe por item_id ────────────────────────────────
  const fused = new Map<
    string,
    { score: number; bestChunk?: { content: string; similarity: number } }
  >();

  // Perna vetorial: rank por primeira ocorrência do item; guarda o melhor chunk.
  let vecRank = 0;
  const seenVecItems = new Set<string>();
  for (const row of vecRows) {
    if (!seenVecItems.has(row.item_id)) {
      seenVecItems.add(row.item_id);
      const entry = fused.get(row.item_id) ?? { score: 0 };
      entry.score += 1 / (RRF_K + vecRank + 1);
      // Linhas vêm ordenadas por similaridade desc → a 1ª do item é o melhor chunk.
      entry.bestChunk = { content: row.content, similarity: row.similarity };
      fused.set(row.item_id, entry);
      vecRank++;
    }
  }

  // Perna léxica.
  ftsRows.forEach((row, rank) => {
    const entry = fused.get(row.item_id) ?? { score: 0 };
    entry.score += 1 / (RRF_K + rank + 1);
    fused.set(row.item_id, entry);
  });

  if (fused.size === 0) return [];

  // Todos os ids fundidos, por score. A exclusão por tag é reaplicada sobre os
  // detalhes (as duas RPCs já filtram) ANTES do corte em `limit`.
  const rankedIds = [...fused.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .map(([id]) => id);

  // Detalhes dos itens (title/kind/metadata/tags + body p/ excerpt de hits só-FTS).
  const { data: items, error: itemsError } = await supabase
    .from('context_items')
    .select('id, title, kind, metadata, body, tags')
    .in('id', rankedIds);
  if (itemsError) {
    throw new Error(`Falha ao carregar context_items: ${itemsError.message}`);
  }
  const itemById = new Map((items as ItemRow[] | null ?? []).map((i) => [i.id, i]));

  const results: RetrievalResult[] = [];
  for (const id of rankedIds) {
    if (results.length >= limit) break;
    const item = itemById.get(id);
    if (!item) continue; // item sumiu entre as queries — ignora
    if (excludeTags && (item.tags ?? []).some((tag) => excludeTags.includes(tag))) {
      continue; // ex.: digests de pesquisa web de outros jobs
    }
    const entry = fused.get(id)!;
    const content =
      entry.bestChunk?.content ??
      (item.body ? item.body.slice(0, 600) : item.title);
    results.push({
      item_id: id,
      content,
      title: item.title,
      kind: item.kind,
      metadata: item.metadata ?? {},
      score: entry.score,
    });
  }
  return results;
}
