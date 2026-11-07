import { ImageOff, Loader2, VideoOff } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSignedUrl } from "@/hooks/use-storage";
import { ArchivedInDrive, restoreFromDrive } from "@/lib/storage-restore";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Os arquivos de vídeo ficam no bucket PRIVADO `renders` — nada é exibido por
// URL pública. Cada leaf chama `useSignedUrl` internamente de propósito: as
// cenas chegam por Realtime e o array muda de tamanho, então chamar o hook
// dentro de um `.map()` mudaria a contagem de hooks entre renders.
// ---------------------------------------------------------------------------

const BUCKET = "renders";

export function SignedImage({
  path,
  alt,
  className,
}: {
  path: string | null;
  alt: string;
  className?: string;
}) {
  const url = useSignedUrl(BUCKET, path);

  if (!path)
    return <MediaPlaceholder className={className} kind="image" label="quadro ainda não gerado" />;
  if (url.isLoading) return <Skeleton className={cn("size-full", className)} />;
  if (url.isError || !url.data) {
    return <MediaPlaceholder className={className} kind="image" label="não foi possível abrir" />;
  }

  return <img src={url.data} alt={alt} className={cn("size-full object-cover", className)} />;
}

export function SignedVideo({
  path,
  className,
  poster,
}: {
  path: string | null;
  className?: string;
  poster?: string | null;
}) {
  // lista de cenas: vídeo que está no Drive só volta se a pessoa pedir
  const url = useSignedUrl(BUCKET, path, 3600, { restore: false });
  const posterUrl = useSignedUrl(BUCKET, poster ?? null);

  if (!path)
    return <MediaPlaceholder className={className} kind="video" label="cena ainda não gerada" />;
  if (url.isLoading) return <Skeleton className={cn("size-full", className)} />;
  if (url.error instanceof ArchivedInDrive) {
    return <DriveRestore path={path} className={className} onDone={() => void url.refetch()} />;
  }
  if (url.isError || !url.data) {
    return <MediaPlaceholder className={className} kind="video" label="não foi possível abrir" />;
  }

  return (
    <video
      src={url.data}
      poster={posterUrl.data ?? undefined}
      controls
      playsInline
      preload="metadata"
      className={cn("size-full bg-black object-contain", className)}
    />
  );
}

/** Link de download com a signed URL do mp4 final. */
export function SignedDownloadLink({
  path,
  fileName,
  children,
  className,
}: {
  path: string | null;
  fileName: string;
  children: React.ReactNode;
  className?: string;
}) {
  const url = useSignedUrl(BUCKET, path, 3600, { restore: false });
  if (!url.data) return null;
  return (
    <a href={url.data} download={fileName} className={className}>
      {children}
    </a>
  );
}

/** Vídeo guardado no Drive: uma ação, ali mesmo, sem sair da tela. */
function DriveRestore({
  path,
  className,
  onDone,
}: {
  path: string;
  className?: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const bring = () => {
    setBusy(true);
    restoreFromDrive(BUCKET, path)
      .then(onDone)
      .catch((error: Error) =>
        toast.error("Não deu para trazer o vídeo", { description: error.message }),
      )
      .finally(() => setBusy(false));
  };
  return (
    <div
      className={cn(
        "flex size-full flex-col items-center justify-center gap-2 bg-[var(--via-navy-04)] p-3 text-center",
        className,
      )}
    >
      <p className="text-xs text-[var(--via-text-muted)]">No seu Google Drive</p>
      <Button size="sm" variant="outline" onClick={bring} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        {busy ? "Trazendo…" : "Trazer de volta"}
      </Button>
    </div>
  );
}

function MediaPlaceholder({
  kind,
  label,
  className,
}: {
  kind: "image" | "video";
  label: string;
  className?: string;
}) {
  const Icon = kind === "image" ? ImageOff : VideoOff;
  return (
    <div
      className={cn(
        "flex size-full flex-col items-center justify-center gap-2 bg-muted text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-6" aria-hidden="true" />
      <span className="text-xs">{label}</span>
    </div>
  );
}
