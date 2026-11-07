// _shared/linter.ts — Classe 1 da auditoria: linter determinístico.
// Fonte: docs/06-arquitetura-ia.md §2.6 e §4.1.
//
// Regex/código puro, SEM LLM, custo zero de token. Fonte única de regras: versão
// ativa de guardrails (nunca duplicar ban list em prompts de canal — adapters
// passam lint_overrides, não cópias). Roda pós-geração (estado linting) e de
// novo pós-adaptação por unidade de canal (com lint_overrides do adapter) —
// um derivado não escapa da ban list por ser derivado.
//
// Semântica de passed: violações severity 'error' reprovam; 'warn' não bloqueia.

import type { Audit, ChannelConfig, ChannelType, GuardrailsContent, PersonaContent } from './types.ts';

export type LintResult = Audit['linter'];
export type LintViolation = LintResult['violations'][number];

/** Overrides declarados pelo adapter do canal (ChannelAdapter.lint_overrides). */
export interface LintOverrides {
  /** true = hashtags liberadas neste texto (campo de metadado declarado pelo canal). */
  allow_hashtags?: boolean;
  /** Limite de emojis neste texto (sobrepõe dosage_rules.emoji_max). */
  emoji_max?: number;
}

export interface LintInput {
  /** Texto da peça (core renderizado) ou de uma unidade adaptada (slide/frame/post). */
  text: string;
  /** Versão ativa de guardrails.content — fonte única das regras. */
  guardrails: GuardrailsContent;
  /** Canal alvo — aplica channel_scope_overrides (regras aditivas). */
  channel_type?: ChannelType;
  /** Limites efetivos do canal (defaults do adapter + channels.config). */
  config?: ChannelConfig;
  /** Overrides do adapter (ChannelAdapter.lint_overrides). */
  lint_overrides?: LintOverrides;
  /** CTA declarado da peça (core_content.cta) — checado contra banned/allowed. */
  cta?: string;
  /** Léxico assinatura da persona ativa — checagem de dosagem. */
  signature_lexicon?: PersonaContent['signature_lexicon'];
}

// ── Normalização (case + acento insensitive, preservando índices) ────────────

/**
 * Dobra o texto para minúsculas sem acentos, preservando o comprimento UTF-16
 * (posição no texto dobrado == posição no original). Code points cuja dobra
 * mudaria o comprimento ficam intactos.
 */
function fold(text: string): string {
  let out = '';
  for (const cp of text) {
    const lowered = cp.toLowerCase();
    const base = lowered.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (base.length === cp.length) out += base;
    else if (lowered.length === cp.length) out += lowered;
    else out += cp;
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Todas as ocorrências literais de `needle` (dobrado) em `haystack` (dobrado). */
function literalMatches(foldedText: string, needle: string): number[] {
  const target = fold(needle);
  if (target.length === 0) return [];
  const positions: number[] = [];
  let idx = foldedText.indexOf(target);
  while (idx !== -1) {
    positions.push(idx);
    idx = foldedText.indexOf(target, idx + target.length);
  }
  return positions;
}

/** Ocorrências de `word` com fronteira de palavra (letras/dígitos não colados). */
function wordMatches(foldedText: string, word: string): number[] {
  const target = fold(word.trim());
  if (target.length === 0) return [];
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(target)}(?![\\p{L}\\p{N}])`,
    'giu',
  );
  const positions: number[] = [];
  for (const m of foldedText.matchAll(re)) positions.push(m.index ?? 0);
  return positions;
}

// ── Regras ───────────────────────────────────────────────────────────────────

/**
 * Antítese "não é X, é Y" (e variações "não são X, são Y" / "e sim" / "mas sim")
 * — padrão clássico de slop de IA, herdado do método de referência.
 */
const ANTITHESIS_RE =
  /\bnao\s+(?:e|sao|se\s+trata\s+de)\s+(?:sobre\s+)?[^,.;:!?\n]{2,80}[,;:]\s*(?:e|sao|e\s+sim|mas\s+sim)\b/giu;

const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;

/**
 * Linter determinístico (Classe 1). Recebe texto + guardrails + limites do canal
 * e retorna Audit['linter'] com as violações encontradas.
 */
export function lintText(input: LintInput): LintResult {
  const violations: LintViolation[] = [];
  const { text, guardrails } = input;
  const folded = fold(text);
  const channelOverride = input.channel_type
    ? guardrails.channel_scope_overrides[input.channel_type]
    : undefined;

  // 1. Pontuação banida — ocorrência literal em qualquer bloco.
  for (const punct of guardrails.banned_punctuation) {
    for (const pos of literalMatches(folded, punct)) {
      violations.push({ rule: 'banned_punctuation', match: punct, position: pos, severity: 'error' });
    }
  }

  // 2. Palavras banidas — fronteira de palavra, case/acento-insensitive.
  //    channel_scope_overrides.banned_words é ADITIVO ao global.
  const bannedWords = [...guardrails.banned_words, ...(channelOverride?.banned_words ?? [])];
  for (const word of bannedWords) {
    for (const pos of wordMatches(folded, word)) {
      violations.push({ rule: 'banned_words', match: word, position: pos, severity: 'error' });
    }
  }

  // 3. Metáforas banidas — match de expressão (substring dobrada).
  for (const metaphor of guardrails.banned_metaphors) {
    for (const pos of literalMatches(folded, metaphor)) {
      violations.push({ rule: 'banned_metaphors', match: metaphor, position: pos, severity: 'error' });
    }
  }

  // 4. CTAs proibidos — no corpo do texto e no CTA declarado da peça;
  //    o CTA declarado deve vir de allowed_ctas (global + aditivo do canal).
  for (const banned of guardrails.banned_ctas) {
    for (const pos of literalMatches(folded, banned)) {
      violations.push({ rule: 'banned_ctas', match: banned, position: pos, severity: 'error' });
    }
  }
  if (input.cta !== undefined) {
    const ctaFolded = fold(input.cta.trim());
    if (guardrails.banned_ctas.some((b) => ctaFolded.includes(fold(b)))) {
      violations.push({ rule: 'banned_ctas', match: input.cta, severity: 'error' });
    }
    const allowed = [...guardrails.allowed_ctas, ...(channelOverride?.allowed_ctas ?? [])];
    if (allowed.length > 0 && !allowed.some((a) => fold(a.trim()) === ctaFolded)) {
      violations.push({ rule: 'cta_not_allowed', match: input.cta, severity: 'error' });
    }
  }

  // 5. Emojis — nenhum no corpo, salvo canal que libere via override.
  const emojiMax = input.lint_overrides?.emoji_max ?? guardrails.dosage_rules.emoji_max ?? 0;
  const emojis = [...text.matchAll(EMOJI_RE)];
  if (emojis.length > emojiMax) {
    for (const m of emojis.slice(emojiMax)) {
      violations.push({ rule: 'emoji', match: m[0], position: m.index, severity: 'error' });
    }
  }

  // 6. Hashtags — proibidas no corpo; liberadas onde o canal declarar campo de
  //    metadado (lint_overrides.allow_hashtags). Política 'none' proíbe sempre.
  const hashtagsAllowed =
    input.lint_overrides?.allow_hashtags === true &&
    guardrails.dosage_rules.hashtag_policy !== 'none';
  if (!hashtagsAllowed) {
    for (const m of text.matchAll(HASHTAG_RE)) {
      violations.push({ rule: 'hashtag', match: m[0], position: m.index, severity: 'error' });
    }
  }

  // 7. Antítese "não é X, é Y" — regex sobre o texto dobrado.
  for (const m of folded.matchAll(ANTITHESIS_RE)) {
    const pos = m.index ?? 0;
    violations.push({
      rule: 'antithesis',
      match: text.slice(pos, pos + m[0].length),
      position: pos,
      severity: 'error',
    });
  }

  // 8. Limite de caracteres do canal (texto principal desta unidade).
  const maxChars = input.config?.text_max_chars ?? input.config?.slide_max_chars;
  if (maxChars !== undefined && text.length > maxChars) {
    violations.push({
      rule: 'channel_limit_chars',
      match: `${text.length}/${maxChars} chars`,
      position: maxChars,
      severity: 'error',
    });
  }

  // 9. Dosagem do léxico assinatura — por termo (max_per_piece) e teto global.
  if (input.signature_lexicon?.length) {
    const globalMax = guardrails.dosage_rules.signature_lexicon_max_per_piece;
    let total = 0;
    for (const entry of input.signature_lexicon) {
      const count = wordMatches(folded, entry.term).length;
      total += count;
      if (count > entry.max_per_piece) {
        violations.push({
          rule: 'lexicon_dosage',
          match: `"${entry.term}" ${count}x (máx ${entry.max_per_piece})`,
          severity: 'warn',
        });
      }
    }
    if (total > globalMax) {
      violations.push({
        rule: 'lexicon_dosage',
        match: `léxico assinatura ${total}x no total (teto ${globalMax})`,
        severity: 'warn',
      });
    }
  }

  return {
    passed: violations.every((v) => v.severity !== 'error'),
    violations,
  };
}
