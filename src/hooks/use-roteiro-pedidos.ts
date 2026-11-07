import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { supabase } from "@/integrations/supabase/client";
import { getFunctionErrorMessage } from "@/lib/edge-functions";
import type { ContextoDeEscrita, TipoDeEscrita } from "@/lib/receitas-de-video";

// ---------------------------------------------------------------------------
// Escrita pelo Claude da pessoa (tela Vídeos). Ela escreve do jeito dela num
// campo e pede "Escrever com o seu Claude"; o pedido vai para `roteiro_pedidos`
// (edge roteiro-pedido) com o tipo e o contexto (modelo, limite, duração), e a
// rotina do Claude dela entrega pelo conector no formato que o modelo exige.
// Tipo `roteiro` traz também o plano de produção. A tela acompanha por
// Realtime. Nada aqui chama LLM.
// ---------------------------------------------------------------------------

export interface PassoDoRoteiro {
  id: string;
  /** conceito = apresentador em tela cheia; tela = tela gravada com o apresentador em miniatura */
  tipo: "conceito" | "tela";
  fala: string;
  acoes?: { em: number; acao: string; alvo: string; valor?: string }[];
  /** só humano opera (login, chave, autorizar): a pessoa grava e anexa */
  ao_vivo?: boolean;
  legenda?: { termo: string; texto: string };
}

export interface MapaDeBastidor {
  ferramentas: {
    nome: string;
    para_que: string;
    onde_fica_a_chave?: string;
    modo_teste?: string;
  }[];
  intervencoes: { quando: string; o_que: string; minutos?: number }[];
  dados_de_teste: string[];
}

export interface PlanoDeProducao {
  resumo: string;
  formato: "9:16" | "16:9" | "1:1";
  passos: PassoDoRoteiro[];
  gravacoes: { o_que: string; como: string }[];
  bastidor: MapaDeBastidor;
  efeitos_globais: string[];
  modelos_extras: string[];
  fontes: { title: string; url: string }[];
}

export const ETAPAS_DO_ROTEIRO = [
  "enviado",
  "pegou",
  "pesquisa",
  "referencias",
  "roteiro",
  "plano",
  "entregue",
] as const;
export type EtapaDoRoteiro = (typeof ETAPAS_DO_ROTEIRO)[number];

export interface Andamento {
  etapa: EtapaDoRoteiro;
  texto: string;
  em: string;
}

export interface Mensagem {
  de: "claude" | "pessoa";
  texto: string;
  em: string;
}

export interface PedidoDeRoteiro {
  id: string;
  /** O que o Claude escreve; instância antiga sem a coluna = roteiro. */
  tipo: TipoDeEscrita;
  contexto: ContextoDeEscrita;
  andamento: Andamento | null;
  conversa: Mensagem[];
  /** O Claude perguntou e parou: espera a resposta da pessoa. */
  aguardando_pessoa: boolean;
  status: "aberto" | "entregue" | "cancelado" | "falhou";
  /** O que a pessoa escreveu ao pedir. */
  briefing: string;
  referencias: { url: string; nota?: string }[];
  /** O texto entregue (roteiro da fala, ideia, fala nova, instrução). */
  roteiro: string | null;
  plano: PlanoDeProducao | null;
  /** Entrega estruturada dos tipos curtos (briefing das cenas, resumo em português). */
  saida: Record<string, string> | null;
  erro: string | null;
  created_at: string;
}

/** Vale um dia: o pedido de ontem não volta a preencher a tela. */
const JANELA_MS = 24 * 60 * 60_000;

const COLUNAS_NOVAS =
  "id, tipo, contexto, saida, status, briefing, referencias, roteiro, plano, erro, andamento, conversa, aguardando_pessoa, created_at";
const COLUNAS_ANTIGAS =
  "id, status, briefing, referencias, roteiro, plano, erro, andamento, conversa, aguardando_pessoa, created_at";

export interface FiltroDePedido {
  tipo: TipoDeEscrita;
  /** O campo da tela (contexto.alvo). */
  alvo: string;
}

/**
 * O pedido mais recente da pessoa (aberto, entregue ou falhou), acompanhado por
 * Realtime. Com `filtro`, só o pedido daquele tipo naquele campo.
 */
export function useUltimoPedidoDeRoteiro(enabled = true, filtro?: FiltroDePedido) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel("roteiro-pedidos")
      .on("postgres_changes", { event: "*", schema: "public", table: "roteiro_pedidos" }, () =>
        queryClient.invalidateQueries({ queryKey: ["roteiro-pedidos"] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, enabled]);

  return useQuery({
    queryKey: ["roteiro-pedidos", "ultimo", filtro?.tipo ?? "*", filtro?.alvo ?? "*"],
    enabled,
    // sem Realtime (publicação vazia num Remix) a tela congelaria com o pedido aberto
    refetchInterval: (q) => (q.state.data?.status === "aberto" ? 8_000 : false),
    queryFn: async (): Promise<PedidoDeRoteiro | null> => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return null;
      const desde = new Date(Date.now() - JANELA_MS).toISOString();
      const consulta = (colunas: string, comFiltro: boolean) => {
        // `tipo`/`contexto` ainda fora dos types gerados (o Lovable os regenera depois do SQL)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q = (supabase as any)
          .from("roteiro_pedidos")
          .select(colunas)
          .eq("created_by", uid)
          .in("status", ["aberto", "entregue", "falhou"])
          .gte("created_at", desde);
        if (comFiltro && filtro) q = q.eq("tipo", filtro.tipo).eq("contexto->>alvo", filtro.alvo);
        return q.order("created_at", { ascending: false }).limit(1).maybeSingle();
      };
      let { data, error } = await consulta(COLUNAS_NOVAS, true);
      // instância sem as colunas novas (SQL roteiro-pedidos.sql ainda não rodou)
      if (error && /tipo|contexto|saida/.test(error.message)) {
        if (filtro && filtro.tipo !== "roteiro") return null;
        ({ data, error } = await consulta(COLUNAS_ANTIGAS, false));
      }
      if (error) throw new Error(error.message);
      if (!data) return null;
      const linha = data as unknown as Partial<PedidoDeRoteiro> & { id: string };
      return {
        ...(linha as PedidoDeRoteiro),
        tipo: linha.tipo ?? "roteiro",
        contexto: linha.contexto ?? {},
        saida: linha.saida ?? null,
        conversa: linha.conversa ?? [],
      };
    },
  });
}

export interface PedidoDeRoteiroInput {
  tipo?: TipoDeEscrita;
  /** O que a pessoa escreveu (vai como está; o Claude transforma). */
  texto: string;
  contexto?: ContextoDeEscrita;
  referencias?: string[];
}

export class PedidoJaAbertoError extends Error {
  constructor(readonly pedidoId: string | null) {
    super("O seu Claude já está escrevendo este campo.");
    this.name = "PedidoJaAbertoError";
  }
}

/** Pede a escrita ao Claude da pessoa. 409 = já há um pedido aberto neste campo. */
export function usePedirRoteiro() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: PedidoDeRoteiroInput,
    ): Promise<{ pedido_id: string; acordou: boolean }> => {
      const { data, error } = await supabase.functions.invoke("roteiro-pedido", {
        body: { ...input, briefing: input.texto },
      });
      if (error) {
        const context = (error as { context?: Response }).context;
        if (context?.status === 409) {
          const payload = (await context.json().catch(() => null)) as {
            error?: { details?: { pedido_id?: string | null } };
          } | null;
          throw new PedidoJaAbertoError(payload?.error?.details?.pedido_id ?? null);
        }
        throw new Error(await getFunctionErrorMessage(error, "Não deu para pedir ao seu Claude."));
      }
      return data as { pedido_id: string; acordou: boolean };
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["roteiro-pedidos"] }),
  });
}

export function useCancelarRoteiro() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (pedidoId: string): Promise<void> => {
      const { error } = await supabase.functions.invoke("roteiro-pedido", {
        body: { action: "cancelar", pedido_id: pedidoId },
      });
      if (error) throw new Error(await getFunctionErrorMessage(error, "Não deu para cancelar."));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["roteiro-pedidos"] }),
  });
}

/** Resposta da pessoa ao seu Claude, dentro do pedido de roteiro (pedido_id) ou da montagem (edit_id). */
export function useResponderClaude() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      pedido_id?: string;
      edit_id?: string;
      texto: string;
    }): Promise<{ ok: boolean; acordou: boolean }> => {
      const { data, error } = await supabase.functions.invoke("roteiro-pedido", {
        body: { action: "responder", ...input },
      });
      if (error) throw new Error(await getFunctionErrorMessage(error, "Não deu para enviar."));
      return data as { ok: boolean; acordou: boolean };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["roteiro-pedidos"] });
      void queryClient.invalidateQueries({ queryKey: ["video-edit"] });
    },
  });
}
