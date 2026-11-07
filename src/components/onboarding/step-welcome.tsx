import { Link } from "@tanstack/react-router";
import { Check, PenLine } from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";

import { WizardFooter } from "@/components/onboarding/wizard-shell";
import type { OnboardingStepProps } from "@/components/onboarding/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  nicheTemplateHighlights,
  useNicheTemplates,
  type NicheTemplate,
} from "@/hooks/use-niche-templates";
import {
  normalizeGuardrailsContent,
  normalizeStrategyContent,
  useActiveVersion,
  useDraftVersion,
  useSaveDraft,
  type GuardrailsContent,
  type StrategyContent,
} from "@/hooks/use-versioned-brand";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Passo 1 — boas-vindas: nome da marca + template de nicho.
// Ao avançar, o payload do template vira RASCUNHO inicial de guardrails e
// bandeira (nunca sobrescreve rascunho/versão ativa já existente).
// ---------------------------------------------------------------------------

/** `undefined` = nada escolhido ainda; `null` = "começar em branco". */
type Selection = string | null | undefined;

export function StepWelcome({ progress, advancing, onBack, onAdvance }: OnboardingStepProps) {
  const templatesQuery = useNicheTemplates();
  const [brandName, setBrandName] = useState(progress.brand_name ?? "");
  const [selection, setSelection] = useState<Selection>(
    progress.niche_template_slug ?? (progress.completed_steps.includes(1) ? null : undefined),
  );
  const [applying, setApplying] = useState(false);

  const guardrailsActive = useActiveVersion<GuardrailsContent>("guardrails");
  const guardrailsDraft = useDraftVersion<GuardrailsContent>("guardrails");
  const strategyActive = useActiveVersion<StrategyContent>("brand_strategy");
  const strategyDraft = useDraftVersion<StrategyContent>("brand_strategy");
  const saveGuardrails = useSaveDraft<GuardrailsContent>("guardrails");
  const saveStrategy = useSaveDraft<StrategyContent>("brand_strategy");

  const templates = templatesQuery.data ?? [];
  const nameOk = brandName.trim().length > 0;
  const chosen = selection !== undefined;
  const busy = advancing || applying;

  const handleContinue = async () => {
    if (!nameOk || !chosen || busy) return;
    setApplying(true);
    try {
      const template = selection ? templates.find((item) => item.slug === selection) : null;
      if (template) {
        await applyNicheTemplate(template);
      }
      await onAdvance({
        brand_name: brandName.trim(),
        niche_template_slug: selection ?? null,
      });
    } catch (error) {
      toast.error("Não foi possível aplicar o modelo do nicho", {
        description: `${error instanceof Error ? `${error.message} ` : ""}Clique em “Continuar” de novo ou escolha “Começar em branco”.`,
      });
    } finally {
      setApplying(false);
    }
  };

  /** Aplica o payload como rascunhos — só onde ainda não há rascunho nem ativa. */
  const applyNicheTemplate = async (template: NicheTemplate) => {
    const payload = template.payload ?? {};
    const applied: string[] = [];

    if (!guardrailsActive.data && !guardrailsDraft.data && payload.guardrails_preset) {
      await saveGuardrails.mutateAsync(normalizeGuardrailsContent(payload.guardrails_preset));
      applied.push("regras da marca");
    }

    if (!strategyActive.data && !strategyDraft.data) {
      const hints = payload.strategy_hints ?? {};
      const stance =
        typeof hints.editorial_stance === "string" && hints.editorial_stance.trim()
          ? hints.editorial_stance
          : (payload.editorial_stance ?? "");
      const merged = { ...hints, editorial_stance: stance };
      if (Object.keys(merged).length > 0) {
        await saveStrategy.mutateAsync(normalizeStrategyContent(merged));
        applied.push("bandeira");
      }
    }

    if (applied.length > 0) {
      toast.success(`Modelo “${template.name}” aplicado`, {
        description: `Rascunho de ${applied.join(" e ")} criado. Você revisa nos próximos passos.`,
      });
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Informe o nome da marca e escolha um ponto de partida para os próximos passos. Você pode
        sair e voltar quando quiser — o progresso fica salvo.{" "}
        <Link
          to="/onboarding"
          search={{}}
          className="underline underline-offset-4 hover:text-foreground"
        >
          Prefere automático? Leia a marca pelo site e Instagram
        </Link>
        .
      </p>

      <div className="max-w-md space-y-2">
        <Label htmlFor="brand-name">Nome da marca</Label>
        <Input
          id="brand-name"
          value={brandName}
          onChange={(event) => setBrandName(event.target.value)}
          placeholder="Ex.: Studio Vértice"
          autoFocus
        />
        <p className="text-xs text-muted-foreground">
          Aparece no topo do app e nas prévias das peças.
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">Ponto de partida</h2>
          <p className="text-xs text-muted-foreground">
            Um modelo de nicho já preenche a bandeira e as regras da marca como rascunho. Você
            revisa tudo nos passos 5 e 6.
          </p>
        </div>

        {templatesQuery.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-32 w-full" />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {templates.map((template) => (
              <TemplateCard
                key={template.slug}
                title={template.name}
                description={template.description ?? ""}
                highlights={nicheTemplateHighlights(template)}
                selected={selection === template.slug}
                onSelect={() => setSelection(template.slug)}
              />
            ))}
            <TemplateCard
              title="Começar em branco"
              description="Você escreve a bandeira e as regras da marca do zero."
              highlights={["nada preenchido"]}
              selected={selection === null}
              onSelect={() => setSelection(null)}
            />
          </div>
        )}

        {templatesQuery.isError ? (
          <p className="text-sm text-muted-foreground">
            Não foi possível carregar os modelos de nicho. Recarregue a página ou escolha “Começar
            em branco”.
          </p>
        ) : null}
      </div>

      <WizardFooter
        onBack={onBack}
        hint={
          !nameOk
            ? "Informe o nome da marca para continuar."
            : !chosen
              ? "Escolha um modelo ou “Começar em branco”."
              : null
        }
      >
        <Button onClick={() => void handleContinue()} disabled={!nameOk || !chosen || busy}>
          {busy ? "Salvando…" : "Continuar"}
        </Button>
      </WizardFooter>
    </div>
  );
}

function TemplateCard({
  title,
  description,
  highlights,
  selected,
  onSelect,
}: {
  title: string;
  description: string;
  highlights: string[];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex h-full flex-col gap-2 rounded-xl border p-4 text-left transition-colors",
        selected
          ? "border-primary bg-[var(--via-navy-06)]"
          : "border-border bg-card hover:border-primary/40 hover:bg-[var(--via-navy-06)]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium text-foreground">
          <PenLine className="size-4 text-primary" aria-hidden="true" />
          {title}
        </span>
        {selected ? <Check className="size-4 shrink-0 text-primary" aria-hidden="true" /> : null}
      </div>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      {highlights.length > 0 ? (
        <div className="mt-auto flex flex-wrap gap-1 pt-1">
          {highlights.map((item) => (
            <Badge key={item} variant="outline" className="font-normal text-muted-foreground">
              {item}
            </Badge>
          ))}
        </div>
      ) : null}
    </button>
  );
}
