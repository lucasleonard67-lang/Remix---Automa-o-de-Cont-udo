import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowRight, Loader2 } from "lucide-react";

import { RADAR_REFRESH_MINUTES } from "@/hooks/use-rss";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Linha de estado da coleta automática: um ponto de estado, uma frase e
// "Atualizar agora" como texto com seta. A busca roda sozinha; a ação existe
// para quem não quer esperar — por isso não é botão cheio.
// ---------------------------------------------------------------------------

export function RefreshStatus({
  lastUpdate,
  failing,
  canRefresh,
  refreshing,
  onRefresh,
  onSeeSources,
}: {
  lastUpdate: Date | null;
  failing: number;
  canRefresh: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onSeeSources: () => void;
}) {
  const ultima = lastUpdate
    ? `última atualização ${formatDistanceToNow(lastUpdate, { locale: ptBR, addSuffix: true })}`
    : "ainda sem atualização";
  // O ponto é o único sinal de cor da linha: navy = em dia, coral = fonte com
  // erro, vazio = nunca coletou.
  const dot =
    failing > 0
      ? "bg-[var(--via-coral)]"
      : lastUpdate
        ? "bg-[var(--via-navy)]"
        : "border border-[var(--via-border)]";

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm text-[var(--via-text-muted)]">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1" aria-live="polite">
        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", dot)} />
        <span>
          Atualiza sozinho a cada {RADAR_REFRESH_MINUTES} min · {ultima}
        </span>
        {failing > 0 ? (
          <button
            type="button"
            onClick={onSeeSources}
            className="rounded-full font-medium text-[var(--via-text-primary)] underline underline-offset-4 focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]"
          >
            {failing === 1 ? "1 fonte com erro" : `${failing} fontes com erro`}
          </button>
        ) : null}
      </p>
      {canRefresh ? (
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-full text-sm font-medium text-[var(--via-text-primary)] transition-[gap] duration-[var(--via-dur)] hover:gap-2.5 focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)] disabled:cursor-progress disabled:text-[var(--via-text-muted)]"
        >
          {refreshing ? "Atualizando…" : "Atualizar agora"}
          {refreshing ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <ArrowRight className="size-4" aria-hidden="true" />
          )}
        </button>
      ) : null}
    </div>
  );
}
