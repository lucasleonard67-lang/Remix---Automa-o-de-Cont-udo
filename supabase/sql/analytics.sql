-- Métricas das redes (Zernio) — tabelas que a edge function `metrics-sync`
-- preenche de 15 em 15 min (ver supabase/sql/metrics-sync.sql).
-- Idempotente. Aplicar pelo Lovable (não há migration no repo).
--
-- Leitura: qualquer usuário autenticado da instância (dado da própria marca).
-- Escrita: só service_role (metrics-sync). Métrica ausente fica null — nunca 0.
--
-- post_metrics_daily    → foto diária de cada publicação com métricas
--                         (1 linha por post × plataforma × dia da leitura).
-- account_metrics_daily → por dia: seguidores de cada conta e, nas linhas
--                         sintéticas `_all` / `_platform:<rede>`, a soma das
--                         métricas do dia (daily-metrics do Zernio).

create table if not exists public.post_metrics_daily (
  id uuid primary key default gen_random_uuid(),
  zernio_post_id text not null,
  piece_id uuid references public.content_pieces (id) on delete set null,
  platform text not null,
  account_id text,
  media_type text,
  day date not null,
  impressions bigint,
  reach bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  saves bigint,
  clicks bigint,
  views bigint,
  engagement_rate numeric(8, 4),
  sync_status text check (sync_status in ('synced', 'pending', 'unavailable')),
  synced_at timestamptz not null default now(),
  unique (zernio_post_id, platform, day)
);

-- Colunas adicionadas depois da primeira versão (aditivas, seguras de repetir).
alter table public.post_metrics_daily add column if not exists published_at timestamptz;
alter table public.post_metrics_daily add column if not exists content text;
alter table public.post_metrics_daily add column if not exists url text;

create index if not exists post_metrics_daily_piece_day_idx
  on public.post_metrics_daily (piece_id, day desc);
create index if not exists post_metrics_daily_day_idx
  on public.post_metrics_daily (day desc);
create index if not exists post_metrics_daily_published_idx
  on public.post_metrics_daily (published_at desc);

create table if not exists public.account_metrics_daily (
  id uuid primary key default gen_random_uuid(),
  account_id text not null,
  platform text,
  day date not null,
  followers bigint,
  followers_gained bigint,
  followers_lost bigint,
  impressions bigint,
  reach bigint,
  views bigint,
  interactions bigint,
  synced_at timestamptz not null default now(),
  unique (account_id, day)
);

-- A plataforma nem sempre vem no follower-stats; as linhas `_all` não têm uma.
alter table public.account_metrics_daily alter column platform drop not null;
alter table public.account_metrics_daily add column if not exists username text;
alter table public.account_metrics_daily add column if not exists likes bigint;
alter table public.account_metrics_daily add column if not exists comments bigint;
alter table public.account_metrics_daily add column if not exists shares bigint;
alter table public.account_metrics_daily add column if not exists saves bigint;
alter table public.account_metrics_daily add column if not exists clicks bigint;

create index if not exists account_metrics_daily_day_idx
  on public.account_metrics_daily (day desc);
create index if not exists account_metrics_daily_account_day_idx
  on public.account_metrics_daily (account_id, day desc);

comment on table public.account_metrics_daily is
  'Leitura diária do Zernio. account_id real → seguidores da conta; "_all" → soma do dia em todas as redes; "_platform:<rede>" → soma do dia naquela rede.';

alter table public.post_metrics_daily enable row level security;
alter table public.account_metrics_daily enable row level security;

drop policy if exists "post_metrics_daily_read" on public.post_metrics_daily;
create policy "post_metrics_daily_read"
  on public.post_metrics_daily for select
  to authenticated
  using (true);

drop policy if exists "account_metrics_daily_read" on public.account_metrics_daily;
create policy "account_metrics_daily_read"
  on public.account_metrics_daily for select
  to authenticated
  using (true);

-- Sem policy de escrita para authenticated/anon: só service_role (ignora RLS).
revoke all on table public.post_metrics_daily from public, anon;
revoke all on table public.account_metrics_daily from public, anon;
grant select on table public.post_metrics_daily to authenticated;
grant select on table public.account_metrics_daily to authenticated;
grant all on table public.post_metrics_daily to service_role;
grant all on table public.account_metrics_daily to service_role;
