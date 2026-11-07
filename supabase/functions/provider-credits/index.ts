// provider-credits — Central de custos: saldo, plano e gasto de cada conta.
// verify_jwt=true; só admin. Leitura pura: não gasta crédito nem muda nada.
//
// Cada provedor é lido em paralelo e falha sozinho (o painel mostra o motivo
// na linha dele). Fontes oficiais:
//   ElevenLabs  GET /v1/user/subscription  (tier, character_count/limit, reset, vagas de voz)
//   HeyGen      GET /v3/users/me           (billing_type: wallet | subscription | usage_based)
//   Higgsfield  MCP `balance`              ("Credits: N")
//   Replicate   não expõe saldo pela API: o painel mostra o gasto que o app registrou.
// O gasto do mês vem dos registros do próprio app (video_month_spend_usd e
// director_jobs.costs), não das faturas dos provedores.

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';
import { heygenRequest } from '../_shared/heygen.ts';
import { hfBalance, hfConnected } from '../_shared/hf-mcp.ts';
import { EDIT_MODEL } from '../_shared/video-edit-engine.ts';
import {
  buildVideoCosts, newestVideos, pieceTitle, type EditCostRow, type JobRow, type PredictionRow, type ReelRow,
} from '../_shared/video-costs.ts';

type Service = ReturnType<typeof createServiceClient>;
type Json = Record<string, unknown>;

interface ProviderState {
  id: 'elevenlabs' | 'heygen' | 'higgsfield' | 'replicate';
  connected: boolean;
  /** nível da conta, como o provedor chama ("creator", "pro"…) */
  plan: string | null;
  /** saldo restante e a unidade dele; null = o provedor não informa */
  remaining: number | null;
  limit: number | null;
  unit: 'chars' | 'usd' | 'credits' | null;
  resets_at: string | null;
  /** detalhes curtos que ajudam a decidir ("vagas de voz 3/10") */
  notes: string[];
  error: string | null;
}

const TIMEOUT_MS = 12_000;

async function vault(service: Service, name: string): Promise<string | null> {
  const { data } = await service.rpc('get_vault_secret', { _name: name });
  return typeof data === 'string' && data ? data : null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function blank(id: ProviderState['id']): ProviderState {
  return { id, connected: false, plan: null, remaining: null, limit: null, unit: null, resets_at: null, notes: [], error: null };
}

function reason(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/\b401\b|unauthori[sz]ed|invalid.*key/i.test(msg)) return 'A chave foi recusada. Cole uma chave nova em Ajustes → Integrações.';
  if (/\b403\b|permission|scope/i.test(msg)) return 'A chave não tem permissão para ler a conta.';
  if (/timeout|timed out|aborted/i.test(msg)) return 'O provedor demorou para responder. Tente de novo.';
  return 'Não deu para ler a conta agora.';
}

async function elevenlabs(service: Service): Promise<ProviderState> {
  const s = blank('elevenlabs');
  const key = await vault(service, 'ELEVEN_API_KEY');
  if (!key) return s;
  s.connected = true;
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
      headers: { 'xi-api-key': key },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`elevenlabs ${res.status}`);
    const b = (await res.json()) as Json;
    const used = num(b.character_count);
    const limit = num(b.character_limit);
    s.plan = typeof b.tier === 'string' ? b.tier : null;
    s.unit = 'chars';
    s.limit = limit;
    s.remaining = used !== null && limit !== null ? Math.max(0, limit - used) : null;
    const reset = num(b.next_character_count_reset_unix);
    s.resets_at = reset ? new Date(reset * 1000).toISOString() : null;
    const slots = num(b.voice_slots_used);
    const voiceLimit = num(b.voice_limit);
    if (slots !== null && voiceLimit !== null) s.notes.push(`Vagas de voz: ${slots} de ${voiceLimit}`);
  } catch (err) {
    s.error = reason(err);
  }
  return s;
}

async function heygen(service: Service): Promise<ProviderState> {
  const s = blank('heygen');
  const key = await vault(service, 'HEYGEN_API_KEY');
  if (!key) return s;
  s.connected = true;
  try {
    const u = await heygenRequest<Json>(key, '/v3/users/me', { signal: AbortSignal.timeout(TIMEOUT_MS) });
    // a chave é de UM workspace: dizer a conta evita olhar o saldo de outro
    const conta = [u.email, u.username].find((v): v is string => typeof v === 'string' && v.trim() !== '');
    if (conta) s.notes.push(`Conta ${conta}`);
    const kind = u.billing_type;
    if (kind === 'wallet') {
      const w = (u.wallet ?? {}) as Json;
      s.plan = 'Pay-as-you-go';
      s.remaining = num(w.remaining_balance);
      s.unit = w.currency === 'credits' ? 'credits' : 'usd';
      const auto = (w.auto_reload ?? null) as Json | null;
      if (auto?.enabled === true) s.notes.push('Recarga automática ligada');
    } else if (kind === 'subscription') {
      const sub = (u.subscription ?? {}) as Json;
      const credits = (sub.credits ?? {}) as Json;
      const premium = (credits.premium_credits ?? null) as Json | null;
      const addOn = (credits.add_on_credits ?? null) as Json | null;
      s.plan = typeof sub.plan === 'string' ? sub.plan : null;
      s.unit = 'credits';
      const parts = [num(premium?.remaining), num(addOn?.remaining)].filter((v): v is number => v !== null);
      s.remaining = parts.length ? parts.reduce((a, b) => a + b, 0) : null;
      s.resets_at = typeof premium?.resets_at === 'string' ? premium.resets_at : null;
      if (num(addOn?.remaining)) s.notes.push(`${num(addOn?.remaining)} créditos avulsos`);
    } else if (kind === 'usage_based') {
      const ub = (u.usage_based ?? {}) as Json;
      s.plan = 'Por uso';
      s.unit = 'usd';
      const spent = num(ub.spending_current_usd);
      const cap = num(ub.spending_cap_usd);
      s.limit = cap;
      s.remaining = spent !== null && cap !== null ? Math.max(0, cap - spent) : null;
      if (spent !== null) s.notes.push(`Gasto no ciclo: US$ ${spent.toFixed(2)}`);
    }
  } catch (err) {
    s.error = reason(err);
  }
  return s;
}

async function higgsfield(service: Service): Promise<ProviderState> {
  const s = blank('higgsfield');
  if (!(await hfConnected(service))) return s;
  s.connected = true;
  s.unit = 'credits';
  try {
    s.remaining = await Promise.race([
      hfBalance(service),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
    ]);
  } catch (err) {
    s.error = reason(err);
  }
  return s;
}

async function replicate(service: Service): Promise<ProviderState> {
  const s = blank('replicate');
  const token = await vault(service, 'REPLICATE_API_TOKEN');
  if (!token) return s;
  s.connected = true;
  try {
    const res = await fetch('https://api.replicate.com/v1/account', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`replicate ${res.status}`);
    const b = (await res.json()) as Json;
    s.plan = b.type === 'organization' ? 'Organização' : b.type === 'user' ? 'Pessoal' : null;
    s.notes.push('O Replicate não mostra o saldo pela API: confira no site.');
  } catch (err) {
    s.error = reason(err);
  }
  return s;
}

/** Gasto do mês registrado pelo app (estimativas no momento de cada geração). */
async function monthSpend(service: Service) {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const [{ data: reels }, { data: jobs }, { data: budget }, { data: edits }] = await Promise.all([
    service.rpc('video_month_spend_usd'),
    service.from('director_jobs').select('costs').gte('created_at', start.toISOString()),
    service.from('app_settings').select('value').eq('key', 'video_budget').maybeSingle(),
    // edições do "Aprimorar com IA" (Claude); sem a tabela, o erro vira 0
    service.from('video_edits').select('cost_usd').gte('created_at', start.toISOString()),
  ]);
  let claudeEditUsd = 0;
  for (const row of (edits ?? []) as { cost_usd: number | string | null }[]) {
    claudeEditUsd += num(Number(row.cost_usd)) ?? 0;
  }
  let replicateUsd = 0;
  let heygenUsd = 0;
  let hfCredits = 0;
  let elevenChars = 0;
  for (const row of (jobs ?? []) as { costs: Json | null }[]) {
    const c = row.costs ?? {};
    replicateUsd += num(c.replicate_usd_est) ?? 0;
    heygenUsd += num(c.heygen_usd_est) ?? 0;
    hfCredits += num(c.hf_credits_spent) ?? 0;
    elevenChars += num(c.eleven_chars) ?? 0;
  }
  const cap = num(((budget as { value?: Json } | null)?.value ?? {}).monthly_cap_usd);
  return {
    since: start.toISOString(),
    // Reels (video_projects) + vídeos do Diretor pelo Replicate
    replicate_usd: Number(((num(reels) ?? 0) + replicateUsd).toFixed(2)),
    heygen_usd: Number(heygenUsd.toFixed(2)),
    claude_edit_usd: Number(claudeEditUsd.toFixed(2)),
    higgsfield_credits: Number(hfCredits.toFixed(1)),
    elevenlabs_chars: Math.round(elevenChars),
    video_cap_usd: cap ?? 100,
  };
}

const PAGE = 1000;
const MAX_ROWS = 5000;
/** A resposta diz "limite"; a tela avisa que mostra os N mais recentes. */
const VIDEO_LIMIT = 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHUNK = 100;

/** Lê todas as páginas; `cut` diz se bateu no teto antes do fim. */
async function allRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  max = MAX_ROWS,
): Promise<{ rows: T[]; cut: boolean; error: string | null }> {
  const rows: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { rows, cut: false, error: error.message };
    const part = (data ?? []) as T[];
    rows.push(...part);
    if (part.length < PAGE) return { rows, cut: false, error: null };
  }
  return { rows, cut: true, error: null };
}

async function chunked<T>(
  ids: string[],
  read: (part: string[], from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
) {
  const parts: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) parts.push(ids.slice(i, i + CHUNK));
  const done = await Promise.all(parts.map((part) => allRows<T>((from, to) => read(part, from, to))));
  return { rows: done.flatMap((d) => d.rows), cut: done.some((d) => d.cut), error: done.find((d) => d.error)?.error ?? null };
}

type ReelBase = Omit<ReelRow, 'title'>;

const validDate = (v: unknown): string | null =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null;

/** Gasto por vídeo (centro de custos, etapa 1): só lê o que já está gravado. Com job_id, traz só esse vídeo. */
async function byVideo(service: Service, body: Json) {
  const jobId = typeof body.job_id === 'string' ? body.job_id : null;
  const since = jobId ? null : validDate(body.since), until = jobId ? null : validDate(body.until);
  const window = <Q extends { gte(c: string, v: string): Q; lte(c: string, v: string): Q }>(q: Q): Q => {
    const a = since ? q.gte('created_at', since) : q;
    return until ? a.lte('created_at', until) : a;
  };
  const none = { rows: [], cut: false, error: null };
  const [jobs, projects, looseEdits] = await Promise.all([
    allRows<JobRow>((from, to) => {
      const q = service.from('director_jobs').select('id, status, created_at, brief, plan, config, costs');
      return (jobId ? q.eq('id', jobId) : window(q)).order('created_at', { ascending: false }).range(from, to);
    }, VIDEO_LIMIT),
    jobId ? none : allRows<ReelBase>((from, to) => window(service.from('video_projects')
      .select('id, status, created_at, estimated_cost_usd, actual_cost_usd, piece_id'))
      .order('created_at', { ascending: false }).range(from, to), VIDEO_LIMIT),
    // sem a tabela (SQL ainda não rodou) a lista segue, sem as edições
    jobId ? none : allRows<EditCostRow>((from, to) => window(service.from('video_edits')
      .select('id, source_kind, source_id, source_path, status, cost_usd, created_at').is('source_id', null))
      .order('created_at', { ascending: false }).range(from, to), VIDEO_LIMIT),
  ]);
  if (jobs.error || projects.error) throw new Error(jobs.error ?? projects.error ?? 'leitura');

  const recent = newestVideos(jobs.rows, projects.rows as ReelBase[], looseEdits.rows as EditCostRow[], VIDEO_LIMIT);
  const [jobEdits, predictions, pieces] = await Promise.all([
    chunked<EditCostRow>(recent.jobs.map((j) => j.id), (part, from, to) => service.from('video_edits')
      .select('id, source_kind, source_id, source_path, status, cost_usd, created_at').in('source_id', part).order('id').range(from, to)),
    chunked<PredictionRow>(recent.reels.map((p) => p.id), (part, from, to) => service.from('video_predictions')
      .select('project_id, kind, model_id, status, cost_actual_usd, cost_estimated_usd').in('project_id', part).order('id').range(from, to)),
    chunked<{ id: string; core_content: Json | null }>(
      recent.reels.flatMap((p) => p.piece_id ? [p.piece_id] : []),
      (part, from, to) => service.from('content_pieces').select('id, core_content').in('id', part).order('id').range(from, to),
    ),
  ]);
  if (predictions.error) throw new Error(predictions.error);

  const titles = new Map(pieces.rows.map((p) => [p.id, pieceTitle(p.core_content)]));
  const videos = buildVideoCosts({
    jobs: recent.jobs,
    reels: recent.reels.map((p) => ({ ...p, title: (p.piece_id && titles.get(p.piece_id)) || null })),
    predictions: predictions.rows,
    edits: [...(looseEdits.error ? [] : recent.edits), ...(jobEdits.error ? [] : jobEdits.rows)],
    editModel: EDIT_MODEL,
  });
  return {
    videos,
    desde: since,
    ate: until,
    limite: VIDEO_LIMIT,
    truncado: recent.cut || [jobs, projects, looseEdits, jobEdits, predictions, pieces].some((r) => r.cut),
    avisos: [
      'letras_nao_registradas',
      'claude_producao_nao_registrado',
      ...(looseEdits.error || jobEdits.error ? ['edicoes_indisponiveis'] : []),
    ],
    checked_at: new Date().toISOString(),
  };
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  try {
    const user = await getUser(req);
    if (!user) return errorResponse(401, 'unauthorized', 'Sessão inválida ou ausente.');
    const service = createServiceClient();
    const { data: isAdmin } = await service.rpc('has_role', { _user_id: user.id, _role: 'admin' });
    if (isAdmin !== true) return errorResponse(403, 'forbidden', 'Só administradores veem os custos.');

    const body = (await req.json().catch(() => ({}))) as Json;
    if (body.action === 'by_video') {
      if (body.job_id !== undefined && (typeof body.job_id !== 'string' || !UUID_RE.test(body.job_id))) {
        return errorResponse(400, 'invalid_job_id', 'Vídeo inválido.');
      }
      return jsonResponse(await byVideo(service, body));
    }

    const [providers, spend] = await Promise.all([
      Promise.all([elevenlabs(service), heygen(service), higgsfield(service), replicate(service)]),
      monthSpend(service),
    ]);
    return jsonResponse({ providers, spend, checked_at: new Date().toISOString() });
  } catch (err) {
    console.error('[provider-credits]', err);
    return errorResponse(500, 'internal', 'Não deu para montar a central de custos agora.');
  }
});
