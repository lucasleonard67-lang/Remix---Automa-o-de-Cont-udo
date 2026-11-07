import { Loader2, MessagesSquare, PenLine, Wand2 } from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";

import {
  PersonaFormFields,
  isPersonaReady,
  sanitizePersonaContent,
} from "@/components/brand/persona-form";
import { WizardFooter } from "@/components/onboarding/wizard-shell";
import type { OnboardingStepProps } from "@/components/onboarding/types";
import { useWizardDirty } from "@/components/onboarding/use-wizard-dirty";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { CONTEXT_KIND_LABELS, useContextItems } from "@/hooks/use-context-items";
import { useSaveAndActivate } from "@/hooks/use-onboarding";
import {
  MAX_CORPUS_ITEMS,
  useExtractVoiceFromCorpus,
  useVoiceInterview,
  type InterviewTurn,
} from "@/hooks/use-voice-extraction";
import {
  normalizePersonaContent,
  useVersionedEditor,
  type PersonaContent,
} from "@/hooks/use-versioned-brand";

// ---------------------------------------------------------------------------
// Passo 4 — voz: dois caminhos para o rascunho das 9 seções (extract-voice),
// editor compartilhado com /marca/persona e ativação da v1 ao confirmar.
// ---------------------------------------------------------------------------

export function StepVoice({ advancing, onBack, onAdvance, onDirtyChange }: OnboardingStepProps) {
  const itemsQuery = useContextItems();
  const readyItems = (itemsQuery.data ?? []).filter((item) => item.status === "ready");

  const editor = useVersionedEditor<PersonaContent>(
    "brand_persona",
    normalizePersonaContent,
    sanitizePersonaContent,
  );
  const activate = useSaveAndActivate<PersonaContent>("brand_persona");
  const [confirming, setConfirming] = useState(false);
  useWizardDirty(editor.dirty, onDirtyChange);

  const ready = isPersonaReady(editor.content);
  const busy = advancing || confirming || activate.isPending;

  const loadDraft = (draft: PersonaContent) => {
    editor.setContent(normalizePersonaContent(draft));
    toast.success("Rascunho de voz carregado", {
      description:
        "Revise as 9 seções abaixo. Nada é salvo até você clicar em “Salvar rascunho” ou “Ativar e continuar”.",
    });
  };

  const handleConfirm = async () => {
    if (!ready || busy) return;
    setConfirming(true);
    try {
      await activate.run(sanitizePersonaContent(editor.content));
      toast.success("Voz ativada", { description: "As próximas peças já seguem esta voz." });
      await onAdvance();
    } catch (error) {
      toast.error("Não foi possível ativar a voz", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Defina como a marca fala — é o que mais pesa na qualidade das peças. Gere um rascunho a
        partir do seu material ou de uma entrevista, depois revise e ajuste à mão.
      </p>

      <Tabs defaultValue={readyItems.length > 0 ? "corpus" : "entrevista"}>
        <TabsList>
          <TabsTrigger value="corpus">A partir do meu material</TabsTrigger>
          <TabsTrigger value="entrevista">Entrevista guiada</TabsTrigger>
        </TabsList>

        <TabsContent value="corpus" className="mt-4">
          <CorpusExtractor
            loading={itemsQuery.isLoading}
            items={readyItems.map((item) => ({
              id: item.id,
              title: item.title,
              kind: CONTEXT_KIND_LABELS[item.kind] ?? item.kind,
            }))}
            onDraft={loadDraft}
          />
        </TabsContent>

        <TabsContent value="entrevista" className="mt-4">
          <VoiceInterview onDraft={loadDraft} />
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Voz da marca — 9 seções</CardTitle>
          <CardDescription>
            {editor.draft
              ? `Rascunho v${editor.draft.version} em edição.`
              : "Preencha à mão ou gere um rascunho acima."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {editor.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <PersonaFormFields content={editor.content} patch={editor.patch} />
          )}
        </CardContent>
      </Card>

      <WizardFooter
        onBack={onBack}
        hint={
          ready
            ? null
            : "Para ativar, preencha o nome (seção 1), 1 princípio de tom (seção 4) e 1 item do checklist (seção 8)."
        }
      >
        <Button
          variant="outline"
          onClick={editor.onSaveDraft}
          disabled={!editor.dirty || editor.saving || busy}
        >
          {editor.saving ? "Salvando…" : "Salvar rascunho"}
        </Button>
        <Button onClick={() => void handleConfirm()} disabled={!ready || busy}>
          {busy ? "Ativando…" : "Ativar e continuar"}
        </Button>
      </WizardFooter>
    </div>
  );
}

// ---------------------------------------------------------------------------
// (a) Extração assistida a partir do corpus
// ---------------------------------------------------------------------------

interface CorpusOption {
  id: string;
  title: string;
  kind: string;
}

function CorpusExtractor({
  loading,
  items,
  onDraft,
}: {
  loading: boolean;
  items: CorpusOption[];
  onDraft: (draft: PersonaContent) => void;
}) {
  const extract = useExtractVoiceFromCorpus();
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((item) => item !== id)
        : prev.length >= MAX_CORPUS_ITEMS
          ? prev
          : [...prev, id],
    );
  };

  const run = () => {
    if (selected.length === 0 || extract.isPending) return;
    extract.mutate(selected, {
      onSuccess: onDraft,
      onError: (error) => {
        toast.error("Não foi possível gerar o rascunho de voz", { description: error.message });
      },
    });
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <Alert>
        <PenLine className="size-4" aria-hidden="true" />
        <AlertTitle>Nenhum material pronto</AlertTitle>
        <AlertDescription>
          Clique em “Voltar” para adicionar material ou use a aba “Entrevista guiada”.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Marque os itens que mais soam como você (até {MAX_CORPUS_ITEMS}).
      </p>
      <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {items.map((item) => {
          const checked = selected.includes(item.id);
          return (
            <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
              <Checkbox
                id={`corpus-${item.id}`}
                checked={checked}
                onCheckedChange={() => toggle(item.id)}
                disabled={!checked && selected.length >= MAX_CORPUS_ITEMS}
              />
              <Label
                htmlFor={`corpus-${item.id}`}
                className="min-w-0 flex-1 cursor-pointer truncate text-sm font-normal"
              >
                {item.title}
              </Label>
              <Badge variant="secondary" className="font-normal">
                {item.kind}
              </Badge>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={run} disabled={selected.length === 0 || extract.isPending}>
          {extract.isPending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Wand2 aria-hidden="true" />
          )}
          {extract.isPending ? "Gerando rascunho…" : "Gerar rascunho de voz"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {selected.length} selecionado{selected.length === 1 ? "" : "s"}
          {extract.isPending ? " · leva alguns segundos" : ""}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// (b) Entrevista guiada (sem corpus) — a função é stateless: o histórico
// completo vai junto a cada chamada.
// ---------------------------------------------------------------------------

function VoiceInterview({ onDraft }: { onDraft: (draft: PersonaContent) => void }) {
  const interview = useVoiceInterview();
  const [turns, setTurns] = useState<InterviewTurn[]>([]);
  const [question, setQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [finished, setFinished] = useState(false);

  const send = (nextTurns: InterviewTurn[]) => {
    interview.mutate(nextTurns, {
      onSuccess: (result) => {
        setTurns(nextTurns);
        if (result.kind === "question") {
          setQuestion(result.question);
          setAnswer("");
          return;
        }
        setQuestion(null);
        setFinished(true);
        onDraft(result.draft);
      },
      onError: (error) => {
        toast.error("Não foi possível continuar a entrevista", { description: error.message });
      },
    });
  };

  const start = () => send([]);

  const submitAnswer = () => {
    if (!question || !answer.trim() || interview.isPending) return;
    send([...turns, { question, answer: answer.trim() }]);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Sem material pronto? Responda algumas perguntas e a IA monta o rascunho a partir das suas
        respostas. Quanto mais concreto, melhor.
      </p>

      {turns.length > 0 ? (
        <ol className="space-y-3 rounded-lg border border-border p-4">
          {turns.map((turn, index) => (
            <li key={index} className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{turn.question}</p>
              <p className="whitespace-pre-wrap text-sm text-foreground">{turn.answer}</p>
            </li>
          ))}
        </ol>
      ) : null}

      {finished ? (
        <Alert>
          <PenLine className="size-4" aria-hidden="true" />
          <AlertTitle>Entrevista concluída</AlertTitle>
          <AlertDescription>
            O rascunho das 9 seções está no formulário abaixo. Revise antes de ativar.
          </AlertDescription>
        </Alert>
      ) : question ? (
        <div className="space-y-2">
          <Label htmlFor="interview-answer" className="text-sm font-medium text-foreground">
            {question}
          </Label>
          <Textarea
            id="interview-answer"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            className="min-h-28"
            placeholder="Sua resposta"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={submitAnswer} disabled={!answer.trim() || interview.isPending}>
              {interview.isPending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <MessagesSquare aria-hidden="true" />
              )}
              {interview.isPending ? "Gerando pergunta…" : "Enviar resposta"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {turns.length} resposta{turns.length === 1 ? "" : "s"} até aqui
            </span>
          </div>
        </div>
      ) : (
        <Button onClick={start} disabled={interview.isPending}>
          {interview.isPending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <MessagesSquare aria-hidden="true" />
          )}
          {interview.isPending ? "Preparando…" : "Começar entrevista"}
        </Button>
      )}
    </div>
  );
}
