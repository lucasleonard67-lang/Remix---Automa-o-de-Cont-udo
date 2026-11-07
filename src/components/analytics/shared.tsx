import type { ReactNode } from "react";

import { BrandIcon } from "@/components/brand-icon";
import { channelBrand } from "@/lib/brands";
import { cn } from "@/lib/utils";
import { sparkPath } from "@/lib/zernio-analytics";

import { platformLabel } from "./motion";

// ---------------------------------------------------------------------------
// Peças compartilhadas do módulo Desempenho (Dashboard) e do bloco Resultado
// (peça). Movimento segue o design system: count-up 600ms só na primeira
// pintura; sparkline desenha por stroke-dashoffset em 700ms; nada pulsa.
// ---------------------------------------------------------------------------

/** Plataforma do Zernio ("twitter" é o X) → ícone colorido oficial, ou nada. */
export function PlatformMark({
  platform,
  className,
  label,
}: {
  platform: string | null | undefined;
  className?: string;
  /** Rótulo acessível quando o nome não está escrito ao lado. */
  label?: boolean;
}) {
  if (!platform) return null;
  const brand = channelBrand(platform === "twitter" ? "x_" : platform);
  if (!brand) return null;
  return (
    <BrandIcon
      name={brand}
      className={cn("size-4 shrink-0", className)}
      label={label ? platformLabel(platform) : undefined}
    />
  );
}

/** Sparkline inline (`.via-spark`) com desenho da linha em 700ms. */
export function Sparkline({
  values,
  down = false,
  className,
}: {
  values: Array<number | null>;
  down?: boolean;
  className?: string;
}) {
  const paths = sparkPath(values, 120, 34);
  if (!paths) return null;
  return (
    <svg
      className={cn("via-spark", down && "via-spark--down", className)}
      viewBox="0 0 120 34"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path className="via-spark__area" d={paths.area} />
      <path d={paths.line} pathLength={1} className="via-spark__line" />
    </svg>
  );
}

/** Etiqueta de seção (mono, caixa alta) + título curto — hierarquia sem card. */
export function BlockHeading({
  eyebrow,
  title,
  aside,
  id,
}: {
  eyebrow: string;
  title?: string;
  aside?: ReactNode;
  id?: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div>
        <p className="via-eyebrow">{eyebrow}</p>
        {title ? (
          <h3 id={id} className="mt-1 text-base font-medium text-[var(--via-text-primary)]">
            {title}
          </h3>
        ) : null}
      </div>
      {aside}
    </div>
  );
}

/** Frase de estado (sem dado, carregando, erro) — uma linha, com a ação quando houver. */
export function StateLine({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-sm text-[var(--via-text-muted)]", className)} role="status">
      {children}
    </p>
  );
}
