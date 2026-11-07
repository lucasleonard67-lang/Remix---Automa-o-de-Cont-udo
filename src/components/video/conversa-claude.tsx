import { SendHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Mensagem } from "@/hooks/use-roteiro-pedidos";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Conversa com o seu Claude dentro de um pedido (roteiro ou montagem): o
// campo de pergunta e resposta, como num chat. O Claude escreve quando precisa
// da pessoa (login, chave, cena ao vivo, decisão) e ela responde aqui; o pedido
// volta para a fila dele. Mensagens do Claude à esquerda, as da pessoa à
// direita; quando ele está esperando, a conversa fica em destaque.
// ---------------------------------------------------------------------------

const MENSAGEM_MAX = 2000;

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function ConversaClaude({
  mensagens,
  aguardando,
  enviando,
  onEnviar,
  placeholder = "Escreva para o seu Claude…",
}: {
  mensagens: Mensagem[];
  /** O Claude parou e espera a resposta da pessoa. */
  aguardando: boolean;
  enviando: boolean;
  onEnviar: (texto: string) => void;
  placeholder?: string;
}) {
  const [texto, setTexto] = useState("");
  const fim = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fim.current?.scrollIntoView({ block: "nearest" });
  }, [mensagens.length]);
  useEffect(() => {
    if (aguardando) campo.current?.focus();
  }, [aguardando]);

  const enviar = () => {
    const limpo = texto.trim();
    if (!limpo || enviando) return;
    onEnviar(limpo);
    setTexto("");
  };
  const teclou = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      enviar();
    }
  };

  return (
    <section
      aria-label="Conversa com o seu Claude"
      className={cn(
        "space-y-3",
        aguardando && "rounded-[var(--via-radius-lg)] bg-[var(--via-navy-04)] p-3",
      )}
      data-testid="conversa-claude"
    >
      {aguardando ? (
        <p className="text-sm font-medium text-[var(--via-text-primary)]">
          O seu Claude precisa de você
        </p>
      ) : null}
      {mensagens.length ? (
        <ol className="max-h-72 space-y-2 overflow-y-auto pr-1" aria-live="polite">
          {mensagens.map((m, i) => {
            const claude = m.de === "claude";
            return (
              <li key={i} className={cn("flex", claude ? "justify-start" : "justify-end")}>
                <div
                  className={cn(
                    "max-w-[85%] px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap",
                    claude
                      ? "rounded-[16px] rounded-bl-[4px] bg-[var(--via-navy-06)] text-[var(--via-text-primary)]"
                      : "rounded-[16px] rounded-br-[4px] bg-[var(--via-navy)] text-white",
                  )}
                >
                  {m.texto}
                  <span
                    className={cn(
                      "mt-1 block text-xs",
                      claude ? "text-[var(--via-text-muted)]" : "text-white/70",
                    )}
                  >
                    {claude ? "Seu Claude" : "Você"} · {hora(m.em)}
                  </span>
                </div>
              </li>
            );
          })}
          <div ref={fim} />
        </ol>
      ) : null}
      <div className="flex items-end gap-2">
        <Textarea
          ref={campo}
          rows={1}
          maxLength={MENSAGEM_MAX}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={teclou}
          placeholder={aguardando ? "Responda aqui…" : placeholder}
          aria-label="Mensagem para o seu Claude"
          className="min-h-9 resize-none"
        />
        <Button
          size="sm"
          variant={aguardando ? "default" : "outline"}
          disabled={!texto.trim() || enviando}
          onClick={enviar}
          aria-label="Enviar"
        >
          <SendHorizontal aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}
