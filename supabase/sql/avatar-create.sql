-- avatar-create.sql — custo de CRIAR um avatar no HeyGen (construtor de avatar).
-- Idempotente e aditivo. Aplicar depois de hub-catalogo.sql (usa as colunas
-- provider/tier/experience/label). Também está no fim do bloco de catálogo do
-- supabase/seed-instancia.sql.
--
-- Uma linha por `type` de POST /v3/avatars (docs/catalogo-heygen.md §1). As
-- linhas servem só para custo e rótulo: o body sai do builder do motor.
-- Preço NÃO VERIFICADO (~US$ 1 por criação, fonte de terceiros; prompt e look
-- sem valor): cost.verified=false → a tela mostra "preço a confirmar".
insert into public.video_models
  (capability, model_id, kind, provider, cost, limits, input_template, required_inputs,
   fallback_model_id, is_primary, active, tier, experience, label, notes)
values
('avatar_create','heygen/avatar-photo','official','heygen',
 '{"unit":"per_run","usd":1,"verified":false}',
 '{"max_bytes":52428800}', '{}', array['file'],
 null, true, true, null, array['photo_presenter'], 'Foto vira avatar',
 '1 foto frontal, luz uniforme, cabeça inteira, 1 pessoa.'),
('avatar_create','heygen/avatar-digital-twin','official','heygen',
 '{"unit":"per_run","usd":1,"verified":false}',
 '{"duration_min":15,"duration_max":600,"max_bytes":209715200}', '{}', array['file'],
 null, false, true, null, array['digital_twin'], 'Clone (Digital Twin)',
 'Vídeo de ~2 min falando para a câmera, sem música. Pede consentimento gravado.'),
('avatar_create','heygen/avatar-prompt','official','heygen',
 '{"unit":"per_run","usd":0,"verified":false}',
 '{"max_chars":1000,"max_refs":3}', '{}', array['prompt'],
 null, false, true, null, array['avatar_script'], 'Avatar por descrição',
 'Apresentador sintético a partir de uma descrição (até 1.000 caracteres).'),
('avatar_create','heygen/avatar-look','official','heygen',
 '{"unit":"per_run","usd":0,"verified":false}',
 '{"max_chars":1000}', '{}', array['avatar_id','prompt'],
 null, false, true, null, array['avatar_script','photo_presenter','digital_twin'], 'Novo visual',
 'Mesmo apresentador com outra roupa ou cenário.')
on conflict (capability, model_id) do update
  set kind = excluded.kind, provider = excluded.provider, cost = excluded.cost,
      limits = excluded.limits, required_inputs = excluded.required_inputs,
      tier = excluded.tier, experience = excluded.experience,
      label = excluded.label, notes = excluded.notes;
