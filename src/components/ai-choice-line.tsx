import { useState } from "react";

import { BrandIcon } from "@/components/brand-icon";
import {
  DEFAULT_PROVIDER,
  DRIVER_BRAND,
  DRIVER_SECRET,
  RoleDialog,
  modelShortLabel,
  type ConnectorChoice,
} from "@/components/ai-role-grid";
import {
  useAppSetting,
  useSecretStatus,
  type AiProviders,
  type AiRole,
} from "@/hooks/use-app-settings";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// "Qual IA vai fazer isto" à vista ONDE se cria (modal e home), não escondido
// em Ajustes: uma linha com o modelo do texto e o da imagem, cada um clicável.
// O clique abre o mesmo seletor de Ajustes (Lovable/Gemini, Claude, OpenAI,
// Grok) e, se o provedor não tiver chave, o botão "Conectar agora" abre a
// integração por cima — sem sair da criação. A escolha vale para a instância.
// ---------------------------------------------------------------------------

const ROLES: Array<{ role: AiRole; label: string }> = [
  { role: "generator", label: "Texto" },
  { role: "image", label: "Imagem" },
];

/**
 * `connector`: quem cria pode escolher o Claude da assinatura, via conector
 * personalizado, para o Texto. Escolhido e disponível, o chip mostra o Claude e
 * o de Imagem sai (a entrega dele traz as imagens).
 */
export function AiChoiceLine({
  className,
  connector,
}: {
  className?: string;
  connector?: ConnectorChoice & { active: boolean };
}) {
  const providers = useAppSetting<AiProviders>("ai_providers");
  const secrets = useSecretStatus();
  const [open, setOpen] = useState<AiRole | null>(null);
  const current = providers.data ?? {};

  if (providers.isLoading) return null;

  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs", className)}
      data-testid="ai-choice"
    >
      <span className="text-[var(--via-text-muted)]">IA:</span>
      {ROLES.filter(({ role }) => !(connector?.active && role === "image")).map(
        ({ role, label }) => {
          const config = current[role] ?? DEFAULT_PROVIDER;
          const secret = DRIVER_SECRET[config.driver];
          const missing = Boolean(secret) && !secrets.isLoading && !secrets.data?.includes(secret!);
          const viaClaude = role === "generator" && Boolean(connector?.active);
          return (
            <button
              key={role}
              type="button"
              onClick={() => setOpen(role)}
              aria-haspopup="dialog"
              data-testid={`ai-choice-${role}`}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--via-border)] px-2.5 py-1 text-[var(--via-text-primary)] transition-[border-color,background-color] duration-[var(--via-dur)] hover:border-[var(--via-navy-30)] hover:bg-[var(--via-navy-03)] focus-visible:outline-none focus-visible:shadow-[var(--via-shadow-focus)]"
            >
              <BrandIcon
                name={viaClaude ? "claude" : DRIVER_BRAND[config.driver]}
                className="size-3.5"
              />
              <span className="text-[var(--via-text-muted)]">{label}</span>
              <span className="font-medium">
                {viaClaude ? "Claude · conector personalizado" : modelShortLabel(config, role)}
              </span>
              {missing && !viaClaude ? (
                <span className="text-[var(--via-coral-dark)]">· conectar</span>
              ) : null}
            </button>
          );
        },
      )}
      {open ? (
        <RoleDialog
          role={open}
          config={current[open] ?? DEFAULT_PROVIDER}
          providers={current}
          onClose={() => setOpen(null)}
          connector={open === "generator" ? connector : undefined}
        />
      ) : null}
    </div>
  );
}
