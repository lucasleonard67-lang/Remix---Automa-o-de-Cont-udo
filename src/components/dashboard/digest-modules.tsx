import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useMemo } from "react";

import { useCountUp } from "@/components/analytics/motion";
import { useFirstStepsVisible } from "@/components/dashboard/first-steps";
import { Panel, PANEL_ITEM, PanelLink } from "@/components/dashboard/panel";
import { Kpi, KpiRow } from "@/components/patterns/Metricas";
import { Skeleton } from "@/components/ui/skeleton";
import { useSecretStatus } from "@/hooks/use-app-settings";
import { useDashboardSuggestions } from "@/hooks/use-dashboard-suggestions";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useAccountFollowerStats, useZernioDaily } from "@/hooks/use-zernio";
import { openIntegration } from "@/lib/integration-modal";
import { cn } from "@/lib/utils";
import {
  followerPeriod,
  formatNumber,
  formatSigned,
  mergeFollowerSeries,
  periodDelta,
} from "@/lib/zernio-analytics";

// ---------------------------------------------------------------------------
// Redes e Ideias no Início. Redes: quatro cards de número, de 7 dias, cada um com
// a variação contra os 7 anteriores. Ideias: as 3 melhores do Radar, lado a lado,
// cada uma com "Criar". O resto vive em páginas próprias (/desempenho, /radar).
// ---------------------------------------------------------------------------

const DAYS = 7;

type Trend = "up" | "down" | "flat";

/** Indicador no padrão do kit (Metricas): o 1º é o North Star da fileira. */
function Figure({
  label,
  value,
  pct,
  detalhe,
  destaque,
}: {
  label: string;
  value: number | null;
  /** variação em fração (0,1 = 10%) contra os 7 dias anteriores; null = sem comparação */
  pct: number | null;
  detalhe?: string;
  destaque: boolean;
}) {
  const animated = useCountUp(value);
  return (
    <div data-testid={`stat-${label}`} className="h-full">
      <Kpi
        label={label}
        value={value === null ? "—" : formatNumber(animated ?? 0)}
        variacao={pct === null ? undefined : Math.round(pct * 1000) / 10 /* fração → % */}
        periodo={`vs. ${DAYS} dias anteriores`}
        detalhe={detalhe}
        destaque={destaque}
      />
    </div>
  );
}

const Note = ({ children }: { children: React.ReactNode }) => (
  <p className="via-tile !p-4 text-sm text-[var(--via-text-muted)]">{children}</p>
);

export function NetworksPanel() {
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  // o status das chaves é só de admin; quem não é admin tenta ler os números
  const secrets = useSecretStatus();
  const connected = isAdmin ? (secrets.data?.includes("ZERNIO_API_KEY") ?? false) : true;
  const loading = adminLoading || (isAdmin && secrets.isLoading);
  // o checklist já tem o passo "Conecte suas redes": não repetir o mesmo convite
  const setupVisible = useFirstStepsVisible();
  if (!loading && !connected && setupVisible) return null;
  return (
    <section aria-label={`Redes, ${DAYS} dias`} data-testid="desempenho-resumo">
      <header className="mb-3 flex min-h-6 items-center justify-between gap-3">
        <p className="via-eyebrow truncate">Redes · {DAYS} dias</p>
        <PanelLink to="/desempenho">Desempenho e mercado</PanelLink>
      </header>
      {loading ? (
        <Skeleton className="h-28 w-full rounded-[var(--via-radius-lg)]" />
      ) : connected ? (
        <NetworkFigures isAdmin={isAdmin} />
      ) : (
        <Note>
          Conecte as redes para ver alcance, interações e seguidores.{" "}
          <button
            type="button"
            onClick={() => openIntegration("zernio")}
            className="font-medium text-[var(--via-text-primary)] underline underline-offset-4"
          >
            Conectar redes
          </button>
        </Note>
      )}
    </section>
  );
}

function NetworkFigures({ isAdmin }: { isAdmin: boolean }) {
  // compara com o período anterior do mesmo tamanho: busca o dobro
  const daily = useZernioDaily(DAYS * 2);
  const followers = useAccountFollowerStats(DAYS * 2);
  const merged = useMemo(() => mergeFollowerSeries(followers.data ?? []), [followers.data]);
  if (daily.isLoading || followers.isLoading)
    return <Skeleton className="h-28 w-full rounded-[var(--via-radius-lg)]" />;
  if (daily.isError && followers.isError) {
    return (
      <Note>
        Não deu para ler as redes agora.{" "}
        <button
          type="button"
          onClick={() => {
            void daily.refetch();
            void followers.refetch();
          }}
          className="font-medium text-[var(--via-text-primary)] underline underline-offset-4"
        >
          Tentar de novo
        </button>
      </Note>
    );
  }

  const points = daily.data ?? [];
  const metric = (key: "reach" | "views" | "interactions") => {
    const p = periodDelta(points, key, DAYS);
    return { value: p.current, pct: p.delta.pct };
  };
  const f = followerPeriod(merged, DAYS);
  const figures = [
    { label: "Alcance", ...metric("reach") },
    { label: "Visualizações", ...metric("views") },
    { label: "Interações", ...metric("interactions") },
    {
      label: "Seguidores",
      value: f.total,
      pct: null,
      detalhe: f.gained === null ? undefined : `${formatSigned(f.gained)} em ${DAYS} dias`,
    },
  ];
  // nenhum número ainda: uma frase, não quatro traços
  if (figures.every((fig) => fig.value === null)) {
    return (
      <Note>
        {isAdmin
          ? "Os números chegam na próxima leitura das redes."
          : "Os números das redes aparecem aqui quando houver leituras."}
      </Note>
    );
  }
  // sem alcance nem interação na semana: nada de quatro zeros em destaque (DS),
  // uma frase com o que é fato e o próximo passo
  const activity = figures.filter((fig) => fig.label !== "Seguidores");
  if (activity.every((fig) => !fig.value)) {
    return (
      <Note>
        {f.total !== null ? `${formatNumber(f.total, "full")} seguidores. ` : ""}
        Nenhum alcance nos últimos {DAYS} dias: os números voltam a aparecer aqui depois da próxima
        publicação.
      </Note>
    );
  }
  return (
    <div data-testid="stats-redes">
      <KpiRow>
        {figures.map((fig, i) => (
          <Figure key={fig.label} destaque={i === 0} {...fig} />
        ))}
      </KpiRow>
    </div>
  );
}

const IDEAS = 3;

export function IdeasPanel() {
  const { suggestions, isLoading } = useDashboardSuggestions();
  const ideas = suggestions.filter((s) => s.kind === "radar");
  return (
    <Panel
      label="Ideias de hoje"
      testId="mercado-resumo"
      aside={
        ideas.length > IDEAS ? (
          <span className="text-xs text-[var(--via-text-muted)] tabular-nums">
            +{ideas.length - IDEAS}
          </span>
        ) : null
      }
      footer={<PanelLink to="/radar">Radar</PanelLink>}
    >
      {isLoading ? (
        <Skeleton className="h-20 w-full rounded-[var(--via-radius-md)]" />
      ) : !ideas.length ? (
        <p className="text-sm text-[var(--via-text-muted)]">Sem ideias novas hoje.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-3" data-testid="ideias">
          {ideas.slice(0, IDEAS).map((idea) => (
            <li key={idea.id} className={cn(PANEL_ITEM, "flex min-h-28 flex-col gap-3")}>
              <span
                className="line-clamp-3 text-sm font-medium leading-snug text-[var(--via-text-primary)]"
                title={idea.text}
              >
                {idea.text}
              </span>
              {idea.action.to === "/" ? (
                <Link
                  to="/criar"
                  search={idea.action.search}
                  className="mt-auto inline-flex w-fit items-center gap-1 text-sm font-medium text-[var(--via-text-primary)] transition-[gap] hover:gap-1.5"
                  aria-label={`Criar: ${idea.text}`}
                >
                  Criar <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
