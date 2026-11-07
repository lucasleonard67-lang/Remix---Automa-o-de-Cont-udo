// _shared/drive-hub.ts — o conector central do Google Drive, sem rede.
//
// Só o hub conhece o cliente OAuth e fala com o Google por trás. Cada instância guarda
// o próprio refresh token e pede ao hub para trocar e renovar, então uma instância nova
// não mexe no Google Cloud. Guia: docs/google-drive.md.

export const HUB_PADRAO = 'https://rpsyfmvwdmzykggcwnoc.supabase.co/functions/v1/drive-hub';
export const INSTANCIAS_KEY = 'drive_hub_instances';
export const ESTADO_TTL_MS = 15 * 60_000;
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';

const INSTANCIA = /^https:\/\/[a-z0-9]{10,40}\.supabase\.co$/;

export const instanciaValida = (valor: unknown): valor is string =>
  typeof valor === 'string' && INSTANCIA.test(valor);

export const hubDaInstancia = (env: (nome: string) => string | undefined) => env('DRIVE_HUB_URL') || HUB_PADRAO;

export const instanciaAtual = (env: (nome: string) => string | undefined) =>
  (env('SUPABASE_URL') ?? '').replace(/\/$/, '');

/** O hub é a instância cujo endereço é o dele. */
export const eHub = (hub: string, instancia: string) => hub.startsWith(`${instancia}/`);

export function instanciaAutorizada(instancia: string, hub: string, lista: unknown): boolean {
  if (!instanciaValida(instancia)) return false;
  return eHub(hub, instancia) || (Array.isArray(lista) && lista.includes(instancia));
}

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function assinar(segredo: string, texto: string): Promise<string> {
  const chave = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(texto))));
}

function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}

/** Credencial da instância no hub. Vem na conexão e não precisa de cadastro. */
export const tokenDaInstancia = (segredo: string, instancia: string) => assinar(segredo, `instancia:${instancia}`);

export async function tokenConfere(segredo: string, instancia: string, token: unknown): Promise<boolean> {
  return typeof token === 'string' && iguais(await tokenDaInstancia(segredo, instancia), token);
}

export async function selarEstado(
  segredo: string,
  dados: { instancia: string; state: string; expira: number },
): Promise<string> {
  const corpo = base64Url(new TextEncoder().encode(JSON.stringify(dados)));
  return `${corpo}.${await assinar(segredo, `estado:${corpo}`)}`;
}

export async function abrirEstado(
  segredo: string,
  selado: string,
  agora: number,
): Promise<{ instancia: string; state: string } | null> {
  const [corpo, assinatura] = selado.split('.');
  if (!corpo || !assinatura || !iguais(await assinar(segredo, `estado:${corpo}`), assinatura)) return null;
  const texto = atob(corpo.replace(/-/g, '+').replace(/_/g, '/'));
  const dados = JSON.parse(texto) as { instancia?: unknown; state?: unknown; expira?: unknown };
  if (!instanciaValida(dados.instancia) || typeof dados.state !== 'string') return null;
  return Number(dados.expira) > agora ? { instancia: dados.instancia, state: dados.state } : null;
}

export function urlDoGoogle(entrada: {
  clientId: string;
  hub: string;
  escopo: string;
  selado: string;
  challenge: string;
}): string {
  const url = new URL(GOOGLE_AUTH);
  url.searchParams.set('client_id', entrada.clientId);
  url.searchParams.set('redirect_uri', entrada.hub);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', entrada.escopo);
  // sem offline + consent o Google pode não devolver refresh token
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', entrada.selado);
  url.searchParams.set('code_challenge', entrada.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/** Volta para a function google-drive da instância que começou. */
export function voltaParaInstancia(instancia: string, state: string, code: string | null, erro: string | null): string {
  const url = new URL(`${instancia}/functions/v1/google-drive`);
  url.searchParams.set('state', state);
  if (code) url.searchParams.set('code', code);
  if (erro) url.searchParams.set('error', erro);
  return url.toString();
}
