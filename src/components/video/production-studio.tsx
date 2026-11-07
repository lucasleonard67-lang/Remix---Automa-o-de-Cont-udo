import { useQueries, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Film,
  ImageIcon,
  Loader2,
  Maximize2,
  Pencil,
  Play,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  SceneEditError,
  SceneEditPanel,
  UndoSceneButton,
  type SceneEditApi,
} from "@/components/video/scene-edit";
import { directorSignedUrl, type DirectorJob } from "@/hooks/use-director-jobs";
import { ArchivedInDrive, restoreFromDrive } from "@/lib/storage-restore";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Estúdio de produção de um vídeo: PALCO grande em 9:16 (o vídeo final, ou a
// cena escolhida: clipe quando já existe, senão o quadro) e o STORYBOARD — uma
// linha por cena com miniatura, fala e estado (quadro pronto, gerando vídeo,
// vídeo pronto). Clicar numa cena leva ao palco; ← → navegam; a tela cheia
// abre a mesma navegação em tamanho grande, com a fala ao lado.
// ---------------------------------------------------------------------------

type SceneState = "waiting" | "frame" | "rendering" | "ready" | "stopped";

interface Scene {
  n: number;
  speech: string;
  keyframe: string | null;
  clip: string | null;
  /** cenas que o mesmo clipe cobre (grupo multi-cena), quando é mais de uma */
  group: number[] | null;
  state: SceneState;
}

type Pick = "final" | number;

const SIGN_SECONDS = 2 * 60 * 60;

/** Cenas do job: plano + quadros + clipes + o que está rodando no provedor. */
export function buildScenes(job: DirectorJob): Scene[] {
  const a = job.artifacts ?? {};
  const shots = job.plan?.shots ?? [];
  const nums = new Set<number>();
  shots.forEach((s) => nums.add(s.idx));
  (a.keyframes ?? []).forEach((k) => nums.add(k.shot));
  (a.videos ?? []).forEach((v) => nums.add(v.shot));
  const stopped = job.status === "failed" || job.status === "canceled";
  return [...nums]
    .filter((n) => Number.isFinite(n))
    .sort((x, y) => x - y)
    .map((n) => {
      const keyframe = (a.keyframes ?? []).find((k) => k.shot === n)?.path ?? null;
      // grupo multi-cena: um clipe cobre várias cenas (members)
      const video = (a.videos ?? []).find((v) => v.shot === n || v.members?.includes(n));
      const group =
        video?.members && video.members.length > 1
          ? [...video.members].sort((x, y) => x - y)
          : null;
      const rendering = (a.pending_vid ?? []).some((p) => p.shot === n || p.members?.includes(n));
      const state: SceneState = video
        ? "ready"
        : rendering
          ? stopped
            ? "stopped"
            : "rendering"
          : keyframe
            ? "frame"
            : stopped
              ? "stopped"
              : "waiting";
      return {
        n,
        speech: shots.find((s) => s.idx === n)?.speech?.trim() ?? "",
        keyframe,
        clip: video?.path ?? null,
        group,
        state,
      };
    });
}

const STATE_LABEL: Record<SceneState, string> = {
  waiting: "Na fila",
  frame: "Quadro pronto",
  rendering: "Gerando vídeo",
  ready: "Vídeo pronto",
  stopped: "Parou",
};

const range = (g: number[]) => `${g[0]}–${g[g.length - 1]}`;

/**
 * Assina os caminhos do bucket `renders` (caminho → URL). Uma query por
 * caminho: quadro ou clipe novo (Realtime) assina só ele, sem recarregar o
 * resto; antes de vencer, a URL é reassinada sozinha.
 */
export function useSignedPaths(paths: string[]): Record<string, string> {
  return useSignedState(paths).urls;
}

function useSignedState(paths: string[]) {
  const key = [...new Set(paths)].sort();
  const results = useQueries({
    queries: key.map((path) => ({
      queryKey: ["director-signed", path],
      // tela com várias cenas: nada volta do Drive só por abrir
      queryFn: () => directorSignedUrl(path, SIGN_SECONDS, { restore: false }),
      staleTime: (SIGN_SECONDS - 600) * 1000,
      refetchInterval: (SIGN_SECONDS - 600) * 1000,
      retry: (count: number, error: Error) => !(error instanceof ArchivedInDrive) && count < 2,
    })),
  });
  const urls: Record<string, string> = {};
  const archived: string[] = [];
  key.forEach((path, i) => {
    const url = results[i]?.data;
    if (url) urls[path] = url;
    if (results[i]?.error instanceof ArchivedInDrive) archived.push(path);
  });
  return { urls, archived };
}

/** Faixa do palco: o vídeo está no Drive, uma ação traz de volta aqui mesmo. */
function DriveRail({ paths }: { paths: string[] }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const bring = async () => {
    setBusy(true);
    try {
      for (const path of paths) {
        await restoreFromDrive("renders", path);
        await queryClient.invalidateQueries({ queryKey: ["director-signed", path] });
      }
    } catch (error) {
      toast.error("Não deu para trazer do Drive", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 border-y border-[var(--via-border-soft)] py-2"
      data-testid="drive-rail"
    >
      <p className="text-sm text-[var(--via-text-body)]">
        {paths.length > 1 ? `${paths.length} arquivos estão` : "Este arquivo está"} no seu Google
        Drive.
      </p>
      <Button size="sm" variant="outline" onClick={() => void bring()} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        {busy ? "Trazendo…" : "Trazer de volta"}
      </Button>
    </div>
  );
}

export function ProductionStudio({
  job,
  edit = null,
  finalPath,
}: {
  job: DirectorJob;
  /** edição de cenas de um vídeo pronto (null = o motor ainda não oferece) */
  edit?: SceneEditApi | null;
  /** o vídeo que o palco mostra como final (Aprimorar com IA: a versão editada) */
  finalPath?: string | null;
}) {
  const scenes = useMemo(() => buildScenes(job), [job]);
  const final = finalPath ?? job.artifacts?.final ?? null;
  const { urls, archived } = useSignedState([
    ...(final ? [final] : []),
    ...scenes.flatMap((s) => [s.keyframe, s.clip].filter((p): p is string => Boolean(p))),
  ]);
  const stageRef = useRef<HTMLDivElement>(null);

  // ordem de navegação: vídeo final primeiro, depois as cenas
  const order: Pick[] = useMemo(
    () => [...(final ? (["final"] as Pick[]) : []), ...scenes.map((s) => s.n)],
    [final, scenes],
  );
  const smartDefault = (): Pick | null =>
    final
      ? "final"
      : ([...scenes].reverse().find((s) => s.clip)?.n ??
        scenes.find((s) => s.keyframe)?.n ??
        scenes[0]?.n ??
        null);
  const [picked, setPicked] = useState<Pick | null>(null);
  // segue o melhor até a pessoa escolher; quando o vídeo final chega, mostra ele
  const current: Pick | null = picked !== null && order.includes(picked) ? picked : smartDefault();
  useEffect(() => {
    if (final) setPicked(null);
  }, [final]);

  const [full, setFull] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  if (!order.length) return null;

  const at = current === null ? -1 : order.indexOf(current);
  const go = (delta: number) => {
    if (at < 0) return;
    setPicked(order[(at + delta + order.length) % order.length]);
  };
  const select = (pick: Pick) => {
    setPicked(pick);
    // no celular o palco não fica preso na tela: leva a pessoa até ele
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
      stageRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };
  const onKeys = (e: React.KeyboardEvent) => {
    // seta dentro do player avança o vídeo: é do controle, não troca de cena
    const t = e.target as HTMLElement;
    if (t !== e.currentTarget && t.closest("video, input, textarea")) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(-1);
    }
  };

  const scene = typeof current === "number" ? scenes.find((s) => s.n === current) : undefined;
  const caption =
    current === "final"
      ? "Vídeo final"
      : scene
        ? scene.group
          ? `Cenas ${range(scene.group)} de ${scenes.length}`
          : `Cena ${scene.n} de ${scenes.length}`
        : "";

  return (
    <section
      className="grid gap-6 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)] md:items-start"
      aria-label="Cenas e vídeo"
      data-testid="production-studio"
    >
      {archived.length ? (
        <div className="md:col-span-2">
          <DriveRail paths={archived} />
        </div>
      ) : null}
      {/* Palco */}
      <div
        ref={stageRef}
        className="mx-auto w-full max-w-[320px] scroll-mt-4 md:sticky md:top-4 md:mx-0"
      >
        <div
          className="relative rounded-[20px] outline-none focus-visible:shadow-[var(--via-shadow-focus)]"
          role="group"
          tabIndex={0}
          onKeyDown={onKeys}
          aria-label={`${caption}. Use as setas para trocar de cena.`}
        >
          {/* com a tela cheia aberta, o palco vira só o quadro: nunca dois players tocando */}
          <StageMedia pick={current} scene={scene} final={final} urls={urls} still={full} />
          {edit?.rebuilding && current === "final" ? (
            <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-[20px] bg-black/60 text-sm text-white backdrop-blur-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Remontando o vídeo…
            </div>
          ) : null}
          <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 font-mono text-xs font-medium tracking-wide text-white backdrop-blur-sm">
            {caption}
          </span>
          <Button
            type="button"
            size="icon"
            variant="overlay"
            className="absolute right-3 top-3 size-8 rounded-full"
            onClick={() => setFull(true)}
            aria-label="Ver em tela cheia"
          >
            <Maximize2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Storyboard */}
      <ol className="min-w-0 divide-y divide-[var(--via-border-soft)]" aria-label="Storyboard">
        {final ? (
          <StoryRow
            active={current === "final"}
            onSelect={() => select("final")}
            thumb={urls[scenes.find((s) => s.keyframe)?.keyframe ?? ""] ?? null}
            thumbVideo={urls[final] ?? null}
            title="Vídeo final"
            text={
              scenes.length
                ? `${scenes.length} ${scenes.length === 1 ? "cena montada" : "cenas montadas"}`
                : undefined
            }
            badge={<StateTag state="ready" label="Pronto" />}
            icon={<Film className="size-3.5" aria-hidden="true" />}
          />
        ) : null}
        {scenes.map((s) => {
          const sceneEdit = edit?.state(s.n) ?? null;
          const canEdit = Boolean(edit?.modes(s.n)) && !edit?.locked;
          return (
            <StoryRow
              key={s.n}
              active={current === s.n}
              onSelect={() => select(s.n)}
              thumb={(s.keyframe && urls[s.keyframe]) || null}
              playable={Boolean(s.clip)}
              title={`Cena ${s.n}`}
              text={s.speech || "Sem fala"}
              badge={
                sceneEdit?.status === "running" ? (
                  <StateTag state="rendering" label="Editando…" />
                ) : sceneEdit?.status === "failed" ? (
                  <StateTag state="stopped" label="A edição falhou" />
                ) : (
                  <StateTag
                    state={s.state}
                    label={
                      s.group && s.state === "ready"
                        ? `Vídeo pronto · cenas ${range(s.group)}`
                        : undefined
                    }
                  />
                )
              }
              trailing={
                edit ? (
                  <>
                    <UndoSceneButton shot={s.n} api={edit} />
                    {canEdit ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-expanded={editing === s.n}
                        onClick={() => setEditing((e) => (e === s.n ? null : s.n))}
                      >
                        <Pencil aria-hidden="true" /> Editar
                      </Button>
                    ) : null}
                  </>
                ) : null
              }
              below={
                edit && editing === s.n && !edit.locked ? (
                  <SceneEditPanel shot={s.n} api={edit} onClose={() => setEditing(null)} />
                ) : edit ? (
                  <SceneEditError shot={s.n} api={edit} />
                ) : null
              }
            />
          );
        })}
      </ol>

      <Dialog open={full} onOpenChange={setFull}>
        <DialogContent
          className="max-h-[96vh] max-w-[min(96vw,1100px)] gap-0 overflow-y-auto border-0 p-0 text-white sm:rounded-[24px] [&_.ce-modal-close]:!bg-transparent [&_.ce-modal-close]:!text-white [&_.ce-modal-close]:opacity-90"
          // .ce-modal pinta o vidro claro; a tela cheia é sala escura
          style={{ background: "var(--via-stage)" }}
          onKeyDown={onKeys}
        >
          <DialogTitle className="sr-only">{caption}</DialogTitle>
          <DialogDescription className="sr-only">
            Use as setas do teclado para trocar de cena.
          </DialogDescription>
          <div className="grid gap-6 p-5 md:grid-cols-[auto_minmax(0,1fr)] md:p-8">
            <div className="mx-auto aspect-[9/16] h-[min(78vh,780px)]">
              <StageMedia pick={current} scene={scene} final={final} urls={urls} tall />
            </div>
            <div className="flex min-w-0 flex-col justify-between gap-6">
              <div className="space-y-3">
                <p className="font-mono text-xs uppercase tracking-[0.14em] text-white/60">
                  {caption}
                </p>
                {scene ? (
                  <>
                    <StateTag state={scene.state} dark />
                    <p className="text-lg leading-relaxed text-white/90">
                      {scene.speech || "Esta cena não tem fala."}
                    </p>
                  </>
                ) : scenes.length ? (
                  <p className="text-lg leading-relaxed text-white/90">
                    O vídeo montado com todas as cenas, a narração e a trilha.
                  </p>
                ) : null}
              </div>
              {order.length > 1 ? (
                <div className="flex items-center gap-2">
                  <Button type="button" variant="overlay" onClick={() => go(-1)}>
                    <ChevronLeft aria-hidden="true" /> Anterior
                  </Button>
                  <Button type="button" variant="overlay" onClick={() => go(1)}>
                    Próxima <ChevronRight aria-hidden="true" />
                  </Button>
                  <span className="ml-auto font-mono text-xs tabular-nums text-white/60">
                    {at + 1}/{order.length}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function StageMedia({
  pick,
  scene,
  final,
  urls,
  tall,
  still,
}: {
  pick: Pick | null;
  scene: Scene | undefined;
  final: string | null;
  urls: Record<string, string>;
  tall?: boolean;
  /** só o quadro, sem player (a tela cheia está aberta) */
  still?: boolean;
}) {
  const box = cn(
    "relative overflow-hidden bg-[var(--via-stage)]",
    tall
      ? "h-full w-full rounded-[18px]"
      : "aspect-[9/16] w-full rounded-[20px] shadow-[var(--via-shadow-lg)]",
  );
  const poster = scene?.keyframe ? urls[scene.keyframe] : undefined;
  const path = pick === "final" ? final : (scene?.clip ?? null);
  const src = path && !still ? urls[path] : undefined;

  if (src) {
    // cena: clipe mudo em loop (é para olhar); final: com som, a pessoa dá o play
    const isFinal = pick === "final";
    return (
      <div className={box}>
        <video
          key={path}
          src={src}
          poster={poster}
          controls
          playsInline
          autoPlay={!isFinal}
          muted={!isFinal}
          loop={!isFinal}
          className="absolute inset-0 size-full object-cover"
        />
      </div>
    );
  }
  if (poster) {
    return (
      <div className={box}>
        <img
          src={poster}
          alt={`Quadro da cena ${scene?.n}`}
          className="absolute inset-0 size-full object-cover"
        />
        {scene?.state === "rendering" ? (
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/75 to-transparent px-4 pb-4 pt-10 text-sm text-white">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Gerando o vídeo desta cena…
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className={cn(box, "flex flex-col items-center justify-center gap-3 text-white/70")}>
      {scene?.state === "stopped" ? (
        <Clapperboard className="size-6" aria-hidden="true" />
      ) : (
        <Loader2 className="size-6 animate-spin" aria-hidden="true" />
      )}
      <span className="text-sm">
        {scene?.state === "stopped" ? "Esta cena não foi gerada" : "Preparando esta cena…"}
      </span>
    </div>
  );
}

/** Primeiro quadro do próprio vídeo, para quem não tem quadro de cena. */
export function VideoFrame({ src }: { src: string }) {
  return (
    <video
      src={`${src}#t=0.1`}
      muted
      playsInline
      preload="metadata"
      aria-hidden="true"
      tabIndex={-1}
      className="absolute inset-0 size-full object-cover"
    />
  );
}

function StoryRow({
  active,
  onSelect,
  thumb,
  thumbVideo,
  playable,
  title,
  text,
  badge,
  icon,
  trailing,
  below,
}: {
  active: boolean;
  onSelect: () => void;
  thumb: string | null;
  /** sem quadro de cena: a miniatura sai do próprio vídeo */
  thumbVideo?: string | null;
  playable?: boolean;
  title: string;
  text?: string;
  badge: React.ReactNode;
  icon?: React.ReactNode;
  /** ações da cena à direita (Editar, Desfazer) — fora do botão que seleciona */
  trailing?: React.ReactNode;
  /** painel aberto sob a linha (edição) */
  below?: React.ReactNode;
}) {
  return (
    <li>
      <div className="flex items-start gap-1">
        <button
          type="button"
          onClick={onSelect}
          aria-current={active ? "true" : undefined}
          className={cn(
            "relative flex min-w-0 flex-1 items-start gap-4 rounded-[14px] px-3 py-3 text-left transition-colors duration-150",
            "hover:bg-[var(--via-navy-04)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]",
          )}
        >
          {active ? (
            <span
              aria-hidden="true"
              className="absolute inset-y-3 left-0 w-[3px] rounded-full bg-[var(--via-navy)]"
            />
          ) : null}
          <span
            className={cn(
              "relative aspect-[9/16] w-16 shrink-0 overflow-hidden rounded-[10px] bg-[var(--via-navy-06)] transition-opacity duration-150",
              !active && "opacity-80",
            )}
          >
            {thumb ? (
              <img
                src={thumb}
                alt=""
                loading="lazy"
                className="absolute inset-0 size-full object-cover"
              />
            ) : thumbVideo ? (
              <VideoFrame src={thumbVideo} />
            ) : (
              <ImageIcon
                className="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 text-[var(--via-text-faint)]"
                aria-hidden="true"
              />
            )}
            {playable ? (
              <span className="absolute bottom-1 right-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white">
                <Play className="size-2.5 fill-current" aria-hidden="true" />
              </span>
            ) : null}
          </span>
          <span className="min-w-0 flex-1 space-y-1.5">
            <span className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 text-sm text-[var(--via-text-primary)]",
                  active ? "font-medium" : "font-medium",
                )}
              >
                {icon}
                {title}
              </span>
              {badge}
            </span>
            {text ? (
              <span className="line-clamp-3 block text-sm leading-snug text-[var(--via-text-body)]">
                {text}
              </span>
            ) : null}
          </span>
        </button>
        {trailing ? <div className="flex shrink-0 items-center pt-2.5">{trailing}</div> : null}
      </div>
      {below}
    </li>
  );
}

function StateTag({ state, label, dark }: { state: SceneState; label?: string; dark?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs",
        dark ? "text-white/70" : "text-[var(--via-text-muted)]",
      )}
    >
      {state === "rendering" ? (
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 rounded-full",
            state === "ready" && (dark ? "bg-white" : "bg-[var(--via-navy)]"),
            state === "frame" && "bg-[var(--via-brand-blue)]",
            state === "waiting" && "bg-[var(--via-navy-14)]",
            state === "stopped" && "bg-[var(--via-coral)]",
          )}
        />
      )}
      {label ?? STATE_LABEL[state]}
    </span>
  );
}
