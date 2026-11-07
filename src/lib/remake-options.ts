// Opções de "Melhorar um vídeo meu" para a tela. Os ids e limites espelham
// supabase/functions/_shared/remake.ts (o servidor valida de novo): mudou lá,
// muda aqui.

import type { RemakeConfig } from "@/hooks/use-director-jobs";

export const REMAKE_MIN_S = 2;
export const REMAKE_MAX_S = 30;
export const SPEECH_MAX_CHARS = 600;
/** Runway Aleph (estilo, cenário) só aceita vídeo de menos de 16 MB. */
export const VISUAL_MAX_BYTES = 16_000_000;
export const VISUAL_MAX_MB = 16;
/** Instrução opcional da troca de pessoa (character_prompt). */
export const CHARACTER_PROMPT_MAX_CHARS = 500;
/** Resolução em que o servidor troca a pessoa (fitResolution(…, "1080p")). */
export const PERSON_SWAP_RESOLUTION = "1080p";

export type RemakeOptionId = "style" | "scene" | "character" | "speech" | "translate" | "captions";

/** A ordem da tela. */
export const REMAKE_OPTION_IDS: readonly RemakeOptionId[] = [
  "style",
  "scene",
  "character",
  "speech",
  "translate",
  "captions",
];

/** Nome e uma linha por opção: o que faz, quem faz e o limite. */
export const REMAKE_OPTION_COPY: Record<RemakeOptionId, { title: string; line: string }> = {
  style: {
    title: "Mudar o estilo",
    line: "Visual novo, mesma fala e gestos. Runway Aleph (Replicate) · até 30 s e 16 MB.",
  },
  scene: {
    title: "Mudar o cenário",
    line: "Troque o lugar, a roupa ou a luz. Runway Aleph (Replicate) · até 30 s e 16 MB.",
  },
  character: {
    title: "Trocar a pessoa",
    line: "Quem aparece vira um apresentador seu, com o áudio original. P-Video Replace (Replicate) · até 30 s.",
  },
  speech: {
    title: "Mudar o que eu digo",
    line: "Fala nova com a boca sincronizada. Voz ElevenLabs, boca HeyGen · até 600 caracteres.",
  },
  translate: {
    title: "Traduzir",
    line: "O mesmo vídeo em outro idioma, com voz e boca. HeyGen · 5 idiomas.",
  },
  captions: {
    title: "Legendas da marca",
    line: "Legendas na cor da marca. Transcrição ElevenLabs, gravação Higgsfield.",
  },
};

/** Opções que mexem na imagem ou na voz de quem aparece: pedem autorização. */
export const PEOPLE_OPTIONS: readonly RemakeOptionId[] = ["character", "speech", "translate"];
/** Opções do Runway Aleph: limite de 16 MB. A troca de pessoa usa o limite do próprio modelo. */
export const VISUAL_OPTIONS: readonly RemakeOptionId[] = ["style", "scene"];
/** Opções que mudam a imagem: a fala nova vira "foto que fala" só sem elas. */
export const IMAGE_OPTIONS: readonly RemakeOptionId[] = ["style", "scene", "character"];

/**
 * Fala em português na voz da marca: ~15 caracteres por segundo. O HeyGen só
 * sincroniza a boca se o áudio e o vídeo diferirem no máximo 15% — fala longa
 * num vídeo curto (23 s de áudio sobre 6 s de vídeo) falhava lá dentro.
 */
export const SPEECH_CHARS_PER_SECOND = 15;
export const SPEECH_DURATION_TOLERANCE = 0.15;

export function speechFit(chars: number, videoSeconds: number | null) {
  if (!videoSeconds || chars === 0) return null;
  const estimated = chars / SPEECH_CHARS_PER_SECOND;
  const ideal = Math.round(videoSeconds * SPEECH_CHARS_PER_SECOND);
  const ratio = estimated / videoSeconds;
  const tooLong = ratio > 1 + SPEECH_DURATION_TOLERANCE;
  const tooShort = ratio < 1 - SPEECH_DURATION_TOLERANCE * 2;
  return { estimated, ideal, tooLong, tooShort };
}

export const STYLE_OPTIONS = [
  { id: "marca", label: "Estilo da minha marca" },
  { id: "cinema", label: "Cinema" },
  { id: "anime", label: "Anime" },
  { id: "massinha", label: "Massinha" },
  { id: "quadrinhos", label: "Quadrinhos" },
  { id: "pixel", label: "Pixel art" },
] as const;

export const LANGUAGE_OPTIONS = [
  { id: "en", label: "Inglês" },
  { id: "es", label: "Espanhol" },
  { id: "fr", label: "Francês" },
  { id: "it", label: "Italiano" },
  { id: "de", label: "Alemão" },
] as const;

/** O que a duração do vídeo permite — `null` quando está dentro do limite. */
export function durationProblem(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds))
    return "Não conseguimos ler este vídeo. Tente outro arquivo MP4 ou MOV.";
  if (seconds < REMAKE_MIN_S)
    return `Este vídeo tem menos de ${REMAKE_MIN_S} segundos. Use um vídeo um pouco maior.`;
  if (seconds > REMAKE_MAX_S + 0.5) {
    return `Este vídeo tem ${Math.round(seconds)} s. Para melhorar, use até ${REMAKE_MAX_S} s — corte antes de subir.`;
  }
  return null;
}

export function formatMb(bytes: number): string {
  const mb = bytes / 1_000_000;
  return `${mb < 10 ? mb.toFixed(1).replace(".", ",") : Math.round(mb)} MB`;
}

/**
 * Maior arquivo que as opções marcadas aceitam: 16 MB do Aleph para estilo e
 * cenário; a troca de pessoa só limita se o modelo declarar `limits.max_bytes`.
 * `null` = sem limite.
 */
export function sizeLimit(
  on: Partial<Record<RemakeOptionId, boolean>>,
  personMaxBytes: number | null | undefined,
): number | null {
  const limits: number[] = [];
  if (VISUAL_OPTIONS.some((id) => on[id])) limits.push(VISUAL_MAX_BYTES);
  if (on.character && personMaxBytes) limits.push(personMaxBytes);
  return limits.length ? Math.min(...limits) : null;
}

/** O tamanho que os modelos aceitam — `null` quando cabe ou quando não há limite. */
export function sizeProblem(bytes: number, limit: number | null): string | null {
  if (limit === null || bytes < limit) return null;
  return `Este vídeo tem ${formatMb(bytes)}. Para essa melhoria, use menos de ${formatMb(limit)}: comprima (exporte em 720p) ou corte antes de subir.`;
}

/** Preço por segundo da troca de pessoa na resolução que o servidor usa. */
export function personSwapRate(
  model: { usdPerSecond: number | null; usdByResolution?: Record<string, number> } | null,
): number | null {
  if (!model) return null;
  return model.usdByResolution?.[PERSON_SWAP_RESOLUTION] ?? model.usdPerSecond;
}

export const SOURCE_LANGUAGE_OPTIONS = [
  { id: "pt", label: "Português" },
  { id: "en", label: "Inglês" },
  { id: "es", label: "Espanhol" },
] as const;

/** Cor da marca no formato que o servidor lê (#RRGGBB); `null` se não der. */
export function captionAccent(color: string | null | undefined): string | null {
  const clean = (color ?? "").trim().replace(/^#/, "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  return /^[0-9a-fA-F]{6}$/.test(full) ? `#${full.toUpperCase()}` : null;
}

/** Frase curta do que foi pedido — vira o título da produção em Vídeos. */
export function remakeSummary(cfg: Partial<RemakeConfig>, captions: boolean): string {
  const parts: string[] = [];
  const style = STYLE_OPTIONS.find((s) => s.id === cfg.style);
  if (style)
    parts.push(style.id === "marca" ? "estilo da marca" : `estilo ${style.label.toLowerCase()}`);
  if (cfg.scene?.trim()) parts.push("cena editada");
  if (cfg.character_identity_id) parts.push("personagem trocado");
  if (cfg.speech?.trim()) parts.push("fala nova");
  const lang = LANGUAGE_OPTIONS.find((l) => l.id === cfg.translate);
  if (lang) parts.push(`em ${lang.label.toLowerCase()}`);
  if (captions) parts.push("legendas");
  return parts.length ? `Vídeo melhorado: ${parts.join(", ")}` : "Vídeo melhorado";
}

/**
 * Integrações que cada opção precisa (ids de lib/integrations). O áudio
 * original volta pelo sandbox do Higgsfield quando ele está conectado e pelo
 * Replicate (util_audio_merge) quando não — por isso o visual sozinho não exige
 * mais o Higgsfield; as legendas continuam exigindo (queima no sandbox).
 */
export function remakeRequirements(
  cfg: Partial<RemakeConfig>,
  captions: boolean,
  /** Sem chave HeyGen, a boca sincroniza pelo `lipsync_post` do Replicate (não vale para a foto que fala). */
  lipsyncViaReplicate = false,
): Array<"replicate" | "higgsfield" | "elevenlabs" | "heygen"> {
  const need = new Set<"replicate" | "higgsfield" | "elevenlabs" | "heygen">();
  const visual = Boolean(cfg.style || cfg.scene?.trim() || cfg.character_identity_id);
  if (visual) need.add("replicate");
  if (cfg.speech?.trim()) {
    // a voz: ElevenLabs (padrão) ou um modelo do catálogo do Replicate
    need.add(cfg.tts_model_id ? "replicate" : "elevenlabs");
    need.add(lipsyncViaReplicate ? "replicate" : "heygen");
  }
  if (cfg.translate) need.add("heygen");
  // legendas: transcrição pela ElevenLabs e queima pelo sandbox do Higgsfield
  if (captions) {
    need.add("elevenlabs");
    need.add("higgsfield");
  }
  return [...need];
}
