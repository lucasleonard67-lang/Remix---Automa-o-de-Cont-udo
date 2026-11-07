// brand-autopilot — onboarding em 2 campos: lê o site e o Instagram e monta a
// primeira versão da marca inteira (voz, bandeira, regras, identidade visual,
// canais), depois roda o teste de tom. Orquestrador RETOMÁVEL e IDEMPOTENTE no
// padrão do Director/automation-tick: estado gravado em
// app_settings.brand_autopilot, UMA etapa por chamada, a tela chama de novo até
// terminar.
//
// Deploy config: verify_jwt = true (só admin; revalida via rpc has_role).
//
// POST { action: 'start', site, instagram?, captions?: string[] } → { state, wait_ms }
// POST { action: 'advance' }                                      → { state, wait_ms }
// POST { action: 'status' }                                       → { state | null, wait_ms }
// POST { action: 'reset' }                                        → { ok: true }
//
// Etapas, em ordem: ler_site → ler_instagram → montar_perfil → ligar_canais →
// teste_de_tom. Ao terminar grava app_settings.onboarding com
// minimum_viable + completed = true (a criação fica destravada). `reset` zera
// brand_autopilot e onboarding e NÃO apaga versões da marca (é o botão de demo).

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';
import { chat, embed, LlmError } from '../_shared/llm.ts';
import { cleanText, chunkText } from '../_shared/chunking.ts';
import { normalizeArt } from '../_shared/carousel-art.ts';
import { VOICE_EXTRACTOR_SCHEMA } from '../_shared/prompts/voice-extractor.ts';
import { zernioFetch } from '../_shared/zernio.ts';
import {
  AUTOPILOT_SETTING_KEY,
  AUTOPILOT_STEP_IDS,
  BRAND_PROFILE_SCHEMA,
  brandProfilePrompt,
  crawlSite,
  emptyState,
  normalizeInstagramHandle,
  normalizeSiteUrl,
  probeSite,
  describeSiteError,
  voiceAdjustPrompt,
  type AutopilotReview,
  type AutopilotState,
  type AutopilotStep,
  type AutopilotStepId,
  type CrawledPage,
  type ReviewSectionId,
  type SiteHints,
} from '../_shared/brand-autopilot.ts';
import {
  CHANNEL_TYPES,
  type ChannelType,
  type GuardrailsContent,
  type PersonaContent,
  type StrategyContent,
} from '../_shared/types.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

type Service = ReturnType<typeof createServiceClient>;

interface Ctx {
  service: Service;
  userId: string;
  /** Authorization do chamador — repassado ao tone-gate (verify_jwt). */
  authHeader: string;
}

const LOCK_MS = 120_000;
const WAIT_NEXT_MS = 400;
const WAIT_BACKGROUND_MS = 6_000;
const MAX_CAPTIONS = 5;
const MAX_CAPTION_CHARS = 2_200;
const EMBED_BATCH_SIZE = 32;
const INSERT_BATCH_SIZE = 100;
/** Teste de tom preso além disso vira "confira" em vez de travar o onboarding. */
const TONE_STUCK_MS = 12 * 60_000;
const TERMINAL_JOB_STATUSES = new Set(['awaiting_review', 'done', 'failed', 'cancelled']);

const CHANNEL_LABELS: Record<ChannelType, string> = {
  instagram_stories: 'Instagram Stories',
  instagram_carousel: 'Instagram Carrossel',
  instagram_post: 'Instagram Post',
  x_post: 'X (Twitter)',
  threads_post: 'Threads',
  linkedin_post: 'LinkedIn',
  facebook_post: 'Facebook',
  instagram_reel: 'Instagram Reel',
};

const DEFAULT_CHANNELS: ChannelType[] = ['instagram_post', 'instagram_carousel'];

/** Separador das legendas dentro do item de Contexto do Instagram. */
const CAPTION_SEPARATOR = '\n\n---\n\n';

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return errorResponse(405, 'invalid_input', 'Use POST.');

  try {
    const user = await getUser(req);
    if (!user) return errorResponse(401, 'unauthorized', 'Sessão inválida ou ausente.');

    const service = createServiceClient();
    const { data: isAdmin, error: roleError } = await service.rpc('has_role', {
      _user_id: user.id,
      _role: 'admin',
    });
    if (roleError) {
      return errorResponse(500, 'internal_error', `Falha ao verificar papel: ${roleError.message}`);
    }
    if (isAdmin !== true) {
      return errorResponse(403, 'forbidden', 'Só administradores configuram a marca.');
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return errorResponse(400, 'invalid_input', 'Body JSON inválido.');
    }

    const ctx: Ctx = {
      service,
      userId: user.id,
      authHeader: req.headers.get('Authorization') ?? '',
    };

    switch (body.action) {
      case 'status': {
        const state = await loadState(service);
        return jsonResponse({ state, wait_ms: waitFor(state) });
      }
      case 'reset':
        return await handleReset(service);
      case 'start':
        return await handleStart(ctx, body);
      case 'advance':
        return await handleAdvance(ctx);
      default:
        return errorResponse(400, 'invalid_input', 'action precisa ser start, advance, status ou reset.');
    }
  } catch (err) {
    if (err instanceof LlmError) return errorResponse(err.status, err.code, err.message);
    console.error('[brand-autopilot] erro inesperado:', err);
    return errorResponse(500, 'internal_error', 'Falha inesperada ao ler a marca.');
  }
});

// ── Estado ───────────────────────────────────────────────────────────────────

async function loadState(service: Service): Promise<AutopilotState | null> {
  const { data, error } = await service
    .from('app_settings')
    .select('value')
    .eq('key', AUTOPILOT_SETTING_KEY)
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler o estado: ${error.message}`);
  const value = (data as { value?: unknown } | null)?.value;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as AutopilotState)
    : null;
}

async function saveState(service: Service, state: AutopilotState): Promise<void> {
  const { error } = await service
    .from('app_settings')
    .upsert({ key: AUTOPILOT_SETTING_KEY, value: state }, { onConflict: 'key' });
  if (error) throw new Error(`Falha ao gravar o estado: ${error.message}`);
}

function stepOf(state: AutopilotState, id: AutopilotStepId): AutopilotStep {
  const found = state.steps.find((s) => s.id === id);
  if (found) return found;
  const created: AutopilotStep = {
    id,
    status: 'pending',
    summary: null,
    error: null,
    started_at: null,
    finished_at: null,
  };
  state.steps.push(created);
  return created;
}

function nextPending(state: AutopilotState): AutopilotStepId | null {
  for (const id of AUTOPILOT_STEP_IDS) {
    const status = stepOf(state, id).status;
    if (status === 'pending' || status === 'running') return id;
  }
  return null;
}

/** Quanto a tela espera antes de chamar de novo. */
function waitFor(state: AutopilotState | null): number {
  if (!state || state.status !== 'running') return 0;
  const current = state.step ? stepOf(state, state.step) : null;
  return current?.status === 'running' ? WAIT_BACKGROUND_MS : WAIT_NEXT_MS;
}

function finishStep(step: AutopilotStep, status: AutopilotStep['status'], summary: string, error?: string) {
  step.status = status;
  step.summary = summary;
  step.error = error ?? null;
  step.finished_at = new Date().toISOString();
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function handleReset(service: Service): Promise<Response> {
  const { error: delError } = await service
    .from('app_settings')
    .delete()
    .eq('key', AUTOPILOT_SETTING_KEY);
  if (delError) return errorResponse(500, 'internal_error', `Falha ao zerar: ${delError.message}`);

  const onboarding = {
    current_step: 1,
    completed_steps: [],
    minimum_viable: false,
    completed: false,
    brand_name: null,
    niche_template_slug: null,
  };
  const { error } = await service
    .from('app_settings')
    .upsert({ key: 'onboarding', value: onboarding }, { onConflict: 'key' });
  if (error) return errorResponse(500, 'internal_error', `Falha ao zerar o onboarding: ${error.message}`);
  return jsonResponse({ ok: true });
}

async function handleStart(ctx: Ctx, body: Record<string, unknown>): Promise<Response> {
  // Site é opcional: sem ele, a marca é lida pelas legendas do Instagram.
  const rawSite = typeof body.site === 'string' ? body.site.trim() : '';
  let site = '';
  if (rawSite) {
    const typed = normalizeSiteUrl(rawSite);
    if (!typed) {
      return errorResponse(400, 'invalid_input', 'Esse endereço de site não parece válido (ex.: minhamarca.com.br).');
    }
    // site fora do ar ou digitado errado aparece já no passo 1, não no fim do fluxo
    const probe = await probeSite(typed);
    if (!probe.ok) return errorResponse(400, 'site_unreachable', probe.message);
    site = probe.url;
  }
  const instagram = normalizeInstagramHandle(typeof body.instagram === 'string' ? body.instagram : null);
  if (typeof body.instagram === 'string' && body.instagram.trim() && !instagram) {
    return errorResponse(400, 'invalid_input', 'O @ do Instagram só aceita letras, números, ponto e sublinhado.');
  }
  const captions = Array.isArray(body.captions)
    ? body.captions
        .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
        .map((c) => c.trim().slice(0, MAX_CAPTION_CHARS))
        .slice(0, MAX_CAPTIONS)
    : [];

  if (!site) {
    if (!instagram && captions.length === 0) {
      return errorResponse(400, 'invalid_input', 'Informe o site ou o @ do Instagram da marca.');
    }
    // sem site, a voz sai das legendas: pelo Zernio (lê o @) ou coladas à mão
    if (captions.length === 0 && !(await getVaultSecret(ctx.service, 'ZERNIO_API_KEY'))) {
      return errorResponse(
        400,
        'needs_captions',
        'Sem site, lemos a marca pelas legendas do Instagram. Cole algumas legendas abaixo ou conecte o Zernio em Redes.',
      );
    }
  }

  const current = await loadState(ctx.service);
  if (current?.status === 'running' && isLocked(current)) {
    return jsonResponse({ state: current, wait_ms: 3_000 });
  }

  // ler de novo substitui a leitura anterior: o material dela sai do Contexto,
  // senão as peças misturariam o site/legendas antigos com os novos
  if (current?.started_at) {
    const { data: old } = await ctx.service
      .from('context_items')
      .select('id')
      .contains('metadata', { autopilot_run: current.started_at });
    const oldIds = ((old ?? []) as Array<{ id: string }>).map((r) => r.id);
    if (oldIds.length > 0) await ctx.service.from('context_items').delete().in('id', oldIds);
  }

  // A memória "provas/temas usados recentemente" é da marca anterior: zerada
  // para a voz nova não evitar assuntos que ela ainda nem contou. As outras
  // chaves de editorial_state.state ficam.
  await clearEditorialRecent(ctx.service);

  const state = emptyState({ site, instagram, captions });
  await saveState(ctx.service, state);
  return await processOnce(ctx, state);
}

/** Zera editorial_state.state.recent (singleton id=1) preservando as outras chaves. Não-fatal. */
async function clearEditorialRecent(service: Service): Promise<void> {
  try {
    const { data, error } = await service
      .from('editorial_state')
      .select('state')
      .eq('id', 1)
      .maybeSingle();
    if (error || !data) return;
    const state = ((data as { state?: Record<string, unknown> | null }).state ?? {});
    if (!Array.isArray(state.recent) || state.recent.length === 0) return;
    const { error: upError } = await service
      .from('editorial_state')
      .update({ state: { ...state, recent: [] } })
      .eq('id', 1);
    if (upError) console.error('[brand-autopilot] editorial_state.recent não zerado:', upError.message);
  } catch (err) {
    console.error('[brand-autopilot] editorial_state.recent não zerado:', err);
  }
}

async function handleAdvance(ctx: Ctx): Promise<Response> {
  const state = await loadState(ctx.service);
  if (!state) {
    return errorResponse(409, 'invalid_state', 'Nenhuma leitura em andamento. Informe o site e clique em “Ler minha marca”.');
  }
  if (state.status === 'done') return jsonResponse({ state, wait_ms: 0 });
  if (state.status === 'failed') {
    // Tentar de novo: a etapa que falhou volta a pendente e segue dali.
    for (const step of state.steps) {
      if (step.status === 'failed') {
        step.status = 'pending';
        step.error = null;
        step.summary = null;
      }
    }
    state.status = 'running';
    state.finished_at = null;
  }
  return await processOnce(ctx, state);
}

function isLocked(state: AutopilotState): boolean {
  return Boolean(state.lock_until && new Date(state.lock_until).getTime() > Date.now());
}

/** Processa a PRÓXIMA etapa pendente (uma só) e devolve o estado gravado. */
async function processOnce(ctx: Ctx, state: AutopilotState): Promise<Response> {
  if (isLocked(state)) return jsonResponse({ state, wait_ms: 3_000 });

  const id = nextPending(state);
  if (!id) {
    await finishRun(ctx, state);
    return jsonResponse({ state, wait_ms: 0 });
  }

  const step = stepOf(state, id);
  state.step = id;
  state.status = 'running';
  state.lock_until = new Date(Date.now() + LOCK_MS).toISOString();
  if (!step.started_at) step.started_at = new Date().toISOString();
  if (step.status === 'pending') step.status = 'running';
  // Estado gravado ANTES de qualquer chamada externa: se a invocação morrer no
  // meio, a próxima chamada vê a etapa em `running` e repete do zero.
  await saveState(ctx.service, state);

  try {
    await runStep(ctx, state, step);
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    console.error(`[brand-autopilot] etapa ${id} falhou:`, message);
    if (id === 'ler_instagram') {
      finishStep(step, 'skipped', 'Instagram não lido', message);
    } else if (id === 'teste_de_tom') {
      finishStep(step, 'needs_review', 'Teste de tom não concluído', message);
    } else {
      finishStep(step, 'failed', 'Não deu para concluir', message);
      state.status = 'failed';
    }
  }

  state.lock_until = null;
  if (state.status === 'running' && !nextPending(state)) {
    await finishRun(ctx, state);
  } else {
    state.step = nextPending(state);
    await saveState(ctx.service, state);
  }
  return jsonResponse({ state, wait_ms: waitFor(state) });
}

async function runStep(ctx: Ctx, state: AutopilotState, step: AutopilotStep): Promise<void> {
  switch (step.id) {
    case 'ler_site':
      return await stepLerSite(ctx, state, step);
    case 'ler_instagram':
      return await stepLerInstagram(ctx, state, step);
    case 'montar_perfil':
      return await stepMontarPerfil(ctx, state, step);
    case 'ligar_canais':
      return await stepLigarCanais(ctx, state, step);
    case 'teste_de_tom':
      return await stepTesteDeTom(ctx, state, step);
  }
}

/** Fecha a execução: onboarding concluído + mínimo viável, criação destravada. */
async function finishRun(ctx: Ctx, state: AutopilotState): Promise<void> {
  state.status = 'done';
  state.step = null;
  state.finished_at = state.finished_at ?? new Date().toISOString();
  state.lock_until = null;

  const { data } = await ctx.service
    .from('app_settings')
    .select('value')
    .eq('key', 'onboarding')
    .maybeSingle();
  const current = ((data as { value?: Record<string, unknown> } | null)?.value ?? {}) as Record<string, unknown>;
  const onboarding = {
    ...current,
    current_step: 9,
    completed_steps: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    minimum_viable: true,
    completed: true,
    brand_name: state.review?.name ?? current.brand_name ?? null,
    niche_template_slug: typeof current.niche_template_slug === 'string' ? current.niche_template_slug : null,
  };
  const { error } = await ctx.service
    .from('app_settings')
    .upsert({ key: 'onboarding', value: onboarding }, { onConflict: 'key' });
  if (error) throw new Error(`Falha ao concluir o onboarding: ${error.message}`);
  await saveState(ctx.service, state);
}

// ── Etapa 1: ler o site ──────────────────────────────────────────────────────

async function stepLerSite(ctx: Ctx, state: AutopilotState, step: AutopilotStep): Promise<void> {
  // Repetição idempotente: apaga os itens de Contexto desta execução antes de recriar.
  await deleteRunItems(ctx.service, state, 'site');
  if (!state.input.site) {
    finishStep(step, 'skipped', 'Sem site: a marca será lida pelo Instagram');
    return;
  }

  let crawl: Awaited<ReturnType<typeof crawlSite>>;
  try {
    crawl = await crawlSite(state.input.site);
  } catch (err) {
    throw new Error(describeSiteError(err, state.input.site));
  }
  const { pages, hints, reader } = crawl;
  if (pages.length === 0 || pages[0].text.trim().length === 0) {
    throw new Error('Não encontrei texto no site. Confira o endereço ou cole legendas em “Prefere começar de outro jeito?”.');
  }

  const ids = await createContextItems(
    ctx,
    state,
    pages.map((page) => ({
      kind: 'document',
      title: page.title || page.url,
      body: page.text,
      source_url: page.url,
      tags: ['autopilot', 'site'],
      source: 'site',
    })),
  );

  state.data.pages = pages.map((p) => ({ url: p.url, title: p.title, chars: p.text.length }));
  state.data.site_hints = hints;
  state.data.context_item_ids = [...(state.data.context_item_ids ?? []), ...ids];

  const n = pages.length;
  const colors = hints.colors.length;
  console.log(`[brand-autopilot] site lido com ${reader}: ${n} páginas, ${colors} cores`);
  finishStep(
    step,
    'done',
    `${n === 1 ? 'Li 1 página' : `Li ${n} páginas`}${colors > 0 ? ` e ${colors} cores do site` : ''}`,
  );
}

// ── Etapa 2: ler o Instagram ─────────────────────────────────────────────────

async function stepLerInstagram(ctx: Ctx, state: AutopilotState, step: AutopilotStep): Promise<void> {
  await deleteRunItems(ctx.service, state, 'instagram');

  let captions: string[] = [];
  let source: 'zernio' | 'manual' | null = null;
  let skipReason: string | null = null;

  const handle = state.input.instagram;
  const zernioKey = await getVaultSecret(ctx.service, 'ZERNIO_API_KEY');
  if (!handle) {
    skipReason = 'Sem @ informado.';
  } else if (!zernioKey) {
    skipReason = 'O Zernio ainda não está conectado (Config → Integrações).';
  } else {
    try {
      captions = await zernioCaptions(zernioKey, handle);
      if (captions.length > 0) source = 'zernio';
      else skipReason = `Nenhuma legenda encontrada para @${handle} nas contas conectadas ao Zernio.`;
    } catch (err) {
      skipReason = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    }
  }

  if (captions.length === 0 && state.input.captions.length > 0) {
    captions = state.input.captions;
    source = 'manual';
  }

  state.data.instagram_source = source;
  state.data.caption_count = captions.length;

  if (captions.length === 0) {
    finishStep(step, 'skipped', 'Instagram não lido', skipReason ?? 'Sem legendas disponíveis.');
    return;
  }

  const ids = await createContextItems(ctx, state, [
    {
      kind: 'post',
      title: handle ? `Legendas do Instagram @${handle}` : 'Legendas do Instagram',
      body: captions.join(CAPTION_SEPARATOR),
      source_url: handle ? `https://www.instagram.com/${handle}/` : null,
      tags: ['autopilot', 'instagram'],
      source: 'instagram',
    },
  ]);
  state.data.context_item_ids = [...(state.data.context_item_ids ?? []), ...ids];

  const n = captions.length;
  finishStep(
    step,
    'done',
    `${n === 1 ? 'Li 1 legenda' : `Li ${n} legendas`}${source === 'manual' ? ' que você colou' : ' pelo Zernio'}`,
  );
}

async function getVaultSecret(service: Service, name: string): Promise<string | null> {
  const { data, error } = await service.rpc('get_vault_secret', { _name: name });
  if (error) return null;
  const value = data as string | null;
  return value && value.length > 0 ? value : null;
}

/** Legendas publicadas da conta Instagram conectada ao Zernio que bate com o @. */
async function zernioCaptions(apiKey: string, handle: string): Promise<string[]> {
  const accountsRes = await zernioFetch(apiKey, '/v1/accounts');
  const rawAccounts = Array.isArray(accountsRes.accounts)
    ? (accountsRes.accounts as Array<Record<string, unknown>>)
    : Array.isArray(accountsRes)
      ? (accountsRes as unknown as Array<Record<string, unknown>>)
      : [];
  const instagram = rawAccounts.filter((a) => String(a.platform ?? '').toLowerCase() === 'instagram');
  if (instagram.length === 0) {
    throw new Error('Nenhuma conta do Instagram conectada ao Zernio (Config → Integrações).');
  }
  const wanted = handle.toLowerCase();
  const account =
    instagram.find((a) => String(a.username ?? a.name ?? '').replace(/^@/, '').toLowerCase() === wanted) ??
    instagram[0];
  const accountId = String(account._id ?? account.id ?? account.accountId ?? '');
  if (!accountId) throw new Error('A conta do Instagram no Zernio veio sem identificador.');

  const postsRes = await zernioFetch(apiKey, '/v1/posts', {
    query: { accountId, limit: '30', status: 'published' },
  });
  const rawPosts = Array.isArray(postsRes.posts)
    ? (postsRes.posts as Array<Record<string, unknown>>)
    : Array.isArray(postsRes.data)
      ? (postsRes.data as Array<Record<string, unknown>>)
      : Array.isArray(postsRes)
        ? (postsRes as unknown as Array<Record<string, unknown>>)
        : [];

  const captions: string[] = [];
  for (const post of rawPosts) {
    const text = [post.content, post.caption, post.text].find(
      (v): v is string => typeof v === 'string' && v.trim().length > 0,
    );
    if (text) captions.push(text.trim().slice(0, MAX_CAPTION_CHARS));
    if (captions.length >= 20) break;
  }
  return captions;
}

// ── Contexto: criação + ingestão (mesmo pipeline do ingest-context) ──────────

interface NewContextItem {
  kind: 'document' | 'post';
  title: string;
  body: string;
  source_url: string | null;
  tags: string[];
  source: 'site' | 'instagram';
}

async function deleteRunItems(service: Service, state: AutopilotState, source: 'site' | 'instagram') {
  if (!state.started_at) return;
  const { data } = await service
    .from('context_items')
    .select('id')
    .contains('metadata', { autopilot_run: state.started_at, autopilot_source: source });
  const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (ids.length === 0) return;
  await service.from('context_items').delete().in('id', ids);
  state.data.context_item_ids = (state.data.context_item_ids ?? []).filter((id) => !ids.includes(id));
}

async function createContextItems(ctx: Ctx, state: AutopilotState, items: NewContextItem[]): Promise<string[]> {
  const rows = items.map((item) => ({
    kind: item.kind,
    title: item.title.slice(0, 200),
    body: item.body,
    source_url: item.source_url,
    tags: item.tags,
    status: 'processing',
    created_by: ctx.userId,
    metadata: { autopilot: true, autopilot_run: state.started_at, autopilot_source: item.source },
  }));
  const { data, error } = await ctx.service.from('context_items').insert(rows).select('id, kind, body');
  if (error) throw new Error(`Falha ao gravar o Contexto: ${error.message}`);
  const created = (data ?? []) as Array<{ id: string; kind: string; body: string }>;

  // Chunks + embeddings em segundo plano (o teste de tom espera por `ready`).
  const task = (async () => {
    for (const row of created) await ingestItem(ctx.service, row.id, row.kind, row.body);
  })().catch((err) => console.error('[brand-autopilot] ingestão falhou:', err));
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime) EdgeRuntime.waitUntil(task);
  else void task;

  return created.map((r) => r.id);
}

/** Espelha ingest-context/processItem: limpeza → chunks → embeddings → delete+insert. */
async function ingestItem(service: Service, itemId: string, kind: string, body: string): Promise<void> {
  try {
    const chunks = chunkText(cleanText(body), kind);
    if (chunks.length === 0) throw new Error('Conteúdo vazio após limpeza.');
    const embeddings: number[][] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
      embeddings.push(...(await embed(chunks.slice(i, i + EMBED_BATCH_SIZE))));
    }
    await service.from('context_chunks').delete().eq('item_id', itemId);
    const rows = chunks.map((content, chunk_index) => ({
      item_id: itemId,
      chunk_index,
      content,
      embedding: embeddings[chunk_index],
    }));
    for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
      const { error } = await service.from('context_chunks').insert(rows.slice(i, i + INSERT_BATCH_SIZE));
      if (error) throw new Error(`Falha ao gravar chunks: ${error.message}`);
    }
    await service.from('context_items').update({ status: 'ready' }).eq('id', itemId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const { data } = await service.from('context_items').select('metadata').eq('id', itemId).maybeSingle();
    const metadata = { ...(((data as { metadata?: Record<string, unknown> } | null)?.metadata) ?? {}), error: message };
    await service.from('context_items').update({ status: 'error', metadata }).eq('id', itemId);
  }
}

// ── Etapa 3: montar o perfil (uma chamada de IA) ─────────────────────────────

interface ProfileOutput {
  brand: { name: string; niche: string; description: string };
  persona: PersonaContent;
  strategy: Omit<StrategyContent, 'content_mix'>;
  guardrails: Pick<
    GuardrailsContent,
    'banned_words' | 'banned_punctuation' | 'banned_metaphors' | 'banned_ctas' | 'allowed_ctas'
  >;
  brand_kit: {
    palette: Array<{ name: string; hex: string }>;
    typography: { heading: string; body: string };
    negative_constraints: string[];
  };
  channels: string[];
  sections: Array<{ id: ReviewSectionId; confidence: number; source: string }>;
}

async function stepMontarPerfil(ctx: Ctx, state: AutopilotState, step: AutopilotStep): Promise<void> {
  const { pages, captions } = await loadRunMaterial(ctx.service, state);
  if (pages.length === 0 && captions.length === 0) {
    throw new Error(
      state.input.site
        ? 'Não encontramos texto para ler no site nem no Instagram. Confira o endereço ou cole algumas legendas.'
        : 'Não encontramos legendas no Instagram para ler. Cole algumas legendas e leia de novo.',
    );
  }
  const hints: SiteHints = state.data.site_hints ?? { colors: [], fonts: [], logo_url: null };

  const prompt = brandProfilePrompt({
    site: state.input.site,
    instagram: state.input.instagram,
    pages,
    captions,
    hints,
  });
  const result = await chat({
    role_hint: 'generator',
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    schema: BRAND_PROFILE_SCHEMA,
  });
  const out = result.parsed as ProfileOutput | undefined;
  if (!out?.brand || !out.persona || !out.strategy || !out.guardrails || !out.brand_kit) {
    throw new Error('A leitura não devolveu um perfil completo. Tente de novo.');
  }

  const brandName =
    clean(out.brand.name) ||
    (state.input.site ? hostName(state.input.site) : (state.input.instagram ?? 'Sua marca'));
  const fallbackSource =
    state.input.site || (state.input.instagram ? `@${state.input.instagram}` : 'Legendas do Instagram');
  const persona = normalizePersona(out.persona, brandName);
  const strategy = normalizeStrategy(out.strategy);
  const guardrails = normalizeGuardrails(out.guardrails);
  const brandKit = normalizeBrandKit(out.brand_kit, hints);
  const channels = normalizeChannels(out.channels);

  const versions = {
    brand_persona: await activateVersion(ctx, 'brand_persona', persona),
    brand_strategy: await activateVersion(ctx, 'brand_strategy', strategy),
    guardrails: await activateVersion(ctx, 'guardrails', guardrails),
    brand_kit: await activateVersion(ctx, 'brand_kit', brandKit),
  };
  state.data.versions = versions;
  state.data.channels = channels;

  const conf = new Map<ReviewSectionId, { confidence: number; source: string }>();
  for (const s of out.sections ?? []) {
    if (!s || typeof s.id !== 'string') continue;
    conf.set(s.id, {
      confidence: clamp01(s.confidence),
      source: clean(s.source).slice(0, 160) || fallbackSource,
    });
  }
  const section = (id: ReviewSectionId, items: string[]) => ({
    id,
    items: items.map(clean).filter(Boolean).slice(0, 6),
    confidence: conf.get(id)?.confidence ?? 0.5,
    source: conf.get(id)?.source ?? fallbackSource,
  });

  const review: AutopilotReview = {
    name: brandName,
    niche: clean(out.brand.niche),
    description: clean(out.brand.description),
    palette: Object.values(brandKit.palette).slice(0, 6),
    logo_url: hints.logo_url,
    channels,
    sections: [
      section('quem_somos', [
        [brandName, persona.identity.role].filter(Boolean).join(' — '),
        persona.identity.positioning,
        out.brand.niche ? `Nicho: ${out.brand.niche}` : '',
      ]),
      section('publico', [persona.identity.audience, strategy.icp.perfil, ...strategy.icp.desejos.slice(0, 3)]),
      section('voz', [
        ...persona.tone_principles.slice(0, 4),
        persona.signature_lexicon.length > 0
          ? `Vocabulário: ${persona.signature_lexicon.slice(0, 5).map((l) => l.term).join(', ')}`
          : '',
      ]),
      section('posicionamento', [
        strategy.brand_promise,
        ...strategy.theses.slice(0, 3),
        strategy.enemy ? `Contra: ${strategy.enemy}` : '',
      ]),
      section('regras', [
        guardrails.banned_words.length > 0 ? `Nunca escrever: ${guardrails.banned_words.slice(0, 8).join(', ')}` : '',
        guardrails.banned_ctas.length > 0 ? `CTAs proibidos: ${guardrails.banned_ctas.slice(0, 4).join(', ')}` : '',
        guardrails.allowed_ctas.length > 0 ? `CTAs permitidos: ${guardrails.allowed_ctas.slice(0, 5).join(', ')}` : '',
      ]),
      section('visual', [
        `Títulos: ${brandKit.typography.heading} · Texto: ${brandKit.typography.body}`,
        ...brandKit.negative_constraints.slice(0, 3),
      ]),
      section('canais', channels.map((c) => CHANNEL_LABELS[c])),
    ],
  };
  state.review = review;

  // Nome da marca no topo do app (mesmo campo que o passo 1 do wizard grava).
  const { data } = await ctx.service.from('app_settings').select('value').eq('key', 'onboarding').maybeSingle();
  const current = ((data as { value?: Record<string, unknown> } | null)?.value ?? {}) as Record<string, unknown>;
  await ctx.service
    .from('app_settings')
    .upsert({ key: 'onboarding', value: { ...current, brand_name: brandName } }, { onConflict: 'key' });

  const tone = persona.tone_principles[0] ? ` · voz: ${persona.tone_principles[0].toLowerCase()}` : '';
  finishStep(step, 'done', `Marca montada: ${brandName}${tone}`.slice(0, 140));
}

async function loadRunMaterial(
  service: Service,
  state: AutopilotState,
): Promise<{ pages: CrawledPage[]; captions: string[] }> {
  const ids = state.data.context_item_ids ?? [];
  if (ids.length === 0) return { pages: [], captions: state.input.captions };
  const { data, error } = await service
    .from('context_items')
    .select('id, title, body, source_url, metadata')
    .in('id', ids)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Falha ao ler o material: ${error.message}`);
  const pages: CrawledPage[] = [];
  let captions: string[] = [];
  for (const row of (data ?? []) as Array<{
    title: string;
    body: string | null;
    source_url: string | null;
    metadata: Record<string, unknown> | null;
  }>) {
    const src = row.metadata?.autopilot_source;
    if (src === 'instagram') {
      captions = (row.body ?? '').split(CAPTION_SEPARATOR).map((c) => c.trim()).filter(Boolean);
    } else {
      pages.push({ url: row.source_url ?? state.input.site, title: row.title, text: row.body ?? '' });
    }
  }
  if (captions.length === 0) captions = state.input.captions;
  return { pages, captions };
}

// ── Normalizadores (o shape que as telas de Marca e o generate-content leem) ─

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanList(value: unknown, max = 30): string[] {
  return Array.isArray(value)
    ? value.map(clean).filter(Boolean).slice(0, max)
    : [];
}

function clamp01(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0.5;
  return Math.min(1, Math.max(0, n));
}

function hostName(site: string): string {
  try {
    return new URL(site).hostname.replace(/^www\./, '');
  } catch {
    return site;
  }
}

function normalizePersona(raw: PersonaContent, brandName: string): PersonaContent {
  const identity = (raw.identity ?? {}) as Partial<PersonaContent['identity']>;
  const worldview = (raw.worldview ?? {}) as Partial<PersonaContent['worldview']>;
  const examples = (raw.reference_examples ?? {}) as Partial<PersonaContent['reference_examples']>;
  const pair = (list: unknown) =>
    Array.isArray(list)
      ? list
          .map((item) => ({ text: clean((item as { text?: unknown })?.text), why: clean((item as { why?: unknown })?.why) }))
          .filter((item) => item.text)
          .slice(0, 6)
      : [];
  const tone = cleanList(raw.tone_principles, 10);
  const checklist = cleanList(raw.voice_checklist, 12);
  return {
    identity: {
      name: clean(identity.name) || brandName,
      role: clean(identity.role),
      positioning: clean(identity.positioning),
      audience: clean(identity.audience),
    },
    credenciais: Array.isArray(raw.credenciais)
      ? raw.credenciais
          .map((c) => ({ claim: clean(c?.claim), source: clean(c?.source) }))
          .filter((c) => c.claim && c.source)
          .slice(0, 10)
      : [],
    worldview: { summary: clean(worldview.summary), theses: cleanList(worldview.theses, 8) },
    // isPersonaReady (tela de Voz) exige nome + 1 princípio + 1 item do checklist.
    tone_principles: tone.length > 0 ? tone : ['Direto e concreto: exemplos antes de conceitos.'],
    signature_lexicon: Array.isArray(raw.signature_lexicon)
      ? raw.signature_lexicon
          .map((l) => ({
            term: clean(l?.term),
            usage: clean(l?.usage),
            max_per_piece: Math.min(2, Math.max(1, Math.trunc(Number(l?.max_per_piece) || 1))),
          }))
          .filter((l) => l.term)
          .slice(0, 10)
      : [],
    calibration_heuristics: cleanList(raw.calibration_heuristics, 10),
    banlist: { ref: 'guardrails' },
    opinioes: Array.isArray(raw.opinioes)
      ? raw.opinioes
          .map((o) => ({ topic: clean(o?.topic), stance: clean(o?.stance) }))
          .filter((o) => o.topic && o.stance)
          .slice(0, 10)
      : [],
    voice_checklist: checklist.length > 0 ? checklist : ['Soa como o dono da marca falando, não como agência?'],
    reference_examples: { good: pair(examples.good), bad: pair(examples.bad) },
  };
}

function normalizeStrategy(raw: ProfileOutput['strategy']): StrategyContent {
  const icp = (raw.icp ?? {}) as Partial<StrategyContent['icp']>;
  return {
    brand_promise: clean(raw.brand_promise),
    theses: cleanList(raw.theses, 8),
    enemy: clean(raw.enemy),
    safe_list: cleanList(raw.safe_list, 12),
    icp: { perfil: clean(icp.perfil), desejos: cleanList(icp.desejos, 8) },
    editorial_stance: clean(raw.editorial_stance),
    content_mix: {},
    cta_repertoire: cleanList(raw.cta_repertoire, 8),
  };
}

function normalizeGuardrails(raw: ProfileOutput['guardrails']): GuardrailsContent {
  const banned = cleanList(raw.banned_ctas, 10);
  const bannedLower = new Set(banned.map((c) => c.toLowerCase()));
  const allowed = cleanList(raw.allowed_ctas, 8).filter((c) => !bannedLower.has(c.toLowerCase()));
  return {
    banned_punctuation: cleanList(raw.banned_punctuation, 6),
    banned_words: cleanList(raw.banned_words, 15),
    banned_metaphors: cleanList(raw.banned_metaphors, 10),
    banned_ctas: banned,
    allowed_ctas: allowed.length > 0 ? allowed : ['Comente aqui', 'Salve para depois', 'Me chama na DM'],
    channel_scope_overrides: {},
    qa_rubric: {},
    approval_threshold: { default: 7 },
    dosage_rules: { signature_lexicon_max_per_piece: 2, emoji_max: 0, hashtag_policy: 'metadata_only' },
  };
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function normalizeBrandKit(raw: ProfileOutput['brand_kit'], hints: SiteHints) {
  const palette: Record<string, string> = {};
  for (const entry of Array.isArray(raw.palette) ? raw.palette : []) {
    const name = clean(entry?.name).toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
    const hex = clean(entry?.hex);
    if (name && HEX.test(hex)) palette[name] = hex.toUpperCase();
  }
  if (Object.keys(palette).length === 0) {
    const declared = hints.colors.filter((c) => HEX.test(c));
    palette.primary = (declared[0] ?? '#0B1B2B').toUpperCase();
    if (declared[1]) palette.accent = declared[1].toUpperCase();
    palette.background = '#FFFFFF';
    palette.text = '#111111';
  }
  const typography = (raw.typography ?? {}) as Partial<{ heading: string; body: string }>;
  return {
    palette,
    typography: {
      heading: clean(typography.heading) || hints.fonts[0] || 'Inter',
      body: clean(typography.body) || hints.fonts[1] || hints.fonts[0] || 'Inter',
    },
    logo_path: null as string | null,
    negative_constraints: cleanList(raw.negative_constraints, 8),
    photo_paths: [] as string[],
    art: normalizeArt({}),
  };
}

function normalizeChannels(raw: unknown): ChannelType[] {
  const set = new Set<ChannelType>();
  for (const item of Array.isArray(raw) ? raw : []) {
    if (typeof item === 'string' && (CHANNEL_TYPES as readonly string[]).includes(item)) {
      set.add(item as ChannelType);
    }
  }
  const list = [...set].slice(0, 4);
  return list.length > 0 ? list : DEFAULT_CHANNELS;
}

/**
 * Grava uma versão NOVA e ativa (archive da ativa anterior, versão = max+1),
 * do mesmo jeito que useSaveDraft + useActivateDraft fazem na tela. Rascunhos
 * antigos são removidos para a tela de Marca abrir na versão recém-ativada.
 */
async function activateVersion(
  ctx: Ctx,
  table: 'brand_persona' | 'brand_strategy' | 'guardrails' | 'brand_kit',
  content: unknown,
): Promise<number> {
  const { data: latest, error: maxError } = await ctx.service
    .from(table)
    .select('version')
    .order('version', { ascending: false })
    .limit(1);
  if (maxError) throw new Error(`Falha ao ler versões de ${table}: ${maxError.message}`);
  const version = (((latest ?? [])[0] as { version?: number } | undefined)?.version ?? 0) + 1;

  await ctx.service.from(table).delete().eq('status', 'draft');
  const { error: archiveError } = await ctx.service
    .from(table)
    .update({ status: 'archived' })
    .eq('status', 'active');
  if (archiveError) throw new Error(`Falha ao arquivar ${table}: ${archiveError.message}`);

  const { error } = await ctx.service
    .from(table)
    .insert({ version, status: 'active', content, created_by: ctx.userId });
  if (error) throw new Error(`Falha ao gravar ${table}: ${error.message}`);
  return version;
}

// ── Etapa 4: ligar canais ────────────────────────────────────────────────────

async function stepLigarCanais(ctx: Ctx, state: AutopilotState, step: AutopilotStep): Promise<void> {
  const wanted = state.data.channels?.length ? state.data.channels : DEFAULT_CHANNELS;
  const { data, error } = await ctx.service.from('channels').select('id, type');
  if (error) throw new Error(`Falha ao carregar canais: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string; type: ChannelType }>;
  for (const row of rows) {
    const { error: upError } = await ctx.service
      .from('channels')
      .update({ enabled: wanted.includes(row.type) })
      .eq('id', row.id);
    if (upError) throw new Error(`Falha ao ligar ${CHANNEL_LABELS[row.type]}: ${upError.message}`);
  }
  const on = rows.filter((r) => wanted.includes(r.type)).map((r) => CHANNEL_LABELS[r.type]);
  finishStep(step, 'done', on.length > 0 ? `Canais ligados: ${on.join(', ')}` : 'Nenhum canal ligado');
}

// ── Etapa 5: teste de tom (reaproveita a tone-gate) ──────────────────────────

async function stepTesteDeTom(ctx: Ctx, state: AutopilotState, step: AutopilotStep): Promise<void> {
  const tone = state.data.tone ?? { attempt: 0, job_ids: [], started_at: null, score: null, cutoff: null };
  state.data.tone = tone;

  // Sem lote em voo: confere o Contexto e dispara as 3 peças de teste.
  if (tone.job_ids.length === 0) {
    const { data: items } = await ctx.service
      .from('context_items')
      .select('status')
      .in('id', state.data.context_item_ids ?? []);
    const statuses = ((items ?? []) as Array<{ status: string }>).map((i) => i.status);
    const ready = statuses.filter((s) => s === 'ready').length;
    const processing = statuses.filter((s) => s === 'processing').length;
    if (ready === 0 && processing > 0) {
      step.summary = 'Preparando o Contexto para o teste';
      return; // continua `running`; a tela chama de novo
    }
    if (ready === 0) {
      finishStep(
        step,
        'needs_review',
        'Teste de tom não rodou',
        'O Contexto não ficou pronto. Confira em Contexto e rode o teste em Marca → Persona.',
      );
      return;
    }
    const jobIds = await invokeToneGate(ctx);
    tone.attempt += 1;
    tone.job_ids = jobIds;
    tone.started_at = new Date().toISOString();
    step.summary = tone.attempt === 1 ? 'Escrevendo 3 peças de teste' : 'Voz ajustada, escrevendo de novo';
    return;
  }

  // Lote em voo: espera as 3 sagas terminarem.
  const { data: jobs } = await ctx.service
    .from('generation_jobs')
    .select('id, status')
    .in('id', tone.job_ids);
  const jobRows = (jobs ?? []) as Array<{ id: string; status: string }>;
  const pending = jobRows.filter((j) => !TERMINAL_JOB_STATUSES.has(j.status));
  const stuck = tone.started_at ? Date.now() - new Date(tone.started_at).getTime() > TONE_STUCK_MS : false;
  if (pending.length > 0 && !stuck) {
    step.summary = `Escrevendo peças de teste (${jobRows.length - pending.length} de ${jobRows.length} prontas)`;
    return;
  }

  const { data: pieces } = await ctx.service
    .from('content_pieces')
    .select('id, job_id, audit')
    .in('job_id', tone.job_ids);
  const pieceRows = (pieces ?? []) as Array<{ id: string; job_id: string; audit: Record<string, unknown> | null }>;
  const cutoff = await loadCutoff(ctx.service);
  tone.cutoff = cutoff;

  const scores: number[] = [];
  const diagnosis: string[] = [];
  for (const piece of pieceRows) {
    const judge = (piece.audit?.judge ?? null) as { score?: unknown; diagnosis?: unknown } | null;
    if (judge && typeof judge.score === 'number' && Number.isFinite(judge.score)) scores.push(judge.score);
    if (Array.isArray(judge?.diagnosis)) {
      for (const d of judge.diagnosis) if (typeof d === 'string') diagnosis.push(d);
    }
  }
  const average = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  tone.score = average === null ? null : Math.round(average * 10) / 10;
  const label = tone.score === null ? 'sem nota' : `${tone.score.toLocaleString('pt-BR')}/10`;

  if (average !== null && average >= cutoff && pieceRows.length > 0) {
    await ctx.service
      .from('content_pieces')
      .update({ status: 'approved' })
      .in('id', pieceRows.map((p) => p.id));
    finishStep(step, 'done', `Teste de tom: ${label} — ${pieceRows.length} peças aprovadas`);
    return;
  }

  if (tone.attempt < 2 && pieceRows.length > 0) {
    // Uma rodada de ajuste de voz, depois tenta de novo.
    await adjustVoice(ctx, diagnosis);
    tone.job_ids = [];
    tone.started_at = null;
    step.summary = `Nota ${label} abaixo de ${cutoff}: ajustando a voz`;
    return;
  }

  finishStep(
    step,
    'needs_review',
    `Teste de tom: ${label}`,
    pieceRows.length === 0
      ? 'As peças de teste não ficaram prontas. Gere uma peça em Criar para conferir a voz.'
      : `Nota abaixo de ${cutoff}. Confira a voz em Marca → Persona e as peças em Biblioteca.`,
  );
}

async function invokeToneGate(ctx: Ctx): Promise<string[]> {
  const base = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!base || !anon) throw new Error('Ambiente sem SUPABASE_URL/ANON_KEY.');
  const res = await fetch(`${base}/functions/v1/tone-gate`, {
    method: 'POST',
    headers: { Authorization: ctx.authHeader, apikey: anon, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(30_000),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    job_ids?: unknown;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(payload.error?.message ?? `O teste de tom respondeu ${res.status}.`);
  }
  const ids = Array.isArray(payload.job_ids) ? payload.job_ids.filter((id): id is string => typeof id === 'string') : [];
  if (ids.length === 0) throw new Error('O teste de tom não iniciou as peças.');
  return ids;
}

async function loadCutoff(service: Service): Promise<number> {
  const { data } = await service.from('guardrails').select('content').eq('status', 'active').maybeSingle();
  const content = (data as { content?: { approval_threshold?: { default?: unknown } } } | null)?.content;
  const value = content?.approval_threshold?.default;
  return typeof value === 'number' && Number.isFinite(value) ? value : 7;
}

/** Ajuste único da voz a partir do diagnóstico do avaliador; vira nova versão ativa. */
async function adjustVoice(ctx: Ctx, diagnosis: string[]): Promise<void> {
  const { data } = await ctx.service.from('brand_persona').select('content').eq('status', 'active').maybeSingle();
  const current = (data as { content?: PersonaContent } | null)?.content;
  if (!current) return;
  const prompt = voiceAdjustPrompt(
    current,
    diagnosis.length > 0 ? diagnosis : ['As peças soaram genéricas e sem opinião própria.'],
  );
  const result = await chat({
    role_hint: 'voice_extractor',
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    schema: VOICE_EXTRACTOR_SCHEMA,
  });
  const draft = result.parsed as PersonaContent | undefined;
  if (!draft?.identity) return;
  const next = normalizePersona(draft, current.identity?.name ?? '');
  // Credenciais não mudam num ajuste de tom — mantém as da versão atual.
  next.credenciais = current.credenciais ?? [];
  await activateVersion(ctx, 'brand_persona', next);
}
