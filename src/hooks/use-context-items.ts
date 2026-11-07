import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { excluir } from "@/hooks/use-delete-content";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { getFunctionErrorMessage } from "@/lib/edge-functions";

// ---------------------------------------------------------------------------
// Tipos (espelham docs/04-modelo-de-dados.md §6.7/§8.5 e 07-contratos-backend.md)
// ---------------------------------------------------------------------------

export const CONTEXT_KINDS = [
  "transcript",
  "post",
  "document",
  "reference",
  "case",
  "offer",
] as const;

export type ContextKind = (typeof CONTEXT_KINDS)[number];

export const CONTEXT_KIND_LABELS: Record<ContextKind, string> = {
  transcript: "Transcrição",
  post: "Post",
  document: "Documento",
  reference: "Referência",
  case: "Case",
  offer: "Oferta",
};

export type ContextItemStatus = "processing" | "ready" | "error";

export interface CaseMetadata {
  metric_type: "brl" | "multiple" | "percent";
  metric_value: number;
  client_name: string | null;
  sector: string;
  source_url: string | null;
  quote: string | null;
  objection_tags: string[];
  citation_policy: "named" | "anonymous";
}

export interface ContextItem {
  id: string;
  kind: ContextKind;
  title: string;
  body: string | null;
  source_url: string | null;
  file_path: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  status: ContextItemStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContextSearchResult {
  item_id: string;
  title: string;
  kind: ContextKind;
  excerpt: string;
  score: number;
}

export interface CreateContextItemInput {
  title: string;
  kind: ContextKind;
  tags: string[];
  body?: string;
  source_url?: string;
  file?: File;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Leituras
// ---------------------------------------------------------------------------

/**
 * Lista de `context_items` (ordem: mais recente primeiro), filtro opcional por kind.
 * Enquanto houver item `processing`, refetch a cada 5s para o status virar
 * `ready`/`error` sem reload (alternativa simples ao Realtime).
 */
export function useContextItems(filters: { kind?: ContextKind | null } = {}) {
  const kind = filters.kind ?? null;
  return useQuery({
    queryKey: ["context-items", { kind }],
    queryFn: async (): Promise<ContextItem[]> => {
      let query = supabase
        .from("context_items")
        .select("*")
        .order("created_at", { ascending: false });
      if (kind) query = query.eq("kind", kind);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      // `metadata` é jsonb (Json) e `status` é text livre no banco — §8.5.
      return (data ?? []) as unknown as ContextItem[];
    },
    refetchInterval: (query) =>
      query.state.data?.some((item) => item.status === "processing") ? 5000 : false,
  });
}

/** Item único por id (detalhe). Refetch 5s enquanto `processing`. */
export function useContextItem(itemId: string | undefined) {
  return useQuery({
    queryKey: ["context-item", itemId],
    enabled: Boolean(itemId),
    queryFn: async (): Promise<ContextItem | null> => {
      if (!itemId) return null;
      const { data, error } = await supabase
        .from("context_items")
        .select("*")
        .eq("id", itemId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      // `metadata` é jsonb (Json) e `status` é text livre no banco — §8.5.
      return (data ?? null) as unknown as ContextItem | null;
    },
    refetchInterval: (query) => (query.state.data?.status === "processing" ? 5000 : false),
  });
}

/** Contagem de `context_chunks` gerados pela ingestão do item. */
export function useContextChunkCount(itemId: string | undefined) {
  return useQuery({
    queryKey: ["context-chunks-count", itemId],
    enabled: Boolean(itemId),
    queryFn: async (): Promise<number> => {
      if (!itemId) return 0;
      const { count, error } = await supabase
        .from("context_chunks")
        .select("id", { count: "exact", head: true })
        .eq("item_id", itemId);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });
}

/**
 * Busca híbrida via edge function `search-context`
 * (POST {query, filters?, limit?} → {results}). Habilitada só com query não-vazia;
 * o debounce (400ms) é responsabilidade de quem chama.
 */
export function useContextSearch(query: string, filters: { kinds?: ContextKind[] } = {}) {
  const kinds = filters.kinds?.length ? filters.kinds : undefined;
  return useQuery({
    queryKey: ["context-search", query, kinds ?? null],
    enabled: query.trim().length > 0,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<ContextSearchResult[]> => {
      const { data, error } = await supabase.functions.invoke("search-context", {
        body: { query, ...(kinds ? { filters: { kinds } } : {}) },
      });
      if (error) {
        throw new Error(
          await getFunctionErrorMessage(
            error,
            "Não foi possível buscar no Contexto. Tente de novo.",
          ),
        );
      }
      return ((data as { results?: ContextSearchResult[] })?.results ??
        []) as ContextSearchResult[];
    },
  });
}

// ---------------------------------------------------------------------------
// Escritas
// ---------------------------------------------------------------------------

/**
 * Cria um item de contexto: upload opcional para o bucket `context-files`,
 * insert em `context_items` (status default `processing`) e disparo do
 * `ingest-context {item_id}` (202). Falha na ingestão NÃO desfaz a criação —
 * volta em `ingestError` para a UI avisar e oferecer "Reprocessar".
 */
export function useCreateContextItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: CreateContextItemInput,
    ): Promise<{ item: ContextItem; ingestError: string | null }> => {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) throw new Error("Sua sessão expirou. Entre de novo para continuar.");

      let filePath: string | null = null;
      if (input.file) {
        const safeName = input.file.name.replace(/[^\w.-]+/g, "_");
        filePath = `${userId}/${Date.now()}-${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from("context-files")
          .upload(filePath, input.file);
        if (uploadError)
          throw new Error(`Não foi possível enviar o arquivo: ${uploadError.message}`);
      }

      const { data, error } = await supabase
        .from("context_items")
        .insert({
          title: input.title,
          kind: input.kind,
          tags: input.tags,
          body: input.body ?? null,
          source_url: input.source_url ?? null,
          file_path: filePath,
          // `metadata` é jsonb (Json) — shape livre por kind (§8.5).
          metadata: (input.metadata ?? {}) as Json,
          created_by: userId,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      const item = data as unknown as ContextItem;

      const { error: fnError } = await supabase.functions.invoke("ingest-context", {
        body: { item_id: item.id },
      });
      const ingestError = fnError
        ? await getFunctionErrorMessage(fnError, "Não foi possível iniciar o processamento.")
        : null;

      return { item, ingestError };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["context-items"] });
    },
  });
}

export interface UpdateContextItemInput {
  id: string;
  title?: string;
  tags?: string[];
  body?: string;
  metadata?: Record<string, unknown>;
}

/** Edição de campos básicos (título/tags/body/metadata) — autor ou admin (RLS). */
export function useUpdateContextItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      metadata,
      ...patch
    }: UpdateContextItemInput): Promise<ContextItem> => {
      const { data, error } = await supabase
        .from("context_items")
        .update({
          ...patch,
          // `metadata` é jsonb (Json) — shape livre por kind (§8.5).
          ...(metadata !== undefined ? { metadata: metadata as Json } : {}),
        })
        .eq("id", id)
        .select()
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Só quem criou o item ou um administrador pode editá-lo.");
      return data as unknown as ContextItem;
    },
    onSuccess: (item) => {
      void queryClient.invalidateQueries({ queryKey: ["context-items"] });
      void queryClient.invalidateQueries({ queryKey: ["context-item", item.id] });
    },
  });
}

/**
 * Exclui o item, com os trechos, o arquivo e a cópia no Drive. Peças que usaram
 * o item mantêm a referência solta em `context_ids` — avisar na UI antes de confirmar.
 */
export function useDeleteContextItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => excluir("context", itemId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["context-items"] });
      void queryClient.invalidateQueries({ queryKey: ["context-search"] });
    },
  });
}

/** (Re)dispara a ingestão RAG do item — `ingest-context {item_id}` → 202. */
export function useIngestContext() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string): Promise<void> => {
      const { error } = await supabase.functions.invoke("ingest-context", {
        body: { item_id: itemId },
      });
      if (error) {
        throw new Error(
          await getFunctionErrorMessage(error, "Não foi possível processar o item. Tente de novo."),
        );
      }
    },
    onSuccess: (_data, itemId) => {
      void queryClient.invalidateQueries({ queryKey: ["context-items"] });
      void queryClient.invalidateQueries({ queryKey: ["context-item", itemId] });
    },
  });
}
