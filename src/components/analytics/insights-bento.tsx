import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Kpi, KpiRow } from "@/components/patterns/Metricas";
import { Button } from "@/components/ui/button";
import {
  bestPostInsight,
  cadence,
  MIN_POSTS,
  MIN_READING_DAYS,
  readiness,
  blockLabel,
  consistency,
  DAY_NAMES,
  DAY_SHORT,
  fmt1,
  fmtPace,
  fmtPct1,
  fmtX,
  formats,
  funnel,
  growth,
  HEAT_BLOCKS,
  HEAT_DAYS,
  marketPosition,
  postDayLift,
  quality,
  reachMultiple,
  timing,
  type Growth,
  type MarketInput,
} from "@/lib/desempenho-insights";
import { cn } from "@/lib/utils";
import {
  daysAgo,
  formatNumber,
  isoDate,
  type BestTimeSlot,
  type DailyPoint,
  type FollowerPoint,
  type ZernioPost,
} from "@/lib/zernio-analytics";

// ---------------------------------------------------------------------------
// Desempenho como BI (versão 1 aprovada pelo Samuel em 04/11): cada card é
// uma conclusão — a frase que diz o que o número significa, o gráfico que a
// prova e o contexto (mercado, período anterior, projeção). Card sem dado
// suficiente não aparece. Cores validadas com a skill dataviz: série
// --via-data-1, contexto --via-data-context, perda coral, mapa num tom só.
// ---------------------------------------------------------------------------

const MONTH = (d: Date) =>
  d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" }).replace(".", "");

function Card({
  eyebrow,
  title,
  sub,
  foot,
  className,
  children,
  label,
}: {
  eyebrow: string;
  title: ReactNode;
  sub?: ReactNode;
  foot?: ReactNode;
  className?: string;
  children?: ReactNode;
  label: string;
}) {
  return (
    <section aria-label={label} className={cn("via-tile flex min-w-0 flex-col", className)}>
      <p className="via-eyebrow">{eyebrow}</p>
      <p className="mt-2 text-lg font-medium leading-snug tracking-[-0.015em] text-[var(--via-text-primary)]">
        {title}
      </p>
      {sub ? (
        <p className="mt-1.5 text-[0.8125rem] leading-snug text-[var(--via-text-muted)]">{sub}</p>
      ) : null}
      {children ? <div className="mt-4">{children}</div> : null}
      {foot ? (
        <p className="mt-auto pt-4 text-[0.8125rem] text-[var(--via-text-soft)]">{foot}</p>
      ) : null}
    </section>
  );
}

/** Barra horizontal com valor na ponta: uma linha de ranking. */
function BarRow({
  name,
  value,
  width,
  strong,
}: {
  name: string;
  value: string;
  width: number;
  strong?: boolean;
}) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)_64px] items-center gap-2.5 text-[0.8125rem]">
      <span
        className={
          strong ? "font-medium text-[var(--via-text-primary)]" : "text-[var(--via-text-body)]"
        }
      >
        {name}
      </span>
      <span className="h-3">
        <span
          className="block h-3 rounded-r-[4px]"
          style={{
            width: `${Math.max(1.5, Math.min(100, width))}%`,
            minWidth: 4,
            background: strong ? "var(--via-data-1)" : "var(--via-data-context)",
          }}
        />
      </span>
      <span className="text-right tabular-nums text-[var(--via-text-body)]">{value}</span>
    </div>
  );
}

function Legend({ items }: { items: Array<{ swatch: ReactNode; text: string }> }) {
  return (
    <div className="mt-2 flex flex-wrap gap-4 text-[0.8125rem] text-[var(--via-text-muted)]">
      {items.map((item) => (
        <span key={item.text} className="inline-flex items-center gap-1.5">
          {item.swatch}
          {item.text}
        </span>
      ))}
    </div>
  );
}

const line = (color: string, dashed = false) => (
  <span
    aria-hidden="true"
    className="inline-block h-0.5 w-3.5 rounded"
    style={{
      background: dashed
        ? `repeating-linear-gradient(90deg, ${color} 0 3px, transparent 3px 8px)`
        : color,
    }}
  />
);
const square = (color: string, ring = false) => (
  <span
    aria-hidden="true"
    className="inline-block size-2.5 rounded-[3px]"
    style={{
      background: ring ? "var(--via-surface)" : color,
      boxShadow: ring ? `inset 0 0 0 2px ${color}` : undefined,
    }}
  />
);

// ── Gráfico de crescimento ──────────────────────────────────────────────────

function niceStep(span: number): number {
  const raw = span / 4;
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const n = raw / pow;
  // seguidores são inteiros: o passo 2,5 só existe a partir da dezena (25, 250…)
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 && pow > 1 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

function GrowthChart({
  g: fullGrowth,
  postDays: allPostDays,
  bestDay: fullBestDay,
  gainedByIndex: allGained,
  lostByIndex: allLost,
  now,
}: {
  g: Growth;
  postDays: Set<number>;
  bestDay: number | null;
  gainedByIndex: Array<number | null>;
  lostByIndex: Array<number | null>;
  now: Date;
}) {
  const [hover, setHover] = useState<number | null>(null);
  // começa na primeira leitura: sem isso, 6 dias de dado ficavam espremidos num eixo de 30
  const skip = Math.max(
    0,
    fullGrowth.series.findIndex((v) => v !== null),
  );
  const g = {
    ...fullGrowth,
    series: fullGrowth.series.slice(skip),
    previousSeries: fullGrowth.previousSeries.slice(skip),
  };
  const postDays = new Set([...allPostDays].filter((i) => i >= skip).map((i) => i - skip));
  const bestDay = fullBestDay !== null && fullBestDay >= skip ? fullBestDay - skip : null;
  const gainedByIndex = allGained.slice(skip);
  const lostByIndex = allLost.slice(skip);
  const n = g.series.length;
  const ext = g.milestoneDate ? Math.round(n / 3) : 0;
  const perDay = g.net / Math.max(g.days, 1);
  const projEnd = g.total + perDay * ext;
  const values = [...g.series, ...g.previousSeries, projEnd].filter((v): v is number => v !== null);
  const step = niceStep(Math.max(...values) - Math.min(...values) || 10);
  const lo = Math.floor(Math.min(...values) / step) * step;
  const hi = Math.ceil(Math.max(...values) / step) * step;
  const W = 720;
  const L = 48;
  const R = 712;
  const T = 24;
  const B = 216;
  const X = (i: number) => L + (i * (R - L)) / Math.max(n - 1 + ext, 1);
  const half = (R - L) / Math.max(n - 1 + ext, 1) / 2;
  const Y = (v: number) => B - ((v - lo) / (hi - lo || 1)) * (B - T);
  const path = (vals: Array<number | null>) => {
    let d = "";
    vals.forEach((v, i) => {
      if (v === null) return;
      d += `${d ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)} `;
    });
    return d.trim();
  };
  const cur = path(g.series);
  const firstIdx = g.series.findIndex((v) => v !== null);
  const area = cur ? `${cur} L${X(n - 1).toFixed(1)} ${B} L${X(firstIdx).toFixed(1)} ${B} Z` : "";
  const ticks: number[] = [];
  for (let v = lo; v <= hi + 0.5; v += step) ticks.push(v);
  const dateOf = (i: number) => daysAgo(n - 1 - i, now);
  const tip =
    hover !== null && g.series[hover] !== null
      ? {
          left: `${((X(hover) / W) * 100).toFixed(1)}%`,
          // perto das bordas a dica abre para dentro do card
          shift: X(hover) / W > 0.78 ? "-100%" : X(hover) / W < 0.22 ? "0%" : "-50%",
          date: `${MONTH(dateOf(hover))}${postDays.has(hover) ? " · dia com post" : ""}`,
          total: formatNumber(g.series[hover], "full"),
          moves:
            gainedByIndex[hover] !== null
              ? `+${gainedByIndex[hover]} entraram · −${lostByIndex[hover] ?? 0} saíram`
              : null,
        }
      : null;
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} 250`}
        role="img"
        aria-label={`Seguidores por dia nos últimos ${n} dias${g.previousSeries.length ? ", com o período anterior em cinza" : ""}${g.milestoneDate ? " e a projeção pontilhada" : ""}`}
        className="block h-auto w-full"
      >
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={L}
              x2={R}
              y1={Y(v)}
              y2={Y(v)}
              stroke={v === lo ? "var(--via-data-axis)" : "var(--via-data-grid)"}
            />
            <text x={L - 8} y={Y(v) + 4} textAnchor="end" fontSize="12" fill="var(--via-text-soft)">
              {formatNumber(v, "full")}
            </text>
          </g>
        ))}
        {g.previousSeries.length ? (
          <path
            d={path(g.previousSeries)}
            fill="none"
            stroke="var(--via-data-context)"
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ) : null}
        <path d={area} fill="var(--via-data-1)" fillOpacity={0.1} />
        <path
          d={cur}
          fill="none"
          stroke="var(--via-data-1)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {g.milestoneDate ? (
          <>
            <path
              d={`M${X(n - 1).toFixed(1)} ${Y(g.total).toFixed(1)} L${X(n - 1 + ext).toFixed(1)} ${Y(projEnd).toFixed(1)}`}
              stroke="var(--via-data-1)"
              strokeWidth={2}
              strokeDasharray="3 5"
              strokeLinecap="round"
            />
            <text x={R - 6} y={T + 8} textAnchor="end" fontSize="12" fill="var(--via-text-muted)">
              {formatNumber(g.milestone, "full")} em {MONTH(g.milestoneDate)} →
            </text>
          </>
        ) : null}
        {[...postDays].map((i) =>
          g.series[i] === null ? null : (
            <circle
              key={i}
              cx={X(i)}
              cy={Y(g.series[i] as number)}
              r={i === bestDay ? 6 : 4.5}
              fill="var(--via-data-1)"
              stroke="var(--via-surface)"
              strokeWidth={2}
            />
          ),
        )}
        {bestDay !== null && g.series[bestDay] !== null && gainedByIndex[bestDay] !== null ? (
          <text
            x={X(bestDay)}
            y={Y(g.series[bestDay] as number) - 14}
            textAnchor="middle"
            fontSize="12"
            fill="var(--via-text-body)"
          >
            +{gainedByIndex[bestDay]} em {MONTH(dateOf(bestDay))}
          </text>
        ) : null}
        {hover !== null ? (
          <line x1={X(hover)} x2={X(hover)} y1={T} y2={B} stroke="var(--via-navy-25)" />
        ) : null}
        <text x={L} y={238} fontSize="12" fill="var(--via-text-soft)">
          {MONTH(dateOf(0))}
        </text>
        <text x={X(n - 1)} y={238} textAnchor="end" fontSize="12" fill="var(--via-text-soft)">
          hoje
        </text>
      </svg>
      {/* camada de hover: uma faixa por dia, sobre a área do gráfico */}
      <div
        className="absolute flex"
        style={{
          left: `${((X(0) - half) / W) * 100}%`,
          width: `${((X(n - 1) - X(0) + 2 * half) / W) * 100}%`,
          top: 0,
          bottom: "14%",
        }}
        onMouseLeave={() => setHover(null)}
      >
        {g.series.map((_, i) => (
          <span key={i} className="h-full flex-1" onMouseEnter={() => setHover(i)} />
        ))}
      </div>
      {tip ? (
        <div
          className="pointer-events-none absolute top-1 whitespace-nowrap rounded-[12px] border border-[var(--via-border-soft)] bg-[var(--via-surface)] px-3 py-2 text-[0.8125rem] shadow-[var(--via-shadow-md)]"
          style={{ left: tip.left, transform: `translateX(${tip.shift})` }}
        >
          <div className="text-[var(--via-text-soft)]">{tip.date}</div>
          <div className="font-medium text-[var(--via-text-primary)]">{tip.total} seguidores</div>
          {tip.moves ? <div className="text-[var(--via-text-muted)]">{tip.moves}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

// ── O bento ─────────────────────────────────────────────────────────────────

export interface InsightsBentoProps {
  posts: ZernioPost[];
  /** seguidores somados por dia, cobrindo o período atual e o anterior */
  followers: FollowerPoint[];
  daily: DailyPoint[];
  bestTime: BestTimeSlot[];
  market: MarketInput | null;
  days: number;
  /** o que mostrar no card Mercado quando ainda não dá para comparar */
  marketEmpty?: ReactNode;
  /** ação de gerenciar concorrentes, no pé do card Mercado */
  marketAction?: ReactNode;
  onOpenPost: (post: ZernioPost) => void;
  now?: Date;
}

export function InsightsBento({
  posts,
  followers,
  daily,
  bestTime,
  market,
  days,
  marketEmpty,
  marketAction,
  onOpenPost,
  now: nowProp,
}: InsightsBentoProps) {
  const now = useMemo(() => nowProp ?? new Date(), [nowProp]);
  const insight = useMemo(() => {
    const g = growth(followers, days, now);
    const lift = postDayLift(followers, posts, days, now);
    const reach = reachMultiple(daily, g?.total ?? null, days, now);
    const mk = marketPosition(posts, followers, market, days);
    const fn = funnel(daily, g?.gained ?? g?.net ?? null, days, now);
    const fm = formats(posts);
    const tm = timing(bestTime, posts);
    const ql = quality(daily, days, now);
    const bp = bestPostInsight(posts, followers, now);
    const cs = consistency(followers, posts, days, now);
    return { g, lift, reach, mk, fn, fm, tm, ql, bp, cs };
  }, [followers, posts, daily, bestTime, market, days, now]);
  // Sem base, as conclusões comparativas ficam "em formação" no próprio card:
  // a estrutura inteira do BI aparece, sem número inventado.
  const base = readiness(followers, posts, now);
  const forming = !base.ready;
  const ritmo = cadence(posts, market, days);
  const { g, reach, mk, tm } = insight;
  const lift = forming ? null : insight.lift;
  const fn = forming ? null : insight.fn;
  const fm = forming ? null : insight.fm;
  const ql = forming ? null : insight.ql;
  const bp = forming ? null : insight.bp;
  const cs = forming ? null : insight.cs;
  const faltam = `Completa com ${MIN_READING_DAYS} dias de leitura e ${MIN_POSTS} publicações com métricas.`;

  // índice do dia no período (0 = mais antigo) para os posts e movimentos
  const dayIndex = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < days; i++) map.set(isoDate(daysAgo(days - 1 - i, now)), i);
    return map;
  }, [days, now]);
  const postDays = new Set(
    posts
      .filter((p) => p.date)
      .map((p) => dayIndex.get(isoDate(new Date(p.date as string))))
      .filter((i): i is number => i !== undefined),
  );
  const moves = (key: "gained" | "lost") =>
    Array.from({ length: days }, (_, i) => {
      const point = followers.find((p) => p.date === isoDate(daysAgo(days - 1 - i, now)));
      return typeof point?.[key] === "number" ? (point[key] as number) : null;
    });
  const gainedByIndex = moves("gained");
  const lostByIndex = moves("lost");
  const bestDay = bp?.post.date ? (dayIndex.get(isoDate(new Date(bp.post.date))) ?? null) : null;
  const topCompetitor = mk?.competitors.length
    ? [...mk.competitors].sort((a, b) => b.perWeek - a.perWeek)[0]
    : null;

  const pendingRow3 = [
    <PendingCard
      key="funil"
      label="Do alcance ao seguidor"
      eyebrow="Funil"
      question="Quanto do seu alcance vira seguidor?"
      need={faltam}
      shape="hbars"
    />,
    <PendingCard
      key="post"
      label="Publicar traz seguidores"
      eyebrow="Publicação"
      question="Quantos seguidores a mais cada post traz?"
      need={faltam}
      shape="cols"
    />,
    <PendingCard
      key="formato"
      label="Formato que funciona"
      eyebrow="Formato"
      question="Qual formato leva mais longe?"
      need={forming ? faltam : "Precisa de publicações em pelo menos 2 formatos."}
      shape="hbars"
    />,
  ];
  const pendingRow5 = [
    <PendingCard
      key="melhor"
      label="Melhor post"
      eyebrow="Melhor post"
      question="Qual post rendeu mais, e por quê?"
      need={faltam}
      shape="post"
    />,
    <PendingCard
      key="constancia"
      label="Constância"
      eyebrow="Constância"
      question="Publicar mais vezes faz você crescer mais?"
      need={forming ? faltam : "Precisa de 2 semanas de leitura."}
      shape="weeks"
    />,
    <PendingCard
      key="volume"
      label="Volume e engajamento"
      eyebrow="Volume × engajamento"
      question="Você engaja mais ou publica mais que os concorrentes?"
      need={`Precisa de ${MIN_POSTS} publicações com métricas e concorrentes lidos.`}
      shape="scatter"
    />,
  ];

  const row3 = [
    fn ? (
      <Card
        key="funil"
        label="Do alcance ao seguidor"
        eyebrow="Funil"
        title={`De cada 100 que interagem, ${fmt1(fn.followPer100)} ${fn.followPer100 < 1.5 ? "segue" : "seguem"}.`}
        sub={
          fn.followPer100 < 10
            ? "O conteúdo prende; falta pedir para seguir no fim do post."
            : "Quem interage vira seguidor: o próximo passo é alcançar mais gente."
        }
        foot={`${formatNumber(fn.followers, "full")} novos seguidores de ${formatNumber(fn.interactions)} interações.`}
      >
        <div className="space-y-3.5">
          <BarRow name="Alcançados" value={formatNumber(fn.reach)} width={100} />
          <BarRow
            name="Interagiram"
            value={fmtPct1(fn.interactRate)}
            width={fn.interactRate * 100}
            strong
          />
          <BarRow
            name="Seguiram"
            value={fmtPct1(fn.followers / fn.reach)}
            width={(fn.followers / fn.reach) * 100}
          />
        </div>
      </Card>
    ) : null,
    lift ? (
      <Card
        key="post"
        label="Publicar traz seguidores"
        eyebrow="Publicação"
        title={`Dia com post traz ${fmtX(lift.ratio)} mais seguidores.`}
        sub="Média de novos seguidores por dia."
        foot={`Cada post vale, em média, ${Math.round(lift.extra)} seguidores a mais.`}
      >
        <svg
          viewBox="0 0 300 150"
          role="img"
          aria-label={`Dia com publicação: ${fmt1(lift.withPost)} novos seguidores; sem publicação: ${fmt1(lift.withoutPost)}`}
          className="block h-auto w-full"
        >
          <line x1="20" x2="280" y1="122" y2="122" stroke="var(--via-data-axis)" />
          {[
            { x: 82, v: lift.withPost, fill: "var(--via-data-1)", label: "com post", strong: true },
            {
              x: 208,
              v: lift.withoutPost,
              fill: "var(--via-data-context)",
              label: "sem post",
              strong: false,
            },
          ].map((c) => {
            const h = (c.v / lift.withPost) * 92;
            return (
              <g key={c.label}>
                <path
                  d={`M${c.x - 12} 122 V${122 - h + 4} a4 4 0 0 1 4 -4 h16 a4 4 0 0 1 4 4 V122 Z`}
                  fill={c.fill}
                />
                <text
                  x={c.x}
                  y={122 - h - 12}
                  textAnchor="middle"
                  fontSize="13"
                  fill={c.strong ? "var(--via-text-primary)" : "var(--via-text-body)"}
                  fontWeight={c.strong ? 500 : 400}
                >
                  {fmt1(c.v)}
                </text>
                <text x={c.x} y={142} textAnchor="middle" fontSize="12" fill="var(--via-text-soft)">
                  {c.label}
                </text>
              </g>
            );
          })}
        </svg>
      </Card>
    ) : null,
    fm ? (
      <Card
        key="formato"
        label="Formato que funciona"
        eyebrow="Formato"
        title={
          fm.reachRatio >= 1.25
            ? `${fm.rows[0].name} alcança ${fmtX(fm.reachRatio)} mais que ${fm.rows[1].name.toLowerCase()}.`
            : `${fm.rows[0].name} e ${fm.rows[1].name.toLowerCase()} alcançam quase o mesmo.`
        }
        sub="Alcance médio por publicação."
        foot={
          fm.mostSaved
            ? `Mas ${fm.mostSaved.name.toLowerCase()} é ${fmtX(fm.mostSaved.ratio)} mais salvo: use-o para conteúdo de consulta.`
            : undefined
        }
      >
        <div className="space-y-3.5">
          {fm.rows.slice(0, 4).map((r, i) => (
            <BarRow
              key={r.type}
              name={r.name}
              value={formatNumber(Math.round(r.avgReach))}
              width={(r.avgReach / fm.rows[0].avgReach) * 100}
              strong={i === 0}
            />
          ))}
        </div>
      </Card>
    ) : null,
  ].map((card, i) => card ?? pendingRow3[i]);

  const row5 = [
    bp ? (
      <Card
        key="melhor"
        label="Melhor post"
        eyebrow="Melhor post"
        title={`Um ${bp.post.mediaType === "video" ? "vídeo" : "post"} de ${DAY_NAMES[new Date(bp.post.date as string).getDay()]} rendeu ${fmtX(bp.ratio)} a sua média.`}
        foot="Mesmo tema, formato e horário: é a receita a repetir."
      >
        <button
          type="button"
          onClick={() => onOpenPost(bp.post)}
          className="grid w-full grid-cols-[72px_minmax(0,1fr)] items-start gap-3.5 rounded-[var(--via-radius-md)] text-left transition-colors hover:bg-[var(--via-navy-03)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]"
        >
          {bp.post.thumbnailUrl ? (
            <img
              src={bp.post.thumbnailUrl}
              alt=""
              className="aspect-[9/16] w-full rounded-[12px] object-cover"
              loading="lazy"
            />
          ) : (
            <span
              aria-hidden="true"
              className="aspect-[9/16] w-full rounded-[12px] bg-[var(--via-navy-06)]"
            />
          )}
          <span className="flex min-w-0 flex-col gap-2 text-[0.8125rem]">
            <span className="line-clamp-2 font-medium text-[var(--via-text-primary)]">
              “{bp.post.content.split("\n")[0] || "sem texto"}”
            </span>
            <span className="text-[var(--via-text-muted)]">{bp.when}</span>
            <span className="flex flex-wrap gap-1.5">
              <span className="ds-pill inline-flex rounded-full bg-[var(--via-navy-06)] px-2 py-0.5 text-[0.6875rem] font-medium text-[var(--via-navy)]">
                alcance {formatNumber(bp.reach)}
              </span>
              {bp.followersThatDay !== null ? (
                <span className="ds-pill inline-flex rounded-full bg-[var(--via-navy-06)] px-2 py-0.5 text-[0.6875rem] font-medium text-[var(--via-navy)]">
                  +{bp.followersThatDay} seguidores
                </span>
              ) : null}
            </span>
          </span>
        </button>
      </Card>
    ) : null,
    cs ? (
      <Card
        key="constancia"
        label="Constância"
        eyebrow="Constância"
        title={
          cs.ratio && cs.ratio >= 1.2
            ? `Semanas com 2 posts ou mais cresceram ${fmtX(cs.ratio)} mais.`
            : "Seu crescimento semana a semana."
        }
        sub="Novos seguidores líquidos por semana."
      >
        <svg
          viewBox="0 0 300 150"
          role="img"
          aria-label={cs.weeks
            .map(
              (w) =>
                `semana de ${w.start.slice(8, 10)}/${w.start.slice(5, 7)}: ${w.net} com ${w.posts} posts`,
            )
            .join("; ")}
          className="block h-auto w-full"
        >
          <line x1="10" x2="290" y1="118" y2="118" stroke="var(--via-data-axis)" />
          {cs.weeks.map((w, i) => {
            const max = Math.max(...cs.weeks.map((x) => Math.max(x.net, 1)));
            const h = Math.max(0, (w.net / max) * 84);
            const cx = 10 + ((i + 0.5) * 280) / cs.weeks.length;
            return (
              <g key={w.start}>
                {h > 0 ? (
                  <path
                    d={`M${cx - 12} 118 V${118 - h + 4} a4 4 0 0 1 4 -4 h16 a4 4 0 0 1 4 4 V118 Z`}
                    fill={w.posts >= 2 ? "var(--via-data-1)" : "var(--via-data-context)"}
                  />
                ) : null}
                <text
                  x={cx}
                  y={118 - h - 8}
                  textAnchor="middle"
                  fontSize="12"
                  fill="var(--via-text-body)"
                >
                  {w.net}
                </text>
                <text
                  x={cx}
                  y={138}
                  textAnchor="middle"
                  fontSize="12"
                  fill="var(--via-text-soft)"
                >{`${Number(w.start.slice(8, 10))}/${w.start.slice(5, 7)}`}</text>
              </g>
            );
          })}
        </svg>
        <Legend
          items={[
            { swatch: square("var(--via-data-1)"), text: "2+ posts" },
            { swatch: square("var(--via-data-context)"), text: "0–1 post" },
          ]}
        />
      </Card>
    ) : null,
    mk && topCompetitor ? (
      <Card
        key="volume"
        label="Volume e engajamento"
        eyebrow="Volume × engajamento"
        title={
          mk.ratio > 1 && mk.minePerWeek < topCompetitor.perWeek
            ? "Você engaja mais com menos posts."
            : "Onde você está entre os concorrentes."
        }
      >
        {(() => {
          const pts = [
            { handle: "você", x: mk.minePerWeek, y: mk.mine, me: true },
            ...mk.competitors.map((c) => ({
              handle: `@${c.handle}`,
              x: c.perWeek,
              y: c.rate,
              me: false,
            })),
          ];
          const maxX = Math.max(1, Math.ceil(Math.max(...pts.map((p) => p.x))));
          const maxY = Math.max(...pts.map((p) => p.y)) * 1.15 || 0.01;
          const PX = (x: number) => 36 + (x / maxX) * 254;
          const PY = (y: number) => 140 - (y / maxY) * 120;
          return (
            <svg
              viewBox="0 0 300 186"
              role="img"
              aria-label={pts
                .map(
                  (p) =>
                    `${p.handle}: ${fmt1(p.x)} posts por semana, ${fmtPct1(p.y)} de engajamento`,
                )
                .join("; ")}
              className="block h-auto w-full"
            >
              <line x1="36" x2="290" y1="140" y2="140" stroke="var(--via-data-axis)" />
              <line x1="36" x2="36" y1="16" y2="140" stroke="var(--via-data-axis)" />
              {Array.from({ length: maxX + 1 }, (_, i) => (
                <text
                  key={i}
                  x={PX(i)}
                  y={156}
                  textAnchor="middle"
                  fontSize="12"
                  fill="var(--via-text-soft)"
                >
                  {i}
                </text>
              ))}
              <text x="163" y="178" textAnchor="middle" fontSize="12" fill="var(--via-text-soft)">
                posts por semana
              </text>
              {pts.map((p) => (
                <g key={p.handle}>
                  <circle
                    cx={PX(p.x)}
                    cy={PY(p.y)}
                    r={p.me ? 7 : 5}
                    fill={p.me ? "var(--via-data-1)" : "var(--via-data-context)"}
                    stroke="var(--via-surface)"
                    strokeWidth={2}
                  />
                  <text
                    x={PX(p.x)}
                    y={PY(p.y) - 11}
                    textAnchor="middle"
                    fontSize="12"
                    fill={p.me ? "var(--via-text-primary)" : "var(--via-text-body)"}
                    fontWeight={p.me ? 500 : 400}
                  >
                    {p.me ? `você · ${fmtPct1(p.y)}` : p.handle}
                  </text>
                </g>
              ))}
            </svg>
          );
        })()}
      </Card>
    ) : null,
  ].map((card, i) => card ?? pendingRow5[i]);

  return (
    <div className="space-y-4">
      {forming ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--via-radius-lg)] border border-dashed border-[var(--via-border)] px-5 py-3.5 text-sm">
          <span className="text-[var(--via-text-body)]">
            <span className="font-medium text-[var(--via-text-primary)]">
              Seu BI está se formando.
            </span>{" "}
            {Math.min(base.readingDays, MIN_READING_DAYS)} de {MIN_READING_DAYS} dias de leitura ·{" "}
            {Math.min(base.postsWithMetrics, MIN_POSTS)} de {MIN_POSTS} publicações com métricas. Os
            cards se completam sozinhos.
          </span>
          <Button asChild variant="outline" size="sm">
            <Link to="/criar">
              Criar uma publicação
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      ) : null}
      <KpiRow>
        {g ? (
          <Kpi
            label="Seguidores"
            value={formatNumber(g.total, "full")}
            variacao={g.net === 0 ? undefined : Math.round(g.pct * 1000) / 10}
            periodo={`em ${g.days} dias`}
            detalhe={
              g.net === 0
                ? `estáveis nos ${g.days} dias de leitura`
                : g.vsPrevious === null
                  ? undefined
                  : g.vsPrevious >= 1.2
                    ? `${fmtX(g.vsPrevious)} o crescimento do período anterior`
                    : g.vsPrevious > 0.83
                      ? "no mesmo ritmo do período anterior"
                      : "crescendo mais devagar que no período anterior"
            }
            destaque
          />
        ) : null}
        {reach ? (
          <Kpi
            label="Alcance"
            value={reach.reach > 0 ? formatNumber(reach.reach) : "—"}
            detalhe={
              reach.reach <= 0
                ? `nenhum alcance medido em ${g?.days ?? days} dias`
                : forming
                  ? `nos ${g?.days ?? days} dias de leitura`
                  : reach.multiple >= 1.5
                    ? `${fmt1(reach.multiple)}× a sua base: o conteúdo chega além de quem já te segue`
                    : `${fmtPct1(reach.multiple)} da sua base viu o conteúdo`
            }
          />
        ) : null}
        {mk ? (
          <Kpi
            label="Engajamento por seguidor"
            value={fmtPct1(mk.mine)}
            detalhe={
              mk.ratio >= 1
                ? `${fmtX(mk.ratio)} a média dos concorrentes (${fmtPct1(mk.market)})`
                : `abaixo da média dos concorrentes (${fmtPct1(mk.market)})`
            }
          />
        ) : (
          <Kpi
            label="Engajamento por seguidor"
            value="—"
            detalhe={`aparece com ${MIN_POSTS} publicações com métricas`}
          />
        )}
        <Kpi
          label="Constância"
          value={
            ritmo.mine <= 0
              ? "—"
              : ritmo.mine < 0.05
                ? `${posts.length} em ${days} dias`
                : `${fmt1(ritmo.mine)} por semana`
          }
          detalhe={
            ritmo.leader && ritmo.leader.perWeek > ritmo.mine
              ? `@${ritmo.leader.handle} publica ${fmt1(ritmo.leader.perWeek)}. Volume é o que mais falta`
              : ritmo.leader
                ? "você publica tanto quanto os concorrentes"
                : ritmo.mine <= 0
                  ? `nenhuma publicação em ${days} dias`
                  : `nos últimos ${days} dias`
          }
        />
      </KpiRow>

      <div className={cn("grid grid-cols-1 gap-4", "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]")}>
        {g ? (
          <Card
            label="Crescimento de seguidores"
            eyebrow="Crescimento"
            title={
              g.milestoneDate
                ? `No ritmo atual, você passa de ${formatNumber(g.milestone, "full")} seguidores em ${MONTH(g.milestoneDate)}.`
                : g.net === 0
                  ? `Seus seguidores estão estáveis em ${formatNumber(g.total, "full")}.`
                  : g.net > 0
                    ? `+${formatNumber(g.net, "full")} seguidores em ${g.days} dias.`
                    : `Você perdeu ${formatNumber(-g.net, "full")} seguidores em ${g.days} dias.`
            }
            sub={
              g.gained !== null
                ? `${g.net > 0 ? "+" : ""}${formatNumber(g.net, "full")} em ${g.days} dias: ${formatNumber(g.gained, "full")} entraram, ${formatNumber(g.lost, "full")} saíram.${lift ? " Os picos são sempre dia de publicação." : ""}`
                : undefined
            }
          >
            <GrowthChart
              g={g}
              postDays={postDays}
              bestDay={bestDay}
              gainedByIndex={gainedByIndex}
              lostByIndex={lostByIndex}
              now={now}
            />
            <Legend
              items={[
                { swatch: line("var(--via-data-1)"), text: `Últimos ${g.days} dias` },
                ...(g.previousSeries.length
                  ? [{ swatch: line("var(--via-data-context)"), text: "Período anterior" }]
                  : []),
                {
                  swatch: (
                    <span
                      aria-hidden="true"
                      className="inline-block size-2 rounded-full bg-[var(--via-data-1)]"
                    />
                  ),
                  text: "Dia com publicação",
                },
                ...(g.milestoneDate
                  ? [{ swatch: line("var(--via-data-1)", true), text: "Projeção no ritmo atual" }]
                  : []),
              ]}
            />
          </Card>
        ) : (
          <PendingCard
            label="Crescimento de seguidores"
            eyebrow="Crescimento"
            question="Quando você chega ao próximo marco de seguidores?"
            need="Aparece com 3 dias de leitura dos seguidores."
            shape="line"
          />
        )}

        <Card
          label="Posição no mercado"
          eyebrow="Mercado"
          title={
            mk
              ? mk.ratio >= 1
                ? `Seu público engaja ${fmtX(mk.ratio)} mais que o dos concorrentes.`
                : "Seus concorrentes engajam mais por seguidor."
              : ritmo.leader
                ? `@${ritmo.leader.handle} publica ${fmt1(ritmo.leader.perWeek)} vezes por semana; você, ${fmtPace(ritmo.mine)}.`
                : "Compare a sua marca com o mercado."
          }
          sub={
            mk
              ? `Engajamento por seguidor nos últimos ${days} dias.`
              : ritmo.leader
                ? `Publicações por semana nos últimos ${days} dias. O engajamento entra com ${MIN_POSTS} posts com métricas.`
                : undefined
          }
          foot={
            mk
              ? mk.ratio > 1 && topCompetitor && topCompetitor.perWeek > mk.minePerWeek
                ? "Você publica menos e engaja mais: o limite é volume, não qualidade."
                : undefined
              : undefined
          }
        >
          {mk
            ? (() => {
                const pts = [
                  { name: "você", v: mk.mine, me: true },
                  ...mk.competitors.map((c) => ({ name: `@${c.handle}`, v: c.rate, me: false })),
                ];
                const maxV = Math.max(...pts.map((p) => p.v), mk.market) * 1.15;
                const PX = (v: number) => 12 + (v / maxV) * 296;
                return (
                  <svg
                    viewBox="0 0 320 170"
                    role="img"
                    aria-label={`Engajamento por seguidor: ${pts.map((p) => `${p.name} ${fmtPct1(p.v)}`).join(", ")}; média do mercado ${fmtPct1(mk.market)}`}
                    className="block h-auto w-full"
                  >
                    <line x1="12" x2="308" y1="140" y2="140" stroke="var(--via-data-axis)" />
                    <line
                      x1={PX(mk.market)}
                      x2={PX(mk.market)}
                      y1="34"
                      y2="140"
                      stroke="var(--via-data-context)"
                    />
                    {/* rótulo da média nunca sai pela borda do card */}
                    <text
                      x={Math.min(Math.max(PX(mk.market), 12), 308)}
                      y="26"
                      textAnchor={
                        PX(mk.market) < 60 ? "start" : PX(mk.market) > 260 ? "end" : "middle"
                      }
                      fontSize="12"
                      fill="var(--via-text-muted)"
                    >
                      média do mercado {fmtPct1(mk.market)}
                    </text>
                    {pts.map((p, i) => {
                      const y = p.me ? 74 : 104 + (i % 2) * 22;
                      return (
                        <g key={p.name}>
                          <circle
                            cx={PX(p.v)}
                            cy={y}
                            r={p.me ? 7 : 5}
                            fill={p.me ? "var(--via-data-1)" : "var(--via-data-context)"}
                            stroke="var(--via-surface)"
                            strokeWidth={2}
                          />
                          <text
                            x={PX(p.v) + (p.me ? -12 : 10)}
                            y={y + 4}
                            textAnchor={p.me ? "end" : "start"}
                            fontSize="12"
                            fill={p.me ? "var(--via-text-primary)" : "var(--via-text-body)"}
                            fontWeight={p.me ? 500 : 400}
                          >
                            {p.name} {fmtPct1(p.v)}
                          </text>
                        </g>
                      );
                    })}
                    <text x="12" y="160" fontSize="12" fill="var(--via-text-soft)">
                      0%
                    </text>
                    <text
                      x="308"
                      y="160"
                      textAnchor="end"
                      fontSize="12"
                      fill="var(--via-text-soft)"
                    >
                      {fmtPct1(maxV)}
                    </text>
                  </svg>
                );
              })()
            : ritmo.leader
              ? (() => {
                  const rowsC = [
                    { name: "Você", v: ritmo.mine, me: true },
                    ...ritmo.competitors.map((c) => ({
                      name: `@${c.handle}`,
                      v: c.perWeek,
                      me: false,
                    })),
                  ];
                  const maxC = Math.max(...rowsC.map((r) => r.v), 0.1);
                  return (
                    <div className="space-y-3.5">
                      {rowsC.map((r) => (
                        <BarRow
                          key={r.name}
                          name={r.name}
                          value={r.v > 0 && r.v < 0.05 ? "<0,1" : fmt1(r.v)}
                          width={(r.v / maxC) * 100}
                          strong={r.me}
                        />
                      ))}
                    </div>
                  );
                })()
              : marketEmpty}
          {marketAction ? <div className="mt-3">{marketAction}</div> : null}
        </Card>
      </div>

      {row3.length ? (
        <div
          className={cn(
            "grid grid-cols-1 gap-4",
            row3.length === 3 ? "md:grid-cols-3" : row3.length === 2 ? "md:grid-cols-2" : "",
          )}
        >
          {row3}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {tm ? (
          <Card
            label="Melhor horário"
            eyebrow="Horário"
            title={`${DAY_NAMES[tm.best.dayOfWeek][0].toUpperCase()}${DAY_NAMES[tm.best.dayOfWeek].slice(1)} entre ${blockLabel(tm.best.block)} engaja ${fmtX(tm.ratio)} a média.${tm.topPostsInBest === 2 ? " Seus 2 melhores posts saíram lá." : tm.postsInBest === 0 ? " Você ainda não publicou nesse horário." : ""}`}
            sub="Engajamento médio por dia e faixa de horário. O anel marca quando você publicou."
          >
            <div className="grid grid-cols-[36px_repeat(8,minmax(0,1fr))] gap-[3px] text-xs">
              {HEAT_DAYS.map((dow, r) => (
                <HeatRow
                  key={dow}
                  label={DAY_SHORT[dow]}
                  levels={tm.levels[r]}
                  posted={tm.posted}
                  row={r}
                />
              ))}
              <span />
              {Array.from({ length: HEAT_BLOCKS }, (_, c) => (
                <span key={c} className="text-[var(--via-text-soft)]">
                  {c * 3}h
                </span>
              ))}
            </div>
            <Legend
              items={[
                {
                  swatch: (
                    <span className="inline-flex gap-0.5">
                      {[
                        "var(--via-navy-04)",
                        "var(--via-heat-1)",
                        "var(--via-heat-2)",
                        "var(--via-heat-3)",
                        "var(--via-heat-4)",
                        "var(--via-heat-5)",
                      ].map((c) => (
                        <span
                          key={c}
                          aria-hidden="true"
                          className="inline-block size-2.5 rounded-[3px]"
                          style={{ background: c }}
                        />
                      ))}
                    </span>
                  ),
                  text: "menos → mais engajamento",
                },
                { swatch: square("var(--via-navy)", true), text: "você publicou" },
              ]}
            />
          </Card>
        ) : (
          <PendingCard
            label="Melhor horário"
            eyebrow="Horário"
            question="Quando o seu público está mais atento?"
            need="O Zernio calcula com o histórico das suas publicações."
            shape="heat"
          />
        )}
        {ql ? (
          <Card
            label="Qualidade das interações"
            eyebrow="Qualidade"
            title={`${Math.round(ql.keepShare * 100)}% das interações são salvar ou compartilhar.`}
            sub="É o sinal de conteúdo útil, o que o algoritmo mais distribui."
          >
            <div className="space-y-3">
              {ql.rows.map((r) => (
                <BarRow
                  key={r.key}
                  name={r.name}
                  value={`${Math.round(r.share * 100)}%`}
                  width={(r.share / ql.rows[0].share) * 100}
                  strong={r.key === "saves" || r.key === "shares"}
                />
              ))}
            </div>
          </Card>
        ) : (
          <PendingCard
            label="Qualidade das interações"
            eyebrow="Qualidade"
            question="As pessoas salvam e compartilham o seu conteúdo?"
            need={faltam}
            shape="hbars"
          />
        )}
      </div>

      {row5.length ? (
        <div
          className={cn(
            "grid grid-cols-1 gap-4",
            row5.length === 3 ? "md:grid-cols-3" : row5.length === 2 ? "md:grid-cols-2" : "",
          )}
        >
          {row5}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Card "em formação": fica no lugar do card de conclusão enquanto falta base.
 * Mostra a pergunta que ele vai responder, a silhueta neutra do gráfico (sem
 * número nenhum) e o que falta. A estrutura do BI aparece inteira desde o dia 1.
 */
function PendingCard({
  label,
  eyebrow,
  question,
  need,
  shape,
}: {
  label: string;
  eyebrow: string;
  question: string;
  need: string;
  shape: "line" | "hbars" | "cols" | "heat" | "post" | "weeks" | "scatter";
}) {
  const ghost = "var(--via-navy-06)";
  return (
    <section aria-label={`${label} (em formação)`} className="via-tile flex min-w-0 flex-col">
      <p className="via-eyebrow">{eyebrow}</p>
      <p className="mt-2 text-lg font-medium leading-snug tracking-[-0.015em] text-[var(--via-text-primary)]">
        {question}
      </p>
      <div className="mt-4" aria-hidden="true">
        {shape === "hbars" ? (
          <div className="space-y-3.5">
            {[100, 46, 22].map((w) => (
              <div key={w} className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2.5">
                <span className="h-2.5 w-16 rounded bg-[var(--via-navy-06)]" />
                <span
                  className="block h-3 rounded-r-[4px]"
                  style={{ width: `${w}%`, background: ghost }}
                />
              </div>
            ))}
          </div>
        ) : shape === "cols" || shape === "weeks" ? (
          <div className="flex h-28 items-end justify-around gap-4 border-b border-[var(--via-data-axis)] px-4">
            {(shape === "cols" ? [86, 22] : [40, 62, 50, 80]).map((h, k) => (
              <span
                key={k}
                className="w-6 rounded-t-[4px]"
                style={{ height: `${h}%`, background: ghost }}
              />
            ))}
          </div>
        ) : shape === "heat" ? (
          <div className="grid grid-cols-[repeat(8,minmax(0,1fr))] gap-[3px]">
            {Array.from({ length: 56 }, (_, k) => (
              <span key={k} className="h-[22px] rounded-[4px]" style={{ background: ghost }} />
            ))}
          </div>
        ) : shape === "post" ? (
          <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3.5">
            <span className="aspect-[9/16] w-full rounded-[12px]" style={{ background: ghost }} />
            <span className="space-y-2.5 pt-1">
              <span className="block h-3 w-4/5 rounded" style={{ background: ghost }} />
              <span className="block h-3 w-3/5 rounded" style={{ background: ghost }} />
              <span className="block h-3 w-2/5 rounded" style={{ background: ghost }} />
            </span>
          </div>
        ) : shape === "scatter" ? (
          <svg viewBox="0 0 300 140" className="block h-auto w-full">
            <line x1="36" x2="290" y1="120" y2="120" stroke="var(--via-data-axis)" />
            <line x1="36" x2="36" y1="10" y2="120" stroke="var(--via-data-axis)" />
            {[
              [110, 40],
              [190, 96],
              [250, 88],
            ].map(([x, y]) => (
              <circle key={x} cx={x} cy={y} r={7} fill={ghost} />
            ))}
          </svg>
        ) : (
          <svg viewBox="0 0 640 160" className="block h-auto w-full">
            <line x1="0" x2="640" y1="150" y2="150" stroke="var(--via-data-axis)" />
            <path
              d="M0 130 C120 126 220 112 320 96 S520 58 640 40"
              fill="none"
              stroke={ghost}
              strokeWidth={3}
            />
          </svg>
        )}
      </div>
      <p className="mt-auto pt-4 text-[0.8125rem] text-[var(--via-text-soft)]">{need}</p>
    </section>
  );
}

const HEAT_COLORS = [
  "var(--via-navy-04)",
  "var(--via-heat-1)",
  "var(--via-heat-2)",
  "var(--via-heat-3)",
  "var(--via-heat-4)",
  "var(--via-heat-5)",
];

function HeatRow({
  label,
  levels,
  posted,
  row,
}: {
  label: string;
  levels: number[];
  posted: Set<string>;
  row: number;
}) {
  return (
    <>
      <span className="self-center text-[var(--via-text-soft)]">{label}</span>
      {levels.map((level, c) => {
        const mine = posted.has(`${row}-${c}`);
        return (
          <span
            key={c}
            title={`${label} ${c * 3}h–${c * 3 + 3}h${mine ? " · você publicou" : ""}`}
            className="h-[26px] rounded-[4px]"
            style={{
              background: HEAT_COLORS[level],
              boxShadow: mine
                ? "inset 0 0 0 2px var(--via-surface), 0 0 0 2px var(--via-navy)"
                : undefined,
            }}
          />
        );
      })}
    </>
  );
}

/** Ação de texto no pé de um card ("Concorrentes (2) →"). */
export function CardLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} className="-ml-1">
      {children}
      <ArrowRight aria-hidden="true" />
    </Button>
  );
}
