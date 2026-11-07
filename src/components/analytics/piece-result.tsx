import { ExternalLink } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { useSecretStatus } from "@/hooks/use-app-settings";
import { usePublishedPost } from "@/hooks/use-published-posts";
import { useZernioPost, useZernioPosts } from "@/hooks/use-zernio";
import { humanizeError } from "@/lib/humanize-error";
import { cn } from "@/lib/utils";
import {
  AVERAGE_BAND_LABELS,
  MEDIA_TYPE_LABELS,
  METRIC_LABELS,
  compareToAverage,
  formatNumber,
  type Metric,
  type ZernioPost,
} from "@/lib/zernio-analytics";

import { useCountUp } from "./motion";
import { BlockHeading, StateLine } from "./shared";

import "./analytics.css";

// Bloco "Resultado" da peça publicada: métricas do post no Zernio e a etiqueta
// acima/na/abaixo da média dos últimos 30 dias do mesmo formato.

const RESULT_METRICS: Metric[] = ["reach", "likes", "comments", "saves", "shares", "views"];

export function PieceResult({ pieceId }: { pieceId: string }) {
  const secretStatus = useSecretStatus();
  const keyConfigured = secretStatus.data?.includes("ZERNIO_API_KEY") ?? false;
  const publishedPost = usePublishedPost(pieceId);
  const zernioPostId =
    publishedPost.data && ["published", "partial"].includes(publishedPost.data.status)
      ? publishedPost.data.zernio_post_id
      : null;

  if (!keyConfigured || !zernioPostId) return null;
  return (
    <ResultBlock zernioPostId={zernioPostId} publicUrl={publishedPost.data?.public_url ?? null} />
  );
}

function ResultBlock({
  zernioPostId,
  publicUrl,
}: {
  zernioPostId: string;
  publicUrl: string | null;
}) {
  const postQuery = useZernioPost(zernioPostId);
  const peersQuery = useZernioPosts(30);
  const post = postQuery.data ?? null;
  const comparison = post ? compareToAverage(post, peersQuery.data?.posts ?? []) : null;

  return (
    <section
      className="space-y-4 border-t border-[var(--via-border-soft)] pt-5"
      aria-labelledby="resultado-title"
    >
      <BlockHeading
        eyebrow="Resultado"
        title="Como a peça foi"
        id="resultado-title"
        aside={comparison ? <BandTag band={comparison.band} /> : null}
      />

      {postQuery.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : postQuery.isError ? (
        <StateLine>{humanizeError(postQuery.error.message)} Recarregue a página.</StateLine>
      ) : !post ? (
        <StateLine>O Zernio ainda não devolveu métricas desta publicação.</StateLine>
      ) : post.syncStatus === "pending" ? (
        <StateLine>Métricas chegam em até 48h depois da publicação.</StateLine>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-x-4 gap-y-3">
            {RESULT_METRICS.map((metric) => (
              <ResultValue
                key={metric}
                label={METRIC_LABELS[metric]}
                value={post.analytics[metric]}
              />
            ))}
          </dl>
          {comparison ? (
            <AverageBar post={post} ratio={comparison.ratio} sample={comparison.sample} />
          ) : null}
        </>
      )}

      {post?.url || publicUrl ? (
        <a
          href={post?.url ?? publicUrl ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--via-text-primary)] underline-offset-4 hover:underline"
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          Ver publicação
        </a>
      ) : null}
    </section>
  );
}

function ResultValue({ label, value }: { label: string; value: number | null }) {
  const animated = useCountUp(value);
  return (
    <div>
      <dt className="text-xs text-[var(--via-text-muted)]">{label}</dt>
      <dd className="text-lg font-medium tabular-nums text-[var(--via-text-primary)]">
        {value === null ? "—" : formatNumber(animated ?? 0, "full")}
      </dd>
    </div>
  );
}

function BandTag({ band }: { band: keyof typeof AVERAGE_BAND_LABELS }) {
  return (
    <span
      className={cn(
        "via-delta rounded-full border border-[var(--via-border)] px-2.5 py-0.5 text-xs",
        band === "above" && "via-delta--up",
        band === "below" && "via-delta--down",
        band === "average" && "via-delta--flat",
      )}
    >
      {AVERAGE_BAND_LABELS[band]}
    </span>
  );
}

/** Micro-barra: engajamento da peça em relação à média do formato (barra cheia = 2× a média). */
function AverageBar({ post, ratio, sample }: { post: ZernioPost; ratio: number; sample: number }) {
  const width = Math.max(0.04, Math.min(1, ratio / 2));
  const format = MEDIA_TYPE_LABELS[post.mediaType].toLowerCase();
  return (
    <div className="space-y-1.5">
      <span className="via-bar">
        <span
          className={cn("via-bar__fill via-bar__fill--grow", ratio <= 0.8 && "via-bar__fill--down")}
          style={{ width: `${width * 100}%` }}
        />
      </span>
      <p className="text-xs text-[var(--via-text-muted)]">
        {ratio.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}× a média de {sample}{" "}
        {sample === 1 ? "peça" : "peças"} de {format === "—" ? "mesmo formato" : format} nos últimos
        30 dias.
      </p>
    </div>
  );
}
