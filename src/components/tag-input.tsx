import { X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

interface TagInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
}

/**
 * Lista editável de chips ("tag input"): Enter ou vírgula adiciona,
 * X (ou Backspace com campo vazio) remove. `disabled` → só exibe os chips.
 */
export function TagInput({
  value,
  onChange,
  placeholder,
  disabled,
  id,
  "aria-label": ariaLabel,
}: TagInputProps) {
  const [input, setInput] = useState("");

  const addTag = (raw: string) => {
    const tag = raw.trim();
    if (!tag || value.includes(tag)) return;
    onChange([...value, tag]);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTag(input);
      setInput("");
    } else if (event.key === "Backspace" && !input && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const handleBlur = () => {
    if (input.trim()) {
      addTag(input);
      setInput("");
    }
  };

  return (
    <div className="space-y-2">
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 font-normal">
              {tag}
              {!disabled ? (
                <button
                  type="button"
                  onClick={() => onChange(value.filter((item) => item !== tag))}
                  aria-label={`Remover ${tag}`}
                  className="rounded-full opacity-70 transition-opacity hover:opacity-100"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              ) : null}
            </Badge>
          ))}
        </div>
      ) : disabled ? (
        <p className="text-sm text-muted-foreground">—</p>
      ) : null}
      {!disabled ? (
        <Input
          id={id}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={placeholder ?? "Digite e pressione Enter para adicionar"}
          aria-label={ariaLabel}
        />
      ) : null}
    </div>
  );
}
