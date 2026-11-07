import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  useActivateDraft,
  useSaveDraft,
  type VersionedBrandTable,
} from "@/hooks/use-versioned-brand";

// ---------------------------------------------------------------------------
// Progresso do onboarding — app_settings key 'onboarding'
// (docs/04-modelo-de-dados.md §8.9/§12.3; docs/05-rotas-e-modulos.md §3 nota 1):
// { current_step, completed_steps, minimum_viable, completed, brand_name,
//   niche_template_slug }
// ---------------------------------------------------------------------------

export const ONBOARDING_SETTING_KEY = "onboarding";

export interface OnboardingProgress {
  current_step: number;
  completed_steps: number[];
  minimum_viable: boolean;
  completed: boolean;
  brand_name: string | null;
  niche_template_slug: string | null;
  /**
   * Passo do fluxo único de configuração (modal `SetupFlow`, 1–7) em que o
   * usuário parou. Independe de `current_step` (que é do wizard de 9 passos):
   * mexer nele não faz a rota /onboarding trocar para o wizard.
   */
  setup_step: number | null;
}

/**
 * Passos do fluxo único de configuração (`SetupFlow`): marca → redes → vídeo
 * e voz → mercado → marca pronta → criar → publicar.
 */
export type SetupFlowStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Último passo do fluxo único de configuração (`SetupFlow`). */
export const SETUP_FLOW_LAST_STEP: SetupFlowStep = 7;

export function clampSetupStep(value: number): SetupFlowStep {
  const step = Math.min(Math.max(Math.trunc(value), 1), SETUP_FLOW_LAST_STEP);
  return step as SetupFlowStep;
}

export interface OnboardingStepMeta {
  step: number;
  slug: string;
  title: string;
  short: string;
}

/** Os 9 passos do wizard, na ordem canônica do brief §7 / docs/05 §4.4. */
export const ONBOARDING_STEPS: OnboardingStepMeta[] = [
  { step: 1, slug: "boas-vindas", title: "Boas-vindas", short: "Marca e nicho" },
  { step: 2, slug: "ia-e-integracoes", title: "IA e integrações", short: "Modelos e chaves" },
  { step: 3, slug: "contexto", title: "Contexto", short: "Textos da marca" },
  { step: 4, slug: "voz", title: "Voz", short: "Como a marca fala" },
  { step: 5, slug: "bandeira", title: "Bandeira", short: "Posicionamento" },
  { step: 6, slug: "guardrails", title: "Regras da marca", short: "O que nunca fazer" },
  { step: 7, slug: "brand-kit", title: "Identidade visual", short: "Cores, fontes, logo" },
  { step: 8, slug: "canais", title: "Canais", short: "Onde publicar" },
  { step: 9, slug: "gate-de-tom", title: "Teste de tom", short: "3 peças de teste" },
];

export const FIRST_STEP = 1;
export const LAST_STEP = ONBOARDING_STEPS.length;

/** Passo do wizard onde o acervo é cadastrado — destino quando ele está vazio. */
export const CONTEXT_STEP = 3;

/** Passo do wizard onde a voz é (re)construída — destino da reprovação no gate. */
export const VOICE_STEP = 4;

export const DEFAULT_ONBOARDING: OnboardingProgress = {
  current_step: FIRST_STEP,
  completed_steps: [],
  minimum_viable: false,
  completed: false,
  brand_name: null,
  niche_template_slug: null,
  setup_step: null,
};

function setupStepOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const step = Math.trunc(value);
  return step >= 1 && step <= SETUP_FLOW_LAST_STEP ? step : null;
}

function clampStep(value: unknown): number {
  const parsed =
    typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : FIRST_STEP;
  return Math.min(Math.max(parsed, FIRST_STEP), LAST_STEP);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** jsonb do banco pode vir parcial/legado — a UI sempre trabalha com o shape completo. */
export function normalizeOnboarding(raw: unknown): OnboardingProgress {
  const value =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const steps = Array.isArray(value.completed_steps)
    ? value.completed_steps
        .filter((item): item is number => typeof item === "number" && Number.isFinite(item))
        .map((item) => Math.trunc(item))
        .filter((item) => item >= FIRST_STEP && item <= LAST_STEP)
    : [];
  return {
    current_step: clampStep(value.current_step),
    completed_steps: [...new Set(steps)].sort((a, b) => a - b),
    minimum_viable: value.minimum_viable === true,
    completed: value.completed === true,
    brand_name: nullableString(value.brand_name),
    niche_template_slug: nullableString(value.niche_template_slug),
    setup_step: setupStepOrNull(value.setup_step),
  };
}

/**
 * Resultado da leitura do progresso. `unknown: true` = a leitura FALHOU (rede,
 * RLS, timeout): os demais campos são só o DEFAULT e não descrevem a instância.
 * Ausência da flag = leitura bem-sucedida — inclusive quando a key ainda não
 * existe (instância nova), caso legítimo em que o default É a verdade.
 */
export interface OnboardingRead extends OnboardingProgress {
  unknown?: boolean;
}

const UNKNOWN_ONBOARDING: OnboardingRead = { ...DEFAULT_ONBOARDING, unknown: true };

/**
 * Leitura direta (sem cache) para os `beforeLoad` dos guards. Fail-open de
 * verdade: erro de leitura devolve `unknown: true` e quem decide redirecionar
 * DEVE ignorar o resultado — uma falha transitória nunca pode jogar um admin
 * com instância já configurada de volta ao wizard. Key ausente ≠ erro: aí o
 * default (nada concluído) é a resposta correta e o redirecionamento vale.
 */
export async function fetchOnboardingProgress(): Promise<OnboardingRead> {
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", ONBOARDING_SETTING_KEY)
      .maybeSingle();
    if (error) return UNKNOWN_ONBOARDING;
    return normalizeOnboarding(data?.value ?? null);
  } catch {
    return UNKNOWN_ONBOARDING;
  }
}

/** Progresso reativo (mesma queryKey de `useAppSetting('onboarding')` — cache único). */
export function useOnboardingProgress() {
  const query = useQuery({
    queryKey: ["app-settings", ONBOARDING_SETTING_KEY],
    queryFn: async (): Promise<unknown> => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", ONBOARDING_SETTING_KEY)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data?.value ?? null;
    },
  });
  const progress = useMemo(() => normalizeOnboarding(query.data ?? null), [query.data]);
  return { ...query, progress };
}

export interface OnboardingPatch extends Partial<OnboardingProgress> {
  /** Marca o passo como concluído (união com os já concluídos — voltar não apaga). */
  completeStep?: number;
}

/**
 * Grava o progresso com read-modify-write: `app_settings.value` é substituído
 * inteiro, então o valor atual é relido antes do merge. `completed_steps` é
 * sempre união (retomar/voltar nunca perde passos já concluídos).
 */
export function useUpdateOnboarding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: OnboardingPatch): Promise<OnboardingProgress> => {
      const read = await fetchOnboardingProgress();
      if (read.unknown) {
        // Sem saber o valor atual, o read-modify-write gravaria o DEFAULT por
        // cima do progresso real (perda de passos concluídos). Melhor falhar.
        throw new Error(
          "Não foi possível ler seu progresso. Verifique a conexão e clique de novo.",
        );
      }
      const { unknown: _unknown, ...current } = read;
      const { completeStep, ...rest } = patch;
      const merged: OnboardingProgress = { ...current, ...rest };
      const steps = new Set([...current.completed_steps, ...(rest.completed_steps ?? [])]);
      if (completeStep != null) steps.add(completeStep);
      merged.completed_steps = [...steps].sort((a, b) => a - b);
      merged.current_step = clampStep(merged.current_step);

      const { data, error } = await supabase
        .from("app_settings")
        // `value` é jsonb (Json); o shape aqui é o de OnboardingProgress (§8.9).
        .upsert(
          { key: ONBOARDING_SETTING_KEY, value: merged as unknown as Json },
          { onConflict: "key" },
        )
        .select("key");
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        throw new Error(
          "Só administradores salvam o onboarding. Peça a um administrador da conta.",
        );
      }
      return merged;
    },
    onSuccess: (merged) => {
      // Cache atualizado na hora + invalidação (o guard do _app relê do banco).
      queryClient.setQueryData(["app-settings", ONBOARDING_SETTING_KEY], merged);
      void queryClient.invalidateQueries({ queryKey: ["app-settings", ONBOARDING_SETTING_KEY] });
    },
  });
}

// ---------------------------------------------------------------------------
// Mínimo viável — predicado sobre o ESTADO DO BANCO, não sobre os passos:
// persona + bandeira + guardrails com versão `active` e ≥ 1 item de contexto.
// É o que o guard do `_app` cobra para destravar a geração.
// ---------------------------------------------------------------------------

/** `null` = não deu para checar (erro de leitura) — nunca confundir com `false`. */
async function hasActiveVersion(table: VersionedBrandTable): Promise<boolean | null> {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("status", "active");
  if (error) return null;
  return (count ?? 0) > 0;
}

/**
 * `true`/`false` = predicado avaliado; `null` = indeterminado (falha de
 * leitura). Quem grava o progresso deve OMITIR `minimum_viable` no `null`,
 * para um erro transitório nunca rebaixar um mínimo viável já conquistado.
 */
export async function fetchMinimumViable(): Promise<boolean | null> {
  try {
    const [persona, strategy, guardrails] = await Promise.all([
      hasActiveVersion("brand_persona"),
      hasActiveVersion("brand_strategy"),
      hasActiveVersion("guardrails"),
    ]);
    if (persona === null || strategy === null || guardrails === null) return null;
    if (!persona || !strategy || !guardrails) return false;
    const { count, error } = await supabase
      .from("context_items")
      .select("id", { count: "exact", head: true });
    if (error) return null;
    return (count ?? 0) > 0;
  } catch {
    return null;
  }
}

/** Contagem de itens de contexto (passo 3 e cálculo do mínimo viável). */
export function useContextItemCount() {
  return useQuery({
    queryKey: ["context-items-count"],
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from("context_items")
        .select("id", { count: "exact", head: true });
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });
}

// ---------------------------------------------------------------------------
// Salvar rascunho + ativar em uma tacada (passos 4-7 do wizard: o cliente não
// pensa em "rascunho vs ativa" — confirmar o passo já ativa a versão).
// ---------------------------------------------------------------------------

export function useSaveAndActivate<T>(table: VersionedBrandTable) {
  const saveDraft = useSaveDraft<T>(table);
  const activateDraft = useActivateDraft(table);
  return {
    isPending: saveDraft.isPending || activateDraft.isPending,
    run: async (content: T): Promise<void> => {
      const saved = await saveDraft.mutateAsync(content);
      await activateDraft.mutateAsync(saved.id);
    },
  };
}
