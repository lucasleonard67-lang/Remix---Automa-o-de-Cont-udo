import { ChannelIcon } from "@/components/criar/channel-tiles";
import { FORMAT_LABELS } from "@/components/criar/formats";
import { MAX_TODAY_IDEAS } from "@/components/criar/use-today-ideas";
import { Skeleton } from "@/components/ui/skeleton";
import type { TodayIdea } from "@/lib/today-ideas";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Topo de /criar: as ideias com mais chance de viralizar hoje (Radar +
// concorrentes, nota do servidor), cada uma com a nota, o formato sugerido e
// o porquê numa linha. Um clique escolhe: o tema entra no campo e o formato
// já vem marcado — sobra só o Gerar. Grupo de escolha única (radio).
// ---------------------------------------------------------------------------

export function TodayIdeas({
  ideas,
  isLoading,
  pickedId,
  onPick,
}: {
  ideas: TodayIdea[];
  isLoading: boolean;
  pickedId: string | null;
  onPick: (idea: TodayIdea) => void;
}) {
  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-3" aria-hidden="true">
        {Array.from({ length: MAX_TODAY_IDEAS }).map((_, index) => (
          <Skeleton key={index} className="h-[7.5rem] rounded-[var(--via-radius-md)]" />
        ))}
      </div>
    );
  }
  if (ideas.length === 0) return null;

  return (
    <section aria-labelledby="sugestoes-hoje" className="space-y-3">
      <h2
        id="sugestoes-hoje"
        className="text-xs font-medium uppercase tracking-wide text-[var(--via-text-muted)]"
      >
        Sugestões para hoje
      </h2>
      <div
        role="radiogroup"
        aria-labelledby="sugestoes-hoje"
        className="grid gap-3 sm:grid-cols-3"
        data-testid="criar-sugestoes"
      >
        {ideas.map((idea) => {
          const on = idea.id === pickedId;
          return (
            <button
              key={idea.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onPick(idea)}
              data-testid="criar-sugestao"
              className={cn(
                "group grid min-w-0 grid-cols-[auto_minmax(0,1fr)] grid-rows-[auto_2.5rem_1rem] gap-x-3 gap-y-1 rounded-[var(--via-radius-md)] border px-3.5 py-3 text-left transition-[background-color,border-color,box-shadow] duration-[var(--via-dur)] ease-[var(--via-ease-snap)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]",
                on
                  ? "border-[var(--via-navy)] bg-[var(--via-navy-04)] shadow-[inset_0_0_0_0.5px_var(--via-navy)]"
                  : "border-[var(--via-border-soft)] hover:border-[var(--via-navy-20)]",
              )}
            >
              <span className="row-span-3 flex flex-col items-start">
                <span className="font-mono text-2xl font-medium leading-none tabular-nums tracking-[-0.02em] text-[var(--via-text-primary)]">
                  {idea.score}
                </span>
                <span className="mt-1 text-xs leading-4 text-[var(--via-text-soft)]">viral</span>
              </span>
              <span className="flex min-w-0 items-center gap-1.5 text-xs leading-4 text-[var(--via-text-muted)]">
                <ChannelIcon type={idea.format} className="size-3 shrink-0" />
                <span className="font-medium text-[var(--via-text-body)]">
                  {FORMAT_LABELS[idea.format]}
                </span>
                <span aria-hidden="true">·</span>
                <span className="truncate">{idea.origin}</span>
              </span>
              <span className="line-clamp-2 text-sm leading-5 text-[var(--via-text-primary)]">
                {idea.title}
              </span>
              <span className="truncate text-xs leading-4 text-[var(--via-text-muted)]">
                {idea.why}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
