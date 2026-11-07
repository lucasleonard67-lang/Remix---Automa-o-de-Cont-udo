// _shared/mcp-anotacoes.ts — título e natureza de cada ferramenta, como o diretório
// de conectores do Claude exige. Ferramenta nova sem entrada aqui reprova no teste.

type Anotacao = [titulo: string, soLeitura: boolean];

export const ANOTACOES: Record<string, Anotacao> = {
  o_que_posso_fazer: ['Ver o que dá para fazer', true],
  marca_ler: ['Ler a marca', true],
  acervo_buscar: ['Buscar no acervo', true],
  acervo_adicionar: ['Adicionar ao acervo', false],
  pecas_listar: ['Listar peças', true],
  gerar_conteudo: ['Gerar conteúdo', false],
  conteudo_pedidos: ['Ver pedidos de conteúdo', false],
  fotos_gerar: ['Gerar fotos da peça', false],
  artes_pendentes: ['Ver artes pendentes', true],
  arte_enviar: ['Enviar arte da peça', false],
  carrossel_ver: ['Ver carrossel', true],
  carrossel_criar: ['Criar carrossel', false],
  carrossel_fotos: ['Colocar fotos no carrossel', false],
  imagem_gerar: ['Gerar imagem', false],
  video_criar: ['Criar vídeo', false],
  video_melhorar: ['Melhorar vídeo', false],
  video_andamento: ['Ver andamento do vídeo', true],
  video_listar: ['Listar vídeos', true],
  video_pedidos: ['Ver pedidos de edição', false],
  video_anexar: ['Anexar arquivo ao vídeo', false],
  video_abrir: ['Abrir vídeo para editar', false],
  video_ver: ['Ver edição do vídeo', false],
  video_aplicar: ['Aplicar edição', false],
  video_render: ['Renderizar edição', false],
  video_entregar: ['Entregar vídeo editado', false],
  video_refazer: ['Refazer vídeo', false],
  avatar_biblioteca: ['Ver avatares', true],
  avatar_criar: ['Criar avatar', false],
  avatar_estado: ['Ver estado do avatar', true],
  voz_biblioteca: ['Ver vozes', true],
  voz_criar: ['Criar voz', false],
  roteiro_pedidos: ['Ver pedidos de escrita', false],
  roteiro_andamento: ['Avisar andamento do roteiro', false],
  roteiro_mensagem: ['Falar com a pessoa no roteiro', false],
  roteiro_entregar: ['Entregar texto escrito', false],
  slide_pedidos: ['Ver pedidos de slide', false],
  slide_entregar: ['Entregar edição do slide', false],
  montagem_pedidos: ['Ver pedidos de montagem', false],
  montagem_entregar: ['Entregar vídeo montado', false],
  video_mensagem: ['Falar com a pessoa no vídeo', false],
};

/** Nada aqui apaga material da pessoa: tudo nasce como rascunho. */
export function comAnotacoes<T extends { name: string }>(ferramentas: readonly T[]) {
  return ferramentas.map((ferramenta) => {
    const [title, soLeitura] = ANOTACOES[ferramenta.name] ?? [ferramenta.name, false];
    return {
      ...ferramenta,
      title,
      annotations: { title, readOnlyHint: soLeitura, destructiveHint: false, openWorldHint: !soLeitura },
    };
  });
}
