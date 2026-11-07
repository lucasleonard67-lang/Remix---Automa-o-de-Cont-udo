import { useMutation, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { getFunctionErrorMessage } from "@/lib/edge-functions";
import type { GenerationJob } from "@/hooks/use-generation-jobs";

// ---------------------------------------------------------------------------
// tone-gate (docs/07-contratos-backend.md §3.6) — passo 9 do onboarding.
// POST {} → { job_ids: string[] } (3 jobs, sagas em background).
// ---------------------------------------------------------------------------

const NOT_DEPLOYED_MESSAGE =
  "O teste de tom não está disponível nesta conta. " +
  "Clique em “Salvar e sair” para ir ao app ou fale com o suporte.";

/**
 * Marcador de amostra: a função grava `sample: true` dentro de `timings`
 * (a flag não faz parte do shape canônico de `Classification`). Serve para
 * reencontrar os jobs do gate depois de um reload do wizard.
 */
export function isSampleJob(job: GenerationJob): boolean {
  return (job.timings as Record<string, unknown> | null)?.sample === true;
}

export function useToneGate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<string[]> => {
      const { data, error } = await supabase.functions.invoke("tone-gate", { body: {} });
      if (error) {
        const status = (error as { context?: { status?: number } } | null)?.context?.status;
        throw new Error(
          status === 404
            ? NOT_DEPLOYED_MESSAGE
            : await getFunctionErrorMessage(
                error,
                "Não foi possível gerar as peças de teste. Tente de novo.",
              ),
        );
      }
      const jobIds = (data as { job_ids?: unknown } | null)?.job_ids;
      if (!Array.isArray(jobIds) || jobIds.length === 0) {
        throw new Error("O teste de tom não iniciou as peças. Tente de novo.");
      }
      return jobIds.filter((id): id is string => typeof id === "string");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}
