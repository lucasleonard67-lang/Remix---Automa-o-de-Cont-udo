// Dados das "Sugestões para hoje" de /criar (sem JSX): notícias novas do
// Radar + resumo do mercado → ideias ordenadas pela nota de viralização
// (src/lib/today-ideas.ts). Mesmo cache do Início.

import { useMemo } from "react";

import { useFreshRadarItems } from "@/hooks/use-dashboard-suggestions";
import { briefFromPost, useMarketSummary } from "@/hooks/use-market";
import { composeBrief, type RssItem } from "@/hooks/use-rss";
import { buildTodayIdeas, recommendedFormat, type TodayIdea } from "@/lib/today-ideas";

export const MAX_TODAY_IDEAS = 3;

export interface PickedIdea {
  idea: TodayIdea;
  /** Briefing pronto para o campo. */
  brief: string;
  /** Notícia do Radar por trás da ideia (marcada como usada ao Gerar). */
  news: RssItem | null;
}

export function useTodayIdeas() {
  const radar = useFreshRadarItems();
  const summary = useMarketSummary();
  const market = summary.data ?? null;

  const { ideas, byRadarId } = useMemo(() => {
    const rows = radar.data ?? [];
    const byId = new Map(rows.map((row) => [row.id, row as RssItem] as const));
    const list = buildTodayIdeas(
      rows.map((row) => ({
        id: row.id,
        title: row.title,
        virality: typeof row.virality === "number" ? row.virality : null,
        relevance: typeof row.relevance === "number" ? row.relevance : null,
        score_reason: typeof row.score_reason === "string" ? row.score_reason : null,
        feedName: row.rss_feeds?.name ?? null,
      })),
      market,
      MAX_TODAY_IDEAS,
    );
    return { ideas: list, byRadarId: byId };
  }, [radar.data, market]);

  const pick = (idea: TodayIdea): PickedIdea => {
    const news = idea.radarId ? (byRadarId.get(idea.radarId) ?? null) : null;
    const brief = news ? composeBrief(news) : idea.post ? briefFromPost(idea.post) : idea.title;
    return { idea, brief, news };
  };

  return {
    ideas,
    pick,
    /** Formato do seu melhor resultado (pré-marcado sem ideia escolhida). */
    recommended: recommendedFormat(market).format,
    isLoading: radar.isLoading || summary.isLoading,
  };
}
