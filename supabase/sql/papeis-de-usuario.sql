-- papeis-de-usuario.sql (2026-11-04) · o admin promove e rebaixa pela tela.
--
-- Config › Usuários passa a trocar o papel de cada pessoa (admin ↔ usuário)
-- direto em user_roles, sob RLS de admin. O gatilho impede rebaixar ou apagar
-- o último admin: a instância nunca fica sem dono.

-- escrita em user_roles só por admin (as políticas podem já existir pela
-- migration de identidade; recriar é idempotente)
drop policy if exists "user_roles_insert_admin" on public.user_roles;
create policy "user_roles_insert_admin"
  on public.user_roles for insert
  to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "user_roles_update_admin" on public.user_roles;
create policy "user_roles_update_admin"
  on public.user_roles for update
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "user_roles_delete_admin" on public.user_roles;
create policy "user_roles_delete_admin"
  on public.user_roles for delete
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- o último admin não sai: nem por update, nem por delete
create or replace function public.user_roles_keep_one_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin') then
    if (select count(*) from public.user_roles where role = 'admin' and user_id <> old.user_id) = 0 then
      raise exception 'a instância precisa de ao menos um administrador';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

-- regra 1 do AGENTS.md: função nova em public nasce aberta; gatilho não precisa de EXECUTE
revoke all on function public.user_roles_keep_one_admin() from public, anon, authenticated;

drop trigger if exists user_roles_keep_one_admin on public.user_roles;
create trigger user_roles_keep_one_admin
  before update or delete on public.user_roles
  for each row execute function public.user_roles_keep_one_admin();
