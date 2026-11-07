import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { Info, Mail, Server, UserPlus, Users } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "@/lib/toast";

import { EmptyState } from "@/components/empty-state";
import { AiRoleGrid } from "@/components/ai-role-grid";
import { IntegrationGrid, IntegrationGroups } from "@/components/integration-grid";
import { openIntegration } from "@/lib/integration-modal";
import { AI_INTEGRATION_IDS, INTEGRATION_BY_ID, type IntegrationId } from "@/lib/integrations";
import { McpConnectorCard } from "@/components/mcp-connector";
import { ReplicateIntegrationCard } from "@/components/replicate-integration";
import { ZernioIntegrationSection } from "@/components/zernio-integration";
import { AjustesLayout } from "@/components/settings/ajustes-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { InstancePanel } from "@/components/instance-panel";
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
import { useBrandAutopilot } from "@/hooks/use-brand-autopilot";
import {
  AI_DRIVERS,
  AI_ROLES,
  AI_ROLE_LABELS,
  MODEL_CUSTOM,
  MODEL_DEFAULT,
  modelsFor,
  WEB_SEARCH_PROVIDERS,
  WEB_SEARCH_PROVIDER_LABELS,
  useAppSetting,
  useUpdateAppSetting,
  type AiDriver,
  type AiProviders,
  type AiRole,
  type WebSearchProviderSetting,
  type WebSearchSetting,
} from "@/hooks/use-app-settings";
import {
  APP_ROLES,
  APP_ROLE_LABELS,
  useInviteUser,
  useMembers,
  useSetRole,
  type AppRole,
  type Member,
} from "@/hooks/use-users-admin";
import { fetchIsAdmin } from "@/lib/auth";
import { higgsfieldExchange } from "@/hooks/use-higgsfield";
import { humanizeError } from "@/lib/humanize-error";

const CONFIG_TABS = ["usuarios", "ia", "integracoes", "instancia"] as const;
type ConfigTab = (typeof CONFIG_TABS)[number];

export const Route = createFileRoute("/_app/config")({
  // ?code&state (ou ?error) é a volta do OAuth do Higgsfield; depois da troca
  // vira ?higgsfield=<desfecho>, que mostra o aviso
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    aba?: ConfigTab;
    higgsfield?: string;
    integracao?: string;
    code?: string;
    state?: string;
    error?: string;
  } => ({
    // `?aba=`: o menu lateral (Ajustes → Usuários/IA/Integrações) abre a aba direto
    ...(CONFIG_TABS.includes(search.aba as ConfigTab) ? { aba: search.aba as ConfigTab } : {}),
    ...(typeof search.higgsfield === "string" ? { higgsfield: search.higgsfield } : {}),
    ...(typeof search.code === "string" ? { code: search.code } : {}),
    ...(typeof search.state === "string" ? { state: search.state } : {}),
    ...(typeof search.error === "string" ? { error: search.error } : {}),
    // `?integracao=<id>`: o assistente e os avisos "Conectar X" abrem direto a aba Integrações
    ...(typeof search.integracao === "string" ? { integracao: search.integracao } : {}),
  }),
  beforeLoad: async () => {
    // Guard de role admin: sem role — ou erro ao ler user_roles — → home.
    const isAdmin = await fetchIsAdmin();
    if (!isAdmin) {
      throw redirect({ to: "/" });
    }
  },
  component: ConfigPage,
});

/**
 * Mensagens da volta do OAuth do Higgsfield. A edge manda só o código do
 * desfecho — o texto é daqui, nunca do provedor.
 */
const RETORNO_HIGGSFIELD: Record<string, { ok: boolean; titulo: string; detalhe: string }> = {
  conectado: {
    ok: true,
    titulo: "Higgsfield conectado",
    detalhe: "A tela Vídeos já pode gerar imagens e vídeos.",
  },
  recusado: {
    ok: false,
    titulo: "Autorização recusada",
    detalhe: "O Higgsfield não liberou o acesso. Clique em Conectar Higgsfield e autorize de novo.",
  },
  sessao: {
    ok: false,
    titulo: "Conexão não confirmada",
    detalhe:
      "A autorização não corresponde à conexão aberta aqui. Clique em Conectar Higgsfield para recomeçar.",
  },
  expirado: {
    ok: false,
    titulo: "Tempo esgotado",
    detalhe: "A autorização passou de 15 minutos. Clique em Conectar Higgsfield para recomeçar.",
  },
  falhou: {
    ok: false,
    titulo: "Conexão não concluída",
    detalhe: "O Higgsfield não confirmou a conexão. Clique em Conectar Higgsfield e tente de novo.",
  },
};

function ConfigPage() {
  const { aba: abaUrl, higgsfield, integracao, code, state, error } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tratado = useRef<string | null>(null);
  const trocado = useRef(false);
  const voltaOauth = Boolean((code && state) || error);
  // A aba vive na URL (?aba=): o menu lateral e as abas escrevem no mesmo
  // lugar. Volta do OAuth sem ?aba cai direto em Integrações, senão parece
  // que nada aconteceu.
  const aba: ConfigTab =
    abaUrl ?? (higgsfield || integracao || voltaOauth ? "integracoes" : "usuarios");
  // A URL sempre carrega a aba resolvida: o menu lateral acende o subitem
  // certo e o topo mostra o nome dela sem caso especial.
  useEffect(() => {
    if (abaUrl) return;
    void navigate({ to: "/config", search: (prev) => ({ ...prev, aba }), replace: true });
  }, [abaUrl, aba, navigate]);

  useEffect(() => {
    // o code vale uma vez só: o ref segura o segundo disparo do efeito
    if (!voltaOauth || trocado.current) return;
    trocado.current = true;
    higgsfieldExchange({ code, state, error })
      .then(({ outcome }) => outcome)
      .catch(() => "falhou")
      .then((desfecho) =>
        navigate({ to: "/config", search: { higgsfield: desfecho }, replace: true }),
      );
  }, [voltaOauth, code, state, error, navigate]);

  useEffect(() => {
    if (integracao && integracao in INTEGRATION_BY_ID) openIntegration(integracao as IntegrationId);
  }, [integracao]);

  useEffect(() => {
    if (!higgsfield || tratado.current === higgsfield) return;
    tratado.current = higgsfield;
    const desfecho = RETORNO_HIGGSFIELD[higgsfield];
    if (desfecho?.ok) {
      queryClient.invalidateQueries({ queryKey: ["higgsfield"] });
      toast.success(desfecho.titulo, { description: desfecho.detalhe });
    } else if (desfecho) {
      toast.error(desfecho.titulo, { description: desfecho.detalhe });
    }
    // limpa a URL (recarregar não pode repetir o aviso) sem sair da aba
    navigate({
      to: "/config",
      search: (prev) => ({ aba: prev.aba ?? "integracoes" }),
      replace: true,
    });
  }, [higgsfield, navigate, queryClient]);

  return (
    <AjustesLayout ativa={aba}>
      {aba === "usuarios" ? <UsersCard /> : null}

      {aba === "ia" ? (
        <div className="space-y-6">
          <section className="space-y-3">
            <div>
              <h3 className="text-base font-medium text-[var(--via-text-primary)]">
                Quem faz cada etapa
              </h3>
              <p className="mt-1 text-sm text-[var(--via-text-muted)]">
                Clique em uma etapa para trocar o provedor ou o modelo. Sem escolha, o Extrator de
                voz usa o mesmo do Gerador.
              </p>
            </div>
            <AiRoleGrid />
          </section>
          <WebSearchCard />
          <section className="space-y-3">
            <div>
              <h3 className="text-base font-medium text-[var(--via-text-primary)]">
                Suas chaves de IA
              </h3>
              <p className="mt-1 text-sm text-[var(--via-text-muted)]">
                Clique em um serviço para colar a chave. Ela fica guardada com segurança e não
                aparece de novo depois de salva.
              </p>
            </div>
            <IntegrationGrid ids={AI_INTEGRATION_IDS} />
          </section>
        </div>
      ) : null}

      {aba === "integracoes" ? (
        <div className="space-y-8">
          <IntegrationGroups />
          <ZernioIntegrationSection />
          <ReplicateIntegrationCard />
          <McpConnectorCard />
        </div>
      ) : null}

      {aba === "instancia" ? (
        <div className="space-y-8">
          <InstancePanel />
          <DemoSection />
        </div>
      ) : null}
    </AjustesLayout>
  );
}

// ---------------------------------------------------------------------------
// Demonstração — volta o onboarding ao início para apresentar a leitura
// automática da marca de novo. As versões da marca ficam guardadas.
// ---------------------------------------------------------------------------

function DemoSection() {
  const navigate = useNavigate();
  const { reset } = useBrandAutopilot();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleReset = () => {
    reset.mutate(undefined, {
      onSuccess: () => {
        setConfirmOpen(false);
        toast.success("Onboarding resetado", {
          description:
            "A leitura da marca abre do zero. As versões da marca continuam no histórico.",
        });
        void navigate({ to: "/onboarding" });
      },
      onError: (error) => {
        toast.error("Não foi possível resetar o onboarding", { description: error.message });
      },
    });
  };

  return (
    <section className="space-y-3 border-t border-border pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-medium text-[var(--via-text-primary)]">Demonstração</h3>
          <p className="mt-1 text-sm text-[var(--via-text-muted)]">
            Volta o onboarding ao início para mostrar a leitura automática da marca. Nada da marca é
            apagado.
          </p>
        </div>
        <Button variant="outline" onClick={() => setConfirmOpen(true)} disabled={reset.isPending}>
          {reset.isPending ? "Resetando…" : "Resetar onboarding"}
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resetar o onboarding?</AlertDialogTitle>
            <AlertDialogDescription>
              Todo administrador volta a ver a tela inicial de leitura da marca. Voz, bandeira,
              regras e identidade visual continuam ativas e com histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset} disabled={reset.isPending}>
              Resetar onboarding
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Usuários — profiles + user_roles (leitura) e convite por e-mail (invite-user)
// ---------------------------------------------------------------------------

function UsersCard() {
  const membersQuery = useMembers();
  const setRole = useSetRole();
  const [inviteOpen, setInviteOpen] = useState(false);
  const members = membersQuery.data ?? [];
  const admins = members.filter((m) => m.roles.includes("admin")).length;
  const trocarPapel = (member: Member, role: AppRole) => {
    if (member.roles.includes(role) && member.roles.length === 1) return;
    setRole.mutate(
      { userId: member.userId, role },
      {
        onSuccess: () =>
          toast.success(
            `${member.displayName || "Pessoa"} agora é ${APP_ROLE_LABELS[role].toLowerCase()}.`,
          ),
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Quem tem acesso</CardTitle>
          <CardDescription>Novas pessoas entram só por convite.</CardDescription>
        </div>
        <Button onClick={() => setInviteOpen(true)}>
          <UserPlus aria-hidden="true" />
          Convidar
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="size-4" aria-hidden="true" />
          <AlertTitle>E-mails ficam ocultos</AlertTitle>
          <AlertDescription>
            Por privacidade, esta lista não mostra e-mails. Troque o papel na própria linha; a
            instância sempre mantém ao menos um administrador.
          </AlertDescription>
        </Alert>

        {membersQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : membersQuery.isError ? (
          <p className="text-sm text-muted-foreground">
            Não foi possível carregar os usuários.{" "}
            {membersQuery.error instanceof Error
              ? humanizeError(membersQuery.error.message)
              : "Recarregue a página."}
          </p>
        ) : members.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Ninguém na lista ainda"
            description="Quem aceitar um convite aparece aqui após o primeiro acesso. Clique em Convidar para começar."
          />
        ) : (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead className="w-40">Papel</TableHead>
                  <TableHead className="w-36">Entrou em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <TableRow key={member.userId}>
                    <TableCell className="font-medium">
                      {member.displayName || "(sem nome)"}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={
                          member.roles.includes("admin") ? "admin" : (member.roles[0] ?? "user")
                        }
                        onValueChange={(value) => trocarPapel(member, value as AppRole)}
                        disabled={
                          setRole.isPending ||
                          // o último admin não rebaixa a si mesmo
                          (member.roles.includes("admin") && admins <= 1)
                        }
                      >
                        <SelectTrigger
                          className="h-8 w-36"
                          aria-label={`Papel de ${member.displayName || "pessoa"}`}
                          data-testid={`papel-${member.userId}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {APP_ROLES.map((role) => (
                            <SelectItem key={role} value={role}>
                              {APP_ROLE_LABELS[role]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(new Date(member.createdAt), "dd/MM/yyyy")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </Card>
  );
}

function InviteUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const inviteUser = useInviteUser();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("user");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inviteUser.isPending) return;
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error("Informe o e-mail de quem você quer convidar.");
      return;
    }
    // O form usa noValidate, então type="email" não barra nada: "abc", "abc@" e
    // "a b@c.com" passavam e só falhavam no servidor, depois de a pessoa achar
    // que tinha convidado alguém.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) {
      toast.error("E-mail inválido", {
        description: "Confira o endereço — falta o @ ou o domínio.",
      });
      return;
    }
    inviteUser.mutate(
      { email: trimmed, role },
      {
        onSuccess: () => {
          setEmail("");
          setRole("user");
          onOpenChange(false);
          toast.success(`Convite enviado para ${trimmed}`, {
            description:
              "A pessoa recebe um e-mail com o link de acesso e cria a senha ao aceitar.",
          });
        },
        onError: (error) => {
          toast.error("Não foi possível convidar", { description: error.message });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>Convidar pessoa</DialogTitle>
            <DialogDescription>
              Ela recebe um e-mail com o link de acesso. O papel vale assim que ela aceitar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">E-mail</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="pessoa@empresa.com"
                autoComplete="off"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">Papel</Label>
              <Select value={role} onValueChange={(value) => setRole(value as AppRole)}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {APP_ROLES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {APP_ROLE_LABELS[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Administrador configura marca, canais, IA e acessos. Usuário gera e revisa peças.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={inviteUser.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!email.trim() || inviteUser.isPending}>
              <Mail aria-hidden="true" />
              {inviteUser.isPending ? "Enviando…" : "Enviar convite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Pesquisa web — app_settings.web_search (etapa `researching` da saga)
// ---------------------------------------------------------------------------

const DEFAULT_WEB_SEARCH: WebSearchSetting = { enabled: true, provider: "auto", max_results: 5 };

function WebSearchCard() {
  const { data: setting, isLoading } = useAppSetting<WebSearchSetting>("web_search");
  const updateSetting = useUpdateAppSetting();

  const [edits, setEdits] = useState<WebSearchSetting | null>(null);
  const saved: WebSearchSetting = { ...DEFAULT_WEB_SEARCH, ...(setting ?? {}) };
  const current: WebSearchSetting = edits ?? saved;
  const dirty = edits !== null && JSON.stringify(edits) !== JSON.stringify(saved);

  const patch = (partial: Partial<WebSearchSetting>) => {
    setEdits((prev) => ({ ...(prev ?? saved), ...partial }));
  };

  const handleSave = () => {
    if (!edits) return;
    updateSetting.mutate(
      { key: "web_search", value: edits },
      {
        onSuccess: () => {
          setEdits(null);
          toast.success("Pesquisa web salva");
        },
        onError: (error) => {
          toast.error("Não foi possível salvar", { description: error.message });
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pesquisa web</CardTitle>
        <CardDescription>
          Antes de gerar, busca notícias e dados recentes na internet. O que for encontrado fica
          salvo em Contexto, com a tag pesquisa-web.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="web-search-provider">Provedor</Label>
                <Select
                  value={current.provider}
                  onValueChange={(value) => patch({ provider: value as WebSearchProviderSetting })}
                >
                  <SelectTrigger id="web-search-provider" aria-label="Provedor da pesquisa web">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEB_SEARCH_PROVIDERS.map((provider) => (
                      <SelectItem key={provider} value={provider}>
                        {WEB_SEARCH_PROVIDER_LABELS[provider]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="web-search-max-results">Resultados por busca (1–10)</Label>
                <Input
                  id="web-search-max-results"
                  type="number"
                  min={1}
                  max={10}
                  value={current.max_results}
                  onChange={(event) => {
                    const n = Number(event.target.value);
                    if (Number.isFinite(n))
                      patch({ max_results: Math.min(10, Math.max(1, Math.trunc(n))) });
                  }}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              “Automático” usa a primeira chave cadastrada em Suas chaves de IA, abaixo. Sem nenhuma
              chave, a geração segue sem pesquisa.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setEdits(null)}
                disabled={!dirty || updateSetting.isPending}
              >
                Descartar
              </Button>
              <Button onClick={handleSave} disabled={!dirty || updateSetting.isPending}>
                {updateSetting.isPending ? "Salvando…" : "Salvar alterações"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
