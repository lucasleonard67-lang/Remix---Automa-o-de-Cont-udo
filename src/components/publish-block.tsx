import { format } from "date-fns";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ExternalLink,
  Loader2,
  RefreshCw,
  Send,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";

import { PlatformMark, StateLine } from "@/components/analytics/shared";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useAppSetting } from "@/hooks/use-app-settings";
import { usePublishedPost, usePublishedPostRealtime } from "@/hooks/use-published-posts";
import {
  PUBLISH_STATUS_LABELS,
  type PublishedPost,
  type ZernioAccount,
  useCancelPublish,
  usePublishPiece,
  useRetryPublish,
  useSyncPublishStatus,
  useZernioAccounts,
} from "@/hooks/use-zernio";
import { humanizeError } from "@/lib/humanize-error";
import { openIntegration } from "@/lib/integration-modal";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Publicação real via Zernio no detalhe da peça (Eixo 1 — docs/10 §Eixo 1), na
// linguagem do kit: contas conectadas como ladrilhos com o ícone da rede (check
// com mola), "Publicar agora"/"Agendar envio" em pílula, "Trocar conta" abre o
// modal do Zernio ali mesmo. Estados assíncronos (scheduled→published) chegam
// pelo zernio-webhook + Realtime; "Atualizar status" é reconciliação on-demand.
// ---------------------------------------------------------------------------

interface PublishBlockPiece {
  id: string;
  status: string;
  scheduled_at: string | null;
  /** Decide quais contas conectadas aceitam publicar esta peça. */
  channel_type: string;
}

export function PublishBlock({
  piece,
  prepareArts,
}: {
  piece: PublishBlockPiece;
  /** Gera e salva as artes da peça antes de enviar (Instagram); lança com mensagem. */
  prepareArts?: () => Promise<void>;
}) {
  const { data: post, isLoading, isError, refetch } = usePublishedPost(piece.id);
  const [preparing, setPreparing] = useState(false);
  usePublishedPostRealtime(piece.id);

  const publishPiece = usePublishPiece();

  // Quando MAIS DE UMA conta aceita este formato, a edge recusa publicar sem
  // saber qual — e o cliente nunca mandava conta, então virava beco sem saída.
  // A escolha é feita aqui, com os mesmos dados que a matriz de Config usa.
  const formatosPorConta =
    useAppSetting<Record<string, { formats?: string[] }>>("zernio_account_formats");
  const contasZernio = useZernioAccounts();
  const contasQueAceitam = (contasZernio.data ?? []).filter((conta) =>
    (formatosPorConta.data?.[conta.accountId]?.formats ?? []).includes(piece.channel_type),
  );
  const [contaEscolhida, setContaEscolhida] = useState<string | null>(null);
  const precisaEscolher = contasQueAceitam.length > 1;
  const retryPublish = useRetryPublish();
  const cancelPublish = useCancelPublish();
  const syncStatus = useSyncPublishStatus();

  const [confirmNow, setConfirmNow] = useState(false);
  const [confirmSchedule, setConfirmSchedule] = useState(false);

  const busy =
    preparing ||
    publishPiece.isPending ||
    retryPublish.isPending ||
    cancelPublish.isPending ||
    syncStatus.isPending;

  const publish = async (mode: "now" | "schedule") => {
    if (precisaEscolher && !contaEscolhida) {
      toast.error("Escolha a conta de destino", {
        description: "Clique em uma das contas acima e publique de novo.",
      });
      return;
    }
    if (prepareArts) {
      setPreparing(true);
      try {
        await prepareArts();
      } catch (error) {
        toast.retry("Não foi possível preparar as artes", {
          description: error instanceof Error ? error.message : undefined,
          onRetry: () => void publish(mode),
        });
        return;
      } finally {
        setPreparing(false);
      }
    }
    publishPiece.mutate(
      {
        pieceId: piece.id,
        mode,
        ...(contaEscolhida ? { accountId: contaEscolhida } : {}),
      },
      {
        onSuccess: (row) => {
          toast.success(
            row.status === "published"
              ? "Peça publicada"
              : row.status === "scheduled"
                ? "Publicação agendada"
                : "Publicação enviada",
            {
              description:
                row.status === "scheduled" && row.scheduled_for
                  ? `Sai em ${format(new Date(row.scheduled_for), "dd/MM/yyyy 'às' HH:mm")}.`
                  : "O status aparece aqui assim que mudar.",
            },
          );
        },
        onError: (error) =>
          toast.retry("Não foi possível publicar", {
            description: error.message,
            onRetry: () => void publish(mode),
          }),
      },
    );
  };

  const retry = () => {
    if (!post) return;
    if (!post.zernio_post_id) {
      // Falhou antes de chegar ao Zernio — o publish reaproveita a linha.
      // O mode sai da fonte de verdade ATUAL (scheduled_at da peça, no futuro),
      // não do scheduled_for congelado na linha: um horário que já passou
      // levaria a um 400 schedule_in_past sem saída.
      const scheduleValid =
        Boolean(piece.scheduled_at) &&
        new Date(piece.scheduled_at as string).getTime() > Date.now();
      void publish(scheduleValid ? "schedule" : "now");
      return;
    }
    retryPublish.mutate(
      { publishedPostId: post.id, pieceId: piece.id },
      {
        onSuccess: () => toast.success("Tentando publicar de novo"),
        onError: (error) =>
          toast.error("Não foi possível tentar de novo", { description: error.message }),
      },
    );
  };

  const cancel = () => {
    if (!post) return;
    cancelPublish.mutate(
      { publishedPostId: post.id, pieceId: piece.id },
      {
        onSuccess: () => toast.success("Agendamento cancelado"),
        onError: (error) =>
          toast.error("Não foi possível cancelar", { description: error.message }),
      },
    );
  };

  const sync = () => {
    syncStatus.mutate(piece.id, {
      onError: (error) =>
        toast.error("Não foi possível atualizar o status", { description: error.message }),
    });
  };

  // Linha "viva" ou terminal define a UI; cancelada volta para os botões.
  const active = post && post.status !== "cancelled" ? post : null;

  // Gate do estado da query: sem ele os botões de publicar apareceriam durante
  // o load (ou com a query em erro) até para peça que JÁ publicou.
  if (isLoading) {
    return <Skeleton className="h-10 w-full rounded-full" />;
  }
  if (isError) {
    return (
      <StateLine>
        Não foi possível carregar o status da publicação.{" "}
        <button
          type="button"
          className="cursor-pointer font-medium text-[var(--via-text-primary)] underline-offset-4 hover:underline"
          onClick={() => void refetch()}
        >
          Tentar de novo
        </button>
      </StateLine>
    );
  }
  if (!active && piece.status === "published") {
    // Peça publicada sem linha legível (ex.: raro pós-migração) — nunca
    // oferecer "Publicar agora" numa peça que já saiu.
    return <StateLine>Esta peça já foi publicada.</StateLine>;
  }

  return (
    <div className="space-y-3">
      {!active && piece.channel_type === "instagram_reel" ? (
        // A peça de Reel é roteiro: sem vídeo ligado a ela, o Zernio não tem o
        // que postar. Vídeo publica pelo card do Diretor em Vídeos.
        <StateLine>
          Este Reel ainda não tem vídeo. Produza o vídeo ao lado e publique em Vídeos, no botão
          Publicar no Instagram.
        </StateLine>
      ) : !active ? (
        <>
          {contasQueAceitam.length > 0 ? (
            <ul
              className="grid gap-2"
              aria-label="Conta de destino"
              data-testid={precisaEscolher ? "escolher-conta" : undefined}
            >
              {contasQueAceitam.map((conta) => (
                <li key={conta.accountId}>
                  <AccountTile
                    conta={conta}
                    selected={precisaEscolher ? contaEscolhida === conta.accountId : true}
                    onSelect={precisaEscolher ? () => setContaEscolhida(conta.accountId) : null}
                  />
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setConfirmNow(true)} disabled={busy}>
              {preparing ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Send aria-hidden="true" />
              )}
              {preparing ? "Preparando as artes…" : "Publicar agora"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirmSchedule(true)}
              disabled={busy || !piece.scheduled_at}
              title={!piece.scheduled_at ? "Marque a data acima para agendar o envio" : undefined}
            >
              <CalendarClock aria-hidden="true" />
              Agendar envio
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-[var(--via-text-muted)]"
              onClick={() => openIntegration("zernio")}
              aria-haspopup="dialog"
            >
              Trocar conta
            </Button>
          </div>
          <StateLine className="text-xs">
            {piece.channel_type.startsWith("instagram")
              ? "As artes saem como estão na prévia."
              : "Sai na conta conectada."}
          </StateLine>
        </>
      ) : (
        <PublishStateRow
          post={active}
          busy={busy}
          onRetry={retry}
          onCancel={cancel}
          onSync={sync}
        />
      )}

      <AlertDialog open={confirmNow} onOpenChange={setConfirmNow}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publicar agora?</AlertDialogTitle>
            <AlertDialogDescription>
              A peça vai ao ar na hora, na conta conectada. Depois de publicada, só dá para apagar
              direto na rede.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void publish("now")}>Publicar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmSchedule} onOpenChange={setConfirmSchedule}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Agendar envio?</AlertDialogTitle>
            <AlertDialogDescription>
              {piece.scheduled_at
                ? `O Zernio publica sozinho em ${format(
                    new Date(piece.scheduled_at),
                    "dd/MM/yyyy 'às' HH:mm",
                  )}. Até lá, você pode mudar a data ou cancelar.`
                : "Marque a data acima e tente de novo."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void publish("schedule")}>Agendar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Conta conectada como ladrilho do kit: ícone da rede no poço, nome e check com mola. */
function AccountTile({
  conta,
  selected,
  onSelect,
}: {
  conta: ZernioAccount;
  selected: boolean;
  /** null = conta única, só informa (não há o que escolher). */
  onSelect: (() => void) | null;
}) {
  const nome = conta.name || conta.username || conta.accountId;
  const body = (
    <>
      <span className="ce-tile-well !size-9 !rounded-[10px]">
        <PlatformMark platform={conta.platform} className="size-4" />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium text-[var(--via-text-primary)]">
          {nome}
        </span>
        {conta.username && conta.username !== nome ? (
          <span className="block truncate text-xs text-[var(--via-text-muted)]">
            @{conta.username.replace(/^@/, "")}
          </span>
        ) : null}
      </span>
      {selected ? (
        <span
          className="ce-check-in flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--via-navy)] text-white"
          aria-hidden="true"
        >
          <Check className="size-3" />
        </span>
      ) : (
        <span
          className="size-5 shrink-0 rounded-full border border-[var(--via-border)] transition-colors duration-[var(--via-dur)] group-hover:border-[var(--via-navy-30)]"
          aria-hidden="true"
        />
      )}
    </>
  );
  const base =
    "via-tile flex w-full items-center gap-3 rounded-[var(--via-radius-md)] !px-3 !py-2.5";
  if (!onSelect) {
    return <div className={base}>{body}</div>;
  }
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        base,
        "via-tile--lift ce-tile group cursor-pointer focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]",
        selected && "!border-[var(--via-navy)]",
      )}
    >
      {body}
    </button>
  );
}

function PublishStateRow({
  post,
  busy,
  onRetry,
  onCancel,
  onSync,
}: {
  post: PublishedPost;
  busy: boolean;
  onRetry: () => void;
  onCancel: () => void;
  onSync: () => void;
}) {
  const inFlight = post.status === "pending" || post.status === "publishing";
  const failed = post.status === "failed" || post.status === "partial";
  const canSync = post.status !== "published" && Boolean(post.zernio_post_id);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "via-meta-chip",
            post.status === "published" && "!border-transparent !bg-[var(--via-navy)] !text-white",
            failed &&
              "!border-transparent !bg-[rgba(184,92,92,0.12)] !text-[var(--via-coral-dark)]",
          )}
        >
          {inFlight ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : null}
          {PUBLISH_STATUS_LABELS[post.status] ?? post.status}
        </span>
        {post.status === "scheduled" && post.scheduled_for ? (
          <span className="text-xs tabular-nums text-[var(--via-text-muted)]">
            sai {format(new Date(post.scheduled_for), "dd/MM 'às' HH:mm")}
          </span>
        ) : null}
        {post.status === "published" && post.published_at ? (
          <span className="text-xs tabular-nums text-[var(--via-text-muted)]">
            em {format(new Date(post.published_at), "dd/MM 'às' HH:mm")}
          </span>
        ) : null}
      </div>

      {post.public_url ? (
        <a
          href={post.public_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--via-text-primary)] underline-offset-4 hover:underline"
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          Ver publicação
        </a>
      ) : null}

      {failed && post.error ? (
        <p className="flex items-start gap-1.5 text-xs text-[var(--via-coral-dark)]">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          <span>{humanizeError(post.error)}</span>
        </p>
      ) : null}

      {failed || post.status === "scheduled" || canSync ? (
        <div className="flex flex-wrap items-center gap-2">
          {failed ? (
            <Button size="sm" variant="outline" onClick={onRetry} disabled={busy}>
              <RefreshCw aria-hidden="true" />
              Tentar de novo
            </Button>
          ) : null}
          {post.status === "scheduled" ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-[var(--via-text-muted)]"
              onClick={onCancel}
              disabled={busy}
            >
              <XCircle aria-hidden="true" />
              Cancelar agendamento
            </Button>
          ) : null}
          {canSync ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-[var(--via-text-muted)]"
              onClick={onSync}
              disabled={busy}
            >
              <RefreshCw aria-hidden="true" />
              Atualizar status
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
