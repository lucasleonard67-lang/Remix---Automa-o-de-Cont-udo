// ---------------------------------------------------------------------------
// Vocabulário de ARTE do lado servidor.
//
// Espelha `src/lib/carousel-art.ts` no que o backend precisa: validar o bloco
// que a IA propõe e traduzir os eixos visuais em DIREÇÃO FOTOGRÁFICA para o
// prompt de imagem. O CSS não atravessa — o que atravessa é a intenção.
//
// A versão anterior tinha aqui um mapa id→direção com onze mundos fixos. Isso
// era catálogo: a marca podia ter a paleta extraída do próprio site e a foto
// vinha do mundo, não da marca. Agora a direção é COMPOSTA dos eixos que o
// design system da marca declara.
// ---------------------------------------------------------------------------

export interface CarouselArt {
  layout: string;
  frame: string;
  texture: string;
  wordplay: string;
  shadow: string;
  photo_slot: string;
  photo_grade: string;
  title_case: string;
  edge: string;
  density: string;
  surface: string;
  title_scale: number;
}

export const LAYOUTS = ['editorial', 'stack', 'center', 'column', 'collage'] as const;
export const FRAMES = ['none', 'rule', 'inner', 'double', 'box'] as const;
export const TEXTURES = [
  'none',
  'grid',
  'mesh',
  'halftone',
  'scanline',
  'confetti',
  'sunburst',
  'orbs',
  'ink',
  'xerox',
] as const;
export const WORDPLAYS = ['none', 'alternate', 'chaos'] as const;
export const SHADOWS = ['none', 'hard', 'offset', 'glow'] as const;
export const PHOTO_SLOTS = ['full', 'band', 'taped', 'none'] as const;
export const PHOTO_GRADES = [
  'natural',
  'mono',
  'duotone',
  'phosphor',
  'cyan',
  'xerox',
  'wash',
] as const;
export const CASES = ['none', 'upper'] as const;
export const EDGES = ['sharp', 'soft', 'round'] as const;
export const DENSITIES = ['compact', 'normal', 'airy'] as const;
export const SURFACES = ['paper', 'ink'] as const;

export const DEFAULT_ART: CarouselArt = {
  layout: 'editorial',
  frame: 'none',
  texture: 'none',
  wordplay: 'none',
  shadow: 'none',
  photo_slot: 'full',
  photo_grade: 'natural',
  title_case: 'none',
  edge: 'soft',
  density: 'normal',
  surface: 'paper',
  title_scale: 1,
};

function umDe(valores: readonly string[], bruto: unknown, padrao: string): string {
  return typeof bruto === 'string' && valores.includes(bruto) ? bruto : padrao;
}

export function normalizeArt(bruto: unknown): CarouselArt {
  const c = (typeof bruto === 'object' && bruto !== null ? bruto : {}) as Record<string, unknown>;
  return {
    // A estrutura é fixa em toda marca (docs/carrossel-editorial.md), mesmo em
    // kit antigo gravado com outra escolha: muda o conteúdo, a cor, a fonte e a foto.
    layout: DEFAULT_ART.layout,
    frame: DEFAULT_ART.frame,
    texture: DEFAULT_ART.texture,
    wordplay: DEFAULT_ART.wordplay,
    shadow: DEFAULT_ART.shadow,
    photo_slot: umDe(PHOTO_SLOTS, c.photo_slot, DEFAULT_ART.photo_slot),
    photo_grade: umDe(PHOTO_GRADES, c.photo_grade, DEFAULT_ART.photo_grade),
    title_case: umDe(CASES, c.title_case, DEFAULT_ART.title_case),
    edge: umDe(EDGES, c.edge, DEFAULT_ART.edge),
    density: umDe(DENSITIES, c.density, DEFAULT_ART.density),
    surface: umDe(SURFACES, c.surface, DEFAULT_ART.surface),
    title_scale:
      typeof c.title_scale === 'number' && Number.isFinite(c.title_scale)
        ? Math.min(1.4, Math.max(0.7, c.title_scale))
        : DEFAULT_ART.title_scale,
  };
}

/** Design system gráfico: a arte se basta e a foto nunca aparece. */
export function artUsesPhoto(art: CarouselArt): boolean {
  return art.photo_slot !== 'none';
}

// ── Direção fotográfica composta ───────────────────────────────────────────
//
// A foto tem que PERTENCER ao sistema da marca. Quem decide isso são dois
// eixos — como ela é revelada (`photo_grade`) e onde ela entra
// (`photo_slot`) — mais a temperatura do fundo (`surface`).

const POR_REVELACAO: Record<string, string> = {
  natural: 'Fotografia editorial contemporânea, luz natural, cor realista, profundidade de campo suave.',
  mono:
    'Fotografia documental em PRETO E BRANCO de alto contraste, grão visível, luz dura e ' +
    'direta, enquadramento frontal e seco.',
  duotone:
    'Fotografia de contraste alto pensada para virar duas tintas: massas claras e escuras bem ' +
    'separadas, poucos meios-tons, sem detalhe em sombra.',
  phosphor:
    'Fotografia escura de ambiente técnico, uma única fonte de luz, sombras profundas, ' +
    'sensação de tela acesa na madrugada.',
  cyan:
    'Fotografia técnica e ordenada — máquina, planta, bancada — luz uniforme, linhas retas ' +
    'evidentes, paleta fria.',
  xerox:
    'Fotografia crua de contraste estourado, como fotocópia: pretos chapados, brancos ' +
    'queimados, granulação grossa.',
  wash:
    'Fotografia serena e minimalista, luz difusa, quase monocromática, muito vazio na ' +
    'composição — ela vai aparecer esmaecida atrás do texto.',
};

const POR_LUGAR: Record<string, string> = {
  full: 'A imagem cobre a arte inteira e o texto entra POR CIMA: a metade inferior precisa ficar calma (sombra, desfoque ou área lisa).',
  band: 'A imagem ocupa só a FAIXA SUPERIOR da arte: o assunto tem que estar na metade de cima do enquadramento.',
  taped: 'A imagem entra como recorte colado, pequeno e torto: enquadramento fechado, um sujeito só, sem cena ampla.',
  none: '',
};

/**
 * Direção fotográfica do design system da marca, para o prompt de imagem.
 * String vazia = a marca não usa foto no carrossel.
 */
export function artPhotoDirection(art: CarouselArt): string {
  if (!artUsesPhoto(art)) return '';
  const partes = [POR_REVELACAO[art.photo_grade] ?? POR_REVELACAO.natural, POR_LUGAR[art.photo_slot]];
  if (art.surface === 'ink') {
    partes.push('A arte roda sobre fundo ESCURO: prefira cena de baixa luz, sem céu estourado.');
  }
  return partes.filter(Boolean).join(' ');
}

/** Menu dos eixos para o prompt do sugeridor de design system. */
export function artVocabularyMenu(): string {
  return [
    `layout: ${LAYOUTS.join(' | ')} — editorial (padrão: reportagem com manchete, texto corrido, foto e gráfico), empilhada, eixo central simétrico, coluna vertical, colagem torta`,
    `frame: ${FRAMES.join(' | ')} — sem moldura, fios, borda interna, moldura escalonada, caixa`,
    `texture: ${TEXTURES.join(' | ')} — lisa, grade suíça, malha técnica, retícula de risografia, varredura de tubo, confete geométrico, raio de sol, orbes luminosos, mancha de nanquim, ruído de xerox`,
    `wordplay: ${WORDPLAYS.join(' | ')} — bloco único, cores da marca alternando por palavra, recorte com fundo e rotação palavra a palavra`,
    `shadow: ${SHADOWS.join(' | ')} — nenhuma, dura deslocada, fora de registro, halo`,
    `photo_slot: ${PHOTO_SLOTS.join(' | ')} — sangrando, faixa no topo, recorte colado, sem foto (arte puramente gráfica)`,
    `photo_grade: ${PHOTO_GRADES.join(' | ')} — natural, preto e branco, duas tintas, fósforo, cianótipo, xerocada, lavada`,
    `title_case: ${CASES.join(' | ')}`,
    `edge: ${EDGES.join(' | ')}`,
    `density: ${DENSITIES.join(' | ')} — denso, normal, arejado`,
    `surface: ${SURFACES.join(' | ')} — arte sobre o claro ou sobre o escuro da paleta`,
    'title_scale: número entre 0.7 e 1.4 — o quanto a marca grita',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// CAPA COMO PEÇA DE ARTE (não como foto de fundo).
//
// A correção que o Tiago pediu, na palavra dele: *"a capa deve ser gerada com
// intenção, com elementos interessantes; se tiver falando algo do Warren
// Buffett esse filho da puta tem que estar na foto. E não é uma imagem de
// fundo com o texto em cima — o texto vai vir na imagem, gerado pelo modelo."*
//
// Então a capa deixa de ser "fundo atmosférico + chassi por cima" e passa a ser
// UMA arte fechada, com a manchete tipografada pelo próprio modelo, dentro do
// design system da marca. O MIOLO não muda: continua render do chassi, e os
// briefs dele continuam proibindo texto — modelo de imagem escrevendo em dez
// slides seguidos é receita de erro de ortografia em série.
// ---------------------------------------------------------------------------

export interface CoverArt {
  /**
   * O QUE aparece. Entidade concreta e nomeada quando o conteúdo cita uma
   * (pessoa, empresa, produto, lugar) — é isso que separa "capa com intenção"
   * de banco de imagem.
   */
  subject: string;
  /** A manchete, exatamente como deve ser escrita NA imagem. */
  headline: string;
  /** Composição, enquadramento e onde o tipo se apoia. */
  art_direction: string;
}

export const COVER_ART_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    subject: {
      type: 'string',
      description:
        'O que aparece na capa, em 1-2 frases. Se o conteúdo cita uma pessoa, empresa, ' +
        'produto ou lugar REAL, NOMEIE — é a pessoa/coisa que tem que estar na imagem, não ' +
        'uma metáfora genérica. Sem entidade citada, escolha um sujeito concreto e ' +
        'específico (uma cena, um objeto, um gesto), nunca abstração.',
    },
    headline: {
      type: 'string',
      description:
        'A manchete que o modelo de imagem vai TIPOGRAFAR na arte. Curta e de impacto: no ' +
        'máximo 8 palavras. Em português do Brasil, com a acentuação correta.',
    },
    art_direction: {
      type: 'string',
      description:
        'Enquadramento, luz, ângulo e ONDE o tipo se apoia na composição (a zona calma). ' +
        '2-3 frases.',
    },
  },
  required: ['subject', 'headline', 'art_direction'],
} as const;

/** Descreve a paleta da marca para o modelo de imagem, com papéis. */
function paletaEmPalavras(paletteDesc: string): string {
  return paletteDesc ? `Paleta obrigatória da marca (use ESTAS cores): ${paletteDesc}.` : '';
}

const LAYOUT_EM_PALAVRAS: Record<string, string> = {
  stack: 'a manchete ancorada na parte de baixo, alinhada à esquerda',
  center: 'a manchete centralizada no eixo vertical, com simetria e muito ar em volta',
  column: 'a manchete em coluna vertical junto à borda direita',
  collage: 'a manchete em blocos recortados e levemente tortos, como colagem',
};

const TEXTURA_EM_PALAVRAS: Record<string, string> = {
  none: '',
  grid: 'uma grade tipográfica suíça discreta, visível como estrutura',
  mesh: 'uma malha milimetrada técnica ao fundo',
  halftone: 'retícula de impressão visível, como risografia',
  scanline: 'linhas horizontais de varredura, como monitor de tubo',
  confetti: 'formas geométricas soltas, memphis',
  sunburst: 'um leque de raios saindo da base, art déco',
  orbs: 'orbes luminosos e difusos ao fundo',
  ink: 'uma mancha de nanquim esmaecida',
  xerox: 'ruído grosso de fotocópia',
};

const MOLDURA_EM_PALAVRAS: Record<string, string> = {
  none: '',
  rule: 'fios finos no topo e na base',
  inner: 'uma moldura interna recuada da margem',
  double: 'uma moldura dupla escalonada, ornamental',
  box: 'um contorno retangular de terminal',
};

/**
 * Prompt da CAPA: uma peça de arte fechada, com tipografia, dentro do design
 * system da marca.
 *
 * Três coisas que este prompt faz e o antigo não fazia:
 *  1. pede a manchete ESCRITA na imagem, entre aspas e soletrada;
 *  2. nomeia o sujeito concreto em vez de pedir "fundo atmosférico";
 *  3. descreve o design system em PALAVRAS (paleta com hex, famílias
 *     tipográficas, composição, textura, moldura) — o modelo de imagem não lê
 *     CSS, então a identidade precisa atravessar como instrução.
 */
export function buildCoverPrompt(input: {
  cover: CoverArt;
  art: CarouselArt;
  paletteDesc: string;
  negativeConstraints: string[];
  typography: { heading: string; body: string };
  aspect: string;
  brandName: string;
}): string {
  const { cover, art, paletteDesc, negativeConstraints, typography, aspect, brandName } = input;

  const partes: string[] = [
    `CAPA de carrossel de Instagram no formato RETRATO ${aspect} (mais alta que larga). ` +
      'É a primeira imagem, a que precisa parar o scroll: uma peça de arte fechada, ' +
      'não uma foto de fundo.',

    `SUJEITO (tem que aparecer): ${cover.subject}`,

    `DIREÇÃO: ${cover.art_direction}`,

    // A manchete entre aspas e com o pedido explícito de ortografia: modelo de
    // imagem erra acento e cedilha com facilidade, e o erro só aparece no PNG.
    `TIPOGRAFIA NA IMAGEM — escreva na arte, exatamente este texto, sem alterar ` +
      `nem uma letra e respeitando TODOS os acentos e cedilhas do português:\n"${cover.headline}"\n` +
      `Componha ${LAYOUT_EM_PALAVRAS[art.layout] ?? LAYOUT_EM_PALAVRAS.stack}. ` +
      `O tipo é o elemento dominante: grande, legível de longe no feed, com contraste ` +
      `suficiente contra o que está atrás dele. ` +
      (art.title_case === 'upper' ? 'Em CAIXA ALTA. ' : '') +
      `Estilo tipográfico de referência: ${typography.heading || 'sans-serif geométrica'} ` +
      `para a manchete. NÃO escreva mais nada além dessa frase — nenhuma legenda, ` +
      `nenhum crédito, nenhuma palavra solta, nenhuma marca d'água.`,
  ];

  const paleta = paletaEmPalavras(paletteDesc);
  if (paleta) partes.push(paleta + ' A cor entra pela cena e pelo tipo, nunca como filtro chapado.');

  const ornamentos = [TEXTURA_EM_PALAVRAS[art.texture], MOLDURA_EM_PALAVRAS[art.frame]].filter(
    Boolean,
  );
  if (ornamentos.length > 0) {
    partes.push(`Linguagem gráfica da marca: ${ornamentos.join('; ')}.`);
  }
  if (art.surface === 'ink') {
    partes.push('A peça roda sobre fundo ESCURO, com o tipo claro por cima.');
  }
  if (brandName) {
    partes.push(
      `Assinatura discreta da marca "${brandName}" num canto, pequena — nunca competindo ` +
        'com a manchete.',
    );
  }
  if (negativeConstraints.length > 0) {
    partes.push(`NUNCA inclua: ${negativeConstraints.join('; ')}.`);
  }

  partes.push(
    'REGRAS DURAS: uma peça única e contínua — nunca colagem de painéis, grade de fotos, ' +
      'tela dividida ou mockup de celular. Nada de gente com mão deformada ou dedo a mais. ' +
      // MEDIDO numa capa com um DRE em cima da mesa: a manchete saiu perfeita e
      // o documento da cena veio com palavras inventadas ("connoicalns",
      // "chaimo"). Modelo de imagem escreve BEM o texto que a gente dita e MAL
      // o texto que ele inventa — então a cena não pode pedir texto legível.
      'A ÚNICA palavra escrita na arte é a manchete ditada acima. Se a cena tiver papel, ' +
      'tela, placa, livro, jornal ou etiqueta, mostre-os de longe, em ângulo, desfocados ou ' +
      'cortados pela borda — nunca legíveis. Prefira compor a cena SEM documento em primeiro ' +
      'plano. ' +
      'Se por política você não puder retratar a pessoa nomeada, componha a SITUAÇÃO ' +
      'reconhecível dela (o contexto, os objetos, o ambiente) e mantenha a manchete escrita ' +
      '— nunca devolva a arte sem o texto.',
  );

  return partes.join('\n\n');
}
