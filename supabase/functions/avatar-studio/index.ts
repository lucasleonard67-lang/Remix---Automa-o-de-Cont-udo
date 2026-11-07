// avatar-studio — criação e curadoria do avatar da marca.
// Spec: docs/11-video-replicate.md §4.4. verify_jwt=true, ações restritas a admin.
//
// O avatar é um ATIVO DA MARCA, não um acessório de uma peça: é gerado uma vez,
// guardado no bucket `brand-assets` junto do brand kit, e reusado em N cenas de
// N vídeos. É isso que o `identity_pack_paths` sustenta — o pack de referência
// entra no modelo de keyframe a cada cena, e é o que faz o MESMO rosto aparecer
// em vídeos diferentes sem retreinar nada.
//
// Toda geração passa pela mesma máquina de `video_predictions` do pipeline de
// vídeo (alvo `avatar_id`), então herda claim atômico, webhook, reconciliador,
// watchdog e ledger de custo — sem caminho paralelo.

import { handlePreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createServiceClient, getUser } from '../_shared/supabase.ts';
import { enforceRateLimit } from '../_shared/rate-limit.ts';
import { ReplicateError, createOfficialPrediction, firstOutputUrl, streamToBucket } from '../_shared/replicate.ts';
import { renderInputTemplate, resolveModel, splitModelId } from '../_shared/video-catalog.ts';
import {
  AVATAR_BUCKET,
  dispatchPrediction,
  getReplicateToken,
  updatePresenterFace,
} from '../_shared/video-pipeline.ts';
import {
  buildCreateLooksBody, createAvatar, createConsent, createLooks, createSpeech, deleteAvatarGroup, deleteAvatarLook,
  deleteVoice, fillGroupVoices, getGroup, HeygenError, heygenHumanError, heygenKeyOrNull, HEYGEN_NOT_CONNECTED, idempotencyKey, listLooks,
  listLookTemplates, listVoices, type LookQuery, PROMPT_ASPECT_RATIOS, PROMPT_MAX_CHARS, PROMPT_MAX_REFS, shortHash,
} from '../_shared/heygen.ts';
import {
  ensureBrandKit, ensurePreviewPhoto, type HeygenAvatarKind, type HeygenRef, heygenRefOf, newHeygenRef, refFromHeygen,
  refreshHeygenRef, saveHeygenRef,
} from '../_shared/avatar-video.ts';
import { NotConnectedError } from '../_shared/not-connected.ts';
import { ACOES_DO_CONECTOR, usuarioDoConector } from '../_shared/conector-interno.ts';
import { createUserClient } from '../_shared/supabase.ts';
import {
  type BrandVoiceRow, CLONE_MAX_BYTES, CLONE_MIN_S, costLabel, DESIGN_MAX, DESIGN_MIN, elevenAddShared, elevenCloneIVC,
  elevenDeleteVoice, elevenDesign, findBrandVoice, elevenDesignSave, elevenGetVoice, elevenHuman, elevenSharedVoices, elevenSubscription,
  type ElevenSubscription, heygenCloneFailure, heygenCloneVoice, heygenDeleteModelVoice, heygenDesignVoices,
  heygenModelTts, heygenModelVoice, loadBrandVoice, VOICE_NAME_MAX, VoiceError, type VoicePath, voicePaths, voiceRefOf,
  wavDurationSeconds,
} from '../_shared/voices.ts';

type Json = Record<string, unknown>;
type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Vozes pt-BR do MiniMax curadas para marca profissional (prefixo Portuguese_).
 * `gender` só onde a voz é inequívoca: é ele que escolhe a voz padrão da
 * narração do Diretor quando o apresentador não tem voz própria lá.
 */
const VOICES = [
  { id: 'Portuguese_CalmLeader', label: 'Líder calmo (masc.)', gender: 'male' },
  { id: 'Portuguese_ConfidentWoman', label: 'Mulher confiante', gender: 'female' },
  { id: 'Portuguese_Deep-VoicedGentleman', label: 'Voz grave (masc.)', gender: 'male' },
  { id: 'Portuguese_DeterminedManager', label: 'Gestor determinado', gender: null },
  { id: 'Portuguese_GentleTeacher', label: 'Professor acolhedor', gender: null },
  { id: 'Portuguese_CaptivatingStoryteller', label: 'Narrador envolvente', gender: null },
  { id: 'Portuguese_ConscientiousInstructor', label: 'Instrutor didático', gender: null },
  { id: 'Portuguese_ElegantGirl', label: 'Voz elegante (fem.)', gender: 'female' },
  { id: 'Portuguese_FriendlyNeighbor', label: 'Próximo e amigável', gender: null },
  { id: 'Portuguese_CharmingLady', label: 'Senhora carismática', gender: 'female' },
] as const;

function voiceGender(voiceId: unknown): 'female' | 'male' | null {
  return VOICES.find((v) => v.id === voiceId)?.gender ?? null;
}

/** Fotos enviadas pela tela no cadastro (1 a 3). */
const MAX_PHOTOS = 3;
const UPLOAD_PREFIX = 'avatars/uploads/';
/** Bucket das fotos do cadastro legado (director_identities). */
const LEGACY_BUCKET = 'renders';

const PREVIEW_TEXT =
  'Esta é a voz que vai narrar os seus vídeos. Um processo bem desenhado paga por si mesmo.';

import { requireDrive } from '../_shared/drive-gate.ts';
import { signRestoring } from '../_shared/drive-restore.ts';

/** Vídeo do gêmeo digital: pode ter ido para o Drive. */
const signed = async (service: unknown, path: string) => {
  try {
    return { data: { signedUrl: await signRestoring(service, 'renders', path, HEYGEN_URL_TTL_S) }, error: null };
  } catch (err) {
    return { data: null, error: err };
  }
};

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const service = createServiceClient();
    const conector = await usuarioDoConector(req, service);
    const user = conector ? { id: conector } : await getUser(req);
    if (!user) return errorResponse(401, 'unauthorized', 'Sessão inválida ou ausente.');
    if (req.method !== 'POST') return errorResponse(405, 'invalid_input', 'Use POST.');

    let body: Json;
    try {
      body = (await req.json()) as Json;
    } catch (_err) {
      return errorResponse(400, 'invalid_input', 'Body JSON inválido.');
    }

    const action = typeof body.action === 'string' ? body.action : '';
    if (conector && !ACOES_DO_CONECTOR.includes(action)) {
      return errorResponse(403, 'forbidden', 'Esta ação é só pela tela do produto.');
    }

    // Catálogo de vozes é leitura pura — não exige admin nem gasta nada.
    if (action === 'list_voices') {
      return jsonResponse({ voices: VOICES.map(({ id, label }) => ({ id, label })) });
    }

    const { data: isAdmin } = await service.rpc('has_role', {
      _user_id: user.id,
      _role: 'admin',
    });
    if (isAdmin !== true) {
      return errorResponse(403, 'forbidden', 'Apenas administradores gerenciam avatares.');
    }

    const semDrive = await requireDrive(service, 'avatar-studio', action);
    if (semDrive) return semDrive;

    switch (action) {
      case 'create':
        return await handleCreate(service, body, user.id);
      case 'generate_identity':
        return await handleGenerateIdentity(service, body, user.id);
      case 'bootstrap_from_photo':
        return await handleBootstrap(service, body, user.id);
      case 'preview_voice':
        return await handlePreviewVoice(service, body, user.id);
      case 'update':
        return await handleUpdate(service, body);
      case 'set_default':
        return await handleSetDefault(service, body);
      case 'archive':
        return await handleArchive(service, body);
      case 'migrate_identities':
        return await handleMigrateIdentities(service);
      // HeyGen (docs/hub-motor-contratos.md §1-§4)
      case 'heygen_looks':
      case 'heygen_voices':
      case 'heygen_group_voice':
      case 'heygen_photo_avatar':
      case 'heygen_twin':
      case 'heygen_consent_link':
      case 'heygen_status':
      case 'heygen_brand_kit':
      case 'heygen_prompt_avatar':
      case 'heygen_new_look':
      case 'heygen_look_templates':
      case 'heygen_delete':
      case 'heygen_voice_preview':
        return await handleHeygen(service, action, body, user.id);
      // Construtor de voz (docs/hub-motor-contratos.md §9)
      case 'voice_options':
      case 'voice_upload_url':
      case 'voice_clone':
      case 'voice_design':
      case 'voice_design_save':
      case 'voice_library':
      case 'voice_library_add':
      case 'voice_import':
      case 'voice_status':
      case 'voice_set_default':
      case 'voice_delete':
        return await handleVoice(service, action, body, user.id, req);
      default:
        return errorResponse(400, 'invalid_input', `Ação desconhecida: "${action}".`);
    }
  } catch (err) {
    if (err instanceof NotConnectedError) return errorResponse(412, 'not_connected', err.message);
    if (err instanceof HeygenError) return errorResponse(502, 'heygen_error', heygenHumanError(err, false).message);
    if (err instanceof ReplicateError) {
      return errorResponse(err.status >= 400 ? err.status : 502, err.code, err.message);
    }
    console.error('[avatar-studio] erro inesperado:', err instanceof Error ? err.message : err);
    return errorResponse(500, 'internal_error', 'Falha inesperada.');
  }
});

// ── Criação ──────────────────────────────────────────────────────────────────

type AvatarRow = {
  id: string;
  name: string;
  appearance_prompt: string | null;
  reference_image_path: string | null;
  identity_pack_paths: string[] | null;
  voice: Record<string, unknown> | null;
  status: string;
};

async function loadAvatar(service: ServiceClient, id: unknown): Promise<AvatarRow | null> {
  if (typeof id !== 'string' || !id) return null;
  const { data } = await service
    .from('brand_avatars')
    .select('id, name, appearance_prompt, reference_image_path, identity_pack_paths, voice, status')
    .eq('id', id)
    .maybeSingle<AvatarRow>();
  return data ?? null;
}

async function handleCreate(
  service: ServiceClient,
  body: Json,
  userId: string,
): Promise<Response> {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return errorResponse(400, 'invalid_input', 'O apresentador precisa de um nome.');

  const appearance =
    typeof body.appearance_prompt === 'string' ? body.appearance_prompt.trim() : '';
  const voice = (body.voice ?? {}) as Json;
  const voiceId = typeof voice.voice_id === 'string' ? voice.voice_id : VOICES[0].id;

  const uploads = Array.isArray(body.photo_paths)
    ? body.photo_paths.filter(
        (p): p is string =>
          typeof p === 'string' && p.startsWith(UPLOAD_PREFIX) && !p.includes('..'),
      )
    : [];
  if (uploads.length > MAX_PHOTOS) {
    return errorResponse(400, 'invalid_input', `Envie no máximo ${MAX_PHOTOS} fotos.`);
  }

  // As fotos sobem para uma pasta temporária (a tela ainda não tem o id) e são
  // arrumadas em avatars/<id>/ref-N — o mesmo lugar das fotos migradas.
  const id = crypto.randomUUID();
  const photos: string[] = [];
  for (let i = 0; i < uploads.length; i++) {
    const ext = uploads[i].split('.').pop()?.toLowerCase() || 'jpg';
    const target = `avatars/${id}/ref-${i + 1}.${ext}`;
    const { error } = await service.storage.from(AVATAR_BUCKET).copy(uploads[i], target);
    photos.push(error ? uploads[i] : target);
    if (!error) await service.storage.from(AVATAR_BUCKET).remove([uploads[i]]).catch(() => {});
  }

  const { count } = await service
    .from('brand_avatars')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active');

  const row: Json = {
    id,
    name,
    appearance_prompt: appearance || null,
    reference_image_path: photos[0] ?? null,
    identity_pack_paths: photos,
    voice: {
      provider: 'replicate',
      voice_id: voiceId,
      language_boost: 'Portuguese',
      ...voice,
    },
    provider_refs: {},
    // Primeiro apresentador da instância já nasce padrão: sem isso o Reel
    // seguinte não teria ninguém falando e cairia em b-roll sem explicação.
    is_default: (count ?? 0) === 0,
    created_by: userId,
  };
  const gender = voiceGender(voiceId);
  const { data, error } = await insertAvatar(service, gender ? { ...row, gender } : row);

  if (error) {
    return errorResponse(500, 'internal_error', `Falha ao criar o apresentador: ${error.message}`);
  }
  return jsonResponse({ avatar: data }, 201);
}

/**
 * Insert tolerante à coluna `gender` ainda não existir (supabase/sql/presenters.sql
 * não aplicado): tenta de novo sem ela.
 */
async function insertAvatar(service: ServiceClient, row: Json) {
  const first = await service
    .from('brand_avatars')
    .insert(row)
    .select('id, name, is_default')
    .single();
  if (!first.error || !('gender' in row) || !/gender/i.test(first.error.message)) return first;
  const { gender: _gender, ...rest } = row;
  return await service.from('brand_avatars').insert(rest).select('id, name, is_default').single();
}

/** Prompt do retrato: 9:16, um rosto, luz de vídeo — nunca colagem de painéis. */
function buildIdentityPrompt(avatar: AvatarRow, instruction?: string): string {
  const parts = [
    'Retrato fotográfico ÚNICO de uma pessoa, vertical 9:16, para servir de identidade ' +
      'visual de um apresentador de vídeo.',
    avatar.appearance_prompt?.trim() ||
      'Pessoa adulta de aparência profissional e acessível, roupa de trabalho sóbria.',
  ];
  if (instruction?.trim()) parts.push(`Ajuste pedido: ${instruction.trim()}`);
  parts.push(
    'Enquadramento do peito para cima, olhando para a câmera, expressão natural e ' +
      'confiante. Luz suave e uniforme de vídeo, fundo simples e desfocado. ' +
      'PROIBIDO: colagem, grade, múltiplos painéis, storyboard, tela dividida, mais de ' +
      'uma pessoa, texto, legenda, logotipo ou marca d’água.',
  );
  return parts.join('\n\n');
}

/**
 * Gera mais um retrato do avatar. Quando já existe pack, ele entra como
 * REFERÊNCIA — é o que mantém o mesmo rosto entre os retratos, em vez de
 * produzir uma pessoa diferente a cada geração.
 */
async function handleGenerateIdentity(
  service: ServiceClient,
  body: Json,
  userId: string,
): Promise<Response> {
  const avatar = await loadAvatar(service, body.avatar_id);
  if (!avatar) return errorResponse(404, 'not_found', 'Avatar não encontrado.');

  const token = await getReplicateToken(service);
  if (!token) {
    return errorResponse(400, 'replicate_not_configured', 'Token do Replicate não configurado.');
  }

  const limited = await enforceRateLimit(userId, 'avatar-studio');
  if (limited) return limited;

  const instruction = typeof body.instruction === 'string' ? body.instruction : undefined;
  const references = await packUrls(service, avatar);

  const predictionId = await dispatchPrediction({
    service,
    token,
    capability: 'avatar_identity',
    kind: 'avatar_identity',
    avatarId: avatar.id,
    vars: {
      prompt: buildIdentityPrompt(avatar, instruction),
      // nano-banana usa todas (image_input); o fallback flux-kontext edita UMA
      // imagem (input_image ← keyframe_url): sem ela, ele era inalcançável
      ...(references.length > 0 ? { reference_urls: references, keyframe_url: references[0] } : {}),
    },
    inputPaths: { appearance_prompt: avatar.appearance_prompt, instruction: instruction ?? null },
    costBasis: { images: 1 },
  });

  if (!predictionId) {
    return errorResponse(409, 'video_in_flight', 'Já existe um retrato sendo gerado para este avatar.');
  }
  return jsonResponse({ prediction_id: predictionId, avatar_id: avatar.id }, 202);
}

async function packUrls(service: ServiceClient, avatar: AvatarRow): Promise<string[]> {
  const paths = [avatar.reference_image_path, ...(avatar.identity_pack_paths ?? [])].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  const unique = [...new Set(paths)].slice(0, 6);
  const urls: string[] = [];
  for (const path of unique) {
    const { data } = await service.storage.from(AVATAR_BUCKET).createSignedUrl(path, 86_400);
    if (data?.signedUrl) urls.push(data.signedUrl);
  }
  return urls;
}

/**
 * Parte de uma FOTO REAL enviada pelo cliente: o retrato canônico é derivado
 * dela, preservando o rosto. É o caminho para o avatar ser a pessoa da marca, e
 * não um personagem inventado.
 */
async function handleBootstrap(
  service: ServiceClient,
  body: Json,
  userId: string,
): Promise<Response> {
  const avatar = await loadAvatar(service, body.avatar_id);
  if (!avatar) return errorResponse(404, 'not_found', 'Avatar não encontrado.');

  const uploadPath = typeof body.upload_path === 'string' ? body.upload_path : '';
  if (!uploadPath) {
    return errorResponse(400, 'invalid_input', 'Envie a foto primeiro (upload_path é obrigatório).');
  }

  const token = await getReplicateToken(service);
  if (!token) {
    return errorResponse(400, 'replicate_not_configured', 'Token do Replicate não configurado.');
  }

  const limited = await enforceRateLimit(userId, 'avatar-studio');
  if (limited) return limited;

  const { data: signed, error: signError } = await service.storage
    .from(AVATAR_BUCKET)
    .createSignedUrl(uploadPath, 86_400);
  if (signError || !signed?.signedUrl) {
    return errorResponse(400, 'invalid_input', 'Não consegui ler a foto enviada.');
  }

  const predictionId = await dispatchPrediction({
    service,
    token,
    capability: 'avatar_identity',
    kind: 'avatar_identity',
    avatarId: avatar.id,
    vars: {
      prompt:
        'Recorte e reenquadre esta pessoa como retrato vertical 9:16 de apresentador de ' +
        'vídeo: do peito para cima, olhando para a câmera, luz suave e uniforme, fundo ' +
        'simples e desfocado. PRESERVE o rosto exatamente como está — mesma pessoa, ' +
        'mesmas feições. Sem texto, sem logotipo, sem colagem.',
      keyframe_url: signed.signedUrl,
      reference_urls: [signed.signedUrl],
    },
    inputPaths: { source_photo: uploadPath },
    costBasis: { images: 1 },
  });

  if (!predictionId) {
    return errorResponse(409, 'video_in_flight', 'Já existe um retrato sendo gerado para este avatar.');
  }
  return jsonResponse({ prediction_id: predictionId, avatar_id: avatar.id }, 202);
}

/**
 * Amostra da voz. TTS é rápido, então usa `Prefer: wait` e devolve na hora —
 * a UI precisa disso para escolher a voz sem esperar webhook. Sempre no MESMO
 * path por avatar: a prévia é descartável e não acumula lixo no bucket.
 */
async function handlePreviewVoice(
  service: ServiceClient,
  body: Json,
  userId: string,
): Promise<Response> {
  const avatar = await loadAvatar(service, body.avatar_id);
  const voiceId =
    typeof body.voice_id === 'string' && body.voice_id
      ? body.voice_id
      : ((avatar?.voice?.voice_id as string) ?? VOICES[0].id);

  const token = await getReplicateToken(service);
  if (!token) {
    return errorResponse(400, 'replicate_not_configured', 'Token do Replicate não configurado.');
  }

  const limited = await enforceRateLimit(userId, 'avatar-studio');
  if (limited) return limited;

  const tts = await resolveModel(service, 'tts');
  const { owner, name } = splitModelId(tts.model_id);
  const input = renderInputTemplate(tts.input_template, {
    text: typeof body.text === 'string' && body.text.trim() ? body.text.trim() : PREVIEW_TEXT,
    voice_id: voiceId,
    language_boost: 'Portuguese',
    bitrate: 128000,
  });

  const prediction = await createOfficialPrediction(token, owner, name, {
    input,
    // Prévia não passa pelo webhook: é curta e a UI espera a resposta.
    webhookUrl: `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/replicate-webhook`,
    preferWaitSeconds: 55,
  });

  const url = firstOutputUrl(prediction.output);
  if (!url) {
    return errorResponse(
      504,
      'provider_error',
      'A prévia demorou mais que o esperado. Tente de novo em instantes.',
    );
  }

  const path = `avatars/${avatar?.id ?? 'previews'}/voice-preview.mp3`;
  await streamToBucket(service, url, AVATAR_BUCKET, path, 'audio/mpeg', 10 * 1_048_576);

  return jsonResponse({ path, voice_id: voiceId });
}

// ── Curadoria ────────────────────────────────────────────────────────────────

/** voice.heygen_voice: {provider: twin | elevenlabs | heygen, voice_id?}. */
function validHeygenVoice(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const { provider, voice_id: id } = v as { provider?: unknown; voice_id?: unknown };
  if (id !== undefined && id !== null && (typeof id !== 'string' || id.length > 128)) return false;
  if (provider === 'twin') return true;
  if (provider === 'elevenlabs') return typeof id === 'string' && /^[A-Za-z0-9]{10,40}$/.test(id);
  if (provider === 'heygen') return typeof id === 'string' && id.trim().length > 0;
  return false;
}

/**
 * Foto aceita para o avatar: já é dele (pack ou pasta avatars/<id>/), ou foi
 * enviada agora (avatars/uploads/…) e é movida para avatars/<id>/ref-<ts>.
 * Qualquer outro caminho (outro avatar, fora do bucket do workspace) → null.
 */
async function adoptPhoto(service: ServiceClient, avatarId: string, pack: string[], path: string): Promise<string | null> {
  if (!path || path.includes('..') || path.startsWith('/')) return null;
  if (pack.includes(path)) return path;
  if (path.startsWith(`avatars/${avatarId}/`)) {
    const { error } = await service.storage.from(AVATAR_BUCKET).createSignedUrl(path, 60);
    return error ? null : path;
  }
  if (!path.startsWith(UPLOAD_PREFIX)) return null;
  const ext = (path.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const target = `avatars/${avatarId}/ref-${Date.now()}.${ext}`;
  const { error } = await service.storage.from(AVATAR_BUCKET).copy(path, target);
  if (error) return null;
  await service.storage.from(AVATAR_BUCKET).remove([path]).catch(() => {});
  return target;
}

async function handleUpdate(service: ServiceClient, body: Json): Promise<Response> {
  const avatar = await loadAvatar(service, body.avatar_id);
  if (!avatar) return errorResponse(404, 'not_found', 'Avatar não encontrado.');

  const patch: Json = {};
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.appearance_prompt === 'string') {
    patch.appearance_prompt = body.appearance_prompt.trim() || null;
  }
  if (body.voice && typeof body.voice === 'object') {
    const hv = (body.voice as Json).heygen_voice;
    if (hv !== undefined && hv !== null && !validHeygenVoice(hv)) {
      return errorResponse(400, 'invalid_input', 'Voz padrão inválida. Escolha de novo.');
    }
    patch.voice = { ...(avatar.voice ?? {}), ...(body.voice as Json) };
    // sempre grava, inclusive null: voz trocada para uma sem gênero definido
    // não pode deixar o gênero da voz anterior escolhendo a narração
    if ('voice_id' in (body.voice as Json)) {
      patch.gender = voiceGender((body.voice as Json).voice_id);
    }
  }
  // Trocar a foto principal: um retrato que já é do avatar (curadoria, sem
  // gastar nada) ou uma foto nova já enviada ao bucket (avatars/uploads/…),
  // que é movida para avatars/<id>/. identity_pack_paths (opcional) troca o
  // pack inteiro pelas mesmas regras.
  let newReference: string | null = null;
  let newPack: string[] | null = null;
  const pack = avatar.identity_pack_paths ?? [];
  if (typeof body.reference_image_path === 'string') {
    const adopted = await adoptPhoto(service, avatar.id, pack, body.reference_image_path);
    if (!adopted) return errorResponse(400, 'invalid_input', 'Essa foto não pertence a este avatar.');
    if (adopted !== avatar.reference_image_path) newReference = adopted;
    if (!pack.includes(adopted)) newPack = [adopted, ...pack].slice(0, MAX_PHOTOS);
  }
  if (Array.isArray(body.identity_pack_paths)) {
    const list = body.identity_pack_paths;
    if (!list.length || list.length > MAX_PHOTOS) {
      return errorResponse(400, 'invalid_input', `Use de 1 a ${MAX_PHOTOS} fotos.`);
    }
    const adoptedPack: string[] = [];
    for (const p of list) {
      const adopted = typeof p === 'string' ? await adoptPhoto(service, avatar.id, pack, p) : null;
      if (!adopted) return errorResponse(400, 'invalid_input', 'Essa foto não pertence a este avatar.');
      if (!adoptedPack.includes(adopted)) adoptedPack.push(adopted);
    }
    newPack = adoptedPack;
    const reference = newReference ?? avatar.reference_image_path;
    if (!reference || !adoptedPack.includes(reference)) newReference = adoptedPack[0];
  }
  if (newPack && !newReference) newReference = avatar.reference_image_path ?? newPack[0];

  if (Object.keys(patch).length === 0 && !newReference) {
    return jsonResponse({ ok: true, unchanged: true });
  }

  // Rosto principal trocado: o element do Higgsfield feito com o rosto antigo
  // é solto (com guard) para o Diretor preparar de novo com o atual.
  if (newReference) {
    const reference = newReference;
    const { error: faceError } = await updatePresenterFace(service, avatar.id, () => ({
      reference_image_path: reference,
      ...(newPack ? { identity_pack_paths: newPack } : {}),
    }));
    if (faceError) {
      return errorResponse(500, 'internal_error', `Falha ao atualizar: ${faceError}`);
    }
    if (Object.keys(patch).length === 0) return jsonResponse({ ok: true });
  }

  let { error } = await service.from('brand_avatars').update(patch).eq('id', avatar.id);
  if (error && 'gender' in patch && /gender/i.test(error.message)) {
    // coluna ainda não criada (presenters.sql não aplicado): salva o resto
    delete patch.gender;
    ({ error } = await service.from('brand_avatars').update(patch).eq('id', avatar.id));
  }
  if (error) return errorResponse(500, 'internal_error', `Falha ao atualizar: ${error.message}`);
  return jsonResponse({ ok: true });
}

async function handleSetDefault(service: ServiceClient, body: Json): Promise<Response> {
  const avatar = await loadAvatar(service, body.avatar_id);
  if (!avatar) return errorResponse(404, 'not_found', 'Avatar não encontrado.');
  if (avatar.status !== 'active') {
    return errorResponse(409, 'invalid_state', 'Avatar arquivado não pode ser o padrão.');
  }

  // O índice único de "um padrão ativo" obriga a limpar antes de marcar.
  await service.from('brand_avatars').update({ is_default: false }).eq('is_default', true);
  const { error } = await service
    .from('brand_avatars')
    .update({ is_default: true })
    .eq('id', avatar.id);
  if (error) return errorResponse(500, 'internal_error', `Falha ao definir padrão: ${error.message}`);
  return jsonResponse({ ok: true });
}

async function handleArchive(service: ServiceClient, body: Json): Promise<Response> {
  const avatar = await loadAvatar(service, body.avatar_id);
  if (!avatar) return errorResponse(404, 'not_found', 'Avatar não encontrado.');

  // Arquivar solta o posto de padrão; senão a instância ficaria sem avatar ativo
  // e com o índice parcial ainda ocupado por um arquivado.
  const { error } = await service
    .from('brand_avatars')
    .update({ status: 'archived', is_default: false })
    .eq('id', avatar.id);
  if (error) return errorResponse(500, 'internal_error', `Falha ao arquivar: ${error.message}`);
  return jsonResponse({ ok: true });
}

// ── Migração do cadastro legado (director_identities → brand_avatars) ─────────

type LegacyIdentity = {
  id: string;
  name: string;
  description: string | null;
  image_paths: unknown;
  hf_element_id: string | null;
  hf_media_ids: unknown;
  status: string;
  created_by: string | null;
  created_at: string;
};

/**
 * Traz cada avatar do cadastro antigo (menu Avatares) para Apresentadores, sem
 * perder nada e sem gastar crédito:
 *  - MESMO id: director_jobs.brief.identity_id continua apontando certo;
 *  - fotos COPIADAS de renders para brand-assets (o original fica);
 *  - element do Higgsfield já pronto vai para provider_refs.higgsfield.
 * Idempotente: quem já tem linha com o mesmo id é pulado. director_identities
 * não é apagado.
 */
async function handleMigrateIdentities(service: ServiceClient): Promise<Response> {
  const { data: legacy, error } = await service
    .from('director_identities')
    .select('id, name, description, image_paths, hf_element_id, hf_media_ids, status, created_by, created_at')
    .order('created_at');
  if (error) {
    return errorResponse(500, 'internal_error', `Falha ao ler os avatares antigos: ${error.message}`);
  }
  const rows = (legacy ?? []) as LegacyIdentity[];
  if (rows.length === 0) return jsonResponse({ migrated: 0, pending: 0, failed: [] });

  const { data: existing, error: existingError } = await service
    .from('brand_avatars')
    .select('id')
    .in('id', rows.map((r) => r.id));
  if (existingError) {
    return errorResponse(500, 'internal_error', `Falha ao ler os apresentadores: ${existingError.message}`);
  }
  const done = new Set(((existing ?? []) as { id: string }[]).map((r) => r.id));

  let migrated = 0;
  const failed: { id: string; name: string; reason: string }[] = [];
  const warnings: { id: string; name: string; warning: string }[] = [];
  for (const identity of rows) {
    if (done.has(identity.id)) continue;
    try {
      for (const warning of await migrateOne(service, identity)) {
        warnings.push({ id: identity.id, name: identity.name, warning: warning.slice(0, 200) });
      }
      migrated++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error('[avatar-studio] migrate', identity.id, reason);
      failed.push({ id: identity.id, name: identity.name, reason: reason.slice(0, 200) });
    }
  }
  return jsonResponse({ migrated, pending: failed.length, failed, warnings });
}

/** Migra um avatar antigo; devolve os avisos (fotos puladas). */
async function migrateOne(service: ServiceClient, identity: LegacyIdentity): Promise<string[]> {
  const sources = (Array.isArray(identity.image_paths) ? identity.image_paths : [])
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .slice(0, MAX_PHOTOS);

  // Foto que sumiu ou não copiou é PULADA com aviso: a migração nunca trava.
  // Sem nenhuma foto, o apresentador vem só com nome e descrição.
  const photos: string[] = [];
  const warnings: string[] = [];
  for (let i = 0; i < sources.length; i++) {
    const { data: blob, error } = await service.storage.from(LEGACY_BUCKET).download(sources[i]);
    if (error || !blob) {
      warnings.push(`foto ${sources[i]} não encontrada (${error?.message ?? 'vazia'})`);
      continue;
    }
    const ext = sources[i].split('.').pop()?.toLowerCase() || 'png';
    const target = `avatars/${identity.id}/ref-${photos.length + 1}.${ext}`;
    const { error: upError } = await service.storage
      .from(AVATAR_BUCKET)
      .upload(target, blob, { contentType: blob.type || 'image/png', upsert: true });
    if (upError) {
      warnings.push(`cópia de ${sources[i]} falhou (${upError.message})`);
      continue;
    }
    photos.push(target);
  }
  for (const warning of warnings) {
    console.warn('[avatar-studio] migrate', identity.id, warning);
  }

  const mediaIds = Array.isArray(identity.hf_media_ids) ? identity.hf_media_ids : [];
  const higgsfield =
    identity.status === 'ready' && identity.hf_element_id
      ? {
          status: 'ready',
          element_id: identity.hf_element_id,
          media_ids: mediaIds,
          error: null,
          migrated_from: 'director_identities',
        }
      : null;

  // ignoreDuplicates: duas abas migrando ao mesmo tempo não colidem nem sobrescrevem
  const { error } = await service.from('brand_avatars').upsert(
    {
      id: identity.id,
      name: identity.name,
      status: 'active',
      is_default: false,
      appearance_prompt: identity.description,
      reference_image_path: photos[0] ?? null,
      identity_pack_paths: photos,
      voice: {},
      provider_refs: higgsfield ? { higgsfield } : {},
      created_by: identity.created_by,
      created_at: identity.created_at,
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);
  return warnings;
}

// ── HeyGen: biblioteca, vozes, photo avatar, Digital Twin e brand kit ────────
// Contrato: docs/hub-motor-contratos.md. Erro da HeyGen vira frase (heygenHumanError).

const TWIN_PATH_RE = /^director\/uploads\/[0-9a-f-]{36}\.mp4$/;
/** a HeyGen busca o arquivo logo; 6 h cobre fila e retry */
const HEYGEN_URL_TTL_S = 6 * 3600;

async function handleHeygen(service: ServiceClient, action: string, body: Json, userId: string): Promise<Response> {
  const maybeKey = await heygenKeyOrNull(service);
  // teste de voz do ElevenLabs não precisa da HeyGen
  // (voz salva: a própria ação confere a chave do provedor da linha)
  const elevenPreview = action === 'heygen_voice_preview' &&
    (((body.voice ?? {}) as { provider?: unknown }).provider === 'elevenlabs' || body.brand_voice_id !== undefined);
  if (!maybeKey && !elevenPreview) {
    return errorResponse(412, 'not_connected', HEYGEN_NOT_CONNECTED.replace(/ e clique em .*$/, '.'));
  }
  const key = maybeKey ?? '';
  try {
    switch (action) {
      case 'heygen_prompt_avatar':
        return await heygenCreateFor(service, key, body, 'prompt');
      case 'heygen_new_look':
        return await heygenNewLook(service, key, body);
      case 'heygen_look_templates':
        return jsonResponse(await listLookTemplates(key, {
          type: body.type === 'look_pack' || body.type === 'template' ? body.type : undefined,
          gender: body.gender === 'female' || body.gender === 'male' ? body.gender : undefined,
          limit: Number(body.limit) || 20,
          token: typeof body.token === 'string' && body.token ? body.token : undefined,
        }));
      case 'heygen_delete':
        return await heygenDeleteFor(service, key, body);
      case 'heygen_voice_preview':
        return await heygenVoicePreview(service, maybeKey, body, userId);
      case 'heygen_looks': {
        const ownership = body.ownership === 'private' ? 'private' : body.ownership === 'public' ? 'public' : null;
        if (!ownership) return errorResponse(400, 'invalid_input', "ownership deve ser 'public' ou 'private'.");
        const types = ['studio_avatar', 'digital_twin', 'photo_avatar'];
        const q: LookQuery = {
          ownership,
          avatar_type: types.includes(String(body.avatar_type)) ? (body.avatar_type as LookQuery['avatar_type']) : undefined,
          group_id: typeof body.group_id === 'string' && body.group_id ? body.group_id : undefined,
          limit: Number(body.limit) || 24,
          token: typeof body.token === 'string' && body.token ? body.token : undefined,
        };
        const page = await listLooks(key, q);
        // na conta, a voz do avatar pode estar só no grupo; no catálogo público
        // seria um GET por avatar, e a tela pergunta só pelo escolhido
        if (ownership === 'public') return jsonResponse(page);
        return jsonResponse({ ...page, looks: await fillGroupVoices(page.looks, (id) => getGroup(key, id)) });
      }
      case 'heygen_voices': {
        return jsonResponse(await listVoices(key, {
          type: body.type === 'private' ? 'private' : 'public',
          language: typeof body.language === 'string' && body.language ? body.language : undefined,
          gender: body.gender === 'female' || body.gender === 'male' ? body.gender : undefined,
          limit: Number(body.limit) || 50,
          token: typeof body.token === 'string' && body.token ? body.token : undefined,
        }));
      }
      case 'heygen_group_voice': {
        // a voz padrão pode estar só no grupo do avatar, não na look
        if (typeof body.group_id !== 'string' || !body.group_id) {
          return errorResponse(400, 'invalid_input', 'group_id é obrigatório.');
        }
        const group = await getGroup(key, body.group_id);
        return jsonResponse({ default_voice_id: group.default_voice_id });
      }
      case 'heygen_photo_avatar':
        return await heygenCreateFor(service, key, body, 'photo');
      case 'heygen_twin':
        return await heygenCreateFor(service, key, body, 'digital_twin');
      case 'heygen_consent_link': {
        const row = await loadHeygenAvatar(service, body.avatar_id);
        if (!row) return errorResponse(404, 'not_found', 'Apresentador não encontrado.');
        const ref = heygenRefOf(row.provider_refs);
        if (!ref || ref.type !== 'digital_twin' || !ref.group_id) {
          return errorResponse(400, 'invalid_input', 'Este apresentador não tem clone na HeyGen.');
        }
        const attempt = (ref.consent_attempt ?? 0) + 1;
        const consent = await createConsent(key, ref.group_id, idempotencyKey('consent', ref.group_id, attempt));
        const next: HeygenRef = {
          ...refFromHeygen(ref, null, consent.group.id ? consent.group : null),
          consent_url: consent.url, consent_url_at: Date.now(), consent_attempt: attempt,
        };
        await saveHeygenRef(service, row.id, next);
        return jsonResponse({ heygen: next });
      }
      case 'heygen_status': {
        const row = await loadHeygenAvatar(service, body.avatar_id);
        if (!row) return errorResponse(404, 'not_found', 'Apresentador não encontrado.');
        const ref = heygenRefOf(row.provider_refs);
        if (!ref) return jsonResponse({ heygen: null });
        return jsonResponse({ heygen: (await refreshHeygenRef(service, key, row.id, ref)).ref });
      }
      case 'heygen_brand_kit': {
        const { kit, reason } = await ensureBrandKit(service, key, { refresh: body.refresh === true });
        return jsonResponse({
          brand_kit: kit ? { id: kit.id, status: kit.status, site: kit.site, colors_synced: kit.colors_synced } : null,
          reason,
        });
      }
    }
    return errorResponse(400, 'invalid_input', `Ação desconhecida: "${action}".`);
  } catch (err) {
    if (err instanceof HeygenError || /^heygen \d{3}:/.test(err instanceof Error ? err.message : '')) {
      const human = heygenHumanError(err, false);
      if (human instanceof NotConnectedError) return errorResponse(412, 'not_connected', human.message);
      return errorResponse(502, 'heygen_error', human.message);
    }
    throw err;
  }
}

type HeygenAvatarRow = {
  id: string;
  name: string;
  appearance_prompt: string | null;
  reference_image_path: string | null;
  identity_pack_paths: string[] | null;
  provider_refs: Record<string, unknown> | null;
};

async function loadHeygenAvatar(service: ServiceClient, id: unknown): Promise<HeygenAvatarRow | null> {
  if (typeof id !== 'string' || !id) return null;
  const { data } = await service
    .from('brand_avatars')
    .select('id, name, appearance_prompt, reference_image_path, identity_pack_paths, provider_refs')
    .eq('id', id)
    .maybeSingle<HeygenAvatarRow>();
  return data ?? null;
}

/** Próxima tentativa de criação: segue o ref atual, ou o marco deixado pelo heygen_delete. */
function nextAttempt(row: HeygenAvatarRow, prev: HeygenRef | null): number {
  if (prev) return (prev.attempt ?? 0) + 1;
  const mark = (row.provider_refs ?? {}).heygen_next_attempt;
  return typeof mark === 'number' && mark >= 0 ? mark : 0;
}

const KIND_CONFLICT: Record<HeygenAvatarKind, string> = {
  photo: 'Este apresentador já tem um clone na HeyGen.',
  digital_twin: 'Este apresentador já tem uma foto na HeyGen. Crie outro apresentador para o clone.',
  prompt: 'Este apresentador já tem um avatar na HeyGen. Apague o atual ou crie outro apresentador.',
};

async function signBrandAsset(service: ServiceClient, path: string): Promise<string> {
  const { data, error } = await service.storage.from(AVATAR_BUCKET).createSignedUrl(path, HEYGEN_URL_TTL_S);
  if (error || !data?.signedUrl) throw new Error(`foto ${path}: ${error?.message ?? 'sem url'}`);
  return data.signedUrl;
}

/**
 * Cadastra o apresentador na HeyGen, sempre no MESMO registro
 * (provider_refs.heygen, formato de docs/hub-motor-contratos.md §8.1):
 * photo = a foto principal; digital_twin = o vídeo enviado + link de
 * consentimento; prompt = descrição (+ até 3 fotos de referência).
 * Idempotente: ref do mesmo tipo que não falhou volta como está; falhou → nova tentativa.
 */
async function heygenCreateFor(
  service: ServiceClient, key: string, body: Json, type: HeygenAvatarKind,
): Promise<Response> {
  let row = await loadHeygenAvatar(service, body.avatar_id);
  if (!row) return errorResponse(404, 'not_found', 'Apresentador não encontrado.');
  let prev = heygenRefOf(row.provider_refs);
  // "Gerar de novo" (só prompt): reaproveita o pedido salvo, apaga o avatar
  // antigo na HeyGen e cria outro com Idempotency-Key nova
  let saved: { prompt: string | null; reference_paths: string[]; aspect_ratio: string | null } | null = null;
  if (type === 'prompt' && body.regenerate === true) {
    if (prev && prev.type !== 'prompt') return errorResponse(409, 'conflict', KIND_CONFLICT.prompt);
    saved = {
      prompt: prev?.prompt ?? null,
      reference_paths: prev?.reference_paths ?? [],
      aspect_ratio: prev?.aspect_ratio ?? null,
    };
    const prompt = typeof body.prompt === 'string' && body.prompt.trim() ? body.prompt.trim() : saved.prompt;
    if (!prompt) {
      return errorResponse(400, 'invalid_input', 'Não encontramos a descrição usada antes. Descreva o apresentador para gerar de novo.');
    }
    if (prev) {
      await removeHeygenAvatar(service, key, row.id, prev);
      // a foto do cadastro que veio da preview antiga sai, para a nova entrar
      if (/\/heygen-preview\.[a-z]+$/.test(row.reference_image_path ?? '')) {
        const { error } = await updatePresenterFace(service, row.id, () => ({ reference_image_path: null }));
        if (error) throw new Error(`limpar a preview antiga: ${error}`);
      }
      row = (await loadHeygenAvatar(service, row.id)) ?? row;
      prev = null;
    }
  } else if (prev && prev.status !== 'failed') {
    if (prev.type !== type) return errorResponse(409, 'conflict', KIND_CONFLICT[type]);
    return jsonResponse({ heygen: prev });
  }

  const attempt = nextAttempt(row, prev);
  const idem = idempotencyKey('avatar', row.id, type, attempt);
  let created;
  let promptInput: Pick<HeygenRef, 'prompt' | 'reference_paths' | 'aspect_ratio'> | null = null;
  if (type === 'prompt') {
    const prompt = (typeof body.prompt === 'string' && body.prompt.trim()
      ? body.prompt
      : saved?.prompt ?? row.appearance_prompt ?? '').trim();
    if (!prompt || prompt.length > PROMPT_MAX_CHARS) {
      return errorResponse(400, 'invalid_input', 'Descreva o apresentador em até 1.000 caracteres.');
    }
    const refs = Array.isArray(body.reference_paths) ? body.reference_paths : saved?.reference_paths ?? [];
    if (refs.length > PROMPT_MAX_REFS) return errorResponse(400, 'invalid_input', 'Use até 3 fotos de referência.');
    if (refs.some((p) => typeof p !== 'string' || !p.startsWith('avatars/') || p.includes('..'))) {
      return errorResponse(400, 'invalid_input', 'Foto de referência inválida.');
    }
    const wanted = typeof body.aspect_ratio === 'string' ? body.aspect_ratio : saved?.aspect_ratio;
    const aspect = wanted && (PROMPT_ASPECT_RATIOS as readonly string[]).includes(wanted) ? wanted : '9:16';
    const referenceUrls: string[] = [];
    for (const p of refs as string[]) referenceUrls.push(await signBrandAsset(service, p));
    created = await createAvatar(key, { type: 'prompt', name: row.name, prompt, referenceUrls, aspectRatio: aspect }, idem);
    promptInput = { prompt, reference_paths: refs as string[], aspect_ratio: aspect };
  } else if (type === 'photo') {
    const photo = row.reference_image_path || (row.identity_pack_paths ?? [])[0];
    if (!photo) return errorResponse(400, 'invalid_input', 'Este apresentador não tem foto.');
    created = await createAvatar(key, { type, name: row.name, url: await signBrandAsset(service, photo) }, idem);
  } else {
    const path = typeof body.video_path === 'string' ? body.video_path : '';
    if (!TWIN_PATH_RE.test(path)) return errorResponse(400, 'invalid_input', 'Envie o vídeo em MP4.');
    const { data, error } = await signed(service, path);
    if (error || !data?.signedUrl) return errorResponse(400, 'invalid_input', 'Vídeo enviado não encontrado. Envie de novo.');
    created = await createAvatar(key, { type, name: row.name, url: data.signedUrl }, idem);
  }

  let ref: HeygenRef = { ...newHeygenRef(type, created.look, created.group, attempt), ...(promptInput ?? {}) };
  // grava ANTES do consentimento: falhar o link não perde o avatar pago
  await saveHeygenRef(service, row.id, ref);
  if (type === 'digital_twin' && ref.group_id) {
    try {
      const consent = await createConsent(key, ref.group_id, idempotencyKey('consent', ref.group_id, 0));
      ref = { ...ref, consent_url: consent.url, consent_url_at: Date.now() };
      await saveHeygenRef(service, row.id, ref);
    } catch (err) {
      console.error('[avatar-studio] consentimento do twin:', err instanceof Error ? err.message : err);
    }
  }
  if (ref.status === 'completed') {
    await ensurePreviewPhoto(service, row.id, ref.preview_image_url)
      .catch((err) => console.warn('[avatar-studio] preview → foto:', err instanceof Error ? err.message : err));
  }
  return jsonResponse({ heygen: ref });
}

/** Visual novo do mesmo avatar: por descrição (POST /v3/avatars prompt) ou por pacote (POST /v3/avatars/looks). */
async function heygenNewLook(service: ServiceClient, key: string, body: Json): Promise<Response> {
  const row = await loadHeygenAvatar(service, body.avatar_id);
  if (!row) return errorResponse(404, 'not_found', 'Apresentador não encontrado.');
  const ref = heygenRefOf(row.provider_refs);
  if (!ref || ref.status !== 'completed') {
    return errorResponse(400, 'invalid_input', 'Este apresentador ainda não tem avatar pronto na HeyGen.');
  }
  const n = ref.looks.length;
  const mode = body.mode;
  let ids: string[];
  let source: 'prompt' | 'look_pack' | 'template';
  if (mode === 'prompt') {
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt || prompt.length > PROMPT_MAX_CHARS) {
      return errorResponse(400, 'invalid_input', 'Descreva o visual em até 1.000 caracteres.');
    }
    const aspect = typeof body.aspect_ratio === 'string' && (PROMPT_ASPECT_RATIOS as readonly string[]).includes(body.aspect_ratio)
      ? body.aspect_ratio
      : '9:16';
    const created = await createAvatar(key, {
      type: 'prompt', name: row.name, prompt, avatarId: ref.look_id, groupId: ref.group_id, aspectRatio: aspect,
    }, idempotencyKey('look', row.id, 'prompt', shortHash(prompt), n));
    ids = [created.look.id];
    source = 'prompt';
  } else if (mode === 'look_pack' || mode === 'template') {
    const templateId = typeof body.template_id === 'string' ? body.template_id.trim() : '';
    if (!templateId || templateId.length > 128) return errorResponse(400, 'invalid_input', 'Escolha um pacote de visuais.');
    const created = await createLooks(key, buildCreateLooksBody({
      type: mode, referenceLookId: ref.look_id, templateId,
      aspectRatio: typeof body.aspect_ratio === 'string' ? body.aspect_ratio : '9:16',
    }), idempotencyKey('look', row.id, mode, templateId, n));
    ids = created.look_ids;
    source = mode;
  } else {
    return errorResponse(400, 'invalid_input', "mode deve ser 'prompt', 'look_pack' ou 'template'.");
  }
  const known = new Set(ref.looks.map((l) => l.id));
  const next: HeygenRef = {
    ...ref,
    looks: [
      ...ref.looks,
      ...ids.filter((id) => !known.has(id) && id !== ref.look_id).map((id) => ({
        id, status: 'processing', preview_image_url: null, supported_api_engines: [], source,
      })),
    ],
    updated_at: new Date().toISOString(),
  };
  await saveHeygenRef(service, row.id, next);
  return jsonResponse({ heygen: next, new_look_ids: ids });
}

/**
 * Apaga na HeyGen o grupo (com as looks) ou a look, e a voz clonada do twin;
 * limpa provider_refs.heygen. Registro, fotos e o ref do Higgsfield ficam.
 */
async function heygenDeleteFor(service: ServiceClient, key: string, body: Json): Promise<Response> {
  const row = await loadHeygenAvatar(service, body.avatar_id);
  if (!row) return errorResponse(404, 'not_found', 'Apresentador não encontrado.');
  const ref = heygenRefOf(row.provider_refs);
  if (!ref) return errorResponse(400, 'invalid_input', 'Este apresentador não tem avatar na HeyGen.');
  const deleted = await removeHeygenAvatar(service, key, row.id, ref);
  return jsonResponse({ ok: true, deleted });
}

/**
 * Apaga na HeyGen o grupo (ou a look) e a voz clonada do twin, limpa
 * provider_refs.heygen e deixa o marco da próxima tentativa (a Idempotency-Key
 * antiga repetiria o avatar apagado por 24 h).
 */
async function removeHeygenAvatar(
  service: ServiceClient, key: string, avatarId: string, ref: HeygenRef,
): Promise<{ group: string | null; look: string | null; voice: string | null }> {
  const deleted: { group: string | null; look: string | null; voice: string | null } = { group: null, look: null, voice: null };
  if (ref.group_id) {
    await deleteAvatarGroup(key, ref.group_id);
    deleted.group = ref.group_id;
  } else {
    await deleteAvatarLook(key, ref.look_id);
    deleted.look = ref.look_id;
  }
  // só a voz do twin é nossa (clone); a de foto/descrição é do catálogo da HeyGen
  if (ref.type === 'digital_twin' && ref.default_voice_id) {
    try {
      await deleteVoice(key, ref.default_voice_id);
      deleted.voice = ref.default_voice_id;
    } catch (err) {
      console.warn('[avatar-studio] voz do twin:', err instanceof Error ? err.message : err);
    }
  }
  await saveHeygenRef(service, avatarId, null);
  const { data } = await service.from('brand_avatars').select('provider_refs').eq('id', avatarId).maybeSingle();
  const refs = { ...((data as { provider_refs?: Record<string, unknown> } | null)?.provider_refs ?? {}) };
  refs.heygen_next_attempt = (ref.attempt ?? 0) + 1;
  const { error } = await service.from('brand_avatars').update({ provider_refs: refs }).eq('id', avatarId);
  if (error) throw new Error(error.message);
  return deleted;
}

const VOICE_TEST_TEXT = 'Olá! Esta é a voz que vai apresentar os seus vídeos.';
const VOICE_TEST_MAX = 200;
const ELEVEN_ID_RE = /^[A-Za-z0-9]{10,40}$/;

/**
 * Áudio curto de teste com a voz escolhida (ElevenLabs, HeyGen ou a do twin),
 * salvo em brand-assets/avatars/voice-previews/<hash>.mp3 e devolvido como URL
 * assinada. Mesmo provedor + voz + texto reaproveita o arquivo.
 */
async function heygenVoicePreview(
  service: ServiceClient, key: string | null, body: Json, userId: string,
): Promise<Response> {
  const voice = (body.voice ?? {}) as { provider?: unknown; voice_id?: unknown };
  const text = typeof body.text === 'string' && body.text.trim() ? body.text.trim() : VOICE_TEST_TEXT;
  if (text.length > VOICE_TEST_MAX) return errorResponse(400, 'invalid_input', 'O texto de teste pode ter até 200 caracteres.');
  let provider = voice.provider;
  let voiceId = typeof voice.voice_id === 'string' ? voice.voice_id.trim() : '';
  if (body.brand_voice_id !== undefined) {
    // voz salva em Vozes (brand_voices): o provedor vem da linha
    const row = await loadBrandVoice(service, body.brand_voice_id);
    if (!row) return errorResponse(404, 'not_found', 'Voz não encontrada.');
    const ref = voiceRefOf(row);
    if (!ref) return errorResponse(400, 'invalid_input', 'A voz ainda não está pronta.');
    provider = ref.provider === 'elevenlabs' ? 'elevenlabs' : ref.heygen_model ? 'heygen_model' : 'heygen';
    voiceId = ref.voice_id;
  } else if (provider === 'twin') {
    const row = await loadHeygenAvatar(service, body.avatar_id);
    if (!row) return errorResponse(404, 'not_found', 'Apresentador não encontrado.');
    const ref = heygenRefOf(row.provider_refs);
    voiceId = ref?.type === 'digital_twin' ? ref.default_voice_id ?? '' : '';
    if (!voiceId) return errorResponse(400, 'invalid_input', 'Este apresentador não tem voz clonada na HeyGen.');
  } else if (provider === 'elevenlabs') {
    if (!ELEVEN_ID_RE.test(voiceId)) return errorResponse(400, 'invalid_input', 'Escolha uma voz para testar.');
  } else if (provider === 'heygen' || provider === 'heygen_model') {
    if (!voiceId || voiceId.length > 128) return errorResponse(400, 'invalid_input', 'Escolha uma voz para testar.');
  } else {
    return errorResponse(400, 'invalid_input', 'Escolha uma voz para testar.');
  }

  const path = `avatars/voice-previews/${shortHash(`${provider}:${voiceId}:${text}`)}${shortHash(text)}.mp3`;
  const cached = await service.storage.from(AVATAR_BUCKET).createSignedUrl(path, 3600);
  if (!cached.error && cached.data?.signedUrl) return jsonResponse({ url: cached.data.signedUrl, path, cached: true });

  const limited = await enforceRateLimit(userId, 'avatar-studio');
  if (limited) return limited;

  let bytes: Uint8Array;
  let contentType = 'audio/mpeg';
  if (provider === 'elevenlabs') {
    const { data: elevenKey } = await service.rpc('get_vault_secret', { _name: 'ELEVEN_API_KEY' });
    if (!elevenKey) return errorResponse(412, 'not_connected', 'Cole a chave do ElevenLabs em Config → Integrações.');
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': elevenKey as string, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_v3', voice_settings: { stability: 0.5 } }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 200);
      if (r.status === 401) return errorResponse(412, 'not_connected', 'A chave do ElevenLabs foi recusada. Salve outra em Config → Integrações.');
      if (r.status === 404 || r.status === 400) return errorResponse(400, 'invalid_input', 'Essa voz não existe no ElevenLabs.');
      return errorResponse(502, 'elevenlabs_error', `O ElevenLabs não gerou o teste (${r.status}): ${detail}`);
    }
    bytes = new Uint8Array(await r.arrayBuffer());
  } else {
    if (!key) return errorResponse(412, 'not_connected', HEYGEN_NOT_CONNECTED.replace(/ e clique em .*$/, '.'));
    // TODO: a spec manda clone profissional para /v3/models/audio/tts; o clone
    // instantâneo do twin em /v3/voices/speech não está confirmado
    const speech = provider === 'heygen_model'
      ? await heygenModelTts(key, { text, voiceId })
      : await createSpeech(key, { text, voiceId, language: 'pt' });
    const r = await fetch(speech.audio_url, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) return errorResponse(502, 'heygen_error', `Não deu para baixar o áudio de teste da HeyGen (${r.status}).`);
    contentType = (r.headers.get('content-type') ?? 'audio/mpeg').split(';')[0].trim() || 'audio/mpeg';
    bytes = new Uint8Array(await r.arrayBuffer());
  }
  const { error: upErr } = await service.storage.from(AVATAR_BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (upErr) throw new Error(`upload do teste de voz: ${upErr.message}`);
  const { data, error } = await service.storage.from(AVATAR_BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error(`teste de voz: ${error?.message ?? 'sem url'}`);
  return jsonResponse({ url: data.signedUrl, path, cached: false });
}

// ── Construtor de voz (brand_voices) ─────────────────────────────────────────
// Contrato: docs/hub-motor-contratos.md §9. O servidor escolhe o provedor; a
// tela só escolhe o caminho. Erro de provedor vira VoiceError (status + frase).

const VOICE_BUCKET = AVATAR_BUCKET;
const VOICE_UPLOAD_PREFIX = 'voices/uploads/';
const VOICE_UPLOAD_RE = /^voices\/uploads\/[0-9a-f-]{36}\.(wav|mp3)$/;
const VOICE_EXT: Record<string, string> = { 'audio/wav': 'wav', 'audio/mpeg': 'mp3' };
const UUID_ONLY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ServiceVoiceRow = BrandVoiceRow;

async function vaultSecret(service: ServiceClient, name: string): Promise<string | null> {
  const { data } = await service.rpc('get_vault_secret', { _name: name });
  return typeof data === 'string' && data ? data : null;
}

async function signVoice(service: ServiceClient, path: string | null, ttl = 3600): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await service.storage.from(VOICE_BUCKET).createSignedUrl(path, ttl);
  return error ? null : data?.signedUrl ?? null;
}

async function voiceView(service: ServiceClient, row: ServiceVoiceRow) {
  return {
    id: row.id, name: row.name, provider: row.provider, provider_voice_id: row.provider_voice_id,
    source: row.source, status: row.status, error: row.error, gender: row.gender, language: row.language,
    owned: row.owned, is_default: row.is_default, preview_url: await signVoice(service, row.preview_path),
    created_at: row.created_at,
  };
}

const VOICE_SELECT =
  'id, name, provider, provider_voice_id, source, status, error, gender, language, sample_path, preview_path, ' +
  'owned, is_default, attempt, created_at';

async function insertVoice(service: ServiceClient, row: Record<string, unknown>): Promise<ServiceVoiceRow> {
  const { data, error } = await service.from('brand_voices').insert(row).select(VOICE_SELECT).single();
  if (error) {
    if (/duplicate key|brand_voices_provider_voice/i.test(error.message)) {
      // a mesma voz do provedor já está em Vozes: devolve a que existe
      const { data: existing } = await service.from('brand_voices').select(VOICE_SELECT)
        .eq('provider', row.provider as string).eq('provider_voice_id', row.provider_voice_id as string).maybeSingle();
      if (existing) return existing as unknown as ServiceVoiceRow;
    }
    if (/relation .*brand_voices.* does not exist/i.test(error.message)) {
      throw new VoiceError(500, 'not_installed', 'As vozes da marca ainda não foram instaladas (brand-voices.sql).');
    }
    throw new Error(`brand_voices: ${error.message}`);
  }
  return data as unknown as ServiceVoiceRow;
}

async function updateVoice(service: ServiceClient, id: string, patch: Record<string, unknown>): Promise<ServiceVoiceRow> {
  const { data, error } = await service.from('brand_voices').update(patch).eq('id', id).select(VOICE_SELECT).single();
  if (error) throw new Error(`brand_voices: ${error.message}`);
  return data as unknown as ServiceVoiceRow;
}

function cleanName(v: unknown, fallback: string): string {
  const name = typeof v === 'string' ? v.trim() : '';
  return (name || fallback).slice(0, VOICE_NAME_MAX);
}

function cleanGender(v: unknown): 'female' | 'male' | null {
  return v === 'female' || v === 'male' ? v : null;
}

/** Estado dos provedores para escolher o caminho (nunca falha: falta de leitura = desconhecido). */
async function voiceProviderState(service: ServiceClient) {
  const elevenKey = await vaultSecret(service, 'ELEVEN_API_KEY');
  const heygen = await heygenKeyOrNull(service);
  let sub: ElevenSubscription | null = null;
  if (elevenKey) sub = await elevenSubscription(elevenKey).catch(() => null);
  return {
    elevenKey, heygen, sub,
    state: {
      eleven: {
        connected: Boolean(elevenKey),
        can_clone: sub ? sub.can_use_instant_voice_cloning : null,
        slots_used: sub ? sub.voice_slots_used : null,
        slot_limit: sub ? sub.voice_limit : null,
      },
      heygen: { connected: Boolean(heygen) },
    },
  };
}

/** Rótulo de custo de cada caminho pelas linhas voice_create do catálogo; texto fixo sem linha. */
async function voiceCostLabels(service: ServiceClient, providers: Record<VoicePath, string | null>): Promise<Record<VoicePath, string>> {
  const fixed: Record<VoicePath, string> = { own: 'a confirmar', describe: 'a confirmar', library: 'grátis', paste: 'grátis' };
  const model: Record<VoicePath, Record<string, string>> = {
    own: { elevenlabs: 'elevenlabs/voice-clone-instant', heygen: 'heygen/voice-clone-instant' },
    describe: { elevenlabs: 'elevenlabs/voice-design', heygen: 'heygen/voice-design' },
    library: { elevenlabs: 'elevenlabs/voice-library' },
    paste: {},
  };
  const { data, error } = await service.from('video_models').select('*').eq('capability', 'voice_create');
  const rows = error ? [] : ((data ?? []) as { model_id: string; cost?: { usd?: number; verified?: boolean } }[]);
  const out = { ...fixed };
  for (const path of Object.keys(fixed) as VoicePath[]) {
    const provider = providers[path];
    const id = provider ? model[path][provider] : undefined;
    const row = id ? rows.find((r) => r.model_id === id) : undefined;
    out[path] = costLabel(row?.cost, fixed[path]);
  }
  return out;
}

async function handleVoice(
  service: ServiceClient, action: string, body: Json, userId: string, req: Request,
): Promise<Response> {
  try {
    switch (action) {
      case 'voice_options': {
        const { state, sub } = await voiceProviderState(service);
        const paths = voicePaths(state, body.prefer === 'heygen' ? 'heygen' : null);
        const labels = await voiceCostLabels(service, {
          own: paths.own.provider, describe: paths.describe.provider, library: paths.library.provider, paste: paths.paste.provider,
        });
        const withCost = Object.fromEntries(
          (Object.keys(paths) as VoicePath[]).map((k) => [k, { ...paths[k], cost_label: labels[k] }]),
        );
        return jsonResponse({
          paths: withCost,
          eleven: { ...state.eleven, tier: sub?.tier ?? null },
          heygen: state.heygen,
        });
      }
      case 'voice_upload_url': {
        const ext = VOICE_EXT[typeof body.content_type === 'string' ? body.content_type : ''];
        if (!ext) return errorResponse(400, 'invalid_input', 'Envie o áudio em WAV ou MP3.');
        const path = `${VOICE_UPLOAD_PREFIX}${crypto.randomUUID()}.${ext}`;
        const { data, error } = await service.storage.from(VOICE_BUCKET).createSignedUploadUrl(path);
        if (error || !data?.token) {
          return errorResponse(500, 'internal', `Não foi possível preparar o envio: ${error?.message ?? 'sem token'}`);
        }
        return jsonResponse({ path, token: data.token });
      }
      case 'voice_clone':
        return await voiceClone(service, body, userId);
      case 'voice_design':
        return await voiceDesign(service, body);
      case 'voice_design_save':
        return await voiceDesignSave(service, body, userId);
      case 'voice_library':
        return await voiceLibrary(service, body);
      case 'voice_library_add':
        return await voiceLibraryAdd(service, body, userId);
      case 'voice_import': {
        if (body.from_settings === true) return await voiceImportFromSettings(service, userId);
        const id = typeof body.voice_id === 'string' ? body.voice_id.trim() : '';
        if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return errorResponse(400, 'invalid_input', 'Voice ID inválido.');
        const key = await vaultSecret(service, 'ELEVEN_API_KEY');
        if (!key) return errorResponse(412, 'not_connected', 'Cole a chave do ElevenLabs em Config → Integrações.');
        let v;
        try {
          v = await elevenGetVoice(key, id);
        } catch (err) {
          const human = elevenHuman(err, 'ler a voz');
          if (human instanceof VoiceError && human.status === 404) {
            return errorResponse(404, 'not_found', 'Esse Voice ID não existe no ElevenLabs.');
          }
          throw human;
        }
        const row = await insertVoice(service, {
          name: cleanName(body.name, v.name), provider: 'elevenlabs', provider_voice_id: v.voice_id, source: 'pasted',
          status: 'ready', gender: cleanGender(v.gender), owned: false, created_by: userId,
        });
        return jsonResponse({ voice: await voiceView(service, row) });
      }
      case 'voice_status':
        return await voiceStatus(service, body);
      case 'voice_set_default':
        return await voiceSetDefault(service, body, req);
      case 'voice_delete':
        return await voiceDelete(service, body);
    }
    return errorResponse(400, 'invalid_input', `Ação desconhecida: "${action}".`);
  } catch (err) {
    if (err instanceof VoiceError) return errorResponse(err.status, err.code, err.message);
    if (err instanceof HeygenError || /^heygen \d{3}:/.test(err instanceof Error ? err.message : '')) {
      const status = (err as HeygenError).status ?? null;
      if (status === 429) {
        return errorResponse(429, 'daily_limit', 'Limite de clones de hoje atingido. Tente amanhã ou use outro caminho.');
      }
      if (status === 402) return errorResponse(402, 'no_credits', 'Os créditos da HeyGen acabaram.');
      const human = heygenHumanError(err, false);
      if (human instanceof NotConnectedError) return errorResponse(412, 'not_connected', human.message);
      return errorResponse(502, 'heygen_error', human.message);
    }
    throw err;
  }
}

/**
 * Traz a voz de Config → Integrações (ELEVEN_VOICE_ID no Vault, lida com o
 * service role como o motor já lê) para Vozes. Idempotente: a linha que já
 * existe para esse Voice ID volta como está. Nome do GET da voz quando der.
 */
async function voiceImportFromSettings(service: ServiceClient, userId: string): Promise<Response> {
  const voiceId = (await vaultSecret(service, 'ELEVEN_VOICE_ID'))?.trim() ?? '';
  if (!/^[A-Za-z0-9]{10,40}$/.test(voiceId)) {
    return errorResponse(400, 'invalid_input', 'Nenhuma voz da marca configurada em Integrações.');
  }
  const existing = await findBrandVoice(service, 'elevenlabs', voiceId);
  if (existing) return jsonResponse({ voice: await voiceView(service, existing) });
  let name = 'Voz da marca';
  let gender: 'female' | 'male' | null = null;
  const key = await vaultSecret(service, 'ELEVEN_API_KEY');
  if (key) {
    try {
      const v = await elevenGetVoice(key, voiceId);
      name = cleanName(v.name, name);
      gender = cleanGender(v.gender);
    } catch (err) {
      console.warn('[voices] nome da voz de Integrações:', err instanceof Error ? err.message : err);
    }
  }
  const row = await insertVoice(service, {
    name, provider: 'elevenlabs', provider_voice_id: voiceId, source: 'pasted', status: 'ready', gender,
    owned: false, created_by: userId,
  });
  return jsonResponse({ voice: await voiceView(service, row) });
}

/** Clone "Da minha voz": ElevenLabs IVC quando o plano e as vagas deixam; senão HeyGen. */
async function voiceClone(service: ServiceClient, body: Json, userId: string): Promise<Response> {
  if (body.consent !== true) return errorResponse(400, 'invalid_input', 'Confirme que a voz é sua.');
  const sample = typeof body.sample_path === 'string' ? body.sample_path : '';
  if (!VOICE_UPLOAD_RE.test(sample)) return errorResponse(400, 'invalid_input', 'Envie o áudio em WAV ou MP3.');
  const { data: blob, error: dlErr } = await service.storage.from(VOICE_BUCKET).download(sample);
  if (dlErr || !blob) return errorResponse(400, 'invalid_input', 'Áudio enviado não encontrado. Envie de novo.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength > CLONE_MAX_BYTES) return errorResponse(400, 'invalid_input', 'O áudio passa de 100 MB. Grave de 1 a 3 min.');
  const isWav = sample.endsWith('.wav');
  const seconds = isWav ? wavDurationSeconds(bytes) : (typeof body.duration_s === 'number' ? body.duration_s : null);
  if (seconds != null && seconds < CLONE_MIN_S) return errorResponse(400, 'invalid_input', 'Grave pelo menos 30 s.');

  let name = typeof body.name === 'string' ? body.name : '';
  if (!name.trim() && typeof body.avatar_id === 'string') {
    const { data } = await service.from('brand_avatars').select('name').eq('id', body.avatar_id).maybeSingle();
    name = (data as { name?: string } | null)?.name ?? '';
  }
  const gender = cleanGender(body.gender);
  const { elevenKey, heygen, state } = await voiceProviderState(service);
  const choice = voicePaths(state, body.prefer === 'heygen' ? 'heygen' : null).own;
  if (!choice.provider) {
    const code = /cheias/.test(choice.blocked_reason ?? '') ? 'slots_full' : 'not_connected';
    return errorResponse(code === 'slots_full' ? 409 : 412, code, choice.blocked_reason ?? 'Conecte um provedor de voz.');
  }

  // a linha nasce antes: o id entra no caminho da amostra e na Idempotency-Key
  const id = crypto.randomUUID();
  const ext = isWav ? 'wav' : 'mp3';
  const samplePath = `voices/${id}/sample.${ext}`;
  const { error: cpErr } = await service.storage.from(VOICE_BUCKET).copy(sample, samplePath);
  if (cpErr) throw new Error(`amostra da voz: ${cpErr.message}`);
  await service.storage.from(VOICE_BUCKET).remove([sample]).catch(() => {});
  let row = await insertVoice(service, {
    id, name: cleanName(name, 'Minha voz'), provider: choice.provider, source: 'clone', status: 'processing',
    gender, sample_path: samplePath, owned: true, consent_at: new Date().toISOString(), consent_by: userId,
    created_by: userId,
  });

  if (choice.provider === 'elevenlabs') {
    try {
      const voiceId = await elevenCloneIVC(elevenKey as string, {
        name: row.name, bytes, filename: `amostra.${ext}`, contentType: isWav ? 'audio/wav' : 'audio/mpeg', gender,
      });
      row = await updateVoice(service, id, { provider_voice_id: voiceId, status: 'ready', error: null });
      return jsonResponse({ voice: await voiceView(service, row) });
    } catch (err) {
      const human = elevenHuman(err, 'clonar a voz');
      // plano/permissão recusou o IVC: a HeyGen clona no lugar, se estiver conectada
      const fallback = heygen && human instanceof VoiceError && [403, 409, 412].includes(human.status);
      if (!fallback) {
        await updateVoice(service, id, { status: 'failed', error: human.message }).catch(() => {});
        throw human;
      }
      row = await updateVoice(service, id, { provider: 'heygen' });
    }
  }
  const url = await signVoice(service, samplePath, 6 * 3600);
  if (!url) throw new Error('não deu para assinar a amostra da voz');
  try {
    const voiceId = await heygenCloneVoice(heygen as string, { name: row.name, url, gender },
      idempotencyKey('voice', id, row.attempt ?? 0));
    row = await updateVoice(service, id, { provider_voice_id: voiceId, status: 'processing', error: null });
  } catch (err) {
    const status = (err as HeygenError).status ?? null;
    const message = status === 429
      ? 'Limite de clones de hoje atingido. Tente amanhã ou use outro caminho.'
      : heygenHumanError(err, false).message;
    await updateVoice(service, id, { status: 'failed', error: message, attempt: (row.attempt ?? 0) + 1 }).catch(() => {});
    throw err;
  }
  return jsonResponse({ voice: await voiceView(service, row) });
}

/** "De uma descrição": 3 prévias. preview_id opaco ("el:<generated_voice_id>" | "hg:<voice_id>"). */
async function voiceDesign(service: ServiceClient, body: Json): Promise<Response> {
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (description.length < DESIGN_MIN || description.length > DESIGN_MAX) {
    return errorResponse(400, 'invalid_input', 'Descreva a voz com 20 a 1.000 caracteres.');
  }
  const { elevenKey, heygen, state } = await voiceProviderState(service);
  const provider = voicePaths(state).describe.provider;
  if (!provider) return errorResponse(412, 'not_connected', 'Conecte o ElevenLabs ou a HeyGen para criar vozes.');
  if (provider === 'elevenlabs') {
    let previews;
    try {
      previews = await elevenDesign(elevenKey as string, description);
    } catch (err) {
      const human = elevenHuman(err, 'desenhar a voz');
      // plano sem Voice Design: a HeyGen procura vozes parecidas
      if (!(heygen && human instanceof VoiceError && human.status === 403)) throw human;
      return jsonResponse({ provider: 'heygen', previews: await heygenDesignPreviews(heygen, description, body.gender) });
    }
    const out: { preview_id: string; url: string | null }[] = [];
    for (const p of previews) {
      const bin = Uint8Array.from(atob(p.audio_base_64), (c) => c.charCodeAt(0));
      const ext = /wav/.test(p.media_type) ? 'wav' : 'mp3';
      const path = `voices/previews/${p.generated_voice_id.replace(/[^A-Za-z0-9_-]/g, '')}.${ext}`;
      const { error } = await service.storage.from(VOICE_BUCKET).upload(path, bin, { contentType: p.media_type || 'audio/mpeg', upsert: true });
      if (error) throw new Error(`prévia da voz: ${error.message}`);
      out.push({ preview_id: `el:${p.generated_voice_id}`, url: await signVoice(service, path) });
    }
    return jsonResponse({ provider: 'elevenlabs', previews: out });
  }
  return jsonResponse({ provider: 'heygen', previews: await heygenDesignPreviews(heygen as string, description, body.gender) });
}

async function heygenDesignPreviews(key: string, description: string, gender: unknown) {
  const voices = await heygenDesignVoices(key, { prompt: description, gender: cleanGender(gender) });
  return voices.map((v) => ({ preview_id: `hg:${v.voice_id}`, url: v.preview_audio_url }));
}

async function voiceDesignSave(service: ServiceClient, body: Json, userId: string): Promise<Response> {
  const previewId = typeof body.preview_id === 'string' ? body.preview_id : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const name = cleanName(body.name, 'Voz da marca');
  const gender = cleanGender(body.gender);
  if (previewId.startsWith('hg:') && previewId.length > 3) {
    const row = await insertVoice(service, {
      name, provider: 'heygen', provider_voice_id: previewId.slice(3), source: 'design', status: 'ready',
      gender, owned: false, created_by: userId,
    });
    return jsonResponse({ voice: await voiceView(service, row) });
  }
  if (!previewId.startsWith('el:') || previewId.length <= 3) {
    return errorResponse(404, 'not_found', 'A prévia expirou. Gere de novo.');
  }
  if (description.length < DESIGN_MIN || description.length > DESIGN_MAX) {
    return errorResponse(400, 'invalid_input', 'Descreva a voz com 20 a 1.000 caracteres.');
  }
  const key = await vaultSecret(service, 'ELEVEN_API_KEY');
  if (!key) return errorResponse(412, 'not_connected', 'Cole a chave do ElevenLabs em Config → Integrações.');
  const generated = previewId.slice(3);
  let voiceId: string;
  try {
    voiceId = await elevenDesignSave(key, { generated_voice_id: generated, name, description, gender });
  } catch (err) {
    const human = elevenHuman(err, 'salvar a voz');
    if (human instanceof VoiceError && (human.status === 404 || human.status === 502)) {
      return errorResponse(404, 'not_found', 'A prévia expirou. Gere de novo.');
    }
    throw human;
  }
  const previewPath = `voices/previews/${generated.replace(/[^A-Za-z0-9_-]/g, '')}.mp3`;
  const row = await insertVoice(service, {
    name, provider: 'elevenlabs', provider_voice_id: voiceId, source: 'design', status: 'ready', gender,
    owned: true, preview_path: previewPath, created_by: userId,
  });
  return jsonResponse({ voice: await voiceView(service, row) });
}

/** Biblioteca pt-BR do ElevenLabs; recusada pelo plano ou sem chave → catálogo pt da HeyGen. */
async function voiceLibrary(service: ServiceClient, body: Json): Promise<Response> {
  const search = typeof body.search === 'string' ? body.search.trim() : '';
  const gender = cleanGender(body.gender) ?? undefined;
  const token = typeof body.token === 'string' ? body.token : '';
  const elevenKey = await vaultSecret(service, 'ELEVEN_API_KEY');
  let notice: string | null = null;
  if (elevenKey && !token.startsWith('hg:')) {
    try {
      const page = Number(token) || 0;
      const lib = await elevenSharedVoices(elevenKey, { search, gender, page });
      return jsonResponse({ provider: 'elevenlabs', voices: lib.voices, next_token: lib.has_more ? String(page + 1) : null, notice });
    } catch (err) {
      const human = elevenHuman(err, 'abrir a biblioteca');
      if (!(human instanceof VoiceError && (human.status === 403 || human.status === 412))) throw human;
      notice = 'Biblioteca do ElevenLabs exige plano Creator.';
    }
  }
  const heygen = await heygenKeyOrNull(service);
  if (!heygen) {
    return jsonResponse({ provider: null, voices: [], next_token: null, notice: notice ?? 'Conecte o ElevenLabs ou a HeyGen para criar vozes.' });
  }
  const list = await listVoices(heygen, {
    type: 'public', language: 'Portuguese', gender, limit: 50, token: token.startsWith('hg:') ? token.slice(3) : undefined,
  });
  const q = search.toLowerCase();
  return jsonResponse({
    provider: 'heygen',
    voices: list.voices
      .filter((v) => !q || v.name.toLowerCase().includes(q))
      .map((v) => ({ ref: v.voice_id, name: v.name, gender: v.gender || null, accent: null, preview_url: v.preview_audio_url })),
    next_token: list.next_token ? `hg:${list.next_token}` : null,
    notice,
  });
}

async function voiceLibraryAdd(service: ServiceClient, body: Json, userId: string): Promise<Response> {
  const ref = typeof body.ref === 'string' ? body.ref.trim() : '';
  if (!ref || ref.length > 200) return errorResponse(400, 'invalid_input', 'Escolha uma voz da lista.');
  const gender = cleanGender(body.gender);
  if (body.provider === 'heygen') {
    const row = await insertVoice(service, {
      name: cleanName(body.name, 'Voz da biblioteca'), provider: 'heygen', provider_voice_id: ref, source: 'library',
      status: 'ready', gender, owned: false, created_by: userId,
    });
    return jsonResponse({ voice: await voiceView(service, row) });
  }
  if (body.provider !== 'elevenlabs') return errorResponse(400, 'invalid_input', 'Escolha uma voz da lista.');
  const key = await vaultSecret(service, 'ELEVEN_API_KEY');
  if (!key) return errorResponse(412, 'not_connected', 'Cole a chave do ElevenLabs em Config → Integrações.');
  const name = cleanName(body.name, 'Voz da biblioteca');
  let voiceId: string;
  try {
    voiceId = await elevenAddShared(key, ref, name);
  } catch (err) {
    throw err instanceof VoiceError ? err : elevenHuman(err, 'adicionar a voz da biblioteca');
  }
  // entra na conta (sem ocupar vaga): apagar em Vozes tira de lá também
  const row = await insertVoice(service, {
    name, provider: 'elevenlabs', provider_voice_id: voiceId, source: 'library', status: 'ready', gender,
    owned: true, created_by: userId,
  });
  return jsonResponse({ voice: await voiceView(service, row) });
}

async function voiceStatus(service: ServiceClient, body: Json): Promise<Response> {
  let row = await loadBrandVoice(service, body.voice_id);
  if (!row) return errorResponse(404, 'not_found', 'Voz não encontrada.');
  if (row.status === 'processing' && row.provider === 'heygen' && row.source === 'clone' && row.provider_voice_id) {
    const key = await heygenKeyOrNull(service);
    if (key) {
      const v = await heygenModelVoice(key, row.provider_voice_id);
      if (v.status === 'ACTIVE') {
        let previewPath: string | null = null;
        if (v.preview_audio_url) {
          try {
            const r = await fetch(v.preview_audio_url, { signal: AbortSignal.timeout(30_000) });
            if (r.ok) {
              previewPath = `voices/${row.id}/preview.wav`;
              await service.storage.from(VOICE_BUCKET).upload(previewPath, new Uint8Array(await r.arrayBuffer()), {
                contentType: 'audio/wav', upsert: true,
              });
            }
          } catch (err) {
            console.warn('[voices] prévia do clone:', err instanceof Error ? err.message : err);
            previewPath = null;
          }
        }
        row = await updateVoice(service, row.id, { status: 'ready', error: null, ...(previewPath ? { preview_path: previewPath } : {}) });
      } else if (v.status === 'FAILED') {
        row = await updateVoice(service, row.id, {
          status: 'failed', error: heygenCloneFailure(v.failure_reason), attempt: (row.attempt ?? 0) + 1,
        });
      }
    }
  }
  return jsonResponse({ voice: await voiceView(service, row) });
}

/**
 * Marca a voz padrão. ElevenLabs: também grava ELEVEN_VOICE_ID no Vault (o
 * valor que a narração lê hoje), pelo store_vault_secret com o JWT de quem
 * chamou (a função revalida admin por auth.uid()). Falhar aqui não desfaz a marcação.
 */
async function voiceSetDefault(service: ServiceClient, body: Json, req: Request): Promise<Response> {
  const row = await loadBrandVoice(service, body.voice_id);
  if (!row) return errorResponse(404, 'not_found', 'Voz não encontrada.');
  if (row.status !== 'ready' || !row.provider_voice_id) {
    return errorResponse(400, 'invalid_input', 'A voz ainda não está pronta.');
  }
  const { error: clearErr } = await service.from('brand_voices').update({ is_default: false })
    .eq('is_default', true).neq('id', row.id);
  if (clearErr) throw new Error(`brand_voices: ${clearErr.message}`);
  await updateVoice(service, row.id, { is_default: true });
  let synced = false;
  if (row.provider === 'elevenlabs') {
    const { error } = await createUserClient(req).rpc('store_vault_secret', {
      _name: 'ELEVEN_VOICE_ID', _value: row.provider_voice_id,
    });
    if (error) console.error('[voices] ELEVEN_VOICE_ID:', error.message);
    synced = !error;
  }
  return jsonResponse({ ok: true, eleven_voice_id_synced: synced });
}

async function voiceDelete(service: ServiceClient, body: Json): Promise<Response> {
  if (typeof body.voice_id !== 'string' || !UUID_ONLY_RE.test(body.voice_id)) {
    return errorResponse(404, 'not_found', 'Voz não encontrada.');
  }
  const row = await loadBrandVoice(service, body.voice_id);
  if (!row) return errorResponse(404, 'not_found', 'Voz não encontrada.');
  if (row.is_default) return errorResponse(409, 'conflict', 'Essa é a voz padrão. Escolha outra antes.');
  let deleted = false;
  if (row.owned && row.provider_voice_id) {
    if (row.provider === 'elevenlabs') {
      const key = await vaultSecret(service, 'ELEVEN_API_KEY');
      if (!key) return errorResponse(412, 'not_connected', 'Cole a chave do ElevenLabs em Config → Integrações para apagar a voz.');
      try {
        deleted = await elevenDeleteVoice(key, row.provider_voice_id);
      } catch (err) {
        throw elevenHuman(err, 'apagar a voz');
      }
    } else {
      const key = await heygenKeyOrNull(service);
      if (!key) return errorResponse(412, 'not_connected', HEYGEN_NOT_CONNECTED.replace(/ e clique em .*$/, '.'));
      deleted = row.source === 'clone' ? await heygenDeleteModelVoice(key, row.provider_voice_id) : false;
    }
  }
  const files = [row.sample_path, row.preview_path].filter((p): p is string => Boolean(p && p.startsWith(`voices/${row.id}/`)));
  if (files.length) await service.storage.from(VOICE_BUCKET).remove(files).catch(() => {});
  const { error } = await service.from('brand_voices').delete().eq('id', row.id);
  if (error) throw new Error(`brand_voices: ${error.message}`);
  return jsonResponse({ ok: true, deleted_at_provider: deleted });
}
