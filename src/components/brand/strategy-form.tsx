import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { StringListEditor } from "@/components/string-list-editor";
import { TagInput } from "@/components/tag-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { StrategyContent } from "@/hooks/use-versioned-brand";

// ---------------------------------------------------------------------------
// Formulário da Bandeira (brand_strategy §8.2) — compartilhado entre
// /marca/bandeira (VersionedEditorShell) e o passo 5 do onboarding.
// ---------------------------------------------------------------------------

function cleanList(list: string[]): string[] {
  return list.map((item) => item.trim()).filter(Boolean);
}

/** Sanitização: trim geral + remoção de itens vazios antes de persistir. */
export function sanitizeStrategyContent(content: StrategyContent): StrategyContent {
  const mix: Record<string, number> = {};
  for (const [key, value] of Object.entries(content.content_mix)) {
    const name = key.trim();
    if (name && Number.isFinite(value)) mix[name] = value;
  }
  return {
    brand_promise: content.brand_promise.trim(),
    theses: cleanList(content.theses),
    enemy: content.enemy.trim(),
    safe_list: cleanList(content.safe_list),
    icp: { perfil: content.icp.perfil.trim(), desejos: cleanList(content.icp.desejos) },
    editorial_stance: content.editorial_stance.trim(),
    content_mix: mix,
    cta_repertoire: cleanList(content.cta_repertoire),
  };
}

/** Mínimo para ativar uma bandeira útil (docs/05 §4.4, passo 5). */
export function isStrategyReady(content: StrategyContent): boolean {
  return (
    content.brand_promise.trim().length > 0 &&
    cleanList(content.theses).length > 0 &&
    content.icp.perfil.trim().length > 0
  );
}

export interface StrategyFormFieldsProps {
  content: StrategyContent;
  patch: (partial: Partial<StrategyContent>) => void;
  readOnly?: boolean;
}

export function StrategyFormFields({ content, patch, readOnly = false }: StrategyFormFieldsProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Promessa e postura</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="strategy-promise">Promessa da marca</Label>
            <Textarea
              id="strategy-promise"
              value={content.brand_promise}
              onChange={(event) => patch({ brand_promise: event.target.value })}
              placeholder="Em uma frase: o que o cliente ganha com a marca"
              className="min-h-20"
              disabled={readOnly}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="strategy-enemy">Contra o que a marca se posiciona</Label>
            <Textarea
              id="strategy-enemy"
              value={content.enemy}
              onChange={(event) => patch({ enemy: event.target.value })}
              placeholder="Ex.: a prática comum do mercado que a marca critica"
              className="min-h-16"
              disabled={readOnly}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="strategy-stance">Postura editorial</Label>
            <Textarea
              id="strategy-stance"
              value={content.editorial_stance}
              onChange={(event) => patch({ editorial_stance: event.target.value })}
              placeholder="Ex.: opina com dados, sem meio-termo"
              className="min-h-16"
              disabled={readOnly}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Teses</CardTitle>
          <CardDescription>As ideias que as peças defendem.</CardDescription>
        </CardHeader>
        <CardContent>
          <StringListEditor
            value={content.theses}
            onChange={(next) => patch({ theses: next })}
            placeholder="Uma tese por linha"
            disabled={readOnly}
            addLabel="Adicionar tese"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Temas seguros</CardTitle>
          <CardDescription>Assuntos sobre os quais a marca sempre pode falar.</CardDescription>
        </CardHeader>
        <CardContent>
          <TagInput
            value={content.safe_list}
            onChange={(next) => patch({ safe_list: next })}
            placeholder="Digite um tema e pressione Enter"
            disabled={readOnly}
            aria-label="Temas seguros"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cliente ideal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="strategy-icp">Perfil</Label>
            <Textarea
              id="strategy-icp"
              value={content.icp.perfil}
              onChange={(event) => patch({ icp: { ...content.icp, perfil: event.target.value } })}
              placeholder="Quem é, o que faz e em que momento está"
              className="min-h-16"
              disabled={readOnly}
            />
          </div>
          <div className="space-y-2">
            <Label>Desejos</Label>
            <StringListEditor
              value={content.icp.desejos}
              onChange={(next) => patch({ icp: { ...content.icp, desejos: next } })}
              placeholder="O que o cliente ideal quer"
              disabled={readOnly}
              addLabel="Adicionar desejo"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mix de conteúdo</CardTitle>
          <CardDescription>
            Quanto de cada tipo de peça, em %. Use os nomes que quiser — ex.: autoridade, prova,
            oferta.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ContentMixEditor
            value={content.content_mix}
            onChange={(next) => patch({ content_mix: next })}
            readOnly={readOnly}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">CTAs preferidos</CardTitle>
          <CardDescription>Escolha entre os CTAs permitidos em Regras da marca.</CardDescription>
        </CardHeader>
        <CardContent>
          <TagInput
            value={content.cta_repertoire}
            onChange={(next) => patch({ cta_repertoire: next })}
            placeholder="Digite um CTA e pressione Enter"
            disabled={readOnly}
            aria-label="CTAs preferidos"
          />
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Editor do Record<string, number> do content_mix. O nome do tipo é aplicado
 * no blur (evita rebuild do Record a cada tecla); o valor aplica direto.
 */
function ContentMixEditor({
  value,
  onChange,
  readOnly,
}: {
  value: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
  readOnly: boolean;
}) {
  const entries = Object.entries(value);

  const renameKey = (oldKey: string, rawNext: string) => {
    const nextKey = rawNext.trim();
    if (!nextKey || nextKey === oldKey) return;
    const next: Record<string, number> = {};
    for (const [key, val] of entries) {
      next[key === oldKey ? nextKey : key] = val;
    }
    onChange(next);
  };

  const setValue = (key: string, raw: string) => {
    const parsed = Number(raw);
    onChange({ ...value, [key]: Number.isFinite(parsed) ? parsed : 0 });
  };

  const removeKey = (key: string) => {
    const next = { ...value };
    delete next[key];
    onChange(next);
  };

  const addRow = () => {
    let name = "novo_tipo";
    let suffix = 1;
    while (name in value) {
      suffix += 1;
      name = `novo_tipo_${suffix}`;
    }
    onChange({ ...value, [name]: 0 });
  };

  const total = entries.reduce((sum, [, val]) => sum + val, 0);

  return (
    <div className="space-y-2">
      {entries.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : null}
      {entries.map(([key, val]) => (
        <MixRow
          key={key}
          name={key}
          value={val}
          readOnly={readOnly}
          onRename={(next) => renameKey(key, next)}
          onValueChange={(raw) => setValue(key, raw)}
          onRemove={() => removeKey(key)}
        />
      ))}
      <div className="flex items-center justify-between gap-2">
        {!readOnly ? (
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus aria-hidden="true" />
            Adicionar tipo
          </Button>
        ) : (
          <span />
        )}
        {entries.length > 0 ? (
          <span
            className={
              total === 100
                ? "text-xs text-muted-foreground"
                : "text-xs font-medium text-[var(--via-text-primary)]"
            }
          >
            total: {total}%{total !== 100 ? " (o ideal é somar 100%)" : ""}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function MixRow({
  name,
  value,
  readOnly,
  onRename,
  onValueChange,
  onRemove,
}: {
  name: string;
  value: number;
  readOnly: boolean;
  onRename: (next: string) => void;
  onValueChange: (raw: string) => void;
  onRemove: () => void;
}) {
  const [localName, setLocalName] = useState(name);

  return (
    <div className="flex items-center gap-2">
      <Input
        value={localName}
        onChange={(event) => setLocalName(event.target.value)}
        onBlur={() => onRename(localName)}
        placeholder="Tipo de conteúdo"
        disabled={readOnly}
        aria-label="Nome do tipo de conteúdo"
      />
      <div className="flex items-center gap-1">
        <Input
          type="number"
          min={0}
          max={100}
          value={String(value)}
          onChange={(event) => onValueChange(event.target.value)}
          className="w-20"
          disabled={readOnly}
          aria-label={`Proporção de ${name}`}
        />
        <span className="text-sm text-muted-foreground">%</span>
      </div>
      {!readOnly ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={onRemove}
          aria-label={`Remover ${name}`}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}
