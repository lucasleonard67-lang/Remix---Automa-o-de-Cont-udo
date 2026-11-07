-- ============================================================================
-- video-edit-setting.sql — chave "Claude edita antes de entregar" (Automação)
-- ============================================================================
-- docs/motor-de-edicao.md §5. O motor (edge video-edit / fase polish do
-- director-advance) lê app_settings.video_edit.auto: true aplica as edições
-- recomendadas em todo vídeo novo, dentro do teto mensal. Desligada por padrão.
-- A tela só faz UPDATE (a RLS não deixa inserir), por isso a key é semeada aqui.
-- Idempotente: não sobrescreve quem já ligou.
-- ============================================================================

insert into public.app_settings (key, value)
values ('video_edit', '{"auto": false}'::jsonb)
on conflict (key) do nothing;
