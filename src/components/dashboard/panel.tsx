import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Módulo do painel do Início: card branco do design system (`via-tile`), com
// rótulo curto, um detalhe à direita e, no pé, links que LEVAM a outra página —
// nada abre ou fecha no lugar. Na mesma linha da grade os vizinhos esticam
// juntos e o pé fica alinhado embaixo. Por dentro, os itens são `PANEL_ITEM`.
// ---------------------------------------------------------------------------

/** Item dentro de um card: fundo do canvas, sem borda nem card sobre card. */
export const PANEL_ITEM = "rounded-[var(--via-radius-md)] bg-[var(--via-gray-50)] p-3";

export function Panel({
  label,
  aside,
  footer,
  className,
  children,
  testId,
}: {
  label: string;
  aside?: ReactNode;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section
      className={cn("via-tile flex min-w-0 flex-col !p-5", className)}
      aria-label={label}
      data-testid={testId}
    >
      <header className="flex min-h-6 items-center justify-between gap-3">
        <p className="via-eyebrow truncate">{label}</p>
        {aside}
      </header>
      <div className="mt-4 min-h-0 flex-1">{children}</div>
      {footer ? <footer className="mt-4 flex items-center gap-4">{footer}</footer> : null}
    </section>
  );
}

/** "Ver tudo →": sempre navegação, nunca expansão no lugar. */
export function PanelLink({
  to,
  children,
}: {
  to: "/videos" | "/biblioteca" | "/radar" | "/desempenho";
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 text-sm font-medium text-[var(--via-text-primary)] transition-[gap] duration-[var(--via-dur)] hover:gap-1.5 focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]"
    >
      {children}
      <ArrowRight className="size-3.5" aria-hidden="true" />
    </Link>
  );
}
