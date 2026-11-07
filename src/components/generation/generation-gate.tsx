import { Loader2 } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { BrandIcon } from "@/components/brand-icon";
import {
  GateEstimateLine,
  type GateEstimateState,
} from "@/components/generation/gate-estimate-line";
import type { GateResolution } from "@/components/generation/use-gate-resolution";
import { StatusDot } from "@/components/status-dot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { formatUsd } from "@/lib/format-usd";
import {
  TIER_LABEL,
  noPriceShort,
  providerName,
  type GateProvider,
  type GateSelection,
  type RankedOption,
} from "@/lib/generation-gate";
import type { IntegrationId } from "@/lib/integrations";
import { INTEGRATION_BY_ID } from "@/lib/integrations";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Portão de geração — UMA LISTA ordenada pela inteligência, com todas as opções
// (provedor · modelo) da tarefa. A Recomendada no topo com selo e motivo; o
// usuário clica em qualquer uma. Sem borda/sombra/título de card: filetes
// finos entre linhas, cabeçalho da tarefa à esquerda, base da estimativa à
// direita, e o botão colado à estimativa. Nunca chama rede.
//
//   Cenas do vídeo                           Estimativa para 24 s de cena · 5 cenas
//   ──────────────────────────────────────────────────────────────────────────
//   ◉ Replicate · Seedance 2.0        Recomendado                 até US$ 3,36
//     Sem segundos mudos no fim; mantém o rosto do apresentador. Até 15 s por cena.
//   ○ Replicate · Seedance 1 Lite     Mais barato                 até US$ 0,86
//     Movimento mais simples. Até 12 s por cena.
//   ○ Higgsfield · Cinema Studio 3.0            sem estimativa · créditos Higgsfield
//     Não conectado  [Conectar Higgsfield]
//   ☐ Comparar duas: gera o primeiro trecho nas duas marcadas e soma
//   ──────────────────────────────────────────────────────────────────────────
//   Estimativa                                      até US$ 3,36   [▶ Gerar vídeo]
//   depende de 24 s de cena · 5 cenas
// ---------------------------------------------------------------------------

export type { GateEstimateState } from "@/components/generation/gate-estimate-line";

const VISIBLE_ROWS = 5;

export interface GateOptionListProps {
  /** cabeçalho à esquerda ("Cenas do vídeo", "Voz da fala nova") */
  task: string;
  /** base da estimativa, à direita ("24 s de cena · 5 cenas", "320 letras") */
  basis?: string;
  rows: RankedOption[];
  /** A e B efetivos (ids), já resolvidos pela tela */
  a: string | null;
  b: string | null;
  onSelect: (next: GateSelection) => void;
  /** "Comparar duas"; null = sem a opção */
  compare: { enabled: boolean; onToggle: (next: boolean) => void } | null;
  /** motivo extra sob a Recomendada (escolha que deixou de aguentar a duração) */
  fallbackReason?: string | null;
  onConnect?: (provider: GateProvider) => void;
  loading?: boolean;
  error?: boolean;
  emptyText?: string;
  emptyAction?: ReactNode;
  /** prefixo dos testids das linhas (padrão "gate-option") */
  testIdPrefix?: string;
  className?: string;
}

/** A lista em si (cabeçalho + linhas + "Comparar duas"), sem a base de estimativa. */
export function GateOptionList({
  task,
  basis,
  rows,
  a,
  b,
  onSelect,
  compare,
  fallbackReason,
  onConnect,
  loading = false,
  error = false,
  emptyText = "Nenhum modelo de cena ativo.",
  emptyAction,
  testIdPrefix = "gate-option",
  className,
}: GateOptionListProps) {
  const [showAll, setShowAll] = useState(false);
  const groupName = useId();
  const compareOn = Boolean(compare?.enabled);
  const single = rows.length === 1;
  const visible = showAll || rows.length <= VISIBLE_ROWS ? rows : rows.slice(0, VISIBLE_ROWS);

  const pick = (id: string) => {
    if (!compareOn) {
      onSelect({ a: id, b: id === b ? null : b });
      return;
    }
    // checkboxes com no máximo duas marcadas: a primeira é A
    if (id === a) {
      onSelect({ a: b, b: null });
      return;
    }
    if (id === b) {
      onSelect({ a, b: null });
      return;
    }
    if (!a) onSelect({ a: id, b });
    else onSelect({ a, b: id });
  };

  const rowsBody = (
    <ul className="divide-y divide-[var(--via-border-soft)] border-y border-[var(--via-border-soft)]">
      {visible.map((row) => {
        const id = row.option.id;
        const checked = id === a || (compareOn && id === b);
        const disabled = row.blocked != null;
        const inputId = `${groupName}-${id}`;
        return (
          <li key={id} className={cn("py-3", disabled && "opacity-60")}>
            <div className="flex items-start gap-3">
              {single ? null : compareOn ? (
                <Checkbox
                  id={inputId}
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={() => pick(id)}
                  className="mt-0.5"
                  data-testid={`${testIdPrefix}-${id.replace(/\//g, "-")}`}
                />
              ) : (
                <RadioGroupItem
                  id={inputId}
                  value={id}
                  disabled={disabled}
                  className="mt-0.5"
                  data-testid={`${testIdPrefix}-${id.replace(/\//g, "-")}`}
                />
              )}
              <label
                htmlFor={single ? undefined : inputId}
                className={cn("min-w-0 flex-1", !single && !disabled && "cursor-pointer")}
                data-testid={single ? `${testIdPrefix}-${id.replace(/\//g, "-")}` : undefined}
              >
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <BrandIcon name={row.option.engine} className="size-4 shrink-0" />
                  <span className="text-sm font-medium text-[var(--via-text-primary)]">
                    {providerName(row.option.engine)} · {row.option.label}
                  </span>
                  {row.badge ? (
                    <Badge
                      variant={row.badge === "recommended" ? "default" : "outline"}
                      className="font-normal"
                      data-testid={
                        row.badge === "recommended" ? `${testIdPrefix}-recommended` : undefined
                      }
                    >
                      {TIER_LABEL[row.badge]}
                    </Badge>
                  ) : null}
                  {row.estimate ? (
                    <span
                      className={cn(
                        "ml-auto text-right text-sm",
                        row.estimate.kind === "catalog"
                          ? "font-mono tabular-nums text-[var(--via-text-primary)]"
                          : "text-xs text-[var(--via-text-muted)]",
                      )}
                    >
                      {row.estimate.kind === "catalog"
                        ? `até ${formatUsd(row.estimate.maxUsd)}`
                        : noPriceShort(row.option.engine)}
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--via-text-muted)]">
                  {row.blocked ? (
                    <span>{row.blocked}</span>
                  ) : row.status === "off" ? (
                    <>
                      <StatusDot status="off" />
                      {onConnect ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={(event) => {
                            event.preventDefault();
                            onConnect(row.option.engine);
                          }}
                        >
                          Conectar {providerName(row.option.engine)}
                        </Button>
                      ) : null}
                    </>
                  ) : (
                    <span>
                      {row.note}
                      {row.badge === "recommended" && fallbackReason ? ` ${fallbackReason}` : ""}
                    </span>
                  )}
                </span>
              </label>
            </div>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-medium text-[var(--via-text-primary)]">{task}</p>
        {basis ? (
          <p className="text-xs text-[var(--via-text-muted)]">Estimativa para {basis}</p>
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-3 border-y border-[var(--via-border-soft)] py-3">
          <Skeleton className="h-5 w-72" />
          <Skeleton className="h-5 w-64" />
        </div>
      ) : error ? (
        <p className="border-y border-[var(--via-border-soft)] py-3 text-xs text-[var(--via-text-muted)]">
          Não foi possível ler o catálogo de modelos. Recarregue a página; se continuar, avise o
          administrador.
        </p>
      ) : rows.length === 0 ? (
        <p className="flex flex-wrap items-center gap-2 border-y border-[var(--via-border-soft)] py-3 text-xs text-[var(--via-text-muted)]">
          {emptyText}
          {emptyAction}
        </p>
      ) : compareOn || single ? (
        rowsBody
      ) : (
        <RadioGroup value={a ?? ""} onValueChange={pick} aria-label={task} className="gap-0">
          {rowsBody}
        </RadioGroup>
      )}

      {rows.length > VISIBLE_ROWS && !showAll ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto px-0 text-xs"
          onClick={() => setShowAll(true)}
        >
          Ver todas as {rows.length} opções
        </Button>
      ) : null}

      {compare && rows.length > 1 ? (
        <label className="flex items-center gap-2.5 text-xs text-[var(--via-text-muted)]">
          <Checkbox
            checked={compareOn}
            onCheckedChange={(value) => compare.onToggle(value === true)}
            data-testid="gate-compare"
          />
          Comparar duas: gera o primeiro trecho nas duas marcadas e soma
        </label>
      ) : null}
    </div>
  );
}

export interface GateAction {
  label: string;
  onClick: () => void;
  pending?: boolean;
  /** quem decide bloquear é a tela (validação, quadros em voo…); erro de estimativa NÃO bloqueia */
  disabled?: boolean;
  icon?: ReactNode;
  testId?: string;
}

export interface GateConnectAction {
  integration: IntegrationId;
  onClick: () => void;
}

export interface GenerationGateProps extends Omit<
  GateOptionListProps,
  "rows" | "a" | "b" | "fallbackReason" | "className"
> {
  resolution: GateResolution;
  /** estimativa da base (a do servidor no Reel; a do catálogo vem da resolução quando ausente) */
  estimate?: GateEstimateState;
  action: GateAction;
  /** provedor em uso desconectado: o CTA vira "Conectar {Provedor}" */
  connectAction?: GateConnectAction | null;
  /** linha extra em 12px sob a estimativa (ex.: "HeyGen cobra à parte") */
  note?: string;
  "data-testid"?: string;
}

/** Lista + base de estimativa + botão primário: o portão completo de uma tarefa. */
export function GenerationGate({
  resolution,
  estimate,
  action,
  connectAction,
  note,
  "data-testid": testId,
  ...list
}: GenerationGateProps) {
  const cta = connectAction ? (
    <Button size="lg" data-testid="btn-conectar-motor" onClick={connectAction.onClick}>
      <BrandIcon name={INTEGRATION_BY_ID[connectAction.integration].brand} />
      Conectar {INTEGRATION_BY_ID[connectAction.integration].name}
    </Button>
  ) : (
    <Button
      size="lg"
      onClick={action.onClick}
      disabled={action.disabled || action.pending || resolution.blockedReason != null}
      data-testid={action.testId}
    >
      {action.pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : action.icon}
      {action.label}
    </Button>
  );

  return (
    <section aria-label={list.task} data-testid={testId} className="space-y-4 py-2">
      <GateOptionList
        {...list}
        rows={resolution.rows}
        a={resolution.a?.option.id ?? null}
        b={resolution.b?.option.id ?? null}
        fallbackReason={resolution.fallbackReason}
      />
      <GateEstimateLine
        estimate={
          estimate ??
          (resolution.blockedReason
            ? { kind: "pending", reason: resolution.blockedReason }
            : resolution.estimate) ?? { kind: "pending", reason: "aparece quando houver duração" }
        }
        action={cta}
        note={note}
      />
    </section>
  );
}
