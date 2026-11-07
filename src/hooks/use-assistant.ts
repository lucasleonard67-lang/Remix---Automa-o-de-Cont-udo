import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { getFunctionErrorMessage } from "@/lib/edge-functions";
import { requestAssistant } from "@/lib/assistant-request";
import { useSession } from "@/hooks/use-session";

// ---------------------------------------------------------------------------
// Assistente do app — conversa com a edge `assistant-chat`.
// Sem tabela: o histórico vive em sessionStorage e vai inteiro a cada chamada
// (as últimas 12 mensagens). A edge devolve texto + ações; quem executa as
// ações é a tela, depois do clique do usuário.
// ---------------------------------------------------------------------------

export type AssistantAction =
  | { type: "navigate"; to: string; label: string; search?: Record<string, string> }
  | { type: "create"; kind: "post" | "image" | "video"; brief: string; label: string }
  | { type: "open_integration"; id: string; label: string };

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: AssistantAction[];
}

export interface AssistantState {
  pecas_em_revisao: number;
  pecas_aprovadas_sem_data: number;
  geracoes_com_falha: Array<{ id: string; criada_em: string; erro: string | null }>;
  usuario_e_admin: boolean;
}

const STORAGE_KEY = "ce.assistant.history";
const HISTORY_SENT = 12;
const HISTORY_KEPT = 40;

function readHistory(): AssistantMessage[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? (parsed as AssistantMessage[]) : [];
  } catch {
    return [];
  }
}

function writeHistory(messages: AssistantMessage[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-HISTORY_KEPT)));
  } catch {
    // sem storage (modo privado): a conversa vive só em memória
  }
}

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const STATE_KEY = ["assistant", "estado"];

const assistantTransport = {
  getAccessToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
  invoke: (options: { body: Record<string, unknown>; headers: { Authorization: string } }) =>
    supabase.functions.invoke("assistant-chat", options),
};

/**
 * Estado da conta para o ponto do launcher (peças em revisão). Uma leitura por
 * sessão, sem polling: a resposta do chat atualiza quando o modelo consulta
 * `estado_conta`.
 */
export function useAssistantState(enabled = true) {
  const { session, isLoading } = useSession();
  return useQuery({
    queryKey: [...STATE_KEY, session?.user.id ?? null],
    enabled: enabled && !isLoading && !!session,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<AssistantState | null> => {
      const result = await requestAssistant({ action: "estado" }, assistantTransport);
      if (result.status === "signed_out") return null;
      const { data, error } = result;
      if (error) return null;
      return ((data as { estado?: AssistantState } | null)?.estado ??
        null) as AssistantState | null;
    },
  });
}

interface ChatResponse {
  reply: string;
  actions?: AssistantAction[];
  estado?: AssistantState;
}

export function useAssistant(route: string) {
  const queryClient = useQueryClient();
  const { session } = useSession();
  const [messages, setMessages] = useState<AssistantMessage[]>(() =>
    typeof window === "undefined" ? [] : readHistory(),
  );

  useEffect(() => {
    writeHistory(messages);
  }, [messages]);

  const mutation = useMutation({
    mutationFn: async (history: AssistantMessage[]): Promise<ChatResponse> => {
      const result = await requestAssistant(
        {
          route,
          messages: history.slice(-HISTORY_SENT).map((m) => ({ role: m.role, content: m.content })),
        },
        assistantTransport,
      );
      if (result.status === "signed_out") {
        throw new Error("Entre novamente para usar o assistente.");
      }
      const { data, error } = result;
      if (error) {
        throw new Error(
          await getFunctionErrorMessage(
            error,
            "O assistente não respondeu. Tente de novo em instantes.",
          ),
        );
      }
      return data as ChatResponse;
    },
    onSuccess: (res) => {
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: "assistant", content: res.reply, actions: res.actions ?? [] },
      ]);
      if (res.estado && session) queryClient.setQueryData([...STATE_KEY, session.user.id], res.estado);
    },
  });

  const send = useCallback(
    (text: string) => {
      const content = text.trim();
      if (!content || mutation.isPending) return;
      const next = [...messages, { id: newId(), role: "user" as const, content }];
      setMessages(next);
      mutation.mutate(next);
    },
    [messages, mutation],
  );

  const reset = useCallback(() => {
    setMessages([]);
    mutation.reset();
  }, [mutation]);

  return {
    messages,
    send,
    reset,
    isPending: mutation.isPending,
    error: mutation.error?.message ?? null,
  };
}
