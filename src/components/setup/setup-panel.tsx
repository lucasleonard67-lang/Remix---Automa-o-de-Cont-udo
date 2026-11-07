import {
  BadgeCheck,
  Check,
  Clapperboard,
  Globe,
  Send,
  Share2,
  SquarePen,
  Users,
  type LucideIcon,
} from "lucide-react";

import { SubidoLogo } from "@/components/brand/subido-logo";
import { SETUP_FLOW_STEPS } from "@/components/setup/setup-steps";
import type { SetupFlowStep } from "@/hooks/use-onboarding";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Painel narrativo navy do assistente de configuração (DS SUBIDO, 04 §2): a
// marca, o que a pessoa vai conseguir, os passos na vertical (círculo de 40px,
// título e apoio, linha entre eles) e, no pé, quanto da conta já está pronta.
// O progresso nasce acima de zero: a conta criada já conta como um passo.
// No celular o painel some e o stepper horizontal fica no topo do conteúdo.
// ---------------------------------------------------------------------------

const ICONS: Record<SetupFlowStep, LucideIcon> = {
  1: Globe,
  2: Share2,
  3: Clapperboard,
  4: Users,
  5: BadgeCheck,
  6: SquarePen,
  7: Send,
};

export function SetupPanel({
  current,
  reached,
  completed,
  onSelect,
  onLater,
}: {
  current: SetupFlowStep;
  reached: SetupFlowStep;
  completed: ReadonlySet<SetupFlowStep>;
  onSelect: (step: SetupFlowStep) => void;
  /** "Deixar para depois": fecha guardando o que já foi feito. */
  onLater?: () => void;
}) {
  const total = SETUP_FLOW_STEPS.length;
  const pronto = Math.round(((completed.size + 1) / (total + 1)) * 100);
  return (
    <aside className="ce-setup-panel hidden min-h-0 flex-col gap-5 overflow-hidden p-6 text-white md:flex">
      <div className="space-y-2">
        <SubidoLogo height={24} tone="inverse" title="subido AI" />
        <p className="pt-3 text-lg font-medium leading-snug tracking-[-0.015em]">
          Bem-vindo à Automação de Redes Sociais
        </p>
        <p className="text-[0.8125rem] leading-relaxed text-white/70">
          Em minutos, a marca lida e a primeira peça pronta. Dá para sair e voltar quando quiser.
        </p>
      </div>

      <ol className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1" aria-label="Passos da configuração">
        {SETUP_FLOW_STEPS.map((item, index) => {
          const isCurrent = item.step === current;
          const done = completed.has(item.step) && !isCurrent;
          const clickable = item.step <= reached && !isCurrent;
          const Icon = ICONS[item.step];
          return (
            <li key={item.step} className="relative" aria-current={isCurrent ? "step" : undefined}>
              {index < total - 1 ? (
                <span
                  aria-hidden="true"
                  className="absolute left-[28px] top-[48px] h-[calc(100%-40px)] w-px bg-white/15"
                />
              ) : null}
              <button
                type="button"
                onClick={() => clickable && onSelect(item.step)}
                disabled={!clickable}
                className={cn(
                  "relative flex w-full items-center gap-3 rounded-[var(--via-radius-md)] px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]",
                  isCurrent ? "bg-white/10" : clickable ? "hover:bg-white/5" : "cursor-default",
                )}
              >
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-full",
                    done
                      ? "bg-white/15 text-white"
                      : isCurrent
                        ? "bg-white text-[var(--via-navy)]"
                        : "border border-white/20 text-white/70",
                  )}
                  aria-hidden="true"
                >
                  {done ? <Check className="size-[18px]" /> : <Icon className="size-[18px]" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-white/55">
                    Passo {item.step}
                  </span>
                  <span
                    className={cn(
                      "block truncate text-sm",
                      isCurrent ? "font-medium text-white" : "text-white/85",
                    )}
                  >
                    {item.label}
                    {done ? <span className="sr-only"> (concluído)</span> : null}
                  </span>
                  <span className="block truncate text-[0.8125rem] text-white/60">{item.hint}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="space-y-3">
        <div>
          <div className="mb-2 flex items-center justify-between text-[0.8125rem]">
            <span className="text-white/70">Sua conta</span>
            <span className="font-medium tabular-nums">{pronto}% pronta</span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-white/15"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pronto}
            aria-label="Conta pronta"
          >
            <div
              className="h-full rounded-full bg-[var(--subido-blue-light)] transition-[width] duration-700 ease-out"
              style={{ width: `${pronto}%` }}
            />
          </div>
        </div>
        {onLater ? (
          <button
            type="button"
            onClick={onLater}
            className="text-[0.8125rem] text-white/70 underline-offset-4 hover:text-white hover:underline focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]"
          >
            Deixar para depois
          </button>
        ) : null}
      </div>
    </aside>
  );
}
