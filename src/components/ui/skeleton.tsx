import { cn } from "@/lib/utils";

// Varredura dupla de luz do kit (`.ce-skeleton`, 1,8s) em vez do pulse.
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("ce-skeleton rounded-[10px]", className)} {...props} />;
}

export { Skeleton };
