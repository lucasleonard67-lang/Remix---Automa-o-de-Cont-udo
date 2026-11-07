import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Retorno de ação no lugar onde ela aconteceu (heurística 1 de Nielsen:
// visibilidade do estado do sistema). O botão vira "✓ Salvo" por um instante,
// o item que mudou de estado acende uma vez, o que falhou balança. As
// animações moram em styles.css (.ce-check, .ce-glow, .ce-shake); os hooks
// que ligam e desligam cada uma, em hooks/use-feedback.ts.
// ---------------------------------------------------------------------------

/** Check que se desenha. Herda a cor do texto. */
export function SuccessCheck({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={cn("ce-check ce-check-pop size-4 shrink-0", className)}
    >
      <path
        d="M3.5 8.5l3 3 6-7"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Conteúdo de botão que confirma a ação: enquanto `done`, troca o rótulo por
 * check + `doneLabel`. Use dentro do `Button` compartilhado.
 */
export function FeedbackLabel({
  done,
  doneLabel,
  children,
}: {
  done: boolean;
  doneLabel: string;
  children: ReactNode;
}) {
  if (!done) return <>{children}</>;
  return (
    <span className="inline-flex items-center gap-1.5" role="status">
      <SuccessCheck />
      {doneLabel}
    </span>
  );
}
