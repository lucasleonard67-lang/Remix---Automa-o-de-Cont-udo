import { createFileRoute, Link, type LinkProps } from "@tanstack/react-router";
import { MessageCircle, MessageCircleQuestion } from "lucide-react";
import { useMemo } from "react";

import { ADMIN_ITEMS, NAV_ITEMS, sectionGroup } from "@/components/app-nav";
import { HelpPage, type AtalhoAjuda, type SecaoAjuda } from "@/components/patterns/Ajuda";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { openAssistant } from "@/lib/assistant-open";
import { DUVIDAS, HELP, type HelpEntry } from "@/lib/help";

// ---------------------------------------------------------------------------
// Ajuda = HelpPage do kit (04-telas §10): busca, atalhos, sumário, uma seção por
// item do menu e "Dúvidas comuns" no fim. O texto vem do mesmo arquivo que o
// assistente usa (src/lib/help.ts). "Não achou?" abre o assistente ali mesmo.
// Quem não é administrador não vê as telas que não abre (Vídeos, Ajustes).
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_app/ajuda")({
  component: AjudaPage,
});

const DUVIDAS_ID = "duvidas";

/** As perguntas que mais trazem alguém à Ajuda; cada uma leva a uma seção. */
const ATALHOS: AtalhoAjuda[] = [
  { pergunta: "Como crio meu primeiro conteúdo?", secao: "criar" },
  { pergunta: "Como aprovo e publico uma peça?", secao: "biblioteca" },
  { pergunta: "Como deixo as peças com a cara da marca?", secao: "marca" },
  { pergunta: "Alguma coisa é publicada sem mim?", secao: DUVIDAS_ID },
];

function slug(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-");
}

/** Nome da tela como no menu ou no fim do caminho ("Marca → Contexto" → "Contexto"). */
function nomeDaTela(entrada: HelpEntry): string {
  return entrada.caminho?.split(" → ").at(-1) ?? entrada.menu;
}

/** "Sintoma: o que fazer." → [sintoma, o que fazer]. */
function dividir(erro: string): [string, string] {
  const i = erro.indexOf(": ");
  return i > 0 ? [erro.slice(0, i), erro.slice(i + 2)] : [erro, ""];
}

function montarSecoes(isAdmin: boolean): SecaoAjuda[] {
  const telas = [...NAV_ITEMS, ...ADMIN_ITEMS].flatMap((item) => {
    const entradas = HELP.filter((h) => h.menu === item.title && (isAdmin || !h.admin));
    if (entradas.length === 0) return [];
    // a tela do próprio item primeiro, as de dentro depois
    const ordem = [...entradas].sort(
      (a, b) => Number(Boolean(a.caminho)) - Number(Boolean(b.caminho)),
    );
    return [
      {
        id: slug(item.title),
        titulo: item.title,
        icon: item.icon,
        conteudo: <Capitulo entradas={ordem} />,
      },
    ];
  });
  return [
    ...telas,
    {
      id: DUVIDAS_ID,
      titulo: "Dúvidas comuns",
      icon: MessageCircleQuestion,
      conteudo: <DuvidasComuns />,
    },
  ];
}

function AjudaPage() {
  const { isAdmin, isLoading } = useIsAdmin();
  // memo: o HelpPage relê o texto das seções sempre que a lista muda
  const secoes = useMemo(() => montarSecoes(isAdmin), [isAdmin]);

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <HelpPage
      eyebrow={sectionGroup("/ajuda") ?? "Conta"}
      descricao="Como usar cada tela e o que fazer quando algo trava."
      placeholderBusca="Buscar na ajuda: publicar, vídeo, marca…"
      secoes={secoes}
      atalhos={ATALHOS}
      naoAchou={{
        texto: "O assistente lê a sua conta e leva você à tela certa.",
        acao: (
          <Button onClick={openAssistant}>
            <MessageCircle aria-hidden="true" />
            Perguntar ao assistente
          </Button>
        ),
      }}
    />
  );
}

/** Um capítulo do manual: a tela do item e as que ficam dentro dela. */
function Capitulo({ entradas }: { entradas: HelpEntry[] }) {
  return (
    <div className="space-y-5">
      {entradas.map((entrada, i) => (
        <Tela key={entrada.rota} entrada={entrada} dentro={i > 0} />
      ))}
    </div>
  );
}

function Tela({ entrada, dentro }: { entrada: HelpEntry; dentro: boolean }) {
  const nome = nomeDaTela(entrada);
  return (
    <div className={dentro ? "border-t border-[var(--via-border-soft)] pt-5" : undefined}>
      {dentro ? (
        <h3 className="mb-1 text-sm font-medium text-[var(--via-text-primary)]">{nome}</h3>
      ) : null}
      <p>
        {entrada.resumo}{" "}
        <Link to={entrada.rota as LinkProps["to"]} className="whitespace-nowrap">
          Abrir {nome}
        </Link>
      </p>
      {entrada.passos.length > 0 ? (
        <ol className="mt-3 list-decimal">
          {entrada.passos.map((passo) => (
            <li key={passo}>{passo}</li>
          ))}
        </ol>
      ) : null}
      {entrada.erros.length > 0 ? (
        <>
          <p className="via-eyebrow mb-2 mt-4">Se travar</p>
          <ul className="list-disc">
            {entrada.erros.map((erro) => {
              const [sintoma, saida] = dividir(erro);
              return (
                <li key={erro}>
                  <strong>{sintoma}:</strong> {saida}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/** FAQ como UMA seção do padrão: pergunta em negrito, resposta embaixo. */
function DuvidasComuns() {
  return (
    <div className="space-y-4">
      {DUVIDAS.map((duvida) => (
        <div key={duvida.pergunta}>
          <p>
            <strong>{duvida.pergunta}</strong>
          </p>
          <p>{duvida.resposta}</p>
        </div>
      ))}
    </div>
  );
}
