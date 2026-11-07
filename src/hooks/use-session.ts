import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

interface UseSessionResult {
  session: Session | null;
  user: Session["user"] | null;
  isLoading: boolean;
}

/**
 * Sessão Supabase reativa: estado inicial via `getSession()` +
 * atualizações via `onAuthStateChange` (login, logout, refresh de token).
 */
export function useSession(): UseSessionResult {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Listener primeiro para não perder eventos entre o getSession e o subscribe.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setIsLoading(false);
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return { session, user: session?.user ?? null, isLoading };
}
