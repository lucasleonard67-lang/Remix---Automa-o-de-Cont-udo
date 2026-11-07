import { Loader2, Mic, Square, Undo2, Wand2 } from "lucide-react";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";

import { DEFAULT_PROVIDER, DRIVER_SECRET } from "@/components/ai-role-grid";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAppSetting, useSecretStatus, type AiProviders } from "@/hooks/use-app-settings";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useEscreverComClaude, type EscritaConfig } from "@/components/prompt/escrever-com-claude";
import {
  PromptAssistError,
  useImprovePrompt,
  useTranscribePrompt,
} from "@/hooks/use-prompt-assist";
import { openIntegration } from "@/lib/integration-modal";
import type { IntegrationId } from "@/lib/integrations";
import { MIC_MAX_S, MicCapture, micSupported } from "@/lib/mic-capture";
import { appendSpoken, type PromptKind } from "@/lib/prompt-assist";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { formatClock } from "@/lib/voice-recording";

// ---------------------------------------------------------------------------
// Falar em vez de digitar e "Melhorar prompt": os mesmos controles em todo
// campo de prompt. A fala cai no campo; o prompt melhorado também, editável,
// com um toque para voltar ao original. Sem chave, o botão leva à integração.
// PromptField é o campo pronto; PromptTools é só a linha, para campos próprios.
//
// Campos de vídeo passam `claude`: no lugar de "Melhorar prompt" (gateway)
// entra "Escrever com o seu Claude", pelo conector da assinatura da pessoa.
// ---------------------------------------------------------------------------

export function PromptTools({
  value,
  onChange,
  kind,
  max,
  disabled = false,
  onBusyChange,
  className,
  claude = null,
}: {
  value: string;
  onChange: (next: string) => void;
  kind: PromptKind;
  /** Limite de caracteres do campo. */
  max?: number;
  disabled?: boolean;
  /** Gravando, transcrevendo ou melhorando: o texto ainda vai mudar. */
  onBusyChange?: (busy: boolean) => void;
  className?: string;
  /** O botão "Escrever com o seu Claude" já montado: substitui "Melhorar prompt". */
  claude?: ReactNode;
}) {
  const providers = useAppSetting<AiProviders>("ai_providers");
  const secrets = useSecretStatus();
  const { isAdmin } = useIsAdmin();
  const transcribe = useTranscribePrompt();
  const improve = useImprovePrompt();
  const capture = useRef<MicCapture | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [original, setOriginal] = useState<string | null>(null);
  // a resposta chega depois: a fala entra no texto de agora, não no do clique
  const latest = useRef(value);
  latest.current = value;

  const recording = seconds !== null;
  const working = recording || transcribe.isPending || improve.isPending;
  useEffect(() => onBusyChange?.(working), [working, onBusyChange]);
  // só existe no navegador: decide depois de montar
  const [micReady, setMicReady] = useState(false);
  useEffect(() => {
    setMicReady(micSupported());
    return () => capture.current?.cancel();
  }, []);

  const config = providers.data?.generator ?? DEFAULT_PROVIDER;
  const aiSecret = DRIVER_SECRET[config.driver];
  // lista desconhecida (quem não é admin não a lê): quem responde é o motor
  const missing = (name: string | undefined) =>
    !name || !secrets.data ? false : !secrets.data.includes(name);

  const failed = (error: Error) => {
    if (error instanceof PromptAssistError && error.connect) {
      if (isAdmin) openIntegration(error.connect);
      else toast.error("Peça a um administrador para conectar esta integração.");
      return;
    }
    toast.error(error.message);
  };

  const finish = async () => {
    const mic = capture.current;
    capture.current = null;
    setSeconds(null);
    const audio = await mic?.stop();
    if (!audio?.size) return;
    transcribe.mutate(audio, {
      onSuccess: (text) => onChange(appendSpoken(latest.current, text, max)),
      onError: failed,
    });
  };

  // relógio da gravação; para sozinho no teto
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds((s) => (s === null ? s : s + 1)), 1000);
    return () => clearInterval(timer);
  }, [recording]);
  useEffect(() => {
    if (seconds !== null && seconds >= MIC_MAX_S) void finish();
    // `finish` muda a cada render; só o relógio dispara
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds]);

  const clickMic = async () => {
    if (recording) return void finish();
    if (missing("ELEVEN_API_KEY")) return openIntegration("elevenlabs");
    const mic = new MicCapture();
    try {
      await mic.start();
      capture.current = mic;
      setSeconds(0);
    } catch {
      mic.cancel();
      toast.error("Libere o microfone no navegador para falar.");
    }
  };

  const clickImprove = () => {
    if (missing(aiSecret)) return openIntegration(config.driver as IntegrationId);
    const before = value;
    improve.mutate(
      { text: before, kind, max },
      {
        onSuccess: (text) => {
          setOriginal(before);
          onChange(text);
        },
        onError: failed,
      },
    );
  };

  const busy = disabled || transcribe.isPending || improve.isPending;
  return (
    <div
      className={cn("flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1", className)}
      data-testid="prompt-tools"
    >
      {micReady ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs tabular-nums"
          disabled={busy}
          aria-label={recording ? "Parar e transcrever" : "Falar em vez de digitar"}
          aria-pressed={recording}
          onClick={() => void clickMic()}
          data-testid="prompt-mic"
        >
          {transcribe.isPending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : recording ? (
            <Square aria-hidden="true" />
          ) : (
            <Mic aria-hidden="true" />
          )}
          {recording ? formatClock(seconds) : null}
        </Button>
      ) : null}
      {claude ?? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={busy || recording || !value.trim()}
          onClick={clickImprove}
          data-testid="prompt-melhorar"
        >
          {improve.isPending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Wand2 aria-hidden="true" />
          )}
          Melhorar prompt
        </Button>
      )}
      {original !== null && !claude ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Voltar ao original"
          title="Voltar ao original"
          disabled={busy}
          onClick={() => {
            onChange(original);
            setOriginal(null);
          }}
          data-testid="prompt-voltar"
        >
          <Undo2 aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}

/** Campo de prompt pronto: a caixa de texto com os controles dentro dela. */
export function PromptField({
  value,
  onChange,
  kind,
  max,
  disabled,
  onBusyChange,
  className,
  claude = null,
  ...textarea
}: Omit<ComponentProps<typeof Textarea>, "value" | "onChange"> & {
  value: string;
  onChange: (next: string) => void;
  kind: PromptKind;
  max?: number;
  onBusyChange?: (busy: boolean) => void;
  /** Campo de vídeo: o Claude da pessoa escreve este campo pelo conector. */
  claude?: EscritaConfig | null;
}) {
  const escrita = useEscreverComClaude(claude, value, onChange, disabled);
  return (
    <div className="space-y-2">
      <div
        className={cn(
          "rounded-[10px] border border-input bg-white transition-[box-shadow,border-color] duration-200 focus-within:border-[var(--via-navy-30)] focus-within:shadow-[var(--via-shadow-focus)]",
          className,
        )}
      >
        <Textarea
          {...textarea}
          value={value}
          disabled={disabled}
          maxLength={max}
          onChange={(event) => onChange(event.target.value)}
          className="border-0 bg-transparent focus-visible:shadow-none"
        />
        <PromptTools
          value={value}
          onChange={onChange}
          kind={kind}
          max={max}
          disabled={disabled}
          onBusyChange={onBusyChange}
          className="px-2 pb-1.5"
          claude={escrita.botao}
        />
      </div>
      {escrita.faixa}
    </div>
  );
}
