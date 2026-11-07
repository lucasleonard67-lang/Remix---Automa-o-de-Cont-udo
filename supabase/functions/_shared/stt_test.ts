import { assertEquals } from 'jsr:@std/assert@1';

import { parseSttOutput } from './stt.ts';

Deno.test('stt: formato ElevenLabs (words com type) ignora espaço e evento', () => {
  const out = {
    text: 'Olá mundo',
    words: [
      { text: 'Olá', start: 0.1, end: 0.4, type: 'word' },
      { text: ' ', start: 0.4, end: 0.45, type: 'spacing' },
      { text: '(risos)', start: 0.45, end: 0.6, type: 'audio_event' },
      { text: 'mundo', start: 0.6, end: 1.0, type: 'word' },
    ],
  };
  assertEquals(parseSttOutput(out), [
    { text: 'Olá', start: 0.1, end: 0.4 },
    { text: 'mundo', start: 0.6, end: 1.0 },
  ]);
});

Deno.test('stt: segments, chunks (whisper) e string JSON', () => {
  assertEquals(parseSttOutput({ segments: [{ words: [{ word: 'a', start: 0, end: 1 }] }, { words: [{ word: 'b', start: 1, end: 2 }] }] }), [
    { text: 'a', start: 0, end: 1 },
    { text: 'b', start: 1, end: 2 },
  ]);
  assertEquals(parseSttOutput({ chunks: [{ text: ' oi', timestamp: [0.5, 0.9] }] }), [{ text: 'oi', start: 0.5, end: 0.9 }]);
  assertEquals(parseSttOutput('{"words":[{"text":"x","start":1,"end":2}]}'), [{ text: 'x', start: 1, end: 2 }]);
});

Deno.test('stt: sem tempo ou forma desconhecida → vazio (cai no ElevenLabs direto)', () => {
  assertEquals(parseSttOutput({ text: 'só texto' }), []);
  assertEquals(parseSttOutput('https://x/out.json'), []);
  assertEquals(parseSttOutput(null), []);
  assertEquals(parseSttOutput({ words: [{ text: 'a' }] }), []);
});
