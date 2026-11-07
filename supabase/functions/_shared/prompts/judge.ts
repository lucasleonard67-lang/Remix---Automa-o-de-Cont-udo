// _shared/prompts/judge.ts — prompt do Juiz (papel 'judge').
// Fonte: docs/06-arquitetura-ia.md §2.3, §4.3 e §1.3.
//
// LLM-as-judge, Classe 3 da auditoria — SEMPRE em chamada separada do Gerador
// (auto-avaliação sofre de self-preference bias). Aplica a rubrica das 4 regras
// editoriais + arco do funil + ponte lógica + voz e devolve veredito com nota.
//
// Estrutura {system, user}: o Juiz mantém o PRÓPRIO prefixo cacheado (rubrica +
// persona + guardrails — 06 §7); o sufixo variável leva a peça, o briefing, o
// case e a nota de corte.

import type {
  AngleOption,
  GuardrailsContent,
  PersonaContent,
} from '../types.ts';
import { ENGINE_VERSION } from '../types.ts';
import { FUNNEL_CHECKLIST, funnelPromptBlock } from '../funnel.ts';
import { compileGuardrails, compilePersona } from './compile.ts';
import type { ContextBlock } from './generator.ts';

/** Exemplo de calibração vindo de piece_feedback (few-shot, incl. gate de tom). */
export interface FeedbackExample {
  excerpt: string;
  verdict: 'approved' | 'rejected';
  note?: string;
}

export interface JudgePromptInput {
  /** Versão ativa de brand_persona.content (para julgar aderência de voz). */
  persona: PersonaContent;
  /** Versão ativa de guardrails.content (qa_rubric complementa a rubrica default). */
  guardrails: GuardrailsContent;
  /** Peça: core_content renderizado como texto corrido (funnel.renderCoreContentText). */
  piece_text: string;
  /** Tese do briefing (classification.thesis). */
  thesis: string | null;
  /** Ângulo escolhido do job. */
  selected_angle: AngleOption;
  /** Bloco do case selecionado (prova central), quando houver. */
  case_block?: ContextBlock;
  /** Nota de corte do canal alvo (guardrails.approval_threshold + channels.config.cutoff_score). */
  cutoff_score: number;
  /** Exemplos de piece_feedback como few-shot de calibração (quando existirem). */
  feedback_examples?: FeedbackExample[];
}

/**
 * Schema de structured output do Juiz — transcrito de 06-arquitetura-ia.md §2.3
 * (gravado em content_pieces.audit.judge).
 */
export const JUDGE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'score', 'rules', 'voice_pass', 'bridge_logical', 'diagnosis'],
  properties: {
    verdict: { enum: ['approve', 'rewrite'] },
    score: {
      type: 'number', minimum: 0, maximum: 10,
      description: '0-10, comparado ao cutoff_score do canal',
    },
    rules: {
      type: 'array', minItems: 4, maxItems: 4,
      items: {
        type: 'object', additionalProperties: false,
        required: ['rule', 'passed'],
        properties: {
          rule: { enum: ['novidade', 'aplicabilidade', 'proprietario', 'narrativa'] },
          passed: { type: 'boolean' },
          note: { type: 'string' },
        },
      },
    },
    voice_pass: { type: 'boolean', description: 'Passa no voice_checklist da persona?' },
    bridge_logical: {
      type: 'boolean',
      description: 'Ponte da camada 8 é lógica (não colada na oferta)?',
    },
    diagnosis: {
      type: 'array',
      items: { type: 'string' },
      description: 'Problemas acionáveis (citando a camada do funil quando aplicável) — alimenta a reescrita',
    },
  },
};

function rubricPrompt(guardrails: GuardrailsContent): string {
  const lines: string[] = [
    `Você é o JUIZ do motor editorial (engine v${ENGINE_VERSION}) de uma marca. Você recebe uma peça PRONTA ` +
      '(escrita por outro modelo) e devolve um veredito estruturado. Você não reescreve a peça — você julga ' +
      'e diagnostica. Seja rigoroso: seu papel é impedir que conteúdo genérico ou frouxo seja publicado.',
    '',
    'RUBRICA — AS 4 REGRAS EDITORIAIS (cada uma com passed + note):',
    '1. novidade — o leitor sai com algo novo (informação, ângulo ou síntese que ele não tinha). ' +
      'Refrito de senso comum = reprova a regra.',
    '2. aplicabilidade — é acionável/aplicável para o ICP; não é abstração vazia nem motivação genérica.',
    '3. proprietario — a pergunta-guilhotina: "essa peça poderia ter saído em qualquer perfil? Se sim, REPROVA." ' +
      'Exige leitura clara da tese/opinião da marca no texto. É a defesa central contra conteúdo genérico de IA.',
    '4. narrativa — a história é interessante SOZINHA (sem a marca); o arco prende do gancho à moral.',
    '',
    'ALÉM DAS 4 REGRAS, verifique:',
    '- voice_pass: a peça passa no checklist de voz do contrato abaixo ("soa como o dono da marca falando?").',
    '- bridge_logical: a camada 8 aterrissa na oferta por LÓGICA (consequência da moral), não colada. ' +
      'Ponte colada → bridge_logical = false e diagnóstico pedindo reescrita DA PONTE, não da peça inteira.',
    '- Arco do funil: camadas ausentes, fora de ordem ou fazendo o trabalho de outra entram no diagnosis, ' +
      'citando a camada (ex.: "Camada 6: prova sem número").',
    '- Prova: a prova central sustenta o ensino? Número/quote coerente com o case fornecido?',
    '',
    funnelPromptBlock(),
    '',
    'SCORE (0-10): qualidade editorial global da peça. 9-10 = publicável como está, acima da média do nicho; ' +
      '7-8 = boa, ajustes menores; 5-6 = mediana, precisa reescrita; <5 = fraca. O score será comparado à nota ' +
      'de corte do canal informada no pedido.',
    '',
    'VEREDITO: verdict = "rewrite" SEMPRE que qualquer uma das 4 regras falhar, voice_pass = false, ' +
      'bridge_logical = false OU score < nota de corte. Caso contrário, "approve". Em rewrite, diagnosis traz ' +
      'problemas ACIONÁVEIS (o Gerador reescreve a partir deles), citando a camada do funil quando aplicável.',
    '',
    `Checklist estrutural de referência:\n${FUNNEL_CHECKLIST.map((c) => `- ${c}`).join('\n')}`,
  ];

  const rubricKeys = Object.keys(guardrails.qa_rubric).sort();
  if (rubricKeys.length > 0) {
    lines.push('', 'INSTRUÇÕES EXTRAS DE RUBRICA DESTA MARCA (qa_rubric):');
    for (const key of rubricKeys) lines.push(`- ${key}: ${guardrails.qa_rubric[key]}`);
  }

  lines.push('', 'Responda APENAS o JSON do schema pedido.');
  return lines.join('\n');
}

export function judgePrompt(input: JudgePromptInput): { system: string; user: string } {
  // Prefixo estável PRÓPRIO do juiz: rubrica → persona → guardrails (06 §7).
  const system = [
    rubricPrompt(input.guardrails),
    compilePersona(input.persona),
    compileGuardrails(input.guardrails),
  ].join('\n\n');

  const userParts: string[] = [
    '# BRIEFING DA PEÇA',
    `Tese que a peça deveria sustentar: ${input.thesis ?? '(nenhuma tese específica no briefing)'}`,
    `Ângulo escolhido: ${input.selected_angle.title}`,
    `Hook prometido: ${input.selected_angle.hook}`,
    `Nota de corte deste canal: ${input.cutoff_score} (score abaixo disso ⇒ verdict = "rewrite")`,
  ];

  if (input.case_block) {
    userParts.push(
      '',
      '# CASE SELECIONADO (prova central — julgue se sustenta o ensino)',
      `item ${input.case_block.item_id} · "${input.case_block.title}"`,
    );
    if (input.case_block.metadata && Object.keys(input.case_block.metadata).length > 0) {
      userParts.push(`metadata: ${JSON.stringify(input.case_block.metadata)}`);
    }
    userParts.push(input.case_block.content.trim());
  }

  if (input.feedback_examples?.length) {
    userParts.push('', '# CALIBRAÇÃO (vereditos anteriores do dono da marca sobre peças desta instância)');
    for (const ex of input.feedback_examples) {
      const note = ex.note ? ` — "${ex.note}"` : '';
      userParts.push(`- [${ex.verdict === 'approved' ? 'APROVOU' : 'REJEITOU'}]${note}: "${ex.excerpt}"`);
    }
  }

  userParts.push('', '# PEÇA A JULGAR', input.piece_text.trim(), '', 'Julgue agora.');

  return { system, user: userParts.join('\n') };
}
