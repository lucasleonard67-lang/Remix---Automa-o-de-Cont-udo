// _shared/decoupage.ts — validação determinística da decupagem.
// Fonte: docs/11-video-replicate.md §4.5 (painel de cinema, 2026-08-18).
//
// Gramática pedida ao LLM é sugestão; gramática VALIDADA é contrato. Este módulo
// existe porque o modelo, deixado sozinho, preenche "close, contra-plongée,
// 85mm" sem motivo e repete a mesma escala em cortes seguidos — o que na tela lê
// como falha de render, não como corte.
//
// A regra mais importante daqui não é estética: é o INVARIANTE DA FALA. Cada
// frase auditada tem que ser coberta por exatamente um plano. Como o diretor
// escolhe frases por ÍNDICE (nunca digita texto), a checagem é sobre índices e a
// narração é remontada pelo código — a fala aprovada não tem como derivar.

import { splitSentences } from './adapters/base.ts';
import { AVATAR_ANGLES, AVATAR_SIZES, type DirectedShot } from './prompts/scene-director.ts';
import type { ReelBeat } from './types.ts';

export interface PlannedShot {
  beat_index: number;
  shot_index: number;
  role: ReelBeat['role'];
  type: 'avatar' | 'broll';
  /** Remontada pelo código a partir das frases escolhidas — nunca do LLM. */
  narration: string;
  shot_function: string;
  size: string;
  angle: string;
  lens: string;
  movement: string;
  visual_prompt: string;
  duration_target_s: number;
}

/** Palavras que denunciam descrição de tempo — viram colagem de painéis na imagem. */
const TEMPORAL = /\b(depois|em seguida|então|enquanto|antes|logo após|a seguir|se afasta|se aproxima|caminha até|vira[ -]se|corta para|transição)\b/iu;

const SIZE_ORDER = ['DETALHE', 'CLOSE', 'MEIO_CLOSE', 'MEDIO', 'AMPLO_VERTICAL'];

export interface DecoupageResult {
  shots: PlannedShot[];
  /** O que foi corrigido pelo código — vai para a timeline, não some em silêncio. */
  fixes: string[];
}

/** Frases numeradas de um beat, na ordem — a mesma numeração dada ao LLM. */
export function beatSentences(beat: ReelBeat): string[] {
  const parts = splitSentences(beat.narration);
  return parts.length > 0 ? parts : [beat.narration.trim()];
}

/**
 * Valida e conserta a decupagem devolvida pelo diretor.
 *
 * Nunca lança: um storyboard ruim vira um storyboard simples (um plano por
 * bloco), que é exatamente o comportamento antigo. Derrubar a geração inteira
 * por causa de um rótulo de câmera seria pior que a doença.
 */
export function planDecoupage(
  beats: ReelBeat[],
  shots: DirectedShot[],
  hasAvatar: boolean,
  shotsPerBeatMax: number,
): DecoupageResult {
  const fixes: string[] = [];
  const planned: PlannedShot[] = [];

  for (const beat of beats) {
    const sentences = beatSentences(beat);
    // Acima do teto: FUNDE o excedente no último plano mantido, em vez de
    // descartá-lo. Descartar deixaria frases órfãs e derrubaria o bloco inteiro
    // para plano único — perdendo a decupagem que o diretor acertou.
    const own = mergeExcess(
      shots.filter((s) => s.beat_index === beat.index),
      Math.max(1, shotsPerBeatMax),
    );

    const assignment = assignSentences(own, sentences.length);
    if (!assignment) {
      // Cobertura inválida (frase repetida, faltando ou fora de ordem): cai para
      // o bloco inteiro num plano só, preservando a fala.
      fixes.push(`bloco ${beat.index}: distribuição de frases inválida — virou um plano único`);
      planned.push(
        fallbackShot(beat, sentences.join(' '), own[0], hasAvatar, planned.length === 0),
      );
      continue;
    }

    // Take de avatar acima de ~9s é dividido em dois enquadramentos quando há
    // frases para isso: a dessincronia labial do modelo cresce com o take
    // (medido: 12,8s dessincronizou; 6,6s segurou). O corte também dá ritmo.
    const expanded: Array<{ shot: DirectedShot | undefined; indices: number[] }> = [];
    assignment.forEach((indices, position) => {
      const shot = own[position];
      const narration = indices.map((i) => sentences[i]).join(' ');
      const isLongAvatar =
        hasAvatar && shot?.type === 'avatar' && indices.length >= 2 &&
        estimate(narration) > 9;
      if (!isLongAvatar || !shot) {
        expanded.push({ shot, indices });
        return;
      }
      const half = splitIndicesByWords(indices, sentences);
      const altSize = shot.size === 'CLOSE' ? 'MEIO_CLOSE' : 'CLOSE';
      expanded.push({ shot, indices: half[0] });
      expanded.push({ shot: { ...shot, size: altSize }, indices: half[1] });
      fixes.push(
        `bloco ${beat.index}: fala de avatar longa dividida em dois enquadramentos`,
      );
    });

    for (const { shot, indices } of expanded) {
      const narration = indices.map((i) => sentences[i]).join(' ').trim();
      planned.push(
        buildShot(beat, narration, shot, hasAvatar, planned.length === 0, indices.length, sentences.length),
      );
    }
  }

  enforceCutGrammar(planned, fixes);
  planned.forEach((shot, index) => {
    shot.shot_index = index === 0 ? 0 : shot.shot_index;
  });
  renumber(planned);

  return { shots: planned, fixes };
}

/** Mantém `max` planos, jogando as frases dos excedentes no último mantido. */
function mergeExcess(shots: DirectedShot[], max: number): DirectedShot[] {
  if (shots.length <= max) return shots;
  const kept = shots.slice(0, max).map((s) => ({ ...s, sentence_indices: [...(s.sentence_indices ?? [])] }));
  const last = kept[kept.length - 1];
  for (const extra of shots.slice(max)) {
    last.sentence_indices.push(...(extra.sentence_indices ?? []));
  }
  last.sentence_indices = [...new Set(last.sentence_indices)].sort((a, b) => a - b);
  return kept;
}

/** Divide os índices em duas metades balanceadas por contagem de palavras. */
function splitIndicesByWords(indices: number[], sentences: string[]): [number[], number[]] {
  const total = indices.reduce((sum, i) => sum + countWordsOf(sentences[i]), 0);
  let acc = 0;
  for (let cut = 1; cut < indices.length; cut++) {
    acc += countWordsOf(sentences[indices[cut - 1]]);
    if (acc >= total / 2) return [indices.slice(0, cut), indices.slice(cut)];
  }
  return [indices.slice(0, 1), indices.slice(1)];
}

function countWordsOf(text: string): number {
  return (text ?? '').trim().split(/\s+/).filter(Boolean).length;
}

/** Índices de frase por plano, se e somente se a cobertura for exata e em ordem. */
function assignSentences(shots: DirectedShot[], total: number): number[][] | null {
  if (shots.length === 0) return null;
  const seen = new Set<number>();
  const out: number[][] = [];

  for (const shot of shots) {
    const indices = (shot.sentence_indices ?? [])
      .filter((i) => Number.isInteger(i) && i >= 0 && i < total)
      .sort((a, b) => a - b);
    if (indices.length === 0) return null;
    for (const i of indices) {
      if (seen.has(i)) return null; // frase repetida em dois planos
      seen.add(i);
    }
    out.push(indices);
  }

  if (seen.size !== total) return null; // frase órfã
  // A ordem dos planos tem que seguir a ordem da fala.
  const flat = out.flat();
  for (let i = 1; i < flat.length; i++) if (flat[i] < flat[i - 1]) return null;
  return out;
}

const WORDS_PER_SECOND = 2.5;

function estimate(narration: string): number {
  const words = narration.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1.6, Math.round((words / WORDS_PER_SECOND) * 2) / 2);
}

function buildShot(
  beat: ReelBeat,
  narration: string,
  shot: DirectedShot | undefined,
  hasAvatar: boolean,
  isFirst: boolean,
  _covered: number,
  _total: number,
): PlannedShot {
  const type: 'avatar' | 'broll' = hasAvatar && shot?.type === 'avatar' ? 'avatar' : 'broll';
  let size = shot?.size ?? (type === 'avatar' ? 'MEIO_CLOSE' : 'MEDIO');
  let angle = shot?.angle ?? (type === 'avatar' ? 'TRES_QUARTOS_ESQ' : 'FRONTAL_OLHOS');

  // O modelo de fala só sustenta um subconjunto de enquadramentos — verificado
  // com clipe real (3/4 mantém sincronia e enquadramento; perfil e plano aberto
  // desestabilizam a boca).
  if (type === 'avatar') {
    if (!AVATAR_SIZES.includes(size as (typeof AVATAR_SIZES)[number])) size = 'MEIO_CLOSE';
    if (!AVATAR_ANGLES.includes(angle as (typeof AVATAR_ANGLES)[number])) angle = 'TRES_QUARTOS_ESQ';
  }

  return {
    beat_index: beat.index,
    shot_index: 0,
    role: beat.role,
    type,
    narration,
    shot_function: (shot?.function ?? '').trim() || (isFirst ? 'abrir com promessa' : 'sustentar a fala'),
    size,
    angle,
    lens: shot?.lens ?? (type === 'avatar' ? 'TELE_85' : 'NORMAL_40'),
    // Avatar é sempre estático: o fabric não recebe prompt de movimento.
    movement: type === 'avatar' ? 'ESTATICO' : (shot?.movement ?? 'PUSH_IN_LENTO'),
    visual_prompt: cleanVisual(shot?.visual_prompt ?? '', narration),
    duration_target_s: estimate(narration),
  };
}

function fallbackShot(
  beat: ReelBeat,
  narration: string,
  shot: DirectedShot | undefined,
  hasAvatar: boolean,
  isFirst: boolean,
): PlannedShot {
  return buildShot(beat, narration, shot, hasAvatar, isFirst, 1, 1);
}

/**
 * Tira descrição de tempo do prompt de imagem — a causa da colagem de painéis.
 *
 * Descarta a ORAÇÃO inteira que contém a marca temporal, não só a palavra:
 * apagar "depois" de "depois a câmera se afasta e revela" deixa "a câmera se
 * afasta e revela", que continua descrevendo movimento e continua produzindo
 * painéis empilhados.
 */
function cleanVisual(visual: string, narration: string): string {
  const text = visual.trim();
  const fallback = `Cena vertical sóbria, um único instante, que ilustra: ${narration.slice(0, 140)}`;
  if (!text) return fallback;
  if (!TEMPORAL.test(text)) return text;

  const kept = text
    .split(/[,;]|\be\s(?=a\s|o\s)/u)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0 && !TEMPORAL.test(clause));

  const rebuilt = kept.join(', ').replace(/[,;:]\s*$/, '').trim();
  // Sobrou pouco demais para descrever um quadro: melhor a descrição neutra do
  // que um fragmento sem sujeito.
  return rebuilt.split(/\s+/).length >= 4 ? rebuilt : fallback;
}

/**
 * Regras de corte que o LLM erra com frequência: escala repetida e eixo
 * atravessado entre planos vizinhos. Corrigir aqui é barato; deixar passar
 * produz corte que lê como glitch.
 */
function enforceCutGrammar(shots: PlannedShot[], fixes: string[]): void {
  // B-roll parado é slide, não cinema — visto em produção: o diretor travou os
  // quatro planos em ESTATICO e o vídeo inteiro ficou sem vida. Avatar é
  // estático por obrigação (o modelo de fala não aceita movimento); b-roll não.
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    if (shot.type === 'broll' && shot.movement === 'ESTATICO') {
      shot.movement = /dado|númer|prova|revel/i.test(shot.shot_function)
        ? 'RACK_FOCUS'
        : 'PUSH_IN_LENTO';
      fixes.push(`plano ${i}: b-roll estático — recebeu ${shot.movement}`);
    }
  }

  for (let i = 1; i < shots.length; i++) {
    const prev = shots[i - 1];
    const cur = shots[i];

    if (cur.size === prev.size) {
      const pool = cur.type === 'avatar' ? [...AVATAR_SIZES] : SIZE_ORDER;
      const alt = pool.find((s) => s !== prev.size);
      if (alt) {
        fixes.push(`plano ${i}: escala repetida (${cur.size}) — trocada para ${alt}`);
        cur.size = alt;
      }
    }

    // Travessia de eixo entre planos vizinhos: o rosto "pula" de lado.
    const crossed =
      (prev.angle === 'TRES_QUARTOS_ESQ' && cur.angle === 'TRES_QUARTOS_DIR') ||
      (prev.angle === 'TRES_QUARTOS_DIR' && cur.angle === 'TRES_QUARTOS_ESQ');
    if (crossed) {
      fixes.push(`plano ${i}: eixo atravessado — mantido o lado do plano anterior`);
      cur.angle = prev.angle;
    }
  }
}

function renumber(shots: PlannedShot[]): void {
  const perBeat = new Map<number, number>();
  for (const shot of shots) {
    const next = perBeat.get(shot.beat_index) ?? 0;
    shot.shot_index = next;
    perBeat.set(shot.beat_index, next + 1);
  }
}
