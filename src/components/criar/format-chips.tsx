import { ChannelIcon } from "@/components/criar/channel-tiles";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { FORMAT_LABELS, STATIC_FORMATS } from "@/components/criar/formats";
import { CHANNEL_TYPE_LABELS, type ChannelType } from "@/hooks/use-channels";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Porta de entrada do criador: UMA linha de formatos, nas palavras de quem
// posta. Um chip por formato estático (Reel e vídeo moram em /videos/novo).
// Chip de canal marca/desmarca o canal da peça (mesma seleção dos ladrilhos);
// nenhum marcado = "o sistema escolhe".
// Canal desligado na instância aparece apagado: o admin liga por aqui mesmo.
// ---------------------------------------------------------------------------

export function FormatChips({
  enabled,
  selected,
  onToggle,
  onEnableChannels,
}: {
  /** Canais ligados na instância. */
  enabled: ReadonlySet<ChannelType>;
  selected: ReadonlySet<ChannelType>;
  onToggle: (type: ChannelType) => void;
  /** Admin: abre a grade de canais para ligar um desligado. Sem ela, o chip fica inerte. */
  onEnableChannels?: () => void;
}) {
  return (
    <ul className="flex flex-wrap items-center gap-2" aria-label="Formatos">
      {STATIC_FORMATS.map((type) => {
        const on = enabled.has(type);
        const off = !on;
        return (
          <li key={type}>
            <ChoiceChip
              selected={selected.has(type)}
              onClick={() => (on ? onToggle(type) : onEnableChannels?.())}
              disabled={off && !onEnableChannels}
              title={
                off ? `${CHANNEL_TYPE_LABELS[type]} está desligado — ligue em Canais` : undefined
              }
              icon={<ChannelIcon type={type} className="size-3.5" />}
              className={cn("px-3 py-1.5 text-sm", off && "border-dashed opacity-60")}
              data-testid={`dashboard-formato-${type}`}
            >
              {FORMAT_LABELS[type]}
            </ChoiceChip>
          </li>
        );
      })}
    </ul>
  );
}
