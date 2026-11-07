// _shared/adapters/base.ts — contrato ChannelAdapter + helpers puros + registry.
// Fonte: docs/07-contratos-backend.md §6.
//
// O núcleo de IA gera apenas a IDEIA e o CONTEÚDO (core_content); o adapter
// transforma para cada plataforma. Canal novo = novo arquivo em adapters/ +
// linha em channels via migration — não muda o núcleo. structure() é PURA e
// determinística: corta/realoca texto respeitando limites; NUNCA chama LLM.
// O linter pós-adaptação (por unidade, com lint_overrides) é executado pelo
// runner da saga — o adapter só declara os overrides.

import type {
  AdaptedContent,
  ChannelConfig,
  ChannelType,
  CoreContent,
} from '../types.ts';
import type { AspectRatio, RenderSpec } from '../render-spec.ts';
import type { LintOverrides } from '../linter.ts';

export interface ChannelAdapter {
  channel_type: ChannelType;

  limits: {
    chars?: number;                          // limite de texto principal
    caption_chars?: number;                  // limite de legenda
    slides?: { min: number; max: number };   // carrossel
    frames?: { min: number; max: number };   // stories
  };

  aspect_ratio: AspectRatio;

  // Função pura: núcleo → conteúdo adaptado ao canal (grava em
  // content_pieces.adapted_content). config = channels.config (overrides por
  // instância sobre os defaults deste adapter).
  structure(core_content: CoreContent, config?: ChannelConfig): AdaptedContent;

  // Como a peça vira arte final (render client-side determinístico)
  render_spec: RenderSpec;

  // Overrides das regras do linter para este canal (ex.: hashtags permitidas
  // em campo de metadado). Consumidos pelo runner no lint pós-adaptação.
  lint_overrides?: LintOverrides;

  // Nota de corte do juiz para este canal (override por instância em
  // channels.config.cutoff_score / guardrails.approval_threshold)
  cutoff_score: number;
}

// ── Helpers puros de texto (compartilhados pelos 7 adapters) ─────────────────

/** Conteúdo do bloco de uma camada (1-8) do funil; '' quando ausente. */
export function blockContent(core: CoreContent, layer: number): string {
  return core.funnel_blocks.find((b) => b.layer === layer)?.content.trim() ?? '';
}

/** Junta partes não vazias com o separador (default: parágrafo). */
export function joinNonEmpty(parts: Array<string | undefined>, sep = '\n\n'): string {
  return parts
    .map((p) => (p ?? '').trim())
    .filter((p) => p.length > 0)
    .join(sep);
}

/**
 * Corte que respeita fronteira de FRASE — o texto termina pontuado, sem parecer
 * cortado no meio. Sem nenhuma frase completa dentro do limite, cai no corte
 * por palavra com reticência (sinal honesto de continuação).
 */
export function clampToSentence(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const lastStop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
  if (lastStop > max * 0.5) return cut.slice(0, lastStop + 1).trimEnd();
  return `${clampText(t, max - 1)}…`;
}

/** Corta em `max` chars respeitando fronteira de palavra (sem reticências). */
export function clampText(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(' ');
  const clamped = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : t.slice(0, max);
  return clamped.trimEnd();
}

/** Divide o texto em sentenças (pontuação final preservada). */
export function splitSentences(text: string): string[] {
  const matches = text.trim().match(/[^.!?\n]+[.!?]*\s*/g) ?? [];
  return matches.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Empacota o texto em unidades de até `maxChars`, quebrando preferencialmente
 * em fronteira de sentença; sentenças maiores que o limite quebram por palavra.
 */
export function packIntoUnits(text: string, maxChars: number): string[] {
  const units: string[] = [];
  let current = '';
  for (const sentence of splitSentences(text)) {
    const candidate = current.length > 0 ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current.length > 0) units.push(current);
    if (sentence.length <= maxChars) {
      current = sentence;
    } else {
      let rest = sentence;
      while (rest.length > maxChars) {
        const chunk = clampText(rest, maxChars);
        units.push(chunk);
        rest = rest.slice(chunk.length).trim();
      }
      current = rest;
    }
  }
  if (current.length > 0) units.push(current);
  return units;
}

/**
 * Divide um texto em duas metades (fronteira de sentença; fallback: palavra).
 * null quando não há como dividir. Usado para atingir o mínimo de slides/frames.
 */
export function splitInHalf(text: string): [string, string] | null {
  const sentences = splitSentences(text);
  if (sentences.length >= 2) {
    const mid = Math.ceil(sentences.length / 2);
    return [sentences.slice(0, mid).join(' '), sentences.slice(mid).join(' ')];
  }
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length >= 4) {
    const mid = Math.ceil(words.length / 2);
    return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
  }
  return null;
}

/** CTA final: camada 8 já contém o CTA? Senão, anexa core.cta. */
export function ctaText(core: CoreContent): string {
  const layer8 = blockContent(core, 8);
  const cta = core.cta.trim();
  if (cta.length === 0) return layer8;
  if (layer8.toLowerCase().includes(cta.toLowerCase())) return layer8;
  return joinNonEmpty([layer8, cta]);
}

// ── Base compartilhada "post + imagem + legenda" (x/threads/linkedin/facebook) ──

/**
 * Texto principal de microblog: hook + virada + prova comprimidos no que couber
 * (07 §6 — mapeamento X/Threads). Determinístico: testa candidatos do mais
 * completo ao mais curto.
 */
export function microblogMainText(core: CoreContent, maxChars: number): string {
  const hook = core.hook.written.trim();
  const virada = blockContent(core, 5);
  const proof = core.proof.claim.trim();
  const candidates = [
    joinNonEmpty([hook, virada, proof]),
    joinNonEmpty([hook, proof]),
    joinNonEmpty([hook, virada]),
    hook,
  ];
  const fit = candidates.find((c) => c.length > 0 && c.length <= maxChars);
  return fit ?? clampText(hook, maxChars);
}

/**
 * Thread opcional: ensino/moral empacotados em unidades ≤ maxChars, CTA sempre
 * na última unidade. Retorna undefined quando nada resta para a thread.
 * `maxPosts` conta o total de unidades da peça (texto principal + thread).
 */
export function microblogThread(
  core: CoreContent,
  maxChars: number,
  maxPosts: number,
): string[] | undefined {
  const body = joinNonEmpty([blockContent(core, 6), blockContent(core, 7)]);
  // MEDIDO no preview de X: o último post saía "me chama para conversar sobre
  // o" — cortado no meio da frase, sem nem uma reticência. `clampText` corta em
  // fronteira de PALAVRA e não sinaliza nada; a regra da casa (já usada no
  // carrossel) é cortar em fronteira de FRASE, com reticência só como último
  // recurso. O CTA é a última coisa que o leitor vê da thread: terminar no
  // meio dela é pior do que terminar mais curto.
  const cta = clampToSentence(ctaText(core), maxChars);
  const maxThreadUnits = Math.max(maxPosts - 1, 0);
  if (maxThreadUnits === 0) return undefined;

  const units = body.length > 0 ? packIntoUnits(body, maxChars) : [];
  const thread: string[] = [];
  // Reserva a última vaga para o CTA.
  for (const unit of units.slice(0, cta.length > 0 ? maxThreadUnits - 1 : maxThreadUnits)) {
    thread.push(unit);
  }
  if (cta.length > 0) thread.push(cta);
  return thread.length > 0 ? thread : undefined;
}

// ── Registry ─────────────────────────────────────────────────────────────────
// Construção LAZY para tolerar o ciclo de módulos adapter ↔ base (os adapters
// importam helpers deste arquivo; este arquivo importa os 7 adapters).

import { instagramCarouselAdapter } from './instagram-carousel.ts';
import { instagramPostAdapter } from './instagram-post.ts';
import { instagramStoriesAdapter } from './instagram-stories.ts';
import { xPostAdapter } from './x-post.ts';
import { threadsPostAdapter } from './threads-post.ts';
import { linkedinPostAdapter } from './linkedin-post.ts';
import { facebookPostAdapter } from './facebook-post.ts';
import { instagramReelAdapter } from './instagram-reel.ts';

let registry: Record<ChannelType, ChannelAdapter> | null = null;

function buildRegistry(): Record<ChannelType, ChannelAdapter> {
  return {
    instagram_carousel: instagramCarouselAdapter,
    instagram_post: instagramPostAdapter,
    instagram_stories: instagramStoriesAdapter,
    x_post: xPostAdapter,
    threads_post: threadsPostAdapter,
    linkedin_post: linkedinPostAdapter,
    facebook_post: facebookPostAdapter,
    instagram_reel: instagramReelAdapter,
  };
}

/** Resolve o adapter de um canal. Lança para channel_type desconhecido. */
export function getAdapter(type: ChannelType): ChannelAdapter {
  if (!registry) registry = buildRegistry();
  const adapter = registry[type];
  if (!adapter) {
    throw new Error(`Adapter não registrado para channel_type "${type}".`);
  }
  return adapter;
}

/** Todos os adapters registrados (ex.: fan-out do estado adapting). */
export function allAdapters(): ChannelAdapter[] {
  if (!registry) registry = buildRegistry();
  return Object.values(registry);
}
