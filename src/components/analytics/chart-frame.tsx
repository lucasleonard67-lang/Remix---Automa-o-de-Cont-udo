import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Espaço do gráfico quando ainda não há série: um card plano do DS (hairline,
// sem sombra), mesma altura do PerformanceChart, com a frase e UMA ação
// centralizadas. Sem grade falsa nem linha-guia — nada que pareça dado.
// ---------------------------------------------------------------------------

export function ChartFrame({
  children,
  minHeight = 240,
}: {
  children: ReactNode;
  minHeight?: number;
}) {
  return (
    <div
      className="ds-card flex w-full flex-col items-center justify-center gap-3 rounded-[var(--via-radius-lg)] border border-[var(--via-border-soft)] bg-[var(--via-surface)] px-6 text-center"
      style={{ minHeight }}
    >
      {children}
    </div>
  );
}
