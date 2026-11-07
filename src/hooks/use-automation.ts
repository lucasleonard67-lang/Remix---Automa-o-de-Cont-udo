import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

import type { FormatFamily } from "@/hooks/use-channels";
// `automation_*` ainda fora dos types gerados (o Lovable os regenera depois da
// migration) — client não-tipado só neste módulo, mesmo padrão do use-rss.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ---------------------------------------------------------------------------
// Motor automático (ponto 7 do plano docs/14).
//
// O gatilho GERA E ENFILEIRA — nada vai ao ar sozinho. A peça cai na Biblioteca
// em "Em revisão" como qualquer outra, e o portão humano continua sendo o
// último passo.
// ---------------------------------------------------------------------------

export type TriggerSource = "radar" | "acervo" | "tema";

export const TRIGGER_SOURCE_LABELS: Record<TriggerSource, string> = {
  radar: "Notícia do Radar",
  acervo: "Case do Contexto",
  tema: "Tema fixo",
};

export interface AutomationTrigger {
  id: string;
  name: string;
  enabled: boolean;
  account_id: string | null;
  family: FormatFamily;
  per_day: number;
  source: TriggerSource;
  theme: string | null;
  budget_credits: number | null;
  last_run_at: string | null;
  created_at: string;
}

export interface AutomationRun {
  id: string;
  trigger_id: string;
  job_id: string | null;
  status: "started" | "ok" | "skipped" | "error";
  detail: string | null;
  created_at: string;
}

export function useAutomationTriggers() {
  return useQuery({
    queryKey: ["automation-triggers"],
    queryFn: async (): Promise<AutomationTrigger[]> => {
      const { data, error } = await supabase
        .from("automation_triggers")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AutomationTrigger[];
    },
  });
}

/** Últimos disparos — é daqui que sai a cota do dia, não de um contador. */
export function useAutomationRuns(limit = 20) {
  return useQuery({
    queryKey: ["automation-runs", limit],
    queryFn: async (): Promise<AutomationRun[]> => {
      const { data, error } = await supabase
        .from("automation_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AutomationRun[];
    },
  });
}

/** Campos obrigatórios na CRIAÇÃO — o banco exige família; o tipo agora também. */
export interface NovoTrigger {
  name: string;
  family: FormatFamily;
  per_day: number;
  source: TriggerSource;
  theme?: string | null;
  account_id?: string | null;
  budget_credits?: number | null;
  enabled?: boolean;
}

export function useCreateTrigger() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: NovoTrigger): Promise<void> => {
      const { data: sessionData } = await supabase.auth.getSession();
      const { error } = await supabase.from("automation_triggers").insert({
        ...input,
        created_by: sessionData.session?.user.id ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["automation-triggers"] });
    },
  });
}

/** Edição pontual (ligar/desligar, renomear) — tudo opcional menos o id. */
export function useUpdateTrigger() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: { id: string } & Partial<Omit<AutomationTrigger, "id">>,
    ): Promise<void> => {
      const { id, ...patch } = input;
      const { error } = await supabase.from("automation_triggers").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["automation-triggers"] });
    },
  });
}

export function useDeleteTrigger() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from("automation_triggers").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["automation-triggers"] });
    },
  });
}

/** "Rodar agora" — a mesma edge do cron, autenticada por JWT de admin. */
export function useRunAutomationNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ triggers: number }> => {
      const { data, error } = await supabase.functions.invoke("automation-tick", { body: {} });
      if (error) throw new Error(error.message);
      return data as { triggers: number };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["automation-runs"] });
      void queryClient.invalidateQueries({ queryKey: ["automation-triggers"] });
    },
  });
}
