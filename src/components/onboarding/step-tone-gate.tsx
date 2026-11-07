import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Loader2,
  PartyPopper,
  PenLine,
  ThumbsDown,
  ThumbsUp,
  Undo2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "@/lib/toast";

import { AuditChips } from "@/components/audit-chips";
import { JobTimeline } from "@/components/job-timeline";
import { WizardFooter } from "@/components/onboarding/wizard-shell";
import type { OnboardingStepProps } from "@/components/onboarding/types";
import { CarouselSlideRender } from "@/components/carousel-slide-render";
import { TweetCardRender } from "@/components/tweet-card-render";
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
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { CHANNEL_TYPE_LABELS } from "@/hooks/use-channels";
import { useContextItems } from "@/hooks/use-context-items";
import {
  getAdaptedFields,
  useContentPieces,
  useUpdatePieceStatus,
  type ContentPiece,
} from "@/hooks/use-content-pieces";
import {
  isTerminalStatus,
  useGenerationJobs,
  useGenerationJobsRealtime,
  type GenerationJob,
} from "@/hooks/use-generation-jobs";
import { CONTEXT_STEP, VOICE_STEP } from "@/hooks/use-onboarding";
import { isSampleJob, useToneGate } from "@/hooks/use-tone-gate";
import { normalizeBrandKitContent, useActiveVersion } from "@/hooks/use-versioned-brand";
import type { CarouselArt } from "@/lib/carousel-art";
import { useTweetCardBrand } from "@/hooks/use-tweet-card-brand";

// ---------------------------------------------------------------------------
// Passo 9 — gate de tom: 3 peças-amostra pelo pipeline completo. Aprovar as 3
// fecha o onboarding; reprovar devolve ao passo de voz com tudo preservado.
// ---------------------------------------------------------------------------

const SAMPLE_COUNT = 3;

export interface StepToneGateProps extends OnboardingStepProps {
  /** Fecha o onboarding (completed + minimum_viable) e leva ao app. */
  onComplete: () => Promise<void>;
}

export function StepToneGate({ advancing, onBack, goToStep, onComplete }: StepToneGateProps) {
  const toneGate = useToneGate();
  const jobsQuery = useGenerationJobs();
  const piecesQuery = useContentPieces();
  // Mesma fonte que a Biblioteca usa para desenhar carrossel: o vocabulário de
  // arte do brand kit ATIVO. É o que o cliente acabou de configurar nos passos
  // anteriores — julgar o tom sem ele seria julgar outra peça.
  const arteDaMarca = normalizeBrandKitContent(
    useActiveVersion("brand_kit").data?.content ?? null,
  ).art;
  const brand = useTweetCardBrand();
  const contextQuery = useContextItems();
  useGenerationJobsRealtime();

  // As amostras provam a voz com material do cliente: sem item processado o
  // retrieval vem vazio e o juiz reprova as 3 por falta de prova. A function
  // recusa com 409; aqui a gente evita a viagem e aponta o passo 3.
  const readyContextCount = (contextQuery.data ?? []).filter(
    (item) => item.status === "ready",
  ).length;
  const contextEmpty = contextQuery.isSuccess && readyContextCount === 0;

  const [jobIds, setJobIds] = useState<string[]>([]);
  const [completing, setCompleting] = useState(false);

  // Retomada: sem ids em memória (reload da página), reencontra a ÚLTIMA rodada
  // de amostras pelo marcador `timings.sample`. Rodadas anteriores (reprovadas
  // e regeradas) ficam de fora — misturar lotes falsearia a contagem do gate.
  const sampleJobs: GenerationJob[] = useMemo(() => {
    const jobs = jobsQuery.data ?? [];
    if (jobIds.length > 0) return jobs.filter((job) => jobIds.includes(job.id));
    const samples = jobs.filter(isSampleJob);
    if (samples.length === 0) return [];
    // `jobs` vem em created_at DESC: o lote é a janela de 30s a partir do mais novo.
    const newest = new Date(samples[0].created_at).getTime();
    return samples
      .filter((job) => newest - new Date(job.created_at).getTime() < 30_000)
      .slice(0, SAMPLE_COUNT);
  }, [jobsQuery.data, jobIds]);

  const sampleJobIdSet = useMemo(() => new Set(sampleJobs.map((job) => job.id)), [sampleJobs]);
  const samplePieces = useMemo(
    () => (piecesQuery.data ?? []).filter((piece) => sampleJobIdSet.has(piece.job_id)),
    [piecesQuery.data, sampleJobIdSet],
  );

  const approved = samplePieces.filter((piece) => piece.status === "approved");
  const rejected = samplePieces.filter((piece) => piece.status === "rejected");
  // Fecha o gate só com o lote inteiro aprovado (≥ 3 peças e nenhuma pendente
  // ou reprovada) — nunca somando aprovações de rodadas diferentes.
  const allApproved =
    samplePieces.length >= SAMPLE_COUNT && approved.length === samplePieces.length;
  const running = sampleJobs.some((job) => !isTerminalStatus(job.status));
  const started = sampleJobs.length > 0;

  // Celebração + fechamento acontecem por ação explícita (botão), nunca sozinhos.
  const handleComplete = async () => {
    if (!allApproved || completing) return;
    setCompleting(true);
    try {
      await onComplete();
    } catch (error) {
      toast.error("Não foi possível concluir o onboarding. Tente de novo.", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setCompleting(false);
    }
  };

  const runGate = () => {
    if (toneGate.isPending) return;
    toneGate.mutate(undefined, {
      onSuccess: (ids) => {
        setJobIds(ids);
        toast.success("Peças de teste em produção", {
          description: "Acompanhe abaixo. Leva alguns minutos.",
        });
      },
      onError: (error) => {
        toast.error("Não foi possível gerar as peças de teste", { description: error.message });
      },
    });
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Teste de tom: geramos 3 peças com tudo o que você configurou. Aprove se soarem como a marca;
        se não, você ajusta a voz no passo 4.
      </p>

      {!started ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PenLine className="size-4 text-primary" aria-hidden="true" />
              Gerar peças de teste
            </CardTitle>
            <CardDescription>
              Cada peça parte de um material seu em Contexto. Leva alguns minutos e você acompanha
              aqui.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {contextEmpty ? (
              <Alert>
                <Undo2 className="size-4" aria-hidden="true" />
                <AlertTitle>Falta material em Contexto</AlertTitle>
                <AlertDescription className="space-y-3">
                  <p>
                    Sem material processado, as peças saem sem números nem casos e seriam rejeitadas
                    por falta de prova, não por tom. Adicione ao menos um material (de preferência
                    um caso com números) e volte aqui.
                  </p>
                  <Button variant="outline" size="sm" onClick={() => goToStep(CONTEXT_STEP)}>
                    <Undo2 aria-hidden="true" />
                    Ir ao passo 3 — Contexto
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            <Button onClick={runGate} disabled={toneGate.isPending || contextEmpty}>
              {toneGate.isPending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <PenLine aria-hidden="true" />
              )}
              {toneGate.isPending ? "Iniciando…" : `Gerar ${SAMPLE_COUNT} peças de teste`}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-normal">
              {approved.length} de {SAMPLE_COUNT} aprovadas
            </Badge>
            {rejected.length > 0 ? (
              <Badge variant="outline" className="font-normal text-destructive">
                {rejected.length} rejeitada{rejected.length === 1 ? "" : "s"}
              </Badge>
            ) : null}
            {running ? (
              <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                gerando
              </Badge>
            ) : null}
          </div>
          {sampleJobs.map((job) => (
            <Card key={job.id}>
              <CardContent className="space-y-3 py-4">
                <p className="line-clamp-2 text-sm text-muted-foreground">{job.prompt}</p>
                <JobTimeline job={job} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {started && samplePieces.length === 0 && running ? (
        <div className="space-y-2">
          <Skeleton className="h-32 w-full" />
          <p className="text-xs text-muted-foreground">
            Cada peça aparece aqui assim que ficar pronta.
          </p>
        </div>
      ) : null}

      {samplePieces.length > 0 ? (
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-foreground">Peças de teste</h2>
          {samplePieces.map((piece) => (
            <SamplePieceCard key={piece.id} piece={piece} brand={brand} arteDaMarca={arteDaMarca} />
          ))}
        </div>
      ) : null}

      {rejected.length > 0 && !allApproved ? (
        <Alert>
          <Undo2 className="size-4" aria-hidden="true" />
          <AlertTitle>Tom rejeitado — ajuste a voz</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              Seus motivos ficam salvos. Volte ao passo 4, ajuste princípios de tom, vocabulário e
              exemplos, ative a nova versão e gere novas peças aqui.
            </p>
            <Button variant="outline" size="sm" onClick={() => goToStep(VOICE_STEP)}>
              <Undo2 aria-hidden="true" />
              Voltar ao passo 4 — Voz
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {allApproved ? (
        <Alert>
          <PartyPopper className="size-4" aria-hidden="true" />
          <AlertTitle>Tom aprovado — tudo pronto</AlertTitle>
          <AlertDescription>
            Daqui em diante, peça novas peças em Criar. Todas passam pelas mesmas conferências que
            você acabou de ver.
          </AlertDescription>
        </Alert>
      ) : null}

      <WizardFooter
        onBack={onBack}
        hint={
          allApproved
            ? null
            : started
              ? `Aprove as ${SAMPLE_COUNT} peças de teste para concluir.`
              : "Gere as peças de teste para concluir."
        }
      >
        {started && !running ? (
          <Button variant="outline" onClick={runGate} disabled={toneGate.isPending || contextEmpty}>
            {toneGate.isPending ? "Iniciando…" : "Gerar novas peças"}
          </Button>
        ) : null}
        <Button
          onClick={() => void handleComplete()}
          disabled={!allApproved || completing || advancing}
        >
          {completing || advancing ? "Concluindo…" : "Ir para o app"}
          <ArrowRight aria-hidden="true" />
        </Button>
      </WizardFooter>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview + veredito de uma amostra
// ---------------------------------------------------------------------------

function SamplePieceCard({
  piece,
  brand,
  arteDaMarca,
}: {
  piece: ContentPiece;
  brand: ReturnType<typeof useTweetCardBrand>;
  arteDaMarca: CarouselArt;
}) {
  const adapted = getAdaptedFields(piece);
  const updateStatus = useUpdatePieceStatus();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [notes, setNotes] = useState("");

  // A amostra tem que sair pelo MESMO renderizador da Biblioteca, senão o gate
  // julga um tom que a produção não vai entregar. As peças do gate nascem
  // `instagram_carousel` com slides: mostrá-las no tweet-card era avaliar a voz
  // numa arte que o cliente nunca veria — e sem o vocabulário de arte do brand
  // kit, que é justamente o que o onboarding acabou de configurar.
  const ehCarrossel = piece.channel_type === "instagram_carousel";
  const slides = adapted.slides ?? [];

  const cardText =
    adapted.card?.text ?? slides[0]?.text ?? adapted.frames?.[0]?.text ?? adapted.text ?? "";

  const decided = piece.status === "approved" || piece.status === "rejected";

  const approve = () => {
    if (updateStatus.isPending) return;
    updateStatus.mutate(
      { pieceId: piece.id, status: "approved", notes: "Tom aprovado no teste de tom." },
      {
        onSuccess: () => toast.success("Peça aprovada"),
        onError: (error) =>
          toast.error("Não foi possível aprovar. Tente de novo.", { description: error.message }),
      },
    );
  };

  const reject = () => {
    if (updateStatus.isPending) return;
    updateStatus.mutate(
      { pieceId: piece.id, status: "rejected", notes: notes.trim() || undefined },
      {
        onSuccess: () => {
          setRejectOpen(false);
          setNotes("");
          toast.success("Peça rejeitada", {
            description: "O motivo fica salvo para ajustar a voz e a avaliação.",
          });
        },
        onError: (error) =>
          toast.error("Não foi possível rejeitar. Tente de novo.", { description: error.message }),
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {CHANNEL_TYPE_LABELS[piece.channel_type] ?? piece.channel_type}
          {piece.status === "approved" ? (
            <Badge className="border-[0.5px] border-[var(--via-border-soft)] bg-[var(--via-navy-04)] font-medium text-[var(--via-text-primary)]">
              aprovada
            </Badge>
          ) : piece.status === "rejected" ? (
            <Badge variant="outline" className="font-normal text-destructive">
              rejeitada
            </Badge>
          ) : null}
        </CardTitle>
        <AuditChips audit={piece.audit} compact />
      </CardHeader>
      <CardContent className="space-y-4">
        {ehCarrossel && slides.length > 0 ? (
          // O DECK inteiro, não só a capa. Tom não se julga por um slide: o que
          // trai a voz costuma estar no miolo, onde o argumento se desenvolve —
          // e a capa é a peça mais trabalhada, a que menos revela. Cada slide
          // recebe seu índice real porque é ele que decide capa x miolo x fecho
          // no vocabulário de arte.
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {slides.length} slides — arraste para ver o conjunto.
            </p>
            <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
              {slides.map((slide, indice) => (
                <div key={indice} className="w-[210px] shrink-0 snap-start space-y-1.5">
                  <CarouselSlideRender
                    text={slide.text}
                    brand={brand}
                    aspect="4:5"
                    index={indice}
                    total={slides.length}
                    art={arteDaMarca}
                  />
                  <p className="text-xs text-muted-foreground">
                    {indice + 1} de {slides.length}
                    {indice === 0 ? " · capa" : indice === slides.length - 1 ? " · fecho" : ""}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : cardText ? (
          <div className="overflow-x-auto">
            <TweetCardRender text={cardText} brand={brand} aspect="4:5" />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            A prévia desta peça ainda não está pronta.
          </p>
        )}

        {adapted.caption ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Legenda</p>
            <p className="whitespace-pre-wrap text-sm text-foreground">{adapted.caption}</p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={piece.status === "approved" ? "secondary" : "default"}
            size="sm"
            onClick={approve}
            disabled={updateStatus.isPending || piece.status === "approved"}
          >
            <ThumbsUp aria-hidden="true" />
            Aprovar tom
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRejectOpen(true)}
            disabled={updateStatus.isPending}
          >
            <ThumbsDown aria-hidden="true" />
            Rejeitar
          </Button>
          <Link
            to="/biblioteca/$pieceId"
            params={{ pieceId: piece.id }}
            className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Ver na Biblioteca
          </Link>
          {decided ? <span className="text-xs text-muted-foreground">decisão salva</span> : null}
        </div>
      </CardContent>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rejeitar esta peça</DialogTitle>
            <DialogDescription>
              O motivo ajuda a ajustar a voz e a avaliação das próximas peças.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`reject-notes-${piece.id}`}>O que ficou errado? (opcional)</Label>
            <Textarea
              id={`reject-notes-${piece.id}`}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="min-h-24"
              placeholder="Ex.: soa consultoria genérica, sem opinião; o gancho não é meu."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={reject} disabled={updateStatus.isPending}>
              {updateStatus.isPending ? "Salvando…" : "Rejeitar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
