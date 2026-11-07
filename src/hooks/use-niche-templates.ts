import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { GuardrailsContent, StrategyContent } from "@/hooks/use-versioned-brand";

// ---------------------------------------------------------------------------
// niche_templates — presets de fábrica (docs/04-modelo-de-dados.md §6.4/§8.10).
// Dado do motor: leitura autenticada, escrita só por migration.
// ---------------------------------------------------------------------------

/** §8.10 — payload do preset de nicho. */
export interface NicheTemplatePayload {
  guardrails_preset: Partial<GuardrailsContent>;
  archetypes: Array<{ name: string; description: string }>;
  hook_families: Array<{ name: string; pattern: string; example: string }>;
  editorial_stance: string;
  strategy_hints: Partial<StrategyContent>;
}

export interface NicheTemplate {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  payload: Partial<NicheTemplatePayload>;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Resumo textual do que o preset pré-popula (cards do passo 1). */
export function nicheTemplateHighlights(template: NicheTemplate): string[] {
  const payload = template.payload ?? {};
  const highlights: string[] = [];
  const guardrails = record(payload.guardrails_preset);
  const bannedCount =
    (Array.isArray(guardrails.banned_words) ? guardrails.banned_words.length : 0) +
    (Array.isArray(guardrails.banned_metaphors) ? guardrails.banned_metaphors.length : 0) +
    (Array.isArray(guardrails.banned_ctas) ? guardrails.banned_ctas.length : 0);
  if (bannedCount > 0) highlights.push(`${bannedCount} proibições de partida`);
  if (Array.isArray(payload.archetypes) && payload.archetypes.length > 0) {
    highlights.push(`${payload.archetypes.length} arquétipos`);
  }
  if (Array.isArray(payload.hook_families) && payload.hook_families.length > 0) {
    highlights.push(`${payload.hook_families.length} famílias de hook`);
  }
  const hints = record(payload.strategy_hints);
  if (Array.isArray(hints.theses) && hints.theses.length > 0) {
    highlights.push(`${hints.theses.length} teses sugeridas`);
  }
  if (typeof payload.editorial_stance === "string" && payload.editorial_stance.trim()) {
    highlights.push("postura editorial");
  }
  return highlights;
}

/** Os 4 presets de fábrica (ordem estável por nome). */
export function useNicheTemplates() {
  return useQuery({
    queryKey: ["niche-templates"],
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<NicheTemplate[]> => {
      const { data, error } = await supabase
        .from("niche_templates")
        .select("id, slug, name, description, payload")
        .order("name", { ascending: true });
      if (error) throw new Error(error.message);
      // `payload` é jsonb (Json); os presets são lidos de forma tolerante.
      return (data ?? []) as unknown as NicheTemplate[];
    },
  });
}
