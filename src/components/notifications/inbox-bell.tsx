import { Link, type LinkProps } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AudioLines,
  Bell,
  Clapperboard,
  FileText,
  type LucideIcon,
  ScanFace,
  SquarePen,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useInbox, useInboxRead } from "@/hooks/use-inbox";
import { browserNotifyOn, browserNotifySupported, setBrowserNotify } from "@/lib/browser-notify";
import { isUnread, unreadCount, type InboxItem, type InboxKind } from "@/lib/inbox";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Sino do cabeçalho: o que terminou (peça, vídeo, avatar, voz), com contador
// de não lidas e atalho para o item. Abrir marca como lido; os pontos seguem
// visíveis enquanto a lista está aberta. Aviso do navegador só por escolha.
// ---------------------------------------------------------------------------

const KIND_ICON: Record<InboxKind, LucideIcon> = {
  piece: SquarePen,
  video: Clapperboard,
  avatar: ScanFace,
  voice: AudioLines,
  roteiro: FileText,
};

function itemLink(item: InboxItem): Pick<LinkProps, "to" | "params" | "search"> {
  if (item.kind === "piece") return { to: "/criar/$jobId", params: { jobId: item.id } };
  if (item.kind === "video") return { to: "/videos" };
  if (item.kind === "roteiro") return { to: "/videos/novo", search: { rota: "avatar" } };
  return { to: item.kind === "avatar" ? "/marca/avatares" : "/marca/vozes" };
}

export function InboxBell() {
  const { data: items = [] } = useInbox();
  const { readAt, markRead } = useInboxRead();
  const [open, setOpen] = useState(false);
  // carimbo de antes de abrir: é ele que marca os pontos desta leitura
  const [shownFrom, setShownFrom] = useState<string | null>(null);
  const [browserOn, setBrowserOn] = useState(false);
  const [canBrowser, setCanBrowser] = useState(false);
  useEffect(() => {
    setCanBrowser(browserNotifySupported());
    setBrowserOn(browserNotifyOn());
  }, []);

  const unread = readAt ? unreadCount(items, readAt) : 0;

  const change = (next: boolean) => {
    setOpen(next);
    if (next) {
      setShownFrom(readAt);
      markRead();
    }
  };

  const toggleBrowser = async (on: boolean) => {
    const result = await setBrowserNotify(on);
    setBrowserOn(result);
    if (on && !result) toast.error("O navegador não liberou os avisos.");
  };

  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative size-8"
          aria-label={unread ? `Avisos, ${unread} não lidos` : "Avisos"}
          data-testid="avisos-sino"
        >
          <Bell aria-hidden="true" />
          {unread ? (
            <span
              className="ce-check-in absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--via-navy)] px-1 text-[10px] leading-none font-medium text-white tabular-nums motion-reduce:animate-none"
              aria-hidden="true"
              data-testid="avisos-contador"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(24rem,calc(100vw-2rem))] rounded-[var(--via-radius-lg)] p-0"
        aria-label="Avisos"
      >
        {items.length ? (
          <ol
            className="max-h-[60vh] divide-y divide-[var(--via-border-soft)] overflow-y-auto"
            data-testid="avisos-lista"
          >
            {items.map((item) => (
              <InboxRow
                key={item.key}
                item={item}
                unread={Boolean(shownFrom) && isUnread(item, shownFrom!)}
                onPick={() => setOpen(false)}
              />
            ))}
          </ol>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-[var(--via-text-muted)]">
            Nada por aqui ainda.
          </p>
        )}
        {canBrowser ? (
          <label className="flex cursor-pointer items-center justify-between gap-3 border-t border-[var(--via-border-soft)] px-4 py-2.5 text-xs text-[var(--via-text-muted)]">
            Avisar no navegador
            <Switch
              checked={browserOn}
              onCheckedChange={(on) => void toggleBrowser(on)}
              data-testid="avisos-navegador"
            />
          </label>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function InboxRow({
  item,
  unread,
  onPick,
}: {
  item: InboxItem;
  unread: boolean;
  onPick: () => void;
}) {
  const Icon = KIND_ICON[item.kind];
  return (
    <li>
      <Link
        {...itemLink(item)}
        onClick={onPick}
        className="flex min-w-0 items-center gap-3 px-4 py-2.5 transition-colors duration-[var(--via-dur)] hover:bg-[var(--via-navy-02)] focus-visible:bg-[var(--via-navy-04)] focus-visible:outline-none"
        data-testid={`aviso-${item.key}`}
      >
        <span
          className={cn(
            "inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--via-navy-06)] text-[var(--via-text-primary)]",
            item.tone === "error" && "text-destructive",
          )}
          aria-hidden="true"
        >
          <Icon className="size-4" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm leading-5 font-medium text-[var(--via-text-primary)]">
            {item.title}
          </span>
          <span className="block truncate text-xs leading-4 text-[var(--via-text-muted)]">
            {item.detail}
          </span>
        </span>
        <span className="shrink-0 text-xs text-[var(--via-text-soft)]">
          {formatDistanceToNow(new Date(item.at), { locale: ptBR })}
        </span>
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            unread ? "bg-[var(--via-navy)]" : "bg-transparent",
          )}
        >
          {unread ? <span className="sr-only">Não lido</span> : null}
        </span>
      </Link>
    </li>
  );
}
