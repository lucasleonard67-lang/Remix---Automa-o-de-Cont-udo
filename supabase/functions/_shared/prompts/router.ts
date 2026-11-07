// _shared/prompts/router.ts — prompt do Roteador (papel 'router').
// Fonte: docs/06-arquitetura-ia.md §2.1.
//
// O Roteador transforma o comando livre do usuário em briefing executável:
// classifica formato/canais/tese, propõe 3-4 ângulos com hook quando o tema é
// amplo e produz a query de contexto para o Retrieval. É o ÚNICO papel de
// geração que lê brand_strategy inteira (regra de altitude, 06 §1.2).
//
// Estrutura {system, user}: system = prefixo estável (prompt do motor +
// estratégia compilada + resumo de voz); user = sufixo variável (canais
// habilitados/pedidos + comando do usuário).

import type { ChannelType, PersonaContent, StrategyContent } from '../types.ts';
import { CHANNEL_TYPES, ENGINE_VERSION } from '../types.ts';
import { compileStrategy } from './compile.ts';

export interface RouterPromptInput {
  /** Comando livre do usuário (generation_jobs.prompt). */
  prompt: string;
  /** Canais pedidos explicitamente na chamada (opcional). */
  requested_channel_types?: ChannelType[];
  /** Canais habilitados na instância (channels.enabled = true). */
  enabled_channel_types: ChannelType[];
  /** Versão ativa de brand_strategy.content. */
  strategy: StrategyContent;
  /** Versão ativa de brand_persona.content (usa identity + teses p/ calibrar ângulos). */
  persona: PersonaContent;
  /** Máximo de ângulos propostos (app_settings.engine_defaults.angle_options; default 4). */
  angle_options?: number;
}

/**
 * Canais entre os quais o Roteador pode inferir. Sem canal pedido, o Reel fica
 * de fora mesmo ligado: ele é vídeo e nasce em /videos/novo, não no "o sistema
 * escolhe" da criação. Pedido explícito (automação, MCP, regenerar) não muda.
 */
export function inferableChannels(
  enabled: ChannelType[],
  requested?: ChannelType[],
): ChannelType[] {
  if (requested?.length) return enabled;
  return enabled.filter((type) => type !== 'instagram_reel');
}

/**
 * Schema de structured output do Roteador — transcrito de 06-arquitetura-ia.md
 * §2.1 (gravado em generation_jobs.classification).
 */
export const CLASSIFICATION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['format', 'channel_types', 'thesis', 'angles', 'context_query', 'needs_angle_choice'],
  properties: {
    format: { type: ['string', 'null'], description: 'Formato detectado no comando; null = ambíguo' },
    channel_types: {
      type: 'array',
      // DERIVADO de CHANNEL_TYPES, nunca repetido à mão: quando a lista estava
      // duplicada aqui, adicionar um canal novo (instagram_reel) fazia o
      // structured output recusá-lo em silêncio e o roteador devolvia outro
      // canal no lugar do que o usuário pediu.
      items: { enum: [...CHANNEL_TYPES] },
      description: 'Canais alvo (informados pelo usuário ou inferidos entre os habilitados)',
    },
    thesis: {
      type: ['string', 'null'],
      description: 'Tese da marca que a peça sustenta (destilada de brand_strategy)',
    },
    angles: {
      type: 'array', minItems: 1, maxItems: 4,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'title', 'hook'],
        properties: {
          id: { type: 'string', description: 'Identificador estável do ângulo (AngleOption.id)' },
          title: { type: 'string' },
          hook: { type: 'string', description: 'Gancho/capa proposto para este ângulo' },
          rationale: { type: 'string' },
        },
      },
    },
    context_query: { type: 'string', description: 'Query para a busca híbrida do Retrieval' },
    context_filters: {
      type: 'object', additionalProperties: false,
      properties: {
        kinds: {
          type: 'array',
          items: { enum: ['transcript', 'post', 'document', 'reference', 'case', 'offer'] },
        },
        tags: { type: 'array', items: { type: 'string' } },
      },
    },
    needs_angle_choice: {
      type: 'boolean',
      description: 'true quando o comando é amplo → job vai para awaiting_angle',
    },
  },
};

function voiceSummary(persona: PersonaContent): string {
  return [
    '# RESUMO DA VOZ (para calibrar ângulos)',
    `Quem fala: ${persona.identity.name}, ${persona.identity.role}.`,
    `Posicionamento: ${persona.identity.positioning}`,
    `Para quem fala: ${persona.identity.audience}`,
    'Teses da voz:',
    ...persona.worldview.theses.map((t) => `- ${t}`),
  ].join('\n');
}

export function routerPrompt(input: RouterPromptInput): { system: string; user: string } {
  const maxAngles = Math.min(Math.max(input.angle_options ?? 4, 1), 4);

  const system = [
    `Você é o ROTEADOR do motor editorial (engine v${ENGINE_VERSION}) de uma marca. ` +
      'Sua única função: transformar o comando livre do usuário em um briefing executável para o Gerador. ' +
      'Você NÃO escreve a peça — você classifica, propõe ângulos e monta a query de contexto.',
    '',
    'MÉTODO DE DECISÃO:',
    '1. FORMATO: detecte o formato pedido no comando (ex.: carrossel, stories, post). Ambíguo → format = null.',
    '2. CANAIS: use os canais pedidos pelo usuário quando houver; senão infira entre os HABILITADOS ' +
      '(nunca proponha canal desabilitado).',
    '3. TESE: escolha, entre as teses da estratégia abaixo, a que a peça vai sustentar — destile-a em uma ' +
      'frase própria para o briefing (o Gerador nunca lê a estratégia inteira). Nenhuma tese se aplica → thesis = null.',
    '4. ÂNGULOS: se o comando já traz ângulo inequívoco (tema fechado + recorte claro), needs_angle_choice = false ' +
      'e angles tem exatamente 1 item, auto-selecionado. Se o tema vem solto/amplo, proponha 3 a ' +
      `${maxAngles} ângulos DISTINTOS entre si, cada um com hook (a capa/primeira linha que para o scroll) ` +
      'e rationale curto, e needs_angle_choice = true. Ângulos devem ser específicos, com tensão editorial — ' +
      'nada de variação cosmética do mesmo recorte.',
    '5. CONTEXT_QUERY: escreva a melhor query de busca híbrida (semântica + léxica, pt-BR) para recuperar ' +
      'provas, cases e material da marca sobre o tema. Todo briefing de geração pede prova: privilegie termos ' +
      'que encontrem números e resultados. Use context_filters.kinds/tags quando o comando delimitar o tipo de fonte.',
    '',
    'REGRAS:',
    '- needs_angle_choice = true é o ÚNICO gatilho de escolha humana — use apenas quando o tema realmente é amplo.',
    '- IDs de ângulo: "a1", "a2", "a3", "a4" (estáveis, nesta ordem).',
    '- Hooks respeitam a voz e a postura editorial abaixo; nada de clickbait vazio nem promessa que a marca não paga.',
    '- Responda APENAS o JSON do schema pedido.',
    '',
    compileStrategy(input.strategy),
    '',
    voiceSummary(input.persona),
  ].join('\n');

  const userParts: string[] = [
    `Canais habilitados na instância: ${input.enabled_channel_types.join(', ') || '(nenhum)'}`,
  ];
  if (input.requested_channel_types?.length) {
    userParts.push(`Canais pedidos pelo usuário: ${input.requested_channel_types.join(', ')}`);
  }
  userParts.push('', 'COMANDO DO USUÁRIO:', input.prompt.trim());

  return { system, user: userParts.join('\n') };
}
