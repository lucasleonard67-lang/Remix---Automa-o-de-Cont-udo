import { ArrowRight, Check } from "lucide-react";
import { useEffect, useState } from "react";

import { Reveal } from "@/components/dashboard/motion";
import { SetupFlow } from "@/components/setup/setup-flow";
import { Button } from "@/components/ui/button";
import { useDashboardSetup, type SetupStep } from "@/hooks/use-dashboard-setup";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Primeiros passos — o checklist de ativação do Design System SUBIDO
// (kit/patterns/FirstSteps), na versão para uma home que já tem dado: card
// branco plano com o progresso ("6 de 7 · falta 1 passo", barra), o próximo
// passo com uma frase de como, UMA ação navy (Continuar) e, embaixo, os passos
// em trilha horizontal — feito, atual, a fazer. A largura inteira é usada pela
// trilha, não por uma frase solta.
// Aparece só para admin e só enquanto a conta não terminou a configuração.
// "Continuar" abre o fluxo único (modal) no passo pendente.
// ---------------------------------------------------------------------------

/** Uma frase de como fazer cada passo; aparece só no passo atual. */
const COMO: Record<SetupStep["id"], string> = {
  analise: "Lemos seu site e o Instagram e montamos a marca.",
  perfil: "Confira persona, bandeira e identidade visual.",
  tom: "Aprove um texto de exemplo na sua voz.",
  instagram: "Autorize a conta que vai publicar.",
  mercado: "Escolha concorrentes para o Radar comparar.",
  "primeira-peca": "Peça a primeira peça em Criar.",
  publicar: "Aprove uma peça na Biblioteca e publique.",
};

/**
 * O checklist está na tela? Enquanto estiver, ele é a ação dominante do Início:
 * o "Criar conteúdo" do cabeçalho recua e o aviso de conectar redes não repete
 * o passo que o checklist já mostra.
 */
export function useFirstStepsVisible(): boolean {
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const setup = useDashboardSetup();
  return !adminLoading && isAdmin && !setup.isLoading && !setup.allDone && Boolean(setup.next);
}

export function FirstSteps({ revealIndex }: { revealIndex: number }) {
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const setup = useDashboardSetup();
  const [flowOpen, setFlowOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  if (adminLoading || !isAdmin || setup.isLoading || setup.allDone || !setup.next) return null;

  const { steps, doneCount, next } = setup;
  const total = steps.length;
  const faltam = total - doneCount;
  const fraction = mounted ? doneCount / total : 0;

  return (
    <Reveal index={revealIndex}>
      <section
        aria-labelledby="ce-first-steps-title"
        className="rounded-[var(--via-radius-lg)] border border-[var(--via-border-soft)] bg-[var(--via-surface)] p-5 sm:p-6"
        data-testid="primeiros-passos"
      >
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div className="min-w-0 flex-1 basis-64">
            <p className="via-eyebrow">Primeiros passos</p>
            <p className="mt-1 text-sm text-[var(--via-text-muted)]">
              <span className="text-2xl font-medium tabular-nums tracking-[-0.02em] text-[var(--via-text-primary)]">
                {doneCount} de {total}
              </span>
              <span className="ml-2">
                {faltam === 1 ? "falta 1 passo" : `faltam ${faltam} passos`}
              </span>
            </p>
          </div>

          <div className="flex min-w-0 flex-1 basis-72 flex-col items-start gap-3 sm:items-end sm:text-right">
            <p id="ce-first-steps-title" className="min-w-0">
              <span className="block text-base font-medium text-[var(--via-text-primary)]">
                {next.label}
              </span>
              <span className="mt-0.5 block text-sm text-[var(--via-text-muted)]">
                {COMO[next.id]}
              </span>
            </p>
            <Button onClick={() => setFlowOpen(true)} aria-haspopup="dialog">
              Continuar
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </div>

        {/* A barra atravessa o card inteiro: é o mesmo caminho da trilha abaixo. */}
        <div
          className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--via-navy-08)]"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={doneCount}
          aria-label="Progresso da configuração"
        >
          <div
            className="h-full rounded-full bg-[var(--via-navy)] transition-[width] duration-700 ease-out"
            style={{ width: `${fraction * 100}%` }}
          />
        </div>

        <ol
          className="mt-4 grid gap-x-3 gap-y-2 sm:grid-cols-[repeat(7,minmax(0,1fr))]"
          aria-label="Passos da configuração"
        >
          {steps.map((step, index) => {
            const atual = step.id === next.id;
            return (
              <li
                key={step.id}
                className="flex min-w-0 items-center gap-2 sm:flex-col sm:items-start"
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium",
                    step.done
                      ? "bg-[var(--via-navy)] text-white"
                      : atual
                        ? "border-2 border-[var(--via-navy)] text-[var(--via-navy)]"
                        : "border border-[var(--via-border)] text-[var(--via-text-muted)]",
                  )}
                  aria-hidden="true"
                >
                  {step.done ? <Check className="size-3" /> : index + 1}
                </span>
                <span
                  className={cn(
                    "min-w-0 truncate text-[13px] leading-5",
                    step.done
                      ? "text-[var(--via-text-muted)]"
                      : atual
                        ? "font-medium text-[var(--via-text-primary)]"
                        : "text-[var(--via-text-muted)]",
                  )}
                >
                  {step.label}
                  <span className="sr-only">
                    {step.done ? " (feito)" : atual ? " (atual)" : ""}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
        <SetupFlow open={flowOpen} onOpenChange={setFlowOpen} initialStep={next.flowStep ?? 6} />
      </section>
    </Reveal>
  );
}
