-- Radar: scores por notícia + diagnóstico por fonte.
-- Idempotente. Aplicar pelo Lovable (não há migration no repo).
--
-- Nenhuma função nova em `public` → nada de grant/revoke a fechar. As tabelas
-- já têm RLS (select authenticated / escrita admin + service_role) e as colunas
-- novas herdam as políticas existentes. Sem Realtime (o Radar lê por query).

-- ── rss_feeds · estado da última coleta, por fonte ───────────────────────────
alter table public.rss_feeds
  add column if not exists last_ok_at      timestamptz,
  add column if not exists last_error      text,
  add column if not exists last_error_at   timestamptz,
  add column if not exists last_item_count integer;

comment on column public.rss_feeds.last_error is
  'Motivo humanizado (pt-BR) da última falha de coleta; null quando a última coleta deu certo.';

-- ── rss_items · scores calculados pelo fetch-rss logo após a coleta ──────────
alter table public.rss_items
  add column if not exists relevance    integer,
  add column if not exists virality     integer,
  add column if not exists topics       text[] not null default '{}',
  add column if not exists score_reason text,
  add column if not exists scored_at    timestamptz;

do $$ begin
  alter table public.rss_items
    add constraint rss_items_relevance_range check (relevance is null or relevance between 0 and 100);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.rss_items
    add constraint rss_items_virality_range check (virality is null or virality between 0 and 100);
exception when duplicate_object then null; end $$;

-- Ordenação padrão do Radar: relevância × viralidade (0–100), calculada no banco
-- para o PostgREST ordenar sem trazer a tabela inteira.
alter table public.rss_items
  add column if not exists priority integer
    generated always as ((coalesce(relevance, 0) * coalesce(virality, 0)) / 100) stored;

create index if not exists rss_items_priority_idx
  on public.rss_items (priority desc, published_at desc);

-- Fila de pontuação: o fetch-rss pega os itens sem nota, mais novos primeiro.
create index if not exists rss_items_unscored_idx
  on public.rss_items (published_at desc)
  where scored_at is null;

create index if not exists rss_items_topics_gin_idx
  on public.rss_items using gin (topics);
