// _shared/replicate.ts — client HTTP da API do Replicate (geração de vídeo/áudio/imagem).
// 7º módulo autorizado a falar com API externa. Spec: docs/11-video-replicate.md §1.
//
// Contrato (replicate.com/docs):
// - Official model:  POST /v1/models/{owner}/{name}/predictions  (sem version; roda a latest)
// - Community model: POST /v1/predictions {version, input, …}    (version hash pinnado)
// - GET  /v1/predictions/{id}  ·  POST /v1/predictions/{id}/cancel
// - GET  /v1/webhooks/default/secret → { key: "whsec_<base64>" }  (secret POR CONTA)
// - Auth: header `Authorization: Bearer r8_…` — a key vem SÓ do Vault, resolvida pelo caller.
//
// Três regras deste módulo, cada uma paga com aprendizado do ciclo anterior:
// 1. A URL de output é EFÊMERA (~1h) → streamToBucket persiste os bytes na hora, em STREAM
//    (nunca arrayBuffer: um Reel de 720p não cabe confortavelmente na memória do worker).
// 2. Todo create leva `webhook` — `Prefer: wait` é só otimização de latência e pode expirar.
// 3. Erro do provider é CLASSIFICADO: 401/402/403 pausam o projeto sem queimar tentativas;
//    input/moderação são terminais; 5xx/429/aborted são elegíveis a retry e fallback.

const API = 'https://api.replicate.com/v1';

/** Tentativas de criação em falha transiente e o backoff entre elas. */
const CREATE_MAX_ATTEMPTS = 3;
const CREATE_BACKOFF_MS = [1_000, 4_000, 10_000];

export type PredictionStatus =
  | 'starting'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  /** Deadline estourado ANTES de começar a rodar (sem cobrança) — tratado como transiente. */
  | 'aborted';

export interface Prediction {
  id: string;
  status: PredictionStatus;
  /** Versão EFETIVA usada. Official roda sempre a latest — gravar para auditoria. */
  version: string | null;
  output: unknown;
  error: string | null;
  metrics: { predict_time?: number } | null;
}

/** Classe do erro do provider — decide retry, fallback ou pausa do projeto (§1.1 do doc 11). */
export type ReplicateErrorCode = 'auth' | 'input' | 'moderation' | 'transient' | 'unknown';

export class ReplicateError extends Error {
  status: number;
  code: ReplicateErrorCode;
  /** `Retry-After` do provider (ms), quando ele diz quanto esperar (429). */
  retryAfterMs?: number;

  constructor(status: number, code: ReplicateErrorCode, message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'ReplicateError';
    this.status = status;
    this.code = code;
    if (retryAfterMs) this.retryAfterMs = retryAfterMs;
  }

  /** Só o transiente vale nova tentativa — repetir input inválido paga para falhar igual. */
  get retryable(): boolean {
    return this.code === 'transient';
  }
}

export interface CreateOpts {
  input: Record<string, unknown>;
  /** SEMPRE preenchida, com ?pid=<uuid interno> — ver §3.4 (adoção de predição órfã). */
  webhookUrl: string;
  /** Só 'completed' por default: é o único evento com retry garantido. */
  webhookEvents?: Array<'start' | 'output' | 'logs' | 'completed'>;
  /** 1–60s. Só para utilitários CPU e TTS; NÃO substitui o webhook. */
  preferWaitSeconds?: number;
}

// ── Erros ────────────────────────────────────────────────────────────────────

function readDetail(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const data = body as Record<string, unknown>;
  for (const key of ['detail', 'error', 'message', 'title']) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/**
 * Traduz status + corpo do Replicate para classe + mensagem acionável em pt-BR.
 * A classificação é a parte que importa: sem ela, uma key revogada com N cenas em
 * voo vira uma cascata de "cena falhou: input inválido" queimando todas as tentativas.
 */
export function classifyReplicateError(
  status: number,
  body: unknown,
): { code: ReplicateErrorCode; message: string } {
  const detail = readDetail(body);
  const lower = detail.toLowerCase();

  if (status === 401 || status === 403) {
    return {
      code: 'auth',
      message:
        'Credencial do Replicate inválida ou sem permissão. Grave um token válido em ' +
        'Config → Integrações — a produção deste vídeo fica pausada até lá.',
    };
  }
  if (status === 402 || lower.includes('insufficient credit') || lower.includes('payment')) {
    return {
      code: 'auth',
      message:
        'Conta do Replicate sem crédito. Adicione crédito em replicate.com/account/billing — ' +
        'a produção deste vídeo fica pausada até lá.',
    };
  }
  if (lower.includes('nsfw') || lower.includes('flagged') || lower.includes('safety')) {
    return {
      code: 'moderation',
      message: 'Conteúdo bloqueado pela moderação do modelo. Ajuste o prompt da cena.',
    };
  }
  if (status === 429 || lower.includes('throttle')) {
    return {
      code: 'transient',
      message: 'Limite de requisições do Replicate atingido. Vamos tentar de novo em instantes.',
    };
  }
  if (status >= 500) {
    return {
      code: 'transient',
      message: 'Replicate instável no momento (erro do lado deles). Nova tentativa em instantes.',
    };
  }
  if (status === 404) {
    return {
      code: 'input',
      message:
        'Modelo não encontrado no Replicate. Rode "Validar catálogo" em Config → Integrações — ' +
        'o slug pode ter mudado.',
    };
  }
  if (status === 400 || status === 422) {
    return {
      code: 'input',
      message: detail
        ? `O modelo recusou os parâmetros: ${detail}`
        : 'O modelo recusou os parâmetros enviados para esta cena.',
    };
  }
  return {
    code: 'unknown',
    message: detail || `Erro do Replicate (HTTP ${status}).`,
  };
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

interface FetchOpts {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** Prefer: wait=n — segura a resposta por até n segundos (máx. 60). */
  preferWaitSeconds?: number;
}

async function apiFetch(token: string, path: string, opts: FetchOpts = {}): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (opts.preferWaitSeconds !== undefined) {
    const wait = Math.max(1, Math.min(60, Math.round(opts.preferWaitSeconds)));
    headers.Prefer = `wait=${wait}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    // Falha de rede é transiente por definição — nunca queima o fallback do modelo.
    throw new ReplicateError(
      0,
      'transient',
      `Não foi possível falar com o Replicate: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch (_err) {
    data = null;
  }

  if (!res.ok) {
    const { code, message } = classifyReplicateError(res.status, data);
    throw new ReplicateError(res.status, code, message, retryAfterMs(res.headers.get('retry-after')));
  }
  return data;
}

/** `Retry-After` em segundos ou data HTTP → ms a esperar (0 = não informado). */
function retryAfterMs(header: string | null): number {
  if (!header) return 0;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs > 0) return Math.round(secs * 1000);
  const when = Date.parse(header);
  return Number.isFinite(when) ? Math.max(0, when - Date.now()) : 0;
}

function toPrediction(data: unknown): Prediction {
  const raw = (data ?? {}) as Record<string, unknown>;
  const id = raw.id;
  if (typeof id !== 'string' || !id) {
    throw new ReplicateError(502, 'unknown', 'O Replicate não devolveu o id da predição.');
  }
  const metrics = raw.metrics;
  return {
    id,
    status: (typeof raw.status === 'string' ? raw.status : 'starting') as PredictionStatus,
    version: typeof raw.version === 'string' ? raw.version : null,
    output: raw.output ?? null,
    error: typeof raw.error === 'string' ? raw.error : null,
    metrics: metrics && typeof metrics === 'object' ? (metrics as { predict_time?: number }) : null,
  };
}

function createBody(opts: CreateOpts, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    ...extra,
    input: opts.input,
    webhook: opts.webhookUrl,
    webhook_events_filter: opts.webhookEvents ?? ['completed'],
  };
}

/** Repete só falha transiente; erro de auth/input aborta na primeira (não adianta insistir). */
async function withCreateRetry(fn: () => Promise<unknown>): Promise<Prediction> {
  let last: unknown;
  for (let attempt = 0; attempt < CREATE_MAX_ATTEMPTS; attempt++) {
    try {
      return toPrediction(await fn());
    } catch (err) {
      last = err;
      if (!(err instanceof ReplicateError) || !err.retryable) throw err;
      if (attempt === CREATE_MAX_ATTEMPTS - 1) break;
      // o provider pode dizer quanto esperar (429 com Retry-After); respeita até 20 s
      const wait = Math.min(20_000, Math.max(CREATE_BACKOFF_MS[attempt], err.retryAfterMs ?? 0));
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  throw last;
}

/**
 * Official model — billing por OUTPUT, sem cold start, sem version hash.
 * É o caminho feliz de todo modelo de mídia do catálogo.
 */
export function createOfficialPrediction(
  token: string,
  owner: string,
  name: string,
  opts: CreateOpts,
): Promise<Prediction> {
  return withCreateRetry(() =>
    apiFetch(token, `/models/${owner}/${name}/predictions`, {
      method: 'POST',
      body: createBody(opts, {}),
      preferWaitSeconds: opts.preferWaitSeconds,
    }),
  );
}

/**
 * Community model — billing por tempo de hardware. Só os 3 utilitários de montagem,
 * SEMPRE com o version hash pinnado (o dono pode publicar versão nova a qualquer hora).
 */
export function createVersionedPrediction(
  token: string,
  versionHash: string,
  opts: CreateOpts,
): Promise<Prediction> {
  return withCreateRetry(() =>
    apiFetch(token, '/predictions', {
      method: 'POST',
      body: createBody(opts, { version: versionHash }),
      preferWaitSeconds: opts.preferWaitSeconds,
    }),
  );
}

export async function getPrediction(token: string, id: string): Promise<Prediction> {
  return toPrediction(await apiFetch(token, `/predictions/${id}`));
}

export async function cancelPrediction(token: string, id: string): Promise<void> {
  try {
    await apiFetch(token, `/predictions/${id}/cancel`, { method: 'POST' });
  } catch (err) {
    // Cancelar o que já terminou (ou nunca existiu) não é erro para o caller.
    if (!(err instanceof ReplicateError) || (err.status !== 404 && err.status !== 409)) throw err;
  }
}

/**
 * Signing secret dos webhooks — é POR CONTA, não por predição: obtido uma vez pelo
 * `setup` e guardado no Vault. O handler do webhook NUNCA chama a API para validar.
 */
export async function fetchWebhookSigningSecret(token: string): Promise<string> {
  const data = (await apiFetch(token, '/webhooks/default/secret')) as Record<string, unknown>;
  const key = data?.key;
  if (typeof key !== 'string' || !key.startsWith('whsec_')) {
    throw new ReplicateError(502, 'unknown', 'O Replicate não devolveu o secret do webhook.');
  }
  return key;
}

/** Metadados públicos do modelo — usados pelo validate_catalog (§4.7 do doc 11). */
export interface ModelInfo {
  owner: string;
  name: string;
  latestVersion: string | null;
  inputSchema: Record<string, unknown> | null;
}

/**
 * Confirma que uma versão FIXADA ainda existe (404 = sumiu).
 *
 * É a checagem que importa para os modelos community: a montagem inteira
 * depende de três utilitários de mantenedores individuais, sem fallback, e o
 * dono pode remover uma versão a qualquer momento. Comparar com a "latest" não
 * detectaria isso — pinar é o desenho, divergir da latest é o esperado.
 */
export async function versionExists(
  token: string,
  owner: string,
  name: string,
  versionHash: string,
): Promise<boolean> {
  try {
    await apiFetch(token, `/models/${owner}/${name}/versions/${versionHash}`);
    return true;
  } catch (err) {
    if (err instanceof ReplicateError && err.status === 404) return false;
    throw err;
  }
}

export async function getModel(token: string, owner: string, name: string): Promise<ModelInfo> {
  const data = (await apiFetch(token, `/models/${owner}/${name}`)) as Record<string, unknown>;
  const latest = (data.latest_version ?? null) as Record<string, unknown> | null;
  const openapi = (latest?.openapi_schema ?? null) as Record<string, unknown> | null;
  const components = (openapi?.components ?? null) as Record<string, unknown> | null;
  const schemas = (components?.schemas ?? null) as Record<string, unknown> | null;
  const input = (schemas?.Input ?? null) as Record<string, unknown> | null;
  return {
    owner,
    name,
    latestVersion: typeof latest?.id === 'string' ? (latest.id as string) : null,
    inputSchema: input,
  };
}

// ── Persistência do output ───────────────────────────────────────────────────

/** Primeira URI do output — a maioria dos modelos devolve string; alguns, array. */
export function firstOutputUrl(output: unknown): string | null {
  if (typeof output === 'string') return output.startsWith('http') ? output : null;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (typeof item === 'string' && item.startsWith('http')) return item;
    }
  }
  if (output && typeof output === 'object') {
    for (const value of Object.values(output as Record<string, unknown>)) {
      if (typeof value === 'string' && value.startsWith('http')) return value;
    }
  }
  return null;
}

/** Client mínimo do Storage que este módulo precisa (evita acoplar ao tipo do supabase-js). */
export interface BucketWriter {
  storage: {
    from(bucket: string): {
      uploadToSignedUrl?: unknown;
      upload(
        path: string,
        body: ReadableStream<Uint8Array> | Uint8Array | Blob,
        options?: { contentType?: string; upsert?: boolean; duplex?: string },
      ): Promise<{ error: { message: string } | null }>;
    };
  };
}

export interface DownloadResult {
  path: string;
  bytes: number;
}

/**
 * Baixa o output do Replicate e persiste no bucket privado.
 *
 * A URL do replicate.delivery expira em ~1h: quem chama isto é o handler do webhook,
 * dentro de EdgeRuntime.waitUntil, imediatamente. Um 404 aqui significa "pago e
 * perdido" — vira erro TERMINAL com mensagem própria, nunca laço de re-download.
 *
 * O corpo é repassado em STREAM para o Storage; `maxBytes` recusa antes de baixar
 * quando o provider informa content-length (o master de 5 cenas passa de 100 MB).
 */
export async function streamToBucket(
  service: BucketWriter,
  url: string,
  bucket: string,
  path: string,
  contentType: string,
  maxBytes: number,
): Promise<DownloadResult> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new ReplicateError(
      0,
      'transient',
      `Falha de rede ao baixar o arquivo gerado: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (res.status === 404 || res.status === 410) {
    throw new ReplicateError(
      res.status,
      'input',
      'O arquivo gerado expirou no Replicate antes de ser salvo (a URL vale ~1h). ' +
        'É preciso gerar de novo — o custo anterior já foi cobrado.',
    );
  }
  if (!res.ok) {
    throw new ReplicateError(
      res.status,
      res.status >= 500 ? 'transient' : 'unknown',
      `Falha ao baixar o arquivo gerado (HTTP ${res.status}).`,
    );
  }

  const header = Number(res.headers.get('content-length') ?? '');
  const declared = Number.isFinite(header) && header > 0 ? header : null;
  if (declared !== null && declared > maxBytes) {
    throw new ReplicateError(
      413,
      'input',
      `O arquivo gerado tem ${Math.round(declared / 1_048_576)} MB e excede o teto de ` +
        `${Math.round(maxBytes / 1_048_576)} MB desta instância. Reduza a duração ou a resolução.`,
    );
  }
  if (!res.body) {
    throw new ReplicateError(502, 'unknown', 'O download do arquivo gerado veio sem corpo.');
  }

  // Conta os bytes DURANTE o pipe: content-length é opcional (resposta chunked devolveria
  // 0) e o tamanho do mp3 é o que dá a duração da cena (§3.3). Também é aqui que o teto
  // vale de verdade — sem header, a recusa acima nunca dispararia.
  let observed = 0;
  const counted = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        observed += chunk.byteLength;
        if (observed > maxBytes) {
          throw new ReplicateError(
            413,
            'input',
            `O arquivo gerado excede o teto de ${Math.round(maxBytes / 1_048_576)} MB desta ` +
              'instância. Reduza a duração ou a resolução do vídeo.',
          );
        }
        controller.enqueue(chunk);
      },
    }),
  );

  const { error } = await service.storage.from(bucket).upload(path, counted, {
    contentType,
    upsert: true,
    // Exigido por fetch/undici para enviar um stream como corpo.
    duplex: 'half',
  });
  if (error) {
    throw new ReplicateError(500, 'unknown', `Falha ao salvar no bucket: ${error.message}`);
  }

  return { path, bytes: observed };
}

// ── Webhook: assinatura (padrão svix) ────────────────────────────────────────

/** Tolerância anti-replay do timestamp do webhook. */
const WEBHOOK_TOLERANCE_S = 300;

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Comparação em tempo constante (evita oracle de timing na função pública). */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Valida a assinatura do webhook do Replicate ANTES de qualquer efeito colateral.
 *
 * signedContent = `${webhook-id}.${webhook-timestamp}.${corpo cru}`
 * chave         = base64-decode do que vem depois de "whsec_"
 * assinatura    = HMAC-SHA256 em base64, comparada contra cada item "v1,<sig>" do header.
 */
export async function verifyReplicateSignature(
  headers: Headers,
  rawBody: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const id = headers.get('webhook-id');
  const timestamp = headers.get('webhook-timestamp');
  const signatureHeader = headers.get('webhook-signature');
  if (!id || !timestamp || !signatureHeader) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > WEBHOOK_TOLERANCE_S) return false;

  const secretBody = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = base64ToBytes(secretBody);
  } catch (_err) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`),
  );
  const expected = bytesToBase64(new Uint8Array(mac));

  // O header pode trazer várias assinaturas (rotação de secret) — uma bater basta.
  for (const entry of signatureHeader.split(' ')) {
    const [version, provided] = entry.split(',');
    if (version !== 'v1' || !provided) continue;
    if (constantTimeEquals(expected, provided)) return true;
  }
  return false;
}

// ── Duração do áudio ─────────────────────────────────────────────────────────

/**
 * Duração do mp3 do TTS. O modelo devolve SÓ a URL — sem campo de duração — e a edge
 * function não tem ffprobe. Como somos nós que pedimos mp3 CBR com bitrate conhecido,
 * a conta fecha por construção (erro de fração de segundo, irrelevante para escolher
 * a duração do clipe). Ver docs/11 §3.3.
 */
export function estimateMp3DurationSeconds(bytes: number, bitrate: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0 || !Number.isFinite(bitrate) || bitrate <= 0) return 0;
  return (bytes * 8) / bitrate;
}
