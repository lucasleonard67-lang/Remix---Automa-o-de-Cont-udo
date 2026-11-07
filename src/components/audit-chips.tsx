import { AlertTriangle, CheckCircle2, CircleDashed, Gavel, XCircle } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  JUDGE_RULE_LABELS,
  type Audit,
  type AuditGrounding,
  type AuditJudge,
  type AuditLinter,
} from "@/hooks/use-content-pieces";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// AuditChips — os 3 chips de auditoria da peça (docs/04 §8.8 + docs/05 §4.2):
// Linter (classe 1, determinístico), Grounding (classe 2, diff contra o
// contexto) e Juiz (classe 3, LLM-as-judge).
// Paleta VIA: nada de semáforo verde/âmbar em chip (banido no DS) — ok e
// atenção vivem na família navy (o ícone diferencia); coral SÓ pra falha real.
// ---------------------------------------------------------------------------

type ChipTone = "ok" | "warn" | "fail" | "pending";

const TONE_CLASSES: Record<ChipTone, string> = {
  ok: "border-[0.5px] border-[var(--via-border-soft)] bg-[var(--via-navy-04)] text-[var(--via-text-body)]",
  warn: "border-[var(--via-navy-20)] bg-[var(--via-navy-08)] text-[var(--via-text-primary)]",
  fail: "border-transparent bg-[rgba(184,92,92,0.12)] text-[var(--via-coral-dark)]",
  pending: "border-transparent bg-muted text-muted-foreground",
};

const TONE_ICONS: Record<ChipTone, typeof CheckCircle2> = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  fail: XCircle,
  pending: CircleDashed,
};

interface ChipModel {
  key: string;
  label: string;
  tone: ChipTone;
  detail: ReactNode | null;
}

function Chip({ chip, compact }: { chip: ChipModel; compact: boolean }) {
  const Icon = chip.key === "judge" && chip.tone !== "pending" ? Gavel : TONE_ICONS[chip.tone];
  const badge = (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 font-medium",
        TONE_CLASSES[chip.tone],
        compact ? "px-1.5 py-0 text-xs" : "cursor-pointer",
      )}
    >
      <Icon className={compact ? "size-2.5" : "size-3"} aria-hidden="true" />
      {chip.label}
    </Badge>
  );

  if (compact || !chip.detail) return badge;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Detalhes: ${chip.label}`}>
          {badge}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3 text-sm">
        {chip.detail}
      </PopoverContent>
    </Popover>
  );
}

// --- Linter -----------------------------------------------------------------

function linterChip(linter: AuditLinter | undefined): ChipModel {
  if (!linter) {
    return { key: "linter", label: "Regras da marca", tone: "pending", detail: null };
  }
  const violations = linter.violations ?? [];
  const tone: ChipTone = linter.passed ? (violations.length > 0 ? "warn" : "ok") : "fail";
  const label =
    violations.length === 0
      ? "Regras ok"
      : `Regras · ${violations.length} ${violations.length === 1 ? "violação" : "violações"}`;
  const detail = (
    <>
      <p className="font-medium text-foreground">
        Regras da marca: palavras, pontuação e chamadas proibidas
      </p>
      {violations.length === 0 ? (
        <p className="text-muted-foreground">Nenhuma regra da marca foi quebrada.</p>
      ) : (
        <ul className="max-h-64 space-y-2 overflow-y-auto">
          {violations.map((violation, index) => (
            <li key={index} className="rounded-md border border-border p-2">
              <div className="flex items-center gap-1.5">
                {violation.severity === "error" ? (
                  <XCircle className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
                ) : (
                  <AlertTriangle
                    className="size-3.5 shrink-0 text-[var(--via-text-primary)]"
                    aria-hidden="true"
                  />
                )}
                <span className="font-medium text-foreground">{violation.rule}</span>
              </div>
              <p className="mt-1 break-words font-mono text-xs text-muted-foreground">
                “{violation.match}”
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
  return { key: "linter", label, tone, detail };
}

// --- Grounding ---------------------------------------------------------------

function groundingChip(grounding: AuditGrounding | undefined): ChipModel {
  if (!grounding) {
    return { key: "grounding", label: "Fatos", tone: "pending", detail: null };
  }
  const flagged = grounding.flagged ?? [];
  const checked = grounding.checked ?? [];
  const tone: ChipTone = !grounding.passed ? "fail" : flagged.length > 0 ? "warn" : "ok";
  const label = flagged.length === 0 ? "Fatos conferidos" : `Fatos · ${flagged.length} a conferir`;
  const detail = (
    <>
      <p className="font-medium text-foreground">
        Fatos: cada afirmação conferida com o seu Contexto
      </p>
      {checked.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {checked.length} {checked.length === 1 ? "afirmação conferida" : "afirmações conferidas"}{" "}
          · {checked.filter((item) => item.status === "ok").length} ok
        </p>
      ) : null}
      {flagged.length === 0 ? (
        <p className="text-muted-foreground">Todas as afirmações têm base no seu Contexto.</p>
      ) : (
        <>
          <ul className="max-h-64 space-y-2 overflow-y-auto">
            {flagged.map((flag, index) => (
              <li key={index} className="rounded-md border border-border p-2">
                <p className="break-words text-foreground">“{flag.claim}”</p>
                <p className="mt-1 text-xs text-muted-foreground">{flag.reason}</p>
                {flag.replaced_with ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Substituída por: “{flag.replaced_with}”
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Confira os trechos marcados com <span className="font-mono">[VERIFICAR]</span> e corrija
            antes de aprovar.
          </p>
        </>
      )}
    </>
  );
  return { key: "grounding", label, tone, detail };
}

// --- Juiz --------------------------------------------------------------------

function PassFailRow({ label, passed, note }: { label: string; passed: boolean; note?: string }) {
  return (
    <li className="flex items-start gap-1.5">
      {passed ? (
        <CheckCircle2
          className="mt-0.5 size-3.5 shrink-0 text-[var(--via-text-primary)]"
          aria-hidden="true"
        />
      ) : (
        <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden="true" />
      )}
      <span className="min-w-0">
        <span className="text-foreground">{label}</span>
        {note ? <span className="block text-xs text-muted-foreground">{note}</span> : null}
      </span>
    </li>
  );
}

function judgeChip(judge: AuditJudge | undefined): ChipModel {
  if (!judge || typeof judge.score !== "number") {
    return { key: "judge", label: "Nota", tone: "pending", detail: null };
  }
  const rules = judge.rules ?? [];
  const softFlags =
    rules.some((rule) => !rule.passed) || !judge.voice_pass || !judge.bridge_logical;
  const tone: ChipTone = judge.verdict === "approve" ? (softFlags ? "warn" : "ok") : "fail";
  const label = `Nota ${judge.score}/10${judge.verdict === "rewrite" ? " · reescrever" : ""}`;
  const detail = (
    <>
      <p className="font-medium text-foreground">
        Nota {judge.score}/10 ·{" "}
        {judge.verdict === "approve" ? "pronta para aprovar" : "precisa ser reescrita"}
      </p>
      <ul className="space-y-1.5">
        {rules.map((rule) => (
          <PassFailRow
            key={rule.rule}
            label={JUDGE_RULE_LABELS[rule.rule] ?? rule.rule}
            passed={rule.passed}
            note={rule.note}
          />
        ))}
        <PassFailRow label="Voz da marca" passed={judge.voice_pass} />
        <PassFailRow label="Ponte lógica para a oferta" passed={judge.bridge_logical} />
      </ul>
      {judge.diagnosis?.length ? (
        <div>
          <p className="text-xs font-medium text-muted-foreground">O que melhorar</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {judge.diagnosis.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
  return { key: "judge", label, tone, detail };
}

// --- Componente --------------------------------------------------------------

export interface AuditChipsProps {
  audit: Partial<Audit> | null | undefined;
  /** Versão mini para cards de lista: chips menores, sem popover. */
  compact?: boolean;
  className?: string;
}

export function AuditChips({ audit, compact = false, className }: AuditChipsProps) {
  const chips = [
    linterChip(audit?.linter),
    groundingChip(audit?.grounding),
    judgeChip(audit?.judge),
  ];
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {chips.map((chip) => (
        <Chip key={chip.key} chip={chip} compact={compact} />
      ))}
    </div>
  );
}
