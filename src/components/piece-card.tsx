import { Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Workflow } from "lucide-react";

import { ChannelLabel } from "@/components/channel-label";
import { AuditChips } from "@/components/audit-chips";
import { Badge } from "@/components/ui/badge";
import { pieceHeadline, type ContentPiece } from "@/hooks/use-content-pieces";

/**
 * Card de peça da Biblioteca (docs/05 §4.2/§5): canal, primeira linha (hook),
 * mini-chips de auditoria, data e link do job de origem. O clique no corpo
 * abre o detalhe; o link do job leva a /criar (feed de gerações).
 */
export function PieceCard({ piece }: { piece: ContentPiece }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-[var(--via-navy-06)]">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="secondary" className="font-normal">
          <ChannelLabel type={piece.channel_type} />
        </Badge>
        <span className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(piece.created_at), { addSuffix: true, locale: ptBR })}
        </span>
      </div>

      <Link
        to="/biblioteca/$pieceId"
        params={{ pieceId: piece.id }}
        className="line-clamp-3 text-sm font-medium text-foreground hover:underline"
      >
        {pieceHeadline(piece)}
      </Link>

      <div className="mt-auto space-y-2">
        <AuditChips audit={piece.audit} compact />
        <Link
          to="/criar/$jobId"
          params={{ jobId: piece.job_id }}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          title="Ver a geração"
        >
          <Workflow className="size-3" aria-hidden="true" />
          geração {piece.job_id.slice(0, 8)}
        </Link>
      </div>
    </div>
  );
}
