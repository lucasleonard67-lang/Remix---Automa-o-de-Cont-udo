// _shared/scene-edit.ts — editar uma cena de um vídeo pronto do Diretor.
// Contrato: docs/hub-motor-contratos.md §10. Aqui só decisões puras (o que
// cada cena permite, custo, validação, troca de clipe); a orquestração fica
// no director-advance (slot de edição) e as ações no video-remake.

import { estimateCostUsd, fitResolution, type VideoModelEntry } from './video-catalog.ts';

/** Clipe da montagem (o mesmo formato de artifacts.videos[] do Diretor). */
export interface ClipArt {
  shot: number;
  path: string;
  dur_s: number;
  cta?: boolean;
  members?: number[];
}

export interface EditOption {
  available: boolean;
  usd: number | null;
  reason: string | null;
}

export interface SceneEditMode {
  edit: EditOption & { model_id: string | null };
  redo: EditOption;
  scope: number[];
}

export type EditKind = 'edit' | 'redo' | 'undo';

export interface SceneEditState {
  status: 'running' | 'done' | 'failed';
  kind: EditKind;
  prompt: string;
  error: string | null;
  can_undo: boolean;
  scope: number[];
  started_at: number;
  finished_at?: number;
}

export const EDIT_PROMPT_MIN = 3;
export const EDIT_PROMPT_MAX = 500;

/** Limites de duração de uma linha do catálogo (faixa ou teto). */
function fitsDuration(entry: VideoModelEntry, dur: number): boolean {
  const l = entry.limits ?? {};
  const max = l.duration_max ?? l.max_duration_s;
  if (typeof l.duration_min === 'number' && dur < l.duration_min) return false;
  if (typeof max === 'number' && dur > max + 0.5) return false;
  return true;
}

function maxDuration(entries: VideoModelEntry[]): number | null {
  const maxes = entries.map((e) => e.limits?.duration_max ?? e.limits?.max_duration_s)
    .filter((n): n is number => typeof n === 'number');
  return maxes.length ? Math.max(...maxes) : null;
}

/**
 * Modelo de edição para um clipe: entre as linhas scene_v2v (já filtradas por
 * provedor/ativas), o primário se couber na duração; senão o mais barato que caiba.
 */
export function pickV2vModel(entries: VideoModelEntry[], dur: number): VideoModelEntry | null {
  const fitting = entries.filter((e) => e.capability === 'scene_v2v' && e.active && fitsDuration(e, dur));
  if (!fitting.length) return null;
  const primary = fitting.find((e) => e.is_primary);
  if (primary) return primary;
  const cost = (e: VideoModelEntry) => estimateCostUsd(e, { duration_s: dur, resolution: fitResolution(e.limits, '1080p') });
  return [...fitting].sort((a, b) => cost(a) - cost(b))[0];
}

/** Clipe (âncora) que contém a cena e as cenas que ele cobre. */
export function clipOfShot(videos: ClipArt[], shot: number): ClipArt | null {
  return videos.find((v) => v.shot === shot || (v.members ?? []).includes(shot)) ?? null;
}

export const scopeOf = (clip: ClipArt): number[] => (clip.members?.length ? [...clip.members] : [clip.shot]);

const round = (n: number) => Number(n.toFixed(2));

export interface EditModesInput {
  /** config.mode do job: só o Diretor de cenas (sem mode) tem cenas */
  mode: string | null | undefined;
  videos: ClipArt[];
  /** linhas ativas scene_v2v do provedor Replicate */
  v2v: VideoModelEntry[];
  replicateConnected: boolean;
  hfConnected: boolean;
  /** motor das cenas do job */
  engine: 'higgsfield' | 'replicate';
  /** linha scene_i2v do job (motor Replicate) para o custo do refazer; null = sem linha */
  sceneEntry: VideoModelEntry | null;
  /** resolução das cenas (config.resolution resolvida) */
  sceneResolution?: string;
}

const NO_SCENES = 'Este vídeo não tem cenas para editar: gere de novo pelo hub.';

/** O que cada cena permite (docs/hub-motor-contratos.md §10.2). Chave = shot. */
export function computeEditModes(input: EditModesInput): Record<string, SceneEditMode> {
  const out: Record<string, SceneEditMode> = {};
  if (input.mode) return out; // avatar, agente, remake: sem cenas
  const v2vMax = maxDuration(input.v2v);
  for (const clip of input.videos) {
    const scope = scopeOf(clip);
    let edit: SceneEditMode['edit'];
    if (!input.replicateConnected) {
      edit = { available: false, usd: null, reason: 'Editar com texto precisa do Replicate conectado.', model_id: null };
    } else {
      const model = pickV2vModel(input.v2v, clip.dur_s);
      if (!model) {
        const reason = !input.v2v.length
          ? 'Nenhum modelo de edição de vídeo ativo no catálogo. Ative um em Config → Integrações → Replicate.'
          : `A cena tem ${Math.round(clip.dur_s)} s; os modelos de edição aceitam até ${v2vMax ?? '?'} s.`;
        edit = { available: false, usd: null, reason, model_id: null };
      } else {
        const usd = estimateCostUsd(model, { duration_s: clip.dur_s, resolution: fitResolution(model.limits, '1080p') });
        edit = { available: true, usd: usd > 0 ? round(usd) : null, reason: null, model_id: model.model_id };
      }
    }
    let redo: EditOption;
    if (!input.hfConnected) {
      redo = { available: false, usd: null, reason: 'Refazer precisa do Higgsfield conectado (é ele que faz o quadro da cena).' };
    } else if (input.engine === 'replicate' && !input.replicateConnected) {
      redo = { available: false, usd: null, reason: 'Refazer esta cena precisa do Replicate conectado.' };
    } else if (input.engine === 'replicate' && !input.sceneEntry) {
      redo = { available: false, usd: null, reason: 'O modelo de cena deste vídeo não está mais ativo no catálogo.' };
    } else if (input.engine === 'replicate' && input.sceneEntry) {
      const usd = estimateCostUsd(input.sceneEntry, { duration_s: clip.dur_s, resolution: input.sceneResolution });
      redo = { available: true, usd: usd > 0 ? round(usd) : null, reason: null };
    } else {
      redo = { available: true, usd: null, reason: null }; // créditos Higgsfield: sem preço em US$
    }
    for (const s of scope) out[String(s)] = { edit, redo, scope };
  }
  return out;
}

export { NO_SCENES };

/** "Estimativa: até US$ X" (como o GenerationGate) ou o aviso sem preço — nunca bloqueia. */
export function estimateLabel(usd: number | null | undefined): string {
  if (typeof usd !== 'number' || !(usd > 0)) return 'Preço a confirmar';
  return `Estimativa: até US$ ${usd.toFixed(2).replace('.', ',')}`;
}

/** Valida o pedido; devolve a frase de erro ou null. */
export function validateSceneEditRequest(kind: unknown, prompt: unknown): string | null {
  if (kind !== 'edit' && kind !== 'redo') return "kind deve ser 'edit' ou 'redo'.";
  const p = typeof prompt === 'string' ? prompt.trim() : '';
  if (p.length > EDIT_PROMPT_MAX) return `Descreva a mudança em até ${EDIT_PROMPT_MAX} caracteres.`;
  if (kind === 'edit' && p.length < EDIT_PROMPT_MIN) return 'Diga o que mudar na cena.';
  return null;
}

/**
 * Lista de clipes da montagem com o da âncora trocado (o clipe novo só entra
 * em artifacts.videos quando o final novo fica pronto).
 */
export function withClip(videos: ClipArt[], clip: ClipArt): ClipArt[] {
  return videos.map((v) => (v.shot === clip.shot ? clip : v));
}

/**
 * Aplica o resultado de uma edição pronta: troca o clipe em videos e mexe na
 * pilha de versões (edit/redo empilha o anterior; undo desempilha).
 */
export function applyClipSwap(
  videos: ClipArt[], versions: Record<string, ClipArt[]>, clip: ClipArt, kind: EditKind,
): { videos: ClipArt[]; versions: Record<string, ClipArt[]> } {
  const key = String(clip.shot);
  const stack = [...(versions[key] ?? [])];
  const current = videos.find((v) => v.shot === clip.shot);
  if (kind === 'undo') stack.pop();
  else if (current) stack.push(current);
  return { videos: withClip(videos, clip), versions: { ...versions, [key]: stack } };
}

/** Linha do prompt de movimento com o ajuste do refazer (cena k dentro do grupo). */
export function redoAdjustment(scope: number[], shot: number, prompt: string): string {
  const p = prompt.trim();
  if (!p) return '';
  const k = scope.indexOf(shot);
  return scope.length > 1 && k >= 0 ? `Adjustment for scene ${k + 1}: ${p}` : `Adjustment: ${p}`;
}
