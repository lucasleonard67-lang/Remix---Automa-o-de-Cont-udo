import { ArrowRight, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { CardLink, InsightsBento } from "@/components/analytics/insights-bento";
import { ChartFrame } from "@/components/analytics/chart-frame";
import { ConnectedAccounts } from "@/components/analytics/connected-accounts";
import { STAGGER_CLASS, staggerStyle } from "@/components/analytics/motion";
import { NetworkCluster } from "@/components/analytics/network-cluster";
import { PostSheet } from "@/components/analytics/post-sheet";
import { PostsTable } from "@/components/analytics/posts-table";
import { StateLine } from "@/components/analytics/shared";
import { CompetitorsDialog } from "@/components/market/competitors-dialog";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useSecretStatus } from "@/hooks/use-app-settings";
import { useIsAdmin } from "@/hooks/use-is-admin";
import {
  useApifyConfigured,
  useCompetitorPosts,
  useCompetitors,
  useMarketSummary,
  useSyncMarket,
} from "@/hooks/use-market";
import {
  ANALYTICS_RANGE_LABELS,
  useAnalyticsRanges,
  useAccountFollowerStats,
  useZernioAccounts,
  useZernioBestTime,
  useZernioDaily,
  useZernioPosts,
  type AnalyticsRange,
} from "@/hooks/use-zernio";
import type { MarketInput } from "@/lib/desempenho-insights";
import { humanizeError } from "@/lib/humanize-error";
import { openIntegration } from "@/lib/integration-modal";
import { cn } from "@/lib/utils";
import { mergeFollowerSeries, type ZernioPost } from "@/lib/zernio-analytics";

import "@/components/analytics/analytics.css";

// ---------------------------------------------------------------------------
// Desempenho das redes como BI: o título, a descrição e o seletor de período
// ficam no cabeçalho da página; aqui, as conclusões (InsightsBento) e, sob
// pedido, a lista de publicações. Sem Zernio: nada de número zerado — só o
// próximo passo, UMA ação: conectar as redes.
// ---------------------------------------------------------------------------

export function PerformanceSection({ range }: { range: AnalyticsRange }) {
  const secretStatus = useSecretStatus();
  const keyConfigured = secretStatus.data?.includes("ZERNIO_API_KEY") ?? false;

  return (
    <section className="space-y-7" aria-label="Desempenho das redes">
      {secretStatus.isLoading ? (
        <LoadingBlocks />
      ) : keyConfigured ? (
        <PerformanceModule range={range} />
      ) : (
        <NotConnected />
      )}
    </section>
  );
}

/** Período no cabeçalho da página: abas segmentadas do kit (2–4 vistas da mesma coisa). */
export function PeriodSelect({
  value,
  onChange,
}: {
  value: AnalyticsRange;
  onChange: (range: AnalyticsRange) => void;
}) {
  const secretStatus = useSecretStatus();
  const keyConfigured = secretStatus.data?.includes("ZERNIO_API_KEY") ?? false;
  // "1 ano" só aparece quando a metrics-sync já gravou leituras no banco.
  const ranges = useAnalyticsRanges(keyConfigured);
  // sem redes conectadas não há o que filtrar: o próximo passo é a única ação
  if (!keyConfigured) return null;
  return (
    <Tabs value={String(value)} onValueChange={(v) => onChange(Number(v) as AnalyticsRange)}>
      <TabsList aria-label="Período">
        {ranges.map((days) => (
          <TabsTrigger key={days} value={String(days)}>
            {ANALYTICS_RANGE_LABELS[days]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/** Sem Zernio: sem fileira de indicadores zerados (regra do kit), uma ação. */
function NotConnected() {
  const { isAdmin } = useIsAdmin();
  return (
    <div className={STAGGER_CLASS} style={staggerStyle(0)}>
      <ChartFrame>
        <NetworkCluster />
        <p className="mt-2 max-w-sm text-sm text-[var(--via-text-muted)]">
          {isAdmin
            ? "Conecte suas redes sociais para acompanhar alcance, views, salvamentos e seguidores aqui."
            : "Peça a um administrador para conectar as redes sociais em Ajustes → Integrações."}
        </p>
        {isAdmin ? (
          <Button onClick={() => openIntegration("zernio")}>
            Conectar redes sociais
            <ArrowRight aria-hidden="true" />
          </Button>
        ) : null}
      </ChartFrame>
    </div>
  );
}

/** Depois disso, abrir o Desempenho refaz a leitura dos concorrentes sozinho (admin). */
const MARKET_REFRESH_HOURS = 12;

function PerformanceModule({ range }: { range: AnalyticsRange }) {
  const [selected, setSelected] = useState<ZernioPost | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const { isAdmin } = useIsAdmin();

  // As conclusões comparam com o período anterior do mesmo tamanho: busca o dobro.
  const window = range * 2;
  const accounts = useZernioAccounts();
  const postsQuery = useZernioPosts(range);
  const dailyQuery = useZernioDaily(window);
  const followersQuery = useAccountFollowerStats(window);
  const bestTimeQuery = useZernioBestTime();
  const apify = useApifyConfigured();
  const competitors = useCompetitors();
  const marketSummary = useMarketSummary();
  const competitorPosts = useCompetitorPosts(range, apify.configured);
  const { start, progress } = useSyncMarket();

  // Leitura automática dos concorrentes: primeira vez ou resumo velho (vinha da
  // seção de ideias, que saiu desta tela; as ideias moram no Início e em Criar).
  const autoStarted = useRef(false);
  const competitorRows = competitors.data;
  const syncedAt = marketSummary.data?.synced_at ?? null;
  useEffect(() => {
    if (autoStarted.current || !isAdmin || !apify.configured) return;
    if (marketSummary.isLoading || competitors.isLoading || !competitorRows?.length) return;
    const age = syncedAt ? Date.now() - new Date(syncedAt).getTime() : Infinity;
    if (age > MARKET_REFRESH_HOURS * 3_600_000 || competitorRows.some((c) => !c.last_sync_at)) {
      autoStarted.current = true;
      void start().catch(() => undefined);
    }
  }, [
    isAdmin,
    apify.configured,
    competitorRows,
    syncedAt,
    marketSummary.isLoading,
    competitors.isLoading,
    start,
  ]);

  const market = useMemo<MarketInput | null>(
    () =>
      apify.configured && marketSummary.data
        ? { summary: marketSummary.data, posts: competitorPosts.data ?? [], days: range }
        : null,
    [apify.configured, marketSummary.data, competitorPosts.data, range],
  );

  const posts = useMemo(() => postsQuery.data?.posts ?? [], [postsQuery.data]);
  const followersAll = useMemo(
    () => mergeFollowerSeries(followersQuery.data ?? []),
    [followersQuery.data],
  );
  const [tableOpen, setTableOpen] = useState(false);

  const loading = postsQuery.isLoading || followersQuery.isLoading;
  const overview = postsQuery.data?.overview;

  if (postsQuery.isError) {
    return <StateLine>{humanizeError(postsQuery.error.message)} Recarregue a página.</StateLine>;
  }
  if (loading) return <LoadingBlocks />;

  const competitorCount = (competitors.data ?? []).filter((c) => c.enabled).length;
  // O card Mercado diz por que ainda não compara e oferece UMA saída.
  const marketEmpty = !apify.configured ? (
    <p className="text-sm text-[var(--via-text-muted)]">
      {isAdmin
        ? "Conecte o Apify para ler os posts públicos dos concorrentes e comparar com os seus."
        : "Peça a um administrador para conectar o Apify em Ajustes → Integrações."}
    </p>
  ) : competitorCount === 0 ? (
    <p className="text-sm text-[var(--via-text-muted)]">
      Adicione os perfis que disputam o mesmo público para ver onde você está.
    </p>
  ) : progress.running || !marketSummary.data ? (
    <p className="text-sm text-[var(--via-text-muted)]" role="status">
      {progress.error
        ? humanizeError(progress.error)
        : "Lendo os concorrentes. A comparação aparece em instantes."}
    </p>
  ) : (
    <p className="text-sm text-[var(--via-text-muted)]">
      Ainda não há publicações suas com métricas suficientes para comparar.
    </p>
  );
  const marketAction = !apify.configured ? (
    isAdmin ? (
      <CardLink onClick={() => openIntegration("apify")}>Conectar Apify</CardLink>
    ) : null
  ) : (
    <CardLink onClick={() => setManageOpen(true)}>
      {competitorCount ? `Concorrentes (${competitorCount})` : "Adicionar concorrentes"}
    </CardLink>
  );

  return (
    <>
      {accounts.data?.length ? (
        <ConnectedAccounts accounts={accounts.data} followers={followersQuery.data ?? []} />
      ) : null}

      {overview?.syncTriggered || (overview?.staleAccountCount ?? 0) > 0 ? (
        <StateLine>
          O Zernio ainda está atualizando as métricas. Os números podem mudar nos próximos minutos.
        </StateLine>
      ) : null}

      <div className={STAGGER_CLASS} style={staggerStyle(1)}>
        <InsightsBento
          posts={posts}
          followers={followersAll}
          daily={dailyQuery.data ?? []}
          bestTime={bestTimeQuery.data ?? []}
          market={market}
          days={range}
          marketEmpty={marketEmpty}
          marketAction={marketAction}
          onOpenPost={setSelected}
        />
      </div>

      {posts.length ? (
        // a lista completa só quando a pessoa pede: o BI fica com as conclusões
        <Collapsible open={tableOpen} onOpenChange={setTableOpen} className="space-y-4">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="-ml-2 text-[var(--via-text-muted)]">
              <ChevronDown
                className={cn(
                  "transition-transform duration-[var(--via-dur)]",
                  tableOpen && "rotate-180",
                )}
                aria-hidden="true"
              />
              {tableOpen
                ? "Esconder as publicações"
                : `Ver todas as publicações com métricas (${posts.length})`}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <PostsTable posts={posts} onOpen={setSelected} />
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      <PostSheet post={selected} onClose={() => setSelected(null)} />
      <CompetitorsDialog
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        summary={marketSummary.data ?? null}
        progress={progress}
        onSync={start}
      />
    </>
  );
}

function LoadingBlocks() {
  return (
    <div className="space-y-7" aria-busy="true" aria-label="Carregando desempenho">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[8.5rem] rounded-[var(--via-radius-lg)]" />
        ))}
      </div>
      <Skeleton className="h-[260px] w-full rounded-[var(--via-radius-lg)]" />
      <Skeleton className="h-6 w-2/3" />
    </div>
  );
}
