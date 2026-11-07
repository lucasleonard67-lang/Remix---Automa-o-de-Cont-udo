import { createFileRoute } from "@tanstack/react-router";
import { Loader2, PenLine, Star, UserRound, UserRoundPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";

import { AvatarBuilderDialog, HeygenAvatarSection } from "@/components/avatars/avatar-builder";
import { NewAvatarDialog } from "@/components/avatars/new-avatar-dialog";
import { PresenterTile } from "@/components/avatars/presenter-tile";
import { ElevenVoiceField, VoicePicker } from "@/components/avatars/voice-picker";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  AVATAR_BUCKET,
  isAvatarGenerating,
  useArchiveAvatar,
  useAvatarPredictions,
  useAvatars,
  useGenerateIdentity,
  useLegacyIdentitiesPending,
  useMigrateIdentities,
  useSetDefaultAvatar,
  useUpdateAvatar,
  type AvatarRow,
} from "@/hooks/use-avatars";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useSignedUrl } from "@/hooks/use-storage";
import { useElevenVoiceCheck } from "@/hooks/use-video-remake";
import { brandIdOf, brandValue, findBrandVoice, useBrandVoices } from "@/hooks/use-voices";
import { VoiceSelect } from "@/components/voices/voice-select";
import { humanizeError } from "@/lib/humanize-error";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/marca/avatares")({
  component: PresentersPage,
});

// ---------------------------------------------------------------------------
// Apresentadores — cadastro único de quem aparece e fala nos vídeos (Reels e
// Diretor). A pessoa é cadastrada uma vez; cada motor é preparado sozinho na
// primeira geração. A página é um elenco de crachás: clicar abre o editor.
// ---------------------------------------------------------------------------

function PresentersPage() {
  const { isAdmin } = useIsAdmin();
  const avatarsQuery = useAvatars("active");
  const archivedQuery = useAvatars("archived");
  const [creating, setCreating] = useState(false);
  const [building, setBuilding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  useLegacyMigration(isAdmin);

  const avatars = avatarsQuery.data ?? [];
  const editing = avatars.find((avatar) => avatar.id === editingId) ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Apresentadores"
        description="Quem aparece e fala nos seus vídeos. Cadastre uma vez e escolha na hora de gerar."
      >
        {isAdmin ? (
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setCreating(true)}>
              <PenLine aria-hidden="true" />
              Novo apresentador
            </Button>
            <Button onClick={() => setBuilding(true)} data-testid="criar-avatar-abrir">
              <UserRoundPlus aria-hidden="true" />
              Criar avatar
            </Button>
          </div>
        ) : null}
      </PageHeader>

      {avatarsQuery.isLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="aspect-[3/4] rounded-[14px]" />
          ))}
        </div>
      ) : avatars.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title="Nenhum apresentador ainda"
          description="Sem apresentador, os vídeos saem só com imagens de apoio, sem ninguém falando."
        />
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {avatars.map((avatar) => (
            <PresenterRosterItem
              key={avatar.id}
              avatar={avatar}
              onOpen={isAdmin ? () => setEditingId(avatar.id) : undefined}
            />
          ))}
        </ul>
      )}

      {(archivedQuery.data ?? []).length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Arquivados</h2>
          <div className="flex flex-wrap gap-2">
            {(archivedQuery.data ?? []).map((avatar) => (
              <Badge
                key={avatar.id}
                variant="outline"
                className="font-normal text-muted-foreground"
              >
                {avatar.name}
              </Badge>
            ))}
          </div>
        </section>
      ) : null}

      <NewAvatarDialog open={creating} onOpenChange={setCreating} />
      <AvatarBuilderDialog open={building} onOpenChange={setBuilding} />
      {editing ? (
        <EditPresenterDialog
          key={editing.id}
          avatar={editing}
          open
          onOpenChange={(open) => !open && setEditingId(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Traz, uma vez por visita, os avatares do cadastro antigo (menu Avatares →
 * Higgsfield) para cá. Silencioso quando não há nada; avisa só o resultado.
 */
function useLegacyMigration(isAdmin: boolean) {
  const pending = useLegacyIdentitiesPending(isAdmin);
  const migrate = useMigrateIdentities();
  const ran = useRef(false);
  const { mutate } = migrate;

  useEffect(() => {
    if (ran.current || !isAdmin || !pending.data) return;
    ran.current = true;
    mutate(undefined, {
      onSuccess: (result) => {
        if (result.migrated > 0) {
          toast.success(
            result.migrated === 1
              ? "Seu avatar agora está em Apresentadores"
              : `Seus ${result.migrated} avatares agora estão em Apresentadores`,
          );
        }
        const missingPhotos = new Set((result.warnings ?? []).map((w) => w.name));
        if (missingPhotos.size > 0) {
          toast.info(`Faltaram fotos antigas de ${[...missingPhotos].join(", ")}`, {
            description: "Abra o apresentador e confira o rosto.",
          });
        }
        if (result.pending > 0) {
          toast.error("Alguns avatares antigos não vieram", {
            description: "Recarregue a página para tentar de novo.",
          });
        }
      },
      onError: (error) =>
        toast.error("Os avatares antigos não vieram", {
          description: humanizeError(error.message),
        }),
    });
  }, [isAdmin, pending.data, mutate]);
}

function PresenterRosterItem({ avatar, onOpen }: { avatar: AvatarRow; onOpen?: () => void }) {
  const predictions = useAvatarPredictions(avatar.id);
  const generating = isAvatarGenerating(predictions.data);
  const lastFailed = (predictions.data ?? []).find((p) => p.status === "failed");

  return (
    <li className="space-y-1.5">
      <PresenterTile
        avatar={avatar}
        busy={generating}
        onClick={onOpen}
        label={onOpen ? `Editar ${avatar.name}` : avatar.name}
        corner={
          avatar.is_default ? (
            <Badge className="gap-1 font-normal shadow-[var(--via-shadow-sm)]">
              <Star className="size-3" aria-hidden="true" />
              padrão
            </Badge>
          ) : null
        }
      />
      {lastFailed && !generating ? (
        <p className="text-xs text-destructive">{humanizeError(lastFailed.error)}</p>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Editor: dados da pessoa, retratos e ações de curadoria
// ---------------------------------------------------------------------------

function EditPresenterDialog({
  avatar,
  open,
  onOpenChange,
}: {
  avatar: AvatarRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdateAvatar();
  const generate = useGenerateIdentity();
  const setDefault = useSetDefaultAvatar();
  const archive = useArchiveAvatar();
  const predictions = useAvatarPredictions(avatar.id);
  const generating = isAvatarGenerating(predictions.data);

  const [name, setName] = useState(avatar.name);
  const [description, setDescription] = useState(avatar.appearance_prompt ?? "");
  const [voiceId, setVoiceId] = useState<string | undefined>(avatar.voice?.voice_id);
  const savedEleven = avatar.voice?.elevenlabs_voice_id ?? "";
  const [elevenVoiceId, setElevenVoiceId] = useState(savedEleven);
  const eleven = useElevenVoiceCheck(elevenVoiceId);
  // a voz no seletor: "catalog" (MiniMax), "eleven" (Voice ID colado) ou uma voz da marca
  const brandVoices = useBrandVoices();
  const [voiceMode, setVoiceMode] = useState<string | null>(null);
  const savedHeygen = avatar.voice?.heygen_voice ?? null;
  const savedBrand =
    findBrandVoice(brandVoices.data ?? [], "elevenlabs", savedEleven) ??
    findBrandVoice(brandVoices.data ?? [], savedHeygen?.provider, savedHeygen?.voice_id);
  const voiceKey =
    voiceMode ?? (savedBrand ? brandValue(savedBrand.id) : savedEleven ? "eleven" : "catalog");
  const brandVoice = (brandVoices.data ?? []).find((v) => v.id === brandIdOf(voiceKey)) ?? null;
  const elevenChanged = voiceKey === "eleven" && elevenVoiceId.trim() !== savedEleven;
  const [instruction, setInstruction] = useState("");

  const busy = update.isPending || setDefault.isPending || archive.isPending;

  /** O que a escolha de voz muda no cadastro (só o que mudou). */
  const voiceChoicePatch = () => {
    if (brandVoice?.provider_voice_id) {
      const id = brandVoice.provider_voice_id;
      if (brandVoice.provider === "heygen")
        return savedHeygen?.provider === "heygen" && savedHeygen.voice_id === id
          ? {}
          : { heygen_voice: { provider: "heygen" as const, voice_id: id } };
      return id === savedEleven
        ? {}
        : {
            elevenlabs_voice_id: id,
            heygen_voice: { provider: "elevenlabs" as const, voice_id: id },
          };
    }
    // vazio apaga a voz do ElevenLabs salva antes; voltar ao catálogo também
    if (voiceKey === "eleven")
      return elevenChanged ? { elevenlabs_voice_id: elevenVoiceId.trim() || null } : {};
    return voiceKey === "catalog" && savedEleven ? { elevenlabs_voice_id: null } : {};
  };

  const save = () => {
    update.mutate(
      {
        avatar_id: avatar.id,
        name: name.trim() || avatar.name,
        appearance_prompt: description.trim(),
        ...(voiceId ? { voice_id: voiceId } : {}),
        ...voiceChoicePatch(),
      },
      {
        onSuccess: () => {
          toast.success("Apresentador atualizado");
          onOpenChange(false);
        },
        onError: (error) =>
          toast.error("Não foi possível salvar", { description: humanizeError(error.message) }),
      },
    );
  };

  const runGenerate = () => {
    generate.mutate(
      { avatar_id: avatar.id, instruction: instruction.trim() || undefined },
      {
        onSuccess: () => {
          setInstruction("");
          toast.success("Gerando outro retrato", {
            description: "Os retratos atuais mantêm o mesmo rosto.",
          });
        },
        onError: (error) =>
          toast.error("Não foi possível gerar", { description: humanizeError(error.message) }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{avatar.name}</DialogTitle>
          <DialogDescription>Mudanças valem para os próximos vídeos.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`nome-${avatar.id}`}>Nome</Label>
            <Input
              id={`nome-${avatar.id}`}
              value={name}
              maxLength={32}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`descricao-${avatar.id}`}>Descrição</Label>
            <Textarea
              id={`descricao-${avatar.id}`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="min-h-20"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`voz-${avatar.id}`}>Voz</Label>
            <VoiceSelect
              id={`voz-${avatar.id}`}
              value={voiceKey}
              onChange={(next) => setVoiceMode(next)}
              options={[
                { value: "catalog", label: "Do catálogo" },
                { value: "eleven", label: "Voice ID do ElevenLabs" },
              ]}
              unusable={(v) => (v.provider_voice_id ? null : "criando…")}
              presenterName={avatar.name}
              avatarId={avatar.id}
            />
            {voiceKey === "catalog" ? (
              <VoicePicker
                value={voiceId}
                onChange={setVoiceId}
                avatarId={avatar.id}
                label="Voz do catálogo"
              />
            ) : null}
            {voiceKey === "eleven" ? (
              <ElevenVoiceField
                value={elevenVoiceId}
                onChange={setElevenVoiceId}
                idPrefix={`eleven-${avatar.id}`}
                initiallyOpen
                hint="No ElevenLabs: Voices → escolha a voz → copie o ID."
              />
            ) : null}
            {brandVoice?.provider === "heygen" ? (
              <p className="text-xs text-muted-foreground">Vale nos vídeos de avatar HeyGen.</p>
            ) : null}
          </div>

          <PortraitStrip avatar={avatar} />

          <HeygenAvatarSection presenter={avatar} />

          <div className="space-y-1.5">
            <Label htmlFor={`retrato-${avatar.id}`}>Outro retrato</Label>
            <div className="flex gap-2">
              <Input
                id={`retrato-${avatar.id}`}
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder="Opcional: o que mudar, ex.: camisa social azul"
              />
              <Button
                type="button"
                variant="outline"
                onClick={runGenerate}
                disabled={generate.isPending || generating}
              >
                {generate.isPending || generating ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : null}
                Gerar
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              disabled={busy}
              onClick={() =>
                archive.mutate(avatar.id, {
                  onSuccess: () => {
                    toast.success(`${avatar.name} arquivado`);
                    onOpenChange(false);
                  },
                  onError: (error) =>
                    toast.error("Não foi possível arquivar", {
                      description: humanizeError(error.message),
                    }),
                })
              }
            >
              Arquivar
            </Button>
            {!avatar.is_default ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  setDefault.mutate(avatar.id, {
                    onSuccess: () => toast.success(`${avatar.name} agora é o padrão`),
                    onError: (error) =>
                      toast.error("Não foi possível definir", {
                        description: humanizeError(error.message),
                      }),
                  })
                }
              >
                Tornar padrão
              </Button>
            ) : null}
          </div>
          <Button
            onClick={save}
            disabled={
              busy ||
              (elevenChanged && !eleven.empty && !eleven.ok) ||
              (brandVoice !== null && !brandVoice.provider_voice_id)
            }
          >
            {update.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Fotos e retratos do apresentador; clicar define o principal. */
function PortraitStrip({ avatar }: { avatar: AvatarRow }) {
  const update = useUpdateAvatar();
  const pack = avatar.identity_pack_paths ?? [];
  if (pack.length < 2) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">Rosto principal</p>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {pack.map((path) => {
          const isCanonical = path === (avatar.reference_image_path ?? pack[0]);
          return (
            <button
              key={path}
              type="button"
              disabled={isCanonical || update.isPending}
              onClick={() =>
                update.mutate(
                  { avatar_id: avatar.id, reference_image_path: path },
                  {
                    onSuccess: () => toast.success("Rosto principal atualizado"),
                    onError: (error) =>
                      toast.error("Não foi possível atualizar", {
                        description: humanizeError(error.message),
                      }),
                  },
                )
              }
              className={cn(
                "w-14 shrink-0 overflow-hidden rounded-md border transition-colors",
                isCanonical ? "border-primary" : "border-border hover:border-primary/60",
              )}
              aria-label={isCanonical ? "Rosto principal" : "Definir como principal"}
            >
              <PackThumb path={path} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PackThumb({ path }: { path: string }) {
  const signed = useSignedUrl(AVATAR_BUCKET, path);
  if (!signed.data) return <Skeleton className="aspect-[3/4] w-full rounded-none" />;
  return <img src={signed.data} alt="" className="aspect-[3/4] w-full object-cover" />;
}
