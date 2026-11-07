// _shared/help-content.ts — a fonte única da ajuda do app. Dois leitores, um
// arquivo: a página Ajuda (src/routes/_app/ajuda.tsx, via src/lib/help.ts) e o
// assistente flutuante (edge function assistant-chat).
//
// Uma entrada por tela. `menu` é o item do menu lateral (src/components/app-nav.ts)
// e agrupa as seções da página; `caminho` existe quando a tela fica dentro de
// outra. Os rótulos entre aspas são os da tela: mudou lá, muda aqui. O teste
// src/lib/help-content.test.ts confere rotas, menus e o formato dos textos.
//
// Sem imports (a edge function não enxerga `src/`). Busca por palavras-chave
// simples: sem IA, sem banco.

export interface HelpEntry {
  rota: string;
  /** Item do menu lateral (não renomear: é o que o usuário vê). */
  menu: string;
  /** Caminho para chegar, quando a tela está dentro de outra. */
  caminho?: string;
  /** O que a tela faz, em uma frase. */
  resumo: string;
  passos: string[];
  /** "Sintoma: o que fazer." — a página põe o sintoma em negrito. */
  erros: string[];
  palavras: string[];
  /** Só administradores enxergam. */
  admin?: boolean;
}

export interface Duvida {
  pergunta: string;
  resposta: string;
  palavras: string[];
}

export const HELP: HelpEntry[] = [
  // ── Produção ───────────────────────────────────────────────────────────────
  {
    rota: '/',
    menu: 'Início',
    resumo: 'O seu dia numa tela: o que está em produção, os números das redes e as ideias de hoje.',
    passos: [
      'Clique em “Criar conteúdo” e escolha o que criar: Conteúdo estático, Vídeo, Avatar ou Voz.',
      'Enquanto a configuração não termina, “Primeiros passos” mostra o que falta. “Continuar” abre o próximo passo.',
      'Em Produção, “Revisar” leva ao que espera você e “Retomar” segue uma produção que parou.',
      'Em “Ideias de hoje”, pautas do Radar prontas para virar conteúdo.',
      'Custos mostra o gasto do mês em vídeo e o teto (só administradores).',
    ],
    erros: [
      'Números das redes não aparecem: as redes não estão conectadas. Um administrador conecta em Ajustes → Integrações → Zernio.',
      'Sem alcance na semana: os números voltam a aparecer depois da próxima publicação.',
    ],
    palavras: ['inicio', 'home', 'painel', 'resumo', 'primeiros passos', 'producao', 'custos', 'gasto', 'teto', 'ideias de hoje', 'criar conteudo', 'retomar'],
  },
  {
    rota: '/criar',
    menu: 'Criar',
    resumo: 'Escolha uma sugestão ou escreva o tema e clique em Gerar. Para post, carrossel, stories e texto.',
    passos: [
      'Em “Sugestões para hoje”, a melhor ideia já vem marcada. Para outro assunto, escreva o tema no campo.',
      'Em Formato, escolha o que sai: post, carrossel, stories, X, Threads, LinkedIn ou Facebook. Sem escolha, o sistema decide entre os canais ligados.',
      'Se aparecer “Pesquisa web”, ligue para buscar notícias recentes sobre o tema antes de gerar. Demora mais.',
      'Clique em Gerar. A criação acontece ali mesmo; pode sair da tela que ela continua.',
      'No “Pronto”, abra a peça para revisar e publicar. Ela também fica na Biblioteca, em “Em revisão”.',
    ],
    erros: [
      '“A criação parou”: leia o motivo na tela e clique em “Tentar de novo”.',
      'Gerar bloqueado: falta ativar parte da marca. Clique em “Configurar minha marca” ou peça a um administrador.',
      'Formato com o canal desligado: um administrador clica em “Ligar canal”.',
      'Criação esperando você: escolha um dos ângulos que aparecem na tela.',
    ],
    palavras: ['criar', 'gerar', 'geracao', 'criacao', 'post', 'peca', 'tema', 'sugestoes', 'carrossel', 'stories', 'legenda', 'threads', 'linkedin', 'facebook', 'pesquisa web', 'angulo', 'parou', 'falhou', 'tentar de novo', 'formato'],
  },
  {
    rota: '/biblioteca',
    menu: 'Biblioteca',
    resumo: 'Revise, agende e acompanhe as peças geradas.',
    passos: [
      'Filtre pelo estado: Em revisão, Aprovadas, Agendadas, Publicadas, Rejeitadas ou Arquivadas.',
      'Abra a peça e confira a prévia, o texto e a Revisão, com a nota e se ela está pronta para aprovar.',
      'Clique em Aprovar ou Rejeitar. O motivo da rejeição orienta as próximas gerações.',
      'Para mudar algo, clique em “Gerar nova versão” e diga o que mudar.',
      'Aprovada a peça, marque a data em Agendar e clique em “Publicar agora” ou “Agendar envio”.',
      'Para publicar por fora, use Exportar ou “Copiar texto”. O Calendário mostra o que está agendado.',
    ],
    erros: [
      '“Agendar envio” desligado: marque a data acima antes.',
      'Não publicou: confira a conta de destino em “Trocar conta”. Sem redes conectadas, um administrador conecta o Zernio em Ajustes → Integrações.',
      'Reel sem vídeo: produza o vídeo e publique em Vídeos, no botão “Publicar no Instagram”.',
    ],
    palavras: ['biblioteca', 'revisao', 'em revisao', 'aprovar', 'rejeitar', 'agendar', 'agendadas', 'publicar', 'publicada', 'calendario', 'nova versao', 'exportar', 'png', 'zip', 'copiar texto', 'arquivar', 'excluir', 'nota', 'zernio'],
  },
  {
    rota: '/videos',
    menu: 'Vídeos',
    admin: true,
    resumo: 'Acompanhe, aprove e publique seus vídeos curtos.',
    passos: [
      'Clique em “Gerar novo vídeo” para começar um.',
      'Cada vídeo aparece aqui enquanto é produzido. Quando ele espera você, abra e aprove para seguir.',
      'Pronto o vídeo, clique em “Publicar no Instagram” ou “Publicar no TikTok”.',
    ],
    erros: [
      'Produção parada: abra o vídeo e leia o aviso. Quase sempre é uma aprovação sua ou crédito no provedor; depois, clique em “Retomar produção”.',
    ],
    palavras: ['video', 'videos', 'reel', 'reels', 'cena', 'roteiro', 'narracao', 'quadros', 'aprovar', 'publicar no instagram', 'tiktok', 'retomar', 'producao'],
  },
  {
    rota: '/videos/novo',
    menu: 'Vídeos',
    caminho: 'Vídeos → Gerar novo vídeo',
    admin: true,
    resumo: 'Diga o que você tem e o que quer. O produto escolhe o caminho e mostra custo e tempo antes de gerar.',
    passos: [
      'Em “O que você tem?”, escolha Só a ideia, Minha foto ou Um vídeo meu.',
      'Em “O que você quer?”, escolha o resultado, como “Vídeo de cenas com narração” ou “Traduzir meu vídeo”.',
      'Confira o modelo, o custo e o tempo, e clique em Continuar.',
      'Preencha o que a tela pedir e gere. O vídeo aparece em Vídeos enquanto é produzido.',
    ],
    erros: [
      '“Falta conectar”: clique no link ao lado para conectar o serviço ali mesmo.',
      'Caminho com apresentador bloqueado: cadastre um em Marca → Apresentadores.',
      '“Em preparação”: esse caminho ainda não está disponível. Escolha outro.',
    ],
    palavras: ['novo video', 'gerar novo video', 'ideia', 'foto', 'meu video', 'avatar', 'apresentador', 'traduzir', 'legendas', 'cenario', 'clone', 'custo', 'modelo', 'melhorar'],
  },

  // ── Inteligência ───────────────────────────────────────────────────────────
  {
    rota: '/radar',
    menu: 'Radar',
    resumo: 'Notícias das suas fontes, com nota de marca e de tendência.',
    passos: [
      'As notícias chegam sozinhas a cada 30 minutos. Filtre por status, ordem e fonte, ou busque por palavra.',
      'Clique em “Gerar peça”: a notícia vai para Criar com o tema pronto.',
      'Na aba Fontes, um administrador adiciona, testa ou remove fontes.',
    ],
    erros: [
      'Lista vazia: não há fonte cadastrada. Um administrador clica em “Adicionar fonte” na aba Fontes.',
      'Fonte com erro: abra a aba Fontes e teste a fonte.',
    ],
    palavras: ['radar', 'noticias', 'rss', 'fontes', 'pauta', 'tendencia', 'nicho', 'atualizar agora', 'gerar peca', 'adicionar fonte'],
  },
  {
    rota: '/desempenho',
    menu: 'Desempenho',
    resumo: 'O que os números dizem sobre a sua marca, e o que fazer com isso.',
    passos: [
      'Escolha o período no topo: 7, 30 ou 90 dias. “1 ano” aparece quando já há histórico.',
      'Leia as conclusões de cada bloco: funil, publicação, formato, melhor post, constância e crescimento.',
      'Para ver post a post, clique em “Ver todas as publicações com métricas” e abra um post.',
      'Para comparar com o mercado, um administrador clica em “Adicionar concorrentes”.',
    ],
    erros: [
      'Tela sem números: as redes não estão conectadas. Um administrador clica em “Conectar redes sociais”.',
      'Sem comparação com concorrentes: falta o Apify. Um administrador clica em “Conectar Apify”.',
    ],
    palavras: ['desempenho', 'metricas', 'numeros', 'alcance', 'views', 'seguidores', 'engajamento', 'interacoes', 'periodo', 'concorrentes', 'mercado', 'apify', 'resultado'],
  },

  // ── Identidade ─────────────────────────────────────────────────────────────
  {
    rota: '/marca',
    menu: 'Marca',
    resumo: 'Como a marca fala, o que defende e como aparece. Toda peça segue a versão ativa de cada área.',
    passos: [
      'Abra uma área: Persona, Bandeira, Regras da marca ou Identidade visual.',
      'Edite, clique em “Salvar rascunho” e depois em “Ativar versão”. Só a versão ativa vale para as próximas peças.',
      'Peças já geradas não mudam.',
    ],
    erros: [
      'Mudou e nada aconteceu: faltou clicar em “Ativar versão”.',
      '“Somente leitura”: só administradores editam a marca.',
    ],
    palavras: ['marca', 'persona', 'voz', 'tom', 'bandeira', 'posicionamento', 'regras', 'identidade visual', 'cores', 'fontes', 'logo', 'versao', 'ativar', 'rascunho'],
  },
  {
    rota: '/marca/persona',
    menu: 'Marca',
    caminho: 'Marca → Persona',
    resumo: 'Como a marca fala: tom, vocabulário, opiniões e exemplos que toda peça segue.',
    passos: [],
    erros: [],
    palavras: ['persona', 'tom de voz', 'vocabulario', 'como a marca fala', 'opinioes'],
  },
  {
    rota: '/marca/bandeira',
    menu: 'Marca',
    caminho: 'Marca → Bandeira',
    resumo: 'O que a marca defende: promessa, teses, cliente ideal e mix de peças.',
    passos: [],
    erros: [],
    palavras: ['bandeira', 'estrategia', 'promessa', 'teses', 'cliente ideal', 'mix'],
  },
  {
    rota: '/marca/guardrails',
    menu: 'Marca',
    caminho: 'Marca → Regras da marca',
    resumo: 'O que a marca nunca escreve, quais CTAs usa e a nota mínima para aprovar uma peça.',
    passos: [],
    erros: [
      'Muitas peças “Precisa ser reescrita”: a nota mínima pode estar alta demais para o material do Contexto.',
    ],
    palavras: ['regras', 'regras da marca', 'proibido', 'nunca', 'cta', 'nota minima'],
  },
  {
    rota: '/marca/brand-kit',
    menu: 'Marca',
    caminho: 'Marca → Identidade visual',
    resumo: 'Cores, fontes, logo e fotos que toda arte gerada segue.',
    passos: [],
    erros: ['Artes sem as cores da marca: não há versão ativa. Clique em “Ativar versão”.'],
    palavras: ['identidade visual', 'cores', 'fontes', 'logo', 'fotos', 'arte', 'carrossel'],
  },
  {
    rota: '/contexto',
    menu: 'Marca',
    caminho: 'Marca → Contexto',
    resumo: 'A base que as gerações consultam: transcrições, posts, documentos, cases e ofertas da marca.',
    passos: [
      'Clique em Adicionar e escolha como: colar o texto, enviar um arquivo .txt ou .md, ou colar um link.',
      'Dê um título e clique em “Adicionar ao Contexto”.',
      'O item fica em Processando e passa a Pronto quando já serve às gerações.',
    ],
    erros: [
      'Item em Falhou ou parado em Processando: abra o item e clique em “Processar de novo”.',
      'Peças genéricas: o Contexto está pequeno. Quanto mais material bom, mais as peças soam como a marca.',
    ],
    palavras: ['contexto', 'acervo', 'base de conhecimento', 'transcricao', 'documento', 'case', 'oferta', 'material', 'processar de novo', 'arquivo', 'link'],
  },
  {
    rota: '/marca/canais',
    menu: 'Marca',
    caminho: 'Marca → Canais',
    resumo: 'Onde a marca publica e os limites de cada formato.',
    passos: [
      'Clique em um canal para ligar e ajustar os limites, como o tamanho da legenda e o número de slides. Vale na hora para as próximas peças.',
    ],
    erros: ['Formato não aparece em Criar: o canal está desligado aqui. O Reel nasce desligado.'],
    palavras: ['canais', 'canal', 'instagram', 'stories', 'reel', 'threads', 'linkedin', 'facebook', 'ligar', 'limites', 'slides'],
  },
  {
    rota: '/marca/avatares',
    menu: 'Marca',
    caminho: 'Marca → Apresentadores',
    resumo: 'Quem aparece e fala nos seus vídeos. Cadastre uma vez e escolha na hora de gerar.',
    passos: [
      'Clique em “Criar avatar” e escolha a origem: Da minha foto, Do meu vídeo (clone) ou De uma descrição.',
      'Na hora de gerar o vídeo, escolha o apresentador.',
    ],
    erros: [
      'Vídeo sem ninguém falando: não há apresentador cadastrado. Um administrador clica em “Criar avatar”.',
    ],
    palavras: ['apresentador', 'apresentadores', 'avatar', 'avatares', 'rosto', 'foto', 'clone', 'pessoa'],
  },
  {
    rota: '/marca/vozes',
    menu: 'Marca',
    caminho: 'Marca → Vozes',
    resumo: 'Quem narra os vídeos.',
    passos: [
      'Clique em “Criar voz” e escolha de onde ela vem: Da minha voz, De uma descrição ou Da biblioteca.',
      'Para usar a sua voz, grave lendo o roteiro da tela. O áudio é conferido antes de criar.',
    ],
    erros: [
      '“Conecte o ElevenLabs ou a HeyGen para criar vozes”: um administrador conecta em Ajustes → Integrações.',
    ],
    palavras: ['voz', 'vozes', 'narracao', 'narrador', 'gravar', 'elevenlabs', 'heygen'],
  },

  // ── Administração ──────────────────────────────────────────────────────────
  {
    rota: '/config',
    menu: 'Ajustes',
    admin: true,
    resumo: 'Convide pessoas, escolha os modelos de IA e conecte as integrações.',
    passos: [
      'Usuários: clique em Convidar, informe o e-mail e o papel, Administrador ou Usuário.',
      'IA: em “Quem faz cada etapa”, clique numa etapa para trocar o provedor ou o modelo. Em “Suas chaves de IA”, cole a chave de cada serviço.',
      'Integrações: conecte as redes (Zernio), vídeo e voz, e o seu Claude em “Conectar ao Claude”.',
      'Automação: gatilhos que geram peças todo dia para você revisar.',
      'Instância: dados desta instalação e a demonstração.',
    ],
    erros: [
      'Pessoa convidada não aparece: ela entra na lista depois do primeiro acesso.',
      'Chave recusada: confira o formato indicado no campo e se a chave foi copiada inteira.',
    ],
    palavras: ['ajustes', 'configuracao', 'usuarios', 'convidar', 'papel', 'administrador', 'ia', 'modelo', 'provedor', 'chave', 'integracoes', 'zernio', 'higgsfield', 'elevenlabs', 'replicate', 'heygen', 'apify', 'tavily', 'claude', 'conector', 'instancia', 'demonstracao'],
  },
  {
    rota: '/automacao',
    menu: 'Ajustes',
    caminho: 'Ajustes → Automação',
    admin: true,
    resumo: 'Gatilhos que geram peças todo dia e as deixam em “Em revisão”. Nada vai ao ar sem você.',
    passos: [
      'Clique em “Novo gatilho”: nome, formato, peças por dia (1 a 20) e a fonte do tema: Notícia do Radar, Case do Contexto ou Tema fixo.',
      'O gatilho roda a cada hora até bater a cota do dia. Para gerar já, clique em “Rodar agora”.',
      'Em “Últimos disparos”, veja o que rodou.',
    ],
    erros: ['Gatilho não gerou nada: confira se ele está Ligado e leia o motivo em “Últimos disparos”.'],
    palavras: ['automacao', 'gatilho', 'todo dia', 'automatico', 'rotina', 'rodar agora', 'cota', 'piloto automatico'],
  },
];

/** Perguntas que atravessam as telas. A página mostra em "Dúvidas comuns". */
export const DUVIDAS: Duvida[] = [
  {
    pergunta: 'Alguma coisa é publicada sem mim?',
    resposta: 'Não. Tudo o que é gerado, inclusive pela Automação e pelo seu Claude, chega em “Em revisão” na Biblioteca. Aprovar e publicar só acontecem aqui.',
    palavras: ['publicar sozinho', 'automatico', 'sem mim', 'aprovar', 'seguranca'],
  },
  {
    pergunta: 'O que só um administrador faz?',
    resposta: 'Vídeos, Ajustes, editar a Marca, ligar canais, adicionar fontes no Radar e excluir peças. Quem é Usuário pede a um administrador.',
    palavras: ['administrador', 'admin', 'permissao', 'acesso', 'usuario', 'papel'],
  },
  {
    pergunta: 'Quanto estou gastando?',
    resposta: 'No Início, Custos mostra o gasto do mês em vídeo e o teto (só administradores). A cobrança final é a de cada provedor, na sua conta.',
    palavras: ['custo', 'custos', 'gasto', 'preco', 'credito', 'creditos', 'teto', 'cobranca'],
  },
  {
    pergunta: 'Posso usar a minha assinatura do Claude?',
    resposta: 'Sim. Em Ajustes → Integrações, clique em “Conectar ao Claude” e autorize. Ele lê a marca, cria peças e busca no Contexto; aprovar e publicar continuam só aqui.',
    palavras: ['claude', 'assinatura', 'conector', 'mcp', 'conectar ao claude'],
  },
  {
    pergunta: 'Onde ficam os avisos?',
    resposta: 'No sino, ao lado do seu e-mail no fim do menu lateral. No celular, no topo da tela.',
    palavras: ['avisos', 'notificacoes', 'sino', 'alerta'],
  },
  {
    pergunta: 'Esqueci a senha.',
    resposta: 'Na tela de entrada, clique em “Esqueci minha senha” e siga o link que chega no seu e-mail.',
    palavras: ['senha', 'esqueci', 'login', 'entrar', 'acesso'],
  },
];

// ── Busca por palavras-chave ─────────────────────────────────────────────────

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s/-]/g, ' ');
}

const STOPWORDS = new Set([
  'a', 'o', 'e', 'de', 'do', 'da', 'em', 'um', 'uma', 'para', 'por', 'que', 'como', 'onde', 'qual',
  'com', 'sem', 'meu', 'minha', 'me', 'eu', 'na', 'no', 'os', 'as', 'se', 'ou', 'ja', 'nao', 'esta',
  'este', 'isso', 'aqui', 'faco', 'fazer', 'posso', 'quero', 'preciso', 'ta', 'ate', 'mais',
]);

function tokens(texto: string): string[] {
  return normalizar(texto)
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Pontua `chaves` (peso 3) e `corpo` (peso 1) contra os termos; devolve os `limite` melhores. */
function ranquear<T>(itens: T[], pergunta: string, limite: number, campos: (item: T) => { chaves: string; corpo: string }): T[] {
  const termos = tokens(pergunta);
  if (termos.length === 0) return [];
  return itens
    .map((item) => {
      const { chaves, corpo } = campos(item);
      const k = normalizar(chaves);
      const c = normalizar(corpo);
      let pontos = 0;
      for (const t of termos) {
        if (k.includes(t)) pontos += 3;
        else if (c.includes(t)) pontos += 1;
      }
      return { item, pontos };
    })
    .filter((p) => p.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, limite)
    .map((p) => p.item);
}

/** Entradas de ajuda mais relevantes para a pergunta (0 a `limite`). */
export function buscarAjuda(pergunta: string, limite = 3): HelpEntry[] {
  return ranquear(HELP, pergunta, limite, (h) => ({
    chaves: [h.menu, h.caminho ?? '', ...h.palavras].join(' '),
    corpo: [h.resumo, ...h.passos, ...h.erros].join(' '),
  }));
}

/** Dúvidas comuns mais relevantes para a pergunta (0 a `limite`). */
export function buscarDuvidas(pergunta: string, limite = 2): Duvida[] {
  return ranquear(DUVIDAS, pergunta, limite, (d) => ({
    chaves: [d.pergunta, ...d.palavras].join(' '),
    corpo: d.resposta,
  }));
}

/** Mapa compacto do app para o prompt de sistema: rota — menu — resumo. */
export function mapaDoApp(): string {
  return HELP.map((h) => `${h.rota} — ${h.caminho ?? h.menu}${h.admin ? ' (só admin)' : ''}: ${h.resumo}`).join('\n');
}

/** Rotas que o assistente pode mandar o usuário visitar. */
export const ROTAS_NAVEGAVEIS = HELP.map((h) => h.rota);

/** Rotas que só administradores abrem. */
export const ROTAS_SO_ADMIN = HELP.filter((h) => h.admin).map((h) => h.rota);
