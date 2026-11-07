import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { EngineNotDeployedError } from "@/hooks/use-heygen-studio";
import { supabase } from "@/integrations/supabase/client";
import { getFunctionError } from "@/lib/edge-functions";

// ---------------------------------------------------------------------------
// Aprimorar com IA (docs/hub-motor-contratos.md §11, docs/motor-de-edicao.md).
// A tabela `video_edits` é a máquina de estados; a edge `video-edit` sugere,
// aplica e reverte. Antes do deploy, a tabela não existe: a leitura volta
// vazia e as ações mostram "Chega no próximo deploy do motor.".
// ---------------------------------------------------------------------------

export type VideoEditStatus =
  "analyzing" | "suggested" | "queued" | "rendering" | "checking" | "ready" | "failed" | "reverted";

export type SuggestionId = "clean" | "tight" | "hook" | "brand" | "sound" | "surprise";

/** Operação do menu fechado (§11.4); a tela só lê `type` e os campos que ajusta. */
export type EditOp = { type: string } & Record<string, unknown>;

/** §11.3 */
export interface EditSuggestion {
  id: SuggestionId;
  title: string;
  gain: string;
  why: string;
  recommended: boolean;
  ops: EditOp[];
  preview: {
    before: { thumb_url: string; duration_s: number };
    after: { thumb_url?: string; duration_s: number };
  };
  usd: number;
}

/** Um item do plano do "Editar com Claude": a pessoa pode tirar antes de aplicar. */
export interface PlanStep {
  title: string;
  detail: string;
}

export interface PlanDraft {
  summary: string;
  steps: PlanStep[];
  not_possible: string[];
  usd: number;
  duration_after: number;
  needs_render?: boolean;
}

export type AttachmentKind = "video" | "image" | "audio";

export interface EditWord {
  text: string;
  start: number;
  end: number;
}

export interface EditAttachment {
  path: string;
  kind: AttachmentKind;
  name: string;
}

export interface VideoEdit {
  id: string;
  status: VideoEditStatus;
  analysis: {
    suggestions?: EditSuggestion[];
    duration_s?: number;
    words?: EditWord[];
    captions_burned?: boolean;
    cost_usd?: number;
    request?: string;
    external?: boolean;
    draft?: PlanDraft;
    attachments?: { path: string; kind: AttachmentKind }[];
    /** conversa com o seu Claude dentro do pedido (video_mensagem ↔ resposta na tela) */
    conversa?: { de: "claude" | "pessoa"; texto: string; em: string }[];
    aguardando_pessoa?: boolean;
  };
  plan: {
    ops?: EditOp[];
    suggestion_ids?: string[];
    steps?: number[];
    dropped?: string[];
    motion?: unknown;
  } | null;
  artifacts?: { last_error?: string };
  output_path: string | null;
  cost_usd: number;
  error: string | null;
  auto: boolean;
  created_at: string;
}

const ACTIVE: VideoEditStatus[] = ["analyzing", "queued", "rendering", "checking"];

export function isEditActive(edit: VideoEdit | null | false | undefined): boolean {
  return Boolean(edit && ACTIVE.includes(edit.status));
}

const COLUMNS =
  "id, status, analysis, plan, artifacts, output_path, cost_usd, error, auto, created_at";

/**
 * A edição mais recente de um vídeo do Diretor. Realtime na tabela e releitura
 * a cada 5 s enquanto o motor trabalha. `null` = nenhuma edição ainda;
 * `false` = a tabela não existe (motor não publicado): a tela some.
 */
export function useLatestVideoEdit(jobId: string) {
  const queryClient = useQueryClient();
  const key = ["video-edit", jobId];

  useEffect(() => {
    const channel = supabase
      .channel(`video-edits-${jobId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "video_edits", filter: `source_id=eq.${jobId}` },
        () => queryClient.invalidateQueries({ queryKey: ["video-edit", jobId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [jobId, queryClient]);

  return useQuery({
    queryKey: key,
    retry: false,
    refetchInterval: (query) =>
      isEditActive(query.state.data) || (query.state.error && query.state.data) ? 5000 : false,
    queryFn: async (): Promise<VideoEdit | null | false> => {
      // `video_edits` ainda não está nos tipos gerados (a migração é do motor)
      const client = supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => {
            eq: (
              column: string,
              value: string,
            ) => {
              order: (
                column: string,
                options: { ascending: boolean },
              ) => {
                limit: (n: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
              };
            };
          };
        };
      };
      const { data, error } = await client
        .from("video_edits")
        .select(COLUMNS)
        .eq("source_id", jobId)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) {
        // só tabela ausente esconde a faixa; erro passageiro repete e mantém a tela
        const code = (error as { code?: string }).code;
        if (code === "PGRST205" || code === "42P01") return false;
        throw error;
      }
      // vídeo aberto pelo conector, ainda sem plano, não cobre o que está na tela
      const rows = (data ?? []) as VideoEdit[];
      const shown = rows.find(
        (row) =>
          !(
            row.status === "suggested" &&
            row.analysis.external &&
            !row.analysis.draft &&
            !row.analysis.request
          ),
      );
      return shown ?? null;
    },
  });
}

async function invokeEdit<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke("video-edit", { body });
  if (error) {
    const status = (error as { context?: { status?: number } } | null)?.context?.status ?? null;
    const { message, code } = await getFunctionError(error, fallback);
    if (status === 404 && code === null) throw new EngineNotDeployedError();
    throw new Error(message);
  }
  return data as T;
}

function useEditMutation<V>(jobId: string, run: (vars: V) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    // devolve a promessa: o botão só libera quando a tela já mostra o novo estado
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["video-edit", jobId] }),
        queryClient.invalidateQueries({ queryKey: ["director-jobs"] }),
      ]),
  });
}

/** O Claude assiste ao vídeo e propõe até 4 melhorias. */
export function useSuggestEdits(jobId: string) {
  return useEditMutation(jobId, () =>
    invokeEdit<{ edit_id: string }>(
      { action: "suggest", source: { job_id: jobId } },
      "Não deu para analisar o vídeo.",
    ),
  );
}

/** Transcreve o vídeo para o painel, sem a API do Claude. */
export function useOpenEdit(jobId: string) {
  return useEditMutation(jobId, () =>
    invokeEdit<{ edit_id: string }>(
      { action: "external_open", source: { job_id: jobId } },
      "Não deu para abrir o vídeo.",
    ),
  );
}

/** Pedido por voz ou texto: o Claude pesquisa o que faltar e devolve um plano. */
export function usePlanEdit(jobId: string) {
  return useEditMutation(
    jobId,
    (vars: { request: string; attachments: string[]; connector?: boolean }) =>
      invokeEdit<{ edit_id: string }>(
        {
          action: "plan",
          source: { job_id: jobId },
          request: vars.request,
          attachments: vars.attachments,
          ...(vars.connector ? { via: "connector" } : {}),
        },
        "Não deu para montar o plano.",
      ),
  );
}

/** Aplica os itens do plano que ficaram. */
export function useApplyPlan(jobId: string) {
  return useEditMutation(jobId, (vars: { editId: string; steps: number[] }) =>
    invokeEdit<{ edit_id: string }>(
      { action: "apply", edit_id: vars.editId, steps: vars.steps },
      "Não deu para aplicar a edição.",
    ),
  );
}

const UPLOAD_MAX_BYTES = 200 * 1024 * 1024;

/** Sobe um vídeo, imagem ou áudio para usar na edição. */
export function useUploadEditFile() {
  return useMutation({
    mutationFn: async (file: File): Promise<EditAttachment> => {
      if (file.size > UPLOAD_MAX_BYTES) throw new Error("Envie arquivos de até 200 MB.");
      const prepared = await invokeEdit<{ path: string; token: string; kind: AttachmentKind }>(
        { action: "upload_url", content_type: file.type },
        "Não deu para preparar o envio.",
      );
      const { error } = await supabase.storage
        .from("renders")
        .uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type });
      if (error) {
        throw new Error(
          /size|exceed|large/i.test(error.message)
            ? "Esse arquivo é grande demais. Envie uma versão menor."
            : "Não deu para enviar o arquivo. Tente de novo.",
        );
      }
      return { path: prepared.path, kind: prepared.kind, name: file.name };
    },
  });
}

/** Aplica as sugestões marcadas, ou ops de ajuste fino (vira uma edição nova). */
export function useApplyEdits(jobId: string) {
  return useEditMutation(
    jobId,
    (vars: { editId: string; suggestionIds?: string[]; ops?: EditOp[]; attachments?: string[] }) =>
      invokeEdit<{ edit_id: string }>(
        {
          action: "apply",
          edit_id: vars.editId,
          ...(vars.ops ? { ops: vars.ops } : { suggestion_ids: vars.suggestionIds ?? [] }),
          ...(vars.attachments?.length ? { attachments: vars.attachments } : {}),
        },
        "Não deu para aplicar a edição.",
      ),
  );
}

/** Volta para o original (a versão editada fica guardada na linha). */
export function useRevertEdit(jobId: string) {
  return useEditMutation(jobId, (editId: string) =>
    invokeEdit<{ ok: true }>({ action: "revert", edit_id: editId }, "Não deu para voltar."),
  );
}

export interface VideoEditVersion {
  id: string;
  output_path: string;
  created_at: string;
}

/** As versões editadas prontas deste vídeo, da mais nova para a mais antiga. */
export function useVideoEditVersions(jobId: string) {
  return useQuery({
    queryKey: ["video-edit-versions", jobId],
    queryFn: async (): Promise<VideoEditVersion[]> => {
      const client = supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => {
            eq: (
              column: string,
              value: string,
            ) => {
              eq: (
                column: string,
                value: string,
              ) => {
                order: (
                  column: string,
                  options: { ascending: boolean },
                ) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
              };
            };
          };
        };
      };
      const { data, error } = await client
        .from("video_edits")
        .select("id, output_path, created_at")
        .eq("source_id", jobId)
        .eq("status", "ready")
        .order("created_at", { ascending: false });
      if (error) throw new Error(String((error as { message?: string }).message ?? error));
      return ((data ?? []) as VideoEditVersion[]).filter((v) => v.output_path);
    },
  });
}
