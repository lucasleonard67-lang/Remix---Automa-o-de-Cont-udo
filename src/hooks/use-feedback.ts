import { useCallback, useEffect, useRef, useState } from "react";

// Estados temporários do retorno de ação (components/ui/feedback.tsx).

/**
 * Estado temporário: `flash()` liga por `ms` e desliga sozinho. Chamar de
 * novo reinicia a contagem.
 */
export function useFlash(ms = 1600): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const flash = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setOn(true);
    timer.current = setTimeout(() => setOn(false), ms);
  }, [ms]);
  return [on, flash];
}

/**
 * Acende quando `value` muda para `when` depois do primeiro render — o estado
 * em que a tela já nasceu não acende. Devolve a classe para aplicar.
 */
export function useGlowOn<T>(value: T, when: (value: T) => boolean, ms = 1400): string {
  const previous = useRef(value);
  const [on, flash] = useFlash(ms);
  useEffect(() => {
    if (previous.current !== value && when(value)) flash();
    previous.current = value;
  }, [value, when, flash]);
  return on ? "ce-glow" : "";
}

/** Balança o elemento quando `trigger` muda para um valor verdadeiro. */
export function useShake(trigger: unknown): string {
  const [on, flash] = useFlash(400);
  useEffect(() => {
    if (trigger) flash();
  }, [trigger, flash]);
  return on ? "ce-shake" : "";
}
