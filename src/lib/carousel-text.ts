// ---------------------------------------------------------------------------
// Texto do slide → chassi título + corpo.
//
// O gerador entrega UMA string por slide. Os sistemas de carrossel são
// construídos em cima de uma manchete grande com apoio embaixo — um slide só
// com corpo fica oco no Memphis e no Punk, e um slide só com título vira
// parede de texto no Alta-Costura. Aqui a string vira {title, body} de forma
// DETERMINÍSTICA: mesma entrada, mesma arte, hoje e no export de amanhã.
// ---------------------------------------------------------------------------

export interface SlideText {
  title: string;
  body: string;
}

/** Título ideal: manchete que se lê de longe no feed. */
const TITULO_ALVO = 88;
/** Acima disso não vale a pena cortar — o título grande já é a peça. */
const TITULO_MAX = 150;
/** Sobra menor que isto é fragmento órfão: volta para o título. */
const CORPO_MIN = 14;

/** Marcador de lista do gerador ("1. ", "- ", "• ") não é conteúdo. */
function semMarcador(linha: string): string {
  return linha.replace(/^\s*(?:[-–—•*]|\d{1,2}[.)])\s+/, "").trim();
}

/**
 * Divide o texto do slide em manchete e apoio.
 *
 * Ordem das regras (a primeira que casar decide):
 *   1. quebra de linha explícita — o gerador já separou; respeitar.
 *   2. fronteira de frase que deixe o título perto de {@link TITULO_ALVO}.
 *   3. nada disso: o texto inteiro é título (a escala tipográfica cuida).
 */
export function splitSlideText(raw: string): SlideText {
  const texto = (raw ?? "").replace(/\r\n?/g, "\n").trim();
  if (!texto) return { title: "", body: "" };

  // 1. Quebra explícita.
  const linhas = texto
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (linhas.length > 1) {
    const titulo = semMarcador(linhas[0]);
    const corpo = linhas.slice(1).map(semMarcador).join("\n");
    if (titulo.length <= TITULO_MAX && corpo.length >= CORPO_MIN) {
      return { title: titulo, body: corpo };
    }
    // Primeira linha longa demais (ou sobra órfã): trata como parágrafo único.
  }

  const plano = semMarcador(linhas.join(" "));

  // 2. Fronteira de frase. Acumula enquanto o título ficar CURTO — e para de
  //    acumular assim que passar do alvo, para não engolir o texto inteiro.
  const frases = plano.split(/(?<=[.!?…])\s+/).filter(Boolean);
  if (frases.length > 1) {
    let titulo = frases[0];
    let corte = 1;
    while (corte < frases.length && titulo.length < 40) {
      const proximo = `${titulo} ${frases[corte]}`;
      if (proximo.length > TITULO_ALVO) break;
      titulo = proximo;
      corte += 1;
    }
    const corpo = frases.slice(corte).join(" ").trim();
    if (titulo.length <= TITULO_MAX && corpo.length >= CORPO_MIN) {
      return { title: titulo, body: corpo };
    }
  }

  // 3. Frase única e longa: quebra na pontuação interna mais perto do alvo.
  //    Sem isto, uma manchete de 130 caracteres força o ajuste medido até o
  //    piso e a arte vira parede de texto miúdo — justamente o contrário do
  //    que um carrossel precisa. Com isto vira manchete + apoio.
  if (plano.length > TITULO_ALVO + 30) {
    const pausas: number[] = [];
    const re = /[,;:—–]\s+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(plano)) !== null) pausas.push(m.index + m[0].length);
    let melhor = -1;
    for (const corte of pausas) {
      const restante = plano.length - corte;
      if (corte < 24 || restante < CORPO_MIN) continue;
      if (melhor < 0 || Math.abs(corte - TITULO_ALVO) < Math.abs(melhor - TITULO_ALVO)) {
        melhor = corte;
      }
    }
    if (melhor > 0) {
      // a pontuação fica no fim do título; o apoio começa limpo
      return {
        title: plano
          .slice(0, melhor)
          .replace(/[,;:—–]\s*$/, "")
          .trim(),
        body: plano.slice(melhor).trim(),
      };
    }
  }

  // 4. Peça de um fôlego só.
  return { title: plano, body: "" };
}

// ---------------------------------------------------------------------------
// Escala tipográfica.
//
// Cada pele define o seu corpo em `cqw` (Punk é enorme, Sumi é fino). Um texto
// comprido não pode estourar a arte, mas também não pode achatar a diferença
// entre as peles. Então a pele mantém o SEU tamanho e recebe um multiplicador
// pelo comprimento — `--t` no título, `--b` no corpo.
// ---------------------------------------------------------------------------

function degrau(len: number, tabela: Array<[number, number]>): number {
  for (const [limite, escala] of tabela) {
    if (len <= limite) return escala;
  }
  return tabela[tabela.length - 1][1];
}

export function titleScale(len: number): number {
  return degrau(len, [
    [24, 1.18],
    [44, 1.06],
    [70, 1],
    [100, 0.86],
    [140, 0.74],
    [190, 0.63],
    [260, 0.54],
    [Infinity, 0.46],
  ]);
}

export function bodyScale(len: number): number {
  return degrau(len, [
    [90, 1.08],
    [160, 1],
    [260, 0.9],
    [380, 0.81],
    [520, 0.73],
    [Infinity, 0.66],
  ]);
}

// ---------------------------------------------------------------------------
// Palavras — o chassi embrulha CADA palavra em <span class="w">, porque peles
// como Punk (quatro fontes alternadas) e Memphis (cores por posição) endereçam
// palavra a palavra via nth-child. Marcação **destaque** do gerador vira a
// classe `em` (nunca asterisco cru na arte).
// ---------------------------------------------------------------------------

export interface SlideWord {
  text: string;
  em: boolean;
}

export function toWords(text: string): SlideWord[] {
  const saida: SlideWord[] = [];
  for (const trecho of text.split(/(\*\*[^*]+\*\*)/g)) {
    if (!trecho) continue;
    const destacado = trecho.startsWith("**") && trecho.endsWith("**") && trecho.length > 4;
    const limpo = destacado ? trecho.slice(2, -2) : trecho;
    for (const palavra of limpo.split(/\s+/)) {
      if (palavra) saida.push({ text: palavra, em: destacado });
    }
  }
  return saida;
}

/** Corpo sem asterisco cru — o destaque no corpo é peso, não marcação. */
export function stripEmphasis(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1");
}
