-- google-drive.sql — materiais no Google Drive da pessoa; o banco guarda só o registro.
-- Guia: docs/google-drive.md. Edge: google-drive. Motor: _shared/drive-*.ts.
--
-- COMO APLICAR: no Lovable, peça "rode este SQL no banco" colando o arquivo inteiro
-- (ou cole no SQL Editor do Supabase). É idempotente e não apaga nada.
--
-- ORDEM DE PUBLICAÇÃO: este SQL → store-secret e google-drive → demais edges → front.
--
-- TRAVA DE GERAÇÃO: google_drive_required() é a regra única. Só bloqueia quando
-- GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET existem no Vault E o Drive não está
-- conectado. Antes de configurar o Google Cloud, o produto segue gerando.
--
-- RLS: leitura só de admin; escrita só pelo service role (a edge). `session_uri` fica
-- fora do grant de leitura: quem tem a URL da sessão pode enviar bytes sem token.
--
-- APAGAR DO STORAGE começa DESLIGADO (app_settings.google_drive_archive.purge = false).
-- A varredura copia e confere; só apaga depois do teste real de ida e volta descrito
-- em docs/google-drive.md.

create table if not exists public.drive_files (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  path text not null,
  kind text not null default 'documento',
  status text not null default 'pending'
    check (status in ('pending', 'uploaded', 'purged', 'restoring', 'kept', 'gone')),
  -- por que o arquivo fica no nosso storage (status = 'kept')
  reason text,
  size_bytes bigint not null default 0,
  mime_type text,
  md5 text,
  source_etag text,
  source_updated_at timestamptz,
  drive_file_id text,
  drive_link text,
  -- dono da cópia: permissionId e e-mail da conta Google que recebeu o arquivo
  drive_account text,
  drive_email text,
  -- upload resumável: a sessão sobrevive de um tick para o outro
  session_uri text,
  uploaded_bytes bigint not null default 0,
  hash_state jsonb,
  -- volta ao storage (TUS)
  tus_url text,
  archived_at timestamptz,
  purged_at timestamptz,
  restored_at timestamptz,
  last_used_at timestamptz,
  attempts integer not null default 0,
  next_try_at timestamptz not null default now(),
  last_error text,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket, path)
);

create index if not exists drive_files_work_idx
  on public.drive_files (status, next_try_at, size_bytes desc);

do $$
begin
  if to_regprocedure('public.set_updated_at()') is not null
     and not exists (
       select 1 from pg_trigger
       where tgrelid = 'public.drive_files'::regclass
         and not tgisinternal
         and tgfoid = 'public.set_updated_at()'::regprocedure
     ) then
    create trigger drive_files_set_updated_at
      before update on public.drive_files
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.drive_files enable row level security;

drop policy if exists "drive_files_admin_read" on public.drive_files;
create policy "drive_files_admin_read"
  on public.drive_files for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

revoke all on table public.drive_files from public, anon, authenticated;
grant select (
  id, bucket, path, kind, status, reason, size_bytes, mime_type, md5, drive_file_id, drive_link,
  drive_email, archived_at, purged_at, restored_at, last_used_at, attempts, last_error,
  created_at, updated_at
) on public.drive_files to authenticated;
grant all on table public.drive_files to service_role;

comment on table public.drive_files is
  'Registro dos arquivos copiados para o Google Drive. O arquivo mora no Drive; o storage guarda só o que ainda está em uso.';

insert into public.app_settings (key, value)
values ('google_drive_archive', '{"purge": false}'::jsonb)
on conflict (key) do nothing;

-- director_state agora guarda access token e verifier do PKCE. O front não lê esta
-- tabela: fica só para o service role, e docs/google-drive.md tem a consulta que confere.
alter table public.director_state enable row level security;
revoke all on table public.director_state from public, anon, authenticated;
grant all on table public.director_state to service_role;

-- ── Trava de geração ─────────────────────────────────────────────────────────

create or replace function public.google_drive_required()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  conexao jsonb;
begin
  if coalesce(public.get_vault_secret('GOOGLE_CLIENT_ID'), '') = ''
     or coalesce(public.get_vault_secret('GOOGLE_CLIENT_SECRET'), '') = '' then
    return false;
  end if;
  select value into conexao from public.director_state where key = 'google_drive';
  return conexao is null
    or coalesce((conexao ->> 'connected')::boolean, false) is not true
    or coalesce((conexao ->> 'broken')::boolean, false) is true;
end
$$;

revoke all on function public.google_drive_required() from public, anon, authenticated;
grant execute on function public.google_drive_required() to service_role;

-- O front insere vídeo novo direto em director_jobs (RLS): a trava precisa morar aqui.
-- Só INSERT: job em andamento segue, e Retomar é UPDATE.
create or replace function public.director_jobs_require_drive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.google_drive_required() then
    raise exception 'drive_required' using hint = 'Conecte o Google Drive para gerar.';
  end if;
  return new;
end
$$;

revoke all on function public.director_jobs_require_drive() from public, anon, authenticated;

drop trigger if exists director_jobs_require_drive on public.director_jobs;
create trigger director_jobs_require_drive
  before insert on public.director_jobs
  for each row execute function public.director_jobs_require_drive();

-- ── Refresh token no Vault ───────────────────────────────────────────────────
-- store_vault_secret exige JWT de admin. Quem conclui o OAuth é a edge, com service
-- role, na volta do Google, sem sessão: estas duas existem só para esse nome fixo.

create or replace function public.google_drive_store_refresh(_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  segredo uuid;
begin
  select id into segredo from vault.secrets where name = 'GOOGLE_DRIVE_REFRESH_TOKEN';
  if segredo is null then
    perform vault.create_secret(_value, 'GOOGLE_DRIVE_REFRESH_TOKEN');
  else
    perform vault.update_secret(segredo, _value);
  end if;
end
$$;

revoke all on function public.google_drive_store_refresh(text) from public, anon, authenticated;
grant execute on function public.google_drive_store_refresh(text) to service_role;

-- ── Leitura do storage ───────────────────────────────────────────────────────
-- O schema storage não sai pelo PostgREST. Candidatos vêm do maior para o menor, e
-- também volta o que mudou no storage depois de copiado (mesmo caminho, novo render).

create or replace function public.google_drive_candidates(
  _buckets text[], _min_size bigint, _min_age interval, _limit integer
)
returns table (
  bucket text, path text, size_bytes bigint, mime_type text, etag text,
  source_updated_at timestamptz, known boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id,
         o.name,
         (o.metadata ->> 'size')::bigint,
         o.metadata ->> 'mimetype',
         o.metadata ->> 'eTag',
         coalesce(o.updated_at, o.created_at),
         f.id is not null
  from storage.objects o
  left join public.drive_files f on f.bucket = o.bucket_id and f.path = o.name
  where o.bucket_id = any (_buckets)
    and (o.metadata ->> 'size')::bigint >= _min_size
    and coalesce(o.updated_at, o.created_at) < now() - _min_age
    and (
      f.id is null
      or (
        f.status in ('uploaded', 'purged', 'kept', 'gone')
        and f.source_updated_at is distinct from coalesce(o.updated_at, o.created_at)
      )
    )
  order by (o.metadata ->> 'size')::bigint desc
  limit _limit
$$;

revoke all on function public.google_drive_candidates(text[], bigint, interval, integer) from public, anon, authenticated;
grant execute on function public.google_drive_candidates(text[], bigint, interval, integer) to service_role;

-- Quantos objetos este papel enxerga. Zero aqui com arquivos na API do storage quer
-- dizer permissão, não bucket vazio: a varredura avisa na tela.
create or replace function public.google_drive_objects_seen(_buckets text[])
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) from storage.objects o where o.bucket_id = any (_buckets)
$$;

revoke all on function public.google_drive_objects_seen(text[]) from public, anon, authenticated;
grant execute on function public.google_drive_objects_seen(text[]) to service_role;

create or replace function public.google_drive_object(_bucket text, _path text)
returns table (size_bytes bigint, mime_type text, etag text, source_updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype', o.metadata ->> 'eTag',
         coalesce(o.updated_at, o.created_at)
  from storage.objects o
  where o.bucket_id = _bucket and o.name = _path
$$;

revoke all on function public.google_drive_object(text, text) from public, anon, authenticated;
grant execute on function public.google_drive_object(text, text) to service_role;

create or replace function public.google_drive_stats()
returns table (saved_bytes bigint, saved_files bigint, drive_files bigint, waiting_files bigint, failing_files bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(size_bytes) filter (where status = 'purged'), 0)::bigint,
         count(*) filter (where status = 'purged'),
         count(*) filter (where status in ('uploaded', 'purged', 'restoring')),
         count(*) filter (where status = 'pending'),
         count(*) filter (where status = 'pending' and attempts > 0)
  from public.drive_files
$$;

revoke all on function public.google_drive_stats() from public, anon, authenticated;
grant execute on function public.google_drive_stats() to service_role;

-- "7 dias sem uso" de um arquivo devolvido. Exceção deliberada: authenticated pode
-- chamar, porque abrir um vídeo na tela também é uso. Só carimba last_used_at, em
-- quem já tem cópia no Drive; não lê nem devolve nada.
create or replace function public.google_drive_touch(_bucket text, _path text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.drive_files
     set last_used_at = now()
   where bucket = _bucket and path = _path and status = 'uploaded'
$$;

revoke all on function public.google_drive_touch(text, text) from public, anon, authenticated;
grant execute on function public.google_drive_touch(text, text) to authenticated, service_role;

-- ── Tick ─────────────────────────────────────────────────────────────────────
-- Mesmo guard do video-edit: x-cron-secret com VIDEO_CRON_SECRET; a edge valida por
-- dentro e exige `verify_jwt = false`. Com trabalho na fila roda a cada minuto; sem
-- fila, procura arquivos novos a cada 15 minutos. Sem Drive conectado, não chama.

create or replace function public.invoke_google_drive_tick()
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
  if not exists (
    select 1 from public.director_state
    where key = 'google_drive'
      and coalesce((value ->> 'connected')::boolean, false)
      and not coalesce((value ->> 'broken')::boolean, false)
  ) then
    return 0;
  end if;
  if extract(minute from now())::integer % 15 <> 0
     and not exists (select 1 from public.drive_files where status = 'pending' and next_try_at <= now()) then
    return 0;
  end if;
  select value ->> 'url' into base_url from public.app_settings where key = 'instance_url';
  secret := public.get_vault_secret('VIDEO_CRON_SECRET');
  if base_url is null or base_url = '' or secret is null or secret = '' then
    raise log 'invoke_google_drive_tick: instance_url ou VIDEO_CRON_SECRET ausente.';
    return 0;
  end if;
  select net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/google-drive',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 10000
  ) into request_id;
  return request_id;
end
$$;

revoke all on function public.invoke_google_drive_tick() from public, anon, authenticated;
grant execute on function public.invoke_google_drive_tick() to service_role;

-- Agendamento: HTTP schedule gerenciado em /api/public/jobs/google-drive-tick (AGENTS.md, Cron).
