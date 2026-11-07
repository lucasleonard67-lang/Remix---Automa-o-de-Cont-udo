import { useEffect, useMemo, useRef, useState, type ElementType, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/* ==============================================================
   Ajuda (DS SUBIDO · 04-telas §10) — a mesma do My Dashboard
     · eyebrow (Conta) + título "Ajuda" + descrição do que a pessoa acha aqui;
     · busca que filtra as seções, sem diferenciar acento;
     · 4 atalhos para as perguntas que mais trazem alguém à Ajuda;
     · sumário lateral que marca a seção visível (some no celular);
     · seções em cards: ícone em tile + h2 18px + corpo 14px (listas com recuo);
     · "Não achou o que procurava?" com UMA ação.
   Nunca uma lista de perguntas em sanfona (Accordion) no lugar disso: FAQ
   vira UMA seção ("Dúvidas comuns"), com pergunta em negrito + resposta.
   ============================================================== */

export interface SecaoAjuda {
  id: string;
  titulo: string;
  icon: ElementType;
  conteudo: ReactNode;
}

export interface AtalhoAjuda {
  pergunta: string;
  /** id da seção para onde o atalho leva */
  secao: string;
}

function normalizar(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function HelpPage({
  eyebrow = "Conta",
  descricao,
  placeholderBusca = "Buscar na ajuda…",
  secoes,
  atalhos,
  naoAchou,
}: {
  eyebrow?: string;
  descricao: string;
  placeholderBusca?: string;
  secoes: SecaoAjuda[];
  /** até 4: as dúvidas mais comuns */
  atalhos: AtalhoAjuda[];
  naoAchou: { texto: string; acao: ReactNode };
}) {
  const [busca, setBusca] = useState("");
  const [ativa, setAtiva] = useState(secoes[0]?.id);
  // texto de cada seção, lido do DOM: o conteúdo é JSX, não string
  const [textos, setTextos] = useState<Record<string, string>>({});
  const refs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    const prox: Record<string, string> = {};
    for (const s of secoes)
      prox[s.id] = normalizar(`${s.titulo} ${refs.current[s.id]?.textContent ?? ""}`);
    setTextos(prox);
  }, [secoes]);

  // o sumário acompanha a rolagem: a seção mais alta ainda visível fica marcada
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entradas) => {
        const visiveis = entradas
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visiveis[0]) setAtiva(visiveis[0].target.id);
      },
      { rootMargin: "-10% 0px -70% 0px" },
    );
    for (const el of Object.values(refs.current)) if (el) obs.observe(el);
    return () => obs.disconnect();
  }, [secoes]);

  const q = normalizar(busca.trim());
  const mostradas = useMemo(
    () => (q ? secoes.filter((s) => (textos[s.id] ?? "").includes(q)) : secoes),
    [q, textos, secoes],
  );

  function ir(id: string) {
    setBusca("");
    requestAnimationFrame(() =>
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl">
      <p className="mb-2 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-[var(--via-text-muted)]">
        {eyebrow}
      </p>
      <h1 className="text-3xl font-medium tracking-[-0.025em] text-[var(--via-text-primary)]">
        Ajuda
      </h1>
      <p className="mt-1 text-sm text-[var(--via-text-muted)]">{descricao}</p>

      <div className="relative mt-6">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--via-text-soft)]" />
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder={placeholderBusca}
          aria-label="Buscar na ajuda"
          className="h-11 pl-10"
        />
      </div>

      {!q && atalhos.length > 0 && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {atalhos.slice(0, 4).map((a) => (
            <button
              key={a.pergunta}
              type="button"
              onClick={() => ir(a.secao)}
              className="group flex items-center justify-between gap-3 rounded-[var(--via-radius-md)] border border-[var(--via-border-soft)] bg-[var(--via-surface)] px-4 py-3 text-left text-sm text-[var(--via-text-primary)] transition-colors hover:border-[var(--via-navy-20)]"
            >
              {a.pergunta}
              <span className="text-[var(--via-text-soft)] transition-transform group-hover:translate-x-0.5">
                →
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-10 grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Sumário" className="hidden lg:block">
          <div className="sticky top-8 space-y-0.5">
            <p className="ds-group-label">Sumário</p>
            {secoes.map((s) => {
              const on = !q && ativa === s.id;
              const apagada = q && !mostradas.includes(s);
              return (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  aria-current={on ? "true" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-[var(--via-radius-sm)] px-3 py-2 text-sm transition-colors",
                    on
                      ? "bg-[var(--via-navy-04)] font-medium text-[var(--via-text-primary)]"
                      : "text-[var(--via-text-muted)] hover:bg-[var(--via-navy-02)] hover:text-[var(--via-text-primary)]",
                    apagada && "opacity-40",
                  )}
                >
                  <s.icon className="h-4 w-4 shrink-0" />
                  <span>{s.titulo}</span>
                </a>
              );
            })}
          </div>
        </nav>

        <div className="min-w-0 space-y-4">
          {q && (
            <p className="text-sm text-[var(--via-text-muted)]">
              {mostradas.length === 0
                ? `Nenhuma seção fala de "${busca.trim()}". Tente outra palavra ou veja o fim da página.`
                : `${mostradas.length} ${mostradas.length === 1 ? "seção fala" : "seções falam"} de "${busca.trim()}".`}
            </p>
          )}
          {secoes.map((s) => (
            <section
              key={s.id}
              id={s.id}
              ref={(el) => {
                refs.current[s.id] = el;
              }}
              hidden={!mostradas.includes(s)}
              className="scroll-mt-8 rounded-[var(--via-radius-lg)] border border-[var(--via-border-soft)] bg-[var(--via-surface)] p-6"
            >
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--via-radius-sm)] bg-[var(--via-navy-04)] text-[var(--via-navy)]">
                  <s.icon className="h-[18px] w-[18px]" />
                </span>
                <h2 className="text-lg font-medium tracking-[-0.015em] text-[var(--via-text-primary)]">
                  {s.titulo}
                </h2>
              </div>
              <div className="ds-help-body">{s.conteudo}</div>
            </section>
          ))}

          <div className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--via-radius-lg)] border border-[var(--via-border-soft)] bg-[var(--via-surface)] p-6">
            <div>
              <p className="text-base font-medium text-[var(--via-text-primary)]">
                Não achou o que procurava?
              </p>
              <p className="mt-0.5 text-sm text-[var(--via-text-muted)]">{naoAchou.texto}</p>
            </div>
            {naoAchou.acao}
          </div>
        </div>
      </div>
    </div>
  );
}
