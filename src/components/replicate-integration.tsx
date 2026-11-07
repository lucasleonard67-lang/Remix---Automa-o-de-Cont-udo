import { CheckCircle2, ListChecks, Loader2, TriangleAlert, Webhook } from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";

import { Badge } from "@/components/ui/badge";
import { BrandIcon } from "@/components/brand-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSecretStatus } from "@/hooks/use-app-settings";
import {
  useSetupReplicateWebhook,
  useValidateVideoCatalog,
  type ValidateCatalogResult,
} from "@/hooks/use-video-project";

// ---------------------------------------------------------------------------
// Ajustes → Integrações: token do Replicate, webhook de predições e validação
// do catálogo de modelos (docs/11-video-replicate.md §4.6/§4.7).
//
// A rota /config já é guardada por `fetchIsAdmin` no `beforeLoad` — não há
// checagem de role redundante aqui.
// ---------------------------------------------------------------------------

export function ReplicateIntegrationCard() {
  const secretStatus = useSecretStatus();
  const configured = secretStatus.data?.includes("REPLICATE_API_TOKEN") ?? false;

  const setupWebhook = useSetupReplicateWebhook();
  const validateCatalog = useValidateVideoCatalog();
  const [report, setReport] = useState<ValidateCatalogResult | null>(null);

  const handleSetup = () => {
    setupWebhook.mutate(undefined, {
      onSuccess: () => {
        toast.success("Webhook do Replicate configurado", {
          description: "O sistema passa a saber sozinho quando cada etapa do vídeo termina.",
        });
      },
      onError: (error) => {
        toast.error("Não foi possível configurar o webhook", { description: error.message });
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

  if (!configured) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BrandIcon name="replicate" className="size-5" />
          Replicate — vídeo dos Reels
        </CardTitle>
        <CardDescription>
          Token salvo. Antes do primeiro vídeo, ative o aviso de conclusão e verifique os modelos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {configured ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <Webhook className="size-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-sm">Webhook de vídeo</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSetup}
                disabled={setupWebhook.isPending}
              >
                {setupWebhook.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : null}
                Configurar webhook
              </Button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <ListChecks className="size-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-sm">Modelos de vídeo</span>
              </div>
              <Button
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
        ) : null}

        <p className="text-xs text-muted-foreground">
          O webhook avisa o sistema quando cada etapa do vídeo termina. Sem o token, os Reels da
          Biblioteca ficam sem vídeo; a tela Vídeos usa o Higgsfield e não depende dele.
        </p>
      </CardContent>
    </Card>
  );
}

/** Resultado da verificação dos modelos — também aparece no modal do Replicate. */
export function CatalogReport({ report }: { report: ValidateCatalogResult }) {
  const broken = report.report.filter((entry) => !entry.ok);
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">
          {report.checked} modelo{report.checked === 1 ? "" : "s"} verificado
          {report.checked === 1 ? "" : "s"}
        </span>
        {report.broken === 0 ? (
          <Badge
            variant="outline"
            className="gap-1 border-[0.5px] border-[var(--via-border-soft)] bg-[var(--via-navy-04)] font-medium text-[var(--via-text-primary)]"
          >
            <CheckCircle2 className="size-3" aria-hidden="true" />
            tudo certo
          </Badge>
        ) : (
          <Badge variant="destructive" className="gap-1 font-medium">
            <TriangleAlert className="size-3" aria-hidden="true" />
            {report.broken} com problema
          </Badge>
        )}
      </div>

      {broken.length > 0 ? (
        <ul className="space-y-2">
          {broken.map((entry) => (
            <li key={`${entry.capability}-${entry.model_id}`} className="text-xs">
              <span className="font-mono text-foreground">{entry.model_id}</span>{" "}
              <span className="text-muted-foreground">({entry.capability})</span>
              <ul className="mt-1 space-y-0.5 pl-4 text-muted-foreground">
                {entry.issues.map((issue, index) => (
                  <li key={index}>— {issue}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
