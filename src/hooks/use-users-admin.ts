import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { getFunctionErrorMessage } from "@/lib/edge-functions";

// ---------------------------------------------------------------------------
// Usuários da instância (/config → aba Usuários).
// `profiles` é legível por qualquer autenticado; `user_roles` só pelo dono ou
// por admin (RLS de 202607290003_identity.sql). O e-mail vive em auth.users e
// NÃO é exposto ao client — a lista mostra nome, papel e data. O admin troca o
// papel direto em user_roles (RLS de admin; o gatilho do banco impede rebaixar
// o último admin — supabase/sql/papeis-de-usuario.sql).
// ---------------------------------------------------------------------------

export const APP_ROLES = ["admin", "user"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const APP_ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrador",
  user: "Usuário",
};

export interface Member {
  userId: string;
  displayName: string | null;
  roles: AppRole[];
  createdAt: string;
}

interface ProfileRow {
  user_id: string;
  display_name: string | null;
  created_at: string;
}

interface UserRoleRow {
  user_id: string;
  role: AppRole;
}

/** Perfis + papéis, mais antigo primeiro (o primeiro usuário é o admin fundador). */
export function useMembers() {
  return useQuery({
    queryKey: ["members"],
    queryFn: async (): Promise<Member[]> => {
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("user_id, display_name, created_at")
        .order("created_at", { ascending: true });
      if (profilesError) throw new Error(profilesError.message);

      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id, role");
      if (rolesError) throw new Error(rolesError.message);

      const rolesByUser = new Map<string, AppRole[]>();
      for (const row of (roles ?? []) as UserRoleRow[]) {
        const list = rolesByUser.get(row.user_id) ?? [];
        list.push(row.role);
        rolesByUser.set(row.user_id, list);
      }

      return ((profiles ?? []) as ProfileRow[]).map((profile) => ({
        userId: profile.user_id,
        displayName: profile.display_name,
        roles: rolesByUser.get(profile.user_id) ?? [],
        createdAt: profile.created_at,
      }));
    },
  });
}

export interface InviteUserInput {
  email: string;
  role: AppRole;
}

const NOT_DEPLOYED_MESSAGE =
  "O envio de convites ainda não está ativo nesta instância. Peça a quem mantém o sistema " +
  "para publicar o back-end e tente de novo.";

/** `invite-user {email, role}` → `{invited, email}` (07 §3.7; admin only). */
export function useInviteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: InviteUserInput): Promise<void> => {
      const { error } = await supabase.functions.invoke("invite-user", {
        body: { email: input.email.trim(), role: input.role },
      });
      if (error) {
        const status = (error as { context?: { status?: number } } | null)?.context?.status;
        throw new Error(
          status === 404
            ? NOT_DEPLOYED_MESSAGE
            : await getFunctionErrorMessage(
                error,
                "Não foi possível enviar o convite. Tente de novo.",
              ),
        );
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["members"] });
    },
  });
}

/** Troca o papel de uma pessoa: apaga os papéis que ela tem e grava o novo (admin only, RLS). */
export function useSetRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; role: AppRole }): Promise<void> => {
      const { data: atuais, error: readError } = await supabase
        .from("user_roles")
        .select("id, role")
        .eq("user_id", input.userId);
      if (readError) throw new Error(readError.message);
      const linhas = (atuais ?? []) as { id: string; role: AppRole }[];
      const existente = linhas.find((r) => r.role === input.role);
      // já tem o papel: só tira os outros; senão troca a primeira linha (o gatilho
      // do banco recusa rebaixar o último admin) e apaga o resto
      if (!existente) {
        const alvo = linhas[0];
        if (alvo) {
          const { error } = await supabase
            .from("user_roles")
            .update({ role: input.role })
            .eq("id", alvo.id);
          if (error) throw new Error(humanizeRoleError(error.message));
        } else {
          const { error } = await supabase
            .from("user_roles")
            .insert({ user_id: input.userId, role: input.role });
          if (error) throw new Error(humanizeRoleError(error.message));
        }
      }
      const sobras = linhas.filter(
        (r) => r.role !== input.role && r.id !== (existente ? null : linhas[0]?.id),
      );
      for (const r of sobras) {
        const { error } = await supabase.from("user_roles").delete().eq("id", r.id);
        if (error) throw new Error(humanizeRoleError(error.message));
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["members"] });
    },
  });
}

function humanizeRoleError(message: string): string {
  if (/ao menos um administrador/.test(message))
    return "A instância precisa de ao menos um administrador.";
  if (/row-level security|permission denied/i.test(message))
    return "Só administradores trocam papéis.";
  return message;
}
