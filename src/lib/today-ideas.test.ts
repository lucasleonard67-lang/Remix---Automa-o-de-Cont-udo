import { describe, expect, it } from "vitest";

import type { MarketSummary, MarketTopPost } from "@/hooks/use-market";
import { buildTodayIdeas, recommendedFormat, type RadarIdeaInput } from "@/lib/today-ideas";

const radar = (over: Partial<RadarIdeaInput>): RadarIdeaInput => ({
  id: "r1",
  title: "Notícia",
  virality: 50,
  relevance: 50,
  score_reason: null,
  feedName: "G1",
  ...over,
});

const post = (over: Partial<MarketTopPost>): MarketTopPost => ({
  id: "p1",
  handle: "rival",
  name: null,
  url: null,
  caption: "Legenda",
  media_type: "carousel",
  thumbnail_url: null,
  posted_at: null,
  likes: null,
  comments: null,
  views: null,
  engagement: 0.06,
  virality: 70,
  relevance: 40,
  topics: [],
  score_reason: null,
  angle: "O nosso ângulo",
  ...over,
});

const summary = (over: Partial<MarketSummary> = {}): MarketSummary => ({
  synced_at: "2026-10-30T00:00:00Z",
  competitors: [
    {
      id: "c1",
      handle: "rival",
      name: null,
      avatar_url: null,
      followers: 1000,
      posts: 10,
      avg_engagement: 0.02,
      last_sync_at: null,
      last_error: null,
    },
  ],
  top_posts: [],
  insights: [],
  vs_me: null,
  ...over,
});

describe("recommendedFormat", () => {
  it("prefere o melhor formato do perfil, depois o do mercado, depois carrossel", () => {
    const vs = {
      my_avg_engagement: null,
      market_avg_engagement: null,
      my_posts: 3,
    };
    expect(
      recommendedFormat(
        summary({ vs_me: { ...vs, my_best_format: "image", market_best_format: "reel" } }),
      ),
    ).toEqual({ format: "instagram_post", basis: "mine" });
    expect(
      recommendedFormat(
        summary({ vs_me: { ...vs, my_best_format: null, market_best_format: "reel" } }),
      ),
    ).toEqual({ format: "instagram_stories", basis: "market" });
    expect(recommendedFormat(null)).toEqual({ format: "instagram_carousel", basis: null });
  });
});

describe("buildTodayIdeas", () => {
  it("ordena Radar e mercado pela nota e corta no limite", () => {
    const ideas = buildTodayIdeas(
      [radar({ id: "a", virality: 90 }), radar({ id: "b", virality: 20 })],
      summary({ top_posts: [post({ id: "x", virality: 60 })] }),
      2,
    );
    expect(ideas.map((idea) => idea.id)).toEqual(["radar-a", "market-x"]);
  });

  it("post de concorrente sugere o formato que rendeu e explica pela média", () => {
    const [idea] = buildTodayIdeas([], summary({ top_posts: [post({ media_type: "reel" })] }));
    expect(idea.format).toBe("instagram_stories");
    expect(idea.why).toBe("Rendeu 3× a média de @rival.");
    expect(idea.title).toBe("O nosso ângulo");
  });

  it("ignora itens sem nota e usa o motivo do servidor quando existe", () => {
    const ideas = buildTodayIdeas(
      [radar({ id: "n", virality: null }), radar({ id: "s", score_reason: "Três fontes hoje." })],
      null,
    );
    expect(ideas).toHaveLength(1);
    expect(ideas[0].why).toBe("Três fontes hoje.");
    expect(ideas[0].format).toBe("instagram_carousel");
  });
});
