import { SuccessCheck } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Indicador de conexão de uma integração/provedor, lido do mesmo lugar em todo
// o app (Ajustes → Integrações, portão de geração): ponto navy cheio =
// conectado; contorno = não conectado. `fresh` troca o ponto pelo check animado
// logo depois de conectar.

export type ConnectionStatus = "builtin" | "loading" | "on" | "off" | "unknown";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  builtin: "Ativo",
  loading: "",
  on: "Conectado",
  off: "Não conectado",
  unknown: "Sem verificação",
};

export function StatusDot({
  status,
  fresh = false,
  className,
}: {
  status: ConnectionStatus;
  fresh?: boolean;
  className?: string;
}) {
  if (status === "loading") return <Skeleton className={cn("h-4 w-16", className)} />;
  const on = status === "on" || status === "builtin";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-xs font-medium",
        on ? "text-[var(--via-text-primary)]" : "text-[var(--via-text-faint)]",
        className,
      )}
    >
      {fresh ? (
        <SuccessCheck className="size-3" />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 rounded-full",
            on ? "bg-[var(--via-navy)]" : "border border-[var(--via-border)]",
          )}
        />
      )}
      {STATUS_LABEL[status]}
    </span>
  );
}
