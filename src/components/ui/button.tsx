import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// DS SUBIDO: pílula navy, 13px/500, sem subir no hover, resposta no APERTAR (110ms),
// foco por fio neutro de 2px com folga — nunca halo azul.
const buttonVariants = cva(
  "ds-btn inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-[0.8125rem] font-medium tracking-[-0.008em] cursor-pointer transition-all duration-[var(--via-dur)] ease-[var(--via-ease-snap)] active:scale-[0.985] active:duration-[var(--via-dur-press)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-[var(--via-gray-100)] disabled:bg-none disabled:text-[var(--via-text-disabled)] disabled:border-[var(--via-border-soft)] disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "ds-btn--primary bg-[linear-gradient(180deg,var(--via-navy),var(--via-navy-deep))] text-white shadow-[0_1px_0_var(--via-edge-hi)_inset,0_6px_16px_-10px_var(--via-shadow-ink-20)] hover:brightness-110",
        destructive:
          "ds-btn--destructive bg-destructive text-white hover:bg-[var(--via-coral-deep)]",
        outline:
          "ds-btn--outline border border-[var(--via-border)] bg-transparent text-[var(--via-text-primary)] hover:bg-[var(--via-navy-06)] hover:border-[var(--via-navy-20)]",
        secondary:
          "ds-btn--secondary bg-secondary text-secondary-foreground hover:bg-[var(--via-navy-06)]",
        ghost:
          "ds-btn--ghost text-[var(--via-text-body)] hover:bg-[var(--via-navy-06)] hover:text-[var(--via-text-primary)]",
        link: "ds-btn--link text-primary underline underline-offset-4",
        // sobre mídia (palco de vídeo, tela cheia): vidro escuro, texto branco
        overlay: "bg-black/55 text-white backdrop-blur-sm hover:bg-black/70",
      },
      size: {
        default: "ds-btn--md h-9 px-[18px]",
        sm: "ds-btn--sm h-8 px-4",
        lg: "ds-btn--lg h-11 px-7",
        icon: "ds-btn--icon h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
