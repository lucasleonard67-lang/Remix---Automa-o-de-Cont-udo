// "Sugestões para hoje" de /criar — sem IA no cliente: junta o que o servidor
// já pontuou e ordena pela nota de viralização (0–100).
//   · Radar (rss_items): notícia nova ainda não usada, nota `virality` do
//     fetch-rss; empate pela `relevance` (casa com a marca).
//   · Mercado (app_settings.market.top_posts): post de concorrente que rendeu,
//     nota `virality` do competitor-sync.
// O formato sugerido vem dos resultados: o post de concorrente sugere o
// formato que rendeu para ele; a notícia sugere o melhor formato DO SEU
// perfil (vs_me.my_best_format), senão o do mercado, senão o carrossel.

import type { ChannelType } from "@/hooks/use-channels";
import type { MarketFormat, MarketSummary, MarketTopPost } from "@/hooks/use-market";

export interface RadarIdeaInput {
  id: string;
  title: string;
  virality: number | null;
  relevance: number | null;
  score_reason: string | null;
  feedName: string | null;
}

export interface TodayIdea {
  id: string;
  kind: "radar" | "competitor";
  /** De onde veio: nome do feed ou @perfil. */
  origin: string;
  /** A frase da ideia, curta. */
  title: string;
  /** 0–100. */
  score: number;
  /** Formato estático sugerido (um canal). */
  format: ChannelType;
  /** Por que, em uma linha. */
  why: string;
  /** Id do item do Radar (para marcar como usado); só no Radar. */
  radarId?: string;
  /** Post do mercado que originou (para compor o briefing). */
  post?: MarketTopPost;
}

/** Estático equivalente ao formato que rendeu (Reel → Stories: vertical em sequência). */
export const STATIC_OF_MARKET: Record<MarketFormat, ChannelType> = {
  image: "instagram_post",
  carousel: "instagram_carousel",
  reel: "instagram_stories",
};

const FORMAT_WORD: Record<MarketFormat, string> = {
  image: "post",
  carousel: "carrossel",
  reel: "vídeo vertical",
};

/** Formato do SEU melhor resultado; senão o do mercado; senão carrossel. */
export function recommendedFormat(summary: MarketSummary | null): {
  format: ChannelType;
  basis: "mine" | "market" | null;
} {
  const mine = summary?.vs_me?.my_best_format ?? null;
  if (mine) return { format: STATIC_OF_MARKET[mine], basis: "mine" };
  const market = summary?.vs_me?.market_best_format ?? null;
  if (market) return { format: STATIC_OF_MARKET[market], basis: "market" };
  return { format: "instagram_carousel", basis: null };
}

function oneLine(text: string, max = 90): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function buildTodayIdeas(
  radar: readonly RadarIdeaInput[],
  summary: MarketSummary | null,
  limit = 3,
): TodayIdea[] {
  const rec = recommendedFormat(summary);
  const mineWord = summary?.vs_me?.my_best_format
    ? FORMAT_WORD[summary.vs_me.my_best_format]
    : null;

  const fromRadar = radar
    .filter((item) => item.virality !== null)
    .map((item): TodayIdea & { tie: number } => ({
      id: `radar-${item.id}`,
      kind: "radar",
      origin: item.feedName ?? "Radar",
      title: oneLine(item.title, 120),
      score: clampScore(item.virality ?? 0),
      format: rec.format,
      why: item.score_reason
        ? oneLine(item.score_reason)
        : rec.basis === "mine" && mineWord
          ? `Assunto em alta; ${mineWord} é o que mais rende no seu perfil.`
          : "Assunto em alta nas últimas 48 h.",
      radarId: item.id,
      tie: item.relevance ?? 0,
    }));

  const avgByHandle = new Map(
    (summary?.competitors ?? []).map((c) => [c.handle, c.avg_engagement] as const),
  );
  const fromMarket = (summary?.top_posts ?? [])
    .filter((post) => post.virality !== null)
    .map((post): TodayIdea & { tie: number } => {
      const avg = avgByHandle.get(post.handle) ?? null;
      const ratio = post.engagement !== null && avg ? post.engagement / avg : null;
      const format = post.media_type ? STATIC_OF_MARKET[post.media_type] : rec.format;
      return {
        id: `market-${post.id}`,
        kind: "competitor",
        origin: `@${post.handle}`,
        title: oneLine(post.angle ?? post.caption ?? "", 120),
        score: clampScore(post.virality ?? 0),
        format,
        why: post.score_reason
          ? oneLine(post.score_reason)
          : ratio !== null && ratio >= 1.2
            ? `Rendeu ${ratio.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}× a média de @${post.handle}.`
            : `Post que rendeu em @${post.handle}.`,
        post,
        tie: post.relevance ?? 0,
      };
    })
    .filter((idea) => idea.title);

  return [...fromRadar, ...fromMarket]
    .sort((a, b) => b.score - a.score || b.tie - a.tie)
    .slice(0, limit)
    .map(({ tie: _tie, ...idea }) => idea);
}
