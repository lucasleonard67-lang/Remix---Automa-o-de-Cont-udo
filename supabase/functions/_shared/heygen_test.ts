// Testes do cliente HeyGen v3: só decisões puras, nenhuma chamada de rede.

import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1';

import {
  buildAvatarVideoBody, buildCreateAvatarBody, buildCreateLooksBody, buildVideoAgentBody, colorRolesFromPalette, consentState, HeygenError, heygenBusy,
  heygenHumanError, idempotencyKey, normalizeLook, pickEngine, shortHash, videoResult,
} from './heygen.ts';
import { NotConnectedError } from './not-connected.ts';

Deno.test('pickEngine: respeita o pedido só se a look aceita; senão avatar_iv; lista vazia = sem engine', () => {
  assertEquals(pickEngine(['avatar_v', 'avatar_iv'], 'avatar_v'), 'avatar_v');
  assertEquals(pickEngine(['avatar_iv'], 'avatar_v'), 'avatar_iv');
  assertEquals(pickEngine(['avatar_iii', 'avatar_v'], null), 'avatar_iii');
  assertEquals(pickEngine(['avatar_iii', 'avatar_v', 'avatar_iv'], 'avatar_x'), 'avatar_iv');
  assertEquals(pickEngine([], 'avatar_v'), null);
  assertEquals(pickEngine(['algo_novo'], null), null);
});

Deno.test('idempotencyKey: só caracteres aceitos e até 255', () => {
  assertEquals(idempotencyKey('job 1', 'avatar_video', 0), 'job-1:avatar_video:0');
  assertMatch(idempotencyKey('a/b?c', 'x'), /^[A-Za-z0-9_:.-]+$/);
  assertEquals(idempotencyKey('x'.repeat(300)).length, 255);
  assertEquals(shortHash('https://a.com'), shortHash('https://a.com'));
  assert(shortHash('https://a.com') !== shortHash('https://b.com'));
});

Deno.test('normalizeLook: engines desconhecidos saem; erro vira texto', () => {
  const look = normalizeLook({
    id: 'L1', name: 'Ana', avatar_type: 'photo_avatar', group_id: 'G1',
    supported_api_engines: ['avatar_iv', 'avatar_vi', 'avatar_v'],
    status: 'failed', error: { code: 'bad_photo', message: 'Rosto não encontrado' },
  });
  assertEquals(look.supported_api_engines, ['avatar_iv', 'avatar_v']);
  assertEquals(look.error, 'Rosto não encontrado');
  assertEquals(look.preview_image_url, null);
});

Deno.test('consentState: accepted/rejected/pending e nulo', () => {
  assertEquals(consentState('accepted'), 'accepted');
  assertEquals(consentState('APPROVED'), 'accepted');
  assertEquals(consentState('rejected'), 'rejected');
  assertEquals(consentState('pending'), 'pending');
  assertEquals(consentState('waiting'), 'pending');
  assertEquals(consentState(null), null);
});

Deno.test('buildAvatarVideoBody: áudio exclui roteiro; 4k só no avatar_iii; motion/expressiveness por tipo', () => {
  const photo = { id: 'L1', avatar_type: 'photo_avatar', supported_api_engines: ['avatar_iv', 'avatar_v'] as const };
  const a = buildAvatarVideoBody({
    look: { ...photo, supported_api_engines: [...photo.supported_api_engines] },
    audio_url: 'https://x/a.mp3', script: 'ignorado', voice_id: 'v', resolution: '4k', motion_prompt: 'acena',
  });
  assertEquals(a.engine, 'avatar_iv');
  assertEquals(a.body.audio_url, 'https://x/a.mp3');
  assert(!('script' in a.body) && !('voice_id' in a.body));
  assertEquals(a.body.resolution, '1080p');
  assertEquals(a.body.aspect_ratio, '9:16');
  assertEquals(a.body.engine, { type: 'avatar_iv' });
  assertEquals(a.body.motion_prompt, 'acena');
  assertEquals(a.body.expressiveness, 'medium');
  assert(!('caption' in a.body));

  const v = buildAvatarVideoBody({
    look: { id: 'L1', avatar_type: 'photo_avatar', supported_api_engines: ['avatar_v'] },
    script: 'Olá', voice_id: 'V1', engine: 'avatar_v', burn_captions: true, aspect_ratio: '16:9',
  });
  assert(!('expressiveness' in v.body), 'avatar_v recusa expressiveness');
  assertEquals(v.body.caption, { file_format: 'srt', style: 'default' });
  assertEquals(v.body.script, 'Olá');
  assertEquals(v.body.voice_id, 'V1');
  assertEquals(v.body.aspect_ratio, '16:9');

  const twin = buildAvatarVideoBody({
    look: { id: 'T', avatar_type: 'digital_twin', supported_api_engines: ['avatar_iii', 'avatar_iv'] },
    script: 'x', engine: 'avatar_iii', resolution: '4k', motion_prompt: 'anda',
  });
  assertEquals(twin.body.resolution, '4k');
  assert(!('motion_prompt' in twin.body), 'twin só aceita motion_prompt no avatar_v');
  assert(!('voice_id' in twin.body), 'sem voice_id: a voz padrão do grupo');

  const none = buildAvatarVideoBody({ look: { id: 'S', avatar_type: 'studio_avatar', supported_api_engines: [] }, script: 'x' });
  assert(!('engine' in none.body));
});

Deno.test('buildVideoAgentBody: modo generate, privado, até 20 arquivos', () => {
  const body = buildVideoAgentBody({
    prompt: 'Um vídeo sobre a marca', brand_kit_id: 'BK', file_urls: Array.from({ length: 25 }, (_, i) => `https://f/${i}`),
  });
  assertEquals(body.mode, 'generate');
  assertEquals(body.visibility, 'private');
  assertEquals(body.orientation, 'portrait');
  assertEquals((body.files as unknown[]).length, 20);
  assert(!('avatar_id' in body));
});

Deno.test('colorRolesFromPalette: só hex válido, primary cai para brand', () => {
  assertEquals(colorRolesFromPalette({ brand: '#abc', accent: 'FF0000', text: '#111111', secondary: 'azul' }), {
    primary: '#AABBCC', accent: '#FF0000',
  });
  assertEquals(colorRolesFromPalette(null), {});
});

Deno.test('erros HeyGen viram frase com o que fazer', () => {
  assert(heygenHumanError(new HeygenError('heygen 401: {}', 401)) instanceof NotConnectedError);
  assertMatch(heygenHumanError(new Error('heygen 402: {"code":"insufficient_credit"}')).message, /sem créditos/);
  assertMatch(heygenHumanError(new HeygenError('heygen 400: invalid engine', 400)).message, /motor/);
  assert(heygenBusy(new HeygenError('heygen 429: slow down', 429)));
  assert(!heygenBusy(new Error('outro')));
});

Deno.test('videoResult: legendado quando pedido, falha com código', () => {
  const done = { id: 'v', status: 'completed', video_url: 'https://v', captioned_video_url: 'https://c', duration: 12, failure_code: null, failure_message: null };
  assertEquals(videoResult(done, 'o vídeo'), 'https://v');
  assertEquals(videoResult(done, 'o vídeo', true), 'https://c');
  assertEquals(videoResult({ ...done, status: 'processing' }, 'o vídeo'), null);
  let msg = '';
  try {
    videoResult({ ...done, status: 'failed', failure_code: 'X1', failure_message: 'ruim' }, 'o vídeo');
  } catch (e) {
    msg = (e as Error).message;
  }
  assertMatch(msg, /\[X1\]: ruim/);
});

Deno.test('buildCreateAvatarBody: foto/twin levam file; prompt leva prompt, até 3 refs e aspecto válido', () => {
  assertEquals(buildCreateAvatarBody({ type: 'photo', name: 'Ana', url: 'https://f' }), {
    type: 'photo', name: 'Ana', file: { type: 'url', url: 'https://f' },
  });
  const p = buildCreateAvatarBody({
    type: 'prompt', name: 'Ana', prompt: 'x'.repeat(1200), referenceUrls: ['a', 'b', 'c', 'd'],
    avatarId: 'L1', groupId: 'G1', aspectRatio: '9:16',
  });
  assertEquals((p.prompt as string).length, 1000);
  assertEquals((p.reference_images as unknown[]).length, 3);
  assertEquals(p.avatar_id, 'L1');
  assertEquals(p.avatar_group_id, 'G1');
  assertEquals(p.aspect_ratio, '9:16');
  assert(!('file' in p));
  const q = buildCreateAvatarBody({ type: 'prompt', name: 'B', prompt: 'p', aspectRatio: '3:2' });
  assert(!('aspect_ratio' in q) && !('reference_images' in q));
});

Deno.test('buildCreateLooksBody: aspect_ratio só no look_pack', () => {
  assertEquals(buildCreateLooksBody({ type: 'look_pack', referenceLookId: 'L', templateId: 'T', aspectRatio: '9:16' }), {
    type: 'look_pack', reference_look_id: 'L', template_id: 'T', aspect_ratio: '9:16',
  });
  assertEquals(buildCreateLooksBody({ type: 'template', referenceLookId: 'L', templateId: 'T', aspectRatio: '9:16' }), {
    type: 'template', reference_look_id: 'L', template_id: 'T',
  });
});
