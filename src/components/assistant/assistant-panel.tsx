import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, ArrowUp, RotateCcw } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { BrandIcon } from "@/components/brand-icon";
import { openIntegration } from "@/lib/integration-modal";
import { INTEGRATION_BY_ID, type IntegrationId } from "@/lib/integrations";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { type AssistantAction, type AssistantMessage, useAssistant } from "@/hooks/use-assistant";
import { brandFromLabel } from "@/lib/brands";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Painel de conversa do assistente. Vive ancorado no canto (desktop) ou num
// Sheet de baixo (mobile) — quem decide é o launcher; aqui é só o conteúdo.
// Três zonas: cabeçalho, fluxo de mensagens, composer. Ações vêm como botões
// abaixo da resposta e só acontecem no clique.
// ---------------------------------------------------------------------------

const SUGESTOES = [
  "O que falta para publicar?",
  "Monte 3 posts para esta semana",
  "Por que minha geração falhou?",
];

interface AssistantPanelProps {
  route: string;
  /** Chamado depois de uma ação que navega (o launcher decide se fecha). */
  onNavigate?: () => void;
  onClose?: () => void;
}

export function AssistantPanel({ route, onNavigate, onClose }: AssistantPanelProps) {
  const navigate = useNavigate();
  const { messages, send, reset, isPending, error } = useAssistant(route);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Rola para a última mensagem a cada resposta ou envio.
  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, isPending]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!draft.trim() || isPending) return;
    send(draft);
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
    if (event.key === "Escape") onClose?.();
  }

  function run(action: AssistantAction) {
    if (action.type === "open_integration" && action.id in INTEGRATION_BY_ID) {
      openIntegration(action.id as IntegrationId);
      onNavigate?.();
      return;
    }
    navigate({ href: hrefOf(action) });
    onNavigate?.();
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(e) => e.key === "Escape" && onClose?.()}
    >
      <style>{DOTS_CSS}</style>

      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--via-border-soft)] px-4 py-3">
        <div className="min-w-0">
          <p className="via-eyebrow">Automação de Redes Sociais</p>
          <h2 className="text-sm font-medium text-[var(--via-text-primary)]">Assistente</h2>
        </div>
        {messages.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={reset}
            className="text-[var(--via-text-muted)]"
          >
            <RotateCcw aria-hidden="true" />
            Limpar
          </Button>
        ) : null}
      </header>

      <div
        ref={streamRef}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4"
        aria-live="polite"
        aria-busy={isPending}
      >
        {messages.length === 0 ? (
          <Welcome onPick={(texto) => send(texto)} disabled={isPending} />
        ) : (
          messages.map((m, i) => <Message key={m.id} message={m} index={i} onAction={run} />)
        )}

        {isPending ? (
          <div className="flex items-center gap-1.5 pl-0.5" role="status" aria-label="Pensando">
            <span className="ce-assist-dot" />
            <span className="ce-assist-dot" />
            <span className="ce-assist-dot" />
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-[var(--via-danger)]" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <form onSubmit={submit} className="shrink-0 border-t border-[var(--via-border-soft)] p-3">
        <div className="flex items-end gap-2">
          <Textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={2000}
            placeholder="Pergunte ou peça uma peça…"
            aria-label="Mensagem para o assistente"
            className="max-h-32 min-h-10 resize-none py-2.5 text-sm"
          />
          <Button
            type="submit"
            size="icon"
            aria-label="Enviar"
            disabled={!draft.trim() || isPending}
            className="h-10 w-10 shrink-0"
          >
            <ArrowUp aria-hidden="true" />
          </Button>
        </div>
      </form>
    </div>
  );
}

// ── Boas-vindas: uma linha e três chips ──────────────────────────────────────

function Welcome({ onPick, disabled }: { onPick: (texto: string) => void; disabled: boolean }) {
  return (
    <div className="space-y-3 pt-1">
      <p className="text-sm text-[var(--via-text-body)]">
        Tire dúvidas, vá direto à tela certa ou peça peças. Nada é publicado sem você.
      </p>
      <div className="flex flex-wrap gap-2">
        {SUGESTOES.map((texto, i) => (
          <Button
            key={texto}
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onPick(texto)}
            className="animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-200 [animation-timing-function:var(--via-ease-out)]"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            {texto}
          </Button>
        ))}
      </div>
    </div>
  );
}

// ── Mensagem ────────────────────────────────────────────────────────────────

function Message({
  message,
  index,
  onAction,
}: {
  message: AssistantMessage;
  index: number;
  onAction: (a: AssistantAction) => void;
}) {
  const user = message.role === "user";
  return (
    <div
      className={cn(
        "animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-200 [animation-timing-function:var(--via-ease-out)]",
        user ? "flex justify-end" : "space-y-3",
      )}
      style={{ animationDelay: `${Math.min(index, 4) * 60}ms` }}
    >
      {user ? (
        <p className="max-w-[85%] whitespace-pre-wrap rounded-[var(--via-radius-md)] rounded-br-[4px] bg-[var(--via-navy)] px-3.5 py-2 text-sm leading-relaxed text-white">
          {message.content}
        </p>
      ) : (
        <>
          <div className="text-sm leading-relaxed text-[var(--via-text-body)]">
            {renderLight(message.content)}
          </div>
          {message.actions?.length ? (
            <div className="flex flex-wrap gap-2">
              {message.actions.map((a, i) => (
                <Button
                  key={`${a.type}-${i}`}
                  type="button"
                  variant={i === 0 ? "default" : "outline"}
                  size="sm"
                  onClick={() => onAction(a)}
                >
                  {actionBrand(a) ? <BrandIcon name={actionBrand(a)!} /> : null}
                  {a.label}
                  <ArrowRight aria-hidden="true" />
                </Button>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Marca da ação ("Conectar Zernio", integração zernio) para o logo no botão. */
function actionBrand(action: AssistantAction) {
  return (
    brandFromLabel(action.label) ??
    (action.type === "open_integration" ? brandFromLabel(action.id) : undefined)
  );
}

// ── Ações → URL ──────────────────────────────────────────────────────────────

function hrefOf(action: AssistantAction): string {
  switch (action.type) {
    case "navigate":
      return withSearch(action.to, action.search);
    case "create":
      return action.kind === "video"
        ? withSearch("/videos/novo", { brief: action.brief })
        : withSearch("/", { brief: action.brief, kind: action.kind });
    case "open_integration":
      // As integrações ficam na aba Integrações de Config; a aba não abre por URL.
      return withSearch("/config", { integracao: action.id });
  }
}

function withSearch(path: string, search?: Record<string, string>): string {
  const params = new URLSearchParams(search ?? {});
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

// ── Markdown leve (negrito e listas) — sem HTML cru ──────────────────────────

function renderLight(text: string): ReactNode {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => {
    if (list.length) {
      out.push(
        <ul key={`l${out.length}`} className="list-disc space-y-1 pl-5">
          {list}
        </ul>,
      );
      list = [];
    }
  };
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) {
      flush();
      return;
    }
    const item = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (item) {
      list.push(<li key={i}>{inline(item[1])}</li>);
      return;
    }
    flush();
    out.push(
      <p key={i} className={i > 0 ? "mt-2" : undefined}>
        {inline(line)}
      </p>,
    );
  });
  flush();
  return out;
}

function inline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={i} className="font-medium text-[var(--via-text-primary)]">
        {p.slice(2, -2)}
      </strong>
    ) : (
      p
    ),
  );
}

// ── "Pensando": três pontos em opacity, passo de 180ms ───────────────────────

const DOTS_CSS = `
.ce-assist-dot{width:6px;height:6px;border-radius:999px;background:var(--via-text-muted);opacity:.3;animation:ce-assist-blink 540ms var(--via-ease) infinite}
.ce-assist-dot:nth-child(2){animation-delay:180ms}
.ce-assist-dot:nth-child(3){animation-delay:360ms}
@keyframes ce-assist-blink{0%,100%{opacity:.3}50%{opacity:1}}
@media (prefers-reduced-motion: reduce){.ce-assist-dot{animation:none;opacity:.6}}
`;
