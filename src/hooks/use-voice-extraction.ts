import { useMutation } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { getFunctionErrorMessage } from "@/lib/edge-functions";
import type { PersonaContent } from "@/hooks/use-versioned-brand";

// ---------------------------------------------------------------------------
// extract-voice (docs/07-contratos-backend.md §3.3) — passo 4 do onboarding.
// Dois modos, ambos SEM escrita: a função devolve o rascunho e o frontend
// grava `brand_persona` pelo CRUD normal.
//   corpus:     POST { context_item_ids }               → { draft }
//   entrevista: POST { mode: 'interview', answers? }     → { next_question } | { draft }
// ---------------------------------------------------------------------------

/** Máximo de itens aceitos pela função por chamada (07 §3.3). */
export const MAX_CORPUS_ITEMS = 20;
/** Teto de perguntas da entrevista guiada antes de a função exigir o rascunho. */
export const MAX_INTERVIEW_TURNS = 15;

export interface InterviewTurn {
  question: string;
  answer: string;
}

const NOT_DEPLOYED_MESSAGE =
  "A leitura automática de voz não está disponível nesta conta. " +
  "Preencha as seções à mão ou peça ao suporte para ativá-la.";

async function voiceErrorMessage(error: unknown, fallback: string): Promise<string> {
  const status = (error as { context?: { status?: number } } | null)?.context?.status;
  if (status === 404) return NOT_DEPLOYED_MESSAGE;
  return getFunctionErrorMessage(error, fallback);
}

/** Modo corpus: itens `ready` selecionados → rascunho das 9 seções. */
export function useExtractVoiceFromCorpus() {
  return useMutation({
    mutationFn: async (contextItemIds: string[]): Promise<PersonaContent> => {
      const { data, error } = await supabase.functions.invoke("extract-voice", {
        body: { context_item_ids: contextItemIds },
      });
      if (error) {
        throw new Error(
          await voiceErrorMessage(
            error,
            "Não foi possível ler a voz dos textos. Tente de novo ou preencha à mão.",
          ),
        );
      }
      const draft = (data as { draft?: unknown } | null)?.draft;
      if (!draft) throw new Error("A leitura voltou incompleta. Clique de novo para refazer.");
      return draft as PersonaContent;
    },
  });
}

export type InterviewResult =
  { kind: "question"; question: string } | { kind: "draft"; draft: PersonaContent };

/**
 * Modo entrevista (sem corpus). A função é stateless: o histórico completo
 * `answers` é reenviado a cada chamada; o LLM decide entre próxima pergunta e
 * rascunho final.
 */
export function useVoiceInterview() {
  return useMutation({
    mutationFn: async (answers: InterviewTurn[]): Promise<InterviewResult> => {
      const { data, error } = await supabase.functions.invoke("extract-voice", {
        body: { mode: "interview", answers },
      });
      if (error) {
        throw new Error(
          await voiceErrorMessage(
            error,
            "Não foi possível continuar a entrevista. Envie a resposta de novo.",
          ),
        );
      }
      const payload = (data ?? {}) as { next_question?: unknown; draft?: unknown };
      if (payload.draft) return { kind: "draft", draft: payload.draft as PersonaContent };
      if (typeof payload.next_question === "string" && payload.next_question.trim()) {
        return { kind: "question", question: payload.next_question.trim() };
      }
      throw new Error("A entrevista não respondeu. Envie a resposta de novo.");
    },
  });
}
