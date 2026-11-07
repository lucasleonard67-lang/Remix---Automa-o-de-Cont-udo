import { toast as sonner } from "sonner";

import { humanizeError } from "@/lib/humanize-error";

// `toast` do app: igual ao do sonner, mas a descrição de `toast.error` passa
// pelo humanizeError — vários pontos repassam `error.message` cru (Supabase em
// inglês, JSON de provedor, jargão interno) e assim nenhum chega à tela assim.
// O título também passa pelo humanizeError: vários pontos chamam
// `toast.error(err.message)` e a mensagem crua virava o título. Frase que já
// está boa passa intacta.
const error: typeof sonner.error = (message, data) =>
  sonner.error(
    typeof message === "string" ? humanizeError(message) : message,
    data && typeof data.description === "string" && data.description.trim()
      ? { ...data, description: humanizeError(data.description) }
      : data,
  );

/**
 * Erro que oferece a saída ali mesmo (heurística 9 de Nielsen): o que houve,
 * o que fazer e o botão "Tentar de novo".
 */
const retry = (message: string, data: { description?: string; onRetry: () => void }) =>
  error(message, {
    description: data.description,
    action: { label: "Tentar de novo", onClick: data.onRetry },
  });

export const toast = Object.assign((...args: Parameters<typeof sonner>) => sonner(...args), {
  ...sonner,
  error,
  retry,
});
