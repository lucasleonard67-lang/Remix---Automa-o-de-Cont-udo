import { Link } from "@tanstack/react-router";
import { Plus, ShieldAlert, Trash2 } from "lucide-react";

import { StringListEditor } from "@/components/string-list-editor";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PersonaContent } from "@/hooks/use-versioned-brand";

// ---------------------------------------------------------------------------
// Formulário das 9 seções do contrato de voz — compartilhado entre
// /marca/persona (VersionedEditorShell) e o passo 4 (`voz`) do onboarding.
// ---------------------------------------------------------------------------

function cleanList(list: string[]): string[] {
  return list.map((item) => item.trim()).filter(Boolean);
}

/** Sanitização: trim geral + remoção de linhas/itens vazios antes de persistir. */
export function sanitizePersonaContent(content: PersonaContent): PersonaContent {
  return {
    identity: {
      name: content.identity.name.trim(),
      role: content.identity.role.trim(),
      positioning: content.identity.positioning.trim(),
      audience: content.identity.audience.trim(),
    },
    credenciais: content.credenciais
      .map((item) => ({ claim: item.claim.trim(), source: item.source.trim() }))
      .filter((item) => item.claim || item.source),
    worldview: {
      summary: content.worldview.summary.trim(),
      theses: cleanList(content.worldview.theses),
    },
    tone_principles: cleanList(content.tone_principles),
    signature_lexicon: content.signature_lexicon
      .map((item) => ({
        term: item.term.trim(),
        usage: item.usage.trim(),
        max_per_piece: Number.isFinite(item.max_per_piece) ? item.max_per_piece : 1,
      }))
      .filter((item) => item.term),
    calibration_heuristics: cleanList(content.calibration_heuristics),
    banlist: { ref: "guardrails" },
    opinioes: content.opinioes
      .map((item) => ({ topic: item.topic.trim(), stance: item.stance.trim() }))
      .filter((item) => item.topic || item.stance),
    voice_checklist: cleanList(content.voice_checklist),
    reference_examples: {
      good: content.reference_examples.good
        .map((item) => ({ text: item.text.trim(), why: item.why.trim() }))
        .filter((item) => item.text),
      bad: content.reference_examples.bad
        .map((item) => ({ text: item.text.trim(), why: item.why.trim() }))
        .filter((item) => item.text),
    },
  };
}

/**
 * Mínimo para ativar um contrato de voz utilizável (docs/05 §4.4, passo 4):
 * identidade nomeada, princípios de tom e checklist de voz preenchidos.
 */
export function isPersonaReady(content: PersonaContent): boolean {
  return (
    content.identity.name.trim().length > 0 &&
    cleanList(content.tone_principles).length > 0 &&
    cleanList(content.voice_checklist).length > 0
  );
}

// Helpers de lista de objetos
function updateAt<T>(list: T[], index: number, patch: Partial<T>): T[] {
  return list.map((item, i) => (i === index ? { ...item, ...patch } : item));
}
function removeAt<T>(list: T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

export interface PersonaFormFieldsProps {
  content: PersonaContent;
  patch: (partial: Partial<PersonaContent>) => void;
  readOnly?: boolean;
}

export function PersonaFormFields({ content, patch, readOnly = false }: PersonaFormFieldsProps) {
  return (
    <>
      <Accordion type="multiple" defaultValue={["identity"]} className="w-full">
        {/* 1. Identidade */}
        <AccordionItem value="identity">
          <AccordionTrigger>1 · Identidade — quem fala</AccordionTrigger>
          <AccordionContent className="space-y-4 px-1">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="persona-name">Nome</Label>
                <Input
                  id="persona-name"
                  value={content.identity.name}
                  onChange={(event) =>
                    patch({ identity: { ...content.identity, name: event.target.value } })
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="persona-role">Papel</Label>
                <Input
                  id="persona-role"
                  value={content.identity.role}
                  onChange={(event) =>
                    patch({ identity: { ...content.identity, role: event.target.value } })
                  }
                  placeholder="Ex.: fundador e estrategista de M&A"
                  disabled={readOnly}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="persona-positioning">Posicionamento</Label>
              <Textarea
                id="persona-positioning"
                value={content.identity.positioning}
                onChange={(event) =>
                  patch({ identity: { ...content.identity, positioning: event.target.value } })
                }
                placeholder="Em um parágrafo: quem é essa voz e o que a diferencia"
                className="min-h-24"
                disabled={readOnly}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="persona-audience">Para quem fala</Label>
              <Input
                id="persona-audience"
                value={content.identity.audience}
                onChange={(event) =>
                  patch({ identity: { ...content.identity, audience: event.target.value } })
                }
                disabled={readOnly}
              />
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* 2. Credenciais */}
        <AccordionItem value="credentials">
          <AccordionTrigger>2 · Credenciais — provas de autoridade</AccordionTrigger>
          <AccordionContent className="space-y-3 px-1">
            <p className="text-xs text-muted-foreground">
              Cada credencial precisa de uma fonte que dê para conferir: um link, um item de
              Contexto ou a descrição de onde vem. Sem fonte, a credencial não entra nas peças.
            </p>
            {content.credenciais.length === 0 && readOnly ? (
              <p className="text-sm text-muted-foreground">—</p>
            ) : null}
            {content.credenciais.map((item, index) => (
              <div key={index} className="flex items-start gap-2">
                <div className="grid flex-1 gap-2 sm:grid-cols-2">
                  <Input
                    value={item.claim}
                    onChange={(event) =>
                      patch({
                        credenciais: updateAt(content.credenciais, index, {
                          claim: event.target.value,
                        }),
                      })
                    }
                    placeholder="Credencial — ex.: R$ 120M transacionados em 2024"
                    disabled={readOnly}
                    aria-label={`Credencial ${index + 1}`}
                  />
                  <Input
                    value={item.source}
                    onChange={(event) =>
                      patch({
                        credenciais: updateAt(content.credenciais, index, {
                          source: event.target.value,
                        }),
                      })
                    }
                    placeholder="Fonte (obrigatória)"
                    disabled={readOnly}
                    aria-label={`Fonte da credencial ${index + 1}`}
                  />
                </div>
                {!readOnly ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => patch({ credenciais: removeAt(content.credenciais, index) })}
                    aria-label="Remover credencial"
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
            ))}
            {!readOnly ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  patch({ credenciais: [...content.credenciais, { claim: "", source: "" }] })
                }
              >
                <Plus aria-hidden="true" />
                Adicionar credencial
              </Button>
            ) : null}
          </AccordionContent>
        </AccordionItem>

        {/* 3. Visão de mundo */}
        <AccordionItem value="worldview">
          <AccordionTrigger>3 · Visão de mundo — teses que a voz defende</AccordionTrigger>
          <AccordionContent className="space-y-4 px-1">
            <div className="space-y-2">
              <Label htmlFor="persona-worldview">Resumo</Label>
              <Textarea
                id="persona-worldview"
                value={content.worldview.summary}
                onChange={(event) =>
                  patch({ worldview: { ...content.worldview, summary: event.target.value } })
                }
                className="min-h-20"
                disabled={readOnly}
              />
            </div>
            <div className="space-y-2">
              <Label>Teses (alinhadas com a Bandeira)</Label>
              <StringListEditor
                value={content.worldview.theses}
                onChange={(next) => patch({ worldview: { ...content.worldview, theses: next } })}
                placeholder="Uma tese por linha"
                disabled={readOnly}
                addLabel="Adicionar tese"
              />
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* 4. Princípios de tom */}
        <AccordionItem value="tone">
          <AccordionTrigger>4 · Princípios de tom — como soa</AccordionTrigger>
          <AccordionContent className="px-1">
            <StringListEditor
              value={content.tone_principles}
              onChange={(next) => patch({ tone_principles: next })}
              placeholder="Ex.: direto, sem jargão corporativo"
              disabled={readOnly}
              addLabel="Adicionar princípio"
            />
          </AccordionContent>
        </AccordionItem>

        {/* 5. Léxico assinatura */}
        <AccordionItem value="lexicon">
          <AccordionTrigger>5 · Vocabulário próprio — termos e quanto usar</AccordionTrigger>
          <AccordionContent className="space-y-3 px-1">
            <p className="text-xs text-muted-foreground">
              Por padrão, cada termo aparece no máximo 1 vez por peça. O limite geral (2) fica em
              Regras da marca.
            </p>
            {content.signature_lexicon.length === 0 && readOnly ? (
              <p className="text-sm text-muted-foreground">—</p>
            ) : null}
            {content.signature_lexicon.map((item, index) => (
              <div key={index} className="flex items-start gap-2">
                <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_2fr_5rem]">
                  <Input
                    value={item.term}
                    onChange={(event) =>
                      patch({
                        signature_lexicon: updateAt(content.signature_lexicon, index, {
                          term: event.target.value,
                        }),
                      })
                    }
                    placeholder="Termo"
                    disabled={readOnly}
                    aria-label={`Termo ${index + 1}`}
                  />
                  <Input
                    value={item.usage}
                    onChange={(event) =>
                      patch({
                        signature_lexicon: updateAt(content.signature_lexicon, index, {
                          usage: event.target.value,
                        }),
                      })
                    }
                    placeholder="Quando e como usar"
                    disabled={readOnly}
                    aria-label={`Uso do termo ${index + 1}`}
                  />
                  <Input
                    type="number"
                    min={0}
                    max={2}
                    value={String(item.max_per_piece)}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      patch({
                        signature_lexicon: updateAt(content.signature_lexicon, index, {
                          max_per_piece: Number.isFinite(value) ? value : 1,
                        }),
                      });
                    }}
                    disabled={readOnly}
                    aria-label={`Máximo por peça do termo ${index + 1}`}
                  />
                </div>
                {!readOnly ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() =>
                      patch({ signature_lexicon: removeAt(content.signature_lexicon, index) })
                    }
                    aria-label="Remover termo"
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
            ))}
            {!readOnly ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  patch({
                    signature_lexicon: [
                      ...content.signature_lexicon,
                      { term: "", usage: "", max_per_piece: 1 },
                    ],
                  })
                }
              >
                <Plus aria-hidden="true" />
                Adicionar termo
              </Button>
            ) : null}
          </AccordionContent>
        </AccordionItem>

        {/* 6. Heurísticas de calibração */}
        <AccordionItem value="calibration">
          <AccordionTrigger>6 · Ajustes finos — o que corrigir quando soar errado</AccordionTrigger>
          <AccordionContent className="px-1">
            <StringListEditor
              value={content.calibration_heuristics}
              onChange={(next) => patch({ calibration_heuristics: next })}
              placeholder="Ex.: se soar consultoria genérica, adicionar opinião"
              disabled={readOnly}
              addLabel="Adicionar ajuste"
            />
          </AccordionContent>
        </AccordionItem>

        {/* 7. Opiniões */}
        <AccordionItem value="opinions">
          <AccordionTrigger>7 · Opiniões — posições explícitas</AccordionTrigger>
          <AccordionContent className="space-y-3 px-1">
            {content.opinioes.length === 0 && readOnly ? (
              <p className="text-sm text-muted-foreground">—</p>
            ) : null}
            {content.opinioes.map((item, index) => (
              <div key={index} className="flex items-start gap-2">
                <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_2fr]">
                  <Input
                    value={item.topic}
                    onChange={(event) =>
                      patch({
                        opinioes: updateAt(content.opinioes, index, { topic: event.target.value }),
                      })
                    }
                    placeholder="Tema"
                    disabled={readOnly}
                    aria-label={`Tema da opinião ${index + 1}`}
                  />
                  <Input
                    value={item.stance}
                    onChange={(event) =>
                      patch({
                        opinioes: updateAt(content.opinioes, index, { stance: event.target.value }),
                      })
                    }
                    placeholder="A opinião, em uma frase citável"
                    disabled={readOnly}
                    aria-label={`Posição da opinião ${index + 1}`}
                  />
                </div>
                {!readOnly ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => patch({ opinioes: removeAt(content.opinioes, index) })}
                    aria-label="Remover opinião"
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
            ))}
            {!readOnly ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  patch({ opinioes: [...content.opinioes, { topic: "", stance: "" }] })
                }
              >
                <Plus aria-hidden="true" />
                Adicionar opinião
              </Button>
            ) : null}
          </AccordionContent>
        </AccordionItem>

        {/* 8. Checklist de voz */}
        <AccordionItem value="checklist">
          <AccordionTrigger>8 · Checklist de voz — conferido em toda peça</AccordionTrigger>
          <AccordionContent className="px-1">
            <StringListEditor
              value={content.voice_checklist}
              onChange={(next) => patch({ voice_checklist: next })}
              placeholder="Ex.: abre com um fato concreto"
              disabled={readOnly}
              addLabel="Adicionar item"
            />
          </AccordionContent>
        </AccordionItem>

        {/* 9. Exemplos de referência */}
        <AccordionItem value="examples">
          <AccordionTrigger>9 · Exemplos — bons e ruins</AccordionTrigger>
          <AccordionContent className="space-y-6 px-1">
            <ExampleList
              label="Bons exemplos"
              items={content.reference_examples.good}
              onChange={(next) =>
                patch({ reference_examples: { ...content.reference_examples, good: next } })
              }
              readOnly={readOnly}
            />
            <ExampleList
              label="Exemplos ruins"
              items={content.reference_examples.bad}
              onChange={(next) =>
                patch({ reference_examples: { ...content.reference_examples, bad: next } })
              }
              readOnly={readOnly}
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <Alert>
        <ShieldAlert className="size-4" aria-hidden="true" />
        <AlertTitle>Proibições ficam em Regras da marca</AlertTitle>
        <AlertDescription>
          Palavras, pontuação, metáforas e CTAs proibidos são definidos só em{" "}
          <Link to="/marca/guardrails" className="underline underline-offset-4">
            Regras da marca
          </Link>
          .
        </AlertDescription>
      </Alert>
    </>
  );
}

function ExampleList({
  label,
  items,
  onChange,
  readOnly,
}: {
  label: string;
  items: Array<{ text: string; why: string }>;
  onChange: (next: Array<{ text: string; why: string }>) => void;
  readOnly: boolean;
}) {
  return (
    <div className="space-y-3">
      <Label>{label}</Label>
      {items.length === 0 && readOnly ? <p className="text-sm text-muted-foreground">—</p> : null}
      {items.map((item, index) => (
        <div key={index} className="flex items-start gap-2">
          <div className="flex-1 space-y-2">
            <Textarea
              value={item.text}
              onChange={(event) => onChange(updateAt(items, index, { text: event.target.value }))}
              placeholder="Trecho de exemplo"
              className="min-h-16"
              disabled={readOnly}
              aria-label={`Texto do exemplo ${index + 1} (${label})`}
            />
            <Input
              value={item.why}
              onChange={(event) => onChange(updateAt(items, index, { why: event.target.value }))}
              placeholder="Por que funciona (ou não)"
              disabled={readOnly}
              aria-label={`Justificativa do exemplo ${index + 1} (${label})`}
            />
          </div>
          {!readOnly ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={() => onChange(removeAt(items, index))}
              aria-label="Remover exemplo"
            >
              <Trash2 aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      ))}
      {!readOnly ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...items, { text: "", why: "" }])}
        >
          <Plus aria-hidden="true" />
          Adicionar exemplo
        </Button>
      ) : null}
    </div>
  );
}
