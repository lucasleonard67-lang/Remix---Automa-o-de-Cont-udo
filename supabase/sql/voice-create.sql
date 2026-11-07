-- voice-create.sql — catálogo do construtor de voz (docs/construtor-de-voz.md §6).
-- Idempotente e aditivo. Aplicar depois de hub-catalogo.sql (usa as colunas
-- provider/tier/experience/label). Também está no fim do bloco de catálogo do
-- supabase/seed-instancia.sql.
--
-- As linhas servem para custo e rótulo: o body sai do cliente do motor
-- (_shared/voices.ts). cost.verified=false → a tela mostra "preço a confirmar";
-- usd 0 com verified=false quer dizer "sem valor na fonte", nunca "grátis".
-- PVC (clone profissional) nasce inativo. O TTS HeyGen também: só liga depois
-- da ordem nova da voz no director-advance (§4.4) estar no ar:
--   update public.video_models set active = true
--    where capability = 'tts' and model_id = 'heygen/voice-1-turbo-free';
insert into public.video_models
  (capability, model_id, kind, provider, cost, limits, input_template, required_inputs,
   fallback_model_id, is_primary, active, tier, experience, label, notes)
values
('voice_create','elevenlabs/voice-clone-instant','official','elevenlabs',
 '{"unit":"per_run","usd":0,"verified":false,"note":"vaga do plano Starter+"}',
 '{"duration_min":10,"duration_ideal":90,"duration_max":180}', '{}', array['audio'],
 'heygen/voice-clone-instant', true, true, 'default', array['own_voice'], 'Minha voz (ElevenLabs)',
 'Grave ou envie de 10 s a 3 min falando; o ideal é 1min30. Usa uma vaga de voz do plano.'),
('voice_create','heygen/voice-clone-instant','official','heygen',
 '{"unit":"per_run","usd":0,"verified":true,"note":"grátis no preview"}',
 '{"duration_max":180,"max_bytes":104857600,"daily":20}', '{}', array['audio'],
 null, false, true, 'alt', array['own_voice'], 'Minha voz (HeyGen)',
 'Clone instantâneo grátis durante o preview. Usa só os 3 primeiros minutos.'),
('voice_create','elevenlabs/voice-design','official','elevenlabs',
 '{"unit":"per_1k_chars","usd":0,"verified":false}',
 '{"max_chars":1000,"min_chars":20,"previews":3}', '{}', array['prompt'],
 null, false, true, 'default', array['voice_design'], 'Voz por descrição (ElevenLabs)',
 'Descreva a voz (20 a 1.000 caracteres) e ouça 3 opções.'),
('voice_create','heygen/voice-design','official','heygen',
 '{"unit":"per_run","usd":0,"verified":false}',
 '{"max_chars":1000,"previews":3}', '{}', array['prompt'],
 null, false, true, 'alt', array['voice_design'], 'Voz por descrição (HeyGen)',
 'Descreva a voz e ouça até 3 opções.'),
('voice_create','elevenlabs/voice-library','official','elevenlabs',
 '{"unit":"per_run","usd":0,"verified":true,"note":"sem vaga; exige Creator"}',
 '{}', '{}', array[]::text[],
 null, false, true, 'default', array['voice_library'], 'Biblioteca de vozes',
 'Vozes prontas da comunidade ElevenLabs. Não usa vaga; exige o plano Creator.'),
('voice_create','elevenlabs/voice-clone-pro','official','elevenlabs',
 '{"unit":"per_run","usd":0,"verified":false}',
 '{"duration_min":1800}', '{}', array['audio'],
 null, false, false, 'top', array['pro_voice'], 'Clone profissional',
 'Pede 30 min ou mais de gravação limpa. Ainda não disponível.'),
('tts','heygen/voice-1-turbo-free','official','heygen',
 '{"unit":"per_1k_chars","usd":0,"verified":true,"until":"2026-11-30"}',
 '{"max_chars":5000,"rpm":30}', '{}', array['text'],
 null, false, false, 'alt', array['narration'], 'HeyGen Voice Turbo',
 'Narração com a voz clonada no HeyGen. Grátis até 30/11/2026; 30 pedidos por minuto.')
on conflict (capability, model_id) do update
  set kind = excluded.kind, provider = excluded.provider, cost = excluded.cost,
      limits = excluded.limits, required_inputs = excluded.required_inputs,
      fallback_model_id = excluded.fallback_model_id,
      tier = excluded.tier, experience = excluded.experience,
      label = excluded.label, notes = excluded.notes;
