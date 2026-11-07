import type { EngineStatus, VideoEngine, VideoModelOption } from "@/hooks/use-video-models";
import { BRAND_LABEL } from "@/lib/brands";
import { modelNote } from "@/lib/model-notes";

// ---------------------------------------------------------------------------
// Portão de geração — regra pura (sem rede, sem React). O portão é UMA LISTA
// ordenada pela inteligência com todas as opções (provedor · modelo) da tarefa:
// a Recomendada no topo com selo e motivo, depois as com preço por preço
// crescente, depois as sem preço, desconectadas por último. O componente
// <GenerationGate> só desenha o que `rankOptions` devolve.
//
// Regras fixas do dono do produto:
//   1. o usuário sempre escolhe provedor e modelo, explícitos e visíveis;
//   2. o custo aparece antes de gerar, como teto ("até US$ X"); sem preço não
//      bloqueia, só avisa; sem base (0 s / 0 letras / 0 imagens) não há valor;
//   3. "Recomendado" nasce marcado, com uma linha de motivo. A recomendação pode
//      não ter preço (Higgsfield com apresentador; a voz da marca na ElevenLabs);
//   4. "Comparar duas" gera o primeiro trecho nas duas marcadas (A + B = Total),
//      com estimativa só quando as duas têm preço.
// ---------------------------------------------------------------------------

/** Provedores que aparecem numa lista (os dois motores de cena + voz e lipsync). */
export type GateProvider = VideoEngine | "elevenlabs" | "heygen";

export type GateTier = "cheapest" | "recommended" | "best";

/** Opção do catálogo já com o provedor (todos os provedores usam o mesmo shape). */
export interface GateOption extends VideoModelOption {
  engine: GateProvider;
}

export interface GateSignals {
  /** há apresentador fixo escolhido (rosto que precisa repetir em todas as cenas) */
  hasPresenter: boolean;
  /** segundos de cena no total (a soma das cenas; a estimativa multiplica por isto) */
  durationSeconds: number;
  /** quantidade de cenas; 1 quando ausente. Duração por cena = durationSeconds / scenes. */
  scenes?: number;
  /** letras do texto, para modelos cobrados por 1k caracteres (voz) */
  chars?: number;
  /** imagens, para modelos cobrados por imagem (quadros); padrão = cenas */
  images?: number;
  /** "Gerar só os quadros (teste barato)" ligado */
  isDraft: boolean;
  /**
   * Cobrança por unidade (Diretor): cada cena vira um clipe com a fala + `padSeconds`,
   * nunca abaixo de `minSeconds` (piso do motor). Ausente = preço × segundos de cena.
   */
  units?: { padSeconds: number; minSeconds: number };
  connected: Partial<Record<GateProvider, EngineStatus>>;
}

/** Regra da tarefa por cima da regra geral: quem a lista recomenda. */
export interface RankRule {
  /** id a recomendar quando a linha existe, está conectada e aguenta a base */
  preferredId?: string | null;
}

export const TIER_LABEL: Record<GateTier, string> = {
  cheapest: "Mais barato",
  recommended: "Recomendado",
  best: "Melhor qualidade",
};

/** Motivo do MOTOR recomendado (a lista mostra a nota do modelo; isto vai para a tela de decisão). */
export const ENGINE_REASON: Record<VideoEngine, string> = {
  higgsfield: "Mesmo rosto em todas as cenas.",
  replicate: "Preço conhecido por segundo.",
};

export function providerName(engine: GateProvider): string {
  return BRAND_LABEL[engine];
}

/** Segundos por cena: o que o modelo precisa aguentar. */
export function sceneSeconds(signals: Pick<GateSignals, "durationSeconds" | "scenes">): number {
  const scenes = Math.max(1, Math.trunc(signals.scenes ?? 1));
  return Math.max(1, Math.ceil(Math.max(0, signals.durationSeconds) / scenes));
}

export function fitsDuration(option: VideoModelOption, perScene: number): boolean {
  return option.maxSeconds == null || option.maxSeconds >= perScene;
}

/** Cobra em blocos fixos (Kling 5/10 s…): o que `limits.durations[]` do catálogo diz. */
export function billsInBlocks(option: VideoModelOption): boolean {
  return option.durationMode === "discrete";
}

/** Duração contínua (casa com o áudio): o que `limits.duration_min/max` do catálogo diz. */
export function isContinuous(option: VideoModelOption): boolean {
  return option.durationMode === "continuous";
}

/**
 * Segundos cobrados por cena num modelo de blocos: o bloco seguinte ao pedido
 * (6 s → 10 s), ou o maior bloco quando passa de todos. Mesma regra do
 * `resolveDuration`/`billableDuration` do servidor.
 */
export function billableSeconds(option: VideoModelOption, perScene: number): number {
  const blocks = option.durations ?? [];
  if (option.durationMode === "discrete" && blocks.length > 0) {
    const sorted = [...blocks].sort((a, b) => a - b);
    return sorted.find((value) => value >= perScene) ?? sorted[sorted.length - 1];
  }
  return perScene;
}

/**
 * Segundos cobrados por clipe no Diretor (aproximação da tela): o servidor gera
 * um clipe por unidade com ceil(fala + 1 s), preso entre o piso (4 s) e o máximo
 * do modelo, e o modelo de blocos sobe para o bloco seguinte. A tela não conhece
 * a fala nem o agrupamento: assume uma unidade por cena (o teto).
 */
export function unitBillableSeconds(
  option: VideoModelOption,
  signals: Pick<GateSignals, "durationSeconds" | "scenes" | "units">,
): number {
  const scenes = Math.max(1, Math.trunc(signals.scenes ?? 1));
  const perScene = Math.max(0, signals.durationSeconds) / scenes;
  if (!signals.units) return billableSeconds(option, sceneSeconds(signals));
  const floor = option.minSeconds ?? signals.units.minSeconds;
  const padded = Math.max(floor, Math.ceil(perScene + signals.units.padSeconds));
  const capped = option.maxSeconds != null ? Math.min(option.maxSeconds, padded) : padded;
  return billableSeconds(option, capped);
}

function hasPrice(option: VideoModelOption): boolean {
  return option.usdPerSecond != null || option.usdPer1kChars != null || option.usdPerImage != null;
}

function unitPrice(option: VideoModelOption): number {
  return (
    option.usdPerSecond ?? option.usdPer1kChars ?? option.usdPerImage ?? Number.POSITIVE_INFINITY
  );
}

function byPriceAsc(a: GateOption, b: GateOption): number {
  return unitPrice(a) - unitPrice(b);
}

// ---------------------------------------------------------------------------
// Motor recomendado (cenas)
// ---------------------------------------------------------------------------

export interface EngineRecommendation {
  engine: VideoEngine;
  reason: string;
}

/**
 * Apresentador fixo + Higgsfield não desconectado → Higgsfield (mesmo sem
 * preço — o selo é recomendação, não afirmação de custo); senão Replicate;
 * desconectado nunca. null = nenhum motor de cena na lista.
 */
export function recommendEngine(
  options: GateOption[],
  signals: GateSignals,
): EngineRecommendation | null {
  const available = (engine: VideoEngine) =>
    signals.connected[engine] !== "off" && options.some((o) => o.engine === engine);
  if (signals.hasPresenter && available("higgsfield"))
    return { engine: "higgsfield", reason: ENGINE_REASON.higgsfield };
  if (available("replicate")) return { engine: "replicate", reason: ENGINE_REASON.replicate };
  if (available("higgsfield")) return { engine: "higgsfield", reason: ENGINE_REASON.higgsfield };
  return null;
}

/**
 * Modelo recomendado dentro de um motor: entre os com preço por segundo e sem
 * blocos, o de duração contínua — o mais barato em rascunho, o padrão do
 * catálogo (ou o mais caro) em produção; sem contínuo, o do meio. Motor sem
 * preço (Higgsfield hoje): o padrão do catálogo.
 */
function recommendInEngine(
  candidates: GateOption[],
  engine: VideoEngine,
  signals: GateSignals,
): GateOption | null {
  const mine = candidates.filter((o) => o.engine === engine);
  const priced = mine.filter((o) => o.usdPerSecond != null && !billsInBlocks(o)).sort(byPriceAsc);
  if (priced.length === 0) return mine.find((o) => o.isDefault) ?? mine[0] ?? null;
  const continuous = priced.filter(isContinuous);
  if (continuous.length > 0) {
    if (signals.isDraft) return continuous[0];
    return continuous.find((o) => o.isDefault) ?? continuous[continuous.length - 1];
  }
  return signals.isDraft ? priced[0] : priced[Math.floor((priced.length - 1) / 2)];
}

// ---------------------------------------------------------------------------
// Estimativa síncrona a partir do catálogo (teto)
// ---------------------------------------------------------------------------

export type GateEstimate =
  | {
      kind: "catalog";
      /** teto em dólares ("até US$ X") */
      maxUsd: number;
      /** do que o valor depende, em uma linha */
      dependsOn: string;
      /** A + B quando "Comparar duas" está ligado (as duas com preço) */
      parts?: { a: number; b: number };
    }
  | { kind: "none"; reason: string };

/** Sem preço: quem cobra e como — a frase da base (long) e a da coluna da lista (short). */
export const NO_PRICE: Record<GateProvider, { long: string; short: string }> = {
  higgsfield: {
    long: "cobrado em créditos na sua conta Higgsfield",
    short: "sem estimativa · créditos Higgsfield",
  },
  elevenlabs: {
    long: "cobrado na sua conta ElevenLabs",
    short: "sem estimativa · conta ElevenLabs",
  },
  heygen: { long: "cobrado à parte pela HeyGen", short: "cobrado à parte pela HeyGen" },
  replicate: { long: "modelo sem preço no catálogo", short: "sem preço no catálogo" },
};

export function noPriceReason(engine: GateProvider): string {
  return NO_PRICE[engine].long;
}

export function noPriceShort(engine: GateProvider): string {
  return NO_PRICE[engine].short;
}

function scenesLabel(scenes: number): string {
  return `${scenes} cena${scenes === 1 ? "" : "s"}`;
}

type Basis = "seconds" | "chars" | "images";

/** Em que base o modelo cobra. */
function basisOf(option: VideoModelOption): Basis | null {
  if (option.usdPerSecond != null) return "seconds";
  if (option.usdPer1kChars != null) return "chars";
  if (option.usdPerImage != null) return "images";
  return null;
}

/** Quantidade da base nos sinais (0 = sem base → sem valor). */
function basisAmount(basis: Basis, signals: GateSignals): number {
  switch (basis) {
    case "seconds":
      return Math.max(0, signals.durationSeconds);
    case "chars":
      return Math.max(0, signals.chars ?? 0);
    case "images":
      return Math.max(0, signals.images ?? signals.scenes ?? 0);
  }
}

/** Há base para estimar (segundos, letras ou imagens > 0)? */
export function hasBasis(option: VideoModelOption, signals: GateSignals): boolean {
  const basis = basisOf(option);
  return basis != null && basisAmount(basis, signals) > 0;
}

/**
 * Teto de UMA opção sobre a base dos sinais. Blocos (Kling 5/10 s…): cada cena
 * paga o bloco seguinte à sua duração — 5 cenas de 6 s pagam 5 × 10 s. null =
 * sem preço ou sem base.
 */
export function optionUsd(option: GateOption, signals: GateSignals): number | null {
  const basis = basisOf(option);
  if (!basis) return null;
  const amount = basisAmount(basis, signals);
  if (amount <= 0) return null;
  switch (basis) {
    case "seconds": {
      if (billsInBlocks(option) || signals.units) {
        const scenes = Math.max(1, Math.trunc(signals.scenes ?? 1));
        return (option.usdPerSecond as number) * unitBillableSeconds(option, signals) * scenes;
      }
      return (option.usdPerSecond as number) * amount;
    }
    case "chars":
      return (option.usdPer1kChars as number) * (amount / 1000);
    case "images":
      return (option.usdPerImage as number) * amount;
  }
}

/** "depende de 24 s de cena · 5 cenas" / "depende de 320 letras" / "depende de 5 imagens". */
export function basisLabel(signals: GateSignals, option?: GateOption | null): string {
  const basis = option ? basisOf(option) : signals.chars != null ? "chars" : "seconds";
  if (basis === "chars") return `depende de ${Math.max(0, signals.chars ?? 0)} letras`;
  if (basis === "images") {
    const n = Math.max(0, signals.images ?? signals.scenes ?? 0);
    return `depende de ${n} ${n === 1 ? "imagem" : "imagens"}`;
  }
  const count = Math.max(1, Math.trunc(signals.scenes ?? 1));
  const base = `depende de ${Math.round(Math.max(0, signals.durationSeconds))} s de cena · ${scenesLabel(count)}`;
  // por unidade: o que o modelo cobra de fato (piso de 4 s, +1 s por clipe, blocos)
  if (signals.units && option?.usdPerSecond != null) {
    return `${base} · cobra ${count} × ${unitBillableSeconds(option, signals)} s`;
  }
  return base;
}

/**
 * `pick` gera tudo; `ab` ("Comparar duas") repete o primeiro trecho. Sem preço
 * em qualquer um dos dois → sem estimativa (avisa, não bloqueia). Sem base
 * (0 s) → null: a linha fica sem valor.
 *
 * Teto do B: o servidor roda o braço B na primeira unidade AGRUPADA do plano
 * (pode juntar várias cenas), capada só pelo máximo do modelo B. O front não
 * conhece o agrupamento, então o teto honesto é min(máximo do modelo B, duração
 * total) — nunca abaixo do que o servidor pode cobrar.
 */
export function estimateFromCatalog(
  pick: GateOption | null | undefined,
  ab: GateOption | null | undefined,
  signals: GateSignals,
): GateEstimate | null {
  if (!pick) return { kind: "none", reason: "escolha um modelo" };
  if (!hasPrice(pick)) return { kind: "none", reason: noPriceReason(pick.engine) };
  const a = optionUsd(pick, signals);
  if (a == null) return null;
  const dependsOn = basisLabel(signals, pick);

  if (!ab) return { kind: "catalog", maxUsd: a, dependsOn };
  if (!hasPrice(ab)) return { kind: "none", reason: noPriceReason(ab.engine) };

  // por unidade, o clipe do B também ganha +1 s e o piso do motor
  const total = Math.max(0, signals.durationSeconds) + (signals.units?.padSeconds ?? 0);
  const floor = signals.units ? (ab.minSeconds ?? signals.units.minSeconds) : 0;
  const firstGroup = Math.max(floor, Math.min(total, ab.maxSeconds ?? total));
  const b =
    ab.usdPerSecond != null
      ? ab.usdPerSecond * (billsInBlocks(ab) ? billableSeconds(ab, firstGroup) : firstGroup)
      : (optionUsd(ab, signals) ?? 0);
  return {
    kind: "catalog",
    maxUsd: a + b,
    dependsOn: `${dependsOn} · gera o primeiro trecho nos dois modelos`,
    parts: { a, b },
  };
}

// ---------------------------------------------------------------------------
// Ranking: a lista única
// ---------------------------------------------------------------------------

export interface RankedOption {
  option: GateOption;
  /** no máximo um selo por linha */
  badge: GateTier | null;
  /** sublinha: para que serve + limite */
  note: string;
  /** teto da linha; null = sem base (a linha fica só com nome e nota) */
  estimate: GateEstimate | null;
  /** linha desabilitada: não aguenta a duração por cena */
  blocked: string | null;
  status: EngineStatus;
}

/**
 * Ordem: Recomendada → com preço por preço crescente → sem preço →
 * desconectadas; dentro de cada grupo, as que não aguentam a duração vão
 * depois. Recomendação: a regra da tarefa (`rule.preferredId`), senão o motor
 * recomendado + o modelo recomendado dentro dele, senão o padrão do catálogo.
 * "Mais barato" e "Melhor qualidade" são os extremos de preço entre as válidas
 * sem blocos (dedup contra a Recomendada).
 */
export function rankOptions(
  options: GateOption[],
  signals: GateSignals,
  rule: RankRule = {},
): RankedOption[] {
  const perScene = sceneSeconds(signals);
  const statusOf = (o: GateOption): EngineStatus => signals.connected[o.engine] ?? "unknown";
  const off = (o: GateOption) => statusOf(o) === "off";
  const blocked = (o: GateOption) =>
    fitsDuration(o, perScene) ? null : `faz até ${o.maxSeconds} s; a cena pede ${perScene} s`;
  const candidates = options.filter((o) => !off(o) && !blocked(o));

  const preferred = rule.preferredId
    ? (candidates.find((o) => o.id === rule.preferredId) ?? null)
    : null;
  const engineRec = recommendEngine(candidates, signals);
  const recommended =
    preferred ??
    (engineRec ? recommendInEngine(candidates, engineRec.engine, signals) : null) ??
    candidates.find((o) => o.isDefault && hasPrice(o)) ??
    candidates.find((o) => o.isDefault) ??
    candidates[0] ??
    null;

  const valid = candidates.filter((o) => hasPrice(o) && !billsInBlocks(o)).sort(byPriceAsc);
  const cheapest = valid[0] && valid[0].id !== recommended?.id ? valid[0] : null;
  const last = valid[valid.length - 1];
  const best =
    last && valid.length > 1 && last.id !== recommended?.id && last.id !== cheapest?.id
      ? last
      : null;

  const rows: RankedOption[] = options.map((o) => ({
    option: o,
    badge:
      o.id === recommended?.id
        ? "recommended"
        : o.id === cheapest?.id
          ? "cheapest"
          : o.id === best?.id
            ? "best"
            : null,
    note: modelNote(o, o.capability),
    estimate: estimateFromCatalog(o, null, signals),
    blocked: blocked(o),
    status: statusOf(o),
  }));

  const group = (r: RankedOption) =>
    r.badge === "recommended" ? 0 : r.status === "off" ? 3 : hasPrice(r.option) ? 1 : 2;
  return rows.sort(
    (x, y) =>
      group(x) - group(y) ||
      Number(x.blocked != null) - Number(y.blocked != null) ||
      unitPrice(x.option) - unitPrice(y.option) ||
      x.option.label.localeCompare(y.option.label),
  );
}

export interface GateSelection {
  /** id do modelo principal (A); null = a Recomendada */
  a: string | null;
  /** id do segundo modelo (B) em "Comparar duas" */
  b: string | null;
}

/**
 * A e B efetivos: a escolha, se ainda válida; senão a primeira linha válida (A)
 * / a seguinte (B). Nenhuma linha válida (todas bloqueadas por duração) → A nulo:
 * o CTA desliga e `allBlockedReason` explica.
 */
export function resolveRanked(
  rows: RankedOption[],
  selection: GateSelection,
  compare: boolean,
): { a: RankedOption | null; b: RankedOption | null } {
  const selectable = (r: RankedOption) => r.blocked == null;
  const explicitA = rows.find((r) => r.option.id === selection.a && selectable(r));
  const a = explicitA ?? rows.find(selectable) ?? null;
  if (!compare || !a) return { a, b: null };
  const explicitB = rows.find(
    (r) => r.option.id === selection.b && selectable(r) && r.option.id !== a.option.id,
  );
  const b =
    explicitB ??
    rows.find((r) => selectable(r) && r.option.id !== a.option.id && r.status !== "off") ??
    null;
  return { a, b };
}

/** Todas as linhas bloqueadas por duração: o que a pessoa pode fazer. */
export function allBlockedReason(rows: RankedOption[], perScene: number): string | null {
  if (rows.length === 0 || rows.some((r) => r.blocked == null)) return null;
  return `Nenhum modelo faz cenas de ${perScene} s. Reduza a duração ou aumente o nº de cenas.`;
}

/** Motivo quando a escolha explícita deixou de aguentar a duração. */
export function selectionFallbackReason(
  rows: RankedOption[],
  selection: GateSelection,
  perScene: number,
): string | null {
  const chosen = rows.find((r) => r.option.id === selection.a);
  if (!chosen?.blocked) return null;
  const fallback = resolveRanked(rows, selection, false).a;
  if (!fallback || fallback.option.id === chosen.option.id) return null;
  return `Este modelo faz até ${chosen.option.maxSeconds} s. Para ${perScene} s, use ${fallback.option.label}.`;
}

// ---------------------------------------------------------------------------
// Duração do Diretor a partir do modelo escolhido
// ---------------------------------------------------------------------------

/** O envio do Diretor aceita 8–90 s no total (o planejador divide entre as cenas). */
export const DIRECTOR_TOTAL_SECONDS = { min: 8, max: 90, fallback: 24 } as const;

/** Piso do clipe e folga de +1 s por clipe que o servidor soma à fala (unitDuration). */
export const DIRECTOR_UNITS = { padSeconds: 1, minSeconds: 4 } as const;

/**
 * O que a tela oferece de duração para o modelo:
 * - "blocks": o modelo só gera clipes de N s (Kling 5/10). Cada bloco vira um
 *   total-alvo de (N − 1 s) × cenas, para que a fala + 1 s caia no bloco;
 * - "range": duração contínua, até o máximo do modelo por cena.
 */
export type DirectorDurationPlan =
  | { kind: "blocks"; blocks: Array<{ seconds: number; total: number }> }
  | { kind: "range"; min: number; max: number; perSceneMax: number | null };

function clampTotal(value: number): number {
  return Math.min(
    Math.max(Math.round(value), DIRECTOR_TOTAL_SECONDS.min),
    DIRECTOR_TOTAL_SECONDS.max,
  );
}

export function directorDurationPlan(
  option: VideoModelOption | null | undefined,
  scenes: number,
): DirectorDurationPlan {
  const count = Math.max(1, Math.trunc(scenes));
  const blocks = option?.durationMode === "discrete" ? (option.durations ?? []) : [];
  if (blocks.length > 0) {
    const list: Array<{ seconds: number; total: number }> = [];
    for (const seconds of [...blocks].sort((x, y) => x - y)) {
      const total = clampTotal(Math.max(1, seconds - DIRECTOR_UNITS.padSeconds) * count);
      if (!list.some((b) => b.total === total)) list.push({ seconds, total });
    }
    return { kind: "blocks", blocks: list };
  }
  const perSceneMax = option?.maxSeconds ?? null;
  const max =
    perSceneMax != null
      ? Math.max(
          DIRECTOR_TOTAL_SECONDS.min,
          Math.min(DIRECTOR_TOTAL_SECONDS.max, perSceneMax * count),
        )
      : DIRECTOR_TOTAL_SECONDS.max;
  return { kind: "range", min: DIRECTOR_TOTAL_SECONDS.min, max, perSceneMax };
}

/** Total que vai no envio: preso à faixa do modelo, ou o total do bloco mais próximo. */
export function fitDirectorDuration(plan: DirectorDurationPlan, raw: number): number {
  const wanted = Number.isFinite(raw) && raw > 0 ? raw : DIRECTOR_TOTAL_SECONDS.fallback;
  if (plan.kind === "range") return Math.min(Math.max(Math.round(wanted), plan.min), plan.max);
  if (plan.blocks.length === 0) return clampTotal(wanted);
  return plan.blocks.reduce(
    (best, b) => (Math.abs(b.total - wanted) < Math.abs(best - wanted) ? b.total : best),
    plan.blocks[0].total,
  );
}
