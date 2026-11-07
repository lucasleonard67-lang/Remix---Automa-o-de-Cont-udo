/* eslint-disable react-refresh/only-export-components -- utilitários de movimento (hook + helper) convivem com <Reveal> de propósito */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Movimento do Dashboard — só transform/opacity, pelos tokens do kit
// (`--via-dur`, `--via-ease-out`). Keyframes em src/styles.css (`.ce-*`).
// `prefers-reduced-motion` é tratado no CSS global; o count-up (JS) checa
// `matchMedia` por conta própria.
// ---------------------------------------------------------------------------

export const REVEAL_STAGGER_MS = 60;

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

interface RevealProps {
  /** Ordem do bloco na página: define o atraso (60ms por bloco). */
  index: number;
  className?: string;
  children: ReactNode;
}

/** Entrada escalonada de um módulo: opacity + translateY(8px→0) em 220ms. */
export function Reveal({ index, className, children }: RevealProps) {
  const style = { "--ce-reveal-delay": `${index * REVEAL_STAGGER_MS}ms` } as CSSProperties;
  return (
    <div className={cn("ce-reveal", className)} style={style}>
      {children}
    </div>
  );
}

/**
 * Count-up de 0 até `value` em 600ms, só na primeira pintura com dado. Depois
 * disso o número acompanha o valor direto (sem reanimar a cada refetch).
 */
export function useCountUp(value: number | null | undefined, duration = 600): number | null {
  const target = typeof value === "number" && Number.isFinite(value) ? value : null;
  const [shown, setShown] = useState<number | null>(null);
  const animatedOnce = useRef(false);

  useEffect(() => {
    if (target === null) return;
    if (animatedOnce.current || prefersReducedMotion() || target === 0) {
      animatedOnce.current = true;
      setShown(target);
      return;
    }
    animatedOnce.current = true;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // ease-out (mesma intenção da --via-ease-out, sem ler CSS no JS)
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(target * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return shown;
}
