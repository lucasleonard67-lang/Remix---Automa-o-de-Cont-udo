import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AI_ROLE_LABELS,
  AI_ROLES,
  modelsFor,
  useAppSetting,
  useSecretStatus,
  useUpdateAppSetting,
  type AiDriver,
  type AiProviderConfig,
  type AiProviders,
  type AiRole,
} from "@/hooks/use-app-settings";
import type { BrandName } from "@/lib/brands";
import { useMcpTokens } from "@/hooks/use-mcp-tokens";
import { openIntegration } from "@/lib/integration-modal";
import { connectorState } from "@/lib/mcp-connector-state";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Provedores por papel como ladrilhos: um por etapa da geração, com o ícone do
// provedor em uso e o modelo. Clicar abre o modal daquele papel; cada mudança
// salva ali mesmo (sem "Descartar/Salvar" soltos no rodapé da página).
// ---------------------------------------------------------------------------

const ROLE_PURPOSE: Record<AiRole, string> = {
  router: "Decide formato, pauta e canais da peça.",
  generator: "Escreve o texto da peça.",
  judge: "Dá a nota e aprova ou reprova.",
  voice_extractor: "Aprende a voz da marca pelos seus textos.",
  embeddings: "Encontra os itens certos do Contexto.",
  image: "Gera a capa e as imagens.",
};

/** Logo do FABRICANTE do modelo: o incluso pelo Lovable é Gemini, então mostra o Gemini. */
export const DRIVER_BRAND: Record<AiDriver, BrandName> = {
  "lovable-gateway": "gemini",
  openai: "openai",
  xai: "xai",
};

export const DRIVER_LABEL: Record<AiDriver, string> = {
  "lovable-gateway": "Lovable AI (Gemini)",
  openai: "OpenAI (GPT · Codex)",
  xai: "Grok (xAI)",
};

/** Integração que conecta a chave do provedor (modal de integrações). */
const DRIVER_INTEGRATION: Partial<Record<AiDriver, "openai" | "xai">> = {
  openai: "openai",
  xai: "xai",
};

export const DRIVER_SECRET: Partial<Record<AiDriver, string>> = {
  openai: "OPENAI_API_KEY",
  xai: "XAI_API_KEY",
};

export const DEFAULT_PROVIDER: AiProviderConfig = { driver: "lovable-gateway", model: "" };

/** Conector do Claude configurado (acessos do "Conectar ao Claude" não revogados). */
export function useClaudeConnected(): boolean | null {
  const tokens = useMcpTokens();
  if (tokens.isLoading) return null;
  return connectorState(tokens.data ?? []).state !== "off";
}

/**
 * Escrever pelo Claude da assinatura, via conector personalizado. Não é um
 * modelo da instância: é a escolha de quem cria (o Criar guarda no navegador).
 */
export interface ConnectorChoice {
  chosen: boolean;
  /** Por que não dá agora ("só carrossel", por exemplo); null = disponível. */
  blocked: string | null;
  choose: (on: boolean) => void;
}

/** Nome curto do modelo para o ladrilho ("Gemini 2.5 Pro — geração…" → "Gemini 2.5 Pro"). */
/** O que o servidor usa quando o papel está no padrão (_shared/llm.ts DEFAULT_PROVIDERS). */
const LOVABLE_DEFAULT_MODEL: Record<AiRole, string> = {
  router: "Gemini 2.5 Flash",
  generator: "Gemini 2.5 Pro",
  judge: "Gemini 2.5 Pro",
  voice_extractor: "Gemini 2.5 Pro",
  embeddings: "Gemini Embedding",
  image: "Gemini 2.5 Flash Image",
};

export function modelShortLabel(config: AiProviderConfig, role: AiRole): string {
  if (!config.model) {
    return config.driver === "lovable-gateway" ? LOVABLE_DEFAULT_MODEL[role] : "Modelo padrão";
  }
  const option = modelsFor(config.driver, role).find((o) => o.value === config.model);
  return option ? option.label.split(" — ")[0] : prettyModel(config.model);
}

/** Id cru fora da lista ("google/gemini-2.5-flash") vira nome legível ("Gemini 2.5 Flash"). */
export function prettyModel(id: string): string {
  const name = id.split("/").pop() ?? id;
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => (/^[a-z]/.test(part) ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export function AiRoleGrid() {
  const providers = useAppSetting<AiProviders>("ai_providers");
  const secrets = useSecretStatus();
  const [open, setOpen] = useState<AiRole | null>(null);

  if (providers.isError) {
    return (
      <p className="text-sm text-[var(--via-text-muted)]">
        Não foi possível carregar a configuração de IA. Recarregue a página.
      </p>
    );
  }

  const current = providers.data ?? {};

  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {AI_ROLES.map((role) => {
          const config = current[role] ?? DEFAULT_PROVIDER;
          const secret = DRIVER_SECRET[config.driver];
          const missingKey =
            Boolean(secret) && !secrets.isLoading && !secrets.data?.includes(secret!);
          return (
            <li key={role}>
              <button
                type="button"
                onClick={() => setOpen(role)}
                aria-haspopup="dialog"
                data-testid={`ai-role-${role}`}
                className="via-tile via-tile--atmos via-tile--lift ce-tile group flex h-full w-full items-start gap-3 rounded-[var(--via-radius-lg)] p-4 text-left hover:border-[var(--via-navy-20)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]"
              >
                <span className="ce-tile-well">
                  {providers.isLoading ? (
                    <Skeleton className="size-5 rounded" />
                  ) : (
                    <BrandIcon name={DRIVER_BRAND[config.driver]} className="size-5" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-[var(--via-text-primary)]">
                      {AI_ROLE_LABELS[role]}
                    </span>
                    {providers.isLoading ? (
                      <Skeleton className="h-4 w-20" />
                    ) : (
                      <span
                        className={cn(
                          "truncate text-xs font-medium",
                          missingKey
                            ? "text-[var(--via-coral-dark)]"
                            : "text-[var(--via-text-faint)]",
                        )}
                      >
                        {missingKey ? "sem chave" : modelShortLabel(config, role)}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-[var(--via-text-muted)]">
                    {ROLE_PURPOSE[role]}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {open ? (
        <RoleDialog
          role={open}
          config={current[open] ?? DEFAULT_PROVIDER}
          providers={current}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}

/** Grupos do seletor, na ordem em que aparecem. */
const DRIVER_ORDER: AiDriver[] = ["lovable-gateway", "openai", "xai"];

/** Nome do grupo: o MODELO, não o intermediário ("Gemini (Google)", não "Lovable AI"). */
const GROUP_LABEL: Record<AiDriver, string> = {
  "lovable-gateway": "Gemini (Google) — já incluso, sem chave",
  openai: "GPT (OpenAI)",
  xai: "Grok (xAI)",
};

/** Por que o provedor não aparece clicável neste papel. */
const GROUP_UNAVAILABLE: Partial<Record<AiDriver, Partial<Record<AiRole, string>>>> = {
  xai: { embeddings: "Grok não oferece busca por similaridade." },
};

/** Default do servidor por papel quando nada foi escolhido (_shared/llm.ts). */
const SERVER_DEFAULT: Record<AiRole, string> = {
  router: "google/gemini-2.5-flash",
  generator: "google/gemini-2.5-pro",
  judge: "google/gemini-2.5-pro",
  voice_extractor: "google/gemini-2.5-pro",
  embeddings: "google/gemini-embedding-001",
  image: "google/gemini-2.5-flash-image",
};

/**
 * Escolha de IA de um papel: UMA lista de modelos, agrupada pela empresa do
 * modelo (Claude, Gemini, GPT, Grok). Clicou num modelo, está escolhido. Se o
 * provedor precisa de chave e ela não existe, o próprio item oferece
 * "Conectar" (abre a integração por cima). Modelo que não serve ao papel
 * aparece desabilitado com o motivo — nunca some sem explicação.
 */
export function RoleDialog({
  role,
  config: initial,
  providers,
  onClose,
  connector,
}: {
  role: AiRole;
  config: AiProviderConfig;
  providers: AiProviders;
  onClose: () => void;
  connector?: ConnectorChoice;
}) {
  const claudeConnected = useClaudeConnected();
  const [viaConnector, setViaConnector] = useState(
    Boolean(connector?.chosen) && !connector?.blocked && claudeConnected !== false,
  );
  const updateSetting = useUpdateAppSetting();
  const secrets = useSecretStatus();
  const effective: AiProviderConfig = initial.model
    ? initial
    : {
        driver: initial.driver,
        model: initial.driver === "lovable-gateway" ? SERVER_DEFAULT[role] : "",
      };
  const [config, setConfig] = useState<AiProviderConfig>(effective);
  const [customOpen, setCustomOpen] = useState(false);
  const [customId, setCustomId] = useState("");
  const dirty =
    JSON.stringify(config) !== JSON.stringify(effective) ||
    viaConnector !== Boolean(connector?.chosen);

  const hasKey = (driver: AiDriver) => {
    const secret = DRIVER_SECRET[driver];
    return !secret || Boolean(secrets.data?.includes(secret));
  };
  const chosenMissingKey = !secrets.isLoading && !hasKey(config.driver);

  const save = () => {
    if (connector) connector.choose(viaConnector);
    if (viaConnector) {
      toast.success("Texto: Claude · conector personalizado");
      onClose();
      return;
    }
    if (JSON.stringify(config) === JSON.stringify(effective)) {
      onClose();
      return;
    }
    updateSetting.mutate(
      { key: "ai_providers", value: { ...providers, [role]: config } },
      {
        onSuccess: () => {
          toast.success(`${AI_ROLE_LABELS[role]}: ${modelShortLabel(config, role)}`);
          onClose();
        },
        onError: (error) => toast.error("Não foi possível salvar", { description: error.message }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{AI_ROLE_LABELS[role]}</DialogTitle>
          <DialogDescription>{ROLE_PURPOSE[role]}</DialogDescription>
        </DialogHeader>

        <div
          className="max-h-[55vh] space-y-4 overflow-y-auto pr-1"
          role="radiogroup"
          aria-label="Modelo"
        >
          {connector ? (
            <section className="space-y-1.5" data-testid="ai-group-conector">
              <header className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.08em] text-[var(--via-text-muted)]">
                  <BrandIcon name="claude" className="size-3.5" />
                  Claude · conector personalizado
                </span>
                {claudeConnected === false ? (
                  <Button asChild size="sm" variant="outline" className="h-7">
                    <Link to="/config" search={{ aba: "integracoes" }} onClick={onClose}>
                      Configurar
                    </Link>
                  </Button>
                ) : null}
              </header>
              <button
                type="button"
                role="radio"
                aria-checked={viaConnector}
                disabled={!claudeConnected || Boolean(connector.blocked)}
                onClick={() => setViaConnector(true)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-[var(--via-radius-md)] border px-3 py-2 text-left transition-colors duration-[var(--via-dur)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)] disabled:cursor-not-allowed disabled:opacity-60",
                  viaConnector
                    ? "border-[var(--via-navy)] bg-[var(--via-navy-04)]"
                    : "border-[var(--via-border-soft)] hover:border-[var(--via-navy-20)]",
                )}
              >
                <span
                  className={cn(
                    "size-4 shrink-0 rounded-full border",
                    viaConnector
                      ? "border-[5px] border-[var(--via-navy)]"
                      : "border-[var(--via-border)]",
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-[var(--via-text-primary)]">
                    Claude da sua assinatura
                  </span>
                  <span className="block text-xs text-[var(--via-text-muted)]">
                    {claudeConnected === false
                      ? "Configure o conector personalizado para usar o seu Claude."
                      : connector.blocked
                        ? connector.blocked
                        : "Sem custo de API. Você abre o Claude e ele entrega aqui."}
                  </span>
                </span>
              </button>
            </section>
          ) : null}
          {DRIVER_ORDER.map((driver) => {
            const unavailable = GROUP_UNAVAILABLE[driver]?.[role];
            const models = modelsFor(driver, role);
            const keyOk = secrets.isLoading || hasKey(driver);
            const integration = DRIVER_INTEGRATION[driver];
            return (
              <section key={driver} className="space-y-1.5" data-testid={`ai-group-${driver}`}>
                <header className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.08em] text-[var(--via-text-muted)]">
                    <BrandIcon name={DRIVER_BRAND[driver]} className="size-3.5" />
                    {GROUP_LABEL[driver]}
                  </span>
                  {!unavailable && !keyOk && integration ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7"
                      onClick={() => openIntegration(integration)}
                    >
                      Conectar
                    </Button>
                  ) : null}
                </header>
                {unavailable ? (
                  <p className="rounded-[var(--via-radius-md)] bg-[var(--via-navy-03)] px-3 py-2 text-xs text-[var(--via-text-muted)]">
                    {unavailable}
                  </p>
                ) : models.length === 0 ? (
                  <p className="px-1 text-xs text-[var(--via-text-muted)]">
                    Digite o ID do modelo em “Outro”, abaixo.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {models.map((m) => {
                      const selected =
                        !viaConnector && config.driver === driver && config.model === m.value;
                      const [name, note] = m.label.split(" — ");
                      return (
                        <li key={m.value}>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => {
                              setConfig({ driver, model: m.value });
                              setViaConnector(false);
                            }}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-[var(--via-radius-md)] border px-3 py-2 text-left transition-colors duration-[var(--via-dur)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]",
                              selected
                                ? "border-[var(--via-navy)] bg-[var(--via-navy-04)]"
                                : "border-[var(--via-border-soft)] hover:border-[var(--via-navy-20)]",
                            )}
                          >
                            <span
                              className={cn(
                                "size-4 shrink-0 rounded-full border",
                                selected
                                  ? "border-[5px] border-[var(--via-navy)]"
                                  : "border-[var(--via-border)]",
                              )}
                              aria-hidden="true"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium text-[var(--via-text-primary)]">
                                {name}
                              </span>
                              {note ? (
                                <span className="block text-xs text-[var(--via-text-muted)]">
                                  {note}
                                </span>
                              ) : null}
                            </span>
                            {!keyOk ? (
                              <span className="text-xs text-[var(--via-coral-dark)]">
                                sem chave
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}

          <div className="space-y-1.5 border-t border-[var(--via-border-soft)] pt-3">
            {customOpen ? (
              <div className="flex gap-2">
                <Select
                  value={config.driver}
                  onValueChange={(v) => setConfig({ driver: v as AiDriver, model: customId })}
                >
                  <SelectTrigger className="w-40" aria-label="Empresa do modelo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DRIVER_ORDER.filter((d) => !GROUP_UNAVAILABLE[d]?.[role]).map((d) => (
                      <SelectItem key={d} value={d}>
                        {GROUP_LABEL[d].split(" — ")[0]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={customId}
                  onChange={(e) => {
                    setCustomId(e.target.value);
                    setConfig((prev) => ({ ...prev, model: e.target.value }));
                  }}
                  placeholder="ID do modelo"
                  aria-label="ID do modelo"
                  autoFocus
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCustomOpen(true)}
                className="text-xs text-[var(--via-text-muted)] underline-offset-4 hover:text-[var(--via-text-primary)] hover:underline"
              >
                Outro modelo (digitar o ID)
              </button>
            )}
          </div>
        </div>

        <DialogFooter className="items-center gap-3 sm:justify-between">
          <span className="text-xs text-[var(--via-text-muted)]">
            {viaConnector
              ? "Escolhido: Claude · conector personalizado"
              : chosenMissingKey
                ? "Conecte a chave para usar este modelo."
                : `Escolhido: ${modelShortLabel(config, role)}`}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={updateSetting.isPending}>
              Cancelar
            </Button>
            <Button
              onClick={save}
              disabled={!dirty || (!viaConnector && !config.model) || updateSetting.isPending}
            >
              {updateSetting.isPending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : null}
              {viaConnector ? "Usar o meu Claude" : "Usar este modelo"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
