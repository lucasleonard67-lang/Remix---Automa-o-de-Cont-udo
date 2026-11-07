// Parâmetros de URL da criação (home "/"). Sem JSX: compartilhado pela rota,
// pelo redirect de /criar e pelos links que preenchem o campo.
//   ?radar=<id>        — notícia do Radar anexada; o briefing vem pré-composto
//   ?brief=&kind=      — texto e família de formato (Ideias, assistente)
//   ?channel=          — um canal específico pré-marcado
// O Criar é só estático. Vídeo e Reel moram em /videos/novo: os links antigos
// (?kind=video, ?channel=instagram_reel) viram `video` e a rota os encaminha.

import { CHANNEL_TYPE_LABELS, type ChannelType } from "@/hooks/use-channels";

export type CreateKind = "post" | "image";
export const CREATE_KINDS: readonly CreateKind[] = ["post", "image"];

export const KIND_CHANNELS: Record<CreateKind, readonly ChannelType[]> = {
  post: [],
  image: ["instagram_post", "instagram_carousel", "instagram_stories"],
};

export interface CreateSearch {
  radar?: string;
  brief?: string;
  kind?: CreateKind;
  channel?: ChannelType;
  /** A pessoa veio atrás de vídeo: a rota leva a /videos/novo com o tema. */
  video?: true;
}

export function validateCreateSearch(search: Record<string, unknown>): CreateSearch {
  const video =
    search.video === true || search.kind === "video" || search.channel === "instagram_reel";
  return {
    ...(typeof search.radar === "string" ? { radar: search.radar } : {}),
    ...(typeof search.brief === "string" && search.brief.trim() ? { brief: search.brief } : {}),
    ...(CREATE_KINDS.includes(search.kind as CreateKind)
      ? { kind: search.kind as CreateKind }
      : {}),
    ...(typeof search.channel === "string" &&
    search.channel in CHANNEL_TYPE_LABELS &&
    search.channel !== "instagram_reel"
      ? { channel: search.channel as ChannelType }
      : {}),
    ...(video ? { video: true as const } : {}),
  };
}

/** Chave da intenção vinda pela URL (qualquer parâmetro); null = nada pedido. */
export function intentKey(search: CreateSearch): string | null {
  const { radar, brief, kind, channel } = search;
  if (!radar && !brief && !kind && !channel) return null;
  return JSON.stringify([radar ?? null, brief ?? null, kind ?? null, channel ?? null]);
}

/** id do campo do briefing — alvo de "Escrever o tema" e do foco por URL. */
export const BRIEF_FIELD_ID = "criar-briefing";
