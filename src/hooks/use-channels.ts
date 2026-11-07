import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

// ---------------------------------------------------------------------------
// Tipos (espelham docs/04-modelo-de-dados.md §6.6 e o enum channel_type)
// ---------------------------------------------------------------------------

export const CHANNEL_TYPES = [
  "instagram_stories",
  "instagram_carousel",
  "instagram_post",
  "x_post",
  "threads_post",
  "linkedin_post",
  "facebook_post",
  // Canal de vídeo (docs/11-video-replicate.md §2.1). Nasce DESLIGADO no seed:
  // `enabledChannels()` filtra por `enabled`, então o chip do Reel só aparece
  // depois que um admin liga o canal em Marca → Canais.
  "instagram_reel",
] as const;

export type ChannelType = (typeof CHANNEL_TYPES)[number];

// ---------------------------------------------------------------------------
// FAMÍLIAS DE FORMATO (ponto 10 do plano).
//
// Reel é do Instagram, mas é a mesma coisa que Shorts do YouTube e que o vídeo
// do TikTok; story é story em qualquer plataforma. A família é a CAMADA por
// cima dos tipos que já existem — renomear `instagram_reel` no banco mexeria
// em peças, canais e histórico gravados, com risco que o ganho não paga.
//
// A peça é pensada pela família; o tipo concreto é detalhe da conta de destino.
// ---------------------------------------------------------------------------

export const FORMAT_FAMILIES = [
  "video_curto_vertical",
  "story",
  "carrossel",
  "post_imagem",
  "post_texto",
] as const;

export type FormatFamily = (typeof FORMAT_FAMILIES)[number];

export const FORMAT_FAMILY_LABELS: Record<FormatFamily, string> = {
  video_curto_vertical: "Vídeo curto vertical",
  story: "Story",
  carrossel: "Carrossel",
  post_imagem: "Post de imagem",
  post_texto: "Post de texto",
};

/** Como cada família se materializa nas plataformas que a instância conhece. */
export const FAMILY_OF_CHANNEL: Record<ChannelType, FormatFamily> = {
  instagram_reel: "video_curto_vertical",
  instagram_stories: "story",
  instagram_carousel: "carrossel",
  instagram_post: "post_imagem",
  x_post: "post_texto",
  threads_post: "post_texto",
  linkedin_post: "post_texto",
  facebook_post: "post_texto",
};

export function channelsOfFamily(family: FormatFamily): ChannelType[] {
  return CHANNEL_TYPES.filter((type) => FAMILY_OF_CHANNEL[type] === family);
}

/** Agrupa canais por família preservando a ordem canônica das famílias. */
export function groupByFamily(
  types: readonly ChannelType[],
): Array<{ family: FormatFamily; label: string; types: ChannelType[] }> {
  return FORMAT_FAMILIES.map((family) => ({
    family,
    label: FORMAT_FAMILY_LABELS[family],
    types: types.filter((type) => FAMILY_OF_CHANNEL[type] === family),
  })).filter((grupo) => grupo.types.length > 0);
}

export const CHANNEL_TYPE_LABELS: Record<ChannelType, string> = {
  instagram_stories: "Instagram Stories",
  instagram_carousel: "Instagram Carrossel",
  instagram_post: "Instagram Post",
  x_post: "X (Twitter)",
  threads_post: "Threads",
  linkedin_post: "LinkedIn",
  facebook_post: "Facebook",
  instagram_reel: "Instagram Reel",
};

export interface ChannelRow {
  id: string;
  type: ChannelType;
  enabled: boolean;
  /** Overrides por instância (limites, template, cutoff_score) — §6.6. */
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

const ADMIN_ONLY_MESSAGE = "Só administradores alteram canais. Peça a um administrador da conta.";

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Os 7 canais (seed por migration), na ordem canônica do enum. */
export function useChannels() {
  return useQuery({
    queryKey: ["channels"],
    queryFn: async (): Promise<ChannelRow[]> => {
      const { data, error } = await supabase.from("channels").select("*");
      if (error) throw new Error(error.message);
      // `config` é jsonb (Json); os overrides são lidos de forma tolerante.
      const rows = (data ?? []) as unknown as ChannelRow[];
      return [...rows].sort(
        (a, b) => CHANNEL_TYPES.indexOf(a.type) - CHANNEL_TYPES.indexOf(b.type),
      );
    },
  });
}

/** Liga/desliga um canal (update direto; RLS restringe a admin). */
export function useToggleChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }): Promise<void> => {
      const { data, error } = await supabase
        .from("channels")
        .update({ enabled })
        .eq("id", id)
        .select("id");
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) throw new Error(ADMIN_ONLY_MESSAGE);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}

/** Substitui o `config` jsonb do canal (overrides de limites/nota de corte). */
/**
 * Grava UMA chave de channels.config sem clobber: lê o config fresco da linha
 * e mescla só a chave — um snapshot velho do cache sobrescreveria edições
 * concorrentes de outros campos (ex.: dialog de Marca → Canais).
 */
export function useSetChannelConfigKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      key,
      value,
    }: {
      id: string;
      key: string;
      /** `undefined` remove a chave. */
      value: unknown;
    }): Promise<void> => {
      const { data: fresh, error: readError } = await supabase
        .from("channels")
        .select("config")
        .eq("id", id)
        .single();
      if (readError) throw new Error(readError.message);
      const config = { ...((fresh?.config ?? {}) as Record<string, unknown>) };
      if (value === undefined) {
        delete config[key];
      } else {
        config[key] = value;
      }
      const { data, error } = await supabase
        .from("channels")
        .update({ config: config as Json })
        .eq("id", id)
        .select("id");
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) throw new Error(ADMIN_ONLY_MESSAGE);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}

export function useUpdateChannelConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      config,
    }: {
      id: string;
      config: Record<string, unknown>;
    }): Promise<void> => {
      const { data, error } = await supabase
        .from("channels")
        .update({ config: config as Json })
        .eq("id", id)
        .select("id");
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) throw new Error(ADMIN_ONLY_MESSAGE);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}
