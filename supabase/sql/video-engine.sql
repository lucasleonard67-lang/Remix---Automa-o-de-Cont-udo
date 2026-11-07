-- video-engine.sql — motor de vídeo escolhido pelo usuário (Higgsfield × Replicate)
-- Aplicar pelo Lovable. Idempotente. Sem tabela/coluna nova: a escolha vive em
-- director_jobs.config (engine/model_id/ab_model_id) e é congelada em
-- director_jobs.artifacts.engine pelo director-advance.
--
-- 1. A tela Vídeos → Novo lê o catálogo `video_models` (só linhas ativas de
--    capability scene_i2v) direto pelo cliente, para listar modelo, custo e
--    limites. docs/11 §2.6 define "select authenticated; escrita admin" — este
--    bloco só garante a política de leitura se a instância nasceu sem ela
--    (Remix clona o schema, não os privilégios).

alter table public.video_models enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'video_models'
       and cmd = 'SELECT'
       and 'authenticated' = any(roles)
  ) then
    create policy video_models_select_authenticated
      on public.video_models for select
      to authenticated
      using (true);
  end if;
end $$;

grant select on table public.video_models to authenticated;
revoke insert, update, delete on table public.video_models from anon, authenticated;

-- 2. (Passo 3 do brief — "Refazer um vídeo meu", vídeo → vídeo) NÃO entregue.
--    Desenho previsto, para quando houver um modelo v2v verificado:
--    - capability nova `scene_v2v` no catálogo, com `{{video_url}}` no template
--      (ex.: um modelo restyle/upscale do Replicate), required_inputs do schema real;
--    - a tela envia o MP4 (≤ 60 s) para renders/director/uploads/<uuid>.mp4 e cria
--      o job com config.mode = 'remake' + config.engine = 'replicate';
--    - no director-advance, `remake` pula planning/tts/keyframes e entra em
--      `videos` com UMA unidade cujo input é o vídeo enviado, saindo em
--      director/<job>/videos/v1.mp4 para a montagem atual.
--    Exemplo de linha (INATIVA até alguém validar version/schema em Config →
--    Integrações → "Verificar modelos"):
--
-- insert into public.video_models
--   (capability, model_id, kind, cost, limits, input_template, is_primary, active, required_inputs, notes)
-- values
--   ('scene_v2v', '<owner>/<modelo-v2v>', 'official',
--    '{"unit":"per_second","usd":0.05}'::jsonb,
--    '{"max_duration_s":60,"aspect_ratios":["9:16"]}'::jsonb,
--    '{"video":"{{video_url}}","prompt":"{{prompt}}"}'::jsonb,
--    true, false, array['video'], 'Refazer vídeo enviado pelo usuário (v2v).')
-- on conflict (capability, model_id) do nothing;

-- 3. "Melhorar um vídeo meu" (Vídeos → Novo → Melhorar) — capability scene_v2v.
--    O Diretor (config.mode = 'remake', ver _shared/remake.ts) pede o primário
--    ativo desta capability e manda estilo + cena + personagem numa chamada só.
--    Runway Aleph 2: vídeo→vídeo de até 30 s que preserva fala, gesto e câmera.
--    Os NOMES dos campos abaixo seguem o padrão dos modelos oficiais da Runway no
--    Replicate e PRECISAM ser confirmados: Config → Integrações → Replicate →
--    "Verificar modelos" compara com o schema real e aponta campo que não existe
--    (aí é um UPDATE em input_template, sem deploy). Custo: US$ 0,336/s é o
--    preço publicado da Runway; o do Replicate pode diferir — ajuste em `cost`.

insert into public.video_models
  (capability, model_id, kind, cost, limits, input_template, is_primary, active, required_inputs, notes)
values
  ('scene_v2v', 'runwayml/aleph-2', 'official',
   '{"unit":"per_second","usd":0.336}'::jsonb,
   '{"max_duration_s":30}'::jsonb,
   '{"video":"{{video_url}}","prompt":"{{prompt}}","reference_image":"{{reference_url}}"}'::jsonb,
   true, true, array['video','prompt'],
   'Melhorar um vídeo meu: estilo, cena e personagem preservando fala e movimento.')
on conflict (capability, model_id) do nothing;
