import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Copy, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { BrandIcon } from "@/components/brand-icon";
import { Button } from "@/components/ui/button";
import { SuccessCheck } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MCP_URL,
  rememberAppOrigin,
  useMcpTokens,
  useRevokeMcpToken,
} from "@/hooks/use-mcp-tokens";
import { connectorState, type ConnectorState } from "@/lib/mcp-connector-state";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Conectores: o Claude da sua conta dentro do Content Engine. Sem caixa em volta:
// o logo no poço, o estado ao lado e os acessos numa lista com filetes.
//
// ESCOPO DECIDIDO, e dito na tela: o modelo lê, cria rascunhos e edita vídeos.
// Aprovar, agendar e publicar continuam só aqui dentro.
//
// O token é gerado no navegador; o banco guarda só o hash. Ele aparece uma vez.
// ---------------------------------------------------------------------------

const CONECTORES_DO_CLAUDE = "https://claude.ai/settings/connectors";

const ABILITIES = ["Ler a marca", "Criar peças", "Buscar no acervo", "Editar vídeos"];

const STATE_LABEL: Record<ConnectorState, string> = {
  off: "Não conectado",
  waiting: "Aguardando instalação",
  on: "Conectado",
  live: "Conectado agora",
};

const quando = (date: Date) => formatDistanceToNowStrict(date, { locale: ptBR, addSuffix: true });

export function McpConnectorCard() {
  const tokens = useMcpTokens();
  const revogar = useRevokeMcpToken();
  const [copiado, setCopiado] = useState<string | null>(null);

  useEffect(rememberAppOrigin, []);

  const lista = tokens.data ?? [];
  const { state, lastUsed } = connectorState(lista);
  const conectado = state === "on" || state === "live";

  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(texto);
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      toast.error("Não foi possível copiar. Selecione o texto e copie manualmente.");
    }
  };

  const conectarNoClaude = async () => {
    await copiar(MCP_URL);
    window.open(CONECTORES_DO_CLAUDE, "_blank", "noopener");
  };

  return (
    <section className="space-y-5" aria-labelledby="conectores-title" data-testid="mcp-card">
      <div className="flex flex-wrap items-center gap-4">
        <span className="relative inline-flex size-14 shrink-0 items-center justify-center rounded-[var(--via-radius-md)] bg-[var(--via-navy-04)]">
          <BrandIcon name="claude" label="Claude" className="size-8" />
          {conectado ? (
            <span
              className="absolute -bottom-1 -right-1 size-3.5 rounded-full border-2 border-white bg-[var(--via-success)]"
              aria-hidden="true"
            />
          ) : null}
        </span>

        <div className="min-w-0 flex-1 basis-[14rem] space-y-0.5">
          <h2
            id="conectores-title"
            className="text-lg font-medium tracking-[-0.02em] text-[var(--via-text-primary)]"
          >
            Claude · conector personalizado
          </h2>
          <p className="text-sm text-[var(--via-text-muted)]" data-testid="mcp-state">
            {tokens.isLoading ? "Conferindo…" : STATE_LABEL[state]}
            {lastUsed ? ` · usado ${quando(lastUsed)}` : ""}
          </p>
        </div>
      </div>

      <p className="max-w-2xl text-sm text-[var(--via-text-body)]">
        Crie e edite qualquer material e vídeo com a sua assinatura do Claude, sem custo de API.
        Aprovar e publicar continuam só por aqui.
      </p>

      <div className="space-y-2">
        <Button onClick={() => void conectarNoClaude()}>
          <BrandIcon name="claude" className="size-4" />
          Conectar ao Claude
        </Button>
        <p className="text-sm text-[var(--via-text-body)]">
          Abre os conectores do Claude com o endereço copiado. Clique em adicionar conector
          personalizado, cole e autorize.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 basis-[16rem] break-all rounded-[var(--via-radius-sm)] bg-[var(--via-navy-04)] p-2.5 font-mono text-xs text-[var(--via-text-body)]">
            {MCP_URL}
          </code>
          <Button size="sm" variant="outline" onClick={() => void copiar(MCP_URL)}>
            {copiado === MCP_URL ? <SuccessCheck /> : <Copy aria-hidden="true" />}
            {copiado === MCP_URL ? "Copiado" : "Copiar endereço"}
          </Button>
        </div>
        <p className="text-xs text-[var(--via-text-muted)]">
          O Claude abre a tela de autorização. Sem colar senha nenhuma.
        </p>
      </div>

      <ul className="flex flex-wrap gap-1.5" aria-label="O que o Claude pode fazer">
        {ABILITIES.map((ability) => (
          <li key={ability} className="via-meta-chip">
            {ability}
          </li>
        ))}
      </ul>

      {tokens.isLoading ? (
        <Skeleton className="h-12 w-full" />
      ) : lista.length ? (
        <ul className="divide-y divide-[var(--via-border-soft)]" aria-label="Acessos ativos">
          {lista.map((token) => (
            <li key={token.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="min-w-0 break-words text-sm text-[var(--via-text-primary)]">
                {token.name}
              </span>
              <span className="font-mono text-xs text-[var(--via-text-muted)]">
                ····{token.hint}
              </span>
              <span
                className={cn(
                  "text-xs text-[var(--via-text-muted)]",
                  !token.last_used_at && "italic",
                )}
              >
                {token.last_used_at
                  ? `usado ${quando(new Date(token.last_used_at))}`
                  : "ainda não usado"}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-destructive"
                onClick={() => {
                  if (
                    !window.confirm(
                      `Revogar o acesso “${token.name}”? O Claude conectado com ele para de funcionar.`,
                    )
                  )
                    return;
                  revogar.mutate(token.id, {
                    onSuccess: () => toast.success("Acesso revogado"),
                    onError: (error) =>
                      toast.error("Não foi possível revogar", { description: error.message }),
                  });
                }}
                aria-label={`Revogar acesso ${token.name}`}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
