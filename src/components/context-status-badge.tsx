import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { ContextItemStatus } from "@/hooks/use-context-items";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<
  ContextItemStatus,
  { label: string; icon: typeof Loader2; className: string; iconClassName?: string }
> = {
  processing: {
    label: "Processando",
    icon: Loader2,
    className: "border-transparent bg-muted text-muted-foreground",
    iconClassName: "animate-spin",
  },
  ready: {
    label: "Pronto",
    icon: CheckCircle2,
    className:
      "border-[0.5px] border-[var(--via-border-soft)] bg-[var(--via-navy-04)] text-[var(--via-text-body)]",
  },
  error: {
    label: "Falhou",
    icon: AlertCircle,
    className: "border-transparent bg-destructive/15 text-destructive",
  },
};

/** Indicador do status de ingestão de um `context_item` (processing/ready/error). */
export function ContextStatusBadge({ status }: { status: ContextItemStatus }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.processing;
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 font-medium", config.className)}>
      <Icon className={cn("size-3", config.iconClassName)} aria-hidden="true" />
      {config.label}
    </Badge>
  );
}
