-- Rotinas: métricas do Zernio (metrics-sync, 15 em 15 min) e leitura do Mercado
-- (competitor-sync no caminho de cron). Idempotente. Aplicar pelo Lovable
-- DEPOIS de supabase/sql/analytics.sql e supabase/sql/market.sql.
--
-- Mesmo desenho de invoke_fetch_rss (docs/15-runbook-remix.md): a rota de
-- servidor /api/public/jobs/<nome> (autenticada pelo LOVABLE_CRON_SECRET) chama
-- o RPC via service role; o RPC lê app_settings.instance_url + o segredo do
-- Vault e posta na edge function com o header x-cron-secret. A edge valida o
-- header contra o mesmo segredo (falha fechada: sem segredo, nega).
--
-- Agendamentos (HTTP schedule gerenciado do Lovable):
--   */15 * * * * → POST /api/public/jobs/metrics-sync  (seguidores e soma do dia
--                  a cada execução; varredura dos posts só na primeira do dia)
--   45 3 * * *  → POST /api/public/jobs/market-sync
--
-- Nenhum papel além de service_role pode executar os RPCs (REVOKE abaixo):
-- expostos, eles disparariam o pipeline pago de graça.

-- ── 1. Segredos de cron (gerados aqui; ninguém precisa abrir o SQL editor) ────

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'METRICS_CRON_SECRET') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'METRICS_CRON_SECRET');
  end if;
  if not exists (select 1 from vault.secrets where name = 'MARKET_CRON_SECRET') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'MARKET_CRON_SECRET');
  end if;
end $$;

-- ── 2. Estado das rotinas em app_settings ────────────────────────────────────
-- metrics_sync: { last_run_at, last_ok_at, last_error, cursor, last_counts }
-- market:       a edge mescla last_run_at no resumo já existente.

insert into public.app_settings (key, value)
values ('metrics_sync', '{}'::jsonb)
on conflict (key) do nothing;

-- ── 3. Dispatcher: metrics-sync ──────────────────────────────────────────────

create or replace function public.invoke_metrics_sync()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  base_url text;
  secret text;
  request_id bigint;
begin
  select value ->> 'url' into base_url
  from public.app_settings
  where key = 'instance_url';
  if base_url is null or base_url = '' then
    raise exception 'app_settings.instance_url ausente: rode fetch-rss ou metrics-sync uma vez (botão da UI) para registrar a URL da instância.';
  end if;

  select decrypted_secret into secret
  from vault.decrypted_secrets
  where name = 'METRICS_CRON_SECRET';
  if secret is null or secret = '' then
    raise exception 'METRICS_CRON_SECRET ausente no Vault: aplique supabase/sql/metrics-sync.sql de novo.';
  end if;

  select net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/metrics-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  ) into request_id;
  return request_id;
end
$$;

revoke all on function public.invoke_metrics_sync() from public, anon, authenticated;
grant execute on function public.invoke_metrics_sync() to service_role;

-- ── 4. Dispatcher: market-sync (competitor-sync no caminho de cron) ──────────

create or replace function public.invoke_market_sync()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  base_url text;
  secret text;
  request_id bigint;
begin
  select value ->> 'url' into base_url
  from public.app_settings
  where key = 'instance_url';
  if base_url is null or base_url = '' then
    raise exception 'app_settings.instance_url ausente: rode fetch-rss ou metrics-sync uma vez (botão da UI) para registrar a URL da instância.';
  end if;

  select decrypted_secret into secret
  from vault.decrypted_secrets
  where name = 'MARKET_CRON_SECRET';
  if secret is null or secret = '' then
    raise exception 'MARKET_CRON_SECRET ausente no Vault: aplique supabase/sql/metrics-sync.sql de novo.';
  end if;

  select net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/competitor-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{"action":"sync"}'::jsonb,
    timeout_milliseconds := 10000
  ) into request_id;
  return request_id;
end
$$;

revoke all on function public.invoke_market_sync() from public, anon, authenticated;
grant execute on function public.invoke_market_sync() to service_role;

-- ── 5. Confere ───────────────────────────────────────────────────────────────

select name from vault.secrets where name in ('METRICS_CRON_SECRET', 'MARKET_CRON_SECRET');
select proname, proacl from pg_proc
where proname in ('invoke_metrics_sync', 'invoke_market_sync');
