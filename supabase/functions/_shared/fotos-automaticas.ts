// _shared/fotos-automaticas.ts — toda peça de card nasce pedindo as próprias fotos.
//
// Carrossel sai com as fotos que o texto pediu, stories com foto em toda tela e post com
// uma foto, sem botão. A chamada
// entra em generate-image como conector, então usa a IA inclusa e nunca chave de API.
// A falha aqui não derruba a peça: o botão Gerar fotos continua na tela para tentar de novo.

import { CONECTOR_USUARIO } from './conector-interno.ts';

interface Unidade {
  index: number;
  visual?: string;
  photo_promoted?: boolean;
  image_path?: string;
}

const CAMPO: Record<string, 'slides' | 'frames' | 'card'> = {
  instagram_carousel: 'slides',
  instagram_stories: 'frames',
  instagram_post: 'card',
};

export type AspectoDaFoto = '4:5' | '1:1' | '9:16' | '16:9' | '4:3';

/**
 * Formato em que a foto é exibida no layout editorial, para nunca sair cortada: o miolo
 * e o post têm caixa 16:9; a capa ocupa os 61% de cima do card.
 */
export function aspectoDaFoto(campo: 'slides' | 'frames' | 'card', indice: number): AspectoDaFoto {
  if (campo === 'card' || indice !== 0) return '16:9';
  return campo === 'slides' ? '4:3' : '1:1';
}

/** No carrossel, a capa e onde o texto pediu foto; no stories e no post, tudo que não é gráfico. */
export function unidadesSemFoto(canal: string, adapted: Record<string, unknown>): number[] {
  const campo = CAMPO[canal];
  if (!campo) return [];
  const valor = adapted[campo];
  const unidades = (campo === 'card' ? [valor] : valor) as Unidade[] | undefined;
  if (!Array.isArray(unidades)) return [];
  return unidades
    .filter((u) => u && !u.image_path && (
      campo === 'slides'
        ? u.index === 0 || u.visual === 'photo' || u.photo_promoted === true
        : u.visual !== 'chart'
    ))
    .map((u) => u.index);
}

type Cliente = {
  rpc(nome: string, args: Record<string, unknown>): PromiseLike<{ data: unknown }>;
  from(tabela: string): {
    select(colunas: string): {
      eq(coluna: string, valor: string): {
        order(coluna: string, opcoes: { ascending: boolean }): {
          limit(n: number): { maybeSingle(): PromiseLike<{ data: unknown }> };
        };
      };
    };
  };
};

export async function pedirFotos(
  service: Cliente,
  pecaId: string,
  indices: number[],
  buscar: typeof fetch = fetch,
): Promise<{ ok: boolean; mensagem?: string }> {
  if (!indices.length) return { ok: true };
  const [{ data: segredo }, { data: admin }] = await Promise.all([
    service.rpc('get_vault_secret', { _name: 'VIDEO_CRON_SECRET' }),
    service.from('user_roles').select('user_id').eq('role', 'admin')
      .order('created_at', { ascending: true }).limit(1).maybeSingle(),
  ]);
  const usuario = (admin as { user_id?: string } | null)?.user_id;
  if (typeof segredo !== 'string' || !segredo || !usuario) {
    return { ok: false, mensagem: 'Conector interno sem configuração.' };
  }
  const chave = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const r = await buscar(`${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-image`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', authorization: `Bearer ${chave}`, apikey: chave,
      'x-cron-secret': segredo, [CONECTOR_USUARIO]: usuario,
    },
    body: JSON.stringify({ piece_id: pecaId, scope: 'slides', slide_indexes: indices, composition: 'inline' }),
  });
  if (r.ok) {
    await r.body?.cancel();
    return { ok: true };
  }
  const corpo = await r.json().catch(() => ({})) as { error?: { message?: string } };
  return { ok: false, mensagem: corpo.error?.message ?? `generate-image ${r.status}` };
}
