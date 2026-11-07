import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "ds-field flex h-9 w-full rounded-[var(--via-radius-md)] border border-[var(--via-border)] bg-[var(--via-surface)] px-3.5 py-1 text-base transition-[box-shadow,border-color] duration-200 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-[var(--via-text-faint)] focus-visible:outline-none focus-visible:border-[var(--via-navy-30)] focus-visible:shadow-[var(--via-shadow-focus)] disabled:cursor-not-allowed disabled:bg-[var(--via-gray-50)] disabled:text-[var(--via-text-faint)] md:text-sm dark:bg-transparent",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
