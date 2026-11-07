// _shared/mcp-photos.ts — fotos escolhidas pelo cliente MCP para um carrossel.
//
// O padrão da casa pede foto real na capa e em até 3 slides do miolo. Pelo
// conector, quem escolhe a foto manda a URL: baixamos, conferimos que é imagem
// e gravamos no mesmo lugar das fotos geradas. Foto de IA continua na
// Biblioteca, onde o modelo e o custo aparecem antes de gerar.

import { isPublicDestination, type ResolveDns } from './link-reader.ts';

export const MAX_FOTOS_POR_CHAMADA = 10;
export const MAX_FOTO_BYTES = 10 * 1024 * 1024;

/**
 * URL que o servidor pode buscar: https público, nunca rede interna (nem por
 * DNS). O download confere de novo pelo safeFetch.
 */
export async function erroDaUrl(bruta: string, resolve?: ResolveDns | null): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(bruta);
  } catch {
    return 'URL inválida.';
  }
  if (url.protocol !== 'https:') return 'Use uma URL https.';
  const publica = await isPublicDestination(url.toString(), { httpsOnly: true, resolve });
  return publica ? null : 'URL de rede interna não é aceita.';
}

/** Tipo real pelos primeiros bytes: o Content-Type do servidor alheio não vale. */
export function tipoDaImagem(b: Uint8Array): { ext: string; contentType: string } | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { ext: 'png', contentType: 'image/png' };
  }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { ext: 'jpg', contentType: 'image/jpeg' };
  }
  const ascii = (de: number, ate: number) => String.fromCharCode(...b.slice(de, ate));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    return { ext: 'webp', contentType: 'image/webp' };
  }
  return null;
}

interface SlideComFoto {
  index: number;
  visual?: string;
  image_path?: string;
  photo_promoted?: boolean;
  cover_art_rendered?: boolean;
}

/**
 * Põe cada foto no slide. Capa é sempre foto pura (o chassi desenha o texto);
 * no miolo a foto precisa da promoção para aparecer, e o slide de gráfico
 * continua gráfico.
 */
export function comFotos<T extends SlideComFoto>(slides: T[], fotos: Map<number, string>): T[] {
  return slides.map((slide, posicao) => {
    const path = fotos.get(slide.index);
    if (!path) return slide;
    if (posicao === 0) return { ...slide, image_path: path, cover_art_rendered: false };
    return {
      ...slide,
      image_path: path,
      photo_promoted: true,
      visual: slide.visual === 'chart' ? 'chart' : 'photo',
    };
  });
}
