-- hub-examples.sql — cria a chave `hub_examples` em app_settings (vídeos de
-- exemplo do hub). O /config só ATUALIZA chave existente; sem esta linha o
-- curador não tem onde gravar. Idempotente: não sobrescreve o que já existe.
-- app_settings: key text (PK), value jsonb, created_at/updated_at com default.
-- Também está no fim do supabase/seed-instancia.sql.
insert into public.app_settings (key, value) values ('hub_examples', '{}'::jsonb)
on conflict (key) do nothing;
