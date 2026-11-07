// _shared/prompts/voice-extractor.ts — prompt do Extrator de Voz (papel 'voice_extractor').
// Fonte: docs/06-arquitetura-ia.md §2.4.
//
// Usado no onboarding (passo 4) via edge function extract-voice. Com corpus:
// produz um RASCUNHO das 9 seções do contrato de voz (o humano aceita/edita cada
// seção — nunca aceita cego). Sem corpus: entrevista guiada — o extrator gera a
// próxima pergunta em função das respostas (um dos 3 nós com autonomia real).

import { ENGINE_VERSION } from '../types.ts';
import type { ContextKind } from '../types.ts';

/** Item do corpus inicial (transcrições/posts selecionados). */
export interface CorpusItem {
  title: string;
  kind: ContextKind;
  content: string;
}

/** Template de nicho para pré-popular arquétipos/postura quando o corpus é fraco. */
export interface NicheTemplateHint {
  editorial_stance?: string;
  archetypes?: Array<{ name: string; description: string }>;
  hook_families?: Array<{ name: string; pattern: string; example: string }>;
}

export interface VoiceExtractorPromptInput {
  corpus: CorpusItem[];
  niche_template?: NicheTemplateHint | null;
}

/**
 * Schema de structured output do Extrator de Voz — transcrito de
 * 06-arquitetura-ia.md §2.4 (rascunho do content de brand_persona; só vira
 * versão active após edição/aprovação humana).
 */
export const VOICE_EXTRACTOR_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['identity', 'credenciais', 'worldview', 'tone_principles', 'signature_lexicon',
             'calibration_heuristics', 'banlist', 'opinioes', 'voice_checklist', 'reference_examples'],
  properties: {
    identity: {
      type: 'object', required: ['name', 'role', 'positioning', 'audience'], additionalProperties: false,
      properties: {
        name: { type: 'string' }, role: { type: 'string' },
        positioning: { type: 'string' }, audience: { type: 'string' },
      },
    },
    credenciais: {
      type: 'array',
      items: {
        type: 'object', required: ['claim', 'source'], additionalProperties: false,
        properties: { claim: { type: 'string' }, source: { type: 'string' } },
      },
    },
    worldview: {
      type: 'object', required: ['summary', 'theses'], additionalProperties: false,
      properties: {
        summary: { type: 'string' },
        theses: {
          type: 'array', items: { type: 'string' },
          description: 'Teses candidatas detectadas no corpus',
        },
      },
    },
    tone_principles: { type: 'array', items: { type: 'string' } },
    signature_lexicon: {
      type: 'array',
      items: {
        type: 'object', required: ['term', 'usage', 'max_per_piece'], additionalProperties: false,
        properties: {
          term: { type: 'string' },
          usage: { type: 'string', description: 'Quando/como usar' },
          max_per_piece: { type: 'integer', description: 'Dosagem: máx 1-2' },
        },
      },
    },
    calibration_heuristics: { type: 'array', items: { type: 'string' } },
    banlist: {
      type: 'object', required: ['ref'], additionalProperties: false,
      properties: { ref: { type: 'string', enum: ['guardrails'] } },
      description:
        'Referência à fonte única em guardrails — o extrator só SUGERE adições (fora deste campo), nunca duplica',
    },
    opinioes: {
      type: 'array',
      items: {
        type: 'object', required: ['topic', 'stance'], additionalProperties: false,
        properties: { topic: { type: 'string' }, stance: { type: 'string' } },
      },
    },
    voice_checklist: { type: 'array', items: { type: 'string' } },
    reference_examples: {
      type: 'object', required: ['good', 'bad'], additionalProperties: false,
      properties: {
        good: {
          type: 'array',
          items: {
            type: 'object', required: ['text', 'why'], additionalProperties: false,
            properties: { text: { type: 'string' }, why: { type: 'string' } },
          },
        },
        bad: {
          type: 'array',
          items: {
            type: 'object', required: ['text', 'why'], additionalProperties: false,
            properties: { text: { type: 'string' }, why: { type: 'string' } },
          },
        },
      },
    },
  },
};

function extractorSystem(): string {
  return [
    `Você é o EXTRATOR DE VOZ do motor editorial (engine v${ENGINE_VERSION}). A partir do corpus da marca ` +
      '(transcrições, posts, documentos), você produz um RASCUNHO do contrato de voz de 9 seções. O rascunho ' +
      'será revisado seção a seção por um humano — seja específico e citável, nunca genérico.',
    '',
    'AS 9 SEÇÕES DO CONTRATO DE VOZ:',
    '1. identity — quem fala: nome, papel, posicionamento em 1 parágrafo, para quem fala.',
    '2. credenciais — provas de autoridade encontradas no corpus, SEMPRE com fonte (trecho/item de origem). ' +
      'Sem fonte verificável no corpus = não entra.',
    '3. worldview — visão de mundo + teses candidatas DETECTADAS no corpus (posições repetidas, ' +
      'bandeiras defendidas), não inventadas.',
    '4. tone_principles — como a voz soa (ritmo, registro, o que ela faz e o que nunca faz).',
    '5. signature_lexicon — termos/expressões assinatura recorrentes, com uso e dosagem (max_per_piece 1, ' +
      'teto 2). Só o que é realmente distintivo.',
    '6. calibration_heuristics — heurísticas de ajuste fino ("se soar consultoria genérica, adicionar opinião").',
    'banlist — apenas a referência {"ref": "guardrails"}: a ban list vive nos guardrails, nunca aqui. ' +
      'Tiques a banir que você detectar viram sugestões em calibration_heuristics.',
    '7. opinioes — posições explícitas e citáveis encontradas no corpus (topic + stance em uma frase).',
    '8. voice_checklist — checklist final de conformidade ("soa como o dono da marca falando?"), derivado ' +
      'dos padrões reais do corpus.',
    '9. reference_examples — trechos REAIS do corpus como exemplos bons (com o porquê) e contraexemplos ' +
      'ruins (reescritas genéricas do mesmo conteúdo, com o porquê).',
    '',
    'REGRAS:',
    '- Tudo sai do corpus: cite/parafraseie o que está lá; não projete uma voz idealizada.',
    '- Corpus fraco em alguma seção: preencha o mínimo defensável e deixe-a curta — o humano completa. ' +
      'Use o template de nicho (quando fornecido) apenas como fallback de postura/arquétipos.',
    '- Escreva em pt-BR. Responda APENAS o JSON do schema pedido.',
  ].join('\n');
}

export function voiceExtractorPrompt(input: VoiceExtractorPromptInput): { system: string; user: string } {
  const userParts: string[] = [];

  if (input.niche_template) {
    const t = input.niche_template;
    userParts.push('# TEMPLATE DE NICHO (fallback quando o corpus for fraco)');
    if (t.editorial_stance) userParts.push(`Postura editorial sugerida: ${t.editorial_stance}`);
    if (t.archetypes?.length) {
      userParts.push('Arquétipos:');
      for (const a of t.archetypes) userParts.push(`- ${a.name}: ${a.description}`);
    }
    if (t.hook_families?.length) {
      userParts.push('Famílias de hook:');
      for (const h of t.hook_families) userParts.push(`- ${h.name} — padrão: ${h.pattern} (ex.: ${h.example})`);
    }
    userParts.push('');
  }

  userParts.push(`# CORPUS (${input.corpus.length} itens)`);
  for (const item of input.corpus) {
    userParts.push('', `--- ${item.kind} · "${item.title}"`, item.content.trim());
  }
  userParts.push('', 'Extraia o contrato de voz agora.');

  return { system: extractorSystem(), user: userParts.join('\n') };
}

// ── Modo entrevista (sem corpus) ─────────────────────────────────────────────

export interface InterviewTurn {
  question: string;
  answer: string;
}

/**
 * Prompt do modo entrevista guiada: gera a PRÓXIMA pergunta em função das
 * respostas anteriores (autonomia cirúrgica do 06 §1.1). O frontend conduz;
 * ao final, as respostas viram corpus para voiceExtractorPrompt.
 */
export function voiceInterviewPrompt(turns: InterviewTurn[]): { system: string; user: string } {
  const system = [
    `Você conduz a ENTREVISTA DE EXTRAÇÃO DE VOZ do motor editorial (engine v${ENGINE_VERSION}) — o cliente ` +
      'não tem corpus de conteúdo. Objetivo: coletar matéria-prima para as 9 seções do contrato de voz ' +
      '(identidade, credenciais com fonte, visão de mundo/teses, tom, léxico assinatura, heurísticas, ' +
      'opiniões, checklist de voz, exemplos).',
    '',
    'REGRAS:',
    '- UMA pergunta por vez, em pt-BR, direta e concreta — a próxima pergunta nasce da resposta anterior ' +
      '(aprofunde o que veio específico; destrave o que veio genérico pedindo exemplo real).',
    '- Priorize lacunas: seções ainda sem matéria-prima vêm primeiro.',
    '- Peça sempre o CASO CONCRETO por trás de afirmações genéricas ("me conte uma vez em que...").',
    '- Máximo de ~10 perguntas no total; quando as 9 seções tiverem matéria-prima suficiente, responda ' +
      'exatamente DONE (e nada mais).',
    '- Responda APENAS com o texto da próxima pergunta (ou DONE).',
  ].join('\n');

  const userParts: string[] = ['# ENTREVISTA ATÉ AQUI'];
  if (turns.length === 0) {
    userParts.push('(nenhuma pergunta feita ainda — abra a entrevista)');
  } else {
    for (const turn of turns) {
      userParts.push(`P: ${turn.question}`, `R: ${turn.answer}`, '');
    }
  }
  userParts.push('Qual é a próxima pergunta?');

  return { system, user: userParts.join('\n') };
}
