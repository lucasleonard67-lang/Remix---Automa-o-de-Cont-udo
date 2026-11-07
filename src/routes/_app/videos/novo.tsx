import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ChevronDown, Loader2, Play, UserRoundPlus, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { NewAvatarDialog } from "@/components/avatars/new-avatar-dialog";
import { PresenterTile } from "@/components/avatars/presenter-tile";
import { BrandIcon } from "@/components/brand-icon";
import { useClaudeConnected } from "@/components/ai-role-grid";
import { toast } from "@/lib/toast";
import { humanizeError } from "@/lib/humanize-error";

import { artInk } from "@/lib/brand-ink";
import { normalizeBrandKitContent, useActiveVersion } from "@/hooks/use-versioned-brand";

import { PageEyebrow } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { GenerationGate } from "@/components/generation/generation-gate";
import { useGateResolution } from "@/components/generation/use-gate-resolution";
import { openIntegration } from "@/lib/integration-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  CAPTION_POSITION_OPTIONS,
  CAPTION_STYLE_OPTIONS,
  useCreateDirectorJob,
  type CaptionPosition,
  type CaptionStyle,
} from "@/hooks/use-director-jobs";
import { useAvatars, type AvatarRow } from "@/hooks/use-avatars";
import { useIsAdmin } from "@/hooks/use-is-admin";
import type { VideoBrief } from "@/hooks/use-video-brief";
import { ferramentaDe } from "@/lib/receitas-de-video";
import {
  atResolution,
  DIRECTOR_RESOLUTIONS,
  directorResolution,
  formatUsdRate,
  type DirectorResolution,
  type VideoModelOption,
  HIGGSFIELD_VIDEO_MODELS,
  useEngineStatus,
  useReplicateVideoModels,
  type VideoEngine,
} from "@/hooks/use-video-models";
import { HubStudio } from "@/components/video/heygen-studios";
import { PromptField } from "@/components/prompt/prompt-tools";
import { RemakeFlow } from "@/components/video/remake-flow";
import { VideoHub } from "@/components/video/video-hub";
import {
  HUB_WANTS,
  isModelParam,
  presenterHasFace,
  routeForWant,
  type HubRoute,
  type HubWant,
} from "@/lib/video-hub";
import {
  DIRECTOR_UNITS,
  directorDurationPlan,
  fitDirectorDuration,
  rankOptions,
  type GateOption,
  type GateSelection,
  type GateSignals,
} from "@/lib/generation-gate";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/videos/novo")({
  // ?brief=<texto> — dashboard e assistente chegam aqui com o tema já escrito
  // ?modo=melhorar — abre direto em "Melhorar um vídeo meu"
  // ?rota=<quero>&modelo=<id> — a rota do hub e o modelo escolhido nela
  validateSearch: (
    search: Record<string, unknown>,
  ): { brief?: string; modo?: "melhorar"; rota?: HubWant; modelo?: string } => ({
    ...(typeof search.rota === "string" && HUB_WANTS.includes(search.rota as HubWant)
      ? { rota: search.rota as HubWant }
      : {}),
    ...(isModelParam(search.modelo) ? { modelo: search.modelo } : {}),
    ...(typeof search.brief === "string" && search.brief.trim()
      ? { brief: search.brief.slice(0, 600) }
      : {}),
    ...(search.modo === "melhorar" ? { modo: "melhorar" as const } : {}),
  }),
  component: NovoVideoPage,
});

// ---------------------------------------------------------------------------
// Experiência dedicada de criação: o hub escolhe a rota; o Diretor abre só o
// que aquela rota precisa. "Vídeo de cenas": a ideia (o Claude da pessoa monta
// o briefing pelo conector) → tamanho → modelo. "Vídeo comigo nas cenas": o
// mesmo + apresentador com rosto, obrigatório. Ao enfileirar, volta pra /videos.
// ---------------------------------------------------------------------------

/** As duas experiências do Diretor (defeito 6: a rota decide o formulário). */
type DirectorVariant = "scenes" | "presenter";

// objetivo/publico/tom só entram como contexto do roteirista; ficam em "Ajustar briefing"
const BRIEF_DEFAULTS: VideoBrief = {
  objetivo: "Reel B2B case-study",
  publico: "",
  smp: "",
  numero_heroi: "",
  tom: "sóbrio, direto",
  cta: "",
};

const SCENE_COUNTS = [3, 4, 5, 6, 7, 8] as const;

function NovoVideoPage() {
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const { modo } = Route.useSearch();
  const navigate = useNavigate();
  const remake = modo === "melhorar";
  const { rota, modelo } = Route.useSearch();
  // veio do hub da tela inicial: a rota já está escolhida
  const [hubRoute, setHubRoute] = useState<HubRoute | null>(() =>
    rota ? routeForWant(rota) : null,
  );
  // o modelo escolhido no hub (padrão ou top): o destino já abre com ele marcado
  const [hubModel, setHubModel] = useState<string | null>(modelo ?? null);
  const setRemake = (next: boolean) =>
    void navigate({
      to: "/videos/novo",
      search: (prev) => ({ ...prev, modo: next ? ("melhorar" as const) : undefined }),
      replace: true,
    });

  if (adminLoading) return <Skeleton className="h-40 w-full" />;
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-3xl">
        <Alert>
          <AlertDescription>
            Só administradores acessam Vídeos. Peça acesso a um administrador da conta.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          <Link to="/videos">
            <ArrowLeft aria-hidden="true" /> Vídeos
          </Link>
        </Button>
        <div>
          <PageEyebrow />
          <h1 className="text-3xl font-medium tracking-[-0.025em] text-[var(--via-text-primary)]">
            {hubRoute && hubRoute.action.kind !== "remake" ? hubRoute.label : "Novo vídeo"}
          </h1>
          {hubRoute && ferramentaDe(hubRoute.experience) ? (
            <div className="mt-1 space-y-0.5" data-testid="ferramenta-faz">
              <p className="text-sm text-muted-foreground">
                {ferramentaDe(hubRoute.experience)!.faz}
              </p>
              <p className="text-sm text-[var(--via-text-muted)]">
                {ferramentaDe(hubRoute.experience)!.nao_faz}
              </p>
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              {remake
                ? "Suba um vídeo seu e escolha o que melhorar. Fala, gestos e câmera continuam os mesmos."
                : "Diga o que você tem e o que quer. A gente escolhe o caminho e mostra custo e tempo."}
            </p>
          )}
        </div>
      </div>
      {/* Hub: a pessoa diz o que tem e o que quer; o produto escolhe o
          provedor. O formulário certo abre embaixo, já com as opções marcadas. */}
      {hubRoute ? (
        <button
          type="button"
          onClick={() => setHubRoute(null)}
          className="text-sm text-[var(--via-accent)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]"
        >
          ← Mudar o que quero fazer
        </button>
      ) : (
        <VideoHub
          initialHave={remake ? "video" : "idea"}
          onRoute={(route, _have, model) => {
            setHubRoute(route);
            setHubModel(model?.id ?? null);
            setRemake(route.action.kind === "remake");
          }}
        />
      )}
      {hubRoute ? (
        hubRoute.action.kind === "remake" ? (
          <RemakeFlow
            key={hubRoute.want}
            initialOptions={hubRoute.action.options}
            initialModelId={hubModel}
          />
        ) : hubRoute.action.kind === "director" ? (
          <CreateVideoForm
            // trocar de rota recomeça o formulário (o apresentador não vaza entre as duas)
            key={hubRoute.want}
            variant={hubRoute.want === "presenter" ? "presenter" : "scenes"}
            initialModelId={hubModel}
          />
        ) : (
          <HubStudio key={hubRoute.want} route={hubRoute} initialModelId={hubModel} />
        )
      ) : null}
    </div>
  );
}

function CreateVideoForm({
  variant,
  initialModelId = null,
}: {
  variant: DirectorVariant;
  /** modelo das cenas escolhido no hub; some sozinho se não estiver na lista */
  initialModelId?: string | null;
}) {
  const create = useCreateDirectorJob();
  const navigate = useNavigate();
  const { brief: briefInicial } = Route.useSearch();
  const withPresenter = variant === "presenter";

  // a ideia vinda da URL entra no campo; o briefing nasce dela, pelo Claude da pessoa
  const [theme, setTheme] = useState(briefInicial?.trim() ?? "");
  const [brief, setBrief] = useState<VideoBrief>(BRIEF_DEFAULTS);
  const campo = ferramentaDe(variant === "presenter" ? "presenter_in_scenes" : "scenes")?.campo;
  const [rawDuration, setRawDuration] = useState("24");
  const [scenes, setScenes] = useState(5);
  const [budget, setBudget] = useState("320");
  // Teto de créditos: o backend trata budget_credits <= 0 como SEM LIMITE.
  const [noBudget, setNoBudget] = useState(false);
  const [gates, setGates] = useState({ keyframes: true, audio: true });
  const [skipVideo, setSkipVideo] = useState(false);
  const [abKling, setAbKling] = useState(false);
  const [identityId, setIdentityId] = useState<string | null>(null);
  // a: null = a Recomendada da lista; b = segunda marcada em "Comparar duas"
  const [selection, setSelection] = useState<GateSelection>({ a: initialModelId, b: null });
  const engineStatus = useEngineStatus();
  const replicate = useReplicateVideoModels();
  const presenters = useAvatars("active");
  const faces = useMemo(() => (presenters.data ?? []).filter(presenterHasFace), [presenters.data]);
  const presenter = withPresenter ? (faces.find((p) => p.id === identityId) ?? null) : null;

  // resolução pedida (config.resolution); null = a padrão do modelo (720p)
  const [wantedRes, setWantedRes] = useState<DirectorResolution | null>(null);
  // sem o login do Higgsfield, as cenas só podem ser do Replicate
  const higgsfieldOff = engineStatus.higgsfield === "off";
  const options = useMemo<GateOption[]>(
    () => [
      ...(higgsfieldOff ? [] : HIGGSFIELD_VIDEO_MODELS).map((o) => ({
        ...o,
        engine: "higgsfield" as const,
      })),
      // cada linha com o preço da resolução que vai de fato (cost.by_resolution)
      ...(replicate.data ?? []).map((o) => ({
        ...atResolution(o, fitResolution(o, wantedRes)),
        engine: "replicate" as const,
      })),
    ],
    [replicate.data, wantedRes, higgsfieldOff],
  );
  const { higgsfield: higgsfieldStatus, replicate: replicateStatus } = engineStatus;
  // Quadros e montagem: no Higgsfield (login), ou sem ele os quadros no Replicate
  // e a montagem e a legenda no Claude da pessoa (conector personalizado).
  const higgsfieldOn = higgsfieldStatus === "on";
  const claudeOn = useClaudeConnected();
  const peloClaude = higgsfieldOff && replicateStatus === "on" && claudeOn === true;
  const podeGerar = higgsfieldOn || peloClaude;

  // O modelo que a pessoa vai usar define a duração: a escolha explícita, ou a
  // Recomendada sem olhar a duração (1 s por cena não bloqueia ninguém).
  const intended = useMemo(() => {
    const explicit = selection.a ? options.find((o) => o.id === selection.a) : undefined;
    if (explicit) return explicit;
    const rows = rankOptions(options, {
      hasPresenter: presenter !== null,
      durationSeconds: scenes,
      scenes,
      isDraft: skipVideo,
      connected: { higgsfield: higgsfieldStatus, replicate: replicateStatus },
    });
    return rows.find((r) => r.badge === "recommended")?.option ?? rows[0]?.option ?? null;
  }, [options, selection.a, presenter, scenes, skipVideo, higgsfieldStatus, replicateStatus]);
  const durationPlan = directorDurationPlan(intended, scenes);
  // resolução que vai: o Higgsfield gera em 1080p; no Replicate, a escolhida
  // quando o modelo tem, senão a padrão dele (o servidor faz o mesmo ajuste)
  const resolutionChoices = intended?.engine === "replicate" ? directorResolutions(intended) : [];
  const sceneResolution =
    intended?.engine === "replicate"
      ? fitResolution(intended, wantedRes)
      : intended
        ? "1080p"
        : undefined;
  const durationSeconds = fitDirectorDuration(durationPlan, Number(rawDuration));

  const signals = useMemo<GateSignals>(
    () => ({
      hasPresenter: presenter !== null,
      durationSeconds,
      scenes,
      // "Gerar só os quadros" é o rascunho: o Recomendado vira o modelo barato
      isDraft: skipVideo,
      connected: { higgsfield: higgsfieldStatus, replicate: replicateStatus },
      // o servidor cobra por clipe: fala + 1 s, nunca abaixo de 4 s (defeito 24)
      units: DIRECTOR_UNITS,
    }),
    [presenter, durationSeconds, scenes, skipVideo, higgsfieldStatus, replicateStatus],
  );
  // Uma resolução só: o recibo e o payload saem do mesmo cálculo.
  const resolution = useGateResolution(options, selection, signals, abKling);
  const selected = resolution.a?.option ?? null;
  const ab = abKling ? (resolution.b?.option ?? null) : null;
  // as opções desta lista são só dos dois motores de cena
  const chosenEngine: VideoEngine = selected?.engine === "replicate" ? "replicate" : "higgsfield";
  // com o Higgsfield ligado, só o Replicate (cenas) pode faltar
  const missingEngine: VideoEngine | null =
    chosenEngine === "replicate" || ab?.engine === "replicate"
      ? replicateStatus === "off"
        ? "replicate"
        : null
      : null;

  const estimate = replicate.isLoading ? ({ kind: "loading" } as const) : undefined;
  const [captions, setCaptions] = useState<{
    on: boolean;
    style: CaptionStyle;
    position: CaptionPosition;
    accent: string;
  }>({ on: true, style: "caps", position: "bottom", accent: "#FFD400" });

  // A cor de destaque da legenda parte da marca; o usuário continua podendo trocar.
  const brandKit = normalizeBrandKitContent(useActiveVersion("brand_kit").data?.content ?? null);
  const acentoDaMarca = artInk(brandKit.palette).accent;
  const acentoAplicado = useRef(false);
  useEffect(() => {
    // uma vez só: depois disso a escolha é do usuário
    if (acentoAplicado.current || !acentoDaMarca) return;
    acentoAplicado.current = true;
    setCaptions((c) => ({ ...c, accent: acentoDaMarca }));
  }, [acentoDaMarca]);

  // o Claude entregou o briefing (saida do pedido): campo vazio mantém o que já havia
  const aplicarBriefing = (saida: Record<string, string> | null) => {
    if (!saida) return;
    setBrief((current) => ({
      objetivo: saida.objetivo?.trim() || current.objetivo,
      publico: saida.publico?.trim() || current.publico,
      smp: saida.smp?.trim() || current.smp,
      numero_heroi: saida.numero_heroi?.trim() || current.numero_heroi,
      tom: saida.tom?.trim() || current.tom,
      cta: saida.cta?.trim() || current.cta,
    }));
  };

  const set =
    (key: keyof VideoBrief) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setBrief((b) => ({ ...b, [key]: e.target.value }));

  // o que falta, em uma linha sob a estimativa; o botão só liga com tudo pronto
  const missing = [
    !theme.trim() ? "a ideia" : null,
    withPresenter && !presenter ? "o apresentador" : null,
  ].filter((item): item is string => item !== null);
  const missingNote = missing.length
    ? `Falta ${missing.length > 1 ? `${missing.slice(0, -1).join(", ")} e ${missing[missing.length - 1]}` : missing[0]}.`
    : undefined;

  const directorResolutionConfig = (model: VideoModelOption) => {
    const res = fitResolution(model, wantedRes);
    return isDirectorResolution(res) ? { resolution: res } : {};
  };

  const submit = () => {
    if (!podeGerar || missing.length) return;
    create.mutate(
      {
        brief: {
          objetivo: brief.objetivo,
          publico: brief.publico,
          // sem briefing do Claude, a ideia da pessoa é a mensagem do vídeo
          smp: brief.smp.trim() || theme.trim(),
          numero_heroi: brief.numero_heroi,
          tom: brief.tom,
          cta: brief.cta,
          duracao_alvo_s: durationSeconds,
          // fixos: o servidor lê, a pessoa não escolhe
          formato: "reels_conversion",
          identity_id: presenter?.id ?? null,
          mandatorios: ["sem logo no plano 1", "sem texto legível em cena"],
        },
        config: {
          max_shots: scenes,
          // Teto NEGATIVO virava 'sem limite' no backend; piso em 1 quando há teto.
          budget_credits: noBudget ? 0 : Math.max(1, Math.trunc(Number(budget) || 320)),
          auto_approve_keyframes: gates.keyframes,
          auto_approve_audio: gates.audio,
          skip_video: skipVideo,
          // o que está no recibo é o que vai: sem modelo B, não há cena extra
          ab_kling: abKling && ab !== null,
          engine: chosenEngine,
          model_id: selected?.id ?? null,
          // só cenas do Replicate escolhem resolução; o servidor ajusta ao modelo
          ...(chosenEngine === "replicate" && selected ? directorResolutionConfig(selected) : {}),
          ab_model_id: abKling ? (ab?.id ?? null) : null,
          // motor do B explícito: o servidor não precisa adivinhar pelo id
          ab_engine:
            abKling && ab && (ab.engine === "higgsfield" || ab.engine === "replicate")
              ? ab.engine
              : null,
          captions: captions.on,
          captions_style: captions.style,
          captions_position: captions.position,
          captions_accent: captions.accent,
        },
      },
      {
        onSuccess: () => {
          toast.success("Vídeo na fila. Acompanhe o progresso em Vídeos.");
          void navigate({ to: "/videos" });
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  let step = 0;
  const next = () => ++step;

  return (
    <div className="space-y-8 pb-8">
      {/* 1 · a ideia: a pessoa escreve do jeito dela; o Claude dela monta o briefing */}
      <section className="space-y-3" aria-labelledby="nv-briefing">
        <StepTitle id="nv-briefing" n={next()}>
          {campo?.rotulo ?? "A ideia"}
        </StepTitle>
        <div className="space-y-1.5">
          <Label htmlFor="nv-tema" className="sr-only">
            {campo?.rotulo ?? "A ideia"}
          </Label>
          <PromptField
            id="nv-tema"
            rows={3}
            kind="video"
            max={600}
            placeholder={campo?.placeholder}
            value={theme}
            onChange={setTheme}
            claude={{
              tipo: "briefing_cenas",
              alvo: variant === "presenter" ? "ideia-apresentador" : "ideia-cenas",
              contexto: {
                ferramenta: variant === "presenter" ? "presenter_in_scenes" : "scenes",
                modelo: selected?.id,
                max: 600,
                formato: "9:16",
                ...(presenter ? { apresentador: presenter.name } : {}),
              },
              onEntrega: (p) => aplicarBriefing(p.saida),
            }}
          />
        </div>

        <Disclosure label="Ver o briefing" testId="nv-ver-briefing">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="nv-smp">Mensagem</Label>
              <Textarea
                id="nv-smp"
                rows={2}
                placeholder="ex.: dá para cortar retrabalho sem contratar ninguém"
                value={brief.smp}
                onChange={set("smp")}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="nv-numero">Número que prova</Label>
                <Input
                  id="nv-numero"
                  placeholder="ex.: 40% menos retrabalho em 3 meses"
                  value={brief.numero_heroi}
                  onChange={set("numero_heroi")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nv-cta">Fala final</Label>
                <Input
                  id="nv-cta"
                  placeholder="ex.: a gente precisa conversar"
                  value={brief.cta}
                  onChange={set("cta")}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="nv-objetivo">Objetivo</Label>
                <Input id="nv-objetivo" value={brief.objetivo} onChange={set("objetivo")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nv-publico">Público</Label>
                <Input
                  id="nv-publico"
                  placeholder="ex.: donos de indústria PME"
                  value={brief.publico}
                  onChange={set("publico")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nv-tom">Tom</Label>
                <Input id="nv-tom" value={brief.tom} onChange={set("tom")} />
              </div>
            </div>
          </div>
        </Disclosure>
      </section>

      {withPresenter ? (
        <AvatarPicker
          n={next()}
          faces={faces}
          loading={presenters.isLoading}
          value={presenter?.id ?? null}
          onChange={setIdentityId}
        />
      ) : null}

      {/* tamanho: cenas e duração pelos limites do modelo escolhido; legendas */}
      <section className="space-y-4" aria-labelledby="nv-tamanho">
        <StepTitle id="nv-tamanho" n={next()}>
          Duração e legendas
        </StepTitle>
        <div className="space-y-2">
          <p className="text-sm font-medium text-[var(--via-text-primary)]">Cenas</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Número de cenas">
            {SCENE_COUNTS.map((count) => (
              <ChoiceChip
                key={count}
                selected={scenes === count}
                onClick={() => setScenes(count)}
                data-testid={`nv-cenas-${count}`}
              >
                {count}
              </ChoiceChip>
            ))}
          </div>
        </div>
        <DurationField
          plan={durationPlan}
          modelLabel={intended?.label ?? null}
          scenes={scenes}
          raw={rawDuration}
          value={durationSeconds}
          onChange={setRawDuration}
          resolution={resolutionChoices.length > 1 ? undefined : sceneResolution}
        />
        {resolutionChoices.length > 1 && intended ? (
          <ResolutionField
            model={intended}
            choices={resolutionChoices}
            value={sceneResolution}
            onChange={setWantedRes}
          />
        ) : null}
        <div className="space-y-2">
          <label className="flex items-center gap-2.5 text-sm font-medium">
            <Switch
              checked={captions.on}
              onCheckedChange={(v) => setCaptions((c) => ({ ...c, on: v }))}
              data-testid="switch-legendas"
            />
            Legendas no vídeo
          </label>
          {captions.on ? (
            <Disclosure label="Estilo da legenda" testId="nv-estilo-legenda">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="nv-cap-style">Estilo e animação</Label>
                  <Select
                    value={captions.style}
                    onValueChange={(v) => setCaptions((c) => ({ ...c, style: v as CaptionStyle }))}
                  >
                    <SelectTrigger id="nv-cap-style">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CAPTION_STYLE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nv-cap-pos">Posição</Label>
                  <Select
                    value={captions.position}
                    onValueChange={(v) =>
                      setCaptions((c) => ({ ...c, position: v as CaptionPosition }))
                    }
                  >
                    <SelectTrigger id="nv-cap-pos">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CAPTION_POSITION_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nv-accent">Cor de destaque</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="nv-accent"
                      type="color"
                      className="h-10 w-14 cursor-pointer p-1"
                      value={captions.accent}
                      onChange={(e) =>
                        setCaptions((c) => ({ ...c, accent: e.target.value.toUpperCase() }))
                      }
                    />
                    <span className="text-xs text-muted-foreground">{captions.accent}</span>
                  </div>
                </div>
              </div>
            </Disclosure>
          ) : null}
        </div>
      </section>

      {/* avançado: o que a maioria não mexe */}
      <Disclosure label="Avançado" testId="nv-avancado">
        <div className="space-y-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="nv-budget">Teto de créditos</Label>
                <Input
                  id="nv-budget"
                  type="number"
                  min={1}
                  className="w-32"
                  value={noBudget ? "" : budget}
                  onChange={(e) => setBudget(e.target.value)}
                  disabled={noBudget}
                  placeholder={noBudget ? "sem limite" : undefined}
                  aria-describedby="nv-budget-help"
                />
              </div>
              <label className="flex h-10 items-center gap-2.5 text-sm">
                <Switch
                  checked={noBudget}
                  onCheckedChange={setNoBudget}
                  data-testid="switch-sem-teto"
                  aria-describedby="nv-budget-help"
                />
                Sem teto
              </label>
            </div>
            <p id="nv-budget-help" className="text-xs text-muted-foreground">
              Vale só para o Higgsfield: cenas do Replicate não entram no teto.
              {noBudget
                ? " A produção vai até o fim, sem parar por gasto."
                : ` A produção para ao passar de ${Number(budget) || 320} créditos.`}
            </p>
          </div>
          <div className="flex flex-col gap-3 text-sm">
            <label className="flex items-center gap-2">
              <Switch
                checked={!gates.keyframes}
                onCheckedChange={(v) => setGates((g) => ({ ...g, keyframes: !v }))}
              />
              Revisar os quadros antes das cenas
            </label>
            <label className="flex items-center gap-2">
              <Switch
                checked={!gates.audio}
                onCheckedChange={(v) => setGates((g) => ({ ...g, audio: !v }))}
              />
              Revisar o som antes de finalizar
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={skipVideo} onCheckedChange={setSkipVideo} />
              Só os quadros (teste barato)
            </label>
            <label className="flex items-center gap-2">
              <Switch
                checked={abKling}
                onCheckedChange={setAbKling}
                data-testid="switch-comparar"
              />
              Comparar dois modelos no primeiro trecho (não entra no vídeo final)
            </label>
          </div>
        </div>
      </Disclosure>

      {podeGerar ? (
        <GenerationGate
          data-testid="generation-gate"
          task="Cenas do vídeo"
          basis={`${durationSeconds} s de cena · ${scenes} cenas`}
          resolution={resolution}
          onSelect={setSelection}
          // "Comparar" liga em Avançado; aqui só aparece para escolher o B
          compare={abKling ? { enabled: true, onToggle: setAbKling } : null}
          onConnect={(provider) =>
            openIntegration(provider === "replicate" ? "replicate" : "higgsfield")
          }
          estimate={estimate}
          loading={replicate.isLoading}
          error={replicate.isError}
          // Só admin chega aqui: verifica os modelos no modal do Replicate, sem sair da tela.
          emptyAction={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openIntegration("replicate")}
            >
              Verificar modelos
            </Button>
          }
          connectAction={
            missingEngine
              ? { integration: missingEngine, onClick: () => openIntegration(missingEngine) }
              : null
          }
          note={
            missingNote ??
            (peloClaude ? "No fim, o seu Claude monta e legenda o vídeo." : undefined)
          }
          action={{
            label: "Gerar vídeo",
            onClick: submit,
            pending: create.isPending,
            disabled: missing.length > 0,
            icon: <Play aria-hidden="true" />,
            testId: "btn-gerar-video",
          }}
        />
      ) : (
        <MontageRequired
          checking={
            higgsfieldStatus === "loading" || replicateStatus === "loading" || claudeOn === null
          }
          replicateOn={replicateStatus === "on"}
        />
      )}
    </div>
  );
}

/**
 * Sem o login do Higgsfield, o vídeo de cenas precisa do Replicate (cenas e
 * quadros) e do Claude da pessoa (montagem e legenda): um bloco, uma ação, a
 * do que falta primeiro.
 */
function MontageRequired({ checking, replicateOn }: { checking: boolean; replicateOn: boolean }) {
  return (
    <section
      className="flex flex-wrap items-center justify-between gap-4 border-y border-[var(--via-border-soft)] py-4"
      data-testid="nv-montagem-obrigatoria"
      aria-live="polite"
    >
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-[var(--via-text-primary)]">
          {checking
            ? "Conferindo as conexões…"
            : replicateOn
              ? "Conecte o Claude para montar o vídeo"
              : "Conecte o Replicate para gerar as cenas"}
        </p>
        {checking ? null : (
          <p className="text-xs text-[var(--via-text-muted)]">
            O Replicate gera as cenas e os quadros; o seu Claude monta e legenda no fim.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {checking ? null : replicateOn ? (
          <Button asChild data-testid="btn-conectar-motor">
            <Link to="/config" search={{ aba: "integracoes" }}>
              <BrandIcon name="claude" />
              Conectar o Claude
            </Link>
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => openIntegration("replicate")}
            data-testid="btn-conectar-motor"
          >
            <BrandIcon name="replicate" />
            Conectar Replicate
          </Button>
        )}
        <Button size="lg" variant="outline" disabled data-testid="btn-gerar-video">
          <Play aria-hidden="true" />
          Gerar vídeo
        </Button>
      </div>
    </section>
  );
}

/** Resoluções do modelo que o Diretor aceita em `config.resolution`, na ordem. */
function directorResolutions(model: Pick<VideoModelOption, "resolutions">): DirectorResolution[] {
  const list = (model.resolutions ?? []).map((r) => r.toLowerCase());
  return DIRECTOR_RESOLUTIONS.filter((r) => list.includes(r));
}

/** A pedida, se o modelo tem; senão a padrão dele (720p ou a primeira). */
function fitResolution(
  model: Pick<VideoModelOption, "resolutions">,
  wanted: DirectorResolution | null,
): string | undefined {
  return wanted && directorResolutions(model).includes(wanted) ? wanted : directorResolution(model);
}

/** `config.resolution` só com um valor que o Diretor aceita; senão, o padrão do servidor. */
function isDirectorResolution(value: string | undefined): value is DirectorResolution {
  return (DIRECTOR_RESOLUTIONS as readonly string[]).includes(value ?? "");
}

/** Resolução das cenas: um chip por resolução, com o preço por segundo de cada. */
function ResolutionField({
  model,
  choices,
  value,
  onChange,
}: {
  model: VideoModelOption;
  choices: DirectorResolution[];
  value: string | undefined;
  onChange: (next: DirectorResolution) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-[var(--via-text-primary)]">Resolução</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Resolução">
        {choices.map((res) => {
          const rate = model.costUnverified ? null : model.usdByResolution?.[res];
          return (
            <ChoiceChip
              key={res}
              selected={value === res}
              onClick={() => onChange(res)}
              data-testid={`nv-res-${res}`}
            >
              {res}
              {rate != null ? ` · ${formatUsdRate(rate)}` : ""}
            </ChoiceChip>
          );
        })}
      </div>
    </div>
  );
}

/** Duração pelo modelo: blocos fixos viram chips; faixa contínua vira um número preso à faixa. */
function DurationField({
  plan,
  modelLabel,
  scenes,
  raw,
  value,
  onChange,
  resolution,
}: {
  plan: ReturnType<typeof directorDurationPlan>;
  modelLabel: string | null;
  scenes: number;
  raw: string;
  value: number;
  onChange: (next: string) => void;
  /** resolução em que as cenas saem (do modelo escolhido) */
  resolution?: string;
}) {
  const inRes = resolution ? ` · em ${resolution}` : "";
  if (plan.kind === "blocks") {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-[var(--via-text-primary)]">Duração por cena</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Duração por cena">
          {plan.blocks.map((block) => (
            <ChoiceChip
              key={block.seconds}
              selected={value === block.total}
              onClick={() => onChange(String(block.total))}
              data-testid={`nv-bloco-${block.seconds}`}
            >
              {block.seconds} s
            </ChoiceChip>
          ))}
        </div>
        <p className="text-xs text-[var(--via-text-muted)]">
          {modelLabel ? `${modelLabel} gera cenas de ` : "Cenas de "}
          {plan.blocks.map((b) => b.seconds).join(" ou ")} s · ≈ {value} s no total{inRes}
        </p>
      </div>
    );
  }
  const adjusted = raw.trim() !== "" && Number(raw) !== value;
  return (
    <div className="space-y-1.5">
      <Label htmlFor="nv-dur">Duração total (s)</Label>
      <Input
        id="nv-dur"
        type="number"
        min={plan.min}
        max={plan.max}
        className="w-32"
        value={raw}
        onChange={(e) => onChange(e.target.value)}
        // mostra o valor real antes de gerar
        onBlur={() => onChange(String(value))}
        aria-describedby="nv-dur-help"
      />
      <p id="nv-dur-help" className="text-xs text-[var(--via-text-muted)]">
        {plan.min}–{plan.max} s com {scenes} cenas
        {plan.perSceneMax != null && modelLabel
          ? ` (${modelLabel}: até ${plan.perSceneMax} s por cena)`
          : ""}
        {adjusted ? ` · vai com ${value} s` : ""}
        {inRes}
      </p>
    </div>
  );
}

function StepTitle({ id, n, children }: { id: string; n: number; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="flex items-center gap-2.5 text-base font-medium text-[var(--via-text-primary)]"
    >
      <span className="flex size-6 items-center justify-center rounded-full border border-[var(--via-border)] font-mono text-xs text-[var(--via-text-muted)]">
        {n}
      </span>
      {children}
    </h2>
  );
}

/** Divulgação progressiva: um gatilho discreto e o conteúdo abaixo, sem caixa. */
function Disclosure({
  label,
  testId,
  children,
}: {
  label: string;
  testId?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="space-y-3">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 text-[var(--via-text-muted)]"
          data-testid={testId}
        >
          {label}
          <ChevronDown
            aria-hidden="true"
            className={cn("transition-transform duration-200", open && "rotate-180")}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// Seletor de apresentador ("Vídeo comigo nas cenas"): crachás com foto e nome,
// seleção por halo navy. Obrigatório: só entra quem tem rosto (foto ou o
// personagem Higgsfield pronto); sem nenhum, o cadastro abre aqui mesmo.
// ---------------------------------------------------------------------------

function AvatarPicker({
  n,
  faces,
  loading,
  value,
  onChange,
}: {
  n: number;
  faces: AvatarRow[];
  loading: boolean;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  // "Novo apresentador" abre o cadastro aqui mesmo e já seleciona quem nasceu.
  const [creating, setCreating] = useState(false);
  // um só com rosto (ou o padrão): já nasce marcado
  const autoPicked = useRef(false);
  useEffect(() => {
    if (autoPicked.current || value || faces.length === 0) return;
    autoPicked.current = true;
    onChange((faces.find((p) => p.is_default) ?? faces[0]).id);
  }, [faces, value, onChange]);
  const chosen = faces.find((p) => p.id === value);
  const firstTime = chosen && chosen.provider_refs?.higgsfield?.status !== "ready";

  return (
    <section className="space-y-3" aria-labelledby="nv-apresentador" data-testid="avatar-picker">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <StepTitle id="nv-apresentador" n={n}>
          Apresentador
        </StepTitle>
        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
          <UserRoundPlus aria-hidden="true" /> Novo apresentador
        </Button>
      </div>
      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Skeleton className="aspect-[3/4] rounded-[14px]" />
          <Skeleton className="aspect-[3/4] rounded-[14px]" />
          <Skeleton className="aspect-[3/4] rounded-[14px]" />
        </div>
      ) : faces.length === 0 ? (
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-[var(--via-text-muted)]">
          Nenhum apresentador com foto ainda.
          <Link
            to="/marca/avatares"
            className="font-medium text-[var(--via-accent)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]"
          >
            Abrir Apresentadores
          </Link>
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {faces.map((presenter) => (
            <PresenterTile
              key={presenter.id}
              avatar={presenter}
              selected={value === presenter.id}
              onClick={() => onChange(presenter.id)}
              corner={
                value === presenter.id ? (
                  <Badge className="shadow-[var(--via-shadow-sm)]">Selecionado</Badge>
                ) : null
              }
            />
          ))}
        </div>
      )}
      {firstTime ? (
        <p className="text-xs text-[var(--via-text-muted)]">
          Primeira vez com {chosen.name}: o Higgsfield prepara o rosto antes das cenas, e a geração
          demora mais.
        </p>
      ) : null}
      <NewAvatarDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(presenter) => onChange(presenter.id)}
      />
    </section>
  );
}
