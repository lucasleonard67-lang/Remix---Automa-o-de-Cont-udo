import {
  Copy,
  ExternalLink,
  FileText,
  ImageIcon,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
  UserRound,
  Video,
  Volume2,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { ElevenVoiceField } from "@/components/avatars/voice-picker";
import { BrandInline } from "@/components/brand-inline";
import { VoiceSelect } from "@/components/voices/voice-select";
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
import { ChoiceChip } from "@/components/ui/choice-chip";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  presenterPortraitPath,
  uploadPresenterPhoto,
  useAvatars,
  useCreateAvatar,
  useUpdateAvatar,
  type AvatarRow,
  type AvatarVoice,
} from "@/hooks/use-avatars";
import {
  ENGINE_LABEL,
  EngineNotDeployedError,
  HeygenNotConnectedError,
  PROMPT_AVATAR_MAX,
  PROMPT_AVATAR_REFS,
  refEngines,
  useAvatarCreateCosts,
  useHeygenBuilderEngine,
  useHeygenConsentLink,
  useHeygenDelete,
  useHeygenLookTemplates,
  useHeygenNewLook,
  useHeygenPhotoAvatar,
  useHeygenPromptAvatar,
  useHeygenStatus,
  useHeygenTwin,
  useHeygenVoicePreview,
  useHeygenVoices,
  type AvatarCreateModel,
  type HeygenEngineState,
  type HeygenRef,
} from "@/hooks/use-heygen-studio";
import { useElevenVoiceCheck, useUploadRemakeVideo } from "@/hooks/use-video-remake";
import {
  brandIdOf,
  brandValue,
  findBrandVoice,
  useBrandVoicePreview,
  useBrandVoices,
} from "@/hooks/use-voices";
import { openIntegration } from "@/lib/integration-modal";
import { avatarBuildState } from "@/lib/heygen-avatar";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { humanizeError } from "@/lib/humanize-error";

// ---------------------------------------------------------------------------
// Construtor de avatar HeyGen (docs/hub-motor-contratos.md §8, §2.1 e §3).
// Um modal só, aberto de Apresentadores e do seletor "Quem apresenta" do hub:
// uma pergunta ("Como você quer criar?"), o mínimo de cada caminho e o estado
// até ficar pronto. No fim, volta para onde a pessoa estava com o avatar
// escolhido. O Higgsfield não aparece aqui: o element nasce no primeiro uso.
// ---------------------------------------------------------------------------

export const LINK =
  "font-medium text-[var(--via-accent)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]";

/** Uma linha quando o motor não está pronto; a ação certa ao lado. */
export function EngineLine({ state, message }: { state: HeygenEngineState; message: string }) {
  if (state === "ready" || state === "checking") return null;
  return (
    <p
      className="flex flex-wrap items-center gap-x-2 text-sm text-[var(--via-coral-dark)]"
      role="status"
      data-testid="studio-motor"
    >
      {state === "not_deployed" ? "Em preparação." : message}
      {state === "not_connected" ? (
        <button type="button" className={LINK} onClick={() => openIntegration("heygen")}>
          <BrandInline name="heygen">Conectar HeyGen</BrandInline>
        </button>
      ) : null}
    </p>
  );
}

// ── peças do clone (§3), também usadas no estúdio "Meu clone" do hub ────────

const TWIN_MIN_S = 15;
const TWIN_MAX_S = 600;
const CONSENT_TTL_MS = 24 * 60 * 60 * 1000;

/** Duração do vídeo escolhido, lida no navegador antes de subir. */
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(video.duration) ? video.duration : null);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    video.src = url;
  });
}

/**
 * Sobe o vídeo (MP4, 15–600 s) e cria o clone. `ensureAvatarId` devolve o
 * apresentador: o escolhido, ou um criado na hora (só depois do upload, para
 * não sobrar cadastro vazio se o envio falhar).
 */
export function TwinUpload({
  ensureAvatarId,
  onCreated,
  disabled = false,
}: {
  ensureAvatarId: () => Promise<string>;
  onCreated: (avatarId: string) => void;
  disabled?: boolean;
}) {
  const upload = useUploadRemakeVideo();
  const twin = useHeygenTwin();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const busy = upload.isPending || twin.isPending;

  const pick = async (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file) return;
    setProblem(null);
    if (file.type !== "video/mp4") return setProblem("Envie o vídeo em MP4.");
    const seconds = await readDuration(file);
    if (seconds !== null && (seconds < TWIN_MIN_S || seconds > TWIN_MAX_S))
      return setProblem(
        `O vídeo tem ${Math.round(seconds)} s. Use de ${TWIN_MIN_S} s a 10 min (o ideal é ~2 min).`,
      );
    try {
      const path = await upload.mutateAsync(file);
      const avatarId = await ensureAvatarId();
      await twin.mutateAsync({ avatar_id: avatarId, video_path: path });
      onCreated(avatarId);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Não foi possível criar o clone.");
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-sm text-[var(--via-text-muted)]">
        ~2 min, MP4, só você olhando para a câmera, falando sem música.
      </p>
      <input
        ref={input}
        type="file"
        accept="video/mp4"
        className="sr-only"
        onChange={(e) => void pick(e.target.files?.[0])}
        data-testid="clone-arquivo"
      />
      <Button onClick={() => input.current?.click()} disabled={busy || disabled}>
        {busy ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Upload aria-hidden="true" />
        )}
        {upload.isPending ? "Enviando…" : twin.isPending ? "Criando o clone…" : "Enviar vídeo"}
      </Button>
      {problem ? <p className="text-sm text-[var(--via-coral-dark)]">{problem}</p> : null}
    </div>
  );
}

/** Estado do clone com a saída de cada trava: link, link novo ou outro vídeo. */
export function TwinStatus({
  avatarId,
  heygen,
  onReplace,
}: {
  avatarId: string;
  heygen: HeygenRef;
  onReplace: () => void;
}) {
  const relink = useHeygenConsentLink();
  const state = avatarBuildState(heygen);
  const expired =
    heygen.consent_url_at !== null && Date.now() - heygen.consent_url_at > CONSENT_TTL_MS;
  const waiting = state.kind === "consent";
  const rejected = heygen.consent_status === "rejected" && !heygen.ready;

  const copy = (url: string) =>
    void navigator.clipboard
      .writeText(url)
      .then(() => toast.success("Link copiado."))
      .catch(() => toast.error("Não foi possível copiar o link."));

  return (
    <div className="space-y-3">
      <StateLine heygen={heygen} />
      <div className="flex flex-wrap items-center gap-3">
        {waiting && heygen.consent_url && !expired && !rejected ? (
          <>
            <Button asChild size="sm">
              <a href={heygen.consent_url} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden="true" /> Abrir link
              </a>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => copy(heygen.consent_url ?? "")}>
              <Copy aria-hidden="true" /> Copiar link
            </Button>
          </>
        ) : null}
        {waiting || rejected ? (
          <Button
            variant={expired || rejected || !heygen.consent_url ? "default" : "ghost"}
            size="sm"
            disabled={relink.isPending}
            onClick={() =>
              relink.mutate({ avatar_id: avatarId }, { onError: (err) => toast.error(err.message) })
            }
          >
            {relink.isPending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw aria-hidden="true" />
            )}
            Gerar novo link
          </Button>
        ) : null}
        {heygen.status === "failed" ? (
          <Button variant="outline" size="sm" onClick={onReplace}>
            <Upload aria-hidden="true" /> Enviar outro vídeo
          </Button>
        ) : null}
      </div>
      {waiting && expired ? (
        <p className="text-xs text-[var(--via-text-muted)]">O link venceu (vale 24 h).</p>
      ) : null}
    </div>
  );
}

/** Preparo da foto do apresentador na HeyGen (§2.1), no estúdio "Minha foto". */
export function HeygenPrepLine({
  presenter,
  heygen,
  pending,
  onPrepare,
}: {
  presenter: AvatarRow;
  heygen: HeygenRef | undefined | null;
  pending: boolean;
  onPrepare: () => void;
}) {
  if (heygen?.ready)
    return (
      <p className="text-xs text-[var(--via-text-muted)]">
        {presenter.name} já está pronto na HeyGen.
      </p>
    );
  if (heygen && heygen.status !== "failed")
    return (
      <p className="flex items-center gap-2 text-xs text-[var(--via-text-muted)]" role="status">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        Preparando {presenter.name} na HeyGen…
      </p>
    );
  return (
    <div className="flex flex-wrap items-center gap-3">
      {heygen?.status === "failed" ? (
        <p className="text-xs text-[var(--via-coral-dark)]">
          {heygen.error ?? "O preparo falhou."}
        </p>
      ) : null}
      <Button variant="outline" size="sm" onClick={onPrepare} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        {heygen?.status === "failed" ? "Tentar de novo" : `Preparar ${presenter.name} na HeyGen`}
      </Button>
    </div>
  );
}

// ── estado do avatar ────────────────────────────────────────────────────────

function StateLine({ heygen }: { heygen: HeygenRef }) {
  const state = avatarBuildState(heygen);
  return (
    <p
      className={cn(
        "flex items-center gap-2 text-sm font-medium",
        state.kind === "failed" ? "text-[var(--via-coral-dark)]" : "text-[var(--via-text-primary)]",
      )}
      role="status"
      data-testid="avatar-estado"
    >
      {state.kind === "creating" || state.kind === "consent" ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      ) : null}
      {state.text}
    </p>
  );
}

function EngineBadges({ heygen }: { heygen: HeygenRef }) {
  const engines = refEngines(heygen);
  if (!engines.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Motores aceitos">
      {engines.map((engine) => (
        <Badge key={engine} variant="outline" className="font-normal">
          {ENGINE_LABEL[engine]}
        </Badge>
      ))}
    </div>
  );
}

/** Retrato 3:4 da HeyGen (a URL expira; o `heygen_status` traz outra). */
function Portrait({
  url,
  busy = false,
  className,
}: {
  url: string | null | undefined;
  busy?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative block aspect-[3/4] shrink-0 overflow-hidden rounded-[14px] border border-[var(--via-border-soft)] bg-[var(--via-navy-06)]",
        className,
      )}
    >
      {url ? (
        <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center">
          <UserRound className="size-7 text-[var(--via-text-muted)]" aria-hidden="true" />
        </span>
      )}
      {busy ? (
        <span className="absolute inset-0 flex items-center justify-center bg-[rgba(2,22,42,0.35)]">
          <Loader2 className="size-5 animate-spin text-white" aria-hidden="true" />
        </span>
      ) : null}
    </span>
  );
}

// ── o modal ─────────────────────────────────────────────────────────────────

type Path = "photo" | "twin" | "prompt";

const PATHS: {
  id: Path;
  title: string;
  hint: string;
  model: AvatarCreateModel;
  icon: ReactNode;
}[] = [
  {
    id: "photo",
    title: "Da minha foto",
    hint: "1 foto de frente",
    model: "heygen/avatar-photo",
    icon: <ImageIcon aria-hidden="true" />,
  },
  {
    id: "twin",
    title: "Do meu vídeo (clone)",
    hint: "~2 min falando para a câmera, com a sua voz",
    model: "heygen/avatar-digital-twin",
    icon: <Video aria-hidden="true" />,
  },
  {
    id: "prompt",
    title: "De uma descrição",
    hint: "um texto e, se quiser, até 3 fotos de referência",
    model: "heygen/avatar-prompt",
    icon: <FileText aria-hidden="true" />,
  },
];

const PATH_OF: Record<HeygenRef["type"], Path> = {
  photo: "photo",
  digital_twin: "twin",
  prompt: "prompt",
};

export interface AvatarBuilt {
  presenterId: string;
  /** look principal na HeyGen (o `avatar_id` do vídeo) */
  lookId: string;
}

export function AvatarBuilderDialog({
  open,
  onOpenChange,
  presenter,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** apresentador já cadastrado: o avatar nasce nele (sem pedir nome) */
  presenter?: AvatarRow | null;
  onDone?: (built: AvatarBuilt) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="avatar-builder">
        {open ? (
          <BuilderBody
            presenter={presenter ?? null}
            onClose={() => onOpenChange(false)}
            onDone={(built) => {
              onOpenChange(false);
              onDone?.(built);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function BuilderBody({
  presenter,
  onClose,
  onDone,
}: {
  presenter: AvatarRow | null;
  onClose: () => void;
  onDone: (built: AvatarBuilt) => void;
}) {
  const saved = presenter?.provider_refs?.heygen ?? null;
  const [step, setStep] = useState<"choose" | "form" | "track">(saved ? "track" : "choose");
  const [path, setPath] = useState<Path | null>(saved ? PATH_OF[saved.type] : null);
  const [presenterId, setPresenterId] = useState<string | null>(presenter?.id ?? null);
  const [prompt, setPrompt] = useState(presenter?.appearance_prompt ?? "");
  const engine = useHeygenBuilderEngine();

  return (
    <>
      <DialogHeader>
        <DialogTitle>{presenter ? `Avatar de ${presenter.name}` : "Criar avatar"}</DialogTitle>
        <DialogDescription className="sr-only">
          Crie um avatar na HeyGen da sua foto, do seu vídeo ou de uma descrição.
        </DialogDescription>
      </DialogHeader>
      {step === "choose" ? (
        <ChooseStep
          presenter={presenter}
          engine={engine}
          onPick={(next) => {
            setPath(next);
            setStep("form");
          }}
        />
      ) : null}
      {step === "form" && path ? (
        <FormStep
          path={path}
          presenter={presenter}
          presenterId={presenterId}
          engine={engine}
          prompt={prompt}
          onPrompt={setPrompt}
          onPresenter={setPresenterId}
          onBack={() => setStep("choose")}
          onStarted={(id) => {
            setPresenterId(id);
            setStep("track");
          }}
        />
      ) : null}
      {step === "track" && presenterId ? (
        <TrackStep
          presenterId={presenterId}
          fallback={saved}
          prompt={prompt}
          onRestart={(next) => {
            if (next) setPath(next);
            setStep(next ? "form" : "choose");
          }}
          onClose={onClose}
          onDone={onDone}
        />
      ) : null}
    </>
  );
}

function ChooseStep({
  presenter,
  engine,
  onPick,
}: {
  presenter: AvatarRow | null;
  engine: ReturnType<typeof useHeygenBuilderEngine>;
  onPick: (path: Path) => void;
}) {
  const costs = useAvatarCreateCosts();
  const blocked = engine.state !== "ready";
  return (
    <div className="space-y-3">
      <EngineLine {...engine} />
      <h3 className="text-sm font-medium text-[var(--via-text-primary)]">Como você quer criar?</h3>
      <ul
        className="divide-y divide-[var(--via-border-soft)] border-y border-[var(--via-border-soft)]"
        aria-label="Como você quer criar?"
      >
        {PATHS.map((item) => {
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onPick(item.id)}
                disabled={blocked}
                data-testid={`criar-${item.id}`}
                className="group flex w-full cursor-pointer items-center gap-3 py-3 text-left transition-colors hover:bg-[var(--via-navy-06)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)] disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-[var(--via-text-muted)]"
              >
                <span className="pl-2">{item.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-[var(--via-text-primary)]">
                    {item.title}
                  </span>
                  <span className="block text-xs text-[var(--via-text-muted)]">{item.hint}</span>
                </span>
                <span className="pr-2 text-xs text-[var(--via-text-muted)]">
                  {costs[item.model]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {engine.state === "checking" ? (
        <p className="text-xs text-[var(--via-text-muted)]">Conferindo a HeyGen…</p>
      ) : null}
    </div>
  );
}

/** Erro de uma criação, na língua da tela (nunca o erro cru do motor). */
function problemOf(err: unknown): { text: string; connect: boolean } {
  if (err instanceof EngineNotDeployedError) return { text: err.message, connect: false };
  if (err instanceof HeygenNotConnectedError) return { text: err.message, connect: true };
  return {
    text: err instanceof Error ? err.message : "Não foi possível criar o avatar.",
    connect: false,
  };
}

function FormStep({
  path,
  presenter,
  presenterId,
  engine,
  prompt,
  onPrompt,
  onPresenter,
  onBack,
  onStarted,
}: {
  path: Path;
  presenter: AvatarRow | null;
  presenterId: string | null;
  engine: ReturnType<typeof useHeygenBuilderEngine>;
  prompt: string;
  onPrompt: (next: string) => void;
  onPresenter: (id: string) => void;
  onBack: () => void;
  onStarted: (presenterId: string) => void;
}) {
  const costs = useAvatarCreateCosts();
  const create = useCreateAvatar();
  const photoAvatar = useHeygenPhotoAvatar();
  const promptAvatar = useHeygenPromptAvatar();
  const update = useUpdateAvatar();
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [refs, setRefs] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<{ text: string; connect: boolean } | null>(null);
  const [notDeployed, setNotDeployed] = useState(false);
  // o apresentador criado nesta abertura: um "Tentar de novo" não cria outro
  const created = useRef<string | null>(presenterId);
  // foto nova já gravada no apresentador: um "Tentar de novo" não sobe outra vez
  const photoSaved = useRef<File | null>(null);
  const hasPhoto = presenter ? Boolean(presenterPortraitPath(presenter)) : false;
  const [changePhoto, setChangePhoto] = useState(false);
  const item = PATHS.find((p) => p.id === path) ?? PATHS[0];

  const ensurePresenter = async (extra: { files?: File[]; appearance_prompt?: string }) => {
    if (created.current) return created.current;
    const { avatar } = await create.mutateAsync({ name: name.trim(), ...extra });
    created.current = avatar.id;
    onPresenter(avatar.id);
    return avatar.id;
  };

  const fail = (err: unknown) => {
    if (err instanceof EngineNotDeployedError) setNotDeployed(true);
    setProblem(problemOf(err));
  };

  const pending =
    create.isPending ||
    update.isPending ||
    photoAvatar.isPending ||
    promptAvatar.isPending ||
    uploading;
  const blocked = engine.state !== "ready" || notDeployed;
  const needsName = !presenter && !created.current;
  const nameOk = !needsName || name.trim().length > 0;

  const submitPhoto = async () => {
    setProblem(null);
    try {
      const id = await ensurePresenter(photo ? { files: [photo] } : {});
      // apresentador que já existia: a foto nova sobe e vira a principal (§8.9)
      if (presenter && photo && photoSaved.current !== photo) {
        await savePresenterPhoto(presenter.id, photo);
        photoSaved.current = photo;
      }
      await photoAvatar.mutateAsync({ avatar_id: id });
      onStarted(id);
    } catch (err) {
      fail(err);
    }
  };

  const savePresenterPhoto = async (avatarId: string, file: File) => {
    setUploading(true);
    const path = await uploadPresenterPhoto(file).finally(() => setUploading(false));
    try {
      await update.mutateAsync({ avatar_id: avatarId, reference_image_path: path });
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      throw new Error(
        /não pertence/i.test(message)
          ? "A foto não foi aceita. Escolha a foto de novo."
          : "Não foi possível salvar a foto. Tente de novo.",
      );
    }
  };

  const submitPrompt = async () => {
    setProblem(null);
    try {
      setUploading(true);
      const referencePaths = await Promise.all(refs.map(uploadPresenterPhoto)).finally(() =>
        setUploading(false),
      );
      const id = await ensurePresenter({ appearance_prompt: prompt.trim() });
      await promptAvatar.mutateAsync({
        avatar_id: id,
        prompt: prompt.trim(),
        ...(referencePaths.length ? { reference_paths: referencePaths } : {}),
        aspect_ratio: "9:16",
      });
      onStarted(id);
    } catch (err) {
      fail(err);
    }
  };

  const canSubmit =
    !blocked &&
    !pending &&
    nameOk &&
    (path === "photo"
      ? (presenter ? hasPhoto && !changePhoto : Boolean(created.current)) || photo !== null
      : path === "prompt"
        ? prompt.trim().length > 0 && prompt.length <= PROMPT_AVATAR_MAX
        : true);

  return (
    <>
      <div className="space-y-4">
        <p className="flex items-center justify-between gap-3 text-sm">
          <span className="font-medium text-[var(--via-text-primary)]">{item.title}</span>
          <button type="button" className={LINK} onClick={onBack} disabled={pending}>
            Trocar
          </button>
        </p>
        <EngineLine {...engine} />
        {needsName ? (
          <div className="space-y-1.5">
            <Label htmlFor="builder-name">Nome</Label>
            <Input
              id="builder-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Fundador"
              maxLength={32}
              autoFocus
            />
          </div>
        ) : null}

        {path === "photo" ? (
          (presenter && hasPhoto && !changePhoto) || (!presenter && created.current) ? (
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-[var(--via-text-muted)]">
              Usa a foto principal{presenter ? ` de ${presenter.name}` : ""}.
              {presenter ? (
                <button
                  type="button"
                  className={LINK}
                  onClick={() => setChangePhoto(true)}
                  disabled={pending}
                >
                  Usar outra foto
                </button>
              ) : null}
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="builder-photo">Foto de frente</Label>
              <Input
                id="builder-photo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                className="text-xs"
              />
              <p className="text-xs text-[var(--via-text-muted)]">
                Boa luz, olhando para a câmera e só você na foto.
              </p>
            </div>
          )
        ) : null}

        {path === "prompt" ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="builder-prompt">Descrição</Label>
              <Textarea
                id="builder-prompt"
                rows={4}
                value={prompt}
                onChange={(e) => onPrompt(e.target.value.slice(0, PROMPT_AVATAR_MAX))}
                placeholder="Ex.: mulher de 30 e poucos anos, cabelo cacheado, blazer bege, escritório claro"
              />
              <p className="text-xs text-[var(--via-text-muted)]">
                {prompt.length.toLocaleString("pt-BR")} /{" "}
                {PROMPT_AVATAR_MAX.toLocaleString("pt-BR")}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="builder-refs">
                Fotos de referência (opcional, até {PROMPT_AVATAR_REFS})
              </Label>
              <Input
                id="builder-refs"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={(e) =>
                  setRefs(Array.from(e.target.files ?? []).slice(0, PROMPT_AVATAR_REFS))
                }
                className="text-xs"
              />
            </div>
          </>
        ) : null}

        {path === "twin" ? (
          <TwinUpload
            disabled={blocked || !nameOk}
            ensureAvatarId={() => ensurePresenter({})}
            onCreated={onStarted}
          />
        ) : null}

        {problem ? (
          <p
            className="flex flex-wrap items-center gap-x-2 text-sm text-[var(--via-coral-dark)]"
            role="alert"
          >
            {problem.text}
            {problem.connect ? (
              <button type="button" className={LINK} onClick={() => openIntegration("heygen")}>
                <BrandInline name="heygen">Conectar HeyGen</BrandInline>
              </button>
            ) : null}
          </p>
        ) : null}
      </div>

      {path !== "twin" ? (
        <DialogFooter className="items-center gap-3 sm:justify-between">
          <span className="text-xs text-[var(--via-text-muted)]">HeyGen · {costs[item.model]}</span>
          <Button
            onClick={() => void (path === "photo" ? submitPhoto() : submitPrompt())}
            disabled={!canSubmit}
            data-testid="criar-avatar"
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {problem && !notDeployed ? "Tentar de novo" : "Criar avatar"}
          </Button>
        </DialogFooter>
      ) : (
        <p className="text-xs text-[var(--via-text-muted)]">HeyGen · {costs[item.model]}</p>
      )}
    </>
  );
}

function TrackStep({
  presenterId,
  fallback,
  prompt,
  onRestart,
  onClose,
  onDone,
}: {
  presenterId: string;
  fallback: HeygenRef | null;
  prompt: string;
  onRestart: (path: Path | null) => void;
  onClose: () => void;
  onDone: (built: AvatarBuilt) => void;
}) {
  const status = useHeygenStatus(presenterId, true);
  const presenters = useAvatars("active");
  const presenter = (presenters.data ?? []).find((p) => p.id === presenterId) ?? null;
  const heygen = status.data !== undefined ? status.data : fallback;
  const retryPhoto = useHeygenPhotoAvatar();
  const regenerate = useHeygenPromptAvatar();
  const update = useUpdateAvatar();
  const [voice, setVoice] = useState<NonNullable<AvatarVoice["heygen_voice"]> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  if (!heygen) {
    return status.isPending ? (
      <p className="flex items-center gap-2 text-sm text-[var(--via-text-muted)]">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Conferindo a HeyGen…
      </p>
    ) : (
      <>
        <p className="text-sm text-[var(--via-text-muted)]">
          {status.isError ? status.error.message : "Este apresentador ainda não tem avatar."}
        </p>
        <DialogFooter>
          <Button onClick={() => onRestart(null)}>Criar avatar</Button>
        </DialogFooter>
      </>
    );
  }

  const state = avatarBuildState(heygen);
  const path = PATH_OF[heygen.type];
  const current = voice ?? defaultVoice(presenter, heygen);

  const runRegenerate = async () => {
    setProblem(null);
    try {
      // o motor apaga o avatar e cria outro com o que salvou; só a descrição mudada vai junto
      const changed = prompt.trim() && prompt.trim() !== presenter?.appearance_prompt?.trim();
      await regenerate.mutateAsync({
        avatar_id: presenterId,
        regenerate: true,
        ...(changed ? { prompt: prompt.trim() } : {}),
      });
    } catch (err) {
      setProblem(problemOf(err).text);
    }
  };

  const retry = () => {
    setProblem(null);
    if (path === "photo")
      retryPhoto.mutate(
        { avatar_id: presenterId },
        { onError: (err) => setProblem(problemOf(err).text) },
      );
    else if (path === "prompt")
      regenerate.mutate(
        {
          avatar_id: presenterId,
          ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
          aspect_ratio: "9:16",
        },
        { onError: (err) => setProblem(problemOf(err).text) },
      );
  };

  const finish = () => {
    setProblem(null);
    update.mutate(
      {
        avatar_id: presenterId,
        heygen_voice: current,
        ...(current.provider === "elevenlabs" && current.voice_id
          ? { elevenlabs_voice_id: current.voice_id }
          : {}),
      },
      {
        onSuccess: () => {
          toast.success(`${presenter?.name ?? "O avatar"} está pronto para os vídeos`);
          onDone({ presenterId, lookId: heygen.look_id });
        },
        onError: (err) => setProblem(err.message),
      },
    );
  };

  const busy = retryPhoto.isPending || regenerate.isPending;

  return (
    <>
      <div className="flex gap-4">
        <Portrait
          url={heygen.preview_image_url}
          busy={state.kind === "creating" || busy}
          className="w-28"
        />
        <div className="min-w-0 flex-1 space-y-3">
          {heygen.type === "digital_twin" && state.kind !== "ready" ? (
            <TwinStatus
              avatarId={presenterId}
              heygen={heygen}
              onReplace={() => onRestart("twin")}
            />
          ) : (
            <StateLine heygen={heygen} />
          )}
          {state.kind === "creating" ? (
            <p className="text-xs text-[var(--via-text-muted)]">
              Leva alguns minutos. Pode fechar: continua sozinho.
            </p>
          ) : null}
          {state.kind === "ready" ? <EngineBadges heygen={heygen} /> : null}
          {state.kind === "failed" && heygen.type !== "digital_twin" ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={retry} disabled={busy}>
                {busy ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw aria-hidden="true" />
                )}
                Tentar de novo
              </Button>
              {path === "prompt" ? (
                <Button variant="ghost" size="sm" onClick={() => onRestart("prompt")}>
                  Mudar a descrição
                </Button>
              ) : null}
            </div>
          ) : null}
          {state.kind === "ready" && path === "prompt" ? (
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2"
              onClick={() => void runRegenerate()}
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw aria-hidden="true" />
              )}
              Gerar de novo
            </Button>
          ) : null}
        </div>
      </div>

      {state.kind === "ready" ? (
        <VoiceChoice
          presenterId={presenterId}
          twin={heygen.type === "digital_twin"}
          value={current}
          onChange={setVoice}
        />
      ) : null}

      {problem ? (
        <p className="text-sm text-[var(--via-coral-dark)]" role="alert">
          {problem}
        </p>
      ) : null}

      <DialogFooter>
        {state.kind === "ready" ? (
          <UseAvatarButton voice={current} pending={update.isPending} onClick={finish} />
        ) : (
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

function UseAvatarButton({
  voice,
  pending,
  onClick,
}: {
  voice: NonNullable<AvatarVoice["heygen_voice"]>;
  pending: boolean;
  onClick: () => void;
}) {
  const eleven = useElevenVoiceCheck(voice.provider === "elevenlabs" ? (voice.voice_id ?? "") : "");
  const voiceOk =
    voice.provider === "twin" ||
    (voice.provider === "heygen" && Boolean(voice.voice_id)) ||
    (voice.provider === "elevenlabs" && eleven.ok);
  return (
    <Button onClick={onClick} disabled={!voiceOk || pending} data-testid="usar-avatar">
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
      Usar este avatar
    </Button>
  );
}

/** Voz salva antes; senão a do clone (twin), a do ElevenLabs do cadastro ou a padrão da HeyGen. */
function defaultVoice(
  presenter: AvatarRow | null,
  heygen: HeygenRef,
): NonNullable<AvatarVoice["heygen_voice"]> {
  const saved = presenter?.voice?.heygen_voice;
  if (saved && (saved.provider !== "twin" || heygen.type === "digital_twin")) return saved;
  if (heygen.type === "digital_twin") return { provider: "twin" };
  const eleven = presenter?.voice?.elevenlabs_voice_id;
  if (eleven) return { provider: "elevenlabs", voice_id: eleven };
  return {
    provider: "heygen",
    ...(heygen.default_voice_id ? { voice_id: heygen.default_voice_id } : {}),
  };
}

function VoiceChoice({
  presenterId,
  twin,
  value,
  onChange,
}: {
  presenterId: string;
  twin: boolean;
  value: NonNullable<AvatarVoice["heygen_voice"]>;
  onChange: (next: NonNullable<AvatarVoice["heygen_voice"]>) => void;
}) {
  const brandVoices = useBrandVoices();
  const presenters = useAvatars("active");
  const presenterName = (presenters.data ?? []).find((p) => p.id === presenterId)?.name;
  // a escolha no seletor: uma opção (twin/elevenlabs/heygen) ou uma voz da marca
  const [mode, setMode] = useState<string | null>(null);
  const match = findBrandVoice(brandVoices.data ?? [], value.provider, value.voice_id);
  const key = mode ?? (match ? brandValue(match.id) : value.provider);
  const brand = (brandVoices.data ?? []).find((v) => v.id === brandIdOf(key)) ?? null;
  const voices = useHeygenVoices(key === "heygen");
  const preview = useHeygenVoicePreview();
  const brandPreview = useBrandVoicePreview();
  const [audio, setAudio] = useState<string | null>(null);
  const [previewProblem, setPreviewProblem] = useState<string | null>(null);
  const eleven = useElevenVoiceCheck(value.provider === "elevenlabs" ? (value.voice_id ?? "") : "");
  const canListen =
    brand !== null ||
    value.provider === "twin" ||
    (value.provider === "heygen" && Boolean(value.voice_id)) ||
    (value.provider === "elevenlabs" && eleven.ok);

  const pick = (next: NonNullable<AvatarVoice["heygen_voice"]>) => {
    setAudio(null);
    setPreviewProblem(null);
    onChange(next);
  };

  const listen = () => {
    setPreviewProblem(null);
    if (brand) {
      brandPreview.mutate(
        { brand_voice_id: brand.id, avatar_id: presenterId },
        {
          onSuccess: (result) => setAudio(result.url),
          onError: (err) => setPreviewProblem(err.message),
        },
      );
      return;
    }
    preview.mutate(
      {
        voice: {
          provider: value.provider,
          ...(value.voice_id ? { voice_id: value.voice_id } : {}),
        },
        avatar_id: presenterId,
      },
      {
        onSuccess: (result) => setAudio(result.url),
        onError: (err) =>
          setPreviewProblem(
            value.provider === "twin" && !(err instanceof EngineNotDeployedError)
              ? "Não deu para gerar a amostra da voz do clone. A HeyGen ainda não confirmou o teste dessa voz por aqui."
              : err.message,
          ),
      },
    );
  };

  return (
    <section className="space-y-3 border-t border-[var(--via-border-soft)] pt-4" aria-label="Voz">
      <h3 className="text-sm font-medium text-[var(--via-text-primary)]">Voz</h3>
      <VoiceSelect
        value={key}
        onChange={(next, voice) => {
          setMode(next);
          if (voice && voice.provider_voice_id)
            pick({ provider: voice.provider, voice_id: voice.provider_voice_id });
          else if (next === "twin" || next === "elevenlabs" || next === "heygen")
            pick({ provider: next });
        }}
        options={[
          ...(twin ? [{ value: "twin", label: "A do clone" }] : []),
          { value: "elevenlabs", label: "ElevenLabs (Voice ID)" },
          { value: "heygen", label: "HeyGen (catálogo)" },
        ]}
        unusable={(v) => (v.provider_voice_id ? null : "criando…")}
        presenterName={presenterName}
        avatarId={presenterId}
        listen={false}
      />

      {key === "elevenlabs" ? (
        <ElevenVoiceField
          value={value.voice_id ?? ""}
          onChange={(id) => pick({ provider: "elevenlabs", voice_id: id })}
          idPrefix={`builder-${presenterId}`}
          initiallyOpen
          hint="No ElevenLabs: Voices → escolha a voz → copie o ID."
        />
      ) : null}

      <div className="flex gap-2">
        {key === "heygen" ? (
          <Select
            value={value.voice_id}
            onValueChange={(id) => pick({ provider: "heygen", voice_id: id })}
          >
            <SelectTrigger className="flex-1" aria-label="Voz da HeyGen">
              <SelectValue
                placeholder={
                  voices.isPending
                    ? "Carregando vozes…"
                    : voices.isError
                      ? voices.error.message
                      : "Escolha a voz"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {(voices.data?.voices ?? []).map((v) => (
                <SelectItem key={v.voice_id} value={v.voice_id}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Button
          type="button"
          variant="outline"
          onClick={listen}
          disabled={!canListen || preview.isPending || brandPreview.isPending}
        >
          {preview.isPending || brandPreview.isPending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Volume2 aria-hidden="true" />
          )}
          Ouvir
        </Button>
      </div>
      {audio ? <audio controls autoPlay src={audio} className="w-full" /> : null}
      {previewProblem ? (
        <p className="text-xs text-[var(--via-coral-dark)]">{previewProblem}</p>
      ) : null}
    </section>
  );
}

// ── no editor do apresentador: estado, novos visuais e apagar ───────────────

export function HeygenAvatarSection({ presenter }: { presenter: AvatarRow }) {
  const engine = useHeygenBuilderEngine();
  const saved = presenter.provider_refs?.heygen ?? null;
  const status = useHeygenStatus(presenter.id, Boolean(saved) && engine.state === "ready");
  const heygen = status.data !== undefined ? status.data : saved;
  const [building, setBuilding] = useState(false);
  const state = heygen ? avatarBuildState(heygen) : null;

  return (
    <section className="space-y-3" aria-labelledby={`heygen-${presenter.id}`}>
      <h3 id={`heygen-${presenter.id}`} className="text-sm font-medium">
        Avatar HeyGen
      </h3>
      <EngineLine {...engine} />
      {!heygen ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[var(--via-text-muted)]">Ainda sem avatar na HeyGen.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBuilding(true)}
            disabled={engine.state !== "ready"}
          >
            Criar avatar
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <StateLine heygen={heygen} />
            <Button variant="ghost" size="sm" onClick={() => setBuilding(true)}>
              {state?.kind === "ready" ? "Voz" : "Abrir"}
            </Button>
          </div>
          {state?.kind === "ready" ? (
            <>
              <EngineBadges heygen={heygen} />
              <LooksGallery heygen={heygen} />
              <NewLookForm presenterId={presenter.id} disabled={engine.state !== "ready"} />
            </>
          ) : null}
          <DeleteHeygenAvatar presenter={presenter} heygen={heygen} />
        </>
      )}
      <AvatarBuilderDialog
        open={building}
        onOpenChange={setBuilding}
        presenter={{
          ...presenter,
          provider_refs: { ...presenter.provider_refs, heygen: heygen ?? undefined },
        }}
      />
    </section>
  );
}

/** O visual principal e os novos (§8.4), num trilho curto. */
function LooksGallery({ heygen }: { heygen: HeygenRef }) {
  const looks = heygen.looks ?? [];
  return (
    <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Visuais">
      <li>
        <Portrait url={heygen.preview_image_url} className="w-14" />
      </li>
      {looks.map((look) => (
        <li key={look.id} className="relative">
          <Portrait
            url={look.preview_image_url}
            busy={look.status === "processing"}
            className="w-14"
          />
          {look.status === "failed" ? (
            <span className="absolute inset-x-0 bottom-0 rounded-b-[14px] bg-[var(--via-coral-dark)] py-0.5 text-center text-xs font-medium text-white">
              Falhou
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function NewLookForm({ presenterId, disabled }: { presenterId: string; disabled: boolean }) {
  const costs = useAvatarCreateCosts();
  const newLook = useHeygenNewLook();
  const [mode, setMode] = useState<"prompt" | "pack">("prompt");
  const [text, setText] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const templates = useHeygenLookTemplates(mode === "pack" && !disabled);
  const list = templates.data?.templates ?? [];
  const chosen = list.find((t) => t.id === templateId) ?? null;

  const submit = () => {
    const input =
      mode === "prompt"
        ? {
            avatar_id: presenterId,
            mode: "prompt" as const,
            prompt: text.trim(),
            aspect_ratio: "9:16" as const,
          }
        : chosen
          ? {
              avatar_id: presenterId,
              mode: chosen.type,
              template_id: chosen.id,
              aspect_ratio: "9:16" as const,
            }
          : null;
    if (!input) return;
    newLook.mutate(input, {
      onSuccess: () => {
        setText("");
        setTemplateId(null);
        toast.success("Visual novo a caminho", { description: "Leva alguns minutos." });
      },
      onError: (err) => toast.error(problemOf(err).text),
    });
  };

  const ready =
    !disabled &&
    !newLook.isPending &&
    (mode === "prompt"
      ? text.trim().length > 0 && text.length <= PROMPT_AVATAR_MAX
      : chosen !== null);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Novo visual">
        <span className="text-sm font-medium">Novo visual</span>
        <ChoiceChip selected={mode === "prompt"} onClick={() => setMode("prompt")}>
          Por texto
        </ChoiceChip>
        <ChoiceChip selected={mode === "pack"} onClick={() => setMode("pack")}>
          Por pacote
        </ChoiceChip>
      </div>
      {mode === "prompt" ? (
        <Input
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, PROMPT_AVATAR_MAX))}
          placeholder="Ex.: camisa social azul, fundo de estúdio"
          aria-label="Descreva o visual"
          disabled={disabled}
        />
      ) : templates.isPending ? (
        <p className="text-xs text-[var(--via-text-muted)]">Carregando pacotes…</p>
      ) : templates.isError ? (
        <p className="text-xs text-[var(--via-coral-dark)]">
          {humanizeError(templates.error.message)}
        </p>
      ) : list.length === 0 ? (
        <p className="text-xs text-[var(--via-text-muted)]">Nenhum pacote disponível.</p>
      ) : (
        <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Pacotes">
          {list.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setTemplateId(t.id)}
                aria-pressed={templateId === t.id}
                title={t.name}
                className={cn(
                  "block w-14 cursor-pointer rounded-[14px] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]",
                  templateId === t.id && "via-selected",
                )}
              >
                <Portrait url={t.preview_image_url} className="w-14" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-[var(--via-text-muted)]">
          {chosen ? `${chosen.name} · ` : ""}
          {costs["heygen/avatar-look"]}
        </span>
        <Button variant="outline" size="sm" onClick={submit} disabled={!ready}>
          {newLook.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Criar visual
        </Button>
      </div>
    </div>
  );
}

function DeleteHeygenAvatar({ presenter, heygen }: { presenter: AvatarRow; heygen: HeygenRef }) {
  const remove = useHeygenDelete();
  const [confirming, setConfirming] = useState(false);
  const twin = heygen.type === "digital_twin";
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 text-muted-foreground hover:text-destructive"
        onClick={() => setConfirming(true)}
        disabled={remove.isPending}
      >
        {remove.isPending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Trash2 aria-hidden="true" />
        )}
        Apagar avatar
      </Button>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar o avatar na HeyGen?</AlertDialogTitle>
            <AlertDialogDescription>
              O avatar e os visuais saem da HeyGen
              {twin ? ", junto com a voz clonada" : ""}. {presenter.name} continua no app, com as
              fotos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                remove.mutate(
                  { avatar_id: presenter.id },
                  {
                    onSuccess: () => toast.success("Avatar apagado na HeyGen"),
                    onError: (err) => toast.error(problemOf(err).text),
                  },
                )
              }
            >
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
