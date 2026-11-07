import { format, parseISO } from "date-fns";
import { ownPostThumbPath, thumbSource, useSignedThumbs } from "@/lib/thumbs";
import { ptBR } from "date-fns/locale";
import { ExternalLink } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useZernioPostTimeline } from "@/hooks/use-zernio";
import { humanizeError } from "@/lib/humanize-error";
import {
  MEDIA_TYPE_LABELS,
  METRICS,
  METRIC_LABELS,
  formatNumber,
  type Metric,
  type TimelinePoint,
  type ZernioPost,
} from "@/lib/zernio-analytics";

import { platformLabel, prefersReducedMotion } from "./motion";
import { PlatformMark, StateLine } from "./shared";

// Painel lateral de um post: miniatura, texto, métricas, link e a linha do
// tempo (post-timeline). Abre a partir do gráfico, do melhor post e da tabela.

export function PostSheet({ post, onClose }: { post: ZernioPost | null; onClose: () => void }) {
  return (
    <Sheet open={post !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        {post ? <PostDetails post={post} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function PostDetails({ post }: { post: ZernioPost }) {
  const signed = useSignedThumbs([ownPostThumbPath(post.id)]).data ?? {};
  const direct = thumbSource(post.thumbnailUrl);
  const thumb =
    signed[ownPostThumbPath(post.id)] ?? (direct && "url" in direct ? direct.url : null);
  const dateText = post.date
    ? format(parseISO(post.date), "d 'de' MMMM 'às' HH:mm", { locale: ptBR })
    : "sem data";
  const pending = post.syncStatus === "pending";

  return (
    <div className="space-y-6">
      <SheetHeader className="space-y-1 text-left">
        <p className="via-eyebrow flex items-center gap-2">
          <PlatformMark platform={post.platform} className="size-3.5" />
          {platformLabel(post.platform)}
          {post.accountUsername ? <span>· @{post.accountUsername}</span> : null}
        </p>
        <SheetTitle className="text-base font-medium text-[var(--via-text-primary)]">
          {MEDIA_TYPE_LABELS[post.mediaType] === "—"
            ? "Publicação"
            : MEDIA_TYPE_LABELS[post.mediaType]}{" "}
          <span className="font-normal text-[var(--via-text-muted)]">· {dateText}</span>
        </SheetTitle>
        <SheetDescription className="sr-only">Métricas e evolução da publicação.</SheetDescription>
      </SheetHeader>

      <div className="flex gap-4">
        {thumb ? (
          <img
            src={thumb}
            alt=""
            className="size-24 shrink-0 rounded-[var(--via-radius-md)] object-cover"
            loading="lazy"
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        ) : null}
        <p className="line-clamp-6 whitespace-pre-line text-sm leading-relaxed text-[var(--via-text-body)]">
          {post.content || "Sem texto."}
        </p>
      </div>

      {pending ? (
        <StateLine>Métricas chegam em até 48h depois da publicação.</StateLine>
      ) : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          {METRICS.map((metric) => (
            <div key={metric}>
              <dt className="via-metric__label">{METRIC_LABELS[metric]}</dt>
              <dd className="mt-0.5 text-lg font-medium tabular-nums text-[var(--via-text-primary)]">
                {formatNumber(post.analytics[metric], "full")}
              </dd>
            </div>
          ))}
          {post.analytics.engagementRate !== null ? (
            <div>
              <dt className="via-metric__label">Engajamento</dt>
              <dd className="mt-0.5 text-lg font-medium tabular-nums text-[var(--via-text-primary)]">
                {post.analytics.engagementRate.toLocaleString("pt-BR", {
                  maximumFractionDigits: 1,
                })}
                %
              </dd>
            </div>
          ) : null}
        </dl>
      )}

      {post.url ? (
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--via-text-primary)] underline-offset-4 hover:underline"
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          Ver publicação
        </a>
      ) : null}

      <PostTimeline postId={post.id} pending={pending} />
    </div>
  );
}

const TIMELINE_PRIORITY: Metric[] = ["views", "reach", "likes", "impressions", "saves", "comments"];

function PostTimeline({ postId, pending }: { postId: string; pending: boolean }) {
  const query = useZernioPostTimeline(pending ? null : postId);
  const points = query.data ?? [];
  const metric = TIMELINE_PRIORITY.find((m) => points.filter((p) => p[m] !== null).length >= 2);

  return (
    <section className="space-y-2" aria-labelledby={`timeline-${postId}`}>
      <p id={`timeline-${postId}`} className="via-eyebrow">
        Evolução
      </p>
      {pending ? (
        <StateLine>A linha do tempo aparece quando as métricas chegarem.</StateLine>
      ) : query.isLoading ? (
        <Skeleton className="h-[140px] w-full" />
      ) : query.isError ? (
        <StateLine>{humanizeError(query.error.message)} Recarregue a página.</StateLine>
      ) : !metric ? (
        <StateLine>Ainda sem histórico — o Zernio registra um ponto por dia.</StateLine>
      ) : (
        <TimelineChart points={points} metric={metric} />
      )}
    </section>
  );
}

function TimelineChart({ points, metric }: { points: TimelinePoint[]; metric: Metric }) {
  const animate = !prefersReducedMotion();
  return (
    <figure className="space-y-1">
      <figcaption className="text-xs text-[var(--via-text-muted)]">
        {METRIC_LABELS[metric]} acumulados por dia
      </figcaption>
      <div className="h-[140px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={{ stroke: "var(--via-data-axis)" }}
              tick={{ fill: "var(--via-text-muted)", fontSize: 11 }}
              tickFormatter={(value: string) => format(parseISO(value), "d MMM", { locale: ptBR })}
              minTickGap={24}
            />
            <YAxis
              width={44}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--via-text-muted)", fontSize: 11 }}
              tickFormatter={(value: number) => formatNumber(value)}
              domain={["auto", "auto"]}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ stroke: "var(--via-data-axis)", strokeDasharray: "3 3" }}
              wrapperStyle={{ outline: "none" }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as TimelinePoint | undefined;
                if (!active || !row) return null;
                return (
                  <div
                    className="rounded-[var(--via-radius-md)] px-3 py-2 text-xs text-white"
                    style={{ background: "var(--via-navy)" }}
                  >
                    <p className="font-medium">
                      {format(parseISO(row.date), "d 'de' MMM", { locale: ptBR })}
                    </p>
                    <p className="mt-0.5 tabular-nums">
                      {formatNumber(row[metric], "full")} {METRIC_LABELS[metric].toLowerCase()}
                    </p>
                  </div>
                );
              }}
            />
            <Line
              type="monotone"
              dataKey={metric}
              stroke="var(--via-data-1)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: "var(--via-surface)", strokeWidth: 2 }}
              connectNulls
              isAnimationActive={animate}
              animationDuration={700}
              animationEasing="ease-out"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
