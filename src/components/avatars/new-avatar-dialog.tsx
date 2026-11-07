import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";

import { ElevenVoiceField, VoicePicker } from "@/components/avatars/voice-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MAX_PRESENTER_PHOTOS, useCreateAvatar, useGenerateIdentity } from "@/hooks/use-avatars";
import { useElevenVoiceCheck } from "@/hooks/use-video-remake";
import { humanizeError } from "@/lib/humanize-error";

// ---------------------------------------------------------------------------
// "Novo apresentador" — cadastro único de quem aparece e fala nos vídeos
// (Reels e Diretor). Abre de Avatares, de Vídeos → Novo e da produção do Reel,
// para a ação acontecer ali mesmo. Com fotos, elas já são o rosto; só com
// descrição, um retrato é gerado a partir dela.
// ---------------------------------------------------------------------------

export function NewAvatarDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chamado assim que o apresentador existe (já pode ser escolhido). */
  onCreated?: (avatar: { id: string; name: string; is_default: boolean }) => void;
}) {
  const create = useCreateAvatar();
  const generate = useGenerateIdentity();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [voiceId, setVoiceId] = useState<string | undefined>(undefined);
  const [elevenVoiceId, setElevenVoiceId] = useState("");
  const eleven = useElevenVoiceCheck(elevenVoiceId);
  const [files, setFiles] = useState<File[]>([]);
  // key força o remount do <input type=file> no reset (input não é controlável)
  const [fileKey, setFileKey] = useState(0);

  const pending = create.isPending || generate.isPending;
  const canSubmit =
    name.trim().length > 0 &&
    (files.length > 0 || description.trim().length > 0) &&
    (eleven.empty || eleven.ok) &&
    !pending;

  const reset = () => {
    setName("");
    setDescription("");
    setVoiceId(undefined);
    setElevenVoiceId("");
    setFiles([]);
    setFileKey((k) => k + 1);
  };

  const finish = (avatar: { id: string; name: string; is_default: boolean }) => {
    reset();
    onOpenChange(false);
    onCreated?.(avatar);
  };

  const submit = () => {
    if (!canSubmit) return;
    create.mutate(
      {
        name: name.trim(),
        appearance_prompt: description.trim() || undefined,
        voice_id: voiceId,
        ...(eleven.ok ? { elevenlabs_voice_id: elevenVoiceId.trim() } : {}),
        files,
      },
      {
        onSuccess: async ({ avatar }) => {
          if (files.length > 0) {
            toast.success(`${avatar.name} está pronto para os vídeos`);
            finish(avatar);
            return;
          }
          // Só descrição: o rosto nasce de um retrato gerado a partir dela.
          try {
            await generate.mutateAsync({ avatar_id: avatar.id });
            toast.success(`${avatar.name} cadastrado`, {
              description: "O retrato fica pronto em instantes.",
            });
          } catch (error) {
            toast.error(`${avatar.name} foi cadastrado, mas o retrato não saiu`, {
              description: humanizeError(error instanceof Error ? error.message : null),
            });
          }
          finish(avatar);
        },
        onError: (error) =>
          toast.error("Não foi possível cadastrar", {
            description: humanizeError(error.message),
          }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo apresentador</DialogTitle>
          <DialogDescription>
            Envie de 1 a 3 fotos de frente ou descreva a pessoa. Cadastre uma vez e use em todos os
            vídeos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="presenter-name">Nome</Label>
            <Input
              id="presenter-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Fundador"
              maxLength={32}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="presenter-photos">Fotos (até {MAX_PRESENTER_PHOTOS})</Label>
            <Input
              key={fileKey}
              id="presenter-photos"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={(event) =>
                setFiles(Array.from(event.target.files ?? []).slice(0, MAX_PRESENTER_PHOTOS))
              }
              className="text-xs"
            />
            <p className="text-xs text-muted-foreground">Boa luz e só uma pessoa na foto.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="presenter-description">
              {files.length > 0 ? "Descrição (opcional)" : "Ou descreva a pessoa"}
            </Label>
            <Textarea
              id="presenter-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Ex.: mulher de 30 e poucos anos, cabelo cacheado, blazer bege"
              className="min-h-20"
            />
          </div>

          <div className="space-y-2">
            <VoicePicker value={voiceId} onChange={setVoiceId} />
            <ElevenVoiceField value={elevenVoiceId} onChange={setElevenVoiceId} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Cadastrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
