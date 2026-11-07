import { RefreshCw } from "lucide-react";

import { SceneStatusBadge, SceneTypeBadge } from "@/components/reel/scene-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { sceneProgressPercent, type VideoScene } from "@/hooks/use-video-project";
import { humanizeError } from "@/lib/humanize-error";

// ---------------------------------------------------------------------------
// Progresso por cena durante as fases automáticas. Sem nenhuma ação destrutiva
// aqui: o único botão é "Cancelar", que fica no rodapé da view.
//
// Fechar a aba não perde nada — todo progresso é estado de banco alimentado
// pelo webhook do Replicate (docs/11 §5).
// ---------------------------------------------------------------------------

export interface SceneProgressListProps {
  scenes: VideoScene[];
  phase: "prep" | "video";
  title: string;
  description: string;
  /** CTA por cena quando o projeto está em `attention`. */
  onRetryScene?: (scene: VideoScene) => void;
  retryPendingSceneId?: string | null;
}

export function SceneProgressList({
  scenes,
  phase,
  title,
  description,
  onRetryScene,
  retryPendingSceneId,
}: SceneProgressListProps) {
  const percent = sceneProgressPercent(scenes, phase);

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
        <Progress value={percent} />
        <p className="text-xs text-muted-foreground">{percent}% das cenas prontas</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {scenes.map((scene) => (
          <div
            key={scene.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
          >
            <span className="text-sm font-medium text-foreground">
              Cena {scene.scene_index + 1}
            </span>
            <SceneTypeBadge type={scene.type} />
            <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
              {scene.narration}
            </p>
            <SceneStatusBadge status={scene.status} />
            {onRetryScene && scene.status === "failed" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={retryPendingSceneId === scene.id}
                onClick={() => onRetryScene(scene)}
              >
                <RefreshCw aria-hidden="true" />
                Tentar de novo
              </Button>
            ) : null}
            {scene.error ? <p className="w-full text-xs text-destructive">{humanizeError(scene.error)}</p> : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
