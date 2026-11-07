// _shared/market-score.ts — nota dos posts dos concorrentes (módulo Mercado),
// no mesmo critério do Radar (fetch-rss/score.ts):
//
// relevance (0–100) · o quanto o post casa com a marca. UMA chamada do papel
//   `router` por lote, com o resumo da marca no sistema, devolvendo nota,
//   assuntos (`topics`), motivo (`reason`) e um ângulo para a marca (`angle`,
//   que vira o brief de "Criar a minha versão").
// virality (0–100) · desempenho real: posição do engajamento do post entre
//   todos os posts de concorrentes lidos + recência + "calor" do assunto
//   (o mesmo lote da IA devolve `heat`).
//
// NOTA: `loadBrandSummary` e os helpers de marca são CÓPIA de
// fetch-rss/score.ts (que é privado daquela função). Copiado de propósito
// para não redeployar o fetch-rss nesta entrega; se mudar lá, espelhar aqui.

import { chat, LlmError } from './llm.ts';
import type { createServiceClient } from './supabase.ts';

type Service = ReturnType<typeof createServiceClient>;

// ── Marca → texto curto (cópia de fetch-rss/score.ts) ────────────────────────

function str(v: unknown, max = 400): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}
function list(v: unknown, n = 5, max = 120): string[] {
  return Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .slice(0, n)
        .map((x) => x.trim().slice(0, max))
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

// ── Engajamento e tendência ──────────────────────────────────────────────────

/** (curtidas + comentários + views × 0,1) ÷ seguidores; null sem seguidores. */
export function engagementOf(
  post: { likes: number | null; comments: number | null; views: number | null },
  followers: number | null,
): number | null {
  if (!followers || followers <= 0) return null;
  const raw = (post.likes ?? 0) + (post.comments ?? 0) + (post.views ?? 0) * 0.1;
  if (raw <= 0 && post.likes === null && post.comments === null && post.views === null) return null;
  return Number((raw / followers).toFixed(6));
}

function clamp(n: unknown, fallback = 0): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function hoursSince(iso: string | null): number {
  if (!iso) return 24 * 14;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 24 * 14;
  return Math.max(0, (Date.now() - t) / 3_600_000);
}

/** Posts de concorrente envelhecem mais devagar que notícia: 0d → 100 · 7d → 61 · 14d → 37 · 30d → 12. */
function recencyScore(hours: number): number {
  return Math.round(100 * Math.exp(-hours / (24 * 14)));
}

/** Posição (0–100) do engajamento do post entre todos os lidos. */
export function engagementRank(value: number | null, all: number[]): number {
  if (value === null || all.length === 0) return 0;
  if (all.length === 1) return 70;
  let below = 0;
  for (const v of all) if (v < value) below++;
  return Math.round((below / (all.length - 1)) * 100);
}

export function virality(input: { rank: number; hours: number; heat: number | null }): number {
  const r = recencyScore(input.hours);
  const base =
    input.heat === null
      ? 0.65 * input.rank + 0.35 * r
      : 0.5 * input.rank + 0.25 * r + 0.25 * input.heat;
  return clamp(base);
}

// ── IA: relevância + assuntos + calor + ângulo (em lote) ─────────────────────

export type LlmItem = {
  id: string;
  relevance: number;
  heat: number;
  topics: string[];
  reason: string;
  angle: string;
};

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
        required: ['id', 'relevance', 'heat', 'topics', 'reason', 'angle'],
        properties: {
          id: { type: 'string' },
          relevance: { type: 'integer', minimum: 0, maximum: 100 },
          heat: { type: 'integer', minimum: 0, maximum: 100 },
          topics: { type: 'array', items: { type: 'string' }, maxItems: 3 },
          reason: { type: 'string' },
          angle: { type: 'string' },
        },
      },
    },
  },
} as const;

const SYSTEM = `Você é o editor-chefe de uma marca e avalia posts de Instagram de CONCORRENTES para ela.
Para CADA post recebido devolva:
- relevance (0–100): o quanto o assunto do post casa com a marca abaixo — nicho, teses, público e assuntos da casa. 90+ só quando a marca teria obrigação de falar disso; 60–89 quando rende um bom gancho; abaixo de 40 quando é de outro universo.
- heat (0–100): quanto o assunto está em alta no mercado da marca agora (tração, repercussão provável, interesse do público).
- topics: 1 a 3 assuntos curtos em português, minúsculas, 1–2 palavras cada. Prefira termos que agrupem posts parecidos.
- reason: uma frase de até 90 caracteres, em português, dizendo por que o post funcionou ou por que casa (ou não) com a marca. Sem jargão.
- angle: uma frase de até 160 caracteres, em português, com o ângulo que a MARCA usaria para fazer a própria versão deste post (sem copiar; com a postura e as teses dela).
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

export type ScoreInput = {
  id: string;
  handle: string;
  caption: string | null;
  media_type: string | null;
  likes: number | null;
  comments: number | null;
  views: number | null;
  engagement: number | null;
};

const FORMAT_PT: Record<string, string> = { image: 'imagem', carousel: 'carrossel', reel: 'reel' };

export async function scoreBatchWithAi(brand: string, rows: ScoreInput[]): Promise<Map<string, LlmItem>> {
  const user = rows
    .map((r, i) => {
      const caption = (r.caption ?? '').replace(/\s+/g, ' ').slice(0, 320) || '(sem legenda)';
      const metrics = [
        r.likes !== null ? `${r.likes} curtidas` : null,
        r.comments !== null ? `${r.comments} comentários` : null,
        r.views !== null ? `${r.views} views` : null,
        r.engagement !== null ? `engajamento ${(r.engagement * 100).toFixed(2)}% dos seguidores` : null,
      ]
        .filter(Boolean)
        .join(', ');
      return `${i + 1}. id=${r.id}\n@${r.handle} · ${FORMAT_PT[r.media_type ?? ''] ?? 'post'}${metrics ? ` · ${metrics}` : ''}\nLegenda: ${caption}`;
    })
    .join('\n\n');
  const result = await chat({
    role_hint: 'router',
    messages: [
      { role: 'system', content: `${SYSTEM}\n\nMARCA:\n${brand}` },
      { role: 'user', content: `Posts dos concorrentes:\n\n${user}` },
    ],
    schema: SCHEMA as unknown as Record<string, unknown>,
    max_tokens: 3200,
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
      angle: typeof it.angle === 'string' ? it.angle.trim().slice(0, 220) : '',
    });
  }
  return map;
}

/** Aviso humano para falha da IA (mesmo vocabulário do Radar). */
export function aiWarning(err: unknown): string {
  return err instanceof LlmError && err.code === 'credits_exhausted'
    ? 'A nota de relevância parou: os créditos de IA acabaram. Recarregue em Config → IA.'
    : 'A nota de relevância não foi calculada agora; tentamos de novo na próxima atualização.';
}

export { hoursSince };
