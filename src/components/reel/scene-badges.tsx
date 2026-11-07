import { AlertTriangle, Loader2, PenLine } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  VIDEO_SCENE_ROLE_LABELS,
  VIDEO_SCENE_STATUS_LABELS,
  VIDEO_SCENE_TYPE_LABELS,
  isSceneBusy,
  type VideoScene,
} from "@/hooks/use-video-project";
import { cn } from "@/lib/utils";

/** Papel do beat (gancho / desenvolvimento / cta). */
export function SceneRoleBadge({ role }: { role: VideoScene["role"] }) {
  return (
    <Badge variant="secondary" className="font-normal">
      {VIDEO_SCENE_ROLE_LABELS[role] ?? role}
    </Badge>
  );
}

/** Tipo da cena — avatar falante ou b-roll (afeta modelo e custo). */
export function SceneTypeBadge({ type }: { type: VideoScene["type"] }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-normal",
        type === "avatar"
          ? "border-[0.5px] border-[var(--via-border-soft)] bg-[var(--via-navy-08)] text-[var(--via-text-primary)]"
          : "border-[0.5px] border-[var(--via-border-soft)] bg-[var(--via-navy-04)] text-[var(--via-text-body)]",
      )}
    >
      {VIDEO_SCENE_TYPE_LABELS[type]}
    </Badge>
  );
}

export function SceneStatusBadge({ status }: { status: VideoScene["status"] }) {
  const label = VIDEO_SCENE_STATUS_LABELS[status] ?? status;
  if (isSceneBusy(status)) {
    return (
      <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        {label}
      </Badge>
    );
  }
  if (status === "failed" || status === "cancelled") {
    return (
      <Badge variant="destructive" className="font-normal">
        {label}
      </Badge>
    );
  }
  if (status === "ready" || status === "keyframe_ready") {
    return (
      <Badge
        variant="outline"
        className="border-[0.5px] border-[var(--via-border-soft)] bg-[var(--via-navy-04)] font-normal text-[var(--via-text-body)]"
      >
        {label}
      </Badge>
    );
  }
  if (status === "stale") {
    return (
      <Badge
        variant="outline"
        className="border-[var(--via-navy-20)] bg-[var(--via-navy-08)] font-normal text-[var(--via-text-primary)]"
      >
        {label}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="font-normal text-muted-foreground">
      {label}
    </Badge>
  );
}

/**
 * Avisos de coerência da cena: `stale` (o texto mudou depois de renderizar) e
 * `narration_diverged` (edição humana tirou a cena da cobertura da auditoria
 * editorial — docs/11 §4.1). O produto DIZ isso em vez de fingir.
 */
export function SceneWarnings({ scene }: { scene: VideoScene }) {
  if (scene.status !== "stale" && !scene.narration_diverged) return null;
  return (
    <div className="space-y-1">
      {scene.status === "stale" ? (
        <p className="flex items-start gap-2 rounded-md bg-[var(--via-navy-06)] p-2 text-xs text-[var(--via-text-primary)]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            O texto mudou depois que a cena foi gerada. Refaça a cena para a imagem acompanhar a
            nova narração.
          </span>
        </p>
      ) : null}
      {scene.narration_diverged ? (
        <p className="flex items-start gap-2 rounded-md bg-muted p-2 text-xs text-muted-foreground">
          <PenLine className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            Narração editada à mão. A conferência de fatos e regras da marca vale só para o texto
            aprovado; revise esta fala antes de publicar.
          </span>
        </p>
      ) : null}
    </div>
  );
}
