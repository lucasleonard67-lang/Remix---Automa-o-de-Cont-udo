import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1';

import {
  applyClipSwap, clipOfShot, computeEditModes, estimateLabel, pickV2vModel, redoAdjustment, validateSceneEditRequest,
} from './scene-edit.ts';
import type { VideoModelEntry } from './video-catalog.ts';

const entry = (model_id: string, extra: Partial<VideoModelEntry> = {}): VideoModelEntry => ({
  id: model_id, capability: 'scene_v2v', model_id, kind: 'official', version_hash: null,
  cost: { unit: 'per_second', usd: 0.1 }, limits: {}, input_template: {}, fallback_model_id: null,
  is_primary: false, active: true, required_inputs: [], provider: 'replicate', ...extra,
});

const kling = entry('kwaivgi/kling-v4.0', {
  cost: { unit: 'per_second', usd: 0.141, by_resolution: { '720p': 0.094, '1080p': 0.141 } },
  limits: { duration_min: 3, duration_max: 30, resolutions: ['720p', '1080p'] },
});
const wan = entry('wan-video/wan-2.7-videoedit', { cost: { unit: 'per_second', usd: 0.1 }, limits: { duration_min: 2, duration_max: 10 } });

Deno.test('pickV2vModel: primário se cabe; senão o mais barato que cabe; nada cabe = null', () => {
  assertEquals(pickV2vModel([kling, wan], 8)?.model_id, 'wan-video/wan-2.7-videoedit');
  assertEquals(pickV2vModel([kling, wan], 14)?.model_id, 'kwaivgi/kling-v4.0');
  assertEquals(pickV2vModel([{ ...kling, is_primary: true }, wan], 8)?.model_id, 'kwaivgi/kling-v4.0');
  assertEquals(pickV2vModel([wan], 14), null);
  assertEquals(pickV2vModel([wan], 1), null);
});

const videos = [
  { shot: 1, path: 'v1.mp4', dur_s: 6 },
  { shot: 2, path: 'v2.mp4', dur_s: 14, members: [2, 3] },
];

Deno.test('computeEditModes: grupo tem escopo inteiro; edit e redo com custo e motivo', () => {
  const m = computeEditModes({
    mode: null, videos, v2v: [wan], replicateConnected: true, hfConnected: true, engine: 'higgsfield', sceneEntry: null,
  });
  assertEquals(Object.keys(m).sort(), ['1', '2', '3']);
  assertEquals(m['3'].scope, [2, 3]);
  assert(m['1'].edit.available);
  assertEquals(m['1'].edit.usd, 0.6);
  assertEquals(m['1'].edit.model_id, 'wan-video/wan-2.7-videoedit');
  assert(!m['2'].edit.available);
  assertMatch(m['2'].edit.reason ?? '', /14 s; os modelos de edição aceitam até 10 s/);
  assert(m['1'].redo.available);
  assertEquals(m['1'].redo.usd, null, 'Higgsfield: crédito, sem US$');
});

Deno.test('computeEditModes: sem Replicate/Higgsfield e modos sem cenas', () => {
  const off = computeEditModes({
    mode: null, videos, v2v: [wan], replicateConnected: false, hfConnected: false, engine: 'replicate', sceneEntry: null,
  });
  assertEquals(off['1'].edit.reason, 'Editar com texto precisa do Replicate conectado.');
  assertMatch(off['1'].redo.reason ?? '', /Higgsfield/);
  const rp = computeEditModes({
    mode: null, videos, v2v: [], replicateConnected: true, hfConnected: true, engine: 'replicate',
    sceneEntry: entry('bytedance/seedance-2.0', { capability: 'scene_i2v', cost: { unit: 'per_second', usd: 0.18 } }),
  });
  assertEquals(rp['1'].redo.usd, 1.08);
  assertMatch(rp['1'].edit.reason ?? '', /Nenhum modelo de edição/);
  assertEquals(computeEditModes({ mode: 'avatar_video', videos, v2v: [wan], replicateConnected: true, hfConnected: true, engine: 'higgsfield', sceneEntry: null }), {});
});

Deno.test('clipOfShot, applyClipSwap (edit empilha, undo desempilha) e ajuste do refazer', () => {
  assertEquals(clipOfShot(videos, 3)?.shot, 2);
  assertEquals(clipOfShot(videos, 9), null);
  const edited = { shot: 2, path: 'v2-e1.mp4', dur_s: 14, members: [2, 3] };
  const a = applyClipSwap(videos, {}, edited, 'edit');
  assertEquals(a.videos[1].path, 'v2-e1.mp4');
  assertEquals(a.versions['2'].map((c) => c.path), ['v2.mp4']);
  const b = applyClipSwap(a.videos, a.versions, a.versions['2'][0], 'undo');
  assertEquals(b.videos[1].path, 'v2.mp4');
  assertEquals(b.versions['2'], []);
  assertEquals(redoAdjustment([2, 3], 3, 'mais luz'), 'Adjustment for scene 2: mais luz');
  assertEquals(redoAdjustment([1], 1, 'x'), 'Adjustment: x');
  assertEquals(redoAdjustment([1], 1, ' '), '');
});

Deno.test('estimateLabel e validação do pedido', () => {
  assertEquals(estimateLabel(1.2), 'Estimativa: até US$ 1,20');
  assertEquals(estimateLabel(null), 'Preço a confirmar');
  assertEquals(validateSceneEditRequest('edit', 'oi'), 'Diga o que mudar na cena.');
  assertEquals(validateSceneEditRequest('redo', ''), null);
  assertEquals(validateSceneEditRequest('x', 'abc'), "kind deve ser 'edit' ou 'redo'.");
  assertMatch(validateSceneEditRequest('edit', 'x'.repeat(501)) ?? '', /500/);
});
