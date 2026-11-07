// _shared/prompts/scene-director.ts — prompt do Diretor de Fotografia (papel 'generator').
// Fonte: docs/11-video-replicate.md §4.5 e o painel de cinema de 2026-08-18.
//
// DUAS DECISÕES ESTRUTURAIS, ambas para tirar do LLM o que ele faz mal:
//
// 1. Ele NÃO escreve nem reescreve a fala. Os beats já foram auditados por
//    grounding, linter e juiz. Se o LLM pudesse redigitar o texto, o veredito do
//    juiz deixaria de valer em silêncio.
// 2. Ele também NÃO copia a fala. O código quebra cada beat em FRASES numeradas
//    e o diretor apenas ESCOLHE quais frases entram em cada plano, por índice.
//    Assim "a soma dos planos é exatamente a fala aprovada" vira invariante
//    estrutural, não uma comparação de strings feita depois.
//
// O que ele decide é o que só ele sabe fazer: onde cortar, por que aquele plano
// existe, e como fotografá-lo.

import type { PersonaContent, ReelBeat } from '../types.ts';

/** Uma frase da narração, já numerada pelo código. */
export interface BeatSentence {
  beat_index: number;
  sentence_index: number;
  text: string;
}

export interface SceneDirectorInput {
  beats: ReelBeat[];
  /** Frases numeradas de todos os beats — o material que o diretor distribui. */
  sentences: BeatSentence[];
  idea: string;
  persona: PersonaContent;
  /** Gancho VISUAL do funil (camada 1): direção de câmera já escrita pelo motor. */
  visual_hook?: string;
  palette?: Record<string, string>;
  negative_constraints?: string[];
  has_avatar: boolean;
  /** Aparência do avatar, quando existe — entra no look block. */
  avatar_appearance?: string;
  /** Teto de planos por bloco de fala (app_settings.video_defaults). */
  shots_per_beat_max: number;
}

// ── Vocabulário fechado ──────────────────────────────────────────────────────
// Poucos valores de propósito: enum grande faz o LLM sortear termo bonito.

const SHOT_SIZE = ['DETALHE', 'CLOSE', 'MEIO_CLOSE', 'MEDIO', 'AMPLO_VERTICAL'] as const;
const SHOT_ANGLE = [
  'FRONTAL_OLHOS',
  'TRES_QUARTOS_ESQ',
  'TRES_QUARTOS_DIR',
  'PERFIL',
  'CONTRA_PLONGEE_SUAVE',
  'PLONGEE_SUAVE',
  'ZENITAL',
] as const;
const SHOT_LENS = ['AMPLA_28', 'NORMAL_40', 'RETRATO_50', 'TELE_85', 'MACRO'] as const;
const SHOT_MOVEMENT = [
  'ESTATICO',
  'PUSH_IN_LENTO',
  'PARALAXE_LATERAL',
  'ACOMPANHA_MAOS',
  'HANDHELD_SUTIL',
  'RACK_FOCUS',
] as const;

/** Enquadramentos que o modelo de lipsync sustenta — calibrado com vídeo real:
 *  em MEDIO (cintura para cima) o rosto fica pequeno demais e a boca dessincroniza;
 *  em MEIO_CLOSE/CLOSE com take curto a sincronia segura. */
export const AVATAR_SIZES = ['MEIO_CLOSE', 'CLOSE'] as const;
export const AVATAR_ANGLES = ['FRONTAL_OLHOS', 'TRES_QUARTOS_ESQ', 'TRES_QUARTOS_DIR'] as const;

export const SCENE_DIRECTOR_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['concept', 'look_block', 'shots'],
  properties: {
    concept: {
      type: 'string',
      description:
        'O CONCEITO VISUAL do vídeo em 2-3 frases: qual objeto/lugar concreto DO CASO ' +
        'costura os planos (não "um escritório" — o calendário das cotações, a planilha ' +
        'redigitada, a linha que voltou a andar), qual é o arco (antes caótico → depois ' +
        'fluido) e qual motivo visual se repete. Os planos de b-roll EXECUTAM este conceito.',
    },
    look_block: {
      type: 'string',
      description:
        'UMA frase densa com o que NÃO muda no Reel inteiro: figurino, paleta, ' +
        'direção e temperatura da luz-chave, locação e hora do dia. Ela é colada ' +
        'literalmente em todos os planos — é o que segura a continuidade entre ' +
        'clipes que serão gerados separadamente.',
    },
    shots: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'beat_index',
          'sentence_indices',
          'function',
          'type',
          'size',
          'angle',
          'lens',
          'movement',
          'visual_prompt',
        ],
        properties: {
          beat_index: { type: 'integer', description: 'Bloco de fala a que este plano pertence' },
          sentence_indices: {
            type: 'array',
            items: { type: 'integer' },
            description:
              'Índices das frases DESTE bloco que este plano cobre, em ordem. ' +
              'Cada frase do bloco tem que ser usada por exatamente um plano.',
          },
          function: {
            type: 'string',
            description:
              'Por que este plano existe, em até 8 palavras: revelar o número, ' +
              'mostrar a prova, dar a reação, estabelecer a escala do problema, ' +
              'fechar olhando o espectador. A escala do plano decorre DISSO.',
          },
          type: {
            enum: ['avatar', 'broll'],
            description: 'avatar = a persona fala na tela; broll = imagem de apoio sem rosto',
          },
          size: { enum: SHOT_SIZE, description: 'Escala do plano' },
          angle: { enum: SHOT_ANGLE, description: 'Ângulo e altura em relação ao sujeito' },
          lens: { enum: SHOT_LENS, description: 'Sensação de lente' },
          movement: {
            enum: SHOT_MOVEMENT,
            description:
              'Movimento de câmera. Em plano de avatar use SEMPRE ESTATICO: o modelo ' +
              'de fala não aceita direção de movimento.',
          },
          visual_prompt: {
            type: 'string',
            description:
              'O QUE se vê, congelado num instante: sujeito, o que ele faz nesse ' +
              'instante (particípio, nunca gerúndio de deslocamento), o ambiente e a ' +
              'luz. Sem citar tempo, sequência ou "depois".',
          },
        },
      },
    },
  },
};

function describePalette(palette?: Record<string, string>): string {
  const entries = Object.entries(palette ?? {})
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .slice(0, 6)
    .map(([name, value]) => `${name} ${value}`);
  return entries.join('; ');
}

export function buildSceneDirectorMessages(
  input: SceneDirectorInput,
): Array<{ role: 'system' | 'user'; content: string }> {
  const palette = describePalette(input.palette);
  const constraints = (input.negative_constraints ?? []).filter(
    (c): c is string => typeof c === 'string' && c.trim().length > 0,
  );

  const system = [
    'Você é DIRETOR DE FOTOGRAFIA de conteúdo vertical de marca. Recebe um roteiro já',
    'aprovado, dividido em blocos de fala, e faz a DECUPAGEM: transforma cada bloco em',
    'PLANOS, com escala, ângulo, lente, movimento e luz pensados.',
    '',
    'Você NÃO escreve, reescreve nem digita a fala. A narração já foi auditada. Você',
    'apenas distribui as FRASES entre os planos, escolhendo pelos índices.',
    '',
    'ANTES DE DECUPAR, CONCEBA: escreva o conceito visual do vídeo — um fio CONCRETO',
    'tirado do próprio caso narrado (o objeto, o lugar, o documento da história), com um',
    'arco visível de antes → depois. B-roll genérico de escritório é o erro nº 1: se a',
    'fala diz "11 dias viraram 2", a imagem tem que MOSTRAR essa transformação, não um',
    'ambiente qualquer. O conceito amarra os planos; sem ele o vídeo vira slideshow.',
    '',
    'COMO SE DECUPA (siga nesta ordem, para cada plano):',
    '1. Declare a FUNÇÃO do plano — por que ele existe no argumento. Sem função, o plano',
    '   é enfeite e o corte não significa nada.',
    '2. A escala decorre da função: DETALHE prova e entrega dado; CLOSE carrega a tese e',
    '   a virada; MEIO_CLOSE é o plano de trabalho do argumento; MEDIO ancora a pessoa no',
    '   contexto; AMPLO_VERTICAL estabelece o ambiente.',
    '3. Só então escolha ângulo, lente e movimento.',
    '',
    'REGRAS DE CORTE (elas é que fazem parecer cinema e não slide):',
    '- Entre planos vizinhos, mude a escala em pelo menos um degrau E mude o ângulo.',
    '  Dois planos seguidos na mesma escala leem como falha, não como corte.',
    '- Mantenha o EIXO: escolha um lado e não atravesse. Se o sujeito olha para a',
    '  câmera-esquerda num plano, ele não pode olhar para a direita no seguinte.',
    '- Alterne quem sustenta a frase: pessoa falando, depois apoio, depois pessoa de novo',
    '  em escala diferente. Bloco inteiro no mesmo enquadramento é o erro que estamos',
    '  corrigindo.',
    '- Abertura: o primeiro plano do Reel entrega uma promessa concreta — um detalhe, um',
    '  número, um objeto — e não um plano genérico de ambiente.',
    '',
    input.has_avatar
      ? 'PLANO DE AVATAR (a persona falando): use APENAS MEIO_CLOSE ou CLOSE — em plano ' +
        'mais aberto o rosto fica pequeno e a boca dessincroniza. Ângulo FRONTAL_OLHOS, ' +
        'TRES_QUARTOS_ESQ ou TRES_QUARTOS_DIR, câmera na linha dos olhos, movimento sempre ' +
        'ESTATICO (a câmera não se move; a riqueza vem de CORTAR entre enquadramentos da ' +
        'mesma pessoa). Fala de avatar com mais de ~9 segundos DEVE ser dividida em dois ' +
        'planos com enquadramentos diferentes. No visual_prompt: boca fechada e relaxada, ' +
        'rosto ocupando de 30% a 45% da altura, olhos no terço superior, fundo separado ' +
        'por profundidade. Nunca mãos perto do rosto, nunca perfil, nunca duas pessoas.'
      : 'Esta instância NÃO tem avatar: TODOS os planos são broll. Nunca mostre rosto ' +
        'humano falando para a câmera.',
    '',
    'PLANO DE B-ROLL: NUNCA estático — todo b-roll tem UM movimento de câmera (o padrão é ' +
      'PUSH_IN_LENTO; RACK_FOCUS quando o plano entrega um dado; PARALAXE_LATERAL para ' +
      'revelar camadas). B-roll parado é slide, não cinema.',
    '',
    'PROIBIDO no visual_prompt: qualquer palavra de tempo ou sequência ("depois",',
    '"enquanto", "então", "em seguida", "a câmera se afasta e revela"). O plano é UM',
    'instante congelado — descrição com movimento faz o gerador de imagem devolver uma',
    'colagem de painéis. O movimento vai no campo `movement`, não no texto.',
    'PROIBIDO também: texto na imagem, legenda, logotipo, marca d’água.',
    '',
    palette ? `Paleta da marca: ${palette}.` : '',
    constraints.length > 0 ? `Restrições visuais (NUNCA violar): ${constraints.join('; ')}.` : '',
    input.avatar_appearance ? `Aparência da persona: ${input.avatar_appearance}` : '',
    `Persona: ${input.persona.identity?.name ?? 'a marca'} — ${input.persona.identity?.role ?? ''}.`,
    `Público: ${input.persona.identity?.audience ?? ''}.`,
  ]
    .filter((line) => line !== '')
    .join('\n');

  const beatBlocks = input.beats
    .map((beat) => {
      const sentences = input.sentences
        .filter((s) => s.beat_index === beat.index)
        .map((s) => `    [${s.sentence_index}] ${s.text}`)
        .join('\n');
      return `  BLOCO ${beat.index} (${beat.role}, ~${beat.duration_target_s}s de fala):\n${sentences}`;
    })
    .join('\n\n');

  const totalSentences = input.sentences.length;

  const user = [
    `Ideia da peça: ${input.idea}`,
    '',
    input.visual_hook
      ? `Gancho visual escrito pelo roteiro — o PRIMEIRO plano deve realizá-lo, refinando ` +
        `só o necessário para caber em 9:16:\n"${input.visual_hook}"\n`
      : '',
    'Blocos de fala e suas frases numeradas:',
    beatBlocks,
    '',
    'Decupe. Regras duras da distribuição:',
    `- Cada frase é usada por EXATAMENTE UM plano. Não sobra nem repete. São ${totalSentences} frases no total.`,
    '- Um plano pode cobrir mais de uma frase do mesmo bloco, mas nunca frases de blocos diferentes.',
    `- No máximo ${input.shots_per_beat_max} planos por bloco. Bloco de uma frase só vira um plano.`,
    '- Entregue os planos na ordem em que aparecem no vídeo.',
    '',
    'Devolva também o concept (o fio visual concreto do caso) e o look_block (a frase de ' +
      'continuidade que vale para o Reel inteiro).',
  ]
    .filter((line) => line !== '')
    .join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ── Saída ────────────────────────────────────────────────────────────────────

export interface DirectedShot {
  beat_index: number;
  sentence_indices: number[];
  function: string;
  type: 'avatar' | 'broll';
  size: string;
  angle: string;
  lens: string;
  movement: string;
  visual_prompt: string;
}

export interface SceneDirectorOutput {
  concept: string;
  look_block: string;
  shots: DirectedShot[];
}
