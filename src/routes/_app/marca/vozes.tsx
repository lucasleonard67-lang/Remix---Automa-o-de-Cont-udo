import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Mic, Plus, Star, Trash2 } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { VoiceBuilderDialog } from "@/components/voices/voice-builder";
import { ListenButton } from "@/components/voices/voice-select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ElevenVoiceField } from "@/components/avatars/voice-picker";
import { useSecretStatus } from "@/hooks/use-app-settings";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useElevenVoiceCheck } from "@/hooks/use-video-remake";
import {
  providerNote,
  SOURCE_LABEL,
  useBrandVoices,
  useDeleteVoice,
  useSetDefaultVoice,
  useVoiceImport,
  useVoiceOptions,
  useVoiceStatus,
  type BrandVoice,
} from "@/hooks/use-voices";
import { toast } from "@/lib/toast";

export const Route = createFileRoute("/_app/marca/vozes")({
  component: VoicesPage,
});

// ---------------------------------------------------------------------------
// Marca → Vozes (docs/construtor-de-voz.md §3.2): a lista de vozes da marca,
// uma delas a padrão dos vídeos. Criar abre o construtor de voz.
// ---------------------------------------------------------------------------

function VoicesPage() {
  const { isAdmin } = useIsAdmin();
  const voices = useBrandVoices();
  const engine = useVoiceOptions(isAdmin);
  const [creating, setCreating] = useState(false);
  const list = voices.data ?? [];
  const deployed = engine.state === "ready";
  // o ELEVEN_VOICE_ID de Ajustes → Integrações ainda não é uma linha de brand_voices
  const secrets = useSecretStatus();
  const configured =
    (secrets.data?.includes("ELEVEN_VOICE_ID") ?? false) &&
    !list.some((v) => v.provider === "elevenlabs" && v.is_default);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Vozes" description="Quem narra os vídeos.">
        {isAdmin ? (
          <Button onClick={() => setCreating(true)} data-testid="criar-voz-abrir">
            <Plus aria-hidden="true" />
            Criar voz
          </Button>
        ) : null}
      </PageHeader>

      {isAdmin && engine.state === "not_deployed" ? (
        <p className="text-sm text-[var(--via-coral-dark)]" role="status">
          {engine.message}
        </p>
      ) : null}

      {voices.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : list.length === 0 && !configured ? (
        <EmptyState
          icon={Mic}
          title="Nenhuma voz ainda"
          description="Sem voz da marca, os vídeos usam a voz do ElevenLabs configurada nas integrações."
        />
      ) : (
        <ul
          className="divide-y divide-[var(--via-border-soft)] border-y border-[var(--via-border-soft)]"
          aria-label="Vozes da marca"
        >
          {configured ? <ConfiguredVoiceRow admin={isAdmin} deployed={deployed} /> : null}
          {list.map((voice) => (
            <VoiceRow key={voice.id} voice={voice} admin={isAdmin} deployed={deployed} />
          ))}
        </ul>
      )}

      <VoiceBuilderDialog open={creating} onOpenChange={setCreating} allowDefault />
    </div>
  );
}

function VoiceRow({
  voice: saved,
  admin,
  deployed,
}: {
  voice: BrandVoice;
  admin: boolean;
  deployed: boolean;
}) {
  // um clone HeyGen que ainda está sendo criado é conferido aqui também (§9.4)
  const status = useVoiceStatus(saved.id, deployed && saved.status === "processing");
  const voice = status.data ?? saved;
  const setDefault = useSetDefaultVoice();
  const remove = useDeleteVoice();
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3" data-testid="voz-linha">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--via-text-primary)]">
          {voice.name}
          {voice.is_default ? <Badge className="font-medium">Padrão</Badge> : null}
        </p>
        <p className="text-xs text-[var(--via-text-muted)]">
          {voice.status === "processing" ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" aria-hidden="true" /> Criando…
            </span>
          ) : voice.status === "failed" ? (
            <span className="text-[var(--via-coral-dark)]">
              {voice.error ?? "Não deu para criar a voz."}
            </span>
          ) : (
            `${SOURCE_LABEL[voice.source]} · ${providerNote(voice)}`
          )}
        </p>
      </div>
      <div className="flex items-center gap-1">
        {voice.status === "ready" ? <ListenButton voice={{ voice }} size="sm" /> : null}
        {admin && voice.status === "ready" && !voice.is_default ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={!deployed || setDefault.isPending}
            onClick={() =>
              setDefault.mutate(
                { voice_id: voice.id },
                {
                  onSuccess: (result) =>
                    toast.success(`${voice.name} é a voz padrão`, {
                      ...(voice.provider === "elevenlabs" && result.eleven_voice_id_synced === false
                        ? {
                            description:
                              "Não deu para atualizar o ID da voz em Integrações. A padrão vale assim mesmo.",
                          }
                        : {}),
                    }),
                  onError: (err) => toast.error(err.message),
                },
              )
            }
          >
            {setDefault.isPending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Star aria-hidden="true" />
            )}
            Usar como padrão
          </Button>
        ) : null}
        {admin ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            aria-label={`Apagar ${voice.name}`}
            disabled={!deployed || remove.isPending}
            onClick={() => setConfirming(true)}
          >
            {remove.isPending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 aria-hidden="true" />
            )}
          </Button>
        ) : null}
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar {voice.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {voice.owned
                ? "A voz sai do app e da conta do provedor."
                : "A voz sai do app. Na conta do provedor ela continua."}
              {voice.is_default ? " Ela é a voz padrão: escolha outra antes." : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={voice.is_default}
              onClick={() =>
                remove.mutate(
                  { voice_id: voice.id },
                  {
                    onSuccess: () => toast.success("Voz apagada"),
                    onError: (err) => toast.error(err.message),
                  },
                )
              }
            >
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

/**
 * A voz que a narração usa hoje (`ELEVEN_VOICE_ID`). O valor fica no Vault e
 * não volta para a tela: "Salvar em Vozes" pede o mesmo Voice ID e chama
 * `voice_import`.
 */
function ConfiguredVoiceRow({ admin, deployed }: { admin: boolean; deployed: boolean }) {
  const [open, setOpen] = useState(false);
  const [voiceId, setVoiceId] = useState("");
  const check = useElevenVoiceCheck(voiceId);
  const importVoice = useVoiceImport();

  const save = () =>
    importVoice.mutate(
      {
        voice_id: voiceId.trim(),
        ...(check.lookup.data?.name ? { name: check.lookup.data.name } : {}),
      },
      {
        onSuccess: (voice) => {
          toast.success(`${voice.name} está em Vozes`);
          setOpen(false);
          setVoiceId("");
        },
        onError: (err) => toast.error(err.message),
      },
    );

  return (
    <li className="space-y-3 py-3" data-testid="voz-configurada">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--via-text-primary)]">
            Voz atual (configurada)
          </p>
          <p className="text-xs text-[var(--via-text-muted)]">
            ElevenLabs · Ajustes → Integrações. A narração usa esta enquanto não houver uma padrão.
          </p>
        </div>
        {admin && !open ? (
          <Button variant="outline" size="sm" disabled={!deployed} onClick={() => setOpen(true)}>
            Salvar em Vozes
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className="space-y-2">
          <ElevenVoiceField
            value={voiceId}
            onChange={setVoiceId}
            idPrefix="voz-configurada"
            initiallyOpen
            hint="Cole o mesmo ID salvo em Integrações (ElevenLabs: Voices → copie o ID)."
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={!check.ok || importVoice.isPending}>
              {importVoice.isPending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : null}
              Salvar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
