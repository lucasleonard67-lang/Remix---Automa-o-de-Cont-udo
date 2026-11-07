-- video-edits.sql — edições do "Aprimorar com IA" (motor de edição com Claude).
-- Spec: docs/motor-de-edicao.md §7 e §11.1 (DDL da sessão do motor, edge video-edit).
--
-- COMO APLICAR: no Lovable, peça "rode este SQL no banco" colando o arquivo
-- inteiro (ou cole no SQL Editor do Supabase). É idempotente e não apaga nada.
--
-- ORDEM DE PUBLICAÇÃO: este SQL → edge video-edit → front (a faixa "Aprimorar
-- com IA" só aparece quando a tabela existe).
--
-- RLS: leitura só de admin (has_role); escrita só pelo service role (a edge).
-- O original nunca é apagado: a edição grava output_path ao lado e "Voltar ao
-- original" vira status = 'reverted'.
--
-- CUSTO: video_month_spend_usd() NÃO é alterada aqui (o corpo real não está no
-- repo, e um corpo errado zeraria o teto). O motor confere o teto somando
-- video_month_spend_usd() + video_edits.cost_usd do mês, e o provider-credits
-- soma video_edits à parte, como já faz com director_jobs.costs.
--
-- Realtime: a tabela entra na publicação (a faixa acompanha o status ao vivo).
-- Seed: mantido à mão (o script gerar-seed-instancia.py não serve aqui); este
-- arquivo entra como bloco depois de set_updated_at().

create table if not exists public.video_edits (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('job', 'path')),
  source_id uuid references public.director_jobs(id) on delete cascade,
  source_path text not null,
  status text not null default 'analyzing'
    check (status in ('analyzing', 'suggested', 'queued', 'rendering', 'checking', 'ready', 'failed', 'reverted')),
  analysis jsonb not null default '{}',
  -- { ops: Op[] } já resolvidas (os ajustes de um clique mexem aqui)
  plan jsonb,
  artifacts jsonb not null default '{}',
  output_path text,
  qa jsonb,
  cost_usd numeric(10, 4) not null default 0,
  error text,
  -- true = aplicada sozinha pela chave "Claude edita antes de entregar"
  auto boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  claimed_by text,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists video_edits_source_idx
  on public.video_edits (source_id, created_at desc);

create index if not exists video_edits_active_idx
  on public.video_edits (status) where status in ('analyzing', 'queued', 'rendering', 'checking');

do $$
begin
  if to_regprocedure('public.set_updated_at()') is not null
     and not exists (
       select 1 from pg_trigger
       where tgrelid = 'public.video_edits'::regclass
         and not tgisinternal
         and tgfoid = 'public.set_updated_at()'::regprocedure
     ) then
    create trigger video_edits_set_updated_at
      before update on public.video_edits
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.video_edits enable row level security;

drop policy if exists "video_edits_admin_read" on public.video_edits;
create policy "video_edits_admin_read"
  on public.video_edits for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- Sem policy de escrita para authenticated/anon: só service_role (ignora RLS).
revoke all on table public.video_edits from public, anon;
grant select on table public.video_edits to authenticated;
grant all on table public.video_edits to service_role;

alter table public.video_edits replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.video_edits;
exception when duplicate_object then null; end $$;

comment on table public.video_edits is
  'Edições do "Aprimorar com IA". Escrita só pela edge video-edit; o original nunca é apagado. cost_usd entra no teto do mês ao lado de video_month_spend_usd().';

-- Rede de segurança do avanço: se a edge não conseguir passar o bastão, o tick
-- de minuto retoma a edição mais antiga. Exige `verify_jwt = false` no video-edit:
-- a edge valida x-cron-secret ou JWT de admin por dentro.
create or replace function public.invoke_video_edit_tick()
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
  if not exists (select 1 from public.video_edits where status in ('analyzing', 'queued', 'rendering', 'checking'))
     and not exists (select 1 from public.app_settings where key = 'video_edit' and (value ->> 'auto')::boolean is true) then
    return 0;
  end if;
  select value ->> 'url' into base_url from public.app_settings where key = 'instance_url';
  secret := public.get_vault_secret('VIDEO_CRON_SECRET');
  if base_url is null or base_url = '' or secret is null or secret = '' then
    raise log 'invoke_video_edit_tick: instance_url ou VIDEO_CRON_SECRET ausente.';
    return 0;
  end if;
  select net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/video-edit',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 10000
  ) into request_id;
  return request_id;
end
$$;

revoke all on function public.invoke_video_edit_tick() from public, anon, authenticated;
grant execute on function public.invoke_video_edit_tick() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'content-engine-video-edit-tick') then
    perform cron.unschedule('content-engine-video-edit-tick');
  end if;
  perform cron.schedule('content-engine-video-edit-tick', '* * * * *', 'select public.invoke_video_edit_tick();');
end $$;

-- Watchdog: a edge se move sozinha; se o runtime cair no meio, a linha ficaria
-- girando na tela para sempre. 20 min > 12 min do prazo do sandbox. Comando 100%
-- SQL, por isso cron.schedule direto (AGENTS.md).
create or replace function public.mark_stale_video_edits_failed()
returns void
language sql
security definer
set search_path = public
as $$
  update public.video_edits
     set status = 'failed',
         error = 'A edição parou no meio. O vídeo original continua igual. Tente de novo.',
         claimed_by = null
   where status in ('analyzing', 'queued', 'rendering', 'checking')
     and updated_at < now() - interval '20 minutes';
$$;

revoke all on function public.mark_stale_video_edits_failed() from public, anon, authenticated;
grant execute on function public.mark_stale_video_edits_failed() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'content-engine-video-edit-watchdog') then
    perform cron.unschedule('content-engine-video-edit-watchdog');
  end if;
  perform cron.schedule('content-engine-video-edit-watchdog', '*/5 * * * *', 'select public.mark_stale_video_edits_failed();');
end $$;
