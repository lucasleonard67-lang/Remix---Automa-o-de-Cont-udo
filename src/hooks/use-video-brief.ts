import { useMutation } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { getFunctionErrorMessage } from "@/lib/edge-functions";

/** Briefing de vídeo pré-gerado pela edge `video-brief` a partir do tema. */
export interface VideoBrief {
  objetivo: string;
  publico: string;
  smp: string;
  numero_heroi: string;
  cta: string;
  tom: string;
}

/** Acima disso a IA travou: melhor um erro com "Tentar de novo" do que um spinner eterno. */
const BRIEF_TIMEOUT_MS = 45_000;

export function useVideoBrief() {
  return useMutation({
    mutationFn: async (theme: string): Promise<VideoBrief> => {
      const call = supabase.functions.invoke("video-brief", { body: { theme } });
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                "O briefing demorou mais de 45 segundos para ficar pronto. Tente de novo; se repetir, confira o provedor de IA em Ajustes → IA.",
              ),
            ),
          BRIEF_TIMEOUT_MS,
        ),
      );
      const { data, error } = await Promise.race([call, timeout]);
      if (error) {
        throw new Error(
          await getFunctionErrorMessage(error, "Não foi possível montar o briefing do vídeo."),
        );
      }
      return (data as { brief: VideoBrief }).brief;
    },
  });
}
