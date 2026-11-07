import type { CompetitorPostLite, MarketSummary, MarketTopPost } from "@/hooks/use-market";
import type { ChannelType } from "@/hooks/use-channels";

import { briefFromPost } from "@/hooks/use-market";
import {
  MEDIA_TYPE_LABELS,
  WEEKDAY_LABELS,
  bestPost,
  engagementOf,
  followerBalance,
  weekdayPhrase,
  type BestTimeSlot,
  type FollowerPoint,
  type MediaType,
  type ZernioPost,
} from "@/lib/zernio-analytics";

// ---------------------------------------------------------------------------
// Takeaways — "para fazer hoje": até 3 frases geradas dos próprios dados, cada
// uma com UMA ação (padrão Buffer: observação + sugestão + botão). Motor
// determinístico, sem IA e sem custo; cada regra só fala quando tem dado
// suficiente, e a ordem é a prioridade de quem cuida de redes: perda de
// seguidores → formato que rende → melhor horário → ritmo contra o concorrente
// → post do concorrente que viralizou → post antigo ainda líder.
// ---------------------------------------------------------------------------

export type TakeawayAction =
  | { kind: "create"; label: string; brief?: string; channel?: ChannelType }
  | { kind: "post"; label: string; post: ZernioPost };

export interface Takeaway {
  id: string;
  title: string;
  text: string;
  action: TakeawayAction;
}

export interface TakeawayInput {
  posts: ZernioPost[];
  followers: FollowerPoint[];
  bestTime: BestTimeSlot[];
  market: {
    posts: CompetitorPostLite[];
    summary: MarketSummary | null;
    days: number;
  } | null;
  /** dias do período (para posts por semana) */
  days: number;
  now?: Date;
}

const MAX_TAKEAWAYS = 3;
/** Queda num dia que vale aviso. */
const LOSS_ALERT = 3;
/** Posts por formato para comparar formatos. */
const MIN_PER_FORMAT = 2;
const FORMAT_RATIO = 1.5;
/** Nota de viralização a partir da qual o post do concorrente vira takeaway. */
const VIRAL_SCORE = 70;
/** Post ainda líder depois disto pede versão nova. */
const OLD_POST_DAYS = 28;

const FORMAT_CHANNEL: Partial<Record<MediaType, ChannelType>> = {
  video: "instagram_reel",
  carousel: "instagram_carousel",
  image: "instagram_post",
};

const FORMAT_PLURAL: Partial<Record<MediaType, string>> = {
  video: "Reels",
  carousel: "Carrosséis",
  image: "Posts de imagem",
  text: "Posts de texto",
};

export function takeaways(input: TakeawayInput): Takeaway[] {
  const out: Takeaway[] = [];
  const push = (t: Takeaway | null) => {
    if (t && out.length < MAX_TAKEAWAYS) out.push(t);
  };
  push(followerDrop(input));
  push(bestFormat(input));
  push(bestTimeTakeaway(input));
  push(cadence(input));
  push(competitorViral(input));
  push(oldLeader(input));
  return out;
}

// ── 1. Perda de seguidores num dia com post ──────────────────────────────────

function followerDrop({ posts, followers }: TakeawayInput): Takeaway | null {
  const balance = followerBalance(followers);
  let worst: { date: string; lost: number } | null = null;
  followers.forEach((p, i) => {
    const lost = p.lost ?? (balance[i] !== null && balance[i]! < 0 ? -balance[i]! : 0);
    if (lost >= LOSS_ALERT && (!worst || lost > worst.lost)) worst = { date: p.date, lost };
  });
  if (!worst) return null;
  const { date, lost } = worst as { date: string; lost: number };
  const post = posts.find((p) => p.date?.slice(0, 10) === date);
  const day = dayLabel(date);
  if (!post) return null;
  return {
    id: "follower-drop",
    title: `Você perdeu ${lost} seguidores ${day}`,
    text: `Foi o dia do post “${excerpt(post)}”. Vale olhar se o tema ou o tom destoou.`,
    action: { kind: "post", label: "Ver o post", post },
  };
}

// ── 2. Formato que mais rende ────────────────────────────────────────────────

function bestFormat({ posts }: TakeawayInput): Takeaway | null {
  const byFormat = new Map<MediaType, number[]>();
  for (const post of posts) {
    const e = engagementOf(post);
    if (e === null || post.mediaType === "unknown") continue;
    byFormat.set(post.mediaType, [...(byFormat.get(post.mediaType) ?? []), e]);
  }
  const ranked = [...byFormat.entries()]
    .filter(([, list]) => list.length >= MIN_PER_FORMAT)
    .map(([type, list]) => ({ type, avg: list.reduce((a, b) => a + b, 0) / list.length }))
    .sort((a, b) => b.avg - a.avg);
  if (ranked.length < 2) return null;
  const [top, second] = ranked;
  if (second.avg <= 0 || top.avg / second.avg < FORMAT_RATIO) return null;
  const ratio = (top.avg / second.avg).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  const channel = FORMAT_CHANNEL[top.type];
  return {
    id: "best-format",
    title: `${FORMAT_PLURAL[top.type] ?? MEDIA_TYPE_LABELS[top.type]} engajam ${ratio}× mais`,
    text: `Média de ${Math.round(top.avg)} interações contra ${Math.round(second.avg)} de ${(FORMAT_PLURAL[second.type] ?? MEDIA_TYPE_LABELS[second.type]).toLowerCase()}.`,
    action: {
      kind: "create",
      label: `Criar ${singular(top.type)}`,
      ...(channel ? { channel } : {}),
    },
  };
}

// ── 3. Melhor horário ────────────────────────────────────────────────────────

function bestTimeTakeaway({ bestTime }: TakeawayInput): Takeaway | null {
  const slot = bestTime.find((s) => s.hour !== null && s.score !== null);
  if (!slot || slot.hour === null) return null;
  const when = `${weekdayPhrase(slot.dayOfWeek)} às ${slot.hour}h`;
  return {
    id: "best-time",
    title: `Seu público engaja mais ${when}`,
    text: `Publicar nesse horário aproveita quando mais gente está vendo.`,
    action: { kind: "create", label: `Criar para ${WEEKDAY_LABELS[slot.dayOfWeek].toLowerCase()}` },
  };
}

// ── 4. Ritmo contra o concorrente ────────────────────────────────────────────

function cadence({ posts, market, days }: TakeawayInput): Takeaway | null {
  if (!market || !market.summary) return null;
  const weeks = Math.max(days / 7, 1);
  const mine = posts.length / weeks;
  const counts = new Map<string, number>();
  for (const p of market.posts) counts.set(p.competitor_id, (counts.get(p.competitor_id) ?? 0) + 1);
  let best: { handle: string; perWeek: number } | null = null;
  for (const c of market.summary.competitors) {
    const perWeek = (counts.get(c.id) ?? 0) / Math.max(market.days / 7, 1);
    if (!best || perWeek > best.perWeek) best = { handle: c.handle, perWeek };
  }
  if (!best || best.perWeek < mine * 2 || best.perWeek < 1) return null;
  const fmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  return {
    id: "cadence",
    title: `@${best.handle} publica ${fmt(best.perWeek)} vezes por semana; você, ${fmt(mine)}`,
    text: "Constância é o que mais pesa no alcance. Uma peça a mais por semana já muda a curva.",
    action: { kind: "create", label: "Criar para esta semana" },
  };
}

// ── 5. Post do concorrente que viralizou ─────────────────────────────────────

function competitorViral({ market }: TakeawayInput): Takeaway | null {
  const top = market?.summary?.top_posts.find(
    (p): p is MarketTopPost => p.virality !== null && p.virality >= VIRAL_SCORE,
  );
  if (!top) return null;
  return {
    id: "competitor-viral",
    title: `@${top.handle} está viralizando (${top.virality})`,
    text: `“${(top.caption ?? "").slice(0, 90)}${(top.caption ?? "").length > 90 ? "…" : ""}”`,
    action: { kind: "create", label: "Criar a minha versão", brief: briefFromPost(top) },
  };
}

// ── 6. Post antigo ainda líder ───────────────────────────────────────────────

function oldLeader({ posts, now = new Date() }: TakeawayInput): Takeaway | null {
  const best = bestPost(posts);
  if (!best?.date || (engagementOf(best) ?? 0) <= 0) return null;
  const age = Math.floor((now.getTime() - new Date(best.date).getTime()) / 86_400_000);
  if (age < OLD_POST_DAYS) return null;
  return {
    id: "old-leader",
    title: `Seu melhor post tem ${age} dias`,
    text: `“${excerpt(best)}” ainda é o que mais engaja. Uma versão nova do mesmo tema tende a repetir o resultado.`,
    action: { kind: "create", label: "Criar uma versão nova", brief: best.content.split("\n")[0] },
  };
}

// ── apoio ────────────────────────────────────────────────────────────────────

function excerpt(post: ZernioPost): string {
  const first = post.content.split("\n")[0].trim();
  return first.length > 60 ? `${first.slice(0, 57)}…` : first || "sem texto";
}

function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return `${weekdayPhrase(d.getDay())} (${d.getDate()}/${String(d.getMonth() + 1).padStart(2, "0")})`;
}

function singular(type: MediaType): string {
  switch (type) {
    case "video":
      return "um Reel";
    case "carousel":
      return "um carrossel";
    case "image":
      return "um post de imagem";
    default:
      return "um post";
  }
}
