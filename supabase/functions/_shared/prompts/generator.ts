// _shared/prompts/generator.ts — prompt do Gerador (papel 'generator').
// Fonte: docs/06-arquitetura-ia.md §2.2, §1.2 (envelope de altitude) e §7 (caching).
//
// O Gerador é função pura: briefing + voz + contexto → core_content. Escreve a
// IDEIA e o CONTEÚDO núcleo no funil de 8 camadas, na voz contratada. Nunca fala
// com o usuário, nunca escolhe case, nunca se auto-aprova. Adaptação por canal é
// dos adapters (código), não dele.
//
// Estrutura {system, user}:
//   system = PREFIXO ESTÁVEL cacheável: prompt do motor (funil + formato de saída
//            + regras duras de grounding) + persona compilada + guardrails compilados.
//            Serialização determinística — qualquer byte diferente invalida o cache.
//   user   = SUFIXO VARIÁVEL: briefing (classification + selected_angle) + contexto
//            RAG + diagnóstico de reescrita / instrução de regeneração.

import type {
  AngleOption,
  Classification,
  ContextKind,
  GuardrailsContent,
  PersonaContent,
  RewriteDiagnosis,
} from '../types.ts';
import { ENGINE_VERSION } from '../types.ts';
import { funnelPromptBlock } from '../funnel.ts';
import { compileGuardrails, compilePersona } from './compile.ts';

/** Bloco de contexto selecionado pelo Retrieval (context_ids do job). */
export interface ContextBlock {
  item_id: string;
  title: string;
  kind: ContextKind;
  content: string;
  /** Metadata tipada quando kind = 'case' (CaseMetadata). */
  metadata?: Record<string, unknown>;
}

export interface GeneratorPromptInput {
  /** Versão ativa de brand_persona.content. */
  persona: PersonaContent;
  /** Versão ativa de guardrails.content. */
  guardrails: GuardrailsContent;
  /** Saída do Roteador (generation_jobs.classification). */
  classification: Classification;
  /** Ângulo escolhido (generation_jobs.selected_angle). */
  selected_angle: AngleOption;
  /** Chunks/itens de context_ids, com o case central e sua metadata. */
  context_blocks: ContextBlock[];
  /** Em reescrita: diagnóstico estruturado consolidado da auditoria (06 §4.4). */
  diagnosis?: RewriteDiagnosis;
  /** Em regeneração guiada (regenerate-piece): instrução do usuário. */
  instruction?: string;
  /** F3.8 — provas/temas usados recentemente (editorial_state): o gerador evita repetir. */
  recent_usage?: { proof_claims: string[]; themes: string[] };
  /** F4.1 — trechos de peças APROVADAS pelo dono, como referência de ESTILO (nunca de prova). */
  style_refs?: string[];
  /** Bloco pronto da referência de estilo ligada na aba Fontes. */
  reference_style?: string;
}

/**
 * Schema de structured output do Gerador — transcrito de 06-arquitetura-ia.md
 * §2.2 (gravado como content_pieces.core_content).
 */
export const CORE_CONTENT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['idea', 'hook', 'funnel_blocks', 'proof', 'verify_flags', 'cta', 'image_brief'],
  properties: {
    idea: { type: 'string', description: 'A IDEIA central da peça, em uma frase' },
    hook: {
      type: 'object', additionalProperties: false,
      required: ['visual', 'written'],
      properties: {
        visual: { type: 'string', description: 'Gancho visual (camada 1)' },
        written: { type: 'string', description: 'Gancho escrito (camada 2)' },
        spoken: { type: 'string', description: 'Gancho falado (camada 3), quando o formato pede' },
      },
    },
    funnel_blocks: {
      type: 'array', minItems: 8, maxItems: 8,
      items: {
        type: 'object', additionalProperties: false,
        required: ['layer', 'name', 'content'],
        properties: {
          layer: {
            type: 'integer',
            description:
              '1..8 (gancho visual, gancho escrito, gancho falado, contexto/Ponto A, virada/Ponto B, ensino+prova, moral/tese, autoridade+CTA)',
          },
          name: { type: 'string', description: 'Nome da camada (ex.: "virada/Ponto B")' },
          content: { type: 'string' },
        },
      },
    },
    proof: {
      type: 'object', additionalProperties: false,
      required: ['claim', 'context_item_id'],
      properties: {
        claim: { type: 'string', description: 'Afirmação exata (número/quote) usada como prova central' },
        context_item_id: {
          type: ['string', 'null'],
          description: 'uuid do context_item da prova central; deve pertencer a context_ids do job',
        },
        source_url: { type: 'string', description: 'URL da fonte, quando houver' },
      },
      description: 'Prova central declarada, insumo do grounding',
    },
    verify_flags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Dados faltantes marcados [VERIFICAR: x] pelo próprio gerador',
    },
    cta: { type: 'string', description: 'CTA escolhido do repertório permitido (allowed_ctas)' },
    image_brief: {
      type: ['string', 'null'],
      description: 'Brief textual para generate-image (null quando a peça não pede imagem)',
    },
  },
};

function enginePrompt(): string {
  return [
    `Você é o GERADOR do motor editorial (engine v${ENGINE_VERSION}) de uma marca. ` +
      'Você escreve a IDEIA e o CONTEÚDO núcleo de UMA peça, seguindo o funil narrativo de 8 camadas, ' +
      'na voz contratada abaixo. Você não fala com o usuário, não escolhe case, não se auto-aprova e não ' +
      'adapta para canal — a adaptação é feita por código depois.',
    '',
    funnelPromptBlock(),
    '',
    'REGRAS DURAS (violar qualquer uma reprova a peça na auditoria):',
    '- NUNCA invente número, case, cliente ou citação. Todo dado vem do CONTEXTO SELECIONADO do briefing.',
    '- NUNCA altere ou arredonde um número da fonte.',
    '- Exatamente 1 prova central por peça: escolha o melhor case/dado do contexto, use na camada 6 e ' +
      'declare em proof {claim exata, context_item_id do item de origem, source_url quando houver}.',
    '- Se o case tiver citation_policy = "anonymous", NUNCA escreva o nome do cliente — anonimize ' +
      '("um cliente do setor X"). Se for "named", cite o nome.',
    '- Dado que faria a peça melhor mas NÃO está no contexto: escreva a marcação [VERIFICAR: descreva o dado] ' +
      'no lugar e liste a pendência em verify_flags. Chutar é proibido.',
    '- PROIBIDA a construção de antítese, em QUALQUER forma: "não é X, é Y", "não são X, são Y", ' +
      '"não é X, e sim Y", "não é X, mas sim Y" — e também a versão quebrada em duas frases ' +
      '("Não se constrói com X. Constrói-se com Y."). Quebrar em duas frases NÃO resolve: o ' +
      'linter pega a versão de uma frase e o juiz pega a de duas. É a violação mais comum e ' +
      'reprova a peça. ' +
      'ERRADO: "Não é falta de gente, é falta de processo." ' +
      'ERRADO: "O problema não era a equipe. Era o processo." ' +
      'CERTO: "O gargalo estava no processo — a equipe só absorvia o retrabalho." ' +
      'CERTO: "Toda a perda vinha de um processo sem dono." ' +
      'A saída é AFIRMAR direto o que é, e deixar o contraste implícito no contexto. Se sentir ' +
      'vontade de negar antes de afirmar, corte a negação e comece pela afirmação.',
    '- A camada 6 (ensino + prova) tem que carregar o RESULTADO com número da fonte — não o ' +
      'mecanismo, não a explicação de como funciona. O mecanismo é bem-vindo na mesma camada, ' +
      'mas só DEPOIS do número. Sem número verificável na camada 6, a peça é reprovada.',
    '- O CTA sai do repertório permitido dos guardrails; a camada 8 chega nele por ponte LÓGICA.',
    '- O núcleo é AGNÓSTICO DE CANAL, mesmo que o briefing liste canais alvo: nada de hashtag, ' +
      '@menção, emoji decorativo, numeração de slides, "arrasta pro lado", corte por limite de ' +
      'caracteres ou qualquer formatação de rede social. Quem corta, numera e adapta é o código, depois. ' +
      'Escreva o conteúdo completo e deixe a adaptação para o adapter.',
    '- Escreva em pt-BR, na voz do contrato abaixo, respeitando TODOS os guardrails.',
    '',
    'FORMATO DE SAÍDA: responda APENAS o JSON do schema pedido. funnel_blocks tem EXATAMENTE 8 blocos, ' +
      'layers 1 a 8 na ordem, cada um com o nome canônico da camada. hook.visual/written/spoken espelham ' +
      'as camadas 1-3. idea é a ideia central em uma frase.',
  ].join('\n');
}

function serializeBriefing(classification: Classification, angle: AngleOption): string {
  const lines: string[] = ['# BRIEFING'];
  lines.push(`Formato: ${classification.format ?? '(livre — o núcleo é agnóstico de canal)'}`);
  lines.push(`Canais alvo: ${classification.channel_types.join(', ')}`);
  lines.push(`Tese a sustentar: ${classification.thesis ?? '(nenhuma tese específica — use a moral da história)'}`);
  lines.push(`Ângulo escolhido: ${angle.title}`);
  lines.push(`Hook do ângulo (honre esta capa): ${angle.hook}`);
  if (angle.rationale) lines.push(`Racional do ângulo: ${angle.rationale}`);
  return lines.join('\n');
}

function serializeContext(blocks: ContextBlock[]): string {
  const lines: string[] = [
    '# CONTEXTO SELECIONADO (única fonte permitida de dados, números e citações)',
  ];
  if (blocks.length === 0) {
    lines.push(
      '(vazio — não há fonte para provas: NÃO use nenhum número/case; marque [VERIFICAR] onde faria falta ' +
        'e deixe proof.context_item_id = null)',
    );
    return lines.join('\n');
  }
  for (const block of blocks) {
    lines.push('');
    lines.push(`--- item ${block.item_id} · kind: ${block.kind} · "${block.title}"`);
    if (block.metadata && Object.keys(block.metadata).length > 0) {
      lines.push(`metadata: ${JSON.stringify(block.metadata)}`);
    }
    lines.push(block.content.trim());
  }
  return lines.join('\n');
}

/** F3.8 — anti-repetição: lista do que saiu recentemente, com regra SUAVE. */
function serializeRecentUsage(usage: { proof_claims: string[]; themes: string[] }): string {
  const lines: string[] = ['# ANTI-REPETIÇÃO (peças recentes desta marca)'];
  if (usage.proof_claims.length > 0) {
    lines.push('Provas usadas recentemente:');
    for (const claim of usage.proof_claims) lines.push(`- "${claim}"`);
  }
  if (usage.themes.length > 0) {
    lines.push('Temas/ângulos recentes:');
    for (const theme of usage.themes) lines.push(`- ${theme}`);
  }
  lines.push(
    'PREFIRA prova e ângulo diferentes dos listados. Repetir uma prova recente SÓ é aceitável ' +
      'se o contexto selecionado não oferecer alternativa equivalente — e mesmo assim, mude o ângulo.',
  );
  return lines.join('\n');
}

/** F4.1 — few-shot de estilo: peças aprovadas calibram tom, nunca viram fonte. */
function serializeStyleRefs(refs: string[]): string {
  const lines: string[] = [
    '# REFERÊNCIAS DE ESTILO (trechos de peças APROVADAS pelo dono da marca)',
    'Use como calibração de tom, ritmo e altitude — o que o dono considera bom. ' +
      'NÃO copie frases nem estruturas inteiras. Os valores numéricos foram substituídos por ' +
      '[valor]/[número] de propósito: estes trechos NÃO são fonte de dados — todo dado da peça ' +
      'nova sai APENAS do CONTEXTO SELECIONADO.',
  ];
  refs.forEach((ref, index) => {
    lines.push(`Exemplo ${index + 1}: "${ref}"`);
  });
  return lines.join('\n');
}

function serializeDiagnosis(diagnosis: RewriteDiagnosis): string {
  const lines: string[] = [
    `# DIAGNÓSTICO DA REESCRITA (tentativa ${diagnosis.attempt} — corrija TODOS os pontos abaixo)`,
  ];
  for (const failure of diagnosis.failures) {
    switch (failure.class) {
      case 'linter':
        lines.push('Violações do linter (regras duras):');
        for (const v of failure.violations) {
          lines.push(`- [${v.rule}] trecho proibido: "${v.match}"`);
        }
        break;
      case 'grounding':
        lines.push('Falhas de grounding (dados sem fonte no contexto):');
        for (const f of failure.flagged) {
          lines.push(`- claim "${f.claim}" — ${f.reason}`);
        }
        break;
      case 'judge':
        lines.push('Diagnóstico do juiz:');
        for (const d of failure.diagnosis) lines.push(`- ${d}`);
        break;
    }
  }
  lines.push(
    'Reescreva a peça inteira resolvendo o diagnóstico, mantendo briefing, voz, guardrails e a MESMA prova central ' +
      '(salvo quando o diagnóstico apontar problema na prova).',
  );
  return lines.join('\n');
}

export function generatorPrompt(input: GeneratorPromptInput): { system: string; user: string } {
  // Prefixo estável: motor → persona → guardrails (ordem do 06 §7; o driver
  // anthropic põe cache_control no último bloco system).
  const system = [
    enginePrompt(),
    compilePersona(input.persona),
    compileGuardrails(input.guardrails),
  ].join('\n\n');

  const userParts: string[] = [
    serializeBriefing(input.classification, input.selected_angle),
    '',
    serializeContext(input.context_blocks),
  ];
  if (input.recent_usage && (input.recent_usage.proof_claims.length || input.recent_usage.themes.length)) {
    userParts.push('', serializeRecentUsage(input.recent_usage));
  }
  if (input.reference_style) {
    userParts.push('', input.reference_style);
  }
  if (input.style_refs?.length) {
    userParts.push('', serializeStyleRefs(input.style_refs));
  }
  if (input.diagnosis) {
    userParts.push('', serializeDiagnosis(input.diagnosis));
  }
  if (input.instruction) {
    userParts.push('', `# INSTRUÇÃO DE REGENERAÇÃO (do usuário): ${input.instruction.trim()}`);
  }
  userParts.push('', 'Escreva a peça agora.');

  return { system, user: userParts.join('\n') };
}
