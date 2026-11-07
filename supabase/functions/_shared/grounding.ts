// _shared/grounding.ts — Classe 2 da auditoria: verificador de grounding.
// Fonte: docs/06-arquitetura-ia.md §4.2.
//
// Determinístico, sem LLM. Garante que nenhum número ou citação foi inventado
// ou alterado: extrai claims do texto renderizado do core_content (regex),
// normaliza (locale pt-BR) e diffa contra o contexto selecionado (context_ids)
// — texto dos chunks + metadata tipada dos cases.
//
// Semântica de passed (06 §4.2): flags [VERIFICAR] NÃO bloqueiam a saga (seguem
// sinalizadas até awaiting_review); violações ESTRUTURAIS bloqueiam e disparam
// reescrita: número divergente da fonte, proof fora de context_ids, mais de um
// case citado (regra "1 prova central"), citation_policy 'anonymous' violada.

import type { Audit, CaseMetadata, ContextKind, CoreContent } from './types.ts';
import { renderCoreContentText } from './funnel.ts';

export interface GroundingSource {
  /** context_items.id do item de origem do chunk. */
  item_id: string;
  kind: ContextKind;
  title?: string;
  /** Conteúdo do chunk/corpo usado pelo gerador. */
  content: string;
  /** context_items.metadata — CaseMetadata quando kind = 'case'. */
  metadata?: Record<string, unknown>;
}

export interface GroundingInput {
  core: CoreContent;
  /** generation_jobs.context_ids — o conjunto (e só ele) contra o qual se diffa. */
  context_ids: string[];
  /** Chunks/itens de context_ids carregados pelo runner. */
  sources: GroundingSource[];
}

/** Audit['grounding'] + o texto com as substituições [VERIFICAR: …] aplicadas. */
export type GroundingReport = Audit['grounding'] & { text: string };

type CheckedEntry = Audit['grounding']['checked'][number];
type FlaggedEntry = Audit['grounding']['flagged'][number];

// ── Normalização pt-BR ───────────────────────────────────────────────────────

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** "1.234,56" → 1234.56 · "1,2" → 1.2 · "1.200" → 1200. */
function parseNumberPt(raw: string): number | null {
  let s = raw.trim();
  if (!/\d/.test(s)) return null;
  if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(/,/g, '.');
  else if (s.includes(',')) s = s.replace(/,/g, '.');
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const SCALE_SUFFIX: Record<string, number> = {
  mil: 1e3, k: 1e3,
  mi: 1e6, milhao: 1e6, milhoes: 1e6, m: 1e6, mm: 1e6,
  bi: 1e9, bilhao: 1e9, bilhoes: 1e9,
};

function applyScale(value: number, suffix: string | undefined): number {
  if (!suffix) return value;
  const scale = SCALE_SUFFIX[fold(suffix.trim())];
  return scale ? value * scale : value;
}

function sameNumber(a: number, b: number): boolean {
  if (a === b) return true;
  const diff = Math.abs(a - b);
  return diff <= Math.abs(Math.max(a, b)) * 1e-9;
}

// ── Extração de claims do output ─────────────────────────────────────────────

interface NumericClaim {
  kind: 'number';
  claim: string;
  position: number;
  /** Valores aceitáveis na fonte (valor bruto e valor escalado, quando houver sufixo). */
  values: number[];
}

interface QuoteClaim {
  kind: 'quote';
  claim: string;
  position: number;
  /** Miolo da citação (sem aspas), dobrado. */
  inner: string;
}

type Claim = NumericClaim | QuoteClaim;

const MONEY_RE =
  /(?:R\$|US\$|U\$|\$)\s?(\d[\d.,]*)\s*(mil|mi|milhões|milhão|milhoes|milhao|bi|bilhões|bilhão|bilhoes|bilhao|k|M|MM)?\b/gu;
const PERCENT_RE = /(\d[\d.,]*)\s?%/gu;
const MULTIPLE_RE = /\b(\d+(?:[.,]\d+)?)\s?x\b/giu;
const TEMPORAL_RE = /\bem\s+(\d[\d.,]*)\s+(?:dias?|semanas?|meses|mês|anos?)\b/giu;
const QUOTE_RE = /["“]([^"”\n]{8,300})["”]/gu;
/** Marcações [VERIFICAR: …] já feitas pelo gerador — não re-flagar dentro delas. */
const VERIFY_SPAN_RE = /\[VERIFICAR:[^\]]*\]/g;

function extractClaims(text: string): Claim[] {
  const claims: Claim[] = [];
  const push = (c: Claim) => {
    // dedupe por posição+texto (regexes podem se sobrepor)
    if (!claims.some((k) => k.position === c.position && k.claim === c.claim)) claims.push(c);
  };

  for (const m of text.matchAll(MONEY_RE)) {
    const value = parseNumberPt(m[1]);
    if (value === null) continue;
    const values = [value];
    const scaled = applyScale(value, m[2]);
    if (!values.some((v) => sameNumber(v, scaled))) values.push(scaled);
    push({ kind: 'number', claim: m[0].trim(), position: m.index ?? 0, values });
  }
  for (const m of text.matchAll(PERCENT_RE)) {
    const value = parseNumberPt(m[1]);
    if (value === null) continue;
    push({ kind: 'number', claim: m[0].trim(), position: m.index ?? 0, values: [value] });
  }
  for (const m of text.matchAll(MULTIPLE_RE)) {
    const value = parseNumberPt(m[1]);
    if (value === null) continue;
    push({ kind: 'number', claim: m[0].trim(), position: m.index ?? 0, values: [value] });
  }
  for (const m of text.matchAll(TEMPORAL_RE)) {
    const value = parseNumberPt(m[1]);
    if (value === null) continue;
    push({ kind: 'number', claim: m[0].trim(), position: m.index ?? 0, values: [value] });
  }
  for (const m of text.matchAll(QUOTE_RE)) {
    push({ kind: 'quote', claim: m[0], position: m.index ?? 0, inner: fold(m[1]).trim() });
  }

  // Ignora claims dentro de marcações [VERIFICAR: …] existentes.
  const verifySpans: Array<[number, number]> = [];
  for (const m of text.matchAll(VERIFY_SPAN_RE)) {
    const start = m.index ?? 0;
    verifySpans.push([start, start + m[0].length]);
  }
  return claims
    .filter((c) => !verifySpans.some(([s, e]) => c.position >= s && c.position < e))
    .sort((a, b) => a.position - b.position);
}

// ── Índice das fontes ────────────────────────────────────────────────────────

interface SourceIndex {
  item_id: string;
  kind: ContextKind;
  foldedContent: string;
  numbers: number[];
  caseMeta: CaseMetadata | null;
}

function readCaseMetadata(source: GroundingSource): CaseMetadata | null {
  if (source.kind !== 'case' || !source.metadata) return null;
  const md = source.metadata as Partial<CaseMetadata>;
  if (typeof md.metric_value !== 'number' && !md.quote && !md.client_name) return null;
  return md as CaseMetadata;
}

function indexSource(source: GroundingSource): SourceIndex {
  const caseMeta = readCaseMetadata(source);
  const numbers: number[] = [];
  const NUM_RE = /\d[\d.,]*/g;
  for (const m of source.content.matchAll(NUM_RE)) {
    const value = parseNumberPt(m[0]);
    if (value !== null) numbers.push(value);
  }
  if (caseMeta && typeof caseMeta.metric_value === 'number') numbers.push(caseMeta.metric_value);
  return {
    item_id: source.item_id,
    kind: source.kind,
    foldedContent: fold(source.content) + (caseMeta?.quote ? '\n' + fold(caseMeta.quote) : ''),
    numbers,
    caseMeta,
  };
}

function claimMatchesSource(claim: Claim, source: SourceIndex): boolean {
  if (claim.kind === 'quote') {
    return claim.inner.length > 0 && source.foldedContent.includes(claim.inner);
  }
  return claim.values.some((v) => source.numbers.some((n) => sameNumber(v, n)));
}

// ── Verificador ──────────────────────────────────────────────────────────────

/**
 * Classe 2 — diff determinístico das claims do core_content contra o contexto
 * selecionado. Retorna Audit['grounding'] + o texto com [VERIFICAR: …] aplicado.
 */
export function verifyGrounding(input: GroundingInput): GroundingReport {
  const { core, context_ids } = input;
  const text = renderCoreContentText(core);
  const checked: CheckedEntry[] = [];
  const flagged: FlaggedEntry[] = [];
  let structuralFailure = false;

  const sources = input.sources
    .filter((s) => context_ids.includes(s.item_id))
    .map(indexSource);
  const proofSource = core.proof.context_item_id
    ? sources.find((s) => s.item_id === core.proof.context_item_id) ?? null
    : null;

  // Regra estrutural: proof.context_item_id ∈ context_ids.
  if (core.proof.context_item_id !== null && !context_ids.includes(core.proof.context_item_id)) {
    flagged.push({
      claim: core.proof.claim,
      reason: 'proof_not_in_context',
    });
    structuralFailure = true;
  }

  // Diff claim a claim.
  const claims = extractClaims(text);
  const foldedProofClaim = fold(core.proof.claim);
  const toReplace: Array<{ position: number; length: number; claim: string }> = [];

  for (const claim of claims) {
    const match = sources.find((s) => claimMatchesSource(claim, s)) ?? null;
    if (match) {
      checked.push({ claim: claim.claim, source_item_id: match.item_id, status: 'ok' });
      continue;
    }

    const belongsToProof =
      foldedProofClaim.length > 0 &&
      (foldedProofClaim.includes(fold(claim.claim)) || fold(claim.claim).includes(foldedProofClaim));

    if (belongsToProof && proofSource) {
      // A prova declara fonte, mas o número/quote não está nela = número
      // alterado/inventado — regra "nunca alterar número": falha DURA.
      checked.push({
        claim: claim.claim,
        source_item_id: proofSource.item_id,
        status: 'divergent',
      });
      flagged.push({
        claim: claim.claim,
        reason: 'divergent_from_source',
        replaced_with: `[VERIFICAR: ${claim.claim}]`,
      });
      toReplace.push({ position: claim.position, length: claim.claim.length, claim: claim.claim });
      structuralFailure = true;
      continue;
    }

    // Sem fonte no contexto → vira [VERIFICAR] (não bloqueia a saga).
    checked.push({ claim: claim.claim, source_item_id: null, status: 'missing' });
    flagged.push({
      claim: claim.claim,
      reason: 'not_found_in_context',
      replaced_with: `[VERIFICAR: ${claim.claim}]`,
    });
    toReplace.push({ position: claim.position, length: claim.claim.length, claim: claim.claim });
  }

  // Regra estrutural: exatamente 1 prova central por peça — mais de um case
  // citado (número/quote/nome presentes no texto) = falha, volta p/ reescrita.
  const foldedText = fold(text);
  const citedCases = sources.filter((s) => {
    if (s.kind !== 'case') return false;
    if (s.caseMeta?.quote && foldedText.includes(fold(s.caseMeta.quote))) return true;
    if (s.caseMeta?.client_name && foldedText.includes(fold(s.caseMeta.client_name))) return true;
    if (typeof s.caseMeta?.metric_value === 'number') {
      return claims.some(
        (c) => c.kind === 'number' && c.values.some((v) => sameNumber(v, s.caseMeta!.metric_value)),
      );
    }
    return false;
  });
  if (citedCases.length > 1) {
    flagged.push({
      claim: citedCases.map((c) => c.item_id).join(', '),
      reason: 'multiple_cases_cited',
    });
    structuralFailure = true;
  }

  // Regra estrutural: citation_policy 'anonymous' com nome do cliente no texto.
  for (const s of sources) {
    if (
      s.caseMeta?.citation_policy === 'anonymous' &&
      s.caseMeta.client_name &&
      foldedText.includes(fold(s.caseMeta.client_name))
    ) {
      flagged.push({
        claim: s.caseMeta.client_name,
        reason: 'citation_policy_violation',
      });
      structuralFailure = true;
    }
  }

  // Aplica as substituições [VERIFICAR: …] de trás para frente (preserva índices).
  let outText = text;
  toReplace.sort((a, b) => b.position - a.position);
  for (const r of toReplace) {
    outText =
      outText.slice(0, r.position) +
      `[VERIFICAR: ${r.claim}]` +
      outText.slice(r.position + r.length);
  }

  return {
    passed: !structuralFailure,
    checked,
    flagged,
    text: outText,
  };
}
