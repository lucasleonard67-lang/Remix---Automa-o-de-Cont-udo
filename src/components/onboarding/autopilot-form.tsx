import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import { BrandText } from "@/components/brand-inline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MAX_CAPTIONS, splitCaptions, type StartAutopilotInput } from "@/hooks/use-brand-autopilot";
import { cn } from "@/lib/utils";
import { humanizeError } from "@/lib/humanize-error";

// ---------------------------------------------------------------------------
// Tela inicial do onboarding: dois campos e um botão. As alternativas (colar
// legendas, configurar manualmente em 9 passos) ficam dobradas.
// ---------------------------------------------------------------------------

export interface AutopilotFormProps {
  pending: boolean;
  error: string | null;
  onStart: (input: StartAutopilotInput) => void;
}

export function AutopilotForm({ pending, error, onStart }: AutopilotFormProps) {
  const [site, setSite] = useState("");
  const [instagram, setInstagram] = useState("");
  const [captionsRaw, setCaptionsRaw] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const moreId = useId();

  const captions = splitCaptions(captionsRaw);
  const siteOk = site.trim().length > 3 && site.includes(".");
  const canStart = siteOk && !pending;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canStart) return;
    onStart({ site: site.trim(), instagram: instagram.trim(), captions });
  };

  return (
    <form onSubmit={submit} className="space-y-10">
      <div className="space-y-6">
        <Field
          id="autopilot-site"
          label="Site"
          value={site}
          onChange={setSite}
          placeholder="minhamarca.com.br"
          autoFocus
          inputMode="url"
          autoComplete="url"
        />
        <Field
          id="autopilot-instagram"
          label={<BrandText text="Instagram" />}
          value={instagram}
          onChange={setInstagram}
          placeholder="@minhamarca"
          autoComplete="off"
          hint={<BrandText text="Com o Zernio conectado, as legendas entram sozinhas." />}
        />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg" disabled={!canStart}>
          {pending ? "Lendo…" : "Ler minha marca"}
        </Button>
        <span className="text-sm text-[var(--via-text-faint)]">
          {error ? humanizeError(error) : "Leva 1 a 3 minutos. Tudo continua editável em Marca."}
        </span>
      </div>

      <div className="border-t border-border pt-4">
        <button
          type="button"
          className="flex items-center gap-1.5 text-sm text-[var(--via-text-muted)] transition-colors hover:text-foreground"
          aria-expanded={moreOpen}
          aria-controls={moreId}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <ChevronDown
            className={cn(
              "size-4 transition-transform duration-[var(--via-dur)]",
              moreOpen && "rotate-180",
            )}
            aria-hidden="true"
          />
          Prefere começar de outro jeito?
        </button>

        {moreOpen ? (
          <div id={moreId} className="mt-5 space-y-6 pl-5">
            <div className="space-y-2">
              <Label htmlFor="autopilot-captions">Legendas do Instagram (opcional)</Label>
              <Textarea
                id="autopilot-captions"
                value={captionsRaw}
                onChange={(event) => setCaptionsRaw(event.target.value)}
                className="min-h-32"
                placeholder="Cole até 5 legendas que soem como você, separadas por uma linha em branco."
              />
              <p className="text-xs text-[var(--via-text-faint)]">
                {captions.length === 0
                  ? "Usadas quando o Instagram não puder ser lido pelo Zernio."
                  : `${captions.length} de ${MAX_CAPTIONS} legendas.`}
              </p>
            </div>
            <p className="text-sm text-[var(--via-text-muted)]">
              Sem site ou prefere preencher tudo você mesmo?{" "}
              <Link
                to="/onboarding"
                search={{ modo: "manual" }}
                className="font-medium text-foreground underline underline-offset-4"
              >
                Configurar manualmente
              </Link>{" "}
              em 9 passos.
            </p>
          </div>
        ) : null}
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  autoFocus,
  inputMode,
  autoComplete,
}: {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  hint?: ReactNode;
  autoFocus?: boolean;
  inputMode?: "url" | "text";
  autoComplete?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        inputMode={inputMode}
        autoComplete={autoComplete}
        className="h-12 text-base md:text-base"
      />
      {hint ? <p className="text-xs text-[var(--via-text-faint)]">{hint}</p> : null}
    </div>
  );
}
