import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

// `mcp_tokens` ainda fora dos types gerados (o Lovable os regenera depois da
// migration) — client não-tipado só neste módulo, mesmo padrão do use-rss.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ---------------------------------------------------------------------------
// Tokens do conector MCP (ponto 6 do plano docs/14).
//
// O token é GERADO NO NAVEGADOR e só o hash sha256 vai para o banco. O valor em
// claro aparece uma única vez, na tela de quem criou: nunca trafega para o
// servidor, e não há o que vazar do nosso lado.
// ---------------------------------------------------------------------------

export interface McpToken {
  id: string;
  name: string;
  hint: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

async function sha256(texto: string): Promise<string> {
  const bytes = new TextEncoder().encode(texto);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function gerarToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function useMcpTokens() {
  return useQuery({
    queryKey: ["mcp-tokens"],
    // "conectado agora" acompanha o uso real enquanto a tela está aberta
    refetchInterval: 30_000,
    queryFn: async (): Promise<McpToken[]> => {
      const { data, error } = await supabase
        .from("mcp_tokens")
        .select("id, name, hint, last_used_at, revoked_at, created_at")
        .is("revoked_at", null)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as McpToken[];
    },
  });
}

/** Devolve o token em CLARO uma única vez — a UI mostra e não guarda. */
export function useCreateMcpToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string): Promise<string> => {
      const token = gerarToken();
      const { data: sessionData } = await supabase.auth.getSession();
      const { error } = await supabase.from("mcp_tokens").insert({
        name: name.trim() || "Conector",
        token_hash: await sha256(token),
        hint: token.slice(-4),
        created_by: sessionData.session?.user.id ?? null,
      });
      if (error) throw new Error(error.message);
      return token;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mcp-tokens"] });
    },
  });
}

export function useRevokeMcpToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("mcp_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mcp-tokens"] });
    },
  });
}

export const MCP_URL = `${import.meta.env.VITE_SUPABASE_URL ?? ""}/functions/v1/mcp-server`;

async function postConnector(path: string, body: unknown): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const response = await fetch(`${MCP_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${data.session?.access_token ?? ""}`,
    },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as Record<string, string>;
  if (!response.ok) throw new Error(result.error_description ?? "Não deu para concluir.");
  return result;
}

/** O servidor confirma cliente e retorno antes de a tela oferecer qualquer botão. */
export function useConnectorRequest(request: {
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
}) {
  return useQuery({
    queryKey: ["mcp-oauth-check", request],
    retry: false,
    enabled: Boolean(request.client_id && request.redirect_uri && request.code_challenge),
    queryFn: async () => {
      await postConnector("/check", request);
      return true;
    },
  });
}

/** Autoriza o conector; devolve para onde voltar, já com o código. */
export async function approveConnector(request: {
  client_id?: string;
  redirect_uri?: string;
  state?: string;
  code_challenge?: string;
}): Promise<string> {
  return (await postConnector("/approve", request)).redirect_to;
}

/** Registra onde o app está: a autorização abre nesse endereço. */
export function rememberAppOrigin(): void {
  void postConnector("/app-origin", { origin: window.location.origin }).catch(() => {});
}

export function redirectHost(uri: string | undefined): string {
  try {
    return uri ? new URL(uri).hostname : "";
  } catch {
    return "";
  }
}
