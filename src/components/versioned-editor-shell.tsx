import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { AlertTriangle, ArrowLeft, Eye, History, Info } from "lucide-react";
import { useState, type ReactNode } from "react";

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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { FeedbackLabel } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useVersionList,
  type VersionedBrandTable,
  type VersionedEditorState,
} from "@/hooks/use-versioned-brand";

interface VersionedEditorShellProps {
  table: VersionedBrandTable;
  title: string;
  description: string;
  editor: VersionedEditorState;
  children: ReactNode;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "rascunho",
  active: "ativa",
  archived: "arquivada",
};

/**
 * Padrão das 4 telas versionadas de /marca: badge da versão ativa + estado do
 * rascunho, ações Salvar rascunho / Ativar versão / Descartar (admin), aviso
 * quando não há versão ativa e histórico compacto. Editar sempre edita o
 * RASCUNHO — a ativa só muda na ativação.
 */
export function VersionedEditorShell({
  table,
  title,
  description,
  editor,
  children,
}: VersionedEditorShellProps) {
  const {
    isAdmin,
    isLoading,
    isError,
    active,
    draft,
    dirty,
    saving,
    saved,
    activating,
    activated,
    discarding,
    onSaveDraft,
    onActivate,
    onDiscardDraft,
  } = editor;

  const [activateOpen, setActivateOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const versionsQuery = useVersionList(table);
  const busy = saving || activating || discarding;
  const hasSomethingToActivate = Boolean(draft) || dirty;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        to="/marca"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Marca
      </Link>

      <PageHeader title={title} description={description}>
        {isAdmin && !isLoading ? (
          <>
            <Button
              variant="outline"
              onClick={() => setDiscardOpen(true)}
              disabled={!hasSomethingToActivate || busy}
            >
              Descartar
            </Button>
            <Button variant="secondary" onClick={onSaveDraft} disabled={!dirty || busy}>
              <FeedbackLabel done={saved} doneLabel="Rascunho salvo">
                {saving ? "Salvando…" : "Salvar rascunho"}
              </FeedbackLabel>
            </Button>
            <Button
              onClick={() => setActivateOpen(true)}
              disabled={!hasSomethingToActivate || busy}
            >
              <FeedbackLabel done={activated} doneLabel="Versão ativa">
                {activating ? "Ativando…" : "Ativar versão"}
              </FeedbackLabel>
            </Button>
          </>
        ) : null}
      </PageHeader>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : isError ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>Não foi possível carregar</AlertTitle>
          <AlertDescription>Verifique a conexão e recarregue a página.</AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {active ? (
              <Badge className="font-medium">
                v{active.version} · ativa desde {format(new Date(active.updated_at), "dd/MM/yyyy")}
              </Badge>
            ) : (
              <Badge variant="outline" className="font-normal text-muted-foreground">
                nenhuma versão ativa
              </Badge>
            )}
            {isAdmin && draft ? (
              <Badge variant="secondary" className="font-normal">
                rascunho v{draft.version} em edição
              </Badge>
            ) : null}
            {dirty ? (
              <Badge variant="outline" className="font-normal text-[var(--via-text-primary)]">
                alterações não salvas
              </Badge>
            ) : null}
          </div>

          {!active ? (
            <Alert>
              <AlertTriangle className="size-4" aria-hidden="true" />
              <AlertTitle>Nenhuma versão ativa ainda</AlertTitle>
              <AlertDescription>
                As peças só usam esta área depois da primeira ativação.
                {isAdmin ? " Preencha os campos e clique em “Ativar versão”." : ""}
              </AlertDescription>
            </Alert>
          ) : null}

          {!isAdmin ? (
            <Alert>
              <Eye className="size-4" aria-hidden="true" />
              <AlertTitle>Somente leitura</AlertTitle>
              <AlertDescription>
                Só administradores editam a marca. Você está vendo a versão ativa.
              </AlertDescription>
            </Alert>
          ) : (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              Você edita um rascunho. As próximas peças só passam a usá-lo quando você clica em
              “Ativar versão”; peças já geradas não mudam.
            </p>
          )}

          {children}

          {(versionsQuery.data?.length ?? 0) > 0 ? (
            <div className="space-y-2 rounded-lg border border-border p-4">
              <h2 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <History className="size-4" aria-hidden="true" />
                Histórico de versões
              </h2>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {versionsQuery.data?.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">v{row.version}</span>
                    <Badge
                      variant={row.status === "active" ? "default" : "outline"}
                      className="font-normal"
                    >
                      {STATUS_LABELS[row.status] ?? row.status}
                    </Badge>
                    <span>{format(new Date(row.updated_at), "dd/MM/yyyy HH:mm")}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}

      <AlertDialog open={activateOpen} onOpenChange={setActivateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ativar esta versão?</AlertDialogTitle>
            <AlertDialogDescription>
              {active
                ? `A v${active.version} atual será arquivada e `
                : "Esta será a primeira versão ativa, e "}
              as próximas peças passam a usar a nova versão. Peças já geradas não mudam.
              {dirty ? " As alterações não salvas entram no rascunho antes de ativar." : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={onActivate} disabled={busy}>
              Ativar versão
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar o rascunho?</AlertDialogTitle>
            <AlertDialogDescription>
              As alterações não ativadas serão perdidas
              {active ? ` — a v${active.version} ativa continua valendo` : ""}. Não dá para
              desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDiscardDraft}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {discarding ? "Descartando…" : "Descartar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
