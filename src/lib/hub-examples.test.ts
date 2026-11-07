import { describe, expect, it } from "vitest";

import { HUB_ROUTES } from "@/lib/video-hub";

import { HUB_EXAMPLES, exampleCaption, exampleFor } from "./hub-examples";

const CDN: Record<string, RegExp> = {
  replicate: /^https:\/\/(tjzk\.)?replicate\.delivery\//,
  higgsfield: /^https:\/\/static\.higgsfield\.ai\//,
  heygen: /^https:\/\/dynamic\.heygen\.ai\//,
};
const PAGE: Record<string, RegExp> = {
  replicate: /^https:\/\/replicate\.com\/[\w-]+\/[\w.-]+$/,
  higgsfield: /^https:\/\/higgsfield\.ai\//,
  heygen: /^https:\/\/www\.heygen\.com/,
};

describe("HUB_EXAMPLES", () => {
  const entries = Object.entries(HUB_EXAMPLES);

  it("só vídeo hospedado pelo provedor, nunca da marca ou do nosso bucket", () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const [, example] of entries) {
      expect(example.video_url).toMatch(CDN[example.provider]);
      expect(example.video_url).toMatch(/\.mp4$/);
      if (example.poster_url) expect(example.poster_url).toMatch(CDN[example.provider]);
      expect(example.source_url).toMatch(PAGE[example.provider]);
      expect(example.model.trim()).not.toBe("");
    }
  });

  it("toda rota do hub tem exemplo", () => {
    for (const routes of Object.values(HUB_ROUTES))
      for (const route of routes) expect(exampleFor(route.experience)).not.toBeNull();
  });

  it("sem exemplo → null (a tela desenha o quadro neutro)", () => {
    expect(exampleFor("music")).toBeNull();
  });
});

describe("exampleCaption", () => {
  it("diz provedor e modelo", () => {
    expect(exampleCaption(HUB_EXAMPLES.scenes!)).toBe("Exemplo · Replicate · Kling 4.0");
    expect(exampleCaption(HUB_EXAMPLES.presenter_in_scenes!)).toBe(
      "Exemplo · Higgsfield · Seedance 2.5",
    );
  });
});
