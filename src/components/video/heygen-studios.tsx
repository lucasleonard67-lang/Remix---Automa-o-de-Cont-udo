import { useNavigate } from "@tanstack/react-router";
import { Loader2, Play, UserRound, UserRoundPlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  AvatarBuilderDialog,
  EngineLine,
  HeygenPrepLine,
  TwinStatus,
  TwinUpload,
} from "@/components/avatars/avatar-builder";
import { NewAvatarDialog } from "@/components/avatars/new-avatar-dialog";
import { PresenterTile } from "@/components/avatars/presenter-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SelectedCheck } from "@/components/ui/choice-tile";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { EscritaConfig } from "@/components/prompt/escrever-com-claude";
import { PromptField } from "@/components/prompt/prompt-tools";
import { PlanoResumo } from "@/components/video/roteiro-brief";
import { ModelRail } from "@/components/video/video-hub";
import { ListenButton, VoiceSelect } from "@/components/voices/voice-select";
import {
  AVATAR_BUCKET,
  presenterPortraitPath,
  useAvatars,
  useUpdateAvatar,
  type AvatarRow,
  type AvatarVoice,
} from "@/hooks/use-avatars";
import { useSignedUrl } from "@/hooks/use-storage";
import {
  AGENT_PROMPT_MAX,
  AVATAR_SCRIPT_MAX,
  ENGINE_LABEL,
  titleFrom,
  useCreateStudioJob,
  useHeygenClones,
  useHeygenEngine,
  useHeygenGroupVoice,
  useHeygenLooks,
  useHeygenPhotoAvatar,
  useHeygenStatus,
  useHeygenVoicePreview,
  useHeygenVoices,
  type HeygenEngine,
  type HeygenLook,
  type HeygenRef,
  type StudioJobConfig,
} from "@/hooks/use-heygen-studio";
import { useHubModels } from "@/hooks/use-hub-models";
import { brandIdOf, useBrandVoices, type BrandVoice } from "@/hooks/use-voices";
import {
  explicitHeygenVoice,
  heygenVoiceIdOf,
  heygenVoiceValue,
  listableClones,
  resolveAvatarVoice,
  voiceForSelection,
  type ManualVoice,
} from "@/lib/heygen-voice";
import { ferramentaDe, LETRAS_POR_SEGUNDO } from "@/lib/receitas-de-video";
import { SPEECH_CHARS_PER_SECOND } from "@/lib/remake-options";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { HUB_PROVIDER_LABEL, type HubRoute } from "@/lib/video-hub";
import type { PlanoDeProducao } from "@/hooks/use-roteiro-pedidos";
import { humanizeError } from "@/lib/humanize-error";

// ---------------------------------------------------------------------------
// Estúdios do hub (docs/hub-motor-contratos.md): avatar fala o roteiro (§1),
// foto vira apresentador (§2), Digital Twin (§3) e Video Agent (§4). Cada um
// pede só o que o modelo precisa — quem apresenta e o texto — e termina num
// botão só, com o modelo (padrão · top) e a estimativa logo acima. O campo de
// texto tem "Escrever com o seu Claude": o roteiro, a ideia ou a fala nascem do
// Claude da pessoa, pelo conector, no formato que o modelo exige
// (src/lib/receitas-de-video.ts é a fonte das frases e das regras).
// O reenquadrar (Higgsfield) ainda não tem contrato: "chega no próximo deploy".
// ---------------------------------------------------------------------------

export function HubStudio({
  route,
  initialModelId,
}: {
  route: HubRoute;
  initialModelId: string | null;
}) {
  if (route.action.kind !== "studio") return null;
  switch (route.action.studio) {
    case "avatar":
      return <AvatarScriptStudio route={route} initialModelId={initialModelId} />;
    case "photo_avatar":
      return <PhotoPresenterStudio route={route} initialModelId={initialModelId} />;
    case "twin":
      return <TwinStudio route={route} initialModelId={initialModelId} />;
    case "agent":
      return <VideoAgentStudio route={route} />;
    case "reframe":
      return <ReframeStudio />;
  }
}

// ── peças comuns ────────────────────────────────────────────────────────────

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="space-y-3" aria-labelledby={id}>
      <h2 id={id} className="text-base font-medium text-[var(--via-text-primary)]">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Modelo da rota (padrão · top) com a escolha local. */
function useStudioModel(route: HubRoute, initialModelId: string | null) {
  const { choices, suggested } = useHubModels(route);
  const [modelId, setModelId] = useState<string | null>(initialModelId);
  const picked =
    choices.find((c) => c.choice.id === modelId && c.state === "ready") ?? suggested ?? null;
  return { choices, picked, setModelId };
}

function ScriptField({
  id,
  label,
  value,
  onChange,
  max,
  placeholder,
  seconds = true,
  claude = null,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  max: number;
  placeholder: string;
  /** mostra a duração estimada da fala */
  seconds?: boolean;
  /** o Claude da pessoa escreve este campo (tipo, campo, modelo, limite) */
  claude?: EscritaConfig | null;
}) {
  const est = Math.max(1, Math.round(value.trim().length / SPEECH_CHARS_PER_SECOND));
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      <PromptField
        id={id}
        rows={5}
        kind={seconds ? "script" : "video"}
        max={max}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        claude={claude}
      />
      <p className="text-xs text-[var(--via-text-muted)]">
        {value.length.toLocaleString("pt-BR")} / {max.toLocaleString("pt-BR")}
        {seconds && value.trim() ? ` · ≈ ${est} s de fala` : ""}
      </p>
    </div>
  );
}

/** Rodapé: modelo + custo + o único botão. `blocker` explica por que está desligado. */
/** "US$ 0,06/s em 1080p" → 0.06; sem número → null. */
function usdPorSegundo(cost: string | null | undefined): number | null {
  const m = /US\$\s*([\d.,]+)\s*\/\s*s/.exec(cost ?? "");
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function GenerateBar({
  route,
  model,
  blocker,
  pending,
  onGenerate,
  segundos = null,
}: {
  route: HubRoute;
  model: ReturnType<typeof useStudioModel>;
  blocker: string | null;
  pending: boolean;
  onGenerate: () => void;
  /** segundos de fala do texto atual: base da estimativa */
  segundos?: number | null;
}) {
  const multi = model.choices.length > 1;
  const picked = model.picked;
  const porSegundo = usdPorSegundo(picked?.cost);
  const conhecido = Boolean(picked && porSegundo !== null && !/confirmar/.test(picked.cost));
  const valor =
    conhecido && porSegundo && segundos
      ? `até US$ ${(porSegundo * segundos).toFixed(2).replace(".", ",")}`
      : conhecido && picked
        ? `US$ ${picked.cost.replace(/^US\$\s*/, "")}`
        : "Sem estimativa para este modelo";
  const provedor = picked ? HUB_PROVIDER_LABEL[picked.choice.provider] : null;
  const depende = picked
    ? [
        picked.choice.label,
        conhecido
          ? segundos
            ? `${segundos} s de fala`
            : "por segundo de fala"
          : provedor
            ? `cobrado na sua conta ${provedor}`
            : null,
        picked.time ? `pronto em ${picked.time}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;
  return (
    <div className="space-y-3 border-t border-[var(--via-border-soft)] pt-4" aria-live="polite">
      {multi ? (
        <ModelRail
          choices={model.choices}
          picked={picked?.choice.id ?? null}
          onPick={model.setModelId}
        />
      ) : null}
      <div
        className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1"
        data-testid="studio-estimativa"
      >
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-sm text-[var(--via-text-muted)]">Estimativa</p>
          {depende ? <p className="text-xs text-[var(--via-text-muted)]">{depende}</p> : null}
        </div>
        <p className="font-mono text-sm text-[var(--via-text-primary)]">{valor}</p>
      </div>
      <p className="text-xs text-[var(--via-text-muted)]">{route.via}</p>
      {blocker ? <p className="text-xs text-[var(--via-text-muted)]">{blocker}</p> : null}
      <Button
        size="lg"
        onClick={onGenerate}
        disabled={blocker !== null || pending}
        data-testid="studio-gerar"
      >
        {pending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Play aria-hidden="true" />
        )}
        Gerar vídeo
      </Button>
    </div>
  );
}

function useSubmitStudio() {
  const create = useCreateStudioJob();
  const navigate = useNavigate();
  const submit = (title: string, config: StudioJobConfig) =>
    create.mutate(
      { title, config },
      {
        onSuccess: () => {
          toast.success("Vídeo na fila. Acompanhe o progresso em Vídeos.");
          void navigate({ to: "/videos" });
        },
        onError: (err) => toast.error(err.message),
      },
    );
  return { submit, pending: create.isPending };
}

/** Motor HeyGen do modelo do catálogo ("heygen/avatar-v" → avatar_v, "heygen/avatar-iii" → avatar_iii). */
function engineOf(modelId: string | undefined): HeygenEngine {
  const id = modelId ?? "";
  if (/avatar[-_]iii$/.test(id)) return "avatar_iii";
  return /avatar[-_]v$/.test(id) ? "avatar_v" : "avatar_iv";
}

/** Motor pedido (do modelo escolhido) e o que a look aceita de fato. */
function engineFor(wanted: string | undefined, supported: HeygenEngine[]): HeygenEngine | null {
  const want = engineOf(wanted);
  if (!supported.length) return null;
  if (supported.includes(want)) return want;
  return supported.includes("avatar_iv") ? "avatar_iv" : supported[0];
}

// ── §1 avatar fala o roteiro ────────────────────────────────────────────────

function AvatarScriptStudio({
  route,
  initialModelId,
}: {
  route: HubRoute;
  initialModelId: string | null;
}) {
  const engine = useHeygenEngine();
  const model = useStudioModel(route, initialModelId);
  const campo = ferramentaDe(route.experience)?.campo ?? null;
  const [ownership, setOwnership] = useState<"public" | "private">("public");
  const looks = useHeygenLooks(ownership, engine.state === "ready");
  const [look, setLook] = useState<HeygenLook | null>(null);
  const [script, setScript] = useState("");
  // o plano de produção do roteiro escrito pelo Claude da pessoa: segue com o vídeo
  const [plano, setPlano] = useState<{ plano: PlanoDeProducao | null; pedidoId: string | null }>({
    plano: null,
    pedidoId: null,
  });
  const [manualVoice, setManualVoice] = useState<ManualVoice | null>(null);
  const brandVoices = useBrandVoices().data ?? [];
  const { submit, pending } = useSubmitStudio();
  const [building, setBuilding] = useState(false);
  // um visual de "Meus avatares" pode ser de um apresentador: a voz salva dele vale (§8.7)
  const presenters = useAvatars("active");
  const owner =
    ownership === "private" && look
      ? ((presenters.data ?? []).find((p) => {
          const ref = p.provider_refs?.heygen;
          return (
            ref &&
            ((look.group_id && ref.group_id === look.group_id) ||
              ref.look_id === look.id ||
              (ref.looks ?? []).some((l) => l.id === look.id))
          );
        }) ?? null)
      : null;
  const saved = owner?.voice?.heygen_voice ?? null;
  const savedLabel = useSavedVoiceLabel(saved);
  // a voz acompanha o avatar: look → cadastro → grupo → clone de mesmo nome
  const clones = useHeygenClones(Boolean(look));
  const groupVoice = useHeygenGroupVoice(
    look?.group_id ?? null,
    Boolean(look) && !look?.default_voice_id,
  );
  const avatarVoice = resolveAvatarVoice({
    hasSaved: Boolean(saved),
    lookVoice: look?.default_voice_id,
    refVoice: owner?.provider_refs?.heygen?.default_voice_id,
    groupVoice: groupVoice.data?.default_voice_id,
    groupLoading: groupVoice.isLoading,
    clones: clones.data ?? [],
    clonesLoading: clones.isLoading,
    names: [look?.name, owner?.name].filter((n): n is string => Boolean(n)),
  });
  const voice = voiceForSelection(manualVoice, look?.id ?? null, avatarVoice);
  const rememberVoice = useRememberVoice();
  // avatar recém-criado no construtor: escolhido assim que aparece em "Meus avatares"
  const [wantedLook, setWantedLook] = useState<string | null>(null);

  const list = useMemo(
    () =>
      (looks.data?.pages.flatMap((p) => p.looks) ?? []).filter(
        (l) => l.status === null || l.status === "completed",
      ),
    [looks.data],
  );
  useEffect(() => {
    if (!wantedLook) return;
    const found = list.find((l) => l.id === wantedLook);
    if (found) {
      setLook(found);
      setWantedLook(null);
    }
  }, [list, wantedLook]);

  const chosenEngine = look ? engineFor(model.picked?.choice.id, look.supported_api_engines) : null;
  const engineNote =
    look &&
    engineOf(model.picked?.choice.id) === "avatar_v" &&
    chosenEngine &&
    chosenEngine !== "avatar_v"
      ? `${look.name} não aceita Avatar V: vai em ${ENGINE_LABEL[chosenEngine]}.`
      : null;

  const blocker =
    engine.state === "checking"
      ? "Conferindo a HeyGen…"
      : engine.state !== "ready"
        ? "A HeyGen precisa estar pronta para gerar."
        : !look
          ? "Escolha quem apresenta."
          : !voice
            ? avatarVoice.state === "loading"
              ? "Conferindo a voz do avatar…"
              : "Escolha a voz."
            : !script.trim()
              ? "Escreva o roteiro."
              : null;

  const generate = () => {
    if (!look || !voice || blocker) return;
    rememberVoice(owner, voice);
    submit(titleFrom(script), {
      mode: "avatar_video",
      avatar_video: {
        provider: "heygen",
        look_id: look.id,
        script: script.trim(),
        ...voicePayload(voice, brandVoices, saved),
        ...(chosenEngine ? { engine: chosenEngine } : {}),
        aspect_ratio:
          plano.plano?.formato === "16:9" || plano.plano?.formato === "1:1"
            ? plano.plano.formato
            : "9:16",
        ...(plano.plano && plano.pedidoId
          ? { plano: plano.plano, roteiro_pedido_id: plano.pedidoId }
          : {}),
      },
    });
  };

  return (
    <div className="space-y-8 pb-8" data-testid="studio-avatar">
      <EngineLine {...engine} />
      {look ? (
        <ChosenRail name={look.name} image={look.preview_image_url}>
          <StudioVoice
            options={[
              ...(saved ? [{ value: "saved", label: "Voz do apresentador" }] : []),
              ...(avatarVoice.state === "found" && heygenVoiceIdOf(avatarVoice.pick)
                ? [{ value: avatarVoice.pick, label: "Voz do avatar" }]
                : []),
              { value: "elevenlabs", label: "Voz da marca" },
            ]}
            value={voice}
            loading={avatarVoice.state === "loading" && !voice}
            onChange={(pick) => setManualVoice({ avatarId: look.id, pick })}
            savedLabel={savedLabel}
            presenter={owner}
          />
        </ChosenRail>
      ) : null}
      <Section id="st-quem" title="Quem apresenta">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Avatares">
          <ChoiceChip
            selected={ownership === "public"}
            onClick={() => {
              setOwnership("public");
              setLook(null);
            }}
          >
            Biblioteca
          </ChoiceChip>
          <ChoiceChip
            selected={ownership === "private"}
            onClick={() => {
              setOwnership("private");
              setLook(null);
            }}
          >
            Meus avatares
          </ChoiceChip>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => setBuilding(true)}
            data-testid="hub-criar-avatar"
          >
            <UserRoundPlus aria-hidden="true" /> Criar avatar
          </Button>
        </div>
        {engine.state !== "ready" ? null : looks.isPending ? (
          <TileSkeleton />
        ) : looks.isError ? (
          <p className="text-sm text-[var(--via-coral-dark)]">
            {humanizeError(looks.error.message)}
          </p>
        ) : list.length === 0 ? (
          <p className="text-sm text-[var(--via-text-muted)]">
            {ownership === "private"
              ? "Nenhum avatar seu na HeyGen ainda. Crie um em “Minha foto vira apresentador” ou “Meu clone”."
              : "A biblioteca da HeyGen veio vazia."}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
              {list.map((item) => (
                <LookTile
                  key={item.id}
                  look={item}
                  selected={look?.id === item.id}
                  onClick={() => {
                    setLook(item);
                  }}
                />
              ))}
            </div>
            {looks.hasNextPage ? (
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2 text-[var(--via-text-muted)]"
                onClick={() => void looks.fetchNextPage()}
                disabled={looks.isFetchingNextPage}
              >
                {looks.isFetchingNextPage ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : null}
                Ver mais
              </Button>
            ) : null}
          </>
        )}
        {engineNote ? <p className="text-xs text-[var(--via-text-muted)]">{engineNote}</p> : null}
      </Section>

      <Section id="st-roteiro" title={campo?.rotulo ?? "O que ele fala"}>
        <ScriptField
          id="st-script"
          label={campo?.rotulo ?? "O que ele fala"}
          value={script}
          onChange={setScript}
          max={AVATAR_SCRIPT_MAX}
          placeholder={campo?.placeholder ?? "O que o avatar vai falar."}
          seconds
          claude={{
            tipo: "roteiro",
            alvo: "avatar",
            referencias: true,
            contexto: {
              ferramenta: route.experience,
              modelo: model.picked?.choice.id,
              max: AVATAR_SCRIPT_MAX,
              formato: "9:16",
              ...(look ? { apresentador: look.name } : {}),
            },
            onEntrega: (p) => setPlano({ plano: p.plano, pedidoId: p.id }),
          }}
        />
        {plano.plano ? <PlanoResumo plano={plano.plano} /> : null}
      </Section>

      <GenerateBar
        route={route}
        model={model}
        blocker={blocker}
        pending={pending}
        onGenerate={generate}
        segundos={script.trim() ? Math.ceil(script.trim().length / LETRAS_POR_SEGUNDO) : null}
      />
      <AvatarBuilderDialog
        open={building}
        onOpenChange={setBuilding}
        onDone={({ lookId }) => {
          setOwnership("private");
          setLook(null);
          setWantedLook(lookId);
        }}
      />
    </div>
  );
}

/** Crachá de um avatar da HeyGen: mesmo desenho do PresenterTile. */
function LookTile({
  look,
  selected,
  onClick,
}: {
  look: HeygenLook;
  selected: boolean;
  onClick: () => void;
}) {
  const top = look.supported_api_engines.includes("avatar_v");
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      data-testid={`look-${look.id}`}
      className={cn(
        "via-lift group relative aspect-[3/4] cursor-pointer overflow-hidden rounded-[14px] border border-[var(--via-border-soft)] bg-[var(--via-surface)] text-left shadow-[var(--via-shadow-sm)]",
        selected && "via-selected",
      )}
    >
      {look.preview_image_url ? (
        <img
          src={look.preview_image_url}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center bg-[var(--via-navy-06)]">
          <UserRound className="size-8 text-[var(--via-text-muted)]" aria-hidden="true" />
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 bg-[linear-gradient(180deg,transparent,rgba(2,22,42,0.82))] p-2 pt-6">
        <span className="block truncate text-xs font-medium text-white">{look.name}</span>
      </span>
      {selected ? (
        <>
          <span className="absolute inset-0 bg-[var(--via-navy-08)]" aria-hidden="true" />
          <SelectedCheck className="top-1.5 left-1.5" />
        </>
      ) : null}
      {top ? (
        <span className="absolute right-1.5 top-1.5">
          <Badge className="text-xs shadow-[var(--via-shadow-sm)]">Avatar V</Badge>
        </span>
      ) : null}
    </button>
  );
}

function TileSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="aspect-[3/4] rounded-[14px]" />
      ))}
    </div>
  );
}

// ── seletor de apresentador da marca (§2 e §3) ─────────────────────────────

function PresenterPicker({
  presenters,
  loading,
  value,
  onChange,
  emptyText,
}: {
  presenters: AvatarRow[];
  loading: boolean;
  value: string | null;
  onChange: (id: string) => void;
  emptyText: string;
}) {
  const [creating, setCreating] = useState(false);
  const autoPicked = useRef(false);
  useEffect(() => {
    if (autoPicked.current || value || presenters.length === 0) return;
    autoPicked.current = true;
    onChange((presenters.find((p) => p.is_default) ?? presenters[0]).id);
  }, [presenters, value, onChange]);
  return (
    <>
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
          <UserRoundPlus aria-hidden="true" /> Novo apresentador
        </Button>
      </div>
      {loading ? (
        <TileSkeleton />
      ) : presenters.length === 0 ? (
        <p className="text-sm text-[var(--via-text-muted)]">{emptyText}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {presenters.map((p) => (
            <PresenterTile
              key={p.id}
              avatar={p}
              selected={value === p.id}
              onClick={() => onChange(p.id)}
              corner={
                p.provider_refs?.heygen?.ready ? (
                  <Badge className="shadow-[var(--via-shadow-sm)]">HeyGen</Badge>
                ) : null
              }
            />
          ))}
        </div>
      )}
      <NewAvatarDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(presenter) => onChange(presenter.id)}
      />
    </>
  );
}

/** O ref HeyGen do apresentador: o lido agora (polling) ou o salvo no cadastro. */
function useHeygenRef(presenter: AvatarRow | null, type: HeygenRef["type"], enabled: boolean) {
  const saved = presenter?.provider_refs?.heygen;
  const own = saved?.type === type ? saved : undefined;
  const status = useHeygenStatus(presenter?.id ?? null, enabled && Boolean(own) && !own?.ready);
  return status.data?.type === type ? status.data : own;
}

/** Visuais do apresentador: a look principal e as extras ("Novo visual"), sem as que falharam. */
function looksOf(ref: HeygenRef | undefined) {
  if (!ref) return [];
  return [
    { id: ref.look_id, preview: ref.preview_image_url ?? null, ready: ref.ready },
    ...(ref.looks ?? [])
      .filter((l) => l.status !== "failed")
      .map((l) => ({ id: l.id, preview: l.preview_image_url, ready: l.status === "completed" })),
  ];
}

/** Look escolhida (a principal por padrão); volta para a principal se a escolhida sumir. */
function useLookChoice(ref: HeygenRef | undefined) {
  const options = looksOf(ref);
  const [lookId, setLookId] = useState<string | null>(null);
  const picked = options.find((o) => o.id === lookId && o.ready)?.id ?? ref?.look_id ?? null;
  return { options, picked, setLookId };
}

/** Miniaturas dos visuais; só aparece quando há mais de um. */
function LookStrip({ choice }: { choice: ReturnType<typeof useLookChoice> }) {
  if (choice.options.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Visual">
      <span className="text-xs text-[var(--via-text-muted)]">Visual</span>
      {choice.options.map((o, i) => (
        <button
          key={o.id}
          type="button"
          disabled={!o.ready}
          onClick={() => choice.setLookId(o.id)}
          aria-pressed={choice.picked === o.id}
          aria-label={i === 0 ? "Visual principal" : `Visual ${i + 1}`}
          data-testid={`visual-${o.id}`}
          className={cn(
            "relative h-14 w-11 cursor-pointer overflow-hidden rounded-[8px] border border-[var(--via-border-soft)] bg-[var(--via-navy-06)] disabled:cursor-not-allowed disabled:opacity-50",
            choice.picked === o.id && "via-selected",
          )}
        >
          {o.preview ? (
            <img src={o.preview} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <UserRound className="mx-auto size-4 text-[var(--via-text-muted)]" aria-hidden="true" />
          )}
          {!o.ready ? (
            <Loader2
              className="absolute inset-0 m-auto size-4 animate-spin text-white"
              aria-hidden="true"
            />
          ) : null}
        </button>
      ))}
    </div>
  );
}

type SavedVoice = NonNullable<AvatarVoice["heygen_voice"]>;
/** "saved" · "elevenlabs" · "heygen" · `brand:<id>` (uma voz de Marca → Vozes) */
type VoicePick = string;

/** Voz salva no construtor, em poucas palavras ("Ana · HeyGen"). */
function useSavedVoiceLabel(saved: SavedVoice | null) {
  const wanted = saved?.provider === "heygen" && Boolean(saved.voice_id);
  const voices = useHeygenVoices(wanted);
  const clones = useHeygenClones(wanted);
  if (!saved) return null;
  if (saved.provider === "twin") return "a do clone";
  if (saved.provider === "elevenlabs") return "ElevenLabs";
  const name = [...(voices.data?.voices ?? []), ...(clones.data ?? [])].find(
    (v) => v.voice_id === saved.voice_id,
  )?.name;
  return name ? `${name} · HeyGen` : "HeyGen";
}

/**
 * Escolha da voz do vídeo: as opções do estúdio, as vozes da marca e "Criar
 * voz…". "saved" não manda `voice`: o servidor usa a do apresentador
 * (`voice.heygen_voice`, do construtor).
 */
function StudioVoice({
  options,
  value,
  loading = false,
  onChange,
  savedLabel,
  presenter,
}: {
  options: { value: VoicePick; label: string }[];
  /** null: nada marcado (a pessoa escolhe, ou a voz ainda está chegando) */
  value: VoicePick | null;
  loading?: boolean;
  onChange: (next: VoicePick) => void;
  savedLabel: string | null;
  presenter?: AvatarRow | null;
}) {
  const { group, chosen } = useCloneGroup(value, options);
  if (loading) {
    return (
      <p
        className="flex items-center gap-2 text-sm text-[var(--via-text-muted)]"
        role="status"
        data-testid="studio-voz-carregando"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Buscando a voz do avatar…
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor="st-voz" className="sr-only">
        Voz
      </Label>
      <div className="flex max-w-sm items-start gap-2">
        <VoiceSelect
          id="st-voz"
          value={value}
          onChange={(next) => onChange(next)}
          options={options}
          groups={[group]}
          prefer="heygen"
          presenterName={presenter?.name}
          avatarId={presenter?.id}
          className="min-w-0 flex-1"
        />
        <CloneListen voiceId={heygenVoiceIdOf(value)} url={chosen?.preview_audio_url ?? null} />
      </div>
      {value === "saved" && savedLabel ? (
        <p className="text-xs text-[var(--via-text-muted)]">Voz do apresentador: {savedLabel}.</p>
      ) : null}
    </div>
  );
}

/**
 * O escolhido e a voz dele, sempre à vista: a faixa acompanha a rolagem, logo
 * abaixo do cabeçalho do app.
 */
function ChosenRail({
  name,
  image,
  children,
}: {
  name: string;
  image: string | null;
  children: ReactNode;
}) {
  return (
    <div
      className="via-bar-glass sticky top-[var(--via-app-header)] z-10 -mx-6 flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-2.5"
      data-testid="studio-escolhido"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="relative block aspect-[3/4] w-9 shrink-0 overflow-hidden rounded-[var(--via-radius-xs)] bg-[var(--via-navy-06)]">
          {image ? (
            <img src={image} alt="" className="absolute inset-0 size-full object-cover" />
          ) : (
            <UserRound
              className="absolute inset-0 m-auto size-4 text-[var(--via-text-muted)]"
              aria-hidden="true"
            />
          )}
        </span>
        <span className="truncate text-sm font-medium text-[var(--via-text-primary)]">{name}</span>
      </span>
      <div className="min-w-0 flex-1 basis-56">{children}</div>
    </div>
  );
}

function PresenterRail({ presenter, children }: { presenter: AvatarRow; children: ReactNode }) {
  const portrait = useSignedUrl(AVATAR_BUCKET, presenterPortraitPath(presenter));
  return (
    <ChosenRail name={presenter.name} image={portrait.data ?? null}>
      {children}
    </ChosenRail>
  );
}

/** A lista de clones da conta HeyGen para o seletor, sem repetir o que já está nele. */
function useCloneGroup(value: VoicePick | null, options: { value: VoicePick }[]) {
  const clones = useHeygenClones(true).data ?? [];
  const brandVoices = useBrandVoices().data ?? [];
  const taken = new Set([
    ...brandVoices.flatMap((v) => (v.provider_voice_id ? [v.provider_voice_id] : [])),
    ...options.flatMap((o) => heygenVoiceIdOf(o.value) ?? []),
  ]);
  const chosen = clones.find((c) => c.voice_id === heygenVoiceIdOf(value)) ?? null;
  return {
    chosen,
    group: {
      label: "Vozes clonadas na HeyGen",
      options: listableClones(clones, taken).map((c) => ({
        value: heygenVoiceValue(c.voice_id),
        label: c.name,
      })),
    },
  };
}

/** "Ouvir" de uma voz da conta HeyGen: a prévia dela ou uma amostra na hora. */
function CloneListen({ voiceId, url }: { voiceId: string | null; url: string | null }) {
  const preview = useHeygenVoicePreview();
  if (!voiceId) return null;
  return (
    <ListenButton
      key={voiceId}
      url={url}
      load={async () =>
        (await preview.mutateAsync({ voice: { provider: "heygen", voice_id: voiceId } })).url
      }
    />
  );
}

/** Voz da conta HeyGen escolhida fica salva no apresentador para os próximos vídeos. */
function useRememberVoice() {
  const update = useUpdateAvatar();
  return (presenter: AvatarRow | null, pick: VoicePick) => {
    const voiceId = heygenVoiceIdOf(pick);
    if (!presenter || !voiceId || presenter.voice?.heygen_voice?.voice_id === voiceId) return;
    update.mutate({
      avatar_id: presenter.id,
      heygen_voice: { provider: "heygen", voice_id: voiceId },
    });
  };
}

/** `voice` do job (§1.3); uma voz da marca vai também como `brand_voice_id` (§9.5). */
function voicePayload(pick: VoicePick, voices: readonly BrandVoice[], saved: SavedVoice | null) {
  const heygen = explicitHeygenVoice(pick, saved);
  if (heygen) return { voice: heygen };
  if (pick === "saved") return {};
  const brandId = brandIdOf(pick);
  if (brandId) {
    const v = voices.find((x) => x.id === brandId);
    if (!v) return {};
    return {
      voice: {
        provider: v.provider,
        brand_voice_id: v.id,
        ...(v.provider_voice_id ? { voice_id: v.provider_voice_id } : {}),
      },
    };
  }
  return { voice: { provider: pick as "elevenlabs" | "heygen" } };
}

// ── §2 minha foto vira apresentador ─────────────────────────────────────────

function PhotoPresenterStudio({
  route,
  initialModelId,
}: {
  route: HubRoute;
  initialModelId: string | null;
}) {
  const engine = useHeygenEngine();
  const model = useStudioModel(route, initialModelId);
  const presenters = useAvatars("active");
  // a HeyGen e o Replicate animam uma foto de verdade (o retrato ou a 1ª do pack)
  const faces = useMemo(
    () =>
      (presenters.data ?? []).filter(
        (p) => Boolean(p.reference_image_path) || (p.identity_pack_paths?.length ?? 0) > 0,
      ),
    [presenters.data],
  );
  const [presenterId, setPresenterId] = useState<string | null>(null);
  const presenter = faces.find((p) => p.id === presenterId) ?? null;
  const [script, setScript] = useState("");
  const [plano, setPlano] = useState<PlanoDeProducao | null>(null);
  const campo = ferramentaDe(route.experience)?.campo ?? null;
  const viaHeygen = (model.picked?.choice.provider ?? "heygen") === "heygen";
  const ref = useHeygenRef(presenter, "photo", viaHeygen && engine.state === "ready");
  const looks = useLookChoice(ref);
  const saved = presenter?.voice?.heygen_voice ?? null;
  const savedPhoto = saved && saved.provider !== "twin" ? saved : null;
  const savedLabel = useSavedVoiceLabel(savedPhoto);
  const [manualVoice, setManualVoice] = useState<ManualVoice | null>(null);
  const brandVoices = useBrandVoices().data ?? [];
  const clones = useHeygenClones(viaHeygen && Boolean(presenter));
  const avatarVoice = resolveAvatarVoice({
    hasSaved: Boolean(savedPhoto),
    refVoice: ref?.default_voice_id,
    clones: clones.data ?? [],
    clonesLoading: clones.isLoading,
    names: presenter ? [presenter.name] : [],
  });
  const voice = voiceForSelection(manualVoice, presenter?.id ?? null, avatarVoice);
  const rememberVoice = useRememberVoice();
  const prepare = useHeygenPhotoAvatar();
  const { submit, pending } = useSubmitStudio();

  // o motor antigo não conhece o modo: nada vai para a fila antes do deploy
  const deployed = engine.state !== "not_deployed" && engine.state !== "checking";
  const blocker = !deployed
    ? engine.state === "checking"
      ? "Conferindo o motor…"
      : "Em preparação."
    : !model.picked
      ? "Nenhum modelo disponível para esta experiência."
      : viaHeygen && engine.state !== "ready"
        ? "A HeyGen precisa estar pronta para gerar."
        : !presenter
          ? "Escolha o apresentador."
          : viaHeygen && !ref?.ready
            ? "Prepare a foto na HeyGen antes de gerar."
            : viaHeygen && !voice
              ? avatarVoice.state === "loading"
                ? "Conferindo a voz do apresentador…"
                : "Escolha a voz."
              : !script.trim()
                ? "Escreva o roteiro."
                : null;

  const generate = () => {
    if (!presenter || !model.picked || blocker) return;
    if (viaHeygen) rememberVoice(presenter, voice ?? "");
    submit(titleFrom(script), {
      mode: "avatar_video",
      avatar_video: viaHeygen
        ? {
            provider: "heygen",
            presenter_id: presenter.id,
            ...(looks.picked ? { look_id: looks.picked } : {}),
            script: script.trim(),
            ...voicePayload(voice ?? "", brandVoices, savedPhoto),
            aspect_ratio: "9:16",
          }
        : {
            provider: "replicate",
            presenter_id: presenter.id,
            model_id: model.picked.choice.id,
            script: script.trim(),
            voice: { provider: "elevenlabs" },
          },
    });
  };

  return (
    <div className="space-y-8 pb-8" data-testid="studio-foto">
      {viaHeygen ? <EngineLine {...engine} /> : null}
      {presenter ? (
        <PresenterRail presenter={presenter}>
          {viaHeygen ? (
            <StudioVoice
              options={[
                ...(savedPhoto ? [{ value: "saved", label: "Voz do apresentador" }] : []),
                ...(avatarVoice.state === "found" && heygenVoiceIdOf(avatarVoice.pick)
                  ? [{ value: avatarVoice.pick, label: "Voz do apresentador" }]
                  : []),
                { value: "elevenlabs", label: "Voz da marca" },
              ]}
              value={voice}
              loading={avatarVoice.state === "loading" && !voice}
              onChange={(pick) => setManualVoice({ avatarId: presenter.id, pick })}
              savedLabel={savedLabel}
              presenter={presenter}
            />
          ) : null}
        </PresenterRail>
      ) : null}
      <Section id="st-foto" title="Apresentador">
        <PresenterPicker
          presenters={faces}
          loading={presenters.isLoading}
          value={presenterId}
          onChange={(id) => {
            setPresenterId(id);
            looks.setLookId(null);
          }}
          emptyText="Nenhum apresentador com foto ainda. Crie um com “Novo apresentador”."
        />
        {viaHeygen && presenter && engine.state === "ready" ? (
          <HeygenPrepLine
            presenter={presenter}
            heygen={ref}
            pending={prepare.isPending}
            onPrepare={() =>
              prepare.mutate(
                { avatar_id: presenter.id },
                { onError: (err) => toast.error(err.message) },
              )
            }
          />
        ) : null}
        {viaHeygen && ref?.ready ? <LookStrip choice={looks} /> : null}
      </Section>
      <Section id="st-roteiro" title={campo?.rotulo ?? "O que ele fala"}>
        <ScriptField
          id="st-script"
          label={campo?.rotulo ?? "O que ele fala"}
          value={script}
          onChange={setScript}
          max={AVATAR_SCRIPT_MAX}
          placeholder={campo?.placeholder ?? "O que o apresentador vai falar."}
          claude={{
            tipo: "roteiro",
            alvo: "foto",
            referencias: true,
            contexto: {
              ferramenta: route.experience,
              modelo: model.picked?.choice.id,
              max: AVATAR_SCRIPT_MAX,
              formato: "9:16",
              ...(presenter ? { apresentador: presenter.name } : {}),
              ...(viaHeygen ? {} : { voz: "voz da marca (ElevenLabs)" }),
            },
            onEntrega: (p) => setPlano(p.plano),
          }}
        />
        {plano ? <PlanoResumo plano={plano} /> : null}
      </Section>
      <GenerateBar
        route={route}
        model={model}
        blocker={blocker}
        pending={pending}
        onGenerate={generate}
        segundos={script.trim() ? Math.ceil(script.trim().length / LETRAS_POR_SEGUNDO) : null}
      />
    </div>
  );
}

// ── §3 meu clone (Digital Twin) ─────────────────────────────────────────────

function TwinStudio({ route, initialModelId }: { route: HubRoute; initialModelId: string | null }) {
  const engine = useHeygenEngine();
  const model = useStudioModel(route, initialModelId);
  const presenters = useAvatars("active");
  const list = presenters.data ?? [];
  const [presenterId, setPresenterId] = useState<string | null>(null);
  const presenter = list.find((p) => p.id === presenterId) ?? null;
  const ref = useHeygenRef(presenter, "digital_twin", engine.state === "ready");
  const [replacing, setReplacing] = useState(false);
  const [script, setScript] = useState("");
  const [plano, setPlano] = useState<PlanoDeProducao | null>(null);
  const campo = ferramentaDe(route.experience)?.campo ?? null;
  const looks = useLookChoice(ref);
  const saved = presenter?.voice?.heygen_voice ?? null;
  // "a do clone" salva é a mesma do chip "A minha voz": sem chip a mais
  const savedOther = saved && saved.provider !== "twin" ? saved : null;
  const savedLabel = useSavedVoiceLabel(savedOther);
  const [manualVoice, setManualVoice] = useState<ManualVoice | null>(null);
  const brandVoices = useBrandVoices().data ?? [];
  // sem outra voz salva, vale a voz do próprio clone, com o id quando o cadastro já o tem
  const twinPick = ref?.default_voice_id ? heygenVoiceValue(ref.default_voice_id) : "heygen";
  const voice =
    voiceForSelection(manualVoice, presenter?.id ?? null, {
      state: "found",
      pick: savedOther ? "saved" : twinPick,
    }) ?? twinPick;
  const rememberVoice = useRememberVoice();
  const { submit, pending } = useSubmitStudio();

  const showUpload = engine.state === "ready" && presenter && (!ref || replacing);
  const blocker =
    engine.state === "checking"
      ? "Conferindo a HeyGen…"
      : engine.state !== "ready"
        ? "A HeyGen precisa estar pronta para gerar."
        : !presenter
          ? "Escolha de quem é o clone."
          : !ref?.ready
            ? "O clone precisa estar pronto e autorizado."
            : !script.trim()
              ? "Escreva o roteiro."
              : null;

  const generate = () => {
    if (!presenter || blocker) return;
    rememberVoice(presenter, voice);
    submit(titleFrom(script), {
      mode: "avatar_video",
      avatar_video: {
        provider: "heygen",
        presenter_id: presenter.id,
        ...(looks.picked ? { look_id: looks.picked } : {}),
        script: script.trim(),
        ...voicePayload(voice, brandVoices, savedOther),
        // preferência: o servidor confere em supported_api_engines (§1.5)
        engine: engineOf(model.picked?.choice.id),
        aspect_ratio: "9:16",
      },
    });
  };

  return (
    <div className="space-y-8 pb-8" data-testid="studio-clone">
      <EngineLine {...engine} />
      {presenter ? (
        <PresenterRail presenter={presenter}>
          {ref?.ready ? (
            <StudioVoice
              options={[
                ...(savedOther ? [{ value: "saved", label: "Voz do apresentador" }] : []),
                { value: twinPick, label: "A minha voz (clonada)" },
                { value: "elevenlabs", label: "Voz da marca" },
              ]}
              value={voice}
              onChange={(pick) => setManualVoice({ avatarId: presenter.id, pick })}
              savedLabel={savedLabel}
              presenter={presenter}
            />
          ) : null}
        </PresenterRail>
      ) : null}
      <Section id="st-quem" title="De quem é o clone">
        <PresenterPicker
          presenters={list}
          loading={presenters.isLoading}
          value={presenterId}
          onChange={(id) => {
            setPresenterId(id);
            setReplacing(false);
            looks.setLookId(null);
          }}
          emptyText="Nenhum apresentador ainda. Crie um com “Novo apresentador”."
        />
      </Section>
      {showUpload ? (
        <Section id="st-video" title="Seu vídeo">
          <TwinUpload
            ensureAvatarId={() => Promise.resolve(presenter.id)}
            onCreated={() => setReplacing(false)}
          />
        </Section>
      ) : null}
      {presenter && ref && !replacing && engine.state === "ready" ? (
        <Section id="st-status" title="Clone">
          <TwinStatus avatarId={presenter.id} heygen={ref} onReplace={() => setReplacing(true)} />
          {ref.ready ? <LookStrip choice={looks} /> : null}
        </Section>
      ) : null}
      {ref?.ready ? (
        <Section id="st-roteiro" title={campo?.rotulo ?? "O que o clone fala"}>
          <ScriptField
            id="st-script"
            label={campo?.rotulo ?? "O que o clone fala"}
            value={script}
            onChange={setScript}
            max={AVATAR_SCRIPT_MAX}
            placeholder={campo?.placeholder ?? "O que o seu clone vai falar."}
            claude={{
              tipo: "roteiro",
              alvo: "clone",
              referencias: true,
              contexto: {
                ferramenta: route.experience,
                modelo: model.picked?.choice.id,
                max: AVATAR_SCRIPT_MAX,
                formato: "9:16",
                ...(presenter ? { apresentador: presenter.name } : {}),
              },
              onEntrega: (p) => setPlano(p.plano),
            }}
          />
          {plano ? <PlanoResumo plano={plano} /> : null}
        </Section>
      ) : null}
      <GenerateBar
        route={route}
        model={model}
        blocker={blocker}
        pending={pending}
        onGenerate={generate}
        segundos={script.trim() ? Math.ceil(script.trim().length / LETRAS_POR_SEGUNDO) : null}
      />
    </div>
  );
}

// ── §4 só a ideia, vídeo pronto (Video Agent) ───────────────────────────────

function VideoAgentStudio({ route }: { route: HubRoute }) {
  const engine = useHeygenEngine();
  const model = useStudioModel(route, null);
  const campo = ferramentaDe(route.experience)?.campo ?? null;
  const [idea, setIdea] = useState("");
  // o Video Agent só aceita voz HeyGen de catálogo (§9.5)
  const [voice, setVoice] = useState<VoicePick>("auto");
  const brandVoiceId = brandIdOf(voice);
  const heygenVoiceId = heygenVoiceIdOf(voice);
  const cloneChoice = useCloneGroup(voice, []);
  const { submit, pending } = useSubmitStudio();
  const blocker =
    engine.state === "checking"
      ? "Conferindo a HeyGen…"
      : engine.state !== "ready"
        ? "A HeyGen precisa estar pronta para gerar."
        : !idea.trim()
          ? "Descreva o vídeo."
          : null;
  const generate = () => {
    if (blocker) return;
    submit(titleFrom(idea), {
      mode: "video_agent",
      video_agent: {
        prompt: idea.trim(),
        orientation: "portrait",
        brand_kit: true,
        ...(brandVoiceId ? { brand_voice_id: brandVoiceId } : {}),
        ...(heygenVoiceId ? { voice_id: heygenVoiceId } : {}),
      },
    });
  };
  return (
    <div className="space-y-8 pb-8" data-testid="studio-agente">
      <EngineLine {...engine} />
      <Section id="st-ideia" title={campo?.rotulo ?? "A ideia"}>
        <ScriptField
          id="st-idea"
          label={campo?.rotulo ?? "A ideia do vídeo"}
          value={idea}
          onChange={setIdea}
          max={AGENT_PROMPT_MAX}
          seconds={false}
          placeholder={
            campo?.placeholder ??
            "ex.: um Reel de 30 s mostrando como a indústria cortou retrabalho sem contratar ninguém"
          }
          claude={{
            tipo: "ideia",
            alvo: "agente",
            contexto: {
              ferramenta: route.experience,
              modelo: model.picked?.choice.id,
              max: AGENT_PROMPT_MAX,
              formato: "9:16",
            },
          }}
        />
        <p className="text-xs text-[var(--via-text-muted)]">
          A marca vai junto: cores e logo vêm do site cadastrado.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="st-agent-voz" className="text-sm font-medium">
            Voz
          </Label>
          <div className="flex max-w-sm items-start gap-2">
            <VoiceSelect
              id="st-agent-voz"
              value={voice}
              onChange={(next) => setVoice(next)}
              options={[{ value: "auto", label: "Voz escolhida pelo Video Agent" }]}
              groups={[cloneChoice.group]}
              prefer="heygen"
              unusable={(v) =>
                v.provider !== "heygen" || v.source === "clone" ? "não vale no Video Agent" : null
              }
              className="min-w-0 flex-1"
            />
            <CloneListen
              voiceId={heygenVoiceId}
              url={cloneChoice.chosen?.preview_audio_url ?? null}
            />
          </div>
        </div>
      </Section>
      <GenerateBar
        route={route}
        model={model}
        blocker={blocker}
        pending={pending}
        onGenerate={generate}
      />
    </div>
  );
}

// ── reenquadrar e melhorar (Higgsfield): sem contrato ainda ────────────────

function ReframeStudio() {
  return (
    <section
      className="space-y-3 border-y border-[var(--via-border-soft)] py-4"
      data-testid="studio-reenquadrar"
    >
      <p className="text-sm font-medium text-[var(--via-text-primary)]">Em preparação.</p>
      <p className="text-xs text-[var(--via-text-muted)]">
        Você vai subir o vídeo, escolher o formato final (9:16 já marcado) e ligar “Mais nitidez”.
      </p>
      <Button size="lg" disabled>
        <Play aria-hidden="true" />
        Gerar vídeo
      </Button>
    </section>
  );
}
