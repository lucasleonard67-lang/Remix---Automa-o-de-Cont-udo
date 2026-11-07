import { AiChoiceLine } from "@/components/ai-choice-line";
import { useClaudeConnected } from "@/components/ai-role-grid";
import { ArrowRight, ChevronDown, Globe, Loader2, Newspaper, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import "@/components/analytics/analytics.css";

import { ChannelsDialog } from "@/components/channels/channels-grid";
import {
  ChannelTiles,
  ChannelTilesSkeleton,
  ChannelsEmpty,
} from "@/components/criar/channel-tiles";
import { readStoredCreateJob, storeCreateJob } from "@/components/criar/create-job-storage";
import {
  BRIEF_FIELD_ID,
  KIND_CHANNELS,
  intentKey,
  type CreateKind,
  type CreateSearch,
} from "@/components/criar/create-search";
import { CreationStage } from "@/components/criar/creation-stage";
import { FormatChips } from "@/components/criar/format-chips";
import { FormatTiles } from "@/components/criar/format-tiles";
import { ChannelIcon } from "@/components/criar/channel-tiles";
import { FORMAT_LABELS } from "@/components/criar/formats";
import { TodayIdeas } from "@/components/criar/today-ideas";
import { useTodayIdeas, type PickedIdea } from "@/components/criar/use-today-ideas";
import type { TodayIdea } from "@/lib/today-ideas";
import { Reveal, prefersReducedMotion } from "@/components/dashboard/motion";
import { PageEyebrow } from "@/components/page-header";
import { PromptTools } from "@/components/prompt/prompt-tools";
import { SetupFlow } from "@/components/setup/setup-flow";
import { Button } from "@/components/ui/button";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAppSetting, type WebSearchSetting } from "@/hooks/use-app-settings";
import { composeBrief, useMarkItemUsed, useRssItem } from "@/hooks/use-rss";
import { CHANNEL_TYPE_LABELS, useChannels, type ChannelType } from "@/hooks/use-channels";
import { useDashboardSetup } from "@/hooks/use-dashboard-setup";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useCreateGenerationJob, useGenerationJobsRealtime } from "@/hooks/use-generation-jobs";
import { useActiveVersion } from "@/hooks/use-versioned-brand";
import { cn } from "@/lib/utils";

/** Escolha de quem cria: Texto pelo Claude via conector personalizado (neste navegador). */
const CONECTOR_KEY = "ce-criar-conector";

// ---------------------------------------------------------------------------
// O criador mora na HOME. Título grande, a linha de formatos como porta de
// entrada, o briefing num campo de vidro com o Gerar dentro e, abaixo, o
// resumo dos canais marcados (os ladrilhos detalhados ficam atrás de "Ajustar
// canais"). Ao Gerar, a CreationStage toma o lugar do campo: o usuário não
// sai da página. Uma ideia clicada em "Ideias para hoje" chega por
// ?brief=/?radar= e preenche o campo aqui mesmo.
//
// Em /criar (picker "tiles") a porta de entrada são as "Sugestões para hoje":
// a melhor já vem escolhida, com o formato sugerido e os canais marcados — o
// próximo passo é só Gerar. O campo é opcional ("ou escreva o seu tema") e
// os ladrilhos de formato ficam logo abaixo para ajustar. Um canal desligado
// liga ali mesmo. A lógica de geração é a mesma nos dois.
// ---------------------------------------------------------------------------

/** Porta de entrada: chips (home) ou ladrilhos com amostra (/criar). */
export type CreatorPicker = "chips" | "tiles";

/** Mesmo teto do generate-content (MAX_PROMPT_CHARS). */
const BRIEF_MAX_CHARS = 4000;

export function Creator({
  revealIndex,
  search,
  onClearSearch,
  onActiveJobChange,
  title = "O que você quer criar hoje?",
  subtitle = "Descreva o tema, marque os canais e clique em Gerar.",
  picker = "chips",
}: {
  revealIndex: number;
  title?: string;
  subtitle?: string;
  picker?: CreatorPicker;
  search: CreateSearch;
  /** Limpa a URL (depois de Gerar, ao desanexar) ou só o ?brief (ao editar). */
  onClearSearch: (only?: "brief") => void;
  /** Geração em cena (ou null): a home não a repete no trilho de recentes. */
  onActiveJobChange?: (jobId: string | null) => void;
}) {
  // Canal Realtime da lista (UPDATE em jobs, INSERT em peças) + fallback polling.
  useGenerationJobsRealtime();

  // Mínimo viável do motor: persona, bandeira e guardrails com versão ativa.
  const persona = useActiveVersion("brand_persona");
  const strategy = useActiveVersion("brand_strategy");
  const guardrails = useActiveVersion("guardrails");
  const readinessLoading = persona.isLoading || strategy.isLoading || guardrails.isLoading;
  const missing = [
    ...(persona.data ? [] : ["persona"]),
    ...(strategy.data ? [] : ["bandeira"]),
    ...(guardrails.data ? [] : ["regras da marca"]),
  ];
  const ready = !readinessLoading && missing.length === 0;

  // A ação abre aqui mesmo: o fluxo de configuração em modal, no passo 1 se a
  // leitura da marca nunca rodou, ou no 5 (Marca pronta) se já rodou.
  const autopilot = useAppSetting<{ status?: unknown }>("brand_autopilot");
  const autopilotIdle =
    !autopilot.data || autopilot.data.status === "idle" || autopilot.data.status === undefined;
  const [setupOpen, setSetupOpen] = useState(false);

  // A criação em andamento (ou pronta) fica aqui; recarregar volta para ela.
  const [activeJob, setActiveJob] = useState<string | null>(() => readStoredCreateJob());
  const startJob = (id: string) => {
    setActiveJob(id);
    // o que veio pela URL já virou geração: não pode voltar ao campo depois
    onClearSearch();
  };
  const restart = () => setActiveJob(null);
  // Efeitos colaterais do job em cena fora do render: storage e a home.
  useEffect(() => {
    storeCreateJob(activeJob);
    onActiveJobChange?.(activeJob);
  }, [activeJob, onActiveJobChange]);

  // Com "Primeiros passos" na tela (admin, configuração incompleta), o
  // "Continuar" de lá já abre o fluxo: aqui fica só o aviso, sem segundo botão.
  const setup = useDashboardSetup();
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const firstStepsVisible =
    !adminLoading && isAdmin && !setup.isLoading && !setup.allDone && Boolean(setup.next);

  // Uma intenção nova pela URL (?brief/?radar/?kind/?channel) enquanto uma
  // criação está na tela: o usuário quer criar outra — a geração anterior
  // continua no servidor. Só reage a intenção NOVA: a que acabou de virar
  // geração não derruba a etapa.
  const intent = intentKey(search);
  const [intentApplied, setIntentApplied] = useState<string | null>(null);
  if (intent && intent !== intentApplied) {
    setIntentApplied(intent);
    if (activeJob) restart();
  } else if (!intent && intentApplied) {
    setIntentApplied(null);
  }

  return (
    <div className="space-y-8">
      <Reveal index={revealIndex}>
        <header className="space-y-2">
          <PageEyebrow />
          <h1 className="text-3xl font-medium tracking-[-0.025em] text-[var(--via-text-primary)]">
            {title}
          </h1>
          <p className="text-sm text-[var(--via-text-muted)]">{subtitle}</p>
        </header>
      </Reveal>

      {!readinessLoading && missing.length > 0 ? (
        <Reveal index={revealIndex + 1}>
          <div
            role="status"
            className="via-row-card via-row-signature flex flex-wrap items-center gap-3 rounded-[var(--via-radius-md)] !px-4 !py-3"
          >
            <ShieldAlert
              className="size-4 shrink-0 text-[var(--via-text-muted)]"
              aria-hidden="true"
            />
            <p className="min-w-0 flex-1 text-sm text-[var(--via-text-body)]">
              {firstStepsVisible
                ? "Complete a marca em Primeiros passos para gerar."
                : `Falta ativar ${missing.join(", ")}. Sem isso, o botão Gerar fica bloqueado.`}
            </p>
            {firstStepsVisible ? null : (
              <Button
                size="sm"
                onClick={() => setSetupOpen(true)}
                disabled={autopilot.isLoading}
                aria-haspopup="dialog"
              >
                Configurar minha marca
              </Button>
            )}
          </div>
        </Reveal>
      ) : null}

      <SetupFlow open={setupOpen} onOpenChange={setSetupOpen} initialStep={autopilotIdle ? 1 : 5} />

      {activeJob ? (
        <Reveal index={revealIndex + 2}>
          <CreationStage jobId={activeJob} onRestart={restart} />
        </Reveal>
      ) : (
        <CommandBox
          ready={ready}
          onStarted={startJob}
          search={search}
          onClearSearch={onClearSearch}
          revealIndex={revealIndex + 2}
          picker={picker}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comando: briefing em vidro + Gerar, ladrilhos de canais
// ---------------------------------------------------------------------------

export function CommandBox({
  ready,
  onStarted,
  search,
  onClearSearch,
  revealIndex,
  picker = "chips",
}: {
  ready: boolean;
  onStarted: (jobId: string) => void;
  search: CreateSearch;
  onClearSearch: (only?: "brief") => void;
  revealIndex: number;
  picker?: CreatorPicker;
}) {
  const { radar: radarId, brief, kind, channel } = search;
  const radarQuery = useRssItem(radarId);
  const noticia = radarQuery.data ?? null;
  const markUsed = useMarkItemUsed();
  // Texto pelo Claude da assinatura (conector personalizado): escolha de quem
  // cria, guardada neste navegador. Por enquanto o Claude entrega só carrossel.
  const estadoConector = useClaudeConnected();
  const claudeConnected = estadoConector === true;
  const [conectorEscolhido, setConectorEscolhido] = useState(() => {
    try {
      return window.localStorage.getItem(CONECTOR_KEY) === "1";
    } catch {
      return false;
    }
  });
  const escolherConector = (on: boolean) => {
    setConectorEscolhido(on);
    try {
      window.localStorage.setItem(CONECTOR_KEY, on ? "1" : "0");
    } catch {
      // sem armazenamento: vale só nesta visita
    }
  };
  const [briefingDoRadar, setBriefingDoRadar] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(brief ?? "");
  // null no início: o ?brief da primeira pintura também rola e foca.
  const [briefApplied, setBriefApplied] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<ChannelType>>(new Set());
  // ?kind/?channel guardados ao chegar: a pré-marcação espera a lista de
  // canais e não pode depender da URL (editar o texto limpa o ?brief).
  const [kindWanted, setKindWanted] = useState<CreateKind | null>(kind ?? null);
  const [channelWanted, setChannelWanted] = useState<ChannelType | null>(channel ?? null);
  if (kind && kind !== kindWanted) setKindWanted(kind);
  if (channel && channel !== channelWanted) setChannelWanted(channel);
  const [kindApplied, setKindApplied] = useState<CreateKind | null>(null);
  // null = usuário ainda não mexeu → DESLIGADA por padrão: a pesquisa web custa
  // tempo e crédito e nem toda pauta precisa de dado fresco. Quem quer, liga.
  const [webSearchChoice, setWebSearchChoice] = useState<boolean | null>(null);
  // "Ligar canais" abre a grade de canais em modal; os ladrilhos atualizam
  // sozinhos quando o modal fecha (mesma query dos canais).
  const [channelsOpen, setChannelsOpen] = useState(false);
  // Ladrilhos detalhados dos canais: recolhidos; os chips já fazem a escolha.
  const [tilesOpen, setTilesOpen] = useState(false);
  const { isAdmin } = useIsAdmin();
  const channelsQuery = useChannels();
  const tiles = picker === "tiles";
  // /criar: sugestões do dia (Radar + mercado). A escolhida dá o tema (o campo
  // pode ficar vazio) e o formato; `pendingFormat` é o formato sugerido cujo
  // canal está desligado — ligado no modal, ele entra marcado sozinho.
  const today = useTodayIdeas();
  const [picked, setPicked] = useState<PickedIdea | null>(null);
  const [pendingFormat, setPendingFormat] = useState<ChannelType | null>(null);
  const [defaultsApplied, setDefaultsApplied] = useState(false);
  // A sugestão vale enquanto o campo está vazio; escrever substitui.
  const pickedId = picked && !prompt.trim() ? picked.idea.id : null;
  const webSearchSetting = useAppSetting<WebSearchSetting>("web_search");
  const createJob = useCreateGenerationJob();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  // Texto que chegou pela URL (ideia clicada, notícia): rolar até o campo e focar.
  const bringIntoView = useRef(false);

  // Reel é vídeo: mora em /videos/novo, não entra na escolha de peça estática
  const enabledChannels = (channelsQuery.data ?? []).filter(
    (channel) => channel.enabled && channel.type !== "instagram_reel",
  );
  const enabledTypes = new Set<ChannelType>(enabledChannels.map((channel) => channel.type));

  // Escolher uma sugestão: tema no lugar + só o formato sugerido marcado (se o
  // canal estiver desligado, ele fica pendente e a linha oferece "Ligar canal").
  const applyIdea = (idea: TodayIdea) => {
    setPicked(today.pick(idea));
    setPrompt("");
    if (enabledTypes.has(idea.format)) {
      setSelected(new Set([idea.format]));
      setPendingFormat(null);
    } else {
      setSelected(new Set());
      setPendingFormat(idea.format);
    }
  };
  const pickIdea = (idea: TodayIdea) => {
    applyIdea(idea);
    // o que veio pela URL dá lugar à escolha feita aqui
    if (brief || radarId || kind || channel) onClearSearch();
  };

  // Chegada em /criar sem intenção na URL: a melhor sugestão já vem escolhida
  // (formato e canal marcados) — sobra só o Gerar. Sem sugestão, o formato do
  // seu melhor resultado fica marcado, se o canal estiver ligado.
  if (tiles && !defaultsApplied && channelsQuery.data && !today.isLoading && !intentKey(search)) {
    setDefaultsApplied(true);
    if (today.ideas[0]) applyIdea(today.ideas[0]);
    else if (selected.size === 0 && enabledTypes.has(today.recommended)) {
      setSelected(new Set([today.recommended]));
    }
  }
  // O canal pendente acabou de ser ligado (modal no lugar): entra marcado.
  if (pendingFormat && enabledTypes.has(pendingFormat)) {
    setPendingFormat(null);
    setSelected(new Set([...selected, pendingFormat]));
  }

  // ?brief= novo (uma ideia clicada com o campo já na tela) substitui o texto:
  // o clique foi explícito. Quando o ?brief sai da URL (Gerar, edição), a
  // marca zera — reclicar a mesma ideia é intenção nova e preenche de novo.
  if (brief && briefApplied !== brief) {
    setBriefApplied(brief);
    setPrompt(brief);
    bringIntoView.current = true;
  } else if (!brief && briefApplied) {
    setBriefApplied(null);
  }

  // Notícia recém-carregada preenche o briefing uma única vez; depois o texto é
  // do usuário (ele veio para cá justamente para editar antes de gerar).
  if (noticia && briefingDoRadar !== noticia.id) {
    setBriefingDoRadar(noticia.id);
    // A notícia chega DEPOIS do primeiro render (query assíncrona) e o campo
    // já está habilitado: sobrescrever apagaria o que o usuário digitou nesse
    // meio-tempo. Só preenche o que está vazio.
    if (!prompt.trim()) {
      setPrompt(composeBrief(noticia));
      bringIntoView.current = true;
    }
  }

  // ?channel= pré-marca só aquele canal, se estiver ligado; ?kind= pré-marca
  // os canais da família. Uma vez, quando a lista chega. Sem canal ligado,
  // fica como "o sistema escolhe".
  const [channelApplied, setChannelApplied] = useState<ChannelType | null>(null);
  if (channelWanted && channelApplied !== channelWanted && channelsQuery.data) {
    setChannelApplied(channelWanted);
    if (selected.size === 0 && enabledChannels.some((c) => c.type === channelWanted)) {
      setSelected(new Set([channelWanted]));
    }
  }
  if (kindWanted && kindApplied !== kindWanted && channelsQuery.data) {
    setKindApplied(kindWanted);
    if (selected.size === 0) {
      const wanted = KIND_CHANNELS[kindWanted].filter((type) =>
        enabledChannels.some((channel) => channel.type === type),
      );
      if (wanted.length > 0) setSelected(new Set(wanted));
    }
  }

  // O campo cresce com o texto (sem animação: altura segue o conteúdo).
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
    if (bringIntoView.current) {
      bringIntoView.current = false;
      field.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "center",
      });
      field.focus({ preventScroll: true });
      field.setSelectionRange(field.value.length, field.value.length);
    }
  }, [prompt, pickedId]);

  // Disponibilidade na instância (chave-geral em Ajustes). A presença da API key
  // não é visível ao usuário comum — se faltar, a saga pula a etapa com aviso.
  const webSearchAvailable =
    webSearchSetting.data?.enabled !== false && webSearchSetting.data?.provider !== "off";
  const webSearchOn = webSearchAvailable && (webSearchChoice ?? false);

  const toggleChannel = (type: ChannelType) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  // A notícia por trás do tema: a da URL ou a da sugestão escolhida.
  const news = noticia ?? picked?.news ?? null;
  // Campo vazio com sugestão escolhida: o tema é o briefing da sugestão.
  const theme = prompt.trim() || picked?.brief.trim() || "";

  const soCarrossel = selected.size === 1 && selected.has("instagram_carousel");
  const conectorBloqueio = soCarrossel ? null : "Por enquanto o seu Claude entrega só carrossel.";
  const viaConector = conectorEscolhido && claudeConnected && !conectorBloqueio;

  const submit = () => {
    const trimmed = theme;
    if (!trimmed || !ready || createJob.isPending) return;
    createJob.mutate(
      viaConector
        ? { prompt: trimmed, pedir_ao_claude: true }
        : {
            prompt: trimmed,
            ...(selected.size > 0 ? { channel_types: [...selected] } : {}),
            ...(webSearchOn ? { web_search: true } : {}),
          },
      {
        onSuccess: ({ job_id }) => {
          // vincula a notícia ao job; falhar aqui não derruba a geração já disparada
          if (news) {
            markUsed.mutate(
              { itemId: news.id, jobId: job_id },
              {
                onError: () =>
                  toast.warning("Geração iniciada, mas a notícia continua como nova no Radar."),
              },
            );
          }
          setPrompt("");
          setPicked(null);
          setSelected(new Set());
          // a criação segue AQUI, nesta tela — sem ir para outra página
          onStarted(job_id);
        },
        onError: (error) => {
          toast.error("Não foi possível gerar", { description: error.message });
        },
      },
    );
  };

  // escolheu o Claude e o estado do conector ainda não chegou: espera, não cai no modelo pago
  const esperandoConector = conectorEscolhido && estadoConector === null;
  const canSubmit = ready && Boolean(theme) && !createJob.isPending && !esperandoConector;

  const changePrompt = (next: string) => {
    setPrompt(next);
    // escrever o próprio tema substitui a sugestão escolhida
    if (picked && next.trim()) setPicked(null);
    // o texto passou a ser do usuário: só o ?brief da ideia sai da URL
    if (brief && !radarId) onClearSearch("brief");
  };

  // Home: marcar um formato leva o foco ao campo (o próximo passo é o tema).
  // /criar: o campo é opcional — marcar só marca, sem puxar o teclado.
  const pickFormat = (type: ChannelType) => {
    toggleChannel(type);
    if (!tiles) fieldRef.current?.focus();
  };
  // Formato desligado (admin): o modal de canais abre no lugar; ao ligar, o
  // formato entra marcado.
  const enableFormat = (type?: ChannelType) => {
    if (type) setPendingFormat(type);
    setChannelsOpen(true);
  };

  const summary =
    selected.size === 0
      ? "O sistema escolhe os canais entre os ligados."
      : [...selected].map((type) => CHANNEL_TYPE_LABELS[type]).join(" · ");

  return (
    <>
      <Reveal index={revealIndex}>
        <div className="space-y-4">
          {tiles ? (
            <TodayIdeas
              ideas={today.ideas}
              isLoading={today.isLoading || channelsQuery.isLoading}
              pickedId={pickedId}
              onPick={pickIdea}
            />
          ) : channelsQuery.isLoading ? (
            <div className="flex flex-wrap gap-2" aria-hidden="true">
              {Array.from({ length: 6 }).map((_, index) => (
                <span
                  key={index}
                  className="h-8 w-24 animate-pulse rounded-full bg-[var(--via-navy-04)]"
                />
              ))}
            </div>
          ) : (
            <FormatChips
              enabled={enabledTypes}
              selected={selected}
              onToggle={pickFormat}
              onEnableChannels={isAdmin ? () => setChannelsOpen(true) : undefined}
            />
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            className={cn("ce-hero-field !rounded-[28px] px-5 pb-3 pt-4", tiles && "ce-reveal")}
          >
            {tiles && pickedId && picked ? (
              <div className="mb-1 flex min-w-0 items-start gap-2" data-testid="criar-tema">
                <p className="line-clamp-2 min-w-0 flex-1 text-lg leading-snug text-[var(--via-text-primary)]">
                  {picked.idea.title}
                </p>
              </div>
            ) : null}
            {noticia ? (
              <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="radar-anexado">
                <span className="via-meta-chip">
                  <Newspaper className="size-3" aria-hidden="true" />
                  Notícia do Radar
                </span>
                <a
                  href={noticia.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate text-xs text-[var(--via-text-muted)] underline-offset-4 hover:underline"
                  title={noticia.title}
                >
                  {noticia.title}
                </a>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => onClearSearch()}
                >
                  Desanexar
                </Button>
              </div>
            ) : null}

            <textarea
              id={BRIEF_FIELD_ID}
              ref={fieldRef}
              value={prompt}
              onChange={(event) => changePrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  submit();
                }
              }}
              rows={tiles && pickedId ? 1 : 3}
              placeholder={
                tiles
                  ? pickedId
                    ? "ou escreva o seu tema"
                    : "Escreva o seu tema"
                  : "Ex.: 3 erros de quem começa a investir"
              }
              aria-label="Tema da peça"
              className={cn(
                "block max-h-[60vh] w-full resize-none bg-transparent leading-snug text-[var(--via-text-primary)] outline-none placeholder:text-[var(--via-text-faint)]",
                tiles && pickedId ? "min-h-0 text-sm" : "min-h-[5.5rem] text-lg",
              )}
            />
            <PromptTools value={prompt} onChange={changePrompt} kind="content" className="mt-1" />

            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <AiChoiceLine
                  connector={{
                    chosen: conectorEscolhido,
                    blocked: conectorBloqueio,
                    choose: escolherConector,
                    active: viaConector,
                  }}
                />
                {/* Regra do produto: o custo aparece antes de Gerar. Os modelos
                    de texto e imagem ainda não têm preço no catálogo: a linha
                    diz isso em vez de sumir. */}
                <span
                  className="text-xs text-[var(--via-text-muted)]"
                  data-testid="criar-estimativa"
                >
                  {viaConector
                    ? "Sem custo de API: o seu Claude escreve pela assinatura"
                    : "Estimativa: sem preço cadastrado para estes modelos"}
                </span>
                {webSearchAvailable && !viaConector ? (
                  <ChoiceChip
                    selected={webSearchOn}
                    onClick={() => setWebSearchChoice(!webSearchOn)}
                    title="Busca notícias recentes sobre o tema antes de gerar. Demora mais."
                    icon={<Globe aria-hidden="true" />}
                  >
                    Pesquisa web {webSearchOn ? "ligada" : "desligada"}
                  </ChoiceChip>
                ) : null}
                {prompt.length > 0 ? (
                  <span
                    className="font-mono text-xs tabular-nums text-[var(--via-text-faint)]"
                    aria-live="off"
                  >
                    {prompt.length}/{BRIEF_MAX_CHARS}
                  </span>
                ) : null}
              </div>
              <Button type="submit" className="h-11 px-5" disabled={!canSubmit}>
                {createJob.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : null}
                Gerar
                <ArrowRight aria-hidden="true" />
              </Button>
            </div>
            {tiles ? (
              <FormatLine
                selected={selected}
                pending={pendingFormat}
                onEnable={isAdmin ? () => enableFormat() : undefined}
              />
            ) : null}
          </form>
          {tiles && channelsQuery.isLoading ? (
            <div
              className="grid grid-cols-2 gap-x-3 gap-y-6 pt-6 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4"
              aria-hidden="true"
            >
              {Array.from({ length: 8 }).map((_, index) => (
                <span
                  key={index}
                  className="block aspect-[4/5] animate-pulse rounded-[var(--via-radius-lg)] bg-[var(--via-navy-04)]"
                />
              ))}
            </div>
          ) : tiles ? (
            <div className="space-y-3 pt-6">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--via-text-muted)]">
                Formato
              </p>
              <FormatTiles
                channels={channelsQuery.data ?? []}
                selected={selected}
                onToggle={pickFormat}
                onEnableChannels={isAdmin ? enableFormat : undefined}
              />
            </div>
          ) : null}
        </div>
      </Reveal>

      <Reveal index={revealIndex + 1}>
        {channelsQuery.isLoading && tiles ? null : channelsQuery.isLoading ? (
          <ChannelTilesSkeleton />
        ) : enabledChannels.length === 0 ? (
          <ChannelsEmpty isAdmin={isAdmin} onOpen={() => setChannelsOpen(true)} />
        ) : tiles ? null : (
          // Resumo da escolha numa linha; os ladrilhos (com o que sai em cada
          // canal) só por revelação, para não ter dois controles abertos da
          // mesma escolha.
          <Collapsible open={tilesOpen} onOpenChange={setTilesOpen} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 text-sm">
              <p className="text-[var(--via-text-muted)]">
                <span className="via-eyebrow mr-2">Canais</span>
                <span className="text-[var(--via-text-body)]" data-testid="criar-canais-resumo">
                  {summary}
                </span>
              </p>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="text-[var(--via-text-muted)]">
                  {tilesOpen ? "Recolher" : "Ajustar canais"}
                  <ChevronDown
                    aria-hidden="true"
                    className={cn("transition-transform duration-200", tilesOpen && "rotate-180")}
                  />
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent>
              <ChannelTiles
                channels={enabledChannels}
                selected={selected}
                onToggle={toggleChannel}
                onClear={() => setSelected(new Set())}
              />
            </CollapsibleContent>
          </Collapsible>
        )}
      </Reveal>

      <ChannelsDialog open={channelsOpen} onOpenChange={setChannelsOpen} />
    </>
  );
}

/**
 * /criar: para onde vai, numa linha (ícone + formato). Formato sugerido com o
 * canal desligado mostra a saída ali mesmo: "Ligar canal" abre o modal.
 */
function FormatLine({
  selected,
  pending,
  onEnable,
}: {
  selected: ReadonlySet<ChannelType>;
  pending: ChannelType | null;
  onEnable?: () => void;
}) {
  return (
    <div
      className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--via-border-soft)] pt-2.5 text-xs text-[var(--via-text-muted)]"
      data-testid="criar-formatos-escolhidos"
    >
      {selected.size > 0 ? (
        [...selected].map((type) => (
          <span key={type} className="inline-flex items-center gap-1.5 text-[var(--via-text-body)]">
            <ChannelIcon type={type} className="size-3" />
            {FORMAT_LABELS[type]}
          </span>
        ))
      ) : pending ? null : (
        <span>O sistema escolhe o formato entre os canais ligados.</span>
      )}
      {pending ? (
        <span className="inline-flex flex-wrap items-center gap-2" role="status">
          <span>
            {FORMAT_LABELS[pending]} está com o canal desligado.
            {onEnable ? "" : " Peça a um administrador para ligar."}
          </span>
          {onEnable ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-3"
              onClick={onEnable}
              aria-haspopup="dialog"
            >
              Ligar canal
            </Button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
