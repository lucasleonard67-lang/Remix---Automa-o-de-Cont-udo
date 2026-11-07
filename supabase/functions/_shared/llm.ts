// _shared/llm.ts — abstração de provider de IA (fonte: docs/06-arquitetura-ia.md §6).
// Nenhuma edge function fala com API de LLM diretamente — sempre via este módulo.
//
// - resolveProvider(role): lê app_settings.ai_providers (shape {driver, model} por papel;
//   fallback voice_extractor→generator) via service role. Ver 04-modelo-de-dados.md §8.9.
// - drivers: lovable-gateway (default, zero-config) · openai (BYO) · xai (BYO; Grok,
//   API compatível com a da OpenAI — só chat). O Claude NUNCA entra por API: o
//   produto usa o Claude pelo conector, com a assinatura da pessoa (AGENTS.md).
// - keys BYO lidas do Vault via rpc get_vault_secret (service role), fallback para env.
// - erros normalizados: 402 do gateway = créditos esgotados; 429 = retry 1x com backoff.
//
// NOTA: streaming ainda não é implementado aqui — chat() é sempre não-streaming.
// O papel 'image' (F3) entra por generateImage(), consumido por generate-image.

import { AsyncLocalStorage } from 'node:async_hooks';

import { createServiceClient } from './supabase.ts';

// ── Tipos ────────────────────────────────────────────────────────────────────

export type RoleHint =
  | 'router'
  | 'assistant'
  | 'generator'
  | 'judge'
  | 'voice_extractor'
  | 'embeddings'
  | 'image';

export type DriverName = 'lovable-gateway' | 'openai' | 'xai';

export const DRIVER_NAMES: readonly DriverName[] = ['lovable-gateway', 'openai', 'xai'];

export interface ProviderConfig {
  driver: DriverName;
  model: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatParams {
  role_hint: RoleHint;
  messages: ChatMessage[];
  /** JSON Schema → structured output do driver (objetos devem ter additionalProperties:false). */
  schema?: Record<string, unknown>;
  max_tokens?: number;
  /** Não implementado na F1 — reservado para a saga (F2). */
  stream?: boolean;
  /**
   * Provedor escolhido pelo usuário NESTA chamada (ex.: identidade visual
   * "gerada pela IA" com o provedor que ele apontou). Quando presente, ignora
   * app_settings.ai_providers; sem `model`, cai no padrão do driver no papel.
   */
  provider?: { driver: DriverName; model?: string };
}

export interface ChatUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface ChatResult {
  content: string;
  /** Objeto parseado quando `schema` foi passado. */
  parsed?: unknown;
  usage: ChatUsage;
  provider: DriverName;
  model: string;
}

export type LlmErrorCode =
  | 'credits_exhausted'
  | 'rate_limited'
  | 'provider_error'
  | 'invalid_config';

export class LlmError extends Error {
  code: LlmErrorCode;
  /** HTTP status sugerido para repassar ao frontend (07-contratos-backend.md §1). */
  status: number;

  constructor(code: LlmErrorCode, status: number, message: string) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.status = status;
  }
}

// ── Constantes ───────────────────────────────────────────────────────────────

const GATEWAY_CHAT_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const GATEWAY_EMBEDDINGS_URL = 'https://ai.gateway.lovable.dev/v1/embeddings';
const GATEWAY_IMAGES_URL = 'https://ai.gateway.lovable.dev/v1/images/generations';
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
// xAI (Grok): chat completions compatível com a OpenAI (docs.x.ai, verificado 2026-10-28).
const XAI_CHAT_URL = 'https://api.x.ai/v1/chat/completions';
/** Grok Imagine (docs.x.ai/docs/guides/image-generations): mesmo formato do endpoint de imagens da OpenAI. */
const XAI_IMAGES_URL = 'https://api.x.ai/v1/images/generations';
/** Modelo padrão do Grok quando o papel não fixa um (flagship em docs.x.ai/docs/models). */
const XAI_DEFAULT_MODEL = 'grok-4.7';

/** Dimensão dos embeddings — precisa bater com context_chunks.embedding vector(768). */
export const EMBEDDING_DIM = 768;

const DEFAULT_MAX_TOKENS = 16000;
const RETRY_BACKOFF_MS = 2000;

// Fallbacks SENSATOS quando app_settings.ai_providers está ausente/incompleta.
// A fonte da verdade é SEMPRE a setting (seed em 04-modelo-de-dados.md §12.3);
// IDs de modelo do gateway são indicativos — o código nunca hardcoda modelo
// fora destes fallbacks comentados.
const DEFAULT_PROVIDERS: Record<RoleHint, ProviderConfig> = {
  router: { driver: 'lovable-gateway', model: 'google/gemini-2.5-flash' },
  // Assistente do app (assistant-chat): conversa curta, ferramentas por JSON.
  // Sem config própria herda a do router (ver resolveProvider).
  assistant: { driver: 'lovable-gateway', model: 'google/gemini-2.5-flash' },
  generator: { driver: 'lovable-gateway', model: 'google/gemini-2.5-pro' },
  judge: { driver: 'lovable-gateway', model: 'google/gemini-2.5-pro' },
  voice_extractor: { driver: 'lovable-gateway', model: 'google/gemini-2.5-pro' },
  embeddings: { driver: 'lovable-gateway', model: 'google/gemini-embedding-001' },
  image: { driver: 'lovable-gateway', model: 'google/gemini-2.5-flash-image' },
};

/** Sem saldo na API, o trabalho segue pelo incluso em vez de parar a tela. */
// ── Conector: nunca API paga ─────────────────────────────────────────────────

const semApi = new AsyncLocalStorage<true>();

/**
 * Quem trabalha pelo conector é o Claude da assinatura da pessoa: o que o servidor
 * ainda gerar nessa chamada sai pelo gateway incluso, nunca por chave de API.
 */
export const semApiPaga = <T>(tarefa: () => Promise<T>): Promise<T> => semApi.run(true, tarefa);

export function provedorDaChamada(cfg: ProviderConfig, role: RoleHint, soIncluso: boolean): ProviderConfig {
  return soIncluso && cfg.driver !== 'lovable-gateway' ? DEFAULT_PROVIDERS[role] : cfg;
}

// ── resolveProvider ──────────────────────────────────────────────────────────

type AiProvidersSetting = Partial<Record<RoleHint, ProviderConfig>>;

let providersCache: { value: AiProvidersSetting; loadedAt: number } | null = null;
const PROVIDERS_CACHE_TTL_MS = 30_000;

function isValidConfig(cfg: unknown): cfg is ProviderConfig {
  if (!cfg || typeof cfg !== 'object') return false;
  const c = cfg as Record<string, unknown>;
  return (
    typeof c.driver === 'string' &&
    (DRIVER_NAMES as readonly string[]).includes(c.driver) &&
    typeof c.model === 'string' &&
    c.model.length > 0
  );
}

async function loadAiProviders(): Promise<AiProvidersSetting> {
  const now = Date.now();
  if (providersCache && now - providersCache.loadedAt < PROVIDERS_CACHE_TTL_MS) {
    return providersCache.value;
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'ai_providers')
    .maybeSingle();
  const value =
    !error && data?.value && typeof data.value === 'object'
      ? (data.value as AiProvidersSetting)
      : {};
  providersCache = { value, loadedAt: now };
  return value;
}

/**
 * Resolve {driver, model} para um papel a partir de app_settings.ai_providers.
 * voice_extractor não configurado herda a config do generator (04 §8.9).
 */
export async function resolveProvider(role: RoleHint): Promise<ProviderConfig> {
  const settings = await loadAiProviders();
  let cfg: ProviderConfig | undefined = isValidConfig(settings[role]) ? settings[role] : undefined;
  if (!cfg && role === 'voice_extractor' && isValidConfig(settings.generator)) {
    cfg = settings.generator;
  }
  if (!cfg && role === 'assistant' && isValidConfig(settings.router)) {
    cfg = settings.router;
  }
  return provedorDaChamada(cfg ?? DEFAULT_PROVIDERS[role], role, semApi.getStore() === true);
}

// ── Keys BYO (Vault → env) ───────────────────────────────────────────────────

async function getVaultSecret(name: string): Promise<string | null> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc('get_vault_secret', { _name: name });
    if (error) return null;
    const value = data as string | null;
    return value && value.length > 0 ? value : null;
  } catch (_err) {
    return null;
  }
}

/**
 * Key BYO opcional (Vault → env), sem lançar quando ausente. Usada por módulos
 * que decidem disponibilidade de recurso pela presença da key (ex.: web-search).
 */
export async function getOptionalByoKey(
  name: 'OPENAI_API_KEY' | 'XAI_API_KEY' | 'TAVILY_API_KEY' | 'FIRECRAWL_API_KEY',
): Promise<string | null> {
  return (await getVaultSecret(name)) ?? Deno.env.get(name) ?? null;
}

async function getByoKey(
  name: 'OPENAI_API_KEY' | 'XAI_API_KEY',
): Promise<string> {
  const key = (await getVaultSecret(name)) ?? Deno.env.get(name) ?? null;
  if (!key) {
    throw new LlmError(
      'invalid_config',
      500,
      `${name} não configurada. Cadastre a key BYO em /config/ia (store-secret) ou volte o papel para o driver lovable-gateway.`,
    );
  }
  return key;
}

// ── HTTP comum (402 claro; 429 retry 1x com backoff) ─────────────────────────

interface PostOptions {
  /** Quando true, um 400 é devolvido ao chamador em vez de virar LlmError (usado p/ fallback de structured output). */
  allow400?: boolean;
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  providerLabel: string,
  opts: PostOptions = {},
): Promise<Response> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };

  let res = await fetch(url, init);

  // 429 → retry único com backoff (respeita Retry-After quando presente)
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after'));
    const delayMs =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 15_000)
        : RETRY_BACKOFF_MS;
    await res.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    res = await fetch(url, init);
  }

  if (res.ok) return res;
  if (opts.allow400 && res.status === 400) return res;

  const detail = (await res.text().catch(() => '')).slice(0, 300);

  if (res.status === 402) {
    // Créditos do Lovable AI Gateway esgotados — erro claro para a UI orientar /config/ia.
    throw new LlmError(
      'credits_exhausted',
      402,
      'Créditos de IA do workspace esgotados. Adicione créditos Lovable ou configure uma API key própria em /config/ia.',
    );
  }
  if (res.status === 429) {
    throw new LlmError(
      'rate_limited',
      429,
      `Rate limit do provider de IA (${providerLabel}). Tente novamente em instantes.`,
    );
  }
  throw new LlmError(
    'provider_error',
    502,
    `Erro do provider de IA (${providerLabel}, HTTP ${res.status}): ${detail || 'sem detalhe'}`,
  );
}

// ── Parse de JSON tolerante (fallback "responda apenas JSON válido") ─────────

function parseJsonLoose(text: string): unknown {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(stripped);
  } catch (_err) {
    // Última tentativa: extrai o primeiro bloco {...} ou [...] do texto.
    const match = stripped.match(/[{[][\s\S]*[}\]]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (_err2) {
        // cai no throw abaixo
      }
    }
    throw new LlmError(
      'provider_error',
      502,
      'O modelo não retornou JSON válido para o schema solicitado.',
    );
  }
}

function withJsonInstruction(
  messages: ChatMessage[],
  schema: Record<string, unknown>,
): ChatMessage[] {
  const instruction: ChatMessage = {
    role: 'system',
    content:
      'Responda APENAS com um JSON válido, sem markdown, sem comentários e sem texto fora do JSON, ' +
      `estritamente no formato deste JSON Schema:\n${JSON.stringify(schema)}`,
  };
  return [...messages, instruction];
}

// ── Driver: lovable-gateway (OpenAI-compatible) ──────────────────────────────

function gatewayHeaders(): Record<string, string> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) {
    throw new LlmError(
      'invalid_config',
      500,
      'LOVABLE_API_KEY ausente no ambiente da edge function (injetada automaticamente pelo Lovable Cloud com AI Gateway ativo).',
    );
  }
  return { Authorization: `Bearer ${apiKey}` };
}

interface OpenAiCompatChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

async function chatLovableGateway(model: string, params: ChatParams): Promise<ChatResult> {
  const headers = gatewayHeaders();
  const maxTokens = params.max_tokens ?? DEFAULT_MAX_TOKENS;

  let res: Response;
  let usedJsonFallback = false;

  if (params.schema) {
    // 1ª tentativa: structured output nativo via response_format json_schema.
    res = await postJson(
      GATEWAY_CHAT_URL,
      headers,
      {
        model,
        messages: params.messages,
        max_tokens: maxTokens,
        stream: false,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'response', strict: true, schema: params.schema },
        },
      },
      'lovable-gateway',
      { allow400: true },
    );

    if (res.status === 400) {
      // Modelo/gateway sem suporte a response_format → fallback:
      // instrução "responda apenas JSON válido" + parse tolerante.
      await res.body?.cancel();
      usedJsonFallback = true;
      res = await postJson(
        GATEWAY_CHAT_URL,
        headers,
        {
          model,
          messages: withJsonInstruction(params.messages, params.schema),
          max_tokens: maxTokens,
          stream: false,
        },
        'lovable-gateway',
      );
    }
  } else {
    res = await postJson(
      GATEWAY_CHAT_URL,
      headers,
      { model, messages: params.messages, max_tokens: maxTokens, stream: false },
      'lovable-gateway',
    );
  }

  const data = (await res.json()) as OpenAiCompatChatResponse;
  const content = data.choices?.[0]?.message?.content ?? '';
  const parsed = params.schema ? parseJsonLoose(content) : undefined;
  void usedJsonFallback; // reservado para telemetria (attempts) na F2

  return {
    content,
    parsed,
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
    },
    provider: 'lovable-gateway',
    model,
  };
}

export type VisionPart =
  | { type: 'text'; text: string }
  | { type: 'image'; media_type: string; data: string };

export interface VisionJsonParams {
  model: string;
  system: string;
  parts: VisionPart[];
  schema: Record<string, unknown>;
  max_tokens?: number;
}

/**
 * Pergunta com texto E imagens (quadros de vídeo), resposta em JSON pelo
 * schema, sempre pelo gateway incluso. É o caminho do motor de edição de
 * vídeo; nunca há chave de API de LLM aqui.
 */
export async function visionJson(
  params: VisionJsonParams,
): Promise<{ text: string; usage: ChatUsage }> {
  const content = params.parts.map((p) =>
    p.type === 'text'
      ? { type: 'text', text: p.text }
      : { type: 'image_url', image_url: { url: `data:${p.media_type};base64,${p.data}` } },
  );
  const body = {
    model: params.model,
    messages: [
      { role: 'system', content: params.system },
      { role: 'user', content },
    ],
    max_tokens: params.max_tokens ?? DEFAULT_MAX_TOKENS,
    stream: false,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'response', strict: true, schema: params.schema },
    },
  };
  const res = await postJson(GATEWAY_CHAT_URL, gatewayHeaders(), body, 'lovable-gateway');
  const data = (await res.json()) as OpenAiCompatChatResponse;
  return {
    text: data.choices?.[0]?.message?.content ?? '',
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
    },
  };
}

interface EmbeddingsResponse {
  data?: Array<{ index: number; embedding: number[] }>;
}

async function embedLovableGateway(model: string, texts: string[]): Promise<number[][]> {
  const headers = gatewayHeaders();

  // Passa dimensions=768 (param OpenAI-compatible p/ output_dimensionality);
  // se o modelo não aceitar (400), tenta sem — e valida a dimensão na volta.
  let res = await postJson(
    GATEWAY_EMBEDDINGS_URL,
    headers,
    { model, input: texts, dimensions: EMBEDDING_DIM },
    'lovable-gateway',
    { allow400: true },
  );
  if (res.status === 400) {
    await res.body?.cancel();
    res = await postJson(
      GATEWAY_EMBEDDINGS_URL,
      headers,
      { model, input: texts },
      'lovable-gateway',
    );
  }

  return extractEmbeddings((await res.json()) as EmbeddingsResponse, texts.length, model);
}

function extractEmbeddings(
  data: EmbeddingsResponse,
  expectedCount: number,
  model: string,
): number[][] {
  const rows = [...(data.data ?? [])].sort((a, b) => a.index - b.index);
  if (rows.length !== expectedCount) {
    throw new LlmError(
      'provider_error',
      502,
      `Endpoint de embeddings retornou ${rows.length} vetores para ${expectedCount} textos (model ${model}).`,
    );
  }
  const vectors = rows.map((r) => r.embedding);
  for (const v of vectors) {
    if (!Array.isArray(v) || v.length !== EMBEDDING_DIM) {
      throw new LlmError(
        'provider_error',
        502,
        `Embedding com dimensão ${v?.length ?? 'desconhecida'} — o schema exige vector(${EMBEDDING_DIM}). ` +
          `Configure um modelo de embeddings com saída de ${EMBEDDING_DIM} dimensões (model atual: ${model}).`,
      );
    }
  }
  return vectors;
}

// ── Driver: openai (chat completions) · xai usa o mesmo caminho ──────────────

async function chatOpenai(model: string, params: ChatParams): Promise<ChatResult> {
  const apiKey = await getByoKey('OPENAI_API_KEY');
  return chatOpenAiCompatible(OPENAI_CHAT_URL, apiKey, 'openai', model, params);
}

/** Grok (xAI): mesma forma de request/response da OpenAI, só muda host e chave. */
async function chatXai(model: string, params: ChatParams): Promise<ChatResult> {
  const apiKey = await getByoKey('XAI_API_KEY');
  return chatOpenAiCompatible(XAI_CHAT_URL, apiKey, 'xai', model, params);
}

async function chatOpenAiCompatible(
  url: string,
  apiKey: string,
  provider: 'openai' | 'xai',
  model: string,
  params: ChatParams,
): Promise<ChatResult> {
  const body: Record<string, unknown> = {
    model,
    messages: params.messages,
    // max_completion_tokens é o nome aceito pelos modelos atuais da OpenAI
    // (max_tokens é rejeitado nas famílias mais novas).
    max_completion_tokens: params.max_tokens ?? DEFAULT_MAX_TOKENS,
    stream: false,
  };
  if (params.schema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'response', strict: true, schema: params.schema },
    };
  }

  const res = await postJson(url, { Authorization: `Bearer ${apiKey}` }, body, provider);
  const data = (await res.json()) as OpenAiCompatChatResponse;
  const content = data.choices?.[0]?.message?.content ?? '';
  const parsed = params.schema ? parseJsonLoose(content) : undefined;

  return {
    content,
    parsed,
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
    },
    provider,
    model,
  };
}

/** Grok não oferece embeddings nem imagem: o erro nomeia a etapa e o que fazer. */
function xaiUnsupported(role: 'embeddings' | 'image'): LlmError {
  const etapa = role === 'embeddings' ? 'embeddings' : 'imagens';
  return new LlmError(
    'invalid_config',
    500,
    `Grok não gera ${etapa}; escolha outro provedor para esta etapa em Config → IA.`,
  );
}

async function embedOpenai(model: string, texts: string[]): Promise<number[][]> {
  const apiKey = await getByoKey('OPENAI_API_KEY');
  // text-embedding-3-* aceita dimensions; validamos a dimensão na volta de todo jeito.
  let res = await postJson(
    OPENAI_EMBEDDINGS_URL,
    { Authorization: `Bearer ${apiKey}` },
    { model, input: texts, dimensions: EMBEDDING_DIM },
    'openai',
    { allow400: true },
  );
  if (res.status === 400) {
    await res.body?.cancel();
    res = await postJson(
      OPENAI_EMBEDDINGS_URL,
      { Authorization: `Bearer ${apiKey}` },
      { model, input: texts },
      'openai',
    );
  }
  return extractEmbeddings((await res.json()) as EmbeddingsResponse, texts.length, model);
}

// ── Papel 'image' (consumido por generate-image — 07-contratos-backend.md §3.5) ──
// Duas famílias, roteadas pelo ID do modelo resolvido para o papel 'image':
//   - gpt-image*  → endpoint de imagens (OpenAI-compatible), resposta b64_json
//   - gemini*     → chat completions com modalities:['image','text'], base64 inline
// Erros passam pelo mesmo postJson do resto do módulo: 402 vira credits_exhausted,
// 429 tem retry único, o resto vira provider_error 502.

export interface ImageParams {
  prompt: string;
  /** ex.: '1024x1024' | '1024x1536' | '1536x1024'. Omitido = default do provider. */
  size?: string;
}

export interface ImageResult {
  /** Bytes da imagem em base64, SEM o prefixo data:. */
  b64: string;
  mime: string;
  provider: DriverName;
  model: string;
}

interface ImagesEndpointResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/** Separa um data URI `data:image/png;base64,AAA…` em {mime, b64}. */
function splitDataUri(uri: string): { b64: string; mime: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(uri.trim());
  if (!match) return null;
  return { mime: match[1], b64: match[2] };
}

/** ArrayBuffer → base64 (chunked: evita estourar o stack em imagens grandes). */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Endpoint de imagens (gateway ou OpenAI): {model, prompt, size} → b64_json. */
async function imagesEndpoint(
  url: string,
  headers: Record<string, string>,
  model: string,
  params: ImageParams,
  label: string,
): Promise<{ b64: string; mime: string }> {
  const base: Record<string, unknown> = { model, prompt: params.prompt };
  // size é o único param opcional: se o modelo não aceitar o valor (400),
  // repete sem ele (mesmo padrão de `dimensions` nos embeddings).
  let res = await postJson(
    url,
    headers,
    params.size ? { ...base, size: params.size } : base,
    label,
    { allow400: Boolean(params.size) },
  );
  if (res.status === 400 && params.size) {
    await res.body?.cancel();
    res = await postJson(url, headers, base, label);
  }

  const data = (await res.json()) as ImagesEndpointResponse;
  const first = data.data?.[0];
  if (first?.b64_json && first.b64_json.length > 0) {
    return { b64: first.b64_json, mime: 'image/png' };
  }
  // Alguns providers devolvem URL temporária em vez de base64.
  if (first?.url) {
    const inline = splitDataUri(first.url);
    if (inline) return inline;
    const download = await fetch(first.url);
    if (!download.ok) {
      throw new LlmError(
        'provider_error',
        502,
        `Falha ao baixar a imagem gerada (${label}, HTTP ${download.status}).`,
      );
    }
    const mime = download.headers.get('content-type') ?? 'image/png';
    return { b64: arrayBufferToBase64(await download.arrayBuffer()), mime };
  }
  throw new LlmError('provider_error', 502, `O modelo de imagem (${label}) não retornou imagem.`);
}

/**
 * Procura uma imagem base64 na message de um chat completion multimodal.
 * Ordem: message.images[].image_url.url → partes de content → varredura do JSON.
 */
function extractInlineImage(message: unknown): { b64: string; mime: string } | null {
  const msg = asRecord(message);
  if (!msg) return null;

  const fromUrlHolder = (holder: unknown): { b64: string; mime: string } | null => {
    const rec = asRecord(holder);
    if (!rec) return null;
    const nested = asRecord(rec.image_url);
    const candidate =
      (nested && typeof nested.url === 'string' ? nested.url : undefined) ??
      (typeof rec.url === 'string' ? rec.url : undefined) ??
      (typeof rec.b64_json === 'string' ? `data:image/png;base64,${rec.b64_json}` : undefined);
    return candidate ? splitDataUri(candidate) : null;
  };

  for (const image of Array.isArray(msg.images) ? msg.images : []) {
    const found = fromUrlHolder(image);
    if (found) return found;
  }
  for (const part of Array.isArray(msg.content) ? msg.content : []) {
    const found = fromUrlHolder(part);
    if (found) return found;
  }

  const match = /data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/.exec(
    JSON.stringify(msg) ?? '',
  );
  return match ? { mime: match[1], b64: match[2] } : null;
}

/** Gemini image no gateway: chat completions com modalities image+text. */
async function imageGeminiGateway(
  model: string,
  params: ImageParams,
): Promise<{ b64: string; mime: string }> {
  const res = await postJson(
    GATEWAY_CHAT_URL,
    gatewayHeaders(),
    {
      model,
      messages: [{ role: 'user', content: params.prompt }],
      modalities: ['image', 'text'],
    },
    'lovable-gateway',
  );
  const data = (await res.json()) as { choices?: Array<{ message?: unknown }> };
  const inline = extractInlineImage(data.choices?.[0]?.message);
  if (!inline) {
    throw new LlmError(
      'provider_error',
      502,
      `O modelo ${model} não retornou imagem inline (modalities image+text).`,
    );
  }
  return inline;
}

function unsupportedImageModel(driver: DriverName, model: string): LlmError {
  return new LlmError(
    'invalid_config',
    500,
    `Modelo de imagem não suportado no papel 'image' (driver ${driver}, model "${model}"). ` +
      'Configure gpt-image-* ou um modelo gemini de imagem em /config/ia.',
  );
}

/**
 * Gera UMA imagem a partir de um prompt textual, resolvendo driver+modelo pelo
 * papel 'image' (app_settings.ai_providers). Retorna os bytes em base64 —
 * quem grava no bucket `renders` é a edge function generate-image.
 */
export async function generateImage(params: ImageParams): Promise<ImageResult> {
  const cfg = await resolveProvider('image');
  const model = cfg.model;
  const isGptImage = model.startsWith('gpt-image') || model.includes('/gpt-image');
  const isGemini = model.toLowerCase().includes('gemini');

  let inline: { b64: string; mime: string };
  switch (cfg.driver) {
    case 'lovable-gateway':
      if (isGptImage) {
        inline = await imagesEndpoint(GATEWAY_IMAGES_URL, gatewayHeaders(), model, params, 'lovable-gateway');
      } else if (isGemini) {
        inline = await imageGeminiGateway(model, params);
      } else {
        throw unsupportedImageModel(cfg.driver, model);
      }
      break;
    case 'openai': {
      if (!isGptImage && !model.startsWith('dall-e')) throw unsupportedImageModel(cfg.driver, model);
      const apiKey = await getByoKey('OPENAI_API_KEY');
      inline = await imagesEndpoint(
        OPENAI_IMAGES_URL,
        { Authorization: `Bearer ${apiKey}` },
        model,
        params,
        'openai',
      );
      break;
    }
    case 'xai': {
      // Grok Imagine: só modelos de imagem (grok-imagine-*); os de chat recusam.
      if (!model.startsWith('grok-imagine') && !model.includes('image')) {
        throw unsupportedImageModel(cfg.driver, model);
      }
      const apiKey = await getByoKey('XAI_API_KEY');
      // size não faz parte da API do Grok Imagine: vai sem ele
      inline = await imagesEndpoint(
        XAI_IMAGES_URL,
        { Authorization: `Bearer ${apiKey}` },
        model,
        { prompt: params.prompt },
        'xai',
      );
      break;
    }
  }

  return { b64: inline.b64, mime: inline.mime, provider: cfg.driver, model };
}

// ── API pública ──────────────────────────────────────────────────────────────

/**
 * Config efetiva de uma chamada de chat: o override da chamada (quando o
 * usuário escolheu o provedor na tela) ou a do papel em app_settings.
 */
async function chatConfig(params: ChatParams): Promise<ProviderConfig> {
  const override = params.provider;
  if (!override || !(DRIVER_NAMES as readonly string[]).includes(override.driver)) {
    return resolveProvider(params.role_hint);
  }
  if (override.model && override.model.trim()) {
    return { driver: override.driver, model: override.model.trim() };
  }
  // Sem modelo: reaproveita o modelo do papel se for do mesmo driver; senão o
  // padrão conhecido do driver (gateway e Grok têm um; OpenAI exige ID).
  const role = await resolveProvider(params.role_hint);
  if (role.driver === override.driver) return role;
  if (override.driver === 'lovable-gateway') return DEFAULT_PROVIDERS[params.role_hint];
  if (override.driver === 'xai') return { driver: 'xai', model: XAI_DEFAULT_MODEL };
  throw new LlmError(
    'invalid_config',
    400,
    'Escolha o modelo deste provedor antes de gerar (ou configure-o em Config → IA).',
  );
}

/** Chat completion não-streaming, resolvendo provider+modelo pelo papel. */
export async function chat(params: ChatParams): Promise<ChatResult> {
  const cfg = await chatConfig(params);
  // stream=true é ignorado na F1 (nenhum consumidor de streaming ainda).
  switch (cfg.driver) {
    case 'lovable-gateway':
      return chatLovableGateway(cfg.model, params);
    case 'openai':
      return chatOpenai(cfg.model, params);
    case 'xai':
      return chatXai(cfg.model, params);
  }
}

/** Embeddings em lote (papel 'embeddings'), sempre com EMBEDDING_DIM dimensões. */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const cfg = await resolveProvider('embeddings');
  switch (cfg.driver) {
    case 'lovable-gateway':
      return embedLovableGateway(cfg.model, texts);
    case 'openai':
      return embedOpenai(cfg.model, texts);
    case 'xai':
      throw xaiUnsupported('embeddings');
  }
}
