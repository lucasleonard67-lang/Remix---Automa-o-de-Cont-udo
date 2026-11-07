// Regras dos campos de prompt, sem React.

import type { IntegrationId } from "@/lib/integrations";

/** Tipo do campo: decide como o "Melhorar prompt" escreve (edge prompt-assist). */
export type PromptKind = "content" | "video" | "scene" | "script" | "slide";

/** Regra da casa quando o modelo não tem preço cadastrado. */
export const NO_ESTIMATE = "Sem estimativa para este modelo";

/** A fala entra depois do que já está escrito, sem passar do limite do campo. */
export function appendSpoken(current: string, spoken: string, max?: number): string {
  const text = spoken.trim();
  const next = current.trim() ? `${current.trimEnd()} ${text}` : text;
  return max ? next.slice(0, max) : next;
}

const CONNECTABLE: readonly IntegrationId[] = ["elevenlabs", "openai", "xai"];

/** Integração que o erro do motor pede; null quando não é falta de conexão. */
export function integrationToConnect(details: unknown): IntegrationId | null {
  const id = (details as { integration?: unknown } | null | undefined)?.integration;
  return CONNECTABLE.includes(id as IntegrationId) ? (id as IntegrationId) : null;
}
