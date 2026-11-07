import { humanizeError } from "@/lib/humanize-error";

export interface FunctionError {
  /** mensagem já em português, pronta para a tela */
  message: string;
  /** código do envelope (`replicate_not_configured`, …); null quando não veio */
  code: string | null;
}

/**
 * Lê o envelope de erro padrão das edge functions
 * (`{ error: { code, message, details? } }` — ver docs/07-contratos-backend.md §1).
 * `FunctionsHttpError` carrega a Response original em `error.context`. Devolve
 * a mensagem humanizada E o código: a tela às vezes precisa do código para
 * reagir (ex.: provedor não configurado → CTA "Conectar", não erro).
 */
export async function getFunctionError(error: unknown, fallback: string): Promise<FunctionError> {
  const context = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  try {
    const payload = (await context?.json?.()) as
      | { error?: { message?: string; code?: string } }
      | null
      | undefined;
    if (payload?.error?.message || payload?.error?.code) {
      return {
        message: humanizeError(payload.error.message, payload.error.code),
        code: payload.error.code ?? null,
      };
    }
  } catch {
    // body já consumido ou não-JSON — usa o fallback
  }
  const message = (error as { message?: string } | null)?.message;
  return {
    message:
      message && message !== "Edge Function returned a non-2xx status code"
        ? humanizeError(message)
        : fallback,
    code: null,
  };
}

/** Só a mensagem do envelope (atalho de `getFunctionError`). */
export async function getFunctionErrorMessage(error: unknown, fallback: string): Promise<string> {
  return (await getFunctionError(error, fallback)).message;
}
