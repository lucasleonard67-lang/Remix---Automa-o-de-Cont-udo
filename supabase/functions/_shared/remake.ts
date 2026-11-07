// _shared/remake.ts — "Melhorar um vídeo meu" (modo remake do Diretor).
//
// A pessoa sobe um vídeo e marca o que mudar. O job aplica as opções EM ORDEM,
// uma etapa por vez, sempre sobre o resultado da anterior:
//   1. person    — troca a pessoa pela do Apresentador (Replicate, capability
//                  person_swap, com as fotos dele; mantém movimento e fala)
//   2. visual    — estilo e cena num único vídeo→vídeo (Replicate,
//                  capability scene_v2v; o modelo preserva fala, gesto e câmera)
//   3. speech    — fala nova na voz da marca (ElevenLabs) + lipsync (HeyGen)
//   4. translate — tradução com voz e boca sincronizadas (HeyGen)
// Depois: se só o visual mudou, o áudio original volta por cima (o vídeo→vídeo
// devolve sem som); as legendas da marca usam a montagem que o Diretor já tem.
//
// Aqui fica só o que é decisão pura (ordem, prompt, validação) e o cliente da
// HeyGen — testável sem chamar serviço pago. A orquestração está em
// director-advance (stepRemake*).

import { HeygenError, heygenRequest } from './heygen.ts';

export { HeygenError };

export type RemakeStage = 'person' | 'visual' | 'speech' | 'translate';

export interface RemakeConfig {
  /** vídeo enviado, no bucket renders */
  source_path: string;
  duration_s: number;
  /** id de STYLE_PRESETS */
  style?: string | null;
  /** o que mudar na cena, em uma frase */
  scene?: string | null;
  /** identidade (Avatares) que substitui a pessoa do vídeo */
  character_identity_id?: string | null;
  /** instrução opcional para a troca de pessoa (ex.: "mantenha o óculos") */
  character_prompt?: string | null;
  /** modelo de troca de pessoa (slug "owner/name"); null = primário de person_swap */
  person_model_id?: string | null;
  /** fala nova, dita na voz da marca */
  speech?: string | null;
  /** código de LANGUAGES */
  translate?: string | null;
  /** idioma falado no vídeo enviado (ISO-639-1, ex.: "pt"); orienta as legendas */
  source_language?: string | null;
  /** modelo vídeo→vídeo escolhido na lista (slug "owner/name"); null = primário do catálogo */
  scene_model_id?: string | null;
  /**
   * lipsync pelo Replicate (capability lipsync_post, slug "owner/name"). null =
   * HeyGen; sem chave HeyGen, o primário de lipsync_post do catálogo.
   */
  lipsync_model_id?: string | null;
  /** modelo de voz do catálogo (slug "owner/name"); null = ElevenLabs, a voz da marca */
  tts_model_id?: string | null;
  /**
   * Quadro do vídeo enviado (jpg no bucket renders). Fala que não cabe no
   * tempo do vídeo vira "foto que fala" do HeyGen a partir deste quadro:
   * mesmo rosto e mesmo ambiente, fala do tamanho que for.
   */
  speech_frame_path?: string | null;
  /** voz da fala nova: o gênero de quem aparece no vídeo */
  voice_gender?: 'female' | 'male' | 'own' | 'custom' | null;
  /** voz salva em Vozes (brand_voices); vence voice_gender quando vem */
  brand_voice_id?: string | null;
  /** Voice ID do ElevenLabs escolhido pela pessoa (voice_gender 'custom') */
  voice_id?: string | null;
  /** quem aparece no vídeo (perguntado na tela): voz de reserva se o clone não for possível */
  person_gender?: 'female' | 'male' | null;
  /** amostra da voz de quem fala (WAV tirado do próprio vídeo) para clonar */
  voice_sample_path?: string | null;
}

/** Limite do vídeo enviado (o modelo vídeo→vídeo aceita até 30 s por chamada). */
export const REMAKE_MIN_S = 2;
export const REMAKE_MAX_S = 30;
export const SPEECH_MAX_CHARS = 600;
export const CHARACTER_PROMPT_MAX_CHARS = 500;

/** Slug do catálogo do Replicate ("owner/name"), como vem da tela. */
const MODEL_SLUG_RE = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i;

export const STYLE_PRESETS: Record<string, { label: string; prompt: string }> = {
  marca: {
    label: 'Estilo da minha marca',
    prompt: 'Restyle the whole video with a clean premium brand look',
  },
  cinema: {
    label: 'Cinema',
    prompt: 'Restyle the whole video as a cinematic film shot: rich color grade, soft contrast, shallow depth of field',
  },
  anime: {
    label: 'Anime',
    prompt: 'Restyle the whole video as hand-drawn 2D anime with clean line art and cel shading',
  },
  massinha: {
    label: 'Massinha',
    prompt: 'Restyle the whole video as claymation stop-motion with sculpted plasticine textures',
  },
  quadrinhos: {
    label: 'Quadrinhos',
    prompt: 'Restyle the whole video as a comic book with bold ink outlines and halftone shading',
  },
  pixel: {
    label: 'Pixel art',
    prompt: 'Restyle the whole video as detailed 16-bit pixel art',
  },
};

/** Idiomas oferecidos → nome que a API de tradução da HeyGen aceita. */
export const LANGUAGES: Record<string, { label: string; heygen: string }> = {
  en: { label: 'Inglês', heygen: 'English' },
  es: { label: 'Espanhol', heygen: 'Spanish' },
  fr: { label: 'Francês', heygen: 'French' },
  it: { label: 'Italiano', heygen: 'Italian' },
  de: { label: 'Alemão', heygen: 'German' },
};

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Opções que mexem na imagem (troca de pessoa e/ou estilo e cena). */
export function hasVisual(cfg: RemakeConfig): boolean {
  return hasPersonSwap(cfg) || hasRestyle(cfg);
}

/** Estilo e cena: vão juntos numa chamada só de vídeo→vídeo (devolve sem som). */
export function hasRestyle(cfg: RemakeConfig): boolean {
  return Boolean(clean(cfg.style) || clean(cfg.scene));
}

/** Trocar a pessoa pela do Apresentador escolhido (person_swap, mantém o áudio). */
export function hasPersonSwap(cfg: RemakeConfig): boolean {
  return Boolean(clean(cfg.character_identity_id));
}

/**
 * Etapas que o job precisa fazer, na ordem. A pessoa troca antes do estilo:
 * o modelo de troca reconhece melhor um rosto real que um já estilizado.
 */
export function remakeStages(cfg: RemakeConfig): RemakeStage[] {
  const stages: RemakeStage[] = [];
  if (hasPersonSwap(cfg)) stages.push('person');
  if (hasRestyle(cfg)) stages.push('visual');
  if (clean(cfg.speech)) stages.push('speech');
  if (clean(cfg.translate)) stages.push('translate');
  return stages;
}

/** Próxima etapa ainda não feita, ou null quando acabou. */
export function nextRemakeStage(cfg: RemakeConfig, done: RemakeStage[]): RemakeStage | null {
  return remakeStages(cfg).find((s) => !done.includes(s)) ?? null;
}

/**
 * O vídeo→vídeo de estilo/cena devolve sem som. Se depois dele não houve fala
 * nova nem tradução (que trazem o próprio áudio), o áudio original precisa
 * voltar. A troca de pessoa já devolve com o áudio original (save_audio).
 */
export function needsOriginalAudio(cfg: RemakeConfig): boolean {
  return hasRestyle(cfg) && !clean(cfg.speech) && !clean(cfg.translate);
}

/**
 * Valida o que veio da tela. Devolve a primeira frase de erro (para a pessoa)
 * ou null. `opts` traz o que só o servidor sabe.
 */
export function validateRemake(
  cfg: RemakeConfig,
  opts: { hasCaptions?: boolean } = {},
): string | null {
  if (!clean(cfg.source_path)) return 'Suba o vídeo que você quer melhorar.';
  const d = Number(cfg.duration_s);
  if (!Number.isFinite(d) || d < REMAKE_MIN_S) return `O vídeo precisa ter pelo menos ${REMAKE_MIN_S} segundos.`;
  if (d > REMAKE_MAX_S + 0.5) return `Use um vídeo de até ${REMAKE_MAX_S} segundos.`;
  if (clean(cfg.style) && !STYLE_PRESETS[clean(cfg.style)]) return 'Escolha um dos estilos da lista.';
  if (clean(cfg.translate) && !LANGUAGES[clean(cfg.translate)]) return 'Escolha um dos idiomas da lista.';
  if (clean(cfg.speech).length > SPEECH_MAX_CHARS) {
    return `A fala nova pode ter até ${SPEECH_MAX_CHARS} caracteres.`;
  }
  if (clean(cfg.scene_model_id) && !MODEL_SLUG_RE.test(clean(cfg.scene_model_id))) {
    return 'Escolha um modelo de vídeo da lista.';
  }
  if (clean(cfg.tts_model_id) && !MODEL_SLUG_RE.test(clean(cfg.tts_model_id))) {
    return 'Escolha uma voz da lista.';
  }
  if (clean(cfg.brand_voice_id) && !/^[0-9a-f-]{36}$/i.test(clean(cfg.brand_voice_id))) {
    return 'Escolha uma voz da lista.';
  }
  if (clean(cfg.lipsync_model_id) && !MODEL_SLUG_RE.test(clean(cfg.lipsync_model_id))) {
    return 'Escolha um modelo de lipsync da lista.';
  }
  if (clean(cfg.person_model_id) && !MODEL_SLUG_RE.test(clean(cfg.person_model_id))) {
    return 'Escolha um modelo de troca de pessoa da lista.';
  }
  if (clean(cfg.character_prompt).length > CHARACTER_PROMPT_MAX_CHARS) {
    return `A instrução da troca de pessoa pode ter até ${CHARACTER_PROMPT_MAX_CHARS} caracteres.`;
  }
  if (remakeStages(cfg).length === 0 && !opts.hasCaptions) return 'Marque pelo menos uma melhoria.';
  return null;
}

/**
 * Fala maior que o vídeo sem HeyGen: a foto que fala só existe na HeyGen.
 */
export function speechNeedsHeygenError(videoS: number): string {
  return (
    'A fala nova não cabe no vídeo, e a foto que fala precisa da HeyGen. ' +
    `Encurte a fala para uns ${Math.round(Math.max(0, videoS) * 15)} caracteres ou conecte a HeyGen em Config → Integrações.`
  );
}

/** O lipsync da HeyGen recusa áudio e vídeo com mais de 15% de diferença. */
export const LIPSYNC_MAX_MISMATCH = 0.15;

/**
 * Fala nova que não cabe no vídeo para o lipsync: a frase para a pessoa, ou
 * null quando cabe (ou quando não dá para medir — segue como antes).
 */
export function speechMismatchError(audioS: number, videoS: number): string | null {
  if (!(videoS > 0) || !(audioS > 0)) return null;
  if (Math.abs(audioS - videoS) / videoS <= LIPSYNC_MAX_MISMATCH) return null;
  return (
    `A fala nova dá ${audioS.toFixed(1)} s e o vídeo tem ${videoS.toFixed(1)} s; o HeyGen só sincroniza com até 15% de diferença. ` +
    `Escreva uma fala de uns ${Math.round(videoS * 15)} caracteres ou crie de novo pelo hub.`
  );
}

/**
 * Instrução para o modelo vídeo→vídeo. Em inglês (o idioma em que esses modelos
 * foram treinados); a frase de cena chega já traduzida por quem chama, ou crua
 * se a tradução falhou. Sempre termina pedindo para preservar o que a pessoa
 * não pediu para mudar — é o que faz o resultado parecer o mesmo vídeo.
 */
export function buildVisualPrompt(
  cfg: RemakeConfig,
  extras: { sceneEnglish?: string | null; brandColors?: string[] } = {},
): string {
  const parts: string[] = [];
  const style = STYLE_PRESETS[clean(cfg.style)];
  if (style) {
    let p = style.prompt;
    if (clean(cfg.style) === 'marca' && extras.brandColors?.length) {
      p += `, using the brand palette ${extras.brandColors.slice(0, 4).join(', ')} in wardrobe, set and light`;
    }
    parts.push(`${p}.`);
  }
  const scene = clean(extras.sceneEnglish) || clean(cfg.scene);
  if (scene) parts.push(`Change only this in the scene: ${scene}.`);
  parts.push(
    'Keep everything else identical: same camera motion, framing, timing, gestures and mouth movements.',
  );
  return parts.join(' ').slice(0, 1000);
}

// ── HeyGen (API v3) ──────────────────────────────────────────────────────────
// https://developers.heygen.com — lipsync: POST /v3/lipsyncs; tradução:
// POST /v3/video-translations. Os dois são assíncronos e devolvem um id que se
// consulta até `completed` (video_url) ou `failed` (failure_message).

// Pedido e erro vêm do cliente compartilhado (_shared/heygen.ts).
const heygen = heygenRequest;

export async function heygenCreateLipsync(key: string, videoUrl: string, audioUrl: string): Promise<string> {
  const data = await heygen<{ lipsync_id?: string }>(key, '/v3/lipsyncs', {
    method: 'POST',
    body: JSON.stringify({
      video: { type: 'url', url: videoUrl },
      audio: { type: 'url', url: audioUrl },
      mode: 'precision',
      keep_the_same_format: true,
      enable_watermark: false,
    }),
  });
  if (!data?.lipsync_id) throw new HeygenError('heygen: lipsync criado sem id');
  return data.lipsync_id;
}

export async function heygenCreateTranslation(key: string, videoUrl: string, language: string): Promise<string> {
  const data = await heygen<{ video_translation_ids?: string[] }>(key, '/v3/video-translations', {
    method: 'POST',
    body: JSON.stringify({
      video: { type: 'url', url: videoUrl },
      output_languages: [language],
      mode: 'speed',
    }),
  });
  const id = data?.video_translation_ids?.[0];
  if (!id) throw new HeygenError('heygen: tradução criada sem id');
  return id;
}

export interface HeygenJob {
  status: 'pending' | 'running' | 'completed' | 'failed' | string;
  video_url?: string | null;
  failure_message?: string | null;
  /** código da falha na v3 (ex.: hf_usage_exhausted) — antes era descartado */
  failure_code?: string | null;
}

/**
 * Foto que fala (POST /v3/videos, type "image"): o quadro do vídeo da pessoa +
 * o áudio da fala nova, de qualquer duração. O fundo fica parado; a pessoa
 * mexe a cabeça e fala com a boca sincronizada.
 */
export async function heygenCreateImageVideo(key: string, imageUrl: string, audioUrl: string): Promise<string> {
  const data = await heygen<{ video_id?: string }>(key, '/v3/videos', {
    method: 'POST',
    body: JSON.stringify({
      type: 'image',
      image: { type: 'url', url: imageUrl },
      audio_url: audioUrl,
      title: 'Fala nova (foto que fala)',
      motion_prompt: 'Natural subtle head movement and expressions while speaking, as in the original video',
      expressiveness: 'medium',
      resolution: '1080p',
      aspect_ratio: 'auto',
    }),
  });
  if (!data?.video_id) throw new HeygenError('A HeyGen não devolveu o id do vídeo.');
  return data.video_id;
}

export function heygenGetVideo(key: string, id: string): Promise<HeygenJob> {
  return heygen<HeygenJob>(key, `/v3/videos/${encodeURIComponent(id)}`);
}

export function heygenGetLipsync(key: string, id: string): Promise<HeygenJob> {
  return heygen<HeygenJob>(key, `/v3/lipsyncs/${encodeURIComponent(id)}`);
}

export function heygenGetTranslation(key: string, id: string): Promise<HeygenJob> {
  return heygen<HeygenJob>(key, `/v3/video-translations/${encodeURIComponent(id)}`);
}

/** url quando terminou, null enquanto roda, erro quando falhou. */
export function heygenResult(job: HeygenJob, what: string): string | null {
  if (job.status === 'completed') {
    if (!job.video_url) throw new HeygenError(`A HeyGen terminou ${what} sem devolver o vídeo.`);
    return job.video_url;
  }
  if (job.status === 'failed') {
    const code = job.failure_code ? ` [${job.failure_code}]` : '';
    throw new HeygenError(`A HeyGen não conseguiu fazer ${what}${code}: ${job.failure_message ?? 'sem motivo informado'}.`);
  }
  return null;
}
