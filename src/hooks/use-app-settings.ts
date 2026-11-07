import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { getFunctionErrorMessage } from "@/lib/edge-functions";
import { useSession } from "@/hooks/use-session";

// ---------------------------------------------------------------------------
// Tipos (espelham docs/04-modelo-de-dados.md §8.9 — app_settings.ai_providers)
// ---------------------------------------------------------------------------

// Claude não entra por API: o produto usa o Claude pelo conector, com a assinatura.
export const AI_DRIVERS = ["lovable-gateway", "openai", "xai"] as const;
export type AiDriver = (typeof AI_DRIVERS)[number];

export const AI_ROLES = [
  "router",
  "generator",
  "judge",
  "voice_extractor",
  "embeddings",
  "image",
] as const;
export type AiRole = (typeof AI_ROLES)[number];

export const AI_ROLE_LABELS: Record<AiRole, string> = {
  router: "Planejador",
  generator: "Gerador",
  judge: "Avaliador",
  voice_extractor: "Extrator de voz",
  embeddings: "Busca no Contexto",
  image: "Imagem",
};

export interface AiProviderConfig {
  driver: AiDriver;
  model: string;
}

export type AiProviders = Partial<Record<AiRole, AiProviderConfig>>;

// ---------------------------------------------------------------------------
// app_settings.web_search — config da pesquisa web (migration 15; 04 §8.9)
// ---------------------------------------------------------------------------

export const WEB_SEARCH_PROVIDERS = ["auto", "tavily", "firecrawl", "openai", "off"] as const;
export type WebSearchProviderSetting = (typeof WEB_SEARCH_PROVIDERS)[number];

export const WEB_SEARCH_PROVIDER_LABELS: Record<WebSearchProviderSetting, string> = {
  auto: "Automático (primeira chave cadastrada)",
  tavily: "Tavily — busca rápida",
  firecrawl: "Firecrawl — busca e lê a página inteira",
  openai: "OpenAI — usa sua chave da OpenAI",
  off: "Desligada",
};

export interface WebSearchSetting {
  enabled: boolean;
  provider: WebSearchProviderSetting;
  max_results: number;
}

// ---------------------------------------------------------------------------
// app_settings (get/update por key)
// ---------------------------------------------------------------------------

/** Lê `app_settings.value` de uma key (leitura autenticada pela RLS). */
export function useAppSetting<T>(key: string) {
  return useQuery({
    queryKey: ["app-settings", key],
    queryFn: async (): Promise<T | null> => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", key)
        .maybeSingle();
      if (error) throw new Error(error.message);
      // `value` é jsonb (Json): o shape é definido por quem chama, via `T`.
      return (data?.value ?? null) as unknown as T | null;
    },
  });
}

/**
 * Atualiza `app_settings.value` de uma key. A RLS só permite escrita de admin;
 * update silencioso (0 linhas) é convertido em erro para a UI exibir toast.
 */
export function useUpdateAppSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: unknown }): Promise<void> => {
      const { data, error } = await supabase
        .from("app_settings")
        .update({ value: value as Json })
        .eq("key", key)
        .select("key");
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        // 0 linhas tem DUAS causas: a RLS barrou, ou a key nunca foi semeada.
        // Dizer só "sem permissão" mandava o admin caçar o problema errado.
        throw new Error(
          "Não foi possível salvar. Confira se seu usuário é administrador; se for, esta " +
            "configuração não existe nesta instância e precisa ser criada por quem a mantém.",
        );
      }
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["app-settings", variables.key] });
    },
  });
}

// ---------------------------------------------------------------------------
// API keys BYO via edge function `store-secret` (Vault; valor nunca volta)
// ---------------------------------------------------------------------------

export const BYO_SECRET_NAMES = [
  "OPENAI_API_KEY",
  "XAI_API_KEY",
  "TAVILY_API_KEY",
  "FIRECRAWL_API_KEY",
] as const;
export type ByoSecretName = (typeof BYO_SECRET_NAMES)[number];

/** Nomes fora do card de IA (Integrações): aceitos pela mesma store-secret. */
export type StorableSecretName =
  | ByoSecretName
  | "ZERNIO_API_KEY"
  | "REPLICATE_API_TOKEN"
  | "ELEVEN_API_KEY"
  | "ELEVEN_VOICE_ID"
  | "HEYGEN_API_KEY"
  | "HIGGSFIELD_API_KEY"
  | "APIFY_TOKEN"
  | "RENDER_WORKER_URL"
  | "RENDER_WORKER_TOKEN"
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET"
  | "CLAUDE_ROUTINE_URL"
  | "CLAUDE_ROUTINE_TOKEN";

/** Status das keys: `store-secret {action: 'status'}` → `{configured: string[]}`. */
export function useSecretStatus() {
  // `enabled` na sessão, e não só `retry: false`: a edge exige JWT, e no boot
  // esta query saía ANTES de o cliente restaurar a sessão do localStorage. O
  // 401 voltava como "Sessão inválida ou ausente." e, sem retry, o erro ficava
  // grudado na tela — o passo 2 do onboarding abria com uma falha que não era
  // falha, só pressa. A suíte não pegava porque `AuthSessionMissingError` está
  // na lista de ruído ignorado do e2e.
  const { session } = useSession();
  return useQuery({
    queryKey: ["secrets", "status"],
    staleTime: 60_000,
    retry: false,
    enabled: Boolean(session),
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase.functions.invoke("store-secret", {
        body: { action: "status" },
      });
      if (error) {
        throw new Error(
          await getFunctionErrorMessage(
            error,
            "Não foi possível verificar as chaves. Recarregue a página.",
          ),
        );
      }
      return ((data as { configured?: string[] })?.configured ?? []) as string[];
    },
  });
}

/** Grava uma key BYO no Vault: `store-secret {name, value}`. Write-only. */
export function useStoreSecret() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      name,
      value,
    }: {
      name: StorableSecretName;
      value: string;
    }): Promise<void> => {
      const { error } = await supabase.functions.invoke("store-secret", {
        body: { name, value },
      });
      if (name.startsWith("GOOGLE_"))
        void queryClient.invalidateQueries({ queryKey: ["google-drive"] });
      if (error) {
        throw new Error(
          await getFunctionErrorMessage(error, "Não foi possível salvar a chave. Tente de novo."),
        );
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["secrets", "status"] });
      // chave nova = conta nova: o saldo no Início relê na hora, não em 5 min
      void queryClient.invalidateQueries({ queryKey: ["provider-credits"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Catálogo de modelos por driver (alimenta o seletor em /config).
// Fontes: defaults verificados do gateway em docs/06-arquitetura-ia.md e as
// referências de modelos dos provedores. Só entram IDs com fonte — o resto vai
// pela opção "Outro", que libera digitar o ID à mão (modelo novo não trava
// ninguém esperando deploy).
// ---------------------------------------------------------------------------

/** Valor sentinela do seletor: revela o campo de texto livre. */
export const MODEL_CUSTOM = "__custom__";
/** Sentinela de "usar o default do driver" — Radix recusa SelectItem com "". */
export const MODEL_DEFAULT = "__default__";

export interface ModelOption {
  value: string;
  label: string;
  /** Papéis em que este modelo faz sentido; ausente = serve a qualquer papel. */
  roles?: AiRole[];
}

export const MODELS_BY_DRIVER: Record<AiDriver, ModelOption[]> = {
  "lovable-gateway": [
    {
      value: "google/gemini-2.5-pro",
      label: "Gemini 2.5 Pro — o padrão para texto",
      roles: ["router", "generator", "judge", "voice_extractor"],
    },
    {
      value: "google/gemini-2.5-flash",
      label: "Gemini 2.5 Flash — rápido e barato",
      roles: ["router", "generator", "judge", "voice_extractor"],
    },
    {
      value: "google/gemini-embedding-001",
      label: "Gemini Embedding 001 — 768d",
      roles: ["embeddings"],
    },
    {
      // VERIFICADO no gateway em 2026-08-31 (uma imagem real, 28s): é o mais
      // forte disponível e o único que tipografa texto legível — a capa é
      // gerada COM a manchete dentro, então o modelo importa.
      value: "google/gemini-3-pro-image-preview",
      label: "Gemini 3 Pro Image — mais detalhe, mais caro",
      roles: ["image"],
    },
    {
      value: "google/gemini-2.5-flash-image",
      label: "Gemini 2.5 Flash Image — o padrão, mais barato",
      roles: ["image"],
    },
  ],
  openai: [{ value: "gpt-image-1", label: "GPT Image 1 — imagens", roles: ["image"] }],
  // Grok (xAI) — IDs VERIFICADOS em docs.x.ai/docs/models em 2026-10-28:
  // grok-4.7 é o flagship (500k de contexto); grok-4.3 é o mais barato com
  // 1M de contexto. "grok-4" e "grok-4-fast" não constam mais na documentação
  // pública, por isso ficaram de fora — "Outro (digitar ID)" cobre.
  // Só chat: embeddings e imagem recusam o driver com mensagem clara.
  xai: [
    {
      value: "grok-4.7",
      label: "Grok 4.7 — o mais capaz",
      roles: ["router", "generator", "judge", "voice_extractor"],
    },
    {
      value: "grok-4.3",
      label: "Grok 4.3 — mais barato, contexto longo",
      roles: ["router", "generator", "judge", "voice_extractor"],
    },
    // Grok Imagine — ID verificado em docs.x.ai/docs/guides/image-generations
    { value: "grok-imagine-image-2.0", label: "Grok Imagine 2.0 — imagens", roles: ["image"] },
  ],
};

/** Opções válidas para o par (driver, papel). */
export function modelsFor(driver: AiDriver, role: AiRole): ModelOption[] {
  return MODELS_BY_DRIVER[driver].filter((m) => !m.roles || m.roles.includes(role));
}
