// Estado do conector de IA, sem React: o token vira uma frase que a pessoa entende.

const LIVE_MINUTES = 10;

export type ConnectorState = "off" | "waiting" | "on" | "live";

/** Os acessos de um Claude (claude.ai, Claude Code). */
export function acessosDoClaude<T extends { name?: string; revoked_at?: string | null }>(
  tokens: readonly T[],
): T[] {
  return tokens.filter((t) => !t.revoked_at);
}

export function connectorState(
  all: readonly { name?: string; last_used_at: string | null; revoked_at?: string | null }[],
  now = Date.now(),
): { state: ConnectorState; lastUsed: Date | null } {
  const tokens = acessosDoClaude(all);
  if (!tokens.length) return { state: "off", lastUsed: null };
  const times = tokens.flatMap((t) => (t.last_used_at ? [new Date(t.last_used_at).getTime()] : []));
  if (!times.length) return { state: "waiting", lastUsed: null };
  const last = Math.max(...times);
  return {
    state: now - last < LIVE_MINUTES * 60_000 ? "live" : "on",
    lastUsed: new Date(last),
  };
}

