import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { BrandIcon } from "@/components/brand-icon";
import { useIntegrationStatus } from "@/components/integration-grid";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { INTEGRATION_BY_ID, INTEGRATION_GROUPS, type IntegrationId } from "@/lib/integrations";
import { openIntegration } from "@/lib/integration-modal";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Conectores (só admin) num chip: "8/11", com o ponto de estado. Clicar abre um popover só
// com o que falta, cada um abrindo a conexão ali mesmo (openIntegration), e um
// link para gerenciar todos em Ajustes → Integrações.
// ---------------------------------------------------------------------------

const IDS: IntegrationId[] = INTEGRATION_GROUPS.flatMap((g) => g.ids).filter(
  (id) => INTEGRATION_BY_ID[id].kind !== "builtin",
);

export function ConnectorsChip() {
  const { isAdmin } = useIsAdmin();
  const statusOf = useIntegrationStatus();
  if (!isAdmin) return null;

  const items = IDS.map((id) => ({
    item: INTEGRATION_BY_ID[id],
    status: statusOf(INTEGRATION_BY_ID[id]),
  }));
  const loading = items.some((i) => i.status === "loading");
  const on = items.filter((i) => i.status === "on").length;
  const missing = items.filter((i) => i.status !== "on" && i.status !== "loading");

  return (
    <Popover>
      <PopoverTrigger
        className="inline-flex h-6 items-center gap-1.5 rounded-full border border-[var(--via-border-soft)] px-2 text-xs text-[var(--via-text-muted)] transition-colors hover:border-[var(--via-navy-30)] hover:text-[var(--via-text-primary)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]"
        data-testid="conectores"
        aria-label={`Conectores: ${on} de ${items.length} conectados`}
        title="Conectores"
      >
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 rounded-full",
            loading
              ? "animate-pulse bg-[var(--via-navy-14)]"
              : missing.length
                ? "bg-[var(--via-brand-blue)]"
                : "bg-[var(--via-navy)]",
          )}
        />
        <span className="tabular-nums">
          {on}/{items.length}
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        {missing.length ? (
          <>
            <p className="px-2 pt-1 pb-2 text-xs text-[var(--via-text-muted)]">Falta conectar</p>
            <ul>
              {missing.map(({ item }) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => openIntegration(item.id)}
                    className="flex h-9 w-full items-center gap-2.5 rounded-[var(--via-radius-md)] px-2 text-left text-sm text-[var(--via-text-primary)] hover:bg-[var(--via-navy-04)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]"
                    data-testid={`conector-${item.id}`}
                    title={item.purpose}
                  >
                    <BrandIcon name={item.brand} className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    <span className="text-xs text-[var(--via-text-muted)]">Conectar</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="px-2 py-2 text-sm text-[var(--via-text-primary)]">Tudo conectado.</p>
        )}
        <Link
          to="/config"
          search={{ aba: "integracoes" }}
          className="mt-1 flex h-9 items-center gap-1 rounded-[var(--via-radius-md)] px-2 text-sm font-medium text-[var(--via-text-primary)] hover:bg-[var(--via-navy-04)]"
        >
          Gerenciar integrações <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </PopoverContent>
    </Popover>
  );
}
