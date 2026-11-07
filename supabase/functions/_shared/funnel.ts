// _shared/funnel.ts — funil narrativo de 8 camadas como DADO tipado.
// Fonte: docs/06-arquitetura-ia.md §2.2 (nomes canônicos das camadas) e o método
// destilado no brief: 1 gancho visual → 2 gancho escrito → 3 gancho falado →
// 4 contexto/Ponto A → 5 virada/Ponto B → 6 ensino+prova → 7 moral/tese →
// 8 autoridade+CTA (ponte LÓGICA na oferta).
//
// Framework default de storytelling do motor: consumido pelos prompts do Gerador
// (prompts/generator.ts), pela rubrica do Juiz (prompts/judge.ts) e pelo
// mapeamento funil → estrutura dos adapters (_shared/adapters/). Módulo puro,
// determinístico — a serialização em texto de prompt é estável (prefixo cacheável).

import type { CoreContent } from './types.ts';

export interface FunnelLayer {
  /** 1..8 — mesmo valor de funnel_blocks[].layer no core_content. */
  layer: number;
  /** Nome canônico da camada (mesmo valor esperado em funnel_blocks[].name). */
  name: string;
  /** O que a camada faz na peça. */
  purpose: string;
  /** Regras duras da camada, aplicadas pelo Gerador e cobradas pelo Juiz. */
  rules: string[];
}

export const FUNNEL_LAYERS: readonly FunnelLayer[] = [
  {
    layer: 1,
    name: 'gancho visual',
    purpose:
      'Parar o scroll: a primeira impressão visual da peça (capa, primeira imagem, primeiro frame).',
    rules: [
      'Descreve uma cena/ideia visual concreta, não um conceito abstrato.',
      'Cria tensão ou curiosidade imediata — sem entregar o payoff.',
      'Nada de marca, logo ou oferta aqui.',
    ],
  },
  {
    layer: 2,
    name: 'gancho escrito',
    purpose: 'A primeira linha lida: promete a história e força a próxima linha.',
    rules: [
      'Uma frase curta, específica e concreta — nunca genérica.',
      'Abre um loop que só fecha nas camadas 7-8; não resume a peça.',
      'Sem clickbait vazio: a promessa precisa ser paga pelo conteúdo.',
    ],
  },
  {
    layer: 3,
    name: 'gancho falado',
    purpose:
      'Versão falada/de curiosidade do gancho (quando o formato pede voz ou abertura longa).',
    rules: [
      'Reforça o loop do gancho escrito com outra entrada, sem repeti-lo literalmente.',
      'Mantém a curiosidade: ainda nenhum payoff, nenhuma marca.',
    ],
  },
  {
    layer: 4,
    name: 'contexto/Ponto A',
    purpose: 'Situa a história: quem, onde, qual era a situação inicial (Ponto A).',
    rules: [
      'Concreto e enxuto: só o contexto necessário para a virada fazer sentido.',
      'Uma ideia por bloco — não antecipa a virada nem o ensino.',
      'A história precisa ser interessante sozinha, sem a marca.',
    ],
  },
  {
    layer: 5,
    name: 'virada/Ponto B',
    purpose: 'O momento de mudança: o que virou, a quebra de expectativa (Ponto B).',
    rules: [
      'Contraste claro entre Ponto A e Ponto B.',
      'A virada é da HISTÓRIA, não da marca — a marca ainda não aparece.',
      'Uma ideia por bloco.',
    ],
  },
  {
    layer: 6,
    name: 'ensino+prova',
    purpose:
      'O mecanismo por trás da virada + a prova central (número/quote com fonte do contexto).',
    rules: [
      'Exatamente 1 prova central por peça, vinda do contexto selecionado — com número.',
      'Nunca inventar ou alterar número/case; dado faltante vira [VERIFICAR: x].',
      'Ensina o mecanismo aplicável, não só o resultado.',
    ],
  },
  {
    layer: 7,
    name: 'moral/tese',
    purpose: 'A moral da história amarrada a uma tese da marca (análise proprietária).',
    rules: [
      'A moral decorre da história contada — não é opinião solta.',
      'Sustenta a tese do briefing; é aqui que a marca começa a aparecer de verdade.',
      'Payoff do loop aberto nas camadas 1-3.',
    ],
  },
  {
    layer: 8,
    name: 'autoridade+CTA',
    purpose:
      'Aterrissagem: autoridade de quem fala + CTA, chegando à oferta por ponte LÓGICA.',
    rules: [
      'Ponte LÓGICA: a oferta entra como consequência natural da moral — nunca colada.',
      'CTA único, escolhido do repertório permitido (allowed_ctas).',
      'Autoridade com credencial verificável (fonte), sem autoelogio vazio.',
    ],
  },
] as const;

/**
 * Checklist estrutural do funil — usado pelos prompts (Gerador) e pela rubrica
 * do Juiz. É a régua de "arco completo" da peça.
 */
export const FUNNEL_CHECKLIST: readonly string[] = [
  'A história é interessante SOZINHA, sem a marca — a marca só aparece de verdade nas camadas 7-8.',
  'O payoff do gancho só chega nas camadas 7-8 — nada de entregar a moral no início.',
  'A camada 6 carrega a prova central com número/quote e fonte do contexto selecionado.',
  'A camada 8 aterrissa na oferta por ponte LÓGICA (consequência da moral), nunca colada.',
  'Uma ideia por bloco: cada camada faz um único trabalho, na ordem 1→8, sem camadas ausentes.',
] as const;

/** Nome canônico de uma camada (1..8); string vazia para camada inválida. */
export function funnelLayerName(layer: number): string {
  return FUNNEL_LAYERS.find((l) => l.layer === layer)?.name ?? '';
}

/**
 * Serialização determinística do framework para prompts (prefixo ESTÁVEL —
 * qualquer byte diferente invalida o cache; ver 06-arquitetura-ia.md §7).
 */
export function funnelPromptBlock(): string {
  const lines: string[] = ['FUNIL NARRATIVO DE 8 CAMADAS (framework obrigatório):'];
  for (const l of FUNNEL_LAYERS) {
    lines.push(`${l.layer}. ${l.name} — ${l.purpose}`);
    for (const rule of l.rules) lines.push(`   - ${rule}`);
  }
  lines.push('');
  lines.push('CHECKLIST ESTRUTURAL (a peça só está pronta se TODOS passarem):');
  for (const item of FUNNEL_CHECKLIST) lines.push(`- ${item}`);
  return lines.join('\n');
}

/**
 * Renderiza o core_content como texto corrido, na ordem do funil — insumo do
 * linter (Classe 1), do grounding (Classe 2) e do prompt do Juiz (Classe 3).
 * Determinístico: mesma peça ⇒ mesmo texto.
 */
export function renderCoreContentText(core: CoreContent): string {
  const parts: string[] = [];
  const blocks = [...core.funnel_blocks].sort((a, b) => a.layer - b.layer);
  for (const block of blocks) {
    const content = block.content.trim();
    if (content.length > 0) parts.push(content);
  }
  const cta = core.cta.trim();
  if (cta.length > 0 && !parts.some((p) => p.includes(cta))) parts.push(cta);
  return parts.join('\n\n');
}
