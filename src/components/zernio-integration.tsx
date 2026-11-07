import {
  CheckCircle2,
  ExternalLink,
  Info,
  KeyRound,
  Link2,
  RefreshCw,
  Webhook,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "@/lib/toast";
import { onZernioConnected, zernioReturnUrl } from "@/lib/zernio-return";

import { ChannelLabel } from "@/components/channel-label";
import { EmptyState } from "@/components/empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { BrandIcon } from "@/components/brand-icon";
import { channelBrand } from "@/lib/brands";
import { Button } from "@/components/ui/button";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useAppSetting,
  useSecretStatus,
  useStoreSecret,
  useUpdateAppSetting,
} from "@/hooks/use-app-settings";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  CHANNEL_TYPES,
  CHANNEL_TYPE_LABELS,
  groupByFamily,
  type ChannelRow,
  type ChannelType,
  useChannels,
  useSetChannelConfigKey,
} from "@/hooks/use-channels";
import {
  CHANNEL_TO_ZERNIO_PLATFORM,
  ZERNIO_PLATFORMS,
  ZERNIO_PLATFORM_LABELS,
  useConnectUrl,
  useSetupWebhook,
  useZernioAccounts,
  type ZernioAccount,
  type ZernioPlatform,
} from "@/hooks/use-zernio";
import { humanizeError } from "@/lib/humanize-error";

// ---------------------------------------------------------------------------
// Ajustes → Integrações: key do Zernio, webhook, contas conectadas e o
// mapeamento canal → conta (channels.config.zernio_account_id).
// Eixo 1 de docs/10-plano-integracoes.md.
// ---------------------------------------------------------------------------

interface ZernioSettings {
  profile_id: string | null;
  webhook_id: string | null;
  timezone: string;
}

export function ZernioIntegrationSection() {
  const secretStatus = useSecretStatus();
  const keyConfigured = secretStatus.data?.includes("ZERNIO_API_KEY") ?? false;

  return (
    <div className="space-y-6">
      {keyConfigured ? (
        <>
          <ConnectedAccountsCard />
          <AccountFormatsCard />
        </>
      ) : secretStatus.isLoading ? null : (
        <EmptyState
          icon={Link2}
          title="Conecte o Zernio para publicar"
          description="Clique em Zernio acima e cole a chave de API. Depois, conecte aqui as contas das redes."
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contas conectadas
// ---------------------------------------------------------------------------

function ConnectedAccountsCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Contas conectadas</CardTitle>
        <CardDescription>
          Clique na rede para autorizar a conta no Zernio. As 2 primeiras são grátis; a partir da
          3ª, o Zernio cobra por conta.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ZernioAccountsList />
      </CardContent>
    </Card>
  );
}

export interface ZernioAccountsListProps {
  /** Redes oferecidas para conectar. Padrão: todas as que o Zernio suporta. */
  platforms?: readonly ZernioPlatform[];
  className?: string;
}

/**
 * Botões "Conectar <rede>" + lista aberta das contas já autorizadas no Zernio.
 * Sem container: quem usa decide o entorno (Card em Ajustes, passo no fluxo de
 * configuração). Só faz sentido com a chave do Zernio salva.
 */
export function ZernioAccountsList({
  platforms = ZERNIO_PLATFORMS,
  className,
}: ZernioAccountsListProps) {
  const accountsQuery = useZernioAccounts();
  const connectUrl = useConnectUrl();
  const accounts = accountsQuery.data ?? [];
  const { refetch } = accountsQuery;

  // A autorização roda em outra aba; quando ela volta (/conectado), avisa aqui.
  // A lista se atualiza sozinha e a pessoa segue onde estava.
  useEffect(
    () =>
      onZernioConnected(({ platform, username }) => {
        void refetch();
        const rede = platform
          ? (ZERNIO_PLATFORM_LABELS[platform as ZernioPlatform] ?? platform)
          : "Conta";
        toast.success(`${rede} conectado`, {
          description: username ? `@${username} já pode receber as peças.` : undefined,
        });
      }),
    [refetch],
  );

  const handleConnect = (platform: ZernioPlatform) => {
    connectUrl.mutate(
      { platform, redirectUrl: zernioReturnUrl() },
      {
        onSuccess: (url) => {
          // window.open fora do gesto do clique (estamos num onSuccess async)
          // pode ser barrado pelo popup blocker — o fallback é um clique real.
          const win = window.open(url, "_blank", "noopener");
          if (win) {
            toast.info("Autorize a conta na aba que abriu", {
              description: "Quando terminar, ela fecha sozinha e a conta aparece aqui.",
            });
          } else {
            toast.info("O navegador bloqueou a aba de autorização", {
              description: "Clique em Abrir para autorizar a conta.",
              duration: 15000,
              action: {
                label: "Abrir",
                onClick: () => window.open(url, "_blank", "noopener"),
              },
            });
          }
        },
        onError: (error) => {
          toast.error("Não foi possível iniciar a conexão", { description: error.message });
        },
      },
    );
  };

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {platforms.map((platform) => (
          <Button
            key={platform}
            variant="outline"
            size="sm"
            onClick={() => handleConnect(platform)}
            disabled={connectUrl.isPending}
          >
            {zernioBrand(platform) ? (
              <BrandIcon name={zernioBrand(platform)!} />
            ) : (
              <ExternalLink aria-hidden="true" />
            )}
            Conectar {ZERNIO_PLATFORM_LABELS[platform]}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => void accountsQuery.refetch()}
          disabled={accountsQuery.isFetching}
        >
          <RefreshCw
            className={accountsQuery.isFetching ? "animate-spin" : undefined}
            aria-hidden="true"
          />
          Atualizar
        </Button>
      </div>

      {accountsQuery.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : accountsQuery.isError ? (
        <p className="text-sm text-[var(--via-text-muted)]">
          Não foi possível listar as contas
          {accountsQuery.error instanceof Error
            ? ` — ${humanizeError(accountsQuery.error.message)}`
            : ""}
          . Clique em Atualizar para tentar de novo.
        </p>
      ) : accounts.length === 0 ? (
        <p className="border-t border-[var(--via-border-soft)] pt-3 text-sm text-[var(--via-text-muted)]">
          Nenhuma conta conectada ainda. Autorize acima a conta onde as peças serão publicadas.
        </p>
      ) : (
        <ul
          className="divide-y divide-[var(--via-border-soft)] border-y border-[var(--via-border-soft)]"
          aria-label="Contas conectadas no Zernio"
        >
          {accounts.map((account) => (
            <li key={account.accountId} className="flex items-center gap-3 py-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-[var(--via-border-soft)] bg-[var(--via-navy-04)]">
                {zernioBrand(account.platform) ? (
                  <BrandIcon name={zernioBrand(account.platform)!} className="size-4" />
                ) : (
                  <Link2 className="size-4 text-[var(--via-text-muted)]" aria-hidden="true" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[var(--via-text-primary)]">
                  {account.name || account.username || account.accountId}
                </span>
                {account.username && account.name !== account.username ? (
                  <span className="block truncate text-xs text-[var(--via-text-muted)]">
                    @{account.username}
                  </span>
                ) : null}
              </span>
              <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-[var(--via-text-primary)]">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--via-navy)]" />
                {ZERNIO_PLATFORM_LABELS[account.platform as ZernioPlatform] ?? account.platform}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FORMATOS POR CONTA (pontos 9 e 10 do plano).
//
// O modelo era FORMATO → uma conta: "Reel" ficava preso a um único perfil, e
// Reel estava habilitado sem conta nenhuma — peça gerada sem destino. Agora é a
// CONTA que declara o que aceita: qualquer conta conectada pode receber Reel.
//
// Os formatos aparecem agrupados por FAMÍLIA porque é assim que se pensa neles
// — vídeo curto vertical é reel, shorts e tiktok; story é story em toda parte.
// ---------------------------------------------------------------------------

/** app_settings.zernio_account_formats — { [accountId]: { formats: [...] } } */
type AccountFormats = Record<string, { formats?: ChannelType[] }>;

function AccountFormatsCard() {
  const accountsQuery = useZernioAccounts();
  const setting = useAppSetting<AccountFormats>("zernio_account_formats");
  const salvar = useUpdateAppSetting();

  const accounts = accountsQuery.data ?? [];
  const mapa = setting.data ?? {};

  const alternar = async (accountId: string, type: ChannelType) => {
    // Relê do BANCO antes de escrever. A escrita é da chave INTEIRA e o cache do
    // react-query só invalida depois do onSuccess: dois cliques seguidos
    // montavam o segundo payload a partir do estado ANTERIOR e apagavam o
    // primeiro toggle em silêncio.
    const { data: fresco } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "zernio_account_formats")
      .maybeSingle();
    const atual = (fresco?.value ?? {}) as AccountFormats;
    const atuais = atual[accountId]?.formats ?? [];
    const proximos = atuais.includes(type) ? atuais.filter((t) => t !== type) : [...atuais, type];
    salvar.mutate(
      {
        key: "zernio_account_formats",
        value: { ...atual, [accountId]: { formats: proximos } },
      },
      {
        onError: (error: Error) =>
          toast.error("Não foi possível salvar os formatos", { description: error.message }),
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Formatos por conta</CardTitle>
        <CardDescription>
          Marque o que cada conta publica. A peça vai para a conta que aceita o formato; se houver
          mais de uma, você escolhe ao publicar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {accountsQuery.isLoading || setting.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : accounts.length === 0 ? (
          <Alert>
            <Info className="size-4" aria-hidden="true" />
            <AlertTitle>Nenhuma conta conectada</AlertTitle>
            <AlertDescription>
              Conecte uma conta acima para escolher o que ela publica.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4" data-testid="formatos-por-conta">
            {accounts.map((account) => {
              const marcados = mapa[account.accountId]?.formats ?? [];
              // só os formatos que a PLATAFORMA daquela conta comporta
              const possiveis = CHANNEL_TYPES.filter(
                (type: ChannelType) => CHANNEL_TO_ZERNIO_PLATFORM[type] === account.platform,
              );
              return (
                <div key={account.accountId} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {account.name || account.username || account.accountId}
                    </span>
                    <Badge variant="outline" className="gap-1.5 font-normal text-muted-foreground">
                      {zernioBrand(account.platform) ? (
                        <BrandIcon name={zernioBrand(account.platform)!} className="size-3" />
                      ) : null}
                      {ZERNIO_PLATFORM_LABELS[account.platform as ZernioPlatform] ??
                        account.platform}
                    </Badge>
                  </div>
                  <div className="mt-3 space-y-2.5">
                    {groupByFamily(possiveis).map((grupo) => (
                      <div key={grupo.family} className="space-y-1">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {grupo.label}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {grupo.types.map((type) => {
                            const ativo = marcados.includes(type);
                            return (
                              <ChoiceChip
                                key={type}
                                selected={ativo}
                                onClick={() => void alternar(account.accountId, type)}
                                disabled={salvar.isPending}
                              >
                                <ChannelLabel type={type} />
                              </ChoiceChip>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    {possiveis.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Ainda não há formatos disponíveis para esta rede.
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Plataforma do Zernio → marca ("twitter" é o X). */
function zernioBrand(platform: string) {
  return channelBrand(platform === "twitter" ? "x_" : platform);
}
