-- vault-fechado.sql (2026-11-04) · o store-secret só grava com o cofre fechado.
--
-- Um Remix novo nasce com get_vault_secret(text) executável por `anon` até o
-- seed rodar (docs/15-runbook-remix.md): qualquer chave gravada antes disso é
-- pública. Esta função diz se os REVOKEs já valem; a edge store-secret recusa
-- gravar enquanto ela não existir ou responder false. Só o service_role a chama.

create or replace function public.vault_fechado()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not has_function_privilege('anon', 'public.get_vault_secret(text)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.get_vault_secret(text)', 'EXECUTE')
     and not has_function_privilege('anon', 'public.store_vault_secret(text, text)', 'EXECUTE');
$$;

-- regra 1 do AGENTS.md: função nova em public nasce aberta; fecha e dá só ao mínimo
revoke all on function public.vault_fechado() from public, anon, authenticated;
grant execute on function public.vault_fechado() to service_role;
