import { Film } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useInView } from "@/components/video/hub-route-tile";
import { useSignedPaths } from "@/components/video/production-studio";
import type { DirectorJob } from "@/hooks/use-director-jobs";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Capa de um vídeo: o que a pessoa reconhece de relance. Com o vídeo pronto, é
// o próprio vídeo (avatar e agente não têm quadro de referência); antes disso,
// o primeiro quadro. Com `play`, toca mudo. O vídeo só carrega ao aparecer.
// ---------------------------------------------------------------------------

/** O título que a pessoa reconhece; `||`: o briefing do hub pode vir com campos vazios. */
export function jobTitle(job: DirectorJob): string {
  return (
    job.plan?.concept ||
    job.brief.smp ||
    job.brief.numero_heroi ||
    job.brief.objetivo ||
    job.brief.title ||
    "Vídeo sem título"
  );
}

function coverPaths(job: DirectorJob) {
  const { edited, final, keyframes, videos } = job.artifacts;
  return {
    video: edited?.path ?? final ?? videos?.[0]?.path ?? null,
    image: [...(keyframes ?? [])].sort((a, b) => a.shot - b.shot)[0]?.path ?? null,
  };
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;

export function JobCover({
  job,
  play = false,
  className,
}: {
  job: DirectorJob;
  play?: boolean;
  className?: string;
}) {
  const { video, image } = coverPaths(job);
  const urls = useSignedPaths([video, image].filter((p): p is string => Boolean(p)));
  const videoUrl = video ? urls[video] : undefined;
  const imageUrl = image ? urls[image] : undefined;

  const { ref: box, seen } = useInView<HTMLSpanElement>();
  const player = useRef<HTMLVideoElement>(null);
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    const node = player.current;
    if (!node) return;
    if (play) void node.play().catch(() => undefined);
    else {
      node.pause();
      if (node.currentTime > 0.5) node.currentTime = 0.5;
    }
  }, [play]);

  return (
    <span
      ref={box}
      className={cn(
        "relative block aspect-[9/16] overflow-hidden bg-[var(--via-navy-06)]",
        className,
      )}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      {videoUrl && seen ? (
        // #t: a capa é o quadro de meio segundo, porque o primeiro costuma ser preto
        <video
          ref={player}
          src={`${videoUrl}#t=0.5`}
          muted
          loop
          playsInline
          preload="metadata"
          tabIndex={-1}
          onLoadedMetadata={(e) => setSeconds(e.currentTarget.duration)}
          className={cn(
            "absolute inset-0 size-full object-cover",
            imageUrl && !play && "opacity-0",
          )}
        />
      ) : null}
      {!videoUrl && !imageUrl ? (
        <Film
          className="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 text-[var(--via-text-faint)]"
          aria-hidden="true"
        />
      ) : null}
      {seconds && Number.isFinite(seconds) ? (
        <span className="absolute bottom-2 right-2 hidden rounded-full bg-black/60 px-2 py-0.5 font-mono text-xs text-white backdrop-blur-sm @[120px]:block">
          {clock(seconds)}
        </span>
      ) : null}
    </span>
  );
}
