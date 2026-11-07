// _shared/brand-autopilot.ts — contrato de estado, leitura do site e prompt do
// "autopilot" de marca (onboarding em 2 campos: site + @ do Instagram).
//
// O orquestrador (functions/brand-autopilot) grava o estado em
// app_settings.brand_autopilot e processa UMA etapa por chamada. Este módulo
// concentra o que não depende de banco: tipos, leitura de páginas (Firecrawl
// quando há key; fetch simples quando não há), pistas visuais do HTML e o
// prompt/schema da única chamada de IA que monta o perfil inteiro.

import { cleanText } from './chunking.ts';
import { firecrawlAvailable, firecrawlMap, firecrawlScrape } from './web-search.ts';
import { VOICE_EXTRACTOR_SCHEMA } from './prompts/voice-extractor.ts';
import { CHANNEL_TYPES, type ChannelType } from './types.ts';
import { isPublicUrl } from './link-rules.ts';
import { BlockedUrlError, safeFetch } from './link-reader.ts';

// ── Estado (app_settings.brand_autopilot) ────────────────────────────────────

export const AUTOPILOT_SETTING_KEY = 'brand_autopilot';

export type AutopilotStepId =
  | 'ler_site'
  | 'ler_instagram'
  | 'montar_perfil'
  | 'ligar_canais'
  | 'teste_de_tom';

export const AUTOPILOT_STEP_IDS: readonly AutopilotStepId[] = [
  'ler_site',
  'ler_instagram',
  'montar_perfil',
  'ligar_canais',
  'teste_de_tom',
] as const;

export type AutopilotStepStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'skipped'
  | 'failed'
  | 'needs_review';

export interface AutopilotStep {
  id: AutopilotStepId;
  status: AutopilotStepStatus;
  /** Uma frase, em pt-BR, quando a etapa termina ("Li 8 páginas"). */
  summary: string | null;
  /** Motivo de falha/pulo, já em linguagem de tela. */
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface AutopilotInput {
  site: string;
  instagram: string | null;
  captions: string[];
}

export type ReviewSectionId =
  | 'quem_somos'
  | 'publico'
  | 'voz'
  | 'posicionamento'
  | 'regras'
  | 'visual'
  | 'canais';

export interface ReviewSection {
  id: ReviewSectionId;
  items: string[];
  /** 0–1; abaixo de 0.6 a tela marca "confira". */
  confidence: number;
  /** Página/trecho de onde saiu. */
  source: string;
}

export interface AutopilotReview {
  name: string;
  niche: string;
  description: string;
  sections: ReviewSection[];
  palette: string[];
  logo_url: string | null;
  channels: ChannelType[];
}

export interface AutopilotData {
  pages?: Array<{ url: string; title: string; chars: number }>;
  site_hints?: SiteHints;
  instagram_source?: 'zernio' | 'manual' | null;
  caption_count?: number;
  context_item_ids?: string[];
  versions?: Partial<Record<'brand_persona' | 'brand_strategy' | 'guardrails' | 'brand_kit', number>>;
  channels?: ChannelType[];
  tone?: {
    attempt: number;
    job_ids: string[];
    started_at: string | null;
    score: number | null;
    cutoff: number | null;
  };
}

export interface AutopilotState {
  status: 'idle' | 'running' | 'done' | 'failed';
  /** Etapa em execução (ou a próxima pendente). */
  step: AutopilotStepId | null;
  steps: AutopilotStep[];
  input: AutopilotInput;
  started_at: string | null;
  finished_at: string | null;
  /** Trava curta contra duas abas processando a mesma etapa. */
  lock_until: string | null;
  data: AutopilotData;
  review: AutopilotReview | null;
}

export function emptyState(input: AutopilotInput): AutopilotState {
  return {
    status: 'running',
    step: 'ler_site',
    steps: AUTOPILOT_STEP_IDS.map((id) => ({
      id,
      status: 'pending',
      summary: null,
      error: null,
      started_at: null,
      finished_at: null,
    })),
    input,
    started_at: new Date().toISOString(),
    finished_at: null,
    lock_until: null,
    data: {},
    review: null,
  };
}

// ── Entrada ──────────────────────────────────────────────────────────────────

/** Normaliza o site digitado: aceita "minhamarca.com.br" e devolve URL https. Endereço interno → null. */
export function normalizeSiteUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!isPublicUrl(url.toString())) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/** "@Marca", "instagram.com/marca/" ou "marca" → "marca". */
export function normalizeInstagramHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  const match = value.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  if (match) value = match[1];
  value = value.replace(/^@+/, '').replace(/\/+$/, '');
  if (!/^[A-Za-z0-9._]{1,30}$/.test(value)) return null;
  return value.toLowerCase();
}

// ── Leitura do site ──────────────────────────────────────────────────────────

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
}

export interface SiteHints {
  colors: string[];
  fonts: string[];
  logo_url: string | null;
}

/** Home + até este número de páginas internas. */
export const MAX_INTERNAL_PAGES = 10;
const PAGE_FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_CHARS = 400_000;
/** Texto por página levado ao modelo. */
export const MAX_PAGE_TEXT_CHARS = 6_000;
const MIN_PAGE_TEXT_CHARS = 200;

/** Palavras que sinalizam página útil para entender a marca (pt + en). */
const RELEVANT_PATH_WORDS = [
  'sobre',
  'quem-somos',
  'quemsomos',
  'about',
  'historia',
  'servico',
  'servicos',
  'services',
  'produto',
  'produtos',
  'products',
  'solucao',
  'solucoes',
  'solutions',
  'metodo',
  'como-funciona',
  'blog',
  'artigos',
  'conteudo',
  'cases',
  'casos',
  'clientes',
  'depoimentos',
  'resultados',
  'planos',
  'precos',
  'pricing',
  'faq',
  'perguntas',
  'manifesto',
  'equipe',
  'time',
  'contato',
];

const IGNORED_PATH_PATTERN =
  /\.(png|jpe?g|gif|svg|webp|ico|pdf|zip|mp4|mp3|css|js|xml|json)(\?|$)|\/(wp-admin|wp-json|wp-content|cart|carrinho|checkout|login|signin|signup|cadastro|minha-conta|account|tag|tags|category|categoria|author|autor|feed|search|busca|politica|privacidade|termos|cookies)(\/|$)/i;

function sameSite(candidate: URL, base: URL): boolean {
  const strip = (host: string) => host.replace(/^www\./i, '');
  return strip(candidate.hostname) === strip(base.hostname);
}

function canonical(url: URL): string {
  url.hash = '';
  url.search = '';
  let out = url.toString();
  if (out.endsWith('/') && url.pathname !== '/') out = out.slice(0, -1);
  return out;
}

/** Relevância de uma URL interna: palavras-chave no caminho e pouca profundidade. */
function scorePath(url: URL): number {
  const path = url.pathname.toLowerCase();
  let score = 0;
  for (const word of RELEVANT_PATH_WORDS) {
    if (path.includes(word)) score += 10;
  }
  const depth = path.split('/').filter(Boolean).length;
  score -= depth * 2;
  if (depth === 0) score -= 100; // home já foi lida
  return score;
}

/** Escolhe até MAX_INTERNAL_PAGES URLs internas relevantes, sem repetir. */
export function pickInternalPages(baseUrl: string, candidates: string[]): string[] {
  const base = new URL(baseUrl);
  const homeKey = canonical(new URL(baseUrl));
  const seen = new Map<string, number>();
  for (const raw of candidates) {
    let url: URL;
    try {
      url = new URL(raw, base);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    if (!sameSite(url, base)) continue;
    if (IGNORED_PATH_PATTERN.test(url.pathname + url.search)) continue;
    const key = canonical(url);
    if (key === homeKey) continue;
    const score = scorePath(url);
    if (!seen.has(key) || (seen.get(key) ?? 0) < score) seen.set(key, score);
  }
  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_INTERNAL_PAGES)
    .map(([url]) => url);
}

/** Links <a href> do HTML (absolutos ou relativos). */
export function extractLinks(html: string): string[] {
  const links: string[] = [];
  const pattern = /<a\b[^>]*?href\s*=\s*["']([^"'#]+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    links.push(match[1].trim());
    if (links.length > 2_000) break;
  }
  return links;
}

export function extractTitle(html: string, fallback: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const value = (og?.[1] ?? title?.[1] ?? '').replace(/\s+/g, ' ').trim();
  return (value || fallback).slice(0, 200);
}

/** Texto limpo de uma página HTML (sem nav/rodapé quando dá para detectar). */
export function htmlToText(html: string): string {
  const withoutChrome = html
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ');
  return cleanText(withoutChrome);
}

const HEX_PATTERN = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi;
const NEUTRAL_HEX = new Set(['#000000', '#ffffff', '#000', '#fff']);
const GENERIC_FONTS = new Set([
  'inherit',
  'initial',
  'sans-serif',
  'serif',
  'monospace',
  'system-ui',
  '-apple-system',
  'blinkmacsystemfont',
  'segoe ui',
  'arial',
  'helvetica',
  'helvetica neue',
  'roboto',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'apple color emoji',
  'segoe ui emoji',
  'segoe ui symbol',
  'noto color emoji',
  'sans',
  'cursive',
  'fantasy',
]);

/** Cores, fontes e logo declarados no HTML — mesma leitura do brand-kit-suggest, só que em código. */
export function extractVisualHints(html: string, baseUrl: string): SiteHints {
  const counts = new Map<string, number>();
  for (const match of html.match(HEX_PATTERN) ?? []) {
    let hex = match.toLowerCase();
    if (hex.length === 4) hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
    if (NEUTRAL_HEX.has(hex)) continue;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  const colors = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([hex]) => hex);

  const fonts = new Set<string>();
  const googleFonts = html.match(/fonts\.googleapis\.com\/css2?\?[^"']+/gi) ?? [];
  for (const link of googleFonts) {
    for (const fam of link.match(/family=([^&:"']+)/gi) ?? []) {
      const name = decodeURIComponent(fam.replace(/^family=/i, '')).replace(/\+/g, ' ').trim();
      if (name) fonts.add(name);
    }
  }
  const families = html.match(/font-family\s*:\s*([^;}"']+)/gi) ?? [];
  for (const decl of families) {
    const list = decl.replace(/^font-family\s*:\s*/i, '').split(',');
    for (const raw of list) {
      const name = raw.replace(/["']/g, '').trim();
      if (!name || name.startsWith('var(') || GENERIC_FONTS.has(name.toLowerCase())) continue;
      fonts.add(name);
      if (fonts.size >= 6) break;
    }
    if (fonts.size >= 6) break;
  }

  let logo: string | null = null;
  const logoImg = html.match(/<img\b[^>]*?(?:class|alt|id|src)=["'][^"']*logo[^"']*["'][^>]*>/i)?.[0];
  const logoSrc = logoImg?.match(/\bsrc=["']([^"']+)["']/i)?.[1];
  const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const icon = html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i)?.[1];
  for (const candidate of [logoSrc, ogImage, icon]) {
    if (!candidate || candidate.startsWith('data:')) continue;
    try {
      logo = new URL(candidate, baseUrl).toString();
      break;
    } catch {
      // segue para o próximo candidato
    }
  }

  return { colors, fonts: [...fonts].slice(0, 6), logo_url: logo };
}

/**
 * Falha ao abrir o site → frase para a tela. O erro do runtime ("dns error:
 * failed to lookup address…") chega cru até o usuário sem isto.
 */
export function describeSiteError(err: unknown, url: string): string {
  const host = siteHost(url);
  if (err instanceof BlockedUrlError) return `O endereço ${host} não é de um site público. Confira o endereço.`;
  const cause = (err as { cause?: { message?: string; code?: string } } | null)?.cause;
  const msg = [err instanceof Error ? err.message : String(err), cause?.message, cause?.code]
    .filter(Boolean)
    .join(' ');
  if (/dns error|lookup address|name or service not known|enotfound|no such host/i.test(msg)) {
    return `Não encontramos o site ${host}. Confira o endereço.`;
  }
  if (/timed? ?out|timeout|aborted/i.test(msg)) {
    return `O site ${host} demorou demais para responder. Tente de novo em instantes.`;
  }
  if (/certificate|tls|ssl/i.test(msg)) {
    return `O site ${host} está com o certificado de segurança (HTTPS) inválido.`;
  }
  if (/^O site respondeu/.test(msg)) return msg.replace(/^O site/, `O site ${host}`);
  return `Não conseguimos abrir o site ${host}.`;
}

function siteHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Mesma URL com o www trocado (com ↔ sem). */
function toggleWww(url: string): string {
  const u = new URL(url);
  u.hostname = u.hostname.startsWith('www.') ? u.hostname.slice(4) : `www.${u.hostname}`;
  return u.toString();
}

/** .com.br ↔ .com — só para SUGERIR; trocar sozinho poderia ler outra empresa. */
function swapBrTld(url: string): string | null {
  const u = new URL(url);
  if (u.hostname.endsWith('.com.br')) u.hostname = u.hostname.slice(0, -3);
  else if (u.hostname.endsWith('.com')) u.hostname = `${u.hostname}.br`;
  else return null;
  return u.toString();
}

/** O servidor responde? Qualquer status serve (403 de anti-robô ainda é um site no ar). */
async function reachable(url: string): Promise<void> {
  const { response: res } = await safeFetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ContentEngine/1.0; +brand-autopilot)' },
    timeoutMs: SITE_PROBE_TIMEOUT_MS,
  });
  await res.body?.cancel();
}

const SITE_PROBE_TIMEOUT_MS = 8_000;

/**
 * Confere o site antes de a leitura começar, para o erro aparecer no passo 1 e
 * não no fim do fluxo. Tenta a variação com/sem www (mesmo domínio) e usa a que
 * abrir. Se nenhuma abrir e o .com/.com.br trocado abrir, sugere esse endereço.
 */
export async function probeSite(
  url: string,
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  let firstError: unknown = null;
  for (const candidate of [url, toggleWww(url)]) {
    try {
      await reachable(candidate);
      return { ok: true, url: candidate };
    } catch (err) {
      firstError ??= err;
    }
  }
  let message = describeSiteError(firstError, url);
  const alternative = swapBrTld(url);
  if (alternative) {
    try {
      await reachable(alternative);
      message += ` Você quis dizer ${siteHost(alternative)}?`;
    } catch {
      // sem sugestão
    }
  }
  return { ok: false, message };
}

async function fetchHtml(url: string): Promise<string> {
  const { response: res } = await safeFetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ContentEngine/1.0; +brand-autopilot)',
      Accept: 'text/html,application/xhtml+xml',
    },
    timeoutMs: PAGE_FETCH_TIMEOUT_MS,
  });
  if (!res.ok) throw new Error(`O site respondeu ${res.status}.`);
  const type = res.headers.get('content-type') ?? '';
  if (type && !/html|xml|text\/plain/i.test(type)) {
    throw new Error('A página não é HTML.');
  }
  const html = await res.text();
  return html.slice(0, MAX_HTML_CHARS);
}

export interface CrawlResult {
  pages: CrawledPage[];
  hints: SiteHints;
  /** 'firecrawl' quando a key existia e respondeu; 'fetch' no caminho simples. */
  reader: 'firecrawl' | 'fetch';
}

/**
 * Lê a home + até 10 páginas internas relevantes. Com key do Firecrawl usa
 * /v1/map para descobrir páginas e /v1/scrape para ler; sem key, segue os
 * links da home com fetch simples e limpeza de HTML. As pistas visuais saem
 * sempre do HTML da home.
 */
export async function crawlSite(siteUrl: string): Promise<CrawlResult> {
  const useFirecrawl = await firecrawlAvailable();

  // 1) Home — sempre com HTML bruto (cores/fontes/logo + links).
  let homeHtml = '';
  let homeText = '';
  let homeTitle = siteUrl;
  let reader: CrawlResult['reader'] = 'fetch';

  if (useFirecrawl) {
    try {
      const page = await firecrawlScrape(siteUrl, { html: true });
      homeHtml = page.html ?? '';
      homeText = page.markdown;
      homeTitle = page.title;
      reader = 'firecrawl';
    } catch (err) {
      console.warn('[brand-autopilot] firecrawl falhou na home, usando fetch:', err);
    }
  }
  if (!homeText) {
    homeHtml = await fetchHtml(siteUrl);
    homeText = htmlToText(homeHtml);
    homeTitle = extractTitle(homeHtml, siteUrl);
    reader = 'fetch';
  }
  if (!homeHtml) {
    // Firecrawl sem rawHtml: busca o HTML só para as pistas visuais/links.
    try {
      homeHtml = await fetchHtml(siteUrl);
    } catch {
      homeHtml = '';
    }
  }
  const hints = extractVisualHints(homeHtml, siteUrl);

  // 2) Descoberta de páginas internas.
  let candidates: string[] = extractLinks(homeHtml);
  if (reader === 'firecrawl') {
    try {
      candidates = [...(await firecrawlMap(siteUrl)), ...candidates];
    } catch (err) {
      console.warn('[brand-autopilot] firecrawl map falhou, usando links da home:', err);
    }
  }
  const internal = pickInternalPages(siteUrl, candidates);

  // 3) Leitura das internas em paralelo (falha de uma não derruba as outras).
  const settled = await Promise.allSettled(
    internal.map(async (url): Promise<CrawledPage> => {
      if (reader === 'firecrawl') {
        try {
          const page = await firecrawlScrape(url);
          return { url: page.url, title: page.title, text: page.markdown };
        } catch {
          // cai no fetch simples da mesma página
        }
      }
      const html = await fetchHtml(url);
      return { url, title: extractTitle(html, url), text: htmlToText(html) };
    }),
  );

  const pages: CrawledPage[] = [
    { url: siteUrl, title: homeTitle, text: homeText.slice(0, MAX_PAGE_TEXT_CHARS * 2) },
  ];
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    const page = result.value;
    if (page.text.trim().length < MIN_PAGE_TEXT_CHARS) continue;
    pages.push({ ...page, text: page.text.slice(0, MAX_PAGE_TEXT_CHARS * 2) });
  }
  return { pages, hints, reader };
}

// ── Prompt e schema do perfil (uma chamada de IA) ────────────────────────────

const SECTION_IDS: readonly ReviewSectionId[] = [
  'quem_somos',
  'publico',
  'voz',
  'posicionamento',
  'regras',
  'visual',
  'canais',
] as const;

const stringArray = { type: 'array', items: { type: 'string' } } as const;

/** Saída estrita: tudo o que as telas de Marca gravam, numa resposta só. */
export const BRAND_PROFILE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['brand', 'persona', 'strategy', 'guardrails', 'brand_kit', 'channels', 'sections'],
  properties: {
    brand: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'niche', 'description'],
      properties: {
        name: { type: 'string', description: 'Nome da marca como aparece no site' },
        niche: { type: 'string', description: 'Nicho/setor em 2-5 palavras' },
        description: { type: 'string', description: 'O que a marca faz, em 1-2 frases' },
      },
    },
    persona: VOICE_EXTRACTOR_SCHEMA,
    strategy: {
      type: 'object',
      additionalProperties: false,
      required: ['brand_promise', 'theses', 'enemy', 'safe_list', 'icp', 'editorial_stance', 'cta_repertoire'],
      properties: {
        brand_promise: { type: 'string' },
        theses: { ...stringArray, description: '3 a 5 teses que a marca defende' },
        enemy: { type: 'string', description: 'O status quo que a marca combate, em 1 frase' },
        safe_list: { ...stringArray, description: 'Territórios de assunto seguros' },
        icp: {
          type: 'object',
          additionalProperties: false,
          required: ['perfil', 'desejos'],
          properties: { perfil: { type: 'string' }, desejos: stringArray },
        },
        editorial_stance: { type: 'string' },
        cta_repertoire: { ...stringArray, description: 'CTAs que a marca usa (subconjunto dos permitidos)' },
      },
    },
    guardrails: {
      type: 'object',
      additionalProperties: false,
      required: ['banned_words', 'banned_punctuation', 'banned_metaphors', 'banned_ctas', 'allowed_ctas'],
      properties: {
        banned_words: { ...stringArray, description: 'Palavras/clichês que a marca nunca usa (5-12)' },
        banned_punctuation: { ...stringArray, description: 'Ex.: "!!", "..."' },
        banned_metaphors: stringArray,
        banned_ctas: stringArray,
        allowed_ctas: { ...stringArray, description: '3-6 CTAs permitidos' },
      },
    },
    brand_kit: {
      type: 'object',
      additionalProperties: false,
      required: ['palette', 'typography', 'negative_constraints'],
      properties: {
        palette: {
          type: 'array',
          description: 'Cores nomeadas (primary, secondary, accent, background, text) em #RRGGBB',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'hex'],
            properties: { name: { type: 'string' }, hex: { type: 'string' } },
          },
        },
        typography: {
          type: 'object',
          additionalProperties: false,
          required: ['heading', 'body'],
          properties: { heading: { type: 'string' }, body: { type: 'string' } },
        },
        negative_constraints: { ...stringArray, description: 'O que a marca nunca faz no visual' },
      },
    },
    channels: {
      type: 'array',
      description: 'Canais recomendados para esta marca (2 a 4)',
      items: { type: 'string', enum: [...CHANNEL_TYPES] },
    },
    sections: {
      type: 'array',
      description: 'Confiança e fonte de cada bloco da revisão — um item por id, todos os ids',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'confidence', 'source'],
        properties: {
          id: { type: 'string', enum: [...SECTION_IDS] },
          confidence: { type: 'number', description: '0 a 1: quanto o material sustenta este bloco' },
          source: { type: 'string', description: 'Página ou trecho de onde saiu (URL curta ou "legendas")' },
        },
      },
    },
  },
};

export interface ProfilePromptInput {
  site: string;
  instagram: string | null;
  pages: CrawledPage[];
  captions: string[];
  hints: SiteHints;
}

const MAX_PROMPT_CHARS = 60_000;

export function brandProfilePrompt(input: ProfilePromptInput): { system: string; user: string } {
  const system = [
    'Você monta a primeira versão completa da MARCA de um criador de conteúdo a partir do site e do ' +
      'Instagram dele. O resultado alimenta um motor que escreve posts nessa voz; depois o dono revisa ' +
      'cada parte. Seja específico e citável, nunca genérico.',
    '',
    'O QUE DEVOLVER (JSON estrito do schema):',
    '- brand: nome, nicho, descrição curta.',
    '- persona: o contrato de voz em 9 seções (identity, credenciais COM fonte, worldview, tone_principles, ' +
      'signature_lexicon com dosagem, calibration_heuristics, banlist = {"ref":"guardrails"}, opinioes, ' +
      'voice_checklist, reference_examples com trechos REAIS do material).',
    '- strategy: promessa, teses, inimigo narrativo, territórios seguros, cliente ideal, postura editorial, CTAs.',
    '- guardrails: o que a marca NUNCA escreve. Sugira pelo setor, sem exagero (5-12 palavras banidas, ' +
      'poucos CTAs proibidos, 3-6 permitidos). Nada que impeça escrever sobre o próprio negócio.',
    '- brand_kit: paleta em hex (use as cores declaradas no site quando fizerem sentido; complete com ' +
      'contraste suficiente para texto), fontes (as declaradas no site ou famílias reais equivalentes) e ' +
      'restrições visuais.',
    '- channels: 2 a 4 canais onde essa marca deve publicar primeiro, pelo tipo de negócio e material.',
    '- sections: para cada bloco (quem_somos, publico, voz, posicionamento, regras, visual, canais) uma ' +
      'confiança 0-1 honesta e a fonte (URL curta ou "legendas"). Material fraco = confiança baixa.',
    '',
    'REGRAS:',
    '- Tudo sai do material. Credencial sem fonte não entra. Não invente números.',
    '- Escreva em pt-BR, direto, sem clichês de marketing.',
    '- Responda APENAS o JSON.',
  ].join('\n');

  const parts: string[] = [
    input.site ? `SITE: ${input.site}` : 'SITE: a marca não tem site; leia tudo pelas legendas do Instagram.',
  ];
  if (input.instagram) parts.push(`INSTAGRAM: @${input.instagram}`);
  if (input.hints.colors.length > 0) parts.push(`CORES DECLARADAS NO HTML: ${input.hints.colors.join(', ')}`);
  if (input.hints.fonts.length > 0) parts.push(`FONTES DECLARADAS NO HTML: ${input.hints.fonts.join(', ')}`);
  if (input.hints.logo_url) parts.push(`LOGO (URL): ${input.hints.logo_url}`);

  let budget = MAX_PROMPT_CHARS;
  const perPage = Math.min(MAX_PAGE_TEXT_CHARS, Math.floor(budget / Math.max(1, input.pages.length + 1)));
  for (const page of input.pages) {
    const text = page.text.slice(0, perPage);
    budget -= text.length;
    if (budget < 0) break;
    parts.push(`\n### PÁGINA: ${page.title}\nURL: ${page.url}\n${text}`);
  }
  if (input.captions.length > 0) {
    const captions = input.captions
      .slice(0, 20)
      .map((c, i) => `[${i + 1}] ${c.slice(0, 700)}`)
      .join('\n\n');
    parts.push(`\n### LEGENDAS DO INSTAGRAM (${input.captions.length})\n${captions}`);
  }
  return { system, user: parts.join('\n') };
}

/** Prompt do ajuste único de voz quando o teste de tom reprova. */
export function voiceAdjustPrompt(
  persona: unknown,
  diagnosis: string[],
): { system: string; user: string } {
  return {
    system:
      'Você ajusta o contrato de voz (9 seções) de uma marca depois que peças de teste ficaram abaixo ' +
      'da nota. Mantenha a identidade e as credenciais; mude só o que o diagnóstico pede: princípios de ' +
      'tom mais concretos, heurísticas de calibração que respondam a cada problema apontado, checklist ' +
      'mais exigente e exemplos melhores. Nada de inventar fatos. Responda APENAS o JSON do schema.',
    user:
      `CONTRATO DE VOZ ATUAL:\n${JSON.stringify(persona).slice(0, 14_000)}\n\n` +
      `DIAGNÓSTICO DO TESTE DE TOM:\n- ${diagnosis.slice(0, 20).join('\n- ')}`,
  };
}
