import { createFileRoute, redirect } from "@tanstack/react-router";

import { validateCreateSearch } from "@/components/criar/create-search";
import { CreditsSection } from "@/components/dashboard/credits-section";
import { IdeasPanel, NetworksPanel } from "@/components/dashboard/digest-modules";
import { FirstSteps } from "@/components/dashboard/first-steps";
import { Reveal } from "@/components/dashboard/motion";
import { ProductionModule } from "@/components/dashboard/production-module";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/")({
  // Links antigos de criação (?radar= / ?brief=&kind= / ?channel=, das ideias
  // do Radar e dos concorrentes) seguem para /criar com os mesmos parâmetros.
  validateSearch: validateCreateSearch,
  beforeLoad: ({ search }) => {
    if (Object.keys(search).length) throw redirect({ to: "/criar", search, replace: true });
  },
  component: HomePage,
});

// ---------------------------------------------------------------------------
// Início = painel numa tela, em cards. Cabeçalho (saudação + Criar conteúdo, que
// abre a escolha do que criar) → primeiros passos (checklist do DS, até
// terminar) → quatro números das redes → Produção ao lado de Custos, em 2:1 → Ideias de hoje.
// Nada abre ou fecha no lugar: cada card leva à sua página.
// ---------------------------------------------------------------------------

function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

function HomePage() {
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  // enquanto o papel carrega a grade já nasce em duas colunas (sem salto)
  const twoCols = isAdmin || adminLoading;
  const today = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const row = cn(
    "grid grid-cols-[minmax(0,1fr)] gap-4",
    twoCols && "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]",
  );
  return (
    <div className="mx-auto max-w-6xl space-y-6" data-testid="inicio">
      <Reveal index={0}>
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <div>
            <p className="via-eyebrow first-letter:uppercase">{today}</p>
            <h1 className="mt-1 text-3xl font-medium tracking-[-0.025em] text-[var(--via-text-primary)]">
              {greeting()}
            </h1>
          </div>
          <QuickActions />
        </header>
      </Reveal>
      <FirstSteps revealIndex={1} />
      <Reveal index={2}>
        <NetworksPanel />
      </Reveal>
      <Reveal index={3}>
        <div className={row}>
          <ProductionModule />
          {isAdmin ? (
            <CreditsSection />
          ) : adminLoading ? (
            <Skeleton className="hidden h-60 rounded-[var(--via-radius-lg)] lg:block" />
          ) : null}
        </div>
      </Reveal>
      <Reveal index={4}>
        <IdeasPanel />
      </Reveal>
    </div>
  );
}
