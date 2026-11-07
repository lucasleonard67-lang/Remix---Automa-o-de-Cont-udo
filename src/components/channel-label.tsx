import { BrandIcon } from "@/components/brand-icon";
import { CHANNEL_TYPE_LABELS, type ChannelType } from "@/hooks/use-channels";
import { channelBrand } from "@/lib/brands";

/** Nome do canal com o logo da plataforma (o texto já nomeia: ícone é decorativo). */
export function ChannelLabel({ type }: { type: string }) {
  const brand = channelBrand(type);
  return (
    <span className="inline-flex items-center gap-1.5">
      {brand ? <BrandIcon name={brand} className="size-3.5" /> : null}
      {CHANNEL_TYPE_LABELS[type as ChannelType] ?? type}
    </span>
  );
}
