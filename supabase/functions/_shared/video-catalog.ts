// _shared/video-catalog.ts — o catálogo de modelos do Replicate como DADO.
// Spec: docs/11-video-replicate.md §1.3.
//
// A orquestração NUNCA cita um modelo pelo nome: pede uma capability e recebe
// modelo + input já montado. Trocar `veed/fabric-1.0` por `bytedance/omni-human`
// é um UPDATE na tabela `video_models`; ADICIONAR um modelo com schema simples
// também, porque o mapeamento de input é um template declarativo com
// placeholders — não código. Só schema excêntrico exigiria mapper próprio.
//
// Placeholders suportados (resolvidos em renderInputTemplate):
//   {{prompt}} {{negative_prompt}} {{text}} {{keyframe_url}} {{audio_url}}
//   {{video_url}} {{reference_urls}} {{reference_url}} {{duration_int}} {{resolution}}
//   {{voice_id}} {{language_boost}} {{bitrate}} {{duration_ms}} {{language_code}}
//   {{avatar_id}}
// Formas de objeto: {"$when":var,"value":x} · {"$list":var|[vars]} (lista
// achatada; vazia = campo some) · {"$map":var,"to":{valor:saída}} (sem casar = some).

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type VideoCapability =
  | 'avatar_identity'
  | 'keyframe'
  | 'talking_avatar'
  | 'scene_i2v'
  | 'scene_t2v'
  /** vídeo → vídeo: restyle/edição/troca de personagem preservando o movimento */
  | 'scene_v2v'
  /** troca a pessoa do vídeo pela das fotos de referência (p-video-replace) */
  | 'person_swap'
  | 'lipsync_post'
  | 'tts'
  | 'util_normalize'
  | 'util_concat'
  | 'util_audio_merge'
  /** fala → texto com tempo por palavra (legendas) */
  | 'stt'
  /** trilha / música */
  | 'music'
  /** vídeo de avatar falando (HeyGen POST /v3/videos type avatar) */
  | 'avatar_video'
  /** ideia → vídeo pronto (HeyGen Video Agent) */
  | 'video_agent'
  /** tradução de vídeo com voz */
  | 'translate'
  /** reenquadrar vídeo (ex.: 16:9 → 9:16) */
  | 'util_reframe';

export interface ModelCost {
  unit: 'per_second' | 'per_run' | 'per_image' | 'per_1k_chars';
  /** preço na resolução que o sistema manda por padrão (o que a tela mostra) */
  usd: number;
  /** preço por resolução quando o provedor cobra diferente ("720p" → 0.18) */
  by_resolution?: Record<string, number>;
}

export interface ModelLimits {
  /** Enum fechado de durações (ex.: Kling aceita só 5 ou 10). */
  durations?: number[];
  /** Faixa contínua (ex.: seedance 4–12). */
  duration_min?: number;
  duration_max?: number;
  max_duration_s?: number;
  aspect_ratios?: string[];
  resolutions?: string[];
  max_refs?: number;
  /** 'audio' = o modelo deriva a duração do áudio (fabric, omni-human). */
  duration_from?: 'audio';
  /** 'array' = o output vem como lista de URIs (fofr/toolkit). */
  output?: 'array';
  /** tamanho máximo do arquivo de entrada (ex.: Aleph aceita < 16 MB) */
  max_bytes?: number;
}

/**
 * Resolução que o modelo aceita mais próxima da pedida: igual se existir; senão
 * a maior abaixo; senão a menor acima. Modelo sem lista recebe a pedida.
 * (Fabric só faz 480p/720p e recebia a resolução do projeto sem checagem.)
 */
export function fitResolution(limits: ModelLimits, wanted: string | null | undefined): string | undefined {
  if (!wanted) return undefined;
  const list = limits.resolutions;
  if (!list?.length || list.includes(wanted)) return wanted;
  // "2k"/"4k" não são altura em px: parseInt('2k') daria 2 e o 2k passava por "abaixo de 720p"
  const px = (r: string) => {
    const v = r.toLowerCase();
    if (v === '4k') return 2160;
    if (v === '2k') return 1440;
    if (v === '1k') return 1080;
    return parseInt(v, 10) || 0;
  };
  const target = px(wanted);
  const sorted = [...list].sort((a, b) => px(a) - px(b));
  const below = sorted.filter((r) => px(r) <= target);
  return below.length ? below[below.length - 1] : sorted[0];
}

/** Resoluções que a tela pode pedir para as cenas (`config.resolution`). */
export const SCENE_RESOLUTIONS = ['720p', '1080p', '4k'] as const;
export const DEFAULT_SCENE_RESOLUTION = '720p';

/**
 * Resolução das cenas: a pedida em `config.resolution` (720p, 1080p ou 4k),
 * senão 720p — sempre ajustada ao que o modelo aceita (fitResolution). Modelo
 * sem lista de resoluções não recebe o campo.
 */
export function sceneResolution(limits: ModelLimits, configured?: unknown): string | undefined {
  if (!limits.resolutions?.length) return undefined;
  const wanted = (SCENE_RESOLUTIONS as readonly string[]).includes(String(configured))
    ? String(configured)
    : DEFAULT_SCENE_RESOLUTION;
  return fitResolution(limits, wanted);
}

export interface VideoModelEntry {
  id: string;
  capability: VideoCapability;
  model_id: string;
  kind: 'official' | 'community';
  version_hash: string | null;
  cost: ModelCost;
  limits: ModelLimits;
  input_template: Record<string, unknown>;
  fallback_model_id: string | null;
  is_primary: boolean;
  active: boolean;
  /** Campos que o modelo EXIGE (array `required` do schema real). */
  required_inputs: string[];
  /** 'replicate' (padrão) | 'heygen' | … — o caminho Replicate só usa 'replicate' */
  provider: string;
}

/** Valores que o motor injeta no template. Ausentes viram remoção do campo. */
export interface TemplateVars {
  prompt?: string;
  negative_prompt?: string;
  text?: string;
  keyframe_url?: string;
  audio_url?: string;
  video_url?: string;
  reference_urls?: string[];
  /** a primeira de reference_urls, para modelos que aceitam uma imagem só */
  reference_url?: string;
  duration_int?: number;
  /** duration_int em milissegundos; derivado de duration_int quando ausente */
  duration_ms?: number;
  resolution?: string;
  voice_id?: string;
  language_boost?: string;
  bitrate?: number;
  /** idioma falado (ISO-639-1), para STT */
  language_code?: string;
  /** look HeyGen (avatar_id de POST /v3/videos) */
  avatar_id?: string;
}

export class CatalogError extends Error {}

type ModelRow = {
  id: string;
  capability: string;
  model_id: string;
  kind: string;
  version_hash: string | null;
  cost: ModelCost | null;
  limits: ModelLimits | null;
  input_template: Record<string, unknown> | null;
  fallback_model_id: string | null;
  is_primary: boolean;
  active: boolean;
  required_inputs: string[] | null;
  /** coluna nova (SQL da sessão de catálogo); ausente = 'replicate' */
  provider?: string | null;
};

/** Provedor da linha. Banco sem a coluna `provider` (ainda) → toda linha é do Replicate. */
export function rowProvider(row: { provider?: string | null }): string {
  return typeof row.provider === 'string' && row.provider ? row.provider : 'replicate';
}

function toEntry(row: ModelRow): VideoModelEntry {
  return {
    id: row.id,
    capability: row.capability as VideoCapability,
    model_id: row.model_id,
    kind: row.kind === 'community' ? 'community' : 'official',
    version_hash: row.version_hash,
    cost: row.cost ?? { unit: 'per_run', usd: 0 },
    limits: row.limits ?? {},
    input_template: row.input_template ?? {},
    fallback_model_id: row.fallback_model_id,
    is_primary: row.is_primary,
    active: row.active,
    required_inputs: row.required_inputs ?? [],
    provider: rowProvider(row),
  };
}

/**
 * Resolve o modelo de uma capability. `override` (model_id) atende a escolha
 * por cena; sem ele, o primário ativo. Modelo community SEM version_hash é
 * recusado aqui: rodar community pela "latest" quebra reprodutibilidade e o
 * dono pode publicar versão incompatível a qualquer momento.
 */
/** Linhas ativas de uma capability (override ou primárias), já filtradas pelo provedor. */
async function activeRows(
  service: SupabaseClient,
  capability: VideoCapability,
  override: string | null | undefined,
  provider: string,
): Promise<ModelRow[]> {
  // select('*') e filtro de provedor em JS: tolera o banco sem a coluna
  // `provider` (todas as linhas contam como Replicate) e garante que uma linha
  // de outro provedor (HeyGen) nunca vá para a API do Replicate.
  let query = service
    .from('video_models')
    .select('*')
    .eq('capability', capability)
    .eq('active', true);
  query = override ? query.eq('model_id', override) : query.eq('is_primary', true);
  const { data, error } = await query.returns<ModelRow[]>();
  if (error) throw new CatalogError(`Falha ao ler o catálogo de modelos: ${error.message}`);
  return (data ?? []).filter((r) => rowProvider(r) === provider);
}

/**
 * Resolve o modelo de uma capability. `override` (model_id) atende a escolha
 * por cena; sem ele, o primário ativo. Override inativo ou inexistente (ex.:
 * modelo aposentado no catálogo, job retomado depois) NÃO derruba o job: avisa
 * no log e segue com o primário. O erro humanizado fica só para "sem primário".
 * Modelo community SEM version_hash é recusado: rodar community pela "latest"
 * quebra reprodutibilidade e o dono pode publicar versão incompatível.
 */
export async function resolveModel(
  service: SupabaseClient,
  capability: VideoCapability,
  override?: string | null,
  provider = 'replicate',
): Promise<VideoModelEntry> {
  let row: ModelRow | undefined;
  if (override) {
    row = (await activeRows(service, capability, override, provider))[0];
    if (!row) {
      console.warn(
        `[catalog] override "${override}" inativo ou inexistente para "${capability}"; usando o primário.`,
      );
    }
  }
  row ??= (await activeRows(service, capability, null, provider))[0];
  if (!row) {
    throw new CatalogError(
      `Nenhum modelo primário ativo para a etapa "${capability}". Configure em /config.`,
    );
  }

  const entry = toEntry(row);
  if (entry.provider === 'replicate' && entry.kind === 'community' && !entry.version_hash) {
    throw new CatalogError(
      `O modelo "${entry.model_id}" é community e está sem version_hash fixado — ` +
        'rode "Validar catálogo" em Config → Integrações antes de usá-lo.',
    );
  }
  return entry;
}

/** Fallback declarado na linha do primário (mesma capability). */
export async function resolveFallback(
  service: SupabaseClient,
  entry: VideoModelEntry,
): Promise<VideoModelEntry | null> {
  if (!entry.fallback_model_id) return null;
  try {
    // só o fallback declarado: inativo → null (sem cair no primário, que é quem falhou)
    const row = (await activeRows(service, entry.capability, entry.fallback_model_id, entry.provider))[0];
    if (!row) return null;
    const fb = toEntry(row);
    return fb.provider === 'replicate' && fb.kind === 'community' && !fb.version_hash ? null : fb;
  } catch (_err) {
    return null;
  }
}

export async function listActiveModels(service: SupabaseClient, provider = 'replicate'): Promise<VideoModelEntry[]> {
  const { data, error } = await service
    .from('video_models')
    .select('*')
    .eq('active', true)
    .order('capability')
    .returns<ModelRow[]>();
  if (error) throw new CatalogError(`Falha ao listar modelos: ${error.message}`);
  return (data ?? []).filter((r) => rowProvider(r) === provider).map(toEntry);
}

// ── Duração ──────────────────────────────────────────────────────────────────

/**
 * Traduz a duração desejada (a real do áudio) para o que o modelo aceita.
 *
 * Três regimes, todos verificados nos schemas (docs/11 Apêndice A):
 * - `duration_from: 'audio'`: o modelo não tem parâmetro de duração (fabric,
 *   omni-human) — devolve null e o campo simplesmente não é enviado;
 * - `durations: [5, 10]`: enum fechado — sobe para o MENOR bucket que cabe o
 *   áudio (nunca para baixo: cortaria a fala);
 * - faixa contínua: arredonda para cima e prende entre min e max.
 */
export function resolveDuration(limits: ModelLimits, desiredSeconds: number): number | null {
  if (limits.duration_from === 'audio') return null;

  const desired = Math.max(0.1, desiredSeconds);

  if (Array.isArray(limits.durations) && limits.durations.length > 0) {
    const sorted = [...limits.durations].sort((a, b) => a - b);
    return sorted.find((value) => value >= desired) ?? sorted[sorted.length - 1];
  }

  const min = limits.duration_min ?? 4;
  const max = limits.duration_max ?? limits.max_duration_s ?? 12;
  return Math.min(max, Math.max(min, Math.ceil(desired)));
}

/** A duração que será COBRADA/renderizada (para estimativa e teto de projeto). */
export function billableDuration(limits: ModelLimits, desiredSeconds: number): number {
  return resolveDuration(limits, desiredSeconds) ?? Math.max(1, Math.ceil(desiredSeconds));
}

// ── Template de input ────────────────────────────────────────────────────────

const PLACEHOLDER = /^\{\{([a-z_]+)\}\}$/;

/**
 * Resolve o template do modelo com os valores da etapa.
 *
 * Regras: um valor `{{x}}` sozinho é substituído pelo VALOR (preservando tipo —
 * número continua número, array continua array); placeholder sem valor faz o
 * campo ser OMITIDO (mandar null/"" faria o provider recusar com 422); strings
 * com placeholder no meio sofrem interpolação textual.
 */
export function renderInputTemplate(
  template: Record<string, unknown>,
  vars: TemplateVars,
): Record<string, unknown> {
  const bag = { ...(vars as unknown as Record<string, unknown>) };
  if (bag.duration_ms == null && typeof vars.duration_int === 'number') bag.duration_ms = vars.duration_int * 1000;
  const out: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(template)) {
    // {"$list":"keyframe_url"} → ["url"]; {"$list":["a","b"]} junta e achata.
    // Lista vazia: o campo some.
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && '$list' in (raw as Record<string, unknown>)) {
      const names = ([] as unknown[]).concat((raw as { $list: unknown }).$list).filter((n): n is string => typeof n === 'string');
      const list: unknown[] = [];
      for (const name of names) {
        const v = bag[name];
        if (Array.isArray(v)) list.push(...v.filter((x) => x !== undefined && x !== null && x !== ''));
        else if (v !== undefined && v !== null && v !== '') list.push(v);
      }
      if (list.length) out[key] = list;
      continue;
    }
    // {"$map":"resolution","to":{"720p":"standard"}} → valor mapeado; sem casar, some.
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && '$map' in (raw as Record<string, unknown>)) {
      const m = raw as { $map: string; to?: Record<string, unknown> };
      const v = bag[m.$map];
      const to = m.to ?? {};
      if ((typeof v === 'string' || typeof v === 'number') && Object.prototype.hasOwnProperty.call(to, String(v))) {
        out[key] = to[String(v)];
      }
      continue;
    }
    // {"$when":"reference_urls","value":["first"]}: o campo só vai quando a
    // variável existe (ex.: keyframe_positions do Aleph sem keyframe_images = 422)
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && '$when' in (raw as Record<string, unknown>)) {
      const cond = raw as { $when: string; value: unknown };
      const v = bag[cond.$when];
      if (v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)) out[key] = cond.value;
      continue;
    }
    if (typeof raw !== 'string') {
      out[key] = raw;
      continue;
    }

    const exact = raw.match(PLACEHOLDER);
    if (exact) {
      const value = bag[exact[1]];
      if (value === undefined || value === null) continue; // campo some
      if (Array.isArray(value) && value.length === 0) continue;
      out[key] = value;
      continue;
    }

    if (raw.includes('{{')) {
      let missing = false;
      const interpolated = raw.replace(/\{\{([a-z_]+)\}\}/g, (_m, name: string) => {
        const value = bag[name];
        if (value === undefined || value === null) {
          missing = true;
          return '';
        }
        return String(value);
      });
      if (!missing) out[key] = interpolated;
      continue;
    }

    out[key] = raw;
  }

  return out;
}

/**
 * Campos OBRIGATÓRIOS do modelo que ficaram de fora — evita gastar uma chamada
 * para tomar 422.
 *
 * A lista vem de `required_inputs`, que é o array `required` do schema real do
 * Replicate. Antes isto olhava todo placeholder do template e reprovava campos
 * opcionais: o `image_input` do keyframe (pack de identidade do avatar) some
 * quando a instância não tem avatar, e a checagem matava a predição sozinha.
 */
export function missingRequiredInputs(
  entry: VideoModelEntry,
  resolved: Record<string, unknown>,
): string[] {
  return entry.required_inputs.filter((field) => !(field in resolved));
}

// ── Custo ────────────────────────────────────────────────────────────────────

export interface CostBasis {
  duration_s?: number;
  images?: number;
  chars?: number;
  /** resolução enviada: usa o preço dela quando o modelo cobra por resolução */
  resolution?: string;
}

/**
 * Estimativa de custo. O Replicate não expõe preço por API — os valores da
 * tabela são estimativa humana (`cost_verified_at` null). Por isso o guard DURO
 * do produto é a cota por contagem; este número serve para mostrar ao usuário
 * antes de gastar e para o teto mensal advisório.
 */
export function estimateCostUsd(entry: VideoModelEntry, basis: CostBasis): number {
  const { unit } = entry.cost;
  const byRes = basis.resolution ? entry.cost.by_resolution?.[basis.resolution] : undefined;
  const usd = typeof byRes === 'number' ? byRes : entry.cost.usd;
  switch (unit) {
    case 'per_second':
      return usd * (basis.duration_s ?? 0);
    case 'per_image':
      return usd * (basis.images ?? 1);
    case 'per_1k_chars':
      return (usd * (basis.chars ?? 0)) / 1000;
    case 'per_run':
    default:
      return usd;
  }
}

export function splitModelId(modelId: string): { owner: string; name: string } {
  const [owner, ...rest] = modelId.split('/');
  const name = rest.join('/');
  if (!owner || !name) {
    throw new CatalogError(`model_id inválido no catálogo: "${modelId}" (esperado owner/name).`);
  }
  return { owner, name };
}
