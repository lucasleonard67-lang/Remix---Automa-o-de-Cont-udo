-- Mercado: concorrentes do Instagram e os posts públicos deles (lidos pelo
-- Apify na edge function competitor-sync), com as notas de marca/tendência no
-- mesmo critério do Radar. Idempotente. Aplicar pelo Lovable (não há migration
-- no repo).
--
-- Leitura: qualquer usuário autenticado da instância (dado da própria marca).
-- Escrita: só service_role (competitor-sync, que revalida admin via has_role).
-- Nenhuma função nova em `public` → nada de grant/revoke de função a fechar.
-- Sem Realtime: a tela lê por query e refaz depois de cada ação.
-- O resumo pronto para o Dashboard fica em app_settings.market (chave jsonb).

create table if not exists public.competitors (
  id uuid primary key default gen_random_uuid(),
  handle text not null,
  platform text not null default 'instagram',
  name text,
  avatar_url text,
  followers bigint,
  enabled boolean not null default true,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (platform, handle)
);

comment on table public.competitors is
  'Perfis concorrentes acompanhados pelo módulo Mercado (Dashboard). handle sem @, minúsculo.';
comment on column public.competitors.last_error is
  'Motivo humanizado (pt-BR) da última leitura que falhou; null quando a última deu certo.';

create table if not exists public.competitor_posts (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references public.competitors (id) on delete cascade,
  platform_post_id text not null unique,
  url text,
  caption text,
  media_type text,
  thumbnail_url text,
  posted_at timestamptz,
  likes bigint,
  comments bigint,
  views bigint,
  engagement numeric(10, 6),
  virality integer,
  relevance integer,
  topics text[] not null default '{}',
  score_reason text,
  angle text,
  scored_at timestamptz,
  fetched_at timestamptz not null default now()
);

comment on column public.competitor_posts.engagement is
  '(curtidas + comentários + views × 0,1) ÷ seguidores do concorrente no momento da leitura; null sem seguidores.';
comment on column public.competitor_posts.angle is
  'Ângulo sugerido pela IA para a marca fazer a própria versão (vira o brief de "Criar a minha versão").';
comment on column public.competitor_posts.media_type is
  'image · carousel · reel (normalizado a partir do tipo do Instagram).';

do $$ begin
  alter table public.competitor_posts
    add constraint competitor_posts_relevance_range check (relevance is null or relevance between 0 and 100);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.competitor_posts
    add constraint competitor_posts_virality_range check (virality is null or virality between 0 and 100);
exception when duplicate_object then null; end $$;

create index if not exists competitor_posts_competitor_idx
  on public.competitor_posts (competitor_id, posted_at desc);

-- Ordenação da tela: relevância × tendência, com a tendência como desempate.
create index if not exists competitor_posts_rank_idx
  on public.competitor_posts (((coalesce(relevance, 0) * coalesce(virality, 0)) / 100) desc, virality desc);

-- Fila de pontuação: posts recém-lidos ainda sem nota.
create index if not exists competitor_posts_unscored_idx
  on public.competitor_posts (fetched_at desc)
  where scored_at is null;

alter table public.competitors enable row level security;
alter table public.competitor_posts enable row level security;

drop policy if exists "competitors_read" on public.competitors;
create policy "competitors_read"
  on public.competitors for select
  to authenticated
  using (true);

drop policy if exists "competitor_posts_read" on public.competitor_posts;
create policy "competitor_posts_read"
  on public.competitor_posts for select
  to authenticated
  using (true);

-- Sem policy de escrita para authenticated/anon: só service_role (ignora RLS).
revoke all on table public.competitors from public, anon;
revoke all on table public.competitor_posts from public, anon;
grant select on table public.competitors to authenticated;
grant select on table public.competitor_posts to authenticated;
grant all on table public.competitors to service_role;
grant all on table public.competitor_posts to service_role;


-- ── Foto diária dos seguidores de cada concorrente ─────────────────────────
-- competitor-sync grava uma linha por concorrente por dia (upsert). Com
-- algumas semanas de leitura, o Dashboard mostra o crescimento deles, não só
-- o número de hoje. Leitura: authenticated; escrita: só service_role.
create table if not exists public.competitor_metrics_daily (
  competitor_id uuid not null references public.competitors (id) on delete cascade,
  day date not null,
  followers bigint,
  synced_at timestamptz not null default now(),
  primary key (competitor_id, day)
);

comment on table public.competitor_metrics_daily is
  'Seguidores de cada concorrente por dia (foto do competitor-sync). Base da evolução no Dashboard.';

alter table public.competitor_metrics_daily enable row level security;

drop policy if exists "competitor_metrics_daily_read" on public.competitor_metrics_daily;
create policy "competitor_metrics_daily_read"
  on public.competitor_metrics_daily for select
  to authenticated
  using (true);

revoke all on table public.competitor_metrics_daily from public, anon;
grant select on table public.competitor_metrics_daily to authenticated;
