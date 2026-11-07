import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useAppSetting, useSecretStatus } from "@/hooks/use-app-settings";
import { useCompetitors } from "@/hooks/use-market";
import { useOnboardingProgress, type SetupFlowStep } from "@/hooks/use-onboarding";
import { useZernioAccounts } from "@/hooks/use-zernio";

// ---------------------------------------------------------------------------
// Primeiros passos — estado consolidado da conta para a faixa do Dashboard.
// Lê onboarding, análise automática da marca (`brand_autopilot`, de forma
// defensiva), chave do Zernio + conta do Instagram, Apify + concorrentes e
// contagens de peças/publicações. Cada passo aponta para o passo do fluxo
// único (`SetupFlow`, modal) que o resolve.
// ---------------------------------------------------------------------------

export type SetupStepId =
  "analise" | "perfil" | "tom" | "instagram" | "mercado" | "primeira-peca" | "publicar";

export type SetupStepTo = "/onboarding" | "/marca" | "/config" | "/" | "/biblioteca";

export interface SetupStep {
  id: SetupStepId;
  label: string;
  done: boolean;
  to: SetupStepTo;
  /** Passo do `SetupFlow` que resolve este item; `null` = navegar para `to`. */
  flowStep: SetupFlowStep | null;
}

export interface DashboardSetup {
  isLoading: boolean;
  steps: SetupStep[];
  doneCount: number;
  next: SetupStep | null;
  allDone: boolean;
}

/** `app_settings.brand_autopilot` — shape de outra frente; lido sem confiar. */
interface AutopilotSetting {
  status?: unknown;
  step?: unknown;
  steps?: unknown;
  started_at?: unknown;
}

const DONE_WORDS = new Set(["done", "completed", "complete", "finished", "ok"]);

function autopilotDone(raw: AutopilotSetting | null | undefined): boolean {
  if (!raw || typeof raw !== "object") return false;
  if (typeof raw.status === "string" && DONE_WORDS.has(raw.status)) return true;
  if (Array.isArray(raw.steps) && raw.steps.length > 0) {
    return raw.steps.every((step) => {
      const status = (step as { status?: unknown } | null)?.status;
      return typeof status === "string" && (DONE_WORDS.has(status) || status === "skipped");
    });
  }
  return false;
}

/** A leitura nunca começou (ou foi zerada): o fluxo abre no passo 1. */
function autopilotIdle(raw: AutopilotSetting | null | undefined): boolean {
  if (!raw || typeof raw !== "object") return true;
  return raw.status === "idle" || raw.status === undefined;
}

/** Passos do wizard que formam o "perfil" da marca (voz, bandeira, regras, identidade). */
const PROFILE_STEPS = [4, 5, 6, 7];
const TONE_STEP = 9;

function useCount(
  table: "content_pieces" | "published_posts",
  publishedOnly: boolean,
  since: string | null = null,
) {
  return useQuery({
    queryKey: ["dashboard", "count", table, publishedOnly, since],
    staleTime: 30_000,
    queryFn: async (): Promise<number> => {
      let query = supabase.from(table).select("id", { count: "exact", head: true });
      if (publishedOnly) query = query.eq("status", "published");
      // peças de uma leitura anterior da marca não contam como "a primeira"
      if (since) query = query.gte("created_at", since);
      const { count, error } = await query;
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });
}

export function useDashboardSetup(): DashboardSetup {
  const onboarding = useOnboardingProgress();
  const autopilot = useAppSetting<AutopilotSetting>("brand_autopilot");
  const secrets = useSecretStatus();
  const zernioKey = secrets.data?.includes("ZERNIO_API_KEY") ?? false;
  const accounts = useZernioAccounts(zernioKey);
  const competitors = useCompetitors();
  const brandSince =
    typeof autopilot.data?.started_at === "string" ? autopilot.data.started_at : null;
  const pieces = useCount("content_pieces", false, brandSince);
  const published = useCount("published_posts", true, brandSince);

  const isLoading =
    onboarding.isLoading ||
    autopilot.isLoading ||
    secrets.isLoading ||
    pieces.isLoading ||
    published.isLoading;

  return useMemo(() => {
    const progress = onboarding.progress;
    const completed = new Set(progress.completed_steps);
    const profileDone =
      progress.completed || progress.minimum_viable || PROFILE_STEPS.every((s) => completed.has(s));
    const toneDone = progress.completed || completed.has(TONE_STEP);
    // Chave salva e conta do Instagram autorizada. Se a lista não puder ser
    // lida (proxy fora), a chave basta — a faixa não pode travar por isso.
    const instagramDone =
      zernioKey &&
      (accounts.isSuccess
        ? accounts.data.some((account) => account.platform === "instagram")
        : true);
    const marketDone =
      (secrets.data?.includes("APIFY_TOKEN") ?? false) && (competitors.data?.length ?? 0) > 0;
    const pieceDone = (pieces.data ?? 0) > 0;
    const publishDone = (published.data ?? 0) > 0;
    const brandStep: SetupFlowStep = autopilotIdle(autopilot.data) ? 1 : 5;

    const steps: SetupStep[] = [
      {
        id: "analise",
        label: "Analise sua marca",
        done: autopilotDone(autopilot.data) || progress.completed,
        to: progress.completed ? "/marca" : "/onboarding",
        flowStep: brandStep,
      },
      { id: "perfil", label: "Revise o perfil", done: profileDone, to: "/marca", flowStep: 5 },
      {
        id: "tom",
        label: "Teste de tom",
        done: toneDone,
        to: progress.completed ? "/marca" : "/onboarding",
        flowStep: 5,
      },
      {
        id: "instagram",
        label: "Conecte suas redes",
        done: instagramDone,
        to: "/config",
        flowStep: 2,
      },
      { id: "mercado", label: "Acompanhe o mercado", done: marketDone, to: "/config", flowStep: 4 },
      {
        id: "primeira-peca",
        label: "Gere a primeira peça",
        done: pieceDone,
        to: "/",
        flowStep: 6,
      },
      {
        id: "publicar",
        label: "Revise e publique",
        done: publishDone,
        to: "/biblioteca",
        flowStep: 7,
      },
    ];
    const doneCount = steps.filter((s) => s.done).length;
    const next = steps.find((s) => !s.done) ?? null;
    return { isLoading, steps, doneCount, next, allDone: next === null };
  }, [
    isLoading,
    onboarding.progress,
    autopilot.data,
    secrets.data,
    zernioKey,
    accounts.isSuccess,
    accounts.data,
    competitors.data,
    pieces.data,
    published.data,
  ]);
}
