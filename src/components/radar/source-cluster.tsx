import type { ReactNode } from "react";
import "@/components/analytics/analytics.css";

import { FeedIcon } from "@/components/radar/feed-icon";

// ---------------------------------------------------------------------------
// Vazios do Radar no padrão do kit: painel de vidro com UMA frase e UMA ação.
// `SourceCluster` é o mesmo conjunto flutuante de `NetworkCluster`, só que com
// os favicons de portais sugeridos (fallback: ícone RSS). Decorativo — a frase
// e o botão dizem o que fazer; os nomes vão no aria-label.
// ---------------------------------------------------------------------------

const SUGGESTED: Array<{ label: string; url: string; offset: string; delay: string }> = [
  { label: "G1", url: "https://g1.globo.com/", offset: "translateY(6px)", delay: "0s" },
  {
    label: "Folha",
    url: "https://www.folha.uol.com.br/",
    offset: "translateY(-6px)",
    delay: "-1.4s",
  },
  {
    label: "Canaltech",
    url: "https://canaltech.com.br/",
    offset: "translateY(2px)",
    delay: "-2.8s",
  },
  { label: "Tecnoblog", url: "https://tecnoblog.net/", offset: "translateY(-4px)", delay: "-4.2s" },
  {
    label: "TecMundo",
    url: "https://www.tecmundo.com.br/",
    offset: "translateY(5px)",
    delay: "-5.6s",
  },
];

export function SourceCluster() {
  return (
    <ul
      className="flex items-center justify-center gap-3"
      role="img"
      aria-label={`Fontes sugeridas: ${SUGGESTED.map((s) => s.label).join(", ")}`}
    >
      {SUGGESTED.map((source) => (
        <li
          key={source.url}
          aria-hidden="true"
          className="ce-float"
          style={{ transform: source.offset, animationDelay: source.delay }}
        >
          <FeedIcon url={source.url} className="!size-12 !rounded-[14px]" iconClassName="size-6" />
        </li>
      ))}
    </ul>
  );
}

/** Painel de vidro do kit para lista sem conteúdo: uma frase e uma ação. */
export function RadarEmpty({
  text,
  children,
  cluster = false,
}: {
  text: string;
  children?: ReactNode;
  cluster?: boolean;
}) {
  return (
    <div
      className="via-tile via-tile--atmos ce-chart-empty flex flex-col items-center gap-4 !px-6 !py-10 text-center"
      role="status"
    >
      {cluster ? <SourceCluster /> : null}
      <p className="max-w-sm text-sm text-[var(--via-text-muted)]">{text}</p>
      {children}
    </div>
  );
}
