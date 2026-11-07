import { IntegrationGrid } from "@/components/integration-grid";
import { CompetitorsList } from "@/components/market/competitors-dialog";
import { useApifyConfigured, useMarketSummary, useSyncMarket } from "@/hooks/use-market";

// ---------------------------------------------------------------------------
// Passo 4 · Mercado — opcional. Ladrilho do Apify e, com a chave salva, os
// primeiros concorrentes (2 a 3 @). Adicionar já dispara a leitura do perfil.
// ---------------------------------------------------------------------------

export function StepMarket() {
  const apify = useApifyConfigured();
  const summary = useMarketSummary();
  const { start, progress } = useSyncMarket();

  return (
    <div className="space-y-6">
      <IntegrationGrid ids={["apify"]} className="sm:grid-cols-2 lg:grid-cols-2" />

      {apify.configured ? (
        <section className="space-y-3" aria-labelledby="setup-market-competitors">
          <div className="flex items-baseline justify-between gap-3">
            <h3
              id="setup-market-competitors"
              className="text-sm font-medium text-[var(--via-text-primary)]"
            >
              Concorrentes
            </h3>
            <span className="text-xs text-[var(--via-text-muted)]">2 a 3 perfis para começar</span>
          </div>
          <CompetitorsList summary={summary.data} progress={progress} onSync={start} />
        </section>
      ) : apify.isLoading ? null : (
        <p className="text-sm text-[var(--via-text-muted)]">
          Clique em Apify e cole o token. Em seguida você adiciona os perfis aqui.
        </p>
      )}
    </div>
  );
}
