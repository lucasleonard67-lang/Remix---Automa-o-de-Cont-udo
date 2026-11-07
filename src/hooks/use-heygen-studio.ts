import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { kickDirector } from "@/hooks/use-director-jobs";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { withDriveGate } from "@/lib/drive-gate";
import { getFunctionError } from "@/lib/edge-functions";
import { avatarCreateCostLabel } from "@/lib/heygen-avatar";

// ---------------------------------------------------------------------------
// Estúdios HeyGen do hub (docs/hub-motor-contratos.md, frente B):
// §1 avatar fala o roteiro · §2 foto vira apresentador · §3 Digital Twin ·
// §4 Video Agent. Avatares, looks e consentimento são ações do `avatar-studio`;
// os vídeos são `director_jobs` com `config.mode` novo.
//
// Antes do deploy do motor, o avatar-studio responde "Ação desconhecida": a
// tela mostra isso como "chega no próximo deploy" e o Gerar fica desligado —
// um job com modo novo num motor antigo cairia no pipeline de cenas e gastaria.
// ---------------------------------------------------------------------------

export type HeygenEngine = "avatar_v" | "avatar_iv" | "avatar_iii";

export interface HeygenLook {
  id: string;
  name: string;
  group_id: string | null;
  avatar_type: "studio_avatar" | "digital_twin" | "photo_avatar";
  preview_image_url: string | null;
  preview_video_url: string | null;
  gender: string | null;
  default_voice_id: string | null;
  supported_api_engines: HeygenEngine[];
  preferred_orientation: "portrait" | "landscape" | "square" | null;
  status: "processing" | "pending_consent" | "completed" | "failed" | null;
}

export type HeygenAvatarStatus = "processing" | "pending_consent" | "completed" | "failed";

/** Visual extra do mesmo avatar (§8.4). */
export interface HeygenExtraLook {
  id: string;
  status: HeygenAvatarStatus;
  preview_image_url: string | null;
  supported_api_engines: HeygenEngine[];
  source: "prompt" | "look_pack" | "template";
}

/**
 * `brand_avatars.provider_refs.heygen` (§8.1). O formato antigo (29/10) tinha
 * `engines` no lugar de `supported_api_engines` e não tinha `preview_image_url`:
 * leia os motores com `refEngines`.
 */
export interface HeygenRef {
  type: "photo" | "digital_twin" | "prompt";
  group_id: string | null;
  look_id: string;
  status: HeygenAvatarStatus;
  supported_api_engines?: HeygenEngine[];
  /** formato antigo */
  engines?: HeygenEngine[];
  preview_image_url?: string | null;
  default_voice_id: string | null;
  consent_status: "pending" | "accepted" | "rejected" | null;
  consent_url: string | null;
  consent_url_at: number | null;
  error: string | null;
  ready: boolean;
  looks?: HeygenExtraLook[];
  attempt?: number;
  consent_attempt?: number;
  updated_at: string;
}

/** Motores aceitos pela look principal, nos dois formatos do registro. */
export function refEngines(ref: Pick<HeygenRef, "supported_api_engines" | "engines">) {
  return ref.supported_api_engines ?? ref.engines ?? [];
}

/** Algum visual extra ainda está sendo gerado? */
export function looksProcessing(ref: HeygenRef | null | undefined): boolean {
  return (ref?.looks ?? []).some((look) => look.status === "processing");
}

/** O estado ainda muda sozinho (vale a pena perguntar de novo)? */
export function heygenSettling(ref: HeygenRef | null | undefined): boolean {
  if (!ref) return false;
  return (!ref.ready && ref.status !== "failed") || looksProcessing(ref);
}

export const ENGINE_LABEL: Record<HeygenEngine, string> = {
  avatar_iv: "Avatar IV",
  avatar_v: "Avatar V",
  avatar_iii: "Avatar III · 4K",
};

/** Motor ainda sem as ações HeyGen (deploy pendente). */
export class EngineNotDeployedError extends Error {
  constructor() {
    super("Em preparação.");
    this.name = "EngineNotDeployedError";
  }
}

/** A HeyGen não está conectada (412 not_connected). */
export class HeygenNotConnectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeygenNotConnectedError";
  }
}

async function invokeStudio<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke("avatar-studio", { body });
  if (error) {
    const status = (error as { context?: { status?: number } } | null)?.context?.status;
    const { message, code } = await getFunctionError(error, fallback);
    // 404 sem envelope = função não publicada; com envelope é do motor ("Apresentador não encontrado.")
    if (status === 404 && code === null) {
      throw new EngineNotDeployedError();
    }
    if (/ação desconhecida/i.test(message)) throw new EngineNotDeployedError();
    if (code === "not_connected" || status === 412) throw new HeygenNotConnectedError(message);
    throw new Error(message);
  }
  return data as T;
}

export type HeygenEngineState = "checking" | "ready" | "not_deployed" | "not_connected" | "error";

/**
 * O motor tem as ações HeyGen e a chave está salva? Uma leitura barata (1 look
 * da biblioteca) responde as duas coisas antes de qualquer gasto.
 */
export function useHeygenEngine(enabled = true): { state: HeygenEngineState; message: string } {
  const probe = useQuery({
    queryKey: ["heygen", "probe"],
    enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: () =>
      invokeStudio<{ looks: HeygenLook[] }>(
        { action: "heygen_looks", ownership: "public", limit: 1 },
        "Não foi possível falar com a HeyGen.",
      ),
  });
  if (probe.isPending) return { state: "checking", message: "" };
  if (probe.isSuccess) return { state: "ready", message: "" };
  const err = probe.error;
  if (err instanceof EngineNotDeployedError) return { state: "not_deployed", message: err.message };
  if (err instanceof HeygenNotConnectedError)
    return { state: "not_connected", message: err.message };
  return { state: "error", message: err?.message ?? "Não foi possível falar com a HeyGen." };
}

/** Looks HeyGen: biblioteca (public) ou meus (private), com "ver mais". */
export function useHeygenLooks(ownership: "public" | "private", enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["heygen", "looks", ownership],
    enabled,
    // as prévias da HeyGen expiram: lista nova a cada abertura
    staleTime: 0,
    retry: false,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      invokeStudio<{ looks: HeygenLook[]; next_token: string | null }>(
        {
          action: "heygen_looks",
          ownership,
          limit: 24,
          ...(pageParam ? { token: pageParam } : {}),
        },
        "Não foi possível listar os avatares da HeyGen.",
      ),
    getNextPageParam: (last) => last.next_token ?? null,
  });
}

/**
 * Estado do avatar HeyGen de um apresentador (§3 passo 4): a cada 10 s
 * enquanto não está pronto. `brand_avatars` não está no Realtime.
 */
export function useHeygenStatus(avatarId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["heygen", "status", avatarId],
    enabled: enabled && avatarId !== null,
    retry: false,
    queryFn: async () => {
      const result = await invokeStudio<{ heygen: HeygenRef | null }>(
        { action: "heygen_status", avatar_id: avatarId },
        "Não foi possível ler o estado do avatar na HeyGen.",
      );
      if (result.heygen && !heygenSettling(result.heygen)) {
        void queryClient.invalidateQueries({ queryKey: ["avatars"] });
        void queryClient.invalidateQueries({ queryKey: ["heygen", "looks", "private"] });
      }
      return result.heygen ?? null;
    },
    // a cada 10 s enquanto a look principal ou um visual novo estão em andamento (§8.3)
    refetchInterval: (query) => (heygenSettling(query.state.data) ? 10_000 : false),
  });
}

function useHeygenAction<I extends Record<string, unknown>>(action: string, fallback: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: I) =>
      (await invokeStudio<{ heygen: HeygenRef }>({ action, ...input }, fallback)).heygen,
    onSuccess: (heygen, input) => {
      const id = (input as { avatar_id?: string }).avatar_id;
      queryClient.setQueryData(["heygen", "status", id], heygen);
      void queryClient.invalidateQueries({ queryKey: ["avatars"] });
      void queryClient.invalidateQueries({ queryKey: ["heygen", "looks", "private"] });
    },
  });
}

/** §2.1: cadastra a foto do apresentador na HeyGen (uma vez). */
export function useHeygenPhotoAvatar() {
  return useHeygenAction<{ avatar_id: string }>(
    "heygen_photo_avatar",
    "Não foi possível preparar a foto na HeyGen.",
  );
}

/** §3 passo 2: cria o Digital Twin a partir do vídeo enviado. */
export function useHeygenTwin() {
  return useHeygenAction<{ avatar_id: string; video_path: string }>(
    "heygen_twin",
    "Não foi possível criar o clone na HeyGen.",
  );
}

/** §3 passo 3: novo link de consentimento (vale 24 h). */
export function useHeygenConsentLink() {
  return useHeygenAction<{ avatar_id: string }>(
    "heygen_consent_link",
    "Não foi possível gerar o link de autorização.",
  );
}

// ── construtor de avatar (§8) ───────────────────────────────────────────────

export const PROMPT_AVATAR_MAX = 1000;
export const PROMPT_AVATAR_REFS = 3;
export type HeygenAspect = "auto" | "16:9" | "9:16" | "1:1" | "4:5" | "5:4";

/**
 * As ações do construtor (§8) chegaram ao motor? O `heygen_looks` do probe
 * geral é mais antigo: um pedido vazio ao `heygen_prompt_avatar` responde
 * "Ação desconhecida" no motor antigo e um erro de validação no novo, sem gastar.
 */
export function useHeygenBuilderEngine(enabled = true): {
  state: HeygenEngineState;
  message: string;
} {
  const base = useHeygenEngine(enabled);
  const probe = useQuery({
    queryKey: ["heygen", "probe", "builder"],
    enabled: enabled && base.state === "ready",
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      try {
        await invokeStudio({ action: "heygen_prompt_avatar" }, "");
      } catch (err) {
        if (err instanceof EngineNotDeployedError) return false;
      }
      return true;
    },
  });
  if (base.state !== "ready") return base;
  if (probe.isPending) return { state: "checking", message: "" };
  if (probe.data === false)
    return { state: "not_deployed", message: new EngineNotDeployedError().message };
  return base;
}

/**
 * §8.2: avatar por descrição, com até 3 fotos de referência. Com `regenerate`,
 * o motor apaga o avatar e cria outro com o que foi salvo; um campo mandado
 * substitui o salvo.
 */
export function useHeygenPromptAvatar() {
  return useHeygenAction<{
    avatar_id: string;
    regenerate?: boolean;
    prompt?: string;
    reference_paths?: string[];
    aspect_ratio?: HeygenAspect;
  }>("heygen_prompt_avatar", "Não foi possível criar o avatar na HeyGen.");
}

export type NewLookInput =
  | { avatar_id: string; mode: "prompt"; prompt: string; aspect_ratio?: HeygenAspect }
  | {
      avatar_id: string;
      mode: "look_pack" | "template";
      template_id: string;
      aspect_ratio?: "16:9" | "9:16";
    };

/** §8.4: visual novo do mesmo avatar, por descrição ou por pacote. */
export function useHeygenNewLook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewLookInput) =>
      invokeStudio<{ heygen: HeygenRef; new_look_ids: string[] }>(
        { action: "heygen_new_look", ...input },
        "Não foi possível criar o visual novo.",
      ),
    onSuccess: ({ heygen }, input) => {
      queryClient.setQueryData(["heygen", "status", input.avatar_id], heygen);
      void queryClient.invalidateQueries({ queryKey: ["avatars"] });
    },
  });
}

export interface LookTemplate {
  id: string;
  type: "look_pack" | "template";
  name: string;
  gender: string | null;
  preview_image_url: string | null;
  looks_count: number | null;
}

/** §8.4: pacotes de visuais da HeyGen (só quando a pessoa abre "Por pacote"). */
export function useHeygenLookTemplates(enabled: boolean) {
  return useQuery({
    queryKey: ["heygen", "look-templates"],
    enabled,
    // as prévias expiram
    staleTime: 0,
    retry: false,
    queryFn: () =>
      invokeStudio<{ templates: LookTemplate[]; next_token: string | null }>(
        { action: "heygen_look_templates", limit: 12 },
        "Não foi possível listar os pacotes de visuais.",
      ),
  });
}

/** §8.5: apaga o avatar na HeyGen (e a voz clonada, no twin). O apresentador fica. */
export function useHeygenDelete() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { avatar_id: string }) =>
      invokeStudio<{
        ok: boolean;
        deleted: { group: string | null; look: string | null; voice: string | null };
      }>({ action: "heygen_delete", ...input }, "Não foi possível apagar o avatar na HeyGen."),
    onSuccess: (_result, input) => {
      queryClient.setQueryData(["heygen", "status", input.avatar_id], null);
      void queryClient.invalidateQueries({ queryKey: ["avatars"] });
      void queryClient.invalidateQueries({ queryKey: ["heygen", "looks", "private"] });
    },
  });
}

export type VoiceTest = { provider: "elevenlabs" | "heygen" | "twin"; voice_id?: string };

/** §8.6: amostra da voz (ElevenLabs, HeyGen ou a do clone). Mesmo pedido = mesmo arquivo. */
export function useHeygenVoicePreview() {
  return useMutation({
    mutationFn: (input: { voice: VoiceTest; avatar_id?: string; text?: string }) =>
      invokeStudio<{ url: string; path: string; cached: boolean }>(
        { action: "heygen_voice_preview", ...input },
        "Não foi possível gerar a amostra da voz.",
      ),
  });
}

export interface HeygenVoice {
  voice_id: string;
  name: string;
  language: string | null;
  gender: string | null;
  preview_audio_url: string | null;
}

/** §1.2: vozes da HeyGen em português (só quando a pessoa escolhe "voz HeyGen"). */
export function useHeygenVoices(enabled: boolean) {
  return useQuery({
    queryKey: ["heygen", "voices", "pt"],
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () =>
      invokeStudio<{ voices: HeygenVoice[]; next_token: string | null }>(
        { action: "heygen_voices", language: "Portuguese", type: "public", limit: 50 },
        "Não foi possível listar as vozes da HeyGen.",
      ),
  });
}

const CLONE_PAGE = 100;
/** Trava de segurança da paginação: 1.000 vozes. */
const CLONE_MAX_PAGES = 10;

/** Todas as vozes clonadas da conta HeyGen (`type=private`, página a página). */
export function useHeygenClones(enabled: boolean) {
  return useQuery({
    queryKey: ["heygen", "voices", "private"],
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<HeygenVoice[]> => {
      const all: HeygenVoice[] = [];
      let token: string | null = null;
      for (let page = 0; page < CLONE_MAX_PAGES; page++) {
        const result: { voices: HeygenVoice[]; next_token: string | null } = await invokeStudio(
          {
            action: "heygen_voices",
            type: "private",
            limit: CLONE_PAGE,
            ...(token ? { token } : {}),
          },
          "Não foi possível listar as vozes clonadas da HeyGen.",
        );
        all.push(...result.voices);
        token = result.next_token;
        if (!token) break;
      }
      return all;
    },
  });
}

/** A voz padrão do avatar quando a look não a traz: fica no grupo (`GET /v3/avatars/{id}`). */
export function useHeygenGroupVoice(groupId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["heygen", "group-voice", groupId],
    enabled: enabled && Boolean(groupId),
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () =>
      invokeStudio<{ default_voice_id: string | null }>(
        { action: "heygen_group_voice", group_id: groupId },
        "Não foi possível conferir a voz do avatar.",
      ),
  });
}

/** Linhas `avatar_create` da HeyGen no catálogo (heygen/avatar-photo, -digital-twin, -prompt, -look). */
export type AvatarCreateModel =
  | "heygen/avatar-photo"
  | "heygen/avatar-digital-twin"
  | "heygen/avatar-prompt"
  | "heygen/avatar-look";

/**
 * Custo de criar cada tipo de avatar, do catálogo. Preço não conferido
 * (`cost.verified = false`), sem linha ou sem número → "preço a confirmar";
 * nunca "grátis".
 */
export function useAvatarCreateCosts(): Record<AvatarCreateModel, string> {
  const query = useQuery({
    queryKey: ["video-models", "avatar_create", "heygen"],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("video_models")
        .select("model_id, cost")
        .eq("active", true)
        .eq("capability", "avatar_create")
        .filter("provider", "eq", "heygen");
      if (error) return [];
      return (data ?? []) as { model_id: string; cost: unknown }[];
    },
  });
  const label = (id: AvatarCreateModel) =>
    avatarCreateCostLabel((query.data ?? []).find((r) => r.model_id === id));
  return {
    "heygen/avatar-photo": label("heygen/avatar-photo"),
    "heygen/avatar-digital-twin": label("heygen/avatar-digital-twin"),
    "heygen/avatar-prompt": label("heygen/avatar-prompt"),
    "heygen/avatar-look": label("heygen/avatar-look"),
  };
}

// ── vídeos (director_jobs) ──────────────────────────────────────────────────

export interface AvatarVideoRequest {
  provider: "heygen" | "replicate";
  look_id?: string;
  presenter_id?: string;
  model_id?: string;
  script: string;
  /** `brand_voice_id`: uma voz de Marca → Vozes; vale antes de `voice_id` (§9.5) */
  voice?: { provider: "elevenlabs" | "heygen"; voice_id?: string; brand_voice_id?: string };
  engine?: HeygenEngine;
  aspect_ratio?: "9:16" | "1:1" | "4:5" | "16:9";
  resolution?: "720p" | "1080p" | "4k";
  /** Roteiro escrito pelo Claude da pessoa: o plano de produção segue com o vídeo e, pronto, vira o pedido de montagem. */
  roteiro_pedido_id?: string;
  plano?: PlanoDeProducao;
}

export interface VideoAgentRequest {
  prompt: string;
  presenter_id?: string;
  look_id?: string;
  orientation?: "portrait" | "landscape";
  brand_kit?: boolean;
  /** só voz HeyGen de catálogo (§9.5) */
  brand_voice_id?: string;
  /** voz da conta HeyGen, direto em voice_id */
  voice_id?: string;
}

import type { PlanoDeProducao } from "@/hooks/use-roteiro-pedidos";

export type StudioJobConfig =
  | { mode: "avatar_video"; captions?: boolean; avatar_video: AvatarVideoRequest }
  | { mode: "video_agent"; captions?: boolean; video_agent: VideoAgentRequest };

export const AVATAR_SCRIPT_MAX = 5000;
export const AGENT_PROMPT_MAX = 10000;

/** Enfileira um vídeo de avatar ou do Video Agent (§1.3, §4.2). */
export function useCreateStudioJob() {
  const queryClient = useQueryClient();
  const { isAdmin } = useIsAdmin();
  return useMutation({
    mutationFn: async (input: { title: string; config: StudioJobConfig }) => {
      const { data, error } = await withDriveGate(() =>
        supabase
          .from("director_jobs")
          .insert({
            brief: { title: input.title } as unknown as Json,
            config: input.config as unknown as Json,
          })
          .select("id")
          .single(),
      );
      if (error) throw new Error(error.message);
      return { id: (data as { id: string }).id };
    },
    onSuccess: () => {
      if (isAdmin) void kickDirector();
      return queryClient.invalidateQueries({ queryKey: ["director-jobs"] });
    },
  });
}

/** Título do job a partir do texto: a primeira frase, curta. */
export function titleFrom(text: string): string {
  const first = text.trim().split(/(?<=[.!?])\s|\n/)[0] ?? "";
  return first.length > 80 ? `${first.slice(0, 77).trimEnd()}…` : first || "Vídeo";
}
