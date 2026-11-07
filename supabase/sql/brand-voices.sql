-- brand-voices.sql — vozes da marca (construtor de voz).
-- Spec: docs/construtor-de-voz.md §3.3 e docs/hub-motor-contratos.md §9.
--
-- COMO APLICAR: no Lovable, peça "rode este SQL no banco" colando o arquivo
-- inteiro (ou cole no SQL Editor do Supabase). É idempotente e não apaga nada.
--
-- ORDEM DE PUBLICAÇÃO: este SQL → edges avatar-studio e director-advance →
-- front. As edges toleram a tabela ausente (a narração segue como hoje), mas as
-- ações voice_* precisam dela.
--
-- RLS no mesmo padrão de brand_avatars (instância = workspace): leitura para
-- authenticated; escrita só pelo service role (avatar-studio, admin).
-- Nenhuma função nova (o trigger reusa public.set_updated_at, se existir).
-- Tabela nova fora do Realtime (a tela consulta voice_status).
-- Seed: mantido à mão (o script gerar-seed-instancia.py não serve aqui); este arquivo entra como bloco depois de set_updated_at().

create table if not exists public.brand_voices (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  provider text not null check (provider in ('elevenlabs', 'heygen')),
  -- null só enquanto o clone HeyGen é criado (a linha nasce antes, para a Idempotency-Key)
  provider_voice_id text,
  source text not null check (source in ('clone', 'design', 'library', 'pasted', 'twin')),
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  error text,
  gender text check (gender is null or gender in ('female', 'male')),
  language text not null default 'pt',
  sample_path text,
  preview_path text,
  -- criada por nós: só estas são apagadas no provedor
  owned boolean not null default false,
  consent_at timestamptz,
  consent_by uuid references auth.users(id) on delete set null,
  is_default boolean not null default false,
  -- tentativa da Idempotency-Key na HeyGen (voice:<id>:<attempt>)
  attempt integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  alter table public.brand_voices
    add constraint brand_voices_clone_consent
    check (source <> 'clone' or consent_at is not null);
exception when duplicate_object then null; end $$;

-- no máximo uma voz padrão
create unique index if not exists brand_voices_one_default
  on public.brand_voices (is_default) where is_default;

-- a mesma voz do provedor não entra duas vezes
create unique index if not exists brand_voices_provider_voice
  on public.brand_voices (provider, provider_voice_id) where provider_voice_id is not null;

create index if not exists brand_voices_created_idx on public.brand_voices (created_at desc);

do $$
begin
  if to_regprocedure('public.set_updated_at()') is not null
     and not exists (
       select 1 from pg_trigger
       where tgrelid = 'public.brand_voices'::regclass
         and not tgisinternal
         and tgfoid = 'public.set_updated_at()'::regprocedure
     ) then
    create trigger brand_voices_set_updated_at
      before update on public.brand_voices
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.brand_voices enable row level security;

drop policy if exists "brand_voices_read" on public.brand_voices;
create policy "brand_voices_read"
  on public.brand_voices for select
  to authenticated
  using (true);

-- Sem policy de escrita para authenticated/anon: só service_role (ignora RLS).
revoke all on table public.brand_voices from public, anon;
grant select on table public.brand_voices to authenticated;
grant all on table public.brand_voices to service_role;

comment on table public.brand_voices is
  'Vozes da marca (construtor de voz). Escrita só pelo avatar-studio; is_default = voz padrão dos vídeos.';
