import type { CSSProperties, ReactNode } from "react";

import { EnginePulse } from "@/components/auth/engine-pulse";
import { SubidoLogo } from "@/components/brand/subido-logo";

// ---------------------------------------------------------------------------
// Moldura das telas de acesso no DS SUBIDO (kit/auth/AuthShell): formulário à
// esquerda com eyebrow, título com ponto e lead; à direita, em tela larga, o
// palco navy do produto (o EnginePulse do Content Engine). Classes `lsf-*` em
// design-system/ds/auth.css, copiado do kit. Sempre tema claro.
// ---------------------------------------------------------------------------

const delay = (i: number) => ({ "--i": i }) as CSSProperties;

export function AuthShell({
  eyebrow,
  title,
  lead,
  children,
  trocaKey,
}: {
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
  /** Refaz a entrada do cabeçalho quando o conteúdo muda (troca de aba). */
  trocaKey?: string;
}) {
  return (
    <div className="lsf-root" data-theme="light">
      <main className="lsf-main">
        <div className="lsf-col">
          {/* no celular o palco some: a marca vem para o topo do formulário */}
          <div className="lsf-lockup">
            <span className="flex flex-col items-start gap-1.5">
              <SubidoLogo height={24} title="subido AI" />
              <span className="max-w-[13rem] text-balance text-[0.6875rem] font-medium uppercase leading-snug tracking-[var(--via-ls-mark)] text-[var(--via-text-muted)]">
                Automação de Redes Sociais
              </span>
            </span>
          </div>
          <div key={trocaKey}>
            <p className="lsf-eyebrow lsf-in" style={delay(1)}>
              {eyebrow}
            </p>
            <h1 className="lsf-title lsf-in" style={delay(2)}>
              {title}
            </h1>
            {lead ? (
              <p className="lsf-lead lsf-in" style={delay(3)}>
                {lead}
              </p>
            ) : null}
          </div>
          {children}
        </div>
      </main>
      <aside className="lsf-aside">
        <div className="ce-auth-stage">
          <SubidoLogo
            height={56}
            animate="intro"
            loopEvery={9000}
            tone="inverse"
            title="subido AI"
            className="relative z-10 shrink-0"
          />
          <div className="relative z-10 flex min-h-0 flex-1 flex-col">
            <EnginePulse />
          </div>
        </div>
      </aside>
    </div>
  );
}

/** Campo do login do kit: rótulo 16px, dica à direita, ícone dentro, 58px. */
export function AuthField({
  id,
  rotulo,
  dica,
  erro,
  icone,
  children,
}: {
  id: string;
  rotulo: string;
  dica?: string;
  erro?: string;
  icone: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <div className="lsf-field">
        <div className="lsf-label">
          <label htmlFor={id}>{rotulo}</label>
          {dica ? <span>{dica}</span> : null}
        </div>
        <div className="lsf-control">
          <span className="lsf-icon">{icone}</span>
          {children}
        </div>
      </div>
      {erro ? (
        <p id={`${id}-error`} className="lsf-error" aria-live="polite">
          {erro}
        </p>
      ) : null}
    </>
  );
}
