import { useQuery } from "@tanstack/react-query";

import { useSecretStatus } from "@/hooks/use-app-settings";
import { useHiggsfieldStatus } from "@/hooks/use-higgsfield";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import { formatUsd, formatUsdRate } from "@/lib/format-usd";

// Reexportado: telas antigas importam daqui; a implementação única mora em lib/format-usd.
export { formatUsd, formatUsdRate };

// ---------------------------------------------------------------------------
// Motor de vídeo do Diretor (Vídeos → Novo): Higgsfield (estúdio da casa) ou
// Replicate (catálogo `video_models`). A escolha vai no `config` do job e o
// director-advance congela em `artifacts.engine` no primeiro tick.
// ---------------------------------------------------------------------------

export type VideoEngine = "higgsfield" | "replicate";

export type EngineStatus = "loading" | "on" | "off" | "unknown";

export interface EngineChoice {
  engine: VideoEngine;
  /** modelo das cenas (null = padrão do motor) */
  modelId: string | null;
  /** modelo da cena extra para comparar (null = padrão do motor) */
  abModelId: string | null;
}

export const DEFAULT_ENGINE_CHOICE: EngineChoice = {
  engine: "higgsfield",
  modelId: null,
  abModelId: null,
};

/** Opção de modelo já pronta para a tela (os dois motores usam o mesmo shape). */
export interface VideoModelOption {
  id: string;
  label: string;
  /** "US$ 0,036/s · 4–12 s" — vazio quando não há custo no catálogo */
  detail: string;
  usdPerSecond: number | null;
  /** preço por 1.000 letras (voz); null quando o modelo não cobra assim */
  usdPer1kChars?: number | null;
  /** preço por imagem (quadros); null quando o modelo não cobra assim */
  usdPerImage?: number | null;
  maxSeconds: number | null;
  /** menor clipe que o modelo gera (`limits.duration_min` ou o menor bloco); null = não diz */
  minSeconds?: number | null;
  /** blocos de duração aceitos (`limits.durations`), quando o modelo cobra em blocos */
  durations?: number[];
  /**
   * Como o modelo trata a duração: "continuous" (faixa min–max, casa com o áudio)
   * ou "discrete" (blocos fixos, ex.: 5 ou 10 s). Ausente quando o catálogo não diz.
   */
  durationMode?: "continuous" | "discrete";
  /** preço por segundo por resolução (`cost.by_resolution`, ex.: { "1080p": 0.06 }) */
  usdByResolution?: Record<string, number>;
  /** maior arquivo de entrada que o modelo aceita (`limits.max_bytes`); null = não diz */
  maxBytes?: number | null;
  /** o catálogo marca o preço como não conferido (`cost.verified = false`) */
  costUnverified?: boolean;
  /** resoluções que o modelo aceita (`limits.resolutions`), na ordem do catálogo */
  resolutions?: string[];
  /** máximo de fotos de referência (`limits.max_refs`); null = não diz */
  maxRefs?: number | null;
  /** entradas que o modelo exige (`required_inputs`) */
  requiredInputs?: string[];
  /** capacidade do catálogo (scene_i2v, scene_v2v, person_swap, tts, keyframe…) */
  capability?: string;
  isDefault: boolean;
}

// Higgsfield: os ids aceitos pelo MCP (director_state.hf_models permite trocar o
// padrão; a lista curta aqui é o que o servidor aceita como escolha do usuário).
export const HIGGSFIELD_VIDEO_MODELS: VideoModelOption[] = [
  {
    id: "cinematic_studio_3_0",
    label: "Cinema Studio 3.0",
    detail: "até 15 s por cena",
    usdPerSecond: null,
    // piso e teto do servidor (hf_models.video_min_s / video_max_s)
    minSeconds: 4,
    maxSeconds: 15,
    isDefault: true,
  },
  {
    id: "cinematic_studio_video_v2",
    label: "Cinema Studio Video 2",
    detail: "até 12 s por cena",
    usdPerSecond: null,
    minSeconds: 4,
    maxSeconds: 12,
    isDefault: false,
  },
];

type ModelCost = {
  unit?: string;
  usd?: number;
  by_resolution?: Record<string, number>;
  /** false = preço não conferido no provedor (HeyGen): a tela não mostra número */
  verified?: boolean;
};
type ModelLimits = {
  max_bytes?: number;
  durations?: number[];
  duration_min?: number;
  duration_max?: number;
  max_duration_s?: number;
  resolutions?: string[];
  max_refs?: number;
};

type CatalogRow = {
  id: string;
  model_id: string;
  cost: unknown;
  limits: unknown;
  is_primary: boolean;
  required_inputs?: string[] | null;
  /** colunas do catálogo do hub (sessão de catálogo); ausentes em bancos antigos */
  label?: string | null;
  provider?: string | null;
  tier?: string | null;
  capability?: string | null;
};

/** "bytedance/seedance-1-lite" → "Seedance 1 Lite" */
export function humanizeModelId(modelId: string): string {
  const name = modelId.split("/").pop() ?? modelId;
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) =>
      part.length <= 3 && /^v?\d/.test(part) ? part : part[0].toUpperCase() + part.slice(1),
    )
    .join(" ");
}

function durationLabel(limits: ModelLimits): string {
  if (Array.isArray(limits.durations) && limits.durations.length) {
    const sorted = [...limits.durations].sort((a, b) => a - b);
    return sorted.length <= 2
      ? `${sorted.join(" ou ")} s`
      : `${sorted[0]}–${sorted[sorted.length - 1]} s`;
  }
  const max = limits.duration_max ?? limits.max_duration_s;
  if (limits.duration_min != null && max != null) return `${limits.duration_min}–${max} s`;
  if (max != null) return `até ${max} s`;
  return "";
}

function maxSeconds(limits: ModelLimits): number | null {
  if (Array.isArray(limits.durations) && limits.durations.length)
    return Math.max(...limits.durations);
  return limits.duration_max ?? limits.max_duration_s ?? null;
}

function minSeconds(limits: ModelLimits): number | null {
  if (Array.isArray(limits.durations) && limits.durations.length)
    return Math.min(...limits.durations);
  return limits.duration_min ?? null;
}

function durationMode(limits: ModelLimits): VideoModelOption["durationMode"] {
  if (Array.isArray(limits.durations) && limits.durations.length) return "discrete";
  if (limits.duration_min != null || limits.duration_max != null || limits.max_duration_s != null)
    return "continuous";
  return undefined;
}

/** Linha do catálogo → opção de tela (também usada pelo modelo vídeo→vídeo do Remake). */
export function toOption(row: CatalogRow, capability?: VideoCapability): VideoModelOption {
  const cost = (row.cost ?? {}) as ModelCost;
  const limits = (row.limits ?? {}) as ModelLimits;
  const usdPerSecond = cost.unit === "per_second" && typeof cost.usd === "number" ? cost.usd : null;
  const usdPer1kChars =
    cost.unit === "per_1k_chars" && typeof cost.usd === "number" ? cost.usd : null;
  const usdPerImage = cost.unit === "per_image" && typeof cost.usd === "number" ? cost.usd : null;
  const parts = [
    usdPerSecond != null ? formatUsdRate(usdPerSecond) : null,
    usdPer1kChars != null ? `${formatUsd(usdPer1kChars)}/1k letras` : null,
    usdPerImage != null ? `${formatUsd(usdPerImage)}/imagem` : null,
    durationLabel(limits) || null,
  ].filter(Boolean);
  return {
    id: row.model_id,
    label: row.label?.trim() || humanizeModelId(row.model_id),
    detail: parts.join(" · "),
    usdPerSecond,
    usdPer1kChars,
    usdPerImage,
    maxSeconds: maxSeconds(limits),
    minSeconds: minSeconds(limits),
    durations:
      Array.isArray(limits.durations) && limits.durations.length
        ? [...limits.durations]
        : undefined,
    durationMode: durationMode(limits),
    usdByResolution: cost.by_resolution,
    maxBytes: typeof limits.max_bytes === "number" ? limits.max_bytes : null,
    costUnverified: cost.verified === false,
    resolutions:
      Array.isArray(limits.resolutions) && limits.resolutions.length
        ? [...limits.resolutions]
        : undefined,
    maxRefs: typeof limits.max_refs === "number" ? limits.max_refs : null,
    requiredInputs: Array.isArray(row.required_inputs) ? [...row.required_inputs] : undefined,
    capability,
    isDefault: row.is_primary,
  };
}

export type VideoCapability =
  | "scene_i2v"
  | "scene_v2v"
  | "person_swap"
  | "keyframe"
  | "tts"
  | "talking_avatar"
  | "lipsync_post";

/**
 * Resolução padrão das cenas do Diretor (`config.resolution`): 720p quando o
 * modelo tem; senão a primeira listada. O servidor ajusta ao que o modelo
 * suporta. undefined = o modelo não declara resolução.
 */
export function directorResolution(option: Pick<VideoModelOption, "resolutions">) {
  const list = option.resolutions ?? [];
  if (!list.length) return undefined;
  return list.includes("720p") ? "720p" : list[0];
}

/** Resoluções que o Diretor aceita em `config.resolution`. */
export const DIRECTOR_RESOLUTIONS = ["720p", "1080p", "4k"] as const;
export type DirectorResolution = (typeof DIRECTOR_RESOLUTIONS)[number];

/** A opção com o preço por segundo da resolução que vai de fato (quando o catálogo tem). */
export function atResolution<T extends VideoModelOption>(option: T, resolution?: string): T {
  const rate = resolution ? option.usdByResolution?.[resolution] : undefined;
  if (rate == null || rate === option.usdPerSecond) return option;
  const duration = option.detail.split(" · ").filter((part) => !part.includes("US$"));
  return {
    ...option,
    usdPerSecond: rate,
    detail: [`${formatUsdRate(rate)} em ${resolution}`, ...duration].join(" · "),
  };
}

// Colunas do hub (provider, tier, label, experience) chegam por SQL de outra
// frente. Até lá, a consulta com elas falha (coluna inexistente): a leitura cai
// para as colunas antigas e lembra disso nesta sessão, sem quebrar a tela.
const BASE_COLUMNS = "id, model_id, capability, cost, limits, is_primary, required_inputs";
const HUB_COLUMNS = `${BASE_COLUMNS}, label, provider, tier`;
let hubColumns: boolean | null = null;

/** Erro de coluna que ainda não existe (Postgres 42703 / PostgREST PGRST204). */
function missingColumn(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /column .* does not exist|could not find .* column/i.test(error.message ?? "")
  );
}

type CatalogQuery = (
  columns: string,
  withHub: boolean,
) => PromiseLike<{
  data: unknown;
  error: { code?: string; message: string } | null;
}>;

/** Lê o catálogo com as colunas do hub; sem elas no banco, com as antigas. */
async function readCatalog(run: CatalogQuery): Promise<{ rows: CatalogRow[]; hub: boolean }> {
  if (hubColumns !== false) {
    const { data, error } = await run(HUB_COLUMNS, true);
    if (!error) {
      hubColumns = true;
      return { rows: (data ?? []) as CatalogRow[], hub: true };
    }
    if (!missingColumn(error)) throw new Error(error.message);
    hubColumns = false;
  }
  const { data, error } = await run(BASE_COLUMNS, false);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as CatalogRow[], hub: false };
}

/**
 * Modelos ativos de uma capacidade no catálogo do Replicate (padrão: cena
 * imagem → vídeo). Só `provider = 'replicate'`: são as listas que rodam no
 * pipeline do Replicate (portões do Remake e cenas do Diretor).
 */
export function useReplicateVideoModels(capability: VideoCapability = "scene_i2v") {
  return useQuery({
    queryKey: ["video-models", capability],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<VideoModelOption[]> => {
      const { rows } = await readCatalog((columns, withHub) => {
        let q = supabase
          .from("video_models")
          .select(columns as "*")
          .eq("active", true)
          .eq("capability", capability);
        if (withHub) q = q.filter("provider", "eq", "replicate");
        return q.order("is_primary", { ascending: false }).order("model_id");
      });
      return rows.map((row) => toOption(row, capability));
    },
  });
}

/** Experiências do hub no catálogo (`video_models.experience[]`). */
export type CatalogExperience =
  | "scenes"
  | "presenter_in_scenes"
  | "avatar_script"
  | "photo_presenter"
  | "digital_twin"
  | "idea_to_video"
  | "change_speech"
  | "translate"
  | "restyle"
  | "person_swap"
  | "captions"
  | "reframe_upscale"
  | "music";

export interface ExperienceModel {
  option: VideoModelOption;
  provider: string;
  tier: "default" | "top" | "alt" | null;
  capability: string;
}

/**
 * Padrão · Top de uma experiência, direto do catálogo: ativo, com o slug em
 * `experience`; padrão primeiro, depois top, depois pelo custo. `null` = o
 * banco ainda não tem as colunas do hub (quem chama usa o plano).
 */
export function useExperienceModels(experience: CatalogExperience | null) {
  return useQuery({
    queryKey: ["video-models", "experience", experience],
    enabled: experience !== null,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ExperienceModel[] | null> => {
      if (!experience || hubColumns === false) return null;
      const { data, error } = await supabase
        .from("video_models")
        .select(HUB_COLUMNS as "*")
        .eq("active", true)
        .filter("experience", "cs", `{${experience}}`);
      if (error) {
        if (!missingColumn(error)) throw new Error(error.message);
        hubColumns = false;
        return null;
      }
      hubColumns = true;
      const rows = (data ?? []) as unknown as CatalogRow[];
      const rank = (tier: string | null | undefined) =>
        tier === "default" ? 0 : tier === "top" ? 1 : 2;
      return rows
        .map((row) => {
          const capability = row.capability ?? "";
          return {
            option: toOption(row, capability as VideoCapability),
            provider: row.provider ?? "replicate",
            tier: (row.tier === "default" || row.tier === "top" || row.tier === "alt"
              ? row.tier
              : null) as ExperienceModel["tier"],
            capability,
          };
        })
        .sort(
          (a, b) =>
            rank(a.tier) - rank(b.tier) ||
            (a.option.usdPerSecond ?? a.option.usdPer1kChars ?? Infinity) -
              (b.option.usdPerSecond ?? b.option.usdPer1kChars ?? Infinity),
        );
    },
  });
}

/** Estado de conexão dos dois motores (mesma leitura de Ajustes → Integrações). */
export function useEngineStatus(): Record<VideoEngine, EngineStatus> {
  const secrets = useSecretStatus();
  const higgsfield = useHiggsfieldStatus();
  const { isLoading: sessionLoading } = useSession();
  // "carregando" só enquanto há resposta a caminho: a sessão ainda restaurando
  // (a query nasce desligada e isLoading é false — o motor aparecia "off" no
  // boot) ou a busca em voo. Sem sessão de fato, a query nunca roda: "off",
  // nunca um spinner eterno.
  const waiting = (q: { isPending: boolean; fetchStatus: string }) =>
    q.isPending && (sessionLoading || q.fetchStatus === "fetching");
  const hf: EngineStatus = waiting(higgsfield)
    ? "loading"
    : higgsfield.isError
      ? "unknown"
      : higgsfield.data?.connected
        ? "on"
        : "off";
  const rp: EngineStatus = waiting(secrets)
    ? "loading"
    : secrets.isError
      ? "unknown"
      : secrets.data?.includes("REPLICATE_API_TOKEN")
        ? "on"
        : "off";
  return { higgsfield: hf, replicate: rp };
}
