import {
  createFileRoute,
  Outlet,
  redirect,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect } from "react";

import { sectionTitle } from "@/components/app-nav";
import { AppSidebar } from "@/components/app-sidebar";
import { AssistantLauncher } from "@/components/assistant/assistant-launcher";
import { DriveGateHost } from "@/components/google-drive-integration";
import { IntegrationModalHost } from "@/components/integration-grid";
import { InboxBell } from "@/components/notifications/inbox-bell";
import { TaskWatcher } from "@/components/task-watcher";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { fetchOnboardingProgress } from "@/hooks/use-onboarding";
import { useSession } from "@/hooks/use-session";
import { fetchIsAdmin, requireSession } from "@/lib/auth";

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ location }) => {
    const session = await requireSession(location.href);

    // Guard do onboarding: só o admin da instância é levado ao wizard, e só
    // enquanto a configuração mínima (voz + bandeira + guardrails + contexto)
    // não existe. Com mínimo viável, o app libera e o dashboard mostra o
    // banner de retomada. Usuário comum nunca é redirecionado.
    // As duas leituras vão em paralelo para não somar latência na navegação.
    const [isAdmin, onboarding] = await Promise.all([fetchIsAdmin(), fetchOnboardingProgress()]);
    // `onboarding.unknown` = a leitura falhou: fail-open explícito, o app abre.
    // Redirecionar aqui jogaria um admin com instância JÁ configurada de volta
    // ao wizard por causa de uma falha transitória de rede.
    if (isAdmin && !onboarding.unknown && !onboarding.completed && !onboarding.minimum_viable) {
      throw redirect({ to: "/onboarding" });
    }

    return { session };
  },
  component: AppLayout,
});

function AppLayout() {
  const { session, isLoading } = useSession();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();

  // Reforço client-side do guard: sessão expirada/logout em outra aba → /login.
  useEffect(() => {
    if (!isLoading && !session) {
      navigate({ to: "/login" });
    }
  }, [session, isLoading, navigate]);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="via-app-bg min-w-0">
        {/* Sem barra de topo no desktop: o cabeçalho da tela é o topo. A altura
            vem de `--via-app-header` (tokens.css), a MESMA que os painéis grudados
            usam; no desktop ela vale 0. */}
        <header className="sticky top-0 z-20 flex h-[var(--via-app-header)] shrink-0 items-center gap-2 border-b border-sidebar-border bg-sidebar px-4 md:hidden">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          {/* o logo já está na lateral: aqui vai onde o usuário está */}
          <span className="text-sm font-medium tracking-[-0.01em] text-[var(--via-text-primary)]">
            {sectionTitle(pathname, search as Record<string, unknown>)}
          </span>
          <div className="ml-auto">
            <InboxBell />
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-x-clip">
          {/* pb-28: o fim da página passa por cima do botão do assistente (56px + 24px) */}
          <div className="mx-auto w-full min-w-0 max-w-6xl px-4 pt-6 pb-28 sm:px-6 sm:pt-8 md:px-10 md:pt-10">
            <Outlet />
          </div>
        </main>
        <AssistantLauncher />
        <IntegrationModalHost />
        <DriveGateHost />
        <TaskWatcher />
      </SidebarInset>
    </SidebarProvider>
  );
}
