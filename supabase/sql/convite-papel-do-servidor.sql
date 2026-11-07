-- convite-papel-do-servidor.sql (05/11/2026) — aplicar nas instâncias existentes.
-- O papel do convidado vem SÓ de pending_invites (gravada pelo invite-user com
-- service_role). A versão de 04/11 (auth-primeiro-admin / migration 0024) voltava
-- a ler raw_user_meta_data.role, que o próprio cadastro preenche: um signup com
-- data.role = 'admin' virava admin. Mesmo texto do seed-instancia.sql.

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
