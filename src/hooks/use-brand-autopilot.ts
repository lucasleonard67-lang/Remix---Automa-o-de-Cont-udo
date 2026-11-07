import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ChannelType } from "@/hooks/use-channels";
import { ONBOARDING_SETTING_KEY } from "@/hooks/use-onboarding";
import { supabase } from "@/integrations/supabase/client";
import { getFunctionErrorMessage } from "@/lib/edge-functions";
import { toast } from "@/lib/toast";

// ---------------------------------------------------------------------------
// brand-autopilot — onboarding em 2 campos (site + @). O estado da execução
// vive em app_settings.brand_autopilot e a função processa UMA etapa por
// chamada; este hook lê o estado, dispara start/advance/reset e, enquanto a
// leitura roda, chama `advance` de novo no intervalo que a função pede.
// Contrato do estado: supabase/functions/_shared/brand-autopilot.ts.
// ---------------------------------------------------------------------------

export const BRAND_AUTOPILOT_SETTING_KEY = "brand_autopilot";

export type AutopilotStepId =
  "ler_site" | "ler_instagram" | "montar_perfil" | "ligar_canais" | "teste_de_tom";

export const AUTOPILOT_STEP_IDS: AutopilotStepId[] = [
  "ler_site",
  "ler_instagram",
  "montar_perfil",
  "ligar_canais",
  "teste_de_tom",
];

export const AUTOPILOT_STEP_LABELS: Record<AutopilotStepId, string> = {
  ler_site: "Ler o site",
  ler_instagram: "Ler o Instagram",
  montar_perfil: "Montar a marca",
  ligar_canais: "Ligar os canais",
  teste_de_tom: "Teste de tom",
};

export type AutopilotStepStatus =
  "pending" | "running" | "done" | "skipped" | "failed" | "needs_review";

export interface AutopilotStep {
  id: AutopilotStepId;
  status: AutopilotStepStatus;
  summary: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export type ReviewSectionId =
  "quem_somos" | "publico" | "voz" | "posicionamento" | "regras" | "visual" | "canais";

export interface ReviewSection {
  id: ReviewSectionId;
  items: string[];
  /** 0–1; abaixo de LOW_CONFIDENCE a tela marca "confira". */
  confidence: number;
  source: string;
}

export interface AutopilotReview {
  name: string;
  niche: string;
  description: string;
  sections: ReviewSection[];
  palette: string[];
  logo_url: string | null;
  channels: ChannelType[];
}

export interface AutopilotState {
  status: "idle" | "running" | "done" | "failed";
  step: AutopilotStepId | null;
  steps: AutopilotStep[];
  input: { site: string; instagram: string | null; captions: string[] };
  started_at: string | null;
  finished_at: string | null;
  lock_until: string | null;
  data: {
    pages?: Array<{ url: string; title: string; chars: number }>;
    caption_count?: number;
    channels?: ChannelType[];
    tone?: { attempt: number; job_ids: string[]; score: number | null; cutoff: number | null };
  };
  review: AutopilotReview | null;
}

export const LOW_CONFIDENCE = 0.6;

export const MAX_CAPTIONS = 5;

/** Legendas coladas: blocos separados por linha em branco, no máximo 5. */
export function splitCaptions(raw: string): string[] {
  return raw
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .slice(0, MAX_CAPTIONS);
}

const QUERY_KEY = ["app-settings", BRAND_AUTOPILOT_SETTING_KEY] as const;

interface FunctionReply {
  state: AutopilotState | null;
  wait_ms?: number;
}

function isState(value: unknown): value is AutopilotState {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Array.isArray((value as { steps?: unknown }).steps)
  );
}

async function callAutopilot(
  body: Record<string, unknown>,
  fallback: string,
): Promise<FunctionReply> {
  const { data, error } = await supabase.functions.invoke("brand-autopilot", { body });
  if (error) {
    const status = (error as { context?: { status?: number } } | null)?.context?.status;
    throw new Error(
      status === 404
        ? "A leitura automática não está disponível nesta conta. Use “Configurar manualmente”."
        : await getFunctionErrorMessage(error, fallback),
    );
  }
  const reply = (data ?? {}) as FunctionReply;
  return { state: isState(reply.state) ? reply.state : null, wait_ms: reply.wait_ms };
}

/** Estado atual (leitura direta de app_settings; a RLS libera para autenticados). */
export function useBrandAutopilotState() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<AutopilotState | null> => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", BRAND_AUTOPILOT_SETTING_KEY)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return isState(data?.value) ? data.value : null;
    },
  });
}

export interface StartAutopilotInput {
  site: string;
  instagram: string;
  captions: string[];
}

export function useBrandAutopilot() {
  const queryClient = useQueryClient();
  const stateQuery = useBrandAutopilotState();

  const apply = (reply: FunctionReply) => {
    if (reply.state) queryClient.setQueryData(QUERY_KEY, reply.state);
    return reply;
  };

  const start = useMutation({
    mutationFn: async (input: StartAutopilotInput) =>
      apply(
        await callAutopilot(
          { action: "start", ...input },
          "Não foi possível começar a leitura. Confira o endereço e tente de novo.",
        ),
      ),
  });

  const advance = useMutation({
    mutationFn: async () =>
      apply(
        await callAutopilot({ action: "advance" }, "A leitura parou. Clique em “Tentar de novo”."),
      ),
    onSuccess: (reply) => {
      if (reply.state?.status === "done") {
        // Marca, canais, Contexto e onboarding mudaram no servidor.
        void queryClient.invalidateQueries({ queryKey: ["doc"] });
        void queryClient.invalidateQueries({ queryKey: ["channels"] });
        void queryClient.invalidateQueries({ queryKey: ["context-items"] });
        void queryClient.invalidateQueries({ queryKey: ["app-settings", ONBOARDING_SETTING_KEY] });
        // a leitura roda enquanto a pessoa segue nos outros passos: o fim tem de aparecer
        toast.success("Marca lida", {
          description: "Persona, bandeira e regras da marca já estão ativas.",
        });
      } else if (reply.state?.status === "failed") {
        toast.error("A leitura da marca parou", {
          description: "Abra Configurar minha marca, corrija o endereço e leia de novo.",
        });
      }
    },
  });

  const reset = useMutation({
    mutationFn: async () => {
      await callAutopilot(
        { action: "reset" },
        "Não foi possível resetar o onboarding. Tente de novo.",
      );
    },
    onSuccess: () => {
      queryClient.setQueryData(QUERY_KEY, null);
      void queryClient.invalidateQueries({ queryKey: ["app-settings"] });
    },
  });

  return { stateQuery, state: stateQuery.data ?? null, start, advance, reset };
}

/**
 * Mantém a execução andando: enquanto o estado está `running`, chama `advance`
 * de novo depois de `wait_ms` (curto entre etapas, mais longo quando a etapa
 * espera algo em segundo plano, como as peças do teste de tom).
 */
export function useBrandAutopilotRunner(autopilot: ReturnType<typeof useBrandAutopilot>) {
  const { state, advance } = autopilot;
  const timer = useRef<number | null>(null);
  const lastWait = useRef<number>(400);
  const failures = useRef(0);
  const [stalled, setStalled] = useState(false);
  const running = state?.status === "running";
  const { mutate } = advance;

  const tick = useCallback(() => {
    mutate(undefined, {
      onSuccess: () => {
        failures.current = 0;
        setStalled(false);
      },
      onError: () => {
        failures.current += 1;
        // Três falhas seguidas de rede: para de insistir e mostra "Tentar de novo".
        if (failures.current >= MAX_CONSECUTIVE_FAILURES) setStalled(true);
      },
    });
  }, [mutate]);

  useEffect(() => {
    if (!running || advance.isPending || stalled) return;
    const wait = advance.data?.wait_ms ?? lastWait.current;
    lastWait.current = wait;
    timer.current = window.setTimeout(tick, Math.max(300, wait));
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [running, stalled, advance.isPending, advance.data, tick]);

  const retry = useCallback(() => {
    failures.current = 0;
    setStalled(false);
    tick();
  }, [tick]);

  return { stalled, error: advance.error?.message ?? null, retry };
}

const MAX_CONSECUTIVE_FAILURES = 3;
