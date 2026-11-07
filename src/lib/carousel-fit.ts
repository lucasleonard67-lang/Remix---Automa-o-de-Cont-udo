// ---------------------------------------------------------------------------
// Medida de transbordo da arte do carrossel.
//
// ARMADILHA que custou uma correção: `scrollHeight`/`scrollWidth` só enxergam
// conteúdo que passa das bordas FINAIS. Conteúdo que vaza pela borda INICIAL é
// invisível para eles — e é justamente o que `justify-content: center` e
// `flex-end` produzem quando o conteúdo é maior que a caixa. Ou seja: a métrica
// óbvia é cega no único caso em que a arte quebra.
//
// Aqui a conta é geométrica: a caixa de cada filho de `.mid` tem que caber
// dentro da caixa de `.mid`, nos quatro lados. De quebra isso respeita rotação
// (a manchete da Punk é `rotate(-1.6deg)` e cada palavra gira sozinha), coisa
// que `scrollHeight` nunca soube medir.
//
// O ajuste do render e o teste e2e usam ESTA função — a arte é medida do mesmo
// jeito que o teste cobra.
// ---------------------------------------------------------------------------

export interface MidOverflow {
  top: number;
  left: number;
  bottom: number;
  right: number;
  /**
   * Maior transbordo entre os quatro lados, em px de LAYOUT (0 = cabe).
   * Layout e não tela de propósito: a arte é desenhada em 540px e escalada
   * pelo contêiner, e uma tolerância em px de tela valeria mais folga na
   * miniatura da galeria do que no node do export — o mesmo slide poderia
   * convergir para um `--fit` diferente no preview e no PNG.
   */
  worst: number;
}

export function midOverflow(slide: Element | null | undefined): MidOverflow {
  const vazio: MidOverflow = { top: 0, left: 0, bottom: 0, right: 0, worst: 0 };
  const mid = slide?.querySelector<HTMLElement>(".mid");
  if (!mid) return vazio;

  // Caixa de CONTEÚDO, não a de borda. Peles que reservam espaço para a foto
  // fazem isso com `padding-top` no `.mid` (Brutalista, Punk): medindo contra
  // a caixa de borda, o texto invade a folga reservada, a conta diz que cabe e
  // a manchete sai por cima da parte escura da foto.
  //
  // ARMADILHA DE UNIDADE (custou uma rodada): a arte é desenhada em 540px e
  // escalada por `transform` para caber no contêiner. `getBoundingClientRect`
  // devolve px de TELA (já escalados); `getComputedStyle().padding`, px de
  // LAYOUT (não escalados). Subtrair um do outro tira área demais — no
  // miniatura da galeria (escala ~0,53) o padding de 216px virava 216px de
  // tela em vez de 115, e o ajuste esmagava o tipo até o piso.
  const cs = getComputedStyle(mid);
  const b = mid.getBoundingClientRect();
  const escala = mid.clientWidth > 0 ? b.width / mid.offsetWidth : 1;
  const pad = (valor: string) => (parseFloat(valor || "0") || 0) * escala;
  const caixa = {
    top: b.top + pad(cs.paddingTop),
    left: b.left + pad(cs.paddingLeft),
    bottom: b.bottom - pad(cs.paddingBottom),
    right: b.right - pad(cs.paddingRight),
  };
  const fora = { ...vazio };
  for (const filho of Array.from(mid.children)) {
    const r = filho.getBoundingClientRect();
    // filho colapsado (corpo vazio) não conta
    if (r.width === 0 && r.height === 0) continue;

    // Caixa de LAYOUT do filho, sem a rotação dele.
    //
    // MEDIDO: a manchete da Punk é um bloco de largura cheia com
    // `rotate(-1.6deg)`. A caixa envolvente de um retângulo girado é SEMPRE
    // mais larga que o retângulo, e como o bloco já ocupa a largura toda do
    // `.mid`, a conta nunca fechava no eixo horizontal — o laço de ajuste
    // descia até o piso em qualquer texto, esmagando o tipo. Reduzir padding
    // não resolvia: o bloco encolhe junto e o excesso continua.
    //
    // Rotação preserva o CENTRO, então dá para recuperar a caixa original
    // exatamente: centro do rect + dimensões de layout (`offsetWidth/Height`,
    // que ignoram transform). O beiço da rotação é escolha de projeto da pele
    // e cai dentro do padding do `.pad`, não para fora da arte.
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    const meiaL = (filho instanceof HTMLElement ? filho.offsetWidth * escala : r.width) / 2;
    const meiaA = (filho instanceof HTMLElement ? filho.offsetHeight * escala : r.height) / 2;

    fora.top = Math.max(fora.top, caixa.top - (cy - meiaA));
    fora.left = Math.max(fora.left, caixa.left - (cx - meiaL));
    fora.bottom = Math.max(fora.bottom, cy + meiaA - caixa.bottom);
    fora.right = Math.max(fora.right, cx + meiaL - caixa.right);
  }
  // De volta para px de LAYOUT: assim a medida (e a tolerância de quem chama)
  // significa a mesma coisa na miniatura de 0,53 e no node do export em 1,0.
  const paraLayout = (v: number) => Math.max(0, v) / (escala || 1);
  fora.top = paraLayout(fora.top);
  fora.left = paraLayout(fora.left);
  fora.bottom = paraLayout(fora.bottom);
  fora.right = paraLayout(fora.right);
  fora.worst = Math.max(fora.top, fora.left, fora.bottom, fora.right);
  return fora;
}

/** Tolerância de 1px: arredondamento de layout não é transbordo. */
export function fitsInMid(slide: Element | null | undefined): boolean {
  return midOverflow(slide).worst <= 1;
}
