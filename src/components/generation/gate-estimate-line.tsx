import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatUsd } from "@/lib/format-usd";
import type { GateEstimate } from "@/lib/generation-gate";
import { humanizeError } from "@/lib/humanize-error";
import type { IntegrationId } from "@/lib/integrations";
import { INTEGRATION_BY_ID } from "@/lib/integrations";
import { cn } from "@/lib/utils";

// A linha de estimativa do recibo. Nunca some: muda de estado. Rótulo à
// esquerda, valor em mono à direita, o que o valor depende em 12px abaixo.

export type GateEstimateState =
  | GateEstimate
  | { kind: "loading" }
  /** ainda sem dado para calcular (ex.: o vídeo não foi lido) */
  | { kind: "pending"; reason: string }
  | {
      kind: "server";
      totalUsd: number;
      perScene: { label: string; usd: number }[];
      budget: { spentUsd: number; capUsd: number } | null;
    }
  | { kind: "error"; error: Error; onRetry?: () => void }
  /** a função não calcula sem o provedor conectado (400 replicate_not_configured) */
  | { kind: "connect"; integration: IntegrationId };

export interface GateEstimateLineProps {
  estimate: GateEstimateState;
  /** à direita do valor (o botão primário); null no diálogo de confirmação */
  action: ReactNode | null;
  /** linha extra em 12px (ex.: "HeyGen cobra à parte") */
  note?: string;
  /** false no diálogo de confirmação, que mostra o OverBudgetAlert no lugar da linha */
  showBudget?: boolean;
}

export function GateEstimateLine({
  estimate,
  action,
  note,
  showBudget = true,
}: GateEstimateLineProps) {
  const [open, setOpen] = useState(false);
  const canExpand = estimate.kind === "server" && estimate.perScene.length > 1;

  return (
    <div className="space-y-3" data-testid="gate-estimate">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-sm text-[var(--via-text-muted)]">Estimativa</p>
          {/* div, não p: no carregamento o DependsOn é um Skeleton (div) */}
          <div className="text-xs text-[var(--via-text-muted)]" data-testid="gate-estimate-depends">
            <DependsOn estimate={estimate} />
          </div>
          {note ? <p className="text-xs text-[var(--via-text-muted)]">{note}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="text-right" data-testid="gate-estimate-value">
            <Value
              estimate={estimate}
              expandable={canExpand}
              expanded={open}
              onToggle={() => setOpen((v) => !v)}
            />
          </div>
          {action}
        </div>
      </div>

      {estimate.kind === "server" && canExpand && open ? (
        <ul className="divide-y divide-[var(--via-border-soft)] border-y border-[var(--via-border-soft)] text-xs">
          {estimate.perScene.map((scene) => (
            <li key={scene.label} className="flex items-center justify-between gap-4 py-1.5">
              <span className="text-[var(--via-text-muted)]">{scene.label}</span>
              <span className="font-mono text-[var(--via-text-primary)]">
                {formatUsd(scene.usd)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {showBudget &&
      estimate.kind === "server" &&
      estimate.budget &&
      estimate.budget.capUsd > 0 &&
      estimate.budget.spentUsd + estimate.totalUsd > estimate.budget.capUsd ? (
        // Só a linha: o alerta com o campo de novo limite mora no diálogo de confirmação.
        <p className="text-xs font-medium text-destructive" data-testid="gate-over-budget">
          Passa do limite do mês: {formatUsd(estimate.budget.spentUsd + estimate.totalUsd)} de{" "}
          {formatUsd(estimate.budget.capUsd)}.
        </p>
      ) : null}
    </div>
  );
}

function Value({
  estimate,
  expandable,
  expanded,
  onToggle,
}: {
  estimate: GateEstimateState;
  expandable: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const mono = "font-mono text-lg font-medium tabular-nums text-[var(--via-text-primary)]";
  switch (estimate.kind) {
    case "loading":
      return <Skeleton className="h-6 w-24" />;
    case "catalog":
      return (
        <span className={mono}>
          {estimate.parts ? (
            <span className="mr-1.5 text-sm font-normal text-[var(--via-text-muted)]">
              {formatUsd(estimate.parts.a)} + {formatUsd(estimate.parts.b)} =
            </span>
          ) : null}
          até {formatUsd(estimate.maxUsd)}
        </span>
      );
    case "server":
      return expandable ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className={cn(
            mono,
            "inline-flex cursor-pointer items-center gap-1 rounded-[6px] underline decoration-[var(--via-border)] decoration-dotted underline-offset-4 hover:decoration-[var(--via-navy)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]",
          )}
        >
          até {formatUsd(estimate.totalUsd)}
          <ChevronDown
            aria-hidden="true"
            className={cn("size-4 transition-transform", expanded && "rotate-180")}
          />
        </button>
      ) : (
        <span className={mono}>até {formatUsd(estimate.totalUsd)}</span>
      );
    case "none":
      return (
        <span className="text-sm font-medium text-[var(--via-text-primary)]">
          Sem estimativa para este modelo
        </span>
      );
    case "pending":
      return <span className={cn(mono, "text-[var(--via-text-faint)]")}>—</span>;
    case "connect":
      return (
        <span className="text-sm font-medium text-[var(--via-text-primary)]">Sem estimativa</span>
      );
    case "error":
      return (
        <span className="text-sm font-medium text-[var(--via-text-primary)]">
          Não deu para calcular.
          {estimate.onRetry ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-1 text-sm"
              onClick={estimate.onRetry}
            >
              Tentar de novo
            </Button>
          ) : null}
        </span>
      );
  }
}

function DependsOn({ estimate }: { estimate: GateEstimateState }) {
  switch (estimate.kind) {
    case "loading":
      return <Skeleton className="mt-1 h-3 w-48" />;
    case "catalog":
      return <>{estimate.dependsOn}</>;
    case "server": {
      const scenes = estimate.perScene.length;
      const budget =
        estimate.budget && estimate.budget.capUsd > 0
          ? ` · ${formatUsd(estimate.budget.spentUsd)} gastos de ${formatUsd(estimate.budget.capUsd)} no mês`
          : "";
      return (
        <>
          {scenes} cena{scenes === 1 ? "" : "s"}
          {budget}
        </>
      );
    }
    case "none":
    case "pending":
      return <>{estimate.reason}</>;
    case "connect":
      return <>conecte o {INTEGRATION_BY_ID[estimate.integration].name} para calcular</>;
    case "error":
      return <>{humanizeError(estimate.error.message)}</>;
  }
}
