import { Link } from "@tanstack/react-router";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowRight } from "lucide-react";
import { useState } from "react";

import { PieceCover } from "@/components/biblioteca/piece-cover";
import { ChannelIcon } from "@/components/criar/channel-tiles";
import { ExcluirNaCapa } from "@/components/excluir-na-capa";
import { FORMAT_LABELS } from "@/components/criar/formats";
import type { TweetCardBrand } from "@/components/tweet-card-render";
import { pieceHeadline, type ContentPiece } from "@/hooks/use-content-pieces";
import { avisoDoDrive, useDeletePiece } from "@/hooks/use-delete-content";
import { useIsAdmin } from "@/hooks/use-is-admin";
import type { CarouselArt } from "@/lib/carousel-art";
import { toast } from "@/lib/toast";

// ---------------------------------------------------------------------------
// Peça na galeria: a arte é o card, e quase nada fica por cima dela. Marca do
// canal no canto, gancho e formato abaixo, soltos, e o próximo passo surge ao
// passar o mouse. O estado não se repete aqui: já é o filtro da tela. O toque
// inteiro abre o detalhe.
// ---------------------------------------------------------------------------

/** O próximo passo daquele estado. */
function acaoDaPeca(peca: ContentPiece): string {
  switch (peca.status) {
    case "draft":
      return "Revisar";
    case "approved":
      return peca.scheduled_at ? "Abrir" : "Agendar";
    case "published":
      return "Ver resultado";
    case "rejected":
      return "Ver motivo";
    default:
      return "Abrir";
  }
}

function quandoDaPeca(peca: ContentPiece): string {
  if (peca.status !== "published" && peca.scheduled_at) {
    return format(new Date(peca.scheduled_at), "dd/MM 'às' HH:mm");
  }
  return formatDistanceToNow(new Date(peca.created_at), { addSuffix: true, locale: ptBR });
}

export function PieceTile({
  piece,
  brand,
  art,
}: {
  piece: ContentPiece;
  brand: TweetCardBrand;
  art: CarouselArt;
}) {
  const [active, setActive] = useState(false);
  const nota = typeof piece.audit?.judge?.score === "number" ? piece.audit.judge.score : null;
  const { isAdmin } = useIsAdmin();
  const excluir = useDeletePiece();

  return (
    <div className="group/capa relative">
      <Link
        to="/biblioteca/$pieceId"
        params={{ pieceId: piece.id }}
        // preserva o segmento e a visão: sem isto, abrir uma peça derruba a fila
        // de volta para "Em revisão" sem o usuário ter pedido
        search={(prev) => prev}
        onPointerEnter={(event) => event.pointerType === "mouse" && setActive(true)}
        onPointerLeave={() => setActive(false)}
        onFocus={() => setActive(true)}
        onBlur={() => setActive(false)}
        className="group block rounded-[18px] no-underline hover:no-underline focus-visible:outline-none"
        data-testid="peca-card"
      >
        <span className="relative block aspect-[4/5] overflow-hidden rounded-[18px] bg-[var(--via-navy-04)] transition-transform after:pointer-events-none after:absolute after:inset-0 after:rounded-[18px] after:shadow-[inset_0_0_0_0.5px_var(--via-navy-12)] after:content-[''] duration-[var(--via-dur)] group-focus-visible:shadow-[var(--via-shadow-focus)] motion-safe:group-hover:-translate-y-0.5">
          <PieceCover piece={piece} brand={brand} art={art} active={active} />
          <span className="absolute left-2 top-2 inline-flex rounded-full bg-white p-1.5 shadow-[var(--via-shadow-sm)]">
            <ChannelIcon type={piece.channel_type} className="size-3.5" />
          </span>
          <span
            className="via-pill-link via-pill-link--solid absolute bottom-2 right-2 opacity-0 transition-opacity duration-[var(--via-dur)] group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden="true"
          >
            {acaoDaPeca(piece)}
            <ArrowRight className="size-3.5" />
          </span>
        </span>
        <span className="mt-2.5 line-clamp-2 text-sm font-medium leading-snug text-[var(--via-text-primary)] [overflow-wrap:anywhere]">
          {pieceHeadline(piece)}
        </span>
        <span className="mt-0.5 block truncate text-xs text-[var(--via-text-muted)]">
          {FORMAT_LABELS[piece.channel_type] ?? piece.channel_type} · {quandoDaPeca(piece)}
          {nota !== null ? ` · Nota ${nota}/10` : ""}
        </span>
      </Link>
      {isAdmin ? (
        <ExcluirNaCapa
          nome={pieceHeadline(piece)}
          titulo="Excluir esta peça?"
          descricao="Ela sai da Biblioteca com os arquivos e a cópia no Drive. O post já publicado segue na rede. Não dá para desfazer."
          pendente={excluir.isPending}
          onExcluir={() =>
            excluir.mutate(piece.id, {
              onSuccess: ({ drive_pendente }) =>
                toast.success("Peça excluída", { description: avisoDoDrive(drive_pendente) }),
              onError: (error) =>
                toast.error("Não foi possível excluir", { description: error.message }),
            })
          }
        />
      ) : null}
    </div>
  );
}
