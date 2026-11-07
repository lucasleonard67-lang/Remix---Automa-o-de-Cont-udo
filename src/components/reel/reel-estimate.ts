import type { GateEstimateState } from "@/components/generation/gate-estimate-line";
import {
  VIDEO_SCENE_TYPE_LABELS,
  videoErrorCode,
  type VideoEstimate,
} from "@/hooks/use-video-project";

// A estimativa do servidor (`generate-video` action `estimate`) no formato do
// portão. Um mapeamento só para o recibo da tela e para o diálogo de confirmação.

export interface ReelEstimateInput {
  data: VideoEstimate | undefined;
  isLoading: boolean;
  error: Error | null;
  onRetry?: () => void;
}

export function reelEstimateState(input: ReelEstimateInput): GateEstimateState {
  if (input.isLoading) return { kind: "loading" };
  if (input.error) {
    // 400 sem REPLICATE_API_TOKEN: não é erro, é conexão que falta
    if (videoErrorCode(input.error) === "replicate_not_configured")
      return { kind: "connect", integration: "replicate" };
    return { kind: "error", error: input.error, onRetry: input.onRetry };
  }
  if (!input.data) return { kind: "pending", reason: "calculando as cenas" };
  const { estimate, budget } = input.data;
  return {
    kind: "server",
    totalUsd: estimate.total_usd,
    perScene: estimate.per_scene.map((scene) => ({
      label: `Cena ${scene.scene_index + 1} · ${VIDEO_SCENE_TYPE_LABELS[scene.type]} · ${scene.duration_s.toFixed(1)} s`,
      usd: scene.usd,
    })),
    budget:
      budget.monthly_cap_usd > 0
        ? { spentUsd: budget.month_spent_usd, capUsd: budget.monthly_cap_usd }
        : null,
  };
}
