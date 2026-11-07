import { Link } from "@tanstack/react-router";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { BrandText } from "@/components/brand-inline";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { hostOf, type BrandFormValues } from "@/components/setup/brand-form";
import { MAX_CAPTIONS, splitCaptions, type AutopilotState } from "@/hooks/use-brand-autopilot";
import { useShake } from "@/hooks/use-feedback";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Passo 1 · Sua marca — site + @ (obrigatórios; "não tenho Instagram" libera)
// e legendas opcionais dobradas. O botão fica no rodapé do fluxo; aqui só o
// formulário controlado. Se a leitura já começou, mostra o que foi lido.
// ---------------------------------------------------------------------------

export interface StepBrandProps {
  values: BrandFormValues;
  onChange: (values: BrandFormValues) => void;
  /** Leitura já iniciada (ou concluída) nesta conta: o formulário vira resumo. */
  state: AutopilotState | null;
  /** "Alterar" foi clicado: mostra o formulário mesmo com leitura feita. */
  editing?: boolean;
  /** Abre a edição; ausente enquanto a leitura roda. */
  onEdit?: () => void;
  /** Erro de campo (do servidor ou da validação): aparece embaixo do campo. */
  errors?: { site?: string; instagram?: string };
  /** Zernio conectado: as legendas do Instagram entram sozinhas. */
  zernioConnected?: boolean;
}

export function StepBrand({
  values,
  onChange,
  state,
  editing = false,
  onEdit,
  errors,
  zernioConnected = false,
}: StepBrandProps) {
  // sem site e sem Zernio, as legendas coladas são o único material: o campo
  // delas abre sozinho e fica marcado como o que falta
  const captionsRequired = values.noSite && !zernioConnected;
  const [moreOpen, setMoreOpen] = useState(captionsRequired);
  useEffect(() => {
    if (captionsRequired) setMoreOpen(true);
  }, [captionsRequired]);
  const siteShake = useShake(errors?.site);
  const instagramShake = useShake(errors?.instagram);
  // o erro do servidor devolve o foco ao campo que ele pede
  const siteRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (errors?.site && !values.noSite) siteRef.current?.focus();
  }, [errors?.site, values.noSite]);
  const moreId = useId();
  const captions = splitCaptions(values.captionsRaw);
  const set = (patch: Partial<BrandFormValues>) => onChange({ ...values, ...patch });

  // falhou: volta o formulário (já preenchido pelo fluxo) para corrigir e ler de novo
  if (state && state.status !== "idle" && state.status !== "failed" && !editing) {
    return <BrandReadSummary state={state} onEdit={onEdit} />;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="setup-site">Site</Label>
          <ChoiceChip
            selected={values.noSite}
            onClick={() => set({ noSite: !values.noSite, site: "" })}
          >
            Não tenho site
          </ChoiceChip>
        </div>
        <Input
          ref={siteRef}
          id="setup-site"
          value={values.site}
          onChange={(event) => set({ site: event.target.value })}
          placeholder="minhamarca.com.br"
          inputMode="url"
          autoComplete="url"
          autoFocus
          disabled={values.noSite}
          aria-invalid={Boolean(errors?.site) || undefined}
          aria-describedby={errors?.site ? "setup-site-error" : undefined}
          className={cn(
            "h-11 text-base md:text-base",
            errors?.site && "border-[var(--via-coral)] focus-visible:border-[var(--via-coral)]",
            siteShake,
          )}
        />
        {errors?.site ? (
          <p
            id="setup-site-error"
            role="alert"
            className="text-xs font-medium text-[var(--via-coral-dark)]"
          >
            {errors.site}
          </p>
        ) : values.noSite ? (
          <p className="text-xs text-[var(--via-text-muted)]">
            A marca será lida pelas legendas do Instagram.
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="setup-instagram">
            <BrandText text="Instagram" />
          </Label>
          <ChoiceChip
            selected={values.noInstagram}
            onClick={() => set({ noInstagram: !values.noInstagram, instagram: "" })}
          >
            Não tenho Instagram
          </ChoiceChip>
        </div>
        <Input
          id="setup-instagram"
          value={values.instagram}
          onChange={(event) => set({ instagram: event.target.value })}
          placeholder="@minhamarca"
          autoComplete="off"
          disabled={values.noInstagram}
          aria-invalid={Boolean(errors?.instagram) || undefined}
          aria-describedby={errors?.instagram ? "setup-instagram-error" : undefined}
          className={cn(
            "h-11 text-base md:text-base",
            errors?.instagram &&
              "border-[var(--via-coral)] focus-visible:border-[var(--via-coral)]",
            instagramShake,
          )}
        />
        {errors?.instagram ? (
          <p
            id="setup-instagram-error"
            role="alert"
            className="text-xs font-medium text-[var(--via-coral-dark)]"
          >
            {errors.instagram}
          </p>
        ) : (
          <p className="text-xs text-[var(--via-text-muted)]">
            {values.noInstagram ? (
              "A marca será montada só a partir do site."
            ) : zernioConnected ? (
              <span className="inline-flex items-center gap-1 text-[var(--via-success)]">
                <Check className="size-3" aria-hidden="true" />
                Zernio conectado: as legendas entram sozinhas.
              </span>
            ) : (
              "Com o Zernio conectado, as legendas entram sozinhas."
            )}
          </p>
        )}
      </div>

      <div className="border-t border-[var(--via-border-soft)] pt-4">
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]",
            captionsRequired && captions.length === 0
              ? "text-[var(--via-coral-dark)]"
              : "text-[var(--via-accent)] hover:text-[var(--via-navy)]",
          )}
          aria-expanded={moreOpen}
          aria-controls={moreId}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <ChevronDown
            className={cn(
              "size-4 transition-transform duration-[180ms] ease-[var(--via-ease)]",
              moreOpen && "rotate-180",
            )}
            aria-hidden="true"
          />
          {captionsRequired
            ? captions.length === 0
              ? "Cole de 1 a 5 legendas: sem site e sem Zernio, elas são o material"
              : "Legendas que soam como você"
            : "Colar legendas que soam como você"}
        </button>

        {moreOpen ? (
          <div
            id={moreId}
            className="mt-4 space-y-2 pl-5 animate-in fade-in slide-in-from-bottom-1 duration-[180ms]"
          >
            <Label htmlFor="setup-captions">Legendas do Instagram (opcional)</Label>
            <Textarea
              id="setup-captions"
              value={values.captionsRaw}
              onChange={(event) => set({ captionsRaw: event.target.value })}
              className="min-h-28"
              placeholder="Até 5 legendas, separadas por uma linha em branco."
            />
            <p className="text-xs text-[var(--via-text-muted)]">
              {captions.length === 0
                ? values.noSite
                  ? "Sem site, são elas que mostram a voz da marca — cole se o Zernio ainda não estiver conectado."
                  : "Usadas quando o Instagram não puder ser lido pelo Zernio."
                : `${captions.length} de ${MAX_CAPTIONS} legendas.`}
            </p>
          </div>
        ) : null}
      </div>

      <p className="text-xs text-[var(--via-text-faint)]">
        Prefere preencher tudo você mesmo?{" "}
        <Link
          to="/onboarding"
          search={{ modo: "manual" }}
          className="text-[var(--via-text-muted)] underline underline-offset-4 hover:text-[var(--via-text-primary)]"
        >
          Configurar manualmente
        </Link>{" "}
        em 9 passos.
      </p>
    </div>
  );
}

function BrandReadSummary({ state, onEdit }: { state: AutopilotState; onEdit?: () => void }) {
  const running = state.status === "running";
  const host = hostOf(state.input.site);
  return (
    <dl className="divide-y divide-[var(--via-border-soft)] border-y border-[var(--via-border-soft)]">
      <Row label="Site">
        <span className="flex items-center justify-between gap-3">
          {host ?? (state.input.site || "Sem site")}
          {onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              className="text-xs text-[var(--via-text-muted)] underline-offset-4 hover:text-[var(--via-text-primary)] hover:underline focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]"
            >
              Alterar site ou Instagram
            </button>
          ) : null}
        </span>
      </Row>
      <Row label="Instagram">
        {state.input.instagram ? `@${state.input.instagram.replace(/^@/, "")}` : "Sem Instagram"}
      </Row>
      <Row label="Leitura">
        <span className="inline-flex items-center gap-2">
          {running ? (
            <Loader2 className="size-3.5 animate-spin text-[var(--via-navy)]" aria-hidden="true" />
          ) : state.status === "done" ? (
            <Check className="size-3.5 text-[var(--via-navy)]" aria-hidden="true" />
          ) : null}
          {running
            ? "Em andamento — segue em segundo plano enquanto você conecta as redes."
            : state.status === "done"
              ? "Concluída. Confira o resultado em Marca pronta."
              : "Parou. Veja o motivo em Marca pronta."}
        </span>
      </Row>
    </dl>
  );
}

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm text-[var(--via-text-muted)]">{label}</dt>
      <dd className="min-w-0 text-sm text-[var(--via-text-primary)]">{children}</dd>
    </div>
  );
}
