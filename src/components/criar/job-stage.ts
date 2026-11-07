import {
  JOB_STATUSES,
  JOB_STATUS_LABELS,
  type GenerationJob,
  type JobStatus,
} from "@/hooks/use-generation-jobs";

// ---------------------------------------------------------------------------
// Leitura do estado de uma geração em quatro etapas — Planejar → Escrever →
// Avaliar → Pronto — e na fração percorrida da esteira. Sem JSX: alimenta o
// anel e os segmentos de job-progress.tsx (separado por causa do Fast Refresh).
// ---------------------------------------------------------------------------

export const STAGES = ["plan", "write", "judge", "ready"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  plan: "Planejar",
  write: "Escrever",
  judge: "Avaliar",
  ready: "Pronto",
};

const STAGE_OF_STATUS: Record<JobStatus, Stage> = {
  created: "plan",
  classifying: "plan",
  awaiting_angle: "plan",
  retrieving: "plan",
  researching: "plan",
  generating: "write",
  rewriting: "write",
  linting: "judge",
  grounding: "judge",
  judging: "judge",
  adapting: "judge",
  awaiting_review: "ready",
  done: "ready",
  failed: "plan",
  cancelled: "plan",
};

export type StageState = "pending" | "running" | "waiting" | "done" | "failed" | "stopped";

export interface StageView {
  stage: Stage;
  state: StageState;
}

/** Etapa onde uma geração parada (falha/cancelada) estava, pela telemetria. */
function stoppedStage(job: GenerationJob): Stage {
  const t = job.timings ?? {};
  if (t.adapting) return "ready";
  if (t.generating) return "judge";
  if (t.retrieving || t.classifying) return "write";
  return "plan";
}

/** Etapa atual e estado de cada uma das quatro. */
export function stageViews(job: GenerationJob): StageView[] {
  const terminal = job.status === "failed" || job.status === "cancelled";
  const current = terminal ? stoppedStage(job) : STAGE_OF_STATUS[job.status];
  const currentIndex = STAGES.indexOf(current);
  const currentState: StageState =
    job.status === "done"
      ? "done"
      : job.status === "failed"
        ? "failed"
        : job.status === "cancelled"
          ? "stopped"
          : job.status === "awaiting_angle" || job.status === "awaiting_review"
            ? "waiting"
            : "running";
  return STAGES.map((stage, index) => ({
    stage,
    state: index < currentIndex ? "done" : index === currentIndex ? currentState : "pending",
  }));
}

/** Fração percorrida da esteira (0–1), pela posição do status na sequência. */
export function pipelineFraction(job: GenerationJob): number {
  if (job.status === "done") return 1;
  if (job.status === "failed" || job.status === "cancelled") {
    const views = stageViews(job);
    const doneCount = views.filter((v) => v.state === "done").length;
    return doneCount / STAGES.length;
  }
  const index = JOB_STATUSES.indexOf(job.status);
  const last = JOB_STATUSES.indexOf("awaiting_review");
  return Math.max(0, Math.min(1, index / last));
}

/** Título curto do momento da geração (o que está acontecendo agora). */
/** Pedido feito ao Claude da assinatura, pelo conector personalizado (Criar). */
export function withClaude(job: GenerationJob): boolean {
  const t = job.timings as { pedido_claude?: { origem?: string } } | null;
  return (
    t?.pedido_claude?.origem === "criar" &&
    (job.status === "created" || job.status === "generating")
  );
}

export function stageTitle(job: GenerationJob): string {
  if (withClaude(job)) return "Com o seu Claude";
  switch (job.status) {
    case "done":
      return "Pronta";
    case "failed":
      return "A geração falhou";
    case "cancelled":
      return "Geração cancelada";
    case "awaiting_angle":
      return "Escolha o ângulo";
    case "awaiting_review":
      return "Em revisão";
    default: {
      const stage = STAGE_OF_STATUS[job.status];
      return stage === "plan" ? "Planejando" : stage === "write" ? "Escrevendo" : "Avaliando";
    }
  }
}

/** Detalhe de uma linha sob o título: o passo fino em andamento. */
export function stageDetail(job: GenerationJob): string | null {
  if (withClaude(job))
    return "Abra o Claude com o pedido pronto. Ele escreve pelo conector personalizado e a peça aparece aqui.";
  if (job.status === "rewriting") return `reescrevendo · tentativa ${Math.max(job.attempt, 1)}/2`;
  if (job.status === "done" || job.status === "failed" || job.status === "cancelled") return null;
  if (job.status === "awaiting_angle") return "a geração continua depois da sua escolha";
  if (job.status === "awaiting_review") return "aprove ou rejeite na Biblioteca";
  return JOB_STATUS_LABELS[job.status];
}
