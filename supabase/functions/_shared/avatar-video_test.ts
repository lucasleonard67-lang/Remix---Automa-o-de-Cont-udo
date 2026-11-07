import { assert, assertEquals } from 'jsr:@std/assert@1';

import {
  chooseAvatarVoice, type HeygenRef, heygenRefOf, lookBelongsTo, mergeExtraLooks, savedHeygenVoice, newHeygenRef, parseFileRef, refFromHeygen, validateAvatarVideo,
  validateVideoAgent,
} from './avatar-video.ts';
import { normalizeGroup, normalizeLook } from './heygen.ts';

const PRESENTER = '0b7f2c1e-1111-4222-8333-444455556666';

Deno.test('validateAvatarVideo: roteiro, quem apresenta, provedor e formato', () => {
  assertEquals(validateAvatarVideo({ script: 'Oi', look_id: 'L1' }), null);
  assertEquals(validateAvatarVideo({ script: '', look_id: 'L1' }), 'O roteiro precisa ter de 1 a 5.000 caracteres.');
  assertEquals(validateAvatarVideo({ script: 'x'.repeat(5001), look_id: 'L1' }), 'O roteiro precisa ter de 1 a 5.000 caracteres.');
  assertEquals(validateAvatarVideo({ script: 'Oi' }), 'Escolha quem apresenta o vídeo.');
  assertEquals(validateAvatarVideo({ script: 'Oi', look_id: 'L1', presenter_id: PRESENTER }), null, 'look + apresentador = visual dele');
  assertEquals(validateAvatarVideo({ script: 'Oi', look_id: 'L1', aspect_ratio: '3:2' }), 'Formato de vídeo inválido. Escolha de novo.');
  assertEquals(validateAvatarVideo({ script: 'Oi', provider: 'replicate', look_id: 'L1' }), 'Escolha quem apresenta o vídeo.');
  assertEquals(
    validateAvatarVideo({ script: 'Oi', provider: 'replicate', presenter_id: PRESENTER, voice: { provider: 'heygen' } }),
    'A voz HeyGen só funciona com avatar HeyGen.',
  );
  assertEquals(validateAvatarVideo({ script: 'Oi', provider: 'replicate', presenter_id: PRESENTER, model_id: 'bytedance/omni-human' }), null);
});

Deno.test('validateVideoAgent e parseFileRef', () => {
  assertEquals(validateVideoAgent({ prompt: 'Um vídeo sobre o produto' }), null);
  assertEquals(validateVideoAgent({ prompt: '' }), 'Descreva o vídeo em até 10.000 caracteres.');
  assertEquals(validateVideoAgent({ prompt: 'x', file_paths: ['renders:director/uploads/a.jpg', 'brand-assets:logo.png'] }), null);
  assertEquals(validateVideoAgent({ prompt: 'x', file_paths: ['outro:a.jpg'] }), 'Arquivo anexado inválido.');
  assertEquals(validateVideoAgent({ prompt: 'x', file_paths: ['renders:../segredo'] }), 'Arquivo anexado inválido.');
  assertEquals(validateVideoAgent({ prompt: 'x', file_paths: Array(21).fill('renders:a.jpg') }), 'Anexe até 20 arquivos.');
  assertEquals(parseFileRef('brand-assets:avatars/x/ref-1.jpg'), { bucket: 'brand-assets', path: 'avatars/x/ref-1.jpg' });
});

const base: HeygenRef = {
  type: 'digital_twin', group_id: 'G', look_id: 'L', status: 'processing', consent_status: 'pending',
  consent_url: 'https://c', consent_url_at: 1, supported_api_engines: [], preview_image_url: null, default_voice_id: null,
  error: null, ready: false, looks: [], attempt: 0, consent_attempt: 0, updated_at: '',
};

Deno.test('refFromHeygen: twin só fica pronto com look completed e consentimento aceito', () => {
  const look = normalizeLook({ id: 'L', name: 'Eu', avatar_type: 'digital_twin', status: 'completed', supported_api_engines: ['avatar_v'] });
  const pending = refFromHeygen(base, look, normalizeGroup({ id: 'G', consent_status: 'pending' }));
  assert(!pending.ready);
  const ok = refFromHeygen(base, look, normalizeGroup({ id: 'G', consent_status: 'accepted', default_voice_id: 'VV' }));
  assert(ok.ready);
  assertEquals(ok.supported_api_engines, ['avatar_v']);
  assertEquals(ok.default_voice_id, 'VV');
  const failed = refFromHeygen(base, normalizeLook({ id: 'L', status: 'failed', error: { code: 'x', message: 'Vídeo escuro' } }), null);
  assertEquals(failed.status, 'failed');
  assertEquals(failed.error, 'Vídeo escuro');
  assert(!failed.ready);
  const photo = refFromHeygen({ ...base, type: 'photo', consent_status: null }, normalizeLook({ id: 'L', status: 'completed' }), null);
  assert(photo.ready);
  assertEquals(photo.consent_status, null);
});

Deno.test('heygenRefOf: só ref com look_id', () => {
  assertEquals(heygenRefOf({ higgsfield: {} }), null);
  assertEquals(heygenRefOf(null), null);
  assertEquals(heygenRefOf({ heygen: base })?.look_id, 'L');
});

Deno.test('heygenRefOf: lê o formato antigo (engines) no canônico', () => {
  const old = { type: 'photo', group_id: 'G', look_id: 'L', status: 'completed', engines: ['avatar_iv'], ready: true };
  const ref = heygenRefOf({ heygen: old })!;
  assertEquals(ref.supported_api_engines, ['avatar_iv']);
  assertEquals(ref.preview_image_url, null);
  assertEquals(ref.looks, []);
  assert(!('engines' in ref));
  assertEquals(heygenRefOf({ heygen: { ...old, type: 'prompt', supported_api_engines: ['avatar_v'] } })!.supported_api_engines, ['avatar_v']);
});

Deno.test('newHeygenRef e mergeExtraLooks: base canônica e visuais extras atualizados', () => {
  const look = normalizeLook({
    id: 'L', group_id: 'G', avatar_type: 'photo_avatar', status: 'processing', preview_image_url: 'https://p',
    supported_api_engines: ['avatar_iv'],
  });
  const ref = newHeygenRef('prompt', look, null, 2);
  assertEquals([ref.type, ref.group_id, ref.look_id, ref.preview_image_url, ref.attempt], ['prompt', 'G', 'L', 'https://p', 2]);
  assertEquals(ref.consent_status, null);
  const withLooks = { ...ref, looks: [{ id: 'X', status: 'processing', preview_image_url: null, supported_api_engines: [], source: 'look_pack' as const }] };
  const merged = mergeExtraLooks(withLooks, [normalizeLook({ id: 'X', status: 'completed', preview_image_url: 'https://x' })]);
  assertEquals(merged.looks[0].status, 'completed');
  assertEquals(merged.looks[0].preview_image_url, 'https://x');
});

Deno.test('chooseAvatarVoice: job → voz do avatar → comportamento de antes', () => {
  const eleven = savedHeygenVoice({ heygen_voice: { provider: 'elevenlabs', voice_id: 'EXAVITQu4vr4xnSDxMaL' } });
  const twin = savedHeygenVoice({ heygen_voice: { provider: 'twin' } });
  // voz explícita do job vence
  assertEquals(chooseAvatarVoice({ provider: 'heygen', voice_id: 'H1' }, eleven, null, 'LV'), { provider: 'heygen', voice_id: 'H1', source: 'job' });
  // sem voz no job: a do avatar
  assertEquals(chooseAvatarVoice(null, eleven, null, 'LV'), { provider: 'elevenlabs', voice_id: 'EXAVITQu4vr4xnSDxMaL', source: 'avatar' });
  assertEquals(chooseAvatarVoice({ provider: 'heygen' }, twin, 'TV', 'LV'), { provider: 'heygen', voice_id: 'TV', source: 'avatar' });
  // job escolheu só o provedor: voz salva de outro provedor não entra
  assertEquals(chooseAvatarVoice({ provider: 'heygen' }, eleven, null, 'LV'), { provider: 'heygen', voice_id: 'LV', source: 'default' });
  // twin sem voz clonada ainda: comportamento de antes
  assertEquals(chooseAvatarVoice({ provider: 'elevenlabs' }, twin, null, 'LV'), { provider: 'elevenlabs', voice_id: null, source: 'default' });
  assertEquals(chooseAvatarVoice(undefined, null, null, null), { provider: 'elevenlabs', voice_id: null, source: 'default' });
  assertEquals(savedHeygenVoice({ heygen_voice: { provider: 'outro' } }), null);
});

Deno.test('lookBelongsTo: principal ou extra', () => {
  const ref = { ...base, looks: [{ id: 'X', status: 'completed', preview_image_url: null, supported_api_engines: [], source: 'prompt' as const }] };
  assert(lookBelongsTo(ref, 'L'));
  assert(lookBelongsTo(ref, 'X'));
  assert(!lookBelongsTo(ref, 'Y'));
});
