// _shared/supabase.ts — factories de clients Supabase para edge functions.
// - createServiceClient(): service role (bypassa RLS; NUNCA sai da edge function)
// - createUserClient(req):  anon key + Authorization do chamador (RLS + auth.uid() do usuário)
// - getUser(req):           resolve o usuário autenticado a partir do JWT do request
// Env padrão do Lovable Cloud: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.

import {
  createClient,
  type SupabaseClient,
  type User,
} from 'npm:@supabase/supabase-js@2';

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

/** Client admin (service role). Uso interno da function; jamais exposto ao client. */
export function createServiceClient(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Client no contexto do usuário chamador: repassa o header Authorization,
 * então RLS e auth.uid() valem para o usuário do JWT (necessário para RPCs
 * SECURITY DEFINER que revalidam papel via auth.uid(), ex.: store_vault_secret).
 */
export function createUserClient(req: Request): SupabaseClient {
  const authHeader = req.headers.get('Authorization') ?? '';
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Resolve o usuário autenticado do request (JWT do header Authorization).
 * O gateway com verify_jwt=true já rejeita JWT inválido antes do código rodar;
 * esta checagem é defesa em profundidade + acesso ao user.id.
 */
export async function getUser(req: Request): Promise<User | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length);
  const supabase = createServiceClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}
