import { Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConversaClaude } from "@/components/video/conversa-claude";
import {
  ETAPAS_DO_ROTEIRO,
  useResponderClaude,
  type EtapaDoRoteiro,
  type PedidoDeRoteiro,
  type PlanoDeProducao,
} from "@/hooks/use-roteiro-pedidos";
import { wantForExperience } from "@/lib/video-hub";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { BrandIcon } from "@/components/brand-icon";
import { brandFromLabel } from "@/lib/brands";

// ---------------------------------------------------------------------------
// Peças do pedido de roteiro pelo Claude da pessoa: a trilha de andamento (na
// ferramenta e, compacta, na lista de Vídeos) e o resumo do plano de produção
// entregue. O campo e o botão "Escrever com o seu Claude" estão em
// components/prompt/escrever-com-claude.tsx.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Andamento: a trilha das etapas (o servidor marca enviado, pegou e entregue; o
// Claude avisa pesquisa, referências, roteiro e plano por roteiro_andamento),
// a última frase dele e há quanto tempo. O pedido vive no servidor: a pessoa
// pode sair da tela, e o sino avisa quando o roteiro chegar.
// ---------------------------------------------------------------------------

const ETAPA_LABEL: Record<EtapaDoRoteiro, string> = {
  enviado: "Enviado",
  pegou: "Pegou",
  pesquisa: "Pesquisa",
  referencias: "Referências",
  roteiro: "Roteiro",
  plano: "Plano",
  entregue: "Entregue",
};
const DEMORA_PARA_PEGAR_MS = 2 * 60_000;
const PARADO_MS = 15 * 60_000;

function haQuanto(iso: string): string {
  return formatDistanceToNow(new Date(iso), { locale: ptBR, addSuffix: true });
}

export function AndamentoDoRoteiro({
  pedido,
  cancelando,
  onCancelar,
  compact = false,
}: {
  pedido: PedidoDeRoteiro;
  cancelando?: boolean;
  onCancelar?: () => void;
  /** Na lista de Vídeos: uma linha, com o atalho para a tela. */
  compact?: boolean;
}) {
  const responder = useResponderClaude();
  const etapa = pedido.andamento?.etapa ?? "enviado";
  const atual = Math.max(0, ETAPAS_DO_ROTEIRO.indexOf(etapa));
  const desde = pedido.andamento?.em ?? pedido.created_at;
  const idade = Date.now() - new Date(desde).getTime();
  const semPegar = etapa === "enviado" && idade > DEMORA_PARA_PEGAR_MS;
  const parado = idade > PARADO_MS;
  const frase = pedido.andamento?.texto ?? "Pedido enviado ao seu Claude.";

  if (compact) {
    const aviso = pedido.aguardando_pessoa
      ? "Responda na tela do roteiro."
      : parado
        ? "Parece parado: cancele e peça de novo."
        : semPegar
          ? "O seu Claude ainda não pegou o pedido."
          : null;
    return (
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 border-[var(--via-navy)] pl-3 text-sm"
        data-testid="roteiro-em-andamento"
      >
        {pedido.aguardando_pessoa || parado ? null : (
          <Loader2
            className="size-4 animate-spin text-[var(--via-text-muted)]"
            aria-hidden="true"
          />
        )}
        <Link
          to="/videos/novo"
          search={{ rota: wantForExperience(pedido.contexto?.ferramenta) ?? "avatar" }}
          className="font-medium text-[var(--via-text-primary)] underline-offset-4 hover:underline"
        >
          {pedido.aguardando_pessoa
            ? "O seu Claude precisa de você no roteiro"
            : `Roteiro com o seu Claude · ${ETAPA_LABEL[etapa]}`}
        </Link>
        <span className="min-w-0 text-[var(--via-text-muted)]">
          {aviso ?? frase} · {haQuanto(desde)}
        </span>
        {onCancelar ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            disabled={cancelando}
            onClick={onCancelar}
          >
            Cancelar
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="space-y-4 border-l-2 border-[var(--via-navy)] pl-3 text-sm"
      data-testid="roteiro-pendente"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <Loader2
          className="mt-0.5 size-4 animate-spin text-[var(--via-text-muted)]"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-[var(--via-text-primary)]">
            Com o seu Claude · {ETAPA_LABEL[etapa].toLowerCase()}
          </span>
          <span className="block text-[var(--via-text-muted)]">
            {frase} · {haQuanto(desde)}
          </span>
        </span>
        {onCancelar ? (
          <Button variant="ghost" size="sm" disabled={cancelando} onClick={onCancelar}>
            Cancelar
          </Button>
        ) : null}
      </div>

      <div
        className="h-1 w-full overflow-hidden rounded-full bg-[var(--via-navy-08)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={ETAPAS_DO_ROTEIRO.length - 1}
        aria-valuenow={atual}
        aria-label="Andamento do roteiro"
      >
        <div
          className="h-full rounded-full bg-[var(--via-navy)] transition-[width] duration-700 ease-out"
          style={{ width: `${(atual / (ETAPAS_DO_ROTEIRO.length - 1)) * 100}%` }}
        />
      </div>
      <ol
        className="grid gap-x-2 gap-y-1 sm:grid-cols-[repeat(7,minmax(0,1fr))]"
        aria-label="Etapas do roteiro"
      >
        {ETAPAS_DO_ROTEIRO.map((id, index) => {
          const feito = index < atual;
          const agora = index === atual;
          return (
            <li key={id} className="flex min-w-0 items-center gap-1.5 sm:flex-col sm:items-start">
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-medium",
                  feito
                    ? "bg-[var(--via-navy)] text-white"
                    : agora
                      ? "border-2 border-[var(--via-navy)] text-[var(--via-navy)]"
                      : "border border-[var(--via-border)] text-[var(--via-text-muted)]",
                )}
                aria-hidden="true"
              >
                {feito ? <Check className="size-2.5" /> : index + 1}
              </span>
              <span
                className={cn(
                  "truncate text-xs",
                  agora
                    ? "font-medium text-[var(--via-text-primary)]"
                    : "text-[var(--via-text-muted)]",
                )}
              >
                {ETAPA_LABEL[id]}
                <span className="sr-only">{feito ? " (feito)" : agora ? " (agora)" : ""}</span>
              </span>
            </li>
          );
        })}
      </ol>

      <ConversaClaude
        mensagens={pedido.conversa ?? []}
        aguardando={pedido.aguardando_pessoa}
        enviando={responder.isPending}
        onEnviar={(texto) =>
          responder.mutate(
            { pedido_id: pedido.id, texto },
            { onError: (err) => toast.error(err.message) },
          )
        }
      />

      <p className="text-xs text-[var(--via-text-muted)]">
        {pedido.aguardando_pessoa
          ? "Ele parou esperando a sua resposta. Responda acima e ele retoma."
          : parado
            ? "Sem aviso do seu Claude há mais de 15 minutos: parece parado. Cancele e peça de novo."
            : semPegar
              ? "O seu Claude ainda não pegou o pedido."
              : "Pode sair desta tela: o pedido continua e o sino avisa quando o roteiro chegar."}
      </p>
    </div>
  );
}

/** O plano de produção entregue junto: o bastidor que a pessoa prepara e o que acontece depois do avatar. */
export function PlanoResumo({ plano }: { plano: PlanoDeProducao }) {
  const telas = plano.passos.filter((p) => p.tipo === "tela");
  const aoVivo = telas.filter((p) => p.ao_vivo);
  const { ferramentas, intervencoes, dados_de_teste: dados } = plano.bastidor;
  const temBastidor = ferramentas.length > 0 || intervencoes.length > 0;
  return (
    <div className="space-y-3 text-sm" data-testid="plano-de-producao">
      {temBastidor ? (
        <div className="space-y-2 border-l-2 border-[var(--via-navy)] pl-3">
          <p className="font-medium text-[var(--via-text-primary)]">Antes de gerar</p>
          {ferramentas.length ? (
            <ul className="space-y-1 text-[var(--via-text-muted)]">
              {ferramentas.map((f, i) => {
                // ferramenta conhecida leva o logo oficial, uma vez, no nome
                const marca = brandFromLabel(f.nome);
                return (
                  <li key={i}>
                    {marca ? (
                      <BrandIcon
                        name={marca}
                        className="mr-1.5 inline-block size-4 align-[-0.2em]"
                      />
                    ) : null}
                    <span className="text-[var(--via-text-primary)]">{f.nome}</span> · {f.para_que}
                    {f.onde_fica_a_chave ? ` · chave em ${f.onde_fica_a_chave}` : ""}
                    {f.modo_teste ? ` · ${f.modo_teste}` : ""}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {intervencoes.length ? (
            <ol className="list-decimal space-y-1 pl-5 text-[var(--via-text-muted)]">
              {intervencoes.map((it, i) => (
                <li key={i}>
                  <span className="text-[var(--via-text-primary)]">{it.quando}</span>: {it.o_que}
                  {it.minutos ? ` · ${it.minutos} min` : ""}
                </li>
              ))}
            </ol>
          ) : null}
          <p className="text-xs text-[var(--via-text-muted)]">
            Deixe essas ferramentas abertas e logadas. As cenas que só você opera, você grava e
            anexa quando o vídeo do avatar ficar pronto.
          </p>
        </div>
      ) : null}
      <details className="group">
        <summary className="cursor-pointer list-none font-medium text-[var(--via-text-primary)]">
          Plano de produção
          <span className="ml-2 font-normal text-[var(--via-text-muted)]">
            {plano.passos.length} {plano.passos.length === 1 ? "passo" : "passos"} · {telas.length}{" "}
            de tela{aoVivo.length ? ` (${aoVivo.length} ao vivo)` : ""}
            {plano.gravacoes.length
              ? ` · ${plano.gravacoes.length} ${plano.gravacoes.length === 1 ? "gravação" : "gravações"}`
              : ""}
            {" · "}
            {plano.formato}
          </span>
        </summary>
        <div className="mt-2 space-y-2 border-l-2 border-[var(--via-border-soft)] pl-3">
          <p className="text-[var(--via-text-muted)]">{plano.resumo}</p>
          <ol className="space-y-1 text-[var(--via-text-muted)]">
            {plano.passos.map((p) => (
              <li key={p.id}>
                <span className="font-medium text-[var(--via-text-primary)]">{p.id}</span>{" "}
                <span className="text-xs">
                  {p.tipo === "tela" ? (p.ao_vivo ? "ao vivo" : "tela") : "tela cheia"}
                </span>{" "}
                {p.fala}
                {p.legenda ? ` · legenda: ${p.legenda.termo}` : ""}
              </li>
            ))}
          </ol>
          {plano.gravacoes.length ? (
            <ol className="list-decimal space-y-1 pl-5 text-[var(--via-text-muted)]">
              {plano.gravacoes.map((g, i) => (
                <li key={i}>
                  <span className="text-[var(--via-text-primary)]">{g.o_que}</span>: {g.como}
                </li>
              ))}
            </ol>
          ) : null}
          {plano.efeitos_globais.length ? (
            <p className="text-[var(--via-text-muted)]">
              No vídeo inteiro: {plano.efeitos_globais.join(", ")}.
            </p>
          ) : null}
          {dados.length ? (
            <p className="text-[var(--via-text-muted)]">Para apagar no fim: {dados.join(", ")}.</p>
          ) : null}
          <p className="text-xs text-[var(--via-text-muted)]">
            Quando o avatar ficar pronto, o seu Claude grava as telas, monta e entrega o vídeo final
            em Vídeos.
          </p>
        </div>
      </details>
    </div>
  );
}
