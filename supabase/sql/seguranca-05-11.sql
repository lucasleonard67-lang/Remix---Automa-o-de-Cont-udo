-- seguranca-05-11.sql — auditoria de segurança de 05/11/2026 (régua das conferências
-- do Diego). Idempotente. Vale para toda instância: está também no fim do
-- seed-instancia.sql, para o remix nascer certo.

-- ── 1. Peças: quem não é admin não aprova, não publica, não agenda e não mexe em
--       peça aprovada. Antes, a policy de UPDATE era `true` para qualquer logado.
--       SECURITY INVOKER: a regra roda como quem chama (auth.uid() da sessão);
--       o servidor (service_role, sem auth.uid()) e as rotinas passam.
create or replace function public.content_pieces_guarda_papel()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null or public.has_role(auth.uid(), 'admin') then
    return new;
  end if;
  if new.status is distinct from old.status and new.status in ('approved', 'published') then
    raise exception 'Só administradores aprovam ou publicam peças.' using errcode = '42501';
  end if;
  if new.scheduled_at is distinct from old.scheduled_at then
    raise exception 'Só administradores agendam peças.' using errcode = '42501';
  end if;
  if new.audit is distinct from old.audit then
    raise exception 'A auditoria da peça é feita pelo servidor.' using errcode = '42501';
  end if;
  if old.status in ('approved', 'published')
     and (new.adapted_content is distinct from old.adapted_content
          or new.core_content is distinct from old.core_content) then
    raise exception 'Peça aprovada só muda com um administrador.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists content_pieces_guarda_papel on public.content_pieces;
create trigger content_pieces_guarda_papel
  before update on public.content_pieces
  for each row execute function public.content_pieces_guarda_papel();

-- ── 2. renders: quem não é admin só envia arquivo para peça em rascunho ou reprovada
drop policy if exists renders_insert_authenticated on storage.objects;
create policy renders_insert_authenticated on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'renders'
    and exists (
      select 1 from public.content_pieces p
       where (p.id)::text = (storage.foldername(objects.name))[1]
         and (public.has_role(auth.uid(), 'admin') or p.status in ('draft', 'rejected'))
    )
  );

-- ── 3. google_drive_touch: só admin (tela) ou servidor adiam o arquivamento
create or replace function public.google_drive_touch(_bucket text, _path text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if auth.uid() is not null and not public.has_role(auth.uid(), 'admin') then
    return;
  end if;
  update public.drive_files set last_used_at = now()
   where bucket = _bucket and path = _path and status = 'uploaded';
end;
$$;

-- ── 4. has_role: visitante não testa se um id é admin (as policies rodam como authenticated)
revoke execute on function public.has_role(uuid, public.app_role) from anon, public;
grant execute on function public.has_role(uuid, public.app_role) to authenticated, service_role;

-- ── 5. Cota: ação sem teto cadastrado passa a ter o padrão (30 por hora), em vez de
--       nenhum; assistente e briefing de vídeo ganham teto próprio.
create or replace function public.consume_rate_limit(_user_id uuid, _action text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _cfg     jsonb;
  _max     integer;
  _window  integer;
  _used    integer;
  _oldest  timestamptz;
begin
  select value -> _action into _cfg
    from public.app_settings
   where key = 'rate_limits';

  _max    := coalesce((_cfg ->> 'max')::integer, 30);
  _window := coalesce((_cfg ->> 'window_minutes')::integer, 60);

  select count(*)::integer, min(created_at)
    into _used, _oldest
    from public.usage_events
   where user_id = _user_id
     and action = _action
     and created_at > now() - make_interval(mins => _window);

  if _used >= _max then
    return jsonb_build_object(
      'allowed', false,
      'remaining', 0,
      'retry_after_seconds',
      greatest(1, ceil(extract(epoch from (_oldest + make_interval(mins => _window)) - now()))::integer)
    );
  end if;

  insert into public.usage_events (user_id, action) values (_user_id, _action);
  return jsonb_build_object('allowed', true, 'remaining', _max - _used - 1);
end;
$$;
revoke all on function public.consume_rate_limit(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(uuid, text) to service_role;

insert into public.app_settings (key, value)
values ('rate_limits', '{"assistant-chat": {"max": 60, "window_minutes": 60}, "video-brief": {"max": 30, "window_minutes": 60}}'::jsonb)
on conflict (key) do update
  set value = excluded.value || public.app_settings.value;
