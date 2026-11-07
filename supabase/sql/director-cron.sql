-- ============================================================================
-- director-cron.sql — o motor do Diretor de vídeo (director_jobs) e o watchdog
-- ============================================================================
-- Idempotente: pode rodar quantas vezes quiser. Aplicar pelo SQL editor do
-- Lovable/Supabase, nesta ordem:
--
--   1. supabase/seed-instancia.sql  (fecha get_vault_secret ANTES de existir
--      segredo no Vault — ver scripts/pos-remix.sql)
--   2. scripts/pos-remix.sql        (grava app_settings.instance_url; neste
--      projeto: https://rpsyfmvwdmzykggcwnoc.supabase.co)
--   3. este arquivo
--
-- Sem agendamento, o front só insere em director_jobs e o pedido fica "Na fila"
-- para sempre, sem erro. Este arquivo versiona o que faltava no repo:
--
--   a. invoke_director_advance(): posta na edge director-advance com o header
--      x-cron-secret (segredo VIDEO_CRON_SECRET do Vault, o mesmo que a edge
--      confere). Sem URL ou sem segredo: registra no log e retorna 0.
--   b. mark_stale_director_jobs_failed(): watchdog. Job em etapa ativa que o
--      motor não tocou em 20 min vira `failed` com motivo legível — a tela
--      mostra "Retomar produção". A edge avança um job por tick em rodízio
--      (o tocado há mais tempo primeiro) e guarda claimed_at como "último
--      tick" ao soltar o lease: job esperando provedor é tocado a cada volta
--      do rodízio e não cai; só cai o que o motor não alcança mais.
--   c. cron.schedule de ambos (minuto a minuto e a cada 5 min).
--
-- O HTTP schedule gerenciado do Lovable (rota /api/public/jobs/director-advance)
-- chama o mesmo RPC. Os dois juntos não colidem: a edge faz claim por lease.
-- ============================================================================

-- ── 0. Segredo do cron (gera se ainda não existe; a edge lê o mesmo nome) ─────

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'VIDEO_CRON_SECRET') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'VIDEO_CRON_SECRET');
  end if;
end $$;

-- ── 1. updated_at precisa andar a cada tick ──────────────────────────────────
-- O watchdog mede "o motor tocou neste job" por claimed_at (último tick) e
-- updated_at. O claim/release de cada tick é um UPDATE; com o trigger
-- genérico set_updated_at, updated_at também anda.
-- Cria o trigger só se a tabela ainda não tem um que chame set_updated_at.

do $$
begin
  if to_regprocedure('public.set_updated_at()') is not null
     and not exists (
       select 1 from pg_trigger
       where tgrelid = 'public.director_jobs'::regclass
         and not tgisinternal
         and tgfoid = 'public.set_updated_at()'::regprocedure
     ) then
    create trigger director_jobs_set_updated_at
      before update on public.director_jobs
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- ── 2. Dispatcher: director-advance ──────────────────────────────────────────
-- Uma versão antiga pode ter outro tipo de retorno; create or replace não troca
-- o tipo, então ela sai antes (os grants são refeitos logo abaixo).

do $$
begin
  if exists (
    select 1 from pg_proc
    where oid = to_regprocedure('public.invoke_director_advance()')
      and prorettype <> 'bigint'::regtype
  ) then
    drop function public.invoke_director_advance();
  end if;
end $$;

create or replace function public.invoke_director_advance()
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
    raise log 'invoke_director_advance: app_settings.instance_url ausente (rode scripts/pos-remix.sql).';
    return 0;
  end if;

  secret := public.get_vault_secret('VIDEO_CRON_SECRET');
  if secret is null or secret = '' then
    raise log 'invoke_director_advance: VIDEO_CRON_SECRET ausente no Vault (rode supabase/sql/director-cron.sql).';
    return 0;
  end if;

  select net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/director-advance',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  ) into request_id;
  return request_id;
end
$$;

revoke all on function public.invoke_director_advance() from public, anon, authenticated;
grant execute on function public.invoke_director_advance() to service_role;

-- ── 3. Watchdog: job ativo que o motor não toca há 20 min ────────────────────
-- Etapas = RUNNABLE de supabase/functions/director-advance/index.ts. Ficam de
-- fora awaiting_* (esperam a pessoa) e publishing (falha volta para done).

create or replace function public.mark_stale_director_jobs_failed()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  runnable constant text[] := array[
    'queued', 'planning', 'plan_ready', 'tts', 'keyframes', 'videos',
    'muxing', 'concatenating', 'bed', 'assembling', 'mastering'
  ];
  affected integer;
begin
  update public.director_jobs j
  set status = 'failed',
      error = 'O motor de vídeo não avançou este pedido em 20 minutos. Clique em Retomar; se repetir, avise o administrador.',
      claimed_by = null
  where j.status = any (runnable)
    -- último tick do motor (nunca tocado = desde a criação)
    and coalesce(j.claimed_at, j.created_at) < now() - interval '20 minutes'
    and j.updated_at < now() - interval '20 minutes';
  get diagnostics affected = row_count;
  return affected;
end
$$;

revoke all on function public.mark_stale_director_jobs_failed() from public, anon, authenticated;
grant execute on function public.mark_stale_director_jobs_failed() to service_role;

-- ── 4. Agendamentos ──────────────────────────────────────────────────────────

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('content-engine-director-advance',  '* * * * *',   'select public.invoke_director_advance();'),
      ('content-engine-director-watchdog', '*/5 * * * *', 'select public.mark_stale_director_jobs_failed();')
    ) as t(nome, agenda, comando)
  loop
    if exists (select 1 from cron.job where jobname = r.nome) then
      perform cron.unschedule(r.nome);
    end if;
    perform cron.schedule(r.nome, r.agenda, r.comando);
  end loop;
end $$;

-- ── 5. Confere ───────────────────────────────────────────────────────────────

select jobname, schedule, active, command
from cron.job
where jobname like 'content-engine-director-%'
order by jobname;

select value ->> 'url' as instance_url,
       case when coalesce(value ->> 'url', '') = '' or value ->> 'url' like '%SEU_PROJECT_REF%'
            then 'FALHA — rode scripts/pos-remix.sql com o ref deste projeto'
            else 'ok' end as veredito
from public.app_settings where key = 'instance_url';

-- últimas chamadas à edge (status 200 = motor autenticou; 401 = segredo divergente)
select id, status_code, left(content::text, 200) as resposta, created
from net._http_response
order by created desc
limit 5;
