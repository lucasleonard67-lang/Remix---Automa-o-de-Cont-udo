import { ChevronDown, Loader2, Volume2 } from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";

import { BrandIcon } from "@/components/brand-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AVATAR_BUCKET, useAvatarVoices, usePreviewVoice } from "@/hooks/use-avatars";
import { useSignedUrl } from "@/hooks/use-storage";
import { useElevenVoiceCheck } from "@/hooks/use-video-remake";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Voz do apresentador dos Reels: seletor + amostra. Usado ao criar e ao editar.
// ---------------------------------------------------------------------------

export function VoicePicker({
  value,
  onChange,
  avatarId,
  label = "Voz da narração",
}: {
  value: string | undefined;
  onChange: (voiceId: string) => void;
  avatarId?: string;
  label?: string;
}) {
  const voices = useAvatarVoices();
  const preview = usePreviewVoice();
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const signed = useSignedUrl(AVATAR_BUCKET, previewPath);

  return (
    <div className="space-y-2">
      <Label htmlFor="voz">{label}</Label>
      <div className="flex gap-2">
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id="voz" className="flex-1">
            <SelectValue placeholder={voices.isLoading ? "Carregando vozes…" : "Escolha a voz"} />
          </SelectTrigger>
          <SelectContent>
            {(voices.data ?? []).map((voice) => (
              <SelectItem key={voice.id} value={voice.id}>
                {voice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          disabled={!value || preview.isPending}
          onClick={() =>
            preview.mutate(
              { voice_id: value as string, ...(avatarId ? { avatar_id: avatarId } : {}) },
              {
                onSuccess: (result) => setPreviewPath(result.path),
                onError: (error) =>
                  toast.error("Não foi possível gerar a amostra", { description: error.message }),
              },
            )
          }
        >
          {preview.isPending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Volume2 aria-hidden="true" />
          )}
          Ouvir
        </Button>
      </div>
      {preview.isPending ? (
        <p className="text-xs text-muted-foreground">Gerando a amostra — leva alguns segundos.</p>
      ) : null}
      {signed.data ? <audio controls src={signed.data} className="w-full" /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Voz do ElevenLabs (opcional, secundária): Voice ID colado e conferido antes
// de salvar, como em "Mudar o que eu digo". Vai como voice.elevenlabs_voice_id.
// ---------------------------------------------------------------------------

const GENDER_LABEL: Record<string, string> = { female: "feminina", male: "masculina" };

export function ElevenVoiceField({
  value,
  onChange,
  idPrefix = "presenter",
  initiallyOpen = false,
  hint,
}: {
  value: string;
  onChange: (voiceId: string) => void;
  idPrefix?: string;
  /** já abre o campo (quando a pessoa escolheu "ElevenLabs" antes) */
  initiallyOpen?: boolean;
  /** texto do campo vazio; o padrão fala da voz de cima */
  hint?: string;
}) {
  const [open, setOpen] = useState(initiallyOpen || value.trim() !== "");
  const { empty, shape, lookup, ok } = useElevenVoiceCheck(value);
  const inputId = `${idPrefix}-eleven-voice`;

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <BrandIcon name="elevenlabs" />
        Usar uma voz do ElevenLabs
        <ChevronDown aria-hidden="true" />
      </Button>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId}>Voice ID do ElevenLabs (opcional)</Label>
      <Input
        id={inputId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Ex.: EXAVITQu4vr4xnSDxMaL"
        aria-invalid={!empty && !ok}
        className="font-mono"
      />
      <p
        className={cn(
          "text-xs",
          !empty && shape && lookup.data?.ok === false
            ? "font-medium text-[var(--via-coral-dark)]"
            : ok
              ? "font-medium text-[var(--via-success)]"
              : "text-muted-foreground",
        )}
      >
        {empty
          ? (hint ??
            "Vale no lugar da voz acima. No ElevenLabs: Voices → escolha a voz → copie o ID.")
          : !shape
            ? "Esse ID não parece do ElevenLabs. Copie de novo em Voices."
            : lookup.isLoading
              ? "Conferindo a voz no ElevenLabs…"
              : ok
                ? `Voz encontrada: ${lookup.data?.name}${lookup.data?.gender ? ` (${GENDER_LABEL[lookup.data.gender] ?? lookup.data.gender})` : ""}.`
                : (lookup.data?.reason ??
                  "Não deu para conferir a voz. Confira o ID e cole de novo.")}
      </p>
    </div>
  );
}
