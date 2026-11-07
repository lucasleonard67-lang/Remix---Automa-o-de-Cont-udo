// _shared/mcp-arte.ts — a arte das peças feita pelo Claude da pessoa, pelo conector.
//
// A assinatura não gera imagem em pixels: o Claude desenha em SVG, manda por arte_enviar
// e aqui vira PNG na unidade da peça. O texto do slide é do layout, a arte não leva letras.

import { extrairSvg, svgParaPng } from './claude-arte.ts';
import { comUnidade, unidadesDaPeca } from './editar-slide.ts';
import { unidadesSemFoto } from './fotos-automaticas.ts';
import type { ChannelType } from './types.ts';

const BUCKET = 'renders';
const SVG_MAX = 300_000;
const CANAIS: ChannelType[] = ['instagram_carousel', 'instagram_stories', 'instagram_post'];
const JANELA_MS = 14 * 24 * 3600 * 1000;

interface Peca {
  id: string;
  status: string;
  channel_type: ChannelType;
  adapted_content: Record<string, unknown>;
  updated_at: string;
}

/** O mesmo formato da caixa onde a arte é exibida: arte em outro formato sai cortada ou com faixas. */
export function tamanhoDaArte(canal: ChannelType, indice: number): { largura: number; altura: number } {
  if (indice === 0 && canal === 'instagram_carousel') return { largura: 1200, altura: 900 };
  if (indice === 0 && canal === 'instagram_stories') return { largura: 1080, altura: 1080 };
  return { largura: 1200, altura: 675 };
}

export function artesDaPeca(peca: Pick<Peca, 'id' | 'channel_type' | 'adapted_content'>) {
  const unidades = unidadesDaPeca(peca.adapted_content, peca.channel_type);
  return unidadesSemFoto(peca.channel_type, peca.adapted_content).map((indice) => {
    const unidade = unidades.find((u) => u.index === indice);
    return {
      peca_id: peca.id,
      indice,
      ...tamanhoDaArte(peca.channel_type, indice),
      texto: unidade?.text?.slice(0, 300) ?? '',
      cena: unidade?.image_brief ?? null,
    };
  });
}

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente do Supabase sem tipos gerados no Deno
type Service = any;

export async function artesPendentes(service: Service) {
  const desde = new Date(Date.now() - JANELA_MS).toISOString();
  const { data, error } = await service.from('content_pieces')
    .select('id, channel_type, adapted_content').eq('status', 'draft').in('channel_type', CANAIS)
    .gte('created_at', desde).order('created_at', { ascending: false }).limit(10);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Peca[]).flatMap(artesDaPeca);
}

export async function enviarArte(service: Service, args: Record<string, unknown>): Promise<Record<string, unknown> | string> {
  const indice = Number(args.indice);
  const bruto = String(args.svg ?? '');
  if (bruto.length > SVG_MAX) return 'SVG grande demais. Simplifique o desenho.';
  const svg = extrairSvg(bruto);
  if (!svg) return 'Envie um SVG completo, sem imagem externa nem script.';

  const { data } = await service.from('content_pieces')
    .select('id, status, channel_type, adapted_content, updated_at').eq('id', String(args.peca_id ?? '')).maybeSingle();
  const peca = data as Peca | null;
  if (!peca) return 'Peça não encontrada.';
  if (peca.status !== 'draft') return 'Só dá para mudar a arte de uma peça em rascunho.';
  const unidade = unidadesDaPeca(peca.adapted_content, peca.channel_type).find((u) => u.index === indice);
  if (!unidade) return 'Esse slide não existe.';

  const { largura } = tamanhoDaArte(peca.channel_type, indice);
  const png = await svgParaPng(svg, largura);
  const caminho = `${peca.id}/claude-${indice}-${Date.now()}.png`;
  const { error: envio } = await service.storage.from(BUCKET).upload(caminho, png, { contentType: 'image/png', upsert: true });
  if (envio) return `Não deu para guardar a arte: ${envio.message}`;

  const nova = { ...unidade, image_path: caminho, ...(indice === 0 && peca.channel_type !== 'instagram_post' ? {} : { visual: 'photo' as const, photo_promoted: true }) };
  const { data: salvo, error } = await service.from('content_pieces')
    .update({ adapted_content: comUnidade(peca.adapted_content, peca.channel_type, nova) })
    .eq('id', peca.id).eq('updated_at', peca.updated_at).select('id');
  if (error) return `Não deu para gravar: ${error.message}`;
  if (!salvo?.length) return 'A peça mudou agora. Envie de novo.';
  return { gravado: true, caminho };
}
