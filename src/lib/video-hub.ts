import type { AvatarRow } from "@/hooks/use-avatars";
import type { CatalogExperience, VideoCapability } from "@/hooks/use-video-models";
import type { IntegrationId } from "@/lib/integrations";

// ---------------------------------------------------------------------------
// Hub de vídeo — a pessoa diz o que TEM e o que QUER; o produto sugere o
// provedor e o modelo. Fonte: docs/hub-de-video-mapa.md e docs/hub-full-plano.md.
//
// Cada rota traz o modelo padrão e as opções top (docs/hub-full-plano.md),
// com custo e tempo. Custos são aproximados e mudam com o provedor; nas linhas
// do catálogo do Replicate, o preço da linha ativa manda.
// ---------------------------------------------------------------------------

export type HubHave = "idea" | "photo" | "video";

export type HubWant =
  | "scenes" // vídeo de cenas com narração
  | "presenter" // vídeo comigo nas cenas (apresentador)
  | "avatar" // um avatar HeyGen (biblioteca ou meu) apresenta o roteiro
  | "photo_avatar" // minha foto vira apresentador
  | "twin" // meu clone (Digital Twin)
  | "agent" // só a ideia, vídeo pronto (HeyGen Video Agent)
  | "speech" // mantém meu rosto e meu ambiente, muda o que eu digo
  | "translate" // traduz meu vídeo
  | "style" // muda o estilo
  | "scene" // muda o cenário de uma cena
  | "character" // troca a pessoa
  | "captions" // legendas da marca
  | "reframe"; // reenquadrar e melhorar (Higgsfield)

export type HubProvider = "higgsfield" | "heygen" | "replicate" | "elevenlabs";

/** Telas novas (HeyGen/Higgsfield) que dependem do contrato do motor. */
export type HubStudio = "avatar" | "photo_avatar" | "twin" | "agent" | "reframe";

/**
 * Um modelo que a rota pode usar. `cost`/`time` vêm do plano
 * (docs/hub-full-plano.md + catálogos); com `catalog`, a linha ativa do
 * `video_models` manda (nome e preço) e, sem ela, o modelo aparece "em breve".
 */
export interface ModelChoice {
  provider: HubProvider;
  /** slug do catálogo (Replicate) ou id do provedor (Higgsfield/HeyGen) */
  id: string;
  label: string;
  cost: string;
  time: string;
  /** capacidade do `video_models` em que o slug precisa estar ativo */
  catalog?: VideoCapability;
  /** o destino ainda não aceita este modelo (sem motor ou sem tela) */
  soon?: boolean;
}

export interface HubRoute {
  want: HubWant;
  /** slug da experiência no catálogo (`video_models.experience[]`) */
  experience: CatalogExperience;
  label: string;
  line: string;
  /** O que o produto vai usar (texto para a pessoa). */
  via: string;
  /** Provedores fixos da rota; o do modelo escolhido entra por cima. */
  providers: HubProvider[];
  /** Padrão (sugerido) e as opções top, com custo e tempo de cada. */
  models: { default: ModelChoice; top?: ModelChoice[] };
  /** Onde a rota leva. */
  action:
    | { kind: "director" }
    | {
        kind: "remake";
        options: Array<"style" | "scene" | "character" | "speech" | "translate" | "captions">;
      }
    | { kind: "studio"; studio: HubStudio };
  /** Fica em "Mais opções" (divulgação progressiva). */
  more?: boolean;
  /** Avisos honestos sobre limites de hoje. */
  note?: string;
  /** O que mais dá para escolher no passo seguinte (motor, modelo, voz). */
  options?: string;
}

/**
 * Estúdios com tela pelo contrato do motor (docs/hub-motor-contratos.md). Se o
 * motor ainda não foi publicado, a própria tela diz "chega no próximo deploy".
 */
export const STUDIO_READY: Record<HubStudio, boolean> = {
  avatar: true,
  photo_avatar: true,
  twin: true,
  agent: true,
  // sem contrato do motor ainda (docs/hub-motor-contratos.md não cobre)
  reframe: false,
};

export function routeReady(route: HubRoute): boolean {
  return route.action.kind !== "studio" || STUDIO_READY[route.action.studio];
}

/** O destino da rota sabe rodar este modelo? (linha do catálogo ou escolha do plano) */
export function routeAccepts(
  route: HubRoute,
  model: { provider: string; capability?: string | null; id: string },
  higgsfieldIds: readonly string[],
): boolean {
  const { provider, capability } = model;
  const action = route.action;
  if (action.kind === "director")
    return provider === "replicate"
      ? capability === "scene_i2v"
      : provider === "higgsfield" && higgsfieldIds.includes(model.id);
  if (action.kind === "remake") {
    if (route.want === "style" || route.want === "scene")
      return provider === "replicate" && capability === "scene_v2v";
    if (route.want === "speech")
      return provider === "elevenlabs" || (provider === "replicate" && capability === "tts");
    if (route.want === "character") return provider === "replicate" && capability === "person_swap";
    return true; // tradução e legendas: o servidor escolhe
  }
  if (!STUDIO_READY[action.studio]) return false;
  if (action.studio === "photo_avatar")
    return provider === "heygen" || (provider === "replicate" && capability === "talking_avatar");
  return provider === (action.studio === "reframe" ? "higgsfield" : "heygen");
}

export const HUB_HAVE: Array<{ id: HubHave; label: string; line: string }> = [
  { id: "idea", label: "Só a ideia", line: "Um tema, um número, uma mensagem." },
  { id: "photo", label: "Minha foto", line: "Um apresentador cadastrado com foto." },
  { id: "video", label: "Um vídeo meu", line: "Gravado por você, até 30 s." },
];

// ── modelos (docs/hub-full-plano.md, tabela "Experiências (padrão · top)") ──
const SCENE_TIME = "10–20 min";
const KLING_40: ModelChoice = {
  provider: "replicate",
  id: "kwaivgi/kling-v4.0",
  label: "Kling 4.0",
  cost: "US$ 0,157/s em 720p",
  time: SCENE_TIME,
  catalog: "scene_i2v",
};
const SCENES_MODELS: HubRoute["models"] = {
  default: {
    provider: "replicate",
    id: "bytedance/seedance-2.0",
    label: "Seedance 2.0",
    cost: "US$ 0,18/s em 720p",
    time: SCENE_TIME,
    catalog: "scene_i2v",
  },
  top: [
    KLING_40,
    {
      provider: "replicate",
      id: "google/veo-3.1",
      label: "Veo 3.1",
      cost: "US$ 0,20/s",
      time: SCENE_TIME,
      catalog: "scene_i2v",
    },
    {
      provider: "higgsfield",
      id: "seedance_2_5",
      label: "Seedance 2.5",
      cost: "≈ 70 créditos por 10 s em 720p",
      time: SCENE_TIME,
    },
  ],
};
const PRESENTER_MODELS: HubRoute["models"] = {
  default: KLING_40,
  top: [
    {
      provider: "higgsfield",
      id: "cinematic_studio_video_4_0",
      label: "Cinema Studio 4.0",
      cost: "créditos Higgsfield",
      time: SCENE_TIME,
    },
  ],
};
const V2V_MODELS: HubRoute["models"] = {
  default: {
    provider: "replicate",
    id: "kwaivgi/kling-v4.0",
    label: "Kling 4.0 (edição)",
    cost: "US$ 0,141/s em 1080p",
    time: "2–6 min",
    catalog: "scene_v2v",
  },
  top: [
    {
      provider: "replicate",
      id: "runwayml/aleph-2",
      label: "Aleph 2",
      cost: "US$ 0,336/s",
      time: "2–6 min",
      catalog: "scene_v2v",
    },
  ],
};
const HEYGEN_AVATAR_TIME = "3–8 min";
// preços da HeyGen sem conferência oficial (catalogo-heygen.md §0): sem número
const HEYGEN_PRICE = "preço a confirmar";

const DIRECTOR_SCENES: HubRoute = {
  want: "scenes",
  experience: "scenes",
  label: "Vídeo de cenas com narração",
  line: "Roteiro, cenas geradas, voz da marca, trilha e legendas.",
  // sem o login do Higgsfield: quadros no Replicate, montagem pelo seu Claude
  via: "Cenas no modelo escolhido; montagem no Higgsfield ou no seu Claude; voz ElevenLabs",
  providers: ["elevenlabs"],
  models: SCENES_MODELS,
  action: { kind: "director" },
  options: "No próximo passo: tema e duração. Dá para trocar o modelo das cenas lá também.",
};

const PRESENTER_NOTE = "Exige um apresentador com foto.";
const PRESENTER_OPTIONS =
  "No próximo passo: tema, apresentador e duração. O Higgsfield mantém o rosto; no Replicate o rosto vem só do quadro.";

const DIRECTOR_PRESENTER: HubRoute = {
  want: "presenter",
  experience: "presenter_in_scenes",
  label: "Vídeo comigo nas cenas",
  line: "O apresentador aparece nas cenas; a narração vai por cima.",
  via: "Cenas no modelo escolhido; montagem no Higgsfield ou no seu Claude; voz ElevenLabs",
  providers: ["elevenlabs"],
  models: PRESENTER_MODELS,
  action: { kind: "director" },
  note: PRESENTER_NOTE,
  options: PRESENTER_OPTIONS,
};

const AVATAR_ROUTE: HubRoute = {
  want: "avatar",
  experience: "avatar_script",
  label: "Um avatar apresenta o roteiro",
  line: "Um avatar da biblioteca HeyGen, ou um seu, fala o seu texto.",
  via: "HeyGen (avatar) + voz da marca",
  providers: ["heygen"],
  models: {
    default: {
      provider: "heygen",
      id: "heygen/avatar-iv",
      label: "Avatar IV",
      cost: HEYGEN_PRICE,
      time: HEYGEN_AVATAR_TIME,
    },
    top: [
      {
        provider: "heygen",
        id: "heygen/avatar-v",
        label: "Avatar V",
        cost: HEYGEN_PRICE,
        time: HEYGEN_AVATAR_TIME,
      },
    ],
  },
  action: { kind: "studio", studio: "avatar" },
  note: "Avatar V só nos avatares que aceitam esse motor.",
};

const AGENT_ROUTE: HubRoute = {
  want: "agent",
  experience: "idea_to_video",
  label: "Só a ideia, vídeo pronto",
  line: "Descreva o vídeo; o HeyGen escreve, monta e aplica a sua marca.",
  via: "HeyGen Video Agent + Brand Kit do site",
  providers: ["heygen"],
  models: {
    default: {
      provider: "heygen",
      id: "heygen/video-agent",
      label: "Video Agent",
      cost: HEYGEN_PRICE,
      time: "5–10× a duração",
    },
  },
  action: { kind: "studio", studio: "agent" },
  more: true,
};

const PHOTO_AVATAR_ROUTE: HubRoute = {
  want: "photo_avatar",
  experience: "photo_presenter",
  label: "Minha foto vira apresentador",
  line: "Uma foto sua fala o roteiro, com a voz da marca.",
  via: "HeyGen (photo avatar) ou Replicate (avatar falante)",
  providers: [],
  models: {
    default: {
      provider: "heygen",
      id: "heygen/avatar-iv",
      label: "Avatar IV",
      cost: HEYGEN_PRICE,
      time: HEYGEN_AVATAR_TIME,
    },
    top: [
      {
        provider: "replicate",
        id: "prunaai/p-video-2-pro-avatar",
        label: "P-Video 2 Pro Avatar",
        cost: "US$ 0,06/s em 1080p",
        time: "2–6 min",
        catalog: "talking_avatar",
      },
      {
        provider: "replicate",
        id: "bytedance/omni-human-1.5",
        label: "OmniHuman 1.5",
        cost: "US$ 0,16/s · até 34 s",
        time: "2–6 min",
        catalog: "talking_avatar",
      },
    ],
  },
  action: { kind: "studio", studio: "photo_avatar" },
};

const TWIN_ROUTE: HubRoute = {
  want: "twin",
  experience: "digital_twin",
  label: "Meu clone",
  line: "Um vídeo seu de ~2 min vira um avatar que fala qualquer roteiro.",
  via: "HeyGen (Digital Twin) com a sua voz",
  providers: ["heygen"],
  models: {
    default: {
      provider: "heygen",
      id: "heygen/avatar-iv",
      label: "Avatar IV",
      cost: HEYGEN_PRICE,
      time: "3–8 min por vídeo",
    },
    top: [
      {
        provider: "heygen",
        id: "heygen/avatar-v",
        label: "Avatar V",
        cost: HEYGEN_PRICE,
        time: "3–8 min por vídeo",
      },
    ],
  },
  action: { kind: "studio", studio: "twin" },
  more: true,
  note: "A pessoa do vídeo grava um consentimento pelo link do HeyGen.",
};

const REFRAME_ROUTE: HubRoute = {
  want: "reframe",
  experience: "reframe_upscale",
  label: "Reenquadrar e melhorar",
  line: "Do horizontal para 9:16, com mais nitidez.",
  via: "Higgsfield (reframe + upscale)",
  providers: ["higgsfield"],
  models: {
    default: {
      provider: "higgsfield",
      id: "reframe",
      label: "Reframe + upscale",
      cost: "créditos Higgsfield, sem preço prévio",
      time: "tempo a confirmar",
    },
  },
  action: { kind: "studio", studio: "reframe" },
  more: true,
};

/** Apresentador que serve ao Diretor: tem foto ou o personagem Higgsfield já pronto. */
export function presenterHasFace(
  avatar: Pick<AvatarRow, "reference_image_path" | "identity_pack_paths" | "provider_refs">,
): boolean {
  return (
    Boolean(avatar.reference_image_path) ||
    (avatar.identity_pack_paths?.length ?? 0) > 0 ||
    avatar.provider_refs?.higgsfield?.status === "ready"
  );
}

export const HUB_ROUTES: Record<HubHave, HubRoute[]> = {
  idea: [DIRECTOR_SCENES, DIRECTOR_PRESENTER, AVATAR_ROUTE, AGENT_ROUTE],
  photo: [
    { ...DIRECTOR_PRESENTER, line: "Seu apresentador nas cenas, com a narração da marca." },
    PHOTO_AVATAR_ROUTE,
    { ...DIRECTOR_SCENES, more: true },
  ],
  video: [
    {
      want: "speech",
      experience: "change_speech",
      label: "Mudar o que eu digo",
      line: "Mantém seu rosto e seu ambiente; a boca acompanha a fala nova.",
      via: "Voz nova + sincronia labial HeyGen (preço a confirmar)",
      providers: ["heygen"],
      models: {
        default: {
          provider: "replicate",
          id: "minimax/speech-2.8-hd",
          label: "MiniMax 2.8",
          cost: "US$ 0,10/1k letras",
          time: "3–8 min",
          catalog: "tts",
        },
        top: [
          {
            provider: "elevenlabs",
            id: "elevenlabs",
            label: "ElevenLabs (voz da marca)",
            cost: "no plano ElevenLabs",
            time: "3–8 min",
          },
        ],
      },
      action: { kind: "remake", options: ["speech"] },
      options:
        "No próximo passo: voz feminina, masculina, a sua voz (clone) ou qualquer Voice ID do ElevenLabs.",
    },
    {
      want: "translate",
      experience: "translate",
      label: "Traduzir meu vídeo",
      line: "Outro idioma, mantendo sua voz e a boca sincronizada.",
      via: "HeyGen (tradução com voz clonada)",
      providers: ["heygen"],
      models: {
        default: {
          provider: "heygen",
          id: "heygen/video-translation",
          label: "Tradução HeyGen",
          cost: HEYGEN_PRICE,
          time: "5–10 min",
        },
      },
      action: { kind: "remake", options: ["translate"] },
    },
    {
      want: "style",
      experience: "restyle",
      label: "Mudar o estilo",
      line: "O vídeo inteiro num visual novo (cinema, anime, marca…).",
      via: "Replicate (vídeo → vídeo)",
      providers: [],
      models: V2V_MODELS,
      action: { kind: "remake", options: ["style"] },
    },
    {
      want: "captions",
      experience: "captions",
      label: "Legendas da marca",
      line: "Legendas queimadas no estilo da marca.",
      via: "ElevenLabs (transcrição) + montagem Higgsfield",
      providers: ["higgsfield"],
      models: {
        default: {
          provider: "elevenlabs",
          id: "scribe_v2",
          label: "Scribe v2",
          cost: "centavos",
          time: "1–2 min",
        },
      },
      action: { kind: "remake", options: ["captions"] },
    },
    {
      want: "scene",
      experience: "restyle",
      label: "Mudar o cenário",
      line: "Troque o lugar ou um detalhe da cena, em uma frase.",
      via: "Replicate (vídeo → vídeo)",
      providers: [],
      models: V2V_MODELS,
      action: { kind: "remake", options: ["scene"] },
      more: true,
    },
    {
      want: "character",
      experience: "person_swap",
      label: "Trocar a pessoa",
      line: "Seu apresentador no lugar de quem aparece. Mantém o áudio original.",
      via: "Replicate + fotos do apresentador",
      providers: [],
      models: {
        default: {
          provider: "replicate",
          id: "prunaai/p-video-replace",
          label: "P-Video Replace",
          cost: "US$ 0,06/s em 1080p",
          time: "2–6 min",
          catalog: "person_swap",
        },
      },
      action: { kind: "remake", options: ["character"] },
      more: true,
      options: "No próximo passo: escolha o apresentador e, se quiser, diga como ele deve ficar.",
    },
    TWIN_ROUTE,
    REFRAME_ROUTE,
  ],
};

export const HUB_PROVIDER_LABEL: Record<HubProvider, string> = {
  higgsfield: "Higgsfield",
  heygen: "HeyGen",
  replicate: "Replicate",
  elevenlabs: "ElevenLabs",
};

export const HUB_PROVIDER_INTEGRATION: Record<HubProvider, IntegrationId> = {
  higgsfield: "higgsfield",
  heygen: "heygen",
  replicate: "replicate",
  elevenlabs: "elevenlabs",
};

export const HUB_WANTS: HubWant[] = [
  "scenes",
  "presenter",
  "avatar",
  "photo_avatar",
  "twin",
  "agent",
  "speech",
  "translate",
  "style",
  "scene",
  "character",
  "captions",
  "reframe",
];

/** Todos os modelos da rota, o padrão primeiro. */
export function routeModels(route: HubRoute): ModelChoice[] {
  return [route.models.default, ...(route.models.top ?? [])];
}

/** id de modelo aceito em ?modelo= (slug do catálogo ou id do provedor). */
export function isModelParam(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._/-]{1,79}$/i.test(value);
}

/** A rota de um "quero" (para quem chega com ?rota= da tela inicial). */
export function routeForWant(want: HubWant): HubRoute | null {
  for (const have of ["video", "photo", "idea"] as HubHave[]) {
    const found = HUB_ROUTES[have].find((r) => r.want === want);
    if (found) return found;
  }
  return null;
}

/** A rota do hub que serve a experiência do catálogo (para o sino e a lista de Vídeos). */
export function wantForExperience(experience: string | null | undefined): HubWant | null {
  if (!experience) return null;
  for (const routes of Object.values(HUB_ROUTES)) {
    const found = routes.find((r) => r.experience === experience);
    if (found) return found.want;
  }
  return null;
}
