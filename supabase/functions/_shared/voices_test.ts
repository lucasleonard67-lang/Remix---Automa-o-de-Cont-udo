// Testes do construtor de voz: só decisões puras, nenhuma chamada de rede.

import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1';

import {
  avatarVoiceAsClone, buildHeygenCloneBody, buildHeygenTtsBody, costLabel, defaultFitsGender, DESIGN_PREVIEW_TEXT, ElevenHttpError, elevenHuman,
  heygenCloneFailure, VoiceError, voicePaths, voiceRefOf, wavDurationSeconds,
} from './voices.ts';

const off = { connected: false, can_clone: null, slots_used: null, slot_limit: null };

Deno.test('voicePaths: IVC só com plano e vaga; senão HeyGen; nada conectado bloqueia com saída', () => {
  const p1 = voicePaths({ eleven: { connected: true, can_clone: true, slots_used: 1, slot_limit: 10 }, heygen: { connected: true } });
  assertEquals(p1.own.provider, 'elevenlabs');
  // Pay-as-you-go sem IVC (a conta do dono): clone vai para a HeyGen
  const p2 = voicePaths({ eleven: { connected: true, can_clone: false, slots_used: 0, slot_limit: 0 }, heygen: { connected: true } });
  assertEquals(p2.own.provider, 'heygen');
  assertEquals(p2.describe.provider, 'elevenlabs');
  const p3 = voicePaths({ eleven: { connected: true, can_clone: true, slots_used: 10, slot_limit: 10 }, heygen: { connected: false } });
  assertEquals(p3.own.provider, null);
  assertMatch(p3.own.blocked_reason ?? '', /cheias \(10\/10\)/);
  const p4 = voicePaths({ eleven: off, heygen: { connected: false } });
  assertEquals(p4.own.blocked_reason, 'Conecte o ElevenLabs ou a HeyGen para criar vozes.');
  assertEquals(p4.paste.provider, null);
  const p5 = voicePaths({ eleven: off, heygen: { connected: true } });
  assertEquals([p5.own.provider, p5.describe.provider, p5.library.provider, p5.paste.provider], ['heygen', 'heygen', 'heygen', null]);
});

Deno.test('voicePaths: num fluxo HeyGen, o clone nasce na HeyGen', () => {
  const eleven = { connected: true, can_clone: true, slots_used: 1, slot_limit: 10 };
  assertEquals(voicePaths({ eleven, heygen: { connected: true } }, 'heygen').own.provider, 'heygen');
  // sem HeyGen conectada, o pedido não vira beco sem saída
  assertEquals(voicePaths({ eleven, heygen: { connected: false } }, 'heygen').own.provider, 'elevenlabs');
});

Deno.test('wavDurationSeconds: lê o cabeçalho PCM; não-WAV = null', () => {
  const rate = 44100;
  const seconds = 2;
  const dataSize = rate * 2 * seconds; // mono 16-bit
  const buf = new Uint8Array(44 + dataSize);
  const v = new DataView(buf.buffer);
  const put = (o: number, s: string) => [...s].forEach((c, i) => (buf[o + i] = c.charCodeAt(0)));
  put(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); put(8, 'WAVE');
  put(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  put(36, 'data'); v.setUint32(40, dataSize, true);
  assertEquals(wavDurationSeconds(buf), 2);
  assertEquals(wavDurationSeconds(new Uint8Array(100)), null);
});

Deno.test('buildHeygenCloneBody: instant, pt, similarity max, nome ≤64, gênero só válido', () => {
  const b = buildHeygenCloneBody({ name: 'x'.repeat(80), url: 'https://a/s.wav', gender: 'female' });
  assertEquals(b.mode, 'instant');
  assertEquals((b.name as string).length, 64);
  assertEquals(b.audio, [{ type: 'url', url: 'https://a/s.wav' }]);
  assertEquals([b.language, b.similarity, b.remove_background_noise, b.gender], ['pt', 'max', true, 'female']);
  assert(!('gender' in buildHeygenCloneBody({ name: 'a', url: 'u', gender: 'outro' })));
});

Deno.test('buildHeygenTtsBody: clone instantâneo com expressiveness_boost 0.5', () => {
  const b = buildHeygenTtsBody({ text: 'Olá', voiceId: 'V' });
  assertEquals([b.model, b.voice_id, b.language, b.expressiveness_boost], ['heygen-voice-1', 'V', 'pt', 0.5]);
});

Deno.test('voiceRefOf: só voz pronta; clone HeyGen fala pelo TTS próprio', () => {
  const base = { provider: 'heygen' as const, provider_voice_id: 'V', source: 'clone' as const, status: 'ready' as const, gender: null };
  assertEquals(voiceRefOf(base), { provider: 'heygen', voice_id: 'V', heygen_model: true, gender: null });
  assertEquals(voiceRefOf({ ...base, source: 'library' })?.heygen_model, false);
  assertEquals(voiceRefOf({ ...base, status: 'processing' }), null);
  assertEquals(voiceRefOf({ ...base, provider_voice_id: null }), null);
  assertEquals(voiceRefOf(null), null);
});

Deno.test('erros: ElevenLabs e HeyGen viram frase e status do contrato', () => {
  const plan = elevenHuman(new ElevenHttpError(403, '{"detail":{"status":"free_users_not_allowed","message":"x"}}'), 'adicionar a voz');
  assert(plan instanceof VoiceError && plan.status === 403);
  const slots = elevenHuman(new ElevenHttpError(400, '{"detail":{"status":"voice_limit_reached","message":"limit"}}'), 'clonar');
  assertEquals((slots as VoiceError).code, 'slots_full');
  assertEquals((elevenHuman(new ElevenHttpError(401, 'bad'), 'clonar') as VoiceError).status, 412);
  assertEquals((elevenHuman(new ElevenHttpError(404, 'nope'), 'ler') as VoiceError).status, 404);
  assertMatch(heygenCloneFailure('INVALID_AUDIO'), /Grave de novo/);
  assertMatch(heygenCloneFailure('TRAINING_FAILED'), /TRAINING_FAILED/);
});

Deno.test('costLabel, gênero da voz padrão e texto das prévias', () => {
  assertEquals(costLabel({ usd: 0, verified: true }, 'x'), 'grátis');
  assertEquals(costLabel({ usd: 1, verified: false }, 'x'), 'a confirmar');
  assertEquals(costLabel(null, 'fixo'), 'fixo');
  assert(defaultFitsGender({ gender: 'female' }, 'female'));
  assert(defaultFitsGender({ gender: null }, null));
  assert(!defaultFitsGender({ gender: null }, 'male'));
  assert(DESIGN_PREVIEW_TEXT.length >= 100 && DESIGN_PREVIEW_TEXT.length <= 1000);
});

Deno.test('avatarVoiceAsClone: só voz do avatar, HeyGen, que é clone HeyGen Voice pronto', () => {
  const clone = { provider: 'heygen' as const, provider_voice_id: 'V', source: 'clone' as const, status: 'ready' as const, gender: null };
  const choice = { provider: 'heygen', voice_id: 'V', source: 'avatar' };
  assertEquals(avatarVoiceAsClone(choice, clone), { provider: 'heygen', voice_id: 'V', heygen_model: true, gender: null });
  assertEquals(avatarVoiceAsClone(choice, { ...clone, source: 'library' }), null, 'catálogo segue como voice_id');
  assertEquals(avatarVoiceAsClone({ ...choice, source: 'job' }, clone), null);
  assertEquals(avatarVoiceAsClone({ ...choice, provider: 'elevenlabs' }, clone), null);
  assertEquals(avatarVoiceAsClone(choice, { ...clone, status: 'processing' }), null);
  assertEquals(avatarVoiceAsClone(choice, { ...clone, provider_voice_id: 'OUTRA' }), null);
  assertEquals(avatarVoiceAsClone(choice, null), null);
});
