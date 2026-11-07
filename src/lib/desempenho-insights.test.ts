import { describe, expect, it } from "vitest";

import {
  observedWeeks,
  bestPostInsight,
  consistency,
  formats,
  funnel,
  growth,
  marketPosition,
  nextMilestone,
  readiness,
  postDayLift,
  quality,
  timing,
} from "@/lib/desempenho-insights";
import {
  daysAgo,
  dedupeFollowerSeries,
  isoDate,
  type DailyPoint,
  type FollowerPoint,
  type ZernioPost,
} from "@/lib/zernio-analytics";

// Os mesmos dados de exemplo do canvas aprovado (versão 1): 30 dias até 4/nov.
const NOW = new Date(2026, 10, 4, 12, 0, 0);
const GAINED = [
  4, 5, 16, 3, 6, 4, 5, 18, 3, 7, 4, 3, 15, 5, 6, 4, 21, 3, 8, 5, 4, 46, 3, 6, 5, 4, 14, 3, 6, 5,
];
const LOST = [
  2, 1, 3, 2, 1, 4, 2, 1, 3, 2, 1, 2, 3, 1, 2, 4, 2, 1, 2, 3, 1, 2, 1, 3, 2, 1, 2, 3, 2, 1,
];
const POST_DAYS = [2, 7, 12, 16, 21, 26];

function followers(): FollowerPoint[] {
  const points: FollowerPoint[] = [];
  // 30 dias anteriores: 1.235 → 1.333 (+98)
  for (let i = 60; i >= 30; i--) {
    points.push({
      date: isoDate(daysAgo(i, NOW)),
      followers: 1235 + Math.round((98 * (60 - i)) / 30),
    });
  }
  let total = 1333;
  GAINED.forEach((g, k) => {
    total += g - LOST[k];
    points.push({
      date: isoDate(daysAgo(29 - k, NOW)),
      followers: total,
      gained: g,
      lost: LOST[k],
    });
  });
  return points;
}

function post(
  day: number,
  hour: number,
  mediaType: ZernioPost["mediaType"],
  reach: number,
  saves: number,
): ZernioPost {
  const d = daysAgo(29 - day, NOW);
  d.setHours(hour, 0, 0, 0);
  return {
    id: `p${day}`,
    date: d.toISOString(),
    mediaType,
    analytics: {
      reach,
      saves,
      likes: reach / 10,
      comments: 5,
      views: reach * 1.8,
      shares: 4,
      impressions: null,
      clicks: null,
      engagementRate: null,
      lastUpdated: null,
    },
  } as unknown as ZernioPost;
}

const POSTS = [
  post(2, 19, "carousel", 3600, 80),
  post(7, 13, "video", 10600, 90),
  post(12, 9, "image", 2400, 14),
  post(16, 19, "carousel", 4600, 95),
  post(21, 13, "video", 21400, 180),
  post(26, 9, "video", 7300, 60),
];

describe("conclusões do Desempenho", () => {
  it("crescimento: líquido, entradas, saídas e o marco de 2.000", () => {
    const g = growth(followers(), 30, NOW);
    expect(g).not.toBeNull();
    expect(g?.net).toBe(181);
    expect(g?.gained).toBe(241);
    expect(g?.lost).toBe(60);
    expect(g?.total).toBe(1514);
    expect(g?.milestone).toBe(2000);
    expect(isoDate(g?.milestoneDate as Date)).toBe("2027-01-24");
    expect(g?.vsPrevious).toBeCloseTo(181 / 98, 1);
  });

  it("crescimento sem leituras suficientes não afirma nada", () => {
    expect(growth([{ date: isoDate(NOW), followers: 68 }], 30, NOW)).toBeNull();
  });

  it("o próximo marco é redondo", () => {
    expect(nextMilestone(1514)).toBe(2000);
    expect(nextMilestone(68)).toBe(100);
    expect(nextMilestone(340)).toBe(400);
  });

  it("dia com post traz 4,7× mais seguidores", () => {
    const lift = postDayLift(followers(), POSTS, 30, NOW);
    expect(lift?.ratio).toBeCloseTo(4.7, 1);
    expect(Math.round(lift?.extra ?? 0)).toBe(17);
  });

  it("formato: vídeo alcança mais e o carrossel é o mais salvo", () => {
    const f = formats(POSTS);
    expect(f?.rows[0].name).toBe("Vídeo");
    expect(f?.reachRatio).toBeCloseTo(13100 / 4100, 1);
    expect(f?.mostSaved?.name).toBe("Carrossel");
  });

  it("funil: de cada 100 que interagem, 4 seguem", () => {
    const daily: DailyPoint[] = [
      {
        date: isoDate(daysAgo(3, NOW)),
        reach: 52700,
        likes: 3780,
        comments: 400,
        saves: 1160,
        shares: 760,
        views: null,
        impressions: null,
        clicks: null,
      },
    ];
    const f = funnel(daily, 241, 30, NOW);
    expect(Math.round(f?.followPer100 ?? 0)).toBe(4);
    expect(f?.interactRate).toBeCloseTo(6100 / 52700, 3);
  });

  it("qualidade: 31% das interações são salvar ou compartilhar", () => {
    const daily: DailyPoint[] = [
      {
        date: isoDate(daysAgo(3, NOW)),
        reach: 52700,
        likes: 3780,
        comments: 400,
        saves: 1160,
        shares: 760,
        views: null,
        impressions: null,
        clicks: null,
      },
    ];
    expect(Math.round((quality(daily, 30, NOW)?.keepShare ?? 0) * 100)).toBe(31);
  });

  it("horário: a melhor faixa e quantos dos melhores posts saíram lá", () => {
    const slots = [
      { dayOfWeek: 2, hour: 13, score: 210, postCount: 2 },
      { dayOfWeek: 4, hour: 19, score: 90, postCount: 2 },
      { dayOfWeek: 0, hour: 9, score: 60, postCount: 2 },
      { dayOfWeek: 1, hour: 10, score: 40, postCount: 1 },
    ];
    const t = timing(slots, POSTS);
    expect(t?.best.dayOfWeek).toBe(2);
    expect(t?.best.block).toBe(4);
    expect(t?.topPostsInBest).toBe(2);
  });

  it("melhor post: 2,6× a média dos outros", () => {
    const b = bestPostInsight(POSTS, followers(), NOW);
    expect(b?.post.id).toBe("p21");
    expect(b?.followersThatDay).toBe(46);
    expect(b?.ratio).toBeGreaterThan(2.5);
  });

  it("constância: semanas com 2 posts crescem mais", () => {
    const c = consistency(followers(), POSTS, 30, NOW);
    expect(c?.weeks.length).toBe(4);
    expect(c?.ratio).toBeGreaterThan(1);
  });

  it("mercado: sem resumo do Apify não compara", () => {
    expect(marketPosition(POSTS, followers(), null, 30)).toBeNull();
  });

  it("a mesma conta autorizada duas vezes conta uma vez só (34, não 68)", () => {
    const pts = [{ date: isoDate(NOW), followers: 34 }];
    const series = [
      { accountId: "a", platform: "instagram", username: "meuqueridopetshop", points: pts },
      { accountId: "b", platform: "instagram", username: "MeuQueridoPetshop", points: pts },
    ];
    expect(dedupeFollowerSeries(series)).toHaveLength(1);
  });

  it("sem 14 dias de leitura e 3 posts com métrica, o BI não afirma", () => {
    const pouco = followers().slice(-6);
    expect(readiness(pouco, POSTS.slice(0, 2), NOW)).toEqual({
      ready: false,
      readingDays: 6,
      postsWithMetrics: 2,
    });
    expect(readiness(followers(), POSTS, NOW).ready).toBe(true);
  });
});

describe("observedWeeks", () => {
  const at = (daysBack: number) => ({
    posted_at: new Date(NOW.getTime() - daysBack * 86_400_000).toISOString(),
  });
  it("usa o período inteiro quando a leitura não bateu o limite de 12 posts", () => {
    expect(observedWeeks([at(2), at(20)], 90, NOW)).toBeCloseTo(90 / 7);
  });
  it("com 12+ posts mede do mais antigo até hoje, sem diluir em 90 dias", () => {
    const own = Array.from({ length: 17 }, (_, i) => at(2 * i + 1)); // mais antigo: 33 dias
    expect(observedWeeks(own, 90, NOW)).toBeCloseTo(33 / 7);
    expect(17 / observedWeeks(own, 90, NOW)).toBeGreaterThan(3.5);
  });
  it("nunca passa do período nem fica abaixo de 1 semana", () => {
    const old = Array.from({ length: 12 }, (_, i) => at(10 + i * 10));
    expect(observedWeeks(old, 30, NOW)).toBeCloseTo(30 / 7);
    const burst = Array.from({ length: 12 }, () => at(1));
    expect(observedWeeks(burst, 30, NOW)).toBe(1);
  });
});
