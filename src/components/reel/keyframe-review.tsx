import { RefreshCw } from "lucide-react";
import { useState } from "react";

import { SceneStatusBadge, SceneTypeBadge, SceneWarnings } from "@/components/reel/scene-badges";
import { SignedImage } from "@/components/reel/signed-media";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  SHOT_ANGLE_LABELS,
  SHOT_MOVEMENT_LABELS,
  SHOT_SIZE_LABELS,
  isSceneBusy,
  type VideoScene,
} from "@/hooks/use-video-project";
import { cn } from "@/lib/utils";
import { humanizeError } from "@/lib/humanize-error";

// ---------------------------------------------------------------------------
// O PORTÃO PRINCIPAL: os keyframes custam CENTAVOS e travam o gasto em vídeo,
// que custa DÓLARES (docs/11 §0, regra 5).
//
// Com a decupagem o Reel passou de 3 cenas para 6-8 planos, e aprovar um por um
// vira abandono garantido. Por isso a revisão é um CONTACT SHEET: uma fileira
// por bloco de fala, todos os planos visíveis de relance, e o caminho padrão é
// aprovar tudo. Rejeitar é a exceção e acontece plano a plano.
// ---------------------------------------------------------------------------

export interface KeyframeReviewProps {
  scenes: VideoScene[];
  onRegenerate: (scene: VideoScene) => void;
  regeneratingSceneId?: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  gancho: "Gancho",
  desenvolvimento: "Desenvolvimento",
  cta: "Chamada",
};

export function KeyframeReview({ scenes, onRegenerate, regeneratingSceneId }: KeyframeReviewProps) {
  const [openShotId, setOpenShotId] = useState<string | null>(null);

  // Uma fileira por bloco de fala. A ordem vem do scene_index, que já é a ordem
  // do vídeo montado.
  const beats = groupByBeat(scenes);

  return (
    <div className="space-y-5">
      {beats.map(({ beatIndex, role, shots }) => (
        <section key={beatIndex} className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <h4 className="text-sm font-medium text-foreground">{ROLE_LABELS[role] ?? role}</h4>
            <span className="text-xs text-muted-foreground">
              {shots.length} {shots.length === 1 ? "cena" : "cenas"} ·{" "}
              {totalSeconds(shots).toFixed(1)}s
            </span>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-1">
            {shots.map((scene) => (
              <ShotThumb
                key={scene.id}
                scene={scene}
                open={openShotId === scene.id}
                onToggle={() => setOpenShotId(openShotId === scene.id ? null : scene.id)}
                onRegenerate={() => onRegenerate(scene)}
                regenerating={regeneratingSceneId === scene.id}
              />
            ))}
          </div>

          {/* A fala do bloco fica embaixo do contact sheet, inteira: é ela que
              dá sentido à sequência de planos — plano a plano ela vem picotada. */}
          <p className="text-xs leading-relaxed text-muted-foreground">
            {shots.map((s) => s.narration).join(" ")}
          </p>
        </section>
      ))}
    </div>
  );
}

function ShotThumb({
  scene,
  open,
  onToggle,
  onRegenerate,
  regenerating,
}: {
  scene: VideoScene;
  open: boolean;
  onToggle: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const failed = scene.status === "failed";

  return (
    <Card
      className={cn(
        "w-40 shrink-0 overflow-hidden transition-colors",
        open && "ring-2 ring-primary",
        failed && "border-destructive",
      )}
    >
      <button type="button" onClick={onToggle} className="block w-full text-left">
        <div className="aspect-[9/16] overflow-hidden">
          <SignedImage
            path={scene.keyframe_path}
            alt={`Quadro da cena ${scene.scene_index + 1}: ${scene.shot_function ?? ""}`}
          />
        </div>
      </button>

      <CardContent className="space-y-1.5 p-2">
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant="outline" className="px-1 py-0 text-xs font-normal">
            {scene.scene_index + 1}
          </Badge>
          <SceneTypeBadge type={scene.type} />
          {isSceneBusy(scene.status) || failed ? <SceneStatusBadge status={scene.status} /> : null}
        </div>

        {/* A gramática do plano em uma linha — é o que deixa a decupagem legível
            para quem aprova, em vez de uma parede de imagens parecidas. */}
        <p className="text-xs leading-tight text-muted-foreground">
          {[
            SHOT_SIZE_LABELS[scene.shot_size ?? ""],
            SHOT_ANGLE_LABELS[scene.shot_angle ?? ""],
            SHOT_MOVEMENT_LABELS[scene.shot_movement ?? ""],
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>

        {scene.shot_function ? (
          <p className="line-clamp-2 text-xs italic leading-tight text-muted-foreground">
            {scene.shot_function}
          </p>
        ) : null}

        {open ? (
          <div className="space-y-1.5 border-t border-border pt-1.5">
            <SceneWarnings scene={scene} />
            <p className="text-xs leading-snug text-foreground">{scene.narration}</p>
            <p className="text-xs text-muted-foreground">
              {scene.audio_duration_s
                ? `${Number(scene.audio_duration_s).toFixed(1)}s de áudio`
                : `${Number(scene.duration_target_s).toFixed(1)}s previstos`}
            </p>
            {scene.error ? (
              <p className="text-xs text-destructive">{humanizeError(scene.error)}</p>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-full text-xs"
              disabled={regenerating || isSceneBusy(scene.status)}
              onClick={onRegenerate}
            >
              <RefreshCw className="size-3" aria-hidden="true" />
              Refazer quadro
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

interface BeatGroup {
  beatIndex: number;
  role: string;
  shots: VideoScene[];
}

function groupByBeat(scenes: VideoScene[]): BeatGroup[] {
  const map = new Map<number, BeatGroup>();
  for (const scene of [...scenes].sort((a, b) => a.scene_index - b.scene_index)) {
    const group = map.get(scene.beat_index);
    if (group) group.shots.push(scene);
    else
      map.set(scene.beat_index, { beatIndex: scene.beat_index, role: scene.role, shots: [scene] });
  }
  return [...map.values()].sort((a, b) => a.beatIndex - b.beatIndex);
}

function totalSeconds(shots: VideoScene[]): number {
  return shots.reduce((sum, s) => sum + Number(s.audio_duration_s ?? s.duration_target_s ?? 0), 0);
}
