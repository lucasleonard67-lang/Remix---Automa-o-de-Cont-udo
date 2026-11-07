import { Check } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import { ChannelIcon } from "@/components/criar/channel-tiles";
import { FormatPreview } from "@/components/criar/format-preview";
import {
  FORMAT_LABELS,
  FORMAT_MINUTES,
  STATIC_FORMATS,
  formatYield,
  previewAspect,
} from "@/components/criar/formats";
import { CHANNEL_TYPE_LABELS, type ChannelRow, type ChannelType } from "@/hooks/use-channels";
import { useTweetCardBrand } from "@/hooks/use-tweet-card-brand";
import { normalizeBrandKitContent, useActiveVersion } from "@/hooks/use-versioned-brand";
import { BRAND_LABEL, channelBrand } from "@/lib/brands";
import { cn } from "@/lib/utils";
import type { TweetCardAspect } from "@/lib/render-export";

// ---------------------------------------------------------------------------
// Porta de entrada de /criar: um ladrilho por formato estático, todos do
// mesmo tamanho (quadro 4:5 + três linhas de altura fixa), cada um com a
// amostra viva da peça no design system da marca e os fatos de relance: o
// que sai ("7–10 slides 4:5"), a rede (ícone), o tempo e se o canal está
// ligado. Marcar é um toggle e vale mais de um (a geração sai em todos os
// canais marcados). Desligado: o clique liga o canal no lugar (admin).
// ---------------------------------------------------------------------------

/** Largura da amostra dentro do quadro 4:5, por proporção (cabe com folga). */
const SAMPLE_WIDTH: Record<TweetCardAspect, string> = {
  "4:5": "74%",
  "1:1": "74%",
  "9:16": "56%",
};

export function FormatTiles({
  channels,
  selected,
  onToggle,
  onEnableChannels,
}: {
  channels: readonly ChannelRow[];
  selected: ReadonlySet<ChannelType>;
  onToggle: (type: ChannelType) => void;
  /** Admin: liga o canal desligado no lugar. Sem ela, o ladrilho desligado fica inerte. */
  onEnableChannels?: (type: ChannelType) => void;
}) {
  const brand = useTweetCardBrand();
  const kit = useActiveVersion("brand_kit");
  const art = useMemo(() => normalizeBrandKitContent(kit.data?.content ?? null).art, [kit.data]);
  const byType = useMemo(
    () => new Map(channels.map((row) => [row.type, row] as const)),
    [channels],
  );

  return (
    <ul
      className="grid grid-cols-2 items-start gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4"
      aria-label="Formatos"
      data-testid="criar-formatos"
    >
      {STATIC_FORMATS.map((type) => {
        const row = byType.get(type);
        const on = row?.enabled ?? false;
        const brandName = channelBrand(type);
        const network = brandName ? BRAND_LABEL[brandName] : CHANNEL_TYPE_LABELS[type];
        return (
          <li key={type} className="min-w-0">
            <Tile
              label={FORMAT_LABELS[type]}
              icon={<ChannelIcon type={type} className="size-3.5" />}
              network={network}
              line={formatYield(type, row?.config, art)}
              minutes={FORMAT_MINUTES[type]}
              status={on ? "on" : onEnableChannels ? "fix" : "off"}
              selected={selected.has(type)}
              disabled={!on && !onEnableChannels}
              onPick={() => (on ? onToggle(type) : onEnableChannels?.(type))}
              testId={`criar-formato-${type}`}
              stage={
                <span
                  className="block overflow-hidden rounded-[var(--via-radius-xs)] shadow-[var(--via-shadow-md)] transition-transform duration-[var(--via-dur)] ease-[var(--via-ease-snap)] group-hover/tile:-translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover/tile:translate-y-0"
                  style={{ width: SAMPLE_WIDTH[previewAspect(type, art)] }}
                >
                  <FormatPreview type={type} brand={brand} art={art} />
                </span>
              }
            />
          </li>
        );
      })}
    </ul>
  );
}

type TileStatus = "on" | "off" | "fix";

function Tile({
  label,
  icon,
  network,
  line,
  minutes,
  status,
  stage,
  selected,
  disabled = false,
  onPick,
  testId,
}: {
  label: string;
  icon: ReactNode;
  network: string;
  line: string;
  /** Tempo típico de geração. */
  minutes: number;
  /** on = canal ligado; fix = desligado, o clique liga; off = desligado, inerte. */
  status: TileStatus;
  stage: ReactNode;
  selected: boolean;
  disabled?: boolean;
  onPick: () => void;
  testId: string;
}) {
  const off = status !== "on";
  const statusText =
    status === "on" ? "Canal ligado" : status === "fix" ? "Ligar canal" : "Desligado";
  return (
    <div className="group/tile relative min-w-0">
      <button
        type="button"
        aria-pressed={off ? undefined : selected}
        aria-label={`${label} · ${network}: ${line}${minutes ? `, cerca de ${minutes} min` : ""}. ${statusText}.`}
        onClick={onPick}
        disabled={disabled}
        className="group flex w-full min-w-0 flex-col gap-2.5 text-left focus-visible:outline-none disabled:cursor-not-allowed"
        data-testid={testId}
      >
        {/* Selecionado: fio navy sólido de 1.5px colado no quadro + tom navy
            um degrau acima. Sem halo colorido; o foco é o fio neutro do DS. */}
        <span
          className={cn(
            "relative block aspect-[4/5] w-full overflow-hidden rounded-[var(--via-radius-lg)] outline-[1.5px] outline-offset-0 outline-solid transition-[outline-color,background-color,transform] duration-[var(--via-dur)] ease-[var(--via-ease-snap)] group-focus-visible:shadow-[var(--via-shadow-focus)] group-active:scale-[0.99] motion-reduce:group-active:scale-100",
            selected ? "bg-[var(--via-navy-08)]" : "bg-[var(--via-navy-04)]",
            selected
              ? "outline-[var(--via-navy)]"
              : "outline-transparent group-hover:outline-[var(--via-navy-14)] group-disabled:group-hover:outline-transparent",
          )}
        />
        {/* altura fixa: nome + rede · o que sai · tempo e canal — com qualquer texto */}
        <span className="grid min-w-0 grid-rows-[1.25rem_1rem_1rem] gap-y-1 px-0.5">
          <span className="flex min-w-0 items-center justify-between gap-2">
            <span className="truncate text-sm leading-5 font-medium text-[var(--via-text-primary)]">
              {label}
            </span>
            <span className="inline-flex shrink-0 items-center" title={network}>
              {icon}
              <span className="sr-only">{network}</span>
            </span>
          </span>
          <span className="truncate text-xs leading-4 text-[var(--via-text-body)]">{line}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs leading-4 text-[var(--via-text-soft)]">
            {minutes ? (
              <>
                <span className="tabular-nums">≈ {minutes} min</span>
                <span aria-hidden="true">·</span>
              </>
            ) : null}
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                status === "on" ? "bg-[var(--via-success)]" : "bg-[var(--via-gray-300)]",
              )}
              aria-hidden="true"
            />
            <span
              className={cn(
                "truncate",
                status === "fix" &&
                  "font-medium text-[var(--via-text-primary)] underline-offset-2 group-hover:underline",
              )}
            >
              {status === "on" ? "Ligado" : statusText}
            </span>
          </span>
        </span>
      </button>
      {/* A amostra fica FORA do botão (o render tem div/h3) e não captura o
          clique: por cima do quadro, centralizada, só para ver. */}
      <span
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 flex aspect-[4/5] w-full items-center justify-center",
          off && "opacity-50 grayscale",
        )}
        aria-hidden="true"
      >
        {stage}
        <span
          className={cn(
            "absolute top-2 right-2 inline-flex size-6 items-center justify-center rounded-full bg-[var(--via-navy)] text-white transition-[opacity,transform] duration-[var(--via-dur)] ease-[var(--via-ease-snap)] motion-reduce:transition-none",
            selected ? "scale-100 opacity-100" : "scale-90 opacity-0",
          )}
        >
          <Check className="size-3.5" strokeWidth={2.5} />
        </span>
      </span>
    </div>
  );
}
