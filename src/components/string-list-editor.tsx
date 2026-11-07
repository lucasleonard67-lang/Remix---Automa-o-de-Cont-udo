import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface StringListEditorProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Textarea em vez de Input (frases longas). */
  multiline?: boolean;
  addLabel?: string;
}

/**
 * Lista editável de strings em linhas (para frases: teses, princípios,
 * checklist…) — cada linha com remover, botão de adicionar no fim.
 * Linhas vazias são filtradas na sanitização da página, não aqui.
 */
export function StringListEditor({
  value,
  onChange,
  placeholder,
  disabled,
  multiline,
  addLabel,
}: StringListEditorProps) {
  const setAt = (index: number, next: string) =>
    onChange(value.map((item, i) => (i === index ? next : item)));
  const removeAt = (index: number) => onChange(value.filter((_, i) => i !== index));

  return (
    <div className="space-y-2">
      {value.length === 0 && disabled ? <p className="text-sm text-muted-foreground">—</p> : null}
      {value.map((item, index) => (
        <div key={index} className="flex items-start gap-2">
          {multiline ? (
            <Textarea
              value={item}
              onChange={(event) => setAt(index, event.target.value)}
              placeholder={placeholder}
              disabled={disabled}
              className="min-h-16"
            />
          ) : (
            <Input
              value={item}
              onChange={(event) => setAt(index, event.target.value)}
              placeholder={placeholder}
              disabled={disabled}
            />
          )}
          {!disabled ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={() => removeAt(index)}
              aria-label="Remover item"
            >
              <Trash2 aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      ))}
      {!disabled ? (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, ""])}>
          <Plus aria-hidden="true" />
          {addLabel ?? "Adicionar"}
        </Button>
      ) : null}
    </div>
  );
}
