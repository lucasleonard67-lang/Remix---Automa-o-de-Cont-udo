import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Central de custos: saldo, plano e gasto do mês de cada conta, lidos pela
// edge provider-credits (só admin). Leitura pura; relê a cada 5 min.
// ---------------------------------------------------------------------------

export type CreditProviderId = "elevenlabs" | "heygen" | "higgsfield" | "replicate";

export interface ProviderCredit {
  id: CreditProviderId;
  connected: boolean;
  plan: string | null;
  remaining: number | null;
  limit: number | null;
  unit: "chars" | "usd" | "credits" | null;
  resets_at: string | null;
  notes: string[];
  error: string | null;
}

export interface MonthSpend {
  since: string;
  replicate_usd: number;
  heygen_usd: number;
  /** Edições do "Aprimorar com IA" (ausente até a edge nova subir). */
  claude_edit_usd?: number;
  higgsfield_credits: number;
  elevenlabs_chars: number;
  video_cap_usd: number;
}

export interface ProviderCredits {
  providers: ProviderCredit[];
  spend: MonthSpend;
  checked_at: string;
}

export function useProviderCredits(enabled: boolean) {
  return useQuery({
    queryKey: ["provider-credits"],
    enabled,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<ProviderCredits> => {
      const { data, error } = await supabase.functions.invoke("provider-credits", { body: {} });
      if (error) throw new Error(error.message);
      return data as ProviderCredits;
    },
  });
}
