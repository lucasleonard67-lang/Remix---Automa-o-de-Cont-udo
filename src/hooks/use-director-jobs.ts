import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useIsAdmin } from "@/hooks/use-is-admin";
import type { VideoEngine } from "@/hooks/use-video-models";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { withDriveGate } from "@/lib/drive-gate";
import { signedUrl } from "@/lib/storage-restore";

// ---------------------------------------------------------------------------
// Jobs do agente-diretor (worker externo — worker/README.md).
// A tabela director_jobs é a fila e a máquina de estados; o worker produz e a
// UI cria jobs, acompanha via Realtime e aprova os gates (awaiting_*).
// ---------------------------------------------------------------------------

export interface DirectorBrief {
  objetivo: string;
  publico: string;
  smp: string;
  numero_heroi: string;
  tom: string;
  cta: string;
  duracao_alvo_s: number;
  formato: string;
  identity_ref?: string | null;
  /** Apresentador: id em brand_avatars (legado: director_identities); precede identity_ref */
  identity_id?: string | null;
  mandatorios?: string[];
  /** título dos jobs sem briefing (avatar_video, video_agent: só o título) */
  title?: string;
}

export interface TikTokPublishConfig {
  mode: "DIRECT_POST" | "UPLOAD_TO_DRAFT";
  title?: string;
  privacy_level?: string;
  music_sound_id?: string;
  music_volume?: number;
  original_volume?: number;
  confirmed: boolean;
  /** carimbo do clique — o edge usa pra distinguir pedido novo de retomada pós-crash */
  requested_at?: number;
}

export interface DirectorConfig {
  max_shots: number;
  budget_credits: number;
  auto_approve_keyframes: boolean;
  auto_approve_audio: boolean;
  skip_video: boolean;
  captions?: boolean;
  captions_style?: CaptionStyle;
  captions_position?: CaptionPosition;
  captions_accent?: string;
  /** experimento multi-cena: gera o 1º grupo também no kling3_0 720p pra comparação */
  ab_kling?: boolean;
  /** motor das cenas (ausente = Higgsfield, compatível com jobs antigos) */
  engine?: VideoEngine;
  /** modelo das cenas no motor escolhido (ausente = padrão do motor) */
  model_id?: string | null;
  /** resolução das cenas do Replicate; o servidor ajusta ao modelo (padrão 720p) */
  resolution?: "720p" | "1080p" | "4k";
  /** modelo da cena extra (A/B); pode ser do outro motor */
  ab_model_id?: string | null;
  /** motor do modelo da cena extra (ausente em jobs antigos: o servidor infere pelo id) */
  ab_engine?: VideoEngine | null;
  tiktok?: TikTokPublishConfig;
  /**
   * "remake" = Melhorar um vídeo meu (ver supabase/functions/_shared/remake.ts);
   * "avatar_video" / "video_agent" = estúdios HeyGen (docs/hub-motor-contratos.md)
   */
  mode?: "remake" | "avatar_video" | "video_agent";
  remake?: RemakeConfig;
}

/** Pedido de "Melhorar um vídeo meu" — espelho de RemakeConfig do servidor. */
export interface RemakeConfig {
  source_path: string;
  duration_s: number;
  style?: string | null;
  scene?: string | null;
  character_identity_id?: string | null;
  /** instrução opcional da troca de pessoa (até 500 caracteres) */
  character_prompt?: string | null;
  /** modelo de troca de pessoa (person_swap) escolhido; null = primário do catálogo */
  person_model_id?: string | null;
  speech?: string | null;
  translate?: string | null;
  /** idioma falado no vídeo enviado (ISO-639-1: pt, en, es); orienta as legendas */
  source_language?: string | null;
  /** modelo vídeo→vídeo escolhido na lista (null = primário do catálogo) */
  scene_model_id?: string | null;
  /** modelo de voz do catálogo (null = ElevenLabs, a voz da marca) */
  tts_model_id?: string | null;
  /** quadro do vídeo: fala que não cabe vira "foto que fala" do HeyGen */
  speech_frame_path?: string | null;
  /** voz da fala nova: o gênero de quem aparece no vídeo */
  voice_gender?: "female" | "male" | "own" | "custom" | null;
  /** Voice ID do ElevenLabs escolhido pela pessoa (voice_gender "custom") */
  voice_id?: string | null;
  /** voz de Marca → Vozes (voice_gender "custom"); vale antes de voice_id (§9.5) */
  brand_voice_id?: string | null;
  /** quem aparece no vídeo (perguntado na tela): voz de reserva se o clone não for possível */
  person_gender?: "female" | "male" | null;
  /** amostra da voz de quem fala (WAV tirado do próprio vídeo) para clonar */
  voice_sample_path?: string | null;
}

export function isRemakeJob(job: Pick<DirectorJob, "config">): boolean {
  return job.config?.mode === "remake";
}

/** Rótulo do status; o modo remake não tem roteiro nem cenas. */
export function directorStatusLabel(
  job: Pick<DirectorJob, "status" | "config"> & { artifacts?: unknown },
): string {
  // sem o Higgsfield, a montagem e a legenda esperam o Claude da pessoa
  if ((job.artifacts as { claude?: unknown } | undefined)?.claude) return "Esperando o seu Claude";
  // estúdios HeyGen (§1.6 e §4.3 do contrato do motor)
  if (job.config?.mode === "avatar_video") {
    if (job.status === "queued") return "Preparando o apresentador";
    if (job.status === "tts") return "Gravando a voz";
    if (job.status === "videos") return "O apresentador está gravando";
    if (job.status === "muxing") return "Finalizando";
  }
  if (job.config?.mode === "video_agent") {
    if (job.status === "queued") return "Preparando a marca";
    if (job.status === "videos") return "O agente está criando o vídeo";
    if (job.status === "muxing") return "Finalizando";
  }
  if (isRemakeJob(job)) {
    if (job.status === "queued") return "Na fila";
    if (job.status === "videos") return "Melhorando o vídeo";
    if (job.status === "muxing") return "Finalizando";
  }
  return DIRECTOR_STATUS_LABEL[job.status] ?? job.status;
}

export const CAPTION_STYLE_OPTIONS = [
  { value: "caps", label: "Clássico — caixa alta com contorno" },
  { value: "karaoke", label: "Destaque por palavra" },
  { value: "build", label: "Palavra por palavra (vai montando)" },
  { value: "pop", label: "Pop — frase entra com zoom" },
  { value: "box", label: "Caixa colorida" },
  { value: "neon", label: "Neon com brilho" },
  { value: "minimal", label: "Discreto — frases inteiras, fonte fina" },
] as const;
export type CaptionStyle = (typeof CAPTION_STYLE_OPTIONS)[number]["value"];

export const CAPTION_POSITION_OPTIONS = [
  { value: "bottom", label: "Embaixo" },
  { value: "center", label: "Centro" },
  { value: "top", label: "Em cima" },
] as const;
export type CaptionPosition = (typeof CAPTION_POSITION_OPTIONS)[number]["value"];

export interface DirectorShotPlan {
  idx: number;
  role: string;
  speech: string;
  scale: string;
  with_character: boolean;
  /** 0 = shot avulso; >0 = grupo multi-cena (uma geração só com corte interno) */
  sequence_group?: number;
}

export interface DirectorTikTokState {
  status?: string; // processing | published | error
  publish_id?: string;
  mode?: string;
  url?: string | null;
  error?: string | null;
}

/** Reel no Instagram via Zernio (zernio-proxy publish-director). */
export interface DirectorInstagramState {
  status: "pending" | "publishing" | "published" | "failed";
  url?: string | null;
  error?: string | null;
  zernio_post_id?: string | null;
}

export interface DirectorArtifacts {
  tts?: { shot: number; path: string; mp3: string; dur_s: number }[];
  keyframes?: { shot: number; path: string; hf_url?: string }[];
  videos?: { shot: number; path: string; dur_s: number; cta?: boolean; members?: number[] }[];
  /** cenas submetidas e ainda rodando no provedor (Higgsfield ou Replicate) */
  pending_vid?: {
    shot?: number;
    /** grupo multi-cena: todas as cenas que esta geração cobre */
    members?: number[];
    hf_job?: string;
    rp_id?: string;
    submitted_at?: number;
  }[];
  /** espera por concorrência da conta Higgsfield (ver director-advance) */
  hf_busy_since?: number;
  ab_videos?: { group: number; path: string; model: string }[];
  ab_error?: string;
  final?: string;
  master?: string;
  /** Aprimorar com IA pronto (§11.6): a versão editada; `final` nunca muda */
  edited?: { edit_id: string; path: string };
  /** modo remake: vídeo atual e etapas feitas */
  remake?: { current: string; done: string[]; pending?: unknown };
  preview_audio?: string;
  tiktok?: DirectorTikTokState;
  instagram?: DirectorInstagramState;
}

export interface DirectorJob {
  id: string;
  brief: DirectorBrief;
  config: Partial<DirectorConfig>;
  status: string;
  plan: { concept?: string; shots?: DirectorShotPlan[] } | null;
  artifacts: DirectorArtifacts;
  costs: { hf_credits_start?: number; hf_credits_spent?: number; eleven_chars?: number };
  error: string | null;
  created_at: string;
  updated_at: string;
}

export const DIRECTOR_STATUS_LABEL: Record<string, string> = {
  queued: "Na fila",
  planning: "Escrevendo roteiro",
  plan_ready: "Roteiro pronto",
  tts: "Gerando narração",
  keyframes: "Gerando quadros",
  awaiting_keyframe_approval: "Quadros para aprovar",
  videos: "Gerando cenas",
  muxing: "Montando o vídeo",
  concatenating: "Montando o vídeo",
  bed: "Montando o vídeo",
  assembling: "Montando o vídeo",
  awaiting_audio_approval: "Som para aprovar",
  mastering: "Finalizando o áudio",
  publishing: "Publicando no TikTok",
  done: "Concluído",
  failed: "Falhou",
  canceled: "Cancelado",
};

const ACTIVE_STATUSES = [
  "queued",
  "planning",
  "plan_ready",
  "tts",
  "keyframes",
  "videos",
  "muxing",
  "concatenating",
  "bed",
  "assembling",
  "mastering",
  "publishing",
];

export function isJobActive(job: DirectorJob): boolean {
  return ACTIVE_STATUSES.includes(job.status);
}

export function useDirectorJobs(enabled = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel("director-jobs")
      .on("postgres_changes", { event: "*", schema: "public", table: "director_jobs" }, () =>
        queryClient.invalidateQueries({ queryKey: ["director-jobs"] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, enabled]);

  return useQuery({
    queryKey: ["director-jobs"],
    enabled,
    // sem Realtime (publicação vazia num Remix) a lista congelava; com job
    // ativo relê a cada 6 s
    refetchInterval: (query) =>
      (query.state.data ?? []).some((job) => isJobActive(job)) ? 6000 : false,
    queryFn: async (): Promise<DirectorJob[]> => {
      const { data, error } = await supabase
        .from("director_jobs")
        .select("*")
        // vídeo excluído fica só para o centro de custos
        .is("config->>excluido_em", null)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as DirectorJob[];
    },
  });
}

/**
 * Um job só, para acompanhar a produção dentro do fluxo de configuração.
 * Realtime na linha + releitura a cada 5 s enquanto o canal não conecta.
 */
export function useDirectorJob(id: string | undefined) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`director-job-${id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "director_jobs", filter: `id=eq.${id}` },
        () => queryClient.invalidateQueries({ queryKey: ["director-jobs", id] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id, queryClient]);
  return useQuery({
    queryKey: ["director-jobs", id],
    enabled: Boolean(id),
    refetchInterval: 5000,
    queryFn: async (): Promise<DirectorJob | null> => {
      const { data, error } = await supabase
        .from("director_jobs")
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as unknown as DirectorJob) ?? null;
    },
  });
}

/**
 * Cutuca o motor (edge director-advance). A edge só aceita x-cron-secret ou
 * JWT de ADMIN: quem chama confere o papel antes. Nunca lança — devolve se o
 * motor respondeu 2xx. O cron segue sendo o caminho oficial.
 */
export async function kickDirector(): Promise<boolean> {
  try {
    const { error } = await supabase.functions.invoke("director-advance", { body: {} });
    return !error;
  } catch {
    return false;
  }
}

export function useCreateDirectorJob() {
  const queryClient = useQueryClient();
  const { isAdmin } = useIsAdmin();
  return useMutation({
    mutationFn: async (input: {
      brief: DirectorBrief;
      config: DirectorConfig;
    }): Promise<{ id: string }> => {
      const { data, error } = await withDriveGate(() =>
        supabase
          .from("director_jobs")
          .insert({
            brief: input.brief as unknown as Json,
            config: input.config as unknown as Json,
          })
          .select("id")
          .single(),
      );
      if (error) throw new Error(error.message);
      return { id: (data as { id: string }).id };
    },
    onSuccess: () => {
      // só admin passa na edge; para os demais, o cron cuida
      if (isAdmin) void kickDirector();
      return queryClient.invalidateQueries({ queryKey: ["director-jobs"] });
    },
  });
}

/** Aprova o gate atual (keyframes → videos · som → done) ou cancela o job. */
export function useUpdateDirectorJobStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status: string; fromStatus: string }) => {
      // guard otimista: aba stale não pode ressuscitar job cancelado (nem o inverso)
      const { data, error } = await supabase
        .from("director_jobs")
        .update({ status: input.status, error: null })
        .eq("id", input.id)
        .eq("status", input.fromStatus)
        .select("id");
      if (error) throw new Error(error.message);
      if (!data?.length)
        throw new Error("Este vídeo mudou de etapa enquanto você olhava. Recarregue a página.");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["director-jobs"] }),
  });
}

/** Reenfileira um job que falhou, retomando do checkpoint mais avançado (lane edge-aware). */
export function useRetryDirectorJob() {
  const queryClient = useQueryClient();
  const { isAdmin } = useIsAdmin();
  return useMutation({
    mutationFn: async (job: DirectorJob) => {
      const arts = (job.artifacts ?? {}) as DirectorArtifacts;
      // Com grupos multi-cena, contagem de vídeos por shot não vale mais; os passos
      // são idempotentes e re-checam completude sozinhos — basta voltar pro degrau
      // mais avançado com artefato presente (um tick extra no pior caso).
      const resume =
        arts.final || arts.master
          ? "muxing"
          : isRemakeJob(job)
            ? // remake: as etapas feitas ficam em arts.remake.done — retoma de onde parou
              arts.remake
              ? "videos"
              : "queued"
            : arts.videos?.length || arts.pending_vid?.length
              ? "videos"
              : arts.keyframes?.length
                ? "keyframes"
                : arts.tts?.length
                  ? "tts"
                  : "queued";
      // pendings de montagem são limpos: itens falhos já foram removidos pelo
      // executor e o passo resubmete só o que falta. pending_kf/pending_vid FICAM:
      // são gerações pagas no Higgsfield que seguem rodando com o job failed —
      // limpá-las re-pagava cada clipe já cobrado. pending_ab/pending_pub idem.
      const cleaned = { ...(job.artifacts as Record<string, unknown>) };
      for (const k of [
        "pending_mux",
        "pending_concat",
        "pending_bed",
        "pending_asm",
        "pending_burn",
      ]) {
        delete cleaned[k];
      }
      // guard: só retoma job que AINDA está failed (aba stale não pode sobrescrever
      // artifacts de um job já reclamado — perderia checkpoints de submissões pagas)
      const { data, error } = await supabase
        .from("director_jobs")
        .update({
          status: resume,
          error: null,
          claimed_at: null,
          claimed_by: null,
          artifacts: cleaned as unknown as Json,
        })
        .eq("id", job.id)
        .eq("status", "failed")
        .select("id");
      if (error) throw new Error(error.message);
      if (!data?.length)
        throw new Error("Este vídeo já foi retomado. Recarregue a página para ver a etapa atual.");
    },
    onSuccess: () => {
      // só admin passa na edge; para os demais, o cron cuida
      if (isAdmin) void kickDirector();
      return queryClient.invalidateQueries({ queryKey: ["director-jobs"] });
    },
  });
}

export async function directorSignedUrl(
  path: string,
  expiresIn = 3600,
  options: { restore?: boolean } = {},
): Promise<string> {
  return await signedUrl("renders", path, expiresIn, options);
}

// ---------------------------------------------------------------------------
// Publicação TikTok
// ---------------------------------------------------------------------------

/** Ações interativas da edge director-publish (conta, OAuth, músicas trending). */
export async function directorPublishAction<T = Record<string, unknown>>(
  action: "accounts" | "connect" | "music",
  extra: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("director-publish", {
    body: { action, ...extra },
  });
  if (error) {
    // FunctionsHttpError esconde o body — recupera a mensagem real da edge
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const body = (await ctx.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (body?.error?.message) throw new Error(body.error.message);
    }
    throw new Error(error.message);
  }
  if (data?.error) throw new Error(data.error.message ?? String(data.error));
  return data as T;
}

/** Enfileira a publicação: grava config.tiktok e muda o job pra 'publishing' (o cron faz o resto). */
export function usePublishTikTok() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { job: DirectorJob; tiktok: TikTokPublishConfig }) => {
      // requested_at distingue pedido novo de retomada ambígua pós-crash no edge
      const config = {
        ...(input.job.config ?? {}),
        tiktok: { ...input.tiktok, requested_at: Date.now() },
      };
      const { data, error } = await supabase
        .from("director_jobs")
        .update({ config: config as unknown as Json, status: "publishing", error: null })
        .eq("id", input.job.id)
        .eq("status", "done")
        .select("id");
      if (error) throw new Error(error.message);
      if (!data?.length)
        throw new Error("Este vídeo não está mais concluído. Recarregue a página.");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["director-jobs"] }),
  });
}
