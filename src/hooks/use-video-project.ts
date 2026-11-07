import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { getFunctionError } from "@/lib/edge-functions";
import { formatUsd } from "@/lib/format-usd";

// ---------------------------------------------------------------------------
// Produção de vídeo (Reels) — docs/11-video-replicate.md §2.3/§2.4 (tabelas),
// §3.2 (máquina de estados) e §4.1 (contrato de `generate-video`).
//
// As linhas são tipadas AQUI porque `src/integrations/supabase/types.ts` ainda
// não conhece as tabelas de vídeo. Toda query dessas tabelas usa
// `(supabase as any)`.
// TODO: remover o cast quando o Lovable regenerar types.ts com as tabelas de vídeo.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

export const VIDEO_PROJECT_STATUSES = [
  "storyboard",
  "generating_audio",
  "keyframes_review",
  "generating_scenes",
  "scenes_ready",
  "assembling",
  "ready",
  "attention",
  "paused",
  "failed",
  "cancelled",
] as const;

export type VideoProjectStatus = (typeof VIDEO_PROJECT_STATUSES)[number];

export const VIDEO_PROJECT_STATUS_LABELS: Record<VideoProjectStatus, string> = {
  storyboard: "roteiro em edição",
  generating_audio: "gerando narração e quadros",
  keyframes_review: "quadros para revisar",
  generating_scenes: "gerando as cenas",
  scenes_ready: "cenas prontas",
  assembling: "montando o vídeo",
  ready: "vídeo pronto",
  attention: "precisa de atenção",
  paused: "pausado",
  failed: "falhou",
  cancelled: "cancelado",
};

export const VIDEO_SCENE_STATUSES = [
  "planned",
  "generating_audio",
  "generating_keyframe",
  "keyframe_ready",
  "generating_video",
  "ready",
  "stale",
  "failed",
  "cancelled",
] as const;

export type VideoSceneStatus = (typeof VIDEO_SCENE_STATUSES)[number];

export const VIDEO_SCENE_STATUS_LABELS: Record<VideoSceneStatus, string> = {
  planned: "na fila",
  generating_audio: "gerando narração",
  generating_keyframe: "gerando quadro",
  keyframe_ready: "quadro pronto",
  generating_video: "gerando vídeo",
  ready: "pronta",
  stale: "desatualizada",
  failed: "falhou",
  cancelled: "cancelada",
};

/**
 * Estados em que o backend está trabalhando sozinho: nada muda por ação humana
 * e a UI mantém o polling ligado. `keyframes_review`, `scenes_ready`,
 * `attention` e `paused` NÃO entram — são portões humanos, não processamento.
 */
export const BUSY_PROJECT_STATUSES: readonly VideoProjectStatus[] = [
  "generating_audio",
  "generating_scenes",
  "assembling",
];

export function isProjectBusy(status: VideoProjectStatus | null | undefined): boolean {
  return status ? BUSY_PROJECT_STATUSES.includes(status) : false;
}

export const BUSY_SCENE_STATUSES: readonly VideoSceneStatus[] = [
  "generating_audio",
  "generating_keyframe",
  "generating_video",
];

export function isSceneBusy(status: VideoSceneStatus | null | undefined): boolean {
  return status ? BUSY_SCENE_STATUSES.includes(status) : false;
}

/** Papel do beat no roteiro. O adapter emite `gancho`; o schema aceita `hook`. */
export type VideoSceneRole = "gancho" | "hook" | "desenvolvimento" | "cta";

export const VIDEO_SCENE_ROLE_LABELS: Record<VideoSceneRole, string> = {
  gancho: "Gancho",
  hook: "Gancho",
  desenvolvimento: "Desenvolvimento",
  cta: "Chamada",
};

export type VideoSceneType = "avatar" | "broll";

export const VIDEO_SCENE_TYPE_LABELS: Record<VideoSceneType, string> = {
  avatar: "avatar",
  broll: "imagem de apoio",
};

export interface VideoProject {
  id: string;
  piece_id: string;
  status: VideoProjectStatus;
  avatar_id: string | null;
  style_bible: string | null;
  resolution: string;
  final_video_path: string | null;
  final_meta: { duration_s?: number; scenes?: number; resolution?: string } | null;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  error: string | null;
  error_code: string | null;
  created_at: string;
}

export interface VideoScene {
  id: string;
  project_id: string;
  scene_index: number;
  beat_index: number;
  role: VideoSceneRole;
  type: VideoSceneType;
  narration: string;
  narration_diverged: boolean;
  on_screen_text: string | null;
  visual_prompt: string;
  duration_target_s: number;
  audio_duration_s: number | null;
  status: VideoSceneStatus;
  keyframe_path: string | null;
  audio_path: string | null;
  video_path: string | null;
  final_path: string | null;
  cost_usd: number | null;
  error: string | null;
  // Decupagem (migration 0028): o plano dentro do bloco de fala.
  shot_index: number;
  shot_function: string | null;
  shot_size: string | null;
  shot_angle: string | null;
  shot_lens: string | null;
  shot_movement: string | null;
}

/** Rótulos curtos da gramática de decupagem, para a UI não mostrar ENUM cru. */
export const SHOT_SIZE_LABELS: Record<string, string> = {
  DETALHE: "detalhe",
  CLOSE: "close",
  MEIO_CLOSE: "meio-close",
  MEDIO: "médio",
  AMPLO_VERTICAL: "plano aberto",
};

export const SHOT_ANGLE_LABELS: Record<string, string> = {
  FRONTAL_OLHOS: "frontal",
  TRES_QUARTOS_ESQ: "3/4 esq.",
  TRES_QUARTOS_DIR: "3/4 dir.",
  PERFIL: "perfil",
  CONTRA_PLONGEE_SUAVE: "contra-plongée",
  PLONGEE_SUAVE: "plongée",
  ZENITAL: "zenital",
};

export const SHOT_MOVEMENT_LABELS: Record<string, string> = {
  ESTATICO: "câmera fixa",
  PUSH_IN_LENTO: "aproximação lenta",
  PARALAXE_LATERAL: "paralaxe lateral",
  ACOMPANHA_MAOS: "acompanha as mãos",
  HANDHELD_SUTIL: "câmera na mão",
  RACK_FOCUS: "mudança de foco",
};

export interface VideoProjectBundle {
  project: VideoProject | null;
  scenes: VideoScene[];
}

const PROJECT_COLUMNS =
  "id, piece_id, status, avatar_id, style_bible, resolution, final_video_path, final_meta, estimated_cost_usd, actual_cost_usd, error, error_code, created_at";

const SCENE_COLUMNS =
  "id, project_id, scene_index, beat_index, role, type, narration, narration_diverged, on_screen_text, visual_prompt, duration_target_s, audio_duration_s, status, keyframe_path, audio_path, video_path, final_path, cost_usd, error, shot_index, shot_function, shot_size, shot_angle, shot_lens, shot_movement";

// ---------------------------------------------------------------------------
// Leitura — query key ['video-project', pieceId]
// ---------------------------------------------------------------------------

/**
 * Projeto de vídeo da peça + cenas ordenadas por `scene_index`.
 *
 * Realtime: um canal por peça escuta `video_projects` (filtro `piece_id`) e
 * `video_scenes` (filtro `project_id`, só depois de conhecer o projeto).
 * Fallback: polling de 3s enquanto houver estado ativo (mesmo padrão de
 * `use-generation-jobs.ts` — o canal pode não conectar se a tabela estiver
 * fora da publication do Realtime).
 */
export function useVideoProject(pieceId: string | undefined) {
  const queryClient = useQueryClient();
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  const query = useQuery({
    queryKey: ["video-project", pieceId],
    enabled: Boolean(pieceId),
    queryFn: async (): Promise<VideoProjectBundle> => {
      if (!pieceId) return { project: null, scenes: [] };

      // TODO: remover o cast quando o Lovable regenerar types.ts com as tabelas de vídeo.
      const { data: projectRow, error: projectError } = await (supabase as any)
        .from("video_projects")
        .select(PROJECT_COLUMNS)
        .eq("piece_id", pieceId)
        .maybeSingle();
      if (projectError) throw new Error(projectError.message);

      const project = (projectRow ?? null) as VideoProject | null;
      if (!project) return { project: null, scenes: [] };

      // TODO: remover o cast quando o Lovable regenerar types.ts com as tabelas de vídeo.
      const { data: sceneRows, error: scenesError } = await (supabase as any)
        .from("video_scenes")
        .select(SCENE_COLUMNS)
        .eq("project_id", project.id)
        .order("scene_index", { ascending: true });
      if (scenesError) throw new Error(scenesError.message);

      return { project, scenes: (sceneRows ?? []) as VideoScene[] };
    },
  });

  const projectId = query.data?.project?.id ?? null;
  const busy =
    isProjectBusy(query.data?.project?.status) ||
    (query.data?.scenes ?? []).some((scene) => isSceneBusy(scene.status));

  useEffect(() => {
    if (!pieceId) return;
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ["video-project", pieceId] });
    };
    let channel = supabase.channel(`video-project-${pieceId}`).on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "video_projects",
        filter: `piece_id=eq.${pieceId}`,
      },
      invalidate,
    );
    // O filtro das cenas é por project_id — só existe depois da primeira leitura.
    if (projectId) {
      channel = channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "video_scenes",
          filter: `project_id=eq.${projectId}`,
        },
        invalidate,
      );
    }
    const subscribed = channel.subscribe((status) => setRealtimeConnected(status === "SUBSCRIBED"));
    return () => {
      setRealtimeConnected(false);
      void supabase.removeChannel(subscribed);
    };
  }, [pieceId, projectId, queryClient]);

  useEffect(() => {
    // O polling é a rede de segurança: só roda enquanto há trabalho em voo e o
    // Realtime não está confirmado.
    if (realtimeConnected || !busy || !pieceId) return;
    const timer = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ["video-project", pieceId] });
    }, 3000);
    return () => clearInterval(timer);
  }, [realtimeConnected, busy, pieceId, queryClient]);

  return { ...query, realtimeConnected };
}

// ---------------------------------------------------------------------------
// Escrita — porta única `generate-video` (docs/11 §4.1)
// ---------------------------------------------------------------------------

const NOT_DEPLOYED_MESSAGE =
  "A produção de vídeo não está ativa neste ambiente. Peça ao responsável técnico para publicar o serviço generate-video e tente de novo.";

/**
 * Erro da function com o código do envelope preservado: a tela reage ao código
 * (`replicate_not_configured` vira "Conectar Replicate", não um erro).
 */
export class VideoApiError extends Error {
  code: string | null;
  constructor(message: string, code: string | null) {
    super(message);
    this.name = "VideoApiError";
    this.code = code;
  }
}

export function videoErrorCode(error: unknown): string | null {
  return error instanceof VideoApiError ? error.code : null;
}

async function invokeVideo<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke("generate-video", { body });
  if (error) {
    const status = (error as { context?: { status?: number } } | null)?.context?.status;
    if (status === 404) throw new VideoApiError(NOT_DEPLOYED_MESSAGE, "not_deployed");
    const parsed = await getFunctionError(error, fallback);
    throw new VideoApiError(parsed.message, parsed.code);
  }
  return data as T;
}

function useInvalidateProject(pieceId: string | undefined) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["video-project", pieceId] });
    void queryClient.invalidateQueries({ queryKey: ["video-estimate"] });
  };
}

export interface CreateStoryboardResult {
  project_id: string;
  status: VideoProjectStatus;
  /** Quantidade de cenas criadas (só na criação; 201). */
  scenes?: number;
  /** `true` quando já existia storyboard — a edição humana é preservada. */
  reused?: boolean;
}

/** Dirige a peça em cenas (1 chamada LLM, sem custo de mídia). */
export function useCreateStoryboard(pieceId: string | undefined) {
  const invalidate = useInvalidateProject(pieceId);
  return useMutation({
    // avatar_id: id do apresentador; null = sem apresentador (só imagens de
    // apoio); ausente = o padrão da instância.
    mutationFn: async (input: { piece_id: string; avatar_id?: string | null }) =>
      invokeVideo<CreateStoryboardResult>(
        {
          action: "create_storyboard",
          piece_id: input.piece_id,
          ...(input.avatar_id !== undefined ? { avatar_id: input.avatar_id } : {}),
        },
        "Não foi possível montar o roteiro. Tente de novo.",
      ),
    onSuccess: invalidate,
  });
}

export interface UpdateScenePatch {
  narration?: string;
  visual_prompt?: string;
  duration_target_s?: number;
  type?: VideoSceneType;
}

export interface UpdateSceneResult {
  ok: boolean;
  /** Nada mudou de fato (patch idêntico ao que já estava gravado). */
  unchanged?: boolean;
  /** A cena já tinha render e foi marcada `stale` pela edição. */
  stale?: boolean;
}

/**
 * Edita uma cena do storyboard. Editar a narração marca
 * `narration_diverged = true` e derruba o áudio: a auditoria editorial vale
 * para o texto aprovado, e o produto diz quando a cena saiu da cobertura.
 * 409 `scene_busy` quando há geração em voo.
 */
export function useUpdateScene(pieceId: string | undefined) {
  const invalidate = useInvalidateProject(pieceId);
  return useMutation({
    mutationFn: async (input: { scene_id: string; patch: UpdateScenePatch }) =>
      invokeVideo<UpdateSceneResult>(
        { action: "update_scene", scene_id: input.scene_id, patch: input.patch },
        "Não foi possível salvar a cena. Tente de novo.",
      ),
    onSuccess: invalidate,
  });
}

export interface VideoSceneEstimate {
  scene_id: string;
  scene_index: number;
  type: VideoSceneType;
  duration_s: number;
  usd: number;
}

export interface VideoEstimate {
  estimate: { total_usd: number; per_scene: VideoSceneEstimate[] };
  budget: { month_spent_usd: number; monthly_cap_usd: number };
}

export type EstimatePhase = "prep" | "video" | "all";

/**
 * Estimativa sem efeito colateral. `prep` = áudio + keyframes (centavos);
 * `video` = os vídeos das cenas + montagem (dólares).
 *
 * `retry: false` de propósito: numa instância sem `REPLICATE_API_TOKEN` a
 * function responde 400 `replicate_not_configured` — a UI mostra a mensagem do
 * envelope com link para /config em vez de girar spinner.
 */
export function useVideoEstimate(
  projectId: string | null | undefined,
  phase: EstimatePhase = "all",
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: ["video-estimate", projectId, phase],
    enabled: Boolean(projectId) && (options.enabled ?? true),
    retry: false,
    staleTime: 30_000,
    queryFn: async (): Promise<VideoEstimate> =>
      invokeVideo<VideoEstimate>(
        { action: "estimate", project_id: projectId, phase },
        "Não foi possível calcular o custo. Tente de novo.",
      ),
  });
}

export interface StartProductionResult {
  project_id: string;
  status: VideoProjectStatus;
  estimate: VideoEstimate["estimate"];
}

/** Portão de custo nº 1: gera ÁUDIO + KEYFRAMES (centavos). */
export function useStartProduction(pieceId: string | undefined) {
  const invalidate = useInvalidateProject(pieceId);
  return useMutation({
    mutationFn: async (input: string | { projectId: string; keyframeModel?: string | null }) =>
      invokeVideo<StartProductionResult>(
        typeof input === "string"
          ? { action: "start_production", project_id: input }
          : {
              action: "start_production",
              project_id: input.projectId,
              ...(input.keyframeModel ? { keyframe_model: input.keyframeModel } : {}),
            },
        "Não foi possível iniciar a produção. Tente de novo.",
      ),
    onSuccess: invalidate,
  });
}

/** Portão de custo nº 2: libera o VÍDEO das cenas (dólares). */
export function useApproveKeyframes(pieceId: string | undefined) {
  const invalidate = useInvalidateProject(pieceId);
  return useMutation({
    mutationFn: async (
      input:
        string | { projectId: string; sceneModel?: string | null; avatarModel?: string | null },
    ) =>
      invokeVideo<StartProductionResult>(
        typeof input === "string"
          ? { action: "approve_keyframes", project_id: input }
          : {
              action: "approve_keyframes",
              project_id: input.projectId,
              ...(input.sceneModel ? { scene_model: input.sceneModel } : {}),
              ...(input.avatarModel ? { avatar_model: input.avatarModel } : {}),
            },
        "Não foi possível liberar a geração das cenas. Tente de novo.",
      ),
    onSuccess: invalidate,
  });
}

export type RegenerateFrom = "audio" | "keyframe" | "video";

/** Regeneração parcial: `from` escolhe o ponto de reentrada no pipeline. */
export function useRegenerateScene(pieceId: string | undefined) {
  const invalidate = useInvalidateProject(pieceId);
  return useMutation({
    mutationFn: async (input: { scene_id: string; from: RegenerateFrom }) =>
      invokeVideo<{ ok: boolean; scene_id: string; from: RegenerateFrom }>(
        { action: "regenerate_scene", scene_id: input.scene_id, from: input.from },
        "Não foi possível refazer a cena. Tente de novo.",
      ),
    onSuccess: invalidate,
  });
}

/** Montagem final: normalize → concat → mp4 no bucket `renders`. */
export function useAssembleVideo(pieceId: string | undefined) {
  const invalidate = useInvalidateProject(pieceId);
  return useMutation({
    mutationFn: async (projectId: string) =>
      invokeVideo<{ project_id: string; status: VideoProjectStatus }>(
        { action: "assemble", project_id: projectId },
        "Não foi possível montar o vídeo final. Tente de novo.",
      ),
    onSuccess: invalidate,
  });
}

export interface CancelVideoResult {
  ok: boolean;
  cancelled: number;
  spent_usd: number;
}

/**
 * Cancela as predições em voo. Vai pela function: o RLS das tabelas de vídeo é
 * select-only para `authenticated` — nenhuma escrita direta do client.
 */
export function useCancelVideoProject(pieceId: string | undefined) {
  const invalidate = useInvalidateProject(pieceId);
  return useMutation({
    mutationFn: async (projectId: string) =>
      invokeVideo<CancelVideoResult>(
        { action: "cancel", project_id: projectId },
        "Não foi possível cancelar a produção. Tente de novo.",
      ),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Ações administrativas (Ajustes → Integrações)
// ---------------------------------------------------------------------------

export interface CatalogReportEntry {
  capability: string;
  model_id: string;
  ok: boolean;
  issues: string[];
}

export interface ValidateCatalogResult {
  checked: number;
  broken: number;
  report: CatalogReportEntry[];
}

/** Busca o signing secret no Replicate e grava no Vault (admin). */
export function useSetupReplicateWebhook() {
  return useMutation({
    mutationFn: async () =>
      invokeVideo<{ ok: boolean; webhook_configured: boolean }>(
        { action: "setup" },
        "Não foi possível configurar o aviso de conclusão do Replicate. Tente de novo.",
      ),
  });
}

/** Confere slug, schema e placeholders de cada modelo ativo (admin). */
export function useValidateVideoCatalog() {
  return useMutation({
    mutationFn: async () =>
      invokeVideo<ValidateCatalogResult>(
        { action: "validate_catalog" },
        "Não foi possível conferir os modelos do Replicate. Tente de novo.",
      ),
  });
}

// ---------------------------------------------------------------------------
// Helpers de apresentação
// ---------------------------------------------------------------------------

// Reexportado: telas do Reel importam daqui; a implementação única (mesmas 2
// casas abaixo de US$ 1 que o Reel sempre teve) mora em lib/format-usd.
export { formatUsd };

/**
 * Progresso 0–100 do conjunto de cenas. O alvo depende da fase: na fase `prep`
 * a cena chega em `keyframe_ready`; na fase `video`, em `ready`.
 */
export function sceneProgressPercent(scenes: VideoScene[], phase: "prep" | "video"): number {
  if (scenes.length === 0) return 0;
  const done = scenes.filter((scene) =>
    phase === "prep"
      ? scene.status === "keyframe_ready" || scene.status === "ready"
      : scene.status === "ready",
  ).length;
  return Math.round((done / scenes.length) * 100);
}
