import {
  Captions,
  Check,
  Clapperboard,
  Crop,
  ExternalLink,
  Image,
  Languages,
  type LucideIcon,
  MessageSquareText,
  Mountain,
  Palette,
  ScanFace,
  UserRound,
  UserRoundCog,
  UsersRound,
  Wand2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useHubModels } from "@/hooks/use-hub-models";
import { exampleCaption, type HubExample } from "@/lib/hub-examples";
import { cn } from "@/lib/utils";
import { HUB_PROVIDER_LABEL, type HubRoute, type HubWant } from "@/lib/video-hub";

// ---------------------------------------------------------------------------
// Ladrilho de rota do hub: um quadro 9:16 com um exemplo público do provedor
// (vídeo mudo, em loop, só enquanto aparece na tela; a fonte linkada no
// rodapé) e, embaixo, nome, resultado e modelo padrão em altura fixa — todo
// ladrilho tem o mesmo tamanho, com qualquer texto.
// ---------------------------------------------------------------------------

const WANT_ICON: Record<HubWant, LucideIcon> = {
  scenes: Clapperboard,
  presenter: UserRound,
  avatar: ScanFace,
  photo_avatar: Image,
  twin: UsersRound,
  agent: Wand2,
  speech: MessageSquareText,
  translate: Languages,
  style: Palette,
  scene: Mountain,
  character: UserRoundCog,
  captions: Captions,
  reframe: Crop,
};

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return reduced;
}

/** Visível na tela: `seen` fica true na primeira vez; `visible` acompanha. */
export function useInView<T extends Element>() {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry.isIntersecting);
        if (entry.isIntersecting) setSeen(true);
      },
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, visible, seen };
}

export function HubRouteTile({
  route,
  example,
  selected,
  onPick,
}: {
  route: HubRoute;
  example: HubExample | null;
  selected: boolean;
  onPick: () => void;
}) {
  const { choices, suggested } = useHubModels(route);
  const lead = suggested ?? choices[0] ?? null;
  const tops = Math.max(0, choices.length - 1);
  const modelLabel = lead
    ? `${lead.choice.label} · ${HUB_PROVIDER_LABEL[lead.choice.provider]}`
    : null;
  const costLine = lead
    ? (lead.state === "checking"
        ? "conferindo…"
        : lead.state === "soon"
          ? `${lead.choice.label} · em breve`
          : [lead.choice.label, lead.cost].filter(Boolean).join(" · ")) +
      (tops ? ` · +${tops} top` : "")
    : null;

  // o link da fonte fica fora do botão (link dentro de botão não é HTML válido)
  return (
    <div className="relative min-w-0" data-testid={`hub-ladrilho-${route.want}`}>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onPick}
        className="group flex w-full min-w-0 flex-col gap-2.5 text-left focus-visible:outline-none"
        data-testid={`hub-quero-${route.want}`}
      >
        <span
          className={cn(
            "relative block aspect-[9/16] w-full overflow-hidden rounded-[var(--via-radius-lg)] bg-[var(--via-stage)] outline-2 outline-offset-2 outline-solid transition-[outline-color,transform] duration-[var(--via-dur)] ease-[var(--via-ease-snap)] group-focus-visible:shadow-[var(--via-shadow-focus)] group-active:scale-[0.99]",
            selected
              ? "outline-[var(--via-navy)]"
              : "outline-transparent group-hover:outline-[var(--via-navy-30)]",
          )}
        >
          <ExampleStage route={route} example={example} modelLabel={modelLabel} />
          <span
            className={cn(
              "absolute top-2 right-2 inline-flex size-6 items-center justify-center rounded-full transition-[opacity,transform] duration-[var(--via-dur)] ease-[var(--via-ease-snap)]",
              selected
                ? "scale-100 bg-white text-[var(--via-navy)] opacity-100"
                : "scale-90 opacity-0",
            )}
            aria-hidden="true"
          >
            <Check className="size-3.5" strokeWidth={2.5} />
          </span>
        </span>
        {/* altura fixa: título em até 2 linhas + 2 linhas + 1 linha, com ou sem texto */}
        <span className="grid min-w-0 grid-rows-[2.5rem_2rem_1rem] gap-y-0.5 px-0.5">
          <span className="line-clamp-2 text-sm leading-5 font-medium text-[var(--via-text-primary)]">
            {route.label}
          </span>
          <span className="line-clamp-2 text-xs leading-4 text-[var(--via-text-muted)]">
            {route.line}
          </span>
          <span className="truncate text-xs leading-4 text-[var(--via-text-soft)]">
            {costLine ? (
              <>
                <span className="font-medium text-[var(--via-text-muted)]">Padrão</span> {costLine}
              </>
            ) : null}
          </span>
        </span>
      </button>
      {example ? (
        // mesma faixa do rodapé do quadro (o quadro é 9:16 da largura do ladrilho)
        <a
          href={example.source_url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${exampleCaption(example)} (abre em nova aba)`}
          className="pointer-events-none absolute inset-x-0 top-0 flex aspect-[9/16] w-full items-end overflow-hidden rounded-[var(--via-radius-lg)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]"
          data-testid={`hub-exemplo-fonte-${route.want}`}
        >
          <span className="pointer-events-auto flex w-full min-w-0 items-center gap-1 bg-gradient-to-t from-black/75 via-black/45 to-transparent px-2.5 pb-2 pt-6 text-xs leading-4 text-white/85 hover:text-white">
            <span className="truncate">{exampleCaption(example)}</span>
            <ExternalLink className="size-2.5 shrink-0" aria-hidden="true" />
          </span>
        </a>
      ) : null}
    </div>
  );
}

/** O quadro: o vídeo do exemplo sobre o desenho de espera (sem salto de layout). */
function ExampleStage({
  route,
  example,
  modelLabel,
}: {
  route: HubRoute;
  example: HubExample | null;
  modelLabel: string | null;
}) {
  const reduced = useReducedMotion();
  const { ref, visible, seen } = useInView<HTMLSpanElement>();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);
  // link do provedor quebrou (o exemplo é hotlink): volta para o desenho de espera
  const [failed, setFailed] = useState(false);
  // nada sai do CDN do provedor antes do ladrilho aparecer
  const videoUrl = example && seen ? example.video_url : null;
  const posterUrl = example?.poster_url && seen ? example.poster_url : null;

  // toca só enquanto aparece; sem movimento → fica no primeiro quadro
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    if (visible && !reduced) void video.play().catch(() => undefined);
    else video.pause();
  }, [visible, reduced, videoUrl]);

  const showVideo = Boolean(videoUrl) && !failed && !(reduced && posterUrl);
  return (
    <span ref={ref} className="absolute inset-0 block">
      <StagePlaceholder want={route.want} modelLabel={example && !failed ? null : modelLabel} />
      {posterUrl && !failed ? (
        <img
          src={posterUrl}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      {showVideo ? (
        <video
          ref={videoRef}
          src={videoUrl ?? undefined}
          muted
          loop
          playsInline
          disablePictureInPicture
          preload={seen ? "metadata" : "none"}
          aria-hidden="true"
          tabIndex={-1}
          onLoadedData={() => setReady(true)}
          onError={() => setFailed(true)}
          className={cn(
            "absolute inset-0 size-full object-cover transition-opacity duration-[var(--via-dur)] ease-[var(--via-ease-out)]",
            ready ? "opacity-100" : "opacity-0",
          )}
        />
      ) : null}
      {example ? (
        // faixa escura para a legenda do exemplo ler sobre qualquer vídeo
        <span className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/60 to-transparent" />
      ) : null}
    </span>
  );
}

/** Sem exemplo: três quadros respirando e o nome do modelo — nada de vídeo de banco. */
function StagePlaceholder({ want, modelLabel }: { want: HubWant; modelLabel: string | null }) {
  const Icon = WANT_ICON[want];
  const frame =
    "rounded-[var(--via-radius-xs)] bg-white/[0.07] animate-[ce-breathe_3.2s_var(--via-ease)_infinite] motion-reduce:animate-none";
  return (
    <span className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
      <span className="flex items-center gap-1.5">
        <span className={cn(frame, "h-12 w-7")} />
        <span
          className={cn(
            frame,
            "flex h-16 w-10 items-center justify-center bg-white/[0.12] text-white/80 [animation-delay:400ms]",
          )}
        >
          <Icon className="size-4" />
        </span>
        <span className={cn(frame, "h-12 w-7 [animation-delay:800ms]")} />
      </span>
      {modelLabel ? (
        <span className="absolute inset-x-0 bottom-0 truncate px-2.5 pb-2.5 text-center text-xs text-white/60">
          {modelLabel}
        </span>
      ) : null}
    </span>
  );
}
