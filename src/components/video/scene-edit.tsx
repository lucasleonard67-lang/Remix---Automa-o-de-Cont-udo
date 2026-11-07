import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, RotateCcw, Wand2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { PromptField } from "@/components/prompt/prompt-tools";
import type { DirectorJob } from "@/hooks/use-director-jobs";
import { supabase } from "@/integrations/supabase/client";
import { formatUsd } from "@/lib/format-usd";
import { getFunctionErrorMessage } from "@/lib/edge-functions";
import { toast } from "@/lib/toast";

// ---------------------------------------------------------------------------
// Editar uma cena de um vídeo pronto. Uma frase ("o que corrigir") e duas
// saídas com custo: Corrigir (edição por prompt sobre o clipe) ou Refazer
// (gera a cena de novo). Quando o provedor não edita, só o Refazer, com o
// motivo. O motor guarda o clipe anterior: Desfazer volta a ele. O vídeo final
// é remontado sozinho depois de qualquer troca.
// Contrato: docs/hub-motor-contratos.md §10 (edit_modes / scene_edits).
// ---------------------------------------------------------------------------

export type SceneEditKind = "edit" | "redo";

export interface SceneEditModes {
  edit: {
    available: boolean;
    usd: number | null;
    model_id?: string | null;
    reason?: string | null;
  };
  redo: { available: boolean; usd: number | null; reason?: string | null };
  /** cenas que a mesma geração refaz (grupo multi-cena) */
  scope?: number[];
}

export interface SceneEditState {
  status: "running" | "done" | "failed";
  kind: SceneEditKind | "undo";
  prompt?: string;
  error?: string | null;
  can_undo?: boolean;
  scope?: number[];
}

export interface SceneEditApi {
  modes: (shot: number) => SceneEditModes | null;
  state: (shot: number) => SceneEditState | null;
  /** o vídeo final está sendo remontado depois de uma troca */
  rebuilding: boolean;
  /** já há uma edição em andamento neste vídeo (uma por vez) */
  locked: boolean;
  submit: (shot: number, kind: SceneEditKind, prompt: string) => Promise<void>;
  undo: (shot: number) => Promise<void>;
  busy: boolean;
}

type EditArtifacts = {
  edit_modes?: Record<string, SceneEditModes>;
  scene_edits?: Record<string, SceneEditState>;
  final_rebuilding?: boolean;
};

// As ações moram na video-remake (a porta da tela para vídeo pronto); o
// trabalho roda no director-advance e volta pelo Realtime de director_jobs.
const EDGE = "video-remake";

async function callEdge<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(EDGE, { body });
  if (error) throw new Error(await getFunctionErrorMessage(error, "Não deu para editar a cena."));
  return data as T;
}

/**
 * Edição de cenas de um vídeo de cenas pronto. Pede `scene_edit_options` uma
 * vez ao abrir (o motor grava `edit_modes` no job e regrava a cada edição).
 * null quando não se aplica (vídeo produzindo, estúdios HeyGen/remake): o
 * botão Editar nem aparece.
 */
export function useSceneEdit(job: DirectorJob): SceneEditApi | null {
  const arts = job.artifacts as unknown as EditArtifacts;
  const eligible = job.status === "done" && !job.config?.mode && Boolean(job.artifacts.final);
  const options = useQuery({
    queryKey: ["scene-edit-options", job.id],
    enabled: eligible && !arts.edit_modes,
    staleTime: Infinity,
    retry: false,
    queryFn: () =>
      callEdge<{ edit_modes: Record<string, SceneEditModes> }>({
        action: "scene_edit_options",
        job_id: job.id,
      }),
  });
  const call = useMutation({ mutationFn: (body: Record<string, unknown>) => callEdge(body) });
  const modes = arts.edit_modes ?? options.data?.edit_modes;
  if (!eligible || !modes) return null;
  const edits = arts.scene_edits ?? {};
  const rebuilding = arts.final_rebuilding === true;
  const run = async (body: Record<string, unknown>, ok: string) => {
    try {
      await call.mutateAsync({ job_id: job.id, ...body });
      toast.success(ok);
    } catch (err) {
      toast.error("Não deu para editar a cena", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };
  return {
    modes: (shot) => modes[String(shot)] ?? null,
    state: (shot) => edits[String(shot)] ?? null,
    rebuilding,
    locked: rebuilding || Object.values(edits).some((e) => e.status === "running"),
    busy: call.isPending,
    submit: (shot, kind, prompt) =>
      run(
        { action: "scene_edit", shot, kind, prompt },
        kind === "edit"
          ? "Corrigindo a cena. O vídeo é remontado em seguida."
          : "Refazendo a cena. O vídeo é remontado em seguida.",
      ),
    undo: (shot) => run({ action: "scene_undo", shot }, "Voltando ao clipe anterior."),
  };
}

// Mesmo formato do GenerationGate: "até US$ X"; sem preço não bloqueia.
const price = (usd: number | null) =>
  usd === null ? "preço a confirmar" : `até ${formatUsd(usd)}`;

/** Painel aberto sob a linha da cena. */
export function SceneEditPanel({
  shot,
  api,
  onClose,
}: {
  shot: number;
  api: SceneEditApi;
  onClose: () => void;
}) {
  const modes = api.modes(shot);
  const [text, setText] = useState("");
  if (!modes) return null;
  const canEdit = modes.edit.available;
  const group = modes.scope && modes.scope.length > 1 ? modes.scope : null;
  const ready = text.trim().length >= 3;
  const go = async (kind: SceneEditKind) => {
    await api.submit(shot, kind, text.trim());
    onClose();
  };

  return (
    <div className="space-y-3 pb-3 pl-[92px] pr-3" data-testid={`scene-edit-${shot}`}>
      <PromptField
        autoFocus
        rows={2}
        kind="scene"
        max={500}
        value={text}
        onChange={setText}
        placeholder={
          canEdit
            ? "O que corrigir? Ex.: a pessoa está torta, deixe o enquadramento reto."
            : "Algum ajuste para a cena nova? (opcional)"
        }
        aria-label={`O que corrigir na cena ${shot}`}
      />
      {!canEdit ? (
        <p className="text-sm text-[var(--via-text-muted)]">
          {modes.edit.reason || "Provedor não permite edição, você deve recriar."}
        </p>
      ) : null}
      {!modes.redo.available && modes.redo.reason ? (
        <p className="text-sm text-[var(--via-text-muted)]">{modes.redo.reason}</p>
      ) : null}
      {group ? (
        <p className="text-xs text-[var(--via-text-muted)]">
          Esta cena sai no mesmo clipe das cenas {group[0]}–{group[group.length - 1]}: as{" "}
          {group.length} são refeitas juntas.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {canEdit ? (
          <Button size="sm" disabled={!ready || api.busy} onClick={() => void go("edit")}>
            {api.busy ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Wand2 aria-hidden="true" />
            )}
            Corrigir esta cena · {price(modes.edit.usd)}
          </Button>
        ) : null}
        {modes.redo.available ? (
          <Button
            size="sm"
            variant={canEdit ? "outline" : "default"}
            // refazer não exige texto: o ajuste é opcional
            disabled={api.busy}
            onClick={() => void go("redo")}
          >
            <RefreshCw aria-hidden="true" />
            Refazer a cena · {price(modes.redo.usd)}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

/** Motivo da última edição que falhou (o vídeo de antes continua valendo). */
export function SceneEditError({ shot, api }: { shot: number; api: SceneEditApi }) {
  const st = api.state(shot);
  if (st?.status !== "failed") return null;
  return (
    <p className="pb-3 pl-[92px] pr-3 text-sm text-[var(--via-coral)]">
      A edição não deu certo: {st.error || "tente de novo."} O vídeo de antes continua valendo.
    </p>
  );
}

/** Ação curta da linha depois de uma edição: Desfazer. */
export function UndoSceneButton({ shot, api }: { shot: number; api: SceneEditApi }) {
  const st = api.state(shot);
  if (!st || st.status !== "done" || !st.can_undo || api.locked) return null;
  return (
    <Button size="sm" variant="ghost" disabled={api.busy} onClick={() => void api.undo(shot)}>
      <RotateCcw aria-hidden="true" /> Desfazer
    </Button>
  );
}
