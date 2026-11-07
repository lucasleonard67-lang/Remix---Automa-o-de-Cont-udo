import { useEffect, useRef, useState } from "react";

import { ZERNIO_PLATFORM_LABELS, type ZernioPlatform } from "@/hooks/use-zernio";

// ---------------------------------------------------------------------------
// Utilitários (sem JSX) do módulo Desempenho: movimento conforme o design
// system e rótulos de plataforma. Separado de shared.tsx para o Fast Refresh.
// ---------------------------------------------------------------------------

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Número que sobe de 0 ao alvo em 600ms (`--via-ease-out`) só na primeira pintura. */
export function useCountUp(target: number | null, duration = 600): number | null {
  const [value, setValue] = useState<number | null>(null);
  const animated = useRef(false);

  useEffect(() => {
    if (target === null) return;
    if (animated.current || prefersReducedMotion()) {
      animated.current = true;
      setValue(target);
      return;
    }
    animated.current = true;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return value;
}

export function platformLabel(platform: string | null | undefined): string {
  if (!platform) return "—";
  return ZERNIO_PLATFORM_LABELS[platform as ZernioPlatform] ?? platform;
}

/** Entrada escalonada: opacity + translateY(8px→0) em 220ms, 60ms entre blocos. */
export function staggerStyle(index: number) {
  return {
    animationDelay: `${index * 60}ms`,
    animationTimingFunction: "var(--via-ease-out)",
  } as const;
}

export const STAGGER_CLASS =
  "animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-200";
