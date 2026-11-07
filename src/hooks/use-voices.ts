import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { EngineNotDeployedError } from "@/hooks/use-heygen-studio";
import { supabase } from "@/integrations/supabase/client";
import { getFunctionError } from "@/lib/edge-functions";
import { voiceCostLabel, voiceRowFor, type VoiceCatalogRow } from "@/lib/voice-recording";

// ---------------------------------------------------------------------------
// Vozes da marca (docs/hub-motor-contratos.md §9, docs/construtor-de-voz.md).
// A lista vem da tabela `brand_voices`; criar, apagar e marcar a padrão são
// ações do `avatar-studio`. Antes do deploy, o motor responde "Ação
// desconhecida" e a tabela ainda não existe: a lista fica vazia e a criação
// mostra "Chega no próximo deploy do motor.".
// ---------------------------------------------------------------------------

export const VOICE_BUCKET = "brand-assets";

export type VoiceProvider = "elevenlabs" | "heygen";
export type VoiceSource = "clone" | "design" | "library" | "pasted" | "twin";

/** §9.1 */
export interface BrandVoice {
  id: string;
  name: string;
  provider: VoiceProvider;
  /** null só enquanto o clone HeyGen é criado */
  provider_voice_id: string | null;
  source: VoiceSource;
  status: "processing" | "ready" | "failed";
  error: string | null;
  gender: "female" | "male" | null;
  language: string | null;
  owned: boolean;
  is_default: boolean;
  /** assinada (vem nas respostas das ações) */
  preview_url?: string | null;
  /** cache da prévia no bucket (vem na leitura da tabela) */
  preview_path?: string | null;
  created_at: string;
}

/** Erro de uma ação de voz, já na língua da tela, com o código do motor. */
export class VoiceActionError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "VoiceActionError";
  }
}

async function invokeVoice<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke("avatar-studio", { body });
  if (error) {
    const status = (error as { context?: { status?: number } } | null)?.context?.status ?? null;
    const { message, code } = await getFunctionError(error, fallback);
    if (status === 404 && code === null) throw new EngineNotDeployedError();
    if (/ação desconhecida/i.test(message)) throw new EngineNotDeployedError();
    throw new VoiceActionError(message, code ?? (status === 412 ? "not_connected" : null), status);
  }
  return data as T;
}

// ── leitura ─────────────────────────────────────────────────────────────────

const BRAND_VOICE_COLUMNS =
  "id, name, provider, provider_voice_id, source, status, error, gender, language, owned, is_default, preview_path, created_at";

/**
 * As vozes da marca, a padrão primeiro. Tabela ainda não criada (ou qualquer
 * erro de leitura) → lista vazia: a tela nunca quebra por isso.
 */
export function useBrandVoices() {
  return useQuery({
    queryKey: ["brand-voices"],
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<BrandVoice[]> => {
      // `brand_voices` ainda não está nos tipos gerados (a migração é do motor)
      const client = supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => {
            order: (
              column: string,
              options: { ascending: boolean },
            ) => {
              order: (
                column: string,
                options: { ascending: boolean },
              ) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
            };
          };
        };
      };
      const { data, error } = await client
        .from("brand_voices")
        .select(BRAND_VOICE_COLUMNS)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) return [];
      return (data ?? []) as BrandVoice[];
    },
  });
}

export type VoicePathId = "own" | "describe" | "library" | "paste";

export interface VoicePathOption {
  provider: VoiceProvider | null;
  blocked_reason: string | null;
  cost_label: string;
}

/** §9.2 `voice_options` */
export interface VoiceOptions {
  paths: Record<VoicePathId, VoicePathOption>;
  eleven: {
    connected: boolean;
    can_clone: boolean | null;
    slots_used: number | null;
    slot_limit: number | null;
    tier: string | null;
  };
  heygen: { connected: boolean };
}

export type VoiceEngineState = "checking" | "ready" | "not_deployed" | "error";

/**
 * O motor tem as ações de voz? O `voice_options` nunca falha por provedor:
 * só "Ação desconhecida" (motor antigo) ou falta de rede derrubam a leitura.
 */
export function useVoiceOptions(enabled = true, prefer?: "heygen") {
  const query = useQuery({
    queryKey: ["voices", "options", prefer ?? "any"],
    enabled,
    staleTime: 30_000,
    retry: false,
    queryFn: () =>
      invokeVoice<VoiceOptions>(
        { action: "voice_options", ...(prefer ? { prefer } : {}) },
        "Não foi possível conferir as vozes.",
      ),
  });
  const state: VoiceEngineState = query.isPending
    ? "checking"
    : query.isSuccess
      ? "ready"
      : query.error instanceof EngineNotDeployedError
        ? "not_deployed"
        : "error";
  return {
    state,
    options: query.data ?? null,
    message:
      state === "not_deployed"
        ? new EngineNotDeployedError().message
        : state === "error"
          ? (query.error?.message ?? "Não foi possível conferir as vozes.")
          : "",
  };
}

const EXPERIENCE: Record<Exclude<VoicePathId, "paste">, string> = {
  own: "own_voice",
  describe: "voice_design",
  library: "voice_library",
};

/**
 * Custo de cada caminho pelo catálogo `voice_create` (§6): a linha do provedor
 * que o servidor escolheu, senão a `default` da experiência.
 */
export function useVoiceCreateCosts(options: VoiceOptions | null) {
  const query = useQuery({
    queryKey: ["video-models", "voice_create"],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("video_models")
        .select("model_id, provider, tier, experience, cost")
        .eq("active", true)
        .eq("capability", "voice_create");
      if (error) return [];
      return (data ?? []) as VoiceCatalogRow[];
    },
  });
  const rows = query.data ?? [];
  const label = (path: Exclude<VoicePathId, "paste">) =>
    voiceCostLabel(voiceRowFor(rows, EXPERIENCE[path], options?.paths[path]?.provider));
  return { own: label("own"), describe: label("describe"), library: label("library") };
}

// ── criação ─────────────────────────────────────────────────────────────────

function useVoiceMutation<I extends Record<string, unknown>>(action: string, fallback: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: I) =>
      (await invokeVoice<{ voice: BrandVoice }>({ action, ...input }, fallback)).voice,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["brand-voices"] });
      void queryClient.invalidateQueries({ queryKey: ["voices", "options"] });
    },
  });
}

/** Sobe a amostra (WAV ou MP3) para `brand-assets` e devolve o caminho. */
export function useUploadVoiceSample() {
  return useMutation({
    mutationFn: async (file: Blob): Promise<string> => {
      const contentType = file.type === "audio/mpeg" ? "audio/mpeg" : "audio/wav";
      const { path, token } = await invokeVoice<{ path: string; token: string }>(
        { action: "voice_upload_url", content_type: contentType },
        "Não foi possível preparar o envio do áudio.",
      );
      const { error } = await supabase.storage
        .from(VOICE_BUCKET)
        .uploadToSignedUrl(path, token, file, { contentType });
      if (error) throw new Error("Não foi possível enviar o áudio. Tente de novo.");
      return path;
    },
  });
}

export function useVoiceClone() {
  return useVoiceMutation<{
    name: string;
    sample_path: string;
    consent: true;
    gender?: "female" | "male";
    duration_s?: number;
    avatar_id?: string;
    prefer?: "heygen";
  }>("voice_clone", "Não foi possível criar a voz.");
}

export interface VoiceDesignPreview {
  preview_id: string;
  url: string;
}

export function useVoiceDesign() {
  return useMutation({
    mutationFn: (input: { description: string; gender?: "female" | "male" }) =>
      invokeVoice<{ provider: VoiceProvider; previews: VoiceDesignPreview[] }>(
        { action: "voice_design", ...input },
        "Não foi possível gerar as vozes.",
      ),
  });
}

export function useVoiceDesignSave() {
  return useVoiceMutation<{ preview_id: string; name: string; description: string }>(
    "voice_design_save",
    "Não foi possível salvar a voz.",
  );
}

export interface LibraryVoice {
  ref: string;
  name: string;
  gender: string | null;
  accent: string | null;
  preview_url: string | null;
}

/** Vozes prontas em pt-BR, com "ver mais". O motor troca para a HeyGen sozinho. */
export function useVoiceLibrary(
  filter: { search: string; gender: "female" | "male" | null },
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: ["voices", "library", filter.search, filter.gender],
    enabled,
    // as prévias expiram
    staleTime: 0,
    retry: false,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      invokeVoice<{
        provider: VoiceProvider;
        voices: LibraryVoice[];
        next_token: string | null;
        notice: string | null;
      }>(
        {
          action: "voice_library",
          ...(filter.search.trim() ? { search: filter.search.trim() } : {}),
          ...(filter.gender ? { gender: filter.gender } : {}),
          ...(pageParam ? { token: pageParam } : {}),
        },
        "Não foi possível listar as vozes.",
      ),
    getNextPageParam: (last) => last.next_token ?? null,
  });
}

export function useVoiceLibraryAdd() {
  return useVoiceMutation<{ provider: VoiceProvider; ref: string; name?: string }>(
    "voice_library_add",
    "Não foi possível adicionar a voz.",
  );
}

export function useVoiceImport() {
  return useVoiceMutation<{ voice_id: string; name?: string }>(
    "voice_import",
    "Não foi possível usar esse Voice ID.",
  );
}

/** §9.4: a cada 3 s enquanto o clone HeyGen está `processing` (quem chama limita a 2 min). */
export function useVoiceStatus(voiceId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["voices", "status", voiceId],
    enabled: enabled && voiceId !== null,
    retry: false,
    queryFn: async () => {
      const { voice } = await invokeVoice<{ voice: BrandVoice }>(
        { action: "voice_status", voice_id: voiceId },
        "Não foi possível ler o estado da voz.",
      );
      if (voice.status !== "processing")
        void queryClient.invalidateQueries({ queryKey: ["brand-voices"] });
      return voice;
    },
    refetchInterval: (query) => (query.state.data?.status === "processing" ? 3_000 : false),
  });
}

export function useSetDefaultVoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { voice_id: string }) =>
      invokeVoice<{ ok: boolean; eleven_voice_id_synced?: boolean }>(
        { action: "voice_set_default", ...input },
        "Não foi possível marcar a voz padrão.",
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["brand-voices"] }),
  });
}

export function useDeleteVoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { voice_id: string }) =>
      invokeVoice<{ ok: boolean; deleted_at_provider: boolean }>(
        { action: "voice_delete", ...input },
        "Não foi possível apagar a voz.",
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["brand-voices"] });
      void queryClient.invalidateQueries({ queryKey: ["voices", "options"] });
    },
  });
}

/** Amostra de uma voz da marca (`heygen_voice_preview` com `brand_voice_id`). */
export function useBrandVoicePreview() {
  return useMutation({
    mutationFn: (input: { brand_voice_id: string; avatar_id?: string; text?: string }) =>
      invokeVoice<{ url: string; path: string; cached: boolean }>(
        { action: "heygen_voice_preview", ...input },
        "Não foi possível gerar a amostra da voz.",
      ),
  });
}

// ── regras pequenas usadas nas telas ────────────────────────────────────────

/** A nota curta do provedor, mostrada só depois de criar (§4.1). */
export function providerNote(voice: Pick<BrandVoice, "provider" | "source">): string {
  if (voice.provider === "elevenlabs") return "Voz do ElevenLabs.";
  return voice.source === "clone" ? "Clone feito na HeyGen." : "Voz da HeyGen.";
}

export const SOURCE_LABEL: Record<VoiceSource, string> = {
  clone: "Clone",
  design: "Por descrição",
  library: "Biblioteca",
  pasted: "Voice ID",
  twin: "Do clone de vídeo",
};

/** A voz da marca que corresponde a um par provedor + id (seleção já salva). */
export function findBrandVoice(
  voices: readonly BrandVoice[],
  provider: string | null | undefined,
  voiceId: string | null | undefined,
): BrandVoice | null {
  if (!provider || !voiceId) return null;
  return voices.find((v) => v.provider === provider && v.provider_voice_id === voiceId) ?? null;
}

/** Valor de uma voz da marca nos seletores (`brand:<id>`). */
export const BRAND_PREFIX = "brand:";
export const brandValue = (id: string) => `${BRAND_PREFIX}${id}`;
export const brandIdOf = (value: string | null | undefined) =>
  value?.startsWith(BRAND_PREFIX) ? value.slice(BRAND_PREFIX.length) : null;
