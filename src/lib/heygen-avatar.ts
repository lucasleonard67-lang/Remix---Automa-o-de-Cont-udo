import type { HeygenRef } from "@/hooks/use-heygen-studio";
import { formatUsd } from "@/lib/format-usd";

// ---------------------------------------------------------------------------
// Regras puras do construtor de avatar (docs/hub-motor-contratos.md §8).
// ---------------------------------------------------------------------------

export const PRICE_TBD = "preço a confirmar";

/**
 * Custo de uma linha `avatar_create` do catálogo. Sem linha, sem número,
 * zero ou `cost.verified` diferente de true → "preço a confirmar"; nunca "grátis".
 */
export function avatarCreateCostLabel(row: { cost: unknown } | undefined): string {
  const cost = (row?.cost ?? {}) as { usd?: unknown; verified?: unknown };
  if (!row || cost.verified !== true || typeof cost.usd !== "number" || !(cost.usd > 0))
    return PRICE_TBD;
  return `${formatUsd(cost.usd)} por avatar`;
}

export type AvatarBuildState =
  | { kind: "creating"; text: string }
  | { kind: "consent"; text: string }
  | { kind: "ready"; text: string }
  | { kind: "failed"; text: string };

/**
 * O que a tela diz do avatar. O pronto vem de `ready` (no twin ele já inclui
 * o consentimento); o valor cru do consentimento só separa a recusa.
 */
export function avatarBuildState(
  ref: Pick<HeygenRef, "ready" | "status" | "error" | "type" | "consent_status">,
): AvatarBuildState {
  if (ref.ready) return { kind: "ready", text: "Pronto" };
  if (ref.status === "failed")
    return {
      kind: "failed",
      text: `Falhou: ${ref.error ?? "a HeyGen não conseguiu criar o avatar."}`,
    };
  if (ref.type === "digital_twin") {
    if (ref.consent_status === "rejected")
      return {
        kind: "failed",
        text: "Falhou: a autorização foi recusada. Gere um novo link e grave de novo.",
      };
    return { kind: "consent", text: "Aguardando seu consentimento" };
  }
  return { kind: "creating", text: "Criando…" };
}
