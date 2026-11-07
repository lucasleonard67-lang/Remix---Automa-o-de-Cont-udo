import { useEffect, useRef, type MouseEvent } from "react";

import { ConnectorsChip } from "@/components/dashboard/connectors-module";
import { Panel, PANEL_ITEM } from "@/components/dashboard/panel";
import { BrandIcon } from "@/components/brand-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsAdmin } from "@/hooks/use-is-admin";
import {
  useProviderCredits,
  type CreditProviderId,
  type MonthSpend,
  type ProviderCredit,
} from "@/hooks/use-provider-credits";
import { formatUsd } from "@/lib/format-usd";
import { openIntegration } from "@/lib/integration-modal";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Custos (só admin): o gasto do mês contra o teto e um item por conta (marca e
// saldo; o item abre a compra de créditos do provedor; detalhe no title).
// O estado dos conectores fica num chip no cabeçalho.
// ---------------------------------------------------------------------------

const META: Record<CreditProviderId, { name: string; site: string }> = {
  elevenlabs: { name: "ElevenLabs", site: "https://elevenlabs.io/app/subscription" },
  heygen: { name: "HeyGen", site: "https://app.heygen.com/settings/billing" },
  higgsfield: { name: "Higgsfield", site: "https://higgsfield.ai/pricing" },
  replicate: { name: "Replicate", site: "https://replicate.com/account/billing" },
};

/** Conta sem limite na API não tem percentual: um vídeo parou com 16 créditos no Higgsfield. */
const POUCO: Partial<Record<CreditProviderId, number>> = { higgsfield: 50 };

/** Nenhum parceiro aceita ser aberto dentro do produto nem vende crédito por API. */
const JANELA = "popup,width=560,height=760,noopener,noreferrer";

const fmtInt = (n: number) => new Intl.NumberFormat("pt-BR").format(Math.round(n));

function amount(p: ProviderCredit): string | null {
  if (p.remaining === null) return null;
  if (p.unit === "usd") return formatUsd(p.remaining);
  if (p.unit === "chars") return fmtInt(p.remaining);
  return fmtInt(p.remaining);
}

function spentFor(id: CreditProviderId, s: MonthSpend): string | null {
  if (id === "replicate")
    return s.replicate_usd > 0 ? `${formatUsd(s.replicate_usd)} no mês` : null;
  if (id === "heygen") return s.heygen_usd > 0 ? `${formatUsd(s.heygen_usd)} no mês` : null;
  if (id === "higgsfield")
    return s.higgsfield_credits > 0 ? `${fmtInt(s.higgsfield_credits)} créditos no mês` : null;
  return s.elevenlabs_chars > 0 ? `${fmtInt(s.elevenlabs_chars)} caracteres no mês` : null;
}

function renews(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `renova em ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}`;
}

const plan = (s: string | null) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : null;

export function CreditsSection() {
  const { isAdmin } = useIsAdmin();
  const query = useProviderCredits(isAdmin);
  const { refetch } = query;
  // quem foi comprar crédito volta olhando o saldo novo
  const comprando = useRef(false);
  useEffect(() => {
    const voltou = () => {
      if (!comprando.current) return;
      comprando.current = false;
      void refetch();
    };
    window.addEventListener("focus", voltou);
    return () => window.removeEventListener("focus", voltou);
  }, [refetch]);
  if (!isAdmin) return null;
  const data = query.data;
  const spend = data?.spend;
  const monthUsd = spend
    ? spend.replicate_usd + spend.heygen_usd + (spend.claude_edit_usd ?? 0)
    : null;
  const cap = spend?.video_cap_usd ?? 0;
  const ratio = monthUsd !== null && cap > 0 ? Math.min(1, monthUsd / cap) : 0;
  const high = ratio >= 0.85;
  const checked = data
    ? new Date(data.checked_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <Panel label="Custos" testId="credits-section" aside={<ConnectorsChip />}>
      {query.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-8 w-full rounded-[var(--via-radius-md)]" />
          ))}
        </div>
      ) : query.isError || !data ? (
        <p className="text-sm text-[var(--via-text-muted)]">
          Não deu para ler as contas agora.{" "}
          <button
            type="button"
            className="font-medium text-[var(--via-text-primary)] underline underline-offset-4"
            onClick={() => void query.refetch()}
          >
            Tentar de novo
          </button>
        </p>
      ) : (
        <div className="flex h-full flex-col gap-3">
          {monthUsd !== null ? (
            <div
              className="space-y-1.5"
              title={`Gasto registrado pelo app ao gerar (a fatura final é a do provedor). Lido às ${checked}.`}
            >
              <p className="flex items-baseline justify-between gap-2 text-sm text-[var(--via-text-muted)]">
                <span>
                  <span className="font-mono text-xl font-medium tabular-nums tracking-[-0.02em] text-[var(--via-text-primary)]">
                    {formatUsd(monthUsd)}
                  </span>{" "}
                  no mês
                </span>
                <span
                  className={cn("text-xs tabular-nums", high && "text-[var(--via-coral-dark)]")}
                >
                  teto {formatUsd(cap)}
                </span>
              </p>
              <span
                className="block h-1 overflow-hidden rounded-full bg-[var(--via-navy-06)]"
                role="meter"
                aria-valuemin={0}
                aria-valuemax={cap > 0 ? cap : undefined}
                aria-valuenow={monthUsd}
                aria-label="Gasto em vídeo no mês"
              >
                <span
                  className={cn(
                    "block h-full rounded-full transition-[width] duration-500 ease-[var(--via-ease-out)]",
                    high ? "bg-[var(--via-coral)]" : "bg-[var(--via-navy)]",
                  )}
                  style={{ width: `${ratio * 100}%` }}
                />
              </span>
            </div>
          ) : null}
          <ul className="grid flex-1 auto-rows-fr grid-cols-2 gap-2" aria-label="Contas">
            {(data.providers ?? []).map((p) => (
              <ProviderRow
                key={p.id}
                p={p}
                spent={spentFor(p.id, data.spend)}
                onBuy={() => {
                  comprando.current = true;
                }}
              />
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

/** Uma conta num item: marca em cima, saldo e unidade embaixo; o item abre a compra de créditos. */
function ProviderRow({
  p,
  spent,
  onBuy,
}: {
  p: ProviderCredit;
  spent: string | null;
  onBuy: () => void;
}) {
  const meta = META[p.id];
  const value = amount(p);
  const used = p.limit && p.remaining !== null ? 1 - p.remaining / p.limit : null;
  const low =
    (used !== null && used >= 0.85) ||
    p.remaining === 0 ||
    (p.remaining !== null && p.remaining < (POUCO[p.id] ?? 0));
  const buy = (event: MouseEvent<HTMLAnchorElement>) => {
    onBuy();
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    window.open(meta.site, `creditos-${p.id}`, JANELA);
  };
  const detail = [plan(p.plan), renews(p.resets_at), spent, ...p.notes].filter(Boolean).join(" · ");
  // o mesmo estado que se vê vira o rótulo lido (erro, saldo baixo, sem saldo pela API)
  const state = !p.connected
    ? "não conectado"
    : p.error
      ? `erro: ${p.error}`
      : value
        ? `${value}${p.unit ? ` ${UNIT_WORD[p.unit]}` : ""}${low ? ", saldo baixo" : ""}`
        : "saldo só no site";
  const label = `${meta.name}: ${state}.${detail ? ` ${detail}.` : ""}`;
  const ROW = cn(
    PANEL_ITEM,
    "flex size-full min-w-0 flex-col gap-2 text-left text-sm text-[var(--via-text-primary)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)] [&:hover_.ce-name]:underline",
  );
  const inner = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <BrandIcon name={p.id} className="size-4 shrink-0" />
        <span className="ce-name truncate underline-offset-4">{meta.name}</span>
      </span>
      <span className="flex min-w-0 items-baseline gap-1.5">
        {!p.connected ? (
          <span className="text-xs font-medium text-[var(--via-text-primary)]">Conectar</span>
        ) : p.error ? (
          <span className="text-xs text-[var(--via-coral-dark)]">erro</span>
        ) : (
          <span
            className={cn(
              "font-mono text-sm font-medium tabular-nums",
              low
                ? "text-[var(--via-coral-dark)]"
                : value
                  ? "text-[var(--via-text-primary)]"
                  : "text-[var(--via-text-faint)]",
            )}
          >
            {value ?? "—"}
          </span>
        )}
        <span className="truncate text-xs text-[var(--via-text-muted)]">
          {p.connected && !p.error && value && p.unit ? SHORT_UNIT[p.unit] : ""}
        </span>
      </span>
      {p.connected ? (
        <span
          className={cn(
            "mt-auto text-xs font-medium",
            low ? "text-[var(--via-coral-dark)]" : "text-[var(--via-text-muted)]",
          )}
        >
          Adicionar créditos
        </span>
      ) : null}
    </>
  );
  return (
    <li data-testid={`credit-${p.id}`} title={detail || undefined}>
      {p.connected ? (
        <a
          href={meta.site}
          target="_blank"
          rel="noopener noreferrer"
          className={ROW}
          onClick={buy}
          aria-label={`${label} Adicionar créditos (abre em nova janela)`}
        >
          {inner}
        </a>
      ) : (
        <button
          type="button"
          className={ROW}
          onClick={() => openIntegration(p.id)}
          aria-label={`${label} Conectar.`}
        >
          {inner}
        </button>
      )}
    </li>
  );
}

const UNIT_WORD: Record<NonNullable<ProviderCredit["unit"]>, string> = {
  chars: "caracteres",
  usd: "de saldo",
  credits: "créditos",
};

const SHORT_UNIT: Record<NonNullable<ProviderCredit["unit"]>, string> = {
  chars: "caract.",
  usd: "saldo",
  credits: "créd.",
};
