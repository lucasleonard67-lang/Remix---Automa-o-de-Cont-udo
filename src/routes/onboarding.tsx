import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { toast } from "@/lib/toast";

import { DriveGateHost } from "@/components/google-drive-integration";
import { StepAiIntegrations } from "@/components/onboarding/step-ai";
import { StepBrandKit } from "@/components/onboarding/step-brand-kit";
import { StepChannels } from "@/components/onboarding/step-channels";
import { StepContext } from "@/components/onboarding/step-context";
import { StepGuardrails } from "@/components/onboarding/step-guardrails";
import { StepStrategy } from "@/components/onboarding/step-strategy";
import { StepToneGate } from "@/components/onboarding/step-tone-gate";
import { StepVoice } from "@/components/onboarding/step-voice";
import { StepWelcome } from "@/components/onboarding/step-welcome";
import type { OnboardingStepProps } from "@/components/onboarding/types";
import { WizardShell } from "@/components/onboarding/wizard-shell";
import { SetupFlow } from "@/components/setup/setup-flow";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  FIRST_STEP,
  LAST_STEP,
  ONBOARDING_STEPS,
  clampSetupStep,
  fetchMinimumViable,
  fetchOnboardingProgress,
  useOnboardingProgress,
  useUpdateOnboarding,
  type OnboardingPatch,
  type OnboardingProgress,
} from "@/hooks/use-onboarding";
import { useBrandAutopilotState } from "@/hooks/use-brand-autopilot";
import { fetchIsAdmin, requireSession } from "@/lib/auth";

// ---------------------------------------------------------------------------
// /onboarding — dois caminhos com layout próprio (sem sidebar):
// - fluxo único (padrão): o modal `SetupFlow` por cima de um fundo simples —
//   site + @ → leitura automática em segundo plano → redes → vídeo e voz →
//   mercado → revisão da marca → primeira peça (estado em
//   app_settings.onboarding.setup_step + app_settings.brand_autopilot);
// - manual (?modo=manual, ou quando o wizard já tem passos concluídos): os 9
//   passos de sempre, retomáveis pelo `current_step` gravado.
// ?preview=1 abre o fluxo em modo visual (nada é gravado; sem redirect de
// onboarding concluído) — serve para conferir a tela numa instância pronta.
// Guard: sessão + admin; onboarding concluído redireciona para o app.
// ---------------------------------------------------------------------------

interface OnboardingSearch {
  modo?: "manual";
  preview?: boolean;
  /** Só com `preview`: passo do fluxo em que o modal abre (1–6). */
  passo?: number;
}

export const Route = createFileRoute("/onboarding")({
  validateSearch: (search: Record<string, unknown>): OnboardingSearch => ({
    ...(search.modo === "manual" ? { modo: "manual" as const } : {}),
    ...(search.preview === true || search.preview === 1 || search.preview === "1"
      ? { preview: true }
      : {}),
    ...(typeof search.passo === "number" && search.passo >= 1 && search.passo <= 6
      ? { passo: search.passo }
      : {}),
  }),
  beforeLoad: async ({ location, search }) => {
    await requireSession(location.href);
    const isAdmin = await fetchIsAdmin();
    if (!isAdmin) {
      // Usuário comum não configura a instância — o app segue normal para ele.
      throw redirect({ to: "/" });
    }
    if (search.preview) return;
    const onboarding = await fetchOnboardingProgress();
    if (onboarding.completed) {
      throw redirect({ to: "/" });
    }
  },
  component: OnboardingRoute,
});

/** Fora do layout logado: o passo de conectar o Drive precisa estar aqui também. */
function OnboardingRoute() {
  return (
    <>
      <OnboardingPage />
      <DriveGateHost />
    </>
  );
}

function OnboardingPage() {
  const navigate = useNavigate();
  const { modo, preview, passo } = Route.useSearch();
  const { progress, isLoading } = useOnboardingProgress();
  const autopilotQuery = useBrandAutopilotState();

  // Fluxo único é o padrão. O wizard aparece quando pedido (?modo=manual) ou
  // quando a instância já avançou nele e nenhuma leitura automática rodou.
  const autopilotState = autopilotQuery.data ?? null;
  const autopilotActive = autopilotState !== null && autopilotState.status !== "idle";
  const wizardStarted = progress.completed_steps.length > 0 || progress.current_step > FIRST_STEP;
  const useWizard = !preview && (modo === "manual" || (!autopilotActive && wizardStarted));

  if (isLoading || autopilotQuery.isLoading) {
    return <OnboardingSkeleton />;
  }

  if (useWizard) {
    return <OnboardingWizard progress={progress} />;
  }

  const canLeave = preview || progress.completed || progress.minimum_viable;

  return (
    <SetupBackdrop brandName={autopilotState?.review?.name ?? progress.brand_name}>
      <SetupFlow
        open
        preview={preview}
        initialStep={preview && passo ? clampSetupStep(passo) : undefined}
        dismissible={canLeave}
        onOpenChange={(open) => {
          if (!open) void navigate({ to: "/" });
        }}
      />
    </SetupBackdrop>
  );
}

/** Fundo do fluxo único: logo e uma frase; o modal faz o resto. */
function SetupBackdrop({
  brandName,
  children,
}: {
  brandName: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <img src="/brand/subido-ai-positivo.svg" alt="Subido AI" className="h-7 w-auto dark:hidden" />
      <img
        src="/brand/subido-ai-negativo.svg"
        alt="Subido AI"
        className="hidden h-7 w-auto dark:block"
      />
      <p className="max-w-sm text-sm text-[var(--via-text-muted)]">
        {brandName
          ? `Configurando ${brandName}: a marca, as redes e a primeira peça.`
          : "Sete passos: a marca, as redes, a primeira peça e a publicação."}
      </p>
      {children}
    </div>
  );
}

function OnboardingSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-6 py-16">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function OnboardingWizard({ progress }: { progress: OnboardingProgress }) {
  const navigate = useNavigate();
  const updateOnboarding = useUpdateOnboarding();

  // Passo em tela: inicia no current_step gravado e depois é controle local.
  const [step, setStep] = useState<number>(progress.current_step);

  // Alterações não salvas do passo corrente (passos 4-7) + confirmação de saída.
  const [dirty, setDirty] = useState(false);
  const [pendingStep, setPendingStep] = useState<number | null>(null);
  const onDirtyChange = useCallback((next: boolean) => setDirty(next), []);

  const currentStep = step;

  /**
   * Fecha o passo corrente: marca concluído, recalcula o mínimo viável a partir
   * do estado do banco e avança `current_step` — tudo numa escrita só.
   * `fetchMinimumViable() === null` (falha de leitura) omite o campo: o
   * read-modify-write preserva o que já estava gravado, sem rebaixar ninguém.
   */
  const advance = async (patch: OnboardingPatch = {}) => {
    const minimumViable = await fetchMinimumViable();
    const next = Math.min(currentStep + 1, LAST_STEP);
    try {
      await updateOnboarding.mutateAsync({
        ...patch,
        completeStep: currentStep,
        current_step: next,
        ...(minimumViable === null ? {} : { minimum_viable: minimumViable }),
      });
      setDirty(false);
      setStep(next);
    } catch (error) {
      toast.error("Não foi possível salvar o progresso", {
        description: error instanceof Error ? error.message : undefined,
      });
      throw error;
    }
  };

  /** Passo 9 aprovado: fecha o onboarding e leva ao app. */
  const complete = async () => {
    await updateOnboarding.mutateAsync({
      completeStep: LAST_STEP,
      completed_steps: ONBOARDING_STEPS.map((item) => item.step),
      current_step: LAST_STEP,
      minimum_viable: true,
      completed: true,
    });
    toast.success("Onboarding concluído", {
      description: "Para gerar a primeira peça, vá em Criar.",
    });
    await navigate({ to: "/" });
  };

  /** Troca de passo de fato (o corpo do passo desmonta e o form local se perde). */
  const commitStep = (clamped: number) => {
    setDirty(false);
    setStep(clamped);
    // Retomar de outra sessão deve cair no passo em que o usuário parou.
    if (clamped !== progress.current_step) {
      updateOnboarding.mutate({ current_step: clamped });
    }
  };

  const goToStep = (target: number) => {
    const clamped = Math.min(Math.max(target, FIRST_STEP), LAST_STEP);
    if (clamped === currentStep) return;
    if (dirty) {
      setPendingStep(clamped);
      return;
    }
    commitStep(clamped);
  };

  const stepProps: OnboardingStepProps = {
    progress,
    advancing: updateOnboarding.isPending,
    onBack: currentStep > FIRST_STEP ? () => goToStep(currentStep - 1) : null,
    onAdvance: advance,
    goToStep,
    onDirtyChange,
  };

  return (
    <>
      <WizardShell
        progress={progress}
        currentStep={currentStep}
        onSelectStep={goToStep}
        canExit={progress.minimum_viable && !dirty}
        onExit={() => void navigate({ to: "/" })}
      >
        <StepBody step={currentStep} stepProps={stepProps} onComplete={complete} />
      </WizardShell>

      <AlertDialog
        open={pendingStep !== null}
        onOpenChange={(open) => {
          if (!open) setPendingStep(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sair do passo sem salvar?</AlertDialogTitle>
            <AlertDialogDescription>
              Suas alterações ainda não foram salvas e serão perdidas. Para mantê-las, clique em
              “Continuar editando” e depois em “Salvar rascunho”.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = pendingStep;
                setPendingStep(null);
                if (target !== null) commitStep(target);
              }}
            >
              Descartar e sair do passo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function StepBody({
  step,
  stepProps,
  onComplete,
}: {
  step: number;
  stepProps: OnboardingStepProps;
  onComplete: () => Promise<void>;
}) {
  switch (step) {
    case 1:
      return <StepWelcome {...stepProps} />;
    case 2:
      return <StepAiIntegrations {...stepProps} />;
    case 3:
      return <StepContext {...stepProps} />;
    case 4:
      return <StepVoice {...stepProps} />;
    case 5:
      return <StepStrategy {...stepProps} />;
    case 6:
      return <StepGuardrails {...stepProps} />;
    case 7:
      return <StepBrandKit {...stepProps} />;
    case 8:
      return <StepChannels {...stepProps} />;
    default:
      return <StepToneGate {...stepProps} onComplete={onComplete} />;
  }
}
