// higgsfield-oauth — conexão da conta Higgsfield (MCP oficial) pela UI.
//
// O MCP do Higgsfield fala OAuth 2.1 com PKCE e REGISTRO DINÂMICO de client.
// Até aqui os tokens eram semeados à mão no banco; esta função põe o fluxo
// inteiro no produto:
//
//   start   (admin)  → registra/reusa o client, gera PKCE + state e devolve a
//                      authorize_url para o front abrir numa aba
//   exchange(admin)  → o Higgsfield devolve o usuário em <app>/config?code&state;
//                      a página repassa os dois pra cá, a função valida o state,
//                      troca o code por tokens e grava em director_state.hf_oauth
//                      (mesma chave que a lane do vídeo lê). Devolve só o código
//                      do desfecho — o texto da mensagem é do app.
//   status  (admin)  → conectado? expira quando? (NUNCA devolve token)
//   disconnect(admin)→ apaga os tokens
//
// Por que o retorno é no APP e não nesta função: desde 2026-10 o registro
// dinâmico do Higgsfield só aceita redirect_uri de uma lista de confiança
// (`invalid_redirect_uri: ... not in the trusted list`). *.supabase.co está
// fora dela; localhost/127.0.0.1 passam. Domínio publicado: confirmar.

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';

const MCP_BASE = 'https://mcp.higgsfield.ai';
const MCP_RESOURCE = `${MCP_BASE}/mcp`;
const PENDING_KEY = 'hf_oauth_pending';
const TOKENS_KEY = 'hf_oauth';
const CLIENT_KEY = 'hf_oauth_client';
/** Rota do app que recebe ?code&state e chama `exchange`. */
const RETURN_PATH = '/config';
/**
 * Volta fora do dev local. O Higgsfield só aceita endereços de volta de uma
 * lista fechada (o próprio Claude e o endereço local); *.lovable.app e o
 * Supabase ficam fora (invalid_redirect_uri, testado em 04/11). Então, no site
 * publicado, a volta é o endereço local: a aba não carrega, a pessoa copia o
 * endereço dela e cola no modal, que chama `exchange` com o code e o state.
 */
const LOOPBACK_REDIRECT = 'http://127.0.0.1/higgsfield';
/** Janela para concluir a autorização — state velho não vale mais. */
const PENDING_TTL_MS = 15 * 60_000;

type Service = ReturnType<typeof createServiceClient>;

// ── PKCE ─────────────────────────────────────────────────────────────────────

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(bytes = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

// ── director_state (service-only) ────────────────────────────────────────────

async function readState<T>(service: Service, key: string): Promise<T | null> {
  const { data } = await service.from('director_state').select('value').eq('key', key).maybeSingle();
  return (data?.value as T) ?? null;
}

async function writeState(service: Service, key: string, value: unknown): Promise<void> {
  const { error } = await service
    .from('director_state')
    .upsert({ key, value }, { onConflict: 'key' });
  if (error) throw new Error(`director_state ${key}: ${error.message}`);
}

/** redirect_uri registrado no provedor: a página de Config do próprio app. */
function redirectUri(appOrigin: string): string {
  return new URL(RETURN_PATH, appOrigin).toString();
}

/**
 * Client OAuth do provedor. O registro é dinâmico e o redirect_uri faz parte
 * dele — preview, publicado e localhost têm origens diferentes, então trocar de
 * origem registra outro client em vez de falhar no authorize com
 * redirect_uri_mismatch.
 */
async function ensureClient(service: Service, redirect: string): Promise<string> {
  const saved = await readState<{ client_id?: string; redirect_uri?: string }>(service, CLIENT_KEY);
  if (saved?.client_id && saved.redirect_uri === redirect) return saved.client_id;

  const response = await fetch(`${MCP_BASE}/oauth2/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Automação de Redes Sociais',
      redirect_uris: [redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  const payload = await response.json().catch(() => ({}));
  const clientId = payload?.client_id;
  if (payload?.error === 'invalid_redirect_uri') {
    throw new Error(
      `O Higgsfield não aceita conexões vindas de ${new URL(redirect).origin}. ` +
        'Conecte pelo app rodando localmente ou peça ao Higgsfield para liberar este domínio.',
    );
  }
  if (!response.ok || typeof clientId !== 'string') {
    throw new Error(`registro do client falhou (${response.status}): ${JSON.stringify(payload).slice(0, 200)}`);
  }
  // Só registra. O Vault (HF_MCP_CLIENT_ID, lido pelo refresh da lane de vídeo)
  // é publicado no EXCHANGE: o refresh_token só vale com o client que o emitiu,
  // então trocar o client_id antes de ter token novo quebraria a conexão viva.
  await writeState(service, CLIENT_KEY, { client_id: clientId, redirect_uri: redirect });
  return clientId;
}

// ── ações ────────────────────────────────────────────────────────────────────

async function handleStart(service: Service, returnOrigin: unknown): Promise<Response> {
  const appOrigin = allowedOrigin(typeof returnOrigin === 'string' ? returnOrigin : null);
  if (!appOrigin) return errorResponse(400, 'invalid_input', 'Origem do app não reconhecida.');
  const local = ['localhost', '127.0.0.1'].includes(new URL(appOrigin).hostname);
  const redirect = local ? redirectUri(appOrigin) : LOOPBACK_REDIRECT;
  const clientId = await ensureClient(service, redirect);
  const verifier = randomToken(48);
  const state = randomToken(24);
  await writeState(service, PENDING_KEY, {
    state,
    verifier,
    client_id: clientId,
    redirect_uri: redirect,
    created_at: Date.now(),
  });

  const url = new URL(`${MCP_BASE}/oauth2/authorize`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('code_challenge', await challengeFor(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('scope', 'openid email offline_access');
  url.searchParams.set('resource', MCP_RESOURCE);
  // colar: a tela pede o endereço da aba depois de autorizar
  return jsonResponse({ authorize_url: url.toString(), colar: !local });
}

async function handleStatus(service: Service): Promise<Response> {
  const tokens = await readState<{
    access_token?: string;
    refresh_token?: string;
    obtained_at?: number;
    expires_in?: number;
    broken?: boolean;
  }>(service, TOKENS_KEY);

  if (!tokens?.refresh_token) return jsonResponse({ connected: false });
  // refresh recusado de vez (hf-mcp marcou): o card não pode dizer "Conectado"
  if (tokens.broken) {
    return jsonResponse({ connected: false, reason: 'A conexão expirou. Clique em Conectar para autorizar de novo.' });
  }

  const expiresAt = (tokens.obtained_at ?? 0) + (tokens.expires_in ?? 0) * 1000;
  return jsonResponse({
    connected: true,
    // com refresh_token a conexão se renova sozinha; o access expirado não é problema
    access_expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
    access_expired: expiresAt ? Date.now() > expiresAt : null,
  });
}

async function handleDisconnect(service: Service): Promise<Response> {
  await service.from('director_state').delete().eq('key', TOKENS_KEY);
  await service.from('director_state').delete().eq('key', PENDING_KEY);
  return jsonResponse({ connected: false });
}

/**
 * Desfechos possíveis do exchange. Só o CÓDIGO volta — o app tem a tabela de
 * mensagens. Nada que o provedor escreveu é refletido de volta: os parâmetros
 * chegam pela URL de retorno, que qualquer um consegue montar.
 */
type Outcome = 'conectado' | 'recusado' | 'sessao' | 'expirado' | 'falhou';

/**
 * Origem do app que vira o redirect_uri do OAuth.
 *
 * Isto é uma guarda de open-redirect, não configuração de conveniência: o
 * `return_origin` vem do navegador (`window.location.origin`), ou seja, de fora.
 * Sem a checagem, qualquer um faria esta função redirecionar para um domínio
 * dele com o desfecho na URL.
 *
 * Quem decide o destino é a PRÓPRIA PÁGINA onde o usuário está: o front manda
 * `window.location.origin`, então preview volta para o preview e publicado volta
 * para o publicado, sem ninguém configurar nada. `APP_ORIGIN` não substitui isso
 * — ela só ACRESCENTA origens que o Lovable não hospeda, que na prática é o
 * domínio próprio do cliente.
 *
 * A regra, em ordem:
 *  1. localhost/127.0.0.1 em http passa sempre — é o dev.
 *  2. domínios do Lovable (preview, publicado, `.lovable.dev`) passam sempre.
 *  3. o que `APP_ORIGIN` listar, separado por vírgula, por igualdade exata de
 *     origem — o domínio do cliente entra aqui.
 *
 * É ADITIVO de propósito. A versão anterior fazia `APP_ORIGIN` SUBSTITUIR os
 * domínios do Lovable, e isso era uma armadilha: pôr o domínio do cliente
 * quebrava o OAuth no preview, que é onde a equipe testa.
 *
 * Por que existe validação, já que a origem vem do próprio usuário: é guarda de
 * open-redirect, e o valor chega do navegador. O risco aqui é baixo e vale
 * registrar para ninguém apertar demais — `start` exige admin autenticado (é
 * Bearer, não cookie, então não há CSRF) e o redirect carrega só
 * `?higgsfield=<desfecho>`, nenhum token: a troca de código acontece
 * server-side e o resultado vai para o Vault. A lista é defesa em profundidade,
 * não a única barreira.
 *
 * O caminho de volta é sempre nosso (RETURN_PATH); o que varia é só a origem.
 */
const DOMINIOS_DO_LOVABLE = ['lovable.app', 'lovableproject.com', 'lovable.dev'];

/** Origens EXTRA de APP_ORIGIN — lista por vírgula, normalizada para origin. */
function origensExtra(): string[] {
  const bruto = Deno.env.get('APP_ORIGIN');
  if (!bruto) return [];
  return bruto
    .split(',')
    .map((parte) => parte.trim())
    .filter((parte) => parte.length > 0)
    .map((parte) => {
      // Normaliza para origin: assim "https://app.cliente.com/" e
      // "https://app.cliente.com" são a mesma coisa, e uma barra sobrando não
      // derruba o OAuth de uma instância inteira.
      try {
        return new URL(parte).origin;
      } catch {
        console.error(`[higgsfield-oauth] APP_ORIGIN tem entrada invalida, ignorada: ${parte}`);
        return null;
      }
    })
    .filter((origem): origem is string => origem !== null);
}

function allowedOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
    return parsed.origin;
  }
  if (parsed.protocol !== 'https:') return null;

  const host = parsed.hostname;
  const doLovable = DOMINIOS_DO_LOVABLE.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
  if (doLovable) return parsed.origin;

  return origensExtra().includes(parsed.origin) ? parsed.origin : null;
}

async function handleExchange(service: Service, body: Record<string, unknown>): Promise<Response> {
  const outcome = (o: Outcome) => jsonResponse({ outcome: o });
  if (typeof body.error === 'string' && body.error) return outcome('recusado');

  const code = typeof body.code === 'string' ? body.code : null;
  const state = typeof body.state === 'string' ? body.state : null;
  if (!code || !state) return outcome('sessao');

  const pending = await readState<{
    state?: string;
    verifier?: string;
    client_id?: string;
    redirect_uri?: string;
    created_at?: number;
  }>(service, PENDING_KEY);

  // state amarra a volta à conexão aberta aqui: precisa existir, bater e estar no prazo
  if (!pending?.state || !pending.verifier || !pending.redirect_uri || pending.state !== state) {
    return outcome('sessao');
  }
  if (Date.now() - (pending.created_at ?? 0) > PENDING_TTL_MS) {
    await service.from('director_state').delete().eq('key', PENDING_KEY);
    return outcome('expirado');
  }

  const response = await fetch(`${MCP_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: pending.redirect_uri,
      client_id: pending.client_id ?? '',
      code_verifier: pending.verifier,
      resource: MCP_RESOURCE,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload?.access_token !== 'string') {
    console.error('troca de tokens falhou:', response.status, JSON.stringify(payload).slice(0, 200));
    return outcome('falhou');
  }
  // sem refresh_token a conexão morreria em 24h e o status diria "conectado"
  if (typeof payload.refresh_token !== 'string' || !payload.refresh_token) {
    console.error('troca de tokens sem refresh_token:', JSON.stringify(payload).slice(0, 200));
    return outcome('falhou');
  }

  const clientId = pending.client_id ?? '';
  await writeState(service, TOKENS_KEY, {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token ?? null,
    obtained_at: Date.now(),
    expires_in: payload.expires_in ?? 86400,
    // quem emitiu estes tokens — o refresh precisa do MESMO client
    client_id: clientId,
  });
  // agora sim o Vault pode apontar pro client novo: já existe token dele
  const { error: vaultError } = await service.rpc('store_vault_secret', {
    _name: 'HF_MCP_CLIENT_ID',
    _value: clientId,
  });
  if (vaultError) console.error('store_vault_secret HF_MCP_CLIENT_ID:', vaultError.message);
  await service.from('director_state').delete().eq('key', PENDING_KEY);

  return outcome('conectado');
}

// ── handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const service = createServiceClient();

  try {
    if (req.method !== 'POST') return errorResponse(405, 'invalid_input', 'Use POST.');

    const user = await getUser(req);
    if (!user) return errorResponse(401, 'unauthorized', 'Sessão inválida ou ausente.');
    const { data: isAdmin } = await service.rpc('has_role', { _user_id: user.id, _role: 'admin' });
    if (!isAdmin) return errorResponse(403, 'forbidden', 'Apenas admin.');

    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case 'start':
        return await handleStart(service, body.return_origin);
      case 'exchange':
        return await handleExchange(service, body);
      case 'status':
        return await handleStatus(service);
      case 'disconnect':
        return await handleDisconnect(service);
      default:
        return errorResponse(400, 'invalid_input', "action deve ser 'start', 'exchange', 'status' ou 'disconnect'.");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[higgsfield-oauth] erro:', message);
    return errorResponse(500, 'internal', 'Não deu para falar com o Higgsfield agora. Tente de novo.');
  }
});
