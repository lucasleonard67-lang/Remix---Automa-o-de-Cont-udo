import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useMemo, useState } from "react";

import { ChoiceChip } from "@/components/ui/choice-chip";
import { cn } from "@/lib/utils";
import {
  MEDIA_TYPE_LABELS,
  METRIC_LABELS,
  formatNumber,
  sortPosts,
  type Metric,
  type PostSortKey,
  type ZernioPost,
} from "@/lib/zernio-analytics";

import { platformLabel } from "./motion";
import { PlatformMark, StateLine } from "./shared";

// Todas as publicações com métricas: tabela `.via-table` ordenável com filtro
// por plataforma. Os takeaways ficam em <Takeaways>, no topo do módulo.

const COLUMNS: Array<{ key: Metric; label: string }> = [
  { key: "reach", label: "Alcance" },
  { key: "likes", label: "Curtidas" },
  { key: "comments", label: "Comentários" },
  { key: "saves", label: "Salvamentos" },
  { key: "shares", label: "Compart." },
  { key: "views", label: "Visualiz." },
];

export function PostsTable({
  posts,
  onOpen,
}: {
  posts: ZernioPost[];
  onOpen: (post: ZernioPost) => void;
}) {
  const [platform, setPlatform] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<PostSortKey>("date");
  const [order, setOrder] = useState<"asc" | "desc">("desc");

  const platforms = useMemo(
    () => [...new Set(posts.map((p) => p.platform).filter((p): p is string => Boolean(p)))],
    [posts],
  );
  const filtered = useMemo(
    () => (platform ? posts.filter((p) => p.platform === platform) : posts),
    [posts, platform],
  );
  const rows = useMemo(() => sortPosts(filtered, sortKey, order), [filtered, sortKey, order]);
  const pendingCount = filtered.filter((p) => p.syncStatus === "pending").length;

  const toggleSort = (key: PostSortKey) => {
    if (key === sortKey) {
      setOrder(order === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setOrder("desc");
    }
  };

  return (
    <div className="space-y-4">
      {platforms.length > 1 ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por rede">
          <ChoiceChip selected={platform === null} onClick={() => setPlatform(null)}>
            Todas as redes
          </ChoiceChip>
          {platforms.map((p) => (
            <ChoiceChip
              key={p}
              selected={platform === p}
              onClick={() => setPlatform(p)}
              icon={<PlatformMark platform={p} className="size-3.5" />}
            >
              {platformLabel(p)}
            </ChoiceChip>
          ))}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <StateLine>Nenhuma publicação nesta rede no período.</StateLine>
      ) : (
        <div className="via-table-wrap">
          <table className="via-table via-table--compact">
            <thead>
              <tr>
                <th scope="col">Rede</th>
                <th scope="col">Peça</th>
                <SortableHeader
                  label="Data"
                  active={sortKey === "date"}
                  order={order}
                  onClick={() => toggleSort("date")}
                />
                {COLUMNS.map((column) => (
                  <SortableHeader
                    key={column.key}
                    label={column.label}
                    title={METRIC_LABELS[column.key]}
                    numeric
                    active={sortKey === column.key}
                    order={order}
                    onClick={() => toggleSort(column.key)}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((post) => (
                <tr key={post.id}>
                  <td>
                    <span className="inline-flex items-center gap-2">
                      <PlatformMark platform={post.platform} label />
                      {post.accountUsername ? (
                        <span className="text-[var(--via-text-muted)]">
                          @{post.accountUsername}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="max-w-[260px]">
                    <button
                      type="button"
                      onClick={() => onOpen(post)}
                      className="block w-full truncate text-left font-medium text-[var(--via-text-primary)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]"
                    >
                      {post.content.split("\n")[0] || "Sem texto"}
                    </button>
                    <span className="text-xs text-[var(--via-text-muted)]">
                      {MEDIA_TYPE_LABELS[post.mediaType]}
                      {post.syncStatus === "pending" ? " · métricas em até 48h" : ""}
                    </span>
                  </td>
                  <td className="whitespace-nowrap text-[var(--via-text-muted)]">
                    {post.date ? format(parseISO(post.date), "d MMM", { locale: ptBR }) : "—"}
                  </td>
                  {COLUMNS.map((column) => (
                    <td key={column.key} className="via-num">
                      {formatNumber(post.analytics[column.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pendingCount > 0 ? (
        <StateLine className="text-xs">
          {pendingCount === 1
            ? "1 publicação ainda sem métricas — chegam em até 48h."
            : `${pendingCount} publicações ainda sem métricas — chegam em até 48h.`}
        </StateLine>
      ) : null}
    </div>
  );
}

function SortableHeader({
  label,
  title,
  numeric = false,
  active,
  order,
  onClick,
}: {
  label: string;
  title?: string;
  numeric?: boolean;
  active: boolean;
  order: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <th
      scope="col"
      className={cn(numeric && "via-num")}
      aria-sort={active ? (order === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        className="via-sort-button"
        aria-pressed={active}
        onClick={onClick}
        title={title}
      >
        {label}
        {active ? (
          order === "asc" ? (
            <ArrowUp className="size-3" aria-hidden="true" />
          ) : (
            <ArrowDown className="size-3" aria-hidden="true" />
          )
        ) : null}
      </button>
    </th>
  );
}
