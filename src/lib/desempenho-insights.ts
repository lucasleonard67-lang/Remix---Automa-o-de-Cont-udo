import type { CompetitorPostLite, MarketSummary } from "@/hooks/use-market";
import {
  daysAgo,
  engagementRate,
  followersAt,
  isoDate,
  periodDelta,
  type BestTimeSlot,
  type DailyPoint,
  type FollowerPoint,
  type MediaType,
  type ZernioPost,
} from "@/lib/zernio-analytics";

// ---------------------------------------------------------------------------
// Conclusões do Desempenho (BI). Cada função transforma dado em uma frase que
// a pessoa entende e usa: "dia com post traz 4,7× mais seguidores", não
// "média de ganhos por dia". Puras e testáveis; null quando o dado não basta
// para afirmar nada — o card some, nunca mostra número inventado.
// ---------------------------------------------------------------------------

export interface MarketInput {
  summary: MarketSummary | null;
  posts: CompetitorPostLite[];
  days: number;
}

/** "4,7×" · "1,4" · "13,6%" */
export const fmt1 = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
export const fmtX = (v: number) => `${fmt1(v)}×`;
/** Ritmo semanal: abaixo de 0,05 o "0" esconderia que houve publicação. */
export const fmtPace = (v: number) => (v > 0 && v < 0.05 ? "menos de 0,1" : fmt1(v));
export const fmtPct1 = (fraction: number) => {
  const pct = fraction * 100;
  // abaixo de 1% a casa decimal some ("0,1%" e "0,1%" pareciam iguais)
  return `${pct.toLocaleString("pt-BR", { maximumFractionDigits: pct < 1 ? 2 : 1 })}%`;
};

// ── Prontidão: só afirma com base ───────────────────────────────────────────

export const MIN_READING_DAYS = 14;
export const MIN_POSTS = 3;

export interface Readiness {
  ready: boolean;
  readingDays: number;
  postsWithMetrics: number;
}

/** O BI só tira conclusão com 14 dias de leitura e 3 publicações com métricas. */
export function readiness(
  points: FollowerPoint[],
  posts: ZernioPost[],
  now = new Date(),
): Readiness {
  const first = points[0]?.date ?? null;
  const readingDays = first
    ? Math.round(
        (new Date(`${isoDate(now)}T12:00:00`).getTime() - new Date(`${first}T12:00:00`).getTime()) /
          86_400_000,
      ) + 1
    : 0;
  const postsWithMetrics = posts.filter((p) => p.analytics.reach !== null).length;
  return {
    ready: readingDays >= MIN_READING_DAYS && postsWithMetrics >= MIN_POSTS,
    readingDays,
    postsWithMetrics,
  };
}

/** Posts que a leitura do concorrente guarda por perfil (competitor-sync). */
export const COMPETITOR_POSTS_PER_READ = 12;

/**
 * Semanas observadas de um concorrente. A leitura traz os últimos 12 posts: com
 * 12 ou mais no período, os mais antigos podem ter ficado de fora, então mede do
 * post mais antigo até hoje (senão um período longo dilui o ritmo real).
 */
export function observedWeeks(
  own: Array<{ posted_at: string | null }>,
  days: number,
  now = new Date(),
): number {
  const full = Math.max(days / 7, 1);
  if (own.length < COMPETITOR_POSTS_PER_READ) return full;
  const oldest = own
    .map((p) => (p.posted_at ? new Date(p.posted_at).getTime() : NaN))
    .filter((t) => Number.isFinite(t))
    .reduce((a, b) => Math.min(a, b), Infinity);
  if (!Number.isFinite(oldest)) return full;
  return Math.min(full, Math.max((now.getTime() - oldest) / (7 * 86_400_000), 1));
}

/** Publicações por semana: a sua e a do concorrente que mais publica (conta, não taxa). */
export function cadence(
  posts: ZernioPost[],
  market: MarketInput | null,
  days: number,
  now = new Date(),
) {
  const mine = posts.length / Math.max(days / 7, 1);
  if (!market?.summary) return { mine, leader: null, competitors: [] };
  const competitors = market.summary.competitors
    .map((c) => {
      const own = market.posts.filter((p) => p.competitor_id === c.id);
      return { handle: c.handle, perWeek: own.length / observedWeeks(own, market.days, now) };
    })
    .sort((a, b) => b.perWeek - a.perWeek);
  const leader = competitors[0];
  return { mine, leader: leader && leader.perWeek > 0 ? leader : null, competitors };
}

const localDay = (iso: string): string => isoDate(new Date(iso));

/** Seguidores no fim de cada dia, de `from` até hoje (repete o último conhecido). */
function followersByDay(points: FollowerPoint[], days: number, now: Date): Array<number | null> {
  const out: Array<number | null> = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = isoDate(daysAgo(i, now));
    out.push(points.length && points[0].date <= key ? followersAt(points, key) : null);
  }
  return out;
}

// ── Crescimento ─────────────────────────────────────────────────────────────

export interface Growth {
  total: number;
  start: number;
  net: number;
  gained: number | null;
  lost: number | null;
  /** fração (0,136 = 13,6%) */
  pct: number;
  /** quantas vezes o crescimento do período anterior; null sem comparação */
  vsPrevious: number | null;
  milestone: number | null;
  /** data em que passa do marco no ritmo atual */
  milestoneDate: Date | null;
  /** dias realmente medidos (o histórico pode ser mais curto que o período) */
  days: number;
  /** seguidores por dia do período, do mais antigo para hoje */
  series: Array<number | null>;
  previousSeries: Array<number | null>;
}

export function nextMilestone(total: number): number {
  const step = total >= 1000 ? 1000 : total >= 100 ? 100 : 50;
  return Math.floor(total / step) * step + step;
}

export function growth(points: FollowerPoint[], days: number, now = new Date()): Growth | null {
  const series = followersByDay(points, days, now);
  const total = points.at(-1)?.followers ?? null;
  if (total === null || points.length < 2) return null;
  // Histórico mais curto que o período: mede desde a primeira leitura.
  const periodStartKey = isoDate(daysAgo(days, now));
  const startKey = points[0].date > periodStartKey ? points[0].date : periodStartKey;
  const covered = Math.round(
    (new Date(`${isoDate(now)}T12:00:00`).getTime() - new Date(`${startKey}T12:00:00`).getTime()) /
      86_400_000,
  );
  if (covered < 3) return null;
  const start = followersAt(points, startKey);
  if (start === null) return null;
  const net = total - start;
  const inPeriod = points.filter((p) => p.date > startKey);
  const hasMoves = inPeriod.some((p) => typeof p.gained === "number");
  const gained = hasMoves ? inPeriod.reduce((a, p) => a + (p.gained ?? 0), 0) : null;
  const lost = hasMoves ? inPeriod.reduce((a, p) => a + (p.lost ?? 0), 0) : null;
  // a busca cobre 2×dias − 1 (hoje incluso): o período anterior começa ali
  const prevStartKey = isoDate(daysAgo(days * 2 - 1, now));
  const prevStart = points[0].date <= prevStartKey ? followersAt(points, prevStartKey) : null;
  const prevNet = prevStart !== null ? start - prevStart : null;
  // compara a média por dia: os dois períodos podem ter um dia de diferença
  const prevDays = days - 1;
  const vsPrevious =
    prevNet !== null && prevNet > 0 && net > 0 ? net / covered / (prevNet / prevDays) : null;
  const perDay = net / covered;
  const milestone = nextMilestone(total);
  const daysTo = perDay > 0 ? Math.ceil((milestone - total) / perDay) : null;
  const milestoneDate = daysTo !== null && daysTo <= 365 ? daysAgo(-daysTo, now) : null;
  const previousSeries =
    prevStart !== null ? followersByDay(points, days * 2, now).slice(0, days) : [];
  return {
    total,
    start,
    net,
    gained,
    lost,
    pct: start > 0 ? net / start : 0,
    vsPrevious,
    milestone: milestoneDate ? milestone : null,
    milestoneDate,
    // dias com leitura (o da primeira conta), nunca além do período
    days: Math.min(covered + 1, days),
    series,
    previousSeries,
  };
}

// ── Publicar traz seguidores ────────────────────────────────────────────────

export interface PostDayLift {
  withPost: number;
  withoutPost: number;
  ratio: number;
  /** seguidores a mais por dia de publicação */
  extra: number;
}

/** Novos seguidores por dia: o `gained` da leitura, ou a diferença entre os dias. */
function gainedByDay(points: FollowerPoint[], days: number, now: Date): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const key = isoDate(daysAgo(i, now));
    const point = points.find((p) => p.date === key);
    if (point && typeof point.gained === "number") {
      out.set(key, point.gained);
      continue;
    }
    const today = followersAt(points, key);
    const before = followersAt(points, isoDate(daysAgo(i + 1, now)));
    if (point && today !== null && before !== null) out.set(key, Math.max(0, today - before));
  }
  return out;
}

export function postDayLift(
  points: FollowerPoint[],
  posts: ZernioPost[],
  days: number,
  now = new Date(),
): PostDayLift | null {
  const byDay = gainedByDay(points, days, now);
  const postDays = new Set(posts.filter((p) => p.date).map((p) => localDay(p.date as string)));
  const withPost: number[] = [];
  const without: number[] = [];
  for (const [day, value] of byDay) (postDays.has(day) ? withPost : without).push(value);
  if (withPost.length < 2 || without.length < 5) return null;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const a = avg(withPost);
  const b = avg(without);
  if (a <= b || b <= 0) return null;
  return { withPost: a, withoutPost: b, ratio: a / b, extra: a - b };
}

// ── Alcance contra a base ───────────────────────────────────────────────────

export function reachMultiple(
  daily: DailyPoint[],
  followers: number | null,
  days: number,
  now = new Date(),
) {
  const reach = periodDelta(daily, "reach", days, now);
  if (reach.current === null || !followers) return null;
  return { reach: reach.current, multiple: reach.current / followers, delta: reach.delta };
}

// ── Engajamento contra o mercado ────────────────────────────────────────────

export interface MarketPosition {
  mine: number;
  market: number;
  ratio: number;
  competitors: Array<{ handle: string; rate: number; perWeek: number }>;
  minePerWeek: number;
}

export function marketPosition(
  posts: ZernioPost[],
  followers: FollowerPoint[],
  market: MarketInput | null,
  days: number,
): MarketPosition | null {
  if (!market?.summary) return null;
  const rates = posts
    .filter((p) => p.date)
    .map((p) => engagementRate(p, followersAt(followers, localDay(p.date as string))))
    .filter((v): v is number => v !== null);
  if (rates.length < MIN_POSTS) return null;
  const mine = rates.reduce((a, b) => a + b, 0) / rates.length;
  if (mine <= 0) return null;
  const competitors = market.summary.competitors
    .map((c) => {
      const own = market.posts.filter((p) => p.competitor_id === c.id);
      const eng = own.map((p) => p.engagement).filter((v): v is number => v !== null);
      const rate = eng.length ? eng.reduce((a, b) => a + b, 0) / eng.length : c.avg_engagement;
      return {
        handle: c.handle,
        rate: rate ?? NaN,
        perWeek: own.length / observedWeeks(own, market.days),
      };
    })
    .filter((c) => Number.isFinite(c.rate));
  const marketAvg =
    market.summary.vs_me?.market_avg_engagement ??
    (competitors.length ? competitors.reduce((a, c) => a + c.rate, 0) / competitors.length : null);
  if (marketAvg === null || marketAvg <= 0) return null;
  return {
    mine,
    market: marketAvg,
    ratio: mine / marketAvg,
    competitors,
    minePerWeek: posts.length / Math.max(days / 7, 1),
  };
}

// ── Funil: alcance → interação → seguidor ───────────────────────────────────

export interface Funnel {
  reach: number;
  interactions: number;
  followers: number;
  /** fração dos alcançados que interagiram */
  interactRate: number;
  /** a cada 100 que interagem, quantos seguem */
  followPer100: number;
}

export function funnel(
  daily: DailyPoint[],
  gained: number | null,
  days: number,
  now = new Date(),
): Funnel | null {
  const reach = periodDelta(daily, "reach", days, now).current;
  const interactions = periodDelta(daily, "interactions", days, now).current;
  if (!reach || !interactions || gained === null || gained <= 0) return null;
  return {
    reach,
    interactions,
    followers: gained,
    interactRate: interactions / reach,
    followPer100: (gained / interactions) * 100,
  };
}

// ── Formato ─────────────────────────────────────────────────────────────────

export const FORMAT_NAMES: Record<MediaType, string> = {
  video: "Vídeo",
  carousel: "Carrossel",
  image: "Post",
  text: "Texto",
  document: "Documento",
  gif: "GIF",
  unknown: "Outro",
};

export interface FormatRow {
  type: MediaType;
  name: string;
  posts: number;
  avgReach: number;
  /** salvamentos por mil pessoas alcançadas */
  savesPer1k: number | null;
}

export interface Formats {
  rows: FormatRow[];
  /** quantas vezes o 1º alcança o 2º */
  reachRatio: number;
  mostSaved: { name: string; ratio: number } | null;
}

export function formats(posts: ZernioPost[]): Formats | null {
  const groups = new Map<MediaType, ZernioPost[]>();
  for (const p of posts) {
    if (p.mediaType === "unknown" || p.analytics.reach === null) continue;
    groups.set(p.mediaType, [...(groups.get(p.mediaType) ?? []), p]);
  }
  const rows: FormatRow[] = [...groups].map(([type, list]) => {
    const reach = list.reduce((a, p) => a + (p.analytics.reach ?? 0), 0);
    const saves = list.reduce((a, p) => a + (p.analytics.saves ?? 0), 0);
    const hasSaves = list.some((p) => p.analytics.saves !== null);
    return {
      type,
      name: FORMAT_NAMES[type],
      posts: list.length,
      avgReach: reach / list.length,
      savesPer1k: hasSaves && reach > 0 ? (saves / reach) * 1000 : null,
    };
  });
  rows.sort((a, b) => b.avgReach - a.avgReach);
  if (rows.length < 2 || rows[1].avgReach <= 0) return null;
  const bySaves = rows
    .filter((r) => r.savesPer1k !== null)
    .sort((a, b) => (b.savesPer1k ?? 0) - (a.savesPer1k ?? 0));
  const mostSaved =
    bySaves.length >= 2 && bySaves[0].type !== rows[0].type && (bySaves[1].savesPer1k ?? 0) > 0
      ? {
          name: bySaves[0].name,
          ratio: (bySaves[0].savesPer1k ?? 0) / (bySaves[1].savesPer1k ?? 1),
        }
      : null;
  return { rows, reachRatio: rows[0].avgReach / rows[1].avgReach, mostSaved };
}

// ── Horário ─────────────────────────────────────────────────────────────────

export const DAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export const DAY_NAMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
/** Linhas do mapa começam na segunda. */
export const HEAT_DAYS = [1, 2, 3, 4, 5, 6, 0];
export const HEAT_BLOCKS = 8; // faixas de 3h

export interface Timing {
  /** nível 0–5 por [linha (seg..dom)][faixa de 3h] */
  levels: number[][];
  /** faixas em que você publicou, "linha-faixa" */
  posted: Set<string>;
  best: { dayOfWeek: number; block: number };
  /** engajamento da melhor faixa ÷ média das faixas com dado */
  ratio: number;
  /** quantos dos seus 2 posts de maior alcance saíram na melhor faixa */
  topPostsInBest: number;
  postsInBest: number;
}

export function timing(slots: BestTimeSlot[], posts: ZernioPost[]): Timing | null {
  const acc = new Map<string, number[]>();
  for (const s of slots) {
    if (s.hour === null || s.score === null) continue;
    const key = `${HEAT_DAYS.indexOf(s.dayOfWeek)}-${Math.floor(s.hour / 3)}`;
    acc.set(key, [...(acc.get(key) ?? []), s.score]);
  }
  if (acc.size < 3) return null;
  const avgOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const cell = new Map([...acc].map(([k, xs]) => [k, avgOf(xs)]));
  const max = Math.max(...cell.values());
  const overall = avgOf([...cell.values()]);
  const levels = HEAT_DAYS.map((_, r) =>
    Array.from({ length: HEAT_BLOCKS }, (_, c) => {
      const v = cell.get(`${r}-${c}`);
      return v === undefined || max <= 0 ? 0 : Math.max(1, Math.ceil((v / max) * 5));
    }),
  );
  const [bestKey] = [...cell].sort((a, b) => b[1] - a[1])[0];
  const [row, block] = bestKey.split("-").map(Number);
  const where = (p: ZernioPost) => {
    const d = new Date(p.date as string);
    return `${HEAT_DAYS.indexOf(d.getDay())}-${Math.floor(d.getHours() / 3)}`;
  };
  const dated = posts.filter((p) => p.date);
  const posted = new Set(dated.map(where));
  const top2 = [...dated]
    .sort((a, b) => (b.analytics.reach ?? 0) - (a.analytics.reach ?? 0))
    .slice(0, 2);
  return {
    levels,
    posted,
    best: { dayOfWeek: HEAT_DAYS[row], block },
    ratio: overall > 0 ? max / overall : 1,
    topPostsInBest: top2.filter((p) => where(p) === bestKey).length,
    postsInBest: dated.filter((p) => where(p) === bestKey).length,
  };
}

export const blockLabel = (block: number) => `${block * 3}h e ${block * 3 + 3}h`;

// ── Qualidade das interações ────────────────────────────────────────────────

export interface Quality {
  rows: Array<{ key: "likes" | "saves" | "shares" | "comments"; name: string; share: number }>;
  /** fração das interações que são salvar ou compartilhar */
  keepShare: number;
}

export function quality(daily: DailyPoint[], days: number, now = new Date()): Quality | null {
  const parts = {
    likes: periodDelta(daily, "likes", days, now).current,
    saves: periodDelta(daily, "saves", days, now).current,
    shares: periodDelta(daily, "shares", days, now).current,
    comments: periodDelta(daily, "comments", days, now).current,
  };
  const total = Object.values(parts).reduce<number>((a, v) => a + (v ?? 0), 0);
  if (total <= 0 || parts.saves === null || parts.shares === null) return null;
  const names = {
    likes: "Curtidas",
    saves: "Salvamentos",
    shares: "Compartilh.",
    comments: "Comentários",
  };
  const rows = (Object.keys(parts) as Array<keyof typeof parts>)
    .map((key) => ({ key, name: names[key], share: (parts[key] ?? 0) / total }))
    .sort((a, b) => b.share - a.share);
  return { rows, keepShare: ((parts.saves ?? 0) + (parts.shares ?? 0)) / total };
}

// ── Melhor publicação ───────────────────────────────────────────────────────

export interface BestPostInsight {
  post: ZernioPost;
  ratio: number;
  reach: number;
  followersThatDay: number | null;
  when: string;
}

export function bestPostInsight(
  posts: ZernioPost[],
  points: FollowerPoint[],
  now = new Date(),
): BestPostInsight | null {
  const withReach = posts.filter((p) => p.date && p.analytics.reach !== null);
  if (withReach.length < 3) return null;
  const best = [...withReach].sort(
    (a, b) => (b.analytics.reach ?? 0) - (a.analytics.reach ?? 0),
  )[0];
  const others = withReach.filter((p) => p.id !== best.id);
  const avg = others.reduce((a, p) => a + (p.analytics.reach ?? 0), 0) / others.length;
  if (avg <= 0) return null;
  const date = new Date(best.date as string);
  const day = localDay(best.date as string);
  const gained = gainedByDay(points, 400, now).get(day) ?? null;
  return {
    post: best,
    ratio: (best.analytics.reach ?? 0) / avg,
    reach: best.analytics.reach ?? 0,
    followersThatDay: gained,
    when: `${date.toLocaleDateString("pt-BR", { day: "numeric", month: "short" }).replace(".", "")} · ${DAY_NAMES[date.getDay()]} · ${date.getHours()}h`,
  };
}

// ── Constância ──────────────────────────────────────────────────────────────

export interface Consistency {
  weeks: Array<{ start: string; net: number; posts: number }>;
  /** quantas vezes as semanas com 2+ posts cresceram mais que as de 0–1 */
  ratio: number | null;
}

export function consistency(
  points: FollowerPoint[],
  posts: ZernioPost[],
  days: number,
  now = new Date(),
): Consistency | null {
  const count = Math.floor(days / 7);
  if (count < 2) return null;
  const weeks: Consistency["weeks"] = [];
  for (let w = count - 1; w >= 0; w--) {
    const endKey = isoDate(daysAgo(w * 7, now));
    const startKey = isoDate(daysAgo(w * 7 + 7, now));
    const end = followersAt(points, endKey);
    const begin =
      points.length && points[0].date <= startKey ? followersAt(points, startKey) : null;
    if (end === null || begin === null) continue;
    const n = posts.filter(
      (p) => p.date && localDay(p.date) > startKey && localDay(p.date) <= endKey,
    ).length;
    weeks.push({ start: isoDate(daysAgo(w * 7 + 6, now)), net: end - begin, posts: n });
  }
  if (weeks.length < 2) return null;
  const hi = weeks.filter((w) => w.posts >= 2);
  const lo = weeks.filter((w) => w.posts <= 1);
  const avg = (xs: typeof weeks) => xs.reduce((a, w) => a + w.net, 0) / xs.length;
  const ratio =
    hi.length && lo.length && avg(lo) > 0 && avg(hi) > avg(lo) ? avg(hi) / avg(lo) : null;
  return { weeks, ratio };
}
