-- hub-catalogo.sql — catálogo do hub completo (docs/hub-full-plano.md, frente A).
-- Idempotente. Aplicar pelo Lovable DEPOIS de video-catalog-precos.sql. Também
-- está no fim do bloco de catálogo do supabase/seed-instancia.sql.
--
-- Fontes: docs/catalogo-replicate.md (preços e schemas lidos em 2026-10-29) e
-- docs/catalogo-heygen.md. Preço HeyGen NÃO é oficial: essas linhas levam
-- cost.verified=false e a tela mostra "preço a confirmar".
--
-- Contrato das colunas novas (a tela do hub lê daqui):
--   provider        'replicate' | 'heygen' | 'higgsfield' | 'elevenlabs'
--   tier            'default' | 'top' | 'alt' | null (sem destaque)
--   experience[]    slugs: scenes, presenter_in_scenes, avatar_script,
--                   photo_presenter, digital_twin, idea_to_video, change_speech,
--                   translate, restyle, person_swap, captions, reframe_upscale, music
--   label           nome curto para a tela
--   retired_reason  por que saiu (active=false; a linha não é apagada)
-- Padrão · Top de uma experiência:
--   where active and :slug = any(experience)
--   order by (tier='default') desc, (tier='top') desc
--
-- Higgsfield não entra aqui: o motor lista os modelos em runtime
-- (models_explore → director_state.hf_catalog) e cobra em créditos.
--
-- Antes de aplicar: jobs parados com model_overrides apontando para uma linha
-- aposentada (§5) falham com "não está ativo" ao retomar. Conferir:
--   select id, status from public.video_scenes
--    where model_overrides::text ~ 'seedance-1-lite|kling-v2.5-turbo-pro|hailuo-2.3|omni-human"|p-video-avatar"|lipsync-2"';
--   select id, status from public.director_jobs
--    where status not in ('done','failed','cancelled')
--      and config::text ~ 'seedance-1-lite|kling-v2.5-turbo-pro|hailuo-2.3';
--
-- Linhas que dependem de $list / $map / {{duration_ms}} no renderer
-- (_shared/video-catalog.ts, frente B) nascem com active=false.

-- ── 1. Colunas ──────────────────────────────────────────────────────────────
alter table public.video_models add column if not exists provider text not null default 'replicate';
alter table public.video_models add column if not exists tier text;
alter table public.video_models add column if not exists experience text[] not null default '{}';
alter table public.video_models add column if not exists label text;
alter table public.video_models add column if not exists retired_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'video_models_tier_check') then
    alter table public.video_models
      add constraint video_models_tier_check check (tier is null or tier in ('default','top','alt'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'video_models_provider_check') then
    alter table public.video_models
      add constraint video_models_provider_check
      check (provider in ('replicate','heygen','higgsfield','elevenlabs'));
  end if;
end $$;

create index if not exists video_models_experience_idx on public.video_models using gin (experience);

-- Se a instância nasceu com check/enum em capability, ele precisa aceitar as
-- capabilities novas (no schema da docs/11 a coluna é text livre).
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.video_models'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%capability%'
  loop
    execute format('alter table public.video_models drop constraint %I', c.conname);
  end loop;
  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'video_models' and column_name = 'capability')
     = 'USER-DEFINED' then
    alter table public.video_models alter column capability type text using capability::text;
  end if;
end $$;

-- ── 2. Linhas novas ─────────────────────────────────────────────────────────
insert into public.video_models
  (capability, model_id, kind, provider, cost, limits, input_template, required_inputs,
   fallback_model_id, is_primary, active, tier, experience, label, notes)
values
-- Cenas (scene_i2v). Áudio nativo sempre desligado: a narração vem do TTS.
('scene_i2v','kwaivgi/kling-v4.0','official','replicate',
 '{"unit":"per_second","usd":0.157,"by_resolution":{"720p":0.157,"1080p":0.235}}',
 '{"duration_min":3,"duration_max":30,"resolutions":["720p","1080p"],"max_refs":4}',
 '{"prompt":"{{prompt}}","start_image":"{{keyframe_url}}","reference_images":"{{reference_urls}}","duration":"{{duration_int}}","resolution":"{{resolution}}"}',
 array['prompt'], null, false, true, 'top', array['scenes','presenter_in_scenes'], 'Kling 4.0',
 'Duração contínua de 3 a 30 s. Aceita o keyframe e as fotos do apresentador juntos.'),
('scene_i2v','google/veo-3.1','official','replicate',
 '{"unit":"per_second","usd":0.20}',
 '{"durations":[4,6,8],"resolutions":["720p","1080p"],"aspect_ratios":["9:16"]}',
 '{"prompt":"{{prompt}}","image":"{{keyframe_url}}","duration":"{{duration_int}}","resolution":"{{resolution}}","aspect_ratio":"9:16","negative_prompt":"{{negative_prompt}}","generate_audio":false}',
 array['prompt'], null, false, true, 'top', array['scenes'], 'Veo 3.1',
 'Visual de cinema. Cenas de 4, 6 ou 8 s.'),
('scene_i2v','google/veo-3.1-fast','official','replicate',
 '{"unit":"per_second","usd":0.10}',
 '{"durations":[4,6,8],"resolutions":["720p","1080p"],"aspect_ratios":["9:16"]}',
 '{"prompt":"{{prompt}}","image":"{{keyframe_url}}","duration":"{{duration_int}}","resolution":"{{resolution}}","aspect_ratio":"9:16","negative_prompt":"{{negative_prompt}}","generate_audio":false}',
 array['prompt'], null, false, true, null, array['scenes'], 'Veo 3.1 Fast',
 'Veo mais rápido e pela metade do preço. Cenas de 4, 6 ou 8 s.'),
('scene_i2v','alibaba/wan-3','official','replicate',
 '{"unit":"per_second","usd":0.05,"by_resolution":{"480p":0.025,"720p":0.05,"1080p":0.10}}',
 '{"duration_min":2,"duration_max":30,"resolutions":["480p","720p","1080p"]}',
 '{"prompt":"{{prompt}}","image":"{{keyframe_url}}","duration":"{{duration_int}}","resolution":"{{resolution}}","negative_prompt":"{{negative_prompt}}"}',
 array['prompt'], null, false, true, 'alt', array['scenes'], 'Wan 3',
 'O mais barato com duração contínua de 2 a 30 s.'),
('scene_i2v','bytedance/seedance-1.5-pro','official','replicate',
 '{"unit":"per_second","usd":0.026,"by_resolution":{"480p":0.013,"720p":0.026,"1080p":0.06}}',
 '{"duration_min":2,"duration_max":12,"resolutions":["480p","720p","1080p"]}',
 '{"prompt":"{{prompt}}","image":"{{keyframe_url}}","duration":"{{duration_int}}","resolution":"{{resolution}}","aspect_ratio":"9:16","generate_audio":false}',
 array['prompt'], null, false, true, 'alt', array['scenes'], 'Seedance 1.5 Pro',
 'Seedance econômico, cenas de 2 a 12 s.'),
('scene_i2v','vidu/q3-pro','official','replicate',
 '{"unit":"per_second","usd":0.15,"by_resolution":{"540p":0.07,"720p":0.15,"1080p":0.16}}',
 '{"duration_min":1,"duration_max":16,"resolutions":["540p","720p","1080p"]}',
 '{"prompt":"{{prompt}}","start_image":"{{keyframe_url}}","duration":"{{duration_int}}","resolution":"{{resolution}}","aspect_ratio":"9:16","audio":false}',
 array['prompt'], null, false, true, null, array['scenes'], 'Vidu Q3 Pro',
 'Cenas de 1 a 16 s.'),
('scene_i2v','kwaivgi/kling-v3-video','official','replicate',
 '{"unit":"per_second","usd":0.224}',
 '{"duration_min":3,"duration_max":15}',
 '{"prompt":"{{prompt}}","start_image":"{{keyframe_url}}","duration":"{{duration_int}}","mode":"pro","aspect_ratio":"9:16","negative_prompt":"{{negative_prompt}}","generate_audio":false}',
 array['prompt'], null, false, true, null, array['scenes'], 'Kling 3.0',
 'Modo pro (1080p) fixo até o renderer mapear resolução para modo.'),
('scene_i2v','pixverse/pixverse-v6-max','official','replicate',
 '{"unit":"per_second","usd":0.11,"by_resolution":{"720p":0.11,"1080p":0.22}}',
 '{"durations":[5,8,10,15],"resolutions":["720p","1080p"]}',
 '{"prompt":"{{prompt}}","image":"{{keyframe_url}}","duration":"{{duration_int}}","quality":"{{resolution}}","aspect_ratio":"9:16","negative_prompt":"{{negative_prompt}}","generate_audio_switch":false}',
 array['prompt'], null, false, true, null, array['scenes'], 'PixVerse 6 Max',
 'Cenas de 5, 8, 10 ou 15 s.'),
('scene_i2v','lightricks/ltx-2.3-pro','official','replicate',
 '{"unit":"per_second","usd":0.08,"by_resolution":{"1080p":0.08,"2k":0.16,"4k":0.32}}',
 '{"durations":[6,8,10],"resolutions":["1080p","2k","4k"]}',
 '{"task":"image_to_video","prompt":"{{prompt}}","image":"{{keyframe_url}}","duration":"{{duration_int}}","resolution":"{{resolution}}","aspect_ratio":"9:16","generate_audio":false}',
 array['prompt'], null, false, true, null, array['scenes'], 'LTX 2.3 Pro',
 '1080p barato; também 2K e 4K. Cenas de 6, 8 ou 10 s.'),
('scene_i2v','runwayml/gen-4.5','official','replicate',
 '{"unit":"per_second","usd":0.12}',
 '{"durations":[5,10]}',
 '{"prompt":"{{prompt}}","image":"{{keyframe_url}}","duration":"{{duration_int}}","aspect_ratio":"9:16"}',
 array['prompt'], null, false, true, null, array['scenes'], 'Runway Gen-4.5',
 'Cenas de 5 ou 10 s.'),
('scene_i2v','luma/ray-3.2','official','replicate',
 '{"unit":"per_second","usd":0.06,"by_resolution":{"540p":0.03,"720p":0.06,"1080p":0.24}}',
 '{"durations":[5],"resolutions":["540p","720p","1080p"]}',
 '{"prompt":"{{prompt}}","start_image":"{{keyframe_url}}","duration":5,"resolution":"{{resolution}}"}',
 array['prompt'], null, false, true, null, array['scenes'], 'Luma Ray 3.2',
 'Cenas de 5 s.'),
('scene_i2v','alibaba/happyhorse-1.1','official','replicate',
 '{"unit":"per_second","usd":0.14,"by_resolution":{"720p":0.14,"1080p":0.18}}',
 '{"duration_min":3,"duration_max":15,"resolutions":["720p","1080p"]}',
 '{"prompt":"{{prompt}}","images":{"$list":["keyframe_url","reference_urls"]},"duration":"{{duration_int}}","resolution":"{{resolution}}"}',
 array['prompt'], null, false, false, null, array['scenes','presenter_in_scenes'], 'HappyHorse 1.1',
 'Espera o renderer ($list): o keyframe vai como lista.'),

-- Apresentador falante (talking_avatar). A duração sai do áudio.
('talking_avatar','prunaai/p-video-2-pro-avatar','official','replicate',
 '{"unit":"per_second","usd":0.06,"by_resolution":{"480p":0.02,"768p":0.04,"1080p":0.06,"2k":0.08,"4k":0.12}}',
 '{"duration_from":"audio","max_duration_s":180,"resolutions":["480p","768p","1080p","2k","4k"]}',
 '{"image":"{{keyframe_url}}","audio":"{{audio_url}}","resolution":"{{resolution}}","prompt":"{{prompt}}"}',
 array['image','audio'], null, false, true, 'top', array['photo_presenter','presenter_in_scenes'], 'P-Video 2 Pro Avatar',
 'Sua foto fala o áudio, até 3 min.'),
('talking_avatar','bytedance/omni-human-1.5','official','replicate',
 '{"unit":"per_second","usd":0.16}',
 '{"duration_from":"audio","max_duration_s":15}',
 '{"image":"{{keyframe_url}}","audio":"{{audio_url}}","prompt":"{{prompt}}"}',
 array['image','audio'], null, false, true, 'top', array['photo_presenter','presenter_in_scenes'], 'OmniHuman 1.5',
 'Corpo e gestos. Fala de até 15 s (a qualidade cai depois).'),

-- Remake: estilo e cenário (scene_v2v)
('scene_v2v','kwaivgi/kling-v4.0','official','replicate',
 '{"unit":"per_second","usd":0.141,"by_resolution":{"720p":0.094,"1080p":0.141}}',
 '{"duration_min":3,"duration_max":30,"max_bytes":314572800,"resolutions":["720p","1080p"]}',
 '{"prompt":"{{prompt}}","base_video":"{{video_url}}","reference_images":"{{reference_urls}}","resolution":"{{resolution}}"}',
 array['prompt'], null, false, true, 'default', array['restyle'], 'Kling 4.0',
 'Vídeo de 3 a 30 s, até 300 MB. Mantém a duração.'),
('scene_v2v','wan-video/wan-2.7-videoedit','official','replicate',
 '{"unit":"per_second","usd":0.10}',
 '{"duration_min":2,"duration_max":10,"resolutions":["720p","1080p"]}',
 '{"video":"{{video_url}}","prompt":"{{prompt}}","reference_image":"{{reference_url}}","resolution":"{{resolution}}","audio_setting":"origin"}',
 array['video','prompt'], null, false, true, 'alt', array['restyle'], 'Wan 2.7 Edit',
 'Barato, para vídeos de até 10 s. Mantém o áudio.'),

-- Remake: trocar pessoa
('person_swap','wan-video/wan-2.2-animate-replace','official','replicate',
 '{"unit":"per_second","usd":0.05}',
 '{"max_refs":1}',
 '{"video":"{{video_url}}","character_image":"{{reference_url}}","resolution":"720","merge_audio":true}',
 array['video','character_image'], null, false, true, 'alt', array['person_swap'], 'Wan 2.2 Replace',
 'Econômico: 1 foto, 720p, mantém o áudio.'),

-- Fala: lipsync e TTS
('lipsync_post','heygen/lipsync-precision','official','replicate',
 '{"unit":"per_second","usd":0.0667}',
 '{}',
 '{"video":"{{video_url}}","audio":"{{audio_url}}","enable_dynamic_duration":true}',
 array['video','audio'], 'heygen/lipsync-speed', false, true, 'default', array['change_speech'], 'HeyGen Lipsync Precision',
 'O mesmo lipsync do Remake, pelo Replicate.'),
('lipsync_post','heygen/lipsync-speed','official','replicate',
 '{"unit":"per_second","usd":0.0333}',
 '{}',
 '{"video":"{{video_url}}","audio":"{{audio_url}}","enable_dynamic_duration":true}',
 array['video','audio'], null, false, true, 'alt', array['change_speech'], 'HeyGen Lipsync Speed',
 'Metade do preço, mais rápido.'),
('lipsync_post','sync/react-1','official','replicate',
 '{"unit":"per_second","usd":0.167}',
 '{}',
 '{"video":"{{video_url}}","audio":"{{audio_url}}","model_mode":"face","emotion":"neutral","sync_mode":"cut_off"}',
 array['video','audio'], null, false, true, 'top', array['change_speech'], 'Sync React-1',
 'Refaz o rosto com expressão.'),
('tts','minimax/speech-2.8-turbo','official','replicate',
 '{"unit":"per_1k_chars","usd":0.06}',
 '{"languages":["Portuguese"],"audio_formats":["mp3"],"bitrates":[32000,64000,128000,256000]}',
 '{"text":"{{text}}","voice_id":"{{voice_id}}","language_boost":"{{language_boost}}","audio_format":"mp3","bitrate":"{{bitrate}}","sample_rate":32000,"channel":"mono","emotion":"neutral","speed":1.0}',
 array['text'], null, false, true, 'alt', array['change_speech'], 'MiniMax 2.8 Turbo',
 'Voz mais barata.'),

-- Legendas (stt)
('stt','elevenlabs/scribe-v2','official','replicate',
 '{"unit":"per_second","usd":0.0000611}',
 '{}',
 '{"audio":"{{audio_url}}","language_code":"{{language_code}}","timestamps_granularity":"word","tag_audio_events":false}',
 array['audio'], null, true, true, 'default', array['captions'], 'ElevenLabs Scribe v2',
 'Transcrição com tempo por palavra. US$ 0,22 por hora.'),

-- Trilha (music)
('music','stability-ai/stable-audio-2.5','official','replicate',
 '{"unit":"per_run","usd":0.20}',
 '{"duration_min":1,"duration_max":190}',
 '{"prompt":"{{prompt}}","duration":"{{duration_int}}"}',
 array['prompt'], null, true, true, 'default', array['music'], 'Stable Audio 2.5',
 'Trilha instrumental de 1 a 190 s.'),
('music','elevenlabs/music','official','replicate',
 '{"unit":"per_second","usd":0.0083}',
 '{"duration_min":5,"duration_max":300}',
 '{"prompt":"{{prompt}}","music_length_ms":"{{duration_ms}}","force_instrumental":true}',
 array['prompt'], null, false, false, 'top', array['music'], 'ElevenLabs Music',
 'Espera o renderer ({{duration_ms}}).'),

-- Reenquadrar / upscale
('util_reframe','luma/reframe-video','official','replicate',
 '{"unit":"per_second","usd":0.06}',
 '{"duration_max":10}',
 '{"video":"{{video_url}}","aspect_ratio":"9:16"}',
 array['video'], null, true, true, 'default', array['reframe_upscale'], 'Luma Reframe',
 'Vídeo 16:9 vira 9:16. Até 10 s.'),

-- HeyGen (preço NÃO VERIFICADO; o body é o de POST /v3/videos e /v3/video-agents)
('avatar_video','heygen/avatar-iv','official','heygen',
 '{"unit":"per_second","usd":0.05,"verified":false}',
 '{"max_chars":5000,"max_duration_s":600,"resolutions":["720p","1080p"]}',
 '{"type":"avatar","avatar_id":"{{avatar_id}}","script":"{{text}}","voice_id":"{{voice_id}}","audio_url":"{{audio_url}}","aspect_ratio":"9:16","resolution":"{{resolution}}","engine":{"type":"avatar_iv"}}',
 array['avatar_id'], null, true, true, 'default', array['avatar_script','photo_presenter','digital_twin'], 'HeyGen Avatar IV',
 'Avatar fala o roteiro (até 5.000 caracteres). Serve para biblioteca, foto e clone.'),
('avatar_video','heygen/avatar-v','official','heygen',
 '{"unit":"per_second","usd":0.12,"verified":false}',
 '{"max_chars":5000,"max_duration_s":600,"resolutions":["720p","1080p"]}',
 '{"type":"avatar","avatar_id":"{{avatar_id}}","script":"{{text}}","voice_id":"{{voice_id}}","audio_url":"{{audio_url}}","aspect_ratio":"9:16","resolution":"{{resolution}}","engine":{"type":"avatar_v"}}',
 array['avatar_id'], null, false, true, 'top', array['avatar_script','digital_twin'], 'HeyGen Avatar V',
 'Maior fidelidade. Só nos avatares que aceitam este motor.'),
('avatar_video','heygen/avatar-iii','official','heygen',
 '{"unit":"per_second","usd":0,"verified":false}',
 '{"max_chars":5000,"max_duration_s":600,"resolutions":["720p","1080p","4k"]}',
 '{}',
 array['avatar_id'], null, false, true, null, array['digital_twin'], 'HeyGen Avatar III',
 'Clone em 4K. O body sai do builder do motor; a linha serve para custo e rótulo.'),
('video_agent','heygen/video-agent','official','heygen',
 '{"unit":"per_run","usd":0,"verified":false}',
 '{"max_chars":10000}',
 '{"mode":"generate","prompt":"{{prompt}}","avatar_id":"{{avatar_id}}","voice_id":"{{voice_id}}","orientation":"portrait"}',
 array['prompt'], null, true, true, 'default', array['idea_to_video'], 'HeyGen Video Agent',
 'Uma ideia vira um vídeo pronto, com a marca.'),
('translate','heygen/video-translation','official','heygen',
 '{"unit":"per_second","usd":0,"verified":false}',
 '{}',
 '{"video_url":"{{video_url}}","mode":"speed"}',
 array['video_url'], null, true, true, 'default', array['translate'], 'HeyGen Tradução',
 'Cobra pela duração do vídeo de origem.')
on conflict (capability, model_id) do update
  set kind = excluded.kind, provider = excluded.provider, cost = excluded.cost,
      limits = excluded.limits, input_template = excluded.input_template,
      required_inputs = excluded.required_inputs, fallback_model_id = excluded.fallback_model_id,
      active = excluded.active, tier = excluded.tier, experience = excluded.experience,
      label = excluded.label, notes = excluded.notes;

-- ── 3. Linhas que já existem: tier, experiência, rótulo ─────────────────────
update public.video_models v set tier = x.tier, experience = x.experience, label = x.label
from (values
  ('scene_i2v',     'bytedance/seedance-2.0',     'default', array['scenes'],                              'Seedance 2.0'),
  ('talking_avatar','veed/fabric-1.0',            'alt',     array['photo_presenter','presenter_in_scenes'], 'Fabric 1.0'),
  ('scene_v2v',     'runwayml/aleph-2',           'top',     array['restyle'],                             'Runway Aleph 2'),
  ('person_swap',   'prunaai/p-video-replace',    'default', array['person_swap'],                         'P-Video Replace'),
  ('tts',           'minimax/speech-02-hd',       'default', array['change_speech'],                       'MiniMax 02 HD'),
  ('tts',           'minimax/speech-2.8-hd',      'top',     array['change_speech'],                       'MiniMax 2.8 HD'),
  ('util_normalize','bytedance/video-upscaler',   'default', array['reframe_upscale'],                     'ByteDance Upscaler'),
  ('keyframe',      'google/nano-banana-2',       null,      array[]::text[],                              'Nano Banana 2'),
  ('keyframe',      'google/nano-banana-pro',     null,      array[]::text[],                              'Nano Banana Pro')
) as x(capability, model_id, tier, experience, label)
where v.capability = x.capability and v.model_id = x.model_id;

-- O Remake usa o Aleph como primário hoje; o hub sugere o Kling 4.0, mas a troca
-- de primário fica para quando o Kling v2v for testado de verdade (A/B).

-- ── 4. Primários e fallbacks ────────────────────────────────────────────────
-- TTS: o primário continua o 02-hd (é o caminho que funciona hoje; trocar
-- muda a voz de todo vídeo novo). O 2.8-hd aparece como "top" no hub; virar
-- primário só depois de um teste real com o OK do Samuel.
-- Lipsync: o HeyGen precision entra no lugar do lipsync-2. Nenhum código
-- resolve lipsync_post hoje (o Remake chama a API HeyGen direto): sem efeito
-- no que roda.
update public.video_models set is_primary = false where capability = 'lipsync_post' and model_id = 'sync/lipsync-2';
update public.video_models set is_primary = true  where capability = 'lipsync_post' and model_id = 'heygen/lipsync-precision';
-- Cenas: o fallback do Seedance 2.0 passa a ser o Kling 4.0 (duração contínua).
update public.video_models set fallback_model_id = 'kwaivgi/kling-v4.0'
 where capability = 'scene_i2v' and model_id = 'bytedance/seedance-2.0';
-- Fabric: fallback para a v2 pro do P-Video Avatar.
update public.video_models set fallback_model_id = 'prunaai/p-video-2-pro-avatar'
 where capability = 'talking_avatar' and model_id = 'veed/fabric-1.0';

-- ── 5. Aposentadas (active=false, sem apagar) ───────────────────────────────
update public.video_models v set active = false, is_primary = false, tier = null,
       experience = '{}', retired_reason = x.reason
from (values
  ('scene_i2v',     'bytedance/seedance-1-lite',    'Mais caro e mais antigo que o Seedance 1.5 Pro.'),
  ('scene_t2v',     'bytedance/seedance-1-lite',    'Texto → vídeo sem uso no motor.'),
  ('scene_t2v',     'pixverse/pixverse-v6',         'Texto → vídeo sem uso no motor.'),
  ('scene_i2v',     'kwaivgi/kling-v2.5-turbo-pro', 'Só 5 ou 10 s: sobram segundos mudos. Substituto: Kling 4.0.'),
  ('scene_i2v',     'minimax/hailuo-2.3',           'Só 6 ou 10 s, preso em 768p e cobrado por vídeo.'),
  ('talking_avatar','bytedance/omni-human',         'A qualidade cai depois de 15 s. Substituto: OmniHuman 1.5.'),
  ('talking_avatar','prunaai/p-video-avatar',       'Substituído pelo P-Video 2 Pro Avatar.'),
  ('lipsync_post',  'sync/lipsync-2',               'Sem uso. Substituto: HeyGen Lipsync Precision.')
) as x(capability, model_id, reason)
where v.capability = x.capability and v.model_id = x.model_id;

-- Ninguém aponta para uma linha aposentada.
update public.video_models set fallback_model_id = null
 where fallback_model_id in (
   select model_id from public.video_models r
    where r.active = false and r.retired_reason is not null
      and r.capability = public.video_models.capability);
