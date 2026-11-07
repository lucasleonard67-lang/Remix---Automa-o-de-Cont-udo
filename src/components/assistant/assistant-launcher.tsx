import { useLocation } from "@tanstack/react-router";
import { MessageCircle, X } from "lucide-react";
import { useEffect, useState } from "react";

import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useAssistantState } from "@/hooks/use-assistant";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSession } from "@/hooks/use-session";
import { subscribeAssistantOpen } from "@/lib/assistant-open";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Botão flutuante do assistente (canto inferior direito de toda tela logada).
// Desktop: painel ancorado acima do botão. Mobile: Sheet de baixo.
// O ponto no botão = há peças esperando revisão (uma leitura por sessão).
// ---------------------------------------------------------------------------

export function AssistantLauncher() {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const { pathname } = useLocation();
  const { session, isLoading } = useSession();
  const { data: estado } = useAssistantState();

  const pendente = (estado?.pecas_em_revisao ?? 0) > 0;

  // Outras telas abrem o painel pelo canal (ex.: "Não achou?" da Ajuda).
  useEffect(() => subscribeAssistantOpen(() => setOpen(true)), []);

  // Esc fecha o painel ancorado (o Sheet já trata o próprio).
  useEffect(() => {
    if (!open || isMobile) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isMobile]);

  if (isLoading || !session) return null;

  const panel = (
    <AssistantPanel
      route={pathname}
      onClose={() => setOpen(false)}
      onNavigate={() => {
        if (isMobile) setOpen(false);
      }}
    />
  );

  return (
    <>
      {open && isMobile ? (
        <Sheet open onOpenChange={setOpen}>
          <SheetContent side="bottom" className="h-[85vh] p-0">
            <SheetTitle className="sr-only">Assistente</SheetTitle>
            {panel}
          </SheetContent>
        </Sheet>
      ) : null}

      {open && !isMobile ? (
        <section
          aria-label="Assistente"
          className="ce-assist-panel fixed bottom-[92px] right-6 z-30 flex h-[min(620px,calc(100vh-120px))] w-[380px] flex-col overflow-hidden rounded-[var(--via-radius-lg)]"
        >
          {panel}
        </section>
      ) : null}

      <Button
        type="button"
        size="icon"
        aria-label={open ? "Fechar assistente" : "Assistente"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn("ce-fab fixed bottom-6 right-6 z-30 h-14 w-14 rounded-full [&_svg]:size-6")}
      >
        {open ? <X aria-hidden="true" /> : <MessageCircle aria-hidden="true" />}
        {pendente && !open ? (
          <span
            aria-hidden="true"
            className="ce-check-in absolute right-1.5 top-1.5 size-2 rounded-full border border-[var(--via-navy)] bg-white"
          />
        ) : null}
      </Button>
    </>
  );
}
