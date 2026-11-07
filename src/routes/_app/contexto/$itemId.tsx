import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { ArrowLeft, ExternalLink, FileText, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { avisoDoDrive } from "@/hooks/use-delete-content";
import { toast } from "@/lib/toast";

import { ContextStatusBadge } from "@/components/context-status-badge";
import { EmptyState } from "@/components/empty-state";
import { PageEyebrow } from "@/components/page-header";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  CONTEXT_KIND_LABELS,
  useContextChunkCount,
  useContextItem,
  useDeleteContextItem,
  useIngestContext,
  useUpdateContextItem,
  type CaseMetadata,
  type ContextItem,
} from "@/hooks/use-context-items";

export const Route = createFileRoute("/_app/contexto/$itemId")({
  component: ContextItemPage,
});

function ContextItemPage() {
  const { itemId } = Route.useParams();
  const navigate = useNavigate();

  const { data: item, isLoading, isError } = useContextItem(itemId);
  const { data: chunkCount } = useContextChunkCount(itemId);
  const ingest = useIngestContext();
  const deleteItem = useDeleteContextItem();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (isError || !item) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <BackLink />
        <EmptyState
          icon={FileText}
          title="Item não encontrado"
          description="Ele pode ter sido excluído ou o link está errado. Volte para Contexto e busque de novo."
        />
      </div>
    );
  }

  const handleReprocess = () => {
    ingest.mutate(item.id, {
      onSuccess: () => {
        toast.success("Processamento iniciado", {
          description:
            "O status muda para “Pronto” quando o item estiver disponível para as gerações.",
        });
      },
      onError: (error) => {
        toast.error("Não foi possível reprocessar", { description: error.message });
      },
    });
  };

  const handleDelete = () => {
    deleteItem.mutate(item.id, {
      onSuccess: ({ drive_pendente }) => {
        toast.success("Item excluído", { description: avisoDoDrive(drive_pendente) });
        navigate({ to: "/contexto" });
      },
      onError: (error) => {
        toast.error("Não foi possível excluir", { description: error.message });
      },
    });
  };

  const caseMeta =
    item.kind === "case" ? (item.metadata as unknown as Partial<CaseMetadata>) : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <PageEyebrow />
          <h1 className="text-3xl font-medium tracking-[-0.025em] text-[var(--via-text-primary)]">
            {item.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{CONTEXT_KIND_LABELS[item.kind] ?? item.kind}</Badge>
            <ContextStatusBadge status={item.status} />
            {item.tags.map((tag) => (
              <Badge key={tag} variant="outline" className="font-normal">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={handleReprocess}
            disabled={ingest.isPending || item.status === "processing"}
          >
            <RefreshCw className={ingest.isPending ? "animate-spin" : ""} aria-hidden="true" />
            Processar de novo
          </Button>
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil aria-hidden="true" />
            Editar
          </Button>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 aria-hidden="true" />
            Excluir
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Conteúdo</CardTitle>
            </CardHeader>
            <CardContent>
              {item.body ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {item.body}
                </p>
              ) : item.file_path ? (
                <p className="text-sm text-muted-foreground">
                  Conteúdo vindo do arquivo{" "}
                  <span className="font-mono text-xs">{item.file_path}</span>. As gerações usam o
                  texto extraído dele.
                </p>
              ) : item.source_url ? (
                <p className="text-sm text-muted-foreground">
                  Conteúdo extraído do link de origem.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">Este item não tem texto.</p>
              )}
            </CardContent>
          </Card>

          {caseMeta ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Dados do case</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  <MetaField label="Métrica" value={formatCaseMetric(caseMeta)} />
                  <MetaField label="Setor" value={caseMeta.sector || "—"} />
                  <MetaField label="Cliente" value={caseMeta.client_name || "—"} />
                  <MetaField
                    label="Política de citação"
                    value={
                      caseMeta.citation_policy === "named"
                        ? "Pode citar o nome"
                        : caseMeta.citation_policy === "anonymous"
                          ? "Anônimo"
                          : "—"
                    }
                  />
                  <MetaField
                    label="Objeções que responde"
                    value={
                      caseMeta.objection_tags?.length ? caseMeta.objection_tags.join(", ") : "—"
                    }
                  />
                  <MetaField label="Fonte" value={caseMeta.source_url || "—"} />
                  {caseMeta.quote ? (
                    <div className="sm:col-span-2">
                      <dt className="text-muted-foreground">Citação do cliente</dt>
                      <dd className="mt-1 border-l-2 border-border pl-3 italic text-foreground">
                        “{caseMeta.quote}”
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Detalhes</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <MetaField
                label="Criado em"
                value={format(new Date(item.created_at), "dd/MM/yyyy HH:mm")}
              />
              <MetaField
                label="Atualizado em"
                value={format(new Date(item.updated_at), "dd/MM/yyyy HH:mm")}
              />
              <MetaField label="Trechos indexados" value={String(chunkCount ?? "—")} />
              {item.source_url ? (
                <div>
                  <dt className="text-muted-foreground">Link de origem</dt>
                  <dd className="mt-1">
                    <a
                      href={item.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 break-all text-foreground underline underline-offset-4"
                    >
                      {item.source_url}
                      <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                    </a>
                  </dd>
                </div>
              ) : null}
              {item.file_path ? <MetaField label="Arquivo" value={item.file_path} mono /> : null}
              {item.status === "error" ? (
                <MetaField
                  label="Por que falhou"
                  value={String(
                    (item.metadata as { error?: string })?.error ??
                      "O processamento falhou. Clique em Processar de novo.",
                  )}
                />
              ) : null}
            </dl>
          </CardContent>
        </Card>
      </div>

      <EditItemDialog item={item} open={editOpen} onOpenChange={setEditOpen} />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este item do Contexto?</AlertDialogTitle>
            <AlertDialogDescription>
              Ele deixa de ser usado nas próximas gerações. Peças que já usaram este item continuam
              na Biblioteca. Não dá para desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteItem.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteItem.isPending ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/contexto"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Contexto
    </Link>
  );
}

function MetaField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "mt-1 break-all font-mono text-xs" : "mt-1 text-foreground"}>
        {value}
      </dd>
    </div>
  );
}

function formatCaseMetric(meta: Partial<CaseMetadata>): string {
  if (meta.metric_value == null) return "—";
  switch (meta.metric_type) {
    case "brl":
      return meta.metric_value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    case "multiple":
      return `${meta.metric_value}x`;
    case "percent":
      return `${meta.metric_value}%`;
    default:
      return String(meta.metric_value);
  }
}

function EditItemDialog({
  item,
  open,
  onOpenChange,
}: {
  item: ContextItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateItem = useUpdateContextItem();
  const [title, setTitle] = useState(item.title);
  const [tags, setTags] = useState(item.tags.join(", "));
  const [body, setBody] = useState(item.body ?? "");

  // Ressincroniza os campos ao abrir (o item pode ter mudado via refetch).
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setTitle(item.title);
      setTags(item.tags.join(", "));
      setBody(item.body ?? "");
    }
    onOpenChange(next);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (updateItem.isPending) return;
    if (!title.trim()) {
      toast.error("O título não pode ficar vazio.");
      return;
    }
    const bodyChanged = item.body !== null && body !== item.body;
    updateItem.mutate(
      {
        id: item.id,
        title: title.trim(),
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        ...(item.body !== null ? { body } : {}),
      },
      {
        onSuccess: () => {
          toast.success("Item atualizado", {
            description: bodyChanged
              ? "O texto mudou. Clique em “Processar de novo” para as gerações usarem a versão nova."
              : undefined,
          });
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error("Não foi possível salvar", { description: error.message });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar item</DialogTitle>
          <DialogDescription>Altere o título, as tags e o texto do item.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-title">Título</Label>
            <Input
              id="edit-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-tags">Tags</Label>
            <Input
              id="edit-tags"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="separadas, por, vírgula"
            />
          </div>
          {item.body !== null ? (
            <div className="space-y-2">
              <Label htmlFor="edit-body">Conteúdo</Label>
              <Textarea
                id="edit-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                className="min-h-40"
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={updateItem.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={updateItem.isPending}>
              {updateItem.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
