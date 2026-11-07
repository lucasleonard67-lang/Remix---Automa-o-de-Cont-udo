import { Share2 } from "lucide-react";
import { toast } from "@/lib/toast";

import { ChannelLabel } from "@/components/channel-label";
import { EmptyState } from "@/components/empty-state";
import { WizardFooter } from "@/components/onboarding/wizard-shell";
import type { OnboardingStepProps } from "@/components/onboarding/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  CHANNEL_TYPE_LABELS,
  useChannels,
  useToggleChannel,
  type ChannelRow,
} from "@/hooks/use-channels";

// ---------------------------------------------------------------------------
// Passo 8 — canais: quais formatos a geração produz. Exige ≥ 1 ativo.
// (Limites e nota de corte por canal ficam em /marca/canais.)
// ---------------------------------------------------------------------------

const CHANNEL_HINTS: Record<string, string> = {
  instagram_stories: "3 a 6 telas verticais com gancho, desenvolvimento e CTA.",
  instagram_carousel: "Slides com texto + legenda.",
  instagram_post: "Imagem única + legenda.",
  x_post: "Post curto, com thread opcional.",
  threads_post: "Post conversacional, com thread opcional.",
  linkedin_post: "Texto em blocos, tom profissional.",
  facebook_post: "Texto corrido + imagem.",
};

export function StepChannels({ advancing, onBack, onAdvance }: OnboardingStepProps) {
  const channelsQuery = useChannels();
  const channels = channelsQuery.data ?? [];
  const enabledCount = channels.filter((channel) => channel.enabled).length;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Ligue os canais onde a marca publica: cada peça sai no formato e no tamanho certos para cada
        um. Dá para mudar depois.
      </p>

      {channelsQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 7 }).map((_, index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))}
        </div>
      ) : channels.length === 0 ? (
        <EmptyState
          icon={Share2}
          title="Não foi possível carregar os canais"
          description="Verifique a conexão e recarregue a página. Se continuar, fale com o suporte."
        />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {channels.map((channel) => (
            <ChannelToggleRow key={channel.id} channel={channel} />
          ))}
        </ul>
      )}

      <WizardFooter
        onBack={onBack}
        hint={enabledCount === 0 ? "Ligue ao menos um canal para continuar." : null}
      >
        <Button onClick={() => void onAdvance()} disabled={advancing || enabledCount === 0}>
          {advancing ? "Salvando…" : "Continuar"}
        </Button>
      </WizardFooter>
    </div>
  );
}

function ChannelToggleRow({ channel }: { channel: ChannelRow }) {
  const toggleChannel = useToggleChannel();

  const handleToggle = (enabled: boolean) => {
    toggleChannel.mutate(
      { id: channel.id, enabled },
      {
        onError: (error) => {
          toast.error("Não foi possível alterar o canal", { description: error.message });
        },
      },
    );
  };

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          <ChannelLabel type={channel.type} />
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {CHANNEL_HINTS[channel.type] ?? ""}
        </p>
      </div>
      <Switch
        checked={channel.enabled}
        onCheckedChange={handleToggle}
        disabled={toggleChannel.isPending}
        aria-label={`Ativar ${CHANNEL_TYPE_LABELS[channel.type]}`}
      />
    </li>
  );
}
