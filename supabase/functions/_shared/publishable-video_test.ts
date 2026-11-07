import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { editedArtifact, type EditRow } from './video-edit-engine.ts';
import { publishablePath } from './publishable-video.ts';

const edited = { edit_id: 'e1', path: 'edits/e1/out.mp4', source_final: 'director/j/final.mp4' };

Deno.test('edição do final atual vai ao ar', () => {
  assertEquals(publishablePath({ final: 'director/j/final.mp4', edited }), 'edits/e1/out.mp4');
});

Deno.test('cena refeita depois de aprimorar: sai o original novo, nunca a edição velha', () => {
  assertEquals(publishablePath({ final: 'director/j/final-e1.mp4', edited }), 'director/j/final-e1.mp4');
});

Deno.test('com a cena remontando, sai o final', () => {
  assertEquals(publishablePath({ final: 'director/j/final.mp4', edited, final_rebuilding: true }), 'director/j/final.mp4');
});

Deno.test('sem edição, revertida ou sem saber a origem: sai o final', () => {
  assertEquals(publishablePath({ final: 'f.mp4' }), 'f.mp4');
  assertEquals(publishablePath({ final: 'f.mp4', edited: null }), 'f.mp4');
  assertEquals(publishablePath({ final: 'f.mp4', edited: { edit_id: 'e', path: 'x.mp4' } }), 'f.mp4');
});

Deno.test('sem final não há o que publicar, mesmo com edição', () => {
  assertEquals(publishablePath({ edited }), null);
  assertEquals(publishablePath({}), null);
});

Deno.test('o que o motor grava casa com o que a publicação lê', () => {
  const edit = { id: 'e9', source_path: 'director/j/final.mp4' } as EditRow;
  const artifact = editedArtifact(edit, 'edits/e9/out.mp4');
  assertEquals(publishablePath({ final: edit.source_path, edited: artifact }), 'edits/e9/out.mp4');
  assertEquals(publishablePath({ final: 'director/j/final-e1.mp4', edited: artifact }), 'director/j/final-e1.mp4');
});

Deno.test('Instagram publica por publishablePath, não por artifacts.final', async () => {
  const src = await Deno.readTextFile(new URL('../zernio-proxy/index.ts', import.meta.url));
  assert(src.includes('publishablePath(artifacts)'));
  assert(!src.includes('artifacts.final'));
});
