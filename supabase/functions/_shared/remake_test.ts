// Testes puros do modo remake (sem serviço pago): ordem das etapas, validação,
// prompt e o cliente da HeyGen com fetch mockado.
//   npx -y deno@2.1.4 test --no-lock supabase/functions/_shared/remake_test.ts
import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1';

import {
  buildVisualPrompt, heygenCreateLipsync, heygenCreateTranslation, heygenGetLipsync, heygenResult,
  needsOriginalAudio, nextRemakeStage, remakeStages, speechMismatchError, validateRemake, type RemakeConfig,
} from './remake.ts';

const base: RemakeConfig = { source_path: 'director/uploads/a.mp4', duration_s: 12 };

Deno.test('ordem das etapas: visual → fala → tradução', () => {
  const all = { ...base, style: 'anime', scene: 'praia', speech: 'Olá', translate: 'en' };
  assertEquals(remakeStages(all), ['visual', 'speech', 'translate']);
  assertEquals(nextRemakeStage(all, []), 'visual');
  assertEquals(nextRemakeStage(all, ['visual']), 'speech');
  assertEquals(nextRemakeStage(all, ['visual', 'speech']), 'translate');
  assertEquals(nextRemakeStage(all, ['visual', 'speech', 'translate']), null);
});

Deno.test('estilo e cena viram UMA etapa visual; a pessoa troca antes, em etapa própria', () => {
  assertEquals(remakeStages({ ...base, style: 'anime', scene: 'x' }), ['visual']);
  assertEquals(remakeStages({ ...base, style: 'anime', scene: 'x', character_identity_id: 'id' }), ['person', 'visual']);
  assertEquals(remakeStages({ ...base, character_identity_id: 'id', speech: 'Oi' }), ['person', 'speech']);
});

Deno.test('troca de pessoa sozinha mantém o áudio do modelo (sem devolver o original)', () => {
  assert(!needsOriginalAudio({ ...base, character_identity_id: 'id' }));
  assert(needsOriginalAudio({ ...base, character_identity_id: 'id', style: 'anime' }));
});

Deno.test('validação: instrução e modelo da troca de pessoa', () => {
  const p = { ...base, character_identity_id: 'id' };
  assertEquals(validateRemake({ ...p, character_prompt: 'mantenha o óculos', person_model_id: 'prunaai/p-video-replace' }), null);
  assertEquals(validateRemake({ ...p, person_model_id: 'não é slug' }), 'Escolha um modelo de troca de pessoa da lista.');
  assertEquals(validateRemake({ ...p, character_prompt: 'a'.repeat(501) }), 'A instrução da troca de pessoa pode ter até 500 caracteres.');
});

Deno.test('só fala: sem etapa visual', () => {
  assertEquals(remakeStages({ ...base, speech: 'Oi' }), ['speech']);
});

Deno.test('áudio original volta só quando o visual mudou e nada trouxe áudio novo', () => {
  assert(needsOriginalAudio({ ...base, style: 'anime' }));
  assert(!needsOriginalAudio({ ...base, style: 'anime', speech: 'Oi' }));
  assert(!needsOriginalAudio({ ...base, style: 'anime', translate: 'es' }));
  assert(!needsOriginalAudio({ ...base, speech: 'Oi' }));
});

Deno.test('validação: mensagens para a pessoa', () => {
  assertEquals(validateRemake({ ...base, source_path: '' }), 'Suba o vídeo que você quer melhorar.');
  assertEquals(validateRemake({ ...base, duration_s: 1, style: 'anime' }), 'O vídeo precisa ter pelo menos 2 segundos.');
  assertEquals(validateRemake({ ...base, duration_s: 45, style: 'anime' }), 'Use um vídeo de até 30 segundos.');
  assertEquals(validateRemake({ ...base, style: 'inventado' }), 'Escolha um dos estilos da lista.');
  assertEquals(validateRemake({ ...base, translate: 'xx' }), 'Escolha um dos idiomas da lista.');
  assertEquals(validateRemake(base), 'Marque pelo menos uma melhoria.');
  assertEquals(validateRemake(base, { hasCaptions: true }), null);
  assertEquals(validateRemake({ ...base, speech: 'a'.repeat(601) }), 'A fala nova pode ter até 600 caracteres.');
  assertEquals(validateRemake({ ...base, style: 'anime', duration_s: 30.2 }), null);
});

Deno.test('validação: modelo e voz escolhidos na lista são slugs do catálogo (ou nulos)', () => {
  assertEquals(validateRemake({ ...base, style: 'anime', scene_model_id: 'runwayml/aleph-2' }), null);
  assertEquals(validateRemake({ ...base, style: 'anime', scene_model_id: null }), null);
  assertEquals(validateRemake({ ...base, style: 'anime', scene_model_id: 'não é slug' }), 'Escolha um modelo de vídeo da lista.');
  assertEquals(validateRemake({ ...base, speech: 'Oi', tts_model_id: 'minimax/speech-02-hd' }), null);
  assertEquals(validateRemake({ ...base, speech: 'Oi', tts_model_id: 'elevenlabs' }), 'Escolha uma voz da lista.');
});

Deno.test('prompt: estilo da marca com cores, cena traduzida e preservação (a pessoa não vai ao Aleph)', () => {
  const p = buildVisualPrompt(
    { ...base, style: 'marca', scene: 'num escritório', character_identity_id: 'x' },
    { sceneEnglish: 'in a modern office', brandColors: ['#276EF5', '#0B1220'] },
  );
  assertMatch(p, /brand palette #276EF5, #0B1220/);
  assertMatch(p, /Change only this in the scene: in a modern office\./);
  assert(!/reference image/.test(p));
  assertMatch(p, /Keep everything else identical: same camera motion, framing, timing, gestures and mouth movements\./);
  assert(p.length <= 1000);
});

Deno.test('prompt: cena crua quando a tradução falhou', () => {
  assertMatch(buildVisualPrompt({ ...base, scene: 'na praia' }), /Change only this in the scene: na praia\./);
});

// HeyGen: confere o corpo enviado contra a documentação (sem chamar a API real)
Deno.test('HeyGen: lipsync e tradução no formato da API v3', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const body = url.endsWith('/v3/lipsyncs')
      ? { data: { lipsync_id: 'ls_1' } }
      : url.endsWith('/v3/video-translations')
        ? { data: { video_translation_ids: ['tr_1-en'] } }
        : { data: { id: 'ls_1', status: 'completed', video_url: 'https://files.heygen.ai/x.mp4' } };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }) as typeof fetch;
  try {
    assertEquals(await heygenCreateLipsync('k', 'https://v', 'https://a'), 'ls_1');
    assertEquals(await heygenCreateTranslation('k', 'https://v', 'Spanish'), 'tr_1-en');
    assertEquals(heygenResult(await heygenGetLipsync('k', 'ls_1'), 'o lipsync'), 'https://files.heygen.ai/x.mp4');
  } finally {
    globalThis.fetch = real;
  }
  const lip = JSON.parse(String(calls[0].init.body));
  assertEquals(calls[0].url, 'https://api.heygen.com/v3/lipsyncs');
  assertEquals((calls[0].init.headers as Record<string, string>)['X-Api-Key'], 'k');
  assertEquals(lip.video, { type: 'url', url: 'https://v' });
  assertEquals(lip.audio, { type: 'url', url: 'https://a' });
  assertEquals(lip.mode, 'precision');
  const tr = JSON.parse(String(calls[1].init.body));
  assertEquals(tr.output_languages, ['Spanish']);
  assertEquals(calls[2].url, 'https://api.heygen.com/v3/lipsyncs/ls_1');
});

Deno.test('HeyGen: falha e erro HTTP viram mensagem clara', async () => {
  let threw = '';
  try {
    heygenResult({ status: 'failed', failure_message: 'no face' }, 'o lipsync');
  } catch (e) {
    threw = (e as Error).message;
  }
  assertEquals(threw, 'A HeyGen não conseguiu fazer o lipsync: no face.');
  assertEquals(heygenResult({ status: 'running' }, 'x'), null);
  const real = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response('{"error":"bad key"}', { status: 401 }))) as typeof fetch;
  let msg = '';
  try {
    await heygenCreateLipsync('k', 'a', 'b');
  } catch (e) {
    msg = (e as Error).message;
  } finally {
    globalThis.fetch = real;
  }
  assertMatch(msg, /^heygen 401: /);
});

Deno.test('fala nova x vídeo: até 15% passa; acima vira frase clara; sem medida segue', () => {
  assertEquals(speechMismatchError(11, 10), null);
  assertEquals(speechMismatchError(8.5, 10), null);
  assertEquals(speechMismatchError(0, 10), null);
  assertEquals(speechMismatchError(12, 0), null);
  assertMatch(speechMismatchError(12, 10) ?? '', /^A fala nova dá 12\.0 s e o vídeo tem 10\.0 s; .*uns 150 caracteres/);
  assertMatch(speechMismatchError(5, 10) ?? '', /15% de diferença/);
});

Deno.test('lipsync pelo Replicate: slug validado; fala longa sem HeyGen explica a saída', async () => {
  const { validateRemake, speechNeedsHeygenError } = await import('./remake.ts');
  const base = { source_path: 'director/uploads/a.mp4', duration_s: 10, speech: 'Oi' };
  assertEquals(validateRemake({ ...base, lipsync_model_id: 'heygen/lipsync-precision' }), null);
  assertEquals(validateRemake({ ...base, lipsync_model_id: 'nada disso' }), 'Escolha um modelo de lipsync da lista.');
  assertMatch(speechNeedsHeygenError(10), /uns 150 caracteres/);
});

Deno.test('remake: brand_voice_id validado como uuid', async () => {
  const { validateRemake } = await import('./remake.ts');
  const base = { source_path: 'director/uploads/a.mp4', duration_s: 10, speech: 'Oi' };
  assertEquals(validateRemake({ ...base, brand_voice_id: '0b7f2c1e-1111-4222-8333-444455556666' }), null);
  assertEquals(validateRemake({ ...base, brand_voice_id: 'qualquer' }), 'Escolha uma voz da lista.');
});
