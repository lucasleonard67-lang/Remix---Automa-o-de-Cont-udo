import { Link } from "@tanstack/react-router";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { RefreshCw } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import "@/components/analytics/analytics.css";

import { NetworkCluster } from "@/components/analytics/network-cluster";
import { PIECE_GRID, PieceGallery } from "@/components/biblioteca/piece-gallery";
import { ChannelIcon } from "@/components/criar/channel-tiles";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CHANNEL_TYPE_LABELS, type ChannelType } from "@/hooks/use-channels";
import {
  pieceHeadline,
  pieceShape,
  useContentPieces,
  type ContentPiece,
  type PieceStage,
} from "@/hooks/use-content-pieces";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Peças da Biblioteca: carrega, trata erro e vazio e entrega a galeria. Com
// `compact`, vira a coluna estreita ao lado de uma peça aberta: linhas de vidro
// do kit, com o ícone do canal no poço, o gancho e a data. A linha inteira abre
// o detalhe.
// ---------------------------------------------------------------------------

const VAZIO: Record<PieceStage, string> = {
  draft: "Nenhuma peça em revisão. As peças geradas chegam aqui para você aprovar.",
  approved: "Nenhuma peça aprovada sem data. Abra uma em revisão e aprove.",
  agendadas: "Nada agendado. Aprove uma peça e marque a data.",
  published: "Nenhuma peça publicada ainda.",
  rejected: "Nenhuma peça rejeitada.",
  archived: "Nenhuma peça arquivada.",
};

export function ReviewQueue({
  stage,
  channelType,
  search,
  compact = false,
  onClearFilters,
  onGoToReview,
}: {
  stage: PieceStage;
  channelType: ChannelType | null;
  search: string;
  compact?: boolean;
  onClearFilters?: () => void;
  onGoToReview?: () => void;
}) {
  const query = useContentPieces({ status: stage, channelType, search });
  const filtrando = search.trim().length > 0 || channelType !== null;

  if (query.isLoading) {
    return compact ? (
      <div className="space-y-2" aria-hidden="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-[var(--via-radius-md)]" />
        ))}
      </div>
    ) : (
      <div className={PIECE_GRID} aria-hidden="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[4/5] w-full rounded-[18px]" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <Painel compact={compact} text="Não foi possível carregar a Biblioteca.">
        <Button variant="outline" className="rounded-full" onClick={() => void query.refetch()}>
          <RefreshCw aria-hidden="true" />
          Tentar de novo
        </Button>
      </Painel>
    );
  }

  // A fila de revisão esvazia do mais antigo; o resto lê do mais recente.
  const pecas = [...(query.data ?? [])].sort((a, b) => {
    const delta = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return stage === "draft" ? delta : -delta;
  });

  if (pecas.length === 0) {
    if (filtrando) {
      return (
        <Painel
          compact={compact}
          title="Nenhuma peça com esses filtros"
          text="Limpe os filtros para ver todas as peças."
        >
          {onClearFilters ? (
            <Button variant="outline" className="rounded-full" onClick={onClearFilters}>
              Limpar filtros
            </Button>
          ) : null}
        </Painel>
      );
    }
    if (stage === "draft") {
      return (
        <Painel compact={compact} text={VAZIO.draft} cluster={!compact}>
          <Button asChild className="rounded-full">
            <Link to="/">Criar a primeira peça</Link>
          </Button>
        </Painel>
      );
    }
    return (
      <Painel compact={compact} text={VAZIO[stage]}>
        {onGoToReview ? (
          <Button variant="outline" className="rounded-full" onClick={onGoToReview}>
            Ver em revisão
          </Button>
        ) : null}
      </Painel>
    );
  }

  if (!compact) {
    return <PieceGallery key={`${stage}:${channelType}`} pieces={pecas} search={search} />;
  }

  return (
    <ol className="space-y-2" data-testid="fila-revisao">
      {pecas.map((peca, index) => (
        <li
          key={peca.id}
          className="ce-reveal"
          style={{ "--ce-reveal-delay": `${Math.min(index, 8) * 60}ms` } as CSSProperties}
        >
          <LinhaDaPeca peca={peca} />
        </li>
      ))}
    </ol>
  );
}

function LinhaDaPeca({ peca }: { peca: ContentPiece }) {
  const forma = pieceShape(peca);
  const agendada = peca.scheduled_at ? new Date(peca.scheduled_at) : null;
  const quando = formatDistanceToNow(new Date(peca.created_at), { addSuffix: true, locale: ptBR });

  return (
    <Link
      to="/biblioteca/$pieceId"
      params={{ pieceId: peca.id }}
      // preserva o segmento e a visão: sem isto, abrir uma peça derruba a fila
      // de volta para "Em revisão" sem o usuário ter pedido
      search={(prev) => prev}
      className="via-row-card via-row-signature flex items-center gap-3 rounded-[var(--via-radius-md)] !px-3 !py-2.5 no-underline hover:no-underline"
      activeProps={{ className: "!border-[var(--via-navy)]" }}
    >
      <span className="ce-tile-well !size-9 !rounded-[10px]">
        <ChannelIcon type={peca.channel_type} className="size-4" />
      </span>

      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-xs font-medium text-[var(--via-text-primary)]">
            {CHANNEL_TYPE_LABELS[peca.channel_type] ?? peca.channel_type}
          </span>
          {forma ? <span className="text-xs text-[var(--via-text-muted)]">{forma}</span> : null}
        </span>
        <span className="line-clamp-2 text-sm leading-snug text-[var(--via-text-body)]">
          {pieceHeadline(peca)}
        </span>
        <span className="block text-xs text-[var(--via-text-muted)]">
          {agendada ? format(agendada, "dd/MM · HH:mm") : quando}
        </span>
      </span>
    </Link>
  );
}

/** Painel de vidro do kit para a lista sem conteúdo: uma frase e uma ação. */
function Painel({
  title,
  text,
  cluster,
  compact,
  children,
}: {
  title?: string;
  text: string;
  cluster?: boolean;
  compact: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "via-tile via-tile--atmos ce-chart-empty flex flex-col items-center gap-4 text-center",
        compact ? "!px-4 !py-6" : "!px-6 !py-10",
      )}
      role="status"
    >
      {cluster ? <NetworkCluster /> : null}
      {title ? (
        <p className="text-base font-medium text-[var(--via-text-primary)]">{title}</p>
      ) : null}
      <p className="max-w-sm text-sm text-[var(--via-text-muted)]">{text}</p>
      {children}
    </div>
  );
}
