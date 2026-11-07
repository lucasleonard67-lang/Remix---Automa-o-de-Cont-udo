import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";

// ---------------------------------------------------------------------------
// Conexão da conta Higgsfield (MCP oficial) — OAuth com PKCE conduzido pela
// edge `higgsfield-oauth`. O token nunca chega ao client: o front só sabe se
// está conectado e quando o access expira.
// ---------------------------------------------------------------------------

export interface HiggsfieldStatus {
  connected: boolean;
  access_expires_at?: string | null;
  access_expired?: boolean | null;
}

async function invokeHiggsfield<T>(
  action: "start" | "exchange" | "status" | "disconnect",
  extra?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("higgsfield-oauth", {
    body: { action, ...extra },
  });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const body = (await ctx.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (body?.error?.message) throw new Error(body.error.message);
    }
    throw new Error(error.message);
  }
  if (data?.error) throw new Error(data.error.message ?? String(data.error));
  return data as T;
}

export function useHiggsfieldStatus(enabled = true) {
  // Mesma corrida do status das keys: sem sessão anexada a edge devolve 401 e,
  // sem retry, o card nasce em erro. Ver o comentário em useSecretStatus.
  const { session } = useSession();
  return useQuery({
    queryKey: ["higgsfield", "status"],
    enabled: enabled && Boolean(session),
    retry: false,
    staleTime: 30 * 1000,
    queryFn: () => invokeHiggsfield<HiggsfieldStatus>("status"),
  });
}

/**
 * Devolve a URL de autorização — quem abre a aba é o componente (popup blocker).
 * A origem vai junto porque o Higgsfield devolve o usuário para <origem>/config;
 * a edge só aceita origens conhecidas e o caminho de retorno é fixo lá.
 */
export function useHiggsfieldConnect() {
  return useMutation({
    mutationFn: () =>
      invokeHiggsfield<{ authorize_url: string; colar?: boolean }>("start", {
        return_origin: window.location.origin,
      }),
  });
}

export function useHiggsfieldDisconnect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => invokeHiggsfield<HiggsfieldStatus>("disconnect"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["higgsfield"] }),
  });
}

/**
 * Volta do OAuth: o Higgsfield traz ?code&state (ou ?error) para /config e a
 * página repassa tudo para a edge, que troca pelos tokens. Devolve só o código
 * do desfecho — a mensagem é da tela.
 */
export function higgsfieldExchange(params: { code?: string; state?: string; error?: string }) {
  return invokeHiggsfield<{ outcome: string }>("exchange", params);
}
