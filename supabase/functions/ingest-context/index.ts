// ingest-context — pipeline de ingestão RAG de um item do Conteúdo de Contexto.
// Contrato: docs/07-contratos-backend.md §3.4.
//
// POST { item_id } → 202 { item_id, status: 'processing' }
// Auth: autenticado (verify_jwt = true no gateway).
// Background (EdgeRuntime.waitUntil): limpeza → chunking → embeddings →
// delete+insert de context_chunks (idempotente por item) → status ready/error
// (erro em metadata.error). Falha do background NUNCA vira HTTP error — vira
// status='error' no item, visível na UI de /contexto via Realtime.
//
// Fonte do texto: body, arquivo do bucket context-files (text/plain e markdown
// apenas; outros tipos → status error com mensagem clara) ou link público, lido
// por _shared/link-reader.ts. O texto do link fica no body do item.

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';
import { enforceRateLimit } from '../_shared/rate-limit.ts';
import { cleanText, chunkText } from '../_shared/chunking.ts';
import { embed, LlmError } from '../_shared/llm.ts';
import { readLink } from '../_shared/link-reader.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const EMBED_BATCH_SIZE = 32;
const INSERT_BATCH_SIZE = 100;
const MAX_LINK_CHARS = 200_000;

const ALLOWED_MIME_TYPES = ['text/plain', 'text/markdown', 'text/x-markdown'];
const ALLOWED_EXTENSIONS = ['txt', 'md', 'markdown'];

interface ContextItemRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  source_url: string | null;
  file_path: string | null;
  metadata: Record<string, unknown> | null;
  status: string;
}

import { downloadRestoring } from '../_shared/drive-restore.ts';

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
    const limited = await enforceRateLimit(user.id, 'ingest-context');
    if (limited) return limited;

    let body: unknown;
    try {
      body = await req.json();
    } catch (_err) {
      return errorResponse(400, 'invalid_input', 'Body JSON inválido.');
    }
    const itemId = (body as { item_id?: unknown })?.item_id;
    if (typeof itemId !== 'string' || itemId.length === 0) {
      return errorResponse(400, 'invalid_input', 'Campo item_id é obrigatório.');
    }

    const supabase = createServiceClient();
    const { data: item, error: itemError } = await supabase
      .from('context_items')
      .select('id, kind, title, body, source_url, file_path, metadata, status')
      .eq('id', itemId)
      .maybeSingle();
    if (itemError) {
      return errorResponse(500, 'internal_error', `Falha ao carregar o item: ${itemError.message}`);
    }
    if (!item) {
      return errorResponse(404, 'not_found', 'Item de contexto não encontrado.');
    }

    const row = item as ContextItemRow;
    if (!row.body?.trim() && !row.file_path && !row.source_url) {
      return errorResponse(400, 'invalid_input', 'Item sem body, arquivo ou link para ingerir.');
    }

    // Claim atômico (migration 202607300014): impede que duas chamadas processem o
    // mesmo item ao mesmo tempo — o pipeline faz DELETE + INSERT dos chunks, e a
    // segunda execução apagaria o que a primeira acabou de inserir, deixando o índice
    // parcial. O claim libera item novo (marcador ausente), reprocesso após concluir
    // (status já não é 'processing') e pipeline morto no meio (marcador velho).
    const { data: claimed, error: claimError } = await supabase.rpc('claim_context_ingest', {
      _item_id: row.id,
    });
    if (claimError) {
      return errorResponse(500, 'internal_error', `Falha ao reservar a ingestão: ${claimError.message}`);
    }
    if (claimed !== true) {
      return errorResponse(
        409,
        'invalid_state',
        'Este item já está sendo processado — aguarde a ingestão em andamento terminar.',
      );
    }

    // Processamento em background; resposta 202 imediata.
    const task = processItem(supabase, row);
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime) {
      EdgeRuntime.waitUntil(task);
    } else {
      task.catch((err) => console.error('[ingest-context] background sem EdgeRuntime:', err));
    }

    return jsonResponse({ item_id: row.id, status: 'processing' }, 202);
  } catch (err) {
    console.error('[ingest-context] erro inesperado:', err);
    return errorResponse(500, 'internal_error', 'Falha inesperada na ingestão.');
  }
});

async function processItem(supabase: SupabaseClient, item: ContextItemRow): Promise<void> {
  try {
    await supabase.from('context_items').update({ status: 'processing' }).eq('id', item.id);

    const raw = await resolveText(supabase, item);
    const text = cleanText(raw);
    const chunks = chunkText(text, item.kind);
    if (chunks.length === 0) {
      throw new Error('Conteúdo vazio após limpeza — nada para indexar.');
    }

    // Embeddings em lote (papel 'embeddings' de app_settings.ai_providers).
    const embeddings: number[][] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
      embeddings.push(...(await embed(batch)));
    }

    // Reprocesso idempotente: substitui integralmente os chunks do item.
    const { error: deleteError } = await supabase
      .from('context_chunks')
      .delete()
      .eq('item_id', item.id);
    if (deleteError) {
      throw new Error(`Falha ao limpar chunks antigos: ${deleteError.message}`);
    }

    const rows = chunks.map((content, chunk_index) => ({
      item_id: item.id,
      chunk_index,
      content,
      embedding: embeddings[chunk_index],
    }));
    for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
      const { error: insertError } = await supabase
        .from('context_chunks')
        .insert(rows.slice(i, i + INSERT_BATCH_SIZE));
      if (insertError) {
        throw new Error(`Falha ao gravar chunks: ${insertError.message}`);
      }
    }

    // Pronto: limpa erro anterior da metadata (a coluna gerada `search` se atualiza sozinha).
    const metadata = { ...(item.metadata ?? {}) };
    delete metadata.error;
    await supabase
      .from('context_items')
      .update({ status: 'ready', metadata })
      .eq('id', item.id);
  } catch (err) {
    const message =
      err instanceof LlmError && err.code === 'credits_exhausted'
        ? 'Créditos de IA esgotados durante a geração de embeddings — adicione créditos ou configure key própria em /config/ia e reprocesse o item.'
        : err instanceof Error
          ? err.message
          : String(err);
    console.error(`[ingest-context] item ${item.id} falhou:`, message);
    const metadata = { ...(item.metadata ?? {}), error: message };
    await supabase
      .from('context_items')
      .update({ status: 'error', metadata })
      .eq('id', item.id)
      .then(({ error }) => {
        if (error) console.error('[ingest-context] falha ao gravar status error:', error.message);
      });
  }
}

/** Resolve o texto-fonte: body OU download do bucket context-files (só .txt/.md no MVP). */
async function resolveText(supabase: SupabaseClient, item: ContextItemRow): Promise<string> {
  if (item.body?.trim()) return item.body;

  if (!item.file_path && item.source_url) {
    const { text } = await readLink(item.source_url, null, MAX_LINK_CHARS);
    const { error } = await supabase.from('context_items').update({ body: text }).eq('id', item.id);
    if (error) throw new Error(`Falha ao guardar o texto do link: ${error.message}`);
    return text;
  }

  if (!item.file_path) {
    throw new Error('Item sem body e sem file_path.');
  }

  const blob = await downloadRestoring(supabase, 'context-files', item.file_path);
  if (!blob) {
    throw new Error('Falha ao baixar o arquivo do bucket context-files: arquivo vazio');
  }

  const mime = (blob.type || '').split(';')[0].trim().toLowerCase();
  const extension = item.file_path.split('.').pop()?.toLowerCase() ?? '';
  const supported =
    ALLOWED_EXTENSIONS.includes(extension) || ALLOWED_MIME_TYPES.includes(mime);
  if (!supported) {
    throw new Error(
      `Tipo de arquivo não suportado no MVP (recebido: ${mime || `.${extension}` || 'desconhecido'}). ` +
        'Envie texto puro (.txt) ou markdown (.md), ou cole o conteúdo no campo de texto do item.',
    );
  }

  return await blob.text();
}
