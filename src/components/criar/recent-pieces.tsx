import { Link } from "@tanstack/react-router";
import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowRight } from "lucide-react";

import { ChannelIcon } from "@/components/criar/channel-tiles";
import { FORMAT_LABELS } from "@/components/criar/formats";
import { Button } from "@/components/ui/button";
import {
  PIECE_STATUS_LABELS,
  pieceHeadline,
  useContentPieces,
  type PieceStatus,
} from "@/hooks/use-content-pieces";

// ---------------------------------------------------------------------------
// Rodapé de /criar: as 6 peças estáticas mais recentes da Biblioteca, numa
// lista de linhas (formato, primeira linha, status, quando). Mesma query da
// Biblioteca (cache compartilhado). Some quando não há peça.
// ---------------------------------------------------------------------------

const LIMIT = 6;

export function RecentPieces() {
  const pieces = useContentPieces();
  const recent = (pieces.data ?? [])
    .filter((piece) => piece.channel_type !== "instagram_reel")
    .slice(0, LIMIT);
  if (recent.length === 0) return null;

  return (
    <section className="space-y-3" aria-labelledby="criar-recentes" data-testid="criar-recentes">
      <div className="flex items-center justify-between gap-3 px-1">
        <h2
          id="criar-recentes"
          className="text-xs font-medium uppercase tracking-wide text-[var(--via-text-muted)]"
        >
          Recentes
        </h2>
        <Button asChild variant="ghost" size="sm" className="text-[var(--via-text-muted)]">
          <Link to="/biblioteca">
            Biblioteca
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
      <ul className="divide-y divide-[var(--via-border-soft)] border-y border-[var(--via-border-soft)]">
        {recent.map((piece) => (
          <li key={piece.id}>
            <Link
              to="/biblioteca/$pieceId"
              params={{ pieceId: piece.id }}
              className="flex min-w-0 items-center gap-3 px-1 py-3 transition-colors duration-[var(--via-dur)] hover:bg-[var(--via-navy-02)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]"
            >
              <ChannelIcon type={piece.channel_type} className="size-4 shrink-0" />
              <span className="w-20 shrink-0 truncate text-xs text-[var(--via-text-muted)]">
                {FORMAT_LABELS[piece.channel_type] ?? piece.channel_type}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-[var(--via-text-primary)]">
                {pieceHeadline(piece)}
              </span>
              <span className="via-meta-chip shrink-0">
                {PIECE_STATUS_LABELS[piece.status as PieceStatus] ?? piece.status}
              </span>
              <span className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-[var(--via-text-soft)] sm:block">
                {formatDistanceToNowStrict(new Date(piece.created_at), { locale: ptBR })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
