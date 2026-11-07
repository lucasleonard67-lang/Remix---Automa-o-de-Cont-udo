// video-costs — gasto por vídeo a partir do que o app já guarda (docs/centro-de-custos/plano.md).
// Só monta a resposta: quem lê o banco é a provider-credits. null = sem dado, nunca zero.

export type Json = Record<string, unknown>;

export interface JobRow {
  id: string; status: string; created_at: string;
  brief: Json | null; plan: Json | null; config: Json | null; costs: Json | null;
}
export interface ReelRow {
  id: string; piece_id: string | null; status: string; created_at: string;
  estimated_cost_usd: number | string | null; actual_cost_usd: number | string | null;
  /** primeira linha da peça, já resolvida */
  title: string | null;
}
export interface PredictionRow {
  project_id: string; kind: string; model_id: string; status: string;
  cost_actual_usd: number | string | null; cost_estimated_usd: number | string | null;
}
export interface EditCostRow {
  id: string; source_kind: string; source_id: string | null; source_path: string | null;
  status: string; cost_usd: number | string | null; created_at: string;
}

export type Etapa = 'cenas' | 'avatar' | 'voz' | 'quadros' | 'montagem' | 'higgsfield' | 'edicao' | 'outros';
export interface VideoStep { etapa: Etapa; modelo: string | null; usd_est: number | null; creditos: number | null }
export type Motivo = 'em_andamento' | 'creditos_sem_fim' | 'heygen_sem_preco' | 'reel_so_estimativa' | 'sem_custo_registrado';

export interface VideoCost {
  id: string;
  /** só no Reel: a tela abre em /biblioteca/$pieceId */
  piece_id: string | null;
  origem: 'job' | 'reel' | 'edicao';
  tipo: 'diretor' | 'remake' | 'avatar' | 'video_agent' | 'reel' | 'edicao';
  titulo: string | null;
  data: string;
  status: 'pronto' | 'andamento' | 'falhou' | 'cancelado';
  status_bruto: string;
  modelos: string[];
  usd_est: number | null;
  creditos: number | null;
  creditos_aproximados: boolean;
  letras: number | null;
  parcial: boolean;
  parcial_motivos: Motivo[];
  etapas: VideoStep[];
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? v as Json : {});
const usd = (v: number) => Number(v.toFixed(4));
const unique = (list: (string | null)[]) => [...new Set(list.filter((v): v is string => !!v))];

function jobStatus(raw: string): VideoCost['status'] {
  if (raw === 'done') return 'pronto';
  if (raw === 'failed') return 'falhou';
  if (raw === 'cancelled' || raw === 'canceled') return 'cancelado';
  return 'andamento';
}

function reelStatus(raw: string): VideoCost['status'] {
  if (raw === 'ready') return 'pronto';
  if (raw === 'failed') return 'falhou';
  if (raw === 'cancelled') return 'cancelado';
  return 'andamento';
}

function editStatus(raw: string): VideoCost['status'] {
  if (raw === 'ready' || raw === 'reverted' || raw === 'suggested') return 'pronto';
  if (raw === 'failed') return 'falhou';
  return 'andamento';
}

/** Mesma ordem do título do JobCard. */
export function jobTitle(job: Pick<JobRow, 'plan' | 'brief'>): string | null {
  const b = obj(job.brief);
  return text(obj(job.plan).concept) ?? text(b.smp) ?? text(b.numero_heroi) ?? text(b.objetivo) ?? text(b.title);
}

/** Primeira linha "cara" da peça, como pieceHeadline, para o que a edge lê do núcleo. */
export function pieceTitle(core: Json | null): string | null {
  const c = obj(core);
  const candidate = text(obj(c.hook).written) ?? text(c.idea);
  return candidate?.split('\n').find((line) => line.trim())?.trim() ?? null;
}

function jobShape(cfg: Json) {
  const remake = obj(cfg.remake), avatar = obj(cfg.avatar_video);
  if (cfg.mode === 'remake') {
    return {
      tipo: 'remake' as const,
      scene: text(remake.scene_model_id) ?? text(cfg.model_id),
      extra: [text(remake.person_model_id), text(remake.tts_model_id)],
    };
  }
  if (cfg.mode === 'avatar_video') return { tipo: 'avatar' as const, scene: text(avatar.model_id) ?? 'heygen/avatar', extra: [] };
  if (cfg.mode === 'video_agent') return { tipo: 'video_agent' as const, scene: 'heygen/video-agent', extra: [] };
  return {
    tipo: 'diretor' as const,
    scene: text(cfg.model_id) ?? text(cfg.engine) ?? 'higgsfield',
    extra: [text(cfg.ab_model_id)],
  };
}

function finish(
  base: Omit<VideoCost, 'modelos' | 'usd_est' | 'creditos' | 'parcial' | 'parcial_motivos' | 'etapas'>,
  etapas: VideoStep[], modelos: (string | null)[], motivos: Set<Motivo>,
): VideoCost {
  const money = etapas.map((e) => e.usd_est).filter((v): v is number => v != null);
  const credits = etapas.map((e) => e.creditos).filter((v): v is number => v != null);
  const usd_est = money.length ? usd(money.reduce((a, b) => a + b, 0)) : null;
  const creditos = credits.length ? Number(credits.reduce((a, b) => a + b, 0).toFixed(1)) : null;
  if (base.status === 'andamento') motivos.add('em_andamento');
  else if (usd_est == null && creditos == null && !motivos.size) motivos.add('sem_custo_registrado');
  const parcial_motivos = [...motivos];
  return { ...base, modelos: unique(modelos), usd_est, creditos, parcial: parcial_motivos.length > 0, parcial_motivos, etapas };
}

function jobCost(job: JobRow, edits: EditCostRow[], editModel: string): VideoCost {
  const cfg = obj(job.config), c = obj(job.costs);
  const shape = jobShape(cfg);
  const status = jobStatus(job.status);
  const motivos = new Set<Motivo>();
  const etapas: VideoStep[] = [];

  const replicate = num(c.replicate_usd_est);
  if (replicate != null) etapas.push({ etapa: 'cenas', modelo: shape.scene, usd_est: usd(replicate), creditos: null });

  const heygen = num(c.heygen_usd_est);
  if (heygen != null) etapas.push({ etapa: 'avatar', modelo: shape.scene, usd_est: usd(heygen), creditos: null });
  else if ((num(c.heygen_seconds) ?? 0) > 0) motivos.add('heygen_sem_preco');

  // saldo inicial menos final: só a lane Higgsfield fecha essa conta, e job que falhou nunca fecha
  const spent = num(c.hf_credits_spent);
  const usesHf = shape.tipo === 'diretor' && (text(cfg.engine) ?? 'higgsfield') === 'higgsfield';
  if (spent != null && spent >= 0) etapas.push({ etapa: 'higgsfield', modelo: shape.scene, usd_est: null, creditos: spent });
  else if (usesHf && num(c.hf_credits_start) != null && status !== 'andamento') motivos.add('creditos_sem_fim');

  const edited = edits.reduce((t, e) => t + (num(e.cost_usd) ?? 0), 0);
  if (edited > 0) etapas.push({ etapa: 'edicao', modelo: editModel, usd_est: usd(edited), creditos: null });

  return finish({
    id: job.id, piece_id: null, origem: 'job', tipo: shape.tipo, titulo: jobTitle(job), data: job.created_at, status,
    status_bruto: job.status, creditos_aproximados: spent != null && spent >= 0, letras: num(c.eleven_chars),
  }, etapas, [shape.scene, ...shape.extra, edited > 0 ? editModel : null], motivos);
}

const REEL_STEP: Record<string, Etapa> = {
  tts: 'voz', keyframe: 'quadros', scene_video: 'cenas', normalize: 'montagem', concat: 'montagem', audio_merge: 'montagem',
};

function reelCost(reel: ReelRow, predictions: PredictionRow[]): VideoCost {
  const motivos = new Set<Motivo>();
  const steps = new Map<string, VideoStep>();
  // 'queued' ainda não foi ao provedor; 'canceled' nunca cobra
  for (const p of predictions) {
    if (p.status === 'queued' || p.status === 'canceled') continue;
    const value = num(p.cost_actual_usd) ?? num(p.cost_estimated_usd);
    const etapa = REEL_STEP[p.kind] ?? 'outros';
    const key = `${etapa}|${p.model_id}`;
    const step = steps.get(key) ?? { etapa, modelo: p.model_id, usd_est: null, creditos: null };
    if (value != null) step.usd_est = usd((step.usd_est ?? 0) + value);
    steps.set(key, step);
  }
  const etapas = [...steps.values()];
  if (!etapas.some((e) => e.usd_est != null)) {
    const actual = num(reel.actual_cost_usd), estimate = num(reel.estimated_cost_usd);
    if ((actual ?? 0) > 0) etapas.push({ etapa: 'outros', modelo: null, usd_est: usd(actual!), creditos: null });
    else if (estimate != null) {
      etapas.push({ etapa: 'outros', modelo: null, usd_est: usd(estimate), creditos: null });
      motivos.add('reel_so_estimativa');
    }
  }
  return finish({
    id: reel.id, piece_id: reel.piece_id, origem: 'reel', tipo: 'reel', titulo: reel.title, data: reel.created_at, status: reelStatus(reel.status),
    status_bruto: reel.status, creditos_aproximados: false, letras: null,
  }, etapas, etapas.map((e) => e.modelo), motivos);
}

function editCost(edit: EditCostRow, editModel: string): VideoCost {
  const value = num(edit.cost_usd);
  return finish({
    id: edit.id, piece_id: null, origem: 'edicao', tipo: 'edicao', titulo: text(edit.source_path)?.split('/').pop() ?? null, data: edit.created_at,
    status: editStatus(edit.status), status_bruto: edit.status, creditos_aproximados: false, letras: null,
  }, value ? [{ etapa: 'edicao', modelo: editModel, usd_est: usd(value), creditos: null }] : [], value ? [editModel] : [], new Set());
}

/** Os `limit` mais recentes das três fontes. Corta antes de somar: cortar pelo custo esconderia os baratos. */
export function newestVideos<J extends { created_at: string }, R extends { created_at: string }, E extends { created_at: string }>(
  jobs: J[], reels: R[], edits: E[], limit: number,
): { jobs: J[]; reels: R[]; edits: E[]; cut: boolean } {
  const all = [...jobs, ...reels, ...edits];
  if (all.length <= limit) return { jobs, reels, edits, cut: false };
  const kept = new Set<object>(all.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit));
  const pick = <T extends { created_at: string }>(list: T[]) => list.filter((row) => kept.has(row));
  return { jobs: pick(jobs), reels: pick(reels), edits: pick(edits), cut: true };
}

/** Linhas por vídeo, do mais caro para o mais barato; sem valor em dólar vai para o fim. */
export function buildVideoCosts(input: {
  jobs: JobRow[]; reels: ReelRow[]; predictions: PredictionRow[]; edits: EditCostRow[]; editModel: string;
}): VideoCost[] {
  const editsOf = new Map<string, EditCostRow[]>();
  for (const e of input.edits) {
    if (!e.source_id) continue;
    editsOf.set(e.source_id, [...(editsOf.get(e.source_id) ?? []), e]);
  }
  const predsOf = new Map<string, PredictionRow[]>();
  for (const p of input.predictions) predsOf.set(p.project_id, [...(predsOf.get(p.project_id) ?? []), p]);

  return [
    ...input.jobs.map((j) => jobCost(j, editsOf.get(j.id) ?? [], input.editModel)),
    ...input.reels.map((r) => reelCost(r, predsOf.get(r.id) ?? [])),
    // edição de arquivo solto não tem job: vira a própria linha
    ...input.edits.filter((e) => !e.source_id).map((e) => editCost(e, input.editModel)),
  ].sort((a, b) => (b.usd_est ?? -1) - (a.usd_est ?? -1) || b.data.localeCompare(a.data));
}
