import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Trilho de notas de uma notícia: duas micro-barras (`.via-bar`) com rótulo e
// número tabular — "Marca" (casa com a marca) e "Tendência" (assunto em alta).
// Nunca número cru solto: a barra dá a proporção, o selo dá a leitura rápida.
// ---------------------------------------------------------------------------

export function ScoreRail({
  relevance,
  virality,
  className,
}: {
  relevance: number | null | undefined;
  virality: number | null | undefined;
  className?: string;
}) {
  // antes do SQL de notas, as colunas nem vêm no select → undefined vira "sem nota"
  relevance = relevance ?? null;
  virality = virality ?? null;
  if (relevance === null && virality === null) {
    return <p className={cn("text-xs text-[var(--via-text-faint)]", className)}>Sem nota ainda</p>;
  }
  return (
    <dl className={cn("grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-1", className)}>
      <ScoreLine label="Marca" value={relevance} missing="depende da marca" />
      <ScoreLine label="Tendência" value={virality} />
    </dl>
  );
}

function ScoreLine({
  label,
  value,
  missing = "sem nota",
}: {
  label: string;
  value: number | null;
  missing?: string;
}) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--via-text-muted)]">
          {label}
        </dt>
        <dd
          className={cn(
            "text-xs font-medium tabular-nums",
            value === null
              ? "text-[var(--via-text-faint)]"
              : pct >= 75
                ? "text-[var(--via-text-primary)]"
                : "text-[var(--via-text-muted)]",
          )}
        >
          {value === null ? missing : value}
        </dd>
      </div>
      <span
        className="via-bar mt-1 !max-w-none"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value ?? undefined}
      >
        <span className="via-bar__fill" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}
