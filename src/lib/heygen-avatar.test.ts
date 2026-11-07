import { describe, expect, it } from "vitest";

import { avatarBuildState, avatarCreateCostLabel, PRICE_TBD } from "@/lib/heygen-avatar";

describe("avatarCreateCostLabel", () => {
  it("nunca mostra número sem preço conferido", () => {
    expect(avatarCreateCostLabel(undefined)).toBe(PRICE_TBD);
    expect(avatarCreateCostLabel({ cost: { usd: 1, verified: false } })).toBe(PRICE_TBD);
    expect(avatarCreateCostLabel({ cost: { usd: 1 } })).toBe(PRICE_TBD);
  });
  it("nunca diz grátis", () => {
    expect(avatarCreateCostLabel({ cost: { usd: 0, verified: true } })).toBe(PRICE_TBD);
  });
  it("mostra o preço conferido", () => {
    expect(avatarCreateCostLabel({ cost: { usd: 2, verified: true } })).toMatch(/por avatar$/);
  });
});

describe("avatarBuildState", () => {
  const base = { ready: false, status: "processing", error: null, consent_status: null } as const;
  it("foto e descrição: criando, pronto, falhou com motivo", () => {
    expect(avatarBuildState({ ...base, type: "prompt" }).kind).toBe("creating");
    expect(avatarBuildState({ ...base, type: "photo", ready: true }).text).toBe("Pronto");
    expect(
      avatarBuildState({ ...base, type: "photo", status: "failed", error: "Sem créditos." }).text,
    ).toBe("Falhou: Sem créditos.");
  });
  it("twin: o pronto vem de ready, não do consentimento cru", () => {
    expect(
      avatarBuildState({
        ...base,
        type: "digital_twin",
        status: "completed",
        consent_status: "accepted",
      }).kind,
    ).toBe("consent");
    expect(avatarBuildState({ ...base, type: "digital_twin", ready: true }).kind).toBe("ready");
    expect(
      avatarBuildState({ ...base, type: "digital_twin", consent_status: "rejected" }).kind,
    ).toBe("failed");
  });
});
