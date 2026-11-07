import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { ChannelType } from "@/hooks/use-channels";
import type { ContextKind } from "@/hooks/use-context-items";
import { supabase } from "@/integrations/supabase/client";
import { getFunctionErrorMessage } from "@/lib/edge-functions";

// ---------------------------------------------------------------------------
// Tipos (espelham docs/04-modelo-de-dados.md §6.9/§8.7 e 07-contratos-backend.md
// §3.1/§3.2 — enum job_status e jsonb classification/selected_angle/timings)
// ---------------------------------------------------------------------------

export const JOB_STATUSES = [
  "created",
  "classifying",
  "awaiting_angle",
  "retrieving",
  "researching",
  "generating",
  "linting",
  "grounding",
  "judging",
  "rewriting",
  "adapting",
  "awaiting_review",
  "done",
  "failed",
  "cancelled",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  created: "na fila",
  classifying: "entendendo o tema",
  awaiting_angle: "escolha o ângulo",
  retrieving: "buscando contexto",
  researching: "pesquisando na internet",
  generating: "gerando",
  linting: "conferindo regras da marca",
  grounding: "conferindo fatos",
  judging: "avaliando qualidade",
  rewriting: "reescrevendo",
  adapting: "adaptando aos canais",
  awaiting_review: "em revisão",
  done: "concluído",
  failed: "falhou",
  cancelled: "cancelado",
};

/** Estados terminais — o job não muda mais sozinho. */
export function isTerminalStatus(status: JobStatus): boolean {
  return status === "done" || status === "failed" || status === "cancelled";
}

/** Estados de processamento ativo (a saga está rodando em background). */
export const PROCESSING_JOB_STATUSES: readonly JobStatus[] = [
  "created",
  "classifying",
  "retrieving",
  "researching",
  "generating",
  "linting",
  "grounding",
  "judging",
  "rewriting",
  "adapting",
];

/**
 * Estados canceláveis pelo dono/admin (update direto permitido pelo RLS só
 * para cancelamento — docs/04-modelo-de-dados.md §6.9). `awaiting_review`
 * fica de fora: a revisão é humana, na Biblioteca.
 */
export const CANCELLABLE_JOB_STATUSES: readonly JobStatus[] = [
  ...PROCESSING_JOB_STATUSES,
  "awaiting_angle",
];

/** §8.7 — opção de ângulo proposta pelo roteador. */
export interface AngleOption {
  id: string;
  title: string;
  hook: string;
  rationale?: string;
}

/** §8.7 — saída do roteador (structured output). */
export interface Classification {
  format: string | null;
  channel_types: ChannelType[];
  thesis: string | null;
  angles: AngleOption[];
  context_query: string;
  context_filters?: { kinds?: ContextKind[]; tags?: string[] };
  needs_angle_choice: boolean;
}

/** §8.7 — telemetria de uma etapa da saga. */
export interface StageTiming {
  started_at: string;
  ended_at: string;
  ms: number;
  provider?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd_est?: number;
  attempts?: number;
}

export type TimedStage =
  | "classifying"
  | "retrieving"
  | "researching"
  | "generating"
  | "linting"
  | "grounding"
  | "judging"
  | "rewriting"
  | "adapting";

export type JobTimings = Partial<Record<TimedStage, StageTiming>> & {
  totals?: {
    input_tokens: number;
    output_tokens: number;
    cost_usd_est: number;
    attempts: number;
    wall_ms: number;
  };
};

/** §8.7 — fonte encontrada pela pesquisa web. */
export interface WebResearchSource {
  url: string;
  title: string;
  snippet?: string;
  published?: string;
}

/** §8.7 — registro da etapa `researching` (generation_jobs.web_research). */
export interface WebResearch {
  requested: boolean;
  provider?: "tavily" | "firecrawl" | "openai";
  query?: string;
  item_id?: string;
  sources?: WebResearchSource[];
  searched_at?: string;
  skipped?: "unavailable" | "error";
  error?: string;
  /** Provedores que falharam antes do que respondeu (ou todos, quando nenhum respondeu). */
  attempts?: { provider: string; error: string }[];
}

export interface GenerationJob {
  id: string;
  prompt: string;
  status: JobStatus;
  classification: Classification | null;
  selected_angle: AngleOption | null;
  context_ids: string[];
  attempt: number;
  error: string | null;
  timings: JobTimings;
  web_research: WebResearch | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Resumo de peça criada pelo job (links "Ver na Biblioteca"). */
export interface JobPieceSummary {
  id: string;
  job_id: string;
  channel_type: ChannelType;
  status: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Erros das edge functions do motor — 404 na invocação significa que o motor
// (F2 backend) ainda não foi deployado nesta instância.
// ---------------------------------------------------------------------------

const ENGINE_NOT_DEPLOYED_MESSAGE =
  "A geração ainda não está disponível nesta instância. Peça ao administrador para ativá-la e tente de novo.";

async function getEngineErrorMessage(error: unknown, fallback: string): Promise<string> {
  const status = (error as { context?: { status?: number } } | null)?.context?.status;
  if (status === 404) return ENGINE_NOT_DEPLOYED_MESSAGE;
  return getFunctionErrorMessage(error, fallback);
}

// ---------------------------------------------------------------------------
// Leituras — query keys ['jobs'], ['job', id], ['job-pieces', jobId]
// ---------------------------------------------------------------------------

/** Últimos 20 jobs (mais recente primeiro) — zona 3 de /criar. */
export function useGenerationJobs() {
  return useQuery({
    queryKey: ["jobs"],
    queryFn: async (): Promise<GenerationJob[]> => {
      const { data, error } = await supabase
        .from("generation_jobs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      // classification/selected_angle/timings são jsonb (Json) — §8.7.
      return (data ?? []) as unknown as GenerationJob[];
    },
  });
}

/** Job único por id (timeline em foco). */
export function useGenerationJob(
  jobId: string | undefined,
  options: { refetchInterval?: number | false } = {},
) {
  return useQuery({
    queryKey: ["job", jobId],
    enabled: Boolean(jobId),
    // quem não pode depender do Realtime (modal de configuração) pede polling
    refetchInterval: options.refetchInterval ?? false,
    queryFn: async (): Promise<GenerationJob | null> => {
      if (!jobId) return null;
      const { data, error } = await supabase
        .from("generation_jobs")
        .select("*")
        .eq("id", jobId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      // classification/selected_angle/timings são jsonb (Json) — §8.7.
      return (data ?? null) as unknown as GenerationJob | null;
    },
  });
}

/** Peças criadas pelo job (awaiting_review/done) — links para a Biblioteca. */
export function useJobPieces(jobId: string | undefined, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["job-pieces", jobId],
    enabled: Boolean(jobId) && (options.enabled ?? true),
    queryFn: async (): Promise<JobPieceSummary[]> => {
      if (!jobId) return [];
      const { data, error } = await supabase
        .from("content_pieces")
        .select("id, job_id, channel_type, status, created_at")
        .eq("job_id", jobId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

// ---------------------------------------------------------------------------
// Escritas — edge functions generate-content / resume-job + cancelamento
// ---------------------------------------------------------------------------

export interface CreateGenerationJobInput {
  prompt: string;
  /** Restringe canais alvo; omitido = canais enabled (o roteador decide). */
  channel_types?: ChannelType[];
  /** Liga a etapa `researching` (pesquisa web reativa sobre a pauta). */
  web_search?: boolean;
  /** Fila para o Claude da assinatura: o servidor não gera nada. */
  pedir_ao_claude?: boolean;
}

/**
 * Resposta de generate-content (07 §3.1): sempre {job_id, status:'classifying'}.
 * Os ângulos NÃO voltam aqui — o roteador roda em background e o job chega a
 * `awaiting_angle` via Realtime, com as opções em `classification.angles`.
 */
export interface CreateGenerationJobResult {
  job_id: string;
  status: JobStatus;
}

/** Dispara a geração: POST generate-content {prompt, channel_types?}. */
export function useCreateGenerationJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateGenerationJobInput): Promise<CreateGenerationJobResult> => {
      const { data, error } = await supabase.functions.invoke("generate-content", {
        body: {
          prompt: input.prompt,
          ...(input.channel_types?.length ? { channel_types: input.channel_types } : {}),
          ...(input.web_search ? { web_search: true } : {}),
          ...(input.pedir_ao_claude ? { pedir_ao_claude: true } : {}),
        },
      });
      if (error) {
        throw new Error(await getEngineErrorMessage(error, "Não foi possível iniciar a geração."));
      }
      return data as CreateGenerationJobResult;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

export interface ResumeJobInput {
  job_id: string;
  /** Obrigatório quando o job está em awaiting_angle (07 §3.2). */
  selected_angle?: AngleOption;
}

/** Retoma a saga do checkpoint: POST resume-job {job_id, selected_angle?}. */
export function useResumeJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ResumeJobInput): Promise<{ job_id: string; status: JobStatus }> => {
      const { data, error } = await supabase.functions.invoke("resume-job", {
        body: {
          job_id: input.job_id,
          ...(input.selected_angle ? { selected_angle: input.selected_angle } : {}),
        },
      });
      if (error) {
        throw new Error(await getEngineErrorMessage(error, "Não foi possível retomar a geração."));
      }
      return data as { job_id: string; status: JobStatus };
    },
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["job", input.job_id] });
    },
  });
}

/**
 * Cancela um job: update direto status='cancelled' (o RLS permite ao dono ou
 * admin, e o filtro por estado cancelável evita sobrescrever job terminado).
 */
export function useCancelJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string): Promise<void> => {
      const { data, error } = await supabase
        .from("generation_jobs")
        .update({ status: "cancelled" })
        .eq("id", jobId)
        .in("status", [...CANCELLABLE_JOB_STATUSES])
        .select("id");
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        throw new Error(
          "Esta geração já terminou ou você não tem permissão para cancelá-la. Recarregue a página para ver o status atual.",
        );
      }
    },
    onSuccess: (_data, jobId) => {
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["job", jobId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Realtime (docs/05-rotas-e-modulos.md §6.1): um canal de lista enquanto /criar
// está montada — UPDATE em generation_jobs e INSERT em content_pieces
// invalidam as queries. Fallback: polling de 3s se o canal não conectar
// (ex.: tabelas fora da publication do Realtime).
// ---------------------------------------------------------------------------

export function useGenerationJobsRealtime(): { realtimeConnected: boolean } {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["job"] });
      void queryClient.invalidateQueries({ queryKey: ["job-pieces"] });
    };
    const channel = supabase
      .channel("generation-jobs-feed")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "generation_jobs" },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "content_pieces" },
        invalidate,
      )
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  useEffect(() => {
    if (connected) return;
    const timer = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["job"] });
      void queryClient.invalidateQueries({ queryKey: ["job-pieces"] });
    }, 3000);
    return () => clearInterval(timer);
  }, [connected, queryClient]);

  return { realtimeConnected: connected };
}
