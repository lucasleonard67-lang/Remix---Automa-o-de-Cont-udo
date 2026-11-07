import { Link } from "@tanstack/react-router";
import { ArrowRight, Film, Lightbulb, type LucideIcon, ScanFace } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { BrandIcon } from "@/components/brand-icon";
import { BrandInline } from "@/components/brand-inline";
import { HubRouteTile } from "@/components/video/hub-route-tile";
import { Button } from "@/components/ui/button";
import { ChoiceTile } from "@/components/ui/choice-tile";
import { useSecretStatus } from "@/hooks/use-app-settings";
import { useAvatars } from "@/hooks/use-avatars";
import { useHubModels, type ResolvedChoice } from "@/hooks/use-hub-models";
import { useEngineStatus } from "@/hooks/use-video-models";
import { exampleFor } from "@/lib/hub-examples";
import { openIntegration } from "@/lib/integration-modal";
import { cn } from "@/lib/utils";
import {
  HUB_HAVE,
  HUB_PROVIDER_INTEGRATION,
  HUB_PROVIDER_LABEL,
  HUB_ROUTES,
  presenterHasFace,
  routeReady,
  type HubHave,
  type HubProvider,
  type HubRoute,
  type ModelChoice,
} from "@/lib/video-hub";

// ---------------------------------------------------------------------------
// Hub de vídeo: duas perguntas (o que você tem? o que você quer?) e a
// resposta: o modelo padrão e, ao lado, o top — custo e tempo de cada, um
// toque para trocar. O escolhido segue para o fluxo de destino.
// ---------------------------------------------------------------------------

const HAVE_ICON: Record<HubHave, LucideIcon> = {
  idea: Lightbulb,
  photo: ScanFace,
  video: Film,
};

export function VideoHub({
  onRoute,
  initialHave = null,
  compact = false,
}: {
  /** A pessoa confirmou a rota: quem chama abre o fluxo certo (com o modelo escolhido, se houver). */
  onRoute: (route: HubRoute, have: HubHave, model: ModelChoice | null) => void;
  initialHave?: HubHave | null;
  /** Dentro do modal: sem o título grande. */
  compact?: boolean;
}) {
  const [have, setHave] = useState<HubHave | null>(initialHave);
  const [route, setRoute] = useState<HubRoute | null>(null);
  // null = o sugerido (o primeiro disponível); a pessoa troca com um toque
  const [modelId, setModelId] = useState<string | null>(null);
  const { choices, suggested } = useHubModels(route);
  // a grade de exemplos é alta: escolhida a rota, o passo seguinte vem para a tela
  const detailRef = useRef<HTMLDivElement | null>(null);
  const routeWant = route?.want ?? null;
  useEffect(() => {
    if (!routeWant || !detailRef.current) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    detailRef.current.scrollIntoView?.({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [routeWant]);
  const picked =
    choices.find((c) => c.choice.id === modelId && c.state === "ready") ?? suggested ?? null;
  const ready = route ? routeReady(route) : false;
  const engines = useEngineStatus();
  const secrets = useSecretStatus();
  const presenters = useAvatars("active");
  // "Vídeo comigo nas cenas" exige rosto: sem nenhum pronto, a nota leva ao cadastro
  const noPresenter =
    route?.want === "presenter" &&
    presenters.isSuccess &&
    !(presenters.data ?? []).some(presenterHasFace);

  const connected = (p: HubProvider): boolean | null => {
    if (p === "higgsfield")
      return engines.higgsfield === "on" ? true : engines.higgsfield === "off" ? false : null;
    if (p === "replicate")
      return engines.replicate === "on" ? true : engines.replicate === "off" ? false : null;
    if (secrets.isLoading) return null;
    const key = p === "heygen" ? "HEYGEN_API_KEY" : "ELEVEN_API_KEY";
    return secrets.data?.includes(key) ?? false;
  };
  // provedores da rota + o do modelo escolhido
  const needed: HubProvider[] = route
    ? [...new Set([...route.providers, ...(picked ? [picked.choice.provider] : [])])]
    : [];
  const missing = needed.filter((p) => connected(p) === false);
  const checking = needed.some((p) => connected(p) === null);

  const pickHave = (id: HubHave) => {
    setHave(id);
    setRoute(null);
  };
  const pickRoute = (next: HubRoute) => {
    setRoute(next);
    setModelId(null);
  };
  // todas as rotas de uma vez: cabem na tela, e esconder atrás de "Mais opções" só
  // escondia escolha; o que ainda não tem motor não aparece em vez de prometer deploy
  const visible = have ? HUB_ROUTES[have].filter(routeReady) : [];

  return (
    <div className={cn("space-y-5", !compact && "space-y-6")} data-testid="video-hub">
      <div className="space-y-2.5">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--via-text-muted)]">
          O que você tem?
        </p>
        <div
          className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 sm:gap-3"
          role="group"
          aria-label="O que você tem"
        >
          {HUB_HAVE.map((item) => (
            <ChoiceTile
              key={item.id}
              icon={HAVE_ICON[item.id]}
              label={item.label}
              line={item.line}
              selected={have === item.id}
              onPick={() => pickHave(item.id)}
              testId={`hub-tenho-${item.id}`}
            />
          ))}
        </div>
      </div>

      {have ? (
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--via-text-muted)]">
            O que você quer?
          </p>
          <ul
            className={cn(
              // colunas iguais e ladrilhos de altura fixa: nada cresce com o texto
              "grid grid-cols-2 items-start gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-4",
              !compact && "lg:grid-cols-4",
            )}
            role="group"
            aria-label="O que você quer"
          >
            {visible.map((item) => (
              <li key={item.want} className="min-w-0">
                <HubRouteTile
                  route={item}
                  example={exampleFor(item.experience)}
                  selected={route?.want === item.want}
                  onPick={() => pickRoute(item)}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {route && have ? (
        <div
          ref={detailRef}
          className="scroll-mb-6 space-y-3 border-t border-[var(--via-border-soft)] pt-4"
          data-testid="hub-rota"
          aria-live="polite"
        >
          <ModelRail
            choices={choices}
            picked={picked?.choice.id ?? null}
            onPick={(id) => setModelId(id)}
          />
          <p className="text-xs text-[var(--via-text-muted)]">{route.via}</p>
          {route.options ? (
            <p className="text-xs text-[var(--via-text-muted)]">{route.options}</p>
          ) : null}
          {route.note ? (
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-[var(--via-text-muted)]">
              {route.note}
              {noPresenter ? (
                <Link
                  to="/marca/avatares"
                  className="font-medium text-[var(--via-accent)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]"
                  data-testid="hub-cadastrar-apresentador"
                >
                  Cadastrar um apresentador
                </Link>
              ) : null}
            </p>
          ) : null}
          {missing.length ? (
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-[var(--via-coral-dark)]">
              Falta conectar {missing.map((p) => HUB_PROVIDER_LABEL[p]).join(" e ")}.
              {missing.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => openIntegration(HUB_PROVIDER_INTEGRATION[p])}
                  className="font-medium text-[var(--via-accent)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]"
                >
                  <BrandInline name={p}>Conectar {HUB_PROVIDER_LABEL[p]}</BrandInline>
                </button>
              ))}
            </p>
          ) : null}
          {ready ? null : (
            <p className="text-xs font-medium text-[var(--via-text-primary)]">Em preparação.</p>
          )}
          <Button
            onClick={() => onRoute(route, have, picked?.choice ?? null)}
            disabled={!ready || missing.length > 0 || checking}
            data-testid="hub-continuar"
          >
            Continuar
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trilho de modelos: o padrão primeiro, os top ao lado. Cada linha diz custo e
// tempo; o que ainda não existe aparece "em breve", desligado.
// ---------------------------------------------------------------------------

export function ModelRail({
  choices,
  picked,
  onPick,
}: {
  choices: ResolvedChoice[];
  picked: string | null;
  onPick: (id: string) => void;
}) {
  if (!choices.length) return null;
  return (
    <div
      className="flex flex-wrap gap-2"
      role="radiogroup"
      aria-label="Modelo"
      data-testid="hub-modelos"
    >
      {choices.map((item, index) => {
        const selected = picked === item.choice.id;
        const off = item.state !== "ready";
        return (
          <button
            key={`${item.choice.provider}:${item.choice.id}`}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={off}
            onClick={() => onPick(item.choice.id)}
            className={cn(
              "min-w-0 rounded-[var(--via-radius-lg)] border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)] disabled:cursor-not-allowed",
              selected
                ? "border-[var(--via-navy)] bg-[var(--via-navy-04)]"
                : "border-[var(--via-border-soft)] hover:border-[var(--via-navy-30)] disabled:hover:border-[var(--via-border-soft)]",
            )}
            data-testid={`hub-modelo-${item.choice.id}`}
          >
            <span className="flex items-center gap-2 text-sm font-medium text-[var(--via-text-primary)]">
              <BrandIcon name={item.choice.provider} className="size-4" />
              {item.choice.label}
              <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--via-text-muted)]">
                {index === 0 ? "Padrão" : "Top"}
              </span>
            </span>
            <span
              className={cn(
                "block text-xs",
                off ? "text-[var(--via-text-disabled)]" : "text-[var(--via-text-muted)]",
              )}
            >
              {item.state === "soon"
                ? "em breve"
                : item.state === "checking"
                  ? "conferindo…"
                  : [item.cost, item.time].filter(Boolean).join(" · ")}
            </span>
          </button>
        );
      })}
    </div>
  );
}
