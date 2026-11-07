import { useNavigate } from "@tanstack/react-router";
import { FileText, Library, Loader2, Mic, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ElevenVoiceField } from "@/components/avatars/voice-picker";
import { BrandText } from "@/components/brand-inline";
import { ListenButton } from "@/components/voices/voice-select";
import { VoiceRecorder, type VoiceSample } from "@/components/voices/voice-recorder";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import { EngineNotDeployedError } from "@/hooks/use-heygen-studio";
import { useElevenVoiceCheck } from "@/hooks/use-video-remake";
import {
  providerNote,
  useSetDefaultVoice,
  useUploadVoiceSample,
  useVoiceClone,
  useVoiceCreateCosts,
  useVoiceDesign,
  useVoiceDesignSave,
  useVoiceImport,
  useVoiceLibrary,
  useVoiceLibraryAdd,
  useVoiceOptions,
  useVoiceStatus,
  VoiceActionError,
  type BrandVoice,
  type LibraryVoice,
  type VoiceDesignPreview,
  type VoiceOptions,
  type VoicePathId,
} from "@/hooks/use-voices";
import { openIntegration } from "@/lib/integration-modal";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { humanizeError } from "@/lib/humanize-error";

// ---------------------------------------------------------------------------
// Construtor de voz (docs/construtor-de-voz.md §4, contrato em
// docs/hub-motor-contratos.md §9). Um modal só, como o construtor de avatar:
// uma pergunta ("De onde vem a voz?"), o mínimo de cada caminho e o estado
// até ficar pronta. No fim, `onDone(voice)` devolve a voz para quem abriu.
// O servidor escolhe o provedor; ele só aparece numa nota depois de criar.
// ---------------------------------------------------------------------------

const LINK =
  "font-medium text-[var(--via-accent)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)] disabled:cursor-not-allowed disabled:opacity-60";

const DESCRIPTION_MIN = 20;
const DESCRIPTION_MAX = 1000;
const NAME_MAX = 60;
const POLL_LIMIT_MS = 2 * 60_000;

type CreatePath = "own" | "describe" | "library";
type Step = CreatePath | "paste" | "choose" | "track";

const PATHS: { id: CreatePath; title: string; hint: string; icon: ReactNode }[] = [
  {
    id: "own",
    title: "Da minha voz",
    hint: "Grave 1 min ou suba um áudio",
    icon: <Mic aria-hidden="true" />,
  },
  {
    id: "describe",
    title: "De uma descrição",
    hint: "Ex.: mulher, 30 anos, calma, sotaque paulista",
    icon: <FileText aria-hidden="true" />,
  },
  {
    id: "library",
    title: "Da biblioteca",
    hint: "Vozes prontas em português",
    icon: <Library aria-hidden="true" />,
  },
];

export function VoiceBuilderDialog({
  open,
  onOpenChange,
  onDone,
  presenterName,
  avatarId,
  allowDefault = false,
  prefer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: (voice: BrandVoice) => void;
  /** nome sugerido (o do apresentador) */
  presenterName?: string;
  /** o clone nasce ligado a este apresentador */
  avatarId?: string;
  /** mostra "Usar como voz padrão" no fim (só em Marca → Vozes) */
  allowDefault?: boolean;
  /** fluxo HeyGen: o clone nasce na HeyGen quando ela está conectada */
  prefer?: "heygen";
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="voice-builder">
        {open ? (
          <BuilderBody
            presenterName={presenterName}
            avatarId={avatarId}
            allowDefault={allowDefault}
            prefer={prefer}
            onClose={() => onOpenChange(false)}
            onDone={(voice) => {
              onOpenChange(false);
              onDone?.(voice);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function BuilderBody({
  presenterName,
  avatarId,
  allowDefault,
  prefer,
  onClose,
  onDone,
}: {
  presenterName?: string;
  avatarId?: string;
  allowDefault: boolean;
  prefer?: "heygen";
  onClose: () => void;
  onDone: (voice: BrandVoice) => void;
}) {
  const [step, setStep] = useState<Step>("choose");
  const [created, setCreated] = useState<BrandVoice | null>(null);
  const engine = useVoiceOptions(true, prefer);
  const back = () => setStep("choose");
  const started = (voice: BrandVoice) => {
    setCreated(voice);
    setStep("track");
  };
  const ctx: StepContext = {
    options: engine.options,
    presenterName,
    avatarId,
    prefer,
    onBack: back,
    onCreated: started,
    onClose,
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Criar voz</DialogTitle>
        <DialogDescription className="sr-only">
          Crie uma voz da sua gravação, de uma descrição ou da biblioteca.
        </DialogDescription>
      </DialogHeader>
      {step === "choose" ? <ChooseStep engine={engine} onPick={setStep} ctx={ctx} /> : null}
      {step === "own" ? <OwnStep ctx={ctx} /> : null}
      {step === "describe" ? <DescribeStep ctx={ctx} /> : null}
      {step === "library" ? <LibraryStep ctx={ctx} /> : null}
      {step === "paste" ? <PasteStep ctx={ctx} /> : null}
      {step === "track" && created ? (
        <TrackStep
          voice={created}
          allowDefault={allowDefault}
          avatarId={avatarId}
          onRestart={(next) => setStep(next)}
          onClose={onClose}
          onDone={onDone}
        />
      ) : null}
    </>
  );
}

interface StepContext {
  options: VoiceOptions | null;
  presenterName?: string;
  avatarId?: string;
  prefer?: "heygen";
  onBack: () => void;
  onCreated: (voice: BrandVoice) => void;
  onClose: () => void;
}

// ── saídas de cada trava ────────────────────────────────────────────────────

type Exit = { label: string; run: () => void };

function useManageVoices(onClose: () => void) {
  const navigate = useNavigate();
  return () => {
    onClose();
    void navigate({ to: "/marca/vozes" });
  };
}

/** As saídas de um caminho bloqueado, pelo estado dos provedores. */
function exitsFor(path: VoicePathId, options: VoiceOptions | null, manage: () => void): Exit[] {
  if (!options) return [];
  const eleven = { label: "Conectar ElevenLabs", run: () => openIntegration("elevenlabs") };
  const heygen = { label: "Conectar HeyGen", run: () => openIntegration("heygen") };
  const { eleven: e, heygen: h } = options;
  if (!e.connected && !h.connected) return path === "paste" ? [eleven] : [eleven, heygen];
  if (path === "paste") return e.connected ? [] : [eleven];
  const full = e.slot_limit !== null && e.slots_used !== null && e.slots_used >= e.slot_limit;
  const exits: Exit[] = [];
  if (path === "own" && full) exits.push({ label: "Apagar uma voz", run: manage });
  if (!h.connected) exits.push(heygen);
  if (!e.connected) exits.push(eleven);
  return exits;
}

function ExitLinks({ exits }: { exits: Exit[] }) {
  if (!exits.length) return null;
  return (
    <>
      {exits.map((exit) => (
        <button key={exit.label} type="button" className={LINK} onClick={exit.run}>
          <BrandText text={exit.label} />
        </button>
      ))}
    </>
  );
}

/** Erro de uma ação, na língua da tela, com a saída certa ao lado (§4.3). */
function ProblemLine({
  error,
  ctx,
  onRetryPath,
}: {
  error: unknown;
  ctx: StepContext;
  /** "Gravar de novo" quando o áudio foi recusado */
  onRetryPath?: () => void;
}) {
  const manage = useManageVoices(ctx.onClose);
  if (!error) return null;
  const text = error instanceof Error ? error.message : "Não deu certo. Tente de novo.";
  const exits: Exit[] = [];
  if (error instanceof VoiceActionError) {
    const missingEleven = !ctx.options?.eleven.connected;
    const missingHeygen = !ctx.options?.heygen.connected;
    if (error.code === "not_connected" || error.status === 412) {
      if (missingEleven)
        exits.push({ label: "Conectar ElevenLabs", run: () => openIntegration("elevenlabs") });
      if (missingHeygen)
        exits.push({ label: "Conectar HeyGen", run: () => openIntegration("heygen") });
    } else if (error.code === "slots_full") {
      exits.push({ label: "Apagar uma voz", run: manage });
      if (missingHeygen)
        exits.push({ label: "Conectar HeyGen", run: () => openIntegration("heygen") });
    } else if (error.status === 402) {
      const heygen = /heygen/i.test(text);
      exits.push({
        label: "Abrir o painel",
        run: () =>
          window.open(
            heygen ? "https://app.heygen.com/" : "https://elevenlabs.io/app/subscription",
            "_blank",
            "noreferrer",
          ),
      });
    } else if (error.code === "daily_limit" || error.status === 429) {
      exits.push({ label: "Escolher outro caminho", run: ctx.onBack });
    } else if (/áudio/i.test(text) && onRetryPath) {
      exits.push({ label: "Gravar de novo", run: onRetryPath });
    }
  }
  return (
    <p
      className="flex flex-wrap items-center gap-x-2 text-sm text-[var(--via-coral-dark)]"
      role="alert"
    >
      {text}
      <ExitLinks exits={exits} />
    </p>
  );
}

// ── escolher ────────────────────────────────────────────────────────────────

function ChooseStep({
  engine,
  onPick,
  ctx,
}: {
  engine: ReturnType<typeof useVoiceOptions>;
  onPick: (step: Step) => void;
  ctx: StepContext;
}) {
  const costs = useVoiceCreateCosts(engine.options);
  const manage = useManageVoices(ctx.onClose);
  const ready = engine.state === "ready";
  const options = engine.options;
  const none = options && !options.eleven.connected && !options.heygen.connected;
  const paste = options?.paths.paste;
  const pasteBlocked = !ready || Boolean(paste?.blocked_reason);

  return (
    <div className="space-y-3">
      {engine.state === "not_deployed" || engine.state === "error" ? (
        <p className="text-sm text-[var(--via-coral-dark)]" role="status" data-testid="voz-motor">
          {engine.message}
        </p>
      ) : null}
      {none ? (
        <p
          className="flex flex-wrap items-center gap-x-2 text-sm text-[var(--via-coral-dark)]"
          role="status"
        >
          Conecte o ElevenLabs ou a HeyGen para criar vozes.
          <ExitLinks exits={exitsFor("own", options, manage)} />
        </p>
      ) : null}
      <h3 className="text-sm font-medium text-[var(--via-text-primary)]">De onde vem a voz?</h3>
      <ul
        className="divide-y divide-[var(--via-border-soft)] border-y border-[var(--via-border-soft)]"
        aria-label="De onde vem a voz?"
      >
        {PATHS.map((item) => {
          const reason = options?.paths[item.id]?.blocked_reason ?? null;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onPick(item.id)}
                disabled={!ready || reason !== null}
                data-testid={`voz-${item.id}`}
                className="group flex w-full cursor-pointer items-center gap-3 py-3 text-left transition-colors hover:bg-[var(--via-navy-06)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)] disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-[var(--via-text-muted)]"
              >
                <span className="pl-2">{item.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-[var(--via-text-primary)]">
                    {item.title}
                  </span>
                  <span className="block text-xs text-[var(--via-text-muted)]">{item.hint}</span>
                </span>
                <span className="pr-2 text-xs text-[var(--via-text-muted)]">{costs[item.id]}</span>
              </button>
              {reason && !none ? (
                <p className="flex flex-wrap items-center gap-x-2 pb-3 pl-9 text-xs text-[var(--via-coral-dark)]">
                  {reason}
                  <ExitLinks exits={exitsFor(item.id, options, manage)} />
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {engine.state === "checking" ? (
        <p className="text-xs text-[var(--via-text-muted)]">Conferindo as vozes…</p>
      ) : null}
      <p className="flex flex-wrap items-center gap-x-2 text-xs">
        <button
          type="button"
          className={LINK}
          onClick={() => onPick("paste")}
          disabled={pasteBlocked}
          data-testid="voz-paste"
        >
          Já tenho um Voice ID
        </button>
        {ready && paste?.blocked_reason && !none ? (
          <span className="text-[var(--via-text-muted)]">{paste.blocked_reason}</span>
        ) : null}
      </p>
    </div>
  );
}

function StepHead({ title, onBack, busy }: { title: string; onBack: () => void; busy: boolean }) {
  return (
    <p className="flex items-center justify-between gap-3 text-sm">
      <span className="font-medium text-[var(--via-text-primary)]">{title}</span>
      <button type="button" className={LINK} onClick={onBack} disabled={busy}>
        Voltar
      </button>
    </p>
  );
}

function NameField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Nome da voz</Label>
      <Input
        id={id}
        value={value}
        maxLength={NAME_MAX}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

// ── da minha voz ────────────────────────────────────────────────────────────

function OwnStep({ ctx }: { ctx: StepContext }) {
  const costs = useVoiceCreateCosts(ctx.options);
  const upload = useUploadVoiceSample();
  const clone = useVoiceClone();
  const [sample, setSample] = useState<VoiceSample | null>(null);
  const [name, setName] = useState(ctx.presenterName?.trim() || "Minha voz");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [recorderKey, setRecorderKey] = useState(0);
  // amostra já enviada: um "Tentar de novo" não sobe outra vez
  const sent = useRef<{ sample: VoiceSample; path: string } | null>(null);
  const pending = upload.isPending || clone.isPending;
  const blocked = error instanceof EngineNotDeployedError;
  const ok =
    sample !== null &&
    !sample.issues.some((i) => i.blocking) &&
    consent &&
    name.trim().length > 0 &&
    !pending &&
    !blocked;

  const submit = async () => {
    if (!sample) return;
    setError(null);
    try {
      const path =
        sent.current?.sample === sample ? sent.current.path : await upload.mutateAsync(sample.blob);
      sent.current = { sample, path };
      const voice = await clone.mutateAsync({
        name: name.trim(),
        sample_path: path,
        consent: true,
        duration_s: Math.round(sample.seconds),
        ...(ctx.avatarId ? { avatar_id: ctx.avatarId } : {}),
        ...(ctx.prefer ? { prefer: ctx.prefer } : {}),
      });
      ctx.onCreated(voice);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <>
      <div className="space-y-4">
        <StepHead title="Da minha voz" onBack={ctx.onBack} busy={pending} />
        <VoiceRecorder
          key={recorderKey}
          onSample={(next) => {
            setSample(next);
            setError(null);
          }}
          disabled={pending}
        />
        {sample ? (
          <>
            <NameField id="voz-nome" value={name} onChange={setName} />
            <label className="flex cursor-pointer items-start gap-2 text-sm text-[var(--via-text-primary)]">
              <Checkbox
                checked={consent}
                onCheckedChange={(v) => setConsent(v === true)}
                className="mt-0.5"
                data-testid="voz-consentimento"
              />
              É a minha voz e eu autorizo criar o clone.
            </label>
          </>
        ) : null}
        <ProblemLine
          error={error}
          ctx={ctx}
          onRetryPath={() => {
            setSample(null);
            setError(null);
            setRecorderKey((k) => k + 1);
          }}
        />
      </div>
      <DialogFooter className="items-center gap-3 sm:justify-between">
        <span className="text-xs text-[var(--via-text-muted)]">{costs.own}</span>
        <Button onClick={() => void submit()} disabled={!ok} data-testid="voz-criar">
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {error && !blocked ? "Tentar de novo" : "Criar voz"}
        </Button>
      </DialogFooter>
    </>
  );
}

// ── de uma descrição ────────────────────────────────────────────────────────

const DESCRIPTION_CHIPS = [
  "mulher",
  "homem",
  "30 anos",
  "calma",
  "animada",
  "grave",
  "fala devagar",
  "sotaque paulista",
  "sotaque carioca",
];

function toggleChip(text: string, chip: string): string {
  const parts = text
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const next = parts.includes(chip) ? parts.filter((p) => p !== chip) : [...parts, chip];
  return next.join(", ");
}

function DescribeStep({ ctx }: { ctx: StepContext }) {
  const costs = useVoiceCreateCosts(ctx.options);
  const design = useVoiceDesign();
  const save = useVoiceDesignSave();
  const [description, setDescription] = useState("");
  const [previews, setPreviews] = useState<VoiceDesignPreview[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [name, setName] = useState(ctx.presenterName?.trim() || "Voz da marca");
  const [error, setError] = useState<unknown>(null);
  const pending = design.isPending || save.isPending;
  const blocked = error instanceof EngineNotDeployedError;
  const length = description.trim().length;
  const describable = length >= DESCRIPTION_MIN && length <= DESCRIPTION_MAX;

  const generate = () => {
    setError(null);
    setPicked(null);
    design.mutate(
      { description: description.trim() },
      {
        onSuccess: (result) => {
          setPreviews(result.previews);
          setPicked(result.previews[0]?.preview_id ?? null);
        },
        onError: setError,
      },
    );
  };

  const submit = () => {
    if (!picked) return;
    setError(null);
    save.mutate(
      { preview_id: picked, name: name.trim(), description: description.trim() },
      {
        onSuccess: ctx.onCreated,
        onError: (err) => {
          // a prévia expirou: gera de novo com a mesma descrição
          if (err instanceof VoiceActionError && err.status === 404) setPreviews(null);
          setError(err);
        },
      },
    );
  };

  return (
    <>
      <div className="space-y-4">
        <StepHead title="De uma descrição" onBack={ctx.onBack} busy={pending} />
        {previews === null ? (
          <div className="space-y-2">
            <Label htmlFor="voz-descricao">Como é a voz?</Label>
            <Textarea
              id="voz-descricao"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, DESCRIPTION_MAX))}
              placeholder="Ex.: mulher de 30 anos, calma e confiante, sotaque paulista"
              autoFocus
            />
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Exemplos">
              {DESCRIPTION_CHIPS.map((chip) => (
                <ChoiceChip
                  key={chip}
                  selected={description
                    .split(",")
                    .map((p) => p.trim())
                    .includes(chip)}
                  onClick={() =>
                    setDescription((d) => toggleChip(d, chip).slice(0, DESCRIPTION_MAX))
                  }
                >
                  {chip}
                </ChoiceChip>
              ))}
            </div>
            <p className="text-xs text-[var(--via-text-muted)]">
              {length < DESCRIPTION_MIN
                ? `Pelo menos ${DESCRIPTION_MIN} letras.`
                : `${length.toLocaleString("pt-BR")} / ${DESCRIPTION_MAX.toLocaleString("pt-BR")}`}
            </p>
          </div>
        ) : (
          <>
            <ul
              className="divide-y divide-[var(--via-border-soft)] border-y border-[var(--via-border-soft)]"
              aria-label="Opções de voz"
            >
              {previews.map((preview, i) => (
                <li key={preview.preview_id} className="flex items-center gap-3 py-2">
                  <button
                    type="button"
                    onClick={() => setPicked(preview.preview_id)}
                    aria-pressed={picked === preview.preview_id}
                    className={cn(
                      "flex-1 cursor-pointer rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--via-navy-06)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]",
                      picked === preview.preview_id
                        ? "font-medium text-[var(--via-text-primary)]"
                        : "text-[var(--via-text-muted)]",
                    )}
                  >
                    Opção {i + 1}
                    {picked === preview.preview_id ? " · escolhida" : ""}
                  </button>
                  <ListenButton url={preview.url} size="sm" />
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-x-4 text-sm">
              <button type="button" className={LINK} onClick={generate} disabled={pending}>
                <RefreshCw className="mr-1 inline size-3.5" aria-hidden="true" />
                Gerar de novo
              </button>
              <button
                type="button"
                className={LINK}
                onClick={() => setPreviews(null)}
                disabled={pending}
              >
                Mudar descrição
              </button>
            </div>
            <NameField id="voz-nome-design" value={name} onChange={setName} />
          </>
        )}
        <ProblemLine error={error} ctx={ctx} />
      </div>
      <DialogFooter className="items-center gap-3 sm:justify-between">
        <span className="text-xs text-[var(--via-text-muted)]">{costs.describe}</span>
        {previews === null ? (
          <Button
            onClick={generate}
            disabled={!describable || pending || blocked}
            data-testid="voz-gerar"
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Gerar vozes
          </Button>
        ) : (
          <Button
            onClick={submit}
            disabled={!picked || !name.trim() || pending || blocked}
            data-testid="voz-usar"
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Usar esta
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

// ── da biblioteca ───────────────────────────────────────────────────────────

const GENDER_LABEL: Record<string, string> = { female: "feminina", male: "masculina" };

function useDebounced(value: string, ms = 400) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function LibraryStep({ ctx }: { ctx: StepContext }) {
  const costs = useVoiceCreateCosts(ctx.options);
  const [search, setSearch] = useState("");
  const [gender, setGender] = useState<"female" | "male" | null>(null);
  const query = useDebounced(search);
  const library = useVoiceLibrary({ search: query, gender }, true);
  const add = useVoiceLibraryAdd();
  const [picked, setPicked] = useState<LibraryVoice | null>(null);
  const [error, setError] = useState<unknown>(null);
  const pages = library.data?.pages ?? [];
  const provider = pages[0]?.provider ?? null;
  const notice = pages[0]?.notice ?? null;
  const list = pages.flatMap((p) => p.voices);
  const blocked =
    error instanceof EngineNotDeployedError || library.error instanceof EngineNotDeployedError;

  const submit = () => {
    if (!picked || !provider) return;
    setError(null);
    add.mutate(
      { provider, ref: picked.ref, name: picked.name },
      { onSuccess: ctx.onCreated, onError: setError },
    );
  };

  return (
    <>
      <div className="space-y-3">
        <StepHead title="Da biblioteca" onBack={ctx.onBack} busy={add.isPending} />
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar voz"
            aria-label="Buscar voz"
            className="min-w-0 flex-1"
          />
          <ChoiceChip
            selected={gender === "female"}
            onClick={() => setGender((g) => (g === "female" ? null : "female"))}
          >
            Feminina
          </ChoiceChip>
          <ChoiceChip
            selected={gender === "male"}
            onClick={() => setGender((g) => (g === "male" ? null : "male"))}
          >
            Masculina
          </ChoiceChip>
        </div>
        {notice ? <p className="text-xs text-[var(--via-text-muted)]">{notice}</p> : null}
        {library.isPending ? (
          <p className="flex items-center gap-2 text-sm text-[var(--via-text-muted)]">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Carregando vozes…
          </p>
        ) : library.isError ? (
          <ProblemLine error={library.error} ctx={ctx} />
        ) : list.length === 0 ? (
          <p className="text-sm text-[var(--via-text-muted)]">Nenhuma voz com essa busca.</p>
        ) : (
          <ul
            className="max-h-72 divide-y divide-[var(--via-border-soft)] overflow-y-auto border-y border-[var(--via-border-soft)]"
            aria-label="Vozes"
          >
            {list.map((voice) => {
              const selected = picked?.ref === voice.ref;
              const meta = [
                voice.gender ? (GENDER_LABEL[voice.gender] ?? voice.gender) : null,
                voice.accent,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={voice.ref} className="flex items-center gap-3 py-2">
                  <button
                    type="button"
                    onClick={() => setPicked(voice)}
                    aria-pressed={selected}
                    className="min-w-0 flex-1 cursor-pointer rounded-md px-2 py-1 text-left transition-colors hover:bg-[var(--via-navy-06)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]"
                  >
                    <span
                      className={cn(
                        "block truncate text-sm",
                        selected
                          ? "font-medium text-[var(--via-text-primary)]"
                          : "text-[var(--via-text-primary)]",
                      )}
                    >
                      {voice.name}
                      {selected ? " · escolhida" : ""}
                    </span>
                    {meta ? (
                      <span className="block text-xs text-[var(--via-text-muted)]">{meta}</span>
                    ) : null}
                  </button>
                  <ListenButton url={voice.preview_url} disabled={!voice.preview_url} size="sm" />
                </li>
              );
            })}
          </ul>
        )}
        {library.hasNextPage ? (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 text-[var(--via-text-muted)]"
            onClick={() => void library.fetchNextPage()}
            disabled={library.isFetchingNextPage}
          >
            {library.isFetchingNextPage ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : null}
            Ver mais
          </Button>
        ) : null}
        <ProblemLine error={error} ctx={ctx} />
      </div>
      <DialogFooter className="items-center gap-3 sm:justify-between">
        <span className="text-xs text-[var(--via-text-muted)]">{costs.library}</span>
        <Button
          onClick={submit}
          disabled={!picked || add.isPending || blocked}
          data-testid="voz-usar"
        >
          {add.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Usar esta
        </Button>
      </DialogFooter>
    </>
  );
}

// ── já tenho um Voice ID ────────────────────────────────────────────────────

function PasteStep({ ctx }: { ctx: StepContext }) {
  const [voiceId, setVoiceId] = useState("");
  const check = useElevenVoiceCheck(voiceId);
  const importVoice = useVoiceImport();
  const [error, setError] = useState<unknown>(null);
  const blocked = error instanceof EngineNotDeployedError;

  const submit = () => {
    setError(null);
    importVoice.mutate(
      {
        voice_id: voiceId.trim(),
        ...(check.lookup.data?.name ? { name: check.lookup.data.name } : {}),
      },
      { onSuccess: ctx.onCreated, onError: setError },
    );
  };

  return (
    <>
      <div className="space-y-4">
        <StepHead title="Já tenho um Voice ID" onBack={ctx.onBack} busy={importVoice.isPending} />
        <ElevenVoiceField
          value={voiceId}
          onChange={setVoiceId}
          idPrefix="voz-colar"
          initiallyOpen
          hint="No ElevenLabs: Voices → escolha a voz → copie o ID."
        />
        <ProblemLine error={error} ctx={ctx} />
      </div>
      <DialogFooter>
        <Button
          onClick={submit}
          disabled={!check.ok || importVoice.isPending || blocked}
          data-testid="voz-usar"
        >
          {importVoice.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Usar esta
        </Button>
      </DialogFooter>
    </>
  );
}

// ── acompanhar ──────────────────────────────────────────────────────────────

function TrackStep({
  voice,
  allowDefault,
  avatarId,
  onRestart,
  onClose,
  onDone,
}: {
  voice: BrandVoice;
  allowDefault: boolean;
  avatarId?: string;
  onRestart: (step: Step) => void;
  onClose: () => void;
  onDone: (voice: BrandVoice) => void;
}) {
  const [timedOut, setTimedOut] = useState(false);
  const status = useVoiceStatus(voice.id, voice.status === "processing" && !timedOut);
  const current = status.data ?? voice;
  const setDefault = useSetDefaultVoice();
  const [asDefault, setAsDefault] = useState(false);

  useEffect(() => {
    if (current.status !== "processing") return;
    const t = window.setTimeout(() => setTimedOut(true), POLL_LIMIT_MS);
    return () => window.clearTimeout(t);
  }, [current.status]);

  const finish = () => {
    if (!asDefault || current.is_default) return onDone(current);
    setDefault.mutate(
      { voice_id: current.id },
      {
        onSuccess: () => onDone({ ...current, is_default: true }),
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <>
      <div className="space-y-3">
        <p className="text-sm font-medium text-[var(--via-text-primary)]">{current.name}</p>
        {current.status === "processing" ? (
          timedOut ? (
            <p className="text-sm text-[var(--via-text-muted)]" role="status">
              Está demorando mais que o normal. Pode fechar: avisamos em Vozes.
            </p>
          ) : (
            <p
              className="flex items-center gap-2 text-sm text-[var(--via-text-muted)]"
              role="status"
            >
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Criando a sua voz…
            </p>
          )
        ) : null}
        {current.status === "failed" ? (
          <div className="space-y-2">
            <p className="text-sm text-[var(--via-coral-dark)]" role="alert">
              {current.error ?? "Não deu para criar a voz."}
            </p>
            <div className="flex flex-wrap gap-2">
              {current.source === "clone" ? (
                <Button size="sm" onClick={() => onRestart("own")}>
                  <Mic aria-hidden="true" /> Gravar de novo
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" onClick={() => onRestart("choose")}>
                Escolher outra
              </Button>
            </div>
          </div>
        ) : null}
        {current.status === "ready" ? (
          <>
            <ListenButton voice={{ voice: current, avatarId }} />
            <p className="text-xs text-[var(--via-text-muted)]">{providerNote(current)}</p>
            {allowDefault && !current.is_default ? (
              <ChoiceChip selected={asDefault} onClick={() => setAsDefault((v) => !v)}>
                Usar como voz padrão
              </ChoiceChip>
            ) : null}
          </>
        ) : null}
        {status.isError && !(status.error instanceof EngineNotDeployedError) ? (
          <p className="text-xs text-[var(--via-coral-dark)]">
            {humanizeError(status.error.message)}
          </p>
        ) : null}
      </div>
      <DialogFooter>
        {current.status === "ready" ? (
          <Button onClick={finish} disabled={setDefault.isPending} data-testid="voz-pronta">
            {setDefault.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Usar esta voz
          </Button>
        ) : current.status === "processing" ? (
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        ) : null}
      </DialogFooter>
    </>
  );
}
