import { describe, expect, it } from "vitest";

import { appendSpoken, integrationToConnect } from "@/lib/prompt-assist";

describe("appendSpoken", () => {
  it("cai no campo vazio", () => {
    expect(appendSpoken("  ", " oi ")).toBe("oi");
  });

  it("continua o que já estava escrito", () => {
    expect(appendSpoken("tema: ", "retrabalho")).toBe("tema: retrabalho");
  });

  it("respeita o limite do campo", () => {
    expect(appendSpoken("abc", "defgh", 6)).toBe("abc de");
  });
});

describe("integrationToConnect", () => {
  it("lê a integração do erro do motor", () => {
    expect(integrationToConnect({ integration: "elevenlabs" })).toBe("elevenlabs");
  });

  it("ignora o que não se conecta por aqui", () => {
    expect(integrationToConnect({ integration: "lovable-gateway" })).toBeNull();
    expect(integrationToConnect(null)).toBeNull();
  });
});
