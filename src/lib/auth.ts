import { redirect } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";

/** Destino seguro pós-login: só paths internos (nunca URL absoluta de fora). */
export function safeRedirectPath(raw: string | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

/**
 * Guard 1 — sessão. Sem sessão → /login (preservando o deep link em ?redirect=).
 * Usado no `beforeLoad` do layout `_app` (e de `/onboarding`).
 *
 * No hard reload o supabase-js pode responder null enquanto ainda restaura/
 * refresca o token do localStorage — sem o retry, F5 em qualquer página
 * jogava usuário logado pro /login (e o deep link se perdia).
 */
export async function requireSession(from?: string) {
  let { data } = await supabase.auth.getSession();
  if (!data.session && typeof window !== "undefined") {
    // hard reload no client: dá tempo do supabase-js restaurar/refrescar o token
    await new Promise((resolve) => setTimeout(resolve, 300));
    ({ data } = await supabase.auth.getSession());
  }
  if (!data.session) {
    // No SSR nunca há sessão (localStorage é do client) — o redirect leva o
    // deep link junto e o /login devolve o usuário pro destino após hidratar.
    const here =
      from ??
      (typeof window !== "undefined" ? window.location.pathname + window.location.search : "/");
    throw redirect({ to: "/login", search: !here || here === "/" ? {} : { redirect: here } });
  }
  return data.session;
}

/** Guard do `/login` — já autenticado → home (ou o deep link preservado). */
export async function redirectIfAuthenticated(redirectTo?: string) {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    throw redirect({ to: safeRedirectPath(redirectTo) });
  }
}

/**
 * Checagem "signup aberto?" do primeiro acesso pós-Remix.
 * `true` somente quando a RPC `has_any_admin()` responde `false`
 * (ainda não existe admin → o primeiro signUp cria o admin).
 * RPC ausente/erro → assumir que há admin (signup fechado).
 */
export async function fetchSignupOpen(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("has_any_admin");
    if (error) return false;
    return data === false;
  } catch {
    return false;
  }
}

/**
 * Roles do usuário logado (RLS restringe às próprias linhas).
 * Tabela ainda inexistente ou erro → lista vazia (esconde recursos de admin).
 */
export async function fetchUserRoles(): Promise<string[]> {
  try {
    let { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session && typeof window !== "undefined") {
      // mesma corrida do requireSession: sem esta espera, um admin que abre a
      // página antes do token restaurar vira "sem role" — e o guard o expulsa
      await new Promise((resolve) => setTimeout(resolve, 300));
      ({ data: sessionData } = await supabase.auth.getSession());
    }
    const userId = sessionData.session?.user.id;
    if (!userId) return [];

    const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (error) return [];
    return (data ?? []).map((row) => row.role);
  } catch {
    return [];
  }
}

/** Conveniência sobre `fetchUserRoles` — controla item Config e guard de `/config`. */
export async function fetchIsAdmin(): Promise<boolean> {
  const roles = await fetchUserRoles();
  return roles.includes("admin");
}
