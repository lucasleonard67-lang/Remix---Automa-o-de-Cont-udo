import { describe, expect, it } from "vitest";

import { connectorState } from "@/lib/mcp-connector-state";

const NOW = new Date("2026-10-30T12:00:00Z").getTime();

describe("connectorState", () => {
  it("sem acesso, desconectado", () => {
    expect(connectorState([], NOW).state).toBe("off");
  });

  it("acesso criado e nunca usado espera a instalação", () => {
    expect(connectorState([{ last_used_at: null }], NOW).state).toBe("waiting");
  });

  it("uso recente é ao vivo; antigo é só conectado", () => {
    expect(connectorState([{ last_used_at: "2026-10-30T11:55:00Z" }], NOW).state).toBe("live");
    expect(connectorState([{ last_used_at: "2026-10-29T11:55:00Z" }], NOW).state).toBe("on");
  });

  it("vale o uso mais recente entre os acessos", () => {
    const { lastUsed } = connectorState(
      [
        { last_used_at: "2026-10-28T10:00:00Z" },
        { last_used_at: "2026-10-29T10:00:00Z" },
        { last_used_at: null },
      ],
      NOW,
    );
    expect(lastUsed?.toISOString()).toBe("2026-10-29T10:00:00.000Z");
  });
});
