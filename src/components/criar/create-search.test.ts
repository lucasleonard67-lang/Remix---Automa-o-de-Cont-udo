import { describe, expect, it } from "vitest";

import { validateCreateSearch } from "@/components/criar/create-search";

describe("validateCreateSearch", () => {
  it("marca os links antigos de vídeo e não os trata como formato", () => {
    expect(validateCreateSearch({ kind: "video", brief: "tema" })).toEqual({
      brief: "tema",
      video: true,
    });
    expect(validateCreateSearch({ channel: "instagram_reel" })).toEqual({ video: true });
  });

  it("mantém o marcador no redirect da home para /criar", () => {
    expect(validateCreateSearch({ video: true })).toEqual({ video: true });
  });

  it("deixa os formatos estáticos como estavam", () => {
    expect(validateCreateSearch({ kind: "image", channel: "instagram_carousel" })).toEqual({
      kind: "image",
      channel: "instagram_carousel",
    });
  });
});
