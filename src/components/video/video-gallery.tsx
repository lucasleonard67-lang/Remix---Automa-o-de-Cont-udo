import { AlertCircle, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

import { ExcluirNaCapa } from "@/components/excluir-na-capa";
import { JobCard } from "@/components/video/job-card";
import { JobCover, jobTitle } from "@/components/video/job-cover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { avisoDoDrive, useDeleteVideo } from "@/hooks/use-delete-content";
import { directorStatusLabel, isJobActive, type DirectorJob } from "@/hooks/use-director-jobs";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Galeria de Vídeos: cada produção é a própria capa, que toca ao passar o
// mouse; quem precisa da pessoa vem primeiro. O toque abre tudo ao lado, na
// mesma tela: palco, cenas, aprovação e publicação (JobCard).
// ---------------------------------------------------------------------------

const KIND: Record<string, string> = {
  remake: "Remake",
  avatar_video: "Avatar",
  video_agent: "Agente",
};

const needsPerson = (job: DirectorJob) =>
  job.status === "failed" || job.status.startsWith("awaiting");

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "short" }).replace(".", "");

export function VideoGallery({ jobs }: { jobs: DirectorJob[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  // Array.sort é estável: dentro de cada grupo, continua do mais novo ao mais antigo
  const sorted = useMemo(
    () => [...jobs].sort((a, b) => Number(needsPerson(b)) - Number(needsPerson(a))),
    [jobs],
  );
  // lê da lista: o Realtime atualiza o painel aberto
  const open = jobs.find((job) => job.id === openId) ?? null;

  return (
    <>
      <ul
        className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(176px,1fr))]"
        aria-label="Vídeos"
      >
        {sorted.map((job) => (
          <li key={job.id}>
            <VideoTile job={job} onOpen={() => setOpenId(job.id)} />
          </li>
        ))}
      </ul>
      <Sheet open={Boolean(open)} onOpenChange={(next) => !next && setOpenId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetTitle className="sr-only">{open ? jobTitle(open) : "Vídeo"}</SheetTitle>
          <SheetDescription className="sr-only">
            Prévia, cenas, aprovação e publicação deste vídeo.
          </SheetDescription>
          {open ? <JobCard key={open.id} job={open} embedded /> : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function VideoTile({ job, onOpen }: { job: DirectorJob; onOpen: () => void }) {
  const [hover, setHover] = useState(false);
  const active = isJobActive(job);
  const attention = needsPerson(job);
  const kind = KIND[job.config?.mode ?? ""] ?? "Cenas";
  const { isAdmin } = useIsAdmin();
  const excluir = useDeleteVideo();

  return (
    <div className="group/capa relative">
      <button
        type="button"
        onClick={onOpen}
        onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
        onPointerLeave={() => setHover(false)}
        className="group block w-full text-left focus-visible:outline-none"
        data-testid="video-tile"
      >
        <span className="@container relative block overflow-hidden rounded-[18px] transition-transform duration-[var(--via-dur)] group-focus-visible:shadow-[var(--via-shadow-focus)] motion-safe:group-hover:-translate-y-0.5">
          <JobCover job={job} play={hover} className="rounded-[18px]" />
          {job.status !== "done" ? (
            <span
              className={cn(
                "absolute left-2 top-2 inline-flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm",
                attention ? "bg-white text-[var(--via-text-primary)]" : "bg-black/60 text-white",
              )}
            >
              {active ? (
                <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden="true" />
              ) : null}
              {job.status === "failed" ? (
                <AlertCircle className="size-3 shrink-0 text-destructive" aria-hidden="true" />
              ) : null}
              <span className="truncate">{directorStatusLabel(job)}</span>
            </span>
          ) : null}
        </span>
        <span className="mt-2.5 line-clamp-2 text-sm font-medium leading-snug text-[var(--via-text-primary)]">
          {jobTitle(job)}
        </span>
        <span className="mt-0.5 block text-xs text-[var(--via-text-muted)]">
          {kind} · {shortDate(job.created_at)}
        </span>
      </button>
      {isAdmin ? (
        <ExcluirNaCapa
          nome={jobTitle(job)}
          titulo="Excluir este vídeo?"
          descricao="Ele sai de Vídeos com os arquivos e a cópia no Drive. O post já publicado segue na rede. Não dá para desfazer."
          pendente={excluir.isPending}
          onExcluir={() =>
            excluir.mutate(job.id, {
              onSuccess: ({ drive_pendente }) =>
                toast.success("Vídeo excluído", { description: avisoDoDrive(drive_pendente) }),
              onError: (error) =>
                toast.error("Não foi possível excluir", { description: error.message }),
            })
          }
        />
      ) : null}
    </div>
  );
}
