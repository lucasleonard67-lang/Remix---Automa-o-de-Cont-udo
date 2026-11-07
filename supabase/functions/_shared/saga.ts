// _shared/saga.ts — runner da máquina de estados da geração (F2, saga).
// Fontes: docs/06-arquitetura-ia.md §3-§4 e §9 (telemetria); docs/07-contratos-backend.md
// §4 (regras do runner); docs/04-modelo-de-dados.md §6.9-§6.10 e §8.7.
//
// runSaga(jobId, {from}) processa o job do estado de entrada até awaiting_review /
// awaiting_angle / failed, atualizando generation_jobs.status a CADA transição
// (checkpoint ANTES de executar a etapa — é o que o Realtime da UI de /criar
// acompanha e o que permite ao watchdog retomar do ponto certo) e acumulando a
// telemetria por etapa em timings (shape canônico StageTiming + totals, 06 §9).
//
// Retomada/idempotência:
// - timings.last_stage guarda a última etapa checkpointada; jobs failed retomam
//   a partir dela (resume-job), jobs travados retomam do status atual.
// - Artefatos intermediários (core_content, audit) vivem só na memória do runner;
//   retomar de linting/grounding/judging/rewriting/adapting re-executa desde
//   generating (função pura: mesmo envelope ⇒ nova peça válida). retrieving
//   regrava context_ids; adapting deleta as pieces do job antes de inserir —
//   nenhuma re-execução duplica peças.
// - Antes de cada checkpoint o runner confere o status no banco: job cancelado
//   pelo usuário aborta silenciosamente a saga.
//
// Loop de reescrita: reprovação em qualquer classe (linter → grounding → juiz,
// ordem fail-fast por custo) → rewriting (attempt += 1) → generating com o
// diagnóstico estruturado consolidado (RewriteDiagnosis). attempt > max_rewrites
// (app_settings.engine_defaults, default 2) → job failed com o diagnóstico
// resumido em error.

import { pedirFotos, unidadesSemFoto } from './fotos-automaticas.ts';
import { acordarRotina, pedeSoCarrossel, ROTINA_TOKEN, ROTINA_URL, temaDoPedido } from './claude-rotina.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { createServiceClient } from './supabase.ts';
import { chat, embed, LlmError } from './llm.ts';
import { cleanText, chunkText } from './chunking.ts';
import {
  loadWebSearchSettings,
  webSearchChain,
} from './web-search.ts';
import { DEFAULT_MATCH_COUNT, hybridSearch } from './retrieval.ts';
import { renderCoreContentText } from './funnel.ts';
import { lintText } from './linter.ts';
import { verifyGrounding, type GroundingSource } from './grounding.ts';
import { judgePiece } from './judge.ts';
import type { FeedbackExample } from './prompts/judge.ts';
import { CLASSIFICATION_SCHEMA, inferableChannels, routerPrompt } from './prompts/router.ts';
import { CORE_CONTENT_SCHEMA, generatorPrompt, type ContextBlock } from './prompts/generator.ts';
import { getAdapter } from './adapters/base.ts';
import { editorialPiece } from './editorial-carousel.ts';
import { normalizeArt } from './carousel-art.ts';
import {
  CHANNEL_TYPES,
  ENGINE_VERSION,
  type AngleOption,
  type Audit,
  type ChannelConfig,
  type ChannelType,
  type Classification,
  type ContextKind,
  type CoreContent,
  type GuardrailsContent,
  type JobStatus,
  type PersonaContent,
  type RewriteDiagnosis,
  type StageTiming,
  type StrategyContent,
  type Timings,
  type WebResearch,
} from './types.ts';

// ── Tipos ────────────────────────────────────────────────────────────────────

/** Etapas executáveis pelo runner (chaves de Timings). */
type StageKey =
  | 'classifying' | 'retrieving' | 'researching' | 'generating' | 'linting'
  | 'grounding' | 'judging' | 'rewriting' | 'adapting';

const STAGE_KEYS: readonly StageKey[] = [
  'classifying', 'retrieving', 'researching', 'generating', 'linting',
  'grounding', 'judging', 'rewriting', 'adapting',
] as const;

/** Timings persistido + checkpoint de retomada (last_stage). */
type SagaTimings = Timings & { last_stage?: StageKey };

export interface RunSagaOptions {
  /** Estado a partir do qual processar; default: derivado do status atual do job. */
  from?: JobStatus;
  /** Canais pedidos na chamada de generate-content (só usados no classifying). */
  requested_channel_types?: ChannelType[];
  /**
   * Diretiva livre do usuário para a regeneração de uma peça (regenerate-piece).
   * Vai para o prompt do Gerador em TODAS as tentativas desta execução, junto do
   * briefing original — é o que diferencia a peça nova da que está sendo trocada.
   */
  instruction?: string;
}

/** app_settings.engine_defaults (04-modelo-de-dados.md §8.9/§12.3). */
export interface EngineDefaults {
  max_rewrites: number;
  angle_options: number;
  watchdog_stale_minutes: number;
  /** Limite da retrieval da saga (opcional na setting; default DEFAULT_MATCH_COUNT). */
  retrieval_limit: number;
}

interface JobRow {
  id: string;
  prompt: string;
  status: JobStatus;
  classification: Classification | null;
  selected_angle: AngleOption | null;
  context_ids: string[];
  attempt: number;
  error: string | null;
  timings: SagaTimings | null;
  web_research: WebResearch | null;
  created_by: string | null;
}

interface ChannelRow {
  type: ChannelType;
  enabled: boolean;
  config: ChannelConfig | null;
}

interface ActiveVersion<T> {
  version: number;
  content: T;
}

interface SagaCtx {
  supabase: SupabaseClient;
  job: JobRow;
  timings: SagaTimings;
  defaults: EngineDefaults;
  channels: ChannelRow[];
  persona: ActiveVersion<PersonaContent>;
  strategy: ActiveVersion<StrategyContent>;
  guardrails: ActiveVersion<GuardrailsContent>;
  brandKitVersion: number | null;
  requested?: ChannelType[];
  /** Diretiva de regeneração (regenerate-piece); undefined numa geração normal. */
  instruction?: string;
  /** Campos a persistir junto com o PRÓXIMO checkpoint (classification, context_ids…). */
  pendingExtras: Record<string, unknown>;
  // Flywheel P1 (carregado no preâmbulo):
  editorialRecent: EditorialRecentUse[];
  feedbackExamples: FeedbackExample[];
  styleRefs: string[];
  // Artefatos em memória da tentativa corrente:
  blocks: ContextBlock[];
  core: CoreContent | null;
  linter: Audit['linter'] | null;
  grounding: Audit['grounding'] | null;
  judge: Audit['judge'] | null;
  diagnosis: RewriteDiagnosis | null;
  roundFailures: RewriteDiagnosis['failures'];
}

/** Erro de saga com mensagem amigável (vai direto para generation_jobs.error). */
class SagaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SagaError';
  }
}

/** Job cancelado pelo usuário no meio do processamento — aborta sem marcar failed. */
class SagaAborted extends Error {
  constructor() {
    super('Job cancelado pelo usuário.');
    this.name = 'SagaAborted';
  }
}

const CONTEXT_KINDS: readonly ContextKind[] = [
  'transcript', 'post', 'document', 'reference', 'case', 'offer',
] as const;

// ── Retomada: status persistido → etapa de entrada ───────────────────────────

const ENTRY_BY_STATUS: Partial<Record<JobStatus, StageKey>> = {
  created: 'classifying',
  classifying: 'classifying',
  awaiting_angle: 'retrieving',   // pressupõe selected_angle já gravado (resume-job)
  retrieving: 'retrieving',
  // Idempotente: se o digest já foi materializado, a etapa reusa e segue.
  researching: 'researching',
  // Artefatos de generating em diante só existem em memória → re-gera.
  generating: 'generating',
  linting: 'generating',
  grounding: 'generating',
  judging: 'generating',
  rewriting: 'generating',
  adapting: 'generating',
};

/**
 * Estado em que a saga (re)entra para um job com este status/timings —
 * null para estados sem retomada (awaiting_review, done, cancelled).
 * Compartilhado com resume-job (resposta rápida {job_id, status}).
 */
export function deriveResumeStage(
  status: JobStatus,
  timings?: { last_stage?: string } | null,
): JobStatus | null {
  if (status === 'failed') {
    const last = (timings?.last_stage ?? 'classifying') as JobStatus;
    return ENTRY_BY_STATUS[last] ?? 'classifying';
  }
  return ENTRY_BY_STATUS[status] ?? null;
}

// ── Telemetria (06-arquitetura-ia.md §9; shape em types.ts StageTiming) ──────

interface StageTimer {
  started_at: string;
  t0: number;
}

function startStage(): StageTimer {
  return { started_at: new Date().toISOString(), t0: Date.now() };
}

function recordStage(
  timings: SagaTimings,
  stage: StageKey,
  timer: StageTimer,
  extra: { provider?: string; model?: string; input_tokens?: number; output_tokens?: number } = {},
): void {
  const prev = timings[stage];
  const entry: StageTiming = {
    started_at: prev?.started_at ?? timer.started_at,
    ended_at: new Date().toISOString(),
    ms: (prev?.ms ?? 0) + (Date.now() - timer.t0),
    attempts: (prev?.attempts ?? 0) + 1,
  };
  const provider = extra.provider ?? prev?.provider;
  if (provider !== undefined) entry.provider = provider;
  const model = extra.model ?? prev?.model;
  if (model !== undefined) entry.model = model;
  if (extra.input_tokens !== undefined || prev?.input_tokens !== undefined) {
    entry.input_tokens = (prev?.input_tokens ?? 0) + (extra.input_tokens ?? 0);
    entry.output_tokens = (prev?.output_tokens ?? 0) + (extra.output_tokens ?? 0);
  }
  timings[stage] = entry;
  computeTotals(timings);
}

function computeTotals(timings: SagaTimings): void {
  let inputTokens = 0;
  let outputTokens = 0;
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  for (const key of STAGE_KEYS) {
    const t = timings[key];
    if (!t) continue;
    inputTokens += t.input_tokens ?? 0;
    outputTokens += t.output_tokens ?? 0;
    const s = Date.parse(t.started_at);
    const e = Date.parse(t.ended_at);
    if (Number.isFinite(s)) earliest = Math.min(earliest, s);
    if (Number.isFinite(e)) latest = Math.max(latest, e);
  }
  timings.totals = {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    // Gateway não expõe preço por token — registra tokens e deixa custo em 0 (06 §9).
    cost_usd_est: 0,
    attempts: timings.generating?.attempts ?? 0,
    wall_ms: earliest < latest ? latest - earliest : 0,
  };
}

// ── Loaders (service role) ───────────────────────────────────────────────────

async function loadJob(supabase: SupabaseClient, jobId: string): Promise<JobRow | null> {
  const { data, error } = await supabase
    .from('generation_jobs')
    .select(
      'id, prompt, status, classification, selected_angle, context_ids, attempt, error, timings, web_research, created_by',
    )
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw new Error(`Falha ao carregar generation_jobs: ${error.message}`);
  return (data as JobRow | null) ?? null;
}

async function loadActive<T>(
  supabase: SupabaseClient,
  table: 'brand_persona' | 'brand_strategy' | 'guardrails' | 'brand_kit',
): Promise<ActiveVersion<T> | null> {
  const { data, error } = await supabase
    .from(table)
    .select('version, content')
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw new Error(`Falha ao carregar ${table}: ${error.message}`);
  if (!data) return null;
  const row = data as { version: number; content: unknown };
  return { version: row.version, content: row.content as T };
}

function requireActive<T>(value: ActiveVersion<T> | null, label: string): ActiveVersion<T> {
  if (!value) {
    throw new SagaError(
      `Nenhuma versão ativa de ${label}. Complete o onboarding (ou ative uma versão em /marca) antes de gerar conteúdo.`,
    );
  }
  return value;
}

async function loadChannels(supabase: SupabaseClient): Promise<ChannelRow[]> {
  const { data, error } = await supabase.from('channels').select('type, enabled, config');
  if (error) throw new Error(`Falha ao carregar channels: ${error.message}`);
  return (data as ChannelRow[] | null) ?? [];
}

/** Lê app_settings.engine_defaults com defaults do seed (04 §12.3). */
export async function loadEngineDefaults(supabase: SupabaseClient): Promise<EngineDefaults> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'engine_defaults')
    .maybeSingle();
  const value =
    !error && data && typeof (data as { value?: unknown }).value === 'object'
      ? ((data as { value: Record<string, unknown> }).value ?? {})
      : {};
  const num = (key: string, fallback: number): number => {
    const v = value[key];
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
  };
  return {
    max_rewrites: num('max_rewrites', 2),
    angle_options: num('angle_options', 4),
    watchdog_stale_minutes: num('watchdog_stale_minutes', 10),
    retrieval_limit: num('retrieval_limit', DEFAULT_MATCH_COUNT),
  };
}

/**
 * Quando a leitura automática da marca (brand-autopilot) começou. Tudo que a
 * marca anterior aprovou ou comentou é exemplo da VOZ ANTIGA: style refs e
 * calibração do juiz só olham o que nasceu depois desta data. Sem leitura
 * (null), nada é filtrado.
 */
async function loadBrandReadStartedAt(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'brand_autopilot')
    .maybeSingle();
  if (error || !data) return null;
  const startedAt = ((data as { value?: { started_at?: unknown } }).value ?? {}).started_at;
  return typeof startedAt === 'string' && Number.isFinite(Date.parse(startedAt)) ? startedAt : null;
}

// ── Flywheel P1: anti-repetição, calibração do juiz e few-shot aprovado ──────

/** F3.8 — uma entrada do editorial_state.state.recent (prova/tema usados). */
export interface EditorialRecentUse {
  proof_claim?: string;
  proof_item_id?: string | null;
  theme?: string;
  thesis?: string;
  used_at?: string;
}

const EDITORIAL_RECENT_MAX = 12;

/**
 * Amostra do gate de tom (timings.sample) ou regeneração guiada
 * (timings.regenerated_from): esses jobs NEM injetam anti-repetição no prompt
 * (a regeneração herda briefing/ângulo fixos — mandar "evite este ângulo"
 * contradiria o próprio job) NEM registram uso no editorial_state.
 */
function isSampleOrRegeneration(ctx: SagaCtx): boolean {
  const timings = ctx.timings as Record<string, unknown>;
  return timings.sample === true || Boolean(timings.regenerated_from);
}

/** F3.8 — lê o singleton editorial_state (provas/temas usados recentemente). */
async function loadEditorialRecent(supabase: SupabaseClient): Promise<EditorialRecentUse[]> {
  const { data, error } = await supabase
    .from('editorial_state')
    .select('state')
    .eq('id', 1)
    .maybeSingle();
  if (error || !data) return [];
  const recent = ((data as { state?: { recent?: unknown } }).state ?? {}).recent;
  return Array.isArray(recent) ? (recent as EditorialRecentUse[]).slice(0, EDITORIAL_RECENT_MAX) : [];
}

/**
 * F4.3 — feedback humano recente COM NOTA (calibração do juiz). Rejeições pesam
 * mais (ensinam o que reprova); um par de aprovações ancora o "bom desta marca".
 */
async function loadFeedbackExamples(
  supabase: SupabaseClient,
  since: string | null = null,
): Promise<FeedbackExample[]> {
  const pull = async (verdict: 'approved' | 'rejected', limit: number) => {
    let query = supabase
      .from('piece_feedback')
      .select('verdict, notes, piece:content_pieces(core_content)')
      .eq('verdict', verdict)
      .not('notes', 'is', null);
    // Feedback da marca antiga calibraria o juiz para a voz antiga.
    if (since) query = query.gte('created_at', since);
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [] as FeedbackExample[];
    type PieceEmbed = { core_content: Partial<CoreContent> | null };
    const rows = data as unknown as Array<{
      verdict: 'approved' | 'rejected';
      notes: string | null;
      // O embed many-to-one volta objeto em runtime, mas o client sem generics
      // tipa como array — normalizamos os dois shapes.
      piece: PieceEmbed | PieceEmbed[] | null;
    }>;
    return rows.map((row) => {
      const piece = Array.isArray(row.piece) ? row.piece[0] : row.piece;
      const core = piece?.core_content;
      const excerpt = (core?.hook?.written || core?.idea || '(peça sem excerto)').slice(0, 140);
      return {
        excerpt,
        verdict: row.verdict,
        ...(row.notes ? { note: row.notes.slice(0, 200) } : {}),
      } satisfies FeedbackExample;
    });
  };
  const [rejected, approved] = await Promise.all([pull('rejected', 4), pull('approved', 2)]);
  return [...rejected, ...approved];
}

/**
 * F4.1 — trechos de peças APROVADAS recentes como referência de ESTILO do
 * gerador. Entram numa seção própria do prompt — NUNCA via context_ids: peça
 * gerada não pode virar "prova" auditável de peça nova (circularidade no
 * grounding).
 */
/**
 * Remove números/valores dos excertos de estilo. O grounding só BLOQUEIA número
 * divergente na proof declarada — número solto copiado de um style ref viraria
 * apenas [VERIFICAR] não-bloqueante. Sem número no excerto, não há o que copiar:
 * o ref calibra tom e ritmo, nunca dado.
 */
function stripNumbers(text: string): string {
  return text
    .replace(/R\$\s?[\d.,]+\s?(mil|milhões?|k|M|bi)?/gi, '[valor]')
    .replace(/\d[\d.,]*\s?(%|x|mil|milhões?|k\b|dias?|meses|anos)/gi, '[número]')
    .replace(/\d[\d.,]*/g, '[número]');
}

async function loadApprovedStyleRefs(
  supabase: SupabaseClient,
  since: string | null = null,
): Promise<string[]> {
  let query = supabase
    .from('content_pieces')
    .select('core_content')
    .eq('status', 'approved');
  // Peça aprovada antes da leitura da marca é referência da voz antiga.
  if (since) query = query.gte('created_at', since);
  const { data, error } = await query
    .order('updated_at', { ascending: false })
    .limit(2);
  if (error || !data) return [];
  const refs: string[] = [];
  for (const row of data as Array<{ core_content: Partial<CoreContent> | null }>) {
    const core = row.core_content;
    if (!core) continue;
    const blocks = [...(core.funnel_blocks ?? [])].sort((a, b) => a.layer - b.layer);
    const body = blocks
      .filter((b) => b.layer >= 4 && b.layer <= 5)
      .map((b) => b.content)
      .join(' ');
    const excerpt = stripNumbers(
      [core.hook?.written, body].filter(Boolean).join(' — '),
    ).slice(0, 420);
    if (excerpt.trim()) refs.push(excerpt.trim());
  }
  return refs;
}

/** Reconstrói blocos de contexto a partir de context_ids (retomada pós-falha). */
async function loadContextBlocks(
  supabase: SupabaseClient,
  contextIds: string[],
): Promise<ContextBlock[]> {
  if (contextIds.length === 0) return [];
  const { data, error } = await supabase
    .from('context_items')
    .select('id, title, kind, metadata, body')
    .in('id', contextIds);
  if (error) throw new Error(`Falha ao carregar context_items: ${error.message}`);
  const rows = (data ?? []) as Array<{
    id: string;
    title: string;
    kind: ContextKind;
    metadata: Record<string, unknown> | null;
    body: string | null;
  }>;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const blocks: ContextBlock[] = [];
  for (const id of contextIds) {
    const item = byId.get(id);
    if (!item) continue;
    blocks.push({
      item_id: item.id,
      title: item.title,
      kind: item.kind,
      content: item.body ? item.body.slice(0, 1200) : item.title,
      metadata: item.metadata ?? {},
    });
  }
  return blocks;
}

// ── Normalização defensiva dos jsonb ─────────────────────────────────────────

function normalizeGuardrails(raw: unknown): GuardrailsContent {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Partial<GuardrailsContent>;
  return {
    banned_punctuation: c.banned_punctuation ?? [],
    banned_words: c.banned_words ?? [],
    banned_metaphors: c.banned_metaphors ?? [],
    banned_ctas: c.banned_ctas ?? [],
    allowed_ctas: c.allowed_ctas ?? [],
    channel_scope_overrides: c.channel_scope_overrides ?? {},
    qa_rubric: c.qa_rubric ?? {},
    approval_threshold: c.approval_threshold ?? { default: 8 },
    dosage_rules: c.dosage_rules ?? { signature_lexicon_max_per_piece: 2 },
  };
}

function coerceClassification(raw: unknown, enabled: ChannelType[]): Classification {
  if (!raw || typeof raw !== 'object') {
    throw new SagaError('O Roteador retornou uma classificação inválida. Tente novamente.');
  }
  const r = raw as Record<string, unknown>;

  // só o que o Roteador podia escolher: o enum do schema aceita qualquer canal
  const channelTypes = (Array.isArray(r.channel_types) ? r.channel_types : []).filter(
    (c): c is ChannelType =>
      CHANNEL_TYPES.includes(c as ChannelType) && enabled.includes(c as ChannelType),
  );

  const angles: AngleOption[] = [];
  for (const [i, a] of (Array.isArray(r.angles) ? r.angles : []).entries()) {
    if (!a || typeof a !== 'object') continue;
    const o = a as Record<string, unknown>;
    if (typeof o.title !== 'string' || typeof o.hook !== 'string') continue;
    angles.push({
      id: typeof o.id === 'string' && o.id.length > 0 ? o.id : `a${i + 1}`,
      title: o.title,
      hook: o.hook,
      ...(typeof o.rationale === 'string' ? { rationale: o.rationale } : {}),
    });
  }
  if (angles.length === 0) {
    throw new SagaError('O Roteador não propôs nenhum ângulo válido. Tente novamente.');
  }

  let contextFilters: Classification['context_filters'];
  if (r.context_filters && typeof r.context_filters === 'object') {
    const f = r.context_filters as Record<string, unknown>;
    const kinds = (Array.isArray(f.kinds) ? f.kinds : []).filter((k): k is ContextKind =>
      CONTEXT_KINDS.includes(k as ContextKind),
    );
    const tags = (Array.isArray(f.tags) ? f.tags : []).filter(
      (t): t is string => typeof t === 'string',
    );
    if (kinds.length > 0 || tags.length > 0) {
      contextFilters = {
        ...(kinds.length > 0 ? { kinds } : {}),
        ...(tags.length > 0 ? { tags } : {}),
      };
    }
  }

  return {
    format: typeof r.format === 'string' && r.format.length > 0 ? r.format : null,
    channel_types: channelTypes.length > 0 ? channelTypes : enabled,
    thesis: typeof r.thesis === 'string' && r.thesis.length > 0 ? r.thesis : null,
    angles,
    context_query: typeof r.context_query === 'string' ? r.context_query : '',
    ...(contextFilters ? { context_filters: contextFilters } : {}),
    needs_angle_choice: r.needs_angle_choice === true,
  };
}

function coerceCoreContent(raw: unknown): CoreContent {
  if (!raw || typeof raw !== 'object') {
    throw new SagaError('O Gerador retornou um core_content inválido. Tente novamente.');
  }
  const r = raw as Record<string, unknown>;
  const hook = (r.hook && typeof r.hook === 'object' ? r.hook : {}) as Record<string, unknown>;

  const funnelBlocks: CoreContent['funnel_blocks'] = [];
  for (const b of Array.isArray(r.funnel_blocks) ? r.funnel_blocks : []) {
    if (!b || typeof b !== 'object') continue;
    const o = b as Record<string, unknown>;
    funnelBlocks.push({
      layer: typeof o.layer === 'number' && Number.isFinite(o.layer) ? o.layer : 0,
      name: typeof o.name === 'string' ? o.name : '',
      content: typeof o.content === 'string' ? o.content : '',
    });
  }
  if (funnelBlocks.length === 0) {
    throw new SagaError('O Gerador não retornou os blocos do funil. Tente novamente.');
  }

  const proof = (r.proof && typeof r.proof === 'object' ? r.proof : {}) as Record<string, unknown>;

  return {
    idea: typeof r.idea === 'string' ? r.idea : '',
    hook: {
      visual: typeof hook.visual === 'string' ? hook.visual : '',
      written: typeof hook.written === 'string' ? hook.written : '',
      ...(typeof hook.spoken === 'string' ? { spoken: hook.spoken } : {}),
    },
    funnel_blocks: funnelBlocks,
    proof: {
      claim: typeof proof.claim === 'string' ? proof.claim : '',
      context_item_id: typeof proof.context_item_id === 'string' ? proof.context_item_id : null,
      ...(typeof proof.source_url === 'string' ? { source_url: proof.source_url } : {}),
    },
    verify_flags: (Array.isArray(r.verify_flags) ? r.verify_flags : []).filter(
      (f): f is string => typeof f === 'string',
    ),
    cta: typeof r.cta === 'string' ? r.cta : '',
    image_brief: typeof r.image_brief === 'string' ? r.image_brief : null,
  };
}

// ── Helpers de canal ─────────────────────────────────────────────────────────

function enabledChannels(ctx: SagaCtx): ChannelType[] {
  return ctx.channels.filter((c) => c.enabled).map((c) => c.type);
}

/** classification.channel_types ∩ enabled; fallback: todos os enabled. */
function targetChannels(ctx: SagaCtx): ChannelType[] {
  const enabled = enabledChannels(ctx);
  if (enabled.length === 0) {
    throw new SagaError('Nenhum canal habilitado na instância. Ative canais em /marca/canais.');
  }
  const wanted = ctx.job.classification?.channel_types ?? [];
  const intersection = wanted.filter((t) => enabled.includes(t));
  return intersection.length > 0 ? intersection : enabled;
}

function channelConfig(ctx: SagaCtx, type: ChannelType): ChannelConfig {
  return ctx.channels.find((c) => c.type === type)?.config ?? {};
}

/** Nota de corte: channels.config.cutoff_score > approval_threshold > default do adapter. */
function resolveCutoff(ctx: SagaCtx, type: ChannelType): number {
  const config = channelConfig(ctx, type);
  if (typeof config.cutoff_score === 'number') return config.cutoff_score;
  const threshold = ctx.guardrails.content.approval_threshold;
  const perChannel = threshold?.per_channel?.[type];
  if (typeof perChannel === 'number') return perChannel;
  if (typeof threshold?.default === 'number') return threshold.default;
  return getAdapter(type).cutoff_score;
}

// ── Grounding: persistir [VERIFICAR] no core renderizado ─────────────────────

/**
 * Aplica as substituições [VERIFICAR: …] do grounding DENTRO do core_content
 * (funnel_blocks + cta) e registra as pendências em verify_flags — assim o
 * texto flagado persiste nas pieces e nos derivados dos adapters.
 */
function applyVerifyFlags(core: CoreContent, flagged: Audit['grounding']['flagged']): void {
  for (const f of flagged) {
    if (!f.replaced_with || !f.claim) continue;
    for (const block of core.funnel_blocks) {
      if (block.content.includes(f.replaced_with)) continue;
      block.content = block.content.split(f.claim).join(f.replaced_with);
    }
    if (!core.cta.includes(f.replaced_with)) {
      core.cta = core.cta.split(f.claim).join(f.replaced_with);
    }
    if (!core.verify_flags.includes(f.replaced_with)) {
      core.verify_flags.push(f.replaced_with);
    }
  }
}

// ── Diagnóstico resumido (error do job após esgotar reescritas) ──────────────

function summarizeFailures(failures: RewriteDiagnosis['failures']): string {
  const parts: string[] = [];
  for (const f of failures) {
    switch (f.class) {
      case 'linter':
        parts.push(
          `linter: ${f.violations.slice(0, 3).map((v) => `${v.rule} ("${v.match}")`).join('; ')}`,
        );
        break;
      case 'grounding':
        parts.push(`grounding: ${f.flagged.slice(0, 3).map((g) => `${g.reason} ("${g.claim}")`).join('; ')}`);
        break;
      case 'judge':
        parts.push(`juiz: ${f.diagnosis.slice(0, 2).join('; ')}`);
        break;
    }
  }
  const summary = parts.join(' | ') || 'auditoria reprovou a peça';
  return summary.length > 400 ? `${summary.slice(0, 397)}...` : summary;
}

// ── Checkpoint (status + timings a cada transição) ───────────────────────────

async function checkpoint(
  ctx: SagaCtx,
  status: JobStatus,
  stage?: StageKey,
  extra: Record<string, unknown> = {},
): Promise<void> {
  // Confere o status atual antes de avançar: cancelamento humano aborta a saga.
  const { data } = await ctx.supabase
    .from('generation_jobs')
    .select('status')
    .eq('id', ctx.job.id)
    .maybeSingle();
  if ((data as { status?: string } | null)?.status === 'cancelled') {
    throw new SagaAborted();
  }

  if (stage) ctx.timings.last_stage = stage;
  const patch: Record<string, unknown> = {
    status,
    timings: ctx.timings,
    ...ctx.pendingExtras,
    ...extra,
  };
  ctx.pendingExtras = {};
  const { error } = await ctx.supabase
    .from('generation_jobs')
    .update(patch)
    .eq('id', ctx.job.id);
  if (error) throw new Error(`Falha ao atualizar generation_jobs: ${error.message}`);
  ctx.job.status = status;
}

async function failJob(
  supabase: SupabaseClient,
  jobId: string,
  timings: SagaTimings,
  err: unknown,
): Promise<void> {
  let message: string;
  if (err instanceof LlmError) {
    // 402 já chega amigável do llm.ts ("Créditos de IA do workspace esgotados…").
    message = err.message;
  } else if (err instanceof SagaError) {
    message = err.message;
  } else {
    const detail = err instanceof Error ? err.message : String(err);
    message = `Erro inesperado na geração: ${detail}`.slice(0, 500);
  }
  const { error } = await supabase
    .from('generation_jobs')
    .update({ status: 'failed', error: message, timings })
    .eq('id', jobId);
  if (error) console.error(`[saga] falha ao marcar job ${jobId} como failed:`, error.message);
}

// ── Runner ───────────────────────────────────────────────────────────────────

/**
 * Processa o job do estado de entrada até um estado de parada
 * (awaiting_angle / awaiting_review / failed / cancelled). Retorna o status final.
 * Nunca lança por falha de etapa — falhas viram status failed + error no job.
 */
export async function runSaga(jobId: string, opts: RunSagaOptions = {}): Promise<JobStatus> {
  const supabase = createServiceClient();
  const job = await loadJob(supabase, jobId);
  if (!job) throw new Error(`Job ${jobId} não encontrado.`);

  const timings: SagaTimings = job.timings ?? {};
  const entry = deriveResumeStage(opts.from ?? job.status, opts.from ? undefined : timings);
  if (!entry) return job.status; // awaiting_review / done / cancelled — nada a fazer

  try {
    // Config da instância carregada uma vez por execução. Persona, estratégia e
    // guardrails ativos são pré-requisito de QUALQUER geração (falha clara aqui).
    // A data da leitura da marca vem antes: style refs e feedback só contam a
    // partir dela (a marca anterior não ensina a voz nova).
    const brandReadStartedAt = await loadBrandReadStartedAt(supabase);
    const [persona, strategy, guardrails, brandKit, channels, defaults, editorialRecent, feedbackExamples, styleRefs] =
      await Promise.all([
        loadActive<PersonaContent>(supabase, 'brand_persona'),
        loadActive<StrategyContent>(supabase, 'brand_strategy'),
        loadActive<GuardrailsContent>(supabase, 'guardrails'),
        loadActive<Record<string, unknown>>(supabase, 'brand_kit'),
        loadChannels(supabase),
        loadEngineDefaults(supabase),
        loadEditorialRecent(supabase),
        loadFeedbackExamples(supabase, brandReadStartedAt),
        loadApprovedStyleRefs(supabase, brandReadStartedAt),
      ]);

    const activeGuardrails = requireActive(guardrails, 'guardrails');
    const ctx: SagaCtx = {
      supabase,
      job,
      timings,
      defaults,
      channels,
      persona: requireActive(persona, 'persona (contrato de voz)'),
      strategy: requireActive(strategy, 'estratégia da marca'),
      guardrails: {
        version: activeGuardrails.version,
        content: normalizeGuardrails(activeGuardrails.content),
      },
      brandKitVersion: brandKit?.version ?? null,   // brand_kit pode não existir → null
      requested: opts.requested_channel_types,
      ...(opts.instruction ? { instruction: opts.instruction } : {}),
      pendingExtras: {},
      editorialRecent,
      feedbackExamples,
      styleRefs,
      blocks: [],
      core: null,
      linter: null,
      grounding: null,
      judge: null,
      diagnosis: null,
      roundFailures: [],
    };

    // Retomada de job failed: limpa o error antigo no primeiro checkpoint.
    if (job.status === 'failed') ctx.pendingExtras.error = null;

    let stage: StageKey = entry as StageKey;

    while (true) {
      switch (stage) {
        case 'classifying': {
          const next = await runClassifying(ctx);
          if (next === 'awaiting_angle') return 'awaiting_angle';
          stage = next;
          break;
        }
        case 'retrieving':
          if (!opts.instruction && (await entregarAoClaude(ctx))) return 'generating';
          stage = await runRetrieving(ctx);
          break;
        case 'researching':
          stage = await runResearching(ctx);
          break;
        case 'generating':
          stage = await runGenerating(ctx);
          break;
        case 'linting':
          stage = await runLinting(ctx);
          break;
        case 'grounding':
          stage = await runGrounding(ctx);
          break;
        case 'judging':
          stage = await runJudging(ctx);
          break;
        case 'rewriting':
          stage = await runRewriting(ctx);
          break;
        case 'adapting': {
          await runAdapting(ctx);
          return 'awaiting_review';
        }
      }
    }
  } catch (err) {
    if (err instanceof SagaAborted) return 'cancelled';
    console.error(`[saga] job ${jobId} falhou:`, err);
    await failJob(supabase, jobId, timings, err);
    return 'failed';
  }
}

// ── Etapas ───────────────────────────────────────────────────────────────────

/**
 * Escrever pela assinatura: acorda a rotina e para aqui. A peça volta por carrossel_criar,
 * e o job segue em generating até lá. Se o Claude não entregar, o watchdog retoma em
 * retrieving e, com o pedido já marcado, a saga escreve como sempre.
 */
async function entregarAoClaude(ctx: SagaCtx): Promise<boolean> {
  const timings = ctx.timings as SagaTimings & { pedido_claude?: unknown };
  if (timings.pedido_claude || !pedeSoCarrossel(targetChannels(ctx))) return false;
  const segredo = async (nome: string) => {
    const { data } = await ctx.supabase.rpc('get_vault_secret', { _name: nome });
    return typeof data === 'string' ? data : '';
  };
  const [url, token] = await Promise.all([segredo(ROTINA_URL), segredo(ROTINA_TOKEN)]);
  if (!url || !token) return false;

  timings.pedido_claude = {
    formato: 'instagram_carousel',
    tema: temaDoPedido(ctx.job.prompt, ctx.job.selected_angle ?? null),
  };
  await checkpoint(ctx, 'generating', 'retrieving');
  if (await acordarRotina({ url, token, texto: `Pedido ${ctx.job.id}` })) return true;
  await checkpoint(ctx, 'retrieving', 'retrieving');
  return false;
}

async function runClassifying(ctx: SagaCtx): Promise<'awaiting_angle' | 'retrieving'> {
  await checkpoint(ctx, 'classifying', 'classifying');
  const timer = startStage();

  const enabled = enabledChannels(ctx);
  if (enabled.length === 0) {
    throw new SagaError('Nenhum canal habilitado na instância. Ative canais em /marca/canais.');
  }
  const inferable = inferableChannels(enabled, ctx.requested);
  if (inferable.length === 0) {
    throw new SagaError('Só o Reel está ligado, e ele é criado em Vídeos. Ative outro canal em /marca/canais.');
  }

  const { system, user } = routerPrompt({
    prompt: ctx.job.prompt,
    requested_channel_types: ctx.requested,
    enabled_channel_types: inferable,
    strategy: ctx.strategy.content,
    persona: ctx.persona.content,
    angle_options: ctx.defaults.angle_options,
  });
  const result = await chat({
    role_hint: 'router',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    schema: CLASSIFICATION_SCHEMA,
  });

  const classification = coerceClassification(result.parsed, inferable);
  if (!classification.context_query.trim()) classification.context_query = ctx.job.prompt;
  ctx.job.classification = classification;
  recordStage(ctx.timings, 'classifying', timer, {
    provider: result.provider,
    model: result.model,
    input_tokens: result.usage.input_tokens,
    output_tokens: result.usage.output_tokens,
  });

  if (classification.needs_angle_choice) {
    // Escolha humana: grava as opções e PARA — resume-job continua com o ângulo.
    await checkpoint(ctx, 'awaiting_angle', undefined, { classification });
    return 'awaiting_angle';
  }

  const selected = classification.angles[0];
  ctx.job.selected_angle = selected;
  ctx.pendingExtras.classification = classification;
  ctx.pendingExtras.selected_angle = selected;
  return 'retrieving';
}

async function runRetrieving(ctx: SagaCtx): Promise<'researching' | 'generating'> {
  await checkpoint(ctx, 'retrieving', 'retrieving');
  const timer = startStage();

  const classification = ctx.job.classification;
  if (!classification) {
    throw new SagaError('Job sem classificação — reinicie a geração pelo comando.');
  }
  if (!ctx.job.selected_angle) {
    throw new SagaError('Job sem ângulo selecionado — escolha um ângulo para continuar.');
  }

  const query = classification.context_query.trim() || ctx.job.prompt;
  // Digests de pesquisa web de OUTROS jobs ficam fora do contexto: são material
  // do job que os pediu (o runResearching anexa o do próprio job), não acervo
  // curado — sem a exclusão, dado web desatualizado viraria prova de peças novas.
  const RETRIEVAL_OPTS = { excludeTags: ['pesquisa-web'] };

  // O filtro de KIND é PREFERÊNCIA, não exclusão.
  //
  // O Roteador deduz `kinds` da INTENÇÃO do comando ("conte o caso…" →
  // kinds:['case']), mas quem classifica o material é o usuário no /contexto.
  // Medido no acervo real: o "Case Fábrica Nardelli" está cadastrado como
  // 'transcript'. Com filtro duro, um briefing que pedia justamente esse case
  // recuperava só os outros dois — e como o grounding exige prova dentro de
  // context_ids, o Gerador era OBRIGADO a provar com o case errado. O juiz
  // reprovava por "não cumpre o briefing" e o job queimava 2 reescritas.
  //
  // A versão anterior só relaxava o filtro quando o resultado vinha VAZIO; o
  // caso ruim é o parcial: sobra material suficiente para parecer certo e o
  // item pedido nunca aparece. Agora a busca roda sem o filtro de kind e o
  // kind pedido apenas ORDENA — todos os itens da lista já passaram pelo corte
  // de relevância, então preferir o kind da intenção não sacrifica precisão.
  const preferKinds = classification.context_filters?.kinds ?? [];
  const tagFilters = classification.context_filters?.tags?.length
    ? { tags: classification.context_filters.tags }
    : undefined;

  let results = await hybridSearch(
    query,
    tagFilters,
    ctx.defaults.retrieval_limit,
    RETRIEVAL_OPTS,
  );

  if (preferKinds.length > 0) {
    // DESEMPATE, não precedência: um empurrão de 15% só inverte itens que já
    // estavam perto. Ordenar todo kind pedido acima recriaria o bug de forma
    // suave — no caso medido, o item certo (rank léxico 6.0) ficaria ABAIXO de
    // dois 'case' de 1.4 e 1.0 só por causa da etiqueta.
    const KIND_BOOST = 1.15;
    const peso = (r: { kind: string; score: number }) =>
      r.score * (preferKinds.includes(r.kind as ContextKind) ? KIND_BOOST : 1);
    results = [...results].sort((a, b) => peso(b) - peso(a));
  }

  ctx.blocks = results.map((r) => ({
    item_id: r.item_id,
    title: r.title,
    kind: r.kind as ContextKind,
    content: r.content,
    metadata: r.metadata,
  }));
  ctx.job.context_ids = [...new Set(results.map((r) => r.item_id))];
  ctx.pendingExtras.context_ids = ctx.job.context_ids;

  recordStage(ctx.timings, 'retrieving', timer);
  return ctx.job.web_research?.requested ? 'researching' : 'generating';
}

/**
 * Etapa `researching` — pesquisa web reativa (SÓ quando o usuário pediu no job).
 * Busca no driver configurado (web-search.ts), materializa o digest como
 * context_item (kind 'reference', tag 'pesquisa-web') com chunks/embeddings e o
 * appenda em context_ids — o conteúdo web vira "contexto selecionado" e os números
 * passam a ser prova auditável pelo grounding (regra de altitude preservada).
 *
 * NUNCA derruba o job: indisponibilidade (sem key) ou erro do provedor viram
 * web_research.skipped e a geração segue sem pesquisa.
 */
async function runResearching(ctx: SagaCtx): Promise<'generating'> {
  await checkpoint(ctx, 'researching', 'researching');
  const timer = startStage();

  // Retomada direta nesta etapa: ctx.blocks está vazio, mas o retrieving já
  // persistiu context_ids. Recarrega ANTES de anexar o bloco da pesquisa —
  // senão o generating veria blocks.length > 0 e pularia o reload, e o
  // gerador perderia todo o acervo interno (ficaria só com a pesquisa).
  if (ctx.blocks.length === 0 && ctx.job.context_ids.length > 0) {
    ctx.blocks = await loadContextBlocks(ctx.supabase, ctx.job.context_ids);
  }

  const record: WebResearch = { ...(ctx.job.web_research ?? { requested: true }) };

  // Retomada idempotente: procura o digest deste JOB pelo metadata, não pelo
  // web_research.item_id — o registro no job só persiste depois da busca, então
  // um crash entre o insert do item e essa persistência deixaria o item "órfão"
  // e a retomada pagaria OUTRA busca e duplicaria o material no acervo.
  const { data: existingData } = await ctx.supabase
    .from('context_items')
    .select('id, title, metadata, body, status')
    .eq('metadata->web_research->>job_id', ctx.job.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const existing = existingData as
    | { id: string; title: string; metadata: Record<string, unknown> | null; body: string | null; status: string }
    | null;
  if (existing?.body) {
    // Crash pós-insert deixou 'processing'? O corpo já basta (FTS/grounding) — promove.
    if (existing.status !== 'ready') {
      await ctx.supabase.from('context_items').update({ status: 'ready' }).eq('id', existing.id);
    }
    const meta = (existing.metadata?.web_research ?? {}) as Partial<WebResearch> & {
      provider?: WebResearch['provider'];
    };
    record.item_id = existing.id;
    if (meta.provider) record.provider = meta.provider;
    if (typeof meta.query === 'string') record.query = meta.query;
    if (Array.isArray(meta.sources)) record.sources = meta.sources;
    if (typeof meta.searched_at === 'string') record.searched_at = meta.searched_at;
    delete record.skipped;
    delete record.error;
    appendResearchBlock(ctx, existing.id, existing.title, existing.body, existing.metadata ?? {});
    await persistResearchRecord(ctx, record);
    recordStage(ctx.timings, 'researching', timer);
    console.info(`[saga] job ${ctx.job.id}: pesquisa web reusada (item ${existing.id}).`);
    return 'generating';
  }

  try {
    const settings = await loadWebSearchSettings();
    const query = ctx.job.classification?.context_query?.trim() || ctx.job.prompt.slice(0, 300);
    const chain = await webSearchChain(query, settings);

    if (chain.status === 'unavailable') {
      record.skipped = 'unavailable';
      record.error =
        'Pesquisa web indisponível: nenhum provedor configurado (cadastre a key Tavily ou uma key BYO em /config).';
      console.info(`[saga] job ${ctx.job.id}: pesquisa web pulada (sem provedor).`);
    } else if (chain.status === 'failed') {
      // TODOS os provedores com key falharam — mensagem diferente de "não tem key",
      // senão o dono procura configuração quando o problema é cota/credencial.
      record.skipped = 'error';
      record.attempts = chain.attempts;
      record.error =
        `Todos os provedores de pesquisa falharam: ` +
        chain.attempts.map((a) => `${a.provider} (${a.error.slice(0, 90)})`).join('; ');
      console.error(`[saga] job ${ctx.job.id}: pesquisa web falhou em todos:`, record.error);
    } else {
      const { outcome, attempts } = chain;
      const itemId = await materializeResearchItem(ctx, outcome);
      record.provider = outcome.provider;
      record.query = outcome.query;
      record.item_id = itemId;
      record.sources = outcome.sources;
      record.searched_at = new Date().toISOString();
      // quem falhou ANTES de dar certo fica registrado: o failover não pode ser mudo
      if (attempts.length > 0) record.attempts = attempts;
      else delete record.attempts;
      delete record.skipped;
      delete record.error;

      appendResearchBlock(ctx, itemId, researchTitle(outcome.query), outcome.digest, {
        web_research: { job_id: ctx.job.id, provider: outcome.provider },
      });
      console.info(
        `[saga] job ${ctx.job.id}: pesquisa web (${outcome.provider}) → ` +
          `${outcome.sources.length} fonte(s), item ${itemId}` +
          (attempts.length ? ` · após ${attempts.map((a) => a.provider).join(', ')} falharem` : '') +
          '.',
      );
    }
  } catch (err) {
    // Degradação graciosa — a peça sai sem pesquisa, com o motivo registrado.
    record.skipped = 'error';
    record.error = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    console.error(`[saga] job ${ctx.job.id}: pesquisa web falhou:`, record.error);
  }

  ctx.job.web_research = record;
  // Persistência IMEDIATA (não espera o próximo checkpoint): fecha a janela em
  // que um crash faria a retomada re-pagar a busca sem saber do item criado.
  await persistResearchRecord(ctx, record);
  recordStage(ctx.timings, 'researching', timer);
  return 'generating';
}

/** Grava web_research + context_ids no job AGORA (e mantém o pendingExtras coerente). */
async function persistResearchRecord(ctx: SagaCtx, record: WebResearch): Promise<void> {
  ctx.job.web_research = record;
  ctx.pendingExtras.web_research = record;
  const { error } = await ctx.supabase
    .from('generation_jobs')
    .update({ web_research: record, context_ids: ctx.job.context_ids })
    .eq('id', ctx.job.id);
  if (error) {
    // Não-fatal: o próximo checkpoint reflui via pendingExtras; o lookup por
    // metadata.job_id cobre a retomada mesmo sem o registro no job.
    console.error(`[saga] job ${ctx.job.id}: falha ao persistir web_research:`, error.message);
  }
}

function researchTitle(query: string): string {
  return `Pesquisa web — ${query}`.slice(0, 180);
}

/** Anexa o digest aos blocos do gerador e ao conjunto auditável (context_ids). */
function appendResearchBlock(
  ctx: SagaCtx,
  itemId: string,
  title: string,
  body: string,
  metadata: Record<string, unknown>,
): void {
  if (!ctx.blocks.some((b) => b.item_id === itemId)) {
    ctx.blocks.push({ item_id: itemId, title, kind: 'reference', content: body, metadata });
  }
  if (!ctx.job.context_ids.includes(itemId)) {
    ctx.job.context_ids = [...ctx.job.context_ids, itemId];
  }
  ctx.pendingExtras.context_ids = ctx.job.context_ids;
}

/**
 * Materializa o digest como context_item pronto (mesmo pipeline do ingest-context:
 * limpeza → chunking → embeddings → chunks). Embeddings com falha NÃO bloqueiam:
 * o item fica ready mesmo assim (a perna FTS da busca híbrida cobre; o corpo já
 * serve ao grounding e à retomada via loadContextBlocks).
 */
async function materializeResearchItem(
  ctx: SagaCtx,
  outcome: { provider: string; query: string; digest: string; sources: unknown[] },
): Promise<string> {
  const { data, error } = await ctx.supabase
    .from('context_items')
    .insert({
      kind: 'reference',
      title: researchTitle(outcome.query),
      body: outcome.digest,
      tags: ['pesquisa-web'],
      metadata: {
        web_research: {
          job_id: ctx.job.id,
          provider: outcome.provider,
          query: outcome.query,
          sources: outcome.sources,
          searched_at: new Date().toISOString(),
        },
      },
      status: 'processing',
      created_by: ctx.job.created_by,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Falha ao materializar a pesquisa web: ${error.message}`);
  const itemId = (data as { id: string }).id;

  try {
    const chunks = chunkText(cleanText(outcome.digest), 'reference');
    if (chunks.length > 0) {
      const embeddings = await embed(chunks);
      const rows = chunks.map((content, i) => ({
        item_id: itemId,
        chunk_index: i,
        content,
        embedding: embeddings[i] ?? null,
      }));
      const { error: chunksError } = await ctx.supabase.from('context_chunks').insert(rows);
      if (chunksError) {
        console.error(
          `[saga] job ${ctx.job.id}: falha ao gravar chunks da pesquisa:`,
          chunksError.message,
        );
      }
    }
  } catch (err) {
    console.error(`[saga] job ${ctx.job.id}: embeddings da pesquisa falharam:`, err);
  }

  const { error: readyError } = await ctx.supabase
    .from('context_items')
    .update({ status: 'ready' })
    .eq('id', itemId);
  if (readyError) {
    throw new Error(`Falha ao marcar a pesquisa como pronta: ${readyError.message}`);
  }
  return itemId;
}

async function runGenerating(ctx: SagaCtx): Promise<'linting'> {
  await checkpoint(ctx, 'generating', 'generating');
  const timer = startStage();

  const classification = ctx.job.classification;
  const angle = ctx.job.selected_angle;
  if (!classification || !angle) {
    throw new SagaError('Job sem briefing completo (classificação/ângulo) — reinicie a geração.');
  }

  // Retomada pós-falha: reconstrói os blocos de contexto a partir de context_ids.
  if (ctx.blocks.length === 0 && ctx.job.context_ids.length > 0) {
    ctx.blocks = await loadContextBlocks(ctx.supabase, ctx.job.context_ids);
  }

  // Nova rodada: zera artefatos de auditoria da tentativa anterior.
  ctx.roundFailures = [];
  ctx.linter = null;
  ctx.grounding = null;
  ctx.judge = null;

  // F3.8: provas/temas usados recentemente (o gerador evita repetir). NUNCA em
  // amostra/regeneração: a regeneração é obrigada a manter ângulo/prova do
  // briefing herdado — a seção mandaria fugir do próprio job.
  const antiRepeat = !isSampleOrRegeneration(ctx);
  const recentUsage = {
    proof_claims: ctx.editorialRecent
      .map((r) => r.proof_claim)
      .filter((c): c is string => Boolean(c?.trim()))
      .slice(0, 8),
    themes: ctx.editorialRecent
      .flatMap((r) => [r.theme, r.thesis])
      .filter((t): t is string => Boolean(t?.trim()))
      .slice(0, 8),
  };

  const { system, user } = generatorPrompt({
    persona: ctx.persona.content,
    guardrails: ctx.guardrails.content,
    classification,
    selected_angle: angle,
    context_blocks: ctx.blocks,
    ...(antiRepeat && (recentUsage.proof_claims.length || recentUsage.themes.length)
      ? { recent_usage: recentUsage }
      : {}),
    ...(ctx.styleRefs.length ? { style_refs: ctx.styleRefs } : {}),
    ...(ctx.diagnosis ? { diagnosis: ctx.diagnosis } : {}),
    ...(ctx.instruction ? { instruction: ctx.instruction } : {}),
  });
  const result = await chat({
    role_hint: 'generator',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    schema: CORE_CONTENT_SCHEMA,
  });

  ctx.core = coerceCoreContent(result.parsed);
  recordStage(ctx.timings, 'generating', timer, {
    provider: result.provider,
    model: result.model,
    input_tokens: result.usage.input_tokens,
    output_tokens: result.usage.output_tokens,
  });
  return 'linting';
}

async function runLinting(ctx: SagaCtx): Promise<'grounding' | 'rewriting'> {
  await checkpoint(ctx, 'linting', 'linting');
  const timer = startStage();

  const core = ctx.core;
  if (!core) throw new SagaError('Estado interno inconsistente: linting sem core_content.');

  const firstChannel = targetChannels(ctx)[0];

  // O core_content é o funil INTEIRO (8 camadas, ~1.500-2.500 chars) — ainda não
  // passou por adapter nenhum. Os limites de caracteres do canal são POR UNIDADE
  // ADAPTADA (um slide, um post, um frame) e só fazem sentido depois da adaptação;
  // aplicá-los aqui reprovaria toda peça de canal curto (x_post/instagram_post 280,
  // carrossel 280/slide, threads 500) de forma determinística — o job queimava as 2
  // reescritas e falhava sempre. Quem garante os limites é o `structure()` de cada
  // adapter, que corta e realoca o texto por construção (07-contratos-backend.md §6;
  // regra de altitude em 06-arquitetura-ia.md §4.1). Nesta etapa checamos só o que é
  // de voz e guardrails: pontuação, palavras/metáforas/CTAs banidos, emoji, hashtag,
  // antítese e dosagem do léxico.
  const {
    text_max_chars: _textMax,
    slide_max_chars: _slideMax,
    caption_max_chars: _captionMax,
    ...coreLintConfig
  } = channelConfig(ctx, firstChannel);

  const result = lintText({
    text: renderCoreContentText(core),
    guardrails: ctx.guardrails.content,
    channel_type: firstChannel,
    config: coreLintConfig,
    cta: core.cta,
    signature_lexicon: ctx.persona.content.signature_lexicon,
  });
  ctx.linter = result;
  recordStage(ctx.timings, 'linting', timer);

  if (!result.passed) {
    // Fail-fast: reprova determinística não gasta grounding nem juiz.
    ctx.roundFailures.push({ class: 'linter', violations: result.violations });
    return 'rewriting';
  }
  return 'grounding';
}

async function runGrounding(ctx: SagaCtx): Promise<'judging' | 'rewriting'> {
  await checkpoint(ctx, 'grounding', 'grounding');
  const timer = startStage();

  const core = ctx.core;
  if (!core) throw new SagaError('Estado interno inconsistente: grounding sem core_content.');

  const sources: GroundingSource[] = ctx.blocks.map((b) => ({
    item_id: b.item_id,
    kind: b.kind,
    title: b.title,
    content: b.content,
    ...(b.metadata ? { metadata: b.metadata } : {}),
  }));
  const report = verifyGrounding({ core, context_ids: ctx.job.context_ids, sources });
  ctx.grounding = { passed: report.passed, checked: report.checked, flagged: report.flagged };
  recordStage(ctx.timings, 'grounding', timer);

  if (!report.passed) {
    // Falha ESTRUTURAL (número divergente, >1 case, policy violada) → reescrita.
    ctx.roundFailures.push({ class: 'grounding', flagged: report.flagged });
    return 'rewriting';
  }

  // Flags [VERIFICAR] não bloqueiam — persistem no core renderizado (e nos derivados).
  applyVerifyFlags(core, report.flagged);
  return 'judging';
}

async function runJudging(ctx: SagaCtx): Promise<'adapting' | 'rewriting'> {
  await checkpoint(ctx, 'judging', 'judging');
  const timer = startStage();

  const core = ctx.core;
  const classification = ctx.job.classification;
  const angle = ctx.job.selected_angle;
  if (!core || !classification || !angle) {
    throw new SagaError('Estado interno inconsistente: judging sem peça/briefing.');
  }

  const firstChannel = targetChannels(ctx)[0];
  const caseBlock = core.proof.context_item_id
    ? ctx.blocks.find((b) => b.item_id === core.proof.context_item_id)
    : undefined;

  const result = await judgePiece({
    persona: ctx.persona.content,
    guardrails: ctx.guardrails.content,
    piece_text: renderCoreContentText(core),
    thesis: classification.thesis,
    selected_angle: angle,
    ...(caseBlock ? { case_block: caseBlock } : {}),
    cutoff_score: resolveCutoff(ctx, firstChannel),
    // F4.3: vereditos humanos recentes calibram o gosto do juiz nesta instância.
    ...(ctx.feedbackExamples.length ? { feedback_examples: ctx.feedbackExamples } : {}),
  });
  ctx.judge = result.judge;
  recordStage(ctx.timings, 'judging', timer, {
    provider: result.provider,
    model: result.model,
    input_tokens: result.usage.input_tokens,
    output_tokens: result.usage.output_tokens,
  });

  if (result.judge.verdict === 'rewrite') {
    ctx.roundFailures.push({ class: 'judge', diagnosis: result.judge.diagnosis });
    return 'rewriting';
  }
  return 'adapting';
}

async function runRewriting(ctx: SagaCtx): Promise<'generating'> {
  const attempt = ctx.job.attempt + 1;
  ctx.job.attempt = attempt;
  await checkpoint(ctx, 'rewriting', 'rewriting', { attempt });
  const timer = startStage();

  const failures = ctx.roundFailures;
  recordStage(ctx.timings, 'rewriting', timer);

  const maxRewrites = ctx.defaults.max_rewrites;
  if (attempt > maxRewrites) {
    throw new SagaError(
      `reprovada após ${maxRewrites} reescritas: ${summarizeFailures(failures)}`,
    );
  }

  // Diagnóstico estruturado consolidado (06 §4.4) — próxima tentativa é função
  // pura de novo: mesmo envelope de altitude + este diagnóstico.
  ctx.diagnosis = { attempt, failures };
  return 'generating';
}

/** O design system ativo da marca usa o layout editorial no carrossel? */
async function brandUsesEditorial(ctx: SagaCtx): Promise<boolean> {
  const { data } = await ctx.supabase
    .from('brand_kit')
    .select('content')
    .eq('status', 'active')
    .maybeSingle();
  const content = (data as { content?: { art?: unknown } | null } | null)?.content;
  return normalizeArt(content?.art).layout === 'editorial';
}

/** A amostra do teste de tom não gasta imagem. Falha aqui não derruba a peça. */
async function fotosDasPecas(ctx: SagaCtx): Promise<void> {
  if ((ctx.timings as { sample?: unknown }).sample) return;
  const { data } = await ctx.supabase.from('content_pieces')
    .select('id, channel_type, adapted_content').eq('job_id', ctx.job.id);
  const pecas = (data ?? []) as { id: string; channel_type: string; adapted_content: Record<string, unknown> }[];
  const comArte = pecas.filter((p) => unidadesSemFoto(p.channel_type, p.adapted_content).length > 0);
  if (!comArte.length) return;
  const segredo = async (nome: string) => {
    const { data: valor } = await ctx.supabase.rpc('get_vault_secret', { _name: nome });
    return typeof valor === 'string' ? valor : '';
  };
  const [url, token] = await Promise.all([segredo(ROTINA_URL), segredo(ROTINA_TOKEN)]);
  if (url && token && (await acordarRotina({ url, token, texto: `Artes do job ${ctx.job.id}` }))) return;
  await Promise.all(pecas.map(async (peca) => {
    const pedido = await pedirFotos(ctx.supabase as never, peca.id, unidadesSemFoto(peca.channel_type, peca.adapted_content))
      .catch((err) => ({ ok: false, mensagem: String(err) }));
    if (!pedido.ok) console.warn(`[saga] fotos da peça ${peca.id}:`, pedido.mensagem);
  }));
}

async function runAdapting(ctx: SagaCtx): Promise<void> {
  await checkpoint(ctx, 'adapting', 'adapting');
  const timer = startStage();

  const core = ctx.core;
  if (!core || !ctx.linter || !ctx.grounding || !ctx.judge) {
    throw new SagaError('Estado interno inconsistente: adapting sem peça auditada.');
  }

  const targets = targetChannels(ctx);
  const audit: Audit = { linter: ctx.linter, grounding: ctx.grounding, judge: ctx.judge };

  // Idempotência: re-execução do adapting nunca duplica peças.
  const { error: deleteError } = await ctx.supabase
    .from('content_pieces')
    .delete()
    .eq('job_id', ctx.job.id);
  if (deleteError) {
    throw new Error(`Falha ao limpar content_pieces do job: ${deleteError.message}`);
  }

  // Layout editorial (padrão da casa): carrossel, stories e post ganham manchete,
  // parágrafos e apoio visual — uma chamada por formato presente nos canais.
  // Falhou, reprovou no linter ou sobrou [VERIFICAR] → adapter de sempre.
  const editorialParams = {
    core,
    blocks: ctx.blocks,
    guardrails: ctx.guardrails.content,
    signatureLexicon: ctx.persona.content.signature_lexicon,
  };
  const wantsEditorial =
    (targets.includes('instagram_carousel') ||
      targets.includes('instagram_stories') ||
      targets.includes('instagram_post')) &&
    (await brandUsesEditorial(ctx));
  const [editorialSlides, editorialFrames, editorialCard] = wantsEditorial
    ? await Promise.all([
        targets.includes('instagram_carousel') ? editorialPiece({ ...editorialParams, format: 'carousel' }) : null,
        targets.includes('instagram_stories') ? editorialPiece({ ...editorialParams, format: 'stories' }) : null,
        targets.includes('instagram_post') ? editorialPiece({ ...editorialParams, format: 'post' }) : null,
      ])
    : [null, null, null];

  const adaptedFor = (type: ChannelType) => {
    const adapted = getAdapter(type).structure(core, channelConfig(ctx, type));
    if (adapted.channel_type === 'instagram_carousel' && editorialSlides) {
      return { ...adapted, slides: editorialSlides };
    }
    if (adapted.channel_type === 'instagram_stories' && editorialFrames) {
      return { ...adapted, frames: editorialFrames };
    }
    if (adapted.channel_type === 'instagram_post' && editorialCard) {
      return { ...adapted, card: editorialCard };
    }
    return adapted;
  };

  const rows = targets.map((type) => ({
    job_id: ctx.job.id,
    channel_type: type,
    core_content: core,
    adapted_content: adaptedFor(type),
    audit,
    status: 'draft',
    persona_version: ctx.persona.version,
    strategy_version: ctx.strategy.version,
    guardrails_version: ctx.guardrails.version,
    brand_kit_version: ctx.brandKitVersion,
    engine_version: ENGINE_VERSION,
    context_ids: ctx.job.context_ids,
  }));

  const { error: insertError } = await ctx.supabase.from('content_pieces').insert(rows);
  if (insertError) {
    throw new Error(`Falha ao inserir content_pieces: ${insertError.message}`);
  }

  // F3.8: registra prova/tema desta peça no editorial_state — os próximos jobs
  // recebem a lista "usados recentemente" e evitam repetir. Append ATÔMICO via
  // RPC (migration 17): o tone-gate roda 3 sagas em paralelo e um upsert de
  // snapshot perderia entradas concorrentes. Amostras do gate de tom e
  // regenerações NÃO contam (a amostra não é publicação; a regeneração
  // substitui uma peça cuja prova já foi registrada). Não-fatal: falhar aqui
  // não pode derrubar um job que já produziu peças válidas.
  if (!isSampleOrRegeneration(ctx)) {
    try {
      const entry: EditorialRecentUse = {
        ...(core.proof.claim?.trim() ? { proof_claim: core.proof.claim.slice(0, 160) } : {}),
        proof_item_id: core.proof.context_item_id,
        ...(ctx.job.selected_angle?.title
          ? { theme: ctx.job.selected_angle.title.slice(0, 120) }
          : {}),
        ...(ctx.job.classification?.thesis
          ? { thesis: ctx.job.classification.thesis.slice(0, 120) }
          : {}),
        used_at: new Date().toISOString(),
      };
      const { error: stateError } = await ctx.supabase.rpc('append_editorial_use', {
        _entry: entry,
        _max: EDITORIAL_RECENT_MAX,
      });
      if (stateError) {
        console.error(`[saga] job ${ctx.job.id}: falha ao gravar editorial_state:`, stateError.message);
      }
    } catch (err) {
      console.error(`[saga] job ${ctx.job.id}: editorial_state não atualizado:`, err);
    }
  }

  recordStage(ctx.timings, 'adapting', timer);
  await checkpoint(ctx, 'awaiting_review');
  await fotosDasPecas(ctx);
}
