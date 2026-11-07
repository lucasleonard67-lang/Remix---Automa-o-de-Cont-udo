import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Pill do kit DS SUBIDO: 11px, peso 500, tracking -0.004em, minúscula, nowrap.
// Sem caps lock, sem bolinha decorativa. Status genérico ("pronto", "ativa") é
// navy — nunca semáforo verde/vermelho; churn/erro em coral.
const badgeVariants = cva(
  "ds-pill inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[0.6875rem] font-medium lowercase leading-[1.4] tracking-[-0.004em] transition-colors focus:outline-none focus-visible:shadow-[var(--via-shadow-focus)]",
  {
    variants: {
      variant: {
        default:
          "ds-pill--default border-transparent bg-[var(--via-navy-06)] text-[var(--via-navy)]",
        secondary:
          "ds-pill--secondary border-transparent bg-[var(--via-gray-100)] text-[var(--via-text-muted)]",
        destructive:
          "ds-pill--churn border-transparent bg-[var(--via-coral-bg,var(--via-gray-100))] text-[var(--via-coral-dark)]",
        outline: "ds-pill--outline border-[var(--via-border)] text-[var(--via-text-body)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
