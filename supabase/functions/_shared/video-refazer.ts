// _shared/video-refazer.ts — refaz um vídeo de avatar com a fala corrigida:
// mesmo apresentador, voz e formato, em um job novo. O vídeo de origem não muda.

import { SCRIPT_MAX_CHARS, shortHash } from './heygen.ts';

type Json = Record<string, unknown>;
export interface Troca { de: string; para: string }
export interface JobOrigem { id: string; brief: Json; config: Json; costs?: Json | null; artifacts?: Json | null; created_by?: string | null }

const roteiroDe = (job: JobOrigem) => String((job.config.avatar_video as Json | undefined)?.script ?? '').trim();
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Só vídeo em que o avatar lê um roteiro tem fala para trocar. */
export function erroDeOrigem(job: JobOrigem): string | null {
  if (job.config.mode !== 'avatar_video') return 'Este vídeo não foi feito com avatar lendo um roteiro.';
  return roteiroDe(job) ? null : 'Este vídeo não guardou o roteiro.';
}

/** Troca palavra inteira, para "EUA" não mexer em "PEUAL"; tudo de uma vez, sem trocar o que já foi trocado. */
export function aplicarTrocas(roteiro: string, trocas: Troca[]): { texto: string; faltou: string[] } {
  const novas = new Map(trocas.map((t) => [t.de.normalize('NFC'), t.para]));
  const termos = [...novas.keys()].sort((a, b) => b.length - a.length).map(escapar).join('|');
  const alvo = new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])(?:${termos})(?![\\p{L}\\p{N}\\p{M}])`, 'gu');
  const achados = new Set<string>();
  const texto = roteiro.normalize('NFC').replace(alvo, (achado) => {
    achados.add(achado);
    return novas.get(achado) ?? achado;
  });
  return { texto, faltou: trocas.map((t) => t.de).filter((de) => !achados.has(de.normalize('NFC'))) };
}

/** Roteiro final do pedido: inteiro ou por trocas. Devolve a frase do problema, se houver. */
export function roteiroNovo(job: JobOrigem, roteiro: unknown, trocas: unknown): { texto: string; erro: string | null } {
  const atual = roteiroDe(job);
  const lista = (Array.isArray(trocas) ? trocas : [])
    .map((t) => ({ de: String(t?.de ?? '').trim(), para: String(t?.para ?? '').trim() }))
    .filter((t) => t.de);
  const inteiro = typeof roteiro === 'string' ? roteiro.trim() : '';
  if (!inteiro && !lista.length) return { texto: atual, erro: 'Informe o roteiro novo ou as trocas.' };
  const { texto, faltou } = inteiro ? { texto: inteiro, faltou: [] } : aplicarTrocas(atual, lista);
  if (faltou.length) return { texto, erro: `Não encontrei no roteiro: ${faltou.join(', ')}.` };
  if (texto === atual.normalize('NFC')) return { texto, erro: 'O roteiro novo é igual ao atual.' };
  if (texto.length > SCRIPT_MAX_CHARS) return { texto, erro: `O roteiro passa de ${SCRIPT_MAX_CHARS} caracteres.` };
  return { texto, erro: null };
}

/** Provedor e preço do vídeo de origem, na proporção do roteiro novo: a cobrança é por segundo. */
export function custoDeOrigem(job: JobOrigem, roteiro: string): { provedor: string; usd_estimado: number | null } {
  const cfg = job.config.avatar_video as Json;
  const avatar = (job.artifacts?.avatar ?? {}) as Json;
  const provedor = cfg.provider === 'replicate'
    ? `replicate/${String(cfg.model_id ?? 'avatar')}`
    : `heygen/${String(avatar.engine ?? cfg.engine ?? 'avatar')}`;
  const usd = Number(job.costs?.heygen_usd_est ?? job.costs?.replicate_usd_est);
  const escala = roteiro.length / Math.max(1, roteiroDe(job).length);
  return { provedor, usd_estimado: Number.isFinite(usd) && usd > 0 ? Math.ceil(usd * escala * 100) / 100 : null };
}

/** Sai só na prévia: sem ele, ninguém gera sem ter visto este roteiro e este custo. */
export const codigoDeAceite = (job: JobOrigem, roteiro: string, usd: number | null) =>
  shortHash(`${job.id}:${roteiro}:${usd}`);

/** O job igual que falhou depois de pago é retomado, não pago de novo. */
export const falhouPago = (job: { status: string; artifacts?: Json | null }) => {
  const avatar = (job.artifacts?.avatar ?? {}) as Json;
  return job.status === 'failed' && Boolean(avatar.pending || avatar.result_path);
};

/** Mesma regra do título que o app dá ao vídeo de avatar. */
const tituloDoRoteiro = (roteiro: string) => {
  const primeira = roteiro.trim().split(/(?<=[.!?])\s|\n/)[0] ?? '';
  return primeira.length > 80 ? `${primeira.slice(0, 77).trimEnd()}…` : primeira || 'Vídeo';
};

/** A voz sorteada na origem fica fixa: a padrão da marca pode ter mudado. */
function vozDe(job: JobOrigem): Json | null {
  const voz = (job.config.avatar_video as Json).voice as Json | null | undefined;
  if (voz?.voice_id || voz?.brand_voice_id) return null;
  const avatar = (job.artifacts?.avatar ?? {}) as Json;
  const voice_id = avatar.voice_provider === 'heygen' ? avatar.voice_id : avatar.eleven_voice_id;
  return voice_id ? { ...voz, provider: avatar.voice_provider ?? 'elevenlabs', voice_id } : null;
}

/** Linha do job novo; sem artefatos, ele começa do zero na fila do motor. */
export function jobRefeito(job: JobOrigem, roteiro: string): { brief: Json; created_by: string | null; config: Json } {
  const herdado = job.brief.title === tituloDoRoteiro(roteiroDe(job));
  const voice = vozDe(job);
  return {
    brief: herdado ? { ...job.brief, title: tituloDoRoteiro(roteiro) } : job.brief,
    created_by: job.created_by ?? null,
    config: {
      ...job.config,
      refaz_de: job.id,
      avatar_video: { ...(job.config.avatar_video as Json), script: roteiro, ...(voice ? { voice } : {}) },
    },
  };
}
