// ---------------------------------------------------------------------------
// VOCABULÁRIO DE ARTE do design system da marca.
//
// A regra que organiza este arquivo — e que a versão anterior errava:
//
//   MATÉRIA vem da MARCA. Paleta, tipografia e logo são gerados no onboarding
//   (brand-kit-suggest, a partir do material/site/nicho do cliente) e chegam na
//   arte como custom properties. São valores ABERTOS: qualquer hex, qualquer
//   família. O produto não opina sobre eles.
//
//   FORMA é vocabulário do PRODUTO. Composição, moldura, textura, tratamento de
//   foto: são enums FECHADOS, porque halftone, varredura e raio de sol são
//   gradientes e pseudo-elementos — não cabem num token de cor. Cada eixo vira
//   um `data-*` no slide e a folha de estilo tem um bloco por valor.
//
// O que existia antes era um seletor de TEMAS: onze peles com hex e fonte
// literais no CSS. A marca podia ter navy e dourado extraídos do próprio site
// que a arte saía no azul-e-rosa do Riso — o design system da marca não
// chegava na arte. Aqui a forma é escolhida (uma vez, no onboarding) e a
// matéria da marca preenche.
// ---------------------------------------------------------------------------

/** Como o conteúdo se organiza na prancha. */
export const LAYOUTS = ["editorial", "stack", "center", "column", "collage"] as const;
export type ArtLayout = (typeof LAYOUTS)[number];

/** O que delimita a arte. */
export const FRAMES = ["none", "rule", "inner", "double", "box"] as const;
export type ArtFrame = (typeof FRAMES)[number];

/** A textura de fundo — o que dá "material" à peça. */
export const TEXTURES = [
  "none",
  "grid",
  "mesh",
  "halftone",
  "scanline",
  "confetti",
  "sunburst",
  "orbs",
  "ink",
  "xerox",
] as const;
export type ArtTexture = (typeof TEXTURES)[number];

/** Como o título trata as palavras. */
export const WORDPLAYS = ["none", "alternate", "chaos"] as const;
export type ArtWordplay = (typeof WORDPLAYS)[number];

/** Sombra do título. */
export const SHADOWS = ["none", "hard", "offset", "glow"] as const;
export type ArtShadow = (typeof SHADOWS)[number];

/** Onde a foto entra na arte. */
export const PHOTO_SLOTS = ["full", "band", "taped", "none"] as const;
export type ArtPhotoSlot = (typeof PHOTO_SLOTS)[number];

/** Como a foto é revelada. */
export const PHOTO_GRADES = [
  "natural",
  "mono",
  "duotone",
  "phosphor",
  "cyan",
  "xerox",
  "wash",
] as const;
export type ArtPhotoGrade = (typeof PHOTO_GRADES)[number];

export const CASES = ["none", "upper"] as const;
export type ArtCase = (typeof CASES)[number];

export const EDGES = ["sharp", "soft", "round"] as const;
export type ArtEdge = (typeof EDGES)[number];

export const DENSITIES = ["compact", "normal", "airy"] as const;
export type ArtDensity = (typeof DENSITIES)[number];

/** Sobre qual dos dois fundos da marca o carrossel roda. */
export const SURFACES = ["paper", "ink"] as const;
export type ArtSurface = (typeof SURFACES)[number];

/**
 * O bloco de arte do design system. Vive em `brand_kit.content.art` — é
 * documento versionado da marca, não estado de tela, e não tem seletor por
 * peça: toda arte da marca segue este bloco.
 */
export interface CarouselArt {
  layout: ArtLayout;
  frame: ArtFrame;
  texture: ArtTexture;
  wordplay: ArtWordplay;
  shadow: ArtShadow;
  photo_slot: ArtPhotoSlot;
  photo_grade: ArtPhotoGrade;
  title_case: ArtCase;
  edge: ArtEdge;
  density: ArtDensity;
  /**
   * Fundo do deck. Estava como botão "miolo branco/preto" na peça — mas isso
   * também é decisão de identidade, não de post: uma marca que roda em fundo
   * escuro roda escuro sempre.
   */
  surface: ArtSurface;
  /** Escala do título, 0.7–1.4 — o quanto a marca grita. */
  title_scale: number;
  /** Frase curta que explica a escolha, na voz de quem dirigiu a arte. */
  rationale: string;
}

export const DEFAULT_ART: CarouselArt = {
  layout: "editorial",
  frame: "none",
  texture: "none",
  wordplay: "none",
  shadow: "none",
  photo_slot: "full",
  photo_grade: "natural",
  title_case: "none",
  edge: "soft",
  density: "normal",
  surface: "paper",
  title_scale: 1,
  rationale: "",
};

function umDe<T extends string>(valores: readonly T[], bruto: unknown, padrao: T): T {
  return typeof bruto === "string" && (valores as readonly string[]).includes(bruto)
    ? (bruto as T)
    : padrao;
}

/** jsonb do banco → bloco completo. Valor desconhecido cai no padrão. */
export function normalizeArt(bruto: unknown): CarouselArt {
  const c = (typeof bruto === "object" && bruto !== null ? bruto : {}) as Record<string, unknown>;
  const escala =
    typeof c.title_scale === "number" && Number.isFinite(c.title_scale)
      ? Math.min(1.4, Math.max(0.7, c.title_scale))
      : DEFAULT_ART.title_scale;
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
    title_scale: escala,
    rationale: typeof c.rationale === "string" ? c.rationale : "",
  };
}

// ---------------------------------------------------------------------------
// Rótulos em português para a revisão guiada (passo "arte" do onboarding).
// Um eixo por vez, com o que cada valor significa — não um catálogo de mundos
// prontos para escolher.
// ---------------------------------------------------------------------------

export interface EixoDeArte {
  chave: keyof CarouselArt;
  titulo: string;
  ajuda: string;
  opcoes: Array<{ valor: string; rotulo: string; nota: string }>;
}

export const EIXOS_DE_ARTE: EixoDeArte[] = [
  {
    chave: "photo_slot",
    titulo: "Lugar da foto",
    ajuda: "Onde a fotografia entra — ou se ela entra.",
    opcoes: [
      { valor: "full", rotulo: "Sangrando", nota: "Foto cobre a arte, texto por cima." },
      { valor: "band", rotulo: "Faixa", nota: "Bloco de foto no topo, texto embaixo." },
      { valor: "taped", rotulo: "Colada", nota: "Recorte torto, com fita." },
      { valor: "none", rotulo: "Sem foto", nota: "A arte gráfica se basta." },
    ],
  },
  {
    chave: "photo_grade",
    titulo: "Revelação da foto",
    ajuda: "Como a foto é tratada para pertencer ao sistema.",
    opcoes: [
      { valor: "natural", rotulo: "Natural", nota: "Cor como veio." },
      { valor: "mono", rotulo: "Preto e branco", nota: "Contraste alto, documental." },
      { valor: "duotone", rotulo: "Duas tintas", nota: "Na paleta da marca." },
      { valor: "phosphor", rotulo: "Fósforo", nota: "Monocromático luminoso." },
      { valor: "cyan", rotulo: "Cianótipo", nota: "Azul técnico." },
      { valor: "xerox", rotulo: "Xerocada", nota: "Contraste estourado." },
      { valor: "wash", rotulo: "Lavada", nota: "Quase aguada, ao fundo." },
    ],
  },
  {
    chave: "title_case",
    titulo: "Caixa do título",
    ajuda: "",
    opcoes: [
      { valor: "none", rotulo: "Como escrito", nota: "" },
      { valor: "upper", rotulo: "Versal", nota: "Tudo em maiúsculas." },
    ],
  },
  {
    chave: "edge",
    titulo: "Cantos",
    ajuda: "",
    opcoes: [
      { valor: "sharp", rotulo: "Retos", nota: "" },
      { valor: "soft", rotulo: "Suaves", nota: "" },
      { valor: "round", rotulo: "Arredondados", nota: "" },
    ],
  },
  {
    chave: "surface",
    titulo: "Fundo",
    ajuda: "Sobre qual dos dois fundos da marca o carrossel roda.",
    opcoes: [
      { valor: "paper", rotulo: "Claro", nota: "Papel da marca." },
      { valor: "ink", rotulo: "Escuro", nota: "Tinta da marca vira o fundo." },
    ],
  },
  {
    chave: "density",
    titulo: "Respiro",
    ajuda: "",
    opcoes: [
      { valor: "compact", rotulo: "Denso", nota: "Margem curta." },
      { valor: "normal", rotulo: "Normal", nota: "" },
      { valor: "airy", rotulo: "Arejado", nota: "Muito espaço em volta." },
    ],
  },
];
