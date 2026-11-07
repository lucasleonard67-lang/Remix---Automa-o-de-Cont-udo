import { RefreshCw } from "lucide-react";

import { SceneStatusBadge, SceneTypeBadge } from "@/components/reel/scene-badges";
import { SignedVideo } from "@/components/reel/signed-media";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { isSceneBusy, type VideoScene } from "@/hooks/use-video-project";
import { humanizeError } from "@/lib/humanize-error";

// ---------------------------------------------------------------------------
// Cenas renderizadas, antes da montagem: cada `final_path` toca sozinho. É o
// último ponto barato de correção — regerar uma cena não re-roda as outras.
// ---------------------------------------------------------------------------

export interface ScenePreviewGridProps {
  scenes: VideoScene[];
  onRegenerate: (scene: VideoScene) => void;
  regeneratingSceneId?: string | null;
}

export function ScenePreviewGrid({
  scenes,
  onRegenerate,
  regeneratingSceneId,
}: ScenePreviewGridProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {scenes.map((scene) => (
        <Card key={scene.id} className="overflow-hidden">
          <div className="aspect-[9/16] bg-black">
            <SignedVideo path={scene.final_path ?? scene.video_path} poster={scene.keyframe_path} />
          </div>
          <CardContent className="space-y-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                Cena {scene.scene_index + 1}
              </span>
              <SceneTypeBadge type={scene.type} />
              <SceneStatusBadge status={scene.status} />
            </div>
            <p className="line-clamp-2 text-xs text-muted-foreground">{scene.narration}</p>
            {scene.error ? <p className="text-xs text-destructive">{humanizeError(scene.error)}</p> : null}
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              disabled={regeneratingSceneId === scene.id || isSceneBusy(scene.status)}
              onClick={() => onRegenerate(scene)}
            >
              <RefreshCw aria-hidden="true" />
              Refazer cena
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
