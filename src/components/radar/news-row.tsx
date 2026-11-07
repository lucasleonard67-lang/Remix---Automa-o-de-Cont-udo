import { Link } from "@tanstack/react-router";
import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowUpRight, Check, PenLine } from "lucide-react";
import type { CSSProperties } from "react";

import { FeedIcon } from "@/components/radar/feed-icon";
import { ScoreRail } from "@/components/radar/score-rail";
import { Button } from "@/components/ui/button";
import type { RssItem } from "@/hooks/use-rss";
import { decodeHtmlEntities, htmlParaTexto } from "@/lib/html-entities";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Linha do Radar no padrão do kit (`via-row-card via-row-signature`, entrada
// escalonada): favicon da fonte no poço à esquerda (a única cor da linha),
// título, resumo em 2 linhas e a meta (fonte · quando · #assuntos). À direita
// o trilho de notas e UMA ação primária, "Gerar peça"; "Ler matéria" e
// "Excluir" ficam como texto.
// ---------------------------------------------------------------------------

const TEXT_ACTION =
  "inline-flex items-center gap-1 rounded-full text-xs font-medium text-[var(--via-text-muted)] transition-colors duration-[var(--via-dur)] hover:text-[var(--via-text-primary)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)] [&_svg]:size-3.5";

export function NewsRow({
  item,
  feedUrl,
  index = 0,
  onDelete,
  onPickTopic,
}: {
  item: RssItem;
  /** Endereço da fonte, para o favicon. */
  feedUrl?: string | null;
  /** Ordem na lista: define o atraso da entrada escalonada (60ms por linha). */
  index?: number;
  onDelete: () => void;
  onPickTopic?: (topic: string) => void;
}) {
  const used = Boolean(item.used_in_job_id);
  // O feed traz entidades de HTML ("avan&ccedil;o"); decodificar aqui conserta
  // também os itens já gravados, sem re-fetch.
  const description = htmlParaTexto(item.description) || null;
  const titulo = decodeHtmlEntities(item.title);
  const quando = item.published_at
    ? formatDistanceToNowStrict(new Date(item.published_at), { locale: ptBR, addSuffix: true })
    : null;
  const high = item.relevance !== null && item.relevance >= 75;

  return (
    <li
      className="ce-reveal"
      style={{ "--ce-reveal-delay": `${Math.min(index, 8) * 60}ms` } as CSSProperties}
      data-testid="radar-noticia"
    >
      <article
        className={cn(
          "via-row-card via-row-signature flex flex-wrap gap-x-4 gap-y-3 rounded-[var(--via-radius-md)] !px-4 !py-4 sm:flex-nowrap",
        )}
        aria-label={titulo}
      >
        <FeedIcon url={feedUrl} className="mt-0.5" />

        <div className="min-w-0 flex-1 basis-[14rem] space-y-1.5">
          <h3 className="text-base font-medium leading-snug text-[var(--via-text-primary)]">
            {titulo}
          </h3>
          {description ? (
            <p className="line-clamp-2 text-sm text-[var(--via-text-muted)]">{description}</p>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 pt-0.5 text-xs text-[var(--via-text-muted)]">
            <span className="font-medium text-[var(--via-text-body)]">
              {item.rss_feeds?.name ?? "Fonte"}
            </span>
            {quando ? <span>· {quando}</span> : null}
            {used ? (
              <span className="via-meta-chip">Usada</span>
            ) : high ? (
              <span className="via-meta-chip">
                <Check className="size-3" aria-hidden="true" />
                Alta relevância
              </span>
            ) : null}
            {(item.topics ?? []).slice(0, 3).map((topic) =>
              onPickTopic ? (
                <button
                  key={topic}
                  type="button"
                  onClick={() => onPickTopic(topic)}
                  className="via-meta-chip cursor-pointer transition-colors duration-[var(--via-dur)] hover:border-[var(--via-navy-30)] hover:text-[var(--via-text-primary)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]"
                  aria-label={`Filtrar por ${topic}`}
                >
                  #{topic}
                </button>
              ) : (
                <span key={topic} className="via-meta-chip">
                  #{topic}
                </span>
              ),
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
            <a href={item.link} target="_blank" rel="noopener noreferrer" className={TEXT_ACTION}>
              Ler matéria
              <ArrowUpRight aria-hidden="true" />
            </a>
            <button type="button" className={TEXT_ACTION} onClick={onDelete}>
              Excluir
            </button>
          </div>
        </div>

        {/* Mobile: notas e ação numa faixa abaixo do texto; desktop: coluna à direita. */}
        <div className="flex w-full shrink-0 items-end justify-between gap-4 sm:w-36 sm:flex-col sm:items-stretch sm:gap-3">
          <ScoreRail
            relevance={item.relevance}
            virality={item.virality}
            className="min-w-0 flex-1 gap-y-1.5 sm:flex-none"
          />
          {!used ? (
            <Button asChild size="sm" className="shrink-0 sm:self-start">
              {/* leva para a tela de criação com a notícia anexada — o briefing é
                  revisado lá, junto de canais, pesquisa e o resto do contexto */}
              <Link to="/" search={{ radar: item.id }}>
                <PenLine aria-hidden="true" />
                Gerar peça
              </Link>
            </Button>
          ) : null}
        </div>
      </article>
    </li>
  );
}
