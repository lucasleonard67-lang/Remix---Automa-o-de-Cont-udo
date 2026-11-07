import { ChevronDown, Search, Target } from "lucide-react";

import { ChoiceChip } from "@/components/ui/choice-chip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { RssFeed, RssItemStatus, RssSort } from "@/hooks/use-rss";

// ---------------------------------------------------------------------------
// Filtros do Radar: busca numa pílula de vidro do kit (`ce-hero-field`, mais
// baixa que a do Criar) e status/ordem/fonte como chips que abrem um menu
// (ChoiceChip + DropdownMenu, ambos compartilhados). O chip fica navy + ✓
// quando o valor saiu do padrão — o mesmo sinal dos chips de marca e assunto.
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<RssItemStatus, string> = {
  new: "Novas",
  used: "Usadas",
  all: "Todas",
};

const SORT_LABELS: Record<RssSort, string> = {
  score: "Mais relevantes",
  recent: "Mais recentes",
};

export interface RadarFilterState {
  search: string;
  status: RssItemStatus;
  sort: RssSort;
  feedId: string | null;
  onlyBrand: boolean;
  topic: string | null;
}

export function RadarFilters({
  value,
  onChange,
  feeds,
  topics,
}: {
  value: RadarFilterState;
  onChange: (patch: Partial<RadarFilterState>) => void;
  feeds: RssFeed[];
  topics: Array<{ topic: string; count: number }>;
}) {
  // O assunto escolhido fica visível mesmo se sair do top da lista.
  const topicChips =
    value.topic && !topics.some((t) => t.topic === value.topic)
      ? [{ topic: value.topic, count: 0 }, ...topics]
      : topics;
  const feedName = value.feedId ? feeds.find((f) => f.id === value.feedId)?.name : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="ce-hero-field flex min-w-0 flex-1 items-center gap-2.5 pl-4 pr-3">
          <Search className="size-4 shrink-0 text-[var(--via-text-faint)]" aria-hidden="true" />
          <input
            type="search"
            value={value.search}
            onChange={(event) => onChange({ search: event.target.value })}
            placeholder="Buscar no título ou no resumo"
            aria-label="Buscar notícias por palavra-chave"
            autoComplete="off"
            className="h-10 min-w-0 flex-1 bg-transparent text-sm text-[var(--via-text-primary)] outline-none placeholder:text-[var(--via-text-faint)]"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtros">
          <MenuChip
            label="Status"
            value={value.status}
            active={value.status !== "new"}
            options={(Object.keys(STATUS_LABELS) as RssItemStatus[]).map((s) => ({
              value: s,
              label: STATUS_LABELS[s],
            }))}
            onChange={(status) => onChange({ status: status as RssItemStatus })}
          >
            {STATUS_LABELS[value.status]}
          </MenuChip>
          <MenuChip
            label="Ordem"
            value={value.sort}
            active={value.sort !== "score"}
            options={(Object.keys(SORT_LABELS) as RssSort[]).map((s) => ({
              value: s,
              label: SORT_LABELS[s],
            }))}
            onChange={(sort) => onChange({ sort: sort as RssSort })}
          >
            {SORT_LABELS[value.sort]}
          </MenuChip>
          {feeds.length > 1 ? (
            <MenuChip
              label="Fonte"
              value={value.feedId ?? "all"}
              active={value.feedId !== null}
              options={[
                { value: "all", label: "Todas as fontes" },
                ...feeds.map((feed) => ({ value: feed.id, label: feed.name })),
              ]}
              onChange={(id) => onChange({ feedId: id === "all" ? null : id })}
            >
              {feedName ?? "Todas as fontes"}
            </MenuChip>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtros rápidos">
        <ChoiceChip
          selected={value.onlyBrand}
          icon={<Target aria-hidden="true" />}
          onClick={() => onChange({ onlyBrand: !value.onlyBrand })}
        >
          Só o que tem a ver com a minha marca
        </ChoiceChip>
        {topicChips.length > 0 ? (
          <span aria-hidden="true" className="mx-1 h-4 w-px bg-[var(--via-border)]" />
        ) : null}
        {topicChips.map(({ topic }) => (
          <ChoiceChip
            key={topic}
            selected={value.topic === topic}
            onClick={() => onChange({ topic: value.topic === topic ? null : topic })}
          >
            {topic}
          </ChoiceChip>
        ))}
      </div>
    </div>
  );
}

/** Chip que abre um menu de escolha única; marcado quando saiu do padrão. */
function MenuChip({
  label,
  value,
  active,
  options,
  onChange,
  children,
}: {
  label: string;
  value: string;
  active: boolean;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ChoiceChip selected={active} aria-label={`${label}: ${children}`}>
          {children}
          <ChevronDown aria-hidden="true" className="-mr-0.5 opacity-70" />
        </ChoiceChip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
