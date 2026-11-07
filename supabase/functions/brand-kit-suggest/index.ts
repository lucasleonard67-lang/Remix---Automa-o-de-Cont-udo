// brand-kit-suggest — rascunho de identidade visual a partir de UMA origem.
//
// Deploy config: verify_jwt = true
//
// POST { source, ... } → 200 { draft, origem, hints }
//   source: 'site'   { url }
//           'file'   { files: [{ name, content }] }   — tokens (.json W3C ou simples,
//                    .css com --vars), guia em .md/.txt, logo .svg (texto p/ cores);
//                    o logo em imagem vai direto ao bucket pelo cliente.
//           'repo'   { url }  — GitHub público (raw) ou o site do design system
//                    (llms.txt, README.md, tokens.css/json, tailwind.config.*, DESIGN.md)
//           'ai'     { description?, use_context?, provider?: { driver, model } }
//           'nicho' | 'acervo'  (compatibilidade)
//
// Esta função só PROPÕE. Nada é ativado sem o usuário revisar e confirmar — o
// brand kit continua versionado como qualquer outro conteúdo de marca.
//
// Quando a origem traz tokens legíveis em código (JSON/CSS), eles entram no
// prompt como "verdade" e, se a IA falhar (sem créditos, sem chave), o rascunho
// sai só do que foi lido — pior cego do que ler cores e fontes do arquivo e
// devolver erro.

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';
import { chat, DRIVER_NAMES, type DriverName } from '../_shared/llm.ts';
import { extractVisualHints, htmlToText } from '../_shared/brand-autopilot.ts';
import { selecionarArquivos } from '../_shared/brand-source-files.ts';
import { BlockedUrlError, safeFetch } from '../_shared/link-reader.ts';
import {
  CASES,
  DENSITIES,
  EDGES,
  FRAMES,
  LAYOUTS,
  PHOTO_GRADES,
  PHOTO_SLOTS,
  SHADOWS,
  SURFACES,
  TEXTURES,
  WORDPLAYS,
  artVocabularyMenu,
  normalizeArt,
} from '../_shared/carousel-art.ts';
// deploy: origens file/repo/ai + override de provedor (chat({provider}))

const MAX_HTML_CHARS = 60_000;
const MAX_FILE_CHARS = 40_000;
const MAX_TOTAL_CHARS = 90_000;
const FETCH_TIMEOUT_MS = 12_000;
const UA = 'ContentEngine/1.0 (+brand-kit-suggest)';

interface BrandKitDraft {
  palette: Record<string, string>;
  typography: { heading: string; body: string };
  negative_constraints: string[];
  rationale: string;
  /** Vocabulário de ARTE da marca — a FORMA que a paleta e o tipo vão vestir. */
  art: Record<string, unknown>;
  /** Como aplicar em post, carrossel e reel — só para a revisão, não é salvo. */
  examples?: Array<{ channel: string; how: string }>;
}

const SCHEMA = {
  type: 'object',
  properties: {
    palette: {
      type: 'object',
      description:
        'Cores nomeadas em hex. Use nomes de papel: background (fundo), text (texto), ' +
        'primary (destaque), accent (apoio), muted (neutro). Pode acrescentar outras.',
      additionalProperties: { type: 'string' },
    },
    typography: {
      type: 'object',
      properties: {
        heading: {
          type: 'string',
          description: 'Família tipográfica dos títulos (nome exato no Google Fonts)',
        },
        body: {
          type: 'string',
          description: 'Família tipográfica do texto corrido (nome exato no Google Fonts)',
        },
      },
      required: ['heading', 'body'],
    },
    negative_constraints: {
      type: 'array',
      items: { type: 'string' },
      description: 'O que a marca NUNCA usa no visual (cores, clichês, elementos).',
    },
    rationale: {
      type: 'string',
      description: 'Duas ou três frases explicando as escolhas, na voz de um diretor de arte.',
    },
    examples: {
      type: 'array',
      description:
        'Três exemplos curtos de como aplicar a identidade: um post, um carrossel e um reel.',
      items: {
        type: 'object',
        properties: {
          channel: { type: 'string', enum: ['post', 'carrossel', 'reel'] },
          how: { type: 'string', description: 'Uma ou duas frases concretas.' },
        },
        required: ['channel', 'how'],
      },
    },
    art: {
      type: 'object',
      description:
        'Como a marca se comporta na arte do carrossel. Não é um tema pronto: são eixos ' +
        'independentes que a paleta e a tipografia acima vão preencher.',
      properties: {
        layout: { type: 'string', enum: LAYOUTS },
        frame: { type: 'string', enum: FRAMES },
        texture: { type: 'string', enum: TEXTURES },
        wordplay: { type: 'string', enum: WORDPLAYS },
        shadow: { type: 'string', enum: SHADOWS },
        photo_slot: { type: 'string', enum: PHOTO_SLOTS },
        photo_grade: { type: 'string', enum: PHOTO_GRADES },
        title_case: { type: 'string', enum: CASES },
        edge: { type: 'string', enum: EDGES },
        density: { type: 'string', enum: DENSITIES },
        surface: { type: 'string', enum: SURFACES },
        title_scale: { type: 'number' },
      },
      required: [
        'layout',
        'frame',
        'texture',
        'wordplay',
        'shadow',
        'photo_slot',
        'photo_grade',
        'title_case',
        'edge',
        'density',
        'surface',
        'title_scale',
      ],
    },
  },
  required: ['palette', 'typography', 'negative_constraints', 'rationale', 'examples', 'art'],
} as const;

const SISTEMA =
  'Você é diretor de arte montando o design system de uma marca. Devolva cores em HEX ' +
  'válido (#RRGGBB), com contraste suficiente para texto sobre superfície (mínimo 4.5:1 ' +
  'para corpo). Nomeie as cores pelo PAPEL (background, text, primary, accent, muted). ' +
  'Tipografia: nomeie famílias reais do Google Fonts, com o nome exato. As restrições ' +
  'negativas devem ser específicas da marca, não genéricas. Dê também três exemplos de ' +
  'aplicação (post, carrossel, reel) em uma ou duas frases cada.\n\n' +
  'Monte também o VOCABULÁRIO DE ARTE do carrossel: como a marca se comporta na peça. ' +
  'Não é escolher um tema pronto — cada eixo abaixo é independente, e a paleta e a ' +
  'tipografia que você acabou de definir é que vão preenchê-lo. Combine os eixos de forma ' +
  'COERENTE (grade suíça pede caixa alta e cantos retos; eixo central pede respiro arejado ' +
  'e moldura de fios) e no território da marca, não pelo que é bonito solto. Se a marca é ' +
  'gráfica a ponto de a foto atrapalhar, use photo_slot "none". Raios de canto viram o eixo ' +
  '"edge", densidade vira "density", estilo de foto vira "photo_grade".\n\n' +
  'LAYOUT FIXO: use sempre layout "editorial" (reportagem: manchete, texto corrido, foto 16:9 ' +
  'e gráfico com margem larga) com frame "none", texture "none", wordplay "none" e shadow ' +
  '"none". A personalidade da marca entra pela paleta, pela tipografia e pela foto.\n\n' +
  artVocabularyMenu();

// ── Tokens legíveis em código (JSON W3C, JSON simples, CSS --vars) ───────────

interface TokenHints {
  /** nome → hex */
  colors: Record<string, string>;
  fonts: string[];
  radii: string[];
  spacing: string[];
}

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function emptyHints(): TokenHints {
  return { colors: {}, fonts: [], radii: [], spacing: [] };
}

function normalizeHex(raw: string): string | null {
  const value = raw.trim();
  if (!HEX_RE.test(value)) return null;
  const hex = value.toLowerCase();
  return hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
}

function pushUnique(list: string[], value: string, max = 8): void {
  const v = value.trim();
  if (v && !list.includes(v) && list.length < max) list.push(v);
}

/** Primeira família de uma pilha CSS ("Inter", sans-serif → Inter). */
function firstFamily(stack: string): string {
  return stack.split(',')[0]?.replace(/["']/g, '').trim() ?? '';
}

function mergeHints(into: TokenHints, from: TokenHints): TokenHints {
  for (const [k, v] of Object.entries(from.colors)) {
    if (Object.keys(into.colors).length < 12 && !(k in into.colors)) into.colors[k] = v;
  }
  for (const f of from.fonts) pushUnique(into.fonts, f, 6);
  for (const r of from.radii) pushUnique(into.radii, r, 6);
  for (const s of from.spacing) pushUnique(into.spacing, s, 8);
  return into;
}

/** Percorre um JSON de tokens (W3C `$value`/`$type` ou simples `{colors, fonts}`). */
function hintsFromJson(raw: unknown): TokenHints {
  const hints = emptyHints();
  const walk = (node: unknown, path: string[]): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, [...path, String(i)]));
      return;
    }
    const rec = node as Record<string, unknown>;
    const name = path.filter((p) => !/^\d+$/.test(p)).join('.') || 'token';
    const joined = name.toLowerCase();

    // W3C Design Tokens: folha com $value
    if ('$value' in rec) {
      const type = typeof rec.$type === 'string' ? rec.$type.toLowerCase() : '';
      const value = rec.$value;
      if (typeof value === 'string') {
        const hex = normalizeHex(value);
        if (hex && (type === 'color' || !type || joined.includes('color'))) {
          hints.colors[name] = hex;
        } else if (type === 'fontfamily' || joined.includes('font')) {
          pushUnique(hints.fonts, firstFamily(value), 6);
        } else if (type === 'dimension' || /px|rem|em$/.test(value)) {
          if (joined.includes('radius')) pushUnique(hints.radii, `${name}: ${value}`, 6);
          else if (/spac|gap/.test(joined)) pushUnique(hints.spacing, `${name}: ${value}`, 8);
        }
      } else if (Array.isArray(value) && (type === 'fontfamily' || joined.includes('font'))) {
        const first = value.find((v) => typeof v === 'string');
        if (typeof first === 'string') pushUnique(hints.fonts, first, 6);
      }
      return;
    }

    for (const [key, value] of Object.entries(rec)) {
      if (key.startsWith('$')) continue;
      const childPath = [...path, key];
      const childName = childPath.join('.').toLowerCase();
      if (typeof value === 'string') {
        const hex = normalizeHex(value);
        if (hex) {
          hints.colors[childPath.join('.')] = hex;
        } else if (/font|typograph|heading|body|display/.test(childName) && /[a-z]/i.test(value)) {
          pushUnique(hints.fonts, firstFamily(value), 6);
        } else if (/radius/.test(childName)) {
          pushUnique(hints.radii, `${childPath.join('.')}: ${value}`, 6);
        } else if (/spac|gap/.test(childName)) {
          pushUnique(hints.spacing, `${childPath.join('.')}: ${value}`, 8);
        }
      } else if (typeof value === 'number' && /radius|spac|gap/.test(childName)) {
        const bucket = /radius/.test(childName) ? hints.radii : hints.spacing;
        pushUnique(bucket, `${childPath.join('.')}: ${value}px`, 8);
      } else {
        walk(value, childPath);
      }
    }
  };
  walk(raw, []);
  return hints;
}

/** `--nome: valor;` de um CSS (tokens.css, globals.css, tailwind em CSS). */
function hintsFromCss(css: string): TokenHints {
  const hints = emptyHints();
  const varRe = /--([\w-]+)\s*:\s*([^;{}]+);/g;
  for (const match of css.matchAll(varRe)) {
    const name = match[1];
    const value = match[2].trim();
    const lower = name.toLowerCase();
    const hex = normalizeHex(value);
    if (hex) {
      if (Object.keys(hints.colors).length < 12) hints.colors[name] = hex;
    } else if (/font/.test(lower) && /[a-z]/i.test(value) && !value.startsWith('var(')) {
      pushUnique(hints.fonts, firstFamily(value), 6);
    } else if (/radius/.test(lower)) {
      pushUnique(hints.radii, `${name}: ${value}`, 6);
    } else if (/spac|gap/.test(lower) && /\d/.test(value)) {
      pushUnique(hints.spacing, `${name}: ${value}`, 8);
    }
  }
  // font-family e links do Google Fonts: mesmo leitor do HTML do site.
  const visual = extractVisualHints(css, 'https://localhost/');
  for (const f of visual.fonts) pushUnique(hints.fonts, f, 6);
  return hints;
}

/** Texto livre (guia de marca, llms.txt, README): só o que é inequívoco. */
function hintsFromText(text: string): TokenHints {
  const hints = emptyHints();
  const visual = extractVisualHints(text, 'https://localhost/');
  visual.colors.forEach((hex, i) => {
    hints.colors[`cor_${i + 1}`] = hex;
  });
  for (const f of visual.fonts) pushUnique(hints.fonts, f, 6);
  return hints;
}

function hintsForFile(name: string, content: string): TokenHints {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'json') {
    try {
      return hintsFromJson(JSON.parse(content));
    } catch {
      return hintsFromText(content);
    }
  }
  if (ext === 'css' || ext === 'scss') return hintsFromCss(content);
  if (ext === 'js' || ext === 'ts' || ext === 'cjs' || ext === 'mjs') {
    // tailwind.config.*: cores em hex e fontFamily como texto
    return mergeHints(hintsFromCss(content), hintsFromText(content));
  }
  if (ext === 'svg' || ext === 'html' || ext === 'htm') {
    const visual = extractVisualHints(content, 'https://localhost/');
    const hints = emptyHints();
    visual.colors.forEach((hex, i) => {
      hints.colors[`${ext === 'svg' ? 'logo' : 'cor'}_${i + 1}`] = hex;
    });
    for (const f of visual.fonts) pushUnique(hints.fonts, f, 6);
    return hints;
  }
  return hintsFromText(content);
}

function hintsEmpty(h: TokenHints): boolean {
  return Object.keys(h.colors).length === 0 && h.fonts.length === 0;
}

function hintsToPrompt(h: TokenHints): string {
  if (hintsEmpty(h) && h.radii.length === 0) return '';
  const linhas: string[] = ['TOKENS LIDOS DIRETO DA ORIGEM (use como verdade; só complete o que faltar):'];
  const cores = Object.entries(h.colors);
  if (cores.length) linhas.push(`cores: ${cores.map(([n, v]) => `${n}=${v}`).join(', ')}`);
  if (h.fonts.length) linhas.push(`fontes: ${h.fonts.join(', ')}`);
  if (h.radii.length) linhas.push(`raios: ${h.radii.join(', ')}`);
  if (h.spacing.length) linhas.push(`espaçamentos: ${h.spacing.join(', ')}`);
  return linhas.join('\n');
}

/** Rascunho sem IA, só do que foi lido — para quando a IA não responde. */
function draftFromHints(h: TokenHints, origem: string): BrandKitDraft | null {
  const cores = Object.entries(h.colors);
  if (cores.length < 2) return null;
  const palette: Record<string, string> = {};
  for (const [name, hex] of cores.slice(0, 8)) {
    const key = name.replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'cor';
    let unique = key;
    let i = 2;
    while (unique in palette) unique = `${key}_${i++}`;
    palette[unique] = hex;
  }
  return {
    palette,
    typography: { heading: h.fonts[0] ?? '', body: h.fonts[1] ?? h.fonts[0] ?? '' },
    negative_constraints: [],
    rationale: `Montado direto do que foi lido em ${origem}, sem IA: a IA não respondeu. Revise os papéis das cores.`,
    art: normalizeArt({}) as unknown as Record<string, unknown>,
  };
}

// ── Origens ──────────────────────────────────────────────────────────────────

/** Contexto de marca já coletado no onboarding — persona e bandeira. */
async function contextoDaMarca(service: ReturnType<typeof createServiceClient>): Promise<string> {
  const partes: string[] = [];
  for (const tabela of ['brand_persona', 'brand_strategy'] as const) {
    const { data } = await service
      .from(tabela)
      .select('content')
      .eq('status', 'active')
      .maybeSingle();
    if (data?.content) partes.push(`${tabela}: ${JSON.stringify(data.content).slice(0, 1500)}`);
  }
  return partes.join('\n\n') || 'Sem persona nem bandeira cadastradas ainda.';
}

/** Material da marca que o usuário já subiu no Contexto. */
async function materialDoAcervo(service: ReturnType<typeof createServiceClient>): Promise<string> {
  const { data } = await service
    .from('context_items')
    .select('title, body')
    .eq('status', 'ready')
    .limit(6);
  const itens = (data ?? []) as Array<{ title: string; body: string | null }>;
  if (itens.length === 0) return '';
  return itens
    .map((i) => `— ${i.title}\n${(i.body ?? '').slice(0, 700)}`)
    .join('\n\n')
    .slice(0, 6000);
}

function parseUrl(url: string): URL {
  let alvo: URL;
  try {
    alvo = new URL(url.trim());
  } catch {
    throw new Error('Endereço inválido. Cole a URL completa, com https://.');
  }
  if (alvo.protocol !== 'https:') {
    throw new Error('O endereço precisa começar com https://.');
  }
  return alvo;
}

const NAO_PUBLICO = 'Esse endereço não é de um site público. Use o endereço aberto, com https://.';

/** GET de texto com timeout; null em 404/erro de rede (as origens são opcionais). */
async function fetchText(
  url: string,
  accept = 'text/plain, text/markdown, text/css, application/json, text/html;q=0.8, */*;q=0.5',
): Promise<{ text: string; type: string } | null> {
  try {
    const { response: res } = await safeFetch(url, {
      headers: { 'User-Agent': UA, Accept: accept },
      timeoutMs: FETCH_TIMEOUT_MS,
      httpsOnly: true,
    });
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    const type = res.headers.get('content-type') ?? '';
    if (/image|video|audio|octet-stream|pdf|zip/i.test(type)) {
      await res.body?.cancel();
      return null;
    }
    return { text: (await res.text()).slice(0, MAX_FILE_CHARS), type };
  } catch {
    return null;
  }
}

/** Busca o HTML do site para o modelo ler cores e fontes declaradas. */
async function htmlDoSite(url: string): Promise<string> {
  const alvo = parseUrl(url);
  let res: Response;
  try {
    ({ response: res } = await safeFetch(alvo.toString(), {
      headers: { 'User-Agent': UA },
      timeoutMs: 15_000,
      httpsOnly: true,
    }));
  } catch (err) {
    throw err instanceof BlockedUrlError ? new Error(NAO_PUBLICO) : err;
  }
  if (!res.ok) throw new Error(`O site respondeu ${res.status}.`);
  const html = await res.text();
  return html.slice(0, MAX_HTML_CHARS);
}

interface Material {
  arquivos: Array<{ name: string; content: string }>;
}

/** Candidatos de um repositório, em ordem de prioridade (o primeiro que existe pesa mais). */
const REPO_CANDIDATES = [
  'llms.txt',
  'README.md',
  'tokens.css',
  'tokens.json',
  'design-tokens.json',
  'tailwind.config.ts',
  'tailwind.config.js',
  'tailwind.config.cjs',
  'tailwind.config.mjs',
  'DESIGN.md',
  'src/design-system/tokens.css',
  'src/tokens.css',
  'src/index.css',
  'src/app/globals.css',
  'app/globals.css',
  'styles/globals.css',
  'src/styles/globals.css',
];

type RepoInfo = { branch: string | null; erro: 'nao_encontrado' | 'indisponivel' | null };

/** Ramo padrão do repositório; `nao_encontrado` cobre privado e inexistente (o GitHub não distingue). */
async function githubRepoInfo(owner: string, repo: string): Promise<RepoInfo> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 404) {
      await res.body?.cancel();
      return { branch: null, erro: 'nao_encontrado' };
    }
    if (!res.ok) {
      await res.body?.cancel();
      return { branch: null, erro: 'indisponivel' };
    }
    const data = (await res.json()) as { default_branch?: string };
    return { branch: data.default_branch ?? null, erro: null };
  } catch {
    return { branch: null, erro: 'indisponivel' };
  }
}

/** Todos os caminhos do ramo (uma chamada); null quando a API não responde (limite de taxa). */
async function githubTree(owner: string, repo: string, branch: string): Promise<string[] | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      { headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    const data = (await res.json()) as { tree?: Array<{ path?: string; type?: string }> };
    return (data.tree ?? []).filter((n) => n.type === 'blob' && typeof n.path === 'string').map((n) => n.path as string);
  } catch {
    return null;
  }
}

/** Lê um repositório público do GitHub (raw) ou o site de um design system. */
async function materialDoRepositorio(url: string): Promise<{ material: Material; origem: string }> {
  const alvo = parseUrl(url);
  const host = alvo.hostname.toLowerCase();

  if (host === 'github.com' || host === 'www.github.com') {
    const partes = alvo.pathname.split('/').filter(Boolean);
    const [owner, repoRaw] = partes;
    if (!owner || !repoRaw) {
      throw new Error('Cole o endereço do repositório: https://github.com/<dono>/<repo>.');
    }
    const repo = repoRaw.replace(/\.git$/, '');
    let branch: string | null = null;
    let base = '';
    let arquivoDireto: string | null = null;
    if (partes[2] === 'tree' && partes[3]) {
      branch = partes[3];
      base = partes.slice(4).join('/');
    } else if (partes[2] === 'blob' && partes[3]) {
      branch = partes[3];
      arquivoDireto = partes.slice(4).join('/');
    }
    const info = await githubRepoInfo(owner, repo);
    if (info.erro === 'nao_encontrado') {
      throw new Error(
        `Não encontrei o repositório público ${owner}/${repo} no GitHub. Se ele for privado, ` +
          'baixe o ZIP (Code → Download ZIP) e envie em “De um arquivo”.',
      );
    }
    const ramos = branch ? [branch] : [info.branch ?? 'main', 'master'];

    for (const ramo of [...new Set(ramos)]) {
      const raw = (path: string) =>
        `https://raw.githubusercontent.com/${owner}/${repo}/${ramo}/${path}`;
      // Com a listagem do ramo, lê o que existe de fato (tokens em qualquer
      // pasta, preset do tailwind, docs de design). Sem ela, a lista fixa.
      const arvore = arquivoDireto ? null : await githubTree(owner, repo, ramo);
      const caminhos = arquivoDireto
        ? [arquivoDireto]
        : arvore
          ? selecionarArquivos(arvore, { base })
          : REPO_CANDIDATES.map((c) => (base ? `${base}/${c}` : c));
      if (caminhos.length === 0) continue;
      const lidos = await Promise.all(
        caminhos.map(async (path) => {
          const r = await fetchText(raw(path));
          return r ? { name: path, content: r.text } : null;
        }),
      );
      const arquivos = lidos.filter((a): a is { name: string; content: string } => a !== null);
      if (arquivos.length > 0) {
        return { material: { arquivos: limitarTotal(arquivos) }, origem: `repositório ${owner}/${repo}` };
      }
    }
    throw new Error(
      'Não achei tokens, tailwind, README nem documentação de design nesse repositório. ' +
        'Confira o endereço ou envie os arquivos em “De um arquivo”.',
    );
  }

  // Site do design system (ou arquivo cru em qualquer host): lê o endereço e,
  // se for uma página, também o llms.txt da raiz.
  const direto = await fetchText(alvo.toString());
  if (!direto) throw new Error('O endereço não respondeu com texto legível. Confira se está público.');
  const arquivos: Array<{ name: string; content: string }> = [];
  const ehHtml = /html/i.test(direto.type) || /^\s*<!doctype html|^\s*<html/i.test(direto.text);
  if (ehHtml) {
    const visual = extractVisualHints(direto.text, alvo.toString());
    const resumo =
      `cores no HTML: ${visual.colors.join(', ') || '—'}\nfontes no HTML: ${visual.fonts.join(', ') || '—'}\n\n` +
      htmlToText(direto.text).slice(0, 12_000);
    arquivos.push({ name: `${alvo.hostname}${alvo.pathname} (página)`, content: resumo });
    if (!/llms\.txt$/i.test(alvo.pathname)) {
      const llms = await fetchText(`${alvo.origin}/llms.txt`);
      if (llms && !/html/i.test(llms.type)) arquivos.unshift({ name: 'llms.txt', content: llms.text });
    }
  } else {
    const nome = alvo.pathname.split('/').filter(Boolean).pop() ?? 'arquivo.txt';
    arquivos.push({ name: nome, content: direto.text });
  }
  return { material: { arquivos: limitarTotal(arquivos) }, origem: `endereço ${alvo.hostname}` };
}

function limitarTotal(arquivos: Array<{ name: string; content: string }>) {
  let restante = MAX_TOTAL_CHARS;
  const out: Array<{ name: string; content: string }> = [];
  for (const a of arquivos) {
    if (restante <= 0) break;
    const content = a.content.slice(0, Math.min(MAX_FILE_CHARS, restante));
    restante -= content.length;
    out.push({ name: a.name, content });
  }
  return out;
}

/** Tokens + texto de um conjunto de arquivos (upload ou repositório). */
function montarEntradaDeArquivos(material: Material, instrucao: string): { entrada: string; hints: TokenHints } {
  const hints = emptyHints();
  for (const a of material.arquivos) mergeHints(hints, hintsForFile(a.name, a.content));
  const blocos = material.arquivos.map((a) => `=== ${a.name} ===\n${a.content}`).join('\n\n');
  const entrada = [instrucao, hintsToPrompt(hints), blocos].filter(Boolean).join('\n\n');
  return { entrada, hints };
}

function lerArquivosDoBody(body: Record<string, unknown>): Material {
  const files = Array.isArray(body.files) ? body.files : [];
  const arquivos = files
    .map((f) => {
      const rec = f && typeof f === 'object' ? (f as Record<string, unknown>) : {};
      const name = typeof rec.name === 'string' ? rec.name.slice(0, 120) : '';
      const content = typeof rec.content === 'string' ? rec.content : '';
      return name && content.trim() ? { name, content } : null;
    })
    .filter((f): f is { name: string; content: string } => f !== null);
  if (arquivos.length === 0) {
    throw new Error('Nenhum arquivo legível. Envie tokens em .json ou .css, um guia em .md/.txt ou o logo em .svg.');
  }
  // Os que descrevem o design system primeiro (ZIP de repositório traz de tudo);
  // o resto segue na ordem enviada, até o teto de texto.
  const porNome = new Map(arquivos.map((a) => [a.name, a] as const));
  const primeiro = selecionarArquivos(arquivos.map((a) => a.name), { max: 16 }).map((n) => porNome.get(n)!);
  const resto = arquivos.filter((a) => !primeiro.includes(a));
  return { arquivos: limitarTotal([...primeiro, ...resto]) };
}

function lerProvedor(body: Record<string, unknown>): { driver: DriverName; model?: string } | undefined {
  const p = body.provider;
  if (!p || typeof p !== 'object') return undefined;
  const rec = p as Record<string, unknown>;
  if (typeof rec.driver !== 'string' || !(DRIVER_NAMES as readonly string[]).includes(rec.driver)) {
    return undefined;
  }
  return {
    driver: rec.driver as DriverName,
    ...(typeof rec.model === 'string' && rec.model.trim() ? { model: rec.model.trim() } : {}),
  };
}

// ── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return errorResponse(405, 'invalid_input', 'Use POST.');

  const service = createServiceClient();
  const user = await getUser(req);
  if (!user) return errorResponse(401, 'unauthorized', 'Sessão inválida ou ausente.');
  const { data: isAdmin } = await service.rpc('has_role', { _user_id: user.id, _role: 'admin' });
  if (!isAdmin) return errorResponse(403, 'forbidden', 'Apenas admin.');

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const source = body.source;

  try {
    let entrada: string;
    let origem: string;
    let hints: TokenHints = emptyHints();
    let provider: { driver: DriverName; model?: string } | undefined;

    if (source === 'site') {
      const url = String(body.url ?? '');
      const html = await htmlDoSite(url);
      const visual = extractVisualHints(html, url);
      visual.colors.forEach((hex, i) => {
        hints.colors[`site_${i + 1}`] = hex;
      });
      hints.fonts = visual.fonts.slice(0, 6);
      origem = `site ${url}`;
      entrada =
        'Extraia o design system do HTML/CSS abaixo — cores realmente usadas, famílias ' +
        `tipográficas declaradas e o que a marca evita.\n\n${hintsToPrompt(hints)}\n\n${html}`;
    } else if (source === 'file') {
      const material = lerArquivosDoBody(body);
      const montado = montarEntradaDeArquivos(
        material,
        'Monte o design system a partir dos arquivos da marca abaixo (tokens, guia, logo). ' +
          'Respeite as cores e fontes declaradas; complete só o que faltar.',
      );
      hints = montado.hints;
      // Só logo em imagem (nenhum token legível): a persona e a bandeira dão o chão.
      entrada = hintsEmpty(hints)
        ? `${montado.entrada}\n\nPERSONA E BANDEIRA:\n${await contextoDaMarca(service)}`
        : montado.entrada;
      origem =
        material.arquivos.length === 1
          ? `arquivo ${material.arquivos[0].name}`
          : `${material.arquivos.length} arquivos enviados`;
    } else if (source === 'repo') {
      const lido = await materialDoRepositorio(String(body.url ?? ''));
      const montado = montarEntradaDeArquivos(
        lido.material,
        'Monte o design system a partir do que foi lido no repositório abaixo (na ordem em que ' +
          'os arquivos aparecem, o primeiro pesa mais). Respeite as cores e fontes declaradas.',
      );
      entrada = montado.entrada;
      hints = montado.hints;
      origem = lido.origem;
    } else if (source === 'ai') {
      provider = lerProvedor(body);
      const descricao = typeof body.description === 'string' ? body.description.trim().slice(0, 2000) : '';
      const contexto = await contextoDaMarca(service);
      const acervo = body.use_context === true ? await materialDoAcervo(service) : '';
      origem = descricao ? 'descrição da marca' : 'persona e bandeira';
      entrada =
        'Crie um design system COMPLETO para a marca abaixo: paleta com papéis (fundo, texto, ' +
        'destaque, apoio), tipografia de título e corpo do Google Fonts, raios, densidade, ' +
        'estilo de foto e vocabulário de arte, mais três exemplos de aplicação (post, carrossel, ' +
        'reel). Fuja do óbvio do nicho — nada de paleta genérica de categoria.\n\n' +
        (descricao ? `DESCRIÇÃO DA MARCA (pelo dono):\n${descricao}\n\n` : '') +
        `PERSONA E BANDEIRA:\n${contexto}` +
        (acervo ? `\n\nMATERIAL DO CONTEXTO:\n${acervo}` : '');
    } else if (source === 'acervo') {
      const material = await materialDoAcervo(service);
      if (!material) {
        return errorResponse(
          409,
          'invalid_state',
          'Nenhum material no Contexto ainda. Suba conteúdo em Contexto ou escolha outra origem.',
        );
      }
      origem = 'material da marca no Contexto';
      entrada =
        'Deduza o design system a partir do material da marca abaixo — o que ele revela ' +
        `sobre tom, formalidade e território visual.\n\n${material}`;
    } else {
      const contexto = await contextoDaMarca(service);
      origem = 'nicho e persona do onboarding';
      entrada =
        'Proponha um design system a partir da persona e da bandeira abaixo. Fuja do ' +
        `óbvio do nicho — nada de paleta genérica de categoria.\n\n${contexto}`;
    }

    let draft: BrandKitDraft | undefined;
    try {
      const resultado = await chat({
        role_hint: 'generator',
        ...(provider ? { provider } : {}),
        messages: [
          { role: 'system', content: SISTEMA },
          { role: 'user', content: entrada },
        ],
        schema: SCHEMA as unknown as Record<string, unknown>,
      });
      draft = resultado.parsed as BrandKitDraft | undefined;
    } catch (err) {
      // Com tokens lidos em código, a IA é complemento, não pré-requisito.
      const semIa = draftFromHints(hints, origem);
      if (!semIa) throw err;
      draft = semIa;
    }
    if (!draft?.palette) {
      const semIa = draftFromHints(hints, origem);
      if (!semIa) {
        throw new Error('O modelo não devolveu um design system utilizável. Tente outra origem.');
      }
      draft = semIa;
    }
    // Eixo inventado vira o padrão em vez de quebrar a tela.
    draft.art = normalizeArt(draft.art) as unknown as Record<string, unknown>;
    if (!Array.isArray(draft.examples)) draft.examples = [];

    return jsonResponse({ draft, origem, hints });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(422, 'suggest_failed', message.slice(0, 300));
  }
});
