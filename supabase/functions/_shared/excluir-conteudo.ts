// _shared/excluir-conteudo.ts — o que a exclusão apaga e quando ela espera, sem rede.
// Item do Contexto: linha, trechos, arquivo e cópia no Drive. Peça: linha, arquivos e cópias no Drive. Vídeo: arquivos e cópias; o registro fica
// invisível para o gasto seguir no centro de custos. O post publicado segue na rede.

export const ARQUIVOS_BUCKET = 'renders';
export const CONTEXTO_BUCKET = 'context-files';
export const POSTS_ABERTOS = ['pending', 'scheduled', 'publishing'];
export const EDICOES_ABERTAS = ['analyzing', 'queued', 'rendering', 'checking'];
export const JOBS_ENCERRADOS = ['done', 'failed', 'canceled'];

interface PecaComArquivos {
  render_path?: string | null;
  adapted_content?: Record<string, unknown> | null;
}

interface Unidade {
  image_path?: unknown;
  path?: unknown;
}

const texto = (valor: unknown): string[] => (typeof valor === 'string' && valor.trim() ? [valor] : []);
const lista = (valor: unknown): Unidade[] => (Array.isArray(valor) ? valor as Unidade[] : []);

/** Tudo o que a peça guarda no bucket, sem repetir. */
export function arquivosDaPeca(peca: PecaComArquivos): string[] {
  const a = peca.adapted_content ?? {};
  const unidades = [...lista(a.slides), ...lista(a.frames), ...lista([a.card])];
  return [...new Set([
    ...texto(peca.render_path),
    ...texto(a.image_path),
    ...texto((a.video as Unidade | undefined)?.path),
    ...unidades.flatMap((u) => texto(u?.image_path)),
    ...lista(a.slide_renders).flatMap((r) => texto(r?.path)),
  ])];
}

/** Peças irmãs dividem arquivo: só sai o que nenhuma outra usa. */
export function arquivosExclusivos(peca: PecaComArquivos, outras: PecaComArquivos[]): string[] {
  const emUso = new Set(outras.flatMap(arquivosDaPeca));
  return arquivosDaPeca(peca).filter((caminho) => !emUso.has(caminho));
}

export function pecaOcupada(peca: PecaComArquivos, projetoAberto: boolean): string | null {
  const lote = peca.adapted_content?.slide_images_job as { status?: string } | undefined;
  if (lote?.status === 'running') return 'As imagens desta peça ainda estão sendo geradas.';
  return projetoAberto ? 'O vídeo desta peça ainda está sendo gerado.' : null;
}

interface JobParaExcluir {
  status: string;
  artifacts?: { instagram?: { status?: string }; tiktok?: { status?: string } } | null;
}

export function videoOcupado(job: JobParaExcluir, emUso: { edicaoAberta: boolean; outroVideo: boolean }): string | null {
  if (!JOBS_ENCERRADOS.includes(job.status)) return 'Cancele a produção antes de excluir.';
  const envios = [job.artifacts?.instagram?.status, job.artifacts?.tiktok?.status];
  if (envios.some((s) => s && POSTS_ABERTOS.includes(s))) return 'Espere o envio terminar antes de excluir.';
  if (emUso.edicaoAberta) return 'Espere a edição deste vídeo terminar antes de excluir.';
  if (emUso.outroVideo) return 'Outro vídeo ou peça ainda usa este arquivo.';
  return null;
}

/** Nunca sobe além da pasta do próprio item: um id vazio apagaria o bucket. */
export function pastasDoVideo(jobId: string, edicoes: string[]): string[] {
  return [`director/${jobId}/`, ...edicoes.map((id) => `edits/${id}/`)].filter((p) => !p.includes('//'));
}
