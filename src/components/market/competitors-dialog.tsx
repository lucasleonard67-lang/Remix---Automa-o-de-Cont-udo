import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Loader2, RefreshCw, X } from "lucide-react";
import { useState, type FormEvent } from "react";

import { BrandIcon } from "@/components/brand-icon";
import { Button } from "@/components/ui/button";
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
import {
  formatCount,
  useAddCompetitor,
  useCompetitors,
  useRemoveCompetitor,
  type Competitor,
  type MarketSummary,
  type SyncProgress,
} from "@/hooks/use-market";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { humanizeError } from "@/lib/humanize-error";

// ---------------------------------------------------------------------------
// Modal "Concorrentes" (padrão ladrilho + modal da integration-grid): um
// ladrilho por @ com avatar/iniciais, seguidores, posts lidos e o estado da
// última leitura. Adicionar pelo @, remover no ladrilho, "Ler agora" no rodapé.
// ---------------------------------------------------------------------------

export interface CompetitorsDialogProps {
  open: boolean;
  onClose: () => void;
  summary: MarketSummary | null | undefined;
  progress: SyncProgress;
  /** Sincroniza todos (sem id) ou um concorrente recém-adicionado. */
  onSync: (competitorId?: string) => Promise<void>;
}

export function CompetitorsDialog({
  open,
  onClose,
  summary,
  progress,
  onSync,
}: CompetitorsDialogProps) {
  const competitors = useCompetitors();
  const list = competitors.data ?? [];

  const handleSyncAll = () => {
    void onSync().catch((error: unknown) => {
      toast.retry("Não foi possível ler os concorrentes", {
        description: error instanceof Error ? error.message : undefined,
        onRetry: handleSyncAll,
      });
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Concorrentes</DialogTitle>
          <DialogDescription>
            Perfis públicos do Instagram que você quer comparar. Cada leitura gasta créditos da sua
            conta Apify.
          </DialogDescription>
        </DialogHeader>

        <CompetitorsList summary={summary} progress={progress} onSync={onSync} />

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleSyncAll}
            disabled={progress.running || list.length === 0}
          >
            {progress.running ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw aria-hidden="true" />
            )}
            {progress.running
              ? `Lendo ${Math.min(progress.done + 1, Math.max(progress.total, 1))} de ${Math.max(progress.total, 1)}…`
              : "Ler agora"}
          </Button>
          <Button type="button" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface CompetitorsListProps {
  summary: MarketSummary | null | undefined;
  progress: SyncProgress;
  /** Sincroniza todos (sem id) ou um concorrente recém-adicionado. */
  onSync: (competitorId?: string) => Promise<void>;
  /** Limite de perfis cadastráveis (o padrão é o teto da leitura, 12). */
  max?: number;
}

/**
 * Campo "@perfil" + Adicionar e os ladrilhos dos concorrentes. Sem Dialog em
 * volta: o modal do Dashboard e o passo "Mercado" do fluxo de configuração
 * usam a mesma lista.
 */
export function CompetitorsList({ summary, progress, onSync, max = 12 }: CompetitorsListProps) {
  const competitors = useCompetitors();
  const add = useAddCompetitor();
  const remove = useRemoveCompetitor();
  const [handle, setHandle] = useState("");

  const list = competitors.data ?? [];
  const postsByHandle = new Map((summary?.competitors ?? []).map((c) => [c.handle, c.posts]));
  const full = list.length >= max;

  const handleAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = handle.trim();
    if (!value || add.isPending) return;
    try {
      const created = await add.mutateAsync(value);
      setHandle("");
      toast.success(`@${created.handle} adicionado`, { description: "Lendo os posts do perfil…" });
      void onSync(created.id).catch(() => undefined);
    } catch (error) {
      toast.error("Não foi possível adicionar o concorrente", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  const handleRemove = (item: Competitor) => {
    remove.mutate(item.id, {
      onSuccess: () => toast.success(`@${item.handle} removido`),
      onError: (error) => toast.error("Não foi possível remover", { description: error.message }),
    });
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleAdd} className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="competitor-handle">Perfil</Label>
          <Input
            id="competitor-handle"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            placeholder="@perfil ou link do Instagram"
            autoComplete="off"
            disabled={add.isPending || full}
          />
        </div>
        <Button type="submit" disabled={!handle.trim() || add.isPending || full}>
          {add.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Adicionar
        </Button>
      </form>

      {competitors.isLoading ? (
        <div className="grid gap-2">
          <Skeleton className="h-[76px] rounded-[var(--via-radius-lg)]" />
          <Skeleton className="h-[76px] rounded-[var(--via-radius-lg)]" />
        </div>
      ) : list.length === 0 ? (
        <p className="text-sm text-[var(--via-text-muted)]" role="status">
          Nenhum concorrente ainda. Comece pelos 3 perfis que mais disputam a sua audiência.
        </p>
      ) : (
        <ul className="grid gap-2" aria-label="Concorrentes">
          {list.map((item) => (
            <li key={item.id}>
              <CompetitorTile
                item={item}
                posts={postsByHandle.get(item.handle) ?? 0}
                syncing={progress.running}
                removing={remove.isPending && remove.variables === item.id}
                onRemove={() => handleRemove(item)}
              />
            </li>
          ))}
        </ul>
      )}

      {progress.warning ? (
        <p className="text-xs text-[var(--via-text-muted)]" role="status">
          {progress.warning}
        </p>
      ) : null}
    </div>
  );
}

function CompetitorTile({
  item,
  posts,
  syncing,
  removing,
  onRemove,
}: {
  item: Competitor;
  posts: number;
  syncing: boolean;
  removing: boolean;
  onRemove: () => void;
}) {
  const pending = !item.last_sync_at;
  const failed = Boolean(item.last_error);
  const status =
    pending && syncing
      ? "Lendo…"
      : pending
        ? "Sem leitura"
        : failed
          ? "Falhou"
          : `Lido ${formatDistanceToNowStrict(new Date(item.last_sync_at as string), { locale: ptBR, addSuffix: true })}`;
  const ok = !pending && !failed;

  return (
    <div
      className="flex h-full items-start gap-3 rounded-[var(--via-radius-lg)] border border-[var(--via-border-soft)] bg-[var(--via-surface)] p-3.5"
      data-testid={`competitor-${item.handle}`}
    >
      <Avatar item={item} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium text-[var(--via-text-primary)]">
            <BrandIcon name="instagram" className="size-3.5" />
            <span className="truncate">@{item.handle}</span>
          </span>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 text-xs font-medium",
              ok ? "text-[var(--via-text-primary)]" : "text-[var(--via-text-faint)]",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 rounded-full",
                ok ? "bg-[var(--via-navy)]" : "border border-[var(--via-border)]",
              )}
            />
            {status}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-[var(--via-text-muted)]">
          {item.followers !== null ? `${formatCount(item.followers)} seguidores` : "Seguidores —"} ·{" "}
          {posts} {posts === 1 ? "post" : "posts"}
        </p>
        {failed ? (
          <p className="mt-1 text-xs text-[var(--via-text-faint)]">
            {humanizeError(item.last_error)}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={removing}
        aria-label={`Remover @${item.handle}`}
        className="-mr-1 -mt-1 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[var(--via-text-faint)] transition-colors hover:bg-[var(--via-navy-06)] hover:text-[var(--via-text-primary)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)] disabled:opacity-50"
      >
        {removing ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <X className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

function Avatar({ item }: { item: Competitor }) {
  const [broken, setBroken] = useState(false);
  const show = Boolean(item.avatar_url) && !broken;
  return (
    <span
      aria-hidden="true"
      className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--via-border-soft)] bg-[var(--via-navy-04)] font-mono text-xs font-medium text-[var(--via-text-muted)]"
    >
      {show ? (
        <img
          src={item.avatar_url ?? undefined}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          className="size-full object-cover"
        />
      ) : (
        item.handle.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
