import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Copy, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

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
import { Skeleton } from "@/components/ui/skeleton";
import {
  useDriveConnect,
  useDriveDisconnect,
  useDriveStatus,
  type DriveLastRun,
  type DriveStatus,
} from "@/hooks/use-google-drive";
import { useShake } from "@/hooks/use-feedback";
import { supabase } from "@/integrations/supabase/client";
import { DRIVE_OUTCOME, onDriveReturn } from "@/lib/drive-return";
import { installDriveGate, settleDriveGate, subscribeDriveGate } from "@/lib/drive-gate";
import { humanizeError } from "@/lib/humanize-error";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Google Drive: o passo de conectar. O mesmo fluxo serve ao modal de Integrações
// e à trava de geração, que abre por cima da tela onde a pessoa está.
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return "0 MB";
  const gb = bytes / 1024 ** 3;
  const number = gb >= 1 ? gb : bytes / 1024 ** 2;
  const text = number.toLocaleString("pt-BR", { maximumFractionDigits: gb >= 1 ? 1 : 0 });
  return `${text} ${gb >= 1 ? "GB" : "MB"}`;
}

/** Espera máxima com o botão ocupado. Depois disso a pessoa pode clicar de novo. */
const WAIT_LIMIT_MS = 2 * 60 * 1000;

/**
 * Abre a aba do Google e espera a volta, pelo aviso da aba ou conferindo o status.
 * `armed` diz que uma conexão é esperada; `waiting` é só a parte visível: ela solta ao
 * voltar o foco ou em 2 min, mas o que conectar depois disso ainda conta.
 */
function useConnectFlow(onConnected: () => void, options: { poll?: boolean } = {}) {
  const connect = useDriveConnect();
  const queryClient = useQueryClient();
  const [waiting, setWaiting] = useState(false);
  const [armed, setArmed] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const status = useDriveStatus({ poll: waiting || options.poll });
  const done = useRef(onConnected);
  done.current = onConnected;
  const refetch = useRef(status.refetch);
  refetch.current = status.refetch;

  useEffect(
    () =>
      onDriveReturn((outcome) => {
        if (outcome === "conectado") {
          void refetch.current();
          return;
        }
        setWaiting(false);
        setFailure(DRIVE_OUTCOME[outcome] ?? DRIVE_OUTCOME.falhou);
      }),
    [],
  );

  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => setWaiting(false), WAIT_LIMIT_MS);
    const onFocus = () => {
      void refetch.current().finally(() => setWaiting(false));
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [waiting]);

  useEffect(() => {
    if (armed && status.data?.connected) {
      setArmed(false);
      setWaiting(false);
      done.current();
    }
  }, [armed, status.data?.connected]);

  /** Status antigo em cache não pode contar como "acabou de conectar". */
  const forgetCached = () =>
    queryClient.setQueryData<DriveStatus>(["google-drive", "status"], (old) =>
      old ? { ...old, connected: false } : old,
    );

  const start = () => {
    setFailure(null);
    const tab = window.open("about:blank", "_blank");
    connect.mutate(undefined, {
      onSuccess: ({ authorize_url }) => {
        if (tab) tab.location.href = authorize_url;
        else window.open(authorize_url, "_blank", "noopener");
        forgetCached();
        setArmed(true);
        setWaiting(true);
      },
      onError: (error) => {
        tab?.close();
        setFailure(humanizeError(error.message));
      },
    });
  };

  return { start, forgetCached, waiting, failure, pending: connect.isPending, status };
}

function FlowFailure({ message }: { message: string | null }) {
  const shake = useShake(message);
  if (!message) return null;
  return (
    <p role="alert" className={cn("text-sm font-medium text-[var(--via-coral-dark)]", shake)}>
      {message}
    </p>
  );
}

function ConnectButton({
  flow,
  label,
}: {
  flow: ReturnType<typeof useConnectFlow>;
  label: string;
}) {
  return (
    <Button onClick={flow.start} disabled={flow.pending || flow.waiting}>
      {flow.pending || flow.waiting ? (
        <Loader2 className="animate-spin" aria-hidden="true" />
      ) : null}
      {flow.failure ? "Tentar de novo" : label}
    </Button>
  );
}

/** URI que vai no cliente OAuth: precisa ser idêntica, então é copiada daqui. */
function RedirectUri({ value }: { value: string }) {
  const copy = () =>
    void navigator.clipboard
      .writeText(value)
      .then(() => toast.success("Endereço copiado"))
      .catch(() => toast.error("Não foi possível copiar. Selecione o texto e copie manualmente."));
  return (
    <div className="space-y-1.5">
      <p className="text-sm text-[var(--via-text-primary)]">URI de redirecionamento</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-[var(--via-radius-sm)] bg-[var(--via-navy-04)] p-2.5 font-mono text-xs text-[var(--via-text-body)]">
          {value}
        </code>
        <Button
          type="button"
          size="icon"
          variant="outline"
          onClick={copy}
          aria-label="Copiar endereço"
        >
          <Copy aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Modal de Integrações. `keyForm` é o formulário padrão, para o client id e o secret: só aparece
 * na instância ainda sem chaves, que quem provisiona preenche. O cliente recebe só o Conectar.
 */
export function GoogleDriveBody({ keyForm, onDone }: { keyForm: ReactNode; onDone: () => void }) {
  const flow = useConnectFlow(() => toast.success("Google Drive conectado"));
  const disconnect = useDriveDisconnect();
  const { data, isLoading, isError, refetch } = flow.status;

  if (isLoading) return <Skeleton className="h-16 w-full" />;
  if (isError || !data) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[var(--via-text-muted)]">
          Não deu para conferir o Google Drive agora.
        </p>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={onDone}>
            Deixar para depois
          </Button>
          <Button onClick={() => void refetch()}>Tentar de novo</Button>
        </DialogFooter>
      </div>
    );
  }

  if (!data.configured) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[var(--via-text-primary)]">Falta configurar o Google Drive.</p>
        {data.redirect_uri ? <RedirectUri value={data.redirect_uri} /> : null}
        {keyForm}
      </div>
    );
  }

  if (data.connected) {
    const handleDisconnect = () => {
      const only = data.only_in_drive ?? 0;
      const warning = only
        ? ` ${only} arquivo${only > 1 ? "s" : ""} só existe${only > 1 ? "m" : ""} no Drive e não abre${only > 1 ? "m" : ""} aqui enquanto ele estiver desconectado.`
        : "";
      if (!window.confirm(`Desconectar o Google Drive? Gerar fica bloqueado.${warning}`)) return;
      disconnect.mutate(undefined, {
        onSuccess: ({ revoked }) => {
          if (revoked) toast.success("Google Drive desconectado");
          else {
            toast.warning("Desconectado aqui", {
              description: "O acesso continua na sua Conta do Google.",
            });
          }
        },
        onError: (error) =>
          toast.error("Não foi possível desconectar", { description: error.message }),
      });
    };
    return (
      <div className="space-y-4">
        <dl className="divide-y divide-[var(--via-border-soft)]" data-testid="drive-account">
          <div className="flex items-baseline justify-between gap-4 py-2">
            <dt className="text-sm text-[var(--via-text-muted)]">Conta</dt>
            <dd className="min-w-0 break-all text-right text-sm text-[var(--via-text-primary)]">
              {data.email ?? "Conectada"}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-2">
            <dt className="text-sm text-[var(--via-text-muted)]">Espaço economizado</dt>
            <dd className="text-sm font-medium text-[var(--via-text-primary)]">
              {formatBytes(data.saved_bytes ?? 0)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-2">
            <dt className="text-sm text-[var(--via-text-muted)]">Última varredura</dt>
            <dd className="text-right text-sm text-[var(--via-text-primary)]">
              {lastRunLabel(data.last_run)}
            </dd>
          </div>
        </dl>
        <RunNotice data={data} />
        <DialogFooter className="sm:justify-between">
          <Button variant="outline" onClick={handleDisconnect} disabled={disconnect.isPending}>
            Desconectar
          </Button>
          <Button onClick={onDone}>Fechar</Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--via-text-muted)]">
        {flow.waiting
          ? "Autorize na aba que abriu."
          : data.broken
            ? "A conexão caiu. Conecte de novo."
            : "Abre o Google para você autorizar."}
      </p>
      <FlowFailure message={flow.failure} />
      <DialogFooter className="sm:justify-between">
        <Button variant="ghost" onClick={onDone}>
          Deixar para depois
        </Button>
        <ConnectButton flow={flow} label="Conectar" />
      </DialogFooter>
    </div>
  );
}

function lastRunLabel(run: DriveLastRun | null | undefined): string {
  if (!run) return "Ainda não rodou";
  const when = formatDistanceToNowStrict(new Date(run.at), { locale: ptBR, addSuffix: true });
  const moved = (run.uploaded ?? 0) + (run.purged ?? 0);
  return moved ? `${when} · ${moved} arquivo${moved > 1 ? "s" : ""}` : when;
}

/** Só aparece quando há o que dizer: falha na rodada, banco cego ou apagamento desligado. */
function RunNotice({ data }: { data: DriveStatus }) {
  const run = data.last_run;
  if (run?.storage_blind) {
    return (
      <p role="alert" className="text-sm text-[var(--via-coral-dark)]">
        A varredura não está enxergando os arquivos. Avise o administrador da instância.
      </p>
    );
  }
  if (run?.error) {
    return (
      <p role="alert" className="text-sm text-[var(--via-coral-dark)]">
        A última varredura falhou. Ela tenta de novo sozinha.
      </p>
    );
  }
  if (data.purge_enabled === false) {
    return (
      <p className="text-sm text-[var(--via-text-muted)]">
        Copiando para o Drive. Ainda não apaga do nosso armazenamento.
      </p>
    );
  }
  return null;
}

/** O passo da trava: abre por cima da tela e devolve a pessoa exatamente onde estava. */
function DriveGateDialog({ onClose }: { onClose: (connected: boolean) => void }) {
  // quem não é admin não conecta: fica olhando o status até o administrador conectar
  const flow = useConnectFlow(() => undefined, { poll: true });
  const { forgetCached } = flow;
  const data = flow.status.data;
  const broken = data?.broken;
  const askAdmin = data?.can_connect === false;
  // o passo só existe porque o servidor disse que falta o Drive: cache antigo não vale
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    forgetCached();
    void flow.status.refetch().finally(() => setChecked(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // conectou aqui, em outra aba ou pelo administrador: a ação segue
  useEffect(() => {
    if (checked && data?.connected) {
      toast.success("Google Drive conectado");
      onClose(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked, data?.connected]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent className="max-w-md" data-testid="drive-gate">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-[10px] border border-[var(--via-border-soft)] bg-[var(--via-navy-04)]">
              <BrandIcon name="google_drive" className="size-4" />
            </span>
            {broken ? "Reconecte seu Google Drive" : "Conecte seu Google Drive"}
          </DialogTitle>
          <DialogDescription>
            {askAdmin
              ? "Só um administrador conecta o Drive. Peça a ele; assim que conectar, você continua daqui."
              : flow.waiting
                ? "Autorize na aba que abriu. Você continua daqui."
                : "Seus materiais ficam no seu Drive. Depois de conectar, você continua daqui."}
          </DialogDescription>
        </DialogHeader>
        <FlowFailure message={flow.failure} />
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={() => onClose(false)}>
            Agora não
          </Button>
          {askAdmin ? (
            <Button onClick={() => void flow.status.refetch()} disabled={flow.status.isFetching}>
              {flow.status.isFetching ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : null}
              Conferir de novo
            </Button>
          ) : (
            <ConnectButton
              flow={flow}
              label={broken ? "Reconectar Google Drive" : "Conectar Google Drive"}
            />
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Montado uma vez no layout logado, como o IntegrationModalHost. */
export function DriveGateHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    installDriveGate(supabase);
    return subscribeDriveGate(() => setOpen(true));
  }, []);

  if (!open) return null;
  return (
    <DriveGateDialog
      onClose={(connected) => {
        setOpen(false);
        settleDriveGate(connected);
      }}
    />
  );
}
