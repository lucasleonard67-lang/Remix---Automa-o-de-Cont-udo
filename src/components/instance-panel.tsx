import { AlertTriangle, CheckCircle2, Clock, Database, Server } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppSetting } from "@/hooks/use-app-settings";
import { MINUTOS_PARA_TRAVADO, refDoProjeto, useInstanceHealth } from "@/hooks/use-instance-health";
import { PIECE_STATUS_LABELS } from "@/hooks/use-content-pieces";

// ---------------------------------------------------------------------------
// Aba INSTÂNCIA (F5.4) — o diagnóstico desta implementação.
//
// Estava como "em construção — chega na fase F5", que é anotação de plano
// interno exposta ao usuário: quem abre a aba não sabe o que é uma fase, e
// muito menos o que é uma instância.
//
// Uma INSTÂNCIA é uma implementação inteira do Content Engine para UM cliente:
// projeto, banco e deploy próprios. O isolamento é físico — não há multi-tenant
// nem `tenant_id`. Instância nova nasce de um Remix do template.
// ---------------------------------------------------------------------------

/** Rotinas de fundo, com a cadência que está registrada no pg_cron. */
const ROTINAS: Array<{ nome: string; cadencia: string; faz: string }> = [
  { nome: "Retomada de gerações", cadencia: "a cada 5 min", faz: "retoma geração parada no meio" },
  { nome: "Radar", cadencia: "a cada 30 min", faz: "busca notícias novas nas fontes" },
  { nome: "Automação", cadencia: "de hora em hora", faz: "dispara os gatilhos que você criou" },
  { nome: "Produção de vídeo", cadencia: "a cada 1 min", faz: "avança os vídeos em produção" },
  {
    nome: "Vídeo — conferência",
    cadencia: "a cada 5 min",
    faz: "confere etapas que terminaram sem avisar",
  },
  {
    nome: "Vídeo — etapas paradas",
    cadencia: "a cada 5 min",
    faz: "marca como falha a etapa que nunca terminou",
  },
  { nome: "Limpeza", cadencia: "1× por dia", faz: "apaga contadores de uso antigos" },
];

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-0">
      <span className="text-sm text-muted-foreground">{rotulo}</span>
      <span className="text-right text-sm font-medium text-foreground">{valor}</span>
    </div>
  );
}

export function InstancePanel() {
  const saude = useInstanceHealth();
  const onboarding = useAppSetting<{ brand_name?: string }>("onboarding");
  const ref = refDoProjeto();
  const d = saude.data;

  return (
    <div className="space-y-6">
      {/* O que É uma instância — a pergunta que a aba precisa responder antes
          de mostrar número nenhum. */}
      <Alert>
        <Server className="size-4" aria-hidden="true" />
        <AlertTitle>Esta é uma instância dedicada</AlertTitle>
        <AlertDescription>
          Esta cópia da Automação de Redes Sociais é só sua: dados próprios, sem nenhuma outra marca. Use esta
          aba para conferir se as gerações estão rodando.
        </AlertDescription>
      </Alert>

      {d && d.jobs.travados > 0 ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>
            {d.jobs.travados === 1 ? "1 geração travada" : `${d.jobs.travados} gerações travadas`}
          </AlertTitle>
          <AlertDescription>
            Sem avançar há mais de {MINUTOS_PARA_TRAVADO} min. O sistema tenta retomar a cada 5 min;
            se o número não cair, a geração falhou. Nesse caso, gere de novo em Criar.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="size-4 text-muted-foreground" aria-hidden="true" />
              Identidade
            </CardTitle>
            <CardDescription>Qual cópia é esta e qual versão gerou a última peça.</CardDescription>
          </CardHeader>
          <CardContent>
            <Linha rotulo="Marca" valor={onboarding.data?.brand_name || "—"} />
            <Linha rotulo="Projeto" valor={ref ? <code className="text-xs">{ref}</code> : "—"} />
            <Linha
              rotulo="Versão do motor"
              valor={d?.motor ? <code className="text-xs">{d.motor}</code> : "—"}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {saude.isLoading ? (
                <Clock className="size-4 text-muted-foreground" aria-hidden="true" />
              ) : d && d.jobs.travados === 0 ? (
                <CheckCircle2 className="size-4 text-primary" aria-hidden="true" />
              ) : (
                <AlertTriangle className="size-4 text-destructive" aria-hidden="true" />
              )}
              Saúde do motor
            </CardTitle>
            <CardDescription>Como estão as gerações agora.</CardDescription>
          </CardHeader>
          <CardContent>
            {saude.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <>
                <Linha rotulo="Gerações no total" valor={d?.jobs.total ?? 0} />
                <Linha rotulo="Em andamento" valor={d?.jobs.emVoo ?? 0} />
                <Linha
                  rotulo="Travadas"
                  valor={
                    d && d.jobs.travados > 0 ? (
                      <Badge variant="destructive">{d.jobs.travados}</Badge>
                    ) : (
                      0
                    )
                  }
                />
                <Linha rotulo="Falhas acumuladas" valor={d?.jobs.falhos ?? 0} />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Volume</CardTitle>
          <CardDescription>O que existe hoje nesta cópia.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-x-8 md:grid-cols-2">
          <div>
            {saude.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : Object.keys(d?.pecas ?? {}).length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">Nenhuma peça gerada ainda.</p>
            ) : (
              Object.entries(d?.pecas ?? {})
                .sort((a, b) => b[1] - a[1])
                .map(([status, n]) => (
                  <Linha
                    key={status}
                    rotulo={
                      PIECE_STATUS_LABELS[status as keyof typeof PIECE_STATUS_LABELS] ?? status
                    }
                    valor={n}
                  />
                ))
            )}
          </div>
          <div>
            {saude.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <>
                <Linha rotulo="Itens de Contexto prontos" valor={d?.contexto.prontos ?? 0} />
                <Linha rotulo="Itens em processamento" valor={d?.contexto.processando ?? 0} />
                <Linha rotulo="Itens com falha" valor={d?.contexto.falhos ?? 0} />
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rotinas automáticas</CardTitle>
          <CardDescription>O que roda sozinho, mesmo com o app fechado.</CardDescription>
        </CardHeader>
        <CardContent>
          {ROTINAS.map((r) => (
            <div
              key={r.nome}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border py-2 last:border-0"
            >
              <span className="text-sm font-medium text-foreground">{r.nome}</span>
              <span className="text-sm text-muted-foreground">{r.faz}</span>
              <Badge variant="outline" className="text-xs">
                {r.cadencia}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {d?.ultimaFalha ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Última falha</CardTitle>
            <CardDescription>
              {new Date(d.ultimaFalha.quando).toLocaleString("pt-BR")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="break-words text-sm text-muted-foreground">
              {d.ultimaFalha.erro || "Sem mensagem registrada."}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
