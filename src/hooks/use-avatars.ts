import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { HeygenRef } from "@/hooks/use-heygen-studio";
import { getFunctionErrorMessage } from "@/lib/edge-functions";

// ---------------------------------------------------------------------------
// Apresentadores (brand_avatars — docs/11-video-replicate.md §2.2 e §4.4).
//
// Cadastro ÚNICO de quem aparece e fala nos vídeos, tanto no Reel (Replicate)
// quanto no Diretor (Higgsfield). Cada motor é preparado sob demanda e guarda o
// resultado em `provider_refs`; a tela nunca mostra isso.
//
// O avatar é um ativo da MARCA: gerado uma vez e reusado em N vídeos. O que
// sustenta isso é o `identity_pack_paths` — o conjunto de retratos que vai como
// referência para o modelo de keyframe a cada cena, mantendo o mesmo rosto.
//
// As imagens vivem no bucket `brand-assets` (privado), NÃO em `renders`.
// ---------------------------------------------------------------------------

export const AVATAR_BUCKET = "brand-assets";

const NOT_DEPLOYED_MESSAGE =
  "O estúdio de avatares não está ativo neste ambiente. Peça ao responsável técnico " +
  "para publicar o serviço avatar-studio e tente de novo.";

export interface AvatarVoice {
  provider?: string;
  voice_id?: string;
  language_boost?: string;
  /** voz do ElevenLabs colada no cadastro; vale no lugar de voice_id quando há */
  elevenlabs_voice_id?: string | null;
  /**
   * Voz dos vídeos HeyGen escolhida no construtor de avatar: a do clone, uma
   * voz do ElevenLabs ou uma da HeyGen (mesmo formato do `voice` do job, §1.3).
   */
  heygen_voice?: { provider: "twin" | "elevenlabs" | "heygen"; voice_id?: string } | null;
}

/** `voice` do avatar-studio (ele junta as chaves com o que já está salvo). */
function voicePatch(input: {
  voice_id?: string;
  elevenlabs_voice_id?: string | null;
  heygen_voice?: AvatarVoice["heygen_voice"];
}) {
  const voice: AvatarVoice = {
    ...(input.voice_id ? { voice_id: input.voice_id } : {}),
    // null apaga a voz do ElevenLabs salva antes
    ...(input.elevenlabs_voice_id !== undefined
      ? { elevenlabs_voice_id: input.elevenlabs_voice_id }
      : {}),
    ...(input.heygen_voice !== undefined ? { heygen_voice: input.heygen_voice } : {}),
  };
  return Object.keys(voice).length ? { voice } : {};
}

export interface AvatarRow {
  id: string;
  name: string;
  status: string;
  is_default: boolean;
  reference_image_path: string | null;
  identity_pack_paths: string[] | null;
  appearance_prompt: string | null;
  voice: AvatarVoice | null;
  created_at: string;
  /** Preparo do personagem no Higgsfield (gravado pelo director-advance) e na HeyGen (avatar-studio). */
  provider_refs?: {
    higgsfield?: { status?: string; element_id?: string; error?: string };
    heygen?: HeygenRef;
  } | null;
}

export interface AvatarVoiceOption {
  id: string;
  label: string;
}

/** Predição de retrato (tabela video_predictions, alvo avatar_id). */
export interface AvatarPrediction {
  id: string;
  status: string;
  error: string | null;
  created_at: string;
}

const ACTIVE_PREDICTION_STATUSES = ["queued", "submitted", "processing", "downloading"];

async function invokeAvatar<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke("avatar-studio", { body });
  if (error) {
    const status = (error as { context?: { status?: number } } | null)?.context?.status;
    if (status === 404) throw new Error(NOT_DEPLOYED_MESSAGE);
    throw new Error(await getFunctionErrorMessage(error, fallback));
  }
  return data as T;
}

// ── Leitura ──────────────────────────────────────────────────────────────────

function useInvalidateAvatars() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["avatars"] });
    void queryClient.invalidateQueries({ queryKey: ["avatar-predictions"] });
  };
}

export function useAvatars(status: "active" | "archived" = "active") {
  return useQuery({
    queryKey: ["avatars", status],
    queryFn: async (): Promise<AvatarRow[]> => {
      const { data, error } = await supabase
        .from("brand_avatars")
        .select(
          "id, name, status, is_default, reference_image_path, identity_pack_paths, " +
            "appearance_prompt, voice, created_at, provider_refs",
        )
        .eq("status", status)
        // Padrão primeiro: é o que o /criar usa quando o usuário não escolhe.
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AvatarRow[];
    },
  });
}

export function useDefaultAvatar() {
  const query = useAvatars("active");
  return {
    ...query,
    data: (query.data ?? []).find((avatar) => avatar.is_default) ?? null,
  };
}

/**
 * Predições de retrato do avatar. `video_predictions` não tem Realtime — a UI
 * acompanha por polling, e o polling PARA sozinho quando nada está ativo.
 */
export function useAvatarPredictions(avatarId: string | undefined) {
  return useQuery({
    queryKey: ["avatar-predictions", avatarId],
    enabled: Boolean(avatarId),
    refetchInterval: (query) => {
      const rows = (query.state.data ?? []) as AvatarPrediction[];
      return rows.some((row) => ACTIVE_PREDICTION_STATUSES.includes(row.status)) ? 4000 : false;
    },
    queryFn: async (): Promise<AvatarPrediction[]> => {
      const { data, error } = await supabase
        .from("video_predictions")
        .select("id, status, error, created_at")
        .eq("avatar_id", avatarId as string)
        .eq("kind", "avatar_identity")
        .order("created_at", { ascending: false })
        .limit(8);
      if (error) throw new Error(error.message);
      return (data ?? []) as AvatarPrediction[];
    },
  });
}

export function isAvatarGenerating(predictions: AvatarPrediction[] | undefined): boolean {
  return (predictions ?? []).some((row) => ACTIVE_PREDICTION_STATUSES.includes(row.status));
}

export function useAvatarVoices() {
  return useQuery({
    queryKey: ["avatar-voices"],
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const result = await invokeAvatar<{ voices: AvatarVoiceOption[] }>(
        { action: "list_voices" },
        "Não foi possível carregar as vozes. Recarregue a página.",
      );
      return result.voices;
    },
  });
}

// ── Escrita ──────────────────────────────────────────────────────────────────

/** UUID v4 com fallback (crypto.randomUUID só existe em secure context). */
function uuid4(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const MAX_PRESENTER_PHOTOS = 3;

/** Sobe uma imagem para `avatars/uploads/` (bucket brand-assets) e devolve o caminho. */
export async function uploadPresenterPhoto(file: File): Promise<string> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `avatars/uploads/${uuid4()}.${ext}`;
  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, { contentType: file.type || "image/jpeg" });
  if (error) throw new Error(`A foto ${file.name} não foi enviada. Tente outra imagem.`);
  return path;
}

/**
 * Cadastra o apresentador. As fotos (1 a 3) sobem para `avatars/uploads/` e o
 * avatar-studio as arruma em `avatars/<id>/`; elas já valem como referência do
 * rosto em qualquer motor, sem gerar nada.
 */
export function useCreateAvatar() {
  const invalidate = useInvalidateAvatars();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      appearance_prompt?: string;
      voice_id?: string;
      elevenlabs_voice_id?: string;
      files?: File[];
    }) => {
      const photoPaths: string[] = [];
      for (const file of (input.files ?? []).slice(0, MAX_PRESENTER_PHOTOS)) {
        photoPaths.push(await uploadPresenterPhoto(file));
      }
      return invokeAvatar<{ avatar: { id: string; name: string; is_default: boolean } }>(
        {
          action: "create",
          name: input.name,
          ...(input.appearance_prompt ? { appearance_prompt: input.appearance_prompt } : {}),
          ...voicePatch(input),
          ...(photoPaths.length ? { photo_paths: photoPaths } : {}),
        },
        "Não foi possível criar o apresentador. Tente de novo.",
      );
    },
    onSuccess: invalidate,
  });
}

/** Imagem que representa o apresentador: o retrato, ou a 1ª foto enviada. */
export function presenterPortraitPath(
  avatar: Pick<AvatarRow, "reference_image_path" | "identity_pack_paths">,
) {
  return avatar.reference_image_path ?? avatar.identity_pack_paths?.[0] ?? null;
}

export function useGenerateIdentity() {
  const invalidate = useInvalidateAvatars();
  return useMutation({
    mutationFn: (input: { avatar_id: string; instruction?: string }) =>
      invokeAvatar<{ prediction_id: string }>(
        {
          action: "generate_identity",
          avatar_id: input.avatar_id,
          ...(input.instruction ? { instruction: input.instruction } : {}),
        },
        "Não foi possível gerar o retrato. Tente de novo.",
      ),
    onSuccess: invalidate,
  });
}

// ── Cadastro legado (director_identities) ────────────────────────────────────

/**
 * Quantos avatares do cadastro antigo ainda não viraram apresentador. Leitura
 * barata (só ids); a página chama `migrate_identities` quando há algum.
 */
export function useLegacyIdentitiesPending(enabled: boolean) {
  return useQuery({
    queryKey: ["legacy-identities-pending"],
    enabled,
    staleTime: Infinity,
    queryFn: async (): Promise<number> => {
      const { data: legacy, error } = await supabase.from("director_identities").select("id");
      if (error || !legacy?.length) return 0;
      const ids = legacy.map((row) => row.id);
      const { data: migrated } = await supabase.from("brand_avatars").select("id").in("id", ids);
      return ids.length - (migrated?.length ?? 0);
    },
  });
}

export interface MigrateIdentitiesResult {
  migrated: number;
  pending: number;
  /** Fotos antigas que não existiam mais e foram puladas. */
  warnings?: { id: string; name: string; warning: string }[];
}

/** Copia os avatares antigos para Apresentadores (mesmo id, fotos copiadas, sem custo). */
export function useMigrateIdentities() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateAvatars();
  return useMutation({
    mutationFn: () =>
      invokeAvatar<MigrateIdentitiesResult>(
        { action: "migrate_identities" },
        "Não foi possível trazer os avatares antigos. Recarregue a página para tentar de novo.",
      ),
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["legacy-identities-pending"] });
    },
  });
}

export function usePreviewVoice() {
  return useMutation({
    mutationFn: (input: { avatar_id?: string; voice_id: string; text?: string }) =>
      invokeAvatar<{ path: string; voice_id: string }>(
        {
          action: "preview_voice",
          ...(input.avatar_id ? { avatar_id: input.avatar_id } : {}),
          voice_id: input.voice_id,
          ...(input.text ? { text: input.text } : {}),
        },
        "Não foi possível gerar a amostra de voz. Tente de novo.",
      ),
  });
}

export function useUpdateAvatar() {
  const invalidate = useInvalidateAvatars();
  return useMutation({
    mutationFn: (input: {
      avatar_id: string;
      name?: string;
      appearance_prompt?: string;
      voice_id?: string;
      elevenlabs_voice_id?: string | null;
      heygen_voice?: AvatarVoice["heygen_voice"];
      /** foto nova em `avatars/uploads/…`: o motor a move para a pasta do avatar (§8.9) */
      reference_image_path?: string;
      identity_pack_paths?: string[];
    }) =>
      invokeAvatar<{ ok: boolean }>(
        {
          action: "update",
          avatar_id: input.avatar_id,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.appearance_prompt !== undefined
            ? { appearance_prompt: input.appearance_prompt }
            : {}),
          ...voicePatch(input),
          ...(input.reference_image_path
            ? { reference_image_path: input.reference_image_path }
            : {}),
          ...(input.identity_pack_paths?.length
            ? { identity_pack_paths: input.identity_pack_paths }
            : {}),
        },
        "Não foi possível salvar o avatar. Tente de novo.",
      ),
    onSuccess: invalidate,
  });
}

export function useSetDefaultAvatar() {
  const invalidate = useInvalidateAvatars();
  return useMutation({
    mutationFn: (avatarId: string) =>
      invokeAvatar<{ ok: boolean }>(
        { action: "set_default", avatar_id: avatarId },
        "Não foi possível definir o avatar padrão. Tente de novo.",
      ),
    onSuccess: invalidate,
  });
}

export function useArchiveAvatar() {
  const invalidate = useInvalidateAvatars();
  return useMutation({
    mutationFn: (avatarId: string) =>
      invokeAvatar<{ ok: boolean }>(
        { action: "archive", avatar_id: avatarId },
        "Não foi possível arquivar o avatar. Tente de novo.",
      ),
    onSuccess: invalidate,
  });
}
