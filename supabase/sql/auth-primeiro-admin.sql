-- auth-primeiro-admin.sql (2026-11-04) · fecha o cadastro aberto.
--
-- No banco da instância, has_any_admin() estava fixo em `select false` e
-- handle_new_user() dava o papel `user` a qualquer cadastro, os dois marcados
-- como TEMPORÁRIO. Resultado: a tela de login oferecia "criar o primeiro
-- admin" para qualquer visitante, e qualquer conta nova entrava, aprovava e
-- publicava. Este arquivo devolve as duas funções à regra do produto
-- (docs/04-modelo-de-dados.md §5.3 e §5.4): o primeiro usuário vira admin;
-- depois disso, só entra quem veio por convite (invite-user grava o papel em
-- raw_user_meta_data.role) e has_any_admin() diz a verdade ao /login.
--
-- Conferência depois de rodar (como anon ou autenticado):
--   select public.has_any_admin();   -- true numa instância que já tem admin
-- e um cadastro direto na tela de login tem de falhar com
-- "signup direto desabilitado".

create or replace function public.has_any_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.user_roles where role = 'admin');
$$;

-- exceção documentada: o /login precisa saber se já existe admin (só um boolean)
revoke all on function public.has_any_admin() from public;
grant execute on function public.has_any_admin() to anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _invited_role text;
begin
  -- Serializa a decisão "primeiro usuário" contra signups concorrentes
  perform pg_advisory_xact_lock(hashtext('handle_new_user_first_admin'));

  insert into public.profiles (user_id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (user_id) do nothing;

  if not exists (select 1 from public.user_roles where role = 'admin') then
    -- Primeiro usuário do banco vira admin (primeiro acesso pós-Remix)
    insert into public.user_roles (user_id, role) values (new.id, 'admin')
    on conflict (user_id, role) do nothing;
  else
    -- Já existe admin: só entra quem tem convite em pending_invites, que só o
    -- servidor grava (invite-user, service_role; anon/authenticated sem acesso).
    -- NUNCA ler o papel de raw_user_meta_data: quem se cadastra preenche esse
    -- campo e virava admin com data.role = 'admin' (202607300012; regrediu em 04/11).
    select pi.role::text into _invited_role
      from public.pending_invites pi
     where pi.email = lower(new.email);

    if _invited_role is null then
      raise exception 'signup direto desabilitado: novos usuários entram apenas por convite de um admin';
    end if;

    insert into public.user_roles (user_id, role)
    values (new.id, _invited_role::public.app_role)
    on conflict (user_id, role) do nothing;

    -- convite usado uma vez só
    delete from public.pending_invites where email = lower(new.email);
  end if;

  return new;
end;
$$;

-- a função é SECURITY DEFINER: ninguém a chama por RPC, só o gatilho
revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
