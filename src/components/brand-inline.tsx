import type { ReactNode } from "react";

import { BrandIcon } from "@/components/brand-icon";
import { BRAND_LABEL, findBrandMentions, type BrandName } from "@/lib/brands";
import { cn } from "@/lib/utils";

// Marca citada no texto corrido: logo oficial colorido (16px) antes do nome.
// O nome está sempre escrito, então o ícone é decorativo. Decisão de produto:
// cor só nas marcas de terceiros, nunca na UI em si — e nunca na sidebar.

interface BrandInlineProps {
  name: BrandName;
  /** Texto a exibir; padrão: o nome oficial da marca. */
  children?: ReactNode;
  className?: string;
  iconClassName?: string;
}

export function BrandInline({ name, children, className, iconClassName }: BrandInlineProps) {
  return (
    <span className={cn("whitespace-nowrap", className)}>
      <BrandIcon
        name={name}
        className={cn("mr-1 inline-block size-4 align-[-0.2em]", iconClassName)}
      />
      {children ?? BRAND_LABEL[name]}
    </span>
  );
}

/**
 * Frase pronta com o logo diante de cada marca que ela nomeia
 * ("Conecte o Zernio e autorize o Instagram" → dois ícones). Sem marca no
 * texto, devolve o texto como veio.
 */
export function BrandText({ text, iconClassName }: { text: string; iconClassName?: string }) {
  const mentions = findBrandMentions(text);
  if (mentions.length === 0) return <>{text}</>;
  const parts: ReactNode[] = [];
  let cursor = 0;
  mentions.forEach((m, i) => {
    if (m.start > cursor) parts.push(text.slice(cursor, m.start));
    parts.push(
      <BrandInline key={`${m.brand}-${i}`} name={m.brand} iconClassName={iconClassName}>
        {text.slice(m.start, m.end)}
      </BrandInline>,
    );
    cursor = m.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}
