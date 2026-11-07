import { useMutation, useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { getFunctionErrorMessage } from "@/lib/edge-functions";

// ---------------------------------------------------------------------------
// "Melhorar um vídeo meu": envio do arquivo (URL assinada da edge
// video-remake — o bucket renders não aceita escrita direta do navegador). Os
// modelos (vídeo→vídeo, voz) vêm de useReplicateVideoModels.
// ---------------------------------------------------------------------------

/** Sobe o vídeo e devolve o caminho no bucket renders. */
export function useUploadRemakeVideo() {
  return useMutation({
    mutationFn: async (file: File): Promise<string> => {
      const contentType = file.type === "video/quicktime" ? "video/quicktime" : "video/mp4";
      const { data, error } = await supabase.functions.invoke("video-remake", {
        body: { action: "upload_url", content_type: contentType },
      });
      if (error)
        throw new Error(
          await getFunctionErrorMessage(error, "Não foi possível preparar o envio do vídeo."),
        );
      const { path, token } = data as { path: string; token: string };
      const { error: uploadError } = await supabase.storage
        .from("renders")
        .uploadToSignedUrl(path, token, file, { contentType });
      if (uploadError) throw new Error(uploadError.message);
      return path;
    },
  });
}

/** Sobe o quadro (jpg) tirado do vídeo, para a "foto que fala" do HeyGen. */
export function useUploadRemakeFrame() {
  return useMutation({
    mutationFn: async (frame: Blob): Promise<string> => {
      const { data, error } = await supabase.functions.invoke("video-remake", {
        body: { action: "upload_url", content_type: "image/jpeg" },
      });
      if (error)
        throw new Error(
          await getFunctionErrorMessage(error, "Não foi possível preparar o envio do quadro."),
        );
      const { path, token } = data as { path: string; token: string };
      const { error: uploadError } = await supabase.storage
        .from("renders")
        .uploadToSignedUrl(path, token, frame, { contentType: "image/jpeg" });
      if (uploadError) throw new Error(uploadError.message);
      return path;
    },
  });
}

/** Sobe a amostra de voz (WAV tirado do vídeo), para clonar a voz de quem fala. */
export function useUploadVoiceSample() {
  return useMutation({
    mutationFn: async (wav: Blob): Promise<string> => {
      const { data, error } = await supabase.functions.invoke("video-remake", {
        body: { action: "upload_url", content_type: "audio/wav" },
      });
      if (error)
        throw new Error(
          await getFunctionErrorMessage(error, "Não foi possível preparar o envio da voz."),
        );
      const { path, token } = data as { path: string; token: string };
      const { error: uploadError } = await supabase.storage
        .from("renders")
        .uploadToSignedUrl(path, token, wav, { contentType: "audio/wav" });
      if (uploadError) throw new Error(uploadError.message);
      return path;
    },
  });
}

interface VoiceCheck {
  ok: boolean | null;
  reason?: string | null;
  tier?: string | null;
  name?: string;
  gender?: string | null;
}

async function voiceCall(body: Record<string, unknown>): Promise<VoiceCheck> {
  const { data, error } = await supabase.functions.invoke("video-remake", { body });
  if (error)
    return { ok: null, reason: await getFunctionErrorMessage(error, "Não deu para conferir.") };
  return data as VoiceCheck;
}

/** O plano do ElevenLabs permite clonar voz? Conferido quando a pessoa escolhe "A minha voz". */
export function useVoiceCloneCheck(enabled: boolean) {
  return useQuery({
    queryKey: ["eleven-clone-check"],
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => voiceCall({ action: "voice_check" }),
  });
}

/** O Voice ID colado existe? Devolve nome e gênero da voz. */
export function useVoiceLookup(voiceId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["eleven-voice", voiceId],
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: () => voiceCall({ action: "voice_lookup", voice_id: voiceId }),
  });
}

/** Voice ID do ElevenLabs colado no cadastro do apresentador. */
const VOICE_ID_SHAPE = /^[A-Za-z0-9]{10,40}$/;

/** Estado do Voice ID colado: vazio, conferindo, válido ou inválido. */
export function useElevenVoiceCheck(value: string) {
  const id = value.trim();
  const shape = VOICE_ID_SHAPE.test(id);
  const lookup = useVoiceLookup(id, shape);
  return {
    empty: id === "",
    shape,
    lookup,
    ok: shape && lookup.data?.ok === true,
  };
}
