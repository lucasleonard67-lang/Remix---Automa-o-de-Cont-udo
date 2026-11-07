// director-advance — avanço reentrante da fila do agente-diretor, 100% edge.
// Invocado pelo pg_cron a cada minuto (invoke_director_advance) OU por admin (JWT).
// Cada invocação avança UM job em passos limitados e persiste checkpoints em
// artifacts — o padrão do video-reconcile aplicado à lane do diretor.
//
// Montagem no SANDBOX do Higgsfield MCP (decisão 2026-08-26, "só faz funcionar"):
//   a cadeia anterior de modelos caixa-preta do Replicate (merge/concat/bed por
//   byte-math de mp3) dessincronizava narração e estourava a duração do áudio —
//   provado por medição nos jobs 4b76d9b0 e 1c76578e. sandbox_exec tem
//   ffmpeg/ffprobe reais: UM passo determinístico faz re-encode uniforme
//   1080×1920/h264, narração alinhada por clipe (apad+atrim na duração REAL via
//   ffprobe), CTA com áudio nativo, bed em aloop cortada exata, amix e
//   loudnorm -14 LUFS. O clipe volta pro bucket por signed upload URL.
//
// Hardening (revisão adversarial 2026-08-26, 26 achados confirmados):
//   - single-flight por LEASE (claimed_by/claimed_at, 3min) com claim atômico e
//     release no fim do tick — ticks sobrepostos e worker local não colidem
//   - checkpoint POR SUBMISSÃO (pending_* persistido item a item)
//   - falha de item remove do pending_* ANTES de falhar o job (retry regenera só o resto)
//   - deadline de 12min por pending (job HF pendurado não congela a fila)
//   - transições de status com guard otimista (cancelamento não é sobrescrito)
//   - budget_credits aplicado antes de cada submissão paga
//   - rotação OAuth otimista (update condicional ao refresh_token antigo)
//
// Deploy config: verify_jwt = false (público; autentica x-cron-secret OU JWT admin).

import { falaPorExtenso } from '../_shared/fala.ts';
import { publishablePath, type EditedVideo } from '../_shared/publishable-video.ts';
import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';
import {
  bedPrompt, clipTtsText, freezeEngineChoice, generateDirectorPlan, readEngineChoice, savePlan, sanitizeSequenceGroups,
  type DirectorPlanShot, type EngineChoice, type VideoEngine,
} from '../_shared/director-core.ts';
import {
  mcp, hfGenerate, hfCheck, hfBalance, hfConnected, hfUploadAudio, hfImportImage, hfImportMedia,
  parseActiveConnector, UUID_RE, type Service,
} from '../_shared/hf-mcp.ts';
import {
  cancelPrediction, createOfficialPrediction, estimateMp3DurationSeconds, createVersionedPrediction, firstOutputUrl, getPrediction,
  streamToBucket, ReplicateError, type CreateOpts, type Prediction,
} from '../_shared/replicate.ts';
import {
  CatalogError, estimateCostUsd, fitResolution, listActiveModels, missingRequiredInputs, renderInputTemplate, resolveDuration,
  resolveModel, sceneResolution, splitModelId, type CostBasis, type VideoModelEntry,
} from '../_shared/video-catalog.ts';
import {
  buildVisualPrompt, heygenCreateImageVideo, heygenCreateLipsync, heygenCreateTranslation, heygenGetLipsync,
  heygenGetTranslation, heygenGetVideo,
  heygenResult, LANGUAGES, needsOriginalAudio, nextRemakeStage, speechMismatchError, speechNeedsHeygenError, validateRemake,
  type RemakeConfig, type RemakeStage,
} from '../_shared/remake.ts';
import { chat } from '../_shared/llm.ts';
import { planoDoJob, planoEmTexto } from '../_shared/roteiro.ts';
import { parseSttOutput } from '../_shared/stt.ts';
import {
  applyClipSwap, computeEditModes, type EditKind, redoAdjustment, type SceneEditState, withClip,
} from '../_shared/scene-edit.ts';
import {
  avatarVoiceAsClone, defaultBrandVoice, defaultFitsGender, findBrandVoice, heygenCloneFailure, heygenCloneVoice, heygenDeleteModelVoice, heygenModelVoice,
  loadBrandVoice, type SpeechResult, speechBytes, type VoiceRef, voiceRefOf,
} from '../_shared/voices.ts';
import {
  buildAvatarVideoBody, buildVideoAgentBody, createAvatarVideo, createVideoAgent, getLook, getVideo, getVideoAgent,
  HEYGEN_NOT_CONNECTED, heygenBusy, type HeygenEngine, HeygenError, heygenHumanError, heygenKey, heygenKeyOrNull,
  type HeygenLook, heygenStatus, idempotencyKey, videoResult,
} from '../_shared/heygen.ts';
import { segredoIgual } from '../_shared/segredo-igual.ts';
import {
  type AvatarVideoConfig, chooseAvatarVoice, ensureBrandKit, ensurePreviewPhoto, type HeygenRef, heygenRefOf,
  lookBelongsTo, savedHeygenVoice, parseFileRef, refreshHeygenRef, validateAvatarVideo,
  validateVideoAgent, type VideoAgentConfig,
} from '../_shared/avatar-video.ts';
import { NotConnectedError, PROVIDER_LABEL } from '../_shared/not-connected.ts';
import { ArchivedFileError, downloadRestoring, ensureLocal, signRestoring } from '../_shared/drive-restore.ts';
import { isMp4Head, MIN_DELIVERY_BYTES } from '../_shared/video-receita.ts';
type Job = {
  id: string;
  brief: Record<string, unknown>;
  config: Record<string, unknown>;
  status: string;
  plan: { concept?: string; look_lock?: string; character_gender?: Gender; shots?: DirectorPlanShot[] } | null;
  artifacts: Record<string, unknown>;
  costs: Record<string, unknown>;
};

const BUCKET = 'renders';
const LEASE_MINUTES = 3;
const PENDING_DEADLINE_MS = 12 * 60_000;
// Replicate enfileira (Kling/Seedance passam de 12 min com frequência): prazo
// próprio, e ao estourar a predição é CANCELADA antes de sair do rastro —
// descartar sem cancelar deixava o provider cobrando por um clipe que ninguém pega.
const RP_PENDING_DEADLINE_MS = 40 * 60_000;
/** Etapa do remake (Replicate ou HeyGen: lipsync e tradução passam de 24 min). */
const REMAKE_DEADLINE_MS = 60 * 60_000;
// 429 no create: pausa a submissão de novas cenas por este tempo (ou o
// Retry-After do provider) em vez de falhar o job em 15 s.
const RP_RETRY_PAUSE_MS = 90_000;
// fila de PRODUÇÃO (inclui aliases legados da lane worker: assembling/mastering).
// 'publishing' NÃO entra aqui: um job done sendo publicado é mais antigo que
// qualquer produção nova e monopolizaria o slot único do tick — publicação roda
// num slot próprio por tick (ver handler).
const RUNNABLE = ['queued', 'planning', 'plan_ready', 'tts', 'keyframes', 'videos', 'muxing', 'concatenating', 'bed', 'assembling', 'mastering'];

// ── modelos HF como CONFIG (director_state.hf_models) ────────────────────────
// O catálogo do MCP gira sem aviso: em 2026-08-26, no meio de uma run, TODOS os
// modelos de terceiros sumiram (nano_banana/seedance/kling/minimax) — restou a
// família da casa. Trocar modelo/params/limites é UPDATE em director_state.
// cta_audio_ref: se o modelo de vídeo aceita audio_references (lipsync da fala
// auditada no CTA). Cinema Studio NÃO aceita → CTA vira narração sobre o clipe.
type AbSpec = { model: string; max_s: number; extra: Record<string, unknown> };
type HfModels = {
  image: string;
  video: string;
  ab_video: string;
  video_min_s: number;
  video_max_s: number;
  ab_max_s: number;
  cta_audio_ref: boolean;
  image_extra: Record<string, unknown>;
  video_extra: Record<string, unknown>;
  ab_extra: Record<string, unknown>;
  /** lista de braços do A/B (tem precedência sobre ab_video/ab_max_s/ab_extra) */
  ab?: AbSpec[];
};
const HF_MODEL_DEFAULTS: HfModels = {
  image: 'cinematic_studio_2_5',
  video: 'cinematic_studio_3_0',
  ab_video: 'cinematic_studio_video_v2',
  video_min_s: 4,
  video_max_s: 15,
  ab_max_s: 12,
  cta_audio_ref: false,
  image_extra: { resolution: '2k' },
  // áudio nativo dos clipes não é usado na montagem (narração + bed cobrem tudo)
  video_extra: { resolution: '1080p', generate_audio: false },
  ab_extra: { mode: 'std', multi_shots: true, multi_shot_mode: 'auto', sound: 'off' },
};

async function hfModels(service: Service): Promise<HfModels> {
  const { data } = await service.from('director_state').select('value').eq('key', 'hf_models').maybeSingle();
  const v = (data?.value ?? {}) as Partial<HfModels>;
  return { ...HF_MODEL_DEFAULTS, ...v };
}

// ── catálogo vivo do Higgsfield (director_state.hf_catalog) ─────────────────
// Uma vez por dia, com o Higgsfield conectado: models_explore (search) para
// vídeo e imagem, gravado CRU (o formato da resposta não está verificado —
// docs/catalogo-higgsfield.md §2). Ninguém consome ainda; o portão de modelos
// passa a ler daqui quando o parser for fixado com uma resposta real.
const HF_CATALOG_EVERY_MS = 24 * 60 * 60_000;
const HF_CATALOG_MAX_CHARS = 20_000;

async function stepHfCatalog(service: Service): Promise<void> {
  const { data } = await service.from('director_state').select('value').eq('key', 'hf_catalog').maybeSingle();
  const prev = (data?.value ?? {}) as { fetched_at?: string };
  const last = prev.fetched_at ? Date.parse(prev.fetched_at) : NaN;
  if (Number.isFinite(last) && Date.now() - last < HF_CATALOG_EVERY_MS) return;
  if (!(await hfConnected(service))) return;
  const results: Record<string, string> = {};
  const errors: string[] = [];
  for (const type of ['video', 'image']) {
    try {
      const out = await mcp(service, 'models_explore', { action: 'search', type, limit: 50 });
      results[type] = out.slice(0, HF_CATALOG_MAX_CHARS);
    } catch (err) {
      errors.push(`${type}: ${errText(err).slice(0, 200)}`);
    }
  }
  // grava mesmo com erro: o carimbo segura a próxima tentativa por 24 h
  const { error } = await service.from('director_state').upsert(
    { key: 'hf_catalog', value: { fetched_at: new Date().toISOString(), results, error: errors.join(' · ') || null } },
    { onConflict: 'key' },
  );
  if (error) throw new Error(`hf_catalog: ${error.message}`);
}

// Modelos que o usuário pode escolher na tela (além dos configurados em hf_models).
// Id fora desta lista cai no padrão — a escolha vem de um jsonb editável pelo cliente.
const HF_USER_MODELS = ['cinematic_studio_3_0', 'cinematic_studio_video_v2'];

/** Braço (modelo + teto + extras) do Higgsfield para um model_id escolhido; sem match → padrão. */
function hfSpecFor(models: HfModels, modelId: string | null): AbSpec {
  const arms = Array.isArray(models.ab) ? models.ab : [];
  const allowed = new Set([models.video, models.ab_video, ...arms.map((a) => a.model), ...HF_USER_MODELS]);
  const id = modelId && allowed.has(modelId) ? modelId : models.video;
  if (id === models.video) return { model: id, max_s: models.video_max_s, extra: models.video_extra };
  if (id === models.ab_video) return { model: id, max_s: models.ab_max_s, extra: models.ab_extra };
  const arm = arms.find((a) => a.model === id);
  if (arm) return arm;
  // id da lista fixa sem config própria: Cinema Studio Video 2 usa os extras do A/B legado
  return id === 'cinematic_studio_video_v2'
    ? { model: id, max_s: models.ab_max_s, extra: models.ab_extra }
    : { model: id, max_s: models.video_max_s, extra: {} };
}

/** Limites de duração do modelo de cena do Replicate (enum fechado ou faixa). */
function replicateCaps(entry: VideoModelEntry): { min: number; max: number } {
  const l = entry.limits;
  if (Array.isArray(l.durations) && l.durations.length) {
    return { min: Math.min(...l.durations), max: Math.max(...l.durations) };
  }
  return { min: l.duration_min ?? 4, max: l.duration_max ?? l.max_duration_s ?? 12 };
}

/** Caps de duração de unidade CONGELADAS no job (config mudar no meio não muda as unidades). */
async function unitCaps(service: Service, job: Job): Promise<{ min: number; max: number }> {
  const arts = job.artifacts as { unit_caps?: { min: number; max: number } };
  if (arts.unit_caps) return arts.unit_caps;
  const choice = readEngineChoice(job);
  if (choice.engine === 'replicate') {
    arts.unit_caps = replicateCaps(await replicateSceneEntry(service, choice.model_id));
  } else {
    const m = await hfModels(service);
    arts.unit_caps = { min: m.video_min_s, max: Math.min(m.video_max_s, hfSpecFor(m, choice.model_id).max_s) };
  }
  await patch(service, job.id, { artifacts: job.artifacts });
  return arts.unit_caps;
}

// ── driver Replicate (cenas imagem → vídeo via catálogo video_models) ─────────
// Mesmo contrato do Higgsfield: submete, guarda o id em pending_vid e o tick
// seguinte faz poll (getPrediction). O webhook obrigatório do create aponta
// para o ack `?hook=` desta função — o avanço é por poll, como no Higgsfield.
async function replicateToken(service: Service): Promise<string> {
  const { data } = await service.rpc('get_vault_secret', { _name: 'REPLICATE_API_TOKEN' });
  if (typeof data !== 'string' || !data) {
    throw new NotConnectedError(
      'replicate',
      'Replicate: o token de API não está salvo. Cole o token em Config → Integrações → Replicate ' +
      'e clique em "Retomar do checkpoint".',
    );
  }
  return data;
}

/** Mensagem curta do braço A/B pulado por provedor desconectado; null se o erro é outro. */
function abSkippedMessage(err: unknown): string | null {
  return err instanceof NotConnectedError
    ? `${PROVIDER_LABEL[err.provider]} não conectado — cena extra pulada`
    : null;
}

/**
 * Cria UMA predição no Replicate a partir de uma linha do catálogo (oficial ou
 * community com version_hash), com o webhook desta função, erro traduzido e o
 * custo estimado somado em job.costs. Usado pela etapa visual do remake, pela
 * voz do catálogo e pelo merge de áudio — um lugar só.
 */
async function createCatalogPrediction(
  service: Service, job: Job, token: string, entry: VideoModelEntry,
  input: Record<string, unknown>, basis: CostBasis,
): Promise<Prediction> {
  let prediction: Prediction;
  try {
    const { owner, name } = splitModelId(entry.model_id);
    const opts: CreateOpts = {
      input,
      webhookUrl: `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/director-advance?hook=replicate`,
      webhookEvents: ['completed'],
    };
    prediction = entry.kind === 'official'
      ? await createOfficialPrediction(token, owner, name, opts)
      : await createVersionedPrediction(token, entry.version_hash as string, opts);
  } catch (err) {
    throw replicateError(err);
  }
  const costs = job.costs as { replicate_usd_est?: number };
  costs.replicate_usd_est = Number(((costs.replicate_usd_est ?? 0) + estimateCostUsd(entry, basis)).toFixed(4));
  await patch(service, job.id, { costs: job.costs });
  return prediction;
}

async function replicateSceneEntry(service: Service, modelId: string | null): Promise<VideoModelEntry> {
  try {
    return await resolveModel(service, 'scene_i2v', modelId);
  } catch (err) {
    if (err instanceof CatalogError) {
      throw new Error(
        `Replicate: ${err.message} Escolha outro modelo em Vídeos → Novo ou ative este em Config → Integrações.`,
      );
    }
    throw err;
  }
}

/** Modelo de imagem dos quadros no Replicate (capability `keyframe`), sem o Higgsfield. */
async function keyframeEntry(service: Service): Promise<VideoModelEntry> {
  try {
    return await resolveModel(service, 'keyframe');
  } catch (err) {
    if (err instanceof CatalogError) {
      throw new Error(`Replicate: ${err.message} Ative um modelo de quadros em Ajustes → Integrações → Replicate.`);
    }
    throw err;
  }
}

/** O Claude da pessoa está ligado pelo conector personalizado (há um acesso vivo). */
async function claudeConectado(service: Service): Promise<boolean> {
  const { data } = await service.from('mcp_tokens').select('id').is('revoked_at', null).limit(1);
  return Boolean(data?.length);
}

/** Erro do Replicate → mensagem com próximo passo (a classe já vem em pt-BR do client). */
function replicateError(err: unknown): Error {
  if (err instanceof ReplicateError) {
    // `cause` guarda o original: quem chama decide se é transiente (pausa) ou terminal
    return new Error(`Replicate: ${err.message} Depois, clique em "Retomar produção".`, { cause: err });
  }
  return err instanceof Error ? err : new Error(String(err));
}

/** Resolução das cenas: `config.resolution` (720p | 1080p | 4k), padrão 720p, ajustada ao modelo. */
function pickResolution(entry: VideoModelEntry, job: Job): string | undefined {
  return sceneResolution(entry.limits, (job.config as { resolution?: unknown }).resolution);
}

/** Estado da predição: url quando terminou; null enquanto roda; erro quando falhou. */
async function replicateCheck(token: string, predictionId: string): Promise<string | null> {
  const p = await getPrediction(token, predictionId);
  if (p.status === 'succeeded') {
    const url = firstOutputUrl(p.output);
    if (!url) throw new Error(`Replicate: predição ${predictionId} terminou sem arquivo de vídeo.`);
    return url;
  }
  if (p.status === 'failed' || p.status === 'canceled' || p.status === 'aborted') {
    // moderação do modelo (E005 "flagged as sensitive"): quem chama tenta uma
    // vez com prompt neutro antes de desistir da cena
    if (/sensitive|flagged|nsfw|safety|E005/i.test(p.error ?? '')) {
      throw new ReplicateError(422, 'moderation', `A cena foi barrada pela moderação do modelo (${(p.error ?? '').slice(0, 120)}).`);
    }
    throw new Error(
      `Replicate: a cena falhou no modelo (${p.error ?? p.status}). ` +
      'Ajuste o briefing ou escolha outro modelo e clique em "Retomar produção".',
    );
  }
  return null;
}

/** Prompt neutro para a segunda tentativa de uma cena barrada pela moderação. */
function safePrompt(prompt: string): string {
  const cleaned = prompt
    .replace(/\b(blood|bleeding|wound|injur(?:y|ed)|needle|syringe|surgery|dead|kill|gun|knife|naked|nude|lingerie|bikini)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return `${cleaned} Safe, family-friendly scene: fully clothed adults, calm everyday setting, no medical procedures, no violence, no nudity.`;
}

/** Cria a predição de UMA cena; devolve id + duração cobrada. Custo estimado soma em costs. */
async function submitReplicateClip(
  service: Service,
  job: Job,
  token: string,
  entry: VideoModelEntry,
  args: { prompt: string; keyframePath: string; seconds: number },
): Promise<{ id: string; dur_s: number }> {
  const duration = resolveDuration(entry.limits, args.seconds);
  const resolution = pickResolution(entry, job);
  const input = renderInputTemplate(entry.input_template, {
    prompt: args.prompt,
    negative_prompt: 'text, letters, logos, watermark, subtitles, deformed hands, extra fingers',
    keyframe_url: await sign(service, args.keyframePath, 21600),
    duration_int: duration ?? undefined,
    duration_ms: duration != null ? duration * 1000 : undefined,
    resolution,
  });
  const missing = missingRequiredInputs(entry, input);
  if (missing.length) {
    throw new Error(
      `Replicate: o modelo ${entry.model_id} exige ${missing.join(', ')} e o catálogo não preenche. ` +
      'Escolha outro modelo em Vídeos → Novo ou corrija o modelo em Config → Integrações.',
    );
  }
  const opts: CreateOpts = {
    input,
    // ack `?hook=` desta função: o create exige webhook; o avanço real é por poll
    webhookUrl: `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/director-advance?hook=replicate`,
    webhookEvents: ['completed'],
  };
  let prediction: Prediction;
  try {
    const { owner, name } = splitModelId(entry.model_id);
    prediction = entry.kind === 'official'
      ? await createOfficialPrediction(token, owner, name, opts)
      : await createVersionedPrediction(token, entry.version_hash as string, opts);
  } catch (err) {
    throw replicateError(err);
  }
  const dur_s = duration ?? Math.max(1, Math.ceil(args.seconds));
  const costs = job.costs as { replicate_usd_est?: number };
  costs.replicate_usd_est = Number(((costs.replicate_usd_est ?? 0) + estimateCostUsd(entry, { duration_s: dur_s, resolution })).toFixed(4));
  await patch(service, job.id, { costs: job.costs });
  return { id: prediction.id, dur_s };
}

/** Baixa o clipe (URL efêmera do Replicate) direto para o bucket, em stream. */
async function saveReplicateClip(service: Service, url: string, path: string) {
  try {
    await streamToBucket(service, url, BUCKET, path, 'video/mp4', 400 * 1024 * 1024);
  } catch (err) {
    throw replicateError(err);
  }
}

async function assertBudget(service: Service, job: Job, context: string) {
  const budget = Number((job.config as { budget_credits?: number }).budget_credits ?? 0);
  const start = (job.costs as { hf_credits_start?: number }).hf_credits_start;
  if (budget <= 0 || start == null) return;
  const bal = await hfBalance(service).catch(() => null);
  if (bal != null && start - bal >= budget) {
    throw new Error(`budget_exceeded: ${(start - bal).toFixed(0)}/${budget} créditos (${context})`);
  }
}

// ── storage ──────────────────────────────────────────────────────────────────
async function putObject(service: Service, path: string, bytes: Uint8Array, contentType: string) {
  const { error } = await service.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`upload ${path}: ${error.message}`);
}

/** URL assinada; `bucket` padrão é renders (fotos de apresentador vivem em brand-assets). */
async function sign(service: Service, path: string, expiresIn = 21600, bucket = BUCKET): Promise<string> {
  return await signRestoring(service, bucket, path, expiresIn);
}

async function signUpload(service: Service, path: string, keep = false): Promise<string> {
  // keep: o pedido ao Claude pode ser lido de novo depois do envio; não apaga o que ele mandou
  if (!keep) await service.storage.from(BUCKET).remove([path]).catch(() => {});
  // upsert: um run zumbi do sandbox (pós-deadline) pode recriar o objeto antes do
  // PUT do retry — sem upsert o retry falharia com "duplicate" fantasma
  const { data, error } = await service.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error || !data?.signedUrl) throw new Error(`signUpload ${path}: ${error?.message}`);
  return data.signedUrl;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

// ── ElevenLabs ───────────────────────────────────────────────────────────────
async function elevenKey(service: Service): Promise<string> {
  const { data } = await service.rpc('get_vault_secret', { _name: 'ELEVEN_API_KEY' });
  if (!data) {
    throw new NotConnectedError(
      'elevenlabs',
      'Cole a chave do ElevenLabs em Config → Integrações (narração, trilha e legendas dependem dela) e clique em "Retomar produção".',
    );
  }
  return data as string;
}

async function elevenVoice(service: Service): Promise<string> {
  const { data } = await service.rpc('get_vault_secret', { _name: 'ELEVEN_VOICE_ID' });
  return (data as string) || 'yxcG28bYeAMra6K4nj10';
}

type Gender = 'female' | 'male';
// voz padrão por gênero quando a configurada não bate com o personagem
// (sobrescreve com ELEVEN_VOICE_ID_FEMALE / ELEVEN_VOICE_ID_MALE no Vault)
const VOICE_BY_GENDER: Record<Gender, string> = {
  female: 'EXAVITQu4vr4xnSDxMaL',
  male: 'yxcG28bYeAMra6K4nj10',
};

/**
 * A voz existe na conta ElevenLabs conectada? 404/400 = não (a fala daria 404
 * depois de pagar o resto). Rede ou outro erro = não dá para saber: segue.
 */
async function elevenVoiceExists(service: Service, voiceId: string): Promise<boolean> {
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/voices/${voiceId}`, {
      headers: { 'xi-api-key': await elevenKey(service) },
    });
    return r.status !== 404 && r.status !== 400;
  } catch {
    return true;
  }
}

/** Voz da narração: a configurada, trocada só se o gênero dela contradiz o personagem. */
async function narrationVoice(service: Service, gender?: Gender): Promise<string> {
  const configured = await elevenVoice(service);
  if (!gender) {
    if (!(await elevenVoiceExists(service, configured))) {
      throw new Error(
        'A voz padrão da ElevenLabs não existe na conta conectada. Troque o Voice ID em Ajustes → Integrações → ' +
        'ElevenLabs (ou escolha uma voz para a marca) e clique em "Retomar do checkpoint".',
      );
    }
    return configured;
  }
  const r = await fetch(`https://api.elevenlabs.io/v1/voices/${configured}`, {
    headers: { 'xi-api-key': await elevenKey(service) },
  });
  // Gênero pedido é regra: só mantém a configurada se ELA for desse gênero.
  // Sem conseguir ler o gênero (permissão/voz da biblioteca) NÃO arrisca —
  // usava a configurada e saía voz de homem numa mulher.
  const voiceGender = r.ok ? ((await r.json()).labels?.gender as string | undefined) : undefined;
  if (voiceGender === gender) return configured;
  const { data } = await service.rpc('get_vault_secret', { _name: `ELEVEN_VOICE_ID_${gender.toUpperCase()}` });
  return (data as string) || VOICE_BY_GENDER[gender];
}

// Erro do ElevenLabs → instrução que o usuário consegue seguir. O JSON cru do
// provedor ("missing the permission text_to_speech…") não diz onde clicar.
const ELEVEN_PERMISSIONS: Record<string, string> = {
  text_to_speech: 'Text to Speech',
  speech_to_text: 'Fala para Texto',
  sound_generation: 'Sound Effects',
};
const ELEVEN_STEP: Record<string, string> = {
  text_to_speech: 'a narração',
  speech_to_text: 'as legendas',
  sound_generation: 'a trilha de fundo',
};

async function elevenError(permission: string, r: Response): Promise<Error> {
  const raw = await r.text();
  let detail: { status?: string; code?: string; message?: string } = {};
  try {
    const parsed = JSON.parse(raw).detail;
    detail = typeof parsed === 'string' ? { message: parsed } : (parsed ?? {});
  } catch { /* corpo não-JSON: cai no genérico */ }
  const msg = detail.message ?? raw;
  const step = ELEVEN_STEP[permission];
  const missing = /missing the permission (\w+)/i.exec(msg)?.[1];
  if (missing) {
    const label = ELEVEN_PERMISSIONS[missing] ?? missing;
    return new Error(
      `ElevenLabs: a chave de API não tem permissão para "${label}", usada para gerar ${step}. ` +
      `Em elevenlabs.io → Desenvolvedores → Chaves de API, edite a chave usada na Automação de Redes Sociais, ` +
      `marque "${label}" como Acesso, salve e clique em "Retomar do checkpoint".`,
    );
  }
  if (detail.status === 'free_users_not_allowed' || /creator tier/i.test(msg)) {
    return new Error(
      'ElevenLabs: a voz configurada é da biblioteca e exige o plano Creator ou superior. ' +
      'Troque o Voice ID em Config → Integrações → ElevenLabs por uma voz padrão (aba Vozes → "Padrão" no ElevenLabs) ' +
      'ou faça upgrade do plano, e clique em "Retomar do checkpoint".',
    );
  }
  // quota vem como 401 no ElevenLabs — checar antes do "chave inválida"
  if (r.status === 402 || detail.status === 'quota_exceeded' || /quota/i.test(msg)) {
    return new Error(
      `ElevenLabs: os créditos da conta acabaram antes de gerar ${step}. ` +
      'Recarregue o plano no ElevenLabs e clique em "Retomar do checkpoint".',
    );
  }
  if (r.status === 401) {
    return new Error(
      'ElevenLabs: a chave de API é inválida ou foi revogada. ' +
      'Cadastre uma chave nova em Config → Integrações e clique em "Retomar do checkpoint".',
    );
  }
  if (r.status === 429) {
    return new Error(
      `ElevenLabs: limite de requisições atingido ao gerar ${step}. ` +
      'Espere alguns minutos e clique em "Retomar do checkpoint".',
    );
  }
  return new Error(`ElevenLabs falhou ao gerar ${step} (HTTP ${r.status}): ${msg.slice(0, 160)}`);
}

/** Duração aproximada de mp3 por bytes (só p/ gates de fala curta; a montagem mede com ffprobe). */
const mp3Duration = (bytes: Uint8Array) => (bytes.byteLength * 8) / 128_000;

/**
 * Clone instantâneo da voz de quem fala no vídeo (ElevenLabs IVC). A amostra
 * é o áudio do próprio vídeo, extraído no navegador como WAV. Devolve o
 * voice_id; quem chama apaga a voz depois de usar (as vagas de voz da conta
 * são limitadas).
 */
async function cloneVoice(service: Service, samplePath: string, name: string): Promise<string> {
  const data = await downloadRestoring(service, BUCKET, samplePath);
  const form = new FormData();
  form.append('name', name.slice(0, 60));
  form.append('files', new File([await data.arrayBuffer()], 'amostra.wav', { type: 'audio/wav' }));
  form.append('remove_background_noise', 'true');
  form.append('description', 'Clone temporário para a fala nova de um vídeo (Content Engine).');
  const r = await fetch('https://api.elevenlabs.io/v1/voices/add', {
    method: 'POST',
    headers: { 'xi-api-key': await elevenKey(service) },
    body: form,
  });
  if (!r.ok) {
    const raw = await r.text();
    if (r.status === 401 || /permission|voices_write|create_instant_voice_clone/i.test(raw)) {
      throw new Error(
        'A chave do ElevenLabs não pode criar vozes. Em elevenlabs.io → API Keys, ligue a permissão "Voices" (escrita) e clique em "Retomar produção". ' +
        `Detalhe: ${raw.slice(0, 200)}`,
      );
    }
    throw new Error(`ElevenLabs não clonou a voz (${r.status}): ${raw.slice(0, 300)}`);
  }
  const body = (await r.json()) as { voice_id?: string };
  if (!body.voice_id) throw new Error('ElevenLabs não devolveu o id da voz clonada.');
  return body.voice_id;
}

async function deleteVoice(service: Service, voiceId: string): Promise<void> {
  await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voiceId)}`, {
    method: 'DELETE',
    headers: { 'xi-api-key': await elevenKey(service) },
  }).catch((e) => console.error('deleteVoice:', e));
}

async function ttsMp3(service: Service, text: string, voice: string): Promise<Uint8Array> {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': await elevenKey(service), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_v3', voice_settings: { stability: 0.5 } }),
  });
  if (!r.ok) throw await elevenError('text_to_speech', r);
  return new Uint8Array(await r.arrayBuffer());
}

/** Trilha de fundo: até 30 s e `loop` (emenda sem corte; o ffmpeg repete na montagem). */
const SFX_MAX_S = 30;
async function sfxMp3(service: Service, text: string, seconds: number): Promise<Uint8Array> {
  const r = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST',
    headers: { 'xi-api-key': await elevenKey(service), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, duration_seconds: Math.min(SFX_MAX_S, seconds), prompt_influence: 0.4, loop: true }),
  });
  if (!r.ok) throw await elevenError('sound_generation', r);
  return new Uint8Array(await r.arrayBuffer());
}

/**
 * STT scribe_v2 com timestamps por palavra (legendas queimadas). `languageCode`
 * = idioma falado (ISO-639-1) quando conhecido; sem ele, o ElevenLabs detecta.
 */
async function sttWords(
  service: Service, audioUrl: string, languageCode?: string | null,
): Promise<{ text: string; start: number; end: number }[]> {
  const media = await fetch(audioUrl);
  if (!media.ok) throw new Error(`stt download ${media.status}`);
  const form = new FormData();
  form.append('model_id', 'scribe_v2');
  if (languageCode) form.append('language_code', languageCode);
  form.append('file', new Blob([await media.arrayBuffer()], { type: 'video/mp4' }), 'final.mp4');
  const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': await elevenKey(service) },
    body: form,
  });
  if (!r.ok) throw await elevenError('speech_to_text', r);
  const j = await r.json() as { words?: { type: string; text: string; start: number; end: number }[] };
  return (j.words ?? []).filter((w) => w.type === 'word');
}

// ── legendas: presets de estilo/animação (ASS renderizado por libass) ────────
// Bloco autocontido (sem service/imports): é extraído tal-qual para os testes.
const CAPTION_STYLES = ['caps', 'karaoke', 'build', 'pop', 'box', 'neon', 'minimal'] as const;
type CaptionStyle = (typeof CAPTION_STYLES)[number];
type CaptionPosition = 'bottom' | 'center' | 'top';
type CaptionCfg = { style: CaptionStyle; position: CaptionPosition; accent: string };
type Word = { text: string; start: number; end: number };

function captionCfg(config: Record<string, unknown>): CaptionCfg {
  const style = (CAPTION_STYLES as readonly string[]).includes(String(config.captions_style))
    ? (config.captions_style as CaptionStyle) : 'caps';
  const position = ['bottom', 'center', 'top'].includes(String(config.captions_position))
    ? (config.captions_position as CaptionPosition) : 'bottom';
  const accent = /^#[0-9a-fA-F]{6}$/.test(String(config.captions_accent ?? ''))
    ? String(config.captions_accent).toUpperCase() : '#FFD400';
  return { style, position, accent };
}

const assTime = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(2).padStart(5, '0');
  return `${h}:${String(m).padStart(2, '0')}:${sec}`;
};
/** #RRGGBB → cor de linha de estilo (&HAABBGGRR) */
const styleColor = (hex: string, alpha = 0) =>
  `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`;
/** #RRGGBB → cor de tag de override (&HBBGGRR&) */
const tagColor = (hex: string) => `&H${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}&`;
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};
const escAss = (t: string) => t.replace(/[{}\\]/g, '');

/** Agrupa palavras em cartelas: corta em pontuação, em gap >0,8s ou no máximo de palavras. */
function groupWords(words: Word[], maxWords: number): Word[][] {
  const groups: Word[][] = [];
  let cur: Word[] = [];
  const flush = () => { if (cur.length) groups.push(cur); cur = []; };
  for (const w of words) {
    if (cur.length && w.start - cur[cur.length - 1].end > 0.8) flush();
    cur.push(w);
    if (cur.length >= maxWords || /[.!?…]$/.test(w.text)) flush();
  }
  flush();
  return groups;
}

type StyleSpec = {
  font: string; size: number; bold: boolean; outline: number; shadow: number;
  borderStyle: 1 | 3; maxWords: number; upper: boolean; spacing: number;
  primary: string; outlineColor: string; back: string;
};

function styleSpec(cfg: CaptionCfg): StyleSpec {
  const white = styleColor('#FFFFFF'), black = styleColor('#000000');
  const base = { shadow: 0, borderStyle: 1 as const, upper: true, spacing: 1, primary: white, outlineColor: black, back: styleColor('#000000', 0x80) };
  switch (cfg.style) {
    case 'caps':    return { ...base, font: 'DejaVu Sans', size: 84, bold: true, outline: 7, maxWords: 3 };
    case 'karaoke': return { ...base, font: 'Montserrat ExtraBold', size: 86, bold: false, outline: 6, maxWords: 4 };
    case 'build':   return { ...base, font: 'Montserrat ExtraBold', size: 90, bold: false, outline: 6, maxWords: 3 };
    case 'pop':     return { ...base, font: 'Montserrat ExtraBold', size: 96, bold: false, outline: 7, maxWords: 3 };
    case 'box':     return {
      ...base, font: 'Montserrat ExtraBold', size: 78, bold: false, outline: 16, maxWords: 3, borderStyle: 3,
      primary: luminance(cfg.accent) > 0.6 ? styleColor('#111111') : white,
      outlineColor: styleColor(cfg.accent), back: styleColor(cfg.accent),
    };
    case 'neon':    return { ...base, font: 'Bebas Neue', size: 132, bold: false, outline: 2, maxWords: 4, spacing: 3 };
    case 'minimal': return {
      ...base, font: 'DejaVu Sans', size: 58, bold: false, outline: 2, shadow: 1, maxWords: 7, upper: false, spacing: 0,
      outlineColor: styleColor('#000000', 0x50), back: styleColor('#000000', 0xA0),
    };
  }
}

const POSITION = { bottom: { align: 2, marginV: 700 }, center: { align: 5, marginV: 0 }, top: { align: 8, marginV: 380 } };

/** Gera o .ass completo: estilo + eventos com as animações do preset. */
function buildAss(words: Word[], cfg: CaptionCfg): string {
  const spec = styleSpec(cfg);
  const pos = POSITION[cfg.position];
  const T = (ws: Word[]) => ws.map((w) => (spec.upper ? escAss(w.text).toUpperCase() : escAss(w.text))).join(' ');
  const W = (w: Word) => (spec.upper ? escAss(w.text).toUpperCase() : escAss(w.text));
  const groups = groupWords(words, spec.maxWords);
  const events: string[] = [];
  const ev = (start: number, end: number, text: string, layer = 0) => {
    if (end <= start) return; // nunca estende: evento estendido sobrepõe o próximo na mesma layer
    events.push(`Dialogue: ${layer},${assTime(start)},${assTime(end)},Cap,,0,0,0,,${text}`);
  };
  const acc = tagColor(cfg.accent);
  let prevEnd = -1;

  groups.forEach((g, gi) => {
    const gStart = g[0].start;
    let gEnd = g[g.length - 1].end + 0.12;
    if (gi < groups.length - 1) gEnd = Math.min(gEnd, groups[gi + 1][0].start);
    const wordEnd = (i: number) => (i < g.length - 1 ? g[i + 1].start : gEnd);
    // fade só com respiro real antes/depois — cartelas contíguas trocam a seco (sem apagão)
    const gapPrev = gStart - prevEnd;
    const gapNext = gi < groups.length - 1 ? groups[gi + 1][0].start - gEnd : 1;
    const fad = (ms: number) => String.raw`{\fad(${gapPrev > 0.25 ? ms : 0},${gapNext > 0.25 ? ms : 0})}`;
    // um evento por palavra; palavra com <50ms de tela cede o tempo à próxima (sem sobreposição)
    const perWord = (text: (i: number) => string) => {
      let carry: number | null = null;
      g.forEach((_, i) => {
        const start = carry ?? g[i].start;
        const end = wordEnd(i);
        carry = null;
        if (i < g.length - 1 && end - start < 0.05) { carry = start; return; }
        ev(start, end, text(i));
      });
    };
    // só escala VERTICAL nos spans parciais: \fscx muda o avanço dos glifos e re-centraliza a linha
    switch (cfg.style) {
      case 'caps':
        ev(gStart, gEnd, fad(60) + T(g));
        break;
      case 'karaoke':
        perWord((i) => g.map((w, j) => (j === i ? String.raw`{\c${acc}\fscy110}${W(w)}{\r}` : W(w))).join(' '));
        break;
      case 'build':
        perWord((i) => g.slice(0, i + 1).map((w, j) =>
          (j === i ? String.raw`{\fscy55\alpha&HFF&\t(0,110,\fscy100\alpha&H00&)}${W(w)}{\r}` : W(w))).join(' '));
        break;
      case 'pop':
        ev(gStart, gEnd, fad(40) + String.raw`{\fscx70\fscy70\t(0,120,\fscx100\fscy100)}` + T(g));
        break;
      case 'box':
        ev(gStart, gEnd, fad(50) + T(g));
        break;
      case 'neon':
        ev(gStart, gEnd, fad(80) + String.raw`{\bord16\blur14\3c${acc}\1c${acc}}` + T(g), 0);
        ev(gStart, gEnd, fad(80) + String.raw`{\bord2\3c&H000000&\1c&HFFFFFF&}` + T(g), 1);
        break;
      case 'minimal':
        ev(gStart, gEnd, fad(90) + T(g));
        break;
    }
    prevEnd = gEnd;
  });

  const header = [
    // WrapStyle 0 = quebra automática inteligente (2 = sem quebra → frase longa vaza a borda)
    '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', 'PlayResY: 1920', 'WrapStyle: 0',
    'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Cap,${spec.font},${spec.size},${spec.primary},${spec.primary},${spec.outlineColor},${spec.back},${spec.bold ? -1 : 0},0,0,0,100,100,${spec.spacing},0,${spec.borderStyle},${spec.outline},${spec.shadow},${pos.align},80,80,${pos.marginV},1`,
    '', '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  return [...header, ...events].join('\n');
}
// ── /legendas ────────────────────────────────────────────────────────────────

/**
 * Silêncio MP3 em memória: quadros MPEG-1 L3 128 kbps 44,1 kHz mono de 417
 * bytes com side info zerada (sem áudio = silêncio). Mesma taxa do TTS
 * (mp3_44100_128), então mp3Duration segue certo. Não depende do Storage:
 * a instância remixada não tem os assets do projeto original.
 */
function silenceMp3(seconds: number): Uint8Array {
  const FRAME = 417;
  const frames = Math.ceil((seconds * 44100) / 1152);
  const out = new Uint8Array(FRAME * frames);
  for (let i = 0; i < frames; i++) out.set([0xff, 0xfb, 0x90, 0xc4], i * FRAME);
  return out;
}

/** Acolchoa fala curta do CTA por concatenação de silêncio até ≥3.2s (Seedance 422 com <~2s). */
// deno-lint-ignore require-await
async function padShortMp3(_service: Service, bytes: Uint8Array): Promise<Uint8Array> {
  if (mp3Duration(bytes) >= 3.0) return bytes;
  const silence = silenceMp3(1.6);
  let out = bytes;
  while (mp3Duration(out) < 3.2) {
    const next = new Uint8Array(out.byteLength + silence.byteLength);
    next.set(out, 0);
    next.set(silence, out.byteLength);
    out = next;
  }
  return out;
}

// ── multi-cena: unidades de geração (1 unidade = 1 clipe Seedance) ───────────
type TtsArt = { shot: number; path: string; dur_s: number };
type VideoUnit = {
  /** shot âncora (primeiro membro) — dono do keyframe e do nome do clipe */
  anchor: DirectorPlanShot;
  members: DirectorPlanShot[];
  grouped: boolean;
  /** duração alvo do clipe (s), 4-30 */
  dur_s: number;
};

type UnitCaps = { min: number; max: number };

const unitDuration = (members: DirectorPlanShot[], tts: TtsArt[], caps: UnitCaps) => {
  const sum = members.reduce((acc, m) => acc + (tts.find((t) => t.shot === m.idx)?.dur_s ?? 0), 0);
  return Math.min(caps.max, Math.max(caps.min, Math.ceil(sum + 1)));
};

/**
 * Agrupa shots contíguos de mesmo sequence_group em unidades de geração.
 * Determinístico (depende só do plano + durações de TTS persistidas + caps
 * congeladas no job): keyframes, vídeos e montagem recomputam as MESMAS
 * unidades em qualquer tick. Split quando o grupo estoura caps.max.
 */
function videoUnits(shots: DirectorPlanShot[], tts: TtsArt[], caps: UnitCaps): VideoUnit[] {
  sanitizeSequenceGroups(shots);
  const units: VideoUnit[] = [];
  const push = (members: DirectorPlanShot[]) =>
    units.push({ anchor: members[0], members, grouped: members.length > 1, dur_s: unitDuration(members, tts, caps) });
  let i = 0;
  while (i < shots.length) {
    const g = shots[i].sequence_group ?? 0;
    if (!g) { push([shots[i]]); i++; continue; }
    let members: DirectorPlanShot[] = [];
    while (i < shots.length && (shots[i].sequence_group ?? 0) === g) {
      const tryMembers = [...members, shots[i]];
      const durSum = tryMembers.reduce((a, m) => a + (tts.find((t) => t.shot === m.idx)?.dur_s ?? 0), 0);
      if (members.length && Math.ceil(durSum + 1) > caps.max) {
        push(members);
        members = [];
        continue; // reavalia o shot atual numa unidade nova
      }
      members = tryMembers;
      i++;
    }
    if (members.length) push(members);
  }
  return units;
}

/** Prompt de movimento de uma unidade agrupada: cenas com corte seco interno. */
function groupMotionPrompt(unit: VideoUnit, tts: TtsArt[], lookLock: string): string {
  const durs = unit.members.map((m) => tts.find((t) => t.shot === m.idx)?.dur_s ?? 4);
  const sum = durs.reduce((a, b) => a + b, 0);
  durs[durs.length - 1] += Math.max(0, unit.dur_s - sum); // padding vai pra última cena
  const lines = [
    `One continuous ${unit.dur_s}s vertical video composed of ${unit.members.length} distinct scenes ` +
    'separated by HARD CUTS (instant scene change, no transitions, no morphing, no camera travel between scenes).',
  ];
  let t = 0;
  unit.members.forEach((m, i) => {
    const end = Math.min(unit.dur_s, t + durs[i]);
    if (i === 0) {
      lines.push(`Scene 1 (0.0s to ${end.toFixed(1)}s), starting exactly from the provided start image: ${m.motion_prompt}`);
    } else {
      lines.push(`Scene ${i + 1} (hard cut at ${t.toFixed(1)}s, until ${end.toFixed(1)}s): ${m.keyframe_prompt} ${m.motion_prompt}`);
    }
    t = end;
  });
  lines.push(lookLock);
  return lines.join('\n');
}

// ── Apresentador (brand_avatars) ─────────────────────────────────────────────
// Cadastro único: a pessoa é cadastrada uma vez em Apresentadores e cada motor
// é preparado SOB DEMANDA. O element do Higgsfield fica em
// brand_avatars.provider_refs.higgsfield = { status, element_id, media_ids,
// error, requested_at, claimed_at, failed_at }:
//   (sem ref) → requested (o job pediu) → preparing (cron claimou) → ready | failed
// O job que precisa do element ESPERA (tick no-op, igual a um pending do HF)
// enquanto stepPresenters prepara. director_identities fica como legado: mesmo
// id (migrate_identities do avatar-studio) e fallback enquanto não migrar.
const PRESENTER_BUCKET = 'brand-assets';
/** Depois de uma falha, quanto esperar antes de um job novo/retomado tentar de novo. */
const HF_PREP_RETRY_MS = 5 * 60_000;
/** 'preparing' mais velho que isso é crash no meio: o cron retoma. */
const HF_PREP_STALE_MS = 10 * 60_000;
/** Teto de tentativas pagas de preparo; zera só quando as fotos mudam. */
const HF_PREP_MAX_ATTEMPTS = 3;
/** Quanto um job espera o apresentador ficar pronto antes de falhar. */
const IDENTITY_WAIT_MAX_MS = 30 * 60_000;

type HfRef = {
  status?: 'requested' | 'preparing' | 'ready' | 'failed';
  /** tentativas de preparo já feitas (cada uma importa fotos = crédito) */
  attempts?: number;
  element_id?: string;
  media_ids?: string[];
  error?: string | null;
  requested_at?: string;
  claimed_at?: string;
  failed_at?: string;
  migrated_from?: string;
};

type Presenter = {
  id: string;
  name: string;
  appearance_prompt: string | null;
  reference_image_path: string | null;
  identity_pack_paths: string[] | null;
  provider_refs: Record<string, unknown> | null;
  voice: Record<string, unknown> | null;
  gender?: string | null;
  created_at: string;
};

type LegacyIdentity = {
  id: string; name: string; status: string; error: string | null;
  hf_element_id: string | null; hf_media_ids: unknown;
};

type IdentityResolution =
  | { element: string }
  | { description: string }
  | { wait: true }
  | null;

async function loadPresenter(service: Service, id: string): Promise<Presenter | null> {
  // select('*'): tolera a coluna gender ainda não existir (presenters.sql)
  const { data, error } = await service.from('brand_avatars').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Presenter | null) ?? null;
}

async function loadLegacyIdentity(service: Service, id: string): Promise<LegacyIdentity | null> {
  const { data, error } = await service
    .from('director_identities')
    .select('id, name, status, error, hf_element_id, hf_media_ids')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as LegacyIdentity | null) ?? null;
}

const hfRef = (p: Presenter): HfRef => ((p.provider_refs ?? {}) as { higgsfield?: HfRef }).higgsfield ?? {};

/** Até 3 fotos: o retrato (ou a 1ª do pack, quando não há retrato) e o resto do pack. */
function presenterPhotos(p: Presenter): string[] {
  const pack = (p.identity_pack_paths ?? []).filter((x) => typeof x === 'string' && x.length > 0);
  const first = p.reference_image_path || pack[0];
  return [...new Set([first, ...pack].filter((x): x is string => Boolean(x)))].slice(0, 3);
}

/**
 * Grava provider_refs.higgsfield com guard otimista no status lido (e no
 * claimed_at, quando houver): perde a corrida → false, sem sobrescrever.
 */
async function writeHfRef(service: Service, p: Presenter, seen: HfRef, next: HfRef): Promise<boolean> {
  const refs = { ...(p.provider_refs ?? {}), higgsfield: next };
  let q = service.from('brand_avatars').update({ provider_refs: refs }).eq('id', p.id);
  q = seen.status
    ? q.eq('provider_refs->higgsfield->>status', seen.status)
    : q.is('provider_refs->higgsfield->>status', null);
  if (seen.claimed_at) q = q.eq('provider_refs->higgsfield->>claimed_at', seen.claimed_at);
  const { data, error } = await q.select('id');
  if (error) throw new Error(error.message);
  return Boolean(data?.length);
}

/**
 * brief.identity_id → como o personagem entra no keyframe:
 *  - { element }     element do Higgsfield pronto
 *  - { description } apresentador só de texto (sem foto não existe element)
 *  - { wait }        element sendo preparado: o job espera o próximo tick
 *  - null            sem apresentador
 */
async function resolveIdentity(service: Service, job: Job): Promise<IdentityResolution> {
  const identityId = (job.brief as { identity_id?: string }).identity_id;
  if (!identityId) return null;

  const presenter = await loadPresenter(service, identityId);
  if (presenter) {
    const hf = hfRef(presenter);
    if (hf.status === 'ready' && hf.element_id) return { element: hf.element_id };
    // sem foto no cadastro, a preview do avatar HeyGen serve de foto (sob demanda)
    if (presenterPhotos(presenter).length === 0 && !heygenRefOf(presenter.provider_refs)?.look_id) {
      const description = presenter.appearance_prompt?.trim();
      return description ? { description } : null;
    }
    // legado já pronto com o mesmo id: reaproveita o element sem gastar crédito
    const legacy = await loadLegacyIdentity(service, identityId);
    if (legacy?.status === 'ready' && legacy.hf_element_id) {
      await writeHfRef(service, presenter, hf, {
        status: 'ready', element_id: legacy.hf_element_id,
        media_ids: Array.isArray(legacy.hf_media_ids) ? legacy.hf_media_ids as string[] : [],
        error: null, migrated_from: 'director_identities',
      });
      return { element: legacy.hf_element_id };
    }
    // legado ainda sendo preparado pelo stepIdentities: espera por ele em vez
    // de pedir outro element (seriam dois imports pagos da mesma pessoa)
    if (legacy && (legacy.status === 'creating' || legacy.status === 'importing')) {
      return { wait: true };
    }
    if (hf.status === 'failed') {
      if ((hf.attempts ?? 0) >= HF_PREP_MAX_ATTEMPTS) {
        throw new Error(
          `Não deu para preparar "${presenter.name}" depois de ${hf.attempts} tentativas. ` +
          'Troque as fotos em Avatares por fotos de frente, com boa luz e uma pessoa só, e gere de novo.',
        );
      }
      const failedAt = Date.parse(hf.failed_at ?? '') || 0;
      if (Date.now() - failedAt < HF_PREP_RETRY_MS) {
        throw new Error(
          `Não deu para preparar "${presenter.name}" para este vídeo (${hf.error ?? 'erro desconhecido'}). ` +
          'Clique em "Retomar do checkpoint" daqui a alguns minutos para tentar de novo.',
        );
      }
    }
    if (hf.status !== 'requested' && hf.status !== 'preparing') {
      // attempts atravessa o novo pedido: retomar não zera o teto de gasto
      await writeHfRef(service, presenter, hf, {
        status: 'requested', attempts: hf.attempts ?? 0,
        requested_at: new Date().toISOString(), error: null,
      });
      return { wait: true };
    }
    const requestedAt = Date.parse(hf.requested_at ?? '') || 0;
    if (requestedAt && Date.now() - requestedAt > IDENTITY_WAIT_MAX_MS) {
      throw new Error(
        `"${presenter.name}" não ficou pronto em ${IDENTITY_WAIT_MAX_MS / 60_000} minutos. ` +
        'Confira a conexão do Higgsfield em Config → Integrações e clique em "Retomar do checkpoint".',
      );
    }
    return { wait: true };
  }

  // legado ainda não migrado (director_identities)
  const legacy = await loadLegacyIdentity(service, identityId);
  if (!legacy) throw new Error('O apresentador escolhido não existe mais. Escolha outro e gere de novo.');
  if (legacy.status === 'ready' && legacy.hf_element_id) return { element: legacy.hf_element_id };
  if (legacy.status === 'failed') {
    throw new Error(`Não deu para preparar "${legacy.name}" (${legacy.error ?? 'erro desconhecido'}).`);
  }
  return { wait: true };
}

const ELEVEN_VOICE_ID_RE = /^[A-Za-z0-9]{10,40}$/;

/**
 * Voz ElevenLabs do apresentador: `voice.elevenlabs_voice_id`, ou `voice_id`
 * quando `voice.provider` é 'elevenlabs'. Voz MiniMax/catálogo (o padrão do
 * cadastro) não serve no ElevenLabs → null (o Diretor usa a regra por gênero).
 */
function presenterElevenVoiceId(voice: Record<string, unknown> | null | undefined): string | null {
  const v = voice ?? {};
  const own = typeof v.elevenlabs_voice_id === 'string' ? v.elevenlabs_voice_id.trim() : '';
  if (ELEVEN_VOICE_ID_RE.test(own)) return own;
  const id = typeof v.voice_id === 'string' ? v.voice_id.trim() : '';
  return v.provider === 'elevenlabs' && ELEVEN_VOICE_ID_RE.test(id) ? id : null;
}

/** Voz ElevenLabs da narração: a do apresentador, quando ele tem; senão a regra global. */
/**
 * Voz da narração (docs/hub-motor-contratos.md §9.5): a voz do job
 * (config.brand_voice_id) → a ElevenLabs do apresentador → a padrão de
 * brand_voices → ELEVEN_VOICE_ID → regra por gênero. Sem brand_voices, igual
 * a antes.
 */
async function presenterNarrationVoice(service: Service, job: Job): Promise<VoiceRef> {
  const jobVoice = await jobBrandVoice(service, (job.config as { brand_voice_id?: unknown }).brand_voice_id);
  if (jobVoice) return jobVoice;
  const identityId = (job.brief as { identity_id?: string }).identity_id;
  const presenter = identityId ? await loadPresenter(service, identityId).catch(() => null) : null;
  const own = presenterElevenVoiceId(presenter?.voice);
  if (own) return { provider: 'elevenlabs', voice_id: own };
  const gender = presenter?.gender === 'female' || presenter?.gender === 'male'
    ? presenter.gender
    : job.plan!.character_gender;
  return await narrationVoiceRef(service, gender);
}

/** Voz salva escolhida no job (brand_voices); null sem escolha; inexistente/pendente → frase com saída. */
async function jobBrandVoice(service: Service, id: unknown): Promise<VoiceRef | null> {
  if (id === undefined || id === null || id === '') return null;
  const row = await loadBrandVoice(service, id);
  if (!row) throw new Error('A voz escolhida não existe mais. Escolha outra em Vozes e clique em "Retomar do checkpoint".');
  const ref = voiceRefOf(row);
  if (!ref) throw new Error(`A voz "${row.name}" ainda não está pronta. Confira em Vozes e clique em "Retomar do checkpoint".`);
  return ref;
}

/**
 * Posições 3-5 da ordem: a voz padrão de brand_voices (pronta e sem conflito
 * de gênero) → ELEVEN_VOICE_ID → regra por gênero (narrationVoice, como antes).
 */
async function narrationVoiceRef(service: Service, gender?: Gender): Promise<VoiceRef> {
  const def = await defaultBrandVoice(service).catch(() => null);
  const ref = def && defaultFitsGender(def, gender) ? voiceRefOf(def) : null;
  if (ref) return ref;
  return { provider: 'elevenlabs', voice_id: await narrationVoice(service, gender) };
}

/** Fala pela voz (ElevenLabs com a tradução de erro de sempre; HeyGen por speechBytes). */
function speak(service: Service, text: string, voice: VoiceRef): Promise<SpeechResult> {
  return speechBytes(service, falaPorExtenso(text), voice, { eleven: (t, id) => ttsMp3(service, t, id) });
}

// ── persistência com guard ───────────────────────────────────────────────────
async function patch(service: Service, id: string, p: Record<string, unknown>) {
  const { error } = await service.from('director_jobs').update(p).eq('id', id);
  if (error) throw new Error(error.message);
}

/** Transição de status com guard otimista: aborta se o status mudou por fora (ex.: cancelado). */
async function transition(service: Service, job: Job, p: Record<string, unknown>) {
  const { data, error } = await service
    .from('director_jobs').update(p).eq('id', job.id).eq('status', job.status).select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('status_changed_externally');
  if (typeof p.status === 'string') job.status = p.status;
}

type Pending = {
  shot?: number; hf_job?: string; model?: string; log?: string; exit?: string; submitted_at?: number;
  /** id da predição no Replicate (driver Replicate; exclui hf_job) */
  rp_id?: string;
  /** duração cobrada/renderizada da cena no Replicate */
  dur_s?: number;
  /** grupo multi-cena: cenas cobertas por este clipe (a tela mostra todas "Gerando vídeo") */
  members?: number[];
};

// Plano Higgsfield com teto de jobs simultâneos (free = 1): com submissão nossa
// já em voo, o excedente espera o próximo tick em vez de derrubar o job.
const HF_CONCURRENCY_RE = /max \d+ concurrent job/i;
const errText = (err: unknown) => String(err instanceof Error ? err.message : err);
/** A conta está ocupada (outro job, outra aba): este tick espera, até um teto. */
const HF_BUSY_MAX_MS = 20 * 60_000;
const hfBusy = (err: unknown, _pending: Pending[]) => HF_CONCURRENCY_RE.test(errText(err));
/**
 * Marca a espera por concorrência em artifacts.hf_busy_since; passado o teto,
 * o erro vira falha de verdade (com a mensagem do Higgsfield).
 */
async function waitHfBusy(service: Service, job: Job, err: unknown): Promise<void> {
  const arts = job.artifacts as { hf_busy_since?: number };
  if (!arts.hf_busy_since) {
    arts.hf_busy_since = Date.now();
    await patch(service, job.id, { artifacts: job.artifacts });
    return;
  }
  if (Date.now() - arts.hf_busy_since > HF_BUSY_MAX_MS) {
    throw new Error(`O Higgsfield ficou ocupado por mais de ${HF_BUSY_MAX_MS / 60000} min (outro vídeo em andamento na conta). ${errText(err)}`);
  }
}

/** Erro do Higgsfield → instrução acionável; o resto passa como veio. */
function hfError(err: unknown): Error {
  const msg = errText(err);
  if (HF_CONCURRENCY_RE.test(msg)) {
    return new Error(
      'Higgsfield: o plano da conta conectada só permite 1 geração por vez e já há outra em andamento nela. ' +
      'Espere ela terminar (ou faça upgrade do plano no Higgsfield) e clique em "Retomar do checkpoint".',
    );
  }
  if (/out of credits/i.test(msg)) {
    return new Error(
      'Higgsfield: o workspace selecionado na conta conectada está sem créditos. ' +
      'No Higgsfield, troque para o workspace que tem créditos (ou recarregue este), ' +
      'reconecte em Config → Integrações se necessário e clique em "Retomar do checkpoint".',
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

/** Poll de um lote pending com deadline; falha de item LIMPA o pending antes de propagar. */
async function pollPending(
  service: Service,
  job: Job,
  key: string,
  check: (p: Pending) => Promise<string | null>,
  onDone: (p: Pending, url: string) => Promise<void>,
  /** Chamado ANTES de descartar um item que estourou o prazo (ex.: cancelar a predição paga). */
  onExpire?: (p: Pending) => Promise<void>,
): Promise<boolean> {
  const arts = job.artifacts as Record<string, Pending[]>;
  const pending = arts[key] ?? [];
  const still: Pending[] = [];
  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];
    try {
      // checa ANTES do prazo: submissão paga que terminou enquanto o job estava
      // failed (retomado depois) tem o resultado aproveitado, não re-pago
      const url = await check(p);
      const deadline = p.rp_id ? RP_PENDING_DEADLINE_MS : PENDING_DEADLINE_MS;
      if (!url && p.submitted_at && Date.now() - p.submitted_at > deadline) {
        if (onExpire) await onExpire(p).catch((e) => console.error('onExpire:', errText(e)));
        throw new Error(`A cena ${p.shot ?? '-'} passou de ${deadline / 60000} min sem terminar no provedor. Clique em "Retomar produção" para gerar de novo.`);
      }
      if (!url) { still.push(p); continue; }
      await onDone(p, url);
    } catch (err) {
      // 429/5xx/rede no GET do Replicate: a predição continua rodando e já foi
      // paga — fica na fila e o próximo tick checa de novo. Descartá-la aqui
      // fazia o "Retomar" recriar a cena e pagar em dobro.
      if (err instanceof ReplicateError && err.retryable) {
        console.warn(`pollPending ${key} shot ${p.shot ?? '-'}: transiente, mantém:`, err.message);
        still.push(p);
        continue;
      }
      // moderação: a cena sai da fila e volta no próximo tick com prompt neutro,
      // UMA vez; barrada de novo, falha com a mensagem certa
      if (err instanceof ReplicateError && err.code === 'moderation' && typeof p.shot === 'number') {
        const moderated = ((job.artifacts as { rp_moderated?: number[] }).rp_moderated ??= []);
        if (!moderated.includes(p.shot)) {
          moderated.push(p.shot);
          console.warn(`pollPending ${key} shot ${p.shot}: moderação, vai tentar com prompt neutro`);
          continue;
        }
        arts[key] = still.concat(pending.slice(i + 1));
        await patch(service, job.id, { artifacts: job.artifacts });
        throw new Error(`${err.message} Mesmo com prompt neutro a cena ${p.shot} foi barrada: mude o briefing dessa cena e clique em "Retomar produção".`);
      }
      // remove o item envenenado ANTES de falhar o job — retry regenera só o que falta
      arts[key] = still.concat(pending.slice(i + 1));
      await patch(service, job.id, { artifacts: job.artifacts });
      throw err;
    }
  }
  arts[key] = still;
  await patch(service, job.id, { artifacts: job.artifacts });
  return still.length === 0;
}

// ── passos ───────────────────────────────────────────────────────────────────
async function stepPlanning(service: Service, job: Job) {
  // Quadros e montagem: com o login do Higgsfield, tudo nele. Sem ele, os quadros
  // vêm do Replicate e a montagem e a legenda ficam com o Claude da pessoa
  // (conector personalizado). Confere aqui: sem um dos dois caminhos o job
  // morreria no 3º passo, já tendo pago roteiro e narração.
  if (!(await hfConnected(service))) {
    await replicateToken(service); // sem token: a frase do Replicate, com o que fazer
    if (!(await claudeConectado(service))) {
      throw new NotConnectedError(
        'higgsfield',
        'Para montar o vídeo, conecte o Claude (conector personalizado) ou o Higgsfield em Ajustes → Integrações. Depois clique em "Retomar produção".',
      );
    }
    // as cenas só podem ser do Replicate: o motor Higgsfield precisa do login
    if (readEngineChoice(job).engine !== 'replicate') {
      if ((job.artifacts as { engine?: unknown }).engine) {
        throw new Error(
          'Este vídeo foi pedido com as cenas no Higgsfield, que não está conectado. ' +
          'Conecte o Higgsfield ou peça o vídeo de novo com um modelo do Replicate.',
        );
      }
      (job.artifacts as Record<string, unknown>).engine = { engine: 'replicate', model_id: null, ab_model_id: null };
      await patch(service, job.id, { artifacts: job.artifacts });
    }
  }
  const maxShots = Math.min(Number(job.config?.max_shots ?? 5), 8);
  // motor congelado ANTES do roteiro: a escolha da tela vale para o job inteiro
  await freezeEngineChoice(service, job);
  const plan = await generateDirectorPlan(job.brief, maxShots);
  await savePlan(service, job.id, plan, 'tts', ['queued', 'planning']);
}

async function stepTts(service: Service, job: Job) {
  const arts = job.artifacts as { tts?: { shot: number; path: string; mp3: string; dur_s: number }[] };
  arts.tts = arts.tts ?? [];
  let voice: VoiceRef | undefined;
  for (const shot of job.plan!.shots!) {
    if (arts.tts.find((t) => t.shot === shot.idx)) continue;
    voice ??= await presenterNarrationVoice(service, job);
    const speech = await speak(service, clipTtsText(shot.speech), voice);
    let bytes = speech.bytes;
    // acolchoamento e medida por bytes só valem em MP3 128 kbps (ElevenLabs e
    // clone HeyGen); voz do catálogo HeyGen usa a duração devolvida
    if (shot.role === 'cta' && speech.mp3_128) bytes = await padShortMp3(service, bytes);
    const path = `director/${job.id}/tts/b${shot.idx}.mp3`;
    await putObject(service, path, bytes, speech.content_type);
    const durS = speech.mp3_128 ? mp3Duration(bytes) : (speech.duration_s ?? mp3Duration(bytes));
    // mp3 espelha path: shape compatível com a lane worker (que lê speech.mp3)
    arts.tts.push({ shot: shot.idx, path, mp3: path, dur_s: Number(durS.toFixed(2)) });
    await patch(service, job.id, { artifacts: arts });
  }
  await transition(service, job, { status: 'keyframes' });
}

async function stepKeyframes(service: Service, job: Job) {
  const arts = job.artifacts as {
    keyframes?: { shot: number; path: string; hf_url: string }[];
    pending_kf?: Pending[];
  };
  arts.keyframes = arts.keyframes ?? [];
  arts.pending_kf = arts.pending_kf ?? [];
  // sem o login do Higgsfield, os quadros saem do modelo `keyframe` do Replicate
  const hfOn = await hfConnected(service);
  if (hfOn && (job.costs as { hf_credits_start?: number }).hf_credits_start == null) {
    const bal = await hfBalance(service);
    // saldo ilegível com teto definido: o teto não vai ser aplicado — fica
    // registrado em vez de silenciado (a tela mostra "Sem teto" nesse caso)
    const budget = Number((job.config as { budget_credits?: number }).budget_credits ?? 0);
    job.costs = { ...job.costs, hf_credits_start: bal, ...(bal == null && budget > 0 ? { budget_unenforced: true } : {}) };
    await patch(service, job.id, { costs: job.costs });
  }
  const identityRef = (job.brief as { identity_ref?: string }).identity_ref ?? null;
  const models = await hfModels(service);
  const caps = await unitCaps(service, job);
  // só o shot ÂNCORA de cada unidade tem keyframe (grupo multi-cena: cenas 2+ nascem do prompt)
  const units = videoUnits(job.plan!.shots!, (job.artifacts as { tts?: TtsArt[] }).tts ?? [], caps);
  // identidade resolvida UMA vez e cacheada nos artifacts: arquivar o
  // apresentador depois disso não derruba um job com keyframes pagos em voo
  const cached = job.artifacts as { identity_element?: string; identity_description?: string };
  let identityElement = cached.identity_element ?? null;
  let identityDescription = cached.identity_description ?? null;
  // apresentador ainda sendo preparado no Higgsfield: as cenas COM personagem
  // esperam (tick no-op); as sem personagem seguem normalmente
  let waitingIdentity = false;
  const needsIdentity = units.some((u) =>
    u.anchor.with_character
    && !arts.keyframes!.some((k) => k.shot === u.anchor.idx)
    && !arts.pending_kf!.some((p) => p.shot === u.anchor.idx));
  // sem Higgsfield não há element: as fotos do apresentador vão como referência
  // da imagem (assinadas a cada tick); sem foto, a descrição dele
  let identityRefs: string[] = [];
  const identityId = (job.brief as { identity_id?: string }).identity_id;
  if (!hfOn && !identityElement && !identityDescription && needsIdentity && identityId) {
    identityRefs = await identityReferences(service, identityId, 3).catch(() => []);
    if (!identityRefs.length) {
      identityDescription = (await loadPresenter(service, identityId))?.appearance_prompt?.trim() || null;
      if (identityDescription) {
        (job.artifacts as Record<string, unknown>).identity_description = identityDescription;
        await patch(service, job.id, { artifacts: job.artifacts });
      }
    }
  }
  if (hfOn && !identityElement && !identityDescription && needsIdentity) {
    const resolved = await resolveIdentity(service, job);
    if (resolved && 'wait' in resolved) {
      // prazo por job: vale também para o legado (director_identities), que
      // não tem requested_at — nenhum job espera para sempre
      const since = (job.artifacts as { identity_wait_since?: number }).identity_wait_since;
      if (!since) {
        (job.artifacts as Record<string, unknown>).identity_wait_since = Date.now();
        await patch(service, job.id, { artifacts: job.artifacts });
      } else if (Date.now() - since > IDENTITY_WAIT_MAX_MS) {
        // limpa o marco: "Retomar do checkpoint" ganha um prazo novo
        delete (job.artifacts as Record<string, unknown>).identity_wait_since;
        await patch(service, job.id, { artifacts: job.artifacts });
        throw new Error(
          `O apresentador não ficou pronto em ${IDENTITY_WAIT_MAX_MS / 60_000} minutos. ` +
          'Confira a conexão do Higgsfield em Config → Integrações e clique em "Retomar do checkpoint".',
        );
      }
      waitingIdentity = true;
    } else if (resolved && 'element' in resolved) {
      identityElement = resolved.element;
      (job.artifacts as Record<string, unknown>).identity_element = identityElement;
      await patch(service, job.id, { artifacts: job.artifacts });
    } else if (resolved && 'description' in resolved) {
      identityDescription = resolved.description;
      (job.artifacts as Record<string, unknown>).identity_description = identityDescription;
      await patch(service, job.id, { artifacts: job.artifacts });
    }
  }
  const rpToken = !hfOn || arts.pending_kf.some((p) => p.rp_id) ? await replicateToken(service) : null;
  let kfEntry: VideoModelEntry | null = null;
  // submete o que falta, persistindo POR ITEM (crash no meio não perde ids nem re-paga)
  for (const unit of units) {
    const shot = unit.anchor;
    if (arts.keyframes.find((k) => k.shot === shot.idx)) continue;
    if (arts.pending_kf.find((p) => p.shot === shot.idx)) continue;
    if (waitingIdentity && shot.with_character) continue;
    if (!hfOn) {
      kfEntry ??= await keyframeEntry(service);
      const withRefs = shot.with_character && identityRefs.length > 0;
      const who = !shot.with_character
        ? ''
        : withRefs
          ? 'The main character is the person in the reference photos: same face, same look. '
          : identityDescription
            ? `The main character is always the same person: ${identityDescription}. `
            : '';
      const input = renderInputTemplate(kfEntry.input_template, {
        prompt: `${who}${shot.keyframe_prompt} ${job.plan!.look_lock}`,
        reference_urls: withRefs ? identityRefs : [],
      });
      const prediction = await createCatalogPrediction(service, job, rpToken!, kfEntry, input, { images: 1 });
      arts.pending_kf.push({ shot: shot.idx, rp_id: prediction.id, model: kfEntry.model_id, submitted_at: Date.now() });
      await patch(service, job.id, { artifacts: arts });
      continue;
    }
    await assertBudget(service, job, `keyframe ${shot.idx}`);
    // apresentador: element por placeholder no prompt; só texto: a descrição;
    // legado: media id em image_references
    const identityInPrompt = !shot.with_character
      ? ''
      : identityElement
        ? `The main character is <<<${identityElement}>>> — the exact same person as this reference. `
        : identityDescription
          ? `The main character is always the same person: ${identityDescription}. `
          : '';
    let hfJob: string;
    try {
      hfJob = await hfGenerate(service, 'generate_image', {
        model: models.image, aspect_ratio: '9:16', count: 1, ...models.image_extra,
        prompt: `${identityInPrompt}${shot.keyframe_prompt} ${job.plan!.look_lock}`,
        ...(shot.with_character && !identityElement && identityRef
          ? { medias: [{ value: identityRef, role: 'image_references' }] }
          : {}),
      });
    } catch (err) {
      if (hfBusy(err, arts.pending_kf)) { await waitHfBusy(service, job, err); break; }
      throw hfError(err);
    }
    arts.pending_kf.push({ shot: shot.idx, hf_job: hfJob, submitted_at: Date.now() });
    await patch(service, job.id, { artifacts: arts });
  }
  const done = await pollPending(service, job, 'pending_kf',
    (p) => p.rp_id ? replicateCheck(rpToken!, p.rp_id) : hfCheck(service, p.hf_job!),
    async (p, url) => {
      const path = `director/${job.id}/keyframes/kf${p.shot}.png`;
      await putObject(service, path, await fetchBytes(url), 'image/png');
      // hf_url só existe no quadro do Higgsfield (o motor de cena dele reaproveita)
      arts.keyframes!.push({ shot: p.shot!, path, hf_url: p.rp_id ? '' : url });
    },
    async (p) => { if (p.rp_id && rpToken) await cancelPrediction(rpToken, p.rp_id); });
  if (done && units.every((u) => arts.keyframes!.some((k) => k.shot === u.anchor.idx))) {
    const cfg = job.config as { auto_approve_keyframes?: boolean; skip_video?: boolean };
    const next = cfg.skip_video ? 'done' : (cfg.auto_approve_keyframes ?? true) ? 'videos' : 'awaiting_keyframe_approval';
    await transition(service, job, { status: next });
  }
}

type VideoArt = { shot: number; path: string; dur_s: number; cta?: boolean; members?: number[] };
type VideosArts = {
  keyframes?: { shot: number; path: string; hf_url: string }[];
  tts?: TtsArt[];
  videos?: VideoArt[];
  ab_videos?: { group: number; path: string; model: string }[];
  ab_error?: string;
  pending_vid?: Pending[];
  pending_ab?: Pending[];
  /** cenas barradas pela moderação do Replicate: a próxima submissão usa prompt neutro */
  rp_moderated?: number[];
};

/** Prompt de movimento de uma unidade (igual nos dois motores). */
function unitPrompt(unit: VideoUnit, arts: VideosArts, job: Job, ctaWithAudio: boolean): string {
  const shot = unit.anchor;
  // sem lipsync a fala entra como narração por cima: boca mexendo dessincroniza
  const silentCharacter = (shot.with_character || shot.role === 'cta') && !ctaWithAudio;
  return unit.grouped
    ? groupMotionPrompt(unit, arts.tts!, job.plan!.look_lock ?? '')
    : silentCharacter
      ? `${shot.motion_prompt} The person does not talk: lips stay closed, warm natural expression, voiceover only.`
      : shot.motion_prompt;
}

async function stepVideos(service: Service, job: Job) {
  const arts = job.artifacts as VideosArts;
  arts.videos = arts.videos ?? [];
  arts.pending_vid = arts.pending_vid ?? [];
  const shots = job.plan!.shots!;
  const choice = readEngineChoice(job);
  const models = await hfModels(service);
  const caps = await unitCaps(service, job);
  const units = videoUnits(shots, arts.tts ?? [], caps);
  // driver Replicate: token + modelo resolvidos uma vez por tick (poll também usa o token)
  const useReplicate = choice.engine === 'replicate';
  const rpToken = useReplicate || arts.pending_vid.some((p) => p.rp_id) ? await replicateToken(service) : null;
  // token só para o braço B no Replicate (principal no Higgsfield): falha de braço
  // nunca derruba o job — vira ab_error, o pending do braço é descartado e o tick segue
  const abSettled = Boolean(arts.ab_error || arts.ab_videos?.length);
  const abWantsReplicate = (job.config as { ab_kling?: boolean }).ab_kling === true
    && !abSettled && !arts.pending_ab?.length && abEngineOf(choice, job) === 'replicate';
  let abToken = rpToken;
  if (!abToken && (abWantsReplicate || arts.pending_ab?.some((p) => p.rp_id))) {
    try {
      abToken = await replicateToken(service);
    } catch (err) {
      if (!arts.ab_error) arts.ab_error = abSkippedMessage(err) ?? errText(err).slice(0, 300);
      arts.pending_ab = (arts.pending_ab ?? []).filter((p) => !p.rp_id);
      await patch(service, job.id, { artifacts: arts });
    }
  }
  const rpEntry = useReplicate ? await replicateSceneEntry(service, choice.model_id) : null;
  const hfSpec = hfSpecFor(models, choice.model_id);
  // pausa por 429 do Replicate: este tick só faz poll, não submete cena nova
  const rpState = arts as { rp_retry_at?: number };
  const rpPaused = useReplicate && typeof rpState.rp_retry_at === 'number' && Date.now() < rpState.rp_retry_at;
  for (const unit of units) {
    const shot = unit.anchor;
    if (arts.videos.find((v) => v.shot === shot.idx)) continue;
    if (arts.pending_vid.find((p) => p.shot === shot.idx)) continue;
    const kf = arts.keyframes!.find((k) => k.shot === shot.idx);
    if (!kf) throw new Error(`vídeo ${shot.idx} sem keyframe âncora`);
    const speech = arts.tts!.find((t) => t.shot === shot.idx)!;

    if (useReplicate) {
      if (rpPaused) break;
      // Replicate não cobra créditos Higgsfield (o teto não se aplica); nenhum modelo
      // de cena do catálogo aceita áudio de referência → CTA narrado como os demais
      let submitted: { id: string; dur_s: number };
      try {
        const basePrompt = unitPrompt(unit, arts, job, false);
        submitted = await submitReplicateClip(service, job, rpToken!, rpEntry!, {
          prompt: arts.rp_moderated?.includes(shot.idx) ? safePrompt(basePrompt) : basePrompt,
          keyframePath: kf.path,
          seconds: unit.dur_s,
        });
      } catch (err) {
        // limite de requisições / instabilidade: o job NÃO falha — para de
        // submeter neste tick e volta no próximo (as cenas já enviadas seguem)
        const cause = (err as { cause?: unknown }).cause;
        const rp = err instanceof ReplicateError ? err : cause instanceof ReplicateError ? cause : null;
        if (rp?.retryable) {
          rpState.rp_retry_at = Date.now() + Math.max(RP_RETRY_PAUSE_MS, rp.retryAfterMs ?? 0);
          await patch(service, job.id, { artifacts: arts });
          console.warn(`stepVideos: Replicate transiente, pausa até ${new Date(rpState.rp_retry_at).toISOString()}:`, rp.message);
          break;
        }
        throw err;
      }
      delete rpState.rp_retry_at;
      const { id, dur_s } = submitted;
      arts.pending_vid.push({ shot: shot.idx, rp_id: id, model: rpEntry!.model_id, dur_s, submitted_at: Date.now(), ...(unit.grouped ? { members: unit.members.map((m) => m.idx) } : {}) });
      await patch(service, job.id, { artifacts: arts });
      continue;
    }

    await assertBudget(service, job, `vídeo ${shot.idx}`);
    let startId: string;
    try {
      startId = await hfImportImage(service, kf.hf_url);
    } catch {
      startId = await hfImportImage(service, await sign(service, kf.path)); // fallback: hf_url expirada
    }
    const medias: { value: string; role: string }[] = [{ value: startId, role: 'start_image' }];
    // lipsync da fala auditada só quando o modelo aceita audio_references
    // (Seedance aceitava; Cinema Studio não — o CTA vira narração na montagem)
    const ctaWithAudio = shot.role === 'cta' && models.cta_audio_ref;
    if (ctaWithAudio) {
      const bytes = await fetchBytes(await sign(service, speech.path));
      medias.push({ value: await hfUploadAudio(service, bytes, `cta${shot.idx}.mp3`), role: 'audio_references' });
    }
    const videoParams: Record<string, unknown> = {
      model: hfSpec.model, aspect_ratio: '9:16',
      duration: unit.dur_s, ...hfSpec.extra,
      prompt: unitPrompt(unit, arts, job, ctaWithAudio),
      medias,
    };
    let hfJob: string;
    try {
      hfJob = await hfGenerate(service, 'generate_video', videoParams);
    } catch (err) {
      if (hfBusy(err, arts.pending_vid!)) { await waitHfBusy(service, job, err); break; }
      // saldo não cobre o clipe na resolução padrão: uma tentativa em 720p (custa menos)
      if (!/out of credits/i.test(errText(err)) || videoParams.resolution === '720p') throw hfError(err);
      try {
        hfJob = await hfGenerate(service, 'generate_video', { ...videoParams, resolution: '720p' });
      } catch (err720) {
        throw hfError(err720);
      }
    }
    arts.pending_vid.push({ shot: shot.idx, hf_job: hfJob, submitted_at: Date.now(), ...(unit.grouped ? { members: unit.members.map((m) => m.idx) } : {}) });
    await patch(service, job.id, { artifacts: arts });
  }
  await maybeSubmitAbKling(service, job, units, arts, choice, abToken);
  const done = await pollPending(service, job, 'pending_vid',
    (p) => p.rp_id ? replicateCheck(rpToken!, p.rp_id) : hfCheck(service, p.hf_job!),
    async (p, url) => {
      const path = `director/${job.id}/videos/v${p.shot}.mp4`;
      if (p.rp_id) await saveReplicateClip(service, url, path);
      else await putObject(service, path, await fetchBytes(url), 'video/mp4');
      const unit = units.find((u) => u.anchor.idx === p.shot)!;
      arts.videos!.push({
        shot: p.shot!, path,
        // Replicate: a duração que o modelo aceitou (bucket 5/10 etc.), não a pedida
        dur_s: p.rp_id ? (p.dur_s ?? unit.dur_s) : unit.dur_s,
        // cta=true = clipe mantém áudio nativo na montagem; sem audio_references
        // o CTA é narrado como os demais
        cta: !p.rp_id && unit.anchor.role === 'cta' && models.cta_audio_ref,
        ...(unit.grouped ? { members: unit.members.map((m) => m.idx) } : {}),
      });
    },
    // predição do Replicate que passou do prazo: cancela antes de descartar
    async (p) => { if (p.rp_id && rpToken) await cancelPrediction(rpToken, p.rp_id); });
  const abDone = await pollAbKling(service, job, arts, abToken);
  // completude por ÂNCORA (contagem crua aceitaria entradas per-shot gravadas
  // por uma lane não-group-aware, duplicando conteúdo na montagem)
  if (done && abDone && units.every((u) => arts.videos!.some((v) => v.shot === u.anchor.idx))) {
    await transition(service, job, { status: 'muxing' });
  }
}

// ── A/B multi-cena: N braços sobre o 1º grupo (experimento p/ o olho do Tiago) ─
// Melhor esforço: NUNCA falha o job — erro vira artifacts.ab_error e a produção segue.
function abSpecs(models: HfModels): AbSpec[] {
  if (Array.isArray(models.ab) && models.ab.length) return models.ab;
  return [{ model: models.ab_video, max_s: models.ab_max_s, extra: models.ab_extra }];
}

/**
 * Motor da cena extra: decidido pelo ab_model_id, não pelo motor principal.
 * "owner/name" é slug do catálogo do Replicate; id simples (cinematic_studio_3_0)
 * é modelo do Higgsfield. Sem ab_model_id, fica no motor principal (como antes).
 * É o que permite "Os dois" na tela: cena 1 no outro motor.
 */
function abEngineOf(choice: EngineChoice, job: Job): VideoEngine {
  const declared = (job.config as { ab_engine?: unknown }).ab_engine;
  if (declared === 'higgsfield' || declared === 'replicate') return declared;
  // jobs anteriores a config.ab_engine: slug "owner/name" é Replicate, id simples é Higgsfield
  if (!choice.ab_model_id) return choice.engine;
  return choice.ab_model_id.includes('/') ? 'replicate' : 'higgsfield';
}

async function maybeSubmitAbKling(
  service: Service, job: Job, units: VideoUnit[], arts: VideosArts, choice: EngineChoice, rpToken: string | null,
) {
  const cfg = job.config as { ab_kling?: boolean };
  if (!cfg.ab_kling || arts.ab_videos?.length || arts.pending_ab?.length || arts.ab_error) return;
  const unit = units.find((u) => u.grouped);
  if (!unit) {
    arts.ab_error = 'plano sem grupo multi-cena — A/B pulado';
    await patch(service, job.id, { artifacts: job.artifacts });
    return;
  }
  const kf = arts.keyframes?.find((k) => k.shot === unit.anchor.idx);
  if (!kf) return; // âncora ainda sem keyframe — tenta no próximo tick
  const abEngine = abEngineOf(choice, job);
  try {
    if (abEngine === 'replicate') {
      // sem token (principal no Higgsfield e Replicate desconectado): já virou ab_error no tick
      if (!rpToken) return;
      const token = rpToken;
      let abId = choice.ab_model_id;
      if (choice.engine === 'replicate') {
        // mesmo motor: o modelo escolhido na tela ou o fallback do principal, nunca o próprio principal
        const main = await replicateSceneEntry(service, choice.model_id);
        abId = abId ?? main.fallback_model_id;
        if (!abId || abId === main.model_id) {
          arts.ab_error = 'sem outro modelo de cena ativo no Replicate — cena extra pulada';
          await patch(service, job.id, { artifacts: job.artifacts });
          return;
        }
      }
      const abEntry = await replicateSceneEntry(service, abId);
      const abCaps = replicateCaps(abEntry);
      const abDur = Math.min(abCaps.max, unit.dur_s);
      const factor = abDur / unit.dur_s;
      const abTts = factor < 1 ? arts.tts!.map((t) => ({ ...t, dur_s: t.dur_s * factor })) : arts.tts!;
      const { id, dur_s } = await submitReplicateClip(service, job, token, abEntry, {
        prompt: groupMotionPrompt({ ...unit, dur_s: abDur }, abTts, job.plan!.look_lock ?? ''),
        keyframePath: kf.path,
        seconds: abDur,
      });
      arts.pending_ab = [{ shot: unit.anchor.idx, rp_id: id, model: abEntry.model_id, dur_s, submitted_at: Date.now() }];
      await patch(service, job.id, { artifacts: job.artifacts });
      return;
    }
    // Higgsfield (principal no HF ou no Replicate): o keyframe precisa estar
    // importado no HF — hf_url pode não existir ou ter expirado; a URL assinada
    // do bucket é o caminho seguro.
    const models = await hfModels(service);
    let startId: string;
    try {
      if (!kf.hf_url) throw new Error('sem hf_url');
      startId = await hfImportImage(service, kf.hf_url);
    } catch {
      startId = await hfImportImage(service, await sign(service, kf.path));
    }
    const pending: Pending[] = [];
    // modelo da cena extra escolhido na tela tem precedência sobre os braços configurados
    const specs = choice.ab_model_id ? [hfSpecFor(models, choice.ab_model_id)] : abSpecs(models);
    for (const spec of specs) {
      await assertBudget(service, job, `A/B ${spec.model} grupo ${unit.anchor.idx}`);
      // teto do braço: se capar, reescala as cenas pro prompt bater com a duração pedida
      const abDur = Math.min(spec.max_s, unit.dur_s);
      const factor = abDur / unit.dur_s;
      const abTts = factor < 1 ? arts.tts!.map((t) => ({ ...t, dur_s: t.dur_s * factor })) : arts.tts!;
      const hfJob = await hfGenerate(service, 'generate_video', {
        model: spec.model, aspect_ratio: '9:16',
        duration: abDur, ...spec.extra,
        prompt: groupMotionPrompt({ ...unit, dur_s: abDur }, abTts, job.plan!.look_lock ?? ''),
        medias: [{ value: startId, role: 'start_image' }],
      });
      pending.push({ shot: unit.anchor.idx, hf_job: hfJob, model: spec.model, submitted_at: Date.now() });
    }
    arts.pending_ab = pending;
  } catch (err) {
    // braços já submetidos seguem no pending; só o erro fica registrado.
    // Motor da cena extra desconectado: aviso curto, o job segue com a cena A.
    arts.ab_error = abSkippedMessage(err) ?? errText(err).slice(0, 300);
  }
  await patch(service, job.id, { artifacts: job.artifacts });
}

/**
 * true quando TODOS os braços terminaram (ou não há A/B); falha de braço nunca propaga.
 * O motor do braço vem da própria entrada (rp_id = Replicate, hf_job = Higgsfield),
 * não do motor do job — por isso a cena extra pode estar no outro motor.
 */
async function pollAbKling(service: Service, job: Job, arts: VideosArts, rpToken: string | null): Promise<boolean> {
  if (!arts.pending_ab?.length) return true;
  const still: Pending[] = [];
  for (const p of arts.pending_ab) {
    try {
      if (p.submitted_at && Date.now() - p.submitted_at > PENDING_DEADLINE_MS) {
        throw new Error(`A/B ${p.model ?? '?'} estourou o prazo`);
      }
      let url: string | null;
      if (p.rp_id) {
        if (!rpToken) throw new NotConnectedError('replicate', 'Replicate não conectado');
        url = await replicateCheck(rpToken, p.rp_id);
      } else {
        url = await hfCheck(service, p.hf_job!);
      }
      if (!url) { still.push(p); continue; }
      // "/" do model_id do Replicate não pode virar pasta no bucket
      const path = `director/${job.id}/ab/${(p.model ?? 'ab').replace(/[^\w.-]+/g, '_')}-g${p.shot}.mp4`;
      if (p.rp_id) await saveReplicateClip(service, url, path);
      else await putObject(service, path, await fetchBytes(url), 'video/mp4');
      arts.ab_videos = [...(arts.ab_videos ?? []), { group: p.shot!, path, model: p.model ?? 'ab' }];
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err).slice(0, 200);
      arts.ab_error = arts.ab_error ? `${arts.ab_error} | ${msg}`.slice(0, 500) : msg;
    }
  }
  arts.pending_ab = still;
  await patch(service, job.id, { artifacts: job.artifacts });
  return still.length === 0;
}

// ── montagem determinística no sandbox (ffmpeg real) ─────────────────────────
// Validado manualmente no job 1c76578e: vídeo 20,17s / áudio 20,17s, -15 LUFS.
const ASSEMBLE_PY = `
import json
import subprocess

m = json.load(open("manifest.json"))
clips = sorted(m["clips"], key=lambda c: c["idx"])
n = len(clips)


def probe(f, sel):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", sel,
         "-show_entries", "stream=duration", "-of", "csv=p=0", f],
        capture_output=True, text=True, check=True).stdout.strip().splitlines()
    return float(out[0])


inputs = []
for c in clips:
    inputs += ["-i", c["video"]]
# narracoes: lista por clipe (grupo multi-cena = varias narracoes sobre UM clipe)
narr_inputs = {}
pos = n
for c in clips:
    idxs = []
    for f in (c.get("narrations") or []):
        inputs += ["-i", f]
        idxs.append(pos)
        pos += 1
    narr_inputs[c["idx"]] = idxs
bed_idx = pos
inputs += ["-i", m["bed"]]

fc = []
total = 0.0
for i, c in enumerate(clips):
    d = probe(c["video"], "v")
    total += d
    fc.append(
        "[%d:v]scale=1080:1920:force_original_aspect_ratio=decrease,"
        "pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1,format=yuv420p[v%d]" % (i, i))
    idxs = narr_inputs[c["idx"]]
    if not idxs:
        src = "[%d:a]" % i
    elif len(idxs) == 1:
        src = "[%d:a]" % idxs[0]
    else:
        for k, ii in enumerate(idxs):
            fc.append("[%d:a]aresample=48000[nr%d_%d]" % (ii, i, k))
        fc.append("".join("[nr%d_%d]" % (i, k) for k in range(len(idxs)))
                  + "concat=n=%d:v=0:a=1[nc%d]" % (len(idxs), i))
        src = "[nc%d]" % i
    fc.append("%saresample=48000,apad,atrim=0:%.3f,asetpts=PTS-STARTPTS[a%d]" % (src, d, i))
fc.append("".join("[v%d][a%d]" % (i, i) for i in range(n)) + "concat=n=%d:v=1:a=1[vc][ac]" % n)
fc.append("[%d:a]aresample=48000,aloop=loop=-1:size=2000000000,"
          "atrim=0:%.3f,volume=0.22[ab]" % (bed_idx, total))
fc.append("[ac][ab]amix=inputs=2:duration=first:normalize=0,"
          "loudnorm=I=-14:TP=-1.5:LRA=11[aout]")

r = subprocess.run(
    ["ffmpeg", "-y", *inputs, "-filter_complex", ";".join(fc),
     "-map", "[vc]", "-map", "[aout]",
     "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
     "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
     "-movflags", "+faststart", "final.mp4"],
    capture_output=True, text=True)
if r.returncode != 0:
    print("FFMPEG_STDERR_TAIL:", r.stderr[-1500:])
    raise SystemExit("ffmpeg exit %d" % r.returncode)

vd = probe("final.mp4", "v")
ad = probe("final.mp4", "a")
assert abs(vd - ad) < 0.5, "desync video=%.2f audio=%.2f" % (vd, ad)
assert abs(vd - total) < 0.5, "duracao video=%.2f esperada=%.2f" % (vd, total)
r = subprocess.run(
    ["curl", "-fsS", "-X", "PUT", "-H", "Content-Type: video/mp4",
     "-H", "x-upsert: true",
     "--data-binary", "@final.mp4", "-w", "%{http_code}", "-o", "/dev/null",
     m["upload"]],
    capture_output=True, text=True)
assert r.stdout.strip() == "200", "upload: %s %s" % (r.stdout, r.stderr)
print("ASSEMBLE_OK video=%.2f audio=%.2f total=%.2f" % (vd, ad, total))
`.trim();

function assembleCommand(manifest: unknown, downloads: { name: string; url: string }[]): string {
  return [
    // set -e + wait POR PID: `wait` sem args devolve 0 mesmo com curl falho, e
    // download truncado viraria narração comida sem erro nenhum
    'set -euo pipefail',
    'rm -rf /tmp/job && mkdir -p /tmp/job && cd /tmp/job',
    ...downloads.map((d) => `curl -fsS -o ${d.name} '${d.url}' &`),
    'for p in $(jobs -p); do wait "$p"; done',
    `for f in ${downloads.map((d) => d.name).join(' ')}; do [ -s "$f" ] || { echo "DOWNLOAD_VAZIO:$f"; exit 1; }; done`,
    "cat > manifest.json <<'MANIFEST_EOF'",
    JSON.stringify(manifest),
    'MANIFEST_EOF',
    "cat > assemble.py <<'SCRIPT_EOF'",
    ASSEMBLE_PY,
    'SCRIPT_EOF',
    'python3 assemble.py',
  ].join('\n');
}

/**
 * Comando da montagem (mux + narrações + trilha) para estes clipes, gravando o
 * master em `outPath`. Usado pela montagem do Diretor e pela remontagem de uma
 * cena editada (§10), que troca só o clipe da cena.
 */
async function assemblyCommandFor(
  service: Service, job: Job, videos: VideoArt[], outPath: string, keepUpload = false,
): Promise<string> {
  const arts = job.artifacts as { tts?: TtsArt[]; bed?: string };
  const downloads: { name: string; url: string }[] = [];
  const clips: { idx: number; video: string; narrations: string[] }[] = [];
  for (const v of videos) {
    const vName = `v${v.shot}.mp4`;
    downloads.push({ name: vName, url: await sign(service, v.path, 7200) });
    const narrations: string[] = [];
    if (!v.cta) {
      // grupo multi-cena: narrações de TODOS os membros, em ordem, sobre o clipe único
      const memberIdxs = v.members ?? [v.shot];
      for (const mIdx of memberIdxs) {
        const t = arts.tts!.find((t) => t.shot === mIdx);
        if (!t) throw new Error(`assemble sem narração do shot ${mIdx}`);
        const name = `b${mIdx}.mp3`;
        narrations.push(name);
        downloads.push({ name, url: await sign(service, t.path, 7200) });
      }
    }
    clips.push({ idx: v.shot, video: vName, narrations });
  }
  downloads.push({ name: 'bed.mp3', url: await sign(service, arts.bed!, 7200) });
  const manifest = { clips, bed: 'bed.mp3', upload: await signUpload(service, outPath, keepUpload) };
  return assembleCommand(manifest, downloads);
}

/**
 * Clipes que entram na montagem, na ordem: só os de ÂNCORA (descarta entrada
 * per-shot órfã gravada por lane não-group-aware — o conteúdo dela já vive no
 * clipe do grupo). Falta de âncora é erro: montar sem ela cortaria a fala.
 */
async function montageVideos(service: Service, job: Job): Promise<VideoArt[]> {
  const arts = job.artifacts as { videos?: VideoArt[]; tts?: TtsArt[] };
  const units = videoUnits(job.plan!.shots!, arts.tts ?? [], await unitCaps(service, job));
  const anchorIdxs = new Set(units.map((u) => u.anchor.idx));
  const videos = [...(arts.videos ?? [])]
    .filter((v) => anchorIdxs.has(v.shot))
    .sort((a, b) => a.shot - b.shot);
  for (const u of units) {
    if (!videos.some((v) => v.shot === u.anchor.idx)) {
      throw new Error(`montagem sem vídeo da âncora ${u.anchor.idx}`);
    }
  }
  if (!videos.length) throw new Error('assemble sem vídeos');
  return videos;
}

async function stepAssemble(service: Service, job: Job) {
  const arts = job.artifacts as {
    videos?: VideoArt[];
    tts?: TtsArt[];
    bed?: string;
    master?: string;
    captions_ass?: string;
    final?: string;
    pending_asm?: Pending[];
    pending_burn?: Pending[];
  };
  if (esperandoClaude(job)) return; // montagem ou legenda com o Claude da pessoa
  if (arts.final) { await finishJob(service, job); return; } // idempotente pós-retry
  if (arts.master) { await stepCaptions(service, job); return; } // fase 2: legendas

  // bed inteira no bucket; quem corta é o ffmpeg do sandbox (aloop+atrim na duração real)
  const targetDur = (arts.videos ?? []).reduce((acc, v) => acc + v.dur_s, 0);
  if (!arts.bed) {
    const bedPath = `director/${job.id}/bed.mp3`;
    const bytes = await sfxMp3(service,
      bedPrompt(job.plan!.concept, (job.brief as { tom?: unknown }).tom),
      Math.min(SFX_MAX_S, Math.ceil(targetDur)),
    );
    await putObject(service, bedPath, bytes, 'audio/mpeg');
    arts.bed = bedPath;
    await patch(service, job.id, { artifacts: arts });
  }

  if (!arts.pending_asm?.length) {
    const videos = await montageVideos(service, job);
    // sem o login do Higgsfield não há sandbox: o Claude da pessoa monta
    if (!(await hfConnected(service))) {
      await pedirAoClaude(service, job, 'montagem');
      return;
    }
    const outPath = `director/${job.id}/master.mp4`;
    const out = await mcp(service, 'sandbox_exec', {
      command: await assemblyCommandFor(service, job, videos, outPath),
      background: true,
    });
    const log = out.match(/Combined output:\s*(\S+)/)?.[1];
    const exit = out.match(/Exit status \(written when done\):\s*(\S+)/)?.[1];
    if (!log || !exit) throw new Error(`sandbox background sem log/exit: ${out.slice(0, 200)}`);
    arts.pending_asm = [{ log, exit, submitted_at: Date.now() }];
    await patch(service, job.id, { artifacts: arts });
    return;
  }

  const p = arts.pending_asm[0];
  if (p.submitted_at && Date.now() - p.submitted_at > PENDING_DEADLINE_MS) {
    arts.pending_asm = [];
    await patch(service, job.id, { artifacts: arts });
    throw new Error(`assemble estourou o prazo de ${PENDING_DEADLINE_MS / 60000}min`);
  }
  const out = await mcp(service, 'sandbox_exec', {
    command: `if [ -f ${p.exit} ]; then echo "EXITCODE:$(cat ${p.exit})"; fi; tail -n 30 ${p.log} 2>/dev/null`,
    timeout_seconds: 30,
  });
  const code = out.match(/EXITCODE:(\d+)/)?.[1];
  if (code == null) return; // ainda rodando — próximo tick
  arts.pending_asm = [];
  if (code !== '0' || !out.includes('ASSEMBLE_OK')) {
    await patch(service, job.id, { artifacts: arts });
    throw new Error(`assemble falhou (exit ${code}): ${out.slice(-400)}`);
  }
  arts.master = `director/${job.id}/master.mp4`;
  await patch(service, job.id, { artifacts: arts });
}

/**
 * Idioma falado no master, para o STT. Diretor: narração do roteiro pt-BR.
 * Remake traduzido: o idioma de destino (é o que se ouve no fim). Remake sem
 * tradução: `source_language` da tela (ISO-639-1); sem ele → autodetecção.
 */
function captionsLanguage(job: Job): string | null {
  if ((job.config as { mode?: string }).mode !== 'remake') return 'pt';
  const cfg = remakeConfig(job);
  const target = cfg.translate ?? '';
  if (LANGUAGES[target]) return target;
  const source = (cfg.source_language ?? '').trim().toLowerCase();
  return /^[a-z]{2}$/.test(source) ? source : null;
}

/** Cor de destaque da marca ativa (paleta: accent → primary → brand), como o artInk da tela. */
async function brandAccent(service: Service): Promise<string | null> {
  try {
    const { data } = await service.from('brand_kit').select('content').eq('status', 'active').maybeSingle();
    const palette = ((data as { content?: { palette?: Record<string, unknown> } } | null)?.content?.palette ?? {});
    for (const key of ['accent', 'primary', 'brand']) {
      const raw = typeof palette[key] === 'string' ? (palette[key] as string).trim().replace(/^#/, '') : '';
      const hex = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
      if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toUpperCase()}`;
    }
  } catch (err) {
    console.warn('[captions] brand kit:', errText(err));
  }
  return null;
}

/**
 * Estilo das legendas: o que a tela mandou. Remake sem cor no pedido (job
 * antigo ou criado fora da tela) usa a cor da marca; sem marca, a de sempre.
 */
async function captionsFor(service: Service, job: Job): Promise<CaptionCfg> {
  const cfg = captionCfg(job.config);
  const isRemake = (job.config as { mode?: string }).mode === 'remake';
  if (!isRemake || /^#[0-9a-fA-F]{6}$/.test(String(job.config.captions_accent ?? ''))) return cfg;
  const accent = await brandAccent(service);
  return accent ? { ...cfg, accent } : cfg;
}

// ── STT das legendas: capability `stt` do catálogo, com o Scribe v2 direto de reserva ──
type SttState = { rp_id?: string; submitted_at?: number; model?: string; direct?: boolean };

async function catalogSttEntry(service: Service): Promise<VideoModelEntry | null> {
  try {
    return await resolveModel(service, 'stt');
  } catch {
    return null; // sem linha stt ativa: o caminho de sempre (ElevenLabs direto)
  }
}

/**
 * Palavras com tempo do master. Com uma linha `stt` ativa e o token do
 * Replicate: predição assíncrona (checkpoint em artifacts.stt; null = rodando).
 * Falha, prazo estourado ou saída sem tempo por palavra → Scribe v2 direto do
 * ElevenLabs, como antes (e o retry não volta a pagar o catálogo).
 */
async function captionWords(service: Service, job: Job): Promise<Word[] | null> {
  const arts = job.artifacts as { master?: string; stt?: SttState };
  const language = captionsLanguage(job);
  const state: SttState = arts.stt ?? {};
  if (!state.direct) {
    if (!state.rp_id) {
      const entry = await catalogSttEntry(service);
      const token = entry ? await replicateToken(service).catch(() => null) : null;
      if (entry && token) {
        const input = renderInputTemplate(entry.input_template, {
          audio_url: await sign(service, arts.master!, 3600),
          language_code: language ?? undefined,
        });
        if (!missingRequiredInputs(entry, input).length) {
          try {
            const prediction = await createCatalogPrediction(service, job, token, entry, input, {});
            arts.stt = { rp_id: prediction.id, submitted_at: Date.now(), model: entry.model_id };
            await patch(service, job.id, { artifacts: job.artifacts });
            return null;
          } catch (err) {
            console.warn('[captions] stt do catálogo não iniciou, ElevenLabs direto:', errText(err));
          }
        }
      }
      if (!entry) return await sttWords(service, await sign(service, arts.master!, 3600), language);
    } else {
      try {
        const p = await getPrediction(await replicateToken(service), state.rp_id);
        if (p.status === 'succeeded') {
          let words = parseSttOutput(p.output);
          const url = words.length ? null : firstOutputUrl(p.output);
          if (url) {
            const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
            if (r.ok) words = parseSttOutput(await r.text());
          }
          if (words.length) return words;
          console.warn(`[captions] ${state.model ?? 'stt'} sem palavras com tempo, ElevenLabs direto`);
        } else if (!['failed', 'canceled', 'aborted'].includes(p.status)) {
          if (Date.now() - (state.submitted_at ?? 0) < PENDING_DEADLINE_MS) return null;
          console.warn('[captions] stt do catálogo estourou o prazo, ElevenLabs direto');
        } else {
          console.warn(`[captions] stt do catálogo falhou (${p.error ?? p.status}), ElevenLabs direto`);
        }
      } catch (err) {
        if (err instanceof ReplicateError && err.retryable) return null; // rede/429: tenta no próximo tick
        console.warn('[captions] stt do catálogo:', errText(err));
      }
    }
    arts.stt = { ...state, direct: true };
    await patch(service, job.id, { artifacts: job.artifacts });
  }
  return await sttWords(service, await sign(service, arts.master!, 3600), language);
}

/**
 * Fontes das legendas (OFL) com origem fixa e sha256 conferido. A instância
 * remixada não traz o Storage do projeto original: se o asset faltar no
 * bucket, baixa uma vez da origem, confere o hash e sobe — auto-cura.
 */
const CAPTION_FONTS: Record<string, { url: string; sha256: string }> = {
  'Montserrat-ExtraBold.ttf': {
    url: 'https://raw.githubusercontent.com/JulietaUla/Montserrat/master/fonts/ttf/Montserrat-ExtraBold.ttf',
    sha256: 'd3ac6a843d3ba6d5cafd44cf39e437055c8aed7e261010f595f57d3c7b3e2c1b',
  },
  'BebasNeue-Regular.ttf': {
    url: 'https://github.com/google/fonts/raw/main/ofl/bebasneue/BebasNeue-Regular.ttf',
    sha256: '08e4623805102d819f58601e46e345648846075e363b2ceb23313c2d1c83ec73',
  },
};

async function signFont(service: Service, name: string): Promise<string> {
  const path = `director/assets/fonts/${name}`;
  try {
    return await sign(service, path, 7200);
  } catch (err) {
    const src = CAPTION_FONTS[name];
    if (!src || !/not found/i.test(errText(err))) throw err;
    const bytes = await fetchBytes(src.url);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
    const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
    if (hex !== src.sha256) throw new Error(`fonte ${name}: hash diferente do esperado`);
    const { error } = await service.storage.from(BUCKET)
      .upload(path, bytes, { contentType: 'font/ttf', upsert: true });
    if (error) throw new Error(`upload ${path}: ${error.message}`);
    console.warn(`[captions] fonte ${name} restaurada no bucket a partir da origem`);
    return await sign(service, path, 7200);
  }
}

/** Comando que queima o ASS `assPath` no `masterPath` e sobe em `outPath` (imprime BURN_OK). */
async function burnCommandFor(
  service: Service, masterPath: string, assPath: string, outPath: string, keepUpload = false,
): Promise<string> {
  // fontes dos presets hospedadas no bucket (sem dependência de GitHub em produção)
  const fonts = ['Montserrat-ExtraBold.ttf', 'BebasNeue-Regular.ttf'];
  const fontDl: string[] = [];
  for (const f of fonts) {
    fontDl.push(`curl -fsS -o fonts/${f} '${await signFont(service, f)}'`);
  }
  return [
    'set -euo pipefail',
    'rm -rf /tmp/burn && mkdir -p /tmp/burn/fonts && cd /tmp/burn',
    `curl -fsS -o master.mp4 '${await sign(service, masterPath, 7200)}'`,
    ...fontDl,
    `curl -fsS -o subs.ass '${await sign(service, assPath, 7200)}'`,
    'ffmpeg -y -i master.mp4 -vf "ass=subs.ass:fontsdir=fonts" -c:v libx264 -preset veryfast -crf 19 -c:a copy -movflags +faststart final.mp4',
    '[ -s final.mp4 ]',
    `code=$(curl -sS -X PUT -H 'Content-Type: video/mp4' -H 'x-upsert: true' --data-binary @final.mp4 -w '%{http_code}' -o /dev/null '${await signUpload(service, outPath, keepUpload)}'); [ "$code" = "200" ] || { echo "upload:$code"; exit 1; }`,
    'echo BURN_OK',
  ].join('\n');
}

/** Fase 2 da montagem: legendas queimadas (STT scribe → ASS → burn no sandbox). */
async function stepCaptions(service: Service, job: Job) {
  const arts = job.artifacts as {
    master?: string;
    captions_ass?: string;
    final?: string;
    pending_burn?: Pending[];
  };
  if (esperandoClaude(job)) return; // legenda com o Claude da pessoa (remake chega aqui direto)
  const outPath = `director/${job.id}/final.mp4`;
  const captionsOn = (job.config as { captions?: boolean }).captions !== false;
  if (!captionsOn) {
    await ensureLocal(service, BUCKET, arts.master!);
    await service.storage.from(BUCKET).remove([outPath]).catch(() => {}); // copy não é upsert
    const { error } = await service.storage.from(BUCKET).copy(arts.master!, outPath);
    if (error) throw new Error(`copy master→final: ${error.message}`);
    arts.final = outPath;
    await patch(service, job.id, { artifacts: arts });
    await finishJob(service, job);
    return;
  }
  if (!arts.captions_ass) {
    const words = await captionWords(service, job);
    if (words === null) return; // STT do catálogo ainda rodando — próximo tick
    if (!words.length) throw new Error('stt sem palavras — áudio do master vazio?');
    // ASS vai pro bucket (não inline): sandbox_exec limita o comando a 16k chars
    const assPath = `director/${job.id}/captions.ass`;
    await putObject(service, assPath, new TextEncoder().encode(buildAss(words, await captionsFor(service, job))), 'text/plain');
    arts.captions_ass = assPath;
    await patch(service, job.id, { artifacts: arts });
  }
  if (!arts.pending_burn?.length) {
    // sem o login do Higgsfield não há sandbox: o Claude da pessoa queima a legenda
    if (!(await hfConnected(service))) {
      await pedirAoClaude(service, job, 'legenda');
      return;
    }
    const cmd = await burnCommandFor(service, arts.master!, arts.captions_ass, outPath);
    const out = await mcp(service, 'sandbox_exec', { command: cmd, background: true });
    const log = out.match(/Combined output:\s*(\S+)/)?.[1];
    const exit = out.match(/Exit status \(written when done\):\s*(\S+)/)?.[1];
    if (!log || !exit) throw new Error(`burn background sem log/exit: ${out.slice(0, 200)}`);
    arts.pending_burn = [{ log, exit, submitted_at: Date.now() }];
    await patch(service, job.id, { artifacts: arts });
    return;
  }
  const p = arts.pending_burn[0];
  if (p.submitted_at && Date.now() - p.submitted_at > PENDING_DEADLINE_MS) {
    arts.pending_burn = [];
    await patch(service, job.id, { artifacts: arts });
    throw new Error(`burn de legendas estourou o prazo de ${PENDING_DEADLINE_MS / 60000}min`);
  }
  const out = await mcp(service, 'sandbox_exec', {
    command: `if [ -f ${p.exit} ]; then echo "EXITCODE:$(cat ${p.exit})"; fi; tail -n 20 ${p.log} 2>/dev/null`,
    timeout_seconds: 30,
  });
  const code = out.match(/EXITCODE:(\d+)/)?.[1];
  if (code == null) return;
  arts.pending_burn = [];
  if (code !== '0' || !out.includes('BURN_OK')) {
    await patch(service, job.id, { artifacts: arts });
    throw new Error(`burn de legendas falhou (exit ${code}): ${out.slice(-400)}`);
  }
  arts.final = outPath;
  await patch(service, job.id, { artifacts: arts });
  await finishJob(service, job);
}

// ── montagem e legenda pelo Claude da pessoa (sem o login do Higgsfield) ─────
// O job fica em `muxing` com `artifacts.claude` (status que o banco já aceita:
// nenhuma mudança de schema). Enquanto o pedido existe, o tick só confere o
// prazo e volta. O conector lê o pedido em montagem_pedidos — o comando sai com
// links assinados NA LEITURA, porque o Claude pode atender horas depois — e
// devolve em montagem_entregar, que confere o MP4 e tira o pedido: o tick
// seguinte segue para a legenda ou para o fim.
const AGUARDANDO_CLAUDE = 'muxing';
const PRAZO_DO_CLAUDE_MS = 24 * 3600_000;
type PedidoAoClaude = { tipo: 'montagem' | 'legenda'; pedido_em: number };

const masterPath = (id: string) => `director/${id}/master.mp4`;
const finalPath = (id: string) => `director/${id}/final.mp4`;

const RECEITA_MONTAGEM_CENAS = `MONTAGEM DO VÍDEO DE CENAS. O produto já gerou as cenas, a narração e a trilha. Falta juntar tudo (pedido "montagem") ou queimar a legenda (pedido "legenda").
1. Rode o comando do pedido inteiro, sem mudar nada, com bash, num ambiente com internet, curl, python3 e ffmpeg. O Claude Code no computador da pessoa serve; o ambiente de código do claude.ai, só se alcançar o endereço dos arquivos. Sem ffmpeg, instale antes (brew install ffmpeg ou apt-get install -y ffmpeg).
2. O comando baixa os arquivos, monta e envia o MP4 sozinho. Deu certo quando imprime ASSEMBLE_OK (montagem) ou BURN_OK (legenda).
3. Depois chame montagem_entregar com o job_id. Depois da montagem vem a legenda, num segundo pedido: espere 2 minutos e chame montagem_pedidos de novo.
4. Se falhar, mostre à pessoa as últimas linhas do erro e não entregue. Os links do comando valem 2 horas; passou disso, chame montagem_pedidos de novo.`;

async function pedirAoClaude(service: Service, job: Job, tipo: PedidoAoClaude['tipo']) {
  const pedido: PedidoAoClaude = { tipo, pedido_em: Date.now() };
  (job.artifacts as Record<string, unknown>).claude = pedido;
  await transition(service, job, { artifacts: job.artifacts });
}

/**
 * Pedido ao Claude aberto: o tick não faz nada até a entrega. Passado o prazo,
 * o job falha com a frase de "Retomar produção" (o retry pede de novo).
 */
function esperandoClaude(job: Job): boolean {
  const arts = job.artifacts as { claude?: PedidoAoClaude };
  if (!arts.claude) return false;
  if (Date.now() - arts.claude.pedido_em > PRAZO_DO_CLAUDE_MS) {
    delete (job.artifacts as Record<string, unknown>).claude;
    throw new Error('O seu Claude não atendeu a montagem em 24 horas. Clique em "Retomar produção" para pedir de novo.');
  }
  return true;
}

/** Pedidos esperando o Claude, cada um com o comando pronto (montagem_pedidos). */
async function claudePedidos(service: Service, body: Record<string, unknown>): Promise<Response> {
  const alvo = typeof body.job_id === 'string' && UUID_RE.test(body.job_id) ? body.job_id : null;
  let q = service.from('director_jobs').select('*').eq('status', AGUARDANDO_CLAUDE)
    .not('artifacts->claude', 'is', null).order('updated_at').limit(10);
  if (alvo) q = q.eq('id', alvo);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const pedidos: Record<string, unknown>[] = [];
  for (const job of (data ?? []) as Job[]) {
    const pedido = (job.artifacts as { claude?: PedidoAoClaude }).claude;
    if (!pedido) continue;
    if (Date.now() - pedido.pedido_em > PRAZO_DO_CLAUDE_MS) {
      await transition(service, job, {
        status: 'failed',
        error: 'O seu Claude não atendeu a montagem em 24 horas. Clique em "Retomar produção" para pedir de novo.',
      }).catch(() => {});
      continue;
    }
    if (pedidos.length >= 3) continue;
    const arts = job.artifacts as { master?: string; captions_ass?: string };
    const comando = pedido.tipo === 'montagem'
      ? await assemblyCommandFor(service, job, await montageVideos(service, job), masterPath(job.id), true)
      : await burnCommandFor(service, arts.master!, arts.captions_ass!, finalPath(job.id), true);
    pedidos.push({
      job_id: job.id, tipo: pedido.tipo, comando,
      pronto_quando: pedido.tipo === 'montagem' ? 'ASSEMBLE_OK' : 'BURN_OK',
    });
  }
  return jsonResponse({ pedidos, receita: RECEITA_MONTAGEM_CENAS });
}

/** Entrega do Claude: confere o MP4 enviado e o job segue (montagem_entregar). */
async function claudeEntrega(service: Service, body: Record<string, unknown>): Promise<Response> {
  const id = typeof body.job_id === 'string' && UUID_RE.test(body.job_id) ? body.job_id : '';
  const { data } = id ? await service.from('director_jobs').select('*').eq('id', id).maybeSingle() : { data: null };
  const job = data as Job | null;
  if (!job) return errorResponse(404, 'not_found', 'Vídeo não encontrado.');
  const pedido = (job.artifacts as { claude?: PedidoAoClaude }).claude;
  if (job.status !== AGUARDANDO_CLAUDE || !pedido) {
    return errorResponse(409, 'not_waiting', 'Este vídeo não está esperando o seu Claude.');
  }
  const path = pedido.tipo === 'montagem' ? masterPath(job.id) : finalPath(job.id);
  const { data: signed } = await service.storage.from(BUCKET).createSignedUrl(path, 300);
  const head = signed ? await fetch(signed.signedUrl, { headers: { range: 'bytes=0-11' } }).catch(() => null) : null;
  const bytes = head?.ok ? new Uint8Array(await head.arrayBuffer()) : new Uint8Array();
  const size = Number(head?.headers.get('content-range')?.split('/')[1]);
  if (!isMp4Head(bytes) || !(size >= MIN_DELIVERY_BYTES)) {
    const marca = pedido.tipo === 'montagem' ? 'ASSEMBLE_OK' : 'BURN_OK';
    return errorResponse(400, 'no_video', `Não encontrei o MP4 enviado. Rode o comando do pedido até aparecer ${marca} e entregue de novo.`);
  }
  const arts = job.artifacts as Record<string, unknown>;
  if (pedido.tipo === 'montagem') arts.master = path;
  else arts.final = path;
  delete arts.claude;
  await transition(service, job, { status: 'muxing', artifacts: arts, error: null });
  const legendaDepois = pedido.tipo === 'montagem' && (job.config as { captions?: boolean }).captions !== false;
  return jsonResponse({
    entregue: true,
    proximo: legendaDepois
      ? 'A legenda vem num segundo pedido, em cerca de 2 minutos: chame montagem_pedidos de novo.'
      : 'O vídeo está pronto na tela da pessoa.',
  });
}

// ── element do Higgsfield a partir de 1-3 fotos ─────────────────────────────
/** Importa as fotos e cria o reference element; só devolve id que RESOLVE no get. */
async function createHfElement(
  service: Service,
  args: { name: string; description: string | null; urls: string[]; ownerId: string },
): Promise<{ elementId: string; mediaIds: string[] }> {
  if (!args.urls.length) throw new Error('sem fotos');
  const medias: { id: string; url: string; type: string }[] = [];
  const mediaIds: string[] = [];
  for (const src of args.urls.slice(0, 3)) {
    const { id, hostedUrl } = await hfImportMedia(service, src, 'image');
    mediaIds.push(id);
    medias.push({ id, url: hostedUrl ?? src, type: 'media_input' });
  }
  const out = await mcp(service, 'show_reference_elements', {
    action: 'create',
    name: args.name.slice(0, 32),
    ...(args.description ? { description: args.description } : {}),
    medias,
  });
  // formato observado: 'Created character "Nome" (uuid). Status: completed.' + bloco 'id: uuid'.
  // Um erro do MCP também carrega UUID ("Request ID: ...") — parse defensivo + verificação real.
  if (/error/i.test(out) && !/Created/i.test(out)) throw new Error(`element create falhou: ${out.slice(0, 300)}`);
  const cleaned = out
    .replace(/Request ID:\s*[a-f0-9-]{36}/gi, ' ')
    .replace(/https:\/\/[^\s"'`)\]]+/g, ' ');
  const labeled = cleaned.match(/Created [a-z]+ "[^"]*" \(([a-f0-9-]{36})\)/i)?.[1]
    ?? cleaned.match(/^\s*id:\s*([a-f0-9-]{36})/im)?.[1];
  const uuids = cleaned.match(new RegExp(UUID_RE.source, 'g')) ?? [];
  const elementId = labeled ?? uuids.find((u) => !mediaIds.includes(u) && u !== args.ownerId);
  if (!elementId) throw new Error(`element create sem id: ${out.slice(0, 200)}`);
  // só marca ready se o element RESOLVE de verdade (id espúrio já virou identidade fantasma)
  const check = await mcp(service, 'show_reference_elements', { action: 'get', element_id: elementId });
  if (!check.includes(elementId) || /not found|error/i.test(check.slice(0, 120))) {
    throw new Error(`element ${elementId} não resolve no get: ${check.slice(0, 200)}`);
  }
  return { elementId, mediaIds };
}

/**
 * Foto de reserva para o element do Higgsfield: a preview do avatar HeyGen do
 * apresentador, relida na HeyGen (a URL guardada expira). Também tenta copiar
 * para o cadastro (reference_image_path), para o próximo uso não depender dela.
 */
async function heygenPreviewUrl(service: Service, presenter: Presenter): Promise<string | null> {
  const ref = heygenRefOf(presenter.provider_refs);
  if (!ref) return null;
  let url = ref.preview_image_url;
  const key = await heygenKeyOrNull(service);
  if (key) {
    try {
      url = (await getLook(key, ref.look_id)).preview_image_url ?? url;
    } catch (err) {
      console.warn('[presenters] preview HeyGen:', errText(err));
    }
  }
  if (url) await ensurePreviewPhoto(service, presenter.id, url).catch((e) => console.warn('[presenters] preview → foto:', errText(e)));
  return url;
}

// ── Estúdio de Identidades (LEGADO): materializa identidade nova no Higgsfield ─
// Roda 1 identidade por tick, fora da fila de jobs. Claim otimista por status
// (creating → importing); 'importing' velho (>10min, crash no meio) é retomado.
// Cadastro novo é em brand_avatars (stepPresenters); isto só esvazia a fila antiga.
async function stepIdentities(service: Service) {
  const stale = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: rows, error: selErr } = await service
    .from('director_identities')
    .select('*')
    .or(`status.eq.creating,and(status.eq.importing,updated_at.lt.${stale})`)
    .order('created_at')
    .limit(1);
  if (selErr) {
    console.error('stepIdentities select:', selErr.message);
    return;
  }
  const identity = rows?.[0] as
    | { id: string; name: string; description: string | null; image_paths: string[]; status: string; updated_at: string }
    | undefined;
  if (!identity) return;
  // claim exclusivo: o eq de updated_at cobre a retomada importing→importing
  // (o trigger set_updated_at muda o valor no claim do vencedor)
  const { data: claimed } = await service
    .from('director_identities')
    .update({ status: 'importing' })
    .eq('id', identity.id)
    .eq('status', identity.status)
    .eq('updated_at', identity.updated_at)
    .select('id');
  if (!claimed?.length) return;
  try {
    const paths = (identity.image_paths ?? []) as string[];
    if (!paths.length) throw new Error('identidade sem imagens');
    const urls: string[] = [];
    for (const p of paths.slice(0, 3)) urls.push(await sign(service, p, 3600));
    const { elementId, mediaIds } = await createHfElement(service, {
      name: identity.name, description: identity.description, urls, ownerId: identity.id,
    });
    await service.from('director_identities').update({
      hf_element_id: elementId, hf_media_ids: mediaIds, status: 'ready', error: null,
    }).eq('id', identity.id);
  } catch (err) {
    await service.from('director_identities').update({
      status: 'failed',
      error: String(err instanceof Error ? err.message : err).slice(0, 500),
    }).eq('id', identity.id);
  }
}

// ── Apresentadores: prepara no Higgsfield o que um job pediu ─────────────────
// 1 por tick, fora da fila de jobs. Claim otimista: requested → preparing
// (guard no status lido); 'preparing' velho (crash no meio) é retomado pelo
// claimed_at. Fotos assinadas do bucket brand-assets.
async function stepPresenters(service: Service) {
  const { data: rows, error } = await service
    .from('brand_avatars')
    .select('*')
    .in('provider_refs->higgsfield->>status', ['requested', 'preparing'])
    .order('created_at')
    .limit(10);
  if (error) {
    console.error('stepPresenters select:', error.message);
    return;
  }
  const presenter = ((rows ?? []) as Presenter[]).find((p) => {
    const hf = hfRef(p);
    if (hf.status === 'requested') return true;
    return Date.now() - (Date.parse(hf.claimed_at ?? '') || 0) > HF_PREP_STALE_MS;
  });
  if (!presenter) return;
  const seen = hfRef(presenter);
  const attempts = seen.attempts ?? 0;
  // teto de gasto: cada tentativa importa fotos no Higgsfield (crédito)
  if (attempts >= HF_PREP_MAX_ATTEMPTS) {
    await writeHfRef(service, presenter, seen, {
      ...seen,
      status: 'failed',
      error: `não deu para preparar "${presenter.name}" depois de ${attempts} tentativas; troque as fotos`,
      failed_at: new Date().toISOString(),
    });
    return;
  }
  const claim: HfRef = {
    ...seen, status: 'preparing', attempts: attempts + 1,
    claimed_at: new Date().toISOString(), error: null,
  };
  if (!(await writeHfRef(service, presenter, seen, claim))) return;
  const claimedRow: Presenter = {
    ...presenter,
    provider_refs: { ...(presenter.provider_refs ?? {}), higgsfield: claim },
  };
  try {
    const photos = presenterPhotos(presenter);
    const urls: string[] = [];
    for (const p of photos) urls.push(await sign(service, p, 3600, PRESENTER_BUCKET));
    if (!urls.length) {
      const preview = await heygenPreviewUrl(service, presenter);
      if (preview) urls.push(preview);
    }
    if (!urls.length) throw new Error('apresentador sem fotos');
    const { elementId, mediaIds } = await createHfElement(service, {
      name: presenter.name, description: presenter.appearance_prompt, urls, ownerId: presenter.id,
    });
    await writeHfRef(service, claimedRow, claim, {
      status: 'ready', element_id: elementId, media_ids: mediaIds, error: null,
      attempts: claim.attempts, requested_at: seen.requested_at, claimed_at: claim.claimed_at,
    });
  } catch (err) {
    // Higgsfield desconectado não é culpa das fotos: não consome tentativa e
    // volta a "requested" para tentar quando reconectar.
    const notConnected = err instanceof NotConnectedError;
    await writeHfRef(service, claimedRow, claim, {
      status: notConnected ? 'requested' : 'failed',
      attempts: notConnected ? attempts : claim.attempts,
      error: String(err instanceof Error ? err.message : err).slice(0, 500),
      requested_at: seen.requested_at,
      ...(notConnected ? {} : { failed_at: new Date().toISOString() }),
    }).catch((e) => console.error('stepPresenters failed-write:', e));
  }
}

// ── Publicação TikTok (job done → 'publishing' via UI) ───────────────────────
type TikTokCfg = {
  mode: 'DIRECT_POST' | 'UPLOAD_TO_DRAFT';
  title?: string;
  privacy_level?: string;
  music_sound_id?: string;
  music_volume?: number;
  original_volume?: number;
  /** o usuário revisou o vídeo e confirmou a publicação no dialog da UI */
  confirmed: boolean;
  /** carimbo do clique — distingue pedido novo de retomada ambígua pós-crash */
  requested_at?: number;
};

// Erro aqui NUNCA falha o job: o advanceOne devolve pra 'done' com tiktok.error.
async function stepPublish(service: Service, job: Job) {
  const arts = job.artifacts as {
    final?: string;
    tiktok?: Record<string, unknown>;
    pending_pub?: Pending[];
  };
  const cfg = (job.config as { tiktok?: TikTokCfg }).tiktok;
  if (!cfg?.confirmed) throw new Error('publicação sem confirmação do usuário');
  // a versão editada vale aqui como no Instagram; sem ela, sai o original
  const video = publishablePath(arts);
  if (!video) throw new Error('job sem final.mp4');

  if (arts.pending_pub?.length) {
    const p = arts.pending_pub[0];
    if (p.submitted_at && Date.now() - p.submitted_at > PENDING_DEADLINE_MS) {
      // o TikTok ainda pode publicar depois — timeout NÃO é falha definitiva
      arts.tiktok = {
        ...(arts.tiktok ?? {}), status: 'timeout',
        error: 'TikTok ainda processando após 12min — confira no app antes de publicar de novo.',
      };
      arts.pending_pub = [];
      await transition(service, job, { status: 'done', artifacts: arts });
      return;
    }
    const st = await mcp(service, 'tiktok_publish_status', {
      connector_id: (arts.tiktok as { connector_id?: string })?.connector_id,
      publish_id: p.hf_job,
    });
    if (/FAILED|FAILURE/i.test(st)) throw new Error(`TikTok: ${st.slice(0, 300)}`);
    if (/PUBLISH_COMPLETE|SEND_TO_USER_INBOX|INBOX_DELIVERED|published/i.test(st)) {
      const url = st.match(/https:\/\/www\.tiktok\.com[^\s"'`)\]]*/)?.[0] ?? null;
      arts.tiktok = { ...(arts.tiktok ?? {}), status: 'published', url, error: null };
      arts.pending_pub = [];
      await transition(service, job, { status: 'done', artifacts: arts });
    }
    return; // ainda processando — próximo tick
  }

  // crash entre o tiktok_publish e a persistência do pending: NÃO republicar às cegas
  const prev = (arts.tiktok ?? {}) as { stage?: string; requested_at?: number | null };
  if (prev.stage === 'submitting' && prev.requested_at === (cfg.requested_at ?? null)) {
    throw new Error('a submissão anterior pode ter chegado ao TikTok — confira no app antes de "Publicar de novo".');
  }

  const accounts = await mcp(service, 'tiktok_accounts', {});
  const connectorId = parseActiveConnector(accounts);
  if (!connectorId) throw new Error('nenhuma conta TikTok ativa — conecte pela página do Diretor.');

  // TikTok exige mídia hospedada no Higgsfield — importa o final.mp4 pra lá
  const { hostedUrl } = await hfImportMedia(service, await sign(service, video, 7200), 'video');
  if (!hostedUrl) throw new Error('import do vídeo sem URL hospedada no Higgsfield');
  const prep = await mcp(service, 'tiktok_prepare_publish', {
    connector_id: connectorId, mode: cfg.mode, media_type: 'VIDEO',
    video_url: hostedUrl,
    ...(cfg.title ? { title: cfg.title.slice(0, 150) } : {}),
    is_aigc: true,
    ...(cfg.mode === 'DIRECT_POST' && cfg.privacy_level ? { privacy_level: cfg.privacy_level } : {}),
  });
  const sessionId = prep.match(/publish_session_id\W{0,4}([a-f0-9-]{36})/i)?.[1]
    ?? (prep.match(new RegExp(UUID_RE.source, 'g')) ?? []).find((u) => u !== connectorId);
  if (!sessionId) throw new Error(`prepare sem session id: ${prep.slice(0, 250)}`);

  // checkpoint ANTES do publish: crash entre publish e persistência cai no guard acima
  arts.tiktok = {
    connector_id: connectorId, publish_session_id: sessionId, mode: cfg.mode,
    stage: 'submitting', requested_at: cfg.requested_at ?? null,
  };
  await patch(service, job.id, { artifacts: arts });

  const pub = await mcp(service, 'tiktok_publish', {
    connector_id: connectorId, publish_session_id: sessionId,
    mode: cfg.mode, media_type: 'VIDEO',
    ...(cfg.title ? { title: cfg.title.slice(0, 150) } : {}),
    is_aigc: true,
    user_confirmed: true, preview_confirmed: true,
    processing_notice_acknowledged: true,
    interaction_settings_selected_by_user: true,
    ...(cfg.mode === 'DIRECT_POST'
      ? { privacy_level: cfg.privacy_level ?? 'SELF_ONLY', privacy_level_selected_by_user: true }
      : {}),
    ...(cfg.music_sound_id
      ? {
        music_sound_id: cfg.music_sound_id,
        music_usage_confirmed: true,
        music_sound_volume: cfg.music_volume ?? 30,
        video_original_sound_volume: cfg.original_volume ?? 100,
      }
      : {}),
  });
  const publishId = pub.match(/publish_id\W{0,4}([\w.~-]{8,})/i)?.[1];
  if (!publishId) throw new Error(`publish sem publish_id: ${pub.slice(0, 250)}`);
  arts.tiktok = { ...arts.tiktok, publish_id: publishId, stage: 'submitted', status: 'processing' };
  arts.pending_pub = [{ hf_job: publishId, submitted_at: Date.now() }];
  await patch(service, job.id, { artifacts: arts });
}

async function finishJob(service: Service, job: Job) {
  const balEnd = await hfBalance(service).catch(() => null);
  const costs = job.costs as { hf_credits_start?: number };
  const patchCosts: Record<string, unknown> = { ...job.costs, hf_credits_end: balEnd };
  if (balEnd != null && costs.hf_credits_start != null) {
    patchCosts.hf_credits_spent = Number((costs.hf_credits_start - balEnd).toFixed(1));
  }
  const auto = (job.config as { auto_approve_audio?: boolean }).auto_approve_audio ?? true;
  await transition(service, job, {
    artifacts: job.artifacts,
    costs: patchCosts,
    status: auto ? 'done' : 'awaiting_audio_approval',
  });
  if (auto) await pedirMontagemDoPlano(service, job);
}

/**
 * Vídeo de avatar pronto com plano de produção (roteiro escrito pelo Claude da
 * pessoa): abre o pedido de montagem para o mesmo Claude, em video_pedidos. O
 * editor prepara transcrição e quadros e acorda a rotina. Nunca falha o job.
 */
async function pedirMontagemDoPlano(service: Service, job: Job): Promise<void> {
  const cfg = job.config as { avatar_video?: { plano?: unknown } };
  const plano = planoDoJob(cfg.avatar_video?.plano);
  if (!plano) return;
  // já aberto: finishJob roda de novo em retomadas, e o pedido não pode duplicar
  if ((job.artifacts as { montagem?: { edit_id?: string } }).montagem?.edit_id) return;
  try {
    const chave = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const { data: secret } = await service.rpc('get_vault_secret', { _name: 'VIDEO_CRON_SECRET' });
    const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/video-edit`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', authorization: `Bearer ${chave}`, apikey: chave,
        'x-cron-secret': typeof secret === 'string' ? secret : '',
      },
      body: JSON.stringify({ action: 'plan', via: 'connector', source: { job_id: job.id }, request: planoEmTexto(plano), plano }),
    });
    const dados = await r.json().catch(() => ({})) as { edit_id?: string; message?: string };
    const montagem = r.ok ? { edit_id: dados.edit_id, pedido_em: new Date().toISOString() } : { erro: dados.message ?? `editor respondeu ${r.status}` };
    await service.from('director_jobs').update({ artifacts: { ...job.artifacts, montagem } }).eq('id', job.id);
    if (!r.ok) console.warn('[director] montagem do plano não abriu:', montagem);
  } catch (err) {
    console.warn('[director] montagem do plano:', err instanceof Error ? err.message : String(err));
  }
}

// ── Melhorar um vídeo meu (config.mode = 'remake') ───────────────────────────
// Mesmos status da fila (queued → videos → muxing → done), outro trilho:
//   queued  → valida o pedido e põe o vídeo enviado como "atual"
//   videos  → aplica UMA etapa por vez sobre o atual (_shared/remake.ts:
//             visual → fala → tradução), checkpoint por etapa em artifacts.remake
//   muxing  → devolve o áudio original quando só o visual mudou e entrega via a
//             montagem de legendas que o Diretor já tem (stepCaptions)

type RemakeArts = {
  remake?: {
    current: string;
    done: RemakeStage[];
    pending?: { stage: RemakeStage; id: string; submitted_at: number } | null;
    /**
     * voz da fala nova por modelo do catálogo: predição em voo e, pronto, o mp3 no
     * bucket. `stalled` = estourou o prazo uma vez; o Retomar só faz poll do mesmo id.
     */
    tts?: { id: string; submitted_at: number; path?: string; stalled?: boolean } | null;
  };
  master?: string;
  pending_asm?: Pending[];
};

function remakeConfig(job: Job): RemakeConfig {
  return ((job.config as { remake?: RemakeConfig }).remake ?? {}) as RemakeConfig;
}

/** Linha de lipsync do Replicate: a escolhida, ou o primário de lipsync_post; null se não houver. */
async function replicateLipsyncEntry(service: Service, modelId: string | null | undefined): Promise<VideoModelEntry | null> {
  try {
    return await resolveModel(service, 'lipsync_post', modelId || undefined);
  } catch (err) {
    if (err instanceof CatalogError) {
      if (modelId) throw new Error('Nenhum modelo de lipsync ativo no catálogo. Ative um em Config → Integrações → Replicate e clique em "Retomar do checkpoint".');
      return null;
    }
    throw err;
  }
}

async function stepRemakeStart(service: Service, job: Job) {
  const cfg = remakeConfig(job);
  const captions = (job.config as { captions?: boolean }).captions === true;
  const problem = validateRemake(cfg, { hasCaptions: captions });
  if (problem) throw new Error(problem);
  const arts = job.artifacts as RemakeArts;
  arts.remake = arts.remake ?? { current: cfg.source_path, done: [], pending: null };
  await transition(service, job, { status: 'videos', artifacts: arts });
}

/** Frase de cena em português → instrução curta em inglês; na falha, segue crua. */
async function sceneInEnglish(scene: string): Promise<string | null> {
  try {
    const r = await chat({
      role_hint: 'generator',
      max_tokens: 200,
      messages: [
        {
          role: 'system',
          content:
            'Translate the user request into ONE short English video-editing instruction. ' +
            'Output only the instruction, no quotes.',
        },
        { role: 'user', content: scene },
      ],
    });
    const text = r.content.trim().replace(/^"|"$/g, '');
    return text || null;
  } catch {
    return null;
  }
}

async function brandColors(service: Service): Promise<string[]> {
  const { data } = await service.from('brand_kit').select('content').eq('status', 'active').maybeSingle();
  const raw = JSON.stringify((data as { content?: unknown } | null)?.content ?? {});
  return [...new Set(raw.match(/#[0-9a-fA-F]{6}\b/g) ?? [])].slice(0, 4);
}

/**
 * Fotos (URLs assinadas, 1 a `max`) do Apresentador escolhido no "Trocar a
 * pessoa": retrato + fotos do cadastro (bucket brand-assets), sem repetir;
 * cadastro antigo do Higgsfield como fallback enquanto houver legado.
 */
async function identityReferences(service: Service, identityId: string, max: number): Promise<string[]> {
  const limit = Math.max(1, Math.min(3, max));
  const { data: presenter } = await service
    .from('brand_avatars')
    .select('reference_image_path, identity_pack_paths')
    .eq('id', identityId)
    .maybeSingle();
  const row = presenter as { reference_image_path?: string | null; identity_pack_paths?: string[] | null } | null;
  const own = [...new Set([row?.reference_image_path, ...(row?.identity_pack_paths ?? [])]
    .filter((x): x is string => typeof x === 'string' && x.length > 0))].slice(0, limit);
  if (own.length) return await Promise.all(own.map((path) => sign(service, path, 21600, PRESENTER_BUCKET)));

  const { data } = await service
    .from('director_identities')
    .select('image_paths')
    .eq('id', identityId)
    .maybeSingle();
  const legacy = ((data as { image_paths?: string[] } | null)?.image_paths ?? []).slice(0, limit);
  if (!legacy.length) throw new Error('O apresentador escolhido não tem foto. Escolha outro em Apresentadores.');
  return await Promise.all(legacy.map((path) => sign(service, path, 21600)));
}

/**
 * Trocar a pessoa (capability person_swap, ex.: prunaai/p-video-replace): o
 * vídeo atual + 1 a 3 fotos do Apresentador. O modelo devolve com o áudio
 * original. Modelo fora do catálogo/inativo → frase com o que fazer.
 */
async function submitPersonSwap(service: Service, job: Job, cfg: RemakeConfig, currentUrl: string): Promise<string> {
  const token = await replicateToken(service);
  let entry: VideoModelEntry;
  try {
    entry = await resolveModel(service, 'person_swap', cfg.person_model_id ?? undefined);
  } catch (err) {
    if (err instanceof CatalogError) {
      throw new Error(
        'Trocar a pessoa precisa de um modelo de troca de pessoa ativo no catálogo (prunaai/p-video-replace). ' +
        'Ative-o em Config → Integrações → Replicate e clique em "Retomar do checkpoint".',
      );
    }
    throw err;
  }
  const resolution = fitResolution(entry.limits, '1080p');
  const instruction = (cfg.character_prompt ?? '').trim().slice(0, 500);
  const refs = await identityReferences(service, cfg.character_identity_id as string, entry.limits.max_refs ?? 3);
  const input = renderInputTemplate(entry.input_template, {
    video_url: currentUrl,
    reference_urls: refs,
    // modelos de uma foto só (wan animate-replace: character_image) usam a primeira
    reference_url: refs[0],
    prompt: instruction || undefined,
    resolution,
  });
  const missing = missingRequiredInputs(entry, input);
  if (missing.length) {
    throw new Error(
      `O modelo ${entry.model_id} exige ${missing.join(', ')} e o catálogo não preenche. ` +
      'Rode "Verificar modelos" em Config → Integrações → Replicate.',
    );
  }
  const prediction = await createCatalogPrediction(service, job, token, entry, input, {
    duration_s: cfg.duration_s,
    resolution,
  });
  return prediction.id;
}

async function submitRemakeStage(
  service: Service, job: Job, stage: RemakeStage, currentUrl: string, ttsPath?: string | null,
): Promise<string> {
  const cfg = remakeConfig(job);
  if (stage === 'person') return await submitPersonSwap(service, job, cfg, currentUrl);
  if (stage === 'visual') {
    const token = await replicateToken(service);
    // o modelo escolhido na lista da tela; sem escolha, o primário do catálogo
    const entry = await resolveModel(service, 'scene_v2v', cfg.scene_model_id ?? undefined);
    const prompt = buildVisualPrompt(cfg, {
      sceneEnglish: cfg.scene ? await sceneInEnglish(cfg.scene) : null,
      brandColors: cfg.style === 'marca' ? await brandColors(service) : [],
    });
    // a pessoa troca na etapa 'person' (person_swap); aqui só estilo e cena
    const input = renderInputTemplate(entry.input_template, {
      prompt,
      video_url: currentUrl,
      duration_int: Math.ceil(cfg.duration_s),
      duration_ms: Math.ceil(cfg.duration_s) * 1000,
    });
    const missing = missingRequiredInputs(entry, input);
    if (missing.length) {
      throw new Error(
        `O modelo ${entry.model_id} exige ${missing.join(', ')} e o catálogo não preenche. ` +
        'Rode "Verificar modelos" em Config → Integrações → Replicate.',
      );
    }
    const prediction = await createCatalogPrediction(service, job, token, entry, input, {
      duration_s: cfg.duration_s,
    });
    return prediction.id;
  }
  if (stage === 'speech') {
    // Lipsync: HeyGen (como sempre) ou, sem a chave HeyGen ou com
    // lipsync_model_id escolhido, a linha lipsync_post do Replicate.
    const key = await heygenKeyOrNull(service);
    const rpLipsync = cfg.lipsync_model_id || !key ? await replicateLipsyncEntry(service, cfg.lipsync_model_id) : null;
    if (!key && !rpLipsync) throw new NotConnectedError('heygen', HEYGEN_NOT_CONNECTED);
    /** foto que fala (fala maior que o vídeo): só HeyGen */
    const talkingPhoto = async (audioPath: string): Promise<string> => {
      if (!key) throw new Error(speechNeedsHeygenError(Number(cfg.duration_s) || 0));
      const videoId = await heygenCreateImageVideo(
        key,
        await sign(service, cfg.speech_frame_path as string, 21600),
        await sign(service, audioPath, 21600),
      );
      return `img:${videoId}`;
    };
    // voz do catálogo (Replicate, por letra): já veio pronta de ensureRemakeTts;
    // voz da marca (ElevenLabs): síncrona, como sempre
    let path = ttsPath ?? null;
    // voz do catálogo (ttsPath pronto): não dá para medir o mp3 aqui; se a tela
    // mandou o quadro, é porque a fala não cabe no vídeo → foto que fala direto
    if (path && cfg.speech_frame_path) return await talkingPhoto(path);
    if (path && !cfg.speech_frame_path) {
      // voz do catálogo sem quadro: mede o mp3 antes de pagar o lipsync, como no
      // ElevenLabs (o MiniMax é pedido em mp3 CBR de 128 kbps no template)
      const mp3 = await downloadRestoring(service, BUCKET, path).catch(() => null);
      const problem = speechMismatchError(
        mp3 ? estimateMp3DurationSeconds(mp3.size, 128_000) : 0,
        Number(cfg.duration_s) || 0,
      );
      if (problem) throw new Error(problem);
    }
    if (!path) {
      // Ordem: a voz salva do job (remake.brand_voice_id) → "a minha voz"
      // (clone ElevenLabs; recusado → clone HeyGen temporário; sem ele → a voz do
      // gênero) → Voice ID colado → a voz da marca (brand_voices padrão,
      // ELEVEN_VOICE_ID, regra por gênero).
      const text = (cfg.speech ?? '').trim();
      let speech: SpeechResult;
      const jobVoice = await jobBrandVoice(service, cfg.brand_voice_id);
      if (jobVoice) {
        speech = await speak(service, text, jobVoice);
      } else if (cfg.voice_gender === 'own' && cfg.voice_sample_path) {
        let cloned: string | null = null;
        let ivcError: unknown = null;
        try {
          cloned = await cloneVoice(service, cfg.voice_sample_path, `remake-${job.id.slice(0, 8)}`);
        } catch (err) {
          ivcError = err;
        }
        if (cloned) {
          try {
            speech = await speak(service, text, { provider: 'elevenlabs', voice_id: cloned });
          } finally {
            await deleteVoice(service, cloned);
          }
        } else {
          console.warn('[remake] clone ElevenLabs indisponível:', errText(ivcError));
          const viaHeygen = await heygenTempCloneSpeech(service, job, cfg, text)
            .catch((e) => { console.warn('[remake] clone HeyGen temporário:', errText(e)); return null; });
          if (viaHeygen) {
            speech = viaHeygen;
            (job.artifacts as { voice_note?: string }).voice_note =
              'O plano do ElevenLabs não clona voz; clonamos a sua voz pela HeyGen só para este vídeo e apagamos depois.';
            await patch(service, job.id, { artifacts: job.artifacts });
          } else {
            // plano sem clone / chave sem permissão: usa a voz do gênero que a
            // pessoa informou na tela — o vídeo sai, e o cartão diz por quê
            const fallback = cfg.person_gender === 'female' || cfg.person_gender === 'male' ? cfg.person_gender : null;
            if (!fallback) throw ivcError;
            (job.artifacts as { voice_note?: string }).voice_note =
              'Não deu para clonar a sua voz (o plano do ElevenLabs não inclui clone); usamos uma voz ' +
              (fallback === 'female' ? 'feminina' : 'masculina') + ' da marca.';
            await patch(service, job.id, { artifacts: job.artifacts });
            speech = await speak(service, text, await narrationVoiceRef(service, fallback));
          }
        }
      } else if (cfg.voice_gender === 'custom' && cfg.voice_id && /^[A-Za-z0-9]{10,40}$/.test(cfg.voice_id)) {
        // Voice ID do ElevenLabs colado na tela (voz da biblioteca ou da conta)
        speech = await speak(service, text, { provider: 'elevenlabs', voice_id: cfg.voice_id });
      } else {
        const gender = cfg.voice_gender === 'female' || cfg.voice_gender === 'male' ? cfg.voice_gender : undefined;
        speech = await speak(service, text, await narrationVoiceRef(service, gender));
      }
      const bytes = speech.bytes;
      // HeyGen lipsync recusa áudio e vídeo com mais de 15% de diferença
      // (duration_mismatch). Mede ANTES de pagar (MP3 128 kbps CBR; voz do
      // catálogo HeyGen: a duração devolvida): não cabe → "foto que fala" a
      // partir do quadro do vídeo, que aceita qualquer duração; sem o quadro,
      // para com a explicação.
      const speechS = speech.mp3_128
        ? estimateMp3DurationSeconds(bytes.byteLength, 128_000)
        : (speech.duration_s ?? estimateMp3DurationSeconds(bytes.byteLength, 128_000));
      const mismatch = speechMismatchError(speechS, Number(cfg.duration_s) || 0);
      path = `director/${job.id}/remake-speech.mp3`;
      await putObject(service, path, bytes, speech.content_type);
      if (mismatch) {
        if (!cfg.speech_frame_path) throw new Error(mismatch);
        return await talkingPhoto(path);
      }
    }
    if (rpLipsync) {
      // "rp:" = lipsync pelo Replicate (checkRemakeStage faz o poll lá)
      const token = await replicateToken(service);
      const input = renderInputTemplate(rpLipsync.input_template, {
        video_url: currentUrl,
        audio_url: await sign(service, path, 21600),
      });
      const missing = missingRequiredInputs(rpLipsync, input);
      if (missing.length) {
        throw new Error(
          `O modelo ${rpLipsync.model_id} exige ${missing.join(', ')} e o catálogo não preenche. ` +
          'Rode "Verificar modelos" em Config → Integrações → Replicate.',
        );
      }
      const prediction = await createCatalogPrediction(service, job, token, rpLipsync, input, {
        duration_s: Number(cfg.duration_s) || 0,
      });
      return `rp:${prediction.id}`;
    }
    return await heygenCreateLipsync(key as string, currentUrl, await sign(service, path, 21600));
  }
  const key = await heygenKey(service);
  const language = LANGUAGES[cfg.translate ?? '']?.heygen;
  if (!language) throw new Error('Idioma de tradução inválido. Escolha de novo em Vídeos → Novo.');
  return await heygenCreateTranslation(key, currentUrl, language);
}

/** Espera do clone HeyGen temporário do remake (o doc da HeyGen fala em segundos). */
const REMAKE_HEYGEN_CLONE_WAIT_MS = 30_000;

/**
 * "A minha voz" sem IVC do ElevenLabs: clone instantâneo HeyGen da amostra do
 * próprio vídeo, fala por /v3/models/audio/tts (MP3 128 kbps) e apaga o clone
 * no fim, com ou sem erro. null = HeyGen não conectada (quem chama cai na voz
 * do gênero, como antes).
 */
async function heygenTempCloneSpeech(
  service: Service, job: Job, cfg: RemakeConfig, text: string,
): Promise<SpeechResult | null> {
  const key = await heygenKeyOrNull(service);
  if (!key || !cfg.voice_sample_path) return null;
  const voiceId = await heygenCloneVoice(key, {
    name: `remake-${job.id.slice(0, 8)}`,
    url: await sign(service, cfg.voice_sample_path, 3600),
    gender: cfg.person_gender ?? null,
  }, idempotencyKey(job.id, 'remake_voice', crypto.randomUUID().slice(0, 8)));
  try {
    const deadline = Date.now() + REMAKE_HEYGEN_CLONE_WAIT_MS;
    for (;;) {
      const v = await heygenModelVoice(key, voiceId);
      if (v.status === 'ACTIVE') break;
      if (v.status === 'FAILED') throw new Error(heygenCloneFailure(v.failure_reason));
      if (Date.now() > deadline) throw new Error('o clone HeyGen não ficou pronto a tempo');
      await new Promise((r) => setTimeout(r, 2_000));
    }
    return await speak(service, text, { provider: 'heygen', voice_id: voiceId, heygen_model: true });
  } finally {
    await heygenDeleteModelVoice(key, voiceId).catch((e) => console.warn('[remake] apagar clone HeyGen:', errText(e)));
  }
}

/**
 * Fala nova por um modelo de voz do catálogo (MiniMax speech-*): submete a
 * predição e guarda o id em arts.remake.tts (como a etapa visual); o tick
 * seguinte faz poll e salva o mp3 no bucket. Nunca descarta o id — o Retomar
 * não paga de novo. A voz é a do apresentador padrão (brand_avatars.voice.
 * voice_id); sem apresentador, uma voz pt-BR do modelo.
 */
async function submitRemakeTts(service: Service, job: Job, text: string, modelId: string): Promise<string> {
  const token = await replicateToken(service);
  const tts = await resolveModel(service, 'tts', modelId);
  const { data: presenter } = await service
    .from('brand_avatars')
    .select('voice')
    .eq('is_default', true)
    .eq('status', 'active')
    .maybeSingle();
  const voice = ((presenter as { voice?: { voice_id?: string } } | null)?.voice ?? {}) as { voice_id?: string };
  // o gênero escolhido na tela manda: a voz do apresentador padrão só vale sem escolha
  const gender = remakeConfig(job).voice_gender;
  const voiceId = gender === 'male'
    ? 'Portuguese_CalmLeader'
    : gender === 'female'
      ? 'Portuguese_ConfidentWoman'
      : typeof voice.voice_id === 'string' && voice.voice_id ? voice.voice_id : 'Portuguese_ConfidentWoman';
  const input = renderInputTemplate(tts.input_template, {
    text,
    voice_id: voiceId,
    language_boost: 'Portuguese',
    bitrate: 128000,
  });
  const prediction = await createCatalogPrediction(service, job, token, tts, input, { chars: text.length });
  return prediction.id;
}

/**
 * Garante o mp3 da fala nova quando a voz vem do catálogo: submete se ainda não
 * há predição, faz poll se há, salva no bucket quando termina. Devolve o path
 * pronto ou null (ainda rodando — próximo tick). Com fala pronta no bucket,
 * devolve direto: o retry nunca gera a voz de novo.
 */
async function ensureRemakeTts(
  service: Service, job: Job, state: NonNullable<RemakeArts['remake']>, cfg: RemakeConfig,
): Promise<string | null> {
  if (state.tts?.path) return state.tts.path;
  if (!state.tts?.id) {
    const id = await submitRemakeTts(service, job, (cfg.speech ?? '').trim(), cfg.tts_model_id as string);
    state.tts = { id, submitted_at: Date.now() };
    return null;
  }
  // Prazo igual ao das outras etapas; estourar NÃO descarta o id (a predição
  // foi paga): marca e pede o Retomar, que volta aqui e só faz poll.
  if (!state.tts.stalled && Date.now() - state.tts.submitted_at > PENDING_DEADLINE_MS * 2) {
    state.tts = { ...state.tts, stalled: true };
    throw new Error('A voz da fala nova demorou demais. Clique em "Retomar do checkpoint".');
  }
  let url: string | null;
  try {
    url = await replicateCheck(await replicateToken(service), state.tts.id);
  } catch (err) {
    // só aqui a predição falhou de fato (ou o token sumiu): o retry submete outra
    if (!(err instanceof NotConnectedError)) state.tts = null;
    throw err;
  }
  if (!url) return null;
  const path = `director/${job.id}/remake-speech.mp3`;
  await streamToBucket(service, url, BUCKET, path, 'audio/mpeg', 20 * 1024 * 1024);
  state.tts = { ...state.tts, path };
  return path;
}

/** url quando a etapa terminou; null enquanto roda; erro quando falhou. */
async function checkRemakeStage(service: Service, stage: RemakeStage, id: string): Promise<string | null> {
  if (stage === 'visual' || stage === 'person') return await replicateCheck(await replicateToken(service), id);
  // "rp:" = lipsync da fala nova pelo Replicate
  if (stage === 'speech' && id.startsWith('rp:')) return await replicateCheck(await replicateToken(service), id.slice(3));
  const key = await heygenKey(service);
  // "img:" = fala longa feita como foto que fala (POST /v3/videos type image)
  if (stage === 'speech' && id.startsWith('img:')) {
    return heygenResult(await heygenGetVideo(key, id.slice(4)), 'a foto que fala');
  }
  return stage === 'speech'
    ? heygenResult(await heygenGetLipsync(key, id), 'o lipsync da fala nova')
    : heygenResult(await heygenGetTranslation(key, id), 'a tradução');
}

async function stepRemakeWork(service: Service, job: Job) {
  const cfg = remakeConfig(job);
  const arts = job.artifacts as RemakeArts;
  const state = arts.remake ?? { current: cfg.source_path, done: [], pending: null };
  arts.remake = state;

  if (state.pending) {
    const p = state.pending;
    let url: string | null;
    try {
      // confere ANTES do prazo: resultado pago que chegou tarde é aproveitado
      url = await checkRemakeStage(service, p.stage, p.id);
    } catch (err) {
      state.pending = null; // retomar refaz só esta etapa
      await patch(service, job.id, { artifacts: arts });
      throw err;
    }
    if (!url && Date.now() - p.submitted_at > REMAKE_DEADLINE_MS) {
      // Replicate (visual/person) cobra enquanto roda: cancela antes de desistir
      if (p.stage === 'visual' || p.stage === 'person') {
        await cancelPrediction(await replicateToken(service), p.id).catch((e) => console.error('cancel remake:', errText(e)));
      }
      state.pending = null;
      await patch(service, job.id, { artifacts: arts });
      throw new Error('A etapa demorou demais e foi interrompida. Clique em "Retomar do checkpoint".');
    }
    if (!url) return; // ainda rodando — próximo tick
    const path = `director/${job.id}/remake-${p.stage}.mp4`;
    if (p.stage === 'visual' || p.stage === 'person') await saveReplicateClip(service, url, path);
    else await streamToBucket(service, url, BUCKET, path, 'video/mp4', 400 * 1024 * 1024);
    state.current = path;
    state.done = [...state.done, p.stage];
    state.pending = null;
    await patch(service, job.id, { artifacts: arts });
    return;
  }

  const stage = nextRemakeStage(cfg, state.done);
  if (!stage) {
    await transition(service, job, { status: 'muxing', artifacts: arts });
    return;
  }
  // fala nova com voz do catálogo: primeiro o mp3 (assíncrono), depois o lipsync
  let ttsPath: string | null = null;
  if (stage === 'speech' && cfg.tts_model_id) {
    try {
      ttsPath = await ensureRemakeTts(service, job, state, cfg);
    } finally {
      await patch(service, job.id, { artifacts: arts });
    }
    if (!ttsPath) return;
  }
  const id = await submitRemakeStage(service, job, stage, await sign(service, state.current, 21600), ttsPath);
  state.pending = { stage, id, submitted_at: Date.now() };
  await patch(service, job.id, { artifacts: arts });
}

async function stepRemakeFinish(service: Service, job: Job) {
  const cfg = remakeConfig(job);
  const arts = job.artifacts as RemakeArts & { final?: string };
  if (arts.final) { await finishJob(service, job); return; }
  if (arts.master) { await stepCaptions(service, job); return; }
  const current = arts.remake?.current ?? cfg.source_path;
  const masterPath = `director/${job.id}/master.mp4`;

  if (!needsOriginalAudio(cfg)) {
    await ensureLocal(service, BUCKET, current);
    await service.storage.from(BUCKET).remove([masterPath]).catch(() => {});
    const { error } = await service.storage.from(BUCKET).copy(current, masterPath);
    if (error) throw new Error(`copy remake→master: ${error.message}`);
    arts.master = masterPath;
    await patch(service, job.id, { artifacts: arts });
    return;
  }

  // O vídeo→vídeo devolve sem som: o áudio do vídeo enviado volta por cima.
  // Com o Higgsfield conectado, o ffmpeg do sandbox (de graça, corta pelo mais
  // curto com -shortest). Sem ele, o util_audio_merge do Replicate
  // (lucataco/video-audio-merge). Conferido no predict.py do modelo
  // (github.com/lucataco/cog-video-audio-merge): `audio_file` vai direto para
  // `ffmpeg.input(...)` e só o stream de áudio (`['a']`) é usado — o MP4
  // original serve como fonte de áudio sem extrair antes; `duration_mode=video`
  // vira `-shortest`, a mesma regra do sandbox (o Aleph pode devolver duração
  // um pouco diferente; nada sobra depois do último quadro). O checkpoint é o
  // mesmo nos dois caminhos: arts.master gravado = merge feito, o retry não refaz.
  if (!arts.pending_asm?.length) {
    if (!(await hfConnected(service))) {
      const token = await replicateToken(service);
      const merge = await resolveModel(service, 'util_audio_merge');
      const input = {
        ...renderInputTemplate(merge.input_template, {
          video_url: await sign(service, current, 7200),
          audio_url: await sign(service, cfg.source_path, 7200),
        }),
        duration_mode: 'video',
      };
      const prediction = await createCatalogPrediction(service, job, token, merge, input, {});
      arts.pending_asm = [{ rp_id: prediction.id, submitted_at: Date.now() }];
      await patch(service, job.id, { artifacts: arts });
      return;
    }
    const cmd = [
      'set -euo pipefail',
      'rm -rf /tmp/remake && mkdir -p /tmp/remake && cd /tmp/remake',
      `curl -fsS -o video.mp4 '${await sign(service, current, 7200)}'`,
      `curl -fsS -o source.mp4 '${await sign(service, cfg.source_path, 7200)}'`,
      'ffmpeg -y -i video.mp4 -i source.mp4 -map 0:v:0 -map 1:a:0? -c:v libx264 -preset veryfast -crf 19 ' +
        '-c:a aac -b:a 192k -shortest -movflags +faststart master.mp4',
      '[ -s master.mp4 ]',
      `code=$(curl -sS -X PUT -H 'Content-Type: video/mp4' -H 'x-upsert: true' --data-binary @master.mp4 -w '%{http_code}' -o /dev/null '${await signUpload(service, masterPath)}'); [ "$code" = "200" ] || { echo "upload:$code"; exit 1; }`,
      'echo REMAKE_AUDIO_OK',
    ].join('\n');
    const out = await mcp(service, 'sandbox_exec', { command: cmd, background: true });
    const log = out.match(/Combined output:\s*(\S+)/)?.[1];
    const exit = out.match(/Exit status \(written when done\):\s*(\S+)/)?.[1];
    if (!log || !exit) throw new Error(`sandbox background sem log/exit: ${out.slice(0, 200)}`);
    arts.pending_asm = [{ log, exit, submitted_at: Date.now() }];
    await patch(service, job.id, { artifacts: arts });
    return;
  }
  const p = arts.pending_asm[0];
  if (p.submitted_at && Date.now() - p.submitted_at > PENDING_DEADLINE_MS) {
    arts.pending_asm = [];
    await patch(service, job.id, { artifacts: arts });
    throw new Error('Devolver o áudio original estourou o prazo. Clique em "Retomar do checkpoint".');
  }
  if (p.rp_id) {
    // caminho Replicate: poll da predição; pronto → master no bucket
    let url: string | null;
    try {
      url = await replicateCheck(await replicateToken(service), p.rp_id);
    } catch (err) {
      arts.pending_asm = [];
      await patch(service, job.id, { artifacts: arts });
      throw err;
    }
    if (!url) return;
    await saveReplicateClip(service, url, masterPath);
    arts.pending_asm = [];
    arts.master = masterPath;
    await patch(service, job.id, { artifacts: arts });
    return;
  }
  const out = await mcp(service, 'sandbox_exec', {
    command: `if [ -f ${p.exit} ]; then echo "EXITCODE:$(cat ${p.exit})"; fi; tail -n 20 ${p.log} 2>/dev/null`,
    timeout_seconds: 30,
  });
  const code = out.match(/EXITCODE:(\d+)/)?.[1];
  if (code == null) return;
  arts.pending_asm = [];
  if (code !== '0' || !out.includes('REMAKE_AUDIO_OK')) {
    await patch(service, job.id, { artifacts: arts });
    throw new Error(`devolver o áudio original falhou (exit ${code}): ${out.slice(-400)}`);
  }
  arts.master = masterPath;
  await patch(service, job.id, { artifacts: arts });
}

// ── Avatar fala o roteiro (config.mode = 'avatar_video') e Video Agent ('video_agent') ──
// Contrato: docs/hub-motor-contratos.md §1-§4. Mesmos status da fila:
//   avatar_video: queued (valida, resolve o apresentador, espera o avatar HeyGen
//                 ficar pronto) → tts (voz ElevenLabs, se for ela) → videos
//                 (POST /v3/videos ou talking_avatar do Replicate; poll) → muxing
//   video_agent:  queued (apresentador + brand kit) → videos (sessão → vídeo) → muxing
// O "Retomar" da tela volta estes modos para 'queued' (não há arts.tts/videos):
// o passo de entrada pula direto para onde o job parou, sem pagar de novo.
// Idempotency-Key = <job>:<etapa>:<tentativa>; a tentativa só sobe depois de
// uma falha real, então o retry de rede reaproveita a mesma criação.

type LanePending = { provider: 'heygen' | 'replicate'; id: string; submitted_at: number; stalled?: boolean };
type AvatarState = {
  look_id?: string;
  look_type?: string;
  look_gender?: string | null;
  engines?: string[];
  engine?: string | null;
  voice_id?: string | null;
  /** voz decidida na entrada (job → heygen_voice do avatar → padrão) */
  voice_provider?: 'elevenlabs' | 'heygen';
  eleven_voice_id?: string | null;
  voice_source?: 'job' | 'avatar' | 'default';
  /** voz salva que fala como áudio (clone HeyGen Voice ou outra HeyGen na rota de áudio) */
  speech_voice?: VoiceRef | null;
  presenter_id?: string | null;
  audio_path?: string;
  audio_s?: number;
  pending?: LanePending | null;
  attempt?: number;
  busy_since?: number | null;
  wait_since?: number | null;
  video_id?: string;
  duration_s?: number | null;
  result_path?: string;
  captions_by?: 'heygen' | 'sandbox' | null;
  captions_note?: string;
};
type AgentState = {
  avatar_id?: string | null;
  /** voz HeyGen decidida na entrada (job → heygen_voice do avatar) */
  voice_id?: string | null;
  voice_default?: string | null;
  brand_kit_id?: string | null;
  brand_kit_note?: string;
  session_id?: string | null;
  session_status?: string;
  progress?: number;
  video_id?: string | null;
  submitted_at?: number;
  stalled?: boolean;
  attempt?: number;
  busy_since?: number | null;
  wait_since?: number | null;
  duration_s?: number | null;
  result_path?: string;
  captions_by?: 'sandbox' | null;
  captions_note?: string;
};
type LaneArts = { avatar?: AvatarState; agent?: AgentState; master?: string; final?: string };

const HEYGEN_VIDEO_DEADLINE_MS = 40 * 60_000;
/** o Video Agent leva de 5 a 10× a duração final */
const HEYGEN_AGENT_DEADLINE_MS = 60 * 60_000;
const HEYGEN_BUSY_MAX_MS = 20 * 60_000;

const avatarCfg = (job: Job) => ((job.config as { avatar_video?: AvatarVideoConfig }).avatar_video ?? {}) as AvatarVideoConfig;
const agentCfg = (job: Job) => ((job.config as { video_agent?: VideoAgentConfig }).video_agent ?? {}) as VideoAgentConfig;
const laneCaptions = (job: Job) => (job.config as { captions?: boolean }).captions === true;

/** Erro de rede, 429 ou 5xx no GET da HeyGen: o job/vídeo segue lá — tenta no próximo tick. */
function heygenTransient(err: unknown): boolean {
  const status = heygenStatus(err);
  // 409: request_in_progress / resource_not_ready — a HeyGen pede para esperar
  if (status != null) return status === 409 || status === 429 || status >= 500;
  return !(err instanceof HeygenError) && !(err instanceof NotConnectedError);
}

/** Erro da HeyGen → frase; 404 de look vira "apresentador não existe". */
function laneHeygenError(err: unknown): Error {
  if (heygenStatus(err) === 404) {
    return new Error('O apresentador escolhido não existe mais na HeyGen. Escolha outro e crie o vídeo de novo.');
  }
  return heygenHumanError(err);
}

/** 429 na criação: espera o próximo tick até o teto, depois falha com a frase. */
async function heygenWaitBusy(service: Service, job: Job, st: { busy_since?: number | null }, err: unknown) {
  st.busy_since ??= Date.now();
  if (Date.now() - st.busy_since > HEYGEN_BUSY_MAX_MS) {
    st.busy_since = null;
    await patch(service, job.id, { artifacts: job.artifacts });
    throw heygenHumanError(err);
  }
  await patch(service, job.id, { artifacts: job.artifacts });
}

type HeygenTarget = { look: HeygenLook; voice: string | null; presenter: Presenter | null; ref: HeygenRef | null };

/** Apresentador da marca dono de um grupo HeyGen (para a voz padrão dele); null se for da biblioteca. */
async function presenterOfGroup(service: Service, groupId: string | null): Promise<Presenter | null> {
  if (!groupId) return null;
  const { data } = await service.from('brand_avatars').select('*')
    .eq('provider_refs->heygen->>group_id', groupId).limit(1);
  return ((data ?? []) as Presenter[])[0] ?? null;
}

/** Espera o avatar ficar pronto (até 30 min); estourou → erro com a saída. */
function waitHeygen(st: { wait_since?: number | null }): null {
  st.wait_since ??= Date.now();
  if (Date.now() - st.wait_since > IDENTITY_WAIT_MAX_MS) {
    st.wait_since = null;
    throw new Error('O avatar ainda não ficou pronto na HeyGen. Confira em Apresentadores e clique em "Retomar".');
  }
  return null;
}

/**
 * Look HeyGen do pedido: a da biblioteca (look_id), o avatar HeyGen do
 * apresentador (presenter_id) ou um visual dele (presenter_id + look_id, entre
 * a look principal e provider_refs.heygen.looks[]). Espera até 30 min o avatar
 * ou o visual ficar pronto. null = esperar.
 */
async function resolveHeygenLook(
  service: Service, key: string, st: { wait_since?: number | null },
  lookId: string | null | undefined, presenterId: string | null | undefined,
): Promise<HeygenTarget | null> {
  try {
    if (!presenterId) {
      const look = await getLook(key, lookId as string);
      if (look.status === 'failed') throw new Error(`O avatar "${look.name}" falhou na HeyGen. Escolha outro.`);
      const owner = await presenterOfGroup(service, look.group_id).catch(() => null);
      return { look, voice: look.default_voice_id, presenter: owner, ref: owner ? heygenRefOf(owner.provider_refs) : null };
    }
    const p = await loadPresenter(service, presenterId);
    if (!p) throw new Error('O apresentador escolhido não existe mais. Escolha outro e crie o vídeo de novo.');
    const ref = heygenRefOf(p.provider_refs);
    if (!ref) {
      throw new Error(
        `O apresentador "${p.name}" ainda não tem avatar na HeyGen. Crie em Apresentadores ` +
        '(Foto vira apresentador ou Meu clone) e clique em "Retomar".',
      );
    }
    if (lookId && !lookBelongsTo(ref, lookId)) {
      throw new Error(`Esse visual não é de "${p.name}". Escolha um dos visuais dele e crie o vídeo de novo.`);
    }
    const { ref: now, look: main } = await refreshHeygenRef(service, key, p.id, ref);
    if (now.status === 'failed') {
      throw new Error(`O avatar "${p.name}" falhou no preparo da HeyGen (${now.error ?? 'sem motivo'}). Crie de novo em Apresentadores.`);
    }
    if (now.consent_status === 'rejected') {
      throw new Error(`A autorização do clone "${p.name}" foi recusada. Gere um novo link em Apresentadores e clique em "Retomar".`);
    }
    if (!now.ready) return waitHeygen(st);
    let look = main;
    if (lookId && lookId !== now.look_id) {
      look = await getLook(key, lookId);
      if (look.status === 'failed') {
        throw new Error(`O visual escolhido de "${p.name}" falhou na HeyGen (${look.error ?? 'sem motivo'}). Escolha outro.`);
      }
      if (look.status && look.status !== 'completed') return waitHeygen(st);
    }
    st.wait_since = null;
    return { look, voice: now.default_voice_id ?? look.default_voice_id, presenter: p, ref: now };
  } catch (err) {
    throw heygenStatus(err) != null ? laneHeygenError(err) : err;
  }
}

/** Voz da lane: a decidida na entrada; job antigo (sem a decisão gravada) segue a config. */
function laneVoiceProvider(cfg: AvatarVideoConfig, st: AvatarState): 'elevenlabs' | 'heygen' {
  return st.voice_provider ?? (cfg.voice?.provider === 'heygen' ? 'heygen' : 'elevenlabs');
}

/** Custo HeyGen pela linha do catálogo (provider heygen); sem linha, só os segundos. */
async function recordHeygenCost(
  service: Service, job: Job, capability: 'avatar_video' | 'video_agent', modelId: string, seconds: number,
  resolution?: string,
) {
  const costs = job.costs as { heygen_seconds?: number; heygen_usd_est?: number | null };
  costs.heygen_seconds = Number(((costs.heygen_seconds ?? 0) + Math.max(0, seconds)).toFixed(1));
  let entry: VideoModelEntry | null = null;
  try {
    entry = await resolveModel(service, capability, modelId, 'heygen');
  } catch {
    entry = await resolveModel(service, capability, null, 'heygen').catch(() => null);
  }
  costs.heygen_usd_est = entry
    ? Number(((costs.heygen_usd_est ?? 0) + estimateCostUsd(entry, { duration_s: seconds, resolution })).toFixed(4))
    : (costs.heygen_usd_est ?? null);
  await patch(service, job.id, { costs: job.costs });
}

/** Voz ElevenLabs do vídeo de avatar: a do pedido, a do apresentador, a da marca pelo gênero. */
async function avatarElevenVoice(
  service: Service, cfg: AvatarVideoConfig, lookGender?: string | null, presenterId?: string | null,
): Promise<string> {
  const explicit = (cfg.voice?.voice_id ?? '').trim();
  if (ELEVEN_VOICE_ID_RE.test(explicit)) {
    if (!(await elevenVoiceExists(service, explicit))) {
      throw new Error(
        `A voz da ElevenLabs escolhida (${explicit}) não existe na conta conectada. Escolha outra voz e crie o vídeo de novo.`,
      );
    }
    return explicit;
  }
  const pid = presenterId ?? cfg.presenter_id;
  const presenter = pid ? await loadPresenter(service, pid).catch(() => null) : null;
  const own = presenterElevenVoiceId(presenter?.voice);
  if (own) return own;
  const g = (presenter?.gender ?? lookGender ?? '').toLowerCase();
  return await narrationVoice(service, g === 'female' || g === 'male' ? g : undefined);
}

/**
 * Aplica a voz salva (voz do job em voice.brand_voice_id, ou a padrão de
 * brand_voices quando a lane caiu no comportamento de antes e o provedor
 * casa) ao estado da lane. Voz HeyGen do catálogo vai como voice_id; clone
 * HeyGen Voice e ElevenLabs vão como áudio (audio_url).
 */
function applyVoiceRef(st: AvatarState, ref: VoiceRef, source: 'job' | 'avatar' | 'default') {
  st.voice_source = source;
  if (ref.provider === 'heygen' && !ref.heygen_model) {
    st.voice_provider = 'heygen';
    st.voice_id = ref.voice_id;
    st.eleven_voice_id = null;
    st.speech_voice = null;
  } else {
    st.voice_provider = 'elevenlabs'; // rota de áudio
    st.voice_id = null;
    st.eleven_voice_id = ref.provider === 'elevenlabs' ? ref.voice_id : null;
    st.speech_voice = ref.provider === 'heygen' ? ref : null;
  }
}

/** Voz padrão de brand_voices que cabe no provedor escolhido pela lane; null se não houver. */
async function laneDefaultVoice(service: Service, provider: 'elevenlabs' | 'heygen'): Promise<VoiceRef | null> {
  const ref = voiceRefOf(await defaultBrandVoice(service).catch(() => null));
  if (!ref) return null;
  if (provider === 'heygen') return ref.provider === 'heygen' ? ref : null;
  return ref.provider === 'elevenlabs' ? ref : null;
}

async function stepAvatarStart(service: Service, job: Job) {
  const cfg = avatarCfg(job);
  const problem = validateAvatarVideo(cfg);
  if (problem) throw new Error(problem);
  const arts = job.artifacts as LaneArts;
  const st = (arts.avatar ??= {});
  if (arts.final || arts.master || st.result_path) return await transition(service, job, { status: 'muxing', artifacts: arts });
  if (st.pending) return await transition(service, job, { status: 'videos', artifacts: arts });
  if ((cfg.provider ?? 'heygen') === 'replicate') {
    const p = await loadPresenter(service, cfg.presenter_id as string);
    if (!p) throw new Error('O apresentador escolhido não existe mais. Escolha outro e crie o vídeo de novo.');
    if (!presenterPhotos(p).length) throw new Error(`O apresentador "${p.name}" não tem foto. Adicione uma em Apresentadores.`);
    st.look_type = 'replicate';
    st.look_gender = p.gender ?? null;
    st.presenter_id = p.id;
    // Replicate recebe áudio: ElevenLabs ou uma voz salva (que fala por speechBytes)
    const jobVoice = await jobBrandVoice(service, cfg.voice?.brand_voice_id);
    const choice = chooseAvatarVoice(cfg.voice, savedHeygenVoice(p.voice), null, null);
    const eleven = choice.provider === 'elevenlabs' ? choice : { provider: 'elevenlabs' as const, voice_id: null, source: 'default' as const };
    st.voice_provider = 'elevenlabs';
    st.eleven_voice_id = eleven.voice_id;
    st.voice_source = eleven.source;
    // voz HeyGen salva no apresentador que é clone HeyGen Voice: fala como áudio
    const avatarClone = jobVoice ? null : avatarVoiceAsClone(choice, await findBrandVoice(service, 'heygen', choice.voice_id));
    if (jobVoice) {
      st.voice_source = 'job';
      st.eleven_voice_id = jobVoice.provider === 'elevenlabs' ? jobVoice.voice_id : null;
      st.speech_voice = jobVoice.provider === 'heygen' ? jobVoice : null;
    } else if (avatarClone) {
      st.voice_source = 'avatar';
      st.eleven_voice_id = null;
      st.speech_voice = avatarClone;
    } else if (eleven.source === 'default') {
      const def = await laneDefaultVoice(service, 'elevenlabs');
      if (def) { st.eleven_voice_id = def.voice_id; st.voice_source = 'default'; }
    }
  } else {
    const key = await heygenKey(service);
    const r = await resolveHeygenLook(service, key, st, cfg.look_id, cfg.presenter_id);
    if (!r) { await patch(service, job.id, { artifacts: arts }); return; } // esperando o avatar
    st.look_id = r.look.id;
    st.look_type = r.look.avatar_type;
    st.look_gender = r.look.gender;
    st.engines = r.look.supported_api_engines;
    st.presenter_id = r.presenter?.id ?? null;
    const choice = chooseAvatarVoice(
      cfg.voice,
      savedHeygenVoice(r.presenter?.voice),
      r.ref?.type === 'digital_twin' ? r.ref.default_voice_id : null,
      r.voice,
    );
    st.voice_provider = choice.provider;
    st.voice_source = choice.source;
    st.voice_id = choice.provider === 'heygen' ? choice.voice_id : null;
    st.eleven_voice_id = choice.provider === 'elevenlabs' ? choice.voice_id : null;
    st.speech_voice = null;
    // voz salva: a do job vence tudo; a padrão de brand_voices entra só no lugar
    // do comportamento de antes, e só se casa com o provedor
    const jobVoice = await jobBrandVoice(service, cfg.voice?.brand_voice_id);
    // voz HeyGen do apresentador que é clone HeyGen Voice (brand_voices): rota de áudio
    const avatarClone = jobVoice ? null : avatarVoiceAsClone(choice, await findBrandVoice(service, 'heygen', choice.voice_id));
    if (jobVoice) applyVoiceRef(st, jobVoice, 'job');
    else if (avatarClone) applyVoiceRef(st, avatarClone, 'avatar');
    else if (choice.source === 'default') {
      const def = await laneDefaultVoice(service, choice.provider);
      if (def) applyVoiceRef(st, def, 'default');
    }
    if (st.voice_provider === 'heygen' && !st.voice_id) throw new Error('Escolha uma voz para o apresentador.');
  }
  const heygenVoice = st.voice_provider === 'heygen';
  const next = heygenVoice || st.audio_path ? 'videos' : 'tts';
  await transition(service, job, { status: next, artifacts: arts });
}

async function stepAvatarVoice(service: Service, job: Job) {
  const cfg = avatarCfg(job);
  const arts = job.artifacts as LaneArts;
  const st = (arts.avatar ??= {});
  if (!st.look_type) return await stepAvatarStart(service, job); // retomada sem a etapa de entrada
  if (!st.audio_path) {
    const voice: VoiceRef = st.speech_voice ?? {
      provider: 'elevenlabs',
      voice_id: st.eleven_voice_id || await avatarElevenVoice(service, cfg, st.look_gender, st.presenter_id),
    };
    const speech = await speak(service, (cfg.script ?? '').trim(), voice);
    const ext = /wav/.test(speech.content_type) ? 'wav' : 'mp3';
    const path = `director/${job.id}/avatar-voice.${ext}`;
    await putObject(service, path, speech.bytes, speech.content_type);
    st.audio_path = path;
    st.audio_s = Number((speech.mp3_128 ? mp3Duration(speech.bytes) : (speech.duration_s ?? mp3Duration(speech.bytes))).toFixed(2));
  }
  await transition(service, job, { status: 'videos', artifacts: arts });
}

async function submitAvatarHeygen(service: Service, job: Job, cfg: AvatarVideoConfig, st: AvatarState) {
  const key = await heygenKey(service);
  const captions = laneCaptions(job);
  const burn = captions && !(await hfConnected(service));
  st.captions_by = captions ? (burn ? 'heygen' : 'sandbox') : null;
  const heygenVoice = laneVoiceProvider(cfg, st) === 'heygen';
  const { body, engine } = buildAvatarVideoBody({
    look: { id: st.look_id as string, avatar_type: st.look_type ?? '', supported_api_engines: (st.engines ?? []) as HeygenEngine[] },
    engine: cfg.engine,
    script: heygenVoice ? falaPorExtenso((cfg.script ?? '').trim()) : null,
    voice_id: heygenVoice ? st.voice_id : null,
    audio_url: heygenVoice ? null : await sign(service, st.audio_path as string, 21600),
    aspect_ratio: cfg.aspect_ratio,
    resolution: cfg.resolution,
    motion_prompt: cfg.motion_prompt,
    burn_captions: burn,
    title: String((job.brief as { title?: unknown }).title ?? '').slice(0, 200) || null,
  });
  st.engine = engine;
  let id: string;
  try {
    id = await createAvatarVideo(key, body, idempotencyKey(job.id, 'avatar_video', st.attempt ?? 0));
  } catch (err) {
    if (heygenBusy(err)) return await heygenWaitBusy(service, job, st, err);
    throw laneHeygenError(err);
  }
  st.busy_since = null;
  st.pending = { provider: 'heygen', id, submitted_at: Date.now() };
  await patch(service, job.id, { artifacts: job.artifacts });
}

async function submitAvatarReplicate(service: Service, job: Job, cfg: AvatarVideoConfig, st: AvatarState) {
  const token = await replicateToken(service);
  let entry: VideoModelEntry;
  try {
    entry = await resolveModel(service, 'talking_avatar', cfg.model_id ?? undefined);
  } catch (err) {
    if (err instanceof CatalogError) {
      throw new Error(`${err.message} Escolha outro modelo de apresentador ou ative este em Config → Integrações → Replicate.`);
    }
    throw err;
  }
  const max = entry.limits.max_duration_s;
  if (max && (st.audio_s ?? 0) > max) {
    throw new Error(
      `O roteiro dá ${(st.audio_s ?? 0).toFixed(0)} s e este modelo aceita até ${max} s. Encurte o roteiro ou escolha outro modelo.`,
    );
  }
  const p = await loadPresenter(service, cfg.presenter_id as string);
  const photo = p ? presenterPhotos(p)[0] : null;
  if (!photo) throw new Error('O apresentador escolhido não tem foto. Adicione uma em Apresentadores.');
  const photoUrl = await sign(service, photo, 21600, PRESENTER_BUCKET);
  const resolution = fitResolution(entry.limits, '1080p');
  const input = renderInputTemplate(entry.input_template, {
    keyframe_url: photoUrl,
    reference_url: photoUrl,
    reference_urls: [photoUrl],
    audio_url: await sign(service, st.audio_path as string, 21600),
    prompt: (cfg.motion_prompt ?? '').trim() || undefined,
    resolution,
  });
  const missing = missingRequiredInputs(entry, input);
  if (missing.length) {
    throw new Error(
      `O modelo ${entry.model_id} exige ${missing.join(', ')} e o catálogo não preenche. ` +
      'Rode "Verificar modelos" em Config → Integrações → Replicate.',
    );
  }
  if (laneCaptions(job)) {
    st.captions_by = (await hfConnected(service)) ? 'sandbox' : null;
    if (!st.captions_by) st.captions_note = 'Legendas da marca precisam do Higgsfield conectado; o vídeo saiu sem legenda.';
  }
  const prediction = await createCatalogPrediction(service, job, token, entry, input, {
    duration_s: st.audio_s ?? 0,
    resolution,
  });
  st.pending = { provider: 'replicate', id: prediction.id, submitted_at: Date.now() };
  await patch(service, job.id, { artifacts: job.artifacts });
}

async function stepAvatarVideo(service: Service, job: Job) {
  const cfg = avatarCfg(job);
  const arts = job.artifacts as LaneArts;
  const st = (arts.avatar ??= {});
  if (st.result_path) return await transition(service, job, { status: 'muxing', artifacts: arts });
  const heygenVoice = laneVoiceProvider(cfg, st) === 'heygen';
  if (!st.pending) {
    // retomada que pulou etapas: a de entrada (ou a voz) reconstrói o que falta
    if (!st.look_type) return await stepAvatarStart(service, job);
    if (!heygenVoice && !st.audio_path) return await stepAvatarVoice(service, job);
    if ((cfg.provider ?? 'heygen') === 'replicate') return await submitAvatarReplicate(service, job, cfg, st);
    return await submitAvatarHeygen(service, job, cfg, st);
  }
  const p = st.pending;
  let url: string | null;
  let duration: number | null = null;
  try {
    if (p.provider === 'replicate') {
      url = await replicateCheck(await replicateToken(service), p.id);
    } else {
      const v = await getVideo(await heygenKey(service), p.id);
      url = videoResult(v, 'o vídeo do apresentador', st.captions_by === 'heygen');
      duration = v.duration;
    }
  } catch (err) {
    if (err instanceof ReplicateError && err.retryable) return;
    if (p.provider === 'heygen' && heygenTransient(err)) return;
    if (err instanceof NotConnectedError) throw err; // chave sumiu: o vídeo segue lá, o Retomar consulta de novo
    // falha real: o Retomar cria outro (nova tentativa, nova Idempotency-Key)
    st.pending = null;
    st.attempt = (st.attempt ?? 0) + 1;
    await patch(service, job.id, { artifacts: arts });
    throw p.provider === 'heygen' ? laneHeygenError(err) : err;
  }
  if (!url) {
    if (!p.stalled && Date.now() - p.submitted_at > HEYGEN_VIDEO_DEADLINE_MS) {
      // não descarta o id (foi pago): o Retomar volta a consultar o mesmo
      p.stalled = true;
      await patch(service, job.id, { artifacts: arts });
      const who = p.provider === 'heygen' ? 'A HeyGen' : 'O Replicate';
      throw new Error(`${who} passou de ${HEYGEN_VIDEO_DEADLINE_MS / 60000} min sem terminar o vídeo. Clique em "Retomar do checkpoint".`);
    }
    return;
  }
  const path = `director/${job.id}/avatar.mp4`;
  if (p.provider === 'replicate') await saveReplicateClip(service, url, path);
  else await streamToBucket(service, url, BUCKET, path, 'video/mp4', 400 * 1024 * 1024);
  st.result_path = path;
  st.video_id = p.id;
  st.duration_s = duration ?? st.audio_s ?? null;
  st.pending = null;
  await patch(service, job.id, { artifacts: arts });
  if (p.provider === 'heygen') {
    const engine = (st.engine ?? 'avatar_iv').replace(/_/g, '-');
    await recordHeygenCost(service, job, 'avatar_video', `heygen/${engine}`, st.duration_s ?? 0, cfg.resolution ?? '1080p')
      .catch((e) => console.warn('[avatar_video] custo:', errText(e)));
  }
  await transition(service, job, { status: 'muxing', artifacts: arts });
}

async function stepAgentStart(service: Service, job: Job) {
  const cfg = agentCfg(job);
  const problem = validateVideoAgent(cfg);
  if (problem) throw new Error(problem);
  const arts = job.artifacts as LaneArts;
  const st = (arts.agent ??= {});
  if (arts.final || arts.master || st.result_path) return await transition(service, job, { status: 'muxing', artifacts: arts });
  if (st.session_id) return await transition(service, job, { status: 'videos', artifacts: arts });
  const key = await heygenKey(service);
  if ((cfg.presenter_id || cfg.look_id) && st.avatar_id == null) {
    const r = await resolveHeygenLook(service, key, st, cfg.look_id, cfg.presenter_id);
    if (!r) { await patch(service, job.id, { artifacts: arts }); return; }
    st.avatar_id = r.look.id;
    st.voice_default = r.voice;
    // voz: a do job → a padrão do avatar (twin = a clonada; HeyGen = a escolhida);
    // sem nenhuma, o agente usa a da look
    const choice = chooseAvatarVoice(
      { provider: 'heygen', voice_id: cfg.voice_id },
      savedHeygenVoice(r.presenter?.voice),
      r.ref?.type === 'digital_twin' ? r.ref.default_voice_id : null,
      null,
    );
    st.voice_id = choice.provider === 'heygen' ? choice.voice_id : null;
  }
  // voz salva para o agente: só HeyGen do catálogo (o agente recebe voice_id;
  // clone HeyGen Voice no agente não está confirmado na spec)
  // (a voz do job vence a do avatar; a padrão de brand_voices só entra sem nenhuma)
  const jobVoice = (cfg.voice_id ?? '').trim() ? null : await jobBrandVoice(service, cfg.brand_voice_id);
  if (jobVoice && jobVoice.provider === 'heygen' && !jobVoice.heygen_model) {
    st.voice_id = jobVoice.voice_id;
  } else if (st.voice_id == null && !(cfg.voice_id ?? '').trim()) {
    const def = voiceRefOf(await defaultBrandVoice(service).catch(() => null));
    if (def && def.provider === 'heygen' && !def.heygen_model) st.voice_id = def.voice_id;
  }
  if (cfg.brand_kit !== false && st.brand_kit_id === undefined) {
    // o kit melhora o vídeo, mas não o impede: falha vira nota no cartão
    try {
      const { kit, reason } = await ensureBrandKit(service, key);
      st.brand_kit_id = kit?.id ?? null;
      if (reason) st.brand_kit_note = reason;
    } catch (err) {
      st.brand_kit_id = null;
      st.brand_kit_note = `Não deu para aplicar a marca na HeyGen: ${laneHeygenError(err).message}`;
    }
  }
  await transition(service, job, { status: 'videos', artifacts: arts });
}

async function stepAgentWork(service: Service, job: Job) {
  const cfg = agentCfg(job);
  const arts = job.artifacts as LaneArts;
  const st = (arts.agent ??= {});
  if (st.result_path) return await transition(service, job, { status: 'muxing', artifacts: arts });
  if (st.brand_kit_id === undefined && cfg.brand_kit !== false) return await stepAgentStart(service, job);
  const key = await heygenKey(service);
  if (!st.session_id) {
    const files: string[] = [];
    for (const ref of cfg.file_paths ?? []) {
      const f = parseFileRef(ref);
      if (f) files.push(await sign(service, f.path, 21600, f.bucket));
    }
    const body = buildVideoAgentBody({
      prompt: (cfg.prompt ?? '').trim(),
      avatar_id: st.avatar_id,
      voice_id: (cfg.voice_id ?? '').trim() || st.voice_id || null,
      style_id: (cfg.style_id ?? '').trim() || null,
      brand_kit_id: st.brand_kit_id,
      orientation: cfg.orientation,
      file_urls: files,
    });
    let session;
    try {
      session = await createVideoAgent(key, body, idempotencyKey(job.id, 'video_agent', st.attempt ?? 0));
    } catch (err) {
      if (heygenBusy(err)) return await heygenWaitBusy(service, job, st, err);
      throw laneHeygenError(err);
    }
    st.busy_since = null;
    st.session_id = session.session_id;
    st.session_status = session.status;
    st.video_id = session.video_id;
    st.submitted_at = Date.now();
    st.stalled = false;
    if (laneCaptions(job)) {
      st.captions_by = (await hfConnected(service)) ? 'sandbox' : null;
      if (!st.captions_by) st.captions_note = 'Legendas da marca precisam do Higgsfield conectado; o vídeo saiu como o agente fez.';
    }
    await patch(service, job.id, { artifacts: arts });
    return;
  }
  /** falha real: descarta a sessão; o Retomar cria outra (nova tentativa) */
  const drop = async (message: string): Promise<never> => {
    st.session_id = null;
    st.video_id = null;
    st.attempt = (st.attempt ?? 0) + 1;
    await patch(service, job.id, { artifacts: arts });
    throw new Error(message);
  };
  try {
    if (!st.video_id) {
      const s = await getVideoAgent(key, st.session_id);
      st.session_status = s.status;
      st.progress = s.progress;
      if (s.status === 'failed') return await drop(`O Video Agent não conseguiu gerar o vídeo: ${s.error ?? 'sem motivo informado'}.`);
      if (s.status === 'waiting_for_input') {
        return await drop('O Video Agent pediu uma decisão que este fluxo não oferece. Reescreva a ideia com mais detalhes e gere de novo.');
      }
      if (s.video_id) st.video_id = s.video_id;
    }
    if (st.video_id) {
      const v = await getVideo(key, st.video_id);
      let url: string | null;
      try {
        url = videoResult(v, 'o vídeo do Video Agent');
      } catch (err) {
        return await drop((err as Error).message);
      }
      if (url) {
        const path = `director/${job.id}/agent.mp4`;
        await streamToBucket(service, url, BUCKET, path, 'video/mp4', 400 * 1024 * 1024);
        st.result_path = path;
        st.duration_s = v.duration;
        await patch(service, job.id, { artifacts: arts });
        await recordHeygenCost(service, job, 'video_agent', 'heygen/video-agent', v.duration ?? 0)
          .catch((e) => console.warn('[video_agent] custo:', errText(e)));
        await transition(service, job, { status: 'muxing', artifacts: arts });
        return;
      }
    }
  } catch (err) {
    if (heygenTransient(err)) return;
    throw err instanceof HeygenError || heygenStatus(err) != null ? laneHeygenError(err) : err;
  }
  if (!st.stalled && st.submitted_at && Date.now() - st.submitted_at > HEYGEN_AGENT_DEADLINE_MS) {
    st.stalled = true; // a sessão foi paga: o Retomar volta a consultar a mesma
    await patch(service, job.id, { artifacts: arts });
    throw new Error(`O Video Agent passou de ${HEYGEN_AGENT_DEADLINE_MS / 60000} min sem terminar. Clique em "Retomar do checkpoint".`);
  }
  await patch(service, job.id, { artifacts: arts });
}

/**
 * Entrega das duas lanes: legendas da marca (master → stepCaptions, exige
 * Higgsfield) quando pedidas; senão o vídeo do provedor vira o final direto.
 */
async function stepLaneFinish(service: Service, job: Job) {
  const arts = job.artifacts as LaneArts;
  if (arts.final) return await finishJob(service, job);
  if (arts.master) return await stepCaptions(service, job);
  const st = arts.avatar ?? arts.agent;
  if (!st?.result_path) throw new Error('O vídeo pronto não foi encontrado. Clique em "Retomar do checkpoint".');
  const sandbox = st.captions_by === 'sandbox';
  const target = sandbox ? `director/${job.id}/master.mp4` : `director/${job.id}/final.mp4`;
  await ensureLocal(service, BUCKET, st.result_path);
  await service.storage.from(BUCKET).remove([target]).catch(() => {}); // copy não é upsert
  const { error } = await service.storage.from(BUCKET).copy(st.result_path, target);
  if (error) throw new Error(`copy ${st.result_path}→${target}: ${error.message}`);
  if (sandbox) {
    arts.master = target;
    await patch(service, job.id, { artifacts: arts });
    return; // próximo tick: stepCaptions
  }
  arts.final = target;
  await patch(service, job.id, { artifacts: arts });
  await finishJob(service, job);
}

const AVATAR_STEPS: Record<string, (s: Service, j: Job) => Promise<void>> = {
  queued: stepAvatarStart,
  planning: stepAvatarStart,
  plan_ready: stepAvatarStart,
  keyframes: stepAvatarStart,
  tts: stepAvatarVoice,
  videos: stepAvatarVideo,
  muxing: stepLaneFinish,
  publishing: stepPublish,
};

const AGENT_STEPS: Record<string, (s: Service, j: Job) => Promise<void>> = {
  queued: stepAgentStart,
  planning: stepAgentStart,
  plan_ready: stepAgentStart,
  keyframes: stepAgentStart,
  tts: stepAgentStart,
  videos: stepAgentWork,
  muxing: stepLaneFinish,
  publishing: stepPublish,
};

// ── Editar uma cena de um vídeo pronto (docs/hub-motor-contratos.md §10) ─────
// Slot próprio por tick: pega um job 'done' com artifacts.final_rebuilding =
// true (enfileirado pelo video-remake) e avança UMA fase da edição:
//   keyframe (só refazer) → video (v2v ou novo clipe) → assemble → captions → troca.
// O job continua 'done' o tempo todo; o final antigo vale até o novo ficar
// pronto; falha vira scene_edits[shot].status = 'failed' — nunca job failed.

type EditActive = {
  shot: number;
  anchor: number;
  kind: EditKind;
  prompt: string;
  /** prompt em inglês (traduzido uma vez) */
  prompt_en?: string | null;
  n: number;
  scope: number[];
  model_id?: string | null;
  phase: 'keyframe' | 'video' | 'assemble' | 'captions';
  pending?: Pending | null;
  kf?: { path: string; hf_url: string } | null;
  clip?: VideoArt | null;
  master_path?: string | null;
  final_path?: string | null;
  ass_path?: string | null;
  sandbox?: Pending | null;
};
type EditArts = VideosArts & {
  scene_edits?: Record<string, SceneEditState>;
  video_versions?: Record<string, VideoArt[]>;
  edit_active?: EditActive | null;
  final_rebuilding?: boolean;
  master?: string;
  final?: string;
  edited?: EditedVideo;
  identity_element?: string;
  identity_description?: string;
};

async function sandboxStart(service: Service, command: string): Promise<Pending> {
  const out = await mcp(service, 'sandbox_exec', { command, background: true });
  const log = out.match(/Combined output:\s*(\S+)/)?.[1];
  const exit = out.match(/Exit status \(written when done\):\s*(\S+)/)?.[1];
  if (!log || !exit) throw new Error(`sandbox background sem log/exit: ${out.slice(0, 200)}`);
  return { log, exit, submitted_at: Date.now() };
}

/** { code, out } quando terminou; null enquanto roda. */
async function sandboxPoll(service: Service, p: Pending): Promise<{ code: string; out: string } | null> {
  const out = await mcp(service, 'sandbox_exec', {
    command: `if [ -f ${p.exit} ]; then echo "EXITCODE:$(cat ${p.exit})"; fi; tail -n 30 ${p.log} 2>/dev/null`,
    timeout_seconds: 30,
  });
  const code = out.match(/EXITCODE:(\d+)/)?.[1];
  return code == null ? null : { code, out };
}

/** Clipes de âncora da montagem, em ordem, com o clipe da edição no lugar do atual. */
async function editMontage(service: Service, job: Job, clip: VideoArt): Promise<VideoArt[]> {
  const arts = job.artifacts as EditArts;
  const units = videoUnits(job.plan!.shots!, arts.tts ?? [], await unitCaps(service, job));
  const anchors = new Set(units.map((u) => u.anchor.idx));
  return withClip(arts.videos ?? [], clip)
    .filter((v) => anchors.has(v.shot))
    .sort((a, b) => a.shot - b.shot) as VideoArt[];
}

async function editPromptEnglish(a: EditActive): Promise<string> {
  if (a.prompt_en != null) return a.prompt_en;
  a.prompt_en = a.prompt ? (await sceneInEnglish(a.prompt)) ?? a.prompt : '';
  return a.prompt_en;
}

/** Fase "keyframe" (refazer): quadro novo da âncora no Higgsfield. */
async function editKeyframe(service: Service, job: Job, a: EditActive) {
  const arts = job.artifacts as EditArts;
  if (!a.pending) {
    const shot = job.plan!.shots!.find((s) => s.idx === a.anchor);
    if (!shot) throw new Error('A cena não existe mais no roteiro deste vídeo.');
    const models = await hfModels(service);
    const identity = !shot.with_character
      ? ''
      : arts.identity_element
        ? `The main character is <<<${arts.identity_element}>>> — the exact same person as this reference. `
        : arts.identity_description
          ? `The main character is always the same person: ${arts.identity_description}. `
          : '';
    const adjust = a.shot === a.anchor ? await editPromptEnglish(a) : '';
    let hfJob: string;
    try {
      hfJob = await hfGenerate(service, 'generate_image', {
        model: models.image, aspect_ratio: '9:16', count: 1, ...models.image_extra,
        prompt: `${identity}${shot.keyframe_prompt}${adjust ? ` ${adjust}.` : ''} ${job.plan!.look_lock ?? ''}`,
      });
    } catch (err) {
      if (HF_CONCURRENCY_RE.test(errText(err))) return; // conta ocupada: tenta no próximo tick
      throw hfError(err);
    }
    a.pending = { shot: a.anchor, hf_job: hfJob, submitted_at: Date.now() };
    await patch(service, job.id, { artifacts: arts });
    return;
  }
  const url = await hfCheck(service, a.pending.hf_job!);
  if (!url) {
    if (Date.now() - (a.pending.submitted_at ?? 0) > PENDING_DEADLINE_MS) {
      throw new Error(`O quadro novo passou de ${PENDING_DEADLINE_MS / 60000} min sem ficar pronto. Tente de novo.`);
    }
    return;
  }
  const path = `director/${job.id}/keyframes/kf${a.anchor}-r${a.n}.png`;
  await putObject(service, path, await fetchBytes(url), 'image/png');
  a.kf = { path, hf_url: url };
  a.pending = null;
  a.phase = 'video';
  await patch(service, job.id, { artifacts: arts });
}

/** Fase "video": edição v2v (Replicate scene_v2v) ou clipe novo da unidade no motor do job. */
async function editVideo(service: Service, job: Job, a: EditActive) {
  const arts = job.artifacts as EditArts;
  const current = (arts.videos ?? []).find((v) => v.shot === a.anchor);
  if (!current) throw new Error('O clipe desta cena não foi encontrado.');
  const units = videoUnits(job.plan!.shots!, arts.tts ?? [], await unitCaps(service, job));
  const unit = units.find((u) => u.anchor.idx === a.anchor);
  if (!a.pending) {
    if (a.kind === 'edit') {
      const token = await replicateToken(service);
      const entry = await resolveModel(service, 'scene_v2v', a.model_id ?? undefined);
      const resolution = fitResolution(entry.limits, '1080p');
      const ask = await editPromptEnglish(a);
      const input = renderInputTemplate(entry.input_template, {
        prompt: `Change only this: ${ask}. Keep everything else identical: same camera motion, framing, timing, people and gestures.`
          .slice(0, 1000),
        video_url: await sign(service, current.path, 21600),
        duration_int: Math.ceil(current.dur_s),
        duration_ms: Math.ceil(current.dur_s) * 1000,
        resolution,
      });
      const missing = missingRequiredInputs(entry, input);
      if (missing.length) {
        throw new Error(`O modelo ${entry.model_id} exige ${missing.join(', ')} e o catálogo não preenche.`);
      }
      const prediction = await createCatalogPrediction(service, job, token, entry, input, {
        duration_s: current.dur_s, resolution,
      });
      a.model_id = entry.model_id;
      a.pending = { shot: a.anchor, rp_id: prediction.id, model: entry.model_id, dur_s: current.dur_s, submitted_at: Date.now() };
      await patch(service, job.id, { artifacts: arts });
      return;
    }
    // refazer: o mesmo motor e modelo das cenas do job
    if (!unit || !a.kf) throw new Error('Faltou o quadro novo desta cena. Tente refazer de novo.');
    const choice = readEngineChoice(job);
    const adjust = redoAdjustment(a.scope, a.shot, await editPromptEnglish(a));
    const prompt = [unitPrompt(unit, arts, job, false), adjust].filter(Boolean).join('\n');
    if (choice.engine === 'replicate') {
      const token = await replicateToken(service);
      const entry = await replicateSceneEntry(service, choice.model_id);
      const { id, dur_s } = await submitReplicateClip(service, job, token, entry, {
        prompt, keyframePath: a.kf.path, seconds: unit.dur_s,
      });
      a.pending = { shot: a.anchor, rp_id: id, model: entry.model_id, dur_s, submitted_at: Date.now() };
    } else {
      const models = await hfModels(service);
      const spec = hfSpecFor(models, choice.model_id);
      let startId: string;
      try {
        startId = await hfImportImage(service, a.kf.hf_url);
      } catch {
        startId = await hfImportImage(service, await sign(service, a.kf.path));
      }
      const params: Record<string, unknown> = {
        model: spec.model, aspect_ratio: '9:16', duration: unit.dur_s, ...spec.extra,
        prompt, medias: [{ value: startId, role: 'start_image' }],
      };
      let hfJob: string;
      try {
        hfJob = await hfGenerate(service, 'generate_video', params);
      } catch (err) {
        if (HF_CONCURRENCY_RE.test(errText(err))) return;
        if (!/out of credits/i.test(errText(err)) || params.resolution === '720p') throw hfError(err);
        hfJob = await hfGenerate(service, 'generate_video', { ...params, resolution: '720p' }).catch((e) => {
          throw hfError(e);
        });
      }
      a.pending = { shot: a.anchor, hf_job: hfJob, dur_s: unit.dur_s, submitted_at: Date.now() };
    }
    await patch(service, job.id, { artifacts: arts });
    return;
  }
  const p = a.pending;
  const token = p.rp_id ? await replicateToken(service) : null;
  let url: string | null;
  try {
    url = p.rp_id ? await replicateCheck(token!, p.rp_id) : await hfCheck(service, p.hf_job!);
  } catch (err) {
    if (err instanceof ReplicateError && err.retryable) return; // rede/429: a predição segue
    throw err;
  }
  if (!url) {
    const deadline = p.rp_id ? RP_PENDING_DEADLINE_MS : PENDING_DEADLINE_MS;
    if (Date.now() - (p.submitted_at ?? 0) > deadline) {
      if (p.rp_id && token) await cancelPrediction(token, p.rp_id).catch(() => {});
      throw new Error(`O clipe novo passou de ${deadline / 60000} min sem ficar pronto. Tente de novo.`);
    }
    return;
  }
  const path = `director/${job.id}/videos/v${a.anchor}-${a.kind === 'edit' ? 'e' : 'r'}${a.n}.mp4`;
  if (p.rp_id) await saveReplicateClip(service, url, path);
  else await putObject(service, path, await fetchBytes(url), 'video/mp4');
  // clipe novo entra narrado (o áudio nativo de CTA não é refeito)
  a.clip = {
    shot: a.anchor, path, dur_s: p.dur_s ?? current.dur_s, cta: false,
    ...(current.members ? { members: current.members } : {}),
  };
  a.pending = null;
  a.phase = 'assemble';
  await patch(service, job.id, { artifacts: arts });
}

/** Fases "assemble" e "captions": remonta em arquivos novos e troca no fim. */
async function editRebuild(service: Service, job: Job, a: EditActive) {
  const arts = job.artifacts as EditArts;
  if (!a.clip) throw new Error('O clipe novo não foi encontrado. Tente de novo.');
  a.master_path ??= `director/${job.id}/master-e${a.n}.mp4`;
  a.final_path ??= `director/${job.id}/final-e${a.n}.mp4`;
  const captionsOn = (job.config as { captions?: boolean }).captions !== false;
  if (a.phase === 'assemble') {
    if (!a.sandbox) {
      a.sandbox = await sandboxStart(service, await assemblyCommandFor(service, job, await editMontage(service, job, a.clip), a.master_path));
      await patch(service, job.id, { artifacts: arts });
      return;
    }
    const done = await sandboxPoll(service, a.sandbox);
    if (!done) {
      if (Date.now() - (a.sandbox.submitted_at ?? 0) > PENDING_DEADLINE_MS) throw new Error('A remontagem do vídeo estourou o prazo. Tente de novo.');
      return;
    }
    a.sandbox = null;
    if (done.code !== '0' || !done.out.includes('ASSEMBLE_OK')) {
      throw new Error(`A remontagem do vídeo falhou (exit ${done.code}). Tente de novo.`);
    }
    if (captionsOn) {
      a.phase = 'captions';
      await patch(service, job.id, { artifacts: arts });
      return;
    }
    await ensureLocal(service, BUCKET, a.master_path);
    await service.storage.from(BUCKET).remove([a.final_path]).catch(() => {});
    const { error } = await service.storage.from(BUCKET).copy(a.master_path, a.final_path);
    if (error) throw new Error(`copy master→final: ${error.message}`);
    return await finishSceneEdit(service, job, a);
  }
  // legendas: STT de novo no master novo (a duração do clipe pode mudar alguns décimos)
  if (!a.ass_path) {
    const words = await sttWords(service, await sign(service, a.master_path, 3600), captionsLanguage(job));
    if (!words.length) throw new Error('As legendas não acharam fala no vídeo remontado.');
    const assPath = `director/${job.id}/captions-e${a.n}.ass`;
    await putObject(service, assPath, new TextEncoder().encode(buildAss(words, await captionsFor(service, job))), 'text/plain');
    a.ass_path = assPath;
    await patch(service, job.id, { artifacts: arts });
  }
  if (!a.sandbox) {
    a.sandbox = await sandboxStart(service, await burnCommandFor(service, a.master_path, a.ass_path, a.final_path));
    await patch(service, job.id, { artifacts: arts });
    return;
  }
  const done = await sandboxPoll(service, a.sandbox);
  if (!done) {
    if (Date.now() - (a.sandbox.submitted_at ?? 0) > PENDING_DEADLINE_MS) throw new Error('As legendas do vídeo editado estouraram o prazo. Tente de novo.');
    return;
  }
  a.sandbox = null;
  if (done.code !== '0' || !done.out.includes('BURN_OK')) {
    throw new Error(`As legendas do vídeo editado falharam (exit ${done.code}). Tente de novo.`);
  }
  await finishSceneEdit(service, job, a);
}

/** Troca o clipe, master e final de uma vez, e fecha a edição. */
async function finishSceneEdit(service: Service, job: Job, a: EditActive) {
  const arts = job.artifacts as EditArts;
  const swapped = applyClipSwap(arts.videos ?? [], arts.video_versions ?? {}, a.clip!, a.kind);
  arts.videos = swapped.videos as VideoArt[];
  arts.video_versions = swapped.versions as Record<string, VideoArt[]>;
  arts.master = a.master_path!;
  arts.final = a.final_path!;
  const key = String(a.shot);
  const prev = arts.scene_edits?.[key];
  arts.scene_edits = {
    ...(arts.scene_edits ?? {}),
    [key]: {
      status: 'done', kind: a.kind, prompt: a.prompt, error: null, scope: a.scope,
      can_undo: (arts.video_versions[String(a.anchor)] ?? []).length > 0,
      started_at: prev?.started_at ?? Date.now(), finished_at: Date.now(),
    },
  };
  arts.edit_active = null;
  arts.final_rebuilding = false;
  // Aprimorar com IA foi feito sobre o final antigo: não vale mais para este vídeo
  delete arts.edited;
  // o clipe pode ter mudado de duração: o que cada cena permite é recalculado
  try {
    const choice = readEngineChoice(job);
    const sceneEntry = choice.engine === 'replicate'
      ? await resolveModel(service, 'scene_i2v', choice.model_id).catch(() => null)
      : null;
    (arts as Record<string, unknown>).edit_modes = computeEditModes({
      mode: null,
      videos: arts.videos,
      v2v: (await listActiveModels(service).catch(() => [] as VideoModelEntry[])).filter((e) => e.capability === 'scene_v2v'),
      replicateConnected: Boolean(await replicateToken(service).catch(() => null)),
      hfConnected: await hfConnected(service),
      engine: choice.engine === 'replicate' ? 'replicate' : 'higgsfield',
      sceneEntry,
      sceneResolution: sceneEntry ? sceneResolution(sceneEntry.limits, (job.config as { resolution?: unknown }).resolution) : undefined,
    });
    (arts as Record<string, unknown>).edit_modes_at = new Date().toISOString();
  } catch (err) {
    console.warn('[scene-edit] edit_modes:', errText(err));
  }
  await patch(service, job.id, { artifacts: arts });
  const { error: retireError } = await service.from('video_edits').update({ status: 'reverted' })
    .eq('source_id', job.id).in('status', ['suggested', 'ready']);
  if (retireError) console.warn('[scene-edit] video_edits:', retireError.message);
}

/** Falha da edição: registra na cena e libera o vídeo; o final de antes continua valendo. */
async function failSceneEdit(service: Service, job: Job, message: string) {
  const arts = job.artifacts as EditArts;
  const a = arts.edit_active;
  if (a?.pending?.rp_id) {
    const token = await replicateToken(service).catch(() => null);
    if (token) await cancelPrediction(token, a.pending.rp_id).catch(() => {});
  }
  if (a) {
    const key = String(a.shot);
    const prev = arts.scene_edits?.[key];
    arts.scene_edits = {
      ...(arts.scene_edits ?? {}),
      [key]: {
        status: 'failed', kind: a.kind, prompt: a.prompt, error: message.slice(0, 400), scope: a.scope,
        can_undo: (arts.video_versions?.[String(a.anchor)] ?? []).length > 0,
        started_at: prev?.started_at ?? Date.now(), finished_at: Date.now(),
      },
    };
  }
  arts.edit_active = null;
  arts.final_rebuilding = false;
  await patch(service, job.id, { artifacts: arts });
}

async function stepSceneEdit(service: Service, job: Job) {
  const a = (job.artifacts as EditArts).edit_active;
  if (!a) {
    (job.artifacts as EditArts).final_rebuilding = false;
    await patch(service, job.id, { artifacts: job.artifacts });
    return;
  }
  if (a.phase === 'keyframe') return await editKeyframe(service, job, a);
  if (a.phase === 'video') return await editVideo(service, job, a);
  return await editRebuild(service, job, a);
}

/** Slot de edição: 1 job 'done' com final_rebuilding por tick, com o mesmo lease da produção. */
async function advanceEdit(service: Service): Promise<Record<string, unknown>> {
  const leaseCutoff = new Date(Date.now() - LEASE_MINUTES * 60_000).toISOString();
  const { data: jobs, error } = await service
    .from('director_jobs')
    .select('*')
    .eq('status', 'done')
    .eq('artifacts->>final_rebuilding', 'true')
    .or(`claimed_by.is.null,claimed_at.lt.${leaseCutoff}`)
    .order('claimed_at', { ascending: true, nullsFirst: true })
    .limit(1);
  if (error) throw new Error(error.message);
  if (!jobs?.length) return { advanced: 0 };
  const job = jobs[0] as Job;
  const { data: claimed, error: claimErr } = await service
    .from('director_jobs')
    .update({ claimed_by: 'edge', claimed_at: new Date().toISOString() })
    .eq('id', job.id)
    .or(`claimed_by.is.null,claimed_at.lt.${leaseCutoff}`)
    .select('id');
  if (claimErr) throw new Error(claimErr.message);
  if (!claimed?.length) return { advanced: 0, skipped: 'claim perdido' };
  try {
    await stepSceneEdit(service, job);
    return { advanced: 1, job: job.id, edit: (job.artifacts as EditArts).edit_active?.phase ?? 'done' };
  } catch (err) {
    // arquivo voltando do Drive: a edição de cena, já paga, continua no próximo tick
    if (err instanceof ArchivedFileError && err.code === 'restoring') return { advanced: 0, job: job.id, waiting: 'drive' };
    const message = err instanceof Error ? err.message : String(err);
    await failSceneEdit(service, job, message).catch((e) => console.error('failSceneEdit:', errText(e)));
    return { advanced: 0, job: job.id, edit_failed: message.slice(0, 200) };
  } finally {
    await patch(service, job.id, { claimed_by: null }).catch(() => {});
  }
}

const REMAKE_STEPS: Record<string, (s: Service, j: Job) => Promise<void>> = {
  queued: stepRemakeStart,
  planning: stepRemakeStart,
  videos: stepRemakeWork,
  muxing: stepRemakeFinish,
  publishing: stepPublish,
};

const STEPS: Record<string, (s: Service, j: Job) => Promise<void>> = {
  queued: stepPlanning,
  planning: stepPlanning,
  plan_ready: (s, j) => transition(s, j, { status: 'tts' }),
  tts: stepTts,
  keyframes: stepKeyframes,
  videos: stepVideos,
  muxing: stepAssemble,
  // aliases legados (jobs antigos retomados no meio caem no mesmo montador;
  // assembling/mastering vêm da lane worker — artefatos compatíveis)
  concatenating: stepAssemble,
  bed: stepAssemble,
  assembling: stepAssemble,
  mastering: stepAssemble,
  publishing: stepPublish,
};

// ── handler ──────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  if (url.searchParams.has('hook')) return jsonResponse({ ok: true }); // ack de webhook legado

  const service = createServiceClient();

  const provided = req.headers.get('x-cron-secret');
  let authorized = false;
  if (provided) {
    const { data } = await service.rpc('get_vault_secret', { _name: 'VIDEO_CRON_SECRET' });
    authorized = segredoIgual(provided, data);
  }
  if (!authorized) {
    const user = await getUser(req);
    if (user) {
      const { data: isAdmin } = await service.rpc('has_role', { _user_id: user.id, _role: 'admin' });
      authorized = Boolean(isAdmin);
    }
  }
  if (!authorized) return errorResponse(401, 'unauthorized', 'x-cron-secret ou JWT de admin.');

  try {
    // pedido de montagem/legenda do Claude da pessoa (pelo conector): não é um tick
    const corpo = req.method === 'POST'
      ? await req.clone().json().catch(() => ({})) as Record<string, unknown>
      : {};
    if (corpo.acao === 'claude_pedidos') return await claudePedidos(service, corpo);
    if (corpo.acao === 'claude_entrega') return await claudeEntrega(service, corpo);

    // Estúdio de Identidades: materializa 1 identidade pendente por tick (fora da fila de jobs);
    // falha aqui não derruba o tick (o erro fica na linha da identidade / no log)
    await stepIdentities(service).catch((err) => console.error('stepIdentities:', err));
    // Apresentadores: prepara 1 element pedido por job (provider_refs.higgsfield)
    await stepPresenters(service).catch((err) => console.error('stepPresenters:', err));
    // Catálogo vivo do Higgsfield: 1x por dia, nunca derruba o tick
    await stepHfCatalog(service).catch((err) => console.error('stepHfCatalog:', err));

    // dois slots por tick: 1 produção + 1 publicação (publicação nunca starva produção)
    const production = await advanceOne(service, RUNNABLE);
    const publish = await advanceOne(service, ['publishing']);
    // edição de cena de vídeo pronto (§10): slot próprio, falha nunca derruba o tick
    const edit = await advanceEdit(service).catch((err) => ({ advanced: 0, error: errText(err).slice(0, 200) }));
    return jsonResponse({ production, publish, edit });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(500, 'internal', message);
  }
});

/** Seleciona (respeitando leases do edge E do worker), claima e avança UM job. */
async function advanceOne(service: Service, statuses: string[]): Promise<Record<string, unknown>> {
  const leaseCutoff = new Date(Date.now() - LEASE_MINUTES * 60_000).toISOString();
  const { data: jobs, error } = await service
    .from('director_jobs')
    .select('*')
    .in('status', statuses)
    .or(`claimed_by.is.null,claimed_at.lt.${leaseCutoff}`)
    // rodízio: o job tocado há mais tempo primeiro (nunca tocado = null vem antes).
    // Antes era o mais ANTIGO sempre: um job esperando provedor ocupava todo
    // tick e os mais novos ficavam "Na fila" para sempre.
    .order('claimed_at', { ascending: true, nullsFirst: true })
    .order('created_at')
    .limit(1);
  if (error) throw new Error(error.message);
  if (!jobs?.length) return { advanced: 0 };

  const job = jobs[0] as Job;
  // claim atômico (single-flight entre ticks e contra o worker local)
  const { data: claimed, error: claimErr } = await service
    .from('director_jobs')
    .update({ claimed_by: 'edge', claimed_at: new Date().toISOString() })
    .eq('id', job.id)
    .or(`claimed_by.is.null,claimed_at.lt.${leaseCutoff}`)
    .select('id');
  if (claimErr) throw new Error(claimErr.message);
  if (!claimed?.length) return { advanced: 0, skipped: 'claim perdido' };

  try {
    const mode = (job.config as { mode?: string } | null)?.mode;
    // modo que este motor não conhece (tela mais nova que a edge): falha antes
    // de gastar crédito rodando como vídeo de cenas
    if (mode && !['remake', 'avatar_video', 'video_agent'].includes(mode)) {
      await patch(service, job.id, {
        status: 'failed',
        error: 'Este tipo de vídeo ainda não está disponível no motor. Avise o administrador para publicar a versão nova.',
      });
      return { advanced: 1, job: job.id, from: job.status };
    }
    const steps = mode === 'remake'
      ? REMAKE_STEPS
      : mode === 'avatar_video'
        ? AVATAR_STEPS
        : mode === 'video_agent'
          ? AGENT_STEPS
          : STEPS;
    await steps[job.status]?.(service, job);
    return { advanced: 1, job: job.id, from: job.status };
  } catch (err) {
    // arquivo voltando do Drive: o job não falhou, o próximo tick continua de onde parou
    if (err instanceof ArchivedFileError && err.code === 'restoring') return { advanced: 0, job: job.id, waiting: 'drive' };
    const message = err instanceof Error ? err.message : String(err);
    if (message !== 'status_changed_externally') {
      if (job.status === 'publishing') {
        // publicação nunca falha o job (o vídeo está pronto) — registra e volta pra done
        const arts = job.artifacts as { tiktok?: Record<string, unknown> };
        arts.tiktok = { ...(arts.tiktok ?? {}), status: 'error', error: message.slice(0, 400) };
        await patch(service, job.id, { status: 'done', artifacts: job.artifacts }).catch(() => {});
      } else {
        await patch(service, job.id, { status: 'failed', error: message.slice(0, 800) }).catch(() => {});
      }
    }
    return { advanced: 0, job: job.id, failed: message.slice(0, 200) };
  } finally {
    // solta o lease mas mantém claimed_at como "último tick": é a chave do rodízio
    await patch(service, job.id, { claimed_by: null }).catch(() => {});
  }
}
