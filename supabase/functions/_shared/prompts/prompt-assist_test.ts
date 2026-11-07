import { assert, assertEquals } from 'jsr:@std/assert@1';

import { PROMPT_KINDS, promptAssistMessages } from './prompt-assist.ts';

const input = { text: 'quero falar de retrabalho', marca: 'Quem fala: Ana', material: '', max: 500 };

Deno.test('prompt-assist: exige [VERIFICAR] e proíbe inventar, em todo tipo de campo', () => {
  for (const kind of PROMPT_KINDS) {
    const { system } = promptAssistMessages({ ...input, kind });
    assert(system.includes('[VERIFICAR]'));
    assert(system.includes('NUNCA invente'));
    assert(system.includes('No máximo 500 caracteres.'));
  }
});

Deno.test('prompt-assist: vídeo trata de gancho, cena, câmera e ritmo', () => {
  const { system } = promptAssistMessages({ ...input, kind: 'video' });
  for (const word of ['gancho', 'cenas', 'câmera', 'ritmo']) assert(system.includes(word));
});

Deno.test('prompt-assist: pedido, marca e material vão no user, separados', () => {
  const { user } = promptAssistMessages({ ...input, kind: 'content' });
  assertEquals(
    user,
    'MARCA:\nQuem fala: Ana\n\nMATERIAL:\n(sem material)\n\nPEDIDO:\nquero falar de retrabalho',
  );
});
