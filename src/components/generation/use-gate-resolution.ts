import { useMemo } from "react";

import {
  allBlockedReason,
  estimateFromCatalog,
  rankOptions,
  resolveRanked,
  sceneSeconds,
  selectionFallbackReason,
  type GateEstimate,
  type GateOption,
  type GateSelection,
  type GateSignals,
  type RankRule,
  type RankedOption,
} from "@/lib/generation-gate";

export interface GateResolution {
  /** a lista, já ordenada pela regra */
  rows: RankedOption[];
  /** modelo principal em uso (null = lista vazia) */
  a: RankedOption | null;
  /** segundo modelo em "Comparar duas" */
  b: RankedOption | null;
  /** teto do que está marcado (A, ou A + B); null = sem base ainda (0 s / 0 letras) */
  estimate: GateEstimate | null;
  /** a escolha explícita deixou de aguentar a duração: motivo para a tela */
  fallbackReason: string | null;
  /** nenhuma linha aguenta a duração: o CTA desliga e a base explica */
  blockedReason: string | null;
}

/**
 * Ranking + seleção efetiva + teto, calculados UMA vez na tela e passados ao
 * <GenerationGate>: o que aparece no recibo é o que vai no payload.
 */
export function useGateResolution(
  options: GateOption[],
  selection: GateSelection,
  signals: GateSignals,
  compare: boolean,
  rule?: RankRule,
): GateResolution {
  return useMemo(() => {
    const rows = rankOptions(options, signals, rule);
    const { a, b } = resolveRanked(rows, selection, compare);
    const estimate = estimateFromCatalog(a?.option, b?.option, signals);
    const perScene = sceneSeconds(signals);
    const fallbackReason = selectionFallbackReason(rows, selection, perScene);
    const blockedReason = allBlockedReason(rows, perScene);
    return { rows, a, b, estimate, fallbackReason, blockedReason };
  }, [options, selection, signals, compare, rule]);
}
