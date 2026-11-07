-- video-catalog-precos.sql — correções do catálogo de vídeo (mapa §5, 2026-10-29).
-- Idempotente. Aplicar pelo Lovable. Também está no fim do bloco de catálogo do
-- supabase/seed-instancia.sql (instância nova já nasce certa).
--
-- O que muda:
--   #3  Aleph-2 (scene_v2v) existe em toda instância, com o template certo:
--       só video + prompt. reference_image não existe no schema, e
--       keyframe_images/positions são quadros do próprio vídeo, não foto de
--       pessoa — trocar a pessoa é outra capability (person_swap).
--   #4 #16 #18  preço oficial do Replicate, com tabela por resolução onde o
--       provedor cobra diferente (cost.by_resolution); `usd` = preço na
--       resolução que o sistema manda por padrão (é o que a tela mostra).
--   #12 OmniHuman com teto de 15 s (a qualidade cai depois disso).
--   #13 Fabric: só 480p/720p, até 60 s (o pipeline agora ajusta a resolução).
--   #19 Hailuo fixo em 768p (o template já fixa; limits dizia 1080p).
--   #20 p-video-avatar: hash desatualizado → null (usa a versão oficial
--       atual) e o áudio passa a ser obrigatório.

-- ── #3 Aleph-2 ───────────────────────────────────────────────────────────────
insert into public.video_models
  (capability, model_id, kind, cost, limits, input_template, is_primary, active, required_inputs, notes)
values
  ('scene_v2v', 'runwayml/aleph-2', 'official',
   '{"unit":"per_second","usd":0.336}'::jsonb,
   '{"duration_min":2,"duration_max":30,"max_duration_s":30,"max_bytes":16777216}'::jsonb,
   '{"video":"{{video_url}}","prompt":"{{prompt}}"}'::jsonb,
   true, true, array['video','prompt'],
   'Melhorar um vídeo meu: estilo, cena e personagem preservando fala e movimento. Vídeo de 2 a 30 s e menor que 16 MB.')
on conflict (capability, model_id) do update
  set input_template = excluded.input_template,
      limits = excluded.limits,
      required_inputs = excluded.required_inputs,
      notes = excluded.notes;

-- ── Trocar pessoa: capability própria (person_swap) ─────────────────────────
-- prunaai/p-video-replace (README do Replicate, 2026-10-29): video + images
-- (1 a 3 fotos da pessoa), instruction_prompt opcional, resolution 720p|1080p,
-- save_audio para manter a fala original. Cobra por segundo de saída:
-- 720p US$ 0,03 · 1080p US$ 0,06. O enquadramento segue o vídeo de origem.
insert into public.video_models
  (capability, model_id, kind, cost, limits, input_template, is_primary, active, required_inputs, notes)
values
  ('person_swap', 'prunaai/p-video-replace', 'official',
   '{"unit":"per_second","usd":0.06,"by_resolution":{"720p":0.03,"1080p":0.06}}'::jsonb,
   '{"resolutions":["720p","1080p"],"max_refs":3}'::jsonb,
   '{"video":"{{video_url}}","images":"{{reference_urls}}","instruction_prompt":"{{prompt}}",
     "resolution":"{{resolution}}","save_audio":true}'::jsonb,
   true, true, array['video','images'],
   'Trocar pessoa: a pessoa das fotos (1 a 3) no lugar da do vídeo, mesmo movimento, câmera e fala.')
on conflict (capability, model_id) do update
  set cost = excluded.cost, limits = excluded.limits, input_template = excluded.input_template,
      required_inputs = excluded.required_inputs, notes = excluded.notes;

-- ── #4 #16 #18 preços oficiais ──────────────────────────────────────────────
update public.video_models set cost =
  '{"unit":"per_second","usd":0.45,"by_resolution":{"480p":0.08,"720p":0.18,"1080p":0.45,"4k":1.00}}'::jsonb
 where model_id = 'bytedance/seedance-2.0';
update public.video_models set cost =
  '{"unit":"per_second","usd":0.072,"by_resolution":{"480p":0.018,"720p":0.036,"1080p":0.072}}'::jsonb
 where model_id = 'bytedance/seedance-1-lite';
update public.video_models set cost =
  '{"unit":"per_second","usd":0.15,"by_resolution":{"480p":0.08,"720p":0.15}}'::jsonb,
  limits = '{"max_duration_s":60,"resolutions":["480p","720p"],"duration_from":"audio"}'::jsonb
 where model_id = 'veed/fabric-1.0';
update public.video_models set cost =
  '{"unit":"per_second","usd":0.045,"by_resolution":{"720p":0.025,"1080p":0.045}}'::jsonb,
  limits = '{"resolutions":["720p","1080p"],"duration_from":"audio"}'::jsonb,
  input_template = '{"image":"{{keyframe_url}}","audio":"{{audio_url}}","resolution":"{{resolution}}"}'::jsonb,
  version_hash = null,
  required_inputs = array['image','audio']
 where model_id = 'prunaai/p-video-avatar';
update public.video_models set cost = '{"unit":"per_second","usd":0.0069}'::jsonb
 where model_id = 'bytedance/video-upscaler';
update public.video_models set cost = '{"unit":"per_second","usd":0.05}'::jsonb
 where model_id = 'sync/lipsync-2';
update public.video_models set cost = '{"unit":"per_image","usd":0.15}'::jsonb
 where model_id = 'google/nano-banana-pro';
update public.video_models set cost = '{"unit":"per_image","usd":0.067}'::jsonb
 where model_id = 'google/nano-banana-2';

-- ── #12 OmniHuman: teto de 15 s ─────────────────────────────────────────────
update public.video_models
   set limits = '{"duration_from":"audio","max_duration_s":15}'::jsonb
 where model_id = 'bytedance/omni-human';

-- ── #19 Hailuo: 768p fixo (6 s = US$ 0,28; 10 s = US$ 0,56) ─────────────────
update public.video_models
   set limits = '{"durations":[6,10],"resolutions":["768p"],"aspect_from":"image"}'::jsonb,
       cost = '{"unit":"per_second","usd":0.0467}'::jsonb
 where model_id = 'minimax/hailuo-2.3';
