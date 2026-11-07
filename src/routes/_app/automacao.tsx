import { createFileRoute, redirect } from "@tanstack/react-router";
import { JOB_STATUS_LABELS, type JobStatus } from "@/hooks/use-generation-jobs";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Loader2, Play, Plus, Repeat, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "@/lib/toast";

import { BrandIcon } from "@/components/brand-icon";
import { EmptyState } from "@/components/empty-state";
import { AjustesLayout } from "@/components/settings/ajustes-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  TRIGGER_SOURCE_LABELS,
  useAutomationRuns,
  useAutomationTriggers,
  useDeleteTrigger,
  useRunAutomationNow,
  useCreateTrigger,
  useUpdateTrigger,
  type AutomationTrigger,
  type TriggerSource,
} from "@/hooks/use-automation";
import { useIntegrationStatus } from "@/components/integration-grid";
import { useAppSetting, useUpdateAppSetting } from "@/hooks/use-app-settings";
import { FORMAT_FAMILIES, FORMAT_FAMILY_LABELS, type FormatFamily } from "@/hooks/use-channels";
import { fetchIsAdmin } from "@/lib/auth";
import { openIntegration } from "@/lib/integration-modal";
import { INTEGRATION_BY_ID, VIDEO_EDIT_AUTO_LIVE } from "@/lib/integrations";

// ---------------------------------------------------------------------------
// /automacao — motor automático de conteúdo (ponto 7 do plano docs/14).
//
// O gatilho responde: em qual FAMÍLIA de formato, quantas peças por dia, a
// partir de qual fonte de pauta. Ele GERA E ENFILEIRA — nada é publicado
// sozinho, e a peça entra na Biblioteca em "Em revisão" como qualquer outra.
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_app/automacao")({
  beforeLoad: async () => {
    if (!(await fetchIsAdmin())) throw redirect({ to: "/" });
  },
  component: AutomacaoPage,
});

function AutomacaoPage() {
  const triggers = useAutomationTriggers();
  const runs = useAutomationRuns();
  const rodarAgora = useRunAutomationNow();
  const [criando, setCriando] = useState(false);

  const lista = triggers.data ?? [];

  return (
    <AjustesLayout ativa="automacao">
      <Alert>
        <Repeat className="size-4" aria-hidden="true" />
        <AlertTitle>Nada vai ao ar sem você</AlertTitle>
        <AlertDescription>
          Cada gatilho gera peças e as coloca em “Em revisão” na Biblioteca. Publicar continua sendo
          decisão sua.
        </AlertDescription>
      </Alert>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-medium text-[var(--via-text-primary)]">Gatilhos</h3>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              rodarAgora.mutate(undefined, {
                onSuccess: (data) =>
                  toast.success(
                    data.triggers === 0
                      ? "Nenhum gatilho ligado. Ligue um gatilho e tente de novo."
                      : `${data.triggers} gatilho(s) verificado(s). Quem ainda não bateu a cota de hoje começou a gerar.`,
                  ),
                onError: (error) =>
                  toast.error("Não foi possível rodar agora", { description: error.message }),
              })
            }
            disabled={rodarAgora.isPending || lista.length === 0}
          >
            {rodarAgora.isPending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Play aria-hidden="true" />
            )}
            Rodar agora
          </Button>
          {/* sem gatilho: a ação navy é a do estado vazio */}
          <Button
            size="sm"
            variant={lista.length === 0 ? "outline" : "default"}
            onClick={() => setCriando(true)}
            data-testid="novo-gatilho"
          >
            <Plus aria-hidden="true" />
            Novo gatilho
          </Button>
        </div>
      </div>

      {criando ? <TriggerForm onClose={() => setCriando(false)} /> : null}

      {triggers.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : lista.length === 0 && !criando ? (
        <EmptyState
          icon={Repeat}
          title="Nenhum gatilho ainda"
          description="Escolha o formato, quantas peças por dia e de onde vem o tema. As peças chegam em revisão na Biblioteca."
        >
          <Button onClick={() => setCriando(true)}>
            <Plus aria-hidden="true" />
            Criar primeiro gatilho
          </Button>
        </EmptyState>
      ) : (
        <div className="space-y-3" data-testid="lista-gatilhos">
          {lista.map((trigger) => (
            <TriggerCard key={trigger.id} trigger={trigger} />
          ))}
        </div>
      )}

      {VIDEO_EDIT_AUTO_LIVE ? <VideoEditAuto /> : null}

      {/* sem gatilho não há disparo: o estado vazio de cima já diz o próximo passo */}
      {lista.length === 0 && !(runs.data ?? []).length ? null : (
        <section className="space-y-2">
          <h3 className="text-base font-medium text-[var(--via-text-primary)]">Últimos disparos</h3>
          {runs.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : (runs.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum disparo ainda. Gatilhos ligados rodam de hora em hora, até a cota do dia.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {(runs.data ?? []).map((run) => (
                <li key={run.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <Badge
                    variant={run.status === "error" ? "destructive" : "outline"}
                    className="font-normal"
                  >
                    {run.status === "ok"
                      ? "gerou"
                      : run.status === "skipped"
                        ? "pulou"
                        : run.status === "error"
                          ? "falhou"
                          : "iniciou"}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {runDetail(run.detail)}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {format(new Date(run.created_at), "dd/MM HH:mm", { locale: ptBR })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </AjustesLayout>
  );
}

// "Claude edita antes de entregar" (docs/motor-de-edicao.md §5): o motor lê
// `app_settings.video_edit.auto` e aplica as edições recomendadas em todo vídeo
// novo, dentro do teto do mês. Desligada por padrão; sem o editor pronto, a
// chave fica travada com o atalho para conectar.
const VIDEO_EDIT_KEY = "video_edit";

function VideoEditAuto() {
  const setting = useAppSetting<{ auto?: boolean }>(VIDEO_EDIT_KEY);
  const salvar = useUpdateAppSetting();
  const editor = useIntegrationStatus()(INTEGRATION_BY_ID.claude_editor);
  const ready = editor === "on";
  const auto = Boolean(setting.data?.auto) && ready;

  return (
    <section
      className="flex flex-wrap items-center gap-3 border-y border-border py-4"
      data-testid="video-edit-auto"
    >
      <BrandIcon name="claude" className="size-4" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">Claude edita antes de entregar</p>
        <p className="text-sm text-muted-foreground">
          {ready
            ? "Todo vídeo novo sai com as edições recomendadas. O original fica guardado e conta no teto do mês."
            : "Conecte o editor de vídeo para ligar."}
        </p>
      </div>
      {editor === "loading" || setting.isLoading ? (
        <Skeleton className="h-6 w-24" />
      ) : ready ? (
        <Label className="flex items-center gap-2 text-sm">
          <Switch
            checked={auto}
            disabled={salvar.isPending}
            onCheckedChange={(checked) =>
              salvar.mutate(
                { key: VIDEO_EDIT_KEY, value: { ...(setting.data ?? {}), auto: checked } },
                {
                  onError: (error) =>
                    toast.error("Não foi possível ligar ou desligar", {
                      description: error.message,
                    }),
                },
              )
            }
            aria-label="Claude edita antes de entregar"
          />
          {auto ? "Ligado" : "Desligado"}
        </Label>
      ) : (
        <Button variant="outline" size="sm" onClick={() => openIntegration("claude_editor")}>
          Conectar editor
        </Button>
      )}
    </section>
  );
}

function TriggerCard({ trigger }: { trigger: AutomationTrigger }) {
  const salvar = useUpdateTrigger();
  const remover = useDeleteTrigger();

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 py-4">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium text-foreground">{trigger.name}</p>
          <p className="text-sm text-muted-foreground">
            {FORMAT_FAMILY_LABELS[trigger.family] ?? trigger.family} ·{" "}
            {trigger.per_day === 1 ? "1 por dia" : `${trigger.per_day} por dia`} ·{" "}
            {TRIGGER_SOURCE_LABELS[trigger.source]}
          </p>
          {trigger.last_run_at ? (
            <p className="text-xs text-muted-foreground">
              Último disparo em{" "}
              {format(new Date(trigger.last_run_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <Label className="flex items-center gap-2 text-sm">
            <Switch
              checked={trigger.enabled}
              onCheckedChange={(checked) =>
                salvar.mutate(
                  { id: trigger.id, enabled: checked },
                  {
                    onError: (error) =>
                      toast.error("Não foi possível ligar ou desligar", {
                        description: error.message,
                      }),
                  },
                )
              }
              aria-label={`Gatilho ${trigger.name} ligado`}
            />
            {trigger.enabled ? "Ligado" : "Desligado"}
          </Label>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => {
              if (!window.confirm(`Apagar o gatilho “${trigger.name}”? Ele para de gerar peças.`))
                return;
              remover.mutate(trigger.id, {
                onSuccess: () => toast.success("Gatilho apagado"),
                onError: (error) =>
                  toast.error("Não foi possível apagar", { description: error.message }),
              });
            }}
            aria-label={`Apagar gatilho ${trigger.name}`}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TriggerForm({ onClose }: { onClose: () => void }) {
  const salvar = useCreateTrigger();
  const [name, setName] = useState("");
  const [family, setFamily] = useState<FormatFamily>("carrossel");
  const [perDay, setPerDay] = useState("1");
  const [source, setSource] = useState<TriggerSource>("acervo");
  const [theme, setTheme] = useState("");

  // Erro marcado NO CAMPO, não só num toast do canto oposto — e o foco vai
  // para ele, senão quem usa teclado não descobre o que faltou.
  const [erro, setErro] = useState<"name" | "theme" | "perDay" | null>(null);
  const cota = Math.trunc(Number(perDay));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setErro("name");
      document.getElementById("gatilho-nome")?.focus();
      toast.error("Dê um nome ao gatilho para reconhecê-lo depois.");
      return;
    }
    // O banco tem check (per_day between 1 and 20): fora disso o insert
    // falharia, e antes a UI reescrevia o número em silêncio.
    if (!Number.isFinite(cota) || cota < 1 || cota > 20) {
      setErro("perDay");
      document.getElementById("gatilho-cota")?.focus();
      toast.error("Escolha de 1 a 20 peças por dia.");
      return;
    }
    if (source === "tema" && !theme.trim()) {
      setErro("theme");
      document.getElementById("gatilho-tema")?.focus();
      toast.error("Escreva o tema fixo do gatilho.");
      return;
    }
    setErro(null);
    salvar.mutate(
      {
        name: name.trim(),
        family,
        per_day: cota,
        source,
        theme: source === "tema" ? theme.trim() : null,
        enabled: true,
      },
      {
        onSuccess: () => {
          toast.success("Gatilho criado", {
            description: "Ele roda na próxima hora. Para gerar já, clique em “Rodar agora”.",
          });
          onClose();
        },
        onError: (error) => toast.error("Não foi possível criar", { description: error.message }),
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Novo gatilho</CardTitle>
        <CardDescription>
          Gera até a quantidade do dia e para. As peças chegam à Biblioteca em “Em revisão”.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* noValidate: a validação é nossa, com mensagem que explica o que falta */}
        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="gatilho-nome">Nome</Label>
            <Input
              id="gatilho-nome"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Carrossel diário de cases"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="gatilho-familia">Formato</Label>
              <Select value={family} onValueChange={(v) => setFamily(v as FormatFamily)}>
                <SelectTrigger id="gatilho-familia">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMAT_FAMILIES.map((f) => (
                    <SelectItem key={f} value={f}>
                      {FORMAT_FAMILY_LABELS[f]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="gatilho-cota">Por dia</Label>
              <Input
                id="gatilho-cota"
                type="number"
                min={1}
                max={20}
                value={perDay}
                onChange={(event) => {
                  setPerDay(event.target.value);
                  setErro(null);
                }}
                aria-invalid={erro === "perDay"}
                aria-describedby={erro === "perDay" ? "gatilho-cota-erro" : undefined}
              />
              {erro === "perDay" ? (
                <p id="gatilho-cota-erro" className="text-xs text-destructive">
                  De 1 a 20 peças por dia.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="gatilho-fonte">Fonte do tema</Label>
              <Select value={source} onValueChange={(v) => setSource(v as TriggerSource)}>
                <SelectTrigger id="gatilho-fonte">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TRIGGER_SOURCE_LABELS) as TriggerSource[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {TRIGGER_SOURCE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {source === "tema" ? (
            <div className="space-y-2">
              <Label htmlFor="gatilho-tema">Tema fixo</Label>
              <Textarea
                id="gatilho-tema"
                value={theme}
                onChange={(event) => {
                  setTheme(event.target.value);
                  setErro(null);
                }}
                aria-invalid={erro === "theme"}
                placeholder="O custo escondido do retrabalho manual na indústria…"
                className="min-h-20"
              />
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={salvar.isPending}>
              {salvar.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Criar gatilho
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** O log grava o status cru do job ("terminou em \"failed\""): traduz e diz onde ver o motivo. */
function runDetail(detail: string | null): string {
  if (!detail) return "—";
  const m = detail.match(/a geração terminou em "(\w+)"/);
  if (!m) return detail;
  const status = JOB_STATUS_LABELS[m[1] as JobStatus] ?? m[1];
  return detail.replace(m[0], `a geração ${status} — veja o motivo em Criar`);
}
