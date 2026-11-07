// _shared/scene-actions.ts — o catálogo de AÇÕES DE CENA.
// Fonte: painel de dailies de 2026-08-19 (docs/11, seção de direção).
//
// A causa-raiz do "vídeo parado", confirmada frame a frame: o prompt de
// movimento dizia "nada mais se move além do que já está no quadro" e o
// keyframe era pedido congelado — a câmera passeava por um quadro morto.
// Cinema é gente fazendo coisa: a prancheta CHEGA à outra mão, o dedo TOCA a
// tela, a etiqueta SAI da impressora.
//
// Cada ação é um PAR de strings: `kf` entra no prompt do KEYFRAME (a ação nasce
// INICIADA — meio-gesto, objeto em desequilíbrio) e `mv` entra no prompt de
// MOVIMENTO (a ação COMPLETA o arco dentro do clipe). O par garante que o i2v
// só termina o que o quadro já começou — é isso que evita deformação sem matar
// a vida da cena.
//
// Strings em inglês de propósito: os modelos de imagem/vídeo respondem melhor
// a direção em inglês (pesquisa do painel); a fala do produto segue em pt-BR.

export interface SceneAction {
  /** Fragmento para o prompt do keyframe: a ação já iniciada no quadro. */
  kf: string;
  /** Fragmento para o prompt de movimento: a ação completando o arco. */
  mv: string;
}

/**
 * Ações PRIMÁRIAS: protagonizam o plano e completam um arco. Mão humana sempre
 * ANCORADA a um objeto (mão livre em motricidade fina deforma).
 */
export const PRIMARY_ACTIONS: Record<string, SceneAction> = {
  mao_risca_x: {
    kf: "a hand in frame, red marker already touching the desk calendar",
    mv: "the hand draws a firm X on today's date and lifts the marker",
  },
  handoff_prancheta: {
    kf: 'clipboard tilted mid-transfer, one hand releasing it, the other open underneath',
    mv: "the clipboard passes fully into the second worker's hand; he nods and turns away",
  },
  dedo_toca_tela: {
    kf: 'a fingertip one centimeter from the screen, a status button in pending state',
    mv: 'the finger taps the screen and the status button turns green',
  },
  impressora_etiqueta: {
    kf: 'thermal printer with a label already two centimeters out of the slot',
    mv: 'the printer feeds the label out; a hand tears it off',
  },
  ferramenta_pousa: {
    kf: 'a hand holding a caliper a few centimeters above the workbench',
    mv: 'the hand sets the caliper down and slides out of frame',
  },
  papel_desliza: {
    kf: "a loose sheet balanced on the pile's edge",
    mv: 'the sheet slips off the pile and settles on the desk',
  },
};

/**
 * Ações AMBIENT: vida de fundo e atmosfera. Nunca protagonizam; são o que
 * separa um cenário vivo de um cenário de maquete.
 */
export const AMBIENT_ACTIONS: Record<string, SceneAction> = {
  operario_atravessa: {
    kf: 'a blurred worker mid-stride in the background corridor',
    mv: 'a blurred worker walks across the background',
  },
  operarios_ciclicos: {
    kf: 'two blurred workers in working posture at machines in the background',
    mv: 'background workers keep operating machines in slow repetitive motion',
  },
  empilhadeira_cruza: {
    kf: 'a forklift partially visible at the frame edge, headlight on',
    mv: 'a forklift crosses the far background, out of focus',
  },
  fagulhas_solda: {
    kf: 'a welding point already glowing with a light halo behind safety glass',
    mv: 'welding sparks drift and fade behind the glass',
  },
  vapor_particulas: {
    kf: 'a thin steam wisp rising from a machine; dust motes visible in a light beam',
    mv: 'steam rises gently; dust motes float in the light beams',
  },
  andon_muda_cor: {
    kf: 'an andon stack light in frame, one color lit',
    mv: 'the stack light blinks and switches from red to green',
  },
  telefone_vibra: {
    kf: 'a desk phone with its call LED lit, handset slightly off the hook',
    mv: "the phone's LED blinks as it buzzes softly",
  },
  esteira_cnc: {
    kf: 'a conveyor with parts at irregular positions, operation light on',
    mv: 'the conveyor advances the parts steadily',
  },
  monitor_atualiza: {
    kf: 'a screen glow visible in frame, its content out of focus',
    mv: 'the out-of-focus screen flickers as its content refreshes',
  },
};

export const PRIMARY_IDS = Object.keys(PRIMARY_ACTIONS);
export const AMBIENT_IDS = Object.keys(AMBIENT_ACTIONS);

export interface SceneActionChoice {
  /** id de PRIMARY_ACTIONS; null em plano de avatar (o fabric anima a pessoa). */
  primary: string | null;
  /** 1-2 ids de AMBIENT_ACTIONS. */
  ambient: string[];
}

/** Defaults seguros quando o diretor não escolher (ou escolher id inexistente). */
export function normalizeSceneAction(
  raw: unknown,
  type: 'avatar' | 'broll',
): { choice: SceneActionChoice; fixed: boolean } {
  const input = (raw ?? {}) as { primary?: unknown; ambient?: unknown };
  let fixed = false;

  let primary = typeof input.primary === 'string' && PRIMARY_ACTIONS[input.primary]
    ? input.primary
    : null;
  if (typeof input.primary === 'string' && !PRIMARY_ACTIONS[input.primary]) fixed = true;

  // Avatar: o fabric anima rosto e gestos sozinho — ação primária ali compete
  // com a pessoa e deforma; a vida vem do FUNDO (exatamente 2 ambient).
  if (type === 'avatar' && primary !== null) {
    primary = null;
    fixed = true;
  }

  let ambient = (Array.isArray(input.ambient) ? input.ambient : [])
    .filter((id): id is string => typeof id === 'string' && Boolean(AMBIENT_ACTIONS[id]));
  if (Array.isArray(input.ambient) && ambient.length !== input.ambient.length) fixed = true;

  const want = type === 'avatar' ? 2 : Math.max(1, Math.min(2, ambient.length || 1));
  if (ambient.length < want) {
    const fallback = type === 'avatar'
      ? ['operarios_ciclicos', 'vapor_particulas']
      : ['vapor_particulas', 'operario_atravessa'];
    for (const id of fallback) {
      if (ambient.length >= want) break;
      if (!ambient.includes(id)) ambient.push(id);
    }
    fixed = true;
  }
  if (ambient.length > 2) {
    ambient = ambient.slice(0, 2);
    fixed = true;
  }

  return { choice: { primary, ambient }, fixed };
}
