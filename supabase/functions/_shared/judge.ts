// _shared/judge.ts — Classe 3 da auditoria: juiz semântico (LLM-as-judge).
// Fonte: docs/06-arquitetura-ia.md §2.3, §4.3 e §1.3.
//
// SEMPRE em chamada de LLM separada do Gerador (papel 'judge' do llm.ts), com
// structured output do schema Audit['judge']. Além do veredito do modelo, este
// módulo aplica em CÓDIGO a regra dura do 06 §4.3: verdict = 'rewrite' sempre
// que qualquer regra falhar, voice_pass/bridge_logical falharem OU
// score < nota de corte do canal — o LLM não tem a palavra final sobre o gate.

import { chat } from './llm.ts';
import type { Audit } from './types.ts';
import { JUDGE_SCHEMA, judgePrompt, type JudgePromptInput } from './prompts/judge.ts';

export type JudgeVerdict = Audit['judge'];

const RULE_NAMES = ['novidade', 'aplicabilidade', 'proprietario', 'narrativa'] as const;
type RuleName = (typeof RULE_NAMES)[number];

export interface JudgePieceResult {
  judge: JudgeVerdict;
  /** usage normalizado da chamada (telemetria em generation_jobs.timings). */
  usage: Awaited<ReturnType<typeof chat>>['usage'];
  provider: string;
  model: string;
}

// ── Validação/coerção do structured output ───────────────────────────────────

function coerceVerdict(raw: unknown): JudgeVerdict {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Juiz retornou payload não-objeto para o schema Audit.judge.');
  }
  const r = raw as Record<string, unknown>;

  const scoreNum = typeof r.score === 'number' && Number.isFinite(r.score) ? r.score : NaN;
  if (Number.isNaN(scoreNum)) {
    throw new Error('Juiz retornou score inválido (esperado número 0-10).');
  }
  const score = Math.min(10, Math.max(0, scoreNum));

  const rawRules = Array.isArray(r.rules) ? r.rules : [];
  const rules: JudgeVerdict['rules'] = [];
  for (const name of RULE_NAMES) {
    const found = rawRules.find(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === 'object' && (item as Record<string, unknown>).rule === name,
    );
    rules.push({
      rule: name as RuleName,
      // Regra ausente no output = tratada como reprovada (conservador).
      passed: found ? found.passed === true : false,
      ...(found && typeof found.note === 'string' ? { note: found.note } : {}),
    });
  }

  const diagnosis = Array.isArray(r.diagnosis)
    ? r.diagnosis.filter((d): d is string => typeof d === 'string')
    : [];

  return {
    verdict: r.verdict === 'approve' ? 'approve' : 'rewrite',
    score,
    rules,
    voice_pass: r.voice_pass === true,
    bridge_logical: r.bridge_logical === true,
    diagnosis,
  };
}

/** Regra dura do gate (06 §4.3), aplicada em código sobre o veredito do LLM. */
function enforceGate(verdict: JudgeVerdict, cutoffScore: number): JudgeVerdict {
  const anyRuleFailed = verdict.rules.some((r) => !r.passed);
  const mustRewrite =
    anyRuleFailed ||
    !verdict.voice_pass ||
    !verdict.bridge_logical ||
    verdict.score < cutoffScore;

  if (!mustRewrite) return { ...verdict, verdict: 'approve' };

  const diagnosis = [...verdict.diagnosis];
  if (verdict.score < cutoffScore) {
    const note = `Score ${verdict.score} abaixo da nota de corte do canal (${cutoffScore}).`;
    if (!diagnosis.includes(note)) diagnosis.push(note);
  }
  return { ...verdict, verdict: 'rewrite', diagnosis };
}

// ── API pública ──────────────────────────────────────────────────────────────

/**
 * Julga uma peça: monta o prompt do juiz, chama o papel 'judge' com structured
 * output e devolve Audit['judge'] com o gate da nota de corte aplicado em código.
 * Erros de provider sobem como LlmError (llm.ts) para o runner da saga tratar.
 */
export async function judgePiece(input: JudgePromptInput): Promise<JudgePieceResult> {
  const { system, user } = judgePrompt(input);

  const result = await chat({
    role_hint: 'judge',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    schema: JUDGE_SCHEMA,
  });

  const verdict = enforceGate(coerceVerdict(result.parsed), input.cutoff_score);

  return {
    judge: verdict,
    usage: result.usage,
    provider: result.provider,
    model: result.model,
  };
}
