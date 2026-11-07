import { Link } from "@tanstack/react-router";
import { ArrowRight, ChevronDown } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  LOW_CONFIDENCE,
  type AutopilotState,
  type ReviewSection,
  type ReviewSectionId,
} from "@/hooks/use-brand-autopilot";
import { CHANNEL_TYPE_LABELS } from "@/hooks/use-channels";
import { cn } from "@/lib/utils";
import { humanizeError } from "@/lib/humanize-error";

// ---------------------------------------------------------------------------
// Revisão em uma página: a marca por seção, "confira" onde a confiança é
// baixa e "editar" para a tela de Marca correspondente. Uma ação principal.
// `compact` (fluxo de configuração em modal): sem título nem rodapé — quem
// envolve dá os dois — e cada seção dobrada, com a primeira linha de amostra.
// ---------------------------------------------------------------------------

const SECTION_META: Record<ReviewSectionId, { title: string; to: string }> = {
  quem_somos: { title: "Quem somos", to: "/marca/persona" },
  publico: { title: "Público", to: "/marca/bandeira" },
  voz: { title: "Voz", to: "/marca/persona" },
  posicionamento: { title: "Posicionamento", to: "/marca/bandeira" },
  regras: { title: "Regras da marca", to: "/marca/guardrails" },
  visual: { title: "Identidade visual", to: "/marca/brand-kit" },
  canais: { title: "Canais", to: "/marca/canais" },
};

const ENTER =
  "animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-[220ms] ease-[var(--via-ease-out)]";

export interface AutopilotReviewProps {
  state: AutopilotState;
  onStart: () => void;
  /** Versão para o modal do fluxo de configuração: seções dobráveis, sem título/rodapé. */
  compact?: boolean;
}

export function AutopilotReview({ state, onStart, compact = false }: AutopilotReviewProps) {
  const review = state.review;
  const tone = state.steps.find((step) => step.id === "teste_de_tom");
  const lowCount = (review?.sections ?? []).filter((s) => s.confidence < LOW_CONFIDENCE).length;

  const lowLine =
    lowCount === 0
      ? "Confira o resumo. Tudo continua editável em Marca."
      : `${lowCount === 1 ? "1 seção pede" : `${lowCount} seções pedem`} uma conferida — o material dizia pouco sobre elas.`;

  return (
    <div className={compact ? "space-y-5" : "space-y-8"}>
      {compact ? (
        <div className="space-y-1">
          <p className="text-xl font-medium tracking-[-0.01em] text-foreground">
            {review?.name || "Sua marca"}
          </p>
          {review?.description ? (
            <p className="text-sm text-[var(--via-text-muted)]">{review.description}</p>
          ) : null}
          {lowCount > 0 ? <p className="text-sm text-[var(--via-text-muted)]">{lowLine}</p> : null}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--via-text-muted)]">
            Primeira versão pronta
          </p>
          <h1 className="text-3xl text-foreground">{review?.name || "Sua marca"}</h1>
          {review?.description ? (
            <p className="max-w-2xl text-sm text-[var(--via-text-muted)]">{review.description}</p>
          ) : null}
          <p className="text-sm text-[var(--via-text-muted)]">{lowLine}</p>
        </div>
      )}

      {tone ? <ToneLine summary={tone.summary} error={tone.error} status={tone.status} /> : null}

      {review ? (
        <dl className="border-t border-border">
          {review.sections.map((section, index) =>
            compact ? (
              <CompactSectionRow
                key={section.id}
                section={section}
                index={index}
                palette={section.id === "visual" ? review.palette : []}
                logoUrl={section.id === "visual" ? review.logo_url : null}
                channels={section.id === "canais" ? review.channels : []}
              />
            ) : (
              <SectionRow
                key={section.id}
                section={section}
                index={index}
                palette={section.id === "visual" ? review.palette : []}
                logoUrl={section.id === "visual" ? review.logo_url : null}
                channels={section.id === "canais" ? review.channels : []}
              />
            ),
          )}
        </dl>
      ) : (
        <p className="text-sm text-[var(--via-text-muted)]">
          O resumo não foi gravado. Confira a marca em Marca → Persona.
        </p>
      )}

      {compact ? null : (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <Button variant="ghost" asChild>
            <Link to="/marca">Ver a marca</Link>
          </Button>
          <Button size="lg" onClick={onStart}>
            Começar a criar
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
}

function ToneLine({
  summary,
  error,
  status,
}: {
  summary: string | null;
  error: string | null;
  status: string;
}) {
  if (!summary) return null;
  const score = summary.match(/(\d+(?:[.,]\d)?)\/10/)?.[1];
  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-3 gap-y-1", ENTER)}>
      {score ? (
        <span className="font-mono text-2xl tabular-nums text-foreground">{score}/10</span>
      ) : null}
      <span className="text-sm text-foreground">
        {score ? summary.replace(/.*?\/10\s*[—–-]?\s*/, "") || "no teste de tom" : summary}
      </span>
      {status === "needs_review" && error ? (
        <span className="text-sm text-[var(--via-text-muted)]">{humanizeError(error)}</span>
      ) : null}
      {status === "done" ? (
        <Link
          to="/biblioteca"
          className="text-sm text-[var(--via-text-muted)] underline underline-offset-4 hover:text-foreground"
        >
          Ver peças de teste
        </Link>
      ) : null}
    </div>
  );
}

interface SectionRowProps {
  section: ReviewSection;
  index: number;
  palette: string[];
  logoUrl: string | null;
  channels: string[];
}

function SectionBody({ section, palette, logoUrl, channels }: Omit<SectionRowProps, "index">) {
  return (
    <>
      {palette.length > 0 ? (
        <div className="flex items-center gap-2" aria-label="Paleta">
          {palette.map((hex) => (
            <span
              key={hex}
              className="size-6 rounded-full border border-[var(--via-border-soft)]"
              style={{ backgroundColor: hex }}
              title={hex}
            />
          ))}
          {logoUrl ? (
            <img
              src={logoUrl}
              alt="Logo encontrado no site"
              className="ml-2 h-8 max-w-28 object-contain"
            />
          ) : null}
        </div>
      ) : null}
      {channels.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {channels.map((channel) => (
            <Badge key={channel} className="font-normal">
              {CHANNEL_TYPE_LABELS[channel as keyof typeof CHANNEL_TYPE_LABELS] ?? channel}
            </Badge>
          ))}
        </div>
      ) : section.items.length > 0 ? (
        <ul className="space-y-1">
          {section.items.map((item, i) => (
            <li key={i} className="text-sm text-foreground">
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--via-text-faint)]">
          O site e o Instagram não trouxeram isso. Preencha à mão, se quiser.
        </p>
      )}
    </>
  );
}

function SectionRow({ section, index, palette, logoUrl, channels }: SectionRowProps) {
  const meta = SECTION_META[section.id];
  const low = section.confidence < LOW_CONFIDENCE;
  return (
    <div
      className={cn(
        "grid gap-2 border-b border-border py-5 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-6",
        ENTER,
      )}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <dt className="flex flex-wrap items-center gap-2 sm:block sm:space-y-2">
        <span className="text-sm font-medium text-foreground">{meta.title}</span>
        {low ? (
          <Badge variant="outline" className="font-normal text-[var(--via-text-muted)]">
            confira
          </Badge>
        ) : null}
      </dt>
      <dd className="min-w-0 space-y-3">
        <SectionBody section={section} palette={palette} logoUrl={logoUrl} channels={channels} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--via-text-faint)]">
          {section.source ? <span className="truncate">Fonte: {section.source}</span> : null}
          <Link
            to={meta.to}
            className="text-[var(--via-text-muted)] underline underline-offset-4 hover:text-foreground"
          >
            Editar
          </Link>
        </div>
      </dd>
    </div>
  );
}

/** Linha dobrável: título + "confira" + amostra; aberta mostra tudo e o "Editar". */
function CompactSectionRow({ section, index, palette, logoUrl, channels }: SectionRowProps) {
  const meta = SECTION_META[section.id];
  const low = section.confidence < LOW_CONFIDENCE;
  const [open, setOpen] = useState(low);
  const bodyId = useId();

  const sample =
    channels.length > 0
      ? channels
          .map((c) => CHANNEL_TYPE_LABELS[c as keyof typeof CHANNEL_TYPE_LABELS] ?? c)
          .join(", ")
      : palette.length > 0
        ? `${palette.length} cores`
        : (section.items[0] ?? "Ainda vazio: preencha à mão.");

  return (
    <div
      className={cn("border-b border-border", ENTER)}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <dt>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-start gap-3 py-3 text-left focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]"
        >
          <ChevronDown
            className={cn(
              "mt-0.5 size-4 shrink-0 text-[var(--via-text-muted)] transition-transform duration-[180ms] ease-[var(--via-ease)]",
              open && "rotate-180",
            )}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">{meta.title}</span>
              {low ? (
                <Badge variant="outline" className="font-normal text-[var(--via-text-muted)]">
                  confira
                </Badge>
              ) : null}
            </span>
            {!open ? (
              <span className="mt-0.5 block truncate text-sm text-[var(--via-text-muted)]">
                {sample}
              </span>
            ) : null}
          </span>
        </button>
      </dt>
      {open ? (
        <dd
          id={bodyId}
          className="animate-in fade-in fill-mode-both space-y-3 pb-4 pl-7 duration-[180ms]"
        >
          <SectionBody section={section} palette={palette} logoUrl={logoUrl} channels={channels} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--via-text-faint)]">
            {section.source ? <span className="truncate">Fonte: {section.source}</span> : null}
            <Link
              to={meta.to}
              className="text-[var(--via-text-muted)] underline underline-offset-4 hover:text-foreground"
            >
              Editar
            </Link>
          </div>
        </dd>
      ) : null}
    </div>
  );
}
