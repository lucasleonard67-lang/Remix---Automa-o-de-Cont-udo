import { Compass, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";

import { useResumeJob, type AngleOption, type GenerationJob } from "@/hooks/use-generation-jobs";
import { cn } from "@/lib/utils";

interface AngleSelectorProps {
  job: GenerationJob;
}

/**
 * Seletor de ângulo (`/criar` — estado `awaiting_angle`): ladrilhos de vidro
 * do kit com as 3-4 opções de `classification.angles[]` (título + gancho +
 * racional). Clique → `resume-job {job_id, selected_angle}` e a trilha retoma
 * via Realtime. Composição aberta: etiqueta, frase e a grade — sem caixa.
 */
export function AngleSelector({ job }: AngleSelectorProps) {
  const resumeJob = useResumeJob();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const angles = job.classification?.angles ?? [];

  const choose = (angle: AngleOption) => {
    if (resumeJob.isPending) return;
    setPendingId(angle.id);
    resumeJob.mutate(
      { job_id: job.id, selected_angle: angle },
      {
        onSuccess: () => {
          toast.success("Ângulo escolhido", {
            description: "A geração continua com esse ângulo.",
          });
        },
        onError: (error) => {
          toast.error("Não foi possível continuar", { description: error.message });
        },
        onSettled: () => setPendingId(null),
      },
    );
  };

  return (
    <section aria-labelledby={`angle-title-${job.id}`} className="space-y-3">
      <div className="flex items-start gap-2.5">
        <span className="ce-tile-well !size-8 !rounded-[10px]">
          <Compass className="size-4 text-[var(--via-text-primary)]" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p
            id={`angle-title-${job.id}`}
            className="text-sm font-medium text-[var(--via-text-primary)]"
          >
            Escolha o ângulo para continuar
          </p>
          <p className="text-xs text-[var(--via-text-muted)]">
            {job.classification?.thesis
              ? `Tese: ${job.classification.thesis}`
              : "O tema permite abordagens diferentes. Clique na que a peça deve seguir."}
          </p>
        </div>
      </div>

      {angles.length === 0 ? (
        <p className="text-sm text-[var(--via-text-muted)]">
          Nenhum ângulo foi sugerido. Clique em Cancelar geração e gere de novo com um tema mais
          específico.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {angles.map((angle) => {
            const isChosen = pendingId === angle.id;
            return (
              <li key={angle.id}>
                <button
                  type="button"
                  data-testid="angle-option"
                  onClick={() => choose(angle)}
                  disabled={resumeJob.isPending}
                  className={cn(
                    "via-tile via-tile--atmos via-tile--lift ce-tile flex h-full w-full flex-col items-start gap-1.5 rounded-[var(--via-radius-lg)] !p-4 text-left",
                    "focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]",
                    "disabled:pointer-events-none disabled:opacity-60",
                    isChosen && "!border-[var(--via-navy)] !opacity-100",
                  )}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="text-sm font-medium text-[var(--via-text-primary)]">
                      {angle.title}
                    </span>
                    {isChosen ? (
                      <Loader2
                        className="size-4 shrink-0 animate-spin text-[var(--via-text-muted)]"
                        aria-hidden="true"
                      />
                    ) : null}
                  </span>
                  <span className="text-sm italic text-[var(--via-text-body)]">“{angle.hook}”</span>
                  {angle.rationale ? (
                    <span className="text-xs text-[var(--via-text-muted)]">{angle.rationale}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
