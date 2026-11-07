import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { ChannelsGrid } from "@/components/channels/channels-grid";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/_app/marca/canais")({
  component: ChannelsPage,
});

// ---------------------------------------------------------------------------
// Marca → Canais: a grade de ladrilhos vive em components/channels e é a mesma
// que o Criar abre em modal quando não há canal ligado.
// ---------------------------------------------------------------------------

function ChannelsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link
        to="/marca"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Marca
      </Link>

      <PageHeader
        title="Canais"
        description="Ligue os canais em que a marca publica. Clique em um canal para ligar e ajustar os limites; vale na hora para as próximas peças."
      />

      <ChannelsGrid />
    </div>
  );
}
