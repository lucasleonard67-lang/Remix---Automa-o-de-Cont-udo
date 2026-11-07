import * as React from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

// Chip de escolha (liga/desliga) · pill canônica VIA. Marcado = navy cheio + ✓;
// desmarcado = contorno. A diferença não pode depender só de um tom de fundo:
// "formatos por conta" com bg-primary/10 era lido como marcado quando não estava.
export interface ChoiceChipProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "type"
> {
  selected: boolean;
  /** Ícone à esquerda quando desmarcado (marcado mostra sempre o ✓). */
  icon?: React.ReactNode;
}

export const ChoiceChip = React.forwardRef<HTMLButtonElement, ChoiceChipProps>(
  ({ selected, icon, className, children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-pressed={selected}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium leading-[1.4] tracking-[-0.004em] transition-[background-color,border-color,color,transform] duration-200 ease-[cubic-bezier(.2,.7,.2,1)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)] active:scale-[0.98] disabled:cursor-not-allowed disabled:text-[var(--via-text-disabled)] [&_svg]:size-3.5 [&_svg]:shrink-0",
        selected
          ? "border-[var(--via-navy)] bg-[var(--via-navy)] text-white [--via-text-primary:white]"
          : "border-[var(--via-border)] bg-transparent text-[var(--via-text-muted)] hover:border-[var(--via-navy-30)] hover:text-[var(--via-text-primary)]",
        className,
      )}
      {...props}
    >
      {selected ? <Check aria-hidden="true" /> : icon}
      {children}
    </button>
  ),
);
ChoiceChip.displayName = "ChoiceChip";
