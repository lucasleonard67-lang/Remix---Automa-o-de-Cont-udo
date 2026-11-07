-- OAuth do conector MCP: "Conectar" no Claude abre a tela de autorização do app.
-- Idempotente. Aplicar pelo Lovable. O token emitido entra em mcp_tokens, então
-- continua aparecendo na lista de acessos e pode ser revogado por lá.
--
-- Só service_role acessa: a edge mcp-server valida tudo. O código guarda só o hash.

create table if not exists public.mcp_oauth_clients (
  client_id uuid primary key default gen_random_uuid(),
  client_name text not null,
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);

create table if not exists public.mcp_oauth_codes (
  code_hash text primary key,
  client_id uuid not null references public.mcp_oauth_clients (client_id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  created_by uuid references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.mcp_oauth_clients enable row level security;
alter table public.mcp_oauth_codes enable row level security;

revoke all on table public.mcp_oauth_clients from public, anon, authenticated;
revoke all on table public.mcp_oauth_codes from public, anon, authenticated;
grant all on table public.mcp_oauth_clients to service_role;
grant all on table public.mcp_oauth_codes to service_role;
