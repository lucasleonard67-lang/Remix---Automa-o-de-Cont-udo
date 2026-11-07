// Testes puros do roteirista do Diretor: contexto do brief e prompt da trilha.
//   npx -y deno@2.1.4 test --no-lock supabase/functions/_shared/director-core_test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1';

import { bedPrompt, clipTtsText, plannerContext } from './director-core.ts';

Deno.test('contexto do planner: objetivo, público e tom reais, sem os ausentes', () => {
  assertEquals(
    plannerContext({ objetivo: 'Vender o curso', publico: 'nutricionistas', tom: 'leve' }),
    'CONTEXTO DO VÍDEO (oriente mundo, pessoas e linguagem por isto):\n' +
      '- Objetivo: Vender o curso\n- Público: nutricionistas\n- Tom: leve\n\n',
  );
  const soTom = plannerContext({ objetivo: '  ', publico: '', tom: 'sóbrio,\n direto' });
  assertEquals(soTom, 'CONTEXTO DO VÍDEO (oriente mundo, pessoas e linguagem por isto):\n- Tom: sóbrio, direto\n\n');
  assertEquals(plannerContext({}), '');
  assertEquals(plannerContext({ objetivo: 42 }), '');
});

Deno.test('trilha: neutra, do tema e do tom; sem nada, genérica', () => {
  const p = bedPrompt('Consultório de nutrição', 'acolhedor');
  assert(p.startsWith('Subtle background ambience for a short video about: Consultório de nutrição. Mood: acolhedor.'));
  assert(!/industrial|machinery|factory/i.test(p));
  assert(p.includes('No music, no voices'));
  assertEquals(
    bedPrompt(undefined, ''),
    'Subtle neutral room tone ambience. Soft, steady and unobtrusive, matching the setting. ' +
      'No music, no voices, no sudden loud sounds, loopable.',
  );
});

Deno.test('TTS: texto acima de 5.000 é cortado no fim de frase abaixo do limite', () => {
  assertEquals(clipTtsText('Curto. Fica igual.'), 'Curto. Fica igual.');
  const frase = 'Uma frase de teste. '; // 20 caracteres
  const longo = frase.repeat(300); // 6.000
  const out = clipTtsText(longo);
  assertEquals(out.length, 4999); // 250 frases, sem o espaço final
  assert(out.endsWith('teste.'));
  assertEquals(clipTtsText('Ola mundo. Tudo bem? Sim', 15), 'Ola mundo.');
  assertEquals(clipTtsText('Ola mundo. Tudo bem? Sim', 20), 'Ola mundo. Tudo bem?');
  assertEquals(clipTtsText('palavra palavra palavra', 12), 'palavra');
  assertEquals(clipTtsText('x'.repeat(30), 10), 'x'.repeat(10));
});
