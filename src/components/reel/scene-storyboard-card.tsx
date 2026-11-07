import { ChevronDown, Loader2, Save } from "lucide-react";
import { useEffect, useState } from "react";

import {
  SceneRoleBadge,
  SceneStatusBadge,
  SceneTypeBadge,
  SceneWarnings,
} from "@/components/reel/scene-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { UpdateScenePatch, VideoScene } from "@/hooks/use-video-project";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Cena no storyboard: edição GRATUITA (nada foi gerado ainda) de imagem, tipo e
// duração. A fala é do roteiro auditado e aparece só para leitura.
//
// O salvamento é explícito de propósito, não autosave por tecla: editar a
// narração marca `narration_diverged` e derruba o áudio já gerado.
// ---------------------------------------------------------------------------

export interface SceneStoryboardCardProps {
  scene: VideoScene;
  total: number;
  /** Estimativa de custo desta cena, quando a fase pedida já respondeu. */
  costLabel?: string;
  disabled?: boolean;
  pending?: boolean;
  onSave: (patch: UpdateScenePatch) => void;
}

export function SceneStoryboardCard({
  scene,
  total,
  costLabel,
  disabled,
  pending,
  onSave,
}: SceneStoryboardCardProps) {
  const [visualPrompt, setVisualPrompt] = useState(scene.visual_prompt);
  const [duration, setDuration] = useState(String(scene.duration_target_s));
  const [promptOpen, setPromptOpen] = useState(false);

  // O Realtime pode reescrever a cena por baixo (regeneração, webhook). Só
  // ressincroniza quando o valor gravado muda — nunca por cima de digitação.
  useEffect(() => setVisualPrompt(scene.visual_prompt), [scene.visual_prompt]);
  useEffect(() => setDuration(String(scene.duration_target_s)), [scene.duration_target_s]);

  const durationNumber = Number(duration.replace(",", "."));
  const durationValid =
    Number.isFinite(durationNumber) && durationNumber >= 3 && durationNumber <= 12;

  const patch: UpdateScenePatch = {};
  if (visualPrompt.trim() !== scene.visual_prompt) patch.visual_prompt = visualPrompt.trim();
  if (durationValid && durationNumber !== Number(scene.duration_target_s)) {
    patch.duration_target_s = durationNumber;
  }
  const dirty = Object.keys(patch).length > 0;

  return (
    <Card className={cn(dirty && "border-primary/50")}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            Cena {scene.scene_index + 1} de {total}
          </span>
          <SceneRoleBadge role={scene.role} />
          <SceneTypeBadge type={scene.type} />
          {scene.status !== "planned" ? <SceneStatusBadge status={scene.status} /> : null}
        </div>
        {costLabel ? (
          <span className="font-mono text-xs text-muted-foreground">{costLabel}</span>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        <SceneWarnings scene={scene} />

        {/* A fala de um plano é uma fatia do roteiro AUDITADO: o servidor recusa
            editar aqui (409 narration_locked) para não tirar a fala da
            conferência de fatos. A tela mostra, não deixa digitar o que vai falhar. */}
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Narração (o que será falado)</p>
          <blockquote className="border-l-2 border-[var(--via-border)] pl-3 text-sm leading-relaxed text-[var(--via-text-body)]">
            {scene.narration || "Sem fala nesta cena."}
          </blockquote>
          <p className="text-xs text-muted-foreground">
            A fala vem do roteiro aprovado. Para mudar, ajuste o roteiro da peça e monte o
            storyboard de novo.
          </p>
        </div>

        <Collapsible open={promptOpen} onOpenChange={setPromptOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="-ml-2 gap-1 text-muted-foreground">
              <ChevronDown
                className={cn("size-4 transition-transform", promptOpen && "rotate-180")}
                aria-hidden="true"
              />
              Descrição da imagem
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <Textarea
              value={visualPrompt}
              onChange={(event) => setVisualPrompt(event.target.value)}
              rows={3}
              disabled={disabled}
              aria-label={`Descrição da imagem da cena ${scene.scene_index + 1}`}
              className="resize-y font-mono text-xs"
            />
            <p className="pt-1 text-xs text-muted-foreground">
              Descreve o quadro de referência da cena (vertical 9:16). Não é falado.
            </p>
          </CollapsibleContent>
        </Collapsible>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <Label htmlFor={`duration-${scene.id}`} className="text-xs">
              Duração (segundos)
            </Label>
            <Input
              id={`duration-${scene.id}`}
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
              inputMode="decimal"
              disabled={disabled}
              className={cn("w-24", !durationValid && "border-destructive")}
            />
            <p className="text-xs text-muted-foreground">
              de 3 a 12; a duração final segue a narração
            </p>
          </div>

          <Button
            size="sm"
            variant={dirty ? "default" : "outline"}
            disabled={disabled || !dirty || pending}
            onClick={() => onSave(patch)}
          >
            {pending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Save aria-hidden="true" />
            )}
            {dirty ? "Salvar cena" : "Sem alterações"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
