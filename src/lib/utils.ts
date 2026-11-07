import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// As classes do design system Viver de IA compartilham o prefixo `via-`; sem
// registro, o tailwind-merge as trata como variantes CONFLITANTES de um mesmo
// grupo e descarta todas menos a última ("via-selected" apagava o
// "via-card-glass" do card). Cada classe da casa vira um grupo próprio —
// nenhuma conflita com nenhuma.
const VIA_CLASSES = [
  "via-app-bg",
  "via-card-glass",
  "via-lift",
  "via-selected",
  "via-row-signature",
  "via-hero-navy",
  "via-glass",
  "via-glass-strong",
  "via-glass-dark",
  "via-liquid",
  "via-tile",
  "via-tile--atmos",
  "via-tile--lift",
  "via-bar-glass",
  "via-pill-link",
  "via-row-card",
  "via-meta-chip",
  "via-mesh-light",
  "via-mesh-navy",
  "via-noise",
  "via-surface",
  "via-card",
  "via-hero",
  "via-display",
  "via-label",
] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: Object.fromEntries(VIA_CLASSES.map((c) => [c, [c]])),
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
