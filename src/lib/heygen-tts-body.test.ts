import { describe, expect, it } from "vitest";

import { buildHeygenTtsBody } from "../../supabase/functions/_shared/voices";

describe("buildHeygenTtsBody", () => {
  it("clone instantâneo sai com expressiveness_boost 0.5 e só campos do contrato", () => {
    const body = buildHeygenTtsBody({ text: "Olá", voiceId: "V" });
    expect(body.expressiveness_boost).toBe(0.5);
    expect(Object.keys(body).sort()).toEqual(
      ["expressiveness_boost", "language", "model", "output_format", "text", "voice_id"].sort(),
    );
  });

  it("corta o texto no limite da API", () => {
    expect(
      (buildHeygenTtsBody({ text: "x".repeat(6000), voiceId: "V" }).text as string).length,
    ).toBe(5000);
  });
});
