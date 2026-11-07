import { Link, type LinkProps } from "@tanstack/react-router";
import { Check, type LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Ladrilho de escolha: ícone num selo tingido, nome e uma linha; o escolhido
// ganha borda navy, tinta suave e o check com mola. Tudo some sob
// reduced-motion. Com `to`, é um link que leva direto ao fluxo.
// ---------------------------------------------------------------------------

const TILE =
  "group relative flex min-w-0 cursor-pointer items-center gap-3 rounded-[var(--via-radius-lg)] border px-3.5 py-3 text-left transition-[background-color,border-color,transform,box-shadow] duration-[var(--via-dur)] ease-[var(--via-ease-snap)] hover:-translate-y-px focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)] active:translate-y-0 active:scale-[0.99] active:duration-[var(--via-dur-press)] motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100";
const TILE_ON = "border-[var(--via-navy)] bg-[var(--via-navy-04)]";
const TILE_OFF =
  "border-[var(--via-border-soft)] hover:border-[var(--via-navy-30)] hover:bg-[var(--via-navy-02)]";
const BADGE =
  "inline-flex size-10 shrink-0 items-center justify-center rounded-full transition-[background-color,color] duration-[var(--via-dur)] ease-[var(--via-ease-snap)] motion-reduce:transition-none";
const ICON =
  "size-5 transition-transform duration-[var(--via-dur)] ease-[var(--via-ease-spring)] group-hover:-rotate-6 group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:transform-none";

interface TileContent {
  icon: LucideIcon;
  label: string;
  line: string;
  selected?: boolean;
}

/** O check com mola do que está selecionado; a posição vem de quem usa. */
export function SelectedCheck({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "ce-check-in absolute inline-flex size-5 items-center justify-center rounded-full bg-[var(--via-navy)] text-white motion-reduce:animate-none",
        className,
      )}
      aria-hidden="true"
    >
      <Check className="size-3" strokeWidth={3} />
    </span>
  );
}

function TileBody({ icon: Icon, label, line, selected = false }: TileContent) {
  return (
    <>
      <span
        className={cn(
          BADGE,
          selected
            ? "bg-[var(--via-navy)] text-white"
            : "bg-[var(--via-navy-06)] text-[var(--via-text-primary)]",
        )}
        aria-hidden="true"
      >
        <Icon className={ICON} strokeWidth={1.75} />
      </span>
      <span className="grid min-w-0 flex-1 grid-rows-[1.25rem_2rem] gap-y-0.5 pr-5">
        <span className="truncate text-sm leading-5 font-medium text-[var(--via-text-primary)] sm:text-[15px]">
          {label}
        </span>
        <span className="line-clamp-2 text-xs leading-4 text-[var(--via-text-muted)]">{line}</span>
      </span>
      {selected ? <SelectedCheck className="top-2.5 right-2.5" /> : null}
    </>
  );
}

/** Botão: a escolha fica na tela (`selected`). */
export function ChoiceTile({
  testId,
  onPick,
  ...content
}: TileContent & { testId: string; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={content.selected ?? false}
      onClick={onPick}
      title={content.line}
      className={cn(TILE, content.selected ? TILE_ON : TILE_OFF)}
      data-testid={testId}
    >
      <TileBody {...content} />
    </button>
  );
}

/** Link: um toque leva ao fluxo. */
export function ChoiceTileLink({
  to,
  testId,
  onPick,
  className,
  style,
  ...content
}: TileContent & {
  to: LinkProps["to"];
  testId: string;
  onPick?: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <Link
      to={to}
      onClick={onPick}
      className={cn(TILE, TILE_OFF, className)}
      style={style}
      data-testid={testId}
    >
      <TileBody {...content} />
    </Link>
  );
}
