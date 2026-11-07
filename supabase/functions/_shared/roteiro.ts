// _shared/roteiro.ts — roteiro e plano de produção pelo Claude da assinatura.
//
// A pessoa diz o que quer produzir (ideia, o que mostrar, referências). O pedido
// fica em `roteiro_pedidos`; a rotina do Claude dela lê pelo conector, pesquisa,
// estuda as referências no ambiente dela e entrega: o roteiro em passos (fala do
// apresentador, passo a passo), o plano de produção (gravações, efeitos, formato)
// e o mapa de bastidor (o que a pessoa precisa ter logado e onde ela intervém).
// O servidor só confere a forma e guarda. Pronto o vídeo do avatar, o plano vira
// o pedido de montagem em video_pedidos, para o mesmo Claude gravar as telas,
// unir ao avatar, aplicar os efeitos e entregar o MP4.
//
// O método é o das aulas com avatar (gravação guiada pela fala, tela cheia para
// conceito e tela compartilhada para ação, cena ao vivo para o que só humano
// opera). Aqui só as regras gerais: nada de marca, mentor ou produto fixo.

export const ROTEIRO_MAX = 5000;
export const BRIEFING_MAX = 4000;
export const REFERENCIAS_MAX = 10;
export const PASSOS_MAX = 120;
/** Texto do pedido de montagem que o editor aceita (o plano inteiro vai à parte). */
export const PEDIDO_MONTAGEM_MAX = 2000;

export interface Referencia {
  url: string;
  nota?: string;
}

export type AcaoDeTela = 'mover' | 'clicar' | 'digitar' | 'contorno' | 'holofote' | 'zoom' | 'rolar';
export const ACOES_DE_TELA: readonly AcaoDeTela[] = ['mover', 'clicar', 'digitar', 'contorno', 'holofote', 'zoom', 'rolar'];

export interface PassoDoRoteiro {
  /** Livre e único: A01 (conceito), T01 (tela guiada), P01 (ao vivo). */
  id: string;
  /** conceito = apresentador em tela cheia; tela = tela gravada com o apresentador em miniatura. */
  tipo: 'conceito' | 'tela';
  fala: string;
  /** Passo de tela: cada ação na fração da fala em que é dita (0 a 1). */
  acoes?: { em: number; acao: AcaoDeTela; alvo: string; valor?: string }[];
  /** Só humano opera (login, chave, autorizar conta): a pessoa grava e anexa. */
  ao_vivo?: boolean;
  /** Termo novo dito no passo: ganha legenda na tela (texto até 70 caracteres). */
  legenda?: { termo: string; texto: string };
}

export interface MapaDeBastidor {
  /** Ferramentas externas que a pessoa deixa abertas e logadas antes de gravar. */
  ferramentas: { nome: string; para_que: string; onde_fica_a_chave?: string; modo_teste?: string }[];
  /** Momentos em que a pessoa intervém, na ordem da aula. */
  intervencoes: { quando: string; o_que: string; minutos?: number }[];
  /** O que a gravação cria e a pessoa apaga no fim. */
  dados_de_teste: string[];
}

export interface PlanoDeProducao {
  /** 1 a 2 frases: o que o vídeo faz e o estilo que segue. */
  resumo: string;
  formato: '9:16' | '16:9' | '1:1';
  passos: PassoDoRoteiro[];
  /** Telas a gravar: o que mostrar e os passos, na ordem. */
  gravacoes: { o_que: string; como: string }[];
  bastidor: MapaDeBastidor;
  /** Vale o vídeo inteiro: legenda, logo na abertura e no fim, música, cor. */
  efeitos_globais: string[];
  /** Outros geradores a usar, se o briefing pediu (nome do modelo e para quê). */
  modelos_extras: string[];
  fontes: { title: string; url: string }[];
}

/** Etapas do pedido, na ordem; a tela desenha a trilha por aqui. */
export const ETAPAS_DO_ROTEIRO = ['enviado', 'pegou', 'pesquisa', 'referencias', 'roteiro', 'plano', 'entregue'] as const;
export type EtapaDoRoteiro = (typeof ETAPAS_DO_ROTEIRO)[number];
/** As etapas que o Claude avisa por roteiro_andamento (as outras o servidor marca). */
export const ETAPAS_DO_CLAUDE: readonly EtapaDoRoteiro[] = ['pesquisa', 'referencias', 'roteiro', 'plano'];

export interface Andamento {
  etapa: EtapaDoRoteiro;
  /** Uma frase do que está acontecendo ("Estudando a referência 2 de 3"). */
  texto: string;
  em: string;
}

export const andamento = (etapa: EtapaDoRoteiro, texto: string): Andamento =>
  ({ etapa, texto: texto.slice(0, 200), em: new Date().toISOString() });

export interface PedidoDeRoteiro {
  andamento: Andamento | null;
  conversa: unknown;
  aguardando_pessoa: boolean;
  id: string;
  status: 'aberto' | 'entregue' | 'cancelado' | 'falhou';
  briefing: string;
  referencias: Referencia[];
  claim: { at: number; attempts: number } | null;
  roteiro: string | null;
  plano: PlanoDeProducao | null;
  erro: string | null;
  created_at: string;
}

export const RECEITA_DO_ROTEIRO = `Você escreve o roteiro e o plano de produção de um vídeo com apresentador (avatar). O produto gera o avatar falando o roteiro; depois, o plano volta para você montar o vídeo final.

O BRIEFING MANDA
O que a pessoa escreveu é a ordem: tema, formato, tom, público e o que mostrar. A marca (marca_ler) é contexto para quando o briefing não diz; se a pessoa pediu outra coisa, outro tom ou outro assunto, siga o briefing. Nenhuma regra de marca se sobrepõe ao pedido.

ANTES DE ESCREVER
1. Leia o briefing e as referências. Depois leia a marca em marca_ler, só como contexto.
2. Pesquise o assunto. Busque no acervo com acervo_buscar; o que faltar, pesquise na web e guarde as fontes.
3. Estude cada referência no seu ambiente: baixe o vídeo, extraia a transcrição e quadros (1 por segundo) e identifique o método: onde corta respiro, onde dá zoom, onde divide a tela (gravação da aplicação em tela cheia com o apresentador em miniatura, como videoaula de software), textos e cartões na tela, vinheta, ritmo, duração. O plano usa esses métodos, não copia o conteúdo.
4. Se o vídeo mostra um sistema, leia o código ou a tela dele antes de escrever: o nome de cada botão como está na tela, a ordem real das telas, o que depende de dado salvo antes. Não invente recurso.

ROTEIRO EM PASSOS (plano.passos)
- Cada passo tem id, tipo e fala. tipo "conceito" = o apresentador em tela cheia (abertura, dor, o que resolve, regra importante, cuidado, recap, fecho); tipo "tela" = tela gravada com o apresentador em miniatura.
- Passo de tela narra a ação na hora em que ela acontece, em primeira pessoa e no presente: "clico em Nova automação", "colo o link aqui". Uma ou duas ações por passo, de 5 a 15 s de fala. Explicação longa com a tela parada é o primeiro erro.
- Diga o nome do botão como está na tela ("Salvar alterações", não "salvar"). A gravação depende disso.
- Em acoes, cada ação na fração da fala em que é dita (em: 0 a 1): mover, clicar, digitar (valor), contorno (no campo que vai ser preenchido), holofote (na área que está sendo mostrada), zoom (só para alvo pequeno: três pontinhos, um switch), rolar.
- Conceito curto, de 5 a 25 s: uma ideia, dita para quem assiste. Regra e cuidado vão em conceito, logo depois do passo em que aparecem.
- O que só humano opera (login, colar chave de API, autorizar conta, conectar número ou perfil, comentar de outra conta) é passo de tela com ao_vivo: true: a pessoa grava essa cena e anexa. Você nunca cria conta, não faz login em serviço de terceiros e não copia nem cola chave real.
- Todo termo que a pessoa pode não conhecer ganha legenda: { termo, texto até 70 caracteres }, e a fala diz o nome, o que é em uma frase do dia a dia e um exemplo.
- Estrutura que funciona: abertura → dor de quem assiste → o que resolve → passos com conceitos intercalados → teste → recap → fecho com a chamada que o briefing pede (sem pedido, a do repertório da marca).
- Frases faladas, curtas, com pontuação nas pausas. Número por extenso quando a leitura for ambígua; sigla que a voz erra, escrita como se fala. Sem emoji, hashtag ou travessão. Nunca invente número, nome, cliente ou resultado.
- roteiro = as falas dos passos, na ordem, separadas por linha em branco; até ${ROTEIRO_MAX} caracteres (cerca de 15 por segundo de fala).

PLANO DE PRODUÇÃO (plano)
- resumo: 1 a 2 frases sobre o que o vídeo faz e o estilo que segue, com a referência que inspirou.
- formato: "9:16" para Reels e TikTok, "16:9" para aula e YouTube, "1:1" para feed.
- gravacoes: cada tela a gravar, com o_que (a aplicação e a funcionalidade) e como (os passos, na ordem, com o que clicar e o que deve aparecer). Se a pessoa pediu para gravar uma tela, ela entra aqui.
- bastidor: o mapa do que a pessoa precisa antes de gravar. ferramentas: cada ferramenta externa, para que o sistema usa, onde fica a chave no painel dela (menu › tela) e se tem modo de teste. intervencoes: cada momento em que a pessoa intervém, na ordem (primeiro acesso, colar chave, autorizar conta, conectar número ou perfil, limite de plano, limpeza no fim), com quanto tempo leva. dados_de_teste: o que a gravação cria e a pessoa apaga no fim.
- efeitos_globais: legenda, vinheta na abertura e no fim, música, cor; o que vale o vídeo inteiro.
- modelos_extras: outros geradores a usar além do avatar, se o briefing pediu (cena gerada, imagem, voz), com o nome do modelo e para quê. Vazio se não precisar.
- fontes: o que embasou os dados do roteiro ({ title, url }).

SE PRECISAR DA PESSOA
Login, chave, autorizar conta, gravar uma cena, uma decisão que só ela pode tomar: pergunte em roteiro_mensagem com aguardar_pessoa true, em uma frase direta, e pare. O pedido sai da sua fila até ela responder; a resposta vem no próximo roteiro_pedidos, em conversa. Dúvida que não trava o trabalho vai em roteiro_mensagem sem aguardar.

AVISE O ANDAMENTO
A pessoa vê a trilha na tela. A cada etapa, chame roteiro_andamento com pedido_id, etapa e uma frase do que está fazendo: "pesquisa" (pesquisando o assunto), "referencias" (estudando as referências: diga qual, "2 de 3"), "roteiro" (escrevendo os passos), "plano" (montando o plano e o bastidor). Sem aviso por 15 minutos, a tela diz que o pedido parece parado.

ENTREGA
Chame roteiro_entregar com pedido_id, roteiro e plano. Se vier a lista de problemas, corrija e chame de novo. A pessoa revisa o roteiro e o bastidor na tela Vídeos e gera o avatar; quando o vídeo ficar pronto, o plano aparece para você em video_pedidos, com a receita de montagem.`;

export const RECEITA_DA_MONTAGEM = `MONTAGEM DO VÍDEO COM APRESENTADOR, pelo plano de produção que você escreveu. Faça no seu ambiente e entregue o MP4 por video_render e video_entregar; o que não der, vai em ficou_de_fora.

1. Tempo de cada passo: o vídeo do avatar tem a transcrição por palavra em video_ver; se vier sem transcrição, transcreva você no seu ambiente (whisper ou equivalente) com tempo por palavra. Ache onde cada passo começa e termina casando a fala do passo com as palavras. A fala manda: a tela se ajusta a ela (acelere a gravação até 1,45x; a ao vivo até 2x), nunca o contrário.
2. Gravação guiada: você roda na nuvem, não no computador da pessoa. Para cada passo de tela sem ao_vivo, grave a tela da aplicação com um navegador sem janela no seu ambiente (1440×900, cursor visível, ondinha no clique), guiada pela duração do passo. Só sites públicos liberados na rede do seu ambiente; o que exige login é cena ao_vivo, que a pessoa grava e anexa na faixa "Editar com Claude" do vídeo. Cada ação cai na fração da fala: cada ação cai na fração da fala em que é dita. Contorno no campo antes de preencher, holofote na área mostrada, zoom só em alvo pequeno (fator 1,4 a 2,2), aplicado na montagem com curva suave. Digite em ritmo humano. Confira numa folha de quadros se a ação bate com a fala antes de seguir.
3. Cena ao vivo: passo com ao_vivo é gravado pela pessoa e vem como anexo. Se ainda não veio, peça em video_mensagem com aguardar_pessoa true e pare; sem o anexo, deixe o passo com o apresentador em tela cheia e avise em ficou_de_fora.
4. Layout: passo de conceito = apresentador em tela cheia; passo de tela = tela compartilhada, com a gravação em um card grande e o apresentador em um card ao lado, sobre o fundo da marca (brand kit), cantos suaves. Transição suave em toda troca entre tela cheia e compartilhada. Texto na tela com pouco texto, nunca cobrindo o rosto, cada cartela legível por pelo menos 2 s; legenda do termo entra na palavra em que é dito.
5. Segredos: chave, token, e-mail de terceiros e conta de outra ferramenta que apareçam na tela são borrados. A imagem mostra só a aplicação; a conta de CRM ou ferramenta de quem grava não aparece.
6. Som e fim: corte de respiro só onde o plano pede; vinheta da marca na abertura e no fim quando o plano pede; volume normalizado a −16 LUFS, pico −1,5 dB, redução leve de chiado.
7. Se precisar da pessoa (login no sistema, gravar uma cena que só ela opera, anexar um arquivo, uma escolha): pergunte em video_mensagem com aguardar_pessoa true e pare. O pedido volta em video_pedidos com a resposta em conversa.
8. Conferência: decodifique o resultado e compare quadros com o original: sem desvio de áudio acima de 45 ms, sem quadro vazio nas emendas, mesma duração da fala. Olhe os quadros de cada troca de layout. Só então entregue.`;

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.map(texto).filter(Boolean) : []);
const FORMATOS = ['9:16', '16:9', '1:1'] as const;

function conferirPassos(bruto: unknown, problemas: string[]): PassoDoRoteiro[] {
  const itens = Array.isArray(bruto) ? bruto : [];
  if (!itens.length) problemas.push('plano.passos: ao menos um passo, com id, tipo e fala.');
  if (itens.length > PASSOS_MAX) problemas.push(`plano.passos: no máximo ${PASSOS_MAX} passos.`);
  const ids = new Set<string>();
  return itens.slice(0, PASSOS_MAX).map((item, i) => {
    const p = (item ?? {}) as Record<string, unknown>;
    const id = texto(p.id) || `P${i + 1}`;
    if (ids.has(id)) problemas.push(`plano.passos[${i}]: id "${id}" repetido.`);
    ids.add(id);
    const tipo = texto(p.tipo) === 'tela' ? 'tela' : texto(p.tipo) === 'conceito' ? 'conceito' : null;
    if (!tipo) problemas.push(`plano.passos[${i}]: tipo é "conceito" ou "tela".`);
    const fala = texto(p.fala);
    if (!fala) problemas.push(`plano.passos[${i}]: falta a fala.`);
    const acoes = (Array.isArray(p.acoes) ? p.acoes : []).map((a, j) => {
      const acao = (a ?? {}) as Record<string, unknown>;
      const em = Number(acao.em);
      const nome = texto(acao.acao) as AcaoDeTela;
      if (!(em >= 0 && em <= 1)) problemas.push(`plano.passos[${i}].acoes[${j}]: em vai de 0 a 1.`);
      if (!ACOES_DE_TELA.includes(nome)) problemas.push(`plano.passos[${i}].acoes[${j}]: acao é uma de ${ACOES_DE_TELA.join(', ')}.`);
      if (!texto(acao.alvo)) problemas.push(`plano.passos[${i}].acoes[${j}]: falta o alvo.`);
      const valor = texto(acao.valor);
      return { em, acao: nome, alvo: texto(acao.alvo), ...(valor ? { valor } : {}) };
    });
    if (tipo === 'conceito' && acoes.length) problemas.push(`plano.passos[${i}]: conceito não tem acoes.`);
    const legendaBruta = (p.legenda ?? null) as Record<string, unknown> | null;
    const legenda = legendaBruta && texto(legendaBruta.termo)
      ? { termo: texto(legendaBruta.termo), texto: texto(legendaBruta.texto).slice(0, 70) }
      : undefined;
    return {
      id, tipo: tipo ?? 'conceito', fala,
      ...(acoes.length ? { acoes } : {}),
      ...(p.ao_vivo === true ? { ao_vivo: true } : {}),
      ...(legenda ? { legenda } : {}),
    };
  });
}

function conferirBastidor(bruto: unknown): MapaDeBastidor {
  const b = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  const ferramentas = (Array.isArray(b.ferramentas) ? b.ferramentas : []).map((f) => {
    const t = (f ?? {}) as Record<string, unknown>;
    const chave = texto(t.onde_fica_a_chave), modo = texto(t.modo_teste);
    return { nome: texto(t.nome), para_que: texto(t.para_que), ...(chave ? { onde_fica_a_chave: chave } : {}), ...(modo ? { modo_teste: modo } : {}) };
  }).filter((f) => f.nome);
  const intervencoes = (Array.isArray(b.intervencoes) ? b.intervencoes : []).map((i) => {
    const t = (i ?? {}) as Record<string, unknown>;
    const minutos = Number(t.minutos);
    return { quando: texto(t.quando), o_que: texto(t.o_que), ...(minutos > 0 ? { minutos } : {}) };
  }).filter((i) => i.o_que);
  return { ferramentas, intervencoes, dados_de_teste: lista(b.dados_de_teste) };
}

/** Confere a forma do plano. Devolve o plano limpo ou a lista do que corrigir. */
export function conferirPlano(bruto: unknown): { plano: PlanoDeProducao | null; problemas: string[] } {
  const problemas: string[] = [];
  const p = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  const resumo = texto(p.resumo);
  if (!resumo) problemas.push('plano.resumo: diga em 1 a 2 frases o que o vídeo faz e o estilo.');
  const formato = (FORMATOS as readonly string[]).includes(texto(p.formato)) ? (texto(p.formato) as PlanoDeProducao['formato']) : null;
  if (!formato) problemas.push(`plano.formato: um de ${FORMATOS.join(', ')}.`);
  const passos = conferirPassos(p.passos, problemas);
  const gravacoes = (Array.isArray(p.gravacoes) ? p.gravacoes : [])
    .map((g) => ({ o_que: texto((g as Record<string, unknown>)?.o_que), como: texto((g as Record<string, unknown>)?.como) }));
  gravacoes.forEach((g, i) => {
    if (!g.o_que || !g.como) problemas.push(`plano.gravacoes[${i}]: precisa de o_que e como.`);
  });
  const bastidor = conferirBastidor(p.bastidor);
  if (passos.some((x) => x.ao_vivo) && !bastidor.intervencoes.length) {
    problemas.push('plano.bastidor.intervencoes: há passo ao vivo, então diga quando a pessoa intervém e por quanto tempo.');
  }
  const fontes = (Array.isArray(p.fontes) ? p.fontes : [])
    .map((f) => ({ title: texto((f as Record<string, unknown>)?.title), url: texto((f as Record<string, unknown>)?.url) }))
    .filter((f) => f.url);
  if (problemas.length || !formato) return { plano: null, problemas };
  return {
    plano: {
      resumo, formato, passos, gravacoes, bastidor,
      efeitos_globais: lista(p.efeitos_globais), modelos_extras: lista(p.modelos_extras), fontes,
    },
    problemas: [],
  };
}

/** Confere a entrega inteira: o plano e o roteiro (derivado dos passos quando não vier). */
export function conferirEntrega(roteiroBruto: unknown, planoBruto: unknown, max?: number): {
  roteiro: string; plano: PlanoDeProducao | null; problemas: string[];
} {
  const conferido = conferirPlano(planoBruto);
  const roteiro = texto(roteiroBruto) || (conferido.plano?.passos.map((p) => p.fala).join('\n\n') ?? '');
  const problemas: string[] = [];
  // o limite do modelo escolhido (contexto do pedido) vale no lugar do teto geral
  const teto = max && max > 0 ? Math.min(max, ROTEIRO_MAX) : ROTEIRO_MAX;
  if (!roteiro) problemas.push('roteiro: falta a fala do apresentador.');
  if (roteiro.length > teto) problemas.push(`roteiro: ${roteiro.length} caracteres, o limite é ${teto}.`);
  if (/\p{Extended_Pictographic}/u.test(roteiro)) problemas.push('roteiro: sem emoji.');
  if (/[#]\w/.test(roteiro)) problemas.push('roteiro: sem hashtag.');
  return { roteiro, plano: conferido.plano, problemas: [...problemas, ...conferido.problemas] };
}

/**
 * O resumo do pedido de montagem, no texto que o editor recebe quando o vídeo
 * do avatar fica pronto. O plano inteiro e a receita vão junto, em video_pedidos.
 */
export function planoEmTexto(plano: PlanoDeProducao): string {
  const telas = plano.passos.filter((p) => p.tipo === 'tela');
  const aoVivo = telas.filter((p) => p.ao_vivo);
  const linhas = [
    'MONTAGEM DO VÍDEO DO APRESENTADOR, pelo plano de produção que você escreveu (o plano e a receita de montagem vêm em video_pedidos).',
    `Resumo: ${plano.resumo}`,
    `Formato final: ${plano.formato}. ${plano.passos.length} passos: ${plano.passos.length - telas.length} de conceito em tela cheia, ${telas.length} de tela compartilhada${aoVivo.length ? `, ${aoVivo.length} ao vivo (anexos da pessoa)` : ''}.`,
  ];
  if (plano.gravacoes.length) {
    linhas.push('', 'GRAVAÇÕES DE TELA (faça no seu ambiente e una ao vídeo do apresentador):');
    plano.gravacoes.forEach((g, i) => linhas.push(`${i + 1}. ${g.o_que}: ${g.como}`));
  }
  if (plano.efeitos_globais.length) linhas.push('', `NO VÍDEO INTEIRO: ${plano.efeitos_globais.join('; ')}.`);
  if (plano.modelos_extras.length) linhas.push('', `OUTROS GERADORES: ${plano.modelos_extras.join('; ')}.`);
  linhas.push('', 'Entregue o MP4 final por video_render e video_entregar. O que não der para fazer vai em ficou_de_fora.');
  const saida = linhas.join('\n');
  return saida.length > PEDIDO_MONTAGEM_MAX ? `${saida.slice(0, PEDIDO_MONTAGEM_MAX - 1)}…` : saida;
}

/** O plano gravado no job é válido? (defesa contra config editada à mão) */
export function planoDoJob(bruto: unknown): PlanoDeProducao | null {
  return conferirPlano(bruto).plano;
}

/** Referências vindas da tela: só https, no máximo REFERENCIAS_MAX. */
export function lerReferencias(bruto: unknown): Referencia[] | null {
  if (bruto === undefined || bruto === null) return [];
  if (!Array.isArray(bruto)) return null;
  const saida: Referencia[] = [];
  for (const item of bruto.slice(0, REFERENCIAS_MAX)) {
    const r = (typeof item === 'string' ? { url: item } : item ?? {}) as Record<string, unknown>;
    const url = texto(r.url);
    if (!/^https:\/\/\S+$/i.test(url) || url.length > 500) return null;
    const nota = texto(r.nota).slice(0, 300);
    saida.push(nota ? { url, nota } : { url });
  }
  return saida;
}
