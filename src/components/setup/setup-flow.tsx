import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { BrandInline } from "@/components/brand-inline";
import {
  EMPTY_BRAND_FORM,
  brandFormMissing,
  brandFormToInput,
  hostOf,
  type BrandFormValues,
} from "@/components/setup/brand-form";
import { SETUP_FLOW_STEPS } from "@/components/setup/setup-steps";
import { SetupPanel } from "@/components/setup/setup-panel";
import { SetupStepper } from "@/components/setup/setup-stepper";
import { StepBrand } from "@/components/setup/step-brand";
import { StepBrandReady } from "@/components/setup/step-brand-ready";
import { StepCreate, type VideoMode } from "@/components/setup/step-create";
import { JobCard } from "@/components/video/job-card";
import type { RemakeOptionId } from "@/components/video/remake-flow";
import { StepMarket } from "@/components/setup/step-market";
import { StepMedia } from "@/components/setup/step-media";
import { StepNetworks } from "@/components/setup/step-networks";
import { StepPublish } from "@/components/setup/step-publish";
import { useMediaReadiness, useNetworksReadiness } from "@/components/setup/use-setup-readiness";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AUTOPILOT_STEP_IDS,
  splitCaptions,
  useBrandAutopilot,
  useBrandAutopilotRunner,
  type AutopilotState,
} from "@/hooks/use-brand-autopilot";
import type { ChannelType } from "@/hooks/use-channels";
import { useShake } from "@/hooks/use-feedback";
import {
  useCreateGenerationJob,
  useGenerationJob,
  useJobPieces,
} from "@/hooks/use-generation-jobs";
import { useAvatars } from "@/hooks/use-avatars";
import { useCreateDirectorJob, useDirectorJob } from "@/hooks/use-director-jobs";
import { useCompetitors } from "@/hooks/use-market";
import { useVideoBrief, type VideoBrief } from "@/hooks/use-video-brief";
import { useEngineStatus } from "@/hooks/use-video-models";
import { normalizeBrandKitContent, useActiveVersion } from "@/hooks/use-versioned-brand";
import { artInk } from "@/lib/brand-ink";
import {
  LAST_STEP,
  ONBOARDING_STEPS,
  SETUP_FLOW_LAST_STEP,
  clampSetupStep,
  useOnboardingProgress,
  useUpdateOnboarding,
  type SetupFlowStep,
} from "@/hooks/use-onboarding";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { humanizeError } from "@/lib/humanize-error";
import { openIntegration } from "@/lib/integration-modal";

// ---------------------------------------------------------------------------
// Fluxo ÚNICO de configuração, em um modal com sete passos encadeados:
//   1 Sua marca · 2 Redes · 3 Vídeo e voz · 4 Mercado · 5 Marca pronta ·
//   6 Criar · 7 Publicar
// A leitura da marca (brand-autopilot) começa no passo 1 e roda em segundo
// plano durante 2–4; o passo 5 mostra o progresso e a revisão. O passo 6 cria
// a peça AQUI DENTRO (formato + tema → progresso) e, pronta, avança sozinho
// para o 7, que aprova e publica. Ninguém sai do modal até publicar. O passo
// em que o usuário parou fica em app_settings.onboarding.setup_step, então
// fechar e voltar (pelo Dashboard → Primeiros passos) retoma do mesmo ponto;
// a geração em andamento fica em localStorage e é retomada ao reabrir.
// `preview`: só visual — nada é gravado nem disparado.
// ---------------------------------------------------------------------------

const ENTER =
  "animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-[220ms] ease-[var(--via-ease-out)]";

/** Geração disparada pelo passo 6 — sobrevive a fechar e reabrir o modal. */
const JOB_STORAGE_KEY = "ce-setup-job";
/** Vídeo disparado pelo passo 6 (director_jobs.id), idem. */
const VIDEO_STORAGE_KEY = "ce-setup-video-job";
const VIDEO_DONE = new Set(["done", "failed", "canceled", "cancelled"]);
const JOB_POLL_MS = 4000;
const TERMINAL_JOB = new Set(["done", "failed", "cancelled"]);

/** `jobId|started_at`: a geração guardada só vale para a leitura da marca em que nasceu. */
function readStoredJob(): { id: string; since: string | null } | null {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(JOB_STORAGE_KEY) : null;
    if (!raw) return null;
    const [id, since] = raw.split("|");
    return id ? { id, since: since || null } : null;
  } catch {
    return null;
  }
}
function storeJob(id: string | null, since: string | null = null) {
  try {
    if (id) window.localStorage.setItem(JOB_STORAGE_KEY, since ? `${id}|${since}` : id);
    else window.localStorage.removeItem(JOB_STORAGE_KEY);
  } catch {
    // sem storage (janela privada): o modal só não retoma depois de fechar
  }
}

export interface SetupFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Passo para abrir (Dashboard manda o pendente). Sem ele, retoma o gravado. */
  initialStep?: SetupFlowStep;
  /** Modo visual: não grava progresso, não dispara leitura. */
  preview?: boolean;
  /** Pode fechar com X/Esc. Em /onboarding só depois do mínimo viável. */
  dismissible?: boolean;
}

export function SetupFlow(props: SetupFlowProps) {
  // Remonta a cada abertura: o passo inicial é recalculado do estado gravado.
  return props.open ? <SetupFlowDialog {...props} /> : null;
}

function SetupFlowDialog({
  onOpenChange,
  initialStep,
  preview = false,
  dismissible = true,
}: SetupFlowProps) {
  const { progress } = useOnboardingProgress();
  const updateOnboarding = useUpdateOnboarding();

  const autopilot = useBrandAutopilot();
  // Em preview o runner não anda (estado nulo → nunca "running").
  const runner = useBrandAutopilotRunner(preview ? { ...autopilot, state: null } : autopilot);
  const { state, start } = autopilot;
  const startShake = useShake(start.error);
  // leitura que falhou volta para o passo 1: o usuário corrige o site e lê de novo
  const brandFailed = state?.status === "failed";
  const failedStep = brandFailed
    ? state?.steps.find((item) => item.status === "failed")
    : undefined;
  const autopilotActive = state !== null && state.status !== "idle" && !brandFailed;

  const networks = useNetworksReadiness();
  const media = useMediaReadiness();
  const competitors = useCompetitors();

  // A marca lida é o que destrava o resto: sem leitura, o fluxo começa no 1;
  // com leitura em andamento, a Primeira peça espera a Marca pronta.
  const brandDone = state?.status === "done";
  const gate = (target: SetupFlowStep): SetupFlowStep =>
    preview ? target : !autopilotActive ? 1 : !brandDone && target > 5 ? 5 : target;
  const [step, setStep] = useState<SetupFlowStep>(() => {
    if (initialStep) return gate(initialStep);
    if (progress.setup_step) return gate(clampSetupStep(progress.setup_step));
    if (autopilotActive) return state?.status === "running" ? 2 : 5;
    return 1;
  });
  // A leitura (re)começou com o modal aberto num passo adiantado: volta para
  // "Marca pronta" — criar agora sairia com a voz antiga.
  const readingStatus = state?.status;
  useEffect(() => {
    if (preview) return;
    if (readingStatus === "running" && step > 5) setStep(5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingStatus]);
  const [reached, setReached] = useState<SetupFlowStep>(() =>
    preview ? SETUP_FLOW_LAST_STEP : clampSetupStep(Math.max(step, progress.setup_step ?? 1)),
  );
  const [brandForm, setBrandForm] = useState<BrandFormValues>(() =>
    brandFailed && state ? formFromInput(state.input) : EMPTY_BRAND_FORM,
  );
  // Erro de campo fica no campo, não no rodapé. Mexer no formulário limpa o
  // erro da tentativa anterior: ele só volta se a próxima falhar.
  const [fieldErrors, setFieldErrors] = useState<{ site?: string; instagram?: string }>({});
  const changeBrandForm = (next: BrandFormValues) => {
    setBrandForm(next);
    setFieldErrors({});
    if (start.error) start.reset();
  };
  const startError = start.error;
  useEffect(() => {
    if (!startError) return;
    const msg = startError.message;
    const fala = { site: /\bsite\b/i.test(msg), instagram: /instagram|@/i.test(msg) };
    if (fala.site && !fala.instagram) {
      if (brandForm.noSite) {
        // servidor ainda na versão que exige site: reabre o campo e diz o porquê
        setBrandForm((form) => ({ ...form, noSite: false }));
        setFieldErrors({
          site: "Este servidor ainda não lê a marca só pelo Instagram. Informe o site por enquanto.",
        });
      } else {
        setFieldErrors({ site: humanizeError(msg) });
      }
    } else if (fala.instagram && !fala.site) {
      setFieldErrors({ instagram: humanizeError(msg) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startError]);
  const hasFieldError = Boolean(fieldErrors.site || fieldErrors.instagram);

  // "Alterar" no resumo do passo 1: reabre o formulário preenchido para ler de novo
  const [editingBrand, setEditingBrand] = useState(false);
  const editBrand = () => {
    if (state) setBrandForm(formFromInput(state.input));
    setEditingBrand(true);
  };
  const [brief, setBrief] = useState("");
  const [formats, setFormats] = useState<ReadonlySet<ChannelType>>(() => new Set());
  const toggleFormat = (type: ChannelType) =>
    setFormats((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  // Geração do passo 6: criada aqui ou retomada do storage ao reabrir.
  const [jobId, setJobId] = useState<string | null>(() => {
    if (preview) return null;
    const stored = readStoredJob();
    // geração de outra leitura da marca (ou anterior à atual) não é retomada
    if (stored?.since && state?.started_at && stored.since !== state.started_at) return null;
    return stored?.id ?? null;
  });
  const createJob = useCreateGenerationJob();
  const jobQuery = useGenerationJob(jobId ?? undefined, { refetchInterval: JOB_POLL_MS });
  const job = jobQuery.data ?? null;
  const piecesQuery = useJobPieces(jobId ?? undefined, {
    enabled: job?.status === "awaiting_review" || job?.status === "done",
  });
  const createdPieces = piecesQuery.data ?? [];
  const jobTerminal = job ? TERMINAL_JOB.has(job.status) : false;
  // terminou (pronta, em revisão, parou ou cancelada): o passo 6 volta a ser escolha
  const jobFinished = Boolean(job) && (jobTerminal || job?.status === "awaiting_review");
  // geração guardada que já não existe (apagada) → volta ao formulário
  useEffect(() => {
    if (jobId && jobQuery.isSuccess && jobQuery.data === null) {
      storeJob(null);
      setJobId(null);
    }
  }, [jobId, jobQuery.isSuccess, jobQuery.data]);
  const restartCreate = () => {
    storeJob(null);
    setJobId(null);
  };

  // ── Vídeo no passo 6: briefing pré-gerado → produção acompanhada aqui ──
  const [videoMode, setVideoMode] = useState<VideoMode>("none");
  const [videoBrief, setVideoBrief] = useState<VideoBrief | null>(null);
  const [remakeOptions, setRemakeOptions] = useState<RemakeOptionId[]>([]);
  const [videoJobId, setVideoJobId] = useState<string | null>(() => {
    if (preview) return null;
    try {
      return window.localStorage.getItem(VIDEO_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const storeVideoJob = (id: string | null) => {
    try {
      if (id) window.localStorage.setItem(VIDEO_STORAGE_KEY, id);
      else window.localStorage.removeItem(VIDEO_STORAGE_KEY);
    } catch {
      // sem storage: só não retoma depois de fechar
    }
  };
  const briefVideo = useVideoBrief();
  const createVideo = useCreateDirectorJob();
  const videoJobQuery = useDirectorJob(videoJobId ?? undefined);
  const videoJob = videoJobQuery.data ?? null;
  const engineStatus = useEngineStatus();
  const presenters = useAvatars();
  const brandKitForVideo = normalizeBrandKitContent(
    useActiveVersion("brand_kit").data?.content ?? null,
  );
  useEffect(() => {
    // vídeo retomado do storage entra no modo certo
    if (videoJobId && videoMode === "none") setVideoMode("presenter");
    // vídeo apagado → volta à escolha
    if (videoJobId && videoJobQuery.isSuccess && videoJobQuery.data === null) {
      storeVideoJob(null);
      setVideoJobId(null);
      setVideoMode("none");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoJobId, videoJobQuery.isSuccess, videoJobQuery.data]);
  const changeVideoMode = (mode: VideoMode) => {
    setVideoMode(mode);
    if (mode !== "none") setFormats(new Set());
    if (mode !== "presenter") setVideoBrief(null);
    if (mode === "none" || mode === "hub") setRemakeOptions([]);
  };
  /** 1º clique: o briefing nasce do tema; 2º: o vídeo entra na fila. */
  const montarBriefing = () => {
    const theme = brief.trim();
    if (!theme || briefVideo.isPending) return;
    briefVideo.mutate(theme, {
      onSuccess: (result) => setVideoBrief(result),
      onError: (error) =>
        toast.retry("Não foi possível montar o briefing", {
          description: humanizeError(error.message),
          onRetry: montarBriefing,
        }),
    });
  };
  const gerarVideo = () => {
    if (!videoBrief || createVideo.isPending || videoBlocked) return;
    if (!videoBrief.smp.trim() || !videoBrief.cta.trim()) {
      toast.error("Falta o que o vídeo defende ou a fala final.");
      return;
    }
    // motor padrão: Higgsfield. O servidor exige Higgsfield para quadros e
    // montagem mesmo com cenas no Replicate, então não troca por status —
    // desconectado ("off") o botão nem habilita (videoBlocked).
    const engine = "higgsfield";
    // Apresentador: só um com personagem JÁ pronto no Higgsfield (status ready)
    // ou um sem foto descrito por texto. Um com foto e personagem ainda não
    // preparado faria o job esperar até 30 min em "Gerando quadros".
    const list = presenters.data ?? [];
    const presenter =
      list.find((a) => a.provider_refs?.higgsfield?.status === "ready") ??
      list.find(
        (a) => !a.reference_image_path && !a.identity_pack_paths?.length && a.appearance_prompt,
      ) ??
      null;
    createVideo.mutate(
      {
        brief: {
          objetivo: videoBrief.objetivo,
          publico: videoBrief.publico,
          smp: videoBrief.smp,
          numero_heroi: videoBrief.numero_heroi,
          tom: videoBrief.tom,
          cta: videoBrief.cta,
          duracao_alvo_s: 24,
          formato: "reels_conversion",
          identity_id: presenter?.id ?? null,
          mandatorios: ["sem logo no plano 1", "sem texto legível em cena"],
        },
        config: {
          max_shots: 5,
          budget_credits: 320,
          // no fluxo, a produção segue até o fim sem parar para aprovação
          auto_approve_keyframes: true,
          auto_approve_audio: true,
          skip_video: false,
          engine,
          model_id: null,
          ab_model_id: null,
          captions: true,
          captions_style: "caps",
          captions_position: "bottom",
          captions_accent: artInk(brandKitForVideo.palette).accent,
        },
      },
      {
        onSuccess: ({ id }) => {
          storeVideoJob(id);
          setVideoJobId(id);
          toast.success("Vídeo na fila", {
            description: "Acompanhe aqui. Pode fechar e voltar — a produção continua.",
          });
        },
        onError: (error) =>
          toast.retry("Não foi possível começar o vídeo", {
            description: humanizeError(error.message),
            onRetry: gerarVideo,
          }),
      },
    );
  };
  const videoFinished = Boolean(videoJob) && VIDEO_DONE.has(videoJob?.status ?? "");
  // Quadros e montagem são do Higgsfield: sem ele conectado, vídeo não nasce.
  // Só "off" bloqueia: conferindo ou status desconhecido deixam gerar — o
  // servidor responde se faltar.
  const videoBlocked =
    engineStatus.higgsfield === "off" ? "Vídeo precisa do Higgsfield conectado." : null;
  // vídeo pronto → Publicar, uma vez
  const videoAdvancedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!videoJobId || step !== 6 || videoJob?.status !== "done") return;
    if (videoAdvancedFor.current === videoJobId) return;
    videoAdvancedFor.current = videoJobId;
    goTo(7);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoJobId, step, videoJob?.status]);
  const [finishing, setFinishing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const saveStep = (next: SetupFlowStep) =>
    updateOnboarding.mutate(
      { setup_step: next },
      {
        onError: () =>
          toast.retry("Não salvamos em que passo você está", {
            description: "Se fechar agora, a configuração volta de um passo anterior.",
            onRetry: () => saveStep(next),
          }),
      },
    );
  const goTo = (target: SetupFlowStep) => {
    const next = gate(target);
    setStep(next);
    if (next > reached) setReached(next);
    if (!preview && next !== progress.setup_step) {
      // Só o ponteiro do fluxo: current_step/completed_steps são do wizard de 9 passos.
      saveStep(next);
    }
  };
  const advance = () => goTo(clampSetupStep(step + 1));
  const back = () => goTo(clampSetupStep(step - 1));

  const readBrand = () => {
    if (preview || (autopilotActive && !editingBrand)) {
      advance();
      return;
    }
    start.mutate(brandFormToInput(brandForm), {
      onSuccess: () => {
        setEditingBrand(false);
        goTo(2);
      },
    });
  };

  /** Passo 7 fechado: onboarding concluído (como o autopilot já grava); fica no painel. */
  const finish = async () => {
    if (!preview) {
      setFinishing(true);
      try {
        await updateOnboarding.mutateAsync({
          completed: true,
          minimum_viable: true,
          current_step: LAST_STEP,
          completed_steps: ONBOARDING_STEPS.map((item) => item.step),
          setup_step: SETUP_FLOW_LAST_STEP,
        });
      } catch (error) {
        setFinishing(false);
        toast.error("Não foi possível concluir a configuração", {
          description: error instanceof Error ? error.message : undefined,
        });
        return;
      }
    }
    storeJob(null);
    onOpenChange(false);
    if (!preview)
      toast.success("Configuração concluída", { description: "Sua marca está pronta para criar." });
  };

  /** Passo 6: dispara a geração e fica aqui vendo o progresso. */
  const createNow = () => {
    if (preview) {
      advance();
      return;
    }
    const prompt = brief.trim();
    if (!prompt || createJob.isPending) return;
    createJob.mutate(
      // sempre com formato: sem ele o motor gera uma peça por canal ligado
      { prompt, channel_types: formats.size > 0 ? [...formats] : ["instagram_carousel"] },
      {
        onSuccess: ({ job_id }) => {
          storeJob(job_id, state?.started_at ?? null);
          setJobId(job_id);
        },
        onError: (error) => {
          toast.error("Não foi possível começar a criar", {
            description: humanizeError(error.message),
          });
        },
      },
    );
  };

  // Peça pronta → Publicar, sozinho, uma vez por geração.
  const advancedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!jobId || step !== 6 || createdPieces.length === 0) return;
    if (advancedFor.current === jobId) return;
    advancedFor.current = jobId;
    goTo(7);
    // goTo muda a cada render; o guard por jobId já evita repetição
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, step, createdPieces.length]);

  const handleOpenChange = (next: boolean) => {
    if (!next && !dismissible) return;
    onOpenChange(next);
  };

  // ── Rodapé por passo: UMA ação principal + o que falta em uma linha ──────
  let primary: ReactNode = null;
  let hint: ReactNode = null;
  let secondary: ReactNode = null;

  switch (step) {
    case 1: {
      const reading = autopilotActive && !editingBrand;
      // sem site e sem Zernio, a leitura só tem as legendas coladas: avisa
      // antes do clique em vez de deixar o servidor recusar
      const needsCaptions =
        !reading &&
        brandForm.noSite &&
        !networks.zernioKey &&
        splitCaptions(brandForm.captionsRaw).length === 0;
      const missing = reading
        ? null
        : (brandFormMissing(brandForm) ??
          (needsCaptions ? "Cole de 1 a 5 legendas para a leitura ter material." : null));
      primary = (
        <Button onClick={readBrand} disabled={Boolean(missing) || start.isPending}>
          {start.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {reading
            ? "Continuar"
            : start.isPending
              ? "Lendo…"
              : editingBrand
                ? "Ler de novo"
                : "Ler minha marca"}
          {reading ? <ArrowRight aria-hidden="true" /> : null}
        </Button>
      );
      secondary = editingBrand ? (
        <SkipLink onClick={() => setEditingBrand(false)}>Cancelar</SkipLink>
      ) : null;
      // com erro no campo, o rodapé cala: "Falta o site" embaixo de "Informe o
      // site" é a mesma coisa dita duas vezes
      hint = hasFieldError
        ? null
        : start.error
          ? humanizeError(start.error.message)
          : brandFailed && failedStep?.error
            ? `A leitura parou. ${humanizeError(failedStep.error)}`
            : (missing ??
              (reading
                ? null
                : editingBrand
                  ? "Ler de novo substitui a leitura atual da marca."
                  : "Leva 1 a 3 minutos e roda enquanto você segue."));
      break;
    }
    case 2: {
      const ready = networks.zernioKey && networks.instagram;
      primary = (
        <Button onClick={advance} disabled={!ready || networks.loading}>
          Continuar
          <ArrowRight aria-hidden="true" />
        </Button>
      );
      hint = networks.loading
        ? null
        : !networks.zernioKey
          ? "Falta a chave do Zernio."
          : !networks.instagram
            ? "Falta autorizar a conta do Instagram."
            : null;
      secondary = ready ? null : <SkipLink onClick={advance}>Fazer isso depois</SkipLink>;
      break;
    }
    case 3: {
      primary = (
        <Button onClick={advance} disabled={media.loading}>
          {media.any ? "Continuar" : "Pular por enquanto"}
          <ArrowRight aria-hidden="true" />
        </Button>
      );
      break;
    }
    case 4: {
      const some = (competitors.data?.length ?? 0) > 0;
      primary = (
        <Button onClick={advance}>
          {some ? "Continuar" : "Pular por enquanto"}
          <ArrowRight aria-hidden="true" />
        </Button>
      );
      break;
    }
    case 5: {
      const done = state?.status === "done";
      const failed = state?.status === "failed" || runner.stalled;
      primary =
        failed && !done ? null : (
          <Button onClick={advance} disabled={!done}>
            Confirmar marca
            <ArrowRight aria-hidden="true" />
          </Button>
        );
      hint =
        state?.status === "running" && !runner.stalled
          ? "Pode fechar e voltar depois — o progresso fica salvo."
          : null;
      break;
    }
    case 6: {
      if (videoMode === "hub") {
        hint = "Diga o que você tem e o que quer; o produto escolhe o provedor e o modelo.";
        break;
      }
      if (videoMode === "remake") {
        // o formulário de "Melhorar um vídeo meu" tem o próprio botão
        hint = "Suba o vídeo e escolha o que melhorar. A produção continua em segundo plano.";
        break;
      }
      if (videoMode === "presenter") {
        if (videoJob && !videoFinished) {
          primary = (
            <Button disabled>
              <Loader2 className="animate-spin" aria-hidden="true" />
              Produzindo o vídeo…
            </Button>
          );
          hint = "Leva alguns minutos. Pode fechar e voltar — a produção continua.";
          secondary = (
            <SkipLink
              onClick={() => {
                storeVideoJob(null);
                setVideoJobId(null);
                setVideoBrief(null);
              }}
            >
              Criar outro
            </SkipLink>
          );
          break;
        }
        if (videoJob && videoFinished) {
          primary =
            videoJob.status === "done" ? (
              <Button onClick={() => goTo(7)}>
                Publicar
                <ArrowRight aria-hidden="true" />
              </Button>
            ) : (
              // "Retomar produção" fica no cartão do vídeo; aqui só se começa outro
              <Button
                variant="outline"
                onClick={() => {
                  storeVideoJob(null);
                  setVideoJobId(null);
                  setVideoBrief(null);
                }}
              >
                Criar outro vídeo
              </Button>
            );
          break;
        }
        const ready = brief.trim().length > 0;
        primary = videoBrief ? (
          <Button onClick={gerarVideo} disabled={createVideo.isPending || Boolean(videoBlocked)}>
            {createVideo.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Gerar vídeo
          </Button>
        ) : (
          <Button onClick={montarBriefing} disabled={!ready || briefVideo.isPending}>
            {briefVideo.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Montar o briefing
          </Button>
        );
        // o status fica AQUI, no rodapé fixo: o corpo do modal rola e escondia o aviso
        hint = briefVideo.isPending
          ? "Montando o briefing com a voz da marca e os números do seu material (até 45 s)…"
          : videoBrief && videoBlocked
            ? videoBlocked
            : videoBrief
              ? "Ajuste o que quiser; o apresentador, o motor e as legendas seguem o padrão da marca."
              : ready
                ? "O briefing nasce pronto do tema e do seu material."
                : "Escreva o tema ou escolha uma sugestão.";
        if (videoBrief) {
          // toda trava tem saída: sem Higgsfield, "Conectar" entra ao lado de "Mudar o tema"
          secondary = (
            <>
              <SkipLink onClick={() => setVideoBrief(null)}>Mudar o tema</SkipLink>
              {videoBlocked ? (
                <SkipLink onClick={() => openIntegration("higgsfield")}>
                  <BrandInline name="higgsfield">Conectar Higgsfield</BrandInline>
                </SkipLink>
              ) : null}
            </>
          );
        }
        break;
      }
      if (jobId && !preview && !jobFinished) {
        // criando: o botão espera; a peça pronta avança sozinha
        const running = job && !jobTerminal;
        primary =
          createdPieces.length > 0 ? (
            <Button onClick={() => goTo(7)}>
              Publicar
              <ArrowRight aria-hidden="true" />
            </Button>
          ) : (
            <Button disabled>
              {running || !job ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {job?.status === "awaiting_angle" ? "Escolha o ângulo" : "Criando…"}
            </Button>
          );
        hint =
          running || !job
            ? "Pode fechar e voltar depois — a criação continua."
            : job.status === "failed"
              ? null
              : "Terminando…";
        break;
      }
      const ready = brief.trim().length > 0;
      primary = (
        <Button onClick={createNow} disabled={!ready || createJob.isPending}>
          {createJob.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Criar agora
        </Button>
      );
      hint = ready
        ? formats.size === 0
          ? "Sem formato marcado, o sistema escolhe entre os canais ligados."
          : null
        : "Escreva o tema ou escolha uma sugestão.";
      if (jobFinished && createdPieces.length > 0) {
        secondary = <SkipLink onClick={() => goTo(7)}>Ver a peça pronta</SkipLink>;
      }
      break;
    }
    default: {
      primary = (
        <Button onClick={() => void finish()} disabled={finishing}>
          {finishing ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Concluir
        </Button>
      );
    }
  }

  const meta = SETUP_FLOW_STEPS.find((item) => item.step === step) ?? SETUP_FLOW_STEPS[0];
  const completed = new Set<SetupFlowStep>(
    preview
      ? []
      : ([
          autopilotActive && 1,
          networks.zernioKey && networks.instagram && 2,
          media.any && 3,
          (competitors.data?.length ?? 0) > 0 && 4,
          brandDone && 5,
          (createdPieces.length > 0 || videoJob?.status === "done") && 6,
        ].filter(Boolean) as SetupFlowStep[]),
  );

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          // janela do assistente do kit: painel navy à esquerda, conteúdo à direita
          "grid h-[min(92vh,48rem)] gap-0 overflow-hidden p-0 outline-none sm:max-w-5xl md:grid-cols-[17rem_minmax(0,1fr)]",
          !dismissible && "[&>button.absolute]:hidden",
        )}
        ref={contentRef}
        // Foco inicial no campo do passo (site, tema) quando houver; senão no
        // próprio modal, sem anel — o Radix focaria o 1º botão do stepper.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const field = contentRef.current?.querySelector<HTMLElement>("[autofocus]");
          (field ?? contentRef.current)?.focus({ preventScroll: true });
        }}
        onEscapeKeyDown={(event) => {
          if (!dismissible) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (!dismissible) event.preventDefault();
        }}
        data-testid="setup-flow"
      >
        <SetupPanel
          current={step}
          reached={reached}
          completed={completed}
          onSelect={goTo}
          onLater={dismissible ? () => handleOpenChange(false) : undefined}
        />

        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="space-y-4 px-6 pt-6 md:px-8 md:pt-8">
            {/* no celular o painel some: o stepper horizontal mostra onde a pessoa está */}
            <div className="md:hidden">
              <SetupStepper
                current={step}
                reached={reached}
                completed={completed}
                onSelect={goTo}
              />
            </div>
            <BackgroundReadingLine step={step} state={state} />
          </div>

          <DialogHeader className="px-6 pb-2 pt-4 text-left md:px-8">
            <p className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-[var(--via-text-muted)]">
              Passo {step}
            </p>
            {/* o onboarding é a tela inteira: o título é o h1 dela */}
            <DialogTitle asChild>
              <h1 className="text-2xl font-medium tracking-[-0.02em]">{meta.label}</h1>
            </DialogTitle>
            <DialogDescription className="text-[var(--via-text-muted)]">
              {describe(step, state?.status ?? null)}
            </DialogDescription>
          </DialogHeader>

          {/* altura segue o conteúdo do passo; só os passos longos rolam */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 md:px-8">
            <div key={step} className={ENTER}>
              {step === 1 ? (
                <StepBrand
                  values={brandForm}
                  onChange={changeBrandForm}
                  state={state}
                  editing={editingBrand}
                  onEdit={state?.status === "running" ? undefined : editBrand}
                  errors={fieldErrors}
                  zernioConnected={networks.zernioKey}
                />
              ) : step === 2 ? (
                <StepNetworks readiness={networks} />
              ) : step === 3 ? (
                <StepMedia />
              ) : step === 4 ? (
                <StepMarket />
              ) : step === 5 ? (
                <StepBrandReady
                  state={state}
                  callError={runner.stalled ? runner.error : null}
                  retrying={autopilot.advance.isPending}
                  onRetry={runner.retry}
                />
              ) : step === 6 ? (
                <StepCreate
                  brief={brief}
                  onBriefChange={setBrief}
                  formats={formats}
                  onToggleFormat={toggleFormat}
                  onDefaultFormat={(type) => setFormats(new Set([type]))}
                  job={preview ? null : job}
                  jobLoading={Boolean(jobId) && !preview && jobQuery.isLoading}
                  pieces={createdPieces}
                  onRestart={restartCreate}
                  finished={jobFinished}
                  onOpenLast={() => goTo(7)}
                  video={videoMode}
                  onVideoChange={changeVideoMode}
                  videoBrief={videoBrief}
                  onVideoBriefChange={setVideoBrief}
                  videoBriefPending={briefVideo.isPending}
                  videoJob={videoMode === "presenter" ? videoJob : null}
                  videoBlocked={videoBlocked}
                  remakeOptions={remakeOptions}
                  onRemakeOptionsChange={setRemakeOptions}
                  onVideoCreated={() => {
                    setVideoMode("none");
                    goTo(7);
                  }}
                />
              ) : videoJob && videoMode === "presenter" ? (
                // vídeo: o cartão da produção já traz o player e "Publicar Reel"
                <JobCard job={videoJob} />
              ) : (
                <StepPublish
                  preferPieceIds={createdPieces.map((piece) => piece.id)}
                  onCreate={() => goTo(6)}
                />
              )}
            </div>
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--via-border-soft)] px-6 py-4 md:px-8">
            <div className="flex min-w-0 items-center gap-3">
              {step > 1 ? (
                <Button variant="ghost" onClick={back} disabled={finishing}>
                  Voltar
                </Button>
              ) : null}
              {hint ? (
                <span
                  key={String(hint)}
                  className={cn(
                    "text-xs",
                    step === 1 && ((start.error && !hasFieldError) || brandFailed)
                      ? cn("font-medium text-[var(--via-coral-dark)]", startShake)
                      : "text-[var(--via-text-muted)]",
                  )}
                  aria-live="polite"
                >
                  {hint}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              {secondary}
              {primary}
            </div>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Linha discreta sob o stepper: a leitura segue enquanto o usuário conecta o resto. */
function BackgroundReadingLine({
  step,
  state,
}: {
  step: SetupFlowStep;
  state: AutopilotState | null;
}) {
  if (!state || state.status === "idle" || step < 2 || step > 4) return null;
  const finished = state.steps.filter((item) =>
    ["done", "skipped", "needs_review", "failed"].includes(item.status),
  ).length;
  const host = hostOf(state.input.site);
  return (
    <p className="flex items-center justify-end gap-2 text-xs text-[var(--via-text-muted)]">
      {state.status === "running" ? (
        <>
          <Loader2 className="size-3.5 animate-spin text-[var(--via-navy)]" aria-hidden="true" />
          Lendo {host ?? "sua marca"} em segundo plano ·{" "}
          <span className="font-mono tabular-nums">
            {finished} de {AUTOPILOT_STEP_IDS.length}
          </span>
        </>
      ) : state.status === "done" ? (
        <>
          <Check className="size-3.5 text-[var(--via-navy)]" aria-hidden="true" />
          Marca lida — confira em Marca pronta
        </>
      ) : (
        <>A leitura parou — veja em Marca pronta</>
      )}
    </p>
  );
}

function describe(step: SetupFlowStep, status: string | null): string {
  switch (step) {
    case 1:
      return "Cole o site e o Instagram. A leitura começa agora e segue enquanto você conecta o resto.";
    case 2:
      return "Conecte o Zernio e autorize a conta do Instagram onde as peças vão sair.";
    case 3:
      return "Opcional. Motores de vídeo e narração dos Reels.";
    case 4:
      return "Compare seus resultados com quem você acompanha. Adicionar já dispara a leitura dos perfis (gasta créditos do Apify).";
    case 5:
      return status === "done"
        ? "Confira o resumo. Tudo continua editável em Marca."
        : status === "failed"
          ? "A leitura parou. Tente de novo ou preencha à mão."
          : "Montando voz, posicionamento, regras e identidade visual.";
    case 6:
      return "Escolha o formato e diga o tema. A peça nasce com a voz e as regras da marca.";
    default:
      return "Aprove e publique agora ou agende. Para mudar algo, volte a qualquer passo.";
  }
}

/** O que a leitura usou, de volta no formato do formulário (para corrigir e ler de novo). */
function formFromInput(input: AutopilotState["input"]): BrandFormValues {
  return {
    site: input.site.replace(/^https?:\/\//, "").replace(/\/$/, ""),
    instagram: input.instagram ?? "",
    captionsRaw: input.captions.join("\n\n"),
    noInstagram: !input.instagram,
    noSite: !input.site,
  };
}

function SkipLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-sm text-[var(--via-text-muted)] underline-offset-4 hover:text-[var(--via-text-primary)] hover:underline focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]"
    >
      {children}
    </button>
  );
}
