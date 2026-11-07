// google-drive — os materiais moram no Google Drive da pessoa; o banco guarda o registro.
// Guia: docs/google-drive.md. SQL: supabase/sql/google-drive.sql.
//
// Deploy config: verify_jwt = false. A validação é interna: o Google volta por GET sem
// Authorization (vale o `state`), e o tick de minuto manda x-cron-secret, como video-edit.
//
//   GET  ?code&state     → volta do hub: troca o código e devolve a pessoa ao app
//   POST status          → configurado? conectado? bloqueia gerar? (e-mail e economia p/ admin)
//   POST start           → URL de autorização, com PKCE e state
//   POST disconnect      → revoga no Google e apaga o token (admin)
//   POST restore         → traz um arquivo de volta ao storage
//   POST tick            → uma rodada da varredura (cron ou admin)
//
// O escopo é só drive.file: o app enxerga apenas o que ele mesmo criou. O e-mail da
// conta vem de about.get, que aceita esse escopo. O refresh token fica no Vault.
// O cliente OAuth mora no hub central (drive-hub): esta instância nunca vê a chave do Google.

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';
import { allowedAppOrigin } from '../_shared/app-origin.ts';
import { aboutUser, DRIVE_SCOPE, ensureFolders, revokeToken, type DriveIo } from '../_shared/drive-api.ts';
import { recordedSweep } from '../_shared/drive-archive.ts';
import { eHub, hubDaInstancia, instanciaAtual } from '../_shared/drive-hub.ts';
import { LAST_RUN_KEY, makeDriveIo } from '../_shared/drive-io.ts';
import { ARCHIVABLE_BUCKETS, mayBeArchived } from '../_shared/drive-policy.ts';
import { ArchivedFileError, restoreFile } from '../_shared/drive-restore.ts';
import { driveRequired } from '../_shared/drive-gate.ts';
import { segredoIgual } from '../_shared/segredo-igual.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

type Service = ReturnType<typeof createServiceClient>;

const PENDING_KEY = 'google_drive_pending';
const PENDING_TTL_MS = 15 * 60_000;
const RETURN_PATH = '/conectado';
const RESTORE_BUDGET_MS = 100_000;

interface Pending {
  state: string;
  verifier: string;
  origin: string;
  created_at: number;
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const randomToken = (bytes = 32) => base64Url(crypto.getRandomValues(new Uint8Array(bytes)));

async function challengeFor(verifier: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/** A URI que vai no cliente OAuth do Google Cloud: a do hub, uma só para todas as instâncias. */
const ambiente = (nome: string) => Deno.env.get(nome);
const hubUrl = () => hubDaInstancia(ambiente);
const instancia = () => instanciaAtual(ambiente);

const background = (task: Promise<unknown>) => {
  const guarded = task.catch((err) => console.error('[google-drive] background:', err));
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime) EdgeRuntime.waitUntil(guarded);
};

async function readPending(service: Service): Promise<Pending | null> {
  const { data } = await service.from('director_state').select('value').eq('key', PENDING_KEY).maybeSingle();
  return (data?.value as Pending) ?? null;
}

async function start(service: Service, io: DriveIo, body: Record<string, unknown>): Promise<Response> {
  const origin = allowedAppOrigin(body.return_origin);
  if (!origin) return errorResponse(400, 'invalid_input', 'Origem do app não reconhecida.');

  const pending: Pending = { state: randomToken(24), verifier: randomToken(48), origin, created_at: Date.now() };
  const { error } = await service.from('director_state').upsert({ key: PENDING_KEY, value: pending }, { onConflict: 'key' });
  if (error) throw new Error(`director_state: ${error.message}`);

  const url = new URL(hubUrl());
  url.searchParams.set('instancia', instancia());
  url.searchParams.set('state', pending.state);
  url.searchParams.set('challenge', await challengeFor(pending.verifier));
  return jsonResponse({ authorize_url: url.toString() });
}

type Outcome = 'conectado' | 'recusado' | 'expirado' | 'sem_permissao' | 'falhou';

async function finishOauth(service: Service, io: DriveIo, pending: Pending, code: string): Promise<Outcome> {
  const resposta = await io.fetch(hubUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ acao: 'trocar', instancia: instancia(), code, verifier: pending.verifier }),
  });
  if (!resposta.ok) {
    console.error('[google-drive] hub recusou a troca:', resposta.status);
    await resposta.body?.cancel();
    return 'falhou';
  }
  const { ok, status, payload, hub_token: hubToken } = await resposta.json() as {
    ok: boolean; status: number; payload: Record<string, unknown>; hub_token: string | null;
  };
  const access = typeof payload.access_token === 'string' ? payload.access_token : null;
  const refresh = typeof payload.refresh_token === 'string' ? payload.refresh_token : null;
  if (!ok || !access || !refresh || !hubToken) {
    console.error('[google-drive] troca de tokens falhou:', status);
    return 'falhou';
  }
  // na tela de consentimento a pessoa pode desmarcar o escopo e mesmo assim autorizar
  if (!String(payload.scope ?? '').split(' ').includes(DRIVE_SCOPE)) {
    await revokeToken(io, refresh).catch(() => false);
    return 'sem_permissao';
  }

  await io.storeRefreshToken(refresh);
  const connection = {
    connected: true,
    access_token: access,
    expires_at: Date.now() + Number(payload.expires_in ?? 3600) * 1000,
    connected_at: new Date().toISOString(),
    folders: {},
    hub_token: hubToken,
  };
  await io.saveConnection(connection);
  try {
    const user = await aboutUser(io);
    if (!user.permissionId) throw new Error('Drive sem permissionId.');
    const current = await io.connection();
    await io.saveConnection({ ...connection, ...current, email: user.email, permission_id: user.permissionId });
  } catch (err) {
    console.error('[google-drive] about falhou:', err);
    await revokeToken(io, refresh).catch(() => false);
    await io.saveConnection(null);
    await io.storeRefreshToken('');
    return 'falhou';
  }
  // a conexão já vale; a pasta que faltar sai no primeiro envio
  await ensureFolders(io).catch((err) => console.error('[google-drive] pastas:', err));
  return 'conectado';
}

/** Volta do Google. Nada do que chega pela URL é refletido: só o código do desfecho. */
async function oauthReturn(service: Service, io: DriveIo, url: URL): Promise<Response> {
  const state = url.searchParams.get('state');
  const pending = await readPending(service);
  if (!pending || !state || pending.state !== state) {
    return new Response('Sessão expirada. Feche esta aba e clique em Conectar de novo.', {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  // state vale uma vez só
  await service.from('director_state').delete().eq('key', PENDING_KEY);

  const code = url.searchParams.get('code');
  let outcome: Outcome;
  if (Date.now() - pending.created_at > PENDING_TTL_MS) outcome = 'expirado';
  else if (url.searchParams.get('error') || !code) outcome = 'recusado';
  else outcome = await finishOauth(service, io, pending, code).catch((err) => {
    console.error('[google-drive] conexão falhou:', err instanceof Error ? err.message : err);
    return 'falhou' as const;
  });
  // o que já existe começa a ir para o Drive sem esperar o próximo tick
  if (outcome === 'conectado') background(recordedSweep(io));
  return new Response(null, {
    status: 302,
    headers: { Location: new URL(`${RETURN_PATH}?drive=${outcome}`, pending.origin).toString() },
  });
}

async function status(service: Service, io: DriveIo, isAdmin: boolean): Promise<Response> {
  const [creds, conn, required] = await Promise.all([io.credentials(), io.connection(), driveRequired(service)]);
  const connected = Boolean(conn?.connected && !conn.broken);
  // o hub precisa das chaves do Google; as demais instâncias só clicam em Conectar
  const configured = eHub(hubUrl(), instancia()) ? Boolean(creds) : true;
  const base = { configured, connected, broken: Boolean(conn?.broken), required, can_connect: isAdmin };
  if (!isAdmin) return jsonResponse(base);
  const [{ data }, { data: lastRun }, purge] = await Promise.all([
    service.rpc('google_drive_stats'),
    service.from('director_state').select('value').eq('key', LAST_RUN_KEY).maybeSingle(),
    io.purgeEnabled(),
  ]);
  const stats = (data as Record<string, number>[] | null)?.[0];
  return jsonResponse({
    ...base,
    email: conn?.email ?? null,
    saved_bytes: Number(stats?.saved_bytes ?? 0),
    drive_files: Number(stats?.drive_files ?? 0),
    only_in_drive: Number(stats?.saved_files ?? 0),
    waiting_files: Number(stats?.waiting_files ?? 0),
    purge_enabled: purge,
    last_run: lastRun?.value ?? null,
    redirect_uri: hubUrl(),
  });
}

async function disconnect(service: Service, io: DriveIo): Promise<Response> {
  // Com arquivo só no Drive, não revoga: a documentação não garante o acesso a eles depois
  // de revogar. Sem saber quantos são, vale o lado seguro.
  const { data, error } = await service.rpc('google_drive_stats');
  const onlyInDrive = error ? 1 : Number((data as Record<string, number>[] | null)?.[0]?.saved_files ?? 0);
  const refresh = await io.refreshToken();
  const revoked = onlyInDrive > 0 ? false : refresh ? await revokeToken(io, refresh).catch(() => false) : true;
  await io.storeRefreshToken('');
  await io.saveConnection(null);
  await service.from('director_state').delete().eq('key', PENDING_KEY);
  return jsonResponse({ connected: false, revoked });
}

async function restore(io: DriveIo, body: Record<string, unknown>): Promise<Response> {
  const bucket = typeof body.bucket === 'string' ? body.bucket : '';
  const path = typeof body.path === 'string' ? body.path : '';
  if (!ARCHIVABLE_BUCKETS.includes(bucket) || !path || !mayBeArchived(bucket, path)) {
    return jsonResponse({ status: 'absent' });
  }
  try {
    const result = await restoreFile(io, bucket, path, { budgetMs: RESTORE_BUDGET_MS, dryRun: body.dry_run === true });
    return jsonResponse({ status: result });
  } catch (err) {
    if (err instanceof ArchivedFileError) return jsonResponse({ status: 'unavailable', code: err.code, message: err.message });
    console.error('[google-drive] restore:', err);
    const failed = new ArchivedFileError('failed');
    return jsonResponse({ status: 'unavailable', code: failed.code, message: failed.message });
  }
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const service = createServiceClient();
  const io = makeDriveIo(service);

  try {
    if (req.method === 'GET') return await oauthReturn(service, io, new URL(req.url));
    if (req.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Use POST.');

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    const provided = req.headers.get('x-cron-secret');
    if (provided) {
      const { data } = await service.rpc('get_vault_secret', { _name: 'VIDEO_CRON_SECRET' });
      if (!segredoIgual(provided, data)) return errorResponse(401, 'unauthorized', 'x-cron-secret inválido.');
      if (body.action !== 'tick') return errorResponse(400, 'invalid_action', 'O cron só chama tick.');
      background(recordedSweep(io));
      return jsonResponse({ ok: true }, 202);
    }

    const user = await getUser(req);
    if (!user) return errorResponse(401, 'unauthorized', 'Sessão inválida ou ausente.');
    const { data: admin } = await service.rpc('has_role', { _user_id: user.id, _role: 'admin' });
    const isAdmin = admin === true;

    switch (body.action) {
      case 'status':
        return await status(service, io, isAdmin);
      case 'start':
        // a conexão recebe os materiais de toda a instância: só admin escolhe a conta.
        // Quem não é admin vê o pedido ao administrador, e a tela reconsulta o status.
        if (!isAdmin) return errorResponse(403, 'forbidden', 'Só administradores conectam o Google Drive.');
        return await start(service, io, body);
      case 'disconnect':
        if (!isAdmin) return errorResponse(403, 'forbidden', 'Só administradores desconectam o Google Drive.');
        return await disconnect(service, io);
      case 'restore':
        return await restore(io, body);
      case 'tick':
        if (!isAdmin) return errorResponse(403, 'forbidden', 'Só administradores.');
        background(recordedSweep(io));
        return jsonResponse({ ok: true }, 202);
      default:
        return errorResponse(400, 'invalid_action', 'Ação desconhecida.');
    }
  } catch (err) {
    console.error('[google-drive]', err instanceof Error ? err.message : err);
    return errorResponse(500, 'google_drive_failed', 'Não deu para concluir agora. Tente de novo em instantes.');
  }
});
