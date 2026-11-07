import { useEffect, useState } from "react";

import { prefersReducedMotion } from "@/components/dashboard/motion";
import { STAGE_LABELS, type StageState, type StageView } from "@/components/criar/job-stage";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Progresso de uma geração na linguagem do kit (mesmo vocabulário de
// "Primeiros passos"): anel que desenha até a fração percorrida da esteira e
// quatro segmentos com o brilho do kit no segmento em andamento. Só
// transform/opacity; o anel anima por stroke-dashoffset (700ms,
// --via-ease-out), uma vez, na primeira pintura.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Anel
// ---------------------------------------------------------------------------

export function ProgressRing({
  fraction,
  size = "md",
  label,
  children,
  failed,
}: {
  fraction: number;
  size?: "sm" | "md";
  label: string;
  children?: React.ReactNode;
  failed?: boolean;
}) {
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const [mounted, setMounted] = useState(() => prefersReducedMotion());
  useEffect(() => {
    if (mounted) return;
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, [mounted]);
  const offset = circumference * (1 - (mounted ? fraction : 0));

  return (
    <div
      className={cn("relative shrink-0", size === "sm" ? "size-10" : "size-16")}
      role="img"
      aria-label={label}
    >
      <svg viewBox="0 0 56 56" className="size-full -rotate-90">
        <circle
          cx="28"
          cy="28"
          r={radius}
          fill="none"
          stroke="var(--via-navy-08)"
          strokeWidth="4"
        />
        <circle
          cx="28"
          cy="28"
          r={radius}
          fill="none"
          stroke={failed ? "var(--via-coral)" : "var(--via-navy)"}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="ce-ring"
        />
      </svg>
      {children ? (
        <span className="absolute inset-0 flex items-center justify-center">{children}</span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Segmentos
// ---------------------------------------------------------------------------

export function StageSegments({
  views,
  withLabels,
  className,
}: {
  views: StageView[];
  withLabels?: boolean;
  className?: string;
}) {
  return (
    <ol className={cn("flex gap-1.5", className)} aria-label="Etapas da geração">
      {views.map(({ stage, state }) => (
        <li
          key={stage}
          className="min-w-0 flex-1"
          aria-current={state === "running" || state === "waiting" ? "step" : undefined}
        >
          <span
            className={cn(
              "relative block h-1.5 overflow-hidden rounded-full",
              state === "done" && "bg-[var(--via-navy)]",
              state === "running" && "ce-segment-current bg-[var(--via-navy-20)]",
              state === "waiting" && "bg-[var(--via-navy-20)]",
              state === "failed" && "bg-[var(--via-coral)]",
              state === "stopped" && "bg-[var(--via-navy-12)]",
              state === "pending" && "bg-[var(--via-navy-08)]",
            )}
          />
          {withLabels ? (
            <span
              className={cn(
                "mt-1.5 block truncate text-xs leading-tight",
                state === "pending" || state === "stopped"
                  ? "text-[var(--via-text-faint)]"
                  : state === "failed"
                    ? "text-[var(--via-coral-dark)]"
                    : state === "done"
                      ? "text-[var(--via-text-muted)]"
                      : "font-medium text-[var(--via-text-primary)]",
              )}
            >
              {STAGE_LABELS[stage]}
            </span>
          ) : (
            <span className="sr-only">
              {STAGE_LABELS[stage]}: {STATE_SR[state]}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

const STATE_SR: Record<StageState, string> = {
  pending: "pendente",
  running: "em andamento",
  waiting: "aguardando você",
  done: "concluída",
  failed: "falhou",
  stopped: "interrompida",
};
