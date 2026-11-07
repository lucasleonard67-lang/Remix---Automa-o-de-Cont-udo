// mcp-oauth — regras do "Conectar" pelo Claude (spec MCP 2025-06-18, OAuth 2.1 com
// PKCE e registro dinâmico). Só cliente público, só S256, e o retorno só vai para o
// próprio Claude: quem autoriza é um administrador, então redirecionar para
// qualquer site entregaria o acesso da marca.

export const CODE_MINUTES = 5;
/** Endereços exatos: um redirecionamento aberto em subdomínio entregaria o código. */
const CLAUDE_CALLBACKS = ['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'];
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export const validVerifier = (value: unknown): value is string => typeof value === 'string' && VERIFIER.test(value);
export const validChallenge = (value: unknown): value is string => typeof value === 'string' && CHALLENGE.test(value);

export const isClaudeCallback = (uri: unknown) => typeof uri === 'string' && CLAUDE_CALLBACKS.includes(uri);

/** Prévia do Lovable não vale como endereço do app. */
export const isPreviewOrigin = (origin: string) => /lovableproject\.com$|id-preview--/.test(origin);

export function validRedirect(uri: unknown): uri is string {
  if (typeof uri !== 'string') return false;
  try {
    const url = new URL(uri);
    if (url.hash || url.username || url.password) return false;
    if (LOCAL_HOSTS.includes(url.hostname)) return url.protocol === 'http:' || url.protocol === 'https:';
    return CLAUDE_CALLBACKS.includes(uri);
  } catch {
    return false;
  }
}

export const resourceMetadata = (base: string) => ({
  resource: base,
  authorization_servers: [base],
  bearer_methods_supported: ['header'],
});

export const serverMetadata = (base: string) => ({
  issuer: base,
  authorization_endpoint: `${base}/authorize`,
  token_endpoint: `${base}/token`,
  registration_endpoint: `${base}/register`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  scopes_supported: ['content-engine'],
  // campos exigidos por quem descobre pelo caminho do openid-configuration, o único
  // que este host permite servir; o conector não emite id_token
  jwks_uri: `${base}/jwks`,
  subject_types_supported: ['public'],
  id_token_signing_alg_values_supported: ['RS256'],
});

export const wwwAuthenticate = (base: string) =>
  `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** code_challenge = BASE64URL(SHA256(verifier)), sem preenchimento. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function validAppOrigin(origin: unknown): origin is string {
  if (typeof origin !== 'string') return false;
  try {
    const url = new URL(origin);
    return url.origin === origin && (url.protocol === 'https:' || LOCAL_HOSTS.includes(url.hostname));
  } catch {
    return false;
  }
}
