// _shared/receitas-de-video.ts — a fonte única do hub de vídeo: o que cada
// ferramenta faz e não faz, o que a pessoa escreve nela e como esse texto tem
// de ser escrito para o modelo que vai gerar. Três leitores, um arquivo: a tela
// (frases, rótulo e limite do campo), o conector (a receita que o Claude da
// pessoa recebe no pedido de escrita) e o servidor (conferência da entrega).
//
// Sem imports: o mesmo arquivo é copiado em src/lib/receitas-de-video.ts e um
// teste confere que as duas cópias são iguais. Números que já vivem no catálogo
// (duração, preço) não entram aqui: o limite de letras é derivado em runtime
// (segundos × LETRAS_POR_SEGUNDO) e vem no contexto do pedido.

/** Letras de fala por segundo, em português falado com calma. */
export const LETRAS_POR_SEGUNDO = 15;

/** O que o Claude da pessoa escreve. Cada tipo tem receita, limite e forma de entrega. */
export type TipoDeEscrita = 'roteiro' | 'ideia' | 'briefing_cenas' | 'fala' | 'cena' | 'pessoa';
export const TIPOS_DE_ESCRITA: readonly TipoDeEscrita[] = ['roteiro', 'ideia', 'briefing_cenas', 'fala', 'cena', 'pessoa'];

/** O que a tela manda junto com o pedido: só o que muda a escrita. */
export interface ContextoDeEscrita {
  /** Campo da tela que recebe o texto (um pedido aberto por pessoa × tipo × alvo). */
  alvo?: string;
  /** Experiência do hub (video_models.experience). */
  ferramenta?: string;
  /** provider/model_id do modelo marcado. */
  modelo?: string;
  /** Teto de letras do campo, já derivado do modelo. */
  max?: number;
  /** Duração do vídeo (fala nova) ou alvo de fala (avatar), em segundos. */
  segundos?: number;
  /** 9:16, 16:9 ou 1:1. */
  formato?: string;
  /** Quem apresenta e com que voz, para o roteiro combinar. */
  apresentador?: string;
  voz?: string;
}

export interface Ferramenta {
  /** slug de video_models.experience[] */
  experience: string;
  faz: string;
  nao_faz: string;
  /** O campo de texto da ferramenta; null quando ela não pede texto. */
  campo: { rotulo: string; placeholder: string; tipo: TipoDeEscrita } | null;
}

const PLACEHOLDER = 'Escreva do seu jeito, ou só a ideia. O seu Claude transforma no texto que este modelo precisa.';

export const FERRAMENTAS: Record<string, Ferramenta> = {
  scenes: {
    experience: 'scenes',
    faz: 'Um roteirista monta cenas geradas por IA a partir da sua ideia, com narração na voz da marca, trilha e legendas.',
    nao_faz: 'Não mostra o seu rosto (para isso, “Vídeo comigo nas cenas”) e não usa vídeo gravado.',
    campo: { rotulo: 'A ideia', placeholder: PLACEHOLDER, tipo: 'briefing_cenas' },
  },
  presenter_in_scenes: {
    experience: 'presenter_in_scenes',
    faz: 'O mesmo vídeo de cenas, com o seu apresentador aparecendo nelas.',
    nao_faz: 'A semelhança do rosto depende do modelo: no Replicate ele vem só do quadro inicial.',
    campo: { rotulo: 'A ideia', placeholder: PLACEHOLDER, tipo: 'briefing_cenas' },
  },
  avatar_script: {
    experience: 'avatar_script',
    faz: 'Um apresentador da biblioteca, ou um seu, fala o texto olhando para a câmera, com a voz escolhida.',
    nao_faz: 'Não muda de cenário nem mostra outras imagens: fala o que está escrito, parado.',
    campo: { rotulo: 'O que ele fala', placeholder: PLACEHOLDER, tipo: 'roteiro' },
  },
  photo_presenter: {
    experience: 'photo_presenter',
    faz: 'A foto do seu apresentador ganha boca, olhos e cabeça em movimento e fala o roteiro.',
    nao_faz: 'Não anda nem troca de cenário: o fundo é o da foto.',
    campo: { rotulo: 'O que ele fala', placeholder: PLACEHOLDER, tipo: 'roteiro' },
  },
  digital_twin: {
    experience: 'digital_twin',
    faz: 'O seu clone, feito do seu vídeo, fala qualquer roteiro novo com a sua voz.',
    nao_faz: 'Não grava cena nova nem muda roupa; precisa do consentimento gravado antes do primeiro vídeo.',
    campo: { rotulo: 'O que o clone fala', placeholder: PLACEHOLDER, tipo: 'roteiro' },
  },
  idea_to_video: {
    experience: 'idea_to_video',
    faz: 'Você descreve a ideia; o Video Agent da HeyGen escreve, escolhe cenas e voz e aplica as cores e o logo da marca.',
    nao_faz: 'Não fala um roteiro pronto palavra por palavra e não deixa revisar antes de renderizar.',
    campo: { rotulo: 'A ideia', placeholder: PLACEHOLDER, tipo: 'ideia' },
  },
  change_speech: {
    experience: 'change_speech',
    faz: 'Troca o que a pessoa diz no vídeo: voz nova e boca sincronizada.',
    nao_faz: 'Não muda imagem, gesto nem duração: a fala nova precisa caber no tempo do vídeo.',
    campo: { rotulo: 'Fala nova', placeholder: PLACEHOLDER, tipo: 'fala' },
  },
  translate: {
    experience: 'translate',
    faz: 'O mesmo vídeo em outro idioma, com a sua voz e a boca sincronizada.',
    nao_faz: 'Não muda o conteúdo nem corta.',
    campo: null,
  },
  restyle: {
    experience: 'restyle',
    faz: 'Refaz o visual do seu vídeo (estilo, lugar, luz, roupa) mantendo fala, gesto e câmera.',
    nao_faz: 'Não troca a pessoa (para isso, “Trocar a pessoa”).',
    campo: { rotulo: 'O que muda', placeholder: 'Ex.: num escritório moderno, com luz de fim de tarde', tipo: 'cena' },
  },
  person_swap: {
    experience: 'person_swap',
    faz: 'Coloca o seu apresentador no lugar da pessoa do vídeo, mantendo fala e movimento.',
    nao_faz: 'Não muda cenário nem fala; usa as fotos do apresentador como referência.',
    campo: { rotulo: 'Como ele deve ficar', placeholder: 'Ex.: mantenha os óculos e a camisa azul', tipo: 'pessoa' },
  },
  captions: {
    experience: 'captions',
    faz: 'Legendas no estilo e na cor da marca, a partir da transcrição.',
    nao_faz: 'Não refaz o vídeo nem a fala.',
    campo: null,
  },
  reframe_upscale: {
    experience: 'reframe_upscale',
    faz: 'Vídeo 16:9 vira 9:16 e ganha nitidez.',
    nao_faz: 'Ainda não está no produto.',
    campo: null,
  },
};

export function ferramentaDe(experience: string | null | undefined): Ferramenta | null {
  return (experience && FERRAMENTAS[experience]) || null;
}

// ── regras de escrita, por tipo ─────────────────────────────────────────────

const REGRA_COMUM = `O QUE A PESSOA ESCREVEU MANDA
O texto dela é a ordem: tema, tom, público, o que mostrar. A marca (marca_ler) é contexto para o que ela não disse; nenhuma regra de marca se sobrepõe ao pedido.
Nunca invente número, nome, cliente, data, resultado ou fato. O que faltar e faria falta, escreva [VERIFICAR] no lugar.
Sem pesquisa longa: este é um pedido curto. Leia a marca, escreva e entregue em roteiro_entregar com pedido_id e texto. Se vier lista de problemas, corrija e entregue de novo.`;

const limite = (ctx: ContextoDeEscrita) =>
  ctx.max ? `Até ${ctx.max.toLocaleString('pt-BR')} caracteres.` : '';

const RECEITAS: Record<Exclude<TipoDeEscrita, 'roteiro'>, (ctx: ContextoDeEscrita) => string> = {
  ideia: (ctx) => `ESCREVA O BRIEFING PARA O VIDEO AGENT DA HEYGEN
Ele escreve o roteiro, escolhe as cenas e a voz e monta o vídeo sozinho a partir do que você entregar. O briefing é a instrução dele, não o roteiro.
Estrutura, nesta ordem, em parágrafos curtos em português do Brasil:
1. Objetivo em uma frase e para quem é.
2. Duração desejada em segundos e formato ${ctx.formato ?? '9:16'}.
3. Os 3 a 5 pontos do vídeo, na ordem em que aparecem.
4. O que mostrar: produto, tela, situação. O que evitar.
5. A chamada final, no repertório da marca.
Tamanho ideal entre 400 e 1.200 caracteres. ${limite(ctx)}
${REGRA_COMUM}`,

  briefing_cenas: (ctx) => `ESCREVA O BRIEFING DE UM VÍDEO DE CENAS GERADAS (Reel vertical de 20 a 40 s, narração por cima)
Entregue em roteiro_entregar com pedido_id, texto (a ideia reescrita em 1 a 3 frases, na voz da marca) e saida com estes campos:
- objetivo: uma de "Educar", "Vender", "Gerar conversa", "Viralizar".
- publico: para quem o vídeo fala, em uma frase concreta (quem, onde, qual dor).
- smp: a mensagem única do vídeo, 1 a 2 frases; é o que a narração defende.
- numero_heroi: UM número que prova a mensagem, com unidade e contexto, SOMENTE se estiver no material da marca ou no que a pessoa escreveu; senão "".
- cta: a frase falada no final, uma só, no repertório da marca quando houver.
- tom: 2 a 3 adjetivos da voz da marca.
Frases curtas, sem emoji. ${limite(ctx)}
${REGRA_COMUM}`,

  fala: (ctx) => `ESCREVA A FALA NOVA DE UM VÍDEO JÁ GRAVADO
A imagem, o gesto e a duração não mudam: a fala nova precisa caber ${ctx.segundos ? `em ${Math.round(ctx.segundos)} segundos (cerca de ${Math.round(ctx.segundos * LETRAS_POR_SEGUNDO)} caracteres)` : 'no tempo do vídeo'}. Passou do tempo, a boca não sincroniza.
Escreva para o ouvido: frases curtas, pontuação nas pausas, número por extenso quando a leitura for ambígua, sigla como se fala. Só a fala, sem rubrica, sem emoji, sem hashtag. ${limite(ctx)}
${REGRA_COMUM}`,

  cena: (ctx) => `ESCREVA A INSTRUÇÃO VISUAL PARA REFAZER O CENÁRIO OU O ESTILO DE UM VÍDEO
O modelo (Kling ou Aleph) mantém fala, gesto e câmera e muda só o que a instrução pede. Ele lê inglês.
Entregue em roteiro_entregar com pedido_id, texto (a instrução em inglês: uma frase visual com lugar, luz, hora, roupa ou paleta; sem história, sem negativa; termine com "keep everything else identical") e saida { resumo_pt: a mesma instrução em português, em uma frase, para a pessoa conferir }. ${limite(ctx)}
${REGRA_COMUM}`,

  pessoa: (ctx) => `ESCREVA A INSTRUÇÃO PARA TROCAR A PESSOA DE UM VÍDEO PELO APRESENTADOR DA MARCA
O modelo recebe as fotos do apresentador e mantém fala e movimento. A instrução diz o que preservar e o que mudar (óculos, roupa, cabelo, acessório). Ele lê inglês.
Entregue em roteiro_entregar com pedido_id, texto (a instrução em inglês, curta e objetiva) e saida { resumo_pt: a mesma instrução em português, em uma frase }. ${limite(ctx)}
${REGRA_COMUM}`,
};

/** A camada do modelo que entra no fim da receita do roteiro (tipo 'roteiro'). */
export function camadaDoModelo(ctx: ContextoDeEscrita): string {
  const linhas: string[] = [];
  if (ctx.modelo) linhas.push(`Modelo escolhido: ${ctx.modelo}.`);
  if (ctx.max) linhas.push(`O roteiro inteiro cabe em ${ctx.max.toLocaleString('pt-BR')} caracteres (cerca de ${Math.round(ctx.max / LETRAS_POR_SEGUNDO)} segundos de fala): este limite vale no lugar dos 5.000.`);
  if (ctx.apresentador) linhas.push(`Quem apresenta: ${ctx.apresentador}.`);
  if (ctx.voz) linhas.push(`Voz: ${ctx.voz}.`);
  if (ctx.formato) linhas.push(`Formato: ${ctx.formato}.`);
  return linhas.length ? `\n\nFERRAMENTA E MODELO\n${linhas.join('\n')}` : '';
}

/** A receita que o Claude recebe para um tipo curto (o roteiro tem a dele em roteiro.ts). */
export function receitaDeEscrita(tipo: Exclude<TipoDeEscrita, 'roteiro'>, ctx: ContextoDeEscrita): string {
  return RECEITAS[tipo](ctx);
}

export function lerTipo(bruto: unknown): TipoDeEscrita {
  return TIPOS_DE_ESCRITA.includes(bruto as TipoDeEscrita) ? (bruto as TipoDeEscrita) : 'roteiro';
}

const NUM = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
const STR = (v: unknown, max = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/** Só o que a receita usa, saneado; o resto do que a tela mandar cai fora. */
export function lerContexto(bruto: unknown): ContextoDeEscrita {
  const c = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  const ctx: ContextoDeEscrita = {};
  const alvo = STR(c.alvo, 60); if (alvo) ctx.alvo = alvo;
  const ferramenta = STR(c.ferramenta, 60); if (ferramenta) ctx.ferramenta = ferramenta;
  const modelo = STR(c.modelo, 120); if (modelo) ctx.modelo = modelo;
  const max = NUM(c.max); if (max) ctx.max = Math.min(Math.round(max), 20000);
  const segundos = NUM(c.segundos); if (segundos) ctx.segundos = Math.round(segundos);
  const formato = STR(c.formato, 5); if (formato && ['9:16', '16:9', '1:1'].includes(formato)) ctx.formato = formato;
  const apresentador = STR(c.apresentador); if (apresentador) ctx.apresentador = apresentador;
  const voz = STR(c.voz); if (voz) ctx.voz = voz;
  return ctx;
}

const OBJETIVOS = ['Educar', 'Vender', 'Gerar conversa', 'Viralizar'];

/** Confere a entrega de um tipo curto: texto dentro do limite e saída na forma pedida. */
export function conferirEscrita(
  tipo: Exclude<TipoDeEscrita, 'roteiro'>,
  ctx: ContextoDeEscrita,
  textoBruto: unknown,
  saidaBruta: unknown,
): { texto: string; saida: Record<string, string> | null; problemas: string[] } {
  const problemas: string[] = [];
  const texto = typeof textoBruto === 'string' ? textoBruto.trim() : '';
  if (!texto) problemas.push('texto: falta o texto.');
  if (ctx.max && texto.length > ctx.max) problemas.push(`texto: ${texto.length} caracteres, o limite é ${ctx.max}.`);
  if (/\p{Extended_Pictographic}/u.test(texto)) problemas.push('texto: sem emoji.');
  if (tipo === 'fala' && /[#]\w/.test(texto)) problemas.push('texto: sem hashtag.');
  if (tipo === 'fala' && ctx.segundos) {
    const teto = Math.round(ctx.segundos * LETRAS_POR_SEGUNDO * 1.15);
    if (texto.length > teto) problemas.push(`texto: a fala tem ${texto.length} caracteres e o vídeo tem ${ctx.segundos} s; cabe até ${teto}.`);
  }
  const s = (saidaBruta && typeof saidaBruta === 'object' ? saidaBruta : {}) as Record<string, unknown>;
  const campo = (k: string, max = 300) => (typeof s[k] === 'string' ? (s[k] as string).trim().slice(0, max) : '');
  let saida: Record<string, string> | null = null;
  if (tipo === 'briefing_cenas') {
    saida = {
      objetivo: campo('objetivo', 40), publico: campo('publico'), smp: campo('smp', 400),
      numero_heroi: campo('numero_heroi', 120), cta: campo('cta', 200), tom: campo('tom', 80),
    };
    if (!OBJETIVOS.includes(saida.objetivo)) problemas.push(`saida.objetivo: um de ${OBJETIVOS.join(', ')}.`);
    if (!saida.smp) problemas.push('saida.smp: falta a mensagem única do vídeo.');
    if (!saida.publico) problemas.push('saida.publico: diga para quem o vídeo fala.');
  } else if (tipo === 'cena' || tipo === 'pessoa') {
    saida = { resumo_pt: campo('resumo_pt') };
    if (!saida.resumo_pt) problemas.push('saida.resumo_pt: a instrução em português, em uma frase.');
    if (/[ãõçáéíóúâêô]/i.test(texto)) problemas.push('texto: a instrução vai em inglês (o modelo lê inglês); o português fica em saida.resumo_pt.');
  }
  return { texto, saida, problemas };
}
