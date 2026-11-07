import { ArrowUpRight, Check, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "@/lib/toast";

import { BrandIcon } from "@/components/brand-icon";
import { StatusDot, type ConnectionStatus } from "@/components/status-dot";
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
import { useAppSetting, useSecretStatus, useStoreSecret } from "@/hooks/use-app-settings";
import {
  higgsfieldExchange,
  useHiggsfieldConnect,
  useHiggsfieldDisconnect,
  useHiggsfieldStatus,
} from "@/hooks/use-higgsfield";
import {
  useSetupReplicateWebhook,
  useValidateVideoCatalog,
  type ValidateCatalogResult,
} from "@/hooks/use-video-project";
import { useSetupWebhook } from "@/hooks/use-zernio";
import { GoogleDriveBody } from "@/components/google-drive-integration";
import { useDriveStatus } from "@/hooks/use-google-drive";
import { CatalogReport } from "@/components/replicate-integration";
import { ZernioAccountsList } from "@/components/zernio-integration";
import {
  INTEGRATION_BY_ID,
  INTEGRATION_GROUPS,
  type Integration,
  type IntegrationId,
} from "@/lib/integrations";
import { openIntegration, subscribeIntegrationModal } from "@/lib/integration-modal";
import { useGlowOn, useShake } from "@/hooks/use-feedback";
import { humanizeError } from "@/lib/humanize-error";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Grade de integrações: um ladrilho por serviço (ícone da marca, estado e o
// que ele faz). Clicar abre um modal pequeno só com o que aquele serviço pede.
// É o mesmo componente no onboarding, em Ajustes → IA e em Ajustes → Integrações
// — o que o usuário conecta num lugar é o que a produção lê em todos.
// ---------------------------------------------------------------------------

type Status = ConnectionStatus;

export function useIntegrationStatus() {
  const secrets = useSecretStatus();
  const higgsfield = useHiggsfieldStatus();
  const drive = useDriveStatus();

  const statusOf = (item: Integration): Status => {
    if (item.kind === "builtin") return "builtin";
    if (item.kind === "drive") {
      if (drive.isLoading) return "loading";
      if (drive.isError) return "unknown";
      return drive.data?.connected ? "on" : "off";
    }
    if (item.kind === "oauth") {
      if (higgsfield.isLoading) return "loading";
      if (higgsfield.isError) return "unknown";
      return higgsfield.data?.connected ? "on" : "off";
    }
    if (secrets.isLoading) return "loading";
    if (secrets.isError) return "unknown";
    const required = (item.fields ?? []).filter((field) => !field.optional);
    if (!required.every((field) => secrets.data?.includes(field.name))) return "off";
    // pronto só com as dependências ligadas (o editor precisa do Higgsfield)
    for (const dep of item.requires ?? []) {
      const s = statusOf(INTEGRATION_BY_ID[dep]);
      if (s !== "on" && s !== "builtin") return s;
    }
    return "on";
  };
  return statusOf;
}

export interface IntegrationGridProps {
  ids: IntegrationId[];
  className?: string;
}

export function IntegrationGrid({ ids, className }: IntegrationGridProps) {
  const statusOf = useIntegrationStatus();
  const [open, setOpen] = useState<IntegrationId | null>(null);

  return (
    <>
      <ul className={cn("grid gap-3 sm:grid-cols-2 2xl:grid-cols-3", className)}>
        {ids.map((id) => {
          const item = INTEGRATION_BY_ID[id];
          return (
            <li key={id}>
              <IntegrationTile item={item} status={statusOf(item)} onOpen={() => setOpen(id)} />
            </li>
          );
        })}
      </ul>
      {open ? (
        <IntegrationDialog
          item={INTEGRATION_BY_ID[open]}
          status={statusOf(INTEGRATION_BY_ID[open])}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Abrir o modal de uma integração de QUALQUER lugar ("Conectar redes sociais"
// no Dashboard, ações do assistente, ?integracao= no Config). Regra do produto:
// clicar numa ação abre a ação ali mesmo, nunca manda o usuário para uma
// página descobrir o que fazer. O host é montado uma vez no layout logado.
// ---------------------------------------------------------------------------

export function IntegrationModalHost() {
  const statusOf = useIntegrationStatus();
  const [open, setOpen] = useState<IntegrationId | null>(null);
  useEffect(() => subscribeIntegrationModal((id) => setOpen(id)), []);
  if (!open) return null;
  const item = INTEGRATION_BY_ID[open];
  return <IntegrationDialog item={item} status={statusOf(item)} onClose={() => setOpen(null)} />;
}

/** Todos os grupos, com título — onboarding e Ajustes → Integrações. */
export function IntegrationGroups() {
  const statusOf = useIntegrationStatus();
  const items = INTEGRATION_GROUPS.flatMap((group) => group.ids.map((id) => INTEGRATION_BY_ID[id]));
  const prontas = items.filter((item) => {
    const status = statusOf(item);
    return status === "on" || status === "builtin";
  }).length;
  return (
    <div className="space-y-8">
      <p className="text-sm text-[var(--via-text-muted)]" data-testid="integracoes-resumo">
        <span className="font-medium tabular-nums text-[var(--via-text-primary)]">
          {prontas} de {items.length}
        </span>{" "}
        prontas. Só as que você usa precisam estar ligadas.
      </p>
      {INTEGRATION_GROUPS.map((group) => (
        <section key={group.title} className="space-y-3">
          <h3 className="text-sm font-medium text-[var(--via-text-primary)]">{group.title}</h3>
          <IntegrationGrid ids={group.ids} />
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ladrilho
// ---------------------------------------------------------------------------

function IntegrationTile({
  item,
  status,
  onOpen,
}: {
  item: Integration;
  status: Status;
  onOpen: () => void;
}) {
  // acabou de conectar: o ladrilho acende e o status desenha o check
  const glow = useGlowOn(status, isConnected);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      data-testid={`integration-${item.id}`}
      className={cn(
        glow,
        "via-tile via-tile--lift ce-tile group flex h-full w-full items-start gap-3 rounded-[var(--via-radius-lg)] p-4 text-left hover:border-[var(--via-navy-20)] hover:bg-[var(--via-navy-02,var(--via-navy-03))] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]",
      )}
    >
      <span className="ce-tile-well">
        <BrandIcon name={item.brand} className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        {/* selo embaixo do nome (kit): na mesma linha ele comia a largura e o nome sumia */}
        <span className="block text-sm font-medium text-[var(--via-text-primary)]">
          {item.name}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-[var(--via-text-muted)]">
          {item.purpose}
        </span>
        <StatusDot status={status} fresh={Boolean(glow)} className="mt-2" />
      </span>
    </button>
  );
}

const isConnected = (status: Status) => status === "on";

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

function IntegrationDialog({
  item,
  status,
  onClose,
}: {
  item: Integration;
  status: Status;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-[10px] border border-[var(--via-border-soft)] bg-[var(--via-navy-04)]">
              <BrandIcon name={item.brand} className="size-4" />
            </span>
            {item.name}
          </DialogTitle>
          <DialogDescription>{item.when}</DialogDescription>
        </DialogHeader>

        {item.kind === "builtin" ? (
          <DialogFooter>
            <Button onClick={onClose}>Entendi</Button>
          </DialogFooter>
        ) : item.kind === "drive" ? (
          <GoogleDriveBody
            keyForm={<KeyBody item={item} status="off" onDone={onClose} />}
            onDone={onClose}
          />
        ) : item.kind === "oauth" ? (
          <OauthBody status={status} onDone={onClose} />
        ) : (
          <KeyBody item={item} status={status} onDone={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Integrações cujo modal segue aberto depois da chave: a ação continua nele. */
const KEEP_OPEN_AFTER_KEY: readonly IntegrationId[] = ["zernio", "replicate", "google_drive"];

/**
 * Chave(s) coladas → store-secret. Zernio ganha as contas e o webhook logo
 * depois da chave; Replicate, o aviso de conclusão e a verificação dos modelos.
 */
function KeyBody({
  item,
  status,
  onDone,
}: {
  item: Integration;
  status: Status;
  onDone: () => void;
}) {
  const fields = item.fields ?? [];
  const secrets = useSecretStatus();
  const storeSecret = useStoreSecret();
  const statusOf = useIntegrationStatus();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<{ message: string } | null>(null);
  const shake = useShake(saveError);
  const filled = fields.filter((field) => values[field.name]?.trim());
  const keySaved = fields
    .filter((field) => !field.optional)
    .every((field) => secrets.data?.includes(field.name));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (filled.length === 0 || storeSecret.isPending) return;
    setSaveError(null);
    try {
      for (const field of filled) {
        await storeSecret.mutateAsync({ name: field.name, value: values[field.name].trim() });
      }
      setValues({});
      toast.success(item.kind === "drive" ? "Configuração salva" : `${item.name} conectado`, {
        description: item.note,
      });
      // falta uma dependência: o modal fica, com o atalho para ela
      const missingDep = (item.requires ?? []).some(
        (dep) => statusOf(INTEGRATION_BY_ID[dep]) !== "on",
      );
      if (!KEEP_OPEN_AFTER_KEY.includes(item.id) && !missingDep) onDone();
    } catch (error) {
      // o erro fica junto do campo que precisa ser corrigido, não num canto da tela
      setSaveError({
        message:
          error instanceof Error
            ? humanizeError(error.message)
            : `Não foi possível salvar a chave do ${item.name}.`,
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} className={cn("space-y-4", shake)}>
      {fields.map((field) => {
        const configured = secrets.data?.includes(field.name) ?? false;
        return (
          <div key={field.name} className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={`integration-${field.name}`}>{field.label}</Label>
              {configured ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--via-text-primary)]">
                  <Check className="size-3" aria-hidden="true" />
                  salva
                </span>
              ) : null}
            </div>
            <Input
              id={`integration-${field.name}`}
              type={field.secret ? "password" : "text"}
              value={values[field.name] ?? ""}
              onChange={(event) =>
                setValues((prev) => ({ ...prev, [field.name]: event.target.value }))
              }
              placeholder={configured ? "•••••••• (cole para substituir)" : field.placeholder}
              // o Chrome ignora "off": sem isto, preenche e-mail e senha salvos no lugar da chave
              autoComplete={field.secret ? "new-password" : "off"}
              data-1p-ignore
              data-lpignore="true"
            />
            {field.help ? (
              <p className="text-xs text-[var(--via-text-muted)]">{field.help}</p>
            ) : null}
          </div>
        );
      })}

      {saveError ? (
        <p role="alert" className="text-sm text-[var(--via-coral-dark)]">
          {saveError.message}
        </p>
      ) : null}

      {item.keyUrl ? (
        <a
          href={item.keyUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-[var(--via-text-muted)] underline-offset-4 hover:text-[var(--via-text-primary)] hover:underline"
        >
          Onde pego a chave?
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </a>
      ) : null}

      {item.id === "zernio" && status === "on" ? (
        <>
          <div className="space-y-2 border-t border-[var(--via-border-soft)] pt-4">
            <p className="text-sm text-[var(--via-text-primary)]">Contas das redes</p>
            <ZernioAccountsList />
          </div>
          <ZernioWebhookRow />
        </>
      ) : null}

      {item.id === "replicate" && status === "on" ? <ReplicateToolsRows /> : null}

      {keySaved && status === "off"
        ? (item.requires ?? []).map((dep) => (
            <MissingDependencyRow key={dep} id={dep} onOpen={onDone} />
          ))
        : null}

      <DialogFooter>
        <Button type="submit" disabled={filled.length === 0 || storeSecret.isPending}>
          {storeSecret.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {keySaved ? "Substituir" : item.kind === "drive" ? "Salvar" : "Conectar"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** A chave está salva, mas falta outra integração para ficar pronto: abre ela ali. */
function MissingDependencyRow({ id, onOpen }: { id: IntegrationId; onOpen: () => void }) {
  const dep = INTEGRATION_BY_ID[id];
  return (
    <div className="flex items-center justify-between gap-3 border-t border-[var(--via-border-soft)] pt-4">
      <p className="text-sm text-[var(--via-text-primary)]">Falta conectar o {dep.name}.</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          onOpen();
          openIntegration(id);
        }}
      >
        <BrandIcon name={dep.brand} />
        Conectar {dep.name}
      </Button>
    </div>
  );
}

function ZernioWebhookRow() {
  const settings = useAppSetting<{ webhook_id: string | null }>("zernio");
  const setupWebhook = useSetupWebhook();
  const active = Boolean(settings.data?.webhook_id);

  const handleSetup = () => {
    setupWebhook.mutate(undefined, {
      onSuccess: () => {
        void settings.refetch();
        toast.success("Webhook configurado", {
          description: "Cada peça publicada passa a mostrar o status e o link do post.",
        });
      },
      onError: (error) => {
        toast.error("Não foi possível configurar o webhook", { description: error.message });
      },
    });
  };

  return (
    <div className="flex items-center justify-between gap-3 border-t border-[var(--via-border-soft)] pt-4">
      <div className="min-w-0">
        <p className="text-sm text-[var(--via-text-primary)]">Aviso de publicação</p>
        <p className="text-xs text-[var(--via-text-muted)]">
          {active
            ? "Ativo: cada post publicado mostra o link aqui."
            : "Sem ele, abra a peça e clique em “Atualizar status”."}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleSetup}
        disabled={setupWebhook.isPending || settings.isLoading}
      >
        {setupWebhook.isPending ? "Configurando…" : active ? "Reconfigurar" : "Ativar"}
      </Button>
    </div>
  );
}

/**
 * Replicate com chave salva: o aviso de conclusão (webhook) e a verificação dos
 * modelos ficam no modal, para a ação completa acontecer onde o usuário clicou
 * (Vídeos → Novo sem modelo ativo abre este modal).
 */
function ReplicateToolsRows() {
  const setupWebhook = useSetupReplicateWebhook();
  const validateCatalog = useValidateVideoCatalog();
  const [report, setReport] = useState<ValidateCatalogResult | null>(null);

  const handleSetup = () => {
    setupWebhook.mutate(undefined, {
      onSuccess: () => {
        toast.success("Aviso de conclusão configurado", {
          description: "O sistema passa a saber sozinho quando cada etapa do vídeo termina.",
        });
      },
      onError: (error) => {
        toast.error("Não foi possível configurar o aviso", { description: error.message });
      },
    });
  };

  const handleValidate = () => {
    validateCatalog.mutate(undefined, {
      onSuccess: (result) => {
        setReport(result);
        if (result.broken === 0) {
          toast.success(`${result.checked} modelos verificados, nenhum problema`);
        } else {
          toast.warning(`${result.broken} de ${result.checked} modelos com problema`, {
            description: "Veja a lista abaixo. Reels que usam esses modelos podem falhar.",
          });
        }
      },
      onError: (error) => {
        toast.error("Não foi possível verificar os modelos", { description: error.message });
      },
    });
  };

  return (
    <div className="space-y-3 border-t border-[var(--via-border-soft)] pt-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-[var(--via-text-primary)]">Aviso de conclusão</p>
          <p className="text-xs text-[var(--via-text-muted)]">
            Avisa quando cada etapa do vídeo termina.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleSetup}
          disabled={setupWebhook.isPending}
        >
          {setupWebhook.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Configurar webhook
        </Button>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-[var(--via-text-primary)]">Modelos de vídeo</p>
          <p className="text-xs text-[var(--via-text-muted)]">
            Confere se os modelos ativos ainda existem.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleValidate}
          disabled={validateCatalog.isPending}
        >
          {validateCatalog.isPending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : null}
          Verificar modelos
        </Button>
      </div>
      {report ? <CatalogReport report={report} /> : null}
    </div>
  );
}

/** Higgsfield: autoriza no site, volta e confirma. */
function OauthBody({ status, onDone }: { status: Status; onDone: () => void }) {
  const hfStatus = useHiggsfieldStatus();
  const connect = useHiggsfieldConnect();
  const disconnect = useHiggsfieldDisconnect();
  const queryClient = useQueryClient();
  const [waiting, setWaiting] = useState(false);
  // site publicado: o Higgsfield volta para o endereço local e a pessoa cola o endereço da aba
  const [colar, setColar] = useState(false);
  const [endereco, setEndereco] = useState("");
  const [trocando, setTrocando] = useState(false);
  // a falha fica no modal, com o motivo e a saída — não só num toast que some
  const [failure, setFailure] = useState<string | null>(null);
  const failureShake = useShake(failure);

  const handleConnect = () => {
    setFailure(null);
    const tab = window.open("about:blank", "_blank");
    connect.mutate(undefined, {
      onSuccess: ({ authorize_url, colar: precisaColar }) => {
        if (tab) tab.location.href = authorize_url;
        else window.open(authorize_url, "_blank", "noopener");
        setWaiting(true);
        setColar(Boolean(precisaColar));
      },
      onError: (error) => {
        tab?.close();
        setFailure(humanizeError(error.message));
      },
    });
  };

  const handlePaste = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFailure(null);
    let params: URLSearchParams;
    try {
      params = new URL(endereco.trim()).searchParams;
    } catch {
      setFailure("Cole o endereço inteiro da aba, começando por http://127.0.0.1.");
      return;
    }
    const code = params.get("code") ?? undefined;
    const state = params.get("state") ?? undefined;
    const error = params.get("error") ?? undefined;
    if (!code && !error) {
      setFailure(
        "Esse endereço não tem a autorização. Autorize no Higgsfield e copie o endereço da aba que abriu depois.",
      );
      return;
    }
    setTrocando(true);
    try {
      const { outcome } = await higgsfieldExchange({ code, state, error });
      if (outcome === "conectado") {
        await queryClient.invalidateQueries({ queryKey: ["higgsfield"] });
        toast.success("Higgsfield conectado");
        onDone();
        return;
      }
      setFailure(
        outcome === "recusado"
          ? "O Higgsfield não liberou o acesso. Clique em Entrar no Higgsfield e autorize de novo."
          : outcome === "expirado"
            ? "Passou o tempo da autorização. Clique em Entrar no Higgsfield de novo."
            : outcome === "sessao"
              ? "Esse endereço é de outra tentativa. Clique em Entrar no Higgsfield e use a aba nova."
              : "O Higgsfield não confirmou a conexão. Tente de novo.",
      );
    } catch (err) {
      setFailure(err instanceof Error ? humanizeError(err.message) : "Não foi possível conectar.");
    } finally {
      setTrocando(false);
    }
  };

  const handleCheck = async () => {
    const { data } = await hfStatus.refetch();
    if (data?.connected) {
      toast.success("Higgsfield conectado");
      onDone();
    } else {
      toast.info("Ainda não conectado", {
        description: "Termine a autorização na aba do Higgsfield e clique em “Já autorizei”.",
      });
    }
  };

  const handleDisconnect = () => {
    disconnect.mutate(undefined, {
      onSuccess: () => toast.success("Higgsfield desconectado"),
      onError: (error) =>
        toast.error("Não foi possível desconectar", { description: error.message }),
    });
  };

  if (status === "on") {
    return (
      <DialogFooter className="sm:justify-between">
        <Button variant="outline" onClick={handleDisconnect} disabled={disconnect.isPending}>
          Desconectar
        </Button>
        <Button onClick={onDone}>Fechar</Button>
      </DialogFooter>
    );
  }

  return (
    <div className="space-y-4">
      {colar ? (
        <form id="higgsfield-colar" onSubmit={(e) => void handlePaste(e)} className="space-y-3">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-[var(--via-text-body)]">
            <li>Autorize com a sua conta na aba do Higgsfield.</li>
            <li>A aba vai para um endereço que não abre. É assim mesmo: copie o endereço dela.</li>
            <li>Cole aqui e clique em Conectar.</li>
          </ol>
          <div className="space-y-1.5">
            <Label htmlFor="higgsfield-endereco">Endereço da aba</Label>
            <Input
              id="higgsfield-endereco"
              value={endereco}
              onChange={(e) => setEndereco(e.target.value)}
              placeholder="http://127.0.0.1/higgsfield?code=…"
              autoComplete="off"
              data-1p-ignore
              autoFocus
            />
          </div>
        </form>
      ) : (
        <p className="text-sm text-[var(--via-text-muted)]">
          {waiting
            ? "Autorize na aba que abriu e volte aqui."
            : "Vai abrir o site do Higgsfield para você autorizar com a sua conta."}
        </p>
      )}
      {failure ? (
        <p
          role="alert"
          className={cn("text-sm font-medium text-[var(--via-coral-dark)]", failureShake)}
        >
          {failure}
        </p>
      ) : null}
      <DialogFooter className={failure ? "sm:justify-between" : undefined}>
        {failure ? (
          <Button variant="ghost" onClick={onDone}>
            Deixar para depois
          </Button>
        ) : null}
        {colar ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={handleConnect} disabled={connect.isPending}>
              Entrar no Higgsfield de novo
            </Button>
            <Button type="submit" form="higgsfield-colar" disabled={!endereco.trim() || trocando}>
              {trocando ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Conectar
            </Button>
          </div>
        ) : waiting ? (
          <Button onClick={() => void handleCheck()} disabled={hfStatus.isFetching}>
            {hfStatus.isFetching ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Já autorizei
          </Button>
        ) : (
          <Button onClick={handleConnect} disabled={connect.isPending}>
            {connect.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {failure ? "Tentar de novo" : "Conectar"}
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}
