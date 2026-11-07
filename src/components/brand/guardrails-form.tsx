import { AlertTriangle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { TagInput } from "@/components/tag-input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CHANNEL_TYPES, CHANNEL_TYPE_LABELS, type ChannelType } from "@/hooks/use-channels";
import type { GuardrailsContent } from "@/hooks/use-versioned-brand";

// ---------------------------------------------------------------------------
// Formulário de Guardrails (§8.3) — compartilhado entre /marca/guardrails
// (VersionedEditorShell) e o passo 6 do onboarding.
// ---------------------------------------------------------------------------

function cleanList(list: string[]): string[] {
  return list.map((item) => item.trim()).filter(Boolean);
}

/** Sanitização: trim geral + remoção de itens vazios antes de persistir. */
export function sanitizeGuardrailsContent(content: GuardrailsContent): GuardrailsContent {
  return {
    ...content,
    banned_punctuation: cleanList(content.banned_punctuation),
    banned_words: cleanList(content.banned_words),
    banned_metaphors: cleanList(content.banned_metaphors),
    banned_ctas: cleanList(content.banned_ctas),
    allowed_ctas: cleanList(content.allowed_ctas),
  };
}

/** CTAs presentes em permitidos E proibidos ao mesmo tempo (bloqueia ativação). */
export function guardrailsCtaConflicts(content: GuardrailsContent): string[] {
  return content.allowed_ctas.filter((cta) => content.banned_ctas.includes(cta));
}

const BAN_LISTS: Array<{
  key: keyof Pick<
    GuardrailsContent,
    "banned_punctuation" | "banned_words" | "banned_metaphors" | "banned_ctas" | "allowed_ctas"
  >;
  label: string;
  description: string;
  placeholder: string;
}> = [
  {
    key: "banned_punctuation",
    label: "Pontuação proibida",
    description: "Ex.: travessão (—), exclamação dupla (!!), reticências (…).",
    placeholder: "Digite o símbolo e pressione Enter",
  },
  {
    key: "banned_words",
    label: "Palavras proibidas",
    description: "Termos que nunca aparecem em nenhuma peça.",
    placeholder: "Digite a palavra e pressione Enter",
  },
  {
    key: "banned_metaphors",
    label: "Metáforas proibidas",
    description: "Imagens e comparações que a marca evita, como clichês do nicho.",
    placeholder: "Digite a metáfora e pressione Enter",
  },
  {
    key: "banned_ctas",
    label: "CTAs proibidos",
    description: "Chamadas que a marca não usa.",
    placeholder: "Digite o CTA e pressione Enter",
  },
  {
    key: "allowed_ctas",
    label: "CTAs permitidos",
    description: "As peças só usam CTAs desta lista.",
    placeholder: "Digite o CTA e pressione Enter",
  },
];

export interface GuardrailsFormFieldsProps {
  content: GuardrailsContent;
  patch: (partial: Partial<GuardrailsContent>) => void;
  readOnly?: boolean;
}

export function GuardrailsFormFields({
  content,
  patch,
  readOnly = false,
}: GuardrailsFormFieldsProps) {
  const ctaConflicts = guardrailsCtaConflicts(content);

  return (
    <div className="space-y-6">
      {ctaConflicts.length > 0 ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>CTA nas duas listas</AlertTitle>
          <AlertDescription>
            Em permitidos e proibidos ao mesmo tempo: {ctaConflicts.join(", ")}. Remova de uma das
            listas antes de ativar.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Proibições e CTAs</CardTitle>
          <CardDescription>
            Toda peça é conferida contra estas listas antes de chegar a você.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {BAN_LISTS.map((list) => (
            <div key={list.key} className="space-y-2">
              <Label>{list.label}</Label>
              <p className="text-xs text-muted-foreground">{list.description}</p>
              <TagInput
                value={content[list.key]}
                onChange={(next) => patch({ [list.key]: next } as Partial<GuardrailsContent>)}
                placeholder={list.placeholder}
                disabled={readOnly}
                aria-label={list.label}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nota mínima para aprovar</CardTitle>
          <CardDescription>
            Cada peça recebe uma nota de 0 a 10 na avaliação automática. Canal em branco usa a nota
            padrão.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="threshold-default">Nota padrão</Label>
            <Input
              id="threshold-default"
              type="number"
              min={0}
              max={10}
              step={0.5}
              value={String(content.approval_threshold.default)}
              onChange={(event) => {
                const value = Number(event.target.value);
                patch({
                  approval_threshold: {
                    ...content.approval_threshold,
                    default: Number.isFinite(value) ? value : 7,
                  },
                });
              }}
              className="w-28"
              disabled={readOnly}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CHANNEL_TYPES.map((channel) => (
              <PerChannelThreshold
                key={channel}
                channel={channel}
                content={content}
                patch={patch}
                readOnly={readOnly}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Limites por peça</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="dosage-lexicon">Termos do vocabulário próprio (máx.)</Label>
            <Input
              id="dosage-lexicon"
              type="number"
              min={0}
              max={10}
              value={String(content.dosage_rules.signature_lexicon_max_per_piece)}
              onChange={(event) => {
                const value = Number(event.target.value);
                patch({
                  dosage_rules: {
                    ...content.dosage_rules,
                    signature_lexicon_max_per_piece: Number.isFinite(value) ? value : 2,
                  },
                });
              }}
              disabled={readOnly}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dosage-emoji">Emojis (máx.; vazio = sem limite)</Label>
            <Input
              id="dosage-emoji"
              type="number"
              min={0}
              value={
                content.dosage_rules.emoji_max != null ? String(content.dosage_rules.emoji_max) : ""
              }
              onChange={(event) => {
                const raw = event.target.value;
                const { emoji_max: _removed, ...rest } = content.dosage_rules;
                if (raw === "") {
                  patch({ dosage_rules: rest });
                  return;
                }
                const value = Number(raw);
                if (Number.isFinite(value)) {
                  patch({ dosage_rules: { ...rest, emoji_max: value } });
                }
              }}
              disabled={readOnly}
            />
          </div>
          <div className="space-y-2">
            <Label>Política de hashtags</Label>
            <Select
              value={content.dosage_rules.hashtag_policy ?? "unset"}
              onValueChange={(value) => {
                const { hashtag_policy: _removed, ...rest } = content.dosage_rules;
                patch({
                  dosage_rules:
                    value === "unset"
                      ? rest
                      : { ...rest, hashtag_policy: value as "none" | "metadata_only" },
                });
              }}
              disabled={readOnly}
            >
              <SelectTrigger aria-label="Política de hashtags">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">Não definida</SelectItem>
                <SelectItem value="none">Nenhuma hashtag</SelectItem>
                <SelectItem value="metadata_only">Só nos metadados</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Critérios de avaliação</CardTitle>
          <CardDescription>
            Um critério por linha, no formato <span className="font-mono">critério: instrução</span>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RubricField
            value={content.qa_rubric}
            onChange={(next) => patch({ qa_rubric: next })}
            readOnly={readOnly}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Regras extras por canal</CardTitle>
          <CardDescription>
            Palavras proibidas ou CTAs permitidos que valem só para um canal, em formato JSON — ex.:{" "}
            {"{"}
            <span className="font-mono text-xs">
              {'"linkedin_post": {"banned_words": ["sinergia"]}'}
            </span>
            {"}"}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <JsonObjectField
            value={content.channel_scope_overrides as Record<string, unknown>}
            onChange={(next) =>
              patch({
                channel_scope_overrides: next as GuardrailsContent["channel_scope_overrides"],
              })
            }
            readOnly={readOnly}
            ariaLabel="Regras extras por canal (JSON)"
          />
        </CardContent>
      </Card>
    </div>
  );
}

function PerChannelThreshold({
  channel,
  content,
  patch,
  readOnly,
}: {
  channel: ChannelType;
  content: GuardrailsContent;
  patch: (partial: Partial<GuardrailsContent>) => void;
  readOnly: boolean;
}) {
  const perChannel = content.approval_threshold.per_channel ?? {};
  const current = perChannel[channel];

  const commit = (raw: string) => {
    const next = { ...perChannel };
    if (raw === "") {
      delete next[channel];
    } else {
      const value = Number(raw);
      if (!Number.isFinite(value)) return;
      next[channel] = value;
    }
    patch({
      approval_threshold: {
        default: content.approval_threshold.default,
        ...(Object.keys(next).length > 0 ? { per_channel: next } : {}),
      },
    });
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`threshold-${channel}`} className="text-xs font-normal">
        {CHANNEL_TYPE_LABELS[channel]}
      </Label>
      <Input
        id={`threshold-${channel}`}
        type="number"
        min={0}
        max={10}
        step={0.5}
        value={current != null ? String(current) : ""}
        placeholder={String(content.approval_threshold.default)}
        onChange={(event) => commit(event.target.value)}
        disabled={readOnly}
      />
    </div>
  );
}

/** Textarea "regra: instrução" (uma por linha) ⇄ Record<string, string>. */
function RubricField({
  value,
  onChange,
  readOnly,
}: {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  readOnly: boolean;
}) {
  const serialized = useMemo(
    () =>
      Object.entries(value)
        .map(([rule, instruction]) => (instruction ? `${rule}: ${instruction}` : rule))
        .join("\n"),
    [value],
  );
  const [text, setText] = useState(serialized);
  const lastCommitted = useRef(serialized);

  useEffect(() => {
    if (serialized !== lastCommitted.current) {
      lastCommitted.current = serialized;
      setText(serialized);
    }
  }, [serialized]);

  const commit = () => {
    const next: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const separator = trimmed.indexOf(":");
      if (separator === -1) {
        next[trimmed] = "";
      } else {
        const rule = trimmed.slice(0, separator).trim();
        const instruction = trimmed.slice(separator + 1).trim();
        if (rule) next[rule] = instruction;
      }
    }
    lastCommitted.current = Object.entries(next)
      .map(([rule, instruction]) => (instruction ? `${rule}: ${instruction}` : rule))
      .join("\n");
    onChange(next);
  };

  if (readOnly) {
    return serialized ? (
      <pre className="whitespace-pre-wrap font-mono text-xs text-foreground">{serialized}</pre>
    ) : (
      <p className="text-sm text-muted-foreground">—</p>
    );
  }

  return (
    <Textarea
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      placeholder={"tom: penalizar jargão corporativo\nprova: exigir número com fonte"}
      className="min-h-28 font-mono text-xs"
      aria-label="Critérios de avaliação"
    />
  );
}

/** Textarea JSON ⇄ objeto — commit no blur; JSON inválido mostra erro e não commita. */
function JsonObjectField({
  value,
  onChange,
  readOnly,
  ariaLabel,
}: {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  readOnly: boolean;
  ariaLabel: string;
}) {
  const serialized = useMemo(() => JSON.stringify(value ?? {}, null, 2), [value]);
  const [text, setText] = useState(serialized);
  const [error, setError] = useState<string | null>(null);
  const lastCommitted = useRef(serialized);

  useEffect(() => {
    if (serialized !== lastCommitted.current) {
      lastCommitted.current = serialized;
      setText(serialized);
      setError(null);
    }
  }, [serialized]);

  const commit = () => {
    try {
      const parsed: unknown = JSON.parse(text.trim() || "{}");
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Esperado um objeto JSON.");
      }
      setError(null);
      lastCommitted.current = JSON.stringify(parsed, null, 2);
      onChange(parsed as Record<string, unknown>);
    } catch {
      setError("JSON inválido. Corrija o texto para salvar no rascunho.");
    }
  };

  if (readOnly) {
    return <pre className="overflow-x-auto font-mono text-xs text-foreground">{serialized}</pre>;
  }

  return (
    <div className="space-y-2">
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        className="min-h-32 font-mono text-xs"
        aria-label={ariaLabel}
      />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
