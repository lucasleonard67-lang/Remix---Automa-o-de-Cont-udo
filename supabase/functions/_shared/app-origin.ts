// _shared/app-origin.ts — para qual origem do app um OAuth pode devolver a pessoa.
// Guarda de open-redirect: a origem vem do navegador. Mesma regra documentada em
// higgsfield-oauth: localhost, domínios do Lovable e o que APP_ORIGIN listar.

const LOVABLE_DOMAINS = ['lovable.app', 'lovableproject.com', 'lovable.dev'];

function extraOrigins(): string[] {
  return (Deno.env.get('APP_ORIGIN') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      try {
        return [new URL(part).origin];
      } catch {
        return [];
      }
    });
}

export function allowedAppOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) return parsed.origin;
  if (parsed.protocol !== 'https:') return null;
  const lovable = LOVABLE_DOMAINS.some((domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`));
  return lovable || extraOrigins().includes(parsed.origin) ? parsed.origin : null;
}
