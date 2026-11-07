// drive-hub — conector central do Google Drive. Guia: docs/google-drive.md.
//
// Deploy config: verify_jwt = false. O Google e o navegador chegam por GET sem Authorization.
//
//   GET  ?instancia&state&challenge → manda a pessoa para o Google
//   GET  ?code|error&state          → devolve a pessoa à instância que começou
//   POST { acao: 'trocar', instancia, code, verifier } → tokens e credencial da instância
//   POST { acao: 'renovar', instancia, hub_token, refresh_token } → access token novo
//
// Só o hub tem GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET. Quem pode usar fica em
// app_settings.drive_hub_instances. O hub não guarda token de ninguém.

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { DRIVE_SCOPE, exchangeCode, refreshDirect } from '../_shared/drive-api.ts';
import {
  abrirEstado, ESTADO_TTL_MS, hubDaInstancia, instanciaAutorizada, INSTANCIAS_KEY, selarEstado, tokenConfere,
  tokenDaInstancia, urlDoGoogle, voltaParaInstancia,
} from '../_shared/drive-hub.ts';
import { createServiceClient } from '../_shared/supabase.ts';

type Service = ReturnType<typeof createServiceClient>;

const segredo = async (service: Service, nome: string) => {
  const { data } = await service.rpc('get_vault_secret', { _name: nome });
  return (data as string) || null;
};

async function credenciais(service: Service) {
  const [clientId, clientSecret] = await Promise.all([
    segredo(service, 'GOOGLE_CLIENT_ID'), segredo(service, 'GOOGLE_CLIENT_SECRET'),
  ]);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

async function autorizada(service: Service, hub: string, instancia: unknown): Promise<boolean> {
  const { data } = await service.from('app_settings').select('value').eq('key', INSTANCIAS_KEY).maybeSingle();
  return instanciaAutorizada(String(instancia), hub, (data?.value as { urls?: unknown } | null)?.urls);
}

const texto = (status: number, mensagem: string) =>
  new Response(mensagem, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

async function porGet(service: Service, hub: string, url: URL): Promise<Response> {
  const creds = await credenciais(service);
  if (!creds) return texto(503, 'O Google Drive ainda não está disponível.');

  const selado = url.searchParams.get('state') ?? '';
  const instancia = url.searchParams.get('instancia');
  if (instancia) {
    const challenge = url.searchParams.get('challenge');
    if (!challenge || !selado || !(await autorizada(service, hub, instancia))) {
      return texto(403, 'Esta instância ainda não foi liberada para o Google Drive.');
    }
    const estado = await selarEstado(creds.clientSecret, {
      instancia, state: selado, expira: Date.now() + ESTADO_TTL_MS,
    });
    return new Response(null, {
      status: 302,
      headers: {
        Location: urlDoGoogle({ clientId: creds.clientId, hub, escopo: DRIVE_SCOPE, selado: estado, challenge }),
      },
    });
  }

  const aberto = await abrirEstado(creds.clientSecret, selado, Date.now()).catch(() => null);
  if (!aberto) return texto(400, 'Sessão expirada. Feche esta aba e clique em Conectar de novo.');
  const destino = voltaParaInstancia(
    aberto.instancia, aberto.state, url.searchParams.get('code'), url.searchParams.get('error'),
  );
  return new Response(null, { status: 302, headers: { Location: destino } });
}

const acesso = { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) };

async function porPost(service: Service, hub: string, body: Record<string, unknown>): Promise<Response> {
  const creds = await credenciais(service);
  if (!creds) return errorResponse(503, 'drive_hub_off', 'O Google Drive ainda não está disponível.');
  const instancia = String(body.instancia ?? '');
  if (!(await autorizada(service, hub, instancia))) {
    return errorResponse(403, 'forbidden', 'Esta instância ainda não foi liberada para o Google Drive.');
  }

  if (body.acao === 'trocar') {
    if (typeof body.code !== 'string' || typeof body.verifier !== 'string') {
      return errorResponse(400, 'invalid_input', 'Pedido incompleto.');
    }
    const { ok, status, payload } = await exchangeCode(acesso, {
      code: body.code, verifier: body.verifier, redirectUri: hub, ...creds,
    });
    return jsonResponse({
      ok, status, payload, hub_token: ok ? await tokenDaInstancia(creds.clientSecret, instancia) : null,
    });
  }

  if (body.acao === 'renovar') {
    if (!(await tokenConfere(creds.clientSecret, instancia, body.hub_token)) || typeof body.refresh_token !== 'string') {
      return errorResponse(403, 'forbidden', 'Credencial da instância inválida.');
    }
    return jsonResponse(await refreshDirect(acesso, creds, body.refresh_token));
  }
  return errorResponse(400, 'invalid_action', 'Ação desconhecida.');
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  const service = createServiceClient();
  const hub = hubDaInstancia((nome) => Deno.env.get(nome));
  try {
    if (req.method === 'GET') return await porGet(service, hub, new URL(req.url));
    if (req.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Use POST.');
    return await porPost(service, hub, await req.json().catch(() => ({})));
  } catch (err) {
    console.error('[drive-hub]', err instanceof Error ? err.message : err);
    return errorResponse(500, 'drive_hub_failed', 'Não deu para concluir agora. Tente de novo em instantes.');
  }
});
