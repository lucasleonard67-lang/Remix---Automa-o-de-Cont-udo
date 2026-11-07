import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";

import {
  ADMIN_ITEMS,
  NAV_ITEMS,
  activeChildTo,
  activeNavTo,
  navGroups,
} from "@/components/app-nav";
import { SubidoLogo } from "@/components/brand/subido-logo";
import { InboxBell } from "@/components/notifications/inbox-bell";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { useSession } from "@/hooks/use-session";
import { fetchIsAdmin } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export function AppSidebar() {
  const { user } = useSession();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();

  // Visibilidade de Ajustes: só admin; erro/tabela ausente → esconder.
  const { data: isAdmin = false } = useQuery({
    queryKey: ["roles", "is-admin", user?.id],
    queryFn: fetchIsAdmin,
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
  });

  const items = isAdmin ? [...NAV_ITEMS, ...ADMIN_ITEMS] : [...NAV_ITEMS];
  const activeTo = activeNavTo(pathname);
  const currentSearch = search as Record<string, unknown>;

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

  return (
    // Recolhida, a barra fica nos ícones: símbolo da marca no topo, itens com tooltip.
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="px-6 py-5 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-2">
        <Link
          to="/"
          className="flex flex-col gap-1.5"
          aria-label="Subido AI, Automação de Redes Sociais"
        >
          <img
            src="/brand/simbolo-ai.svg"
            alt="Subido AI"
            className="hidden h-5 w-auto group-data-[collapsible=icon]:block"
          />
          {/* logo vetorial do kit: passar o mouse dispara o "momento" das barras */}
          <span className="self-start group-data-[collapsible=icon]:hidden">
            <SubidoLogo height={24} animate="hover" title="subido AI" />
          </span>
          <span className="max-w-[13rem] text-balance text-[0.6875rem] font-medium uppercase leading-snug tracking-[var(--via-ls-mark)] text-[var(--via-text-muted)] group-data-[collapsible=icon]:hidden">
            Automação de Redes Sociais
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent className="gap-6 px-1 py-2">
        {navGroups(items).map((group) => (
          <SidebarGroup key={group.label} className="py-0">
            <p className="ds-group-label group-data-[collapsible=icon]:hidden">{group.label}</p>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {group.items.map((item) => {
                  const active = item.to === activeTo;
                  const activeChild = active ? activeChildTo(item, pathname, currentSearch) : null;
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        asChild
                        // o pai só acende quando a rota é dele mesmo; dentro de um
                        // subitem, acende o subitem
                        isActive={active && !activeChild}
                        tooltip={item.title}
                        className="ce-nav-item h-10 gap-3 rounded-[var(--via-radius-md)] px-3 text-sm font-medium hover:no-underline data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground data-[active=true]:hover:bg-sidebar-primary data-[active=true]:hover:text-sidebar-primary-foreground [&>svg]:size-[18px] [&>svg]:text-[var(--sidebar-icon)] data-[active=true]:[&>svg]:text-current"
                      >
                        <Link to={item.to}>
                          <item.icon aria-hidden="true" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                      {/* subitens visíveis quando a rota está dentro do pai */}
                      {active && item.children?.length ? (
                        <SidebarMenuSub aria-label={`Seções de ${item.title}`}>
                          {item.children.map((child) => (
                            <SidebarMenuSubItem
                              key={`${child.to}${JSON.stringify(child.search ?? {})}`}
                            >
                              <SidebarMenuSubButton
                                asChild
                                isActive={activeChild === child}
                                className="hover:no-underline data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground"
                              >
                                <Link to={child.to} search={child.search ?? {}}>
                                  <span>{child.title}</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      ) : null}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      {/* Rodapé do kit: e-mail em 12px e "Sair" como item; o sino das
          notificações fica ao lado do e-mail (sem barra de topo no desktop). */}
      <SidebarFooter className="gap-1 border-t border-sidebar-border p-3 group-data-[collapsible=icon]:px-2">
        <div className="flex items-center justify-between gap-1 px-3 group-data-[collapsible=icon]:hidden">
          <span
            className="min-w-0 flex-1 truncate text-xs text-[var(--sidebar-meta)]"
            title={user?.email ?? ""}
          >
            {user?.email ?? "…"}
          </span>
          <span className="hidden md:inline-flex">
            <InboxBell />
          </span>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={handleSignOut}
              tooltip="Sair"
              className="ce-nav-item h-10 gap-3 rounded-[var(--via-radius-md)] px-3 text-sm font-medium text-sidebar-foreground [&>svg]:size-[18px] [&>svg]:text-[var(--sidebar-icon)]"
            >
              <LogOut aria-hidden="true" />
              <span>Sair</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
