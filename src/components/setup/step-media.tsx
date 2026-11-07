import { IntegrationGrid } from "@/components/integration-grid";

// ---------------------------------------------------------------------------
// Passo 3 · Vídeo e voz — opcional. Os três motores dos Reels; sem nenhum, os
// posts e imagens continuam funcionando.
// ---------------------------------------------------------------------------

export function StepMedia() {
  return (
    <div className="space-y-4">
      <IntegrationGrid
        ids={["higgsfield", "elevenlabs", "replicate", "heygen"]}
        className="sm:grid-cols-2 lg:grid-cols-2"
      />
      <p className="text-xs text-[var(--via-text-faint)]">
        Posts e imagens não dependem disso. Dá para ligar depois, nas Integrações.
      </p>
    </div>
  );
}
