import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  analyzeCommand, brandAss, buildSegments, capBox, CAP_FAST_S, CAP_LANES, CAP_MAX_W, CAP_MIN_S, captionBlocks, captionCues, captionsAss, cleanWords,
  compileEdit, type Cue, editCaptions, type EditContext, expectedDuration, normalizeOps, type Op, parseAnalysis, parseBackground,
  parseProbe, parseQa, qaChecks, renderCommand, retimeWords, SAFE, SANDBOX_MAX_CHARS, segmentsDuration, textWidth, type Word,
} from './video-edit.ts';

const w = (text: string, start: number, end: number) => ({ text, start, end });
const words = [
  w('olá', 3, 3.4), w('é', 3.4, 3.8), w('tudo', 3.8, 4.2), w('bem', 4.2, 4.6),
  w('hoje', 7, 7.5), w('vamos', 7.5, 8), w('falar', 8, 8.5), w('disso', 8.5, 9),
];
const ctx = (over: Partial<EditContext> = {}): EditContext => ({
  words, duration: 12, hasAudio: true, hasMusic: true, captionsBurned: false,
  brand: { logo: true, primary: '#E4572E', handle: '@marca', font: null }, ...over,
});
const norm = (raw: unknown, c = ctx()) => normalizeOps(raw, c);

Deno.test('normalizeOps recusa operação fora do menu e aplica os limites', () => {
  assertEquals(norm([{ type: 'shell', cmd: 'rm -rf /' }]).error, 'Operação inválida.');
  assertEquals(norm([]).error, 'Escolha ao menos uma sugestão.');
  const { ops } = norm([{ type: 'punch_in', zoom: 9 }, { type: 'trim_silences', pad_ms: 1, min_gap_ms: 99999 }]);
  assertEquals(ops[0], { type: 'punch_in', zoom: 1.2 });
  assertEquals(ops[1], { type: 'trim_silences', pad_ms: 40, min_gap_ms: 1500 });
  assertEquals(ops.at(-1), { type: 'loudness' });
});

Deno.test('normalizeOps: número vira padrão quando o valor não é número', () => {
  const { ops } = norm([{ type: 'punch_in', zoom: '1;rm -rf /' }, { type: 'color', preset: 'x;y' }]);
  assertEquals(ops[0], { type: 'punch_in', zoom: 1.12 });
  assertEquals(ops[1], { type: 'color', preset: 'neutral' });
});

Deno.test('abertura com logo não entra antes de gancho falado', () => {
  const spoken = ctx({ words: [w('oi', 0.2, 0.6)] });
  assert(norm([{ type: 'brand_intro' }], spoken).error?.includes('gancho falado'));
  assertEquals(norm([{ type: 'brand_intro' }]).error, null);
});

Deno.test('sem logo as operações de marca somem; legenda queimada não duplica', () => {
  const c = ctx({ brand: { logo: false, primary: '#000000' }, captionsBurned: true });
  const { ops } = norm([{ type: 'brand_outro' }, { type: 'brand_watermark' }, { type: 'captions' }], c);
  assertEquals(ops, [{ type: 'loudness' }]);
});

Deno.test('trim_silences mantém a fala com folga e junta lacunas curtas', () => {
  const { ops } = norm([{ type: 'trim_silences', pad_ms: 100, min_gap_ms: 400 }]);
  const segs = buildSegments(ops, ctx());
  assertEquals(segs.map((s) => [s.start, s.end]), [[2.9, 4.7], [6.9, 9.1]]);
});

Deno.test('cut_words tira a palavra sem comer as vizinhas', () => {
  const { ops } = norm([{ type: 'trim_silences' }, { type: 'cut_words', word_idxs: [1] }]);
  const segs = buildSegments(ops, ctx());
  assertEquals(segs.slice(0, 2).map((s) => [s.start, s.end]), [[2.92, 3.4], [3.8, 4.68]]);
  const out = retimeWords(words, segs);
  assert(!out.some((x) => x.text === 'é'));
  assertEquals(out.map((x) => x.text).slice(0, 3), ['olá', 'tudo', 'bem']);
});

Deno.test('hook_first vem primeiro, marcado, e entra por entrada própria', () => {
  const { ops } = norm([{ type: 'trim_silences' }, { type: 'hook_first', word_from: 4, word_to: 5 }]);
  const segs = buildSegments(ops, ctx());
  assert(segs[0].hook);
  assertEquals(segs[0].start, 6.94);
  const out = compileEdit(ops, ctx(), {});
  assertStringIncludes(out.inputArgs, '-ss 6.84');
  assertStringIncludes(out.filter, '[1:v]trim=start=0.1');
  const legenda = retimeWords(words, segs);
  assertEquals(legenda[0].text, 'hoje');
  assert(legenda.some((x) => x.brk));
});

Deno.test('legenda nunca tem dois eventos ao mesmo tempo', () => {
  const dense = [w('um', 1, 1.2), w('dois', 1.21, 1.3), w('tres', 1.3, 1.31), w('quatro', 1.32, 1.5), w('cinco', 1.55, 1.7), w('seis', 1.71, 2.2)];
  const toS = (t: string) => { const [h, m, s] = t.split(':').map(Number); return h * 3600 + m * 60 + s; };
  const events = captionsAss(dense, { accent: '#FF0000' }).split('\n').filter((l) => l.startsWith('Dialogue:'))
    .map((l) => l.split(',')).map((p) => ({ a: toS(p[1]), b: toS(p[2]) }));
  assert(events.length >= 4);
  for (let i = 1; i < events.length; i++) assert(events[i].a >= events[i - 1].b, `sobreposição no evento ${i}`);
});

Deno.test('efeitos do ffmpeg: anexo do tipo certo e dado com fonte', () => {
  const attachments = [{ path: 'a.mp4', kind: 'video' as const }, { path: 'b.png', kind: 'image' as const }];
  const sources = [{ title: 'OMS', url: 'https://www.who.int/x', text: 'Foram 32% das mortes.' }];
  const c = ctx({ attachments, sources });
  const { ops } = normalizeOps([
    { type: 'split_screen', items: [{ word_from: 0, word_to: 3, attachment_index: 0, side: 'bottom' }, { word_from: 0, word_to: 1, attachment_index: 9, side: 'top' }] },
    { type: 'image_overlay', items: [{ word_from: 4, word_to: 7, attachment_index: 0, position: 'top' }, { word_from: 4, word_to: 7, attachment_index: 1, position: 'middle' }] },
    { type: 'fact_card', items: [{ word_from: 1, word_to: 2, value: '32%', label: 'das mortes', source_index: 0, position: 'middle' }, { word_from: 1, word_to: 2, value: '99%', label: 'x', source_index: 0, position: 'top' }] },
    { type: 'title', items: [{ word_from: 0, word_to: 1, text: 'Título', position: 'top' }] },
  ], c);
  const by = (t: string) => ops.find((o) => o.type === t) as unknown as { items: Record<string, unknown>[] };
  assertEquals(by('split_screen').items.length, 1);
  assertEquals(by('image_overlay').items.map((i) => i.attachment_index), [1]);
  assertEquals(by('fact_card').items.map((i) => i.source), ['who.int']);
  const out = compileEdit(ops, c, { files: { 0: 'att0.mp4', 1: 'att1.png' }, brandAss: true, fonts: true });
  assert(out.inputArgs.includes('-i att0.mp4'));
  assert(!out.inputArgs.includes('-loop 1'));
  assertStringIncludes(out.filter, 'loop=loop=-1:size=1,trim=duration=');
  assert(out.filter.includes('drawbox=x=64'));
  assert(out.filter.includes(':eof_action=pass'));
  const ass = brandAss(ops, c)!;
  assert(ass.includes('Fonte: who.int'));
  assert(ass.includes('Título'));
});

Deno.test('speed desacelera até 0,85 e o limite vale nos dois lados', () => {
  const slow = norm([{ type: 'speed', ranges: [{ word_from: 0, word_to: 7, factor: 0.85 }] }]).ops;
  const limit = norm([{ type: 'speed', ranges: [{ word_from: 0, word_to: 7, factor: 0.2 }] }]).ops;
  const fast = norm([{ type: 'speed', ranges: [{ word_from: 0, word_to: 7, factor: 4 }] }]).ops;
  assertEquals((slow[0] as { ranges: { factor: number }[] }).ranges[0].factor, 0.85);
  assertEquals((limit[0] as { ranges: { factor: number }[] }).ranges[0].factor, 0.85);
  assertEquals((fast[0] as { ranges: { factor: number }[] }).ranges[0].factor, 1.25);
});

Deno.test('speed reduz a duração e casa com expectedDuration', () => {
  const { ops } = norm([{ type: 'speed', ranges: [{ word_from: 4, word_to: 7, factor: 1.25 }] }]);
  assertEquals(expectedDuration(ops, ctx()), 11.6);
  assertStringIncludes(compileEdit(ops, ctx(), {}).filter, 'atempo=1.25');
});

Deno.test('vídeo mudo gera silêncio em vez de ler [0:a]', () => {
  const c = ctx({ hasAudio: false });
  const { ops } = norm([{ type: 'trim_silences' }], c);
  const { filter } = compileEdit(ops, c, {});
  assert(!filter.includes('[0:a]'));
  assertStringIncludes(filter, 'anullsrc');
});

Deno.test('texto de marca vive no ASS, nunca no filtro nem no shell', () => {
  const evil = "$(rm -rf /)'; `x` {\\b1}";
  const { ops } = norm([{ type: 'brand_outro', cta: evil }, { type: 'lower_third', name: evil }]);
  const compiled = compileEdit(ops, ctx(), { logo: true, brandAss: true });
  assert(!compiled.filter.includes('rm -rf'));
  const ass = brandAss(ops, ctx())!;
  assert(!ass.includes('{\\b1}'));
  assertStringIncludes(ass, 'Dialogue:');
});

Deno.test('cor de marca hostil cai no padrão', () => {
  const c = ctx({ brand: { logo: true, primary: "';rm -rf /" } });
  const { ops } = norm([{ type: 'brand_outro' }], c);
  assert(!compileEdit(ops, c, { logo: true }).filter.includes('rm -rf'));
});

Deno.test('captionsAss destaca a palavra falada e quebra em pulo do original', () => {
  const ass = captionsAss([
    { text: 'um', start: 0, end: 0.3 }, { text: 'dois', start: 0.3, end: 0.6 }, { text: 'tres', start: 0.6, end: 0.9, brk: true },
  ], { accent: '#E4572E', style: 'caps' });
  assertStringIncludes(ass, '{\\c&H2E57E4&}UM{\\c&HFFFFFF&} DOIS');
  assert(!ass.includes('DOIS TRES'));
});

Deno.test('comandos cabem no limite do sandbox e escapam aspas da URL', () => {
  const url = `https://x.supabase.co/storage/v1/object/sign/renders/edits/abc?token=${'a'.repeat(280)}`;
  const render = renderCommand({
    id: 'abc-123', sourceUrl: `${url}'x`, filterUrl: url, uploadUrl: url, frameUploadUrls: [url, url, url, url],
    inputArgs: '-i src.mp4 -i logo.png', logoUrl: url, fontUrls: { 'a.ttf': url }, assUrl: url, brandAssUrl: url,
  });
  assert(render.length < SANDBOX_MAX_CHARS);
  assertStringIncludes(render, `'\\''x`);
  const analyze = analyzeCommand({ id: 'abc', sourceUrl: url, audioUploadUrl: url, frameUploadUrls: Array(8).fill(url), logoUrl: url });
  assert(analyze.length < SANDBOX_MAX_CHARS);
});

Deno.test('parsers do log do sandbox', () => {
  assertEquals(parseBackground('x\nCombined output: /tmp/a.log\nExit status (written when done): /tmp/a.exit\n'), { log: '/tmp/a.log', exit: '/tmp/a.exit' });
  assertEquals(parseBackground('nada'), null);
  assertEquals(parseAnalysis('PROBE:12.5|audio|1080,1920\nLOGO:rgb24|ffffff'), {
    duration: 12.5, hasAudio: true, width: 1080, height: 1920, logoKey: '#ffffff',
  });
  assertEquals(parseAnalysis('PROBE:12.5||1080,1920\nLOGO:rgba|ffffff')?.logoKey, null);
  assertEquals(parseAnalysis('PROBE:12.5||1080,1920')?.hasAudio, false);
  assertEquals(parseAnalysis('sem nada'), null);
  assertEquals(parseQa('QA:15.7|audio|-13.9'), { duration: 15.7, hasAudio: true, lufs: -13.9 });
  assertEquals(parseQa('QA:15.7|audio|0.0')?.lufs, null, 'medição zerada não reprova o vídeo');
  assertEquals(parseQa('QA:15.7|audio|')?.lufs, null);
  const probe = parseProbe('NODE:v22.3.0\nCHROME:/usr/bin/chromium\nffmpeg version 6.1 x\n T.. afftdn  A->A  x\n ... subtitles  V->V  x\n');
  assert(probe.hyperframes_ready);
  assertEquals(probe.ffmpeg, '6.1');
  assert(probe.filters.afftdn && probe.filters.subtitles && !probe.filters.drawtext);
  assertEquals(parseProbe('NODE:v20.1.0\nCHROME:\n').hyperframes_ready, false);
});

Deno.test('qaChecks: tolerância cresce com os cortes e mudo não cobra loudness', () => {
  assertEquals(qaChecks({ duration: 10.2, hasAudio: true, lufs: -14 }, { seconds: 10, segments: 3, speech: true }), []);
  assertEquals(qaChecks({ duration: 12, hasAudio: true, lufs: -14 }, { seconds: 10, segments: 40, speech: true }).length, 1);
  assertEquals(qaChecks({ duration: 10.9, hasAudio: true, lufs: -14 }, { seconds: 10.0, segments: 25, speech: true }), []);
  assertEquals(qaChecks({ duration: 10, hasAudio: true, lufs: -70 }, { seconds: 10, segments: 1, speech: false }), []);
  assertEquals(qaChecks({ duration: 10, hasAudio: true, lufs: -20 }, { seconds: 10, segments: 1, speech: true }).length, 1);
  assertEquals(qaChecks({ duration: 10, hasAudio: false, lufs: null }, { seconds: 10, segments: 1, speech: true }), ['sem áudio']);
});

Deno.test('ops de todos os tipos compilam', () => {
  const all: unknown[] = [
    { type: 'trim_silences' }, { type: 'cut_words', word_idxs: [1] }, { type: 'punch_in' }, { type: 'captions' },
    { type: 'voice_clean' }, { type: 'music_duck' }, { type: 'color', preset: 'punch' }, { type: 'brand_intro' },
    { type: 'brand_watermark' }, { type: 'brand_outro', cta: 'Siga' }, { type: 'lower_third', name: 'Ana' },
  ];
  const { ops, error } = norm(all);
  assertEquals(error, null);
  const types = (ops as Op[]).map((o) => o.type);
  assert(types.includes('loudness'));
  const { filter } = compileEdit(ops, ctx(), { logo: true, music: true, fonts: true, ass: true, brandAss: true });
  assertStringIncludes(filter, 'eval=frame');
  assertStringIncludes(filter, 'subtitles=brand.ass:fontsdir=fonts');
});

Deno.test('vídeo longo não passa do teto de cortes', () => {
  const many = Array.from({ length: 2000 }, (_, i) => w(`p${i}`, i * 1.0, i * 1.0 + 0.4));
  const c = ctx({ words: many, duration: 2001 });
  const { ops } = norm([{ type: 'trim_silences' }], c);
  const { filter } = compileEdit(ops, c, {});
  assert(buildSegments(ops, c).length <= 300);
  assert(filter.length < 128 * 1024, String(filter.length));
});

// ── invariantes da legenda ───────────────────────────────────────────────────
const assS = (t: string) => { const [h, m, s] = t.split(':').map(Number); return h * 3600 + m * 60 + s; };
const eventsOf = (ass: string) => ass.split('\n').filter((l) => l.startsWith('Dialogue:')).map((l) => {
  const p = l.split(',');
  return { a: assS(p[1]), b: assS(p[2]), text: p.slice(9).join(',') };
});
/** Vídeo sorteado, sempre o mesmo: fala rápida, palavra longa e tempos do STT ruins. */
function dirtyWords(seed: number, n = 120): Word[] {
  let x = seed;
  const rnd = () => (x = (x * 16807) % 2147483647) / 2147483647;
  const pool = ['eu', 'vou', 'hoje', 'inteligência', 'artificial', 'desproporcionalmente', 'anticonstitucionalissimamente', 'você', 'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW', '{x}', 'é', 'açúcar'];
  const out: Word[] = [];
  let t = 0.2;
  for (let i = 0; i < n; i++) {
    const len = rnd() < 0.2 ? 0 : rnd() * 0.5;
    out.push({ text: pool[Math.floor(rnd() * pool.length)], start: r2(t - (rnd() < 0.2 ? 0.3 : 0)), end: r2(t + len + (rnd() < 0.1 ? 0.8 : 0)) });
    t += rnd() < 0.1 ? 1.2 : rnd() * 0.3;
  }
  return out.sort(() => rnd() - 0.8 < 0 ? 0 : -1);
}
const r2 = (n: number) => Math.round(n * 100) / 100;
const checkCues = (cues: Cue[], duration?: number) => {
  for (const [i, c] of cues.entries()) {
    assert(c.end - c.start >= CAP_FAST_S - 0.002, `texto curto: ${c.end - c.start}`);
    if (i) assert(c.start >= cues[i - 1].end - 1e-6, 'dois textos ao mesmo tempo');
    if (duration != null) assert(c.end <= duration + 1e-6, 'texto depois do fim');
    assert(textWidth(c.words.map((w) => w.text).join(' ')) * 0.7 <= CAP_MAX_W, 'não cabe nem encolhido');
  }
};

Deno.test('cleanWords e retimeWords: tempos sempre crescentes, com qualquer STT e edição', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const dirty = dirtyWords(seed);
    const clean = cleanWords(dirty);
    for (let i = 1; i < clean.length; i++) {
      assert(clean[i].start >= clean[i - 1].end, 'sobreposição');
      assert(clean[i].end > clean[i].start, 'sem duração');
    }
    const c = ctx({ words: dirty, duration: 60 });
    const { ops } = norm([
      { type: 'trim_silences' }, { type: 'cut_words', word_idxs: [3, 4, 9] },
      { type: 'speed', ranges: [{ word_from: 10, word_to: 30, factor: 1.25 }] },
    ], c);
    const out = retimeWords(dirty, buildSegments(ops, c), 1.2);
    assert(out.length > 0);
    for (let i = 1; i < out.length; i++) assert(out[i].start >= out[i - 1].end && out[i].end > out[i].start, `retime ${seed}/${i}`);
  }
});

Deno.test('captionCues: um texto por vez, tempo mínimo e largura, com qualquer entrada', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const shown = dirtyWords(seed).map((x) => ({ ...x, text: x.text.toUpperCase() }));
    checkCues(captionCues(shown));
    checkCues(captionCues(shown, { duration: 30 }), 30);
  }
  // só um texto cabe: mostra o vídeo inteiro em vez de sumir
  assertEquals(captionCues([w('oi', 0.1, 0.2)], { duration: 0.5 }).length, 1);
  // fala que acaba colada no fim recua para manter o tempo mínimo
  const end = captionCues([w('um', 0, 0.2), w('tchau', 9.8, 9.95)], { duration: 10 });
  assertEquals(end[end.length - 1], { start: 9.3, end: 10, words: end[end.length - 1].words });
});

Deno.test('palavra longa: encolhe sem mudar a altura; a que não cabe parte em pedaços', () => {
  const ass = captionsAss([w('inconstitucionalissimamente', 1, 2)], { accent: '#FF0000' });
  assertStringIncludes(ass, '\\fscx');
  const parts = captionCues([w('W'.repeat(30), 1, 3)]);
  assert(parts.length > 1 || parts[0].words.length > 1);
  assert(parts.flatMap((c) => c.words).every((x) => textWidth(x.text) <= CAP_MAX_W));
  // medido no frame: 20 maiúsculas ocupam menos de 840 px com o contorno
  assert(textWidth('COMPLETAMENTE') > 520 && textWidth('COMPLETAMENTE') < 560);
});

Deno.test('toda legenda sai no mesmo ponto, sem quebra e sem empilhar', () => {
  for (const [position, y] of [['bottom', 1220], ['center', 1010], ['top', 490]] as const) {
    const ass = captionsAss(dirtyWords(7), { accent: '#FF0000', position });
    assertStringIncludes(ass, 'WrapStyle: 2');
    const events = eventsOf(ass);
    assert(events.length > 20);
    for (const [i, e] of events.entries()) {
      assert(e.text.startsWith(`{\\an2\\pos(540,${y})\\q2`), e.text);
      assert(!e.text.includes('\\N'));
      if (i) assert(e.a >= events[i - 1].b, 'eventos sobrepostos');
    }
  }
});

Deno.test('as faixas ficam na área útil do Instagram', () => {
  for (const lane of ['bottom', 'center', 'top'] as const) {
    assert(capBox(lane).top >= SAFE.top && capBox(lane).bottom <= SAFE.bottom);
  }
  assertEquals(CAP_MAX_W, 840);
});

const longCtx = () => ctx({
  words: Array.from({ length: 40 }, (_, i) => w(`p${i}`, 1 + i * 0.5, 1.4 + i * 0.5)), duration: 22,
});
const fact = (position: string) => ({ word_from: 4, word_to: 16, value: '42%', label: 'x', source: 'ibge.gov.br', position });

Deno.test('legenda troca de faixa no vídeo todo para não tocar em dado ou título', () => {
  const c = longCtx();
  const cases: [unknown[], 'bottom' | 'center' | 'top'][] = [
    [[{ type: 'captions' }, { type: 'fact_card', items: [fact('bottom')] }], 'center'],
    [[{ type: 'captions', position: 'center' }, { type: 'fact_card', items: [fact('middle')] }], 'top'],
    [[{ type: 'captions', position: 'top' }, { type: 'fact_card', items: [fact('top')] }], 'bottom'],
    [[{ type: 'captions' }, { type: 'title', items: [{ word_from: 2, word_to: 12, text: 'Um título bem longo que ocupa várias linhas na parte de baixo', position: 'bottom' }] }], 'center'],
  ];
  for (const [raw, lane] of cases) {
    const y = CAP_LANES[lane];
    const { ops } = norm(raw, c);
    const events = eventsOf(editCaptions(ops, c, '#FF0000')!);
    assert(events.length > 10);
    assert(events.every((e) => e.text.includes(`\\pos(540,${y})`)), `esperava ${y}: ${events[0].text}`);
    const box = capBox(lane);
    for (const b of captionBlocks(ops, c)) assert(b.top >= box.bottom || b.bottom <= box.top, 'faixa ocupada');
  }
});

Deno.test('sem faixa livre, a legenda some enquanto o dado está na tela', () => {
  const c = longCtx();
  const { ops } = norm([{ type: 'captions' }, { type: 'fact_card', items: [fact('top'), fact('middle'), fact('bottom')] }], c);
  const blocks = captionBlocks(ops, c);
  const events = eventsOf(editCaptions(ops, c, '#FF0000')!);
  assert(events.length > 5);
  for (const e of events) for (const b of blocks) assert(e.b <= b.start + 0.01 || e.a >= b.end - 0.01, 'legenda em cima do dado');
  assert(events.every((e) => e.text.includes('\\pos(540,1220)')));
});

Deno.test('legenda segue monotônica e sem colisão com gancho, cortes e velocidade', () => {
  const c = longCtx();
  const { ops } = norm([
    { type: 'trim_silences' }, { type: 'cut_words', word_idxs: [2, 3] }, { type: 'hook_first', word_from: 20, word_to: 24 },
    { type: 'speed', ranges: [{ word_from: 26, word_to: 34, factor: 1.25 }] }, { type: 'captions' },
    { type: 'title', items: [{ word_from: 6, word_to: 10, text: 'Título', position: 'bottom' }] },
  ], c);
  const events = eventsOf(editCaptions(ops, c, '#FF0000')!);
  assert(events.length > 10);
  for (let i = 1; i < events.length; i++) assert(events[i].a >= events[i - 1].b, `evento ${i}`);
  const total = segmentsDuration(buildSegments(ops, c));
  assert(events[events.length - 1].b <= total + 0.01);
});

Deno.test('título longo pode quebrar linha; o resto do texto da marca não', () => {
  const { ops } = norm([{ type: 'title', items: [{ word_from: 0, word_to: 2, text: 'Título', position: 'top' }] }]);
  assertStringIncludes(brandAss(ops, ctx())!, '{\\q0\\fad(180,120)}');
});

Deno.test('música abaixa na fala mesmo com centenas de trechos', () => {
  const words = Array.from({ length: 200 }, (_, i) => ({ text: 'a', start: i, end: i + 0.3 }));
  const c = { ...ctx(), words, duration: 200, hasMusic: true };
  const { ops } = normalizeOps([{ type: 'music_duck' }], c);
  const { filter } = compileEdit(ops, c, { music: true });
  const volumes = filter.match(/volume='[^']+'/g) ?? [];
  assert(volumes.length >= 3);
  for (const v of volumes) assert(v.split('clip(').length - 1 <= 80);
});

Deno.test('legenda atrasada alcança a fala em vez de acumular', () => {
  const words = Array.from({ length: 12 }, (_, i) => ({ text: 'TRANSFORMAÇÃO', start: i * 0.4, end: i * 0.4 + 0.35 }));
  const cues = captionCues(words);
  const lag = Math.max(...cues.map((c) => c.start - c.words[0].start));
  assert(lag < 0.8, `atraso de ${lag}`);
});

Deno.test('valor longo do card encolhe em vez de quebrar sobre o rótulo', () => {
  const c = { ...ctx(), sources: [{ title: 't', url: 'https://a.com', text: '20 milhões' }] };
  const { ops } = normalizeOps([{ type: 'fact_card', items: [{ word_from: 0, word_to: 1, value: '20 MILHÕES DE SEGUIDORES', label: 'x', source_index: 0, source: 'a.com' }] }], c);
  assertStringIncludes(brandAss(ops, c)!, '\\fscx');
});
