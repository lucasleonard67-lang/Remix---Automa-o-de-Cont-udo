import type { VideoModelOption } from "@/hooks/use-video-models";

// ---------------------------------------------------------------------------
// Sublinha de cada opção do portão de geração: para que o modelo serve + o
// limite que importa (duração por cena, blocos de cobrança). Copy humana por
// model_id; sem frase própria, cai no genérico da capacidade. Uma frase curta
// por linha — a lista inteira tem que caber no olho.
// ---------------------------------------------------------------------------

export const MODEL_NOTES: Record<string, string> = {
  // cenas (imagem → vídeo)
  "bytedance/seedance-2.0": "Sem segundos mudos no fim; mantém o rosto do apresentador.",
  "bytedance/seedance-1-lite": "Movimento mais simples.",
  "kwaivgi/kling-v2.5-turbo-pro": "Cobra em blocos de 5 ou 10 s: uma fala de 6 s paga 10.",
  "minimax/hailuo-2.3": "Cobra em blocos de 6 ou 10 s: uma fala de 7 s paga 10.",
  "pixverse/pixverse-v6": "Cobra em blocos de 5, 8, 10 ou 15 s.",
  // Higgsfield
  cinematic_studio_3_0: "Mantém melhor o mesmo rosto entre cenas.",
  cinematic_studio_video_v2: "Versão anterior do estúdio; mais rápida, menos detalhe.",
  // vídeo → vídeo
  "runwayml/aleph-2": "Muda estilo, cena ou pessoa mantendo fala, gesto e câmera.",
  // voz
  "minimax/speech-02-hd": "Voz natural em português; cobra por letra.",
  "minimax/speech-2.8-hd": "Mesma voz, versão mais nova; cobra por letra.",
  elevenlabs: "A voz da marca, como nos outros vídeos.",
  // informativas
  heygen: "Boca sincronizada e tradução pela HeyGen.",
  // quadros
  "google/nano-banana-2": "Quadro de referência da cena; o mesmo rosto em todas.",
  "google/nano-banana-pro": "Quadro com mais detalhe; mais caro por imagem.",
};

const CAPABILITY_NOTE: Record<string, string> = {
  scene_i2v: "Gera a cena em vídeo a partir do quadro.",
  scene_t2v: "Gera a cena em vídeo só do texto.",
  scene_v2v: "Refaz o vídeo mantendo o movimento.",
  talking_avatar: "Apresentador falando a partir do quadro e da narração.",
  tts: "Narração a partir do texto.",
  keyframe: "Quadro de referência da cena.",
};

/** Frase da linha: nota do modelo (ou da capacidade) + limite de duração, quando houver. */
export function modelNote(
  option: Pick<VideoModelOption, "id" | "maxSeconds" | "durationMode">,
  capability?: string,
): string {
  const base =
    MODEL_NOTES[option.id] ?? (capability ? CAPABILITY_NOTE[capability] : undefined) ?? "";
  // modelo de blocos já diz os blocos na própria nota; o contínuo ganha o teto por cena
  const limit =
    option.maxSeconds != null && option.durationMode !== "discrete" && !/blocos/.test(base)
      ? `Até ${option.maxSeconds} s por cena.`
      : "";
  return [base, limit].filter(Boolean).join(" ");
}
