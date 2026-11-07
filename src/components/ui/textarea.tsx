import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "ds-field flex min-h-[60px] w-full rounded-[var(--via-radius-md)] border border-[var(--via-border)] bg-[var(--via-surface)] px-3.5 py-2 text-base transition-[box-shadow,border-color] duration-200 placeholder:text-[var(--via-text-faint)] focus-visible:outline-none focus-visible:border-[var(--via-navy-30)] focus-visible:shadow-[var(--via-shadow-focus)] disabled:cursor-not-allowed disabled:bg-[var(--via-gray-50)] disabled:text-[var(--via-text-faint)] md:text-sm dark:bg-transparent",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
