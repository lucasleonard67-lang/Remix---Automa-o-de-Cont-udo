import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { Reveal } from "@/components/dashboard/motion";
import { PageHeader } from "@/components/page-header";
import { PeriodSelect, PerformanceSection } from "@/components/performance-section";
import type { AnalyticsRange } from "@/hooks/use-zernio";

export const Route = createFileRoute("/_app/desempenho")({
  component: PerformancePage,
});

// ---------------------------------------------------------------------------
// Desempenho como BI (versão 1 aprovada em 04/11): conclusões sobre as redes e
// o mercado, não dado cru. "Para fazer hoje" e as ideias moram no Início e em
// Criar; aqui fica o porquê. O período é escolhido no cabeçalho.
// ---------------------------------------------------------------------------

function PerformancePage() {
  const [range, setRange] = useState<AnalyticsRange>(30);
  return (
    <div className="mx-auto max-w-6xl space-y-12">
      <PageHeader
        title="Desempenho"
        description="O que os números dizem sobre a sua marca, e o que fazer com isso."
      >
        <PeriodSelect value={range} onChange={setRange} />
      </PageHeader>
      <Reveal index={0}>
        <PerformanceSection range={range} />
      </Reveal>
    </div>
  );
}
