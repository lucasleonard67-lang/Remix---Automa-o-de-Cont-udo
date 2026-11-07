import { format } from "date-fns";
import { FileText, Info, Plus } from "lucide-react";
import { useState } from "react";

import { ContextItemForm } from "@/components/context-item-form";
import { ContextStatusBadge } from "@/components/context-status-badge";
import { EmptyState } from "@/components/empty-state";
import { WizardFooter } from "@/components/onboarding/wizard-shell";
import type { OnboardingStepProps } from "@/components/onboarding/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CONTEXT_KIND_LABELS, useContextItems } from "@/hooks/use-context-items";

// ---------------------------------------------------------------------------
// Passo 3 — conteúdo de contexto: o corpus que define a voz. Com ≥ 1 item
// `ready` o passo 4 extrai a voz do material; sem corpus, o passo 4 cai na
// entrevista guiada.
// ---------------------------------------------------------------------------

export function StepContext({ advancing, onBack, onAdvance }: OnboardingStepProps) {
  const itemsQuery = useContextItems();
  const [formOpen, setFormOpen] = useState(false);

  const items = itemsQuery.data ?? [];
  const readyCount = items.filter((item) => item.status === "ready").length;
  const processingCount = items.filter((item) => item.status === "processing").length;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Adicione textos e transcrições da marca: é deles que o próximo passo tira a sua voz. Falas
        transcritas funcionam melhor que textos muito editados.
      </p>

      <Alert>
        <Info className="size-4" aria-hidden="true" />
        <AlertTitle>Quanto adicionar</AlertTitle>
        <AlertDescription>
          5 a 10 transcrições (lives, podcasts, reuniões) <strong>ou</strong> 15 a 20 posts que soem
          como você. Dá para continuar com menos e completar depois em Contexto.
        </AlertDescription>
      </Alert>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-normal">
            {items.length} {items.length === 1 ? "item" : "itens"}
          </Badge>
          <Badge
            variant="outline"
            className="border-[0.5px] border-[var(--via-border-soft)] bg-[var(--via-navy-04)] font-medium text-[var(--via-text-primary)]"
          >
            {readyCount} pronto{readyCount === 1 ? "" : "s"}
          </Badge>
          {processingCount > 0 ? (
            <Badge variant="outline" className="font-normal text-muted-foreground">
              {processingCount} processando
            </Badge>
          ) : null}
        </div>
        <Button onClick={() => setFormOpen(true)}>
          <Plus aria-hidden="true" />
          Adicionar conteúdo
        </Button>
      </div>

      {itemsQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Nenhum material adicionado"
          description="Cole uma transcrição, envie um arquivo ou informe um link. O processamento acontece em segundo plano."
        >
          <Button variant="outline" onClick={() => setFormOpen(true)}>
            <Plus aria-hidden="true" />
            Adicionar o primeiro
          </Button>
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {item.title}
              </span>
              <Badge variant="secondary" className="font-normal">
                {CONTEXT_KIND_LABELS[item.kind] ?? item.kind}
              </Badge>
              <ContextStatusBadge status={item.status} />
              <span className="text-xs text-muted-foreground">
                {format(new Date(item.created_at), "dd/MM/yyyy")}
              </span>
            </li>
          ))}
        </ul>
      )}

      <ContextItemForm open={formOpen} onOpenChange={setFormOpen} />

      <WizardFooter
        onBack={onBack}
        hint={
          readyCount === 0
            ? processingCount > 0
              ? "Processando o material. O botão libera quando o primeiro item ficar pronto."
              : "Sem material, você define a voz respondendo a uma entrevista no próximo passo."
            : null
        }
      >
        <Button variant="outline" onClick={() => void onAdvance()} disabled={advancing}>
          Pular e fazer entrevista
        </Button>
        <Button onClick={() => void onAdvance()} disabled={advancing || readyCount === 0}>
          {advancing ? "Salvando…" : "Usar este material"}
        </Button>
      </WizardFooter>
    </div>
  );
}
