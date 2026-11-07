import {
  Clapperboard,
  Download,
  Film,
  Images,
  KeyRound,
  Loader2,
  TriangleAlert,
  UserRound,
  Wand2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "@/lib/toast";

import { NewAvatarDialog } from "@/components/avatars/new-avatar-dialog";
import { BrandIcon } from "@/components/brand-icon";
import { GateOptionList, GenerationGate } from "@/components/generation/generation-gate";
import { useGateResolution } from "@/components/generation/use-gate-resolution";
import { CostGateDialog } from "@/components/reel/cost-gate-dialog";
import { reelEstimateState } from "@/components/reel/reel-estimate";
import { KeyframeReview } from "@/components/reel/keyframe-review";
import { ScenePreviewGrid } from "@/components/reel/scene-preview-grid";
import { SceneProgressList } from "@/components/reel/scene-progress-list";
import { SceneStoryboardCard } from "@/components/reel/scene-storyboard-card";
import { SignedDownloadLink, SignedVideo } from "@/components/reel/signed-media";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import "@/components/analytics/analytics.css";
import { Skeleton } from "@/components/ui/skeleton";
import {
  VIDEO_PROJECT_STATUS_LABELS,
  formatUsd,
  isProjectBusy,
  useApproveKeyframes,
  useAssembleVideo,
  useCancelVideoProject,
  useCreateStoryboard,
  useRegenerateScene,
  useStartProduction,
  useUpdateScene,
  useVideoEstimate,
  useVideoProject,
  type RegenerateFrom,
  type UpdateScenePatch,
  type VideoProject,
  type VideoScene,
} from "@/hooks/use-video-project";
import {
  AVATAR_BUCKET,
  presenterPortraitPath,
  useAvatars,
  type AvatarRow,
} from "@/hooks/use-avatars";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { useSignedUrl } from "@/hooks/use-storage";
import {
  useEngineStatus,
  useReplicateVideoModels,
  type VideoCapability,
  type VideoModelOption,
} from "@/hooks/use-video-models";
import type { GateOption, GateSelection, GateSignals } from "@/lib/generation-gate";
import { openIntegration } from "@/lib/integration-modal";
import { cn } from "@/lib/utils";
import { humanizeError } from "@/lib/humanize-error";

// ---------------------------------------------------------------------------
// Produção de vídeo da peça Reel — docs/11-video-replicate.md §5.
//
// A tela é a máquina de estados do projeto (§3.2). Dois portões de custo
// explícitos: `start_production` (áudio + keyframes, centavos) e
// `approve_keyframes` (os vídeos, dólares). Nada se perde ao fechar a aba —
// todo progresso é estado de banco alimentado pelo webhook.
// ---------------------------------------------------------------------------

/**
 * Estados em que o projeto parou fora de um portão humano: a tela mostra as
 * cenas com CTA por cena, preservando o que já ficou pronto.
 */
const NO_SELECTION: GateSelection = { a: null, b: null };

const NEEDS_SCENE_TRIAGE: readonly VideoProject["status"][] = [
  "attention",
  "paused",
  "failed",
  "cancelled",
];

export function ReelProjectView({ pieceId }: { pieceId: string }) {
  const projectQuery = useVideoProject(pieceId);
  const project = projectQuery.data?.project ?? null;
  const scenes = projectQuery.data?.scenes ?? [];

  const createStoryboard = useCreateStoryboard(pieceId);
  const updateScene = useUpdateScene(pieceId);
  const startProduction = useStartProduction(pieceId);
  const approveKeyframes = useApproveKeyframes(pieceId);
  const regenerateScene = useRegenerateScene(pieceId);
  const assemble = useAssembleVideo(pieceId);
  const cancelProject = useCancelVideoProject(pieceId);

  const [savingSceneId, setSavingSceneId] = useState<string | null>(null);
  const [regeneratingSceneId, setRegeneratingSceneId] = useState<string | null>(null);
  const [prepGateOpen, setPrepGateOpen] = useState(false);
  const [videoGateOpen, setVideoGateOpen] = useState(false);

  // Apresentador do Reel: o padrão já vem marcado; null = ninguém falando.
  const presenters = useAvatars("active");
  const [presenterChoice, setPresenterChoice] = useState<string | null | undefined>(undefined);
  const defaultPresenterId = (presenters.data ?? []).find((a) => a.is_default)?.id ?? null;
  const presenterId = presenterChoice !== undefined ? presenterChoice : defaultPresenterId;

  // As estimativas só são pedidas na fase em que importam (a function cobra uma
  // ida ao banco por cena — e sem token do Replicate ela responde 400).
  const prepEstimate = useVideoEstimate(project?.id, "prep", {
    enabled: project?.status === "storyboard",
  });
  const videoEstimate = useVideoEstimate(project?.id, "video", {
    enabled: project?.status === "keyframes_review",
  });

  // Os portões ESCOLHEM de verdade: todos os modelos ativos da fase, o
  // primário marcado como Recomendado; a escolha vai para o servidor ao
  // confirmar (keyframe_model / scene_model / avatar_model). Cena com o
  // apresentador falando usa outro catálogo (talking_avatar), com portão próprio.
  const phaseCapability: VideoCapability =
    project?.status === "keyframes_review" ? "scene_i2v" : "keyframe";
  const phaseModels = useReplicateVideoModels(phaseCapability);
  const avatarModels = useReplicateVideoModels("talking_avatar");
  const engineStatus = useEngineStatus();
  const { higgsfield: higgsfieldStatus, replicate: replicateStatus } = engineStatus;
  const [phaseSelection, setPhaseSelection] = useState<GateSelection>(NO_SELECTION);
  const [avatarSelection, setAvatarSelection] = useState<GateSelection>(NO_SELECTION);
  const sceneRows = projectQuery.data?.scenes ?? [];
  const avatarScenes = sceneRows.filter((s) => s.type === "avatar");
  const brollScenes = sceneRows.filter((s) => s.type !== "avatar");
  const gate = useMemo(() => {
    const options: GateOption[] = (phaseModels.data ?? []).map((o) => ({
      ...o,
      engine: "replicate",
    }));
    const avatarOptions: GateOption[] = (avatarModels.data ?? []).map((o) => ({
      ...o,
      engine: "replicate",
    }));
    const seconds = (rows: typeof sceneRows) =>
      rows.reduce((sum, s) => sum + Number(s.audio_duration_s ?? s.duration_target_s ?? 0), 0);
    const base = {
      hasPresenter: false,
      isDraft: false,
      connected: { higgsfield: higgsfieldStatus, replicate: replicateStatus },
    };
    // na fase de quadros contam todas as cenas; na de vídeo, só as de imagem
    const phaseRows = phaseCapability === "keyframe" ? sceneRows : brollScenes;
    const signals: GateSignals = {
      ...base,
      durationSeconds: seconds(phaseRows),
      scenes: phaseRows.length || undefined,
      images: phaseRows.length || undefined,
    };
    const avatarSignals: GateSignals = {
      ...base,
      hasPresenter: true,
      durationSeconds: seconds(avatarScenes),
      scenes: avatarScenes.length || undefined,
    };
    return { options, signals, avatarOptions, avatarSignals };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    phaseModels.data,
    avatarModels.data,
    projectQuery.data?.scenes,
    higgsfieldStatus,
    replicateStatus,
    phaseCapability,
  ]);
  const gateResolution = useGateResolution(gate.options, phaseSelection, gate.signals, false);
  const avatarResolution = useGateResolution(
    gate.avatarOptions,
    avatarSelection,
    gate.avatarSignals,
    false,
  );
  const chosenPhaseModel = gateResolution.a?.option.id ?? null;
  const chosenAvatarModel = avatarResolution.a?.option.id ?? null;
  const prepGate = reelEstimateState({
    data: prepEstimate.data,
    isLoading: prepEstimate.isLoading,
    error: prepEstimate.error,
    onRetry: () => void prepEstimate.refetch(),
  });
  const videoGate = reelEstimateState({
    data: videoEstimate.data,
    isLoading: videoEstimate.isLoading,
    error: videoEstimate.error,
    onRetry: () => void videoEstimate.refetch(),
  });
  const connectReplicate = {
    integration: "replicate" as const,
    onClick: () => openIntegration("replicate"),
  };

  const handleSaveScene = (scene: VideoScene, patch: UpdateScenePatch) => {
    setSavingSceneId(scene.id);
    updateScene.mutate(
      { scene_id: scene.id, patch },
      {
        onSuccess: (result) => {
          if (result.unchanged) {
            toast.info("Nenhuma alteração para salvar nesta cena.");
            return;
          }
          toast.success(`Cena ${scene.scene_index + 1} salva`, {
            description: result.stale
              ? "Esta cena já tinha mídia gerada e vai precisar ser refeita."
              : undefined,
          });
          void prepEstimate.refetch();
        },
        onError: (error) => {
          toast.error("Não foi possível salvar a cena", { description: error.message });
        },
        onSettled: () => setSavingSceneId(null),
      },
    );
  };

  const handleRegenerate = (scene: VideoScene, from: RegenerateFrom) => {
    setRegeneratingSceneId(scene.id);
    regenerateScene.mutate(
      { scene_id: scene.id, from },
      {
        onSuccess: () => {
          toast.success(`Cena ${scene.scene_index + 1} sendo refeita`);
        },
        onError: (error) => {
          toast.error("Não foi possível refazer a cena", { description: error.message });
        },
        onSettled: () => setRegeneratingSceneId(null),
      },
    );
  };

  const handleCancel = () => {
    if (!project) return;
    cancelProject.mutate(project.id, {
      onSuccess: (result) => {
        toast.success("Produção cancelada", {
          description: `${result.cancelled} geração(ões) interrompida(s). Gasto até aqui: ${formatUsd(result.spent_usd)}.`,
        });
      },
      onError: (error) => {
        toast.error("Não foi possível cancelar", { description: error.message });
      },
    });
  };

  if (projectQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (projectQuery.isError) {
    return (
      <Alert variant="destructive">
        <TriangleAlert className="size-4" aria-hidden="true" />
        <AlertTitle>A produção do vídeo não carregou. Recarregue a página.</AlertTitle>
        <AlertDescription>{humanizeError(projectQuery.error?.message)}</AlertDescription>
      </Alert>
    );
  }

  if (!project) {
    return (
      <NoProjectCard
        pending={createStoryboard.isPending}
        loadingPresenters={presenters.isLoading}
        presenters={presenters.data ?? []}
        presenterId={presenterId}
        onPresenterChange={setPresenterChoice}
        onCreate={() =>
          createStoryboard.mutate(
            // avatar_id só quando o usuário escolheu; sem escolha, o servidor usa o padrão
            presenterChoice !== undefined
              ? { piece_id: pieceId, avatar_id: presenterChoice }
              : { piece_id: pieceId },
            {
              onSuccess: (result) => {
                toast.success(
                  result.reused
                    ? "O roteiro de cenas já existia. Nada foi sobrescrito."
                    : `Roteiro pronto com ${result.scenes ?? 0} cenas`,
                  { description: "Revise as cenas e clique em “Gerar narração e quadros”." },
                );
              },
              onError: (error) => {
                toast.error("Não foi possível montar o roteiro", {
                  description: error.message,
                });
              },
            },
          )
        }
      />
    );
  }

  const allKeyframesSettled = scenes.every(
    (scene) => scene.status === "keyframe_ready" || scene.status === "failed",
  );
  const hasFailedScene = scenes.some((scene) => scene.status === "failed");

  return (
    <div className="space-y-4">
      <ProjectHeader project={project} sceneCount={scenes.length} />
      <AvatarBanner avatarId={project.avatar_id} />

      {project.status === "paused" ? <PausedBanner project={project} /> : null}
      {project.status === "failed" || project.status === "cancelled" ? (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" aria-hidden="true" />
          <AlertTitle>
            {project.status === "failed" ? "A produção falhou" : "Produção cancelada"}
          </AlertTitle>
          <AlertDescription>
            {project.error ??
              "Use “Tentar de novo” nas cenas com erro abaixo para retomar de onde parou."}
          </AlertDescription>
        </Alert>
      ) : null}

      {project.status === "attention" ? (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" aria-hidden="true" />
          <AlertTitle>Uma ou mais cenas falharam</AlertTitle>
          <AlertDescription>
            As cenas prontas foram mantidas. Clique em “Tentar de novo” na cena com erro; ela
            continua de onde parou.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* ── storyboard: edição livre e gratuita ─────────────────────────── */}
      {project.status === "storyboard" ? (
        <>
          <div className="space-y-3">
            {scenes.map((scene) => (
              <SceneStoryboardCard
                key={scene.id}
                scene={scene}
                total={scenes.length}
                costLabel={sceneCostLabel(prepEstimate.data, scene.id)}
                pending={savingSceneId === scene.id}
                onSave={(patch) => handleSaveScene(scene, patch)}
              />
            ))}
          </div>

          <GenerationGate
            data-testid="reel-prep-gate"
            task="Narração e quadros"
            resolution={gateResolution}
            onSelect={setPhaseSelection}
            compare={null}
            estimate={prepGate}
            loading={phaseModels.isLoading}
            error={phaseModels.isError}
            emptyText="Nenhum modelo de quadro ativo."
            note="Narração e quadros: etapa barata. As cenas em vídeo são aprovadas depois."
            connectAction={prepGate.kind === "connect" ? connectReplicate : null}
            action={{
              label: "Gerar narração e quadros",
              onClick: () => setPrepGateOpen(true),
              pending: startProduction.isPending,
              disabled: prepEstimate.isLoading,
              icon: <Wand2 aria-hidden="true" />,
            }}
          />
        </>
      ) : null}

      {/* ── generating_audio: progresso, sem ações destrutivas ──────────── */}
      {project.status === "generating_audio" ? (
        <>
          <SceneProgressList
            scenes={scenes}
            phase="prep"
            title="Gerando narração e quadros"
            description="Etapa barata (centavos): a narração e o quadro de referência de cada cena. Pode fechar a aba; o progresso fica salvo."
          />
          <CancelRow pending={cancelProject.isPending} onCancel={handleCancel} />
        </>
      ) : null}

      {/* ── keyframes_review: o portão principal ────────────────────────── */}
      {project.status === "keyframes_review" ? (
        <>
          <Alert>
            <Images className="size-4" aria-hidden="true" />
            <AlertTitle>Confira os quadros antes de gastar em vídeo</AlertTitle>
            <AlertDescription>
              Até aqui o vídeo custou <strong>centavos</strong>. O próximo passo gera as cenas em
              vídeo e custa <strong>dólares</strong>. Refaça agora o quadro que não ficou bom: sai
              bem mais barato que refazer a cena depois.
            </AlertDescription>
          </Alert>

          <KeyframeReview
            scenes={scenes}
            regeneratingSceneId={regeneratingSceneId}
            onRegenerate={(scene) => handleRegenerate(scene, "keyframe")}
          />
          {avatarScenes.length ? (
            <div data-testid="reel-avatar-gate" className="space-y-1">
              <GateOptionList
                task="Cenas com o apresentador falando"
                basis={`${avatarScenes.length} ${avatarScenes.length === 1 ? "cena" : "cenas"} · a boca acompanha a narração`}
                rows={avatarResolution.rows}
                a={avatarResolution.a?.option.id ?? null}
                b={null}
                onSelect={setAvatarSelection}
                compare={null}
                fallbackReason={avatarResolution.fallbackReason}
                loading={avatarModels.isLoading}
                error={avatarModels.isError}
              />
            </div>
          ) : null}

          <GenerationGate
            data-testid="reel-video-gate"
            task={avatarScenes.length ? "Cenas de imagem em vídeo" : "Cenas em vídeo"}
            resolution={gateResolution}
            onSelect={setPhaseSelection}
            compare={null}
            estimate={videoGate}
            loading={phaseModels.isLoading}
            error={phaseModels.isError}
            emptyText="Nenhum modelo de cena ativo."
            note={
              !allKeyframesSettled
                ? "Ainda há quadro sendo gerado. O botão libera quando todos terminarem."
                : hasFailedScene
                  ? "Há cena com falha. Ela será refeita junto com as outras ao aprovar."
                  : undefined
            }
            connectAction={videoGate.kind === "connect" ? connectReplicate : null}
            action={{
              label: "Aprovar e gerar cenas",
              onClick: () => setVideoGateOpen(true),
              pending: approveKeyframes.isPending,
              disabled: !allKeyframesSettled,
              icon: <Film aria-hidden="true" />,
            }}
          />
          <CancelRow pending={cancelProject.isPending} onCancel={handleCancel} />
        </>
      ) : null}

      {/* ── generating_scenes ───────────────────────────────────────────── */}
      {project.status === "generating_scenes" ? (
        <>
          <SceneProgressList
            scenes={scenes}
            phase="video"
            title="Gerando as cenas"
            description="Etapa mais cara. Cada cena vira vídeo com a narração. Esta tela atualiza sozinha."
          />
          <CancelRow pending={cancelProject.isPending} onCancel={handleCancel} />
        </>
      ) : null}

      {/* ── scenes_ready: preview antes da montagem ─────────────────────── */}
      {project.status === "scenes_ready" ? (
        <>
          <ScenePreviewGrid
            scenes={scenes}
            regeneratingSceneId={regeneratingSceneId}
            onRegenerate={(scene) => handleRegenerate(scene, "video")}
          />
          <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background/95 p-4 shadow-lg backdrop-blur">
            <p className="text-sm text-muted-foreground">
              Todas as cenas estão prontas. Monte o vídeo final; custa centavos.
            </p>
            <Button
              onClick={() =>
                assemble.mutate(project.id, {
                  onSuccess: () => toast.success("Montagem iniciada. Termina em alguns minutos."),
                  onError: (error) =>
                    toast.error("Não foi possível montar o vídeo", {
                      description: error.message,
                    }),
                })
              }
              disabled={assemble.isPending}
            >
              {assemble.isPending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Clapperboard aria-hidden="true" />
              )}
              Montar vídeo final
            </Button>
          </div>
        </>
      ) : null}

      {/* ── assembling ──────────────────────────────────────────────────── */}
      {project.status === "assembling" ? (
        <SceneProgressList
          scenes={scenes}
          phase="video"
          title="Montando o vídeo final"
          description="Juntando as cenas na ordem do roteiro. Termina em alguns minutos."
        />
      ) : null}

      {/* ── ready: player + download ────────────────────────────────────── */}
      {project.status === "ready" ? <ReadyCard project={project} /> : null}

      {/* ── attention: CTA por cena, preservando as prontas ─────────────── */}
      {NEEDS_SCENE_TRIAGE.includes(project.status) ? (
        <SceneProgressList
          scenes={scenes}
          phase="video"
          title="Cenas do vídeo"
          description="As cenas prontas foram mantidas. Clique em “Tentar de novo” só nas que falharam."
          retryPendingSceneId={regeneratingSceneId}
          onRetryScene={(scene) => handleRegenerate(scene, retryEntryPoint(scene))}
        />
      ) : null}

      {/* ── Portões de custo ────────────────────────────────────────────── */}
      <CostGateDialog
        open={prepGateOpen}
        onOpenChange={setPrepGateOpen}
        title="Gerar narração e quadros?"
        description={
          <>
            <p>
              Etapa barata: a narração de cada cena e um quadro de referência (a imagem que guia a
              cena).
            </p>
            <p>Nenhuma cena em vídeo é gerada agora. Você aprova os quadros antes.</p>
          </>
        }
        confirmLabel="Gerar agora"
        pending={startProduction.isPending}
        estimate={prepEstimate.data}
        loading={prepEstimate.isLoading}
        error={prepEstimate.error}
        onConfirm={() =>
          startProduction.mutate(
            { projectId: project.id, keyframeModel: chosenPhaseModel },
            {
              onSuccess: () => {
                setPrepGateOpen(false);
                toast.success("Produção iniciada", {
                  description: "Gerando a narração e o quadro de cada cena.",
                });
              },
              onError: (error) => {
                toast.error("Não foi possível iniciar a produção", { description: error.message });
              },
            },
          )
        }
      />

      <CostGateDialog
        open={videoGateOpen}
        onOpenChange={setVideoGateOpen}
        title="Gerar as cenas em vídeo?"
        description={
          <>
            <p>Esta é a etapa mais cara: cada cena vira vídeo no Replicate.</p>
            <p>Refazer depois custa de novo. Confira os quadros antes de confirmar.</p>
          </>
        }
        confirmLabel="Aprovar e gerar"
        pending={approveKeyframes.isPending}
        estimate={videoEstimate.data}
        loading={videoEstimate.isLoading}
        error={videoEstimate.error}
        onConfirm={() =>
          approveKeyframes.mutate(
            { projectId: project.id, sceneModel: chosenPhaseModel, avatarModel: chosenAvatarModel },
            {
              onSuccess: () => {
                setVideoGateOpen(false);
                toast.success("Gerando as cenas. Esta tela atualiza sozinha.");
              },
              onError: (error) => {
                toast.error("Não foi possível gerar as cenas", { description: error.message });
              },
            },
          )
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Blocos
// ---------------------------------------------------------------------------

function NoProjectCard({
  pending,
  loadingPresenters,
  presenters,
  presenterId,
  onPresenterChange,
  onCreate,
}: {
  pending: boolean;
  /** Lista carregando: criar agora ignoraria o apresentador marcado. */
  loadingPresenters: boolean;
  presenters: AvatarRow[];
  presenterId: string | null;
  onPresenterChange: (id: string | null) => void;
  onCreate: () => void;
}) {
  return (
    // Painel de vidro do kit: o Reel ainda não tem vídeo; a produção começa aqui mesmo.
    <section
      aria-labelledby="reel-produzir-title"
      className="via-tile via-tile--atmos ce-chart-empty flex flex-col items-center gap-4 !px-6 !py-10 text-center"
    >
      <p
        id="reel-produzir-title"
        className="text-lg font-medium tracking-[-0.02em] text-[var(--via-text-primary)]"
      >
        Produzir o vídeo
      </p>
      <p className="max-w-sm text-sm text-[var(--via-text-muted)]">
        O texto vira um roteiro de cenas, grátis e editável. Narração e quadros custam centavos; as
        cenas em vídeo, dólares — você aprova cada etapa antes de gastar.
      </p>
      {presenters.length > 0 ? (
        <div role="group" aria-label="Quem apresenta" className="space-y-2">
          <p className="via-eyebrow">Quem apresenta</p>
          <div className="flex flex-wrap justify-center gap-2">
            {presenters.map((presenter) => (
              <ChoiceChip
                key={presenter.id}
                selected={presenterId === presenter.id}
                onClick={() => onPresenterChange(presenter.id)}
              >
                {presenter.name}
              </ChoiceChip>
            ))}
            <ChoiceChip selected={presenterId === null} onClick={() => onPresenterChange(null)}>
              Ninguém, só imagens
            </ChoiceChip>
          </div>
        </div>
      ) : null}
      <Button onClick={onCreate} disabled={pending || loadingPresenters} className="rounded-full">
        {pending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Wand2 aria-hidden="true" />
        )}
        Montar roteiro de cenas
      </Button>
    </section>
  );
}

function ProjectHeader({ project, sceneCount }: { project: VideoProject; sceneCount: number }) {
  const busy = isProjectBusy(project.status);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge
        variant="outline"
        className={cn(
          "gap-1 font-normal",
          project.status === "ready" &&
            "border-[0.5px] border-[var(--via-border-soft)] bg-[var(--via-navy-04)] text-[var(--via-text-body)]",
          (project.status === "attention" ||
            project.status === "paused" ||
            project.status === "failed") &&
            "border-[var(--via-navy-20)] bg-[var(--via-navy-08)] text-[var(--via-text-primary)]",
        )}
      >
        {busy ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : null}
        {VIDEO_PROJECT_STATUS_LABELS[project.status] ?? project.status}
      </Badge>
      <span className="text-xs text-muted-foreground">
        {sceneCount} cena{sceneCount === 1 ? "" : "s"} · {project.resolution}
      </span>
      {Number(project.actual_cost_usd ?? 0) > 0 ? (
        <span className="font-mono text-xs text-muted-foreground">
          gasto: {formatUsd(project.actual_cost_usd)}
        </span>
      ) : null}
    </div>
  );
}

function PausedBanner({ project }: { project: VideoProject }) {
  return (
    <Alert variant="destructive">
      <KeyRound className="size-4" aria-hidden="true" />
      <AlertTitle>Produção pausada: o Replicate recusou o acesso</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>
          {project.error ?? "Em geral é chave de acesso inválida, revogada ou conta sem crédito."}
        </p>
        <p>
          Nada foi perdido. Corrija a chave e clique em “Tentar de novo” nas cenas para continuar.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => openIntegration("replicate")}
        >
          <BrandIcon name="replicate" />
          Corrigir chave do Replicate
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function CancelRow({ pending, onCancel }: { pending: boolean; onCancel: () => void }) {
  return (
    <div className="flex justify-end">
      <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
        {pending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <X aria-hidden="true" />
        )}
        Cancelar produção
      </Button>
    </div>
  );
}

function ReadyCard({ project }: { project: VideoProject }) {
  const duration = project.final_meta?.duration_s;
  return (
    // Painel de vidro do kit: o vídeo pronto, no mesmo lugar da pré-visualização.
    <section
      aria-label="Vídeo final"
      className="via-tile via-tile--atmos ce-chart-empty space-y-4 !p-4 sm:!p-6"
    >
      <p className="via-eyebrow">Vídeo final</p>
      <div className="mx-auto w-full max-w-[320px] overflow-hidden rounded-[14px] shadow-[var(--via-shadow-md)]">
        <div className="aspect-[9/16]">
          <SignedVideo path={project.final_video_path} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-4 text-sm tabular-nums text-[var(--via-text-muted)]">
        {duration ? <span>{Number(duration).toFixed(1)}s</span> : null}
        <span>{project.resolution}</span>
        <span className="font-mono">custo: {formatUsd(project.actual_cost_usd)}</span>
      </div>

      <div className="flex justify-center">
        <SignedDownloadLink
          path={project.final_video_path}
          fileName={`reel-${project.id}.mp4`}
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          <Download aria-hidden="true" />
          Baixar mp4
        </SignedDownloadLink>
      </div>

      <p className="text-center text-xs text-[var(--via-text-muted)]">
        O vídeo já está ligado à peça. Para publicar, aprove a peça no topo.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Custo estimado desta cena, quando a estimativa da fase já respondeu. */
function sceneCostLabel(
  estimate: { estimate: { per_scene: Array<{ scene_id: string; usd: number }> } } | undefined,
  sceneId: string,
): string | undefined {
  const entry = estimate?.estimate.per_scene.find((item) => item.scene_id === sceneId);
  return entry ? formatUsd(entry.usd) : undefined;
}

/**
 * Ponto de reentrada de um retry: o pipeline é por artefato, então volta-se ao
 * primeiro que está faltando — nunca se repaga o que já existe.
 */
function retryEntryPoint(scene: VideoScene): RegenerateFrom {
  if (!scene.audio_path) return "audio";
  if (!scene.keyframe_path) return "keyframe";
  return "video";
}

/**
 * Quem aparece falando neste Reel. Sem avatar ativo, TODAS as cenas saem como
 * b-roll — e o usuário precisa saber disso antes de gastar, não depois.
 */
function AvatarBanner({ avatarId }: { avatarId: string | null }) {
  const avatars = useAvatars("active");
  const avatar = (avatars.data ?? []).find((row) => row.id === avatarId) ?? null;
  const portrait = useSignedUrl(AVATAR_BUCKET, avatar ? presenterPortraitPath(avatar) : null);
  const [creating, setCreating] = useState(false);

  if (avatars.isLoading) return null;

  if (!avatar) {
    return (
      <Alert>
        <UserRound className="size-4" aria-hidden="true" />
        <AlertTitle>Ninguém apresenta este Reel</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>
            As cenas saem só com imagens de apoio. Cadastre um apresentador para os próximos Reels.
          </span>
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            Novo apresentador
          </Button>
          <NewAvatarDialog open={creating} onOpenChange={setCreating} />
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
      {portrait.data ? (
        <img
          src={portrait.data}
          alt={`Retrato de ${avatar.name}`}
          className="size-10 rounded-md object-cover"
        />
      ) : (
        <div className="flex size-10 items-center justify-center rounded-md bg-muted">
          <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
        </div>
      )}
      <div className="min-w-0 text-xs">
        <p className="font-medium text-foreground">{avatar.name}</p>
        <p className="text-muted-foreground">Apresenta as cenas de fala</p>
      </div>
    </div>
  );
}
