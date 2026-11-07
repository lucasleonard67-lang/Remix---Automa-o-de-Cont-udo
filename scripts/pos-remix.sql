-- ============================================================================
-- pos-remix.sql — o que vive FORA das tabelas e o Remix não leva
-- ============================================================================
-- Roda depois de supabase/seed-instancia.sql, no SQL editor da instância NOVA.
-- Idempotente: reagenda os mesmos 7 jobs, não duplica.
--
-- ANTES DE RODAR: troque SEU_PROJECT_REF, na linha marcada, pelo ref do
-- Supabase desta instância (Lovable → Cloud → supabase_project_id).
--
-- Agendar antes de completar o Vault é seguro: as funções invoke_* são
-- defensivas — sem `instance_url` ou sem o segredo, registram no log e retornam
-- 0 sem disparar requisição nenhuma. O motor fica dormindo até as credenciais
-- chegarem.
--
-- A ORDEM QUE IMPORTA É OUTRA: seed-instancia.sql vem ANTES de gravar qualquer
-- segredo no Vault. Enquanto ele não rodar, `get_vault_secret` está aberta para
-- `anon` e o segredo é legível por quem tiver a chave publishable.
-- ============================================================================

-- ── 1. O endereço da própria instância ───────────────────────────────────────
-- Os crons chamam as edge functions por net.http_post e precisam saber para
-- onde. Sem esta linha, TUDO que roda sozinho vira no-op silencioso.

insert into public.app_settings (key, value)
values ('instance_url', jsonb_build_object('url', 'https://SEU_PROJECT_REF.supabase.co'))  -- ← TROQUE AQUI
on conflict (key) do update set value = excluded.value;

-- ── 2. As 7 rotinas automáticas ──────────────────────────────────────────────
-- Sem cron.job, nada roda sozinho e ninguém percebe: o Radar não busca, a
-- automação não dispara, geração travada nunca é retomada. As funções chamadas
-- aqui vêm no Remix; o agendamento, não.

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('content-engine-watchdog',         '*/5 * * * *',  'select public.mark_stale_jobs_failed();'),
      ('content-engine-purge-usage',      '17 4 * * *',   'select public.purge_old_usage_events();'),
      ('content-engine-rss-fetch',        '*/30 * * * *', 'select public.invoke_fetch_rss();'),
      ('content-engine-video-reconcile',  '*/5 * * * *',  'select public.invoke_video_reconcile();'),
      ('content-engine-video-watchdog',   '*/5 * * * *',  'select public.mark_stale_video_predictions_failed();'),
      ('content-engine-video-edit-watchdog', '*/5 * * * *', 'select public.mark_stale_video_edits_failed();'),
      ('content-engine-director-advance', '* * * * *',    'select public.invoke_director_advance();'),
      ('automation-tick',                 '7 * * * *',    'select public.invoke_automation_tick();')
    ) as t(nome, agenda, comando)
  loop
    if exists (select 1 from cron.job where jobname = r.nome) then
      perform cron.unschedule(r.nome);
    end if;
    perform cron.schedule(r.nome, r.agenda, r.comando);
  end loop;
end $$;

-- ── 3. Confere ───────────────────────────────────────────────────────────────

select jobname, schedule, active, command from cron.job order by jobname;

select value ->> 'url' as instance_url,
       case when value ->> 'url' like '%SEU_PROJECT_REF%'
            then 'FALHA — o placeholder nao foi trocado'
            else 'ok' end as veredito
from public.app_settings where key = 'instance_url';
