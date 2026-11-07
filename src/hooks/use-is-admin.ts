import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/hooks/use-session";
import { fetchIsAdmin } from "@/lib/auth";

/**
 * Role admin do usuário logado, como hook (cache compartilhado com a
 * `AppSidebar` — mesma queryKey). Erro ou tabela ausente → `false`
 * (recursos de admin ficam escondidos).
 */
export function useIsAdmin(): { isAdmin: boolean; isLoading: boolean } {
  const { user, isLoading: sessionLoading } = useSession();
  const query = useQuery({
    queryKey: ["roles", "is-admin", user?.id],
    queryFn: fetchIsAdmin,
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
  });
  return {
    isAdmin: query.data ?? false,
    isLoading: sessionLoading || (Boolean(user) && query.isPending),
  };
}
