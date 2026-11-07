import { useMutation } from "@tanstack/react-query";

import { EngineNotDeployedError } from "@/hooks/use-heygen-studio";
import { supabase } from "@/integrations/supabase/client";
import type { IntegrationId } from "@/lib/integrations";
import { audioFileName } from "@/lib/mic-capture";
import { integrationToConnect, type PromptKind } from "@/lib/prompt-assist";
import { humanizeError } from "@/lib/humanize-error";

// ---------------------------------------------------------------------------
// Edge `prompt-assist`: transcrever a fala e melhorar o prompt. Sem chave, o
// erro traz a integração a conectar. Antes do deploy, a edge responde 404 e a
// tela mostra "Chega no próximo deploy do motor.".
// ---------------------------------------------------------------------------

export class PromptAssistError extends Error {
  constructor(
    message: string,
    /** Falta conectar esta integração: a tela abre o modal em vez de mostrar erro. */
    readonly connect: IntegrationId | null,
  ) {
    super(message);
    this.name = "PromptAssistError";
  }
}

async function invoke<T>(body: FormData | Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke("prompt-assist", { body });
  if (!error) return data as T;
  const context = (error as { context?: Response }).context;
  if (context?.status === 404) throw new EngineNotDeployedError();
  const payload = (await context?.json?.().catch(() => null)) as {
    error?: { code?: string; message?: string; details?: unknown };
  } | null;
  throw new PromptAssistError(
    humanizeError(payload?.error?.message ?? fallback, payload?.error?.code),
    payload?.error?.code === "not_connected" ? integrationToConnect(payload.error.details) : null,
  );
}

export function useTranscribePrompt() {
  return useMutation({
    mutationFn: async (audio: Blob): Promise<string> => {
      const form = new FormData();
      form.append("file", audio, audioFileName(audio.type));
      const { text } = await invoke<{ text: string }>(form, "Não deu para transcrever.");
      return text;
    },
  });
}

export function useImprovePrompt() {
  return useMutation({
    mutationFn: async (vars: { text: string; kind: PromptKind; max?: number }): Promise<string> => {
      const { text } = await invoke<{ text: string }>(vars, "Não deu para melhorar o prompt.");
      return text;
    },
  });
}
