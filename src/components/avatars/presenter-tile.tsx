import { Loader2, UserRound } from "lucide-react";
import type { ReactNode } from "react";

import { SelectedCheck } from "@/components/ui/choice-tile";
import { Skeleton } from "@/components/ui/skeleton";
import { AVATAR_BUCKET, presenterPortraitPath, type AvatarRow } from "@/hooks/use-avatars";
import { useSignedUrl } from "@/hooks/use-storage";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Crachá do apresentador: o rosto em 3:4 com o nome sobre a foto. Mesmo tile
// na página de Apresentadores e no seletor de Vídeos → Novo; selecionado =
// borda fina (`via-selected`), tinta leve e o check.
// ---------------------------------------------------------------------------

export function PresenterTile({
  avatar,
  selected,
  busy = false,
  corner,
  onClick,
  label,
}: {
  avatar: AvatarRow;
  /** Só no seletor: vira botão de alternância (aria-pressed). */
  selected?: boolean;
  /** Retrato sendo gerado. */
  busy?: boolean;
  /** Marca no canto superior (ex.: "padrão", "Selecionado"). */
  corner?: ReactNode;
  onClick?: () => void;
  /** Rótulo acessível do clique. */
  label?: string;
}) {
  const path = presenterPortraitPath(avatar);
  const portrait = useSignedUrl(AVATAR_BUCKET, path);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={label}
      data-testid={`avatar-${avatar.id}`}
      className={cn(
        "via-lift group relative aspect-[3/4] cursor-pointer overflow-hidden rounded-[14px] border border-[var(--via-border-soft)] bg-[var(--via-surface)] text-left shadow-[var(--via-shadow-sm)]",
        selected && "via-selected",
      )}
    >
      {!path ? (
        <span className="absolute inset-0 flex items-center justify-center bg-[var(--via-navy-06)]">
          <UserRound className="size-8 text-[var(--via-text-muted)]" aria-hidden="true" />
        </span>
      ) : portrait.data ? (
        <img
          src={portrait.data}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <Skeleton className="absolute inset-0 rounded-none" />
      )}
      {busy ? (
        <span className="absolute inset-0 flex items-center justify-center bg-background/60">
          <Loader2
            className="size-6 animate-spin text-[var(--via-text-muted)]"
            aria-hidden="true"
          />
        </span>
      ) : null}
      <span className="absolute inset-x-0 bottom-0 bg-[linear-gradient(180deg,transparent,rgba(2,22,42,0.82))] p-2.5 pt-8">
        <span className="block truncate text-sm font-medium text-white">{avatar.name}</span>
      </span>
      {selected ? (
        <>
          <span className="absolute inset-0 bg-[var(--via-navy-08)]" aria-hidden="true" />
          <SelectedCheck className="top-2 left-2" />
        </>
      ) : null}
      {corner ? <span className="absolute right-2 top-2">{corner}</span> : null}
    </button>
  );
}
