// Testes do template declarativo do catálogo (sem rede).

import { assertEquals, assertRejects } from 'jsr:@std/assert@1';

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { CatalogError, renderInputTemplate, resolveFallback, resolveModel, rowProvider, sceneResolution } from './video-catalog.ts';

Deno.test('template: $list embrulha, junta e achata; vazia some', () => {
  const t = {
    one: { $list: 'keyframe_url' },
    many: { $list: ['keyframe_url', 'reference_urls'] },
    none: { $list: 'reference_urls' },
  };
  assertEquals(renderInputTemplate(t, { keyframe_url: 'k', reference_urls: ['a', 'b'] }), {
    one: ['k'],
    many: ['k', 'a', 'b'],
    none: ['a', 'b'],
  });
  assertEquals(renderInputTemplate(t, { reference_urls: [] }), {});
});

Deno.test('template: $map devolve o valor mapeado; sem casar some', () => {
  const t = { mode: { $map: 'resolution', to: { '720p': 'standard', '1080p': 'pro', '4k': '4k' } } };
  assertEquals(renderInputTemplate(t, { resolution: '1080p' }), { mode: 'pro' });
  assertEquals(renderInputTemplate(t, { resolution: '480p' }), {});
  assertEquals(renderInputTemplate(t, {}), {});
});

Deno.test('template: duration_ms vem de duration_int quando ausente; explícito vence', () => {
  const t = { duration: '{{duration_ms}}', d: '{{duration_int}}' };
  assertEquals(renderInputTemplate(t, { duration_int: 5 }), { duration: 5000, d: 5 });
  assertEquals(renderInputTemplate(t, { duration_int: 5, duration_ms: 4800 }), { duration: 4800, d: 5 });
  assertEquals(renderInputTemplate(t, {}), {});
});

Deno.test('template: formas antigas continuam iguais', () => {
  const t = {
    prompt: '{{prompt}}',
    pos: { $when: 'reference_urls', value: ['first'] },
    txt: 'size {{resolution}}',
    fixed: 3,
  };
  assertEquals(renderInputTemplate(t, { prompt: 'p', resolution: '720p' }), { prompt: 'p', txt: 'size 720p', fixed: 3 });
  assertEquals(renderInputTemplate(t, { reference_urls: ['x'] }), { pos: ['first'], fixed: 3 });
});

Deno.test('template: avatar_id e language_code são vars', () => {
  assertEquals(
    renderInputTemplate({ type: 'avatar', avatar_id: '{{avatar_id}}', language_code: '{{language_code}}' }, { avatar_id: 'L1', language_code: 'pt' }),
    { type: 'avatar', avatar_id: 'L1', language_code: 'pt' },
  );
});

Deno.test('provider: sem coluna conta como replicate; heygen fica fora do caminho Replicate', () => {
  assertEquals(rowProvider({}), 'replicate');
  assertEquals(rowProvider({ provider: null }), 'replicate');
  assertEquals(rowProvider({ provider: 'heygen' }), 'heygen');
});

Deno.test('sceneResolution: 720p padrão, config.resolution respeitada dentro do que o modelo aceita', () => {
  const all = { resolutions: ['480p', '720p', '1080p', '4k'] };
  assertEquals(sceneResolution(all), '720p');
  assertEquals(sceneResolution(all, '1080p'), '1080p');
  assertEquals(sceneResolution(all, '4k'), '4k');
  assertEquals(sceneResolution(all, '8k'), '720p');
  assertEquals(sceneResolution({ resolutions: ['480p', '720p'] }, '1080p'), '720p');
  assertEquals(sceneResolution({ resolutions: ['768p'] }), '768p');
  assertEquals(sceneResolution({}, '1080p'), undefined);
});

/** Cliente falso: aplica os .eq() sobre as linhas em memória (sem rede). */
function fakeCatalog(rows: Record<string, unknown>[]): SupabaseClient {
  const builder = (filters: [string, unknown][]) => ({
    select: () => builder(filters),
    eq: (col: string, v: unknown) => builder([...filters, [col, v]]),
    returns: () => Promise.resolve({ data: rows.filter((r) => filters.every(([c, v]) => r[c] === v)), error: null }),
  });
  return { from: () => builder([]) } as unknown as SupabaseClient;
}

const row = (model_id: string, extra: Record<string, unknown> = {}) => ({
  id: model_id, capability: 'scene_i2v', model_id, kind: 'official', version_hash: null, cost: null, limits: null,
  input_template: {}, fallback_model_id: null, is_primary: false, active: true, required_inputs: [], ...extra,
});

Deno.test('resolveModel: override aposentado avisa e segue com o primário', async () => {
  const warn = console.warn;
  const warned: string[] = [];
  console.warn = (m: string) => warned.push(m);
  try {
    const db = fakeCatalog([
      row('a/primario', { is_primary: true }),
      row('b/aposentado', { active: false }),
      row('c/escolhido'),
      row('heygen/avatar-iv', { is_primary: true, provider: 'heygen' }),
    ]);
    assertEquals((await resolveModel(db, 'scene_i2v', 'c/escolhido')).model_id, 'c/escolhido');
    assertEquals((await resolveModel(db, 'scene_i2v', 'b/aposentado')).model_id, 'a/primario');
    assertEquals((await resolveModel(db, 'scene_i2v', 'z/nao-existe')).model_id, 'a/primario');
    assertEquals(warned.length, 2);
    assertEquals((await resolveModel(db, 'scene_i2v')).model_id, 'a/primario');
    assertEquals((await resolveModel(db, 'scene_i2v', null, 'heygen')).model_id, 'heygen/avatar-iv');
  } finally {
    console.warn = warn;
  }
});

Deno.test('resolveModel: sem primário ativo mantém o erro humanizado; fallback inativo = null', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const db = fakeCatalog([row('b/aposentado', { active: false, is_primary: true })]);
    await assertRejects(() => resolveModel(db, 'scene_i2v', 'b/aposentado'), CatalogError, 'Nenhum modelo primário ativo');
    const db2 = fakeCatalog([row('a/primario', { is_primary: true, fallback_model_id: 'b/off' }), row('b/off', { active: false })]);
    const primary = await resolveModel(db2, 'scene_i2v');
    assertEquals(await resolveFallback(db2, primary), null);
  } finally {
    console.warn = warn;
  }
});
