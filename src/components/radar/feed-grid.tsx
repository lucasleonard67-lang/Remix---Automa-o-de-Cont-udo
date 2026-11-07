import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Loader2, Plus } from "lucide-react";
import { useState, type CSSProperties, type FormEvent } from "react";

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
import { FeedIcon } from "@/components/radar/feed-icon";
import { Switch } from "@/components/ui/switch";
import {
  FEED_PRESETS,
  useFetchRssNow,
  useRssFeedMutations,
  type FetchRssResult,
  type RssFeed,
} from "@/hooks/use-rss";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { humanizeError } from "@/lib/humanize-error";

// ---------------------------------------------------------------------------
// Fontes do Radar no padrão ladrilho + modal (igual integration-grid): um
// ladrilho por fonte com o favicon do site, o estado da última coleta e o
// motivo quando falhou. Clicar abre o modal para editar, testar ou remover.
// ---------------------------------------------------------------------------

type FeedStatus = "ok" | "failed" | "off" | "never";

const STATUS_LABEL: Record<FeedStatus, string> = {
  ok: "Atualizada",
  failed: "Falhou",
  off: "Desligada",
  never: "Sem coleta",
};

function statusOf(feed: RssFeed): FeedStatus {
  if (!feed.active) return "off";
  if (feed.last_error) return "failed";
  if (feed.last_ok_at || feed.last_fetched_at) return "ok";
  return "never";
}

function agora(iso: string | null): string | null {
  return iso ? formatDistanceToNow(new Date(iso), { locale: ptBR, addSuffix: true }) : null;
}

/** Resumo do resultado de uma coleta para o toast. */
function describeFetch(
  result: FetchRssResult,
  feedId?: string,
): { title: string; description?: string } {
  const mine = feedId ? result.results.find((r) => r.feed_id === feedId) : null;
  if (mine && "error" in mine)
    return { title: `${mine.feed}: a coleta falhou`, description: mine.error };
  const novas = mine && "new" in mine ? mine.new : result.totalNew;
  const failed = result.results.filter((r) => "error" in r).length;
  const title =
    novas > 0
      ? `${novas} notícia${novas === 1 ? "" : "s"} nova${novas === 1 ? "" : "s"}`
      : "Nenhuma notícia nova";
  const bits: string[] = [];
  if (!feedId && failed > 0)
    bits.push(`${failed} fonte${failed === 1 ? "" : "s"} com erro — veja em Fontes`);
  if (result.warning) bits.push(result.warning);
  return { title, description: bits.join(" · ") || undefined };
}

// ── Grade ────────────────────────────────────────────────────────────────────

export function FeedGrid({ feeds, canManage }: { feeds: RssFeed[]; canManage: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? (feeds.find((f) => f.id === openId) ?? null) : null;

  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {feeds.map((feed, index) => (
          <li
            key={feed.id}
            className="ce-reveal"
            style={{ "--ce-reveal-delay": `${Math.min(index, 8) * 60}ms` } as CSSProperties}
          >
            <FeedTile feed={feed} onOpen={canManage ? () => setOpenId(feed.id) : undefined} />
          </li>
        ))}
      </ul>
      {open ? <FeedDialog feed={open} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function FeedTile({ feed, onOpen }: { feed: RssFeed; onOpen?: () => void }) {
  const status = statusOf(feed);
  const detail =
    status === "failed"
      ? humanizeError(feed.last_error)
      : status === "ok"
        ? `${feed.last_item_count ?? 0} notícia${feed.last_item_count === 1 ? "" : "s"} na última coleta · ${agora(feed.last_ok_at ?? feed.last_fetched_at) ?? ""}`
        : status === "off"
          ? "Não entra na atualização automática."
          : "Entra na próxima atualização automática.";

  const body = (
    <>
      <FeedIcon url={feed.url} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-[var(--via-text-primary)]">
            {feed.name}
          </span>
          <StatusDot status={status} />
        </span>
        <span
          className={cn(
            "mt-0.5 line-clamp-2 block text-xs leading-snug",
            status === "failed" ? "text-[var(--via-coral-dark)]" : "text-[var(--via-text-muted)]",
          )}
        >
          {detail}
        </span>
      </span>
    </>
  );

  const className =
    "via-tile via-tile--atmos group flex h-full w-full items-start gap-3 rounded-[var(--via-radius-lg)] !p-4 text-left";

  if (!onOpen) return <div className={className}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      data-testid={`feed-${feed.id}`}
      className={cn(
        className,
        "via-tile--lift ce-tile hover:border-[var(--via-navy-20)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]",
      )}
    >
      {body}
    </button>
  );
}

function StatusDot({ status }: { status: FeedStatus }) {
  const tone =
    status === "ok"
      ? "text-[var(--via-text-primary)]"
      : status === "failed"
        ? "text-[var(--via-coral-dark)]"
        : "text-[var(--via-text-faint)]";
  const dot =
    status === "ok"
      ? "bg-[var(--via-navy)]"
      : status === "failed"
        ? "bg-[var(--via-coral)]"
        : "border border-[var(--via-border)]";
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs font-medium", tone)}>
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", dot)} />
      {STATUS_LABEL[status]}
    </span>
  );
}

// ── Modal: editar / testar / remover ─────────────────────────────────────────

function FeedDialog({ feed, onClose }: { feed: RssFeed; onClose: () => void }) {
  const { update, toggleActive, remove } = useRssFeedMutations();
  const fetchNow = useFetchRssNow();
  const [name, setName] = useState(feed.name);
  const [url, setUrl] = useState(feed.url);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const status = statusOf(feed);
  const dirty = name.trim() !== feed.name || url.trim() !== feed.url;

  const handleSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dirty || !name.trim() || !url.trim() || update.isPending) return;
    update.mutate(
      { id: feed.id, name, url },
      {
        onSuccess: () => {
          toast.success("Fonte salva");
          // Endereço novo → coleta na hora, para o erro (se houver) aparecer já.
          if (url.trim() !== feed.url) handleTest();
          else onClose();
        },
        onError: (error) => toast.error("Não foi possível salvar", { description: error.message }),
      },
    );
  };

  const handleTest = () => {
    fetchNow.mutate(
      { feedId: feed.id },
      {
        onSuccess: (result) => {
          const msg = describeFetch(result, feed.id);
          const mine = result.results.find((r) => r.feed_id === feed.id);
          if (mine && "error" in mine) toast.error(msg.title, { description: msg.description });
          else toast.success(msg.title, { description: msg.description });
        },
        onError: (error) =>
          toast.error("Não foi possível testar a fonte", { description: error.message }),
      },
    );
  };

  const handleRemove = () => {
    remove.mutate(feed.id, {
      onSuccess: () => {
        toast.success(`Fonte removida: ${feed.name}`);
        onClose();
      },
      onError: (error) => toast.error("Não foi possível remover", { description: error.message }),
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <FeedIcon url={feed.url} className="!size-8 !rounded-[10px]" iconClassName="size-4" />
            {feed.name}
          </DialogTitle>
          <DialogDescription>
            {status === "failed"
              ? "A última coleta falhou. Corrija o endereço ou teste de novo."
              : status === "ok"
                ? `Última coleta ${agora(feed.last_ok_at ?? feed.last_fetched_at)}, com ${feed.last_item_count ?? 0} notícia${feed.last_item_count === 1 ? "" : "s"}.`
                : status === "off"
                  ? "Desligada: não entra na atualização automática."
                  : "Ainda não coletada. Entra na próxima atualização automática."}
          </DialogDescription>
        </DialogHeader>

        {status === "failed" && feed.last_error ? (
          <p
            role="status"
            className="border-l-2 border-[var(--via-coral)] pl-3 text-sm text-[var(--via-coral-dark)]"
          >
            {humanizeError(feed.last_error)}
            {feed.last_error_at ? (
              <span className="block text-xs text-[var(--via-text-faint)]">
                {agora(feed.last_error_at)}
              </span>
            ) : null}
          </p>
        ) : null}

        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`feed-name-${feed.id}`}>Nome</Label>
            <Input
              id={`feed-name-${feed.id}`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`feed-url-${feed.id}`}>Endereço do feed (RSS)</Label>
            <Input
              id={`feed-url-${feed.id}`}
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-[var(--via-border-soft)] pt-4">
            <div>
              <p className="text-sm text-[var(--via-text-primary)]">Atualização automática</p>
              <p className="text-xs text-[var(--via-text-muted)]">
                {feed.active ? "Entra em cada coleta." : "Fica de fora até ligar de novo."}
              </p>
            </div>
            <Switch
              checked={feed.active}
              onCheckedChange={(active) =>
                toggleActive.mutate(
                  { id: feed.id, active },
                  {
                    onError: (error) =>
                      toast.error("Não foi possível ligar ou desligar a fonte", {
                        description: error.message,
                      }),
                  },
                )
              }
              aria-label={`Atualização automática de ${feed.name}`}
            />
          </div>

          <DialogFooter className="sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              className="text-[var(--via-coral-dark)] hover:text-[var(--via-coral-dark)]"
              onClick={() => setConfirmRemove(true)}
              disabled={remove.isPending}
            >
              Remover
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleTest}
                disabled={fetchNow.isPending || dirty}
                title={dirty ? "Salve o endereço antes de testar" : undefined}
              >
                {fetchNow.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : null}
                Testar e buscar
              </Button>
              <Button
                type="submit"
                disabled={!dirty || !name.trim() || !url.trim() || update.isPending}
              >
                {update.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                Salvar
              </Button>
            </div>
          </DialogFooter>
        </form>

        <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remover “{feed.name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                As notícias já coletadas dela também são apagadas. Não dá para desfazer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Manter</AlertDialogCancel>
              <AlertDialogAction onClick={handleRemove}>Remover fonte</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

// ── Modal: adicionar ─────────────────────────────────────────────────────────

export function AddFeedDialog({
  open,
  onClose,
  existingUrls,
}: {
  open: boolean;
  onClose: () => void;
  existingUrls: Set<string>;
}) {
  const { create } = useRssFeedMutations();
  const fetchNow = useFetchRssNow();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const presets = FEED_PRESETS.filter((p) => !existingUrls.has(p.url));
  const busy = create.isPending || fetchNow.isPending;

  const addAndFetch = (input: { name: string; url: string }) => {
    create.mutate(input, {
      onSuccess: (feedId) => {
        setName("");
        setUrl("");
        // Coleta na hora: se o endereço estiver errado, o motivo aparece agora,
        // não daqui a 30 minutos.
        fetchNow.mutate(
          { feedId },
          {
            onSuccess: (result) => {
              const msg = describeFetch(result, feedId);
              const mine = result.results.find((r) => r.feed_id === feedId);
              if (mine && "error" in mine) toast.error(msg.title, { description: msg.description });
              else
                toast.success(`${input.name}: ${msg.title.toLowerCase()}`, {
                  description: msg.description,
                });
            },
            onError: () =>
              toast.success(`Fonte adicionada: ${input.name}`, {
                description: "A primeira coleta entra na próxima atualização automática.",
              }),
          },
        );
      },
      onError: (error) => toast.error("Não foi possível adicionar", { description: error.message }),
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !url.trim() || busy) return;
    addAndFetch({ name, url });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar fonte</DialogTitle>
          <DialogDescription>
            Cole o endereço de RSS de um site. A primeira coleta roda na hora.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="feed-new-name">Nome</Label>
            <Input
              id="feed-new-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: G1 Tecnologia"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="feed-new-url">Endereço do feed (RSS)</Label>
            <Input
              id="feed-new-url"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://exemplo.com/feed"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || !url.trim() || busy}>
              {busy ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Plus aria-hidden="true" />
              )}
              Adicionar
            </Button>
          </DialogFooter>
        </form>

        {presets.length > 0 ? (
          <div className="space-y-2 border-t border-[var(--via-border-soft)] pt-4">
            <p className="text-xs font-medium text-[var(--via-text-muted)]">
              Ou escolha uma fonte pronta
            </p>
            <ul className="flex flex-wrap gap-2">
              {presets.map((preset) => (
                <li key={preset.url}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addAndFetch({ name: preset.name, url: preset.url })}
                    disabled={busy}
                  >
                    <Plus aria-hidden="true" />
                    {preset.name}
                    {preset.lang === "en" ? (
                      <span className="text-xs text-[var(--via-text-faint)]">EN</span>
                    ) : null}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
