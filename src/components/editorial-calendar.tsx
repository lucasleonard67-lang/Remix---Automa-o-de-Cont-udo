import { Link } from "@tanstack/react-router";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isBefore,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import "@/components/analytics/analytics.css";

import { ChannelIcon } from "@/components/criar/channel-tiles";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CHANNEL_TYPE_LABELS } from "@/hooks/use-channels";
import { useScheduledPieces, type ContentPiece } from "@/hooks/use-content-pieces";
import { usePublishedPostsMap } from "@/hooks/use-published-posts";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Calendário editorial na linguagem do kit: dias como células de vidro leves,
// peças como chips com o ícone do canal (a única cor da célula) e o dia vazio
// convidando a "Preencher" em Criar. O estado de publicação (Zernio) muda só o
// chip: agendada aqui · envio agendado · publicada · falhou.
// ---------------------------------------------------------------------------

/** Classe do chip conforme o estado de publicação (published_posts). */
function chipClasses(status: string | undefined): string {
  switch (status) {
    case "scheduled":
    case "publishing":
    case "pending":
      return "!bg-[var(--via-navy-08)] !text-[var(--via-text-primary)]";
    case "published":
      return "!border-transparent !bg-[var(--via-navy)] !text-white";
    case "failed":
    case "partial":
      return "!border-transparent !bg-[rgba(184,92,92,0.12)] !text-[var(--via-coral-dark)]";
    default:
      // Agendada só no calendário local (sem post no Zernio)
      return "";
  }
}

const CHIP_STATE_LABELS: Record<string, string> = {
  pending: "enviando",
  publishing: "publicando",
  scheduled: "envio agendado",
  published: "publicada",
  failed: "falha ao publicar",
  partial: "publicada em parte",
};

const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"] as const;

export function EditorialCalendar() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));

  // O grid mostra semanas completas — o intervalo da query cobre as bordas
  // (dias do mês anterior/seguinte visíveis no grid).
  const gridStart = startOfWeek(month, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const piecesQuery = useScheduledPieces(gridStart.toISOString(), gridEnd.toISOString());
  const pieces = useMemo(() => piecesQuery.data ?? [], [piecesQuery.data]);
  // Estado de publicação por peça (Zernio) — pinta o chip do calendário.
  const publishedMap = usePublishedPostsMap(pieces.map((p) => p.id)).data;

  const days = useMemo(
    () => eachDayOfInterval({ start: gridStart, end: gridEnd }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- derivados de `month`
    [month],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, ContentPiece[]>();
    for (const piece of pieces) {
      if (!piece.scheduled_at) continue;
      const key = format(new Date(piece.scheduled_at), "yyyy-MM-dd");
      map.set(key, [...(map.get(key) ?? []), piece]);
    }
    return map;
  }, [pieces]);

  const hoje = startOfDay(new Date());

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-medium capitalize tracking-[-0.02em] text-[var(--via-text-primary)]">
          {format(month, "MMMM yyyy", { locale: ptBR })}
        </h2>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => setMonth((m) => addMonths(m, -1))}
            aria-label="Mês anterior"
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>
            Hoje
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => setMonth((m) => addMonths(m, 1))}
            aria-label="Próximo mês"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((day) => (
          <p key={day} className="via-eyebrow px-2 py-1 text-center">
            {day}
          </p>
        ))}
      </div>

      {piecesQuery.isLoading ? (
        <div className="grid grid-cols-7 gap-1.5" aria-hidden="true">
          {Array.from({ length: 35 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full rounded-[12px]" />
          ))}
        </div>
      ) : (
        <ol className="grid grid-cols-7 gap-1.5">
          {days.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            const dayPieces = byDay.get(key) ?? [];
            const inMonth = isSameMonth(day, month);
            const podePreencher =
              inMonth && dayPieces.length === 0 && !isBefore(startOfDay(day), hoje);
            return (
              <li
                key={key}
                className={cn(
                  "group flex min-h-24 flex-col gap-1 rounded-[12px] p-1.5",
                  inMonth
                    ? "via-tile !rounded-[12px] !p-1.5"
                    : "border border-dashed border-[var(--via-border-soft)] opacity-60",
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-6 items-center justify-center rounded-full font-mono text-xs tabular-nums",
                    isToday(day)
                      ? "bg-[var(--via-navy)] font-medium text-white"
                      : inMonth
                        ? "text-[var(--via-text-primary)]"
                        : "text-[var(--via-text-faint)]",
                  )}
                >
                  {format(day, "d")}
                </span>
                <div className="flex flex-1 flex-col gap-1">
                  {dayPieces.map((piece) => {
                    const publishState =
                      publishedMap?.get(piece.id)?.status === "cancelled"
                        ? undefined
                        : publishedMap?.get(piece.id)?.status;
                    const stateLabel = publishState
                      ? ` · ${CHIP_STATE_LABELS[publishState] ?? publishState}`
                      : "";
                    const hora = piece.scheduled_at
                      ? format(new Date(piece.scheduled_at), "HH:mm")
                      : "";
                    const canal = CHANNEL_TYPE_LABELS[piece.channel_type] ?? piece.channel_type;
                    return (
                      <Link
                        key={piece.id}
                        to="/biblioteca/$pieceId"
                        params={{ pieceId: piece.id }}
                        title={`${canal} — ${hora}${stateLabel}`}
                        aria-label={`${canal} às ${hora}${stateLabel}`}
                        className={cn(
                          "via-meta-chip !gap-1.5 !px-1.5 !py-0.5 no-underline transition-transform duration-[var(--via-dur)] hover:-translate-y-px hover:no-underline focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]",
                          chipClasses(publishState),
                        )}
                      >
                        <ChannelIcon type={piece.channel_type} className="size-3" />
                        <span className="truncate font-mono tabular-nums">{hora}</span>
                      </Link>
                    );
                  })}
                  {podePreencher ? (
                    <Link
                      to="/"
                      className="mt-auto inline-flex items-center gap-1 self-start rounded-full px-1 text-xs text-[var(--via-text-muted)] opacity-0 transition-opacity duration-[var(--via-dur)] hover:text-[var(--via-text-primary)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)] group-hover:opacity-100"
                      aria-label={`Preencher ${format(day, "d 'de' MMMM", { locale: ptBR })}`}
                    >
                      <Plus className="size-3" aria-hidden="true" />
                      Preencher
                    </Link>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {!piecesQuery.isLoading && pieces.length === 0 ? (
        <div
          className="via-tile via-tile--atmos ce-chart-empty flex flex-col items-center gap-4 !px-6 !py-8 text-center"
          role="status"
        >
          <p className="max-w-sm text-sm text-[var(--via-text-muted)]">
            Nenhuma peça agendada neste mês. Aprove uma peça e marque a data.
          </p>
          <Button asChild variant="outline" className="rounded-full">
            <Link to="/biblioteca" search={{ status: "approved" }}>
              Ver aprovadas
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
