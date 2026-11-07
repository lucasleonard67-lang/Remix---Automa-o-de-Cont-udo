import { createFileRoute, Link, Outlet, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CalendarDays, LayoutGrid, PanelLeft, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "@/components/analytics/analytics.css";

import { ChannelLabel } from "@/components/channel-label";
import { Reveal } from "@/components/dashboard/motion";
import { EditorialCalendar } from "@/components/editorial-calendar";
import { PageEyebrow } from "@/components/page-header";
import { ReviewQueue } from "@/components/review-queue";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CHANNEL_TYPES, type ChannelType } from "@/hooks/use-channels";
import { usePieceStageCounts, type PieceStage } from "@/hooks/use-content-pieces";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Biblioteca na linguagem do kit: título grande, filtros como chips (o estado
// "Em revisão" é o primeiro, com a contagem), busca em pílula de vidro e as
// peças numa galeria, cada uma com a própria arte. Sem peça aberta, a galeria é
// a página inteira; com peça aberta, o detalhe toma a tela e a fila volta pelo
// botão, como coluna compacta à esquerda. O segmento e a visão vivem na URL.
// ---------------------------------------------------------------------------

const ESTEIRA: Array<{ stage: PieceStage; label: string }> = [
  { stage: "draft", label: "Em revisão" },
  { stage: "approved", label: "Aprovadas" },
  { stage: "agendadas", label: "Agendadas" },
  { stage: "published", label: "Publicadas" },
  { stage: "rejected", label: "Rejeitadas" },
  { stage: "archived", label: "Arquivadas" },
];

function isStage(v: unknown): v is PieceStage {
  return typeof v === "string" && ESTEIRA.some((s) => s.stage === v);
}

export const Route = createFileRoute("/_app/biblioteca")({
  // A URL é a fonte única do segmento e da visão: recarregar não pode
  // contradizer o que está na tela, e /criar aponta para cá com ?status=draft.
  validateSearch: (
    search: Record<string, unknown>,
  ): { status?: PieceStage; view?: "calendario" } => ({
    ...(isStage(search.status) ? { status: search.status } : {}),
    ...(search.view === "calendario" ? { view: "calendario" as const } : {}),
  }),
  component: Biblioteca,
});

type ChannelFilter = ChannelType | "all";

/* Pílula de filtro (mesmo desenho do ChoiceChip) sobre o Tabs do Radix: o
   papel de aba fica (setas do teclado, data-state), o visual é o chip do kit. */
const STAGE_CHIP_CLASS =
  "rounded-full border border-[var(--via-border)] bg-transparent px-3 py-1 text-xs font-medium leading-[1.4] tracking-[-0.004em] text-[var(--via-text-muted)] shadow-none transition-[background-color,border-color,color,transform] duration-[var(--via-dur)] hover:border-[var(--via-navy-30)] hover:text-[var(--via-text-primary)] focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:shadow-[var(--via-shadow-focus)] active:scale-[0.98] data-[state=active]:bg-transparent data-[state=active]:text-[var(--via-text-primary)]";

function Biblioteca() {
  const navigate = useNavigate();
  const { status, view } = Route.useSearch();
  // Guard TAMBÉM aqui: ?status=lixo chegava ao componente e virava filtro no
  // PostgREST (HTTP 400 e fila em skeleton eterno).
  const stage: PieceStage = isStage(status) ? status : "draft";
  const counts = usePieceStageCounts().data;

  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [busca, setBusca] = useState("");

  // Com peça aberta, quem abriu quer LER a peça: a fila sai da frente e volta
  // pelo botão, como coluna compacta. A escolha sobrevive à troca de peça.
  const matchRoute = useMatchRoute();
  const pecaAberta = Boolean(matchRoute({ to: "/biblioteca/$pieceId", fuzzy: true }));
  const [filaManual, setFilaManual] = useState<boolean | null>(null);
  const filaVisivel = pecaAberta && (filaManual ?? false);
  const naAba = counts?.[stage as keyof typeof counts];
  const stageLabel = ESTEIRA.find((s) => s.stage === stage)?.label ?? "";

  // mescla o search: trocar de segmento não pode apagar a visão, e vice-versa
  // em tela estreita os chips rolam: a aba aberta não pode ficar fora da vista
  const abas = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // no quadro seguinte: a aba ativa e a contagem já pintaram e mudam a medida
    const quadro = requestAnimationFrame(() => {
      const lista = abas.current;
      const ativa = lista?.querySelector('[data-state="active"]');
      if (!lista || !ativa) return;
      const caixa = lista.getBoundingClientRect();
      const aba = ativa.getBoundingClientRect();
      lista.scrollLeft += aba.left - caixa.left - (caixa.width - aba.width) / 2;
    });
    return () => cancelAnimationFrame(quadro);
  }, [stage, pecaAberta, view, counts]);

  const irPara = (patch: { status?: PieceStage; view?: "calendario" | undefined }) =>
    void navigate({
      to: "/biblioteca",
      search: (prev) => {
        const next = { ...prev, ...patch };
        if (next.status === "draft") delete next.status;
        if (!next.view) delete next.view;
        return next;
      },
      replace: true,
    });

  const limparFiltros = () => {
    setChannelFilter("all");
    setBusca("");
  };

  if (pecaAberta) {
    return (
      <div className={cn("mx-auto space-y-6", filaVisivel ? "max-w-[1400px]" : "max-w-5xl")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link to="/biblioteca" search={(prev) => prev}>
              <ArrowLeft aria-hidden="true" />
              Biblioteca
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFilaManual(!filaVisivel)}
            aria-pressed={filaVisivel}
          >
            <PanelLeft aria-hidden="true" />
            {filaVisivel
              ? "Ocultar fila"
              : `Ver fila${typeof naAba === "number" && naAba > 0 ? ` (${naAba})` : ""}`}
          </Button>
        </div>

        <div
          className={cn(
            "grid items-start gap-6",
            filaVisivel && "lg:grid-cols-[20rem_minmax(0,1fr)]",
          )}
        >
          {filaVisivel ? (
            <aside
              aria-label="Fila"
              className="space-y-3 lg:sticky lg:top-[var(--via-sticky-top)] lg:max-h-[var(--via-sticky-max-h)] lg:overflow-y-auto lg:pr-1"
            >
              <p className="via-eyebrow">Fila · {stageLabel}</p>
              <ReviewQueue
                stage={stage}
                channelType={channelFilter === "all" ? null : channelFilter}
                search={busca}
                compact
                onClearFilters={limparFiltros}
              />
            </aside>
          ) : null}
          <div className="min-w-0">
            <Outlet />
          </div>
        </div>
      </div>
    );
  }

  const filtrando = view !== "calendario";

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <Reveal index={0}>
        <header className="space-y-2">
          <PageEyebrow />
          <h1 className="text-3xl font-medium tracking-[-0.025em] text-[var(--via-text-primary)]">
            Biblioteca
          </h1>
          <p className="text-sm text-[var(--via-text-muted)]">
            Revise, agende e acompanhe as peças geradas.
          </p>
        </header>
      </Reveal>

      <Reveal index={1}>
        <div className="space-y-3">
          {/* O calendário mostra o que está AGENDADO, sem recorte por segmento:
              deixar a esteira ali anunciava um filtro que a tela não aplica. */}
          {filtrando ? (
            <Tabs value={stage} onValueChange={(v) => irPara({ status: v as PieceStage })}>
              <TabsList
                ref={abas}
                className="flex h-auto w-0 min-w-full justify-start gap-1.5 overflow-x-auto rounded-none bg-transparent p-0 [scrollbar-width:none]"
                aria-label="Estado da peça"
              >
                {ESTEIRA.map(({ stage: value, label }) => {
                  const n = counts?.[value as keyof typeof counts];
                  return (
                    <TabsTrigger
                      key={value}
                      value={value}
                      className={cn(
                        STAGE_CHIP_CLASS,
                        "shrink-0",
                        value === stage && "via-selected",
                      )}
                    >
                      {label}
                      {typeof n === "number" && n > 0 ? (
                        <span className="ml-1.5 font-mono tabular-nums opacity-80">{n}</span>
                      ) : null}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>
          ) : null}

          <div className="flex items-center gap-2">
            {filtrando ? (
              <>
                <label className="ce-hero-field flex h-9 min-w-0 flex-1 items-center gap-2 pl-3.5 pr-3 sm:max-w-xs">
                  <Search
                    className="size-4 shrink-0 text-[var(--via-text-faint)]"
                    aria-hidden="true"
                  />
                  <input
                    value={busca}
                    onChange={(event) => setBusca(event.target.value)}
                    placeholder="Buscar"
                    aria-label="Buscar peças"
                    autoComplete="off"
                    className="h-full min-w-0 flex-1 bg-transparent text-sm text-[var(--via-text-primary)] outline-none placeholder:text-[var(--via-text-faint)]"
                  />
                </label>
                <Select
                  value={channelFilter}
                  onValueChange={(v) => setChannelFilter(v as ChannelFilter)}
                >
                  <SelectTrigger
                    className="h-9 w-auto shrink-0 gap-2 rounded-full"
                    aria-label="Filtrar por canal"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os canais</SelectItem>
                    {CHANNEL_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        <ChannelLabel type={type} />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            ) : null}
            <div className="ml-auto shrink-0">
              <VisaoToggle
                view={view === "calendario" ? "calendar" : "gallery"}
                onChange={(v) => irPara({ view: v === "calendar" ? "calendario" : undefined })}
              />
            </div>
          </div>
        </div>
      </Reveal>

      <Reveal index={2}>
        {view === "calendario" ? (
          <EditorialCalendar />
        ) : (
          <ReviewQueue
            stage={stage}
            channelType={channelFilter === "all" ? null : channelFilter}
            search={busca}
            onClearFilters={limparFiltros}
            onGoToReview={() => irPara({ status: "draft" })}
          />
        )}
      </Reveal>

      <Outlet />
    </div>
  );
}

/** Alterna entre a galeria e o calendário editorial: dois ícones numa cápsula de vidro. */
function VisaoToggle({
  view,
  onChange,
}: {
  view: "gallery" | "calendar";
  onChange: (view: "gallery" | "calendar") => void;
}) {
  return (
    <div
      role="group"
      aria-label="Visão"
      className="inline-flex items-center gap-0.5 rounded-full border border-[var(--via-border-soft)] bg-[var(--via-glass-card)] p-0.5 shadow-[inset_0_1px_0_var(--via-edge-hi)]"
    >
      {(
        [
          ["gallery", "Galeria", LayoutGrid],
          ["calendar", "Calendário", CalendarDays],
        ] as const
      ).map(([value, label, Icon]) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          aria-pressed={view === value}
          aria-label={label}
          title={label}
          className={cn(
            "flex size-8 cursor-pointer items-center justify-center rounded-full transition-[background-color,color,transform] duration-[var(--via-dur)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)] active:scale-[0.97]",
            view === value
              ? "bg-[var(--via-navy-06)] text-[var(--via-text-primary)]"
              : "text-[var(--via-text-muted)] hover:text-[var(--via-text-primary)]",
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
