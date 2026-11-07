import { describe, expect, it } from "vitest";

import { DEFAULT_ART, EIXOS_DE_ARTE, normalizeArt } from "@/lib/carousel-art";

describe("estrutura do carrossel", () => {
  it("kit antigo com outra composição cai no editorial", () => {
    const art = normalizeArt({
      layout: "collage",
      frame: "box",
      texture: "sunburst",
      wordplay: "chaos",
      shadow: "glow",
    });
    expect(art).toMatchObject({
      layout: "editorial",
      frame: "none",
      texture: "none",
      wordplay: "none",
      shadow: "none",
    });
  });

  it("a marca ainda escolhe o que não é estrutura", () => {
    expect(normalizeArt({ surface: "ink" }).surface).toBe("ink");
    expect(normalizeArt({ photo_grade: "mono" }).photo_grade).toBe("mono");
    expect(normalizeArt({}).surface).toBe(DEFAULT_ART.surface);
  });

  it("a tela não oferece eixo de estrutura", () => {
    const chaves = EIXOS_DE_ARTE.map((e) => e.chave as string);
    for (const chave of ["layout", "frame", "texture", "wordplay", "shadow"]) {
      expect(chaves).not.toContain(chave);
    }
  });
});
