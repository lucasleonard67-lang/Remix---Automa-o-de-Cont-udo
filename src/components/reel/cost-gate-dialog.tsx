import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { BrandIcon } from "@/components/brand-icon";
import { GateEstimateLine } from "@/components/generation/gate-estimate-line";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { OverBudgetAlert } from "@/components/reel/over-budget-alert";
import { reelEstimateState } from "@/components/reel/reel-estimate";
import type { VideoEstimate } from "@/hooks/use-video-project";
import { openIntegration } from "@/lib/integration-modal";
import { INTEGRATION_BY_ID } from "@/lib/integrations";

// ---------------------------------------------------------------------------
// O portão de custo: nenhum dólar sai sem um número na tela antes do clique
// (docs/11 §0, regra 5). Mesmo diálogo para os dois portões — só muda o texto
// e a fase da estimativa.
// ---------------------------------------------------------------------------

export interface CostGateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  pending?: boolean;
  estimate: VideoEstimate | undefined;
  loading?: boolean;
  error?: Error | null;
}

export function CostGateDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  pending,
  estimate,
  loading,
  error,
}: CostGateDialogProps) {
  const gateEstimate = reelEstimateState({
    data: estimate,
    isLoading: Boolean(loading),
    error: error ?? null,
  });
  // Nenhum dólar sem número na tela: só "server" libera o confirmar.
  const blocked = gateEstimate.kind !== "server";
  const needsConnect = gateEstimate.kind === "connect" ? gateEstimate.integration : null;
  const total = estimate?.estimate.total_usd ?? 0;
  const spent = estimate?.budget.month_spent_usd ?? 0;
  const cap = estimate?.budget.monthly_cap_usd ?? 0;
  const overBudget = cap > 0 && spent + total > cap;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-1 text-sm text-muted-foreground">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* A estimativa é a linha final do recibo: mesma linha do portão, sem caixa em volta. */}
        <div className="space-y-4 border-t border-[var(--via-border)] pt-4">
          <GateEstimateLine estimate={gateEstimate} action={null} showBudget={false} />
          {overBudget ? <OverBudgetAlert cap={cap} afterSpend={spent + total} /> : null}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          {needsConnect ? (
            <AlertDialogAction onClick={() => openIntegration(needsConnect)}>
              <BrandIcon name={INTEGRATION_BY_ID[needsConnect].brand} />
              Conectar {INTEGRATION_BY_ID[needsConnect].name}
            </AlertDialogAction>
          ) : (
            <AlertDialogAction
              onClick={(event) => {
                // O diálogo fecha por conta própria; a mutation reporta por toast.
                event.preventDefault();
                onConfirm();
              }}
              disabled={pending || blocked}
            >
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {confirmLabel}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
