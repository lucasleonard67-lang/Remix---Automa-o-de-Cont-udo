import { useNavigate } from "@tanstack/react-router";
import {
  Captions,
  ChevronDown,
  Clapperboard,
  Languages,
  Loader2,
  type LucideIcon,
  Mic,
  Palette,
  Plus,
  Upload,
  UserRound,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import {
  GateEstimateLine,
  type GateEstimateState,
} from "@/components/generation/gate-estimate-line";
import { BrandIcon } from "@/components/brand-icon";
import { GateOptionList } from "@/components/generation/generation-gate";
import { useGateResolution } from "@/components/generation/use-gate-resolution";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { PromptField } from "@/components/prompt/prompt-tools";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useHiggsfieldStatus } from "@/hooks/use-higgsfield";
import { useSecretStatus } from "@/hooks/use-app-settings";
import { useEngineStatus, useReplicateVideoModels } from "@/hooks/use-video-models";
import { normalizeBrandKitContent, useActiveVersion } from "@/hooks/use-versioned-brand";
import {
  CAPTION_STYLE_OPTIONS,
  useCreateDirectorJob,
  type CaptionStyle,
  type RemakeConfig,
} from "@/hooks/use-director-jobs";
import { useAvatars } from "@/hooks/use-avatars";
import {
  useUploadRemakeFrame,
  useUploadRemakeVideo,
  useUploadVoiceSample,
  useVoiceCloneCheck,
  useVoiceLookup,
} from "@/hooks/use-video-remake";
import { brandIdOf, useBrandVoices } from "@/hooks/use-voices";
import { VoiceSelect } from "@/components/voices/voice-select";
import { artInk } from "@/lib/brand-ink";
import {
  providerName,
  type GateOption,
  type GateProvider,
  type GateSelection,
  type GateSignals,
} from "@/lib/generation-gate";
import { humanizeError } from "@/lib/humanize-error";
import { INTEGRATION_BY_ID } from "@/lib/integrations";
import { openIntegration } from "@/lib/integration-modal";
import {
  captionAccent,
  CHARACTER_PROMPT_MAX_CHARS,
  durationProblem,
  formatMb,
  IMAGE_OPTIONS,
  LANGUAGE_OPTIONS,
  PEOPLE_OPTIONS,
  REMAKE_OPTION_COPY,
  REMAKE_OPTION_IDS,
  remakeRequirements,
  remakeSummary,
  personSwapRate,
  sizeLimit,
  sizeProblem,
  SOURCE_LANGUAGE_OPTIONS,
  SPEECH_MAX_CHARS,
  speechFit,
  STYLE_OPTIONS,
  type RemakeOptionId,
} from "@/lib/remake-options";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// "Melhorar um vídeo meu" (Vídeos → Novo). Três passos na mesma tela, de cima
// para baixo: o vídeo, o que melhorar e o custo com um botão só.
//
// Vindo do Hub com uma experiência (initialOptions), a tela mostra só ela, na
// ordem em que se decide: vídeo → campos da opção → voz (se for fala) →
// autorização (se mexe em pessoas) → custo → botão. As outras opções ficam em
// "Adicionar outra melhoria" (ainda dá para combinar). Sem initialOptions,
// todas aparecem como interruptores.
//
// O que depende de integração desligada mostra "Conectar" ali mesmo (modal de
// integrações), sem sair do fluxo. Ao enviar, vira uma produção do Diretor
// (config.mode = 'remake') e o aviso de "Vídeo pronto" chega em qualquer tela.
// ---------------------------------------------------------------------------

type OptionId = RemakeOptionId;
type VoiceChoice = "female" | "male" | "own" | "custom";

const VOICE_RULE = { preferredId: "elevenlabs" } as const;

const OPTION_ICON: Record<OptionId, LucideIcon> = {
  style: Palette,
  scene: Clapperboard,
  character: UserRound,
  speech: Mic,
  translate: Languages,
  captions: Captions,
};

const VOICE_CHOICES: { id: VoiceChoice; label: string }[] = [
  { id: "female", label: "Voz feminina" },
  { id: "male", label: "Voz masculina" },
  { id: "own", label: "A minha voz (do vídeo)" },
  { id: "custom", label: "Outra voz" },
];

export type { RemakeOptionId };

export function RemakeFlow({
  onCreated,
  initialOptions = [],
  initialModelId = null,
}: {
  onCreated?: () => void;
  initialOptions?: OptionId[];
  /**
   * Modelo escolhido no hub: o vídeo→vídeo (estilo/cenário) ou a voz (fala).
   * Fora da lista, a Recomendada assume — o portão nunca prende um id morto.
   */
  initialModelId?: string | null;
} = {}) {
  const navigate = useNavigate();
  const upload = useUploadRemakeVideo();
  const uploadFrame = useUploadRemakeFrame();
  const uploadVoice = useUploadVoiceSample();
  const create = useCreateDirectorJob();
  // listas do portão: vídeo→vídeo (estilo/cena), troca de pessoa e voz (fala nova)
  const v2vModels = useReplicateVideoModels("scene_v2v");
  const personModels = useReplicateVideoModels("person_swap");
  const ttsModels = useReplicateVideoModels("tts");
  const lipsyncModels = useReplicateVideoModels("lipsync_post");
  // "Trocar personagem" usa um Apresentador com foto (retrato ou primeira foto do cadastro)
  const presenters = useAvatars();
  const secrets = useSecretStatus();
  const higgsfield = useHiggsfieldStatus();
  const engineStatus = useEngineStatus();
  // legendas na cor da marca, como no vídeo de cenas (novo.tsx)
  const brandKit = normalizeBrandKitContent(useActiveVersion("brand_kit").data?.content ?? null);
  const brandAccent = captionAccent(artInk(brandKit.palette).accent);

  // Experiência escolhida no Hub: sempre ligada, sem interruptor. O resto vira
  // "Adicionar outra melhoria".
  const primary = REMAKE_OPTION_IDS.filter((id) => initialOptions.includes(id));
  const focused = primary.length > 0;
  const extras = focused ? REMAKE_OPTION_IDS.filter((id) => !primary.includes(id)) : [];

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [toggled, setToggled] = useState<Record<OptionId, boolean>>({
    style: initialOptions.includes("style"),
    scene: initialOptions.includes("scene"),
    character: initialOptions.includes("character"),
    speech: initialOptions.includes("speech"),
    translate: initialOptions.includes("translate"),
    captions: initialOptions.includes("captions"),
  });
  const on: Record<OptionId, boolean> = { ...toggled };
  for (const id of primary) on[id] = true;
  const setOption = (id: OptionId, value: boolean) => setToggled((p) => ({ ...p, [id]: value }));
  const [showExtras, setShowExtras] = useState(false);

  const [style, setStyle] = useState<string>("marca");
  const [scene, setScene] = useState("");
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [characterPrompt, setCharacterPrompt] = useState("");
  // idioma falado no vídeo: a transcrição das legendas (e a tradução) partem dele
  const [sourceLanguage, setSourceLanguage] = useState<string>("pt");
  const [speech, setSpeech] = useState("");
  // voz da fala nova: o gênero de quem aparece (sem isso saía voz masculina em mulher)
  const [voiceGender, setVoiceGender] = useState<VoiceChoice | null>(null);
  const [customVoiceId, setCustomVoiceId] = useState("");
  // "A minha voz": quem aparece no vídeo — voz de reserva se o plano não clonar
  const [personGender, setPersonGender] = useState<"female" | "male" | null>(null);
  // "Outra voz": uma voz de Marca → Vozes (`brand:<id>`) ou um Voice ID colado ("paste")
  const brandVoices = useBrandVoices();
  const [customPick, setCustomPick] = useState<string | null>(null);
  const otherPick = customPick ?? ((brandVoices.data ?? []).length ? null : "paste");
  const brandVoice = (brandVoices.data ?? []).find((v) => v.id === brandIdOf(otherPick)) ?? null;
  const pasting = otherPick === "paste";
  const customVoiceShape = /^[A-Za-z0-9]{10,40}$/.test(customVoiceId.trim());
  // conferências ANTES de gerar (nunca descobrir no meio da produção)
  const cloneCheck = useVoiceCloneCheck(on.speech && voiceGender === "own");
  const voiceLookup = useVoiceLookup(
    customVoiceId.trim(),
    on.speech && voiceGender === "custom" && pasting && customVoiceShape,
  );
  const customVoiceOk = brandVoice
    ? brandVoice.status === "ready"
    : pasting && customVoiceShape && voiceLookup.data?.ok === true;
  const cloneBlocked = voiceGender === "own" && cloneCheck.data?.ok === false;
  // o portão de modelo de voz só vale para voz feminina/masculina; a própria
  // voz e o Voice ID colado saem sempre pelo ElevenLabs
  const catalogVoice = voiceGender === "female" || voiceGender === "male";
  const [language, setLanguage] = useState<string>("en");
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>("karaoke");
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  // escolha nas listas (null = a Recomendada)
  const hubPicksScene = initialOptions.includes("style") || initialOptions.includes("scene");
  const [sceneModelId, setSceneModelId] = useState<string | null>(
    hubPicksScene ? initialModelId : null,
  );
  const [ttsModelId, setTtsModelId] = useState<string | null>(
    initialOptions.includes("speech") ? initialModelId : null,
  );

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const readyIdentities = (presenters.data ?? []).filter(
    (p) => Boolean(p.reference_image_path) || (p.identity_pack_paths?.length ?? 0) > 0,
  );

  // estilo/cena vão pelo vídeo→vídeo (Aleph); a pessoa, pelo person_swap
  const restyle = on.style || (on.scene && Boolean(scene.trim()));
  const personSwap = on.character && Boolean(characterId);
  const visual = restyle || personSwap;
  // marcada, mesmo sem preencher: já muda a imagem (a fala não vira foto que fala)
  const visualToo = IMAGE_OPTIONS.some((id) => on[id]);
  // a troca de pessoa: o primário do catálogo (o servidor resolve o mesmo)
  const personModel = on.character
    ? ((personModels.data ?? []).find((m) => m.isDefault) ?? personModels.data?.[0] ?? null)
    : null;
  const maxBytes = sizeLimit(on, personModel?.maxBytes);
  // fotos de referência da troca: o retrato + o pack, até o limite do modelo
  // (`limits.max_refs`) e do servidor (3, presenterPhotos no director-advance)
  const swapPhotos = (() => {
    const chosen = on.character ? readyIdentities.find((p) => p.id === characterId) : undefined;
    if (!chosen) return null;
    const pack = (chosen.identity_pack_paths ?? []).filter(Boolean);
    const photos = new Set([chosen.reference_image_path || pack[0], ...pack].filter(Boolean));
    const max = personModel?.maxRefs ?? null;
    const sent = Math.min(photos.size, 3, max ?? 3);
    return sent > 0 ? { name: chosen.name, sent, max } : null;
  })();
  const captions = on.captions;
  const anyOption = Object.values(on).some(Boolean);

  const connected: Record<string, boolean> = {
    replicate: secrets.data?.includes("REPLICATE_API_TOKEN") ?? false,
    elevenlabs: secrets.data?.includes("ELEVEN_API_KEY") ?? false,
    heygen: secrets.data?.includes("HEYGEN_API_KEY") ?? false,
    higgsfield: higgsfield.data?.connected ?? false,
  };
  const checking = secrets.isLoading || higgsfield.isLoading;
  const elevenStatus = secrets.isLoading
    ? "loading"
    : secrets.isError
      ? "unknown"
      : connected.elevenlabs
        ? "on"
        : "off";

  // ── listas do portão ─────────────────────────────────────────────────────
  const { higgsfield: higgsfieldStatus, replicate: replicateStatus } = engineStatus;
  const sceneOptions = useMemo<GateOption[]>(
    () => (v2vModels.data ?? []).map((o) => ({ ...o, engine: "replicate" as const })),
    [v2vModels.data],
  );
  const sceneSignals = useMemo<GateSignals>(
    () => ({
      hasPresenter: false,
      durationSeconds: seconds == null ? 0 : Math.ceil(seconds),
      scenes: 1,
      isDraft: false,
      connected: { higgsfield: higgsfieldStatus, replicate: replicateStatus },
    }),
    [seconds, higgsfieldStatus, replicateStatus],
  );
  const sceneSelection = useMemo<GateSelection>(
    () => ({ a: sceneModelId, b: null }),
    [sceneModelId],
  );
  const sceneGate = useGateResolution(sceneOptions, sceneSelection, sceneSignals, false);

  const voiceOptions = useMemo<GateOption[]>(
    () => [
      ...(ttsModels.data ?? []).map((o) => ({ ...o, engine: "replicate" as const })),
      {
        engine: "elevenlabs" as const,
        id: "elevenlabs",
        label: "Voz da marca",
        detail: "",
        usdPerSecond: null,
        maxSeconds: null,
        isDefault: false,
      },
    ],
    [ttsModels.data],
  );
  const voiceSignals = useMemo<GateSignals>(
    () => ({
      hasPresenter: false,
      durationSeconds: 0,
      chars: speech.trim().length,
      isDraft: false,
      connected: { replicate: replicateStatus, elevenlabs: elevenStatus },
    }),
    [speech, replicateStatus, elevenStatus],
  );
  const voiceSelection = useMemo<GateSelection>(() => ({ a: ttsModelId, b: null }), [ttsModelId]);
  // Regra da tarefa: a voz da marca (ElevenLabs) é o padrão, como nos outros
  // vídeos; só recomenda um modelo do catálogo se a ElevenLabs não estiver conectada.
  const voiceGate = useGateResolution(
    voiceOptions,
    voiceSelection,
    voiceSignals,
    false,
    VOICE_RULE,
  );

  const sceneModel = restyle ? (sceneGate.a?.option ?? null) : null;
  const voiceModel = on.speech && catalogVoice ? (voiceGate.a?.option ?? null) : null;

  const cfg: Partial<RemakeConfig> = {
    style: on.style ? style : null,
    scene: on.scene ? scene.trim() || null : null,
    character_identity_id: on.character ? characterId : null,
    character_prompt: on.character ? characterPrompt.trim() || null : null,
    // null = o servidor usa o primário de person_swap
    person_model_id: null,
    speech: on.speech ? speech.trim() || null : null,
    voice_gender: on.speech ? voiceGender : null,
    // voz da marca: `brand_voice_id` (§9.5) e, se for ElevenLabs, o Voice ID para o motor de hoje
    voice_id:
      on.speech && voiceGender === "custom"
        ? brandVoice
          ? brandVoice.provider === "elevenlabs"
            ? brandVoice.provider_voice_id
            : null
          : customVoiceId.trim() || null
        : null,
    brand_voice_id: on.speech && voiceGender === "custom" && brandVoice ? brandVoice.id : null,
    person_gender: on.speech && voiceGender === "own" ? personGender : null,
    translate: on.translate ? language : null,
    source_language: on.captions || on.translate ? sourceLanguage : null,
    scene_model_id: sceneModel?.id ?? null,
    // ElevenLabs (a voz da marca) é o caminho padrão do servidor: vai como null.
    // A própria voz e o Voice ID saem pelo ElevenLabs: o catálogo não se aplica.
    tts_model_id: voiceModel && voiceModel.engine === "replicate" ? voiceModel.id : null,
  };
  // sem HeyGen, a fala que cabe no vídeo sincroniza pelo Replicate; a foto que fala continua HeyGen
  const speechFits = (() => {
    const f = on.speech ? speechFit(speech.trim().length, seconds) : null;
    return !f || !(f.tooLong || f.tooShort);
  })();
  const lipsyncViaReplicate =
    !connected.heygen && Boolean(lipsyncModels.data?.length) && speechFits;
  const missing = remakeRequirements(cfg, captions, lipsyncViaReplicate).filter(
    (id) => !connected[id],
  );

  const durationError = file ? durationProblem(seconds) : null;
  const sizeError = file ? sizeProblem(file.size, maxBytes) : null;
  const fileError = durationError ?? sizeError;
  const touchesPeople = PEOPLE_OPTIONS.some((id) => on[id]);
  const incomplete =
    (on.scene && !scene.trim()) ||
    (on.character && !characterId) ||
    (on.speech &&
      (!speech.trim() ||
        !voiceGender ||
        (voiceGender === "custom" && !customVoiceOk) ||
        (voiceGender === "own" && (!personGender || cloneBlocked))));

  const fit = on.speech ? speechFit(speech.trim().length, seconds) : null;
  // Fala que não cabe no tempo do vídeo: em vez de bloquear, o HeyGen faz uma
  // "foto que fala" com um quadro do seu vídeo (mesmo rosto e ambiente, fundo
  // parado). Só quando a fala é a única mudança visual — estilo/cena/pessoa
  // mudariam o vídeo depois do quadro tirado.
  const photoTalk = Boolean(fit && (fit.tooLong || fit.tooShort) && !visualToo && !on.translate);
  const blocker = !file
    ? "Suba o vídeo que você quer melhorar."
    : fileError
      ? fileError
      : !anyOption
        ? "Marque pelo menos uma melhoria."
        : fit?.tooLong && !photoTalk
          ? `A fala nova é longa demais para este vídeo: dá ~${Math.round(fit.estimated)} s e o vídeo tem ${Math.round(seconds ?? 0)} s. Corte para cerca de ${fit.ideal} caracteres.`
          : incomplete
            ? on.speech && !speech.trim()
              ? "Escreva a fala nova."
              : on.speech && !voiceGender
                ? "Escolha a voz da fala nova."
                : on.speech && voiceGender === "custom" && !customVoiceOk
                  ? pasting
                    ? "Cole um Voice ID válido do ElevenLabs."
                    : "Escolha a voz da fala nova."
                  : cloneBlocked
                    ? "Seu plano do ElevenLabs não clona voz: escolha outra voz ou assine o Starter."
                    : on.speech && voiceGender === "own" && !personGender
                      ? "Diga se a pessoa do vídeo é mulher ou homem."
                      : on.scene && !scene.trim()
                        ? "Descreva o cenário novo."
                        : on.character && !characterId
                          ? "Escolha o apresentador que entra no vídeo."
                          : "Complete a melhoria marcada."
            : on.character && personModels.isSuccess && !personModel
              ? "Nenhum modelo de troca de pessoa ativo: ative o P-Video Replace em Ajustes → Integrações → Replicate."
              : !checking && missing.length
                ? `Falta conectar ${missing.map((id) => INTEGRATION_BY_ID[id].name).join(" e ")}.`
                : touchesPeople && !consent
                  ? "Confirme a autorização das pessoas do vídeo."
                  : null;

  // Estimativa total = soma das listas marcadas; quem não tem preço cobra à parte.
  const heygen = Boolean(cfg.speech || cfg.translate);
  const gateEstimate: GateEstimateState = (() => {
    const loading =
      (restyle && v2vModels.isLoading) ||
      (personSwap && personModels.isLoading) ||
      (on.speech && catalogVoice && ttsModels.isLoading);
    if (loading) return { kind: "loading" };
    if (seconds === null && visual)
      return {
        kind: "pending",
        reason: file ? "aparece depois que o vídeo for lido" : "suba o vídeo para calcular",
      };
    const parts: { usd: number; label: string }[] = [];
    const aside: GateProvider[] = [];
    if (restyle) {
      if (sceneGate.estimate?.kind === "catalog")
        parts.push({
          usd: sceneGate.estimate.maxUsd,
          label: `${Math.ceil(seconds ?? 0)} s de vídeo`,
        });
      else if (sceneGate.estimate?.kind === "none" && sceneModel) aside.push(sceneModel.engine);
    }
    if (personSwap) {
      const rate = personSwapRate(personModel);
      if (rate != null)
        parts.push({
          usd: rate * Math.ceil(seconds ?? 0),
          label: `${Math.ceil(seconds ?? 0)} s de troca de pessoa`,
        });
      else aside.push("replicate");
    }
    if (on.speech && catalogVoice) {
      if (voiceGate.estimate?.kind === "catalog")
        parts.push({ usd: voiceGate.estimate.maxUsd, label: `${speech.trim().length} letras` });
      else if (voiceGate.estimate?.kind === "none" && voiceModel) aside.push(voiceModel.engine);
    } else if (on.speech && voiceGender) aside.push("elevenlabs");
    if (heygen) aside.push("heygen");
    const asideLabel = [...new Set(aside)].map(providerName).join(" e ");
    if (parts.length === 0) {
      return aside.length
        ? { kind: "none", reason: `cobrado à parte: ${asideLabel}` }
        : { kind: "catalog", maxUsd: 0, dependsOn: "sem cena nova: só a montagem" };
    }
    const dependsOn = `depende de ${parts.map((p) => p.label).join(" · ")}${
      aside.length ? ` · ${asideLabel} cobra à parte` : ""
    }`;
    return { kind: "catalog", maxUsd: parts.reduce((sum, p) => sum + p.usd, 0), dependsOn };
  })();

  const pickFile = (next: File | null) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(next);
    setSeconds(null);
    setPreviewUrl(next ? URL.createObjectURL(next) : null);
  };

  const brandLook = () => {
    setToggled((prev) => ({ ...prev, style: true, captions: true }));
    setStyle("marca");
  };

  const submit = async () => {
    if (blocker || !file || seconds === null || sending) return;
    setSending(true);
    try {
      const sourcePath = await upload.mutateAsync(file);
      // quadro só é preciso quando a fala não cabe; se o navegador não conseguir
      // tirá-lo (HEVC sem decodificador), segue sem e o servidor explica
      const framePath =
        photoTalk && previewUrl
          ? await grabFrame(previewUrl, seconds)
              .then((blob) => uploadFrame.mutateAsync(blob))
              .catch(() => null)
          : null;
      // a minha voz: o áudio do vídeo vira WAV no navegador (sem ffmpeg no servidor)
      const voicePath =
        on.speech && voiceGender === "own"
          ? await extractWav(file).then((wav) => uploadVoice.mutateAsync(wav))
          : null;
      const remake: RemakeConfig = {
        source_path: sourcePath,
        duration_s: Math.round(seconds * 10) / 10,
        ...cfg,
        ...(framePath ? { speech_frame_path: framePath } : {}),
        ...(voicePath ? { voice_sample_path: voicePath } : {}),
      };
      await create.mutateAsync({
        brief: {
          objetivo: remakeSummary(cfg, captions),
          publico: "",
          smp: "",
          numero_heroi: "",
          tom: "",
          cta: "",
          duracao_alvo_s: Math.round(seconds),
          formato: "remake",
        },
        config: {
          mode: "remake",
          remake,
          max_shots: 0,
          budget_credits: 0,
          auto_approve_keyframes: true,
          auto_approve_audio: true,
          skip_video: false,
          captions,
          captions_style: captionStyle,
          // lidos por captionCfg no director-advance; sem eles saía amarelo fixo
          ...(captions
            ? {
                captions_position: "bottom" as const,
                ...(brandAccent ? { captions_accent: brandAccent } : {}),
              }
            : {}),
        },
      });
      toast.success("Melhorando o seu vídeo", {
        description: "Avisamos quando ficar pronto. Pode seguir usando o app.",
      });
      // dentro do fluxo de configuração, quem chamou decide o próximo passo
      if (onCreated) onCreated();
      else void navigate({ to: "/videos" });
    } catch (error) {
      toast.retry("Não foi possível começar", {
        description: error instanceof Error ? humanizeError(error.message) : undefined,
        onRetry: () => void submit(),
      });
    } finally {
      setSending(false);
    }
  };

  // ── campos de cada opção ─────────────────────────────────────────────────
  const voiceBlock = (
    <div className="space-y-2 pt-2" role="group" aria-labelledby="remake-voice">
      <p id="remake-voice" className="text-sm font-medium text-[var(--via-text-primary)]">
        Voz
      </p>
      <div className="flex flex-wrap gap-2">
        {VOICE_CHOICES.map((choice) => (
          <ChoiceChip
            key={choice.id}
            selected={voiceGender === choice.id}
            onClick={() => setVoiceGender(choice.id)}
          >
            {choice.label}
          </ChoiceChip>
        ))}
      </div>
      {voiceGender === "custom" ? (
        <VoiceSelect
          value={otherPick}
          onChange={(next) => setCustomPick(next)}
          options={[{ value: "paste", label: "Colar um Voice ID do ElevenLabs" }]}
          ariaLabel="Outra voz"
          className="max-w-sm"
        />
      ) : null}
      {voiceGender === "custom" && pasting ? (
        <div className="space-y-1">
          <Input
            value={customVoiceId}
            onChange={(event) => setCustomVoiceId(event.target.value)}
            placeholder="Voice ID do ElevenLabs (ex.: EXAVITQu4vr4xnSDxMaL)"
            aria-label="Voice ID do ElevenLabs"
            aria-invalid={customVoiceId.trim() !== "" && !customVoiceOk}
            className="font-mono"
          />
          <p
            className={cn(
              "text-xs",
              voiceLookup.data?.ok === false
                ? "font-medium text-[var(--via-coral-dark)]"
                : voiceLookup.data?.ok
                  ? "font-medium text-[var(--via-success)]"
                  : "text-[var(--via-text-muted)]",
            )}
          >
            {!customVoiceShape
              ? "No ElevenLabs: Voices → escolha a voz → copie o ID. Vale voz da biblioteca ou da sua conta."
              : voiceLookup.isLoading
                ? "Conferindo a voz no ElevenLabs…"
                : voiceLookup.data?.ok
                  ? `Voz encontrada: ${voiceLookup.data.name}${voiceLookup.data.gender ? ` (${voiceLookup.data.gender === "female" ? "feminina" : voiceLookup.data.gender === "male" ? "masculina" : voiceLookup.data.gender})` : ""}.`
                  : (voiceLookup.data?.reason ??
                    "Não deu para conferir a voz. Confira o ID e cole de novo.")}
          </p>
        </div>
      ) : null}
      {voiceGender === "own" && cloneCheck.isLoading ? (
        <p className="text-xs text-[var(--via-text-muted)]">
          Conferindo se o seu plano do ElevenLabs clona voz…
        </p>
      ) : null}
      {cloneBlocked ? (
        <p className="flex flex-wrap items-center gap-x-2 text-xs font-medium text-[var(--via-coral-dark)]">
          {cloneCheck.data?.reason}
          <a
            href="https://elevenlabs.io/app/subscription"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--via-accent)] underline-offset-4 hover:underline"
          >
            Ver planos do ElevenLabs
          </a>
        </p>
      ) : null}
      {voiceGender === "own" && !cloneBlocked ? (
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Quem aparece no vídeo"
        >
          <span className="text-xs text-[var(--via-text-muted)]">A pessoa do vídeo é:</span>
          <ChoiceChip
            selected={personGender === "female"}
            onClick={() => setPersonGender("female")}
          >
            Mulher
          </ChoiceChip>
          <ChoiceChip selected={personGender === "male"} onClick={() => setPersonGender("male")}>
            Homem
          </ChoiceChip>
          <span className="text-xs text-[var(--via-text-muted)]">
            (se o seu plano não clonar, a fala sai numa voz desse gênero)
          </span>
        </div>
      ) : null}
      {voiceGender === "own" ? (
        <p className="text-xs text-[var(--via-text-muted)]">
          {seconds != null && seconds < 15
            ? `Clonamos a voz pelo áudio do vídeo. Com ${Math.round(seconds)} s de amostra ela fica aproximada; vídeos de 30 s ou mais dão uma voz bem mais fiel.`
            : "Clonamos a voz pelo áudio do próprio vídeo, usamos na fala nova e apagamos o clone depois."}
        </p>
      ) : null}
      {catalogVoice ? (
        <GateOptionList
          task="Voz da fala nova"
          basis={`${speech.trim().length} letras`}
          rows={voiceGate.rows}
          a={voiceGate.a?.option.id ?? null}
          b={null}
          onSelect={(next) => setTtsModelId(next.a)}
          compare={null}
          onConnect={(provider) =>
            openIntegration(provider === "elevenlabs" ? "elevenlabs" : "replicate")
          }
          loading={ttsModels.isLoading}
          error={ttsModels.isError}
          emptyText="Nenhum modelo de voz ativo."
          testIdPrefix="remake-voice-option"
        />
      ) : null}
    </div>
  );

  const sourceLanguageBlock = (
    <div className="space-y-2 pt-2" role="group" aria-labelledby="remake-source-language">
      <p id="remake-source-language" className="text-xs text-[var(--via-text-muted)]">
        Idioma do vídeo
      </p>
      <div className="flex flex-wrap gap-2">
        {SOURCE_LANGUAGE_OPTIONS.map((option) => (
          <ChoiceChip
            key={option.id}
            selected={sourceLanguage === option.id}
            onClick={() => setSourceLanguage(option.id)}
          >
            {option.label}
          </ChoiceChip>
        ))}
      </div>
    </div>
  );

  const fields: Record<OptionId, ReactNode> = {
    style: (
      <div className="flex flex-wrap gap-2">
        {STYLE_OPTIONS.map((option) => (
          <ChoiceChip
            key={option.id}
            selected={style === option.id}
            onClick={() => setStyle(option.id)}
          >
            {option.label}
          </ChoiceChip>
        ))}
      </div>
    ),
    scene: (
      <>
        <Label htmlFor="remake-scene" className="sr-only">
          O que mudar no cenário
        </Label>
        <PromptField
          id="remake-scene"
          rows={2}
          kind="scene"
          value={scene}
          onChange={setScene}
          placeholder="Ex.: num escritório moderno, com luz de fim de tarde"
          max={200}
          claude={{
            tipo: "cena",
            alvo: "cenario",
            contexto: {
              ferramenta: "restyle",
              modelo: sceneModelId ?? undefined,
              max: 200,
              ...(seconds ? { segundos: Math.round(seconds) } : {}),
            },
          }}
        />
      </>
    ),
    character: readyIdentities.length ? (
      <>
        <div className="flex flex-wrap gap-2">
          {readyIdentities.map((identity) => (
            <ChoiceChip
              key={identity.id}
              selected={characterId === identity.id}
              onClick={() => setCharacterId(identity.id)}
            >
              {identity.name}
            </ChoiceChip>
          ))}
        </div>
        {swapPhotos ? (
          <p className="text-xs text-[var(--via-text-muted)]" data-testid="remake-fotos-referencia">
            {swapPhotos.sent === 1 ? "Vai 1 foto" : `Vão ${swapPhotos.sent} fotos`} de{" "}
            {swapPhotos.name} como referência
            {swapPhotos.max != null ? ` (${personModel?.label} aceita até ${swapPhotos.max})` : ""}.
          </p>
        ) : null}
        <div className="space-y-1.5 pt-2">
          <Label htmlFor="remake-character-prompt" className="text-xs text-[var(--via-text-muted)]">
            Como a pessoa deve ficar (opcional)
          </Label>
          <PromptField
            id="remake-character-prompt"
            rows={2}
            kind="scene"
            value={characterPrompt}
            onChange={setCharacterPrompt}
            placeholder="Ex.: mantenha os óculos e a camisa azul"
            max={CHARACTER_PROMPT_MAX_CHARS}
            claude={{
              tipo: "pessoa",
              alvo: "pessoa",
              contexto: { ferramenta: "person_swap", max: CHARACTER_PROMPT_MAX_CHARS },
            }}
          />
        </div>
      </>
    ) : (
      <p className="text-sm text-[var(--via-text-muted)]">
        Nenhum apresentador com foto ainda. Cadastre um em Apresentadores e volte aqui.
      </p>
    ),
    speech: (
      <>
        <Label htmlFor="remake-speech" className="sr-only">
          Fala nova
        </Label>
        <PromptField
          id="remake-speech"
          rows={4}
          kind="script"
          value={speech}
          onChange={(next) => setSpeech(next.slice(0, SPEECH_MAX_CHARS))}
          placeholder="Escreva do seu jeito, ou só a ideia. O seu Claude transforma na fala que cabe no vídeo."
          max={SPEECH_MAX_CHARS}
          claude={{
            tipo: "fala",
            alvo: "fala",
            contexto: {
              ferramenta: "change_speech",
              max: SPEECH_MAX_CHARS,
              ...(seconds ? { segundos: Math.round(seconds) } : {}),
            },
          }}
        />
        <p
          className={cn(
            "text-xs",
            photoTalk
              ? "font-medium text-[var(--via-accent)]"
              : fit?.tooLong || fit?.tooShort
                ? "font-medium text-[var(--via-coral-dark)]"
                : "text-[var(--via-text-muted)]",
          )}
        >
          {fit && photoTalk
            ? `A fala (~${Math.round(fit.estimated)} s) não cabe nos ${Math.round(seconds ?? 0)} s do vídeo: vamos usar um quadro do seu vídeo como foto que fala (mesmo rosto e ambiente; o fundo fica parado).`
            : fit
              ? fit.tooLong
                ? `Longa demais: dá ~${Math.round(fit.estimated)} s de fala para ${Math.round(seconds ?? 0)} s de vídeo. Corte para ~${fit.ideal} caracteres.`
                : fit.tooShort
                  ? `Curta: dá ~${Math.round(fit.estimated)} s de fala para ${Math.round(seconds ?? 0)} s de vídeo. O ideal é ~${fit.ideal} caracteres.`
                  : `Cabe no vídeo: ~${Math.round(fit.estimated)} s de fala para ${Math.round(seconds ?? 0)} s.`
              : seconds
                ? `Para ${Math.round(seconds)} s de vídeo, escreva ~${Math.round(seconds * 15)} caracteres.`
                : `${speech.length} de ${SPEECH_MAX_CHARS} caracteres.`}
        </p>
        {voiceBlock}
      </>
    ),
    translate: (
      <>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Idioma">
          {LANGUAGE_OPTIONS.map((option) => (
            <ChoiceChip
              key={option.id}
              selected={language === option.id}
              onClick={() => setLanguage(option.id)}
            >
              {option.label}
            </ChoiceChip>
          ))}
        </div>
        {/* com legendas ligadas, o idioma do vídeo aparece lá (um só lugar) */}
        {on.captions ? null : sourceLanguageBlock}
      </>
    ),
    captions: (
      <>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Estilo da legenda">
          {CAPTION_STYLE_OPTIONS.map((option) => (
            <ChoiceChip
              key={option.value}
              selected={captionStyle === option.value}
              onClick={() => setCaptionStyle(option.value)}
            >
              {option.label.split(" — ")[0]}
            </ChoiceChip>
          ))}
        </div>
        {brandAccent ? (
          <p className="flex items-center gap-2 text-xs text-[var(--via-text-muted)]">
            <span
              className="size-3 rounded-full border border-[var(--via-border)]"
              style={{ backgroundColor: brandAccent }}
              aria-hidden="true"
            />
            Destaque na cor da marca, embaixo do vídeo.
          </p>
        ) : null}
        {sourceLanguageBlock}
      </>
    ),
  };

  const optionRows = (ids: readonly OptionId[]) => (
    <ul className="divide-y divide-[var(--via-border-soft)] border-y border-[var(--via-border-soft)]">
      {ids.map((id) => (
        <OptionRow
          key={id}
          icon={OPTION_ICON[id]}
          title={REMAKE_OPTION_COPY[id].title}
          line={REMAKE_OPTION_COPY[id].line}
          checked={on[id]}
          onToggle={(v) => setOption(id, v)}
        >
          {fields[id]}
        </OptionRow>
      ))}
    </ul>
  );

  const connectLine =
    !checking && missing.length ? (
      <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--via-text-muted)]">
        Para essas melhorias, conecte:
        {missing.map((id) => (
          <Button key={id} variant="outline" size="sm" onClick={() => openIntegration(id)}>
            <BrandIcon name={INTEGRATION_BY_ID[id].brand} />
            Conectar {INTEGRATION_BY_ID[id].name}
          </Button>
        ))}
      </div>
    ) : null;

  // as extras ligadas nunca ficam escondidas
  const extrasOpen = showExtras || extras.some((id) => toggled[id]);

  return (
    <div className="space-y-10">
      {/* 1 · o vídeo */}
      <section className="space-y-3" aria-labelledby="remake-video">
        <StepTitle id="remake-video" n={1}>
          Seu vídeo
        </StepTitle>
        <VideoDrop
          file={file}
          previewUrl={previewUrl}
          seconds={seconds}
          error={fileError}
          maxMb={maxBytes === null ? null : Math.floor(maxBytes / 1_000_000)}
          onPick={pickFile}
          onDuration={setSeconds}
        />
      </section>

      {/* 2 · o que melhorar */}
      {focused ? (
        <section className="space-y-6" aria-labelledby="remake-options">
          <StepTitle id="remake-options" n={2}>
            {primary.length === 1 ? REMAKE_OPTION_COPY[primary[0]].title : "O que melhorar"}
          </StepTitle>
          {primary.map((id) => {
            const Icon = OPTION_ICON[id];
            return (
              <div key={id} className="space-y-3">
                {primary.length > 1 ? (
                  <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--via-text-primary)]">
                    <Icon className="size-4 text-[var(--via-text-muted)]" aria-hidden="true" />
                    {REMAKE_OPTION_COPY[id].title}
                  </h3>
                ) : null}
                <p className="text-xs text-[var(--via-text-muted)]">
                  {REMAKE_OPTION_COPY[id].line}
                </p>
                <div className="space-y-2">{fields[id]}</div>
              </div>
            );
          })}

          {extras.length ? (
            <div className="space-y-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowExtras((v) => !v)}
                aria-expanded={extrasOpen}
                aria-controls="remake-extras"
              >
                <Plus aria-hidden="true" />
                Adicionar outra melhoria
                <ChevronDown
                  aria-hidden="true"
                  className={cn("transition-transform", extrasOpen && "rotate-180")}
                />
              </Button>
              {extrasOpen ? (
                <div
                  id="remake-extras"
                  className="animate-in fade-in slide-in-from-top-1 duration-[180ms]"
                >
                  {optionRows(extras)}
                </div>
              ) : null}
            </div>
          ) : null}
          {connectLine}
        </section>
      ) : (
        <section className="space-y-3" aria-labelledby="remake-options">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <StepTitle id="remake-options" n={2}>
              O que melhorar
            </StepTitle>
            <Button variant="outline" size="sm" onClick={brandLook}>
              <Palette aria-hidden="true" />
              Deixar com a cara da marca
            </Button>
          </div>
          {optionRows(REMAKE_OPTION_IDS)}
          {connectLine}
        </section>
      )}

      {/* 3 · custo e confirmação */}
      <section
        className="space-y-4 border-t border-[var(--via-border-soft)] pt-6"
        aria-labelledby="remake-go"
      >
        <StepTitle id="remake-go" n={3}>
          Custo e confirmação
        </StepTitle>
        {touchesPeople ? (
          <label className="flex items-start gap-2.5 text-sm text-[var(--via-text-body)]">
            <Checkbox
              checked={consent}
              onCheckedChange={(value) => setConsent(value === true)}
              className="mt-0.5"
            />
            Tenho autorização das pessoas que aparecem no vídeo para mudar a imagem e a fala delas.
          </label>
        ) : null}

        {restyle ? (
          <GateOptionList
            task="Estilo e cenário"
            basis={seconds == null ? undefined : `${Math.ceil(seconds)} s de vídeo`}
            rows={sceneGate.rows}
            a={sceneGate.a?.option.id ?? null}
            b={null}
            onSelect={(next) => setSceneModelId(next.a)}
            compare={null}
            fallbackReason={sceneGate.fallbackReason}
            onConnect={() => openIntegration("replicate")}
            loading={v2vModels.isLoading}
            error={v2vModels.isError}
            emptyText="Nenhum modelo de vídeo→vídeo ativo."
            testIdPrefix="remake-scene-option"
          />
        ) : null}

        <p className="text-sm text-[var(--via-text-muted)]" aria-live="polite">
          {blocker ?? "Leva alguns minutos e roda em segundo plano."}
        </p>

        <div data-testid="remake-gate">
          <GateEstimateLine
            estimate={gateEstimate}
            action={
              !checking && missing.length === 1 ? (
                <Button size="lg" onClick={() => openIntegration(missing[0])}>
                  <BrandIcon name={INTEGRATION_BY_ID[missing[0]].brand} />
                  Conectar {INTEGRATION_BY_ID[missing[0]].name}
                </Button>
              ) : (
                <Button
                  size="lg"
                  onClick={() => void submit()}
                  disabled={Boolean(blocker) || sending}
                >
                  {sending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                  {sending
                    ? upload.isPending
                      ? "Enviando vídeo…"
                      : "Começando…"
                    : "Melhorar vídeo"}
                </Button>
              )
            }
          />
        </div>
      </section>
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

function VideoDrop({
  file,
  previewUrl,
  seconds,
  error,
  maxMb,
  onPick,
  onDuration,
}: {
  file: File | null;
  previewUrl: string | null;
  seconds: number | null;
  error: string | null;
  /** limite de tamanho das opções marcadas (Aleph, troca de pessoa); null = sem limite */
  maxMb: number | null;
  onPick: (file: File | null) => void;
  onDuration: (seconds: number | null) => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const accept = (list: FileList | null) => {
    const next = list?.[0] ?? null;
    if (next && !/^video\/(mp4|quicktime)$/.test(next.type)) {
      toast.error("Esse arquivo não é um vídeo MP4 ou MOV", {
        description: "Exporte o vídeo em MP4 e tente de novo.",
      });
      return;
    }
    onPick(next);
  };

  const input = (
    <input
      ref={inputRef}
      id={inputId}
      type="file"
      accept="video/mp4,video/quicktime"
      className="sr-only"
      onChange={(event) => accept(event.target.files)}
      data-testid="remake-file"
    />
  );

  if (file && previewUrl) {
    return (
      <div className="flex flex-wrap items-start gap-4">
        <video
          src={previewUrl}
          controls
          playsInline
          className="h-56 rounded-[var(--via-radius-md)] bg-black"
          onLoadedMetadata={(event) => onDuration(event.currentTarget.duration)}
          onError={() => onDuration(null)}
        />
        <div className="min-w-0 space-y-2 text-sm">
          <p className="truncate font-medium text-[var(--via-text-primary)]">{file.name}</p>
          <p className="text-[var(--via-text-muted)]">
            {seconds === null ? "Lendo o vídeo…" : `${Math.round(seconds)} segundos`} ·{" "}
            {formatMb(file.size)}
          </p>
          {error ? (
            <p role="alert" className="text-[var(--via-coral-dark)]">
              {error}
            </p>
          ) : null}
          {input}
          <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            Trocar vídeo
          </Button>
        </div>
      </div>
    );
  }

  return (
    <label
      htmlFor={inputId}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        accept(event.dataTransfer.files);
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--via-radius-lg)] border border-dashed px-6 py-10 text-center transition-colors",
        dragging
          ? "border-[var(--via-navy)] bg-[var(--via-navy-04)]"
          : "border-[var(--via-border)] hover:border-[var(--via-navy-30)]",
      )}
    >
      <Upload className="size-5 text-[var(--via-text-muted)]" aria-hidden="true" />
      <span className="text-sm font-medium text-[var(--via-text-primary)]">
        Arraste o vídeo aqui ou clique para escolher
      </span>
      <span className="text-xs text-[var(--via-text-muted)]">
        MP4 ou MOV, de 2 a 30 segundos{maxMb ? `, até ${maxMb} MB` : ""}.
      </span>
      {input}
    </label>
  );
}

function OptionRow({
  icon: Icon,
  title,
  line,
  checked,
  onToggle,
  children,
}: {
  icon: LucideIcon;
  title: string;
  line: string;
  checked: boolean;
  onToggle: (value: boolean) => void;
  children: ReactNode;
}) {
  const switchId = useId();
  const lineId = useId();
  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <Icon className="size-4 shrink-0 text-[var(--via-text-muted)]" aria-hidden="true" />
        {/* o título é o nome do interruptor; a frase, a descrição dele */}
        <div className="min-w-0 flex-1">
          <label
            htmlFor={switchId}
            className="block cursor-pointer text-sm font-medium text-[var(--via-text-primary)]"
          >
            {title}
          </label>
          <span id={lineId} className="block text-xs text-[var(--via-text-muted)]">
            {line}
          </span>
        </div>
        <Switch
          id={switchId}
          checked={checked}
          onCheckedChange={onToggle}
          aria-describedby={lineId}
        />
      </div>
      {checked ? (
        <div className="mt-3 space-y-2 pl-7 animate-in fade-in slide-in-from-top-1 duration-[180ms]">
          {children}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Um quadro nítido do vídeo (perto de 1 s, ou no meio se for mais curto) como
 * JPG, tirado no próprio navegador — é a "foto" da foto que fala do HeyGen.
 */
const FRAME_MAX_SIDE = 1920;
const FRAME_TIMEOUT_MS = 8000;

function grabFrame(url: string, seconds: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // sem isto um HEVC que o navegador não decodifica prendia o envio para sempre
    const timer = setTimeout(
      () => reject(new Error("O navegador não conseguiu ler um quadro do vídeo.")),
      FRAME_TIMEOUT_MS,
    );
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    const fail = () => {
      clearTimeout(timer);
      reject(new Error("Não foi possível tirar um quadro do vídeo."));
    };
    video.onerror = fail;
    video.onloadeddata = () => {
      video.currentTime = Math.min(1, Math.max(0, seconds / 2));
    };
    video.onseeked = () => {
      // 4K vira JPEG de vários MB: reduz o lado maior para 1920
      const scale = Math.min(1, FRAME_MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx || !canvas.width) return fail();
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          clearTimeout(timer);
          if (blob) resolve(blob);
          else fail();
        },
        "image/jpeg",
        0.9,
      );
    };
  });
}

/**
 * Áudio do vídeo como WAV mono 22,05 kHz (até 60 s), decodificado no próprio
 * navegador — é a amostra para clonar a voz de quem fala.
 */
async function extractWav(file: File): Promise<Blob> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    const rate = 22050;
    const seconds = Math.min(decoded.duration, 60);
    const offline = new OfflineAudioContext(1, Math.ceil(seconds * rate), rate);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start(0, 0, seconds);
    const mono = (await offline.startRendering()).getChannelData(0);
    const buffer = new ArrayBuffer(44 + mono.length * 2);
    const view = new DataView(buffer);
    const text = (offset: number, value: string) =>
      [...value].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
    text(0, "RIFF");
    view.setUint32(4, 36 + mono.length * 2, true);
    text(8, "WAVE");
    text(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, "data");
    view.setUint32(40, mono.length * 2, true);
    for (let i = 0; i < mono.length; i++) {
      const v = Math.max(-1, Math.min(1, mono[i]));
      view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    }
    return new Blob([buffer], { type: "audio/wav" });
  } catch {
    throw new Error(
      "Não conseguimos ler o áudio deste vídeo para clonar a voz. Escolha voz feminina ou masculina.",
    );
  } finally {
    void ctx.close();
  }
}
