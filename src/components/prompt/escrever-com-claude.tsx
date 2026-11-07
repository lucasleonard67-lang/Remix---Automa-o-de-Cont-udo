import { useNavigate } from "@tanstack/react-router";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Link2, Loader2, Undo2 } from "lucide-react";

import { BrandIcon } from "@/components/brand-icon";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConversaClaude } from "@/components/video/conversa-claude";
import { AndamentoDoRoteiro } from "@/components/video/roteiro-brief";
import { useMcpTokens } from "@/hooks/use-mcp-tokens";
import {
  PedidoJaAbertoError,
  useCancelarRoteiro,
  usePedirRoteiro,
  useResponderClaude,
  useUltimoPedidoDeRoteiro,
  type PedidoDeRoteiro,
} from "@/hooks/use-roteiro-pedidos";
import { acessosDoClaude } from "@/lib/mcp-connector-state";
import type { ContextoDeEscrita, TipoDeEscrita } from "@/lib/receitas-de-video";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// "Escrever com o seu Claude": o mesmo controle em todo campo de texto do hub
// de vídeo. A pessoa escreve do jeito dela (ou dita) e clica; o pedido vai pelo
// conector com o tipo, o modelo, o limite e a duração; o Claude dela lê a marca
// e devolve o texto no formato que o modelo exige. O campo nunca trava: ela
// pode editar, sair da tela e voltar; a entrega só entra no campo se ela não
// mexeu nele enquanto esperava. Um pedido aberto por campo.
// ---------------------------------------------------------------------------

export interface EscritaConfig {
  tipo: TipoDeEscrita;
  /** O campo da tela: chave do pedido (um aberto por tipo × alvo). */
  alvo: string;
  /** Modelo, limite, duração, apresentador, voz, formato. */
  contexto?: Omit<ContextoDeEscrita, "alvo">;
  /** Mostra "+ referência" (links que o Claude estuda; só faz sentido no roteiro). */
  referencias?: boolean;
  /** A entrega chegou e entrou no campo: quem chama usa o plano ou a saída. */
  onEntrega?: (pedido: PedidoDeRoteiro) => void;
}

const DEMORA_MS = 2 * 60_000;
const PARADO_MS = 15 * 60_000;

function haQuanto(iso: string): string {
  return formatDistanceToNow(new Date(iso), { locale: ptBR, addSuffix: true });
}

function chaveUsada(id: string) {
  return `ce:escrita-usada:${id}`;
}

/**
 * O estado do pedido deste campo. Devolve o botão (vai na barra do campo) e a
 * faixa (vai embaixo do campo). `config` null = campo sem Claude: nada.
 */
export function useEscreverComClaude(
  config: EscritaConfig | null,
  value: string,
  onChange: (next: string) => void,
  disabled = false,
): { botao: ReactNode; faixa: ReactNode; ocupado: boolean } {
  const navigate = useNavigate();
  const tokens = useMcpTokens();
  // o pedido roda no Claude do admin, com ferramentas de serviço: só admin vê o botão
  // (o roteiro-pedido recusa os outros com 403)
  const { isAdmin } = useIsAdmin();
  const ligado = Boolean(config) && isAdmin;
  // conector conectado = há um acesso ativo; enquanto carrega, não acusa falta
  const claude = tokens.isLoading || acessosDoClaude(tokens.data ?? []).length > 0;
  const pedir = usePedirRoteiro();
  const cancelar = useCancelarRoteiro();
  const responder = useResponderClaude();
  const ultimo = useUltimoPedidoDeRoteiro(
    ligado,
    config ? { tipo: config.tipo, alvo: config.alvo } : undefined,
  );
  const [descartado, setDescartado] = useState<string | null>(null);
  const [refsAbertas, setRefsAbertas] = useState(false);
  const [refs, setRefs] = useState("");
  // o texto no instante do clique: a entrega só substitui se ele não mudou
  const enviadoCom = useRef<string | null>(null);
  const [anterior, setAnterior] = useState<string | null>(null);
  const [usado, setUsado] = useState<string | null>(null);
  const [entregaGuardada, setEntregaGuardada] = useState<PedidoDeRoteiro | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onEntregaRef = useRef(config?.onEntrega);
  onEntregaRef.current = config?.onEntrega;

  const pedido = ultimo.data && ultimo.data.id !== descartado ? ultimo.data : null;

  // entregou: entra no campo se a pessoa não mexeu; senão espera a decisão dela
  useEffect(() => {
    if (!pedido || pedido.status !== "entregue" || !pedido.roteiro || usado === pedido.id) return;
    let jaUsado = false;
    try {
      jaUsado = localStorage.getItem(chaveUsada(pedido.id)) === "1";
    } catch {
      /* sem storage */
    }
    if (jaUsado) {
      setUsado(pedido.id);
      return;
    }
    const intocado = enviadoCom.current === null || enviadoCom.current === value || !value.trim();
    if (!intocado) {
      setEntregaGuardada(pedido);
      return;
    }
    setAnterior(value);
    onChangeRef.current(pedido.roteiro);
    onEntregaRef.current?.(pedido);
    setUsado(pedido.id);
    enviadoCom.current = null;
    try {
      localStorage.setItem(chaveUsada(pedido.id), "1");
    } catch {
      /* sem storage */
    }
  }, [pedido, usado, value]);

  if (!config) return { botao: null, faixa: null, ocupado: false };

  const aberto = pedido?.status === "aberto";
  const links = refs
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => /^https:\/\/\S+$/i.test(t));

  const enviar = () => {
    const texto = value.trim();
    if (!texto || pedir.isPending) return;
    if (!claude) {
      toast.error("Conecte o seu Claude em Ajustes, em Conectores, para ele escrever por você.");
      void navigate({ to: "/config", hash: "conectores-title" });
      return;
    }
    enviadoCom.current = value;
    setEntregaGuardada(null);
    setDescartado(null);
    pedir.mutate(
      {
        tipo: config.tipo,
        texto,
        contexto: { ...(config.contexto ?? {}), alvo: config.alvo },
        referencias: links,
      },
      {
        onSuccess: ({ acordou }) => {
          if (!acordou)
            toast.info("Pedido guardado. Abra o seu Claude e diga: “atenda os pedidos abertos”.");
        },
        onError: (err) => {
          if (err instanceof PedidoJaAbertoError) return; // a faixa mostra o pedido aberto
          toast.error(err.message);
        },
      },
    );
  };

  const usarEntrega = () => {
    if (!entregaGuardada?.roteiro) return;
    setAnterior(value);
    onChange(entregaGuardada.roteiro);
    onEntregaRef.current?.(entregaGuardada);
    setUsado(entregaGuardada.id);
    try {
      localStorage.setItem(chaveUsada(entregaGuardada.id), "1");
    } catch {
      /* sem storage */
    }
    setEntregaGuardada(null);
  };
  const manterMeu = () => {
    if (!entregaGuardada) return;
    setUsado(entregaGuardada.id);
    try {
      localStorage.setItem(chaveUsada(entregaGuardada.id), "1");
    } catch {
      /* sem storage */
    }
    setEntregaGuardada(null);
  };
  const pedirDeNovo = () => {
    setDescartado(pedido?.id ?? null);
    setEntregaGuardada(null);
  };

  const botao = (
    <>
      {!aberto ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={disabled || pedir.isPending || !value.trim()}
          onClick={enviar}
          data-testid="prompt-claude"
        >
          {pedir.isPending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <BrandIcon name="claude" />
          )}
          Escrever com o seu Claude
        </Button>
      ) : null}
      {config.referencias && !aberto ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          aria-pressed={refsAbertas}
          onClick={() => setRefsAbertas((v) => !v)}
          data-testid="prompt-referencia"
        >
          <Link2 aria-hidden="true" /> referência
        </Button>
      ) : null}
      {anterior !== null ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Voltar ao meu texto"
          title="Voltar ao meu texto"
          onClick={() => {
            onChange(anterior);
            setAnterior(null);
          }}
          data-testid="prompt-voltar"
        >
          <Undo2 aria-hidden="true" />
        </Button>
      ) : null}
      <span className="min-w-0 truncate pl-1 text-xs leading-4 text-[var(--via-text-soft)]">
        {claude ? "Pela sua assinatura, sem custo extra" : "Falta conectar o seu Claude"}
      </span>
    </>
  );

  let faixa: ReactNode = null;
  if (refsAbertas && !aberto) {
    faixa = (
      <div className="space-y-1">
        <Input
          value={refs}
          onChange={(e) => setRefs(e.target.value)}
          placeholder="Link de um vídeo parecido (opcional), um por espaço"
          aria-label="Links de referência"
          data-testid="prompt-referencias"
        />
      </div>
    );
  }
  if (aberto && pedido) {
    faixa =
      pedido.tipo === "roteiro" ? (
        <AndamentoDoRoteiro
          pedido={pedido}
          cancelando={cancelar.isPending}
          onCancelar={() =>
            cancelar.mutate(pedido.id, { onError: (err) => toast.error(err.message) })
          }
        />
      ) : (
        <FaixaCurta
          pedido={pedido}
          cancelando={cancelar.isPending}
          onCancelar={() =>
            cancelar.mutate(pedido.id, { onError: (err) => toast.error(err.message) })
          }
          enviando={responder.isPending}
          onResponder={(texto) =>
            responder.mutate(
              { pedido_id: pedido.id, texto },
              { onError: (err) => toast.error(err.message) },
            )
          }
        />
      );
  } else if (entregaGuardada) {
    faixa = (
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-2 border-l-2 border-[var(--via-navy)] pl-3 text-sm"
        data-testid="escrita-entregue-editada"
        aria-live="polite"
      >
        <span className="min-w-0 flex-1 text-[var(--via-text-primary)]">
          O seu Claude terminou. Você mexeu no texto enquanto esperava.
        </span>
        <Button variant="outline" size="sm" onClick={usarEntrega}>
          Usar o texto do Claude
        </Button>
        <Button variant="ghost" size="sm" onClick={manterMeu}>
          Manter o meu
        </Button>
      </div>
    );
  } else if (pedido?.status === "falhou") {
    faixa = (
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-2 border-l-2 border-[var(--via-navy)] pl-3 text-sm"
        data-testid="escrita-falhou"
        aria-live="polite"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-[var(--via-text-primary)]">
            O seu Claude não respondeu
          </span>
          {pedido.erro ? (
            <span className="block text-[var(--via-text-muted)]">{pedido.erro}</span>
          ) : null}
        </span>
        <Button variant="ghost" size="sm" onClick={pedirDeNovo}>
          Pedir de novo
        </Button>
      </div>
    );
  } else if (pedido?.status === "entregue" && usado === pedido.id && pedido.saida?.resumo_pt) {
    // instrução em inglês para o modelo: a pessoa confere em português
    faixa = (
      <p className="text-xs text-[var(--via-text-muted)]" data-testid="escrita-resumo">
        Em português: {pedido.saida.resumo_pt}
      </p>
    );
  }

  return { botao, faixa, ocupado: aberto || pedir.isPending };
}

/** Trilha curta dos tipos sem pesquisa: enviado → pegou → pronto, com a frase do Claude. */
function FaixaCurta({
  pedido,
  cancelando,
  onCancelar,
  enviando,
  onResponder,
}: {
  pedido: PedidoDeRoteiro;
  cancelando: boolean;
  onCancelar: () => void;
  enviando: boolean;
  onResponder: (texto: string) => void;
}) {
  const desde = pedido.andamento?.em ?? pedido.created_at;
  const idade = Date.now() - new Date(desde).getTime();
  const etapa = pedido.andamento?.etapa ?? "enviado";
  const semPegar = etapa === "enviado" && idade > DEMORA_MS;
  const parado = idade > PARADO_MS;
  const rotulo = pedido.aguardando_pessoa
    ? "precisa de você"
    : etapa === "enviado"
      ? "enviado"
      : etapa === "pegou"
        ? "pegou"
        : "escrevendo";
  return (
    <div
      className="space-y-3 border-l-2 border-[var(--via-navy)] pl-3 text-sm"
      data-testid="escrita-pendente"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        {pedido.aguardando_pessoa || parado ? null : (
          <Loader2
            className="mt-0.5 size-4 animate-spin text-[var(--via-text-muted)]"
            aria-hidden="true"
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-[var(--via-text-primary)]">
            Com o seu Claude · {rotulo}
          </span>
          <span className={cn("block text-[var(--via-text-muted)]")}>
            {parado
              ? "Sem resposta há mais de 15 minutos: parece parado. Cancele e peça de novo."
              : semPegar
                ? "Ainda não pegou. Continua valendo; pode sair da tela."
                : (pedido.andamento?.texto ?? "Pedido enviado ao seu Claude.")}{" "}
            · {haQuanto(desde)}
          </span>
        </span>
        <Button variant="ghost" size="sm" disabled={cancelando} onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
      {pedido.aguardando_pessoa || pedido.conversa.length ? (
        <ConversaClaude
          mensagens={pedido.conversa}
          aguardando={pedido.aguardando_pessoa}
          enviando={enviando}
          onEnviar={onResponder}
        />
      ) : null}
      {!parado && !pedido.aguardando_pessoa ? (
        <p className="text-xs text-[var(--via-text-muted)]">
          Pode sair desta tela: o pedido continua e o sino avisa. O campo segue editável.
        </p>
      ) : null}
    </div>
  );
}
