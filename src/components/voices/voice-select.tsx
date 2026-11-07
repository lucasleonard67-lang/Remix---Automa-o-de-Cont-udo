import { Loader2, Plus, Square, Volume2 } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { BrandText } from "@/components/brand-inline";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  brandIdOf,
  brandValue,
  useBrandVoicePreview,
  useBrandVoices,
  VOICE_BUCKET,
  type BrandVoice,
} from "@/hooks/use-voices";
import { cn } from "@/lib/utils";

const VoiceBuilderDialog = lazy(() =>
  import("@/components/voices/voice-builder").then((m) => ({ default: m.VoiceBuilderDialog })),
);

// ---------------------------------------------------------------------------
// O seletor de voz do app (docs/construtor-de-voz.md §3.2): as opções de quem
// usa (voz feminina, a do apresentador…), as vozes da marca e, no fim,
// "Criar voz…", que abre o construtor e volta com a voz nova escolhida.
// ---------------------------------------------------------------------------

const CREATE = "__criar_voz__";

export interface VoiceSelectOption {
  value: string;
  label: string;
}

export function VoiceSelect({
  id,
  value,
  onChange,
  options = [],
  unusable,
  presenterName,
  avatarId,
  listen = true,
  groups = [],
  prefer,
  placeholder = "Escolha a voz",
  ariaLabel = "Voz",
  className,
}: {
  id?: string;
  /** a opção escolhida, ou `brand:<id>` */
  value: string | null;
  onChange: (value: string, voice: BrandVoice | null) => void;
  options?: VoiceSelectOption[];
  /** motivo para uma voz da marca não servir aqui (aparece desligada) */
  unusable?: (voice: BrandVoice) => string | null;
  /** nome sugerido para a voz criada (o do apresentador) */
  presenterName?: string;
  avatarId?: string;
  /** mostra "Ouvir" ao lado quando a escolhida é uma voz da marca */
  listen?: boolean;
  /** listas extras, depois das vozes da marca */
  groups?: { label: string; options: VoiceSelectOption[] }[];
  /** provedor do clone em "Criar voz…", num fluxo de um provedor só */
  prefer?: "heygen";
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const voices = useBrandVoices();
  const [creating, setCreating] = useState(false);
  const list = (voices.data ?? []).filter((v) => v.status !== "failed");
  const chosen = list.find((v) => v.id === brandIdOf(value)) ?? null;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex gap-2">
        <Select
          value={value ?? ""}
          onValueChange={(next) => {
            if (next === CREATE) return setCreating(true);
            onChange(next, list.find((v) => v.id === brandIdOf(next)) ?? null);
          }}
        >
          <SelectTrigger id={id} className="flex-1" aria-label={ariaLabel}>
            <SelectValue placeholder={voices.isPending ? "Carregando vozes…" : placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                <BrandText text={o.label} />
              </SelectItem>
            ))}
            {list.length ? (
              <SelectGroup>
                {options.length ? <SelectSeparator /> : null}
                <SelectLabel>Vozes da marca</SelectLabel>
                {list.map((v) => {
                  const reason = v.status === "processing" ? "criando…" : (unusable?.(v) ?? null);
                  return (
                    <SelectItem key={v.id} value={brandValue(v.id)} disabled={reason !== null}>
                      {v.name}
                      {v.is_default ? " · padrão" : ""}
                      {reason ? ` · ${reason}` : ""}
                    </SelectItem>
                  );
                })}
              </SelectGroup>
            ) : null}
            {groups
              .filter((group) => group.options.length)
              .map((group) => (
                <SelectGroup key={group.label}>
                  <SelectSeparator />
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            <SelectSeparator />
            <SelectItem value={CREATE} data-testid="criar-voz-item">
              <span className="inline-flex items-center gap-1.5 text-[var(--via-accent)]">
                <Plus className="size-3.5" aria-hidden="true" /> Criar voz…
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
        {listen && chosen ? <ListenButton voice={{ voice: chosen, avatarId }} /> : null}
      </div>
      {creating ? (
        <Suspense fallback={null}>
          <VoiceBuilderDialog
            open={creating}
            onOpenChange={setCreating}
            presenterName={presenterName}
            avatarId={avatarId}
            prefer={prefer}
            onDone={(voice) => onChange(brandValue(voice.id), voice)}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

/**
 * O "Ouvir" de toda voz (§7): toca uma URL pronta ou pede a amostra na hora.
 * Tocar de novo para; uma falha aparece numa linha curta logo abaixo.
 */
export function ListenButton({
  url,
  voice,
  load,
  disabled = false,
  size = "default",
  label = "Ouvir",
}: {
  url?: string | null;
  /** voz da marca: prévia salva, senão `heygen_voice_preview` com `brand_voice_id` */
  voice?: { voice: BrandVoice; avatarId?: string };
  load?: () => Promise<string>;
  disabled?: boolean;
  size?: "default" | "sm";
  label?: string;
}) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const preview = useBrandVoicePreview();

  useEffect(() => () => audio.current?.pause(), []);

  const source = async (): Promise<string> => {
    if (url) return url;
    if (voice) {
      const v = voice.voice;
      if (v.preview_url) return v.preview_url;
      if (v.preview_path) {
        const { data } = await supabase.storage
          .from(VOICE_BUCKET)
          .createSignedUrl(v.preview_path, 3600);
        if (data?.signedUrl) return data.signedUrl;
      }
      const result = await preview.mutateAsync({
        brand_voice_id: v.id,
        ...(voice.avatarId ? { avatar_id: voice.avatarId } : {}),
      });
      return result.url;
    }
    if (load) return load();
    throw new Error("Esta voz ainda não tem amostra.");
  };

  const toggle = async () => {
    if (state === "playing") {
      audio.current?.pause();
      return setState("idle");
    }
    setProblem(null);
    setState("loading");
    try {
      const src = await source();
      audio.current?.pause();
      const player = new Audio(src);
      audio.current = player;
      player.onended = () => setState("idle");
      player.onerror = () => {
        setState("idle");
        setProblem("Não deu para tocar a amostra.");
      };
      await player.play();
      setState("playing");
    } catch (err) {
      setState("idle");
      setProblem(err instanceof Error ? err.message : "Não deu para tocar a amostra.");
    }
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        size={size}
        onClick={() => void toggle()}
        disabled={disabled || state === "loading"}
        aria-pressed={state === "playing"}
      >
        {state === "loading" ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : state === "playing" ? (
          <Square aria-hidden="true" />
        ) : (
          <Volume2 aria-hidden="true" />
        )}
        {state === "playing" ? "Parar" : label}
      </Button>
      {problem ? (
        <span className="text-xs text-[var(--via-coral-dark)]" role="alert">
          {problem}
        </span>
      ) : null}
    </span>
  );
}
