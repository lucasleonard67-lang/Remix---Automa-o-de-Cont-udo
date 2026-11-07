import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Diagnóstico da INSTÂNCIA (F5.4).
//
// "Instância" é uma implementação inteira do Content Engine para UM cliente:
// projeto próprio, banco próprio, deploy próprio. O isolamento é físico, não
// por `tenant_id` — não existe multi-tenant aqui. Esta aba responde "como está
// a minha cópia": que versão do motor gerou as peças, se o motor está travado,
// e o volume acumulado.
//
// Tudo sai de contagem no banco. Nada de número inventado: quando não há dado,
// a tela diz que não há.
// ---------------------------------------------------------------------------

/** Estados intermediários: job parado aqui por muito tempo é job travado. */
const ESTADOS_EM_VOO = [
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
] as const;

/** O watchdog roda de 5 em 5 min; acima disto o job já devia ter sido retomado. */
export const MINUTOS_PARA_TRAVADO = 15;

export interface InstanceHealth {
  motor: string | null;
  jobs: { total: number; falhos: number; emVoo: number; travados: number };
  pecas: Record<string, number>;
  contexto: { prontos: number; processando: number; falhos: number };
  ultimaFalha: { id: string; erro: string | null; quando: string } | null;
  ultimaGeracao: string | null;
}

export function useInstanceHealth() {
  return useQuery({
    queryKey: ["instancia", "saude"],
    // números de operação envelhecem rápido; meio minuto é o suficiente
    staleTime: 30_000,
    queryFn: async (): Promise<InstanceHealth> => {
      const limite = new Date(Date.now() - MINUTOS_PARA_TRAVADO * 60_000).toISOString();

      const [motor, jobs, travados, pecas, contexto, falha] = await Promise.all([
        supabase
          .from("content_pieces")
          .select("engine_version")
          .not("engine_version", "is", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from("generation_jobs").select("status, created_at"),
        supabase
          .from("generation_jobs")
          .select("id")
          .in("status", [...ESTADOS_EM_VOO])
          .lt("updated_at", limite),
        supabase.from("content_pieces").select("status"),
        supabase.from("context_items").select("status"),
        supabase
          .from("generation_jobs")
          .select("id, error, updated_at")
          .eq("status", "failed")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const linhasJob = (jobs.data ?? []) as Array<{ status: string; created_at: string }>;
      const conta = (linhas: Array<{ status: string }>) =>
        linhas.reduce<Record<string, number>>((acc, l) => {
          acc[l.status] = (acc[l.status] ?? 0) + 1;
          return acc;
        }, {});
      const porStatusJob = conta(linhasJob);
      const porStatusCtx = conta((contexto.data ?? []) as Array<{ status: string }>);

      const emVoo = ESTADOS_EM_VOO.reduce((n, e) => n + (porStatusJob[e] ?? 0), 0);
      const ultima = linhasJob
        .map((l) => l.created_at)
        .sort()
        .at(-1);

      return {
        motor: (motor.data as { engine_version?: string } | null)?.engine_version ?? null,
        jobs: {
          total: linhasJob.length,
          falhos: porStatusJob.failed ?? 0,
          emVoo,
          travados: (travados.data ?? []).length,
        },
        pecas: conta((pecas.data ?? []) as Array<{ status: string }>),
        contexto: {
          prontos: porStatusCtx.ready ?? 0,
          processando: porStatusCtx.processing ?? 0,
          falhos: porStatusCtx.failed ?? 0,
        },
        ultimaFalha: falha.data
          ? {
              id: (falha.data as { id: string }).id,
              erro: (falha.data as { error: string | null }).error,
              quando: (falha.data as { updated_at: string }).updated_at,
            }
          : null,
        ultimaGeracao: ultima ?? null,
      };
    },
  });
}

/** Referência do projeto Supabase que serve ESTA instância. */
export function refDoProjeto(): string | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url) return null;
  return new URL(url).hostname.split(".")[0] ?? null;
}
