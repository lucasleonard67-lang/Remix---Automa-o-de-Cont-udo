// _shared/mcp-criar.ts — pedidos de criação que chegam pelo conector MCP. Monta o
// mesmo brief e config que as telas gravam em director_jobs e usa os validadores do
// motor. Nada aqui gasta: a prévia devolve o aceite, e só com ele o job nasce.

import { validateAvatarVideo, validateVideoAgent, type AvatarVideoConfig, type VideoAgentConfig } from './avatar-video.ts';
import { shortHash } from './heygen.ts';
import { validateRemake, type RemakeConfig } from './remake.ts';

type Json = Record<string, unknown>;

export const ROTAS_DE_VIDEO = ['avatar', 'foto', 'agente', 'cenas', 'apresentador'] as const;
export type RotaDeVideo = (typeof ROTAS_DE_VIDEO)[number];

/** Mesma conta da tela: 15 letras por segundo de fala. */
const LETRAS_POR_SEGUNDO = 15;
const CENAS_PADRAO = 5;
const CENAS_MIN = 3;
const CENAS_MAX = 8;
const TOTAL_MIN_S = 8;
const TOTAL_MAX_S = 90;
const TETO_CREDITOS = 320;

const txt = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export interface PedidoDeVideo {
  brief: Json;
  config: Json;
  /** Base do custo, em segundos de vídeo. */
  segundos: number;
}

export const segundosDaFala = (texto: string) => Math.max(1, Math.round(texto.length / LETRAS_POR_SEGUNDO));

/** Mesma regra do título que o app dá aos estúdios. */
function tituloDe(texto: string): string {
  const primeira = texto.trim().split(/(?<=[.!?])\s|\n/)[0] ?? '';
  return primeira.length > 80 ? `${primeira.slice(0, 77).trimEnd()}…` : primeira || 'Vídeo';
}

function vozDe(args: Json): AvatarVideoConfig['voice'] | undefined {
  const voz = (args.voz ?? null) as Json | null;
  if (!voz) return undefined;
  const brand_voice_id = txt(voz.brand_voice_id);
  const voice_id = txt(voz.voice_id);
  const provider = voz.provider === 'heygen' ? 'heygen' as const : 'elevenlabs' as const;
  return { provider, ...(brand_voice_id ? { brand_voice_id } : {}), ...(voice_id ? { voice_id } : {}) };
}

function pedidoDeAvatar(rota: 'avatar' | 'foto', args: Json): PedidoDeVideo | string {
  const roteiro = txt(args.roteiro);
  const modelo = txt(args.modelo);
  const replicate = rota === 'foto' && modelo.startsWith('replicate/');
  const voice = vozDe(args);
  const cfg: AvatarVideoConfig = replicate
    ? {
      provider: 'replicate', presenter_id: txt(args.apresentador_id), model_id: modelo.slice('replicate/'.length),
      script: roteiro, voice: voice ?? { provider: 'elevenlabs' },
    }
    : {
      provider: 'heygen', script: roteiro, aspect_ratio: '9:16',
      ...(txt(args.look_id) ? { look_id: txt(args.look_id) } : {}),
      ...(txt(args.apresentador_id) ? { presenter_id: txt(args.apresentador_id) } : {}),
      ...(voice ? { voice } : {}),
      // catálogo usa hífen (heygen/avatar-v); a HeyGen e o pickEngine, sublinhado (avatar_v)
      ...(modelo.startsWith('heygen/') ? { engine: modelo.slice('heygen/'.length).replace(/-/g, '_') } : {}),
    };
  if (rota === 'foto' && !cfg.presenter_id) return 'Escolha o apresentador da foto em apresentador_id.';
  const erro = validateAvatarVideo(cfg);
  if (erro) return erro;
  return {
    brief: { title: tituloDe(roteiro) },
    config: { mode: 'avatar_video', avatar_video: cfg },
    segundos: segundosDaFala(roteiro),
  };
}

function pedidoDeAgente(args: Json): PedidoDeVideo | string {
  const ideia = txt(args.ideia);
  const voz = (args.voz ?? {}) as Json;
  const cfg: VideoAgentConfig = {
    prompt: ideia, orientation: 'portrait', brand_kit: true,
    ...(txt(voz.brand_voice_id) ? { brand_voice_id: txt(voz.brand_voice_id) } : {}),
    ...(voz.provider === 'heygen' && txt(voz.voice_id) ? { voice_id: txt(voz.voice_id) } : {}),
  };
  const erro = validateVideoAgent(cfg);
  if (erro) return erro;
  const segundos = Math.min(TOTAL_MAX_S, Math.max(TOTAL_MIN_S, Number(args.duracao_s) || 30));
  return { brief: { title: tituloDe(ideia) }, config: { mode: 'video_agent', video_agent: cfg }, segundos };
}

export const MODELOS_HIGGSFIELD = ['higgsfield/cinematic_studio_3_0', 'higgsfield/cinematic_studio_video_v2'];

function pedidoDeCenas(rota: 'cenas' | 'apresentador', args: Json): PedidoDeVideo | string {
  const b = (args.briefing ?? {}) as Json;
  const faltam = (['objetivo', 'publico', 'smp', 'numero_heroi', 'tom', 'cta'] as const).filter((k) => !txt(b[k]));
  if (faltam.length) return `Faltam no briefing: ${faltam.join(', ')}.`;
  const apresentador = txt(args.apresentador_id);
  if (rota === 'apresentador' && !apresentador) return 'Escolha o apresentador em apresentador_id.';
  const duracao = Number(args.duracao_s);
  if (!Number.isFinite(duracao) || duracao < TOTAL_MIN_S || duracao > TOTAL_MAX_S) {
    return `Informe duracao_s de ${TOTAL_MIN_S} a ${TOTAL_MAX_S}.`;
  }
  const cenas = Math.min(CENAS_MAX, Math.max(CENAS_MIN, Math.round(Number(args.cenas) || CENAS_PADRAO)));
  const modelo = txt(args.modelo);
  const replicate = modelo.startsWith('replicate/');
  // o motor troca id desconhecido pelo padrão sem avisar: a pessoa aceitaria um e receberia outro
  if (modelo && !replicate && !MODELOS_HIGGSFIELD.includes(modelo)) {
    return `Use um destes modelos do Higgsfield: ${MODELOS_HIGGSFIELD.join(', ')}.`;
  }
  return {
    brief: {
      objetivo: txt(b.objetivo), publico: txt(b.publico), smp: txt(b.smp), numero_heroi: txt(b.numero_heroi),
      tom: txt(b.tom), cta: txt(b.cta), duracao_alvo_s: Math.round(duracao), formato: 'reels_conversion',
      identity_id: rota === 'apresentador' ? apresentador : null,
      mandatorios: ['sem logo no plano 1', 'sem texto legível em cena'],
    },
    config: {
      max_shots: cenas, budget_credits: TETO_CREDITOS,
      // quem aceitou o custo aqui não tem a tela de aprovar quadros
      auto_approve_keyframes: true, auto_approve_audio: true, skip_video: false,
      engine: replicate ? 'replicate' : 'higgsfield',
      model_id: replicate ? modelo.slice('replicate/'.length) : modelo.replace(/^higgsfield\//, '') || null,
      captions: args.legenda !== false,
    },
    segundos: Math.round(duracao),
  };
}

/** Pedido pronto para gravar, ou a frase do problema. */
export function pedidoDeVideo(args: Json): PedidoDeVideo | string {
  const rota = args.rota as RotaDeVideo;
  if (!ROTAS_DE_VIDEO.includes(rota)) return `Escolha a rota: ${ROTAS_DE_VIDEO.join(', ')}.`;
  if (rota === 'avatar' || rota === 'foto') return pedidoDeAvatar(rota, args);
  return rota === 'agente' ? pedidoDeAgente(args) : pedidoDeCenas(rota, args);
}

/** Melhorar um vídeo que já está no produto: mesmo job da tela "Melhorar um vídeo meu". */
export function pedidoDeRemake(fonte: string, segundos: number, args: Json): PedidoDeVideo | string {
  const legenda = args.legenda === true;
  const remake: RemakeConfig = {
    source_path: fonte, duration_s: segundos,
    ...(txt(args.estilo) ? { style: txt(args.estilo) } : {}),
    ...(txt(args.cenario) ? { scene: txt(args.cenario) } : {}),
    ...(txt(args.fala) ? { speech: txt(args.fala) } : {}),
    ...(txt(args.brand_voice_id) ? { brand_voice_id: txt(args.brand_voice_id) } : {}),
    ...(txt(args.traduzir_para) ? { translate: txt(args.traduzir_para) } : {}),
    ...(txt(args.apresentador_id) ? { character_identity_id: txt(args.apresentador_id) } : {}),
    ...(txt(args.instrucao_da_troca) ? { character_prompt: txt(args.instrucao_da_troca) } : {}),
  };
  const erro = validateRemake(remake, { hasCaptions: legenda });
  if (erro) return erro;
  return {
    brief: {
      objetivo: txt(args.resumo) || 'Melhorar um vídeo pelo conector', publico: '', smp: '', numero_heroi: '', tom: '', cta: '',
      duracao_alvo_s: Math.round(segundos), formato: 'remake',
    },
    config: {
      mode: 'remake', remake, max_shots: 0, budget_credits: 0, auto_approve_keyframes: true, auto_approve_audio: true,
      skip_video: false, captions: legenda,
      ...(legenda ? { captions_position: 'bottom' } : {}),
    },
    segundos,
  };
}

/** Sai só na prévia: sem ele, ninguém gera sem ter visto este pedido e este custo. */
export const aceiteDe = (pedido: unknown, usd: number | null) => shortHash(`${JSON.stringify(pedido)}:${usd}`);

/** Soma o que tem preço; o que não tem aparece à parte, para não parecer de graça. */
export function somarCustos(itens: { nome: string; usd: number | null }[]): { usd_estimado: number | null; sem_preco: string[] } {
  const comPreco = itens.filter((i) => i.usd !== null);
  const total = comPreco.reduce((s, i) => s + (i.usd as number), 0);
  return {
    usd_estimado: comPreco.length ? Math.ceil(total * 100) / 100 : null,
    sem_preco: itens.filter((i) => i.usd === null).map((i) => i.nome),
  };
}
