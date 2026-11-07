// invite-user — convite de usuário via auth admin API. ADMIN ONLY.
// Contrato: docs/07-contratos-backend.md §3.7; trigger handle_new_user em
// docs/04-modelo-de-dados.md §5.
//
// Deploy config: verify_jwt = true
//   (supabase/config.toml → [functions.invite-user] verify_jwt = true;
//    deploy via Lovable MCP — 07-contratos-backend.md §9)
//
// POST { email, role: 'admin' | 'user' } → 200 { invited: true, email }
//
// Signup aberto existe apenas até o primeiro usuário (que vira admin pelo
// trigger). Depois, entrada SÓ por convite: o papel pretendido viaja no
// user metadata do convite (`data.role`) e o trigger handle_new_user lê
// raw_user_meta_data.role — validado contra o enum app_role — para popular
// user_roles no aceite. Esta função NÃO escreve em user_roles.
//
// Promover/rebaixar usuário existente é update em user_roles pela tela
// /config/usuarios (RLS de admin) — não passa por aqui.

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';

const ROLES = ['admin', 'user'] as const;
type AppRole = (typeof ROLES)[number];

/** Validação pragmática de e-mail (o GoTrue revalida do lado dele). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface InviteUserRequest {
  email?: unknown;
  role?: unknown;
}

/**
 * "E-mail já cadastrado" no GoTrue não tem uma mensagem única entre versões:
 * checa status 422 e os códigos/mensagens conhecidos. Qualquer outro erro da
 * admin API vira 502 provider_error (07 §3.7).
 */
function isAlreadyRegistered(error: { status?: number; code?: string; message?: string }): boolean {
  if (error.status === 422) return true;
  const haystack = `${error.code ?? ''} ${error.message ?? ''}`.toLowerCase();
  return (
    haystack.includes('email_exists') ||
    haystack.includes('user_already_exists') ||
    haystack.includes('already been registered') ||
    haystack.includes('already registered') ||
    haystack.includes('already exists')
  );
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return errorResponse(405, 'invalid_input', 'Use POST.');
  }

  try {
    const user = await getUser(req);
    if (!user) {
      return errorResponse(401, 'unauthorized', 'Sessão inválida ou ausente.');
    }

    // Checagem de admin dentro da função (verify_jwt só garante "autenticado").
    const service = createServiceClient();
    const { data: isAdmin, error: roleError } = await service.rpc('has_role', {
      _user_id: user.id,
      _role: 'admin',
    });
    if (roleError) {
      return errorResponse(500, 'internal_error', `Falha ao verificar papel: ${roleError.message}`);
    }
    if (isAdmin !== true) {
      return errorResponse(403, 'forbidden', 'Apenas administradores podem convidar usuários.');
    }

    let body: InviteUserRequest;
    try {
      body = (await req.json()) as InviteUserRequest;
    } catch (_err) {
      return errorResponse(400, 'invalid_input', 'Body JSON inválido.');
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email) {
      return errorResponse(400, 'invalid_input', 'Campo email é obrigatório.');
    }
    if (!EMAIL_RE.test(email)) {
      return errorResponse(400, 'invalid_input', `E-mail inválido: "${email}".`);
    }

    const role = body.role;
    if (typeof role !== 'string' || !(ROLES as readonly string[]).includes(role)) {
      return errorResponse(
        400,
        'invalid_input',
        `Papel inválido. Valores aceitos: ${ROLES.join(', ')}.`,
      );
    }

    // O papel do convidado é gravado ANTES do convite, em pending_invites — tabela
    // que só o service_role alcança (RLS sem política). O trigger handle_new_user lê
    // dali, NUNCA do metadata do signup: metadata é controlado pelo cliente e permitia
    // escalonamento para admin (ver migration 202607300012).
    const { error: inviteRowError } = await service
      .from('pending_invites')
      .upsert(
        { email: email.toLowerCase(), role: role as AppRole, invited_by: user.id },
        { onConflict: 'email' },
      );
    if (inviteRowError) {
      console.error(`[invite-user] falha ao registrar convite de ${email}: ${inviteRowError.message}`);
      return errorResponse(500, 'internal_error', 'Falha ao registrar o convite.');
    }

    // Convite pelo client service role. O `data.role` vai junto apenas como registro
    // informativo do convite — a autorização não depende dele.
    const { error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
      data: { role: role as AppRole },
    });

    if (inviteError) {
      // Convite não saiu: não deixa a linha órfã autorizando um signup futuro.
      await service.from('pending_invites').delete().eq('email', email.toLowerCase());
      if (isAlreadyRegistered(inviteError)) {
        return errorResponse(
          409,
          'invalid_state',
          `Já existe um usuário com o e-mail ${email}. Para mudar o papel dele, use /config/usuarios.`,
        );
      }
      console.error(`[invite-user] falha da auth admin API para ${email}: ${inviteError.message}`);
      return errorResponse(
        502,
        'provider_error',
        `Falha ao enviar o convite: ${inviteError.message}`,
      );
    }

    console.info(`[invite-user] convite enviado para ${email} (role ${role}) por ${user.id}`);
    return jsonResponse({ invited: true, email });
  } catch (err) {
    console.error('[invite-user] erro inesperado:', err);
    return errorResponse(500, 'internal_error', 'Falha inesperada ao convidar o usuário.');
  }
});
