import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import "@/components/analytics/analytics.css";

import { Reveal } from "@/components/dashboard/motion";
import { JobDetail } from "@/components/generation-job-card";
import { PageEyebrow } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useGenerationJob, useGenerationJobsRealtime } from "@/hooks/use-generation-jobs";

// ---------------------------------------------------------------------------
// Página de UMA postagem em criação. É para cá que "Gerar" leva: o usuário
// acompanha a geração inteira (anel + etapas) sem procurar na lista, e as
// fases da trilha continuam servindo de atalho (Revisão → Biblioteca, etc.).
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_app/criar/$jobId")({
  component: JobPage,
});

/** id fora do formato não vai ao banco: o Postgres devolve 400 e a query
 *  ficaria repetindo a falha em vez de dizer "não encontrada". */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function JobPage() {
  const { jobId } = Route.useParams();
  // mesma assinatura Realtime da lista: a geração avança sozinha nesta tela
  useGenerationJobsRealtime();
  const idValido = UUID_RE.test(jobId);
  const jobQuery = useGenerationJob(idValido ? jobId : undefined);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <Reveal index={0}>
        <header className="space-y-3">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link to="/criar">
              <ArrowLeft aria-hidden="true" />
              Voltar para Criar
            </Link>
          </Button>
          <PageEyebrow />
          <h1 className="text-3xl font-medium tracking-[-0.025em] text-[var(--via-text-primary)]">
            Postagem em criação
          </h1>
          <p className="text-sm text-[var(--via-text-muted)]">
            Acompanhe as etapas. Quando chegar em Revisão, abra as peças na Biblioteca.
          </p>
        </header>
      </Reveal>

      <Reveal index={1}>
        {!idValido ? (
          <NotFound reason="O link está incorreto." />
        ) : jobQuery.isLoading ? (
          <Skeleton className="h-48 w-full rounded-[var(--via-radius-lg)]" />
        ) : jobQuery.isError || !jobQuery.data ? (
          <NotFound reason="Ela pode ter sido removida." />
        ) : (
          <JobDetail job={jobQuery.data} />
        )}
      </Reveal>
    </div>
  );
}

/** Painel de vidro do kit: uma frase e uma ação. */
function NotFound({ reason }: { reason: string }) {
  return (
    <div className="via-tile via-tile--atmos ce-chart-empty flex flex-col items-center gap-4 !px-6 !py-10 text-center">
      <p className="text-base font-medium text-[var(--via-text-primary)]">Geração não encontrada</p>
      <p className="max-w-sm text-sm text-[var(--via-text-muted)]">
        {reason} Volte para Criar conteúdo: as peças recentes ficam logo abaixo dos formatos.
      </p>
      <Button asChild className="rounded-full">
        <Link to="/criar">Voltar para Criar</Link>
      </Button>
    </div>
  );
}
