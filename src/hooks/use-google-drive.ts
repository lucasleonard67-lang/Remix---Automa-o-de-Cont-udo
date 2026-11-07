import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { getFunctionError } from "@/lib/edge-functions";

// ---------------------------------------------------------------------------
// Google Drive: o OAuth inteiro roda na edge `google-drive`. O token nunca chega
// ao client; o front só sabe se está configurado, conectado e quanto economizou.
// ---------------------------------------------------------------------------

export interface DriveStatus {
  configured: boolean;
  connected: boolean;
  broken: boolean;
  required: boolean;
  /** só admin escolhe a conta que recebe os materiais */
  can_connect: boolean;
  email?: string | null;
  saved_bytes?: number;
  drive_files?: number;
  only_in_drive?: number;
  waiting_files?: number;
  redirect_uri?: string;
  purge_enabled?: boolean;
  last_run?: DriveLastRun | null;
}

export interface DriveLastRun {
  at: string;
  uploaded?: number;
  purged?: number;
  errors?: number;
  skipped?: string;
  error?: string | null;
  storage_blind?: boolean;
}

async function invokeDrive<T>(action: string, extra?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("google-drive", {
    body: { action, ...extra },
  });
  if (error) {
    const failure = await getFunctionError(error, "Não deu para falar com o Google Drive.");
    throw new Error(failure.message);
  }
  return data as T;
}

export function useDriveStatus(options: { poll?: boolean } = {}) {
  const { session } = useSession();
  return useQuery({
    queryKey: ["google-drive", "status"],
    enabled: Boolean(session),
    retry: false,
    staleTime: 30 * 1000,
    refetchInterval: options.poll ? 3000 : false,
    queryFn: () => invokeDrive<DriveStatus>("status"),
  });
}

/** A URL volta para quem abre a aba: o bloqueador de pop-up exige o clique da pessoa. */
export function useDriveConnect() {
  return useMutation({
    mutationFn: () =>
      invokeDrive<{ authorize_url: string }>("start", { return_origin: window.location.origin }),
  });
}

export function useDriveDisconnect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => invokeDrive<{ connected: false; revoked: boolean }>("disconnect"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["google-drive"] }),
  });
}
