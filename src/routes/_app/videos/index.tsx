import { createFileRoute, Link } from "@tanstack/react-router";
import { Clapperboard, Plus } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { AndamentoDoRoteiro } from "@/components/video/roteiro-brief";
import { VideoGallery } from "@/components/video/video-gallery";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDirectorJobs } from "@/hooks/use-director-jobs";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useCancelarRoteiro, useUltimoPedidoDeRoteiro } from "@/hooks/use-roteiro-pedidos";
import { toast } from "@/lib/toast";

export const Route = createFileRoute("/_app/videos/")({
  component: VideosPage,
});

// ---------------------------------------------------------------------------
// Biblioteca de vídeos: lista as produções geradas e leva pra experiência
// dedicada de criação (/videos/novo). A geração NÃO acontece aqui.
// ---------------------------------------------------------------------------

function VideosPage() {
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const { data: jobs, isLoading } = useDirectorJobs();
  const roteiro = useUltimoPedidoDeRoteiro();
  const cancelarRoteiro = useCancelarRoteiro();

  if (adminLoading) return <Skeleton className="h-40 w-full" />;
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-5xl">
        <Alert>
          <AlertDescription>
            Só administradores acessam Vídeos. Peça acesso a um administrador da conta.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader
          title="Vídeos"
          description="Acompanhe, aprove e publique seus vídeos curtos. Para começar um, clique em “Gerar novo vídeo”."
        />
        <Button asChild size="lg" data-testid="cta-novo-video">
          <Link to="/videos/novo">
            <Plus aria-hidden="true" /> Gerar novo vídeo
          </Link>
        </Button>
      </div>
      {roteiro.data?.status === "aberto" ? (
        <AndamentoDoRoteiro
          pedido={roteiro.data}
          compact
          cancelando={cancelarRoteiro.isPending}
          onCancelar={() =>
            cancelarRoteiro.mutate(roteiro.data!.id, {
              onError: (err) => toast.error(err.message),
            })
          }
        />
      ) : null}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(176px,1fr))]">
          <Skeleton className="aspect-[9/16] rounded-[18px]" />
          <Skeleton className="aspect-[9/16] rounded-[18px]" />
          <Skeleton className="aspect-[9/16] rounded-[18px]" />
        </div>
      ) : jobs && jobs.length > 0 ? (
        <VideoGallery jobs={jobs} />
      ) : (
        <EmptyState
          icon={Clapperboard}
          title="Nenhum vídeo ainda"
          description="Clique em “Gerar novo vídeo” e preencha o briefing. O vídeo aparece aqui enquanto é produzido."
        />
      )}
    </div>
  );
}
