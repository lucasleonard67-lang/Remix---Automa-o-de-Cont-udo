import { useMutation, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { getFunctionErrorMessage } from "@/lib/edge-functions";

export interface EditSlideResult {
  gerar_foto: boolean;
  conferir: string[];
}

/** O pedido ficou com o Claude da assinatura; a peça muda quando ele entregar. */
export interface SlidePedidoResult {
  status: "pedido";
  acordou: boolean;
}

export type EditSlideOutcome = EditSlideResult | SlidePedidoResult;

export const pedidoFeito = (r: EditSlideOutcome): r is SlidePedidoResult =>
  (r as SlidePedidoResult).status === "pedido";

async function editSlide(body: Record<string, unknown>): Promise<EditSlideOutcome> {
  const { data, error } = await supabase.functions.invoke("edit-slide", { body });
  if (error) throw new Error(await getFunctionErrorMessage(error, "Não deu para editar o slide."));
  return data as EditSlideOutcome;
}

/**
 * Muda ou desfaz um slide. `confirmar` vai quando a peça já saiu da revisão;
 * `pedirAoClaude` manda o pedido para o Claude da assinatura em vez da IA inclusa;
 * `cancelar` retira um pedido ainda não atendido.
 */
export function useEditSlide(pieceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      index: number;
      instruction?: string;
      desfazer?: boolean;
      cancelar?: boolean;
      pedirAoClaude?: boolean;
      confirmar: boolean;
    }) =>
      editSlide({
        piece_id: pieceId,
        index: input.index,
        confirmar: input.confirmar,
        ...(input.cancelar
          ? { action: "cancelar_pedido" }
          : input.desfazer
            ? { action: "desfazer" }
            : {
                instruction: input.instruction,
                ...(input.pedirAoClaude ? { pedir_ao_claude: true } : {}),
              }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["piece", pieceId] });
      void queryClient.invalidateQueries({ queryKey: ["pieces"] });
    },
  });
}
