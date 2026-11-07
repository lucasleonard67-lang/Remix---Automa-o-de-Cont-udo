import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { getFunctionErrorMessage } from "@/lib/edge-functions";

// ---------------------------------------------------------------------------
// Radar RSS (Eixo 2 — docs/10): fontes, notícias e curadoria. A coleta roda
// sozinha a cada RADAR_REFRESH_MINUTES (cron → /api/public/jobs/rss-fetch →
// invoke_fetch_rss → edge fetch-rss); "Atualizar agora" invoca a mesma edge.
// Nada de Realtime/polling aqui — refetch após ações.
//
// TODO(types): `rss_feeds`/`rss_items` ainda não existem em
// integrations/supabase/types.ts — o Lovable regenera no deploy; remover os
// casts depois.
// ---------------------------------------------------------------------------

/** Cadência do agendamento gerenciado (cron a cada 30 minutos). */
export const RADAR_REFRESH_MINUTES = 30;

/** Relevância mínima para "só o que tem a ver com a minha marca". */
export const BRAND_RELEVANCE_MIN = 60;

export interface RssFeed {
  id: string;
  name: string;
  url: string;
  active: boolean;
  last_fetched_at: string | null;
  /** Última coleta que deu certo (supabase/sql/radar.sql). */
  last_ok_at: string | null;
  /** Motivo humanizado da última falha; null quando a última coleta deu certo. */
  last_error: string | null;
  last_error_at: string | null;
  last_item_count: number | null;
  created_at: string;
  updated_at: string;
}

export interface RssItem {
  id: string;
  feed_id: string;
  guid: string;
  title: string;
  link: string;
  description: string | null;
  published_at: string | null;
  used_in_job_id: string | null;
  dismissed_at: string | null;
  created_at: string;
  /** 0–100 · casa com a marca (null = ainda sem nota). */
  relevance: number | null;
  /** 0–100 · tendência (recência, repetição entre fontes, assunto em alta). */
  virality: number | null;
  /** relevance × virality / 100, calculado no banco (ordenação padrão). */
  priority: number | null;
  topics: string[] | null;
  score_reason: string | null;
  scored_at: string | null;
  /** Join leve com o nome do feed (select aninhado). */
  rss_feeds?: { name: string } | null;
}

export type RssItemStatus = "new" | "used" | "all";
export type RssSort = "score" | "recent";

/** Presets pt-BR do nicho (todos validados com request real em 2026-10-28). */
export const FEED_PRESETS: Array<{ name: string; url: string; lang?: "en" }> = [
  { name: "G1", url: "https://g1.globo.com/rss/g1/" },
  { name: "G1 Tecnologia", url: "https://g1.globo.com/rss/g1/tecnologia/" },
  { name: "O Globo", url: "https://oglobo.globo.com/rss/oglobo/" },
  { name: "Folha de S.Paulo", url: "https://feeds.folha.uol.com.br/emcimadahora/rss091.xml" },
  { name: "Tecnoblog", url: "https://tecnoblog.net/feed/" },
  { name: "TecMundo", url: "https://rss.tecmundo.com.br/feed" },
  { name: "Canaltech", url: "https://canaltech.com.br/rss/" },
  { name: "Olhar Digital", url: "https://olhardigital.com.br/feed/" },
  { name: "MIT Technology Review Brasil", url: "https://mittechreview.com.br/feed/" },
  { name: "Rock Content (marketing)", url: "https://rockcontent.com/br/blog/feed/" },
  { name: "OpenAI News", url: "https://openai.com/news/rss.xml", lang: "en" },
  { name: "Hacker News (frontpage)", url: "https://hnrss.org/frontpage", lang: "en" },
];

// `rss_*` fora dos types gerados — client não-tipado só neste módulo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ---------------------------------------------------------------------------
// Feeds
// ---------------------------------------------------------------------------

export function useRssFeeds() {
  return useQuery({
    queryKey: ["rss-feeds"],
    queryFn: async (): Promise<RssFeed[]> => {
      const { data, error } = await db
        .from("rss_feeds")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as RssFeed[];
    },
  });
}

/** Estado da atualização automática, derivado das fontes. */
export function radarRefreshStatus(feeds: RssFeed[]): {
  lastUpdate: Date | null;
  failing: number;
  active: number;
} {
  let last: number | null = null;
  let failing = 0;
  let active = 0;
  for (const feed of feeds) {
    if (!feed.active) continue;
    active++;
    if (feed.last_error) failing++;
    const t = feed.last_fetched_at ? new Date(feed.last_fetched_at).getTime() : null;
    if (t !== null && !Number.isNaN(t) && (last === null || t > last)) last = t;
  }
  return { lastUpdate: last === null ? null : new Date(last), failing, active };
}

export function useRssFeedMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["rss-feeds"] });
    void queryClient.invalidateQueries({ queryKey: ["rss-items"] });
  };

  const create = useMutation({
    mutationFn: async (input: { name: string; url: string }): Promise<string> => {
      const { data, error } = await db
        .from("rss_feeds")
        .insert({ name: input.name.trim(), url: input.url.trim() })
        .select("id")
        .single();
      if (error) {
        throw new Error(error.code === "23505" ? "Esta fonte já está cadastrada." : error.message);
      }
      return (data as { id: string }).id;
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async (input: { id: string; name: string; url: string }): Promise<void> => {
      const { error } = await db
        .from("rss_feeds")
        .update({ name: input.name.trim(), url: input.url.trim() })
        .eq("id", input.id);
      if (error) {
        throw new Error(
          error.code === "23505" ? "Já existe uma fonte com este endereço." : error.message,
        );
      }
    },
    onSuccess: invalidate,
  });

  const toggleActive = useMutation({
    mutationFn: async (input: { id: string; active: boolean }): Promise<void> => {
      const { error } = await db
        .from("rss_feeds")
        .update({ active: input.active })
        .eq("id", input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await db.from("rss_feeds").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  return { create, update, toggleActive, remove };
}

export interface FetchRssResult {
  ok: boolean;
  totalNew: number;
  scored: number;
  pending: number;
  warning: string | null;
  results: Array<
    | { feed_id: string; feed: string; fetched: number; new: number }
    | { feed_id: string; feed: string; error: string }
  >;
}

/** "Atualizar agora": invoca fetch-rss (admin). Com `feedId`, só aquela fonte. */
export function useFetchRssNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input?: { feedId?: string }): Promise<FetchRssResult> => {
      const { data, error } = await supabase.functions.invoke("fetch-rss", {
        body: input?.feedId ? { feed_id: input.feedId } : {},
      });
      if (error) {
        throw new Error(
          await getFunctionErrorMessage(
            error,
            "Não foi possível buscar as notícias. Tente de novo em alguns minutos.",
          ),
        );
      }
      return data as FetchRssResult;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["rss-items"] });
      void queryClient.invalidateQueries({ queryKey: ["rss-feeds"] });
      void queryClient.invalidateQueries({ queryKey: ["rss-topics"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Notícias (itens)
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

export interface RssItemFilters {
  page: number;
  status: RssItemStatus;
  feedId: string | null;
  search: string;
  /** Só relevance ≥ BRAND_RELEVANCE_MIN. */
  onlyBrand: boolean;
  topic: string | null;
  sort: RssSort;
}

/** `%` e `_` são curingas do ilike; vírgula e parêntese quebram o `.or()`. */
function escapeLike(term: string): string {
  return term.replace(/[%_\\]/g, (c) => `\\${c}`).replace(/[,()]/g, " ");
}

export function useRssItems(filters: RssItemFilters) {
  return useQuery({
    queryKey: ["rss-items", filters],
    queryFn: async (): Promise<{ items: RssItem[]; total: number }> => {
      // As colunas de nota (priority/relevance/topics) chegam por SQL aplicado
      // à instância. Enquanto não existirem, a lista continua funcionando sem
      // notas em vez de quebrar com "column does not exist".
      try {
        return await fetchItems(filters, true);
      } catch (error) {
        if (error instanceof Error && /does not exist|42703/i.test(error.message)) {
          return fetchItems(filters, false);
        }
        throw error;
      }
    },
  });
}

async function fetchItems(
  filters: RssItemFilters,
  withScores: boolean,
): Promise<{ items: RssItem[]; total: number }> {
  let query = db.from("rss_items").select("*, rss_feeds(name)", { count: "exact" });

  if (filters.sort === "score" && withScores) {
    query = query
      .order("priority", { ascending: false, nullsFirst: false })
      .order("published_at", { ascending: false, nullsFirst: false });
  } else {
    query = query.order("published_at", { ascending: false, nullsFirst: false });
  }

  // a linha excluída fica, marcada: sem ela, a próxima leitura do feed traria a notícia de volta
  query = query.is("dismissed_at", null);
  if (filters.status === "new") {
    query = query.is("used_in_job_id", null);
  } else if (filters.status === "used") {
    query = query.not("used_in_job_id", "is", null);
  }
  if (filters.feedId) query = query.eq("feed_id", filters.feedId);
  if (filters.onlyBrand && withScores) query = query.gte("relevance", BRAND_RELEVANCE_MIN);
  if (filters.topic && withScores) query = query.contains("topics", [filters.topic]);
  const term = escapeLike(filters.search.trim());
  if (term) query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%`);

  const from = filters.page * PAGE_SIZE;
  const { data, error, count } = await query.range(from, from + PAGE_SIZE - 1);
  if (error) throw new Error(error.message);
  return { items: (data ?? []) as RssItem[], total: count ?? 0 };
}

export const RSS_PAGE_SIZE = PAGE_SIZE;

/** Assuntos mais frequentes entre as notícias novas (para os chips de filtro). */
export function useRssTopics(limit = 8) {
  return useQuery({
    queryKey: ["rss-topics", limit],
    staleTime: 60_000,
    queryFn: async (): Promise<Array<{ topic: string; count: number }>> => {
      const { data, error } = await db
        .from("rss_items")
        .select("topics")
        .is("used_in_job_id", null)
        .is("dismissed_at", null)
        .not("scored_at", "is", null)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(400);
      // coluna de nota ainda não aplicada na instância → sem chips, sem erro
      if (error && /does not exist|42703/i.test(error.message)) return [];
      if (error) throw new Error(error.message);
      const counts = new Map<string, number>();
      for (const row of (data ?? []) as Array<{ topics: string[] | null }>) {
        for (const topic of row.topics ?? []) counts.set(topic, (counts.get(topic) ?? 0) + 1);
      }
      return [...counts.entries()]
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([topic, count]) => ({ topic, count }));
    },
  });
}

/** Uma notícia por id — a tela de criação a carrega quando vem do Radar. */
export function useRssItem(itemId: string | undefined) {
  return useQuery({
    queryKey: ["rss-item", itemId],
    enabled: Boolean(itemId),
    queryFn: async (): Promise<RssItem | null> => {
      if (!itemId) return null;
      const { data, error } = await db
        .from("rss_items")
        .select("*, rss_feeds(name)")
        .eq("id", itemId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as RssItem | null;
    },
  });
}

/** Grava o vínculo notícia → job após o dispatch da geração. */
export function useMarkItemUsed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { itemId: string; jobId: string }): Promise<void> => {
      const { error } = await db
        .from("rss_items")
        .update({ used_in_job_id: input.jobId })
        .eq("id", input.itemId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rss-items"] });
      // a notícia usada sai das sugestões (Início e /criar)
      void queryClient.invalidateQueries({ queryKey: ["dashboard", "radar-fresh"] });
    },
  });
}

export function useDismissItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { itemId: string; dismissed: boolean }): Promise<void> => {
      const { error } = await db
        .from("rss_items")
        .update({ dismissed_at: input.dismissed ? new Date().toISOString() : null })
        .eq("id", input.itemId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rss-items"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Brief da geração (título + resumo sem HTML + fonte)
// ---------------------------------------------------------------------------

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function composeBrief(item: RssItem): string {
  const parts = [`Notícia: ${item.title}`];
  if (item.description) {
    const clean = stripHtml(item.description).slice(0, 600);
    if (clean) parts.push(`Resumo: ${clean}`);
  }
  parts.push(`Fonte: ${item.link}`);
  parts.push(
    "Crie conteúdo em português brasileiro conectando esta notícia ao posicionamento da marca.",
  );
  return parts.join("\n\n");
}
