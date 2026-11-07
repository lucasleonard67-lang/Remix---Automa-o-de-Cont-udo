// _shared/conector-interno.ts — o conector MCP chamando edges que exigem administrador.
//
// O token do conector só vive em mcp-server. Para reaproveitar avatar-studio e
// generate-image, ele chama com x-cron-secret, o mesmo segredo do video-edit, e diz
// qual administrador responde pela ação. O segredo nunca sai do servidor, e o
// usuário informado precisa ser admin: sem isso a chamada volta ao caminho do JWT.

export const CONECTOR_USUARIO = 'x-conector-usuario';

/** O que o conector pode pedir ao avatar-studio. Fora da lista, 403. */
export const ACOES_DO_CONECTOR: readonly string[] = [
  'create', 'heygen_looks', 'heygen_photo_avatar', 'heygen_prompt_avatar', 'heygen_status',
  'voice_options', 'voice_design', 'voice_design_save', 'voice_library', 'voice_library_add', 'voice_import',
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Cliente = {
  rpc(nome: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error?: unknown }>;
};

function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}

/** Id do administrador quando a chamada veio mesmo do conector; senão, null. */
export async function usuarioDoConector(req: Request, service: Cliente): Promise<string | null> {
  const enviado = req.headers.get('x-cron-secret');
  const usuario = req.headers.get(CONECTOR_USUARIO) ?? '';
  if (!enviado || !UUID_RE.test(usuario)) return null;
  const { data: segredo } = await service.rpc('get_vault_secret', { _name: 'VIDEO_CRON_SECRET' });
  if (typeof segredo !== 'string' || !segredo || !iguais(enviado, segredo)) return null;
  const { data: admin } = await service.rpc('has_role', { _user_id: usuario, _role: 'admin' });
  return admin === true ? usuario : null;
}
