import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Loader2, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";

import { Reveal } from "@/components/dashboard/motion";
import { PageEyebrow } from "@/components/page-header";
import { AddFeedDialog, FeedGrid } from "@/components/radar/feed-grid";
import { NewsRow } from "@/components/radar/news-row";
import { RadarFilters, type RadarFilterState } from "@/components/radar/radar-filters";
import { RefreshStatus } from "@/components/radar/refresh-status";
import { RadarEmpty } from "@/components/radar/source-cluster";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsAdmin } from "@/hooks/use-is-admin";
import {
  RADAR_REFRESH_MINUTES,
  RSS_PAGE_SIZE,
  radarRefreshStatus,
  useDismissItem,
  useFetchRssNow,
  useRssFeeds,
  useRssItems,
  useRssTopics,
  type FetchRssResult,
} from "@/hooks/use-rss";
import { toast } from "@/lib/toast";

// ---------------------------------------------------------------------------
// /radar — mesa de pautas. As fontes RSS são coletadas sozinhas a cada 30 min
// (agendamento → /api/public/jobs/rss-fetch → fetch-rss), cada notícia recebe
// nota de relevância (casa com a marca) e de tendência, e "Gerar peça" leva a
// pauta para /criar com o briefing pré-composto. Mesma composição aberta do
// Criar: título grande, blocos entrando escalonados, linhas e ladrilhos do kit.
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_app/radar")({
  component: RadarPage,
});

type Tab = "noticias" | "fontes";

function RadarPage() {
  const [tab, setTab] = useState<Tab>("noticias");
  const [adding, setAdding] = useState(false);
  const { isAdmin } = useIsAdmin();
  const feedsQuery = useRssFeeds();
  const feeds = feedsQuery.data ?? [];
  const openAdd = isAdmin ? () => setAdding(true) : undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Reveal index={0}>
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <PageEyebrow />
            <h1 className="text-3xl font-medium tracking-[-0.025em] text-[var(--via-text-primary)]">
              Radar
            </h1>
            <p className="text-sm text-[var(--via-text-muted)]">
              Notícias das suas fontes, com nota de marca e de tendência.
            </p>
          </div>
          {tab === "fontes" && openAdd ? (
            <Button onClick={openAdd} aria-haspopup="dialog" className="rounded-full">
              <Plus aria-hidden="true" />
              Adicionar fonte
            </Button>
          ) : null}
        </header>
      </Reveal>

      <Reveal index={1}>
        <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
          <TabsList>
            <TabsTrigger value="noticias">Notícias</TabsTrigger>
            <TabsTrigger value="fontes">Fontes</TabsTrigger>
          </TabsList>
          <TabsContent value="noticias" className="mt-6">
            <NewsTab onSeeSources={() => setTab("fontes")} onAdd={openAdd} />
          </TabsContent>
          <TabsContent value="fontes" className="mt-6">
            <FeedsTab onAdd={openAdd} />
          </TabsContent>
        </Tabs>
      </Reveal>

      {isAdmin ? (
        <AddFeedDialog
          open={adding}
          onClose={() => setAdding(false)}
          existingUrls={new Set(feeds.map((f) => f.url))}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba Notícias
// ---------------------------------------------------------------------------

const FILTROS_INICIAIS: RadarFilterState = {
  search: "",
  status: "new",
  sort: "score",
  feedId: null,
  onlyBrand: false,
  topic: null,
};

function describeRefresh(result: FetchRssResult): { title: string; description?: string } {
  const failed = result.results.filter((r) => "error" in r).length;
  const bits: string[] = [];
  if (failed > 0) bits.push(`${failed} fonte${failed === 1 ? "" : "s"} com erro — veja em Fontes`);
  if (result.warning) bits.push(result.warning);
  return {
    title:
      result.totalNew > 0
        ? `${result.totalNew} notícia${result.totalNew === 1 ? "" : "s"} nova${result.totalNew === 1 ? "" : "s"}`
        : "Nenhuma notícia nova",
    description: bits.join(" · ") || undefined,
  };
}

function NewsTab({ onSeeSources, onAdd }: { onSeeSources: () => void; onAdd?: () => void }) {
  const [filters, setFilters] = useState<RadarFilterState>(FILTROS_INICIAIS);
  const [page, setPage] = useState(0);
  const { isAdmin } = useIsAdmin();

  const feedsQuery = useRssFeeds();
  const topicsQuery = useRssTopics();
  const itemsQuery = useRssItems({ ...filters, page });
  const dismissItem = useDismissItem();
  const fetchNow = useFetchRssNow();

  const feeds = feedsQuery.data ?? [];
  const feedUrlById = new Map(feeds.map((f) => [f.id, f.url] as const));
  const items = itemsQuery.data?.items ?? [];
  const total = itemsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / RSS_PAGE_SIZE));
  const refresh = radarRefreshStatus(feeds);
  const filtrado =
    filters.search.trim() !== "" ||
    filters.onlyBrand ||
    filters.topic !== null ||
    filters.feedId !== null;
  const canRefresh = isAdmin && feeds.length > 0;

  const patchFilters = (patch: Partial<RadarFilterState>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(0);
  };

  const handleRefresh = () => {
    fetchNow.mutate(undefined, {
      onSuccess: (result) => {
        const msg = describeRefresh(result);
        toast.success(msg.title, { description: msg.description });
      },
      onError: (error) => toast.error("Não foi possível atualizar", { description: error.message }),
    });
  };

  const loading = itemsQuery.isLoading || feedsQuery.isLoading;

  return (
    <div className="space-y-5">
      <RefreshStatus
        lastUpdate={refresh.lastUpdate}
        failing={refresh.failing}
        canRefresh={canRefresh}
        refreshing={fetchNow.isPending}
        onRefresh={handleRefresh}
        onSeeSources={onSeeSources}
      />

      {feeds.length > 0 || loading ? (
        <RadarFilters
          value={filters}
          onChange={patchFilters}
          feeds={feeds}
          topics={topicsQuery.data ?? []}
        />
      ) : null}

      {loading ? (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-[7.5rem] w-full rounded-[var(--via-radius-md)]" />
          ))}
        </div>
      ) : feeds.length === 0 ? (
        <RadarEmpty
          cluster
          text={
            onAdd
              ? "Nenhuma fonte ainda. Adicione uma e as notícias começam a chegar."
              : "Nenhuma fonte ainda. Peça a um administrador para adicionar."
          }
        >
          {onAdd ? (
            <Button onClick={onAdd} aria-haspopup="dialog" className="rounded-full">
              <Plus aria-hidden="true" />
              Adicionar fonte
            </Button>
          ) : null}
        </RadarEmpty>
      ) : items.length === 0 ? (
        filtrado ? (
          <RadarEmpty text="Nada com esses filtros.">
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => patchFilters(FILTROS_INICIAIS)}
            >
              Limpar filtros
            </Button>
          </RadarEmpty>
        ) : (
          <RadarEmpty
            text={`Notícias novas chegam sozinhas a cada ${RADAR_REFRESH_MINUTES} minutos.`}
          >
            {canRefresh ? (
              <Button
                variant="outline"
                className="rounded-full"
                onClick={handleRefresh}
                disabled={fetchNow.isPending}
              >
                {fetchNow.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw aria-hidden="true" />
                )}
                Atualizar agora
              </Button>
            ) : null}
          </RadarEmpty>
        )
      ) : (
        <ul className="space-y-2" aria-label="Notícias">
          {items.map((item, index) => (
            <NewsRow
              key={item.id}
              item={item}
              index={index}
              feedUrl={feedUrlById.get(item.feed_id)}
              onPickTopic={(topic) => patchFilters({ topic })}
              onDelete={() =>
                dismissItem.mutate(
                  { itemId: item.id, dismissed: true },
                  {
                    onSuccess: () =>
                      toast.success("Notícia excluída", {
                        action: {
                          label: "Desfazer",
                          onClick: () => dismissItem.mutate({ itemId: item.id, dismissed: false }),
                        },
                      }),
                    onError: (error) =>
                      toast.error("Não foi possível excluir a notícia", {
                        description: error.message,
                      }),
                  },
                )
              }
            />
          ))}
        </ul>
      )}

      {totalPages > 1 ? (
        <nav
          className="flex items-center justify-between text-sm text-[var(--via-text-muted)]"
          aria-label="Páginas de notícias"
        >
          <span className="via-meta-chip via-meta-chip--mono">
            {page + 1} / {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ArrowLeft aria-hidden="true" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba Fontes — ladrilho + modal; "Adicionar fonte" fica no cabeçalho da página
// ---------------------------------------------------------------------------

function FeedsTab({ onAdd }: { onAdd?: () => void }) {
  const { isAdmin } = useIsAdmin();
  const feedsQuery = useRssFeeds();
  const feeds = feedsQuery.data ?? [];

  if (feedsQuery.isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-[4.75rem] w-full rounded-[var(--via-radius-lg)]" />
        ))}
      </div>
    );
  }

  if (feeds.length === 0) {
    return (
      <RadarEmpty
        cluster
        text={
          onAdd
            ? `Nenhuma fonte ainda. O Radar busca notícias sozinho a cada ${RADAR_REFRESH_MINUTES} minutos.`
            : "Nenhuma fonte ainda. Peça a um administrador para adicionar."
        }
      >
        {onAdd ? (
          <Button onClick={onAdd} aria-haspopup="dialog" className="rounded-full">
            <Plus aria-hidden="true" />
            Adicionar fonte
          </Button>
        ) : null}
      </RadarEmpty>
    );
  }

  return (
    <div className="space-y-4">
      <FeedGrid feeds={feeds} canManage={isAdmin} />
      <p className="text-xs text-[var(--via-text-muted)]">
        {isAdmin
          ? "Clique numa fonte para editar, testar ou remover. As notícias não entram em Contexto."
          : "As notícias não entram em Contexto. Só administradores alteram as fontes."}
      </p>
    </div>
  );
}
