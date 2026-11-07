import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { FolderOpen, Plus, Search, SearchX, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { ContextItemForm } from "@/components/context-item-form";
import { ContextStatusBadge } from "@/components/context-status-badge";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { avisoDoDrive } from "@/hooks/use-delete-content";
import { humanizeError } from "@/lib/humanize-error";
import { toast } from "@/lib/toast";
import {
  CONTEXT_KINDS,
  CONTEXT_KIND_LABELS,
  useContextItems,
  useContextSearch,
  useDeleteContextItem,
  type ContextItem,
  type ContextKind,
  type ContextSearchResult,
} from "@/hooks/use-context-items";

export const Route = createFileRoute("/_app/contexto/")({
  component: ContextListPage,
});

type KindFilter = ContextKind | "all";

function ContextListPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");

  // Busca com debounce de 400ms → edge function search-context.
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchInput.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const isSearching = debouncedQuery.length > 0;
  const kind = kindFilter === "all" ? null : kindFilter;

  const itemsQuery = useContextItems({ kind });
  const searchQuery = useContextSearch(debouncedQuery, {
    kinds: kind ? [kind] : undefined,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Contexto"
        description="A base que as gerações consultam. Adicione transcrições, posts, documentos, cases e ofertas da marca."
      >
        {/* lista vazia: a ação navy é a do estado vazio */}
        <Button
          variant={itemsQuery.data?.length === 0 ? "outline" : "default"}
          onClick={() => setFormOpen(true)}
        >
          <Plus aria-hidden="true" />
          Adicionar
        </Button>
      </PageHeader>

      <div className="space-y-4">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Buscar por assunto ou palavra…"
            className="pl-9"
            aria-label="Buscar no contexto"
          />
        </div>

        <Tabs value={kindFilter} onValueChange={(value) => setKindFilter(value as KindFilter)}>
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="all">Todos</TabsTrigger>
            {CONTEXT_KINDS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {CONTEXT_KIND_LABELS[value]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {isSearching ? (
        <SearchResults
          isLoading={searchQuery.isLoading}
          isError={searchQuery.isError}
          errorMessage={searchQuery.error ? humanizeError(searchQuery.error.message) : undefined}
          results={searchQuery.data ?? []}
        />
      ) : (
        <ItemsTable
          isLoading={itemsQuery.isLoading}
          isError={itemsQuery.isError}
          items={itemsQuery.data ?? []}
          onAdd={() => setFormOpen(true)}
        />
      )}

      <ContextItemForm open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}

function ItemsTable({
  isLoading,
  isError,
  items,
  onAdd,
}: {
  isLoading: boolean;
  isError: boolean;
  items: ContextItem[];
  onAdd: () => void;
}) {
  const excluir = useDeleteContextItem();
  const [excluindo, setExcluindo] = useState<ContextItem | null>(null);
  const confirmar = () => {
    if (!excluindo) return;
    excluir.mutate(excluindo.id, {
      onSuccess: ({ drive_pendente }) =>
        toast.success("Item excluído", { description: avisoDoDrive(drive_pendente) }),
      onError: (error) => toast.error("Não foi possível excluir", { description: error.message }),
    });
  };

  if (isLoading) return <ListSkeleton />;

  if (isError) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="Não foi possível carregar o Contexto"
        description="Recarregue a página. Se continuar, confira sua conexão."
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="Nenhum item no Contexto ainda"
        description="Adicione transcrições, posts, cases e ofertas. Quanto mais material bom, mais as peças soam como a marca."
      >
        <Button onClick={onAdd}>
          <Plus aria-hidden="true" />
          Adicionar conteúdo
        </Button>
      </EmptyState>
    );
  }

  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Título</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead className="hidden md:table-cell">Tags</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden sm:table-cell">Data</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">Ações</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="max-w-64 font-medium">
                <Link
                  to="/contexto/$itemId"
                  params={{ itemId: item.id }}
                  className="block truncate hover:underline"
                  title={item.title}
                >
                  {item.title}
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{CONTEXT_KIND_LABELS[item.kind] ?? item.kind}</Badge>
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <div className="flex max-w-56 flex-wrap gap-1">
                  {item.tags.slice(0, 4).map((tag) => (
                    <Badge key={tag} variant="outline" className="font-normal">
                      {tag}
                    </Badge>
                  ))}
                  {item.tags.length > 4 ? (
                    <span className="text-xs text-muted-foreground">+{item.tags.length - 4}</span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell>
                <ContextStatusBadge status={item.status} />
              </TableCell>
              <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                {format(new Date(item.created_at), "dd/MM/yyyy")}
              </TableCell>
              <TableCell className="p-1 text-right">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Excluir ${item.title}`}
                  onClick={() => setExcluindo(item)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <AlertDialog open={Boolean(excluindo)} onOpenChange={(open) => !open && setExcluindo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este item do Contexto?</AlertDialogTitle>
            <AlertDialogDescription>
              {excluindo?.title} deixa de ser usado nas próximas gerações. Peças que já usaram este
              item continuam na Biblioteca. Não dá para desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={excluir.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmar}
            >
              {excluir.isPending ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SearchResults({
  isLoading,
  isError,
  errorMessage,
  results,
}: {
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  results: ContextSearchResult[];
}) {
  if (isLoading) return <ListSkeleton />;

  if (isError) {
    return (
      <EmptyState
        icon={SearchX}
        title="Busca indisponível"
        description={errorMessage ?? "Não foi possível buscar no Contexto. Tente de novo."}
      />
    );
  }

  if (results.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title="Nenhum conteúdo com essas palavras"
        description="Tente outras palavras ou volte para a aba Todos."
      />
    );
  }

  return (
    <div className="space-y-3">
      {results.map((result) => (
        <Link
          key={result.item_id}
          to="/contexto/$itemId"
          params={{ itemId: result.item_id }}
          className="block rounded-lg border border-border bg-card p-4 transition-colors hover:bg-[var(--via-navy-06)]"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{result.title}</span>
            <Badge variant="secondary">{CONTEXT_KIND_LABELS[result.kind] ?? result.kind}</Badge>
            <Badge variant="outline" className="ml-auto font-normal text-muted-foreground">
              relevância {result.score.toFixed(2)}
            </Badge>
          </div>
          <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{result.excerpt}</p>
        </Link>
      ))}
    </div>
  );
}
