import { useMutation, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { getFunctionErrorMessage } from "@/lib/edge-functions";

export async function excluir(
  kind: "piece" | "video" | "context",
  id: string,
): Promise<{ drive_pendente: number }> {
  const { data, error } = await supabase.functions.invoke("delete-content", { body: { kind, id } });
  if (error) throw new Error(await getFunctionErrorMessage(error, "Não deu para excluir."));
  return data as { drive_pendente: number };
}

export function useDeletePiece() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pieceId: string) => excluir("piece", pieceId),
    onSuccess: (_data, pieceId) => {
      queryClient.removeQueries({ queryKey: ["piece", pieceId] });
      for (const key of [
        "pieces",
        "piece-stage-counts",
        "pieces-pending-count",
        "pieces-scheduled",
      ]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

export function useDeleteVideo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => excluir("video", jobId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["director-jobs"] }),
  });
}

/** A exclusão valeu; só a cópia no Drive pode ter ficado. */
export function avisoDoDrive(pendentes: number): string | undefined {
  if (!pendentes) return undefined;
  return pendentes === 1
    ? "1 cópia ficou no Google Drive. Apague por lá."
    : `${pendentes} cópias ficaram no Google Drive. Apague por lá.`;
}
