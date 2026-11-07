import { formatUsd } from "@/lib/format-usd";
import { PRICE_TBD } from "@/lib/heygen-avatar";

// ---------------------------------------------------------------------------
// Regras puras do construtor de voz (docs/construtor-de-voz.md §4.2 e §6):
// WAV PCM 16-bit mono, medição do áudio e as checagens antes de enviar.
// ---------------------------------------------------------------------------

export const VOICE_SAMPLE_RATE = 44_100;
/** abaixo disso o motor recusa ("Grave pelo menos 30 s.") */
export const VOICE_MIN_S = 30;
/** a HeyGen só usa 3 min e o ElevenLabs piora acima disso: corta aqui */
export const VOICE_MAX_S = 180;
export const VOICE_IDEAL_MIN_S = 60;
export const VOICE_IDEAL_MAX_S = 120;
/** silêncio inicial que mede o ruído de fundo */
export const NOISE_PROBE_S = 2;
export const VOICE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

const CLIP_DB = -1;
const CLIP_RATIO = 0.005;
const LOW_SPEECH_DB = -35;
const NOISY_DB = -50;
const SILENCE_RATIO = 0.4;
const FRAME_S = 0.05;
const SILENT = -120;

/** Amplitude linear → dBFS (0 = o máximo). */
export function toDb(value: number): number {
  return value > 0 ? Math.max(SILENT, 20 * Math.log10(value)) : SILENT;
}

/** Nível RMS (dBFS) de um trecho. */
export function rmsDb(samples: Float32Array, start = 0, end = samples.length): number {
  const to = Math.min(end, samples.length);
  if (to <= start) return SILENT;
  let sum = 0;
  for (let i = start; i < to; i++) sum += samples[i] * samples[i];
  return toDb(Math.sqrt(sum / (to - start)));
}

/** WAV PCM 16-bit mono, pronto para os dois provedores. */
export function encodeWav(samples: Float32Array, sampleRate = VOICE_SAMPLE_RATE): ArrayBuffer {
  const bytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, bytes, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff), true);
  }
  return buffer;
}

export interface VoiceAnalysis {
  seconds: number;
  /** fração das amostras acima de −1 dBFS */
  clipRatio: number;
  /** nível médio da fala (só os trechos com voz) */
  speechDb: number;
  /** ruído de fundo: medido no silêncio inicial ou estimado pelos trechos mais quietos */
  noiseDb: number;
  /** fração do tempo em silêncio */
  silenceRatio: number;
}

/**
 * Mede o áudio em quadros de 50 ms. `noiseDb` vem do silêncio de 2 s da
 * gravação; num arquivo enviado ele é estimado pelo 10º percentil dos quadros.
 */
export function analyzeVoice(
  samples: Float32Array,
  sampleRate: number,
  noiseDb?: number,
): VoiceAnalysis {
  const seconds = samples.length / sampleRate;
  const clipAt = 10 ** (CLIP_DB / 20);
  let clipped = 0;
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) > clipAt) clipped++;

  const frame = Math.max(1, Math.round(FRAME_S * sampleRate));
  const levels: number[] = [];
  for (let start = 0; start < samples.length; start += frame)
    levels.push(rmsDb(samples, start, start + frame));
  const sorted = [...levels].sort((a, b) => a - b);
  const noise = noiseDb ?? (sorted.length ? sorted[Math.floor(sorted.length * 0.1)] : SILENT);
  // fala = quadro bem acima do fundo; nunca abaixo de −50 dBFS
  const threshold = Math.max(noise + 10, -50);
  const voiced = levels.filter((db) => db > threshold);
  const speechDb = voiced.length
    ? toDb(Math.sqrt(voiced.reduce((sum, db) => sum + 10 ** (db / 10), 0) / voiced.length))
    : SILENT;

  return {
    seconds,
    clipRatio: samples.length ? clipped / samples.length : 0,
    speechDb,
    noiseDb: noise,
    silenceRatio: levels.length ? 1 - voiced.length / levels.length : 1,
  };
}

export type VoiceIssueId = "short" | "clipping" | "low" | "noise" | "silence";

export interface VoiceIssue {
  id: VoiceIssueId;
  text: string;
  /** só o barulho de fundo avisa sem bloquear */
  blocking: boolean;
}

/** As checagens antes de enviar (§4.2), na ordem em que a pessoa resolve. */
export function voiceIssues(a: VoiceAnalysis): VoiceIssue[] {
  const issues: VoiceIssue[] = [];
  if (a.seconds < VOICE_MIN_S)
    issues.push({
      id: "short",
      text: `Grave pelo menos ${VOICE_MIN_S} s (o ideal é de 1 a 2 min).`,
      blocking: true,
    });
  if (a.clipRatio > CLIP_RATIO)
    issues.push({
      id: "clipping",
      text: "Está estourando. Afaste um pouco o microfone.",
      blocking: true,
    });
  if (a.speechDb < LOW_SPEECH_DB)
    issues.push({ id: "low", text: "Está baixo. Chegue mais perto.", blocking: true });
  if (a.silenceRatio > SILENCE_RATIO)
    issues.push({ id: "silence", text: "Leia o texto até o fim.", blocking: true });
  if (a.noiseDb > NOISY_DB)
    issues.push({
      id: "noise",
      text: "Tem barulho no fundo. Procure um lugar mais quieto.",
      blocking: false,
    });
  return issues;
}

/** Roteiro guiado em pt-BR: frase neutra, pergunta e emoção (~150 palavras). */
export const RECORDING_SCRIPT: readonly string[] = [
  "Oi, tudo bem? Hoje eu quero te contar como a gente trabalha. Cada projeto começa com uma conversa simples: entender o que você precisa, o prazo e o resultado que faz sentido para o seu negócio. Depois, a gente organiza as etapas, divide as tarefas e acompanha tudo de perto, semana a semana.",
  "E você, já parou para pensar quanto tempo perde com tarefas repetidas? Quantas horas por mês vão embora em planilhas, mensagens e retrabalho? Será que dá para fazer diferente, sem contratar ninguém e sem mudar tudo de uma vez?",
  "Dá, sim! E é isso que me deixa animado. Quando um cliente me conta que finalmente sobrou tempo para pensar no futuro da empresa, eu sei que valeu a pena. Então, se você quer dar esse passo, conta comigo. Vamos juntos!",
];

/** Bloco do roteiro para o segundo atual (o texto anda com o tempo). */
export function scriptBlockAt(seconds: number, total = VOICE_IDEAL_MIN_S): number {
  const per = total / RECORDING_SCRIPT.length;
  return Math.min(RECORDING_SCRIPT.length - 1, Math.max(0, Math.floor(seconds / per)));
}

/** "1:05" */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Custo de uma linha `voice_create` do catálogo (§6). Preço conferido e zero
 * → "grátis"; conferido com valor → o valor; sem linha, sem número ou
 * `cost.verified` diferente de true → "preço a confirmar" (nunca "grátis").
 */
export function voiceCostLabel(row: { cost: unknown } | undefined): string {
  const cost = (row?.cost ?? {}) as { usd?: unknown; verified?: unknown; unit?: unknown };
  if (!row || cost.verified !== true || typeof cost.usd !== "number" || !(cost.usd >= 0))
    return PRICE_TBD;
  if (cost.usd === 0) return "grátis";
  return `${formatUsd(cost.usd)} ${cost.unit === "per_1k_chars" ? "por mil letras" : "por voz"}`;
}

export interface VoiceCatalogRow {
  model_id: string;
  provider: string;
  tier: string | null;
  experience: string[];
  cost: unknown;
}

/**
 * A linha que vale para um caminho: a do provedor que o servidor escolheu
 * (`voice_options`), senão a `default` da experiência.
 */
export function voiceRowFor(
  rows: readonly VoiceCatalogRow[],
  experience: string,
  provider: string | null | undefined,
): VoiceCatalogRow | undefined {
  const of = rows.filter((r) => r.experience.includes(experience));
  return (
    (provider ? of.find((r) => r.provider === provider) : undefined) ??
    of.find((r) => r.tier === "default") ??
    of[0]
  );
}
