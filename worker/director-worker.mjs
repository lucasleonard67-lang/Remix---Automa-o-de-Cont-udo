#!/usr/bin/env node
// director-worker — worker do agente-diretor (fora do edge runtime: ffmpeg + loops longos).
// Fluxo: claim job → director-plan (edge fn) → TTS (ElevenLabs) → keyframes (Higgsfield MCP)
//   → [gate] → vídeos (Seedance omni) → montagem/master (ffmpeg) → entrega no bucket renders.
// Estado persistido em director_jobs (status + artifacts como checkpoint idempotente).
// Auth: usuário admin via password grant (RLS manda; nenhuma service key aqui).
// Docs: ../supabase/migrations/202608210030_director_jobs.sql · ../../poc-agente-diretor/.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';
import path from 'node:path';

// ── env ──────────────────────────────────────────────────────────────────────
const envFile = path.join(import.meta.dirname, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const env = (k, d) => process.env[k] ?? d ?? (() => { throw new Error(`env ${k} ausente`); })();
const SB = env('SUPABASE_URL');
const ANON = env('SUPABASE_ANON_KEY');
const FFMPEG = env('FFMPEG', 'ffmpeg');
const FFPROBE = env('FFPROBE', 'ffprobe');
const ELEVEN_KEY = env('ELEVEN_API_KEY');
const VOICE = env('ELEVEN_VOICE_ID', 'yxcG28bYeAMra6K4nj10'); // Osmar (pt-BR)
const MCP_URL = 'https://mcp.higgsfield.ai/mcp';
const TOKEN_FILE = env('HF_MCP_TOKEN_FILE', path.join(import.meta.dirname, 'hf-tokens.json'));
const WORKER_ID = `${hostname()}#${process.pid}`;
const TMP = path.join(import.meta.dirname, 'tmp');
mkdirSync(TMP, { recursive: true });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// fetch com retry p/ falhas transitórias de rede ("fetch failed", 5xx de CDN etc.)
async function rfetch(url, opts, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, opts);
      if (r.status >= 500 && i < tries) throw new Error(`HTTP ${r.status}`);
      return r;
    } catch (err) {
      if (i >= tries) throw err;
      log(`rfetch retry ${i}/${tries - 1} (${err.message}) ${String(url).slice(0, 60)}`);
      await new Promise((res) => setTimeout(res, 2000 * i));
    }
  }
}

// ── supabase (REST, usuário admin) ───────────────────────────────────────────
let jwt = null, jwtAt = 0;
async function login() {
  if (jwt && Date.now() - jwtAt < 45 * 60_000) return jwt;
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env('WORKER_EMAIL'), password: env('WORKER_PASSWORD') }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login falhou: ${JSON.stringify(j).slice(0, 200)}`);
  jwt = j.access_token; jwtAt = Date.now();
  return jwt;
}
async function sb(pathname, opts = {}) {
  const t = await login();
  const r = await fetch(`${SB}${pathname}`, {
    ...opts,
    headers: {
      apikey: ANON, Authorization: `Bearer ${t}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
      ...(opts.headers ?? {}),
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`supabase ${pathname}: ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const updateJob = (id, patch) =>
  sb(`/rest/v1/director_jobs?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
async function uploadStorage(objPath, buf, contentType) {
  for (let i = 1; ; i++) {
    const t = await login();
    try {
      const r = await fetch(`${SB}/storage/v1/object/renders/${objPath}`, {
        method: 'POST',
        headers: { apikey: ANON, Authorization: `Bearer ${t}`, 'Content-Type': contentType, 'x-upsert': 'true' },
        body: buf,
      });
      if (r.ok) return objPath;
      const body = (await r.text()).slice(0, 200);
      if (i >= 3) throw new Error(`upload ${objPath}: ${r.status} ${body}`);
      log(`upload retry ${i}/2 (${r.status}) ${objPath}`);
    } catch (err) {
      if (i >= 3) throw err;
      log(`upload retry ${i}/2 (${err.message}) ${objPath}`);
    }
    jwt = null; // força re-login na próxima tentativa
    await new Promise((res) => setTimeout(res, 3000 * i));
  }
}
async function signUrl(objPath, expiresIn = 86400) {
  const t = await login();
  const r = await fetch(`${SB}/storage/v1/object/sign/renders/${objPath}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn }),
  });
  const j = await r.json();
  if (!j.signedURL) throw new Error(`sign ${objPath} falhou`);
  return `${SB}/storage/v1${j.signedURL}`;
}

// ── Higgsfield MCP client (OAuth refresh com rotação) ────────────────────────
let hfSession = null;
async function hfToken() {
  const tok = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
  if (tok.obtained_at && Date.now() - tok.obtained_at < (tok.expires_in - 300) * 1000) {
    return tok.access_token;
  }
  const r = await fetch('https://mcp.higgsfield.ai/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: tok.refresh_token,
      client_id: env('HF_MCP_CLIENT_ID'), resource: MCP_URL,
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`refresh HF falhou: ${JSON.stringify(j).slice(0, 200)}`);
  j.obtained_at = Date.now();
  if (!j.refresh_token) j.refresh_token = tok.refresh_token;
  writeFileSync(TOKEN_FILE, JSON.stringify(j)); // rotação persistida
  hfSession = null;
  return j.access_token;
}
async function mcpPost(payload, session) {
  const t = await hfToken();
  const r = await rfetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${t}`, ...(session ? { 'mcp-session-id': session } : {}),
    },
    body: JSON.stringify(payload),
  });
  const sid = r.headers.get('mcp-session-id');
  const raw = await r.text();
  let data = null;
  for (const line of raw.split('\n')) if (line.startsWith('data:')) data = JSON.parse(line.slice(5));
  if (!data && raw.trim()) data = JSON.parse(raw);
  return { data, sid };
}
async function mcp(name, args) {
  if (!hfSession) {
    const { data, sid } = await mcpPost({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'mega-director-worker', version: '0.1' } },
    });
    if (!data?.result) throw new Error('MCP init falhou');
    await mcpPost({ jsonrpc: '2.0', method: 'notifications/initialized' }, sid);
    hfSession = sid;
  }
  const { data } = await mcpPost(
    { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name, arguments: args } },
    hfSession,
  );
  if (data?.error) {
    if (String(data.error.message ?? '').toLowerCase().includes('session')) { hfSession = null; return mcp(name, args); }
    throw new Error(`MCP ${name}: ${JSON.stringify(data.error).slice(0, 300)}`);
  }
  return (data?.result?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}
const uuidRe = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/;
async function hfBalance() {
  const m = (await mcp('balance', {})).match(/Credits:\s*([\d.]+)/);
  return m ? Number(m[1]) : null;
}
async function hfImportImage(url) {
  const out = await mcp('media_import_url', { url, type: 'image' });
  return out.match(uuidRe)?.[0] ?? (() => { throw new Error(`import falhou: ${out.slice(0, 200)}`); })();
}
async function hfUploadAudio(file) {
  const out = await mcp('media_upload', { files: [{ filename: path.basename(file) }], type: 'audio' });
  const mediaId = out.match(uuidRe)?.[0];
  const url = out.match(/'(https:\/\/[^']+)'/)?.[1];
  if (!mediaId || !url) throw new Error(`media_upload: ${out.slice(0, 200)}`);
  const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'audio/mpeg' }, body: readFileSync(file) });
  if (!put.ok) throw new Error(`PUT audio ${put.status}`);
  await mcp('media_confirm', { type: 'audio', media_ids: [mediaId] });
  return mediaId;
}
async function hfGenerate(tool, params) {
  let out = await mcp(tool, { params });
  const preset = out.match(/declined_preset_id:\s*"([a-f0-9-]+)"/) ?? out.match(/Preset id:\s*([a-f0-9-]+)/);
  if (preset && !out.includes('Submitted')) {
    out = await mcp(tool, { params: { ...params, declined_preset_id: preset[1] } });
  }
  const jobId = out.match(/^- ([a-f0-9-]{36})/m)?.[1];
  if (!jobId) throw new Error(`${tool} sem job id: ${out.slice(0, 250)}`);
  return jobId;
}
async function hfWait(jobId, timeoutMs = 10 * 60_000) {
  const t0 = Date.now();
  for (;;) {
    const out = await mcp('job_status', { jobId, sync: true });
    if (out.includes('completed')) {
      const url = out.match(/https:\/\/[^\s"]+\.(?:png|mp4|webp|jpg)/)?.[0];
      if (!url) throw new Error(`completed sem url: ${out.slice(0, 200)}`);
      return url;
    }
    if (/failed|nsfw/.test(out)) throw new Error(`job ${jobId}: ${out.slice(0, 200)}`);
    if (Date.now() - t0 > timeoutMs) throw new Error(`job ${jobId} timeout`);
    await new Promise((r) => setTimeout(r, 8000));
  }
}

// ── mídia (ffmpeg) ───────────────────────────────────────────────────────────
const ff = (args) => execFileSync(FFMPEG, ['-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
const probeDur = (f) =>
  Number(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());
async function download(url, file) {
  const r = await rfetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return file;
}

// ── ElevenLabs ───────────────────────────────────────────────────────────────
async function sfx(text, seconds, outFile) {
  const r = await rfetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST',
    headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, duration_seconds: Math.min(22, seconds), prompt_influence: 0.4 }),
  });
  if (!r.ok) throw new Error(`sfx ${r.status}: ${(await r.text()).slice(0, 200)}`);
  writeFileSync(outFile, Buffer.from(await r.arrayBuffer()));
  return outFile;
}

async function tts(text, outBase) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_v3', voice_settings: { stability: 0.5 } }),
  });
  if (!r.ok) throw new Error(`elevenlabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const raw = `${outBase}-raw.mp3`;
  writeFileSync(raw, Buffer.from(await r.arrayBuffer()));
  const wav = `${outBase}.wav`;
  ff(['-i', raw, '-af',
    'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse',
    wav]);
  const mp3 = `${outBase}.mp3`;
  ff(['-i', wav, '-b:a', '128k', mp3]);
  return { wav, mp3, dur: probeDur(wav) };
}

// ── estágios ─────────────────────────────────────────────────────────────────
async function stagePlanning(job) {
  const t = await login();
  const r = await fetch(`${SB}/functions/v1/director-plan`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_id: job.id }),
  });
  const j = await r.json();
  if (!r.ok || !j.plan) throw new Error(`director-plan: ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  // lint estrutural (docs/13): 30° entre vizinhos e CTA com personagem
  const shots = j.plan.shots;
  for (let i = 1; i < shots.length; i++) {
    if (shots[i].scale === shots[i - 1].scale) {
      shots[i].scale = shots[i].scale === 'CLOSE' ? 'MEDIO' : 'CLOSE'; // correção mínima; warning
      log(`lint 30°: shot ${shots[i].idx} escala repetida — ajustada`);
    }
  }
  await updateJob(job.id, { plan: j.plan, status: 'tts' });
  return { ...job, plan: j.plan, status: 'tts' };
}

async function stageTts(job) {
  const dir = path.join(TMP, job.id); mkdirSync(dir, { recursive: true });
  const arts = job.artifacts ?? {};
  arts.tts = arts.tts ?? [];
  let chars = 0;
  for (const shot of job.plan.shots) {
    if (arts.tts.find((t) => t.shot === shot.idx)) continue; // checkpoint
    const { wav, mp3, dur } = await tts(shot.speech, path.join(dir, `b${shot.idx}`));
    chars += shot.speech.length;
    const base = `director/${job.id}/tts/b${shot.idx}`;
    await uploadStorage(`${base}.wav`, readFileSync(wav), 'audio/wav');
    await uploadStorage(`${base}.mp3`, readFileSync(mp3), 'audio/mpeg');
    arts.tts.push({ shot: shot.idx, path: `${base}.wav`, mp3: `${base}.mp3`, dur_s: dur });
    await updateJob(job.id, { artifacts: arts, costs: { ...(job.costs ?? {}), eleven_chars: ((job.costs ?? {}).eleven_chars ?? 0) + chars } });
    log(`tts b${shot.idx}: ${dur.toFixed(2)}s`);
  }
  await updateJob(job.id, { status: 'keyframes' });
  return { ...job, artifacts: arts, status: 'keyframes' };
}

async function stageKeyframes(job) {
  const dir = path.join(TMP, job.id); mkdirSync(dir, { recursive: true });
  const arts = job.artifacts ?? {}; arts.keyframes = arts.keyframes ?? [];
  if (!(job.costs ?? {}).hf_credits_start) {
    const bal = await hfBalance();
    job.costs = { ...(job.costs ?? {}), hf_credits_start: bal };
    await updateJob(job.id, { costs: job.costs });
  }
  const identityRef = job.brief.identity_ref ?? null;
  for (const shot of job.plan.shots) {
    if (arts.keyframes.find((k) => k.shot === shot.idx)) continue;
    const params = {
      model: 'nano_banana_pro', aspect_ratio: '9:16', resolution: '2k', count: 1,
      prompt: `${shot.keyframe_prompt} ${job.plan.look_lock}`,
      ...(shot.with_character && identityRef
        ? { medias: [{ value: identityRef, role: 'image_references' }] }
        : {}),
    };
    const hfJob = await hfGenerate('generate_image', params);
    const url = await hfWait(hfJob);
    const file = await download(url, path.join(dir, `kf${shot.idx}.png`));
    const objPath = `director/${job.id}/keyframes/kf${shot.idx}.png`;
    await uploadStorage(objPath, readFileSync(file), 'image/png');
    arts.keyframes.push({ shot: shot.idx, path: objPath, hf_url: url });
    await updateJob(job.id, { artifacts: arts });
    log(`keyframe ${shot.idx} ok`);
  }
  const auto = job.config?.auto_approve_keyframes ?? true;
  const next = job.config?.skip_video ? 'done' : auto ? 'videos' : 'awaiting_keyframe_approval';
  await updateJob(job.id, { status: next });
  if (next === 'done') log('skip_video: parado nos keyframes (smoke).');
  return { ...job, artifacts: arts, status: next };
}

async function stageVideos(job) {
  const dir = path.join(TMP, job.id); mkdirSync(dir, { recursive: true });
  const arts = job.artifacts ?? {}; arts.videos = arts.videos ?? [];
  const budget = Number(job.config?.budget_credits ?? 0);
  for (const shot of job.plan.shots) {
    if (arts.videos.find((v) => v.shot === shot.idx)) continue;
    if (budget > 0 && job.costs?.hf_credits_start != null) {
      const bal = await hfBalance().catch(() => null);
      if (bal != null && job.costs.hf_credits_start - bal >= budget) {
        throw new Error(`budget_exceeded: ${(job.costs.hf_credits_start - bal).toFixed(0)}/${budget} créditos antes do shot ${shot.idx}`);
      }
    }
    const kf = arts.keyframes.find((k) => k.shot === shot.idx);
    const startId = await hfImportImage(kf.hf_url ?? (await signUrl(kf.path)));
    const speech = arts.tts.find((t) => t.shot === shot.idx);
    const dur = Math.min(30, Math.max(4, Math.ceil(speech.dur_s + 1)));
    const isCta = shot.role === 'cta';
    const medias = [{ value: startId, role: 'start_image' }];
    if (isCta) {
      const mp3Local = await download(await signUrl(speech.mp3), path.join(dir, `cta${shot.idx}.mp3`));
      // fala curta demais é rejeitada como audio ref (422); acolchoa até ≥3s
      // (0,3s de respiro antes + silêncio no fim — ele termina e sustenta o olhar)
      let refAudio = mp3Local;
      if (speech.dur_s < 2.8) {
        refAudio = path.join(dir, `cta${shot.idx}-pad.mp3`);
        ff(['-i', mp3Local, '-af', `adelay=300:all=1,apad=whole_dur=${Math.max(3.2, speech.dur_s + 1.5).toFixed(1)}`, '-b:a', '128k', refAudio]);
      }
      medias.push({ value: await hfUploadAudio(refAudio), role: 'audio_references' });
    }
    const hfJob = await hfGenerate('generate_video', {
      model: 'seedance_2_5', mode: 'omni_reference', aspect_ratio: '9:16',
      duration: dur, resolution: '1080p', generate_audio: true,
      prompt: shot.motion_prompt, medias,
    });
    const url = await hfWait(hfJob, 15 * 60_000);
    const file = await download(url, path.join(dir, `v${shot.idx}.mp4`));
    const objPath = `director/${job.id}/videos/v${shot.idx}.mp4`;
    await uploadStorage(objPath, readFileSync(file), 'video/mp4');
    arts.videos.push({ shot: shot.idx, path: objPath, dur_s: probeDur(file), cta: isCta });
    await updateJob(job.id, { artifacts: arts });
    log(`video ${shot.idx} ok (${dur}s)`);
  }
  await updateJob(job.id, { status: 'assembling' });
  return { ...job, artifacts: arts, status: 'assembling' };
}

async function stageAssemble(job) {
  const dir = path.join(TMP, job.id); mkdirSync(dir, { recursive: true });
  const arts = job.artifacts ?? {};
  const shots = [...job.plan.shots].sort((a, b) => a.idx - b.idx);
  // garante arquivos locais (retomada pós-crash re-baixa do bucket)
  for (const s of shots) {
    const v = path.join(dir, `v${s.idx}.mp4`);
    if (!existsSync(v)) await download(await signUrl(arts.videos.find((x) => x.shot === s.idx).path), v);
    const b = path.join(dir, `b${s.idx}.wav`);
    if (!existsSync(b)) await download(await signUrl(arts.tts.find((x) => x.shot === s.idx).path), b);
  }
  // cama de ambiência ÚNICA atravessando todos os cortes (room tone costura o filme;
  // áudio nativo dos b-rolls é DESCARTADO — cada clipe trazia uma "sala" diferente).
  let offset = 0; const offsets = new Map();
  shots.forEach((s) => { offsets.set(s.idx, offset); offset += arts.videos.find((x) => x.shot === s.idx).dur_s; });
  const total = offset;
  const ambLocal = path.join(dir, 'amb.mp3');
  if (!existsSync(ambLocal)) {
    await sfx(
      `Consistent cinematic room tone ambience: ${job.plan.concept}. Steady industrial background hum, ` +
      `distant machinery, air ventilation, spacious hall. No music, no voices, no sudden loud sounds, loopable.`,
      22, ambLocal);
  }
  const cta = shots.find((s) => s.role === 'cta');
  const inputs = []; const fc = []; const pairs = [];
  shots.forEach((s) => { inputs.push('-i', path.join(dir, `v${s.idx}.mp4`)); });
  const narIdx0 = shots.length;
  const narShots = shots.filter((s) => s.role !== 'cta');
  narShots.forEach((s) => inputs.push('-i', path.join(dir, `b${s.idx}.wav`)));
  const ambIdx = narIdx0 + narShots.length;
  inputs.push('-stream_loop', '-1', '-i', ambLocal);
  shots.forEach((s, i) => { fc.push(`[${i}:v]fps=30,setsar=1[v${i}]`); pairs.push(`[v${i}]`); });
  fc.push(`${pairs.join('')}concat=n=${shots.length}:v=1[v]`);
  const mixLabels = [];
  // bed contínuo com fades, por baixo de TUDO (inclusive do CTA)
  fc.push(`[${ambIdx}:a]atrim=0:${(total + 0.1).toFixed(2)},highpass=f=35,lowpass=f=7000,` +
    `afade=t=in:d=0.5,afade=t=out:st=${(total - 0.7).toFixed(2)}:d=0.7,volume=0.4,` +
    `aformat=sample_rates=44100:channel_layouts=stereo[bed]`);
  mixLabels.push('[bed]');
  // fala do CTA: áudio nativo do clipe (voz+sala do seedance), na posição dele
  if (cta) {
    const ctaIn = shots.indexOf(cta);
    const delay = Math.round(offsets.get(cta.idx) * 1000);
    fc.push(`[${ctaIn}:a]adelay=${delay}:all=1,aformat=sample_rates=44100:channel_layouts=stereo[ctaa]`);
    mixLabels.push('[ctaa]');
  }
  narShots.forEach((s, k) => {
    const delay = Math.round((offsets.get(s.idx) + 0.35) * 1000);
    fc.push(`[${narIdx0 + k}:a]highpass=f=100,aecho=0.92:0.9:23|47:0.09|0.05,adelay=${delay}:all=1,` +
      `aformat=sample_rates=44100:channel_layouts=stereo[n${k}]`);
    mixLabels.push(`[n${k}]`);
  });
  fc.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=longest:normalize=0,` +
    `atrim=0:${(total + 0.05).toFixed(2)},loudnorm=I=-14:TP=-1.0:LRA=9,aresample=44100[a]`);
  const finalLocal = path.join(dir, 'final.mp4');
  ff([...inputs, '-filter_complex', fc.join(';'), '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-crf', '19', '-preset', 'medium', '-c:a', 'aac', '-b:a', '160k', finalLocal]);
  const previewLocal = path.join(dir, 'preview-audio.mp3');
  ff(['-i', finalLocal, '-vn', '-b:a', '160k', previewLocal]);
  const finalPath = `director/${job.id}/final.mp4`;
  const previewPath = `director/${job.id}/preview-audio.mp3`;
  await uploadStorage(finalPath, readFileSync(finalLocal), 'video/mp4');
  await uploadStorage(previewPath, readFileSync(previewLocal), 'audio/mpeg');
  arts.final = finalPath; arts.preview_audio = previewPath;
  const balEnd = await hfBalance().catch(() => null);
  const costs = { ...(job.costs ?? {}), hf_credits_end: balEnd };
  if (balEnd != null && costs.hf_credits_start != null) {
    costs.hf_credits_spent = Number((costs.hf_credits_start - balEnd).toFixed(1));
  }
  const auto = job.config?.auto_approve_audio ?? true;
  await updateJob(job.id, { artifacts: arts, costs, status: auto ? 'done' : 'awaiting_audio_approval' });
  log(`final: ${finalPath} (${probeDur(finalLocal).toFixed(1)}s) · créditos gastos: ${costs.hf_credits_spent ?? '?'}`);
  return { ...job, artifacts: arts, status: 'done' };
}

const STAGES = {
  planning: stagePlanning, plan_ready: stagePlanning, tts: stageTts,
  keyframes: stageKeyframes, videos: stageVideos,
  assembling: stageAssemble, mastering: stageAssemble,
};

// ── loop principal ───────────────────────────────────────────────────────────
async function nextJob() {
  const claimed = await sb('/rest/v1/rpc/claim_director_job', {
    method: 'POST', body: JSON.stringify({ p_worker: WORKER_ID }),
  });
  if (claimed?.length) return claimed[0];
  // retomadas: runnable e (meu, ou livre, ou órfão >10min). "Livre" = sem
  // claimed_by: a edge solta o lease mas mantém claimed_at como "último tick".
  const rows = await sb(
    `/rest/v1/director_jobs?status=in.(planning,plan_ready,tts,keyframes,videos,assembling,mastering)` +
    `&or=(claimed_by.eq.${encodeURIComponent(WORKER_ID)},claimed_by.is.null,claimed_at.lt.${new Date(Date.now() - 10 * 60_000).toISOString()})` +
    `&order=created_at&limit=1`);
  if (rows?.length) {
    await updateJob(rows[0].id, { claimed_by: WORKER_ID, claimed_at: new Date().toISOString() });
    return rows[0];
  }
  return null;
}

async function runJob(job) {
  log(`job ${job.id} → ${job.status}`);
  // multi-cena (sequence_group) é exclusivo da lane edge: este worker gera por
  // shot e quebraria (ou pagaria em dobro) um job agrupado — solta e pula.
  const grouped = (job.plan?.shots ?? []).some((s) => (s.sequence_group ?? 0) > 0);
  if (grouped) {
    log(`job ${job.id} tem sequence_group — deixando para a lane edge`);
    await updateJob(job.id, { claimed_by: null, claimed_at: null }).catch(() => {});
    return;
  }
  try {
    while (STAGES[job.status]) {
      job = await STAGES[job.status](job);
      if (['awaiting_keyframe_approval', 'awaiting_audio_approval', 'done'].includes(job.status)) break;
    }
    log(`job ${job.id} ⇒ ${job.status}`);
  } catch (err) {
    log(`job ${job.id} FALHOU: ${err.message}`);
    await updateJob(job.id, { status: 'failed', error: String(err.message).slice(0, 800) }).catch(() => {});
  }
}

const POLL = Number(env('POLL_SECONDS', '15')) * 1000;
log(`director-worker ${WORKER_ID} · poll ${POLL / 1000}s · ffmpeg=${FFMPEG}`);
for (;;) {
  try {
    const job = await nextJob();
    if (job) await runJob(job);
    else await new Promise((r) => setTimeout(r, POLL));
  } catch (err) {
    log(`loop: ${err.message}`);
    await new Promise((r) => setTimeout(r, POLL));
  }
}
