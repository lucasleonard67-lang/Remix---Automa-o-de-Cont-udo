// fetch-rss/score.ts — nota por notícia, calculada logo após a coleta.
//
// relevance (0–100) · o quanto a pauta casa com a marca. Uma chamada barata do
//   papel `router` por lote de 15 notícias, com o resumo da marca (persona +
//   estratégia + nicho) no sistema, devolvendo JSON com nota, assuntos e motivo.
//   Embeddings dariam só um cosseno sem explicação; aqui saem os `topics`
//   (filtro da tela) e o `score_reason` ("por que casa") na mesma chamada.
// virality (0–100) · tendência: recência + repetição do assunto entre as fontes
//   nas últimas 48h + palavras de tração no título + "calor" do tema no
//   mercado (o mesmo lote da IA devolve `heat`).
//
// Limite por execução (SCORE_LIMIT_PER_RUN) para não estourar o tempo da
// função: o que sobrar entra na próxima atualização (a cada 30 min).

import { chat, LlmError } from '../_shared/llm.ts';
import type { createServiceClient } from '../_shared/supabase.ts';

type Service = ReturnType<typeof createServiceClient>;

export const SCORE_LIMIT_PER_RUN = 45;
const BATCH = 15;
const RECENT_WINDOW_HOURS = 48;

type Row = {
  id: string;
  title: string;
  description: string | null;
  published_at: string | null;
  created_at: string;
  feed_id: string;
};

type RecentRow = {
  id: string;
  title: string;
  topics: string[] | null;
  feed_id: string;
};

type LlmItem = { id: string; relevance: number; heat: number; topics: string[]; reason: string };

export type ScoreSummary = {
  scored: number;
  pending: number;
  /** Aviso humano quando a nota de marca não pôde ser calculada (IA/marca). */
  warning: string | null;
};

// ── Marca → texto curto ──────────────────────────────────────────────────────

function str(v: unknown, max = 400): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}
function list(v: unknown, n = 5, max = 120): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, n).map((x) => x.trim().slice(0, max))
    : [];
}

export async function loadBrandSummary(service: Service): Promise<string | null> {
  const [persona, strategy, niche] = await Promise.all([
    service.from('brand_persona').select('content').eq('status', 'active').maybeSingle(),
    service.from('brand_strategy').select('content').eq('status', 'active').maybeSingle(),
    loadNicheName(service),
  ]);
  const p = (persona.data as { content?: Record<string, unknown> } | null)?.content ?? null;
  const s = (strategy.data as { content?: Record<string, unknown> } | null)?.content ?? null;

  const lines: string[] = [];
  if (niche) lines.push(`Nicho: ${niche}`);
  if (p) {
    const id = (p.identity ?? {}) as Record<string, unknown>;
    const who = [str(id.name, 80), str(id.role, 120)].filter(Boolean).join(', ');
    if (who) lines.push(`Quem fala: ${who}`);
    const pos = str(id.positioning, 500);
    if (pos) lines.push(`Posicionamento: ${pos}`);
    const aud = str(id.audience, 300);
    if (aud) lines.push(`Público: ${aud}`);
    const wv = (p.worldview ?? {}) as Record<string, unknown>;
    const wsum = str(wv.summary, 400);
    if (wsum) lines.push(`Visão de mundo: ${wsum}`);
    const theses = list(wv.theses);
    if (theses.length) lines.push(`Teses: ${theses.join(' | ')}`);
  }
  if (s) {
    const promise = str(s.brand_promise, 300);
    if (promise) lines.push(`Promessa: ${promise}`);
    const theses = list(s.theses);
    if (theses.length) lines.push(`Bandeiras: ${theses.join(' | ')}`);
    const enemy = str(s.enemy, 200);
    if (enemy) lines.push(`Combate: ${enemy}`);
    const safe = list(s.safe_list, 8, 60);
    if (safe.length) lines.push(`Assuntos da casa: ${safe.join(', ')}`);
    const icp = (s.icp ?? {}) as Record<string, unknown>;
    const perfil = str(icp.perfil, 300);
    if (perfil) lines.push(`Cliente ideal: ${perfil}`);
    const desejos = list(icp.desejos, 5, 100);
    if (desejos.length) lines.push(`O que ele quer: ${desejos.join(' | ')}`);
    const stance = str(s.editorial_stance, 300);
    if (stance) lines.push(`Postura editorial: ${stance}`);
  }
  const text = lines.join('\n');
  return text.length >= 40 ? text.slice(0, 2400) : null;
}

async function loadNicheName(service: Service): Promise<string | null> {
  const { data: setting } = await service.from('app_settings').select('value').eq('key', 'onboarding').maybeSingle();
  const value = (setting as { value?: Record<string, unknown> } | null)?.value;
  const slug = value && typeof value.niche_template_slug === 'string' ? value.niche_template_slug : null;
  if (!slug) return null;
  const { data } = await service.from('niche_templates').select('name').eq('slug', slug).maybeSingle();
  return str((data as { name?: unknown } | null)?.name, 120);
}

// ── Heurísticas de viralidade ────────────────────────────────────────────────

const STOP = new Set([
  'para', 'como', 'com', 'sem', 'por', 'que', 'uma', 'dos', 'das', 'nos', 'nas', 'mais', 'menos', 'sobre',
  'entre', 'após', 'apos', 'ante', 'até', 'ate', 'quando', 'onde', 'quem', 'qual', 'quais', 'pelo', 'pela',
  'pelos', 'pelas', 'este', 'esta', 'esse', 'essa', 'isso', 'isto', 'aqui', 'ainda', 'veja', 'saiba', 'diz',
  'tem', 'têm', 'ser', 'são', 'sao', 'foi', 'era', 'vai', 'the', 'and', 'for', 'with', 'from', 'that', 'this',
  'anos', 'ano', 'dia', 'dias', 'hoje', 'nova', 'novo', 'novas', 'novos', 'contra', 'depois', 'antes',
]);

const TRACTION = [
  /\brecorde\b/i, /\bin[eé]dit[oa]\b/i, /\bpol[eê]mic[oa]\b/i, /\bviraliz/i, /\bviral\b/i, /\bexplod/i,
  /\bdispar/i, /\bdespenc/i, /\bbomba\b/i, /\burgente\b/i, /\bao vivo\b/i, /\bexclusiv/i, /\bescândalo\b/i,
  /\banuncia\b/i, /\blança\b/i, /\bproíbe\b/i, /\bdemite\b/i, /\bbilh(ão|ões)\b/i, /\bmilh(ão|ões)\b/i,
  /\bgr[aá]tis\b/i, /\bchatgpt\b/i, /\bopenai\b/i, /\binteligência artificial\b/i, /\bIA\b/, /\bagentes?\b/i,
  /\btiktok\b/i, /\binstagram\b/i, /\bwhatsapp\b/i, /\bmeta\b/i, /\bgoogle\b/i, /\bapple\b/i, /\bnvidia\b/i,
];

function tokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOP.has(w)),
  );
}

function hoursSince(iso: string | null, fallbackIso: string): number {
  const t = new Date(iso ?? fallbackIso).getTime();
  if (Number.isNaN(t)) return 72;
  return Math.max(0, (Date.now() - t) / 3_600_000);
}

function recencyScore(hours: number): number {
  // 0h → 100 · 12h → 72 · 24h → 51 · 48h → 26 · 96h → 7
  return Math.round(100 * Math.exp(-hours / 36));
}

function repetitionScore(count: number): number {
  if (count <= 0) return 8;
  if (count === 1) return 38;
  if (count === 2) return 58;
  if (count === 3) return 72;
  if (count === 4) return 82;
  return 94;
}

function tractionBonus(title: string): number {
  let hits = 0;
  for (const rx of TRACTION) if (rx.test(title)) hits++;
  return Math.min(12, hits * 4);
}

/** Quantas outras notícias (48h) falam do mesmo assunto: ≥2 palavras fortes em comum ou um assunto igual. */
function countEchoes(item: { id: string; title: string; topics: string[] }, recent: RecentRow[]): number {
  const mine = tokens(item.title);
  const myTopics = new Set(item.topics);
  let n = 0;
  for (const other of recent) {
    if (other.id === item.id) continue;
    let shared = 0;
    for (const w of tokens(other.title)) if (mine.has(w)) shared++;
    const topicHit = (other.topics ?? []).some((t) => myTopics.has(t));
    if (shared >= 2 || topicHit) n++;
  }
  return n;
}

function clamp(n: unknown, fallback = 0): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function virality(input: {
  hours: number;
  echoes: number;
  title: string;
  heat: number | null;
}): number {
  const r = recencyScore(input.hours);
  const e = repetitionScore(input.echoes);
  const bonus = tractionBonus(input.title);
  const base = input.heat === null ? 0.55 * r + 0.45 * e : 0.4 * r + 0.33 * e + 0.27 * input.heat;
  return clamp(base + bonus);
}

// ── IA: relevância + assuntos + calor (em lote) ──────────────────────────────

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'relevance', 'heat', 'topics', 'reason'],
        properties: {
          id: { type: 'string' },
          relevance: { type: 'integer', minimum: 0, maximum: 100 },
          heat: { type: 'integer', minimum: 0, maximum: 100 },
          topics: { type: 'array', items: { type: 'string' }, maxItems: 3 },
          reason: { type: 'string' },
        },
      },
    },
  },
} as const;

const SYSTEM = `Você é o editor-chefe de uma marca e avalia pautas de notícia para ela.
Para CADA notícia recebida devolva:
- relevance (0–100): o quanto a pauta casa com a marca abaixo — nicho, teses, público e assuntos da casa. 90+ só quando a marca teria obrigação de comentar; 60–89 quando rende um bom gancho; abaixo de 40 quando é de outro universo.
- heat (0–100): quanto o assunto está em alta no mercado da marca agora (tração, repercussão provável, interesse do público).
- topics: 1 a 3 assuntos curtos em português, minúsculas, 1–2 palavras cada (ex.: "inteligência artificial", "instagram", "eleições"). Prefira termos que agrupem notícias parecidas.
- reason: uma frase de até 90 caracteres, em português, dizendo por que casa (ou não) com a marca. Sem jargão.
Devolva exatamente um item por id recebido, na mesma ordem.`;

function normalizeTopics(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== 'string') continue;
    const v = t.toLowerCase().replace(/\s+/g, ' ').replace(/[.#"'“”]/g, '').trim().slice(0, 28);
    if (v.length >= 2 && !out.includes(v)) out.push(v);
    if (out.length === 3) break;
  }
  return out;
}

async function scoreBatchWithAi(brand: string, rows: Row[]): Promise<Map<string, LlmItem>> {
  const user = rows
    .map((r, i) => {
      const resumo = (r.description ?? '').replace(/\s+/g, ' ').slice(0, 280);
      return `${i + 1}. id=${r.id}\nTítulo: ${r.title}${resumo ? `\nResumo: ${resumo}` : ''}`;
    })
    .join('\n\n');
  const result = await chat({
    role_hint: 'router',
    messages: [
      { role: 'system', content: `${SYSTEM}\n\nMARCA:\n${brand}` },
      { role: 'user', content: `Notícias:\n\n${user}` },
    ],
    schema: SCHEMA as unknown as Record<string, unknown>,
    max_tokens: 2400,
  });
  const parsed = result.parsed as { items?: unknown[] } | undefined;
  const map = new Map<string, LlmItem>();
  for (const raw of parsed?.items ?? []) {
    const it = raw as Record<string, unknown>;
    if (typeof it.id !== 'string') continue;
    map.set(it.id, {
      id: it.id,
      relevance: clamp(it.relevance),
      heat: clamp(it.heat, 40),
      topics: normalizeTopics(it.topics),
      reason: typeof it.reason === 'string' ? it.reason.trim().slice(0, 140) : '',
    });
  }
  return map;
}

// ── Orquestração ─────────────────────────────────────────────────────────────

export async function scorePendingItems(service: Service, limit = SCORE_LIMIT_PER_RUN): Promise<ScoreSummary> {
  const { data: pendingRaw, count } = await service
    .from('rss_items')
    .select('id, title, description, published_at, created_at, feed_id', { count: 'exact' })
    .is('scored_at', null)
    .is('dismissed_at', null)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  const pending = (pendingRaw ?? []) as Row[];
  if (pending.length === 0) return { scored: 0, pending: 0, warning: null };

  const since = new Date(Date.now() - RECENT_WINDOW_HOURS * 3_600_000).toISOString();
  const [{ data: recentRaw }, brand] = await Promise.all([
    service.from('rss_items').select('id, title, topics, feed_id').gte('created_at', since).limit(600),
    loadBrandSummary(service),
  ]);
  const recent = (recentRaw ?? []) as RecentRow[];

  // IA em paralelo por lote (3 lotes de 15 ≈ o tempo de um).
  let ai = new Map<string, LlmItem>();
  let warning: string | null = null;
  if (!brand) {
    warning = 'A relevância só é calculada depois que a marca estiver definida em Marca (persona e estratégia).';
  } else {
    const batches: Row[][] = [];
    for (let i = 0; i < pending.length; i += BATCH) batches.push(pending.slice(i, i + BATCH));
    const settled = await Promise.allSettled(batches.map((b) => scoreBatchWithAi(brand, b)));
    for (const s of settled) {
      if (s.status === 'fulfilled') ai = new Map([...ai, ...s.value]);
      else {
        const err = s.reason;
        console.warn('[fetch-rss] score: lote falhou:', err instanceof Error ? err.message : err);
        if (!warning) {
          warning =
            err instanceof LlmError && err.code === 'credits_exhausted'
              ? 'A nota de relevância parou: os créditos de IA acabaram. Recarregue em Config → IA.'
              : 'A nota de relevância não foi calculada agora; tentamos de novo na próxima atualização.';
        }
      }
    }
  }

  const now = new Date().toISOString();
  const updates = pending.map((row) => {
    const a = ai.get(row.id) ?? null;
    const topics = a?.topics ?? [];
    const echoes = countEchoes({ id: row.id, title: row.title, topics }, recent);
    const v = virality({
      hours: hoursSince(row.published_at, row.created_at),
      echoes,
      title: row.title,
      heat: a ? a.heat : null,
    });
    const complete = Boolean(a) || !brand;
    const reasonBits: string[] = [];
    if (a?.reason) reasonBits.push(a.reason);
    if (echoes > 0) reasonBits.push(`${echoes} fonte${echoes === 1 ? '' : 's'} falando disso nas últimas 48h`);
    if (!a && warning) reasonBits.push(warning);
    return {
      id: row.id,
      patch: {
        relevance: a ? a.relevance : null,
        virality: v,
        topics,
        score_reason: reasonBits.join(' · ').slice(0, 400) || null,
        // Sem nota de marca por falha transitória → fica pendente para a próxima rodada.
        scored_at: complete ? now : null,
      },
    };
  });

  let scored = 0;
  for (let i = 0; i < updates.length; i += 10) {
    const slice = updates.slice(i, i + 10);
    const results = await Promise.all(
      slice.map((u) => service.from('rss_items').update(u.patch).eq('id', u.id)),
    );
    for (const r of results) if (!r.error) scored++;
    for (const r of results) if (r.error) console.warn('[fetch-rss] score: update falhou:', r.error.message);
  }

  return { scored, pending: Math.max(0, (count ?? pending.length) - pending.length), warning };
}
