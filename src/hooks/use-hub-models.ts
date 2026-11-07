import {
  atResolution,
  directorResolution,
  formatUsd,
  formatUsdRate,
  HIGGSFIELD_VIDEO_MODELS,
  useExperienceModels,
  useReplicateVideoModels,
  type VideoCapability,
  type VideoModelOption,
} from "@/hooks/use-video-models";
import { PERSON_SWAP_RESOLUTION, personSwapRate } from "@/lib/remake-options";
import {
  routeAccepts,
  routeModels,
  type HubProvider,
  type HubRoute,
  type ModelChoice,
} from "@/lib/video-hub";

// ---------------------------------------------------------------------------
// "Padrão · Top" de uma rota do hub, conferido com o que existe de fato.
//
// 1. O catálogo manda: linhas ativas com a experiência da rota em
//    `video_models.experience[]`, padrão → top → custo (contrato da frente A).
// 2. Sem essas colunas no banco (ou sem linhas padrão/top), vale o plano
//    (docs/hub-full-plano.md): a linha do Replicate só conta se estiver ativa
//    no catálogo — o preço vem dela —, o resto aparece "em breve".
// O destino precisa saber rodar o modelo (`routeAccepts`); senão, "em breve".
// ---------------------------------------------------------------------------

export type ChoiceState = "ready" | "checking" | "soon";

export interface ResolvedChoice {
  choice: ModelChoice;
  state: ChoiceState;
  /** "US$ 0,450/s em 1080p" — da linha do catálogo quando há, senão o do plano */
  cost: string;
  /** tempo de geração: só quando o plano tem um número */
  time: string | null;
}

const HF_IDS = HIGGSFIELD_VIDEO_MODELS.map((m) => m.id);
const PROVIDERS: HubProvider[] = ["replicate", "heygen", "higgsfield", "elevenlabs"];

/** Preço da linha do catálogo, na resolução que o motor usa. */
function catalogCost(row: VideoModelOption, capability: string): string | null {
  if (row.costUnverified) return "preço a confirmar";
  if (capability === "scene_i2v") {
    const res = directorResolution(row);
    const priced = atResolution(row, res);
    if (priced.usdPerSecond == null) return null;
    const at = res && row.usdByResolution?.[res] != null ? ` em ${res}` : "";
    return `${formatUsdRate(priced.usdPerSecond)}${at}`;
  }
  if (capability === "person_swap") {
    const rate = personSwapRate(row);
    if (rate == null) return null;
    const at =
      row.usdByResolution?.[PERSON_SWAP_RESOLUTION] != null ? ` em ${PERSON_SWAP_RESOLUTION}` : "";
    return `${formatUsdRate(rate)}${at}`;
  }
  if (row.usdPer1kChars != null) return `${formatUsd(row.usdPer1kChars)}/1k letras`;
  if (row.usdPerImage != null) return `${formatUsd(row.usdPerImage)}/imagem`;
  if (row.usdPerSecond != null) return formatUsdRate(row.usdPerSecond);
  return null;
}

export function useHubModels(route: HubRoute | null): {
  choices: ResolvedChoice[];
  /** o primeiro disponível (o padrão, se estiver) — null quando nenhum está */
  suggested: ResolvedChoice | null;
} {
  const experience = useExperienceModels(route?.experience ?? null);
  // plano: uma consulta por capacidade (cache de 5 min)
  const lists: Partial<Record<VideoCapability, ReturnType<typeof useReplicateVideoModels>>> = {
    scene_i2v: useReplicateVideoModels("scene_i2v"),
    scene_v2v: useReplicateVideoModels("scene_v2v"),
    person_swap: useReplicateVideoModels("person_swap"),
    tts: useReplicateVideoModels("tts"),
    talking_avatar: useReplicateVideoModels("talking_avatar"),
  };

  if (!route) return { choices: [], suggested: null };
  const plan = routeModels(route);

  let choices: ResolvedChoice[];
  const fromCatalog = (experience.data ?? []).filter(
    (r) => r.tier === "default" || r.tier === "top",
  );
  if (experience.isPending && route) {
    choices = plan.map((choice) => ({
      choice,
      state: "checking",
      cost: choice.cost,
      time: choice.time,
    }));
  } else if (fromCatalog.length) {
    choices = fromCatalog.map((row) => {
      const provider = (PROVIDERS as string[]).includes(row.provider)
        ? (row.provider as HubProvider)
        : "replicate";
      const known = plan.find((c) => c.id === row.option.id && c.provider === provider);
      const choice: ModelChoice = {
        provider,
        id: row.option.id,
        label: row.option.label,
        cost: catalogCost(row.option, row.capability) ?? known?.cost ?? "custo a confirmar",
        time: known?.time ?? "",
      };
      const ok = routeAccepts(route, { ...choice, capability: row.capability }, HF_IDS);
      return { choice, state: ok ? "ready" : "soon", cost: choice.cost, time: choice.time || null };
    });
  } else {
    choices = plan.map((choice) => {
      const base = { choice, cost: choice.cost, time: choice.time || null };
      if (choice.catalog) {
        const query = lists[choice.catalog];
        if (!query || query.isPending) return { ...base, state: "checking" as const };
        const row = (query.data ?? []).find((o) => o.id === choice.id);
        if (!row) return { ...base, state: "soon" as const };
        const ok = routeAccepts(route, { ...choice, capability: choice.catalog }, HF_IDS);
        return {
          ...base,
          cost: catalogCost(row, choice.catalog) ?? choice.cost,
          state: ok ? ("ready" as const) : ("soon" as const),
        };
      }
      const ok = !choice.soon && routeAccepts(route, choice, HF_IDS);
      return { ...base, state: ok ? ("ready" as const) : ("soon" as const) };
    });
  }

  const suggested = choices.find((c) => c.state === "ready") ?? null;
  return { choices, suggested };
}
