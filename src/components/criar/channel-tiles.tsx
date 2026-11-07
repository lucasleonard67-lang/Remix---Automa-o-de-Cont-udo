import { Check, LayoutGrid, Share2, Video } from "lucide-react";
import "@/components/analytics/analytics.css";

import { NetworkCluster } from "@/components/analytics/network-cluster";
import { BrandIcon } from "@/components/brand-icon";
import { CHANNEL_PURPOSE } from "@/components/channels/channels-grid";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CHANNEL_TYPE_LABELS, type ChannelRow, type ChannelType } from "@/hooks/use-channels";
import { channelBrand } from "@/lib/brands";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Canais da tela Criar como ladrilhos de vidro do kit (mesmo ladrilho de
// Marca → Canais e das integrações): ícone oficial da rede uma vez, nome do
// formato e uma linha do que sai. Selecionar é um toggle (aria-pressed) com o
// check entrando com mola. "O sistema escolhe" é o primeiro ladrilho e vale
// quando nenhum canal está marcado.
// ---------------------------------------------------------------------------

const TILE_CLASS =
  "via-tile via-tile--atmos via-tile--lift ce-tile group flex h-full w-full items-start gap-3 rounded-[var(--via-radius-lg)] !p-4 text-left focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]";

/** Ícone oficial da plataforma; formato sem marca usável cai num ícone neutro. */
export function ChannelIcon({ type, className }: { type: ChannelType; className?: string }) {
  const brand = channelBrand(type);
  if (brand) return <BrandIcon name={brand} className={className} />;
  return <Share2 className={cn("text-[var(--via-text-muted)]", className)} aria-hidden="true" />;
}

export function ChannelTiles({
  channels,
  selected,
  onToggle,
  onClear,
  onPresenterVideo,
}: {
  channels: ChannelRow[];
  selected: ReadonlySet<ChannelType>;
  onToggle: (type: ChannelType) => void;
  onClear: () => void;
  /** "Vídeo com apresentador": abre o estúdio do Diretor levando o tema. */
  onPresenterVideo?: () => void;
}) {
  const auto = selected.size === 0;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Canais da peça">
      <li>
        <ChannelTile
          selected={auto}
          onClick={onClear}
          icon={<LayoutGrid className="size-5 text-[var(--via-text-primary)]" aria-hidden="true" />}
          name="O sistema escolhe"
          purpose="Entre os canais ligados, os que combinam com o tema."
        />
      </li>
      {channels.map((channel) => (
        <li key={channel.id}>
          <ChannelTile
            selected={selected.has(channel.type)}
            onClick={() => onToggle(channel.type)}
            icon={<ChannelIcon type={channel.type} className="size-5" />}
            name={CHANNEL_TYPE_LABELS[channel.type]}
            purpose={CHANNEL_PURPOSE[channel.type]}
            testId={`criar-canal-${channel.type}`}
          />
        </li>
      ))}
      {onPresenterVideo ? (
        <li>
          <ChannelTile
            selected={false}
            onClick={onPresenterVideo}
            icon={<Video className="size-5 text-[var(--via-text-primary)]" aria-hidden="true" />}
            name="Vídeo com apresentador"
            purpose="Abre o estúdio de vídeo já com o seu tema."
            testId="criar-canal-apresentador"
          />
        </li>
      ) : null}
    </ul>
  );
}

function ChannelTile({
  selected,
  onClick,
  icon,
  name,
  purpose,
  testId,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  name: string;
  purpose: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      data-testid={testId}
      className={cn(TILE_CLASS, selected && "!border-[var(--via-navy)]")}
    >
      <span className="ce-tile-well">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-[var(--via-text-primary)]">
            {name}
          </span>
          {selected ? (
            <span
              className="ce-check-in flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--via-navy)] text-white"
              aria-hidden="true"
            >
              <Check className="size-3" />
            </span>
          ) : (
            <span
              className="size-5 shrink-0 rounded-full border border-[var(--via-border)] transition-colors duration-[var(--via-dur)] group-hover:border-[var(--via-navy-30)]"
              aria-hidden="true"
            />
          )}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-[var(--via-text-muted)]">
          {purpose}
        </span>
      </span>
    </button>
  );
}

export function ChannelTilesSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {Array.from({ length: 3 }).map((_, index) => (
        <Skeleton key={index} className="h-[4.75rem] w-full rounded-[var(--via-radius-lg)]" />
      ))}
    </div>
  );
}

/** Nenhum canal ligado: painel de vidro com as redes flutuando e uma ação. */
export function ChannelsEmpty({ isAdmin, onOpen }: { isAdmin: boolean; onOpen: () => void }) {
  return (
    <div className="via-tile via-tile--atmos ce-chart-empty flex flex-col items-center gap-4 !px-6 !py-8 text-center">
      <NetworkCluster />
      <p className="max-w-sm text-sm text-[var(--via-text-muted)]">
        {isAdmin
          ? "Nenhum canal ligado ainda."
          : "Nenhum canal ligado. Peça a um administrador para ligar os canais."}
      </p>
      {isAdmin ? (
        <Button onClick={onOpen} aria-haspopup="dialog" className="rounded-full">
          Ligar canais
        </Button>
      ) : null}
    </div>
  );
}
