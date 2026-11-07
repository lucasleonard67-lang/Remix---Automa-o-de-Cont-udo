import { Rss } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Favicon da fonte no poço de ícone do kit (`ce-tile-well`). É a única cor
// permitida no Radar: o ícone oficial do portal, uma vez por linha/ladrilho.
// Sem favicon (ou se a imagem falhar), cai no ícone RSS neutro.
// ---------------------------------------------------------------------------

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function faviconUrl(url: string): string | null {
  const host = hostOf(url);
  return host
    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`
    : null;
}

export function FeedIcon({
  url,
  className,
  iconClassName = "size-5",
}: {
  url: string | null | undefined;
  className?: string;
  iconClassName?: string;
}) {
  const [broken, setBroken] = useState(false);
  const src = url ? faviconUrl(url) : null;
  return (
    <span className={cn("ce-tile-well overflow-hidden", className)} aria-hidden="true">
      {src && !broken ? (
        <img
          src={src}
          alt=""
          width={20}
          height={20}
          loading="lazy"
          className={iconClassName}
          onError={() => setBroken(true)}
        />
      ) : (
        <Rss className={cn("text-[var(--via-text-muted)]", iconClassName)} />
      )}
    </span>
  );
}
