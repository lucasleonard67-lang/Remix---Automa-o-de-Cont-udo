// _shared/editorial-carousel.ts — peças no layout EDITORIAL (padrão da casa):
// carrossel, stories e post.
//
// O adapter determinístico corta o core em fatias de texto; o layout editorial
// precisa de mais: manchete curta por unidade, parágrafos curtos com o número-
// chave em **negrito** e UM apoio por unidade (foto, gráfico de barras ou só
// texto). Uma chamada LLM reorganiza o core JÁ AUDITADO nessa estrutura — uma
// chamada por formato presente nos canais da peça.
//
// Fundamentos (docs/carrossel-editorial.md):
//   · capa/gancho: 1–2 frases, a virada em negrito; foto de abertura;
//   · miolo: uma ideia por unidade, contada como reportagem — fato, número,
//     citação; parágrafos de até 2 frases;
//   · ritmo: fotos entre unidades só de texto (no carrossel, até duas seguidas);
//     no máximo 1 gráfico, que pode fechar a peça, só com números que estão no
//     material.
//
// Nada de fato novo: o texto só pode reescrever o que o core e o contexto já
// dizem. Por isso o resultado passa no linter e os números do gráfico são
// conferidos no material; qualquer "[VERIFICAR" sobrevivente também derruba a
// peça. Se algo não fecha, volta o adapter determinístico.

import { chat } from './llm.ts';
import { lintText } from './linter.ts';
import { renderCoreContentText } from './funnel.ts';
import type { ContextBlock } from './prompts/generator.ts';
import type {
  ChannelType,
  CoreContent,
  GuardrailsContent,
  PersonaContent,
  SlideChart,
  SlideCta,
  StoryFrame,
  TweetCardSlide,
} from './types.ts';

export type EditorialFormat = 'carousel' | 'stories' | 'post';

/** Limites por formato — o que a tela cabe sem cortar (docs/carrossel-editorial.md). */
export interface FormatRules {
  channel: ChannelType;
  headlineMax: number;      // capa/gancho
  titleMax: number;         // manchete das unidades do miolo
  paragraphMax: number;
  paragraphsMax: number;
  photosMax: number;
  /** Fotos em unidades consecutivas. */
  photoStreakMax: number;
  chartBars: { min: number; max: number };
  endTitleWithPeriod: boolean;
}

export const RULES: Record<EditorialFormat, FormatRules> = {
  carousel: {
    channel: 'instagram_carousel',
    headlineMax: 230,
    titleMax: 70,
    paragraphMax: 240,
    paragraphsMax: 3,
    photosMax: 3,
    photoStreakMax: 2,
    chartBars: { min: 3, max: 6 },
    endTitleWithPeriod: false,
  },
  stories: {
    channel: 'instagram_stories',
    headlineMax: 140,
    titleMax: 45,
    paragraphMax: 160,
    paragraphsMax: 2,
    photosMax: 2,
    photoStreakMax: 1,
    chartBars: { min: 3, max: 5 },
    endTitleWithPeriod: true,
  },
  post: {
    channel: 'instagram_post',
    headlineMax: 60,
    titleMax: 60,
    paragraphMax: 200,
    paragraphsMax: 2,
    photosMax: 1,
    photoStreakMax: 1,
    chartBars: { min: 3, max: 5 },
    endTitleWithPeriod: false,
  },
};

// ── Schemas ──────────────────────────────────────────────────────────────────

const UNIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    paragraphs: { type: 'array', items: { type: 'string' } },
    visual: { type: 'string', enum: ['photo', 'chart', 'none'] },
    image_brief: { type: 'string' },
    chart_label: { type: 'string' },
    chart_bars: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { label: { type: 'string' }, value: { type: 'number' } },
        required: ['label', 'value'],
      },
    },
  },
  required: ['title', 'paragraphs', 'visual', 'image_brief', 'chart_label', 'chart_bars'],
} as const;

const COVER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    headline: { type: 'string' },
    image_brief: { type: 'string' },
  },
  required: ['headline', 'image_brief'],
} as const;

export const CTA_KINDS = ['whatsapp', 'direct', 'site', 'perfil'] as const;
/** Rótulo do botão do fecho. */
export const CTA_LABEL_MAX = 28;

const CTA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    paragraph: { type: 'string' },
    button_kind: { type: 'string', enum: [...CTA_KINDS] },
    button_label: { type: 'string' },
  },
  required: ['title', 'paragraph', 'button_kind', 'button_label'],
} as const;

const CAROUSEL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cover: COVER_SCHEMA,
    slides: { type: 'array', items: UNIT_SCHEMA },
    cta: CTA_SCHEMA,
  },
  required: ['cover', 'slides', 'cta'],
} as const;

const STORIES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cover: COVER_SCHEMA,
    frames: { type: 'array', items: UNIT_SCHEMA },
    cta: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        paragraph: { type: 'string' },
      },
      required: ['title', 'paragraph'],
    },
  },
  required: ['cover', 'frames', 'cta'],
} as const;

const POST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { card: UNIT_SCHEMA },
  required: ['card'],
} as const;

// ── Prompts ──────────────────────────────────────────────────────────────────

const COMMON_HEAD =
  'Reorganize o conteúdo abaixo. Não invente fatos, números, nomes nem citações: use só o que está no conteúdo e no material. ' +
  'Nunca escreva "[VERIFICAR]": se um dado não está no material, não o use.';
const COMMON_TAIL = 'Sem emojis, sem hashtags, sem travessão.';

const SYSTEM_CAROUSEL = [
  'Você é editor de um carrossel de Instagram no formato REPORTAGEM, como os de jornalismo de negócios.',
  COMMON_HEAD,
  '',
  'CAPA (headline): 1 ou 2 frases. A primeira apresenta a situação; a segunda, a virada com o número mais forte, toda entre **dois asteriscos**. Até 230 caracteres.',
  'image_brief da capa: a cena real do assunto, fotográfica, sem texto na imagem.',
  '',
  'MIOLO (6 a 8 slides, uma ideia por slide, em ordem cronológica ou de causa e efeito):',
  '- title: manchete curta e concreta, até 60 caracteres, terminando em ponto. Ex.: "Pegou, pagou, foi embora."',
  '- paragraphs: 1 a 3 parágrafos de no máximo 2 frases cada. Linguagem falada, frases curtas. Marque em **negrito** só o número-chave ou a citação central (no máximo 2 trechos por slide).',
  '- visual: "photo" quando uma imagem mostra o que o texto diz (no máximo 3 no carrossel, no máximo dois seguidos); "chart" UMA vez, só se houver uma série de 3 a 6 números comparáveis no conteúdo; "none" no resto.',
  '- image_brief: com visual "photo", a cena em uma frase, fotográfica, sem texto; senão "".',
  '- chart_label e chart_bars: com visual "chart", a legenda ("vendas por ano, em R$ milhões") e as barras em ordem; senão "" e [].',
  '- O último slide do miolo é o gráfico que prova a história, ou o fato mais forte.',
  '',
  'FECHO (cta), o card final, depois do miolo:',
  '- title: a tese da história em uma frase curta, até 60 caracteres, terminando em ponto.',
  '- paragraph: o próximo passo concreto, até 160 caracteres, na voz da marca e a partir da chamada do conteúdo (CTA). Sem chamada genérica.',
  '- button_kind: por onde a pessoa age: "whatsapp" se a chamada fala em WhatsApp, chamar, agendar ou falar; "direct" se é mandar mensagem no Instagram; "site" se é um link ou a bio; "perfil" se é seguir.',
  '- button_label: o texto do botão, 2 a 4 palavras no imperativo, até 28 caracteres. Ex.: "Chamar no WhatsApp", "Mandar mensagem", "Ver o site", "Seguir a página".',
  COMMON_TAIL,
].join('\n');

const SYSTEM_STORIES = [
  'Você é editor de uma sequência de Stories de Instagram (9:16) no formato REPORTAGEM, como os de jornalismo de negócios.',
  COMMON_HEAD,
  '',
  'GANCHO (cover.headline): 1 ou 2 frases, até 140 caracteres. A frase com o número mais forte vai toda entre **dois asteriscos**.',
  'cover.image_brief: a cena real do assunto, fotográfica, sem texto na imagem.',
  '',
  'DESENVOLVIMENTO (frames: exatamente 2 ou 3 frames, uma ideia por frame, em ordem cronológica ou de causa e efeito):',
  '- title: manchete curta e concreta, até 45 caracteres, terminando em ponto. Ex.: "Pegou, pagou, foi embora."',
  '- paragraphs: 1 ou 2 parágrafos de até 160 caracteres cada, no máximo 2 frases. Linguagem falada. Marque em **negrito** só o número-chave ou a citação central.',
  '- visual: "photo" quando uma imagem mostra o que o texto diz (no máximo 2 na sequência, nunca dois seguidos); "chart" UMA vez, só se houver uma série de 3 a 5 números comparáveis no conteúdo; "none" no resto.',
  '- image_brief: com visual "photo", a cena em uma frase, fotográfica, sem texto; senão "".',
  '- chart_label e chart_bars: com visual "chart", a legenda ("vendas por ano, em R$ milhões") e as barras em ordem; senão "" e [].',
  '',
  'FECHO (cta): title = a tese em uma frase curta, até 45 caracteres; paragraph = o próximo passo concreto em até 160 caracteres, sem chamada genérica.',
  COMMON_TAIL,
].join('\n');

const SYSTEM_POST = [
  'Você é editor de um post único de Instagram (um card) no formato REPORTAGEM, como os de jornalismo de negócios.',
  COMMON_HEAD,
  '',
  'CARD (card): a ideia central em um só quadro.',
  '- title: manchete curta e concreta, até 60 caracteres.',
  '- paragraphs: 1 ou 2 parágrafos de até 200 caracteres cada, no máximo 2 frases. Marque em **negrito** só o número-chave ou a citação central.',
  '- visual: "photo" se uma imagem mostra o que o texto diz; "chart" só se houver uma série de 3 a 5 números comparáveis no conteúdo; "none" no resto.',
  '- image_brief: com visual "photo", a cena em uma frase, fotográfica, sem texto; senão "".',
  '- chart_label e chart_bars: com visual "chart", a legenda ("vendas por ano, em R$ milhões") e as barras em ordem; senão "" e [].',
  COMMON_TAIL,
].join('\n');

// ── Shapes crus do modelo ────────────────────────────────────────────────────

interface RawUnit {
  title: string;
  paragraphs: string[];
  visual: 'photo' | 'chart' | 'none';
  image_brief: string;
  chart_label: string;
  chart_bars: { label: string; value: number }[];
}

interface RawCover { headline: string; image_brief: string }
interface RawCta { title: string; paragraph: string; button_kind: string; button_label: string }

type RawCarousel = { cover: RawCover; slides: RawUnit[]; cta: RawCta };
type RawStories = { cover: RawCover; frames: RawUnit[]; cta: { title: string; paragraph: string } };
type RawPost = { card: RawUnit };

// ── Utilitários ──────────────────────────────────────────────────────────────

/** Os números do gráfico têm que aparecer no material (formato BR ou US). */
function numberInSource(value: number, source: string): boolean {
  const variants = new Set<string>([
    String(value),
    value.toLocaleString('pt-BR'),
    value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    value.toLocaleString('en-US'),
  ]);
  return [...variants].some((v) => source.includes(v));
}

export function clean(text: string): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** Corta no último espaço antes do limite e fecha um **negrito** que ficou aberto. */
export function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = cut.lastIndexOf(' ');
  let out = (at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:]+$/, '');
  if ((out.match(/\*\*/g) ?? []).length % 2 === 1) out += '**';
  return out;
}

export function ensurePeriod(title: string): string {
  return /[.!?…]$/.test(title) ? title : `${title}.`;
}

/** Unidade válida tem manchete e ao menos um parágrafo com texto. */
function hasBody(raw: RawUnit | undefined): raw is RawUnit {
  return Boolean(raw && clean(raw.title) && Array.isArray(raw.paragraphs) && raw.paragraphs.some((p) => clean(p)));
}

/** Orçamento de apoios visuais da peça (fotos alternadas, um gráfico). */
interface VisualBudget { photos: number; charted: boolean; photoStreak: number }

/** Campos editoriais de uma unidade (sem index/role — cada formato monta o seu). */
interface Unit {
  text: string;
  title: string;
  paragraphs: string[];
  visual: 'photo' | 'chart' | 'none';
  chart?: SlideChart;
  image_brief?: string;
  photo_promoted?: boolean;
}

function buildUnit(raw: RawUnit, rules: FormatRules, budget: VisualBudget, source: string): Unit {
  let title = clamp(clean(raw.title), rules.titleMax);
  if (rules.endTitleWithPeriod) title = ensurePeriod(title);
  const paragraphs = raw.paragraphs.map(clean).filter(Boolean)
    .slice(0, rules.paragraphsMax)
    .map((p) => clamp(p, rules.paragraphMax));

  let visual: Unit['visual'] = 'none';
  let chart: SlideChart | undefined;
  if (raw.visual === 'photo' && budget.photos < rules.photosMax && budget.photoStreak < rules.photoStreakMax && clean(raw.image_brief)) {
    visual = 'photo';
    budget.photos += 1;
  } else if (
    raw.visual === 'chart' && !budget.charted &&
    Array.isArray(raw.chart_bars) &&
    raw.chart_bars.length >= rules.chartBars.min && raw.chart_bars.length <= rules.chartBars.max &&
    raw.chart_bars.every((b) => Number.isFinite(b.value) && numberInSource(b.value, source))
  ) {
    visual = 'chart';
    budget.charted = true;
    chart = {
      label: clean(raw.chart_label),
      bars: raw.chart_bars.map((b) => ({ label: clean(b.label), value: b.value })),
    };
  }
  budget.photoStreak = visual === 'photo' ? budget.photoStreak + 1 : 0;

  return {
    text: [title, ...paragraphs].join('\n'),
    title,
    paragraphs,
    visual,
    ...(chart ? { chart } : {}),
    ...(visual === 'photo' ? { image_brief: clean(raw.image_brief), photo_promoted: true } : {}),
  };
}

const isCtaKind = (kind: unknown): kind is SlideCta['kind'] =>
  typeof kind === 'string' && (CTA_KINDS as readonly string[]).includes(kind);

/**
 * O fecho do carrossel: a tese, o próximo passo e o botão. Null quando o
 * modelo não entregou um fecho inteiro — o carrossel sem fecho não sai.
 */
function buildCtaSlide(raw: RawCta | undefined, index: number, rules: FormatRules): TweetCardSlide | null {
  const title = ensurePeriod(clamp(clean(raw?.title ?? ''), rules.titleMax));
  const paragraph = clamp(clean(raw?.paragraph ?? ''), rules.paragraphMax);
  const label = clamp(clean(raw?.button_label ?? ''), CTA_LABEL_MAX);
  if (!clean(raw?.title ?? '') || !paragraph || !label || !isCtaKind(raw?.button_kind)) return null;
  return {
    index,
    role: 'cta',
    text: [title, paragraph].join('\n'),
    title,
    paragraphs: [paragraph],
    visual: 'none',
    cta: { kind: raw!.button_kind as SlideCta['kind'], label },
  };
}

interface Checkable { text: string; title?: string; paragraphs?: string[]; chart?: SlideChart }

/**
 * Mesmas regras da marca que o core passou: uma violação devolve o adapter.
 * "[VERIFICAR" em qualquer unidade é falha dura — a peça editorial nunca pode
 * sair com dado pendente de conferência.
 */
export function gateIssues(
  units: Checkable[],
  rules: FormatRules,
  guardrails: GuardrailsContent,
  signatureLexicon: PersonaContent['signature_lexicon'] | undefined,
): { unit: number; issue: string }[] {
  const issues: { unit: number; issue: string }[] = [];
  units.forEach((unit, index) => {
    const everything = [
      unit.text,
      unit.title ?? '',
      ...(unit.paragraphs ?? []),
      unit.chart?.label ?? '',
      ...(unit.chart?.bars.map((b) => b.label) ?? []),
    ].join('\n');
    if (everything.includes('[VERIFICAR')) issues.push({ unit: index, issue: 'tem [VERIFICAR] pendente' });
    const lint = lintText({
      text: unit.text.replace(/\*\*/g, ''),
      guardrails,
      channel_type: rules.channel,
      signature_lexicon: signatureLexicon,
    });
    for (const violation of lint.violations) {
      if (violation.severity === 'error') {
        issues.push({ unit: index, issue: `quebra a regra da marca ${violation.rule}: "${violation.match}"` });
      }
    }
  });
  return issues;
}

function passesGate(
  units: Checkable[],
  rules: FormatRules,
  guardrails: GuardrailsContent,
  signatureLexicon: PersonaContent['signature_lexicon'] | undefined,
  tag: string,
): boolean {
  const issues = gateIssues(units, rules, guardrails, signatureLexicon);
  if (issues.length) console.warn(`[editorial-${tag}] reprovado, usa o adapter`, issues);
  return issues.length === 0;
}

// ── Chamada ──────────────────────────────────────────────────────────────────

export interface EditorialPieceParams {
  core: CoreContent;
  blocks: ContextBlock[];
  guardrails: GuardrailsContent;
  signatureLexicon?: PersonaContent['signature_lexicon'];
}

async function ask<T>(
  format: EditorialFormat,
  system: string,
  schema: Record<string, unknown>,
  coreText: string,
  material: string,
): Promise<T | null> {
  try {
    const result = await chat({
      role_hint: 'generator',
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: `CONTEÚDO APROVADO:\n${coreText}\n\nMATERIAL DE APOIO:\n${material || '(sem material)'}`,
        },
      ],
      schema,
    });
    return result.parsed as T;
  } catch (error) {
    console.warn(`[editorial-${format}] chamada falhou, usa o adapter`, error);
    return null;
  }
}

const CAROUSEL_ATTEMPTS = 2;
/** Slides depois da capa. */
const CAROUSEL_MIDDLE = { min: 5, max: 9 };
/** Trechos em **negrito** por slide. */
const BOLD_MAX = 2;

async function writeCarousel(
  rules: FormatRules,
  coreText: string,
  material: string,
  source: string,
  guardrails: GuardrailsContent,
  signatureLexicon: PersonaContent['signature_lexicon'] | undefined,
): Promise<TweetCardSlide[] | null> {
  const parsed = await ask<RawCarousel>('carousel', SYSTEM_CAROUSEL, CAROUSEL_SCHEMA as unknown as Record<string, unknown>, coreText, material);
  const headline = clamp(clean(parsed?.cover?.headline ?? ''), rules.headlineMax);
  const middle = (parsed?.slides ?? []).filter(hasBody);
  if (!parsed || !headline || middle.length < CAROUSEL_MIDDLE.min) return null;

  const budget: VisualBudget = { photos: 0, charted: false, photoStreak: 0 };
  const slides: TweetCardSlide[] = [
    {
      index: 0,
      text: headline,
      paragraphs: [headline],
      visual: 'photo',
      ...(clean(parsed.cover.image_brief) ? { image_brief: clean(parsed.cover.image_brief) } : {}),
    },
  ];
  for (const raw of middle.slice(0, CAROUSEL_MIDDLE.max)) {
    slides.push({ index: slides.length, ...buildUnit(raw, rules, budget, source) });
  }
  const fecho = buildCtaSlide(parsed.cta, slides.length, rules);
  if (!fecho) {
    console.warn('[editorial-carousel] veio sem fecho');
    return null;
  }
  slides.push(fecho);
  return passesGate(slides, rules, guardrails, signatureLexicon, 'carousel') ? slides : null;
}

/**
 * Escreve a peça no layout editorial para UM formato. Devolve as unidades
 * daquele formato (slides, frames ou o card) ou null — e null significa
 * "fica com o adapter determinístico".
 */
export async function editorialPiece(
  params: EditorialPieceParams & { format: 'carousel' },
): Promise<TweetCardSlide[] | null>;
export async function editorialPiece(
  params: EditorialPieceParams & { format: 'stories' },
): Promise<StoryFrame[] | null>;
export async function editorialPiece(
  params: EditorialPieceParams & { format: 'post' },
): Promise<TweetCardSlide | null>;
export async function editorialPiece(
  params: EditorialPieceParams & { format: EditorialFormat },
): Promise<TweetCardSlide[] | StoryFrame[] | TweetCardSlide | null> {
  const { format, core, blocks, guardrails, signatureLexicon } = params;
  const rules = RULES[format];
  const coreText = renderCoreContentText(core);
  const material = blocks.map((b) => `## ${b.title}\n${b.content}`).join('\n\n').slice(0, 12_000);
  const source = `${coreText}\n${material}`;
  if (format === 'carousel') {
    // O carrossel é a vitrine do padrão: uma falha passageira do modelo ganha
    // uma segunda chance antes de cair no adapter.
    for (let attempt = 1; attempt <= CAROUSEL_ATTEMPTS; attempt++) {
      const slides = await writeCarousel(rules, coreText, material, source, guardrails, signatureLexicon);
      if (slides) return slides;
      console.warn(`[editorial-carousel] tentativa ${attempt} de ${CAROUSEL_ATTEMPTS} não fechou`);
    }
    return null;
  }

  const budget: VisualBudget = { photos: 0, charted: false, photoStreak: 0 };

  if (format === 'stories') {
    const parsed = await ask<RawStories>(format, SYSTEM_STORIES, STORIES_SCHEMA as unknown as Record<string, unknown>, coreText, material);
    const headline = clamp(clean(parsed?.cover?.headline ?? ''), rules.headlineMax);
    const middle = (parsed?.frames ?? []).filter(hasBody);
    const ctaTitle = ensurePeriod(clamp(clean(parsed?.cta?.title ?? ''), rules.titleMax));
    const ctaParagraph = clamp(clean(parsed?.cta?.paragraph ?? ''), rules.paragraphMax);
    // 4 a 5 frames: gancho + 2–3 desenvolvimentos + fecho.
    if (!parsed || !headline || middle.length < 2 || !clean(parsed.cta?.title) || !ctaParagraph) return null;

    const frames: StoryFrame[] = [
      {
        index: 0,
        role: 'gancho',
        text: headline,
        paragraphs: [headline],
        visual: 'photo',
        photo_promoted: true,
        ...(clean(parsed.cover.image_brief) ? { image_brief: clean(parsed.cover.image_brief) } : {}),
      },
    ];
    for (const raw of middle.slice(0, 3)) {
      frames.push({ index: frames.length, role: 'desenvolvimento', ...buildUnit(raw, rules, budget, source) });
    }
    frames.push({
      index: frames.length,
      role: 'cta',
      text: [ctaTitle, ctaParagraph].join('\n'),
      title: ctaTitle,
      paragraphs: [ctaParagraph],
      visual: 'none',
    });
    return passesGate(frames, rules, guardrails, signatureLexicon, format) ? frames : null;
  }

  const parsed = await ask<RawPost>(format, SYSTEM_POST, POST_SCHEMA as unknown as Record<string, unknown>, coreText, material);
  if (!parsed || !hasBody(parsed.card)) return null;
  const card: TweetCardSlide = { index: 0, ...buildUnit(parsed.card, rules, budget, source) };
  return passesGate([card], rules, guardrails, signatureLexicon, format) ? card : null;
}

/** Compatibilidade: o carrossel editorial como sempre foi chamado. */
export function editorialCarousel(params: EditorialPieceParams): Promise<TweetCardSlide[] | null> {
  return editorialPiece({ ...params, format: 'carousel' });
}

// ── Carrossel escrito fora do servidor (Claude da pessoa, pelo conector) ─────

export interface WrittenBar { label: string; value: number; fonte?: string }

export interface WrittenSlide {
  title: string;
  paragraphs: string[];
  visual: 'photo' | 'chart' | 'none';
  image_brief?: string;
  chart?: { label: string; bars: WrittenBar[]; highlight?: number };
}

export interface WrittenCta {
  title: string;
  paragraph: string;
  button: { kind: SlideCta['kind']; label: string };
}

export interface WrittenCarousel {
  cover: { headline: string; image_brief?: string };
  slides: WrittenSlide[];
  /** O card final: a tese, o próximo passo e o botão. Obrigatório. */
  cta?: WrittenCta;
}

export interface CheckedCarousel {
  slides: TweetCardSlide[];
  /** De onde veio cada número do gráfico sem respaldo no material. */
  fontes: { slide: number; label: string; value: number; fonte: string }[];
  problemas: string[];
}

const boldCount = (text: string) => Math.floor((text.match(/\*\*/g) ?? []).length / 2);

/**
 * Mesmas regras do escritor do servidor, com uma diferença: aqui nada é cortado
 * nem descartado em silêncio. Quem escreveu recebe a lista do que corrigir.
 */
export function checkWrittenCarousel(
  written: WrittenCarousel,
  context: {
    guardrails: GuardrailsContent;
    signatureLexicon?: PersonaContent['signature_lexicon'];
    material?: string;
  },
): CheckedCarousel {
  const rules = RULES.carousel;
  const problemas: string[] = [];
  const headline = clean(written.cover?.headline ?? '');
  if (!headline) problemas.push('Capa: falta a manchete.');
  if (headline.length > rules.headlineMax) {
    problemas.push(`Capa: ${headline.length} caracteres, o limite é ${rules.headlineMax}.`);
  }
  if (headline && boldCount(headline) === 0) {
    problemas.push('Capa: a virada com o número mais forte vai entre **dois asteriscos**.');
  }

  const writtenSlides = Array.isArray(written.slides) ? written.slides : [];
  if (writtenSlides.length < CAROUSEL_MIDDLE.min || writtenSlides.length > CAROUSEL_MIDDLE.max) {
    problemas.push(`São ${CAROUSEL_MIDDLE.min} a ${CAROUSEL_MIDDLE.max} slides depois da capa; vieram ${writtenSlides.length}.`);
  }

  const budget: VisualBudget = { photos: 0, charted: false, photoStreak: 0 };
  const fontes: CheckedCarousel['fontes'] = [];
  const material = context.material ?? '';
  const brief = clean(written.cover?.image_brief ?? '');
  const slides: TweetCardSlide[] = [
    { index: 0, text: headline, paragraphs: [headline], visual: 'photo', ...(brief ? { image_brief: brief } : {}) },
  ];

  writtenSlides.forEach((raw, position) => {
    const index = position + 1;
    const nome = `Slide ${index}`;
    const title = clean(raw?.title ?? '');
    const paragraphs = (Array.isArray(raw?.paragraphs) ? raw.paragraphs : []).map(clean).filter(Boolean);
    if (!title) problemas.push(`${nome}: falta a manchete.`);
    if (title.length > rules.titleMax) problemas.push(`${nome}: manchete com ${title.length} caracteres, o limite é ${rules.titleMax}.`);
    if (!paragraphs.length || paragraphs.length > rules.paragraphsMax) {
      problemas.push(`${nome}: são 1 a ${rules.paragraphsMax} parágrafos.`);
    }
    paragraphs.forEach((paragraph, i) => {
      if (paragraph.length > rules.paragraphMax) {
        problemas.push(`${nome}: parágrafo ${i + 1} com ${paragraph.length} caracteres, o limite é ${rules.paragraphMax}.`);
      }
    });
    if (paragraphs.reduce((total, p) => total + boldCount(p), 0) > BOLD_MAX) {
      problemas.push(`${nome}: no máximo ${BOLD_MAX} trechos em negrito.`);
    }

    const visual = raw?.visual ?? 'none';
    const unit: TweetCardSlide = { index, text: [title, ...paragraphs].join('\n'), title, paragraphs, visual };
    if (visual === 'photo') {
      const scene = clean(raw.image_brief ?? '');
      budget.photos += 1;
      budget.photoStreak += 1;
      if (budget.photos > rules.photosMax) problemas.push(`${nome}: no máximo ${rules.photosMax} fotos no miolo.`);
      if (budget.photoStreak > rules.photoStreakMax) problemas.push(`${nome}: no máximo ${rules.photoStreakMax} fotos seguidas.`);
      if (!scene) problemas.push(`${nome}: descreva a foto em image_brief.`);
      unit.image_brief = scene;
      unit.photo_promoted = true;
    } else {
      budget.photoStreak = 0;
    }
    if (visual === 'chart') {
      const bars = Array.isArray(raw.chart?.bars) ? raw.chart.bars : [];
      if (budget.charted) problemas.push(`${nome}: só um gráfico por carrossel.`);
      budget.charted = true;
      if (!clean(raw.chart?.label ?? '')) problemas.push(`${nome}: falta a legenda do gráfico.`);
      if (bars.length < rules.chartBars.min || bars.length > rules.chartBars.max) {
        problemas.push(`${nome}: o gráfico tem de ${rules.chartBars.min} a ${rules.chartBars.max} barras.`);
      }
      for (const bar of bars) {
        const fonte = clean(bar.fonte ?? '');
        if (!Number.isFinite(bar.value)) {
          problemas.push(`${nome}: a barra "${bar.label}" precisa de um número.`);
        } else if (fonte) {
          fontes.push({ slide: index, label: clean(bar.label), value: bar.value, fonte });
        } else if (!numberInSource(bar.value, material)) {
          problemas.push(`${nome}: o número ${bar.value} não está no material. Informe a fonte dessa barra.`);
        }
      }
      unit.chart = {
        label: clean(raw.chart?.label ?? ''),
        bars: bars.map((bar) => ({ label: clean(bar.label), value: bar.value })),
        ...(Number.isInteger(raw.chart?.highlight) ? { highlight: raw.chart!.highlight } : {}),
      };
    }
    slides.push(unit);
  });

  const cta = written.cta;
  const ctaTitle = clean(cta?.title ?? '');
  const ctaParagraph = clean(cta?.paragraph ?? '');
  const ctaLabel = clean(cta?.button?.label ?? '');
  if (!cta) {
    problemas.push('Fecho: falta o card final (cta: title, paragraph e button).');
  } else {
    if (!ctaTitle) problemas.push('Fecho: falta a tese em title.');
    if (ctaTitle.length > rules.titleMax) problemas.push(`Fecho: title com ${ctaTitle.length} caracteres, o limite é ${rules.titleMax}.`);
    if (!ctaParagraph) problemas.push('Fecho: falta o próximo passo em paragraph.');
    if (ctaParagraph.length > rules.paragraphMax) problemas.push(`Fecho: paragraph com ${ctaParagraph.length} caracteres, o limite é ${rules.paragraphMax}.`);
    if (!isCtaKind(cta.button?.kind)) problemas.push(`Fecho: button.kind é um de ${CTA_KINDS.join(', ')}.`);
    if (!ctaLabel) problemas.push('Fecho: falta o texto do botão em button.label.');
    if (ctaLabel.length > CTA_LABEL_MAX) problemas.push(`Fecho: button.label com ${ctaLabel.length} caracteres, o limite é ${CTA_LABEL_MAX}.`);
  }
  const fecho = buildCtaSlide(
    cta ? { title: cta.title, paragraph: cta.paragraph, button_kind: cta.button?.kind, button_label: cta.button?.label } : undefined,
    slides.length,
    rules,
  );
  if (fecho) slides.push(fecho);

  for (const { unit, issue } of gateIssues(slides, rules, context.guardrails, context.signatureLexicon)) {
    const nome = unit === 0 ? 'Capa' : slides[unit]?.role === 'cta' ? 'Fecho' : `Slide ${unit}`;
    problemas.push(`${nome}: ${issue}.`);
  }
  return { slides, fontes, problemas };
}
