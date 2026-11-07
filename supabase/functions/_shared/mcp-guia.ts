// _shared/mcp-guia.ts — o que o Claude da pessoa precisa saber para conduzir o produto:
// como guiar a conversa (`GUIA_DO_CONECTOR`) e o que dá para fazer nesta instância
// (`capacidades`). O catálogo é puro: quem lê o estado real é o mcp-server.

export const GUIA_DO_CONECTOR = `Você opera a Automação de Redes Sociais para a pessoa até ela chegar ao resultado.

1. Entenda o objetivo. Se ela não disser, pergunte o que quer alcançar e para quem.
2. Chame o_que_posso_fazer antes de propor. Só ofereça o que está disponível; diga o que falta conectar.
3. Pergunte uma coisa de cada vez, e só o que faltar: formato, tema, avatar, voz, duração, modelo. Se a marca ou o acervo responderem, use marca_ler e acervo_buscar.
4. Recomende uma opção com o motivo, em vez de listar tudo.
5. Antes de gastar, chame a ferramenta sem aceite. Mostre provedor, modelo e custo. Custo nulo = preço desconhecido, cobrado na conta do provedor.
6. Só envie o aceite depois de um sim claro a esse custo. Mudou o pedido, faça a prévia de novo.
7. Acompanhe com video_andamento ou avatar_estado, entregue o resultado e sugira o próximo passo.

Regras:
- Aprovar, agendar e publicar acontecem só na tela do produto. Tudo daqui nasce como rascunho.
- Mudança que não altera a fala nunca refaz o vídeo: corte, legenda, efeito, música e manchete vão por video_abrir e video_aplicar ou video_render.
- Filas da tela, cada uma com receita: conteudo_pedidos (Criar), slide_pedidos (mudar um slide; entregue em slide_entregar), roteiro_pedidos (roteiro, plano, briefing, fala ou cena; entregue em roteiro_entregar), montagem_pedidos (montar e legendar vídeo de cenas; entregue em montagem_entregar). O que a pessoa escreveu manda; a marca é contexto. Pronto o vídeo do avatar, o plano volta em video_pedidos.
- Precisou da pessoa (login, chave, cena ao vivo, decisão)? Pergunte em roteiro_mensagem ou video_mensagem com aguardar_pessoa true e pare; a resposta volta no pedido.
- Para carrossel, escreva você mesmo: carrossel_criar sem conteúdo devolve a receita. O conector nunca usa API paga. Use só fotos reais que a marca pode publicar e diga de onde vieram.
- Foto ou voz de outra pessoa só com autorização dela.
- Nunca peça nem mostre chaves: conexões são feitas pela pessoa em Integrações.`;

export interface EstadoDaInstancia {
  conexoes: Record<'heygen' | 'higgsfield' | 'replicate' | 'elevenlabs', boolean>;
  drive_bloqueia: boolean;
  /** Tipos de canal ligados. */
  canais: string[];
  avatares: number;
  vozes: number;
}

export interface Capacidade {
  id: string;
  o_que_faz: string;
  ferramentas: string[];
  perguntar: string[];
  disponivel: boolean;
  falta: string[];
}

type Conexao = keyof EstadoDaInstancia['conexoes'];
const NOME: Record<Conexao, string> = {
  heygen: 'HeyGen', higgsfield: 'Higgsfield', replicate: 'Replicate', elevenlabs: 'ElevenLabs',
};

interface Definicao {
  id: string;
  o_que_faz: string;
  ferramentas: string[];
  perguntar: string[];
  /** Precisa de todas. */
  exige?: Conexao[];
  /** Precisa de pelo menos uma. */
  exige_uma?: Conexao[];
  /** Gera material novo: a trava do Drive vale. */
  gera?: boolean;
  falta_extra?: (estado: EstadoDaInstancia) => string[];
}

const semApresentador = (e: EstadoDaInstancia) => (e.avatares ? [] : ['Um apresentador: crie com avatar_criar.']);

const DEFINICOES: Definicao[] = [
  {
    id: 'conteudo', o_que_faz: 'Post, carrossel, stories, roteiro de Reel e textos para X, Threads, LinkedIn e Facebook, na voz da marca.',
    ferramentas: ['gerar_conteudo', 'carrossel_criar', 'pecas_listar', 'carrossel_ver', 'carrossel_fotos'], perguntar: ['tema', 'canais'], gera: true,
    falta_extra: (e) => (e.canais.length ? [] : ['Um canal ligado em Marca > Canais.']),
  },
  {
    id: 'slide_editar', o_que_faz: 'Mudar um slide de uma peça pronta pelo pedido da pessoa na Biblioteca, sem refazer o resto.',
    ferramentas: ['slide_pedidos', 'slide_entregar'], perguntar: [],
  },
  {
    id: 'roteiro', o_que_faz: 'Escrever o que cada ferramenta de vídeo precisa, no formato do modelo escolhido: roteiro e plano do avatar, briefing das cenas, ideia do Video Agent, fala nova, instrução de cenário ou de pessoa.',
    ferramentas: ['roteiro_pedidos', 'roteiro_andamento', 'roteiro_mensagem', 'roteiro_entregar'], perguntar: [],
  },
  {
    id: 'imagem', o_que_faz: 'Imagem de IA avulsa ou para uma peça.', ferramentas: ['imagem_gerar'],
    perguntar: ['o que a imagem mostra'], gera: true,
  },
  {
    id: 'video_avatar', o_que_faz: 'Um avatar da biblioteca HeyGen ou seu fala o roteiro.', ferramentas: ['avatar_biblioteca', 'video_criar'],
    perguntar: ['roteiro', 'quem apresenta', 'voz'], exige: ['heygen'], gera: true,
  },
  {
    id: 'video_foto', o_que_faz: 'A foto de um apresentador fala o roteiro.', ferramentas: ['video_criar'],
    perguntar: ['roteiro', 'apresentador', 'voz'], exige_uma: ['heygen', 'replicate'], gera: true, falta_extra: semApresentador,
  },
  {
    id: 'video_agente', o_que_faz: 'Só a ideia: o HeyGen escreve, monta e aplica a marca.', ferramentas: ['video_criar'],
    perguntar: ['ideia do vídeo'], exige: ['heygen'], gera: true,
  },
  {
    id: 'video_cenas', o_que_faz: 'Vídeo de cenas geradas, com narração, trilha e legenda.', ferramentas: ['video_criar'],
    perguntar: ['objetivo', 'público', 'mensagem', 'número-herói', 'tom', 'fala final', 'duração', 'modelo'],
    exige: ['elevenlabs'], exige_uma: ['higgsfield', 'replicate'], gera: true,
  },
  {
    id: 'video_apresentador', o_que_faz: 'Vídeo de cenas com o apresentador aparecendo nelas.', ferramentas: ['video_criar'],
    perguntar: ['objetivo', 'público', 'mensagem', 'número-herói', 'tom', 'fala final', 'apresentador', 'duração', 'modelo'],
    exige: ['elevenlabs'], exige_uma: ['higgsfield', 'replicate'], gera: true, falta_extra: semApresentador,
  },
  {
    id: 'montagem', o_que_faz: 'Montar e legendar o vídeo de cenas no seu ambiente, quando a instância não tem o Higgsfield.',
    ferramentas: ['montagem_pedidos', 'montagem_entregar'], perguntar: [],
  },
  {
    id: 'video_melhorar', o_que_faz: 'Em um vídeo pronto de até 30 s: mudar a fala, traduzir, mudar estilo ou cenário, trocar a pessoa, pôr legenda.',
    ferramentas: ['video_listar', 'video_melhorar'], perguntar: ['qual vídeo', 'o que mudar'], exige_uma: ['heygen', 'replicate', 'elevenlabs'], gera: true,
  },
  {
    id: 'video_editar', o_que_faz: 'Cortes, ritmo, legenda, manchete, dado, imagem, tela dividida e música, sem refazer o vídeo.',
    ferramentas: ['video_listar', 'video_abrir', 'video_ver', 'video_anexar', 'video_aplicar', 'video_render', 'video_mensagem', 'video_entregar'],
    perguntar: ['qual vídeo', 'o que mudar'], exige: ['higgsfield'], gera: true,
  },
  {
    id: 'video_corrigir_fala', o_que_faz: 'Refaz um vídeo de avatar quando o que ele fala precisa mudar.', ferramentas: ['video_refazer'],
    perguntar: ['qual vídeo', 'o que trocar'], exige: ['heygen'], gera: true,
  },
  {
    id: 'avatar', o_que_faz: 'Criar um apresentador por descrição ou por foto.', ferramentas: ['avatar_criar', 'avatar_estado'],
    perguntar: ['nome', 'descrição ou foto'], exige: ['heygen'], gera: true,
  },
  {
    id: 'voz', o_que_faz: 'Criar voz por descrição, escolher na biblioteca ou importar um Voice ID.', ferramentas: ['voz_biblioteca', 'voz_criar'],
    perguntar: ['como a voz deve soar'], exige_uma: ['elevenlabs', 'heygen'], gera: true,
  },
  {
    id: 'marca_e_acervo', o_que_faz: 'Ler a marca, buscar no acervo e guardar material novo.', ferramentas: ['marca_ler', 'acervo_buscar', 'acervo_adicionar'],
    perguntar: [],
  },
];

/** Só pela tela do produto: dependem de envio de arquivo ou de decisão humana. */
export const SO_NA_TELA = [
  'Aprovar, agendar e publicar.',
  'Clonar voz e criar Digital Twin: exigem gravação enviada e consentimento da pessoa.',
  'Enviar vídeo próprio para melhorar. Pelo conector, só vídeos que já estão no produto.',
  'Reel da Biblioteca com aprovação de quadros. Pelo conector, use o roteiro da peça em video_criar.',
  'Conectar integrações e o Google Drive.',
];

/** Cada capacidade com o que falta nesta instância. */
export function capacidades(estado: EstadoDaInstancia): Capacidade[] {
  return DEFINICOES.map((d) => {
    const falta = [
      ...(d.exige ?? []).filter((c) => !estado.conexoes[c]).map((c) => `Conectar ${NOME[c]} em Integrações.`),
      ...(d.exige_uma?.length && !d.exige_uma.some((c) => estado.conexoes[c])
        ? [`Conectar ${d.exige_uma.map((c) => NOME[c]).join(' ou ')} em Integrações.`]
        : []),
      ...(d.gera && estado.drive_bloqueia ? ['Conectar o Google Drive em Integrações.'] : []),
      ...(d.falta_extra?.(estado) ?? []),
    ];
    return {
      id: d.id, o_que_faz: d.o_que_faz, ferramentas: d.ferramentas, perguntar: d.perguntar,
      disponivel: falta.length === 0, falta,
    };
  });
}
