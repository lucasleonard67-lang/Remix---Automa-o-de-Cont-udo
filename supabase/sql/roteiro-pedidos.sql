-- roteiro-pedidos.sql (2026-11-04) · pedidos de escrita pelo Claude da assinatura.
--
-- A pessoa escreve do jeito dela num campo da tela Vídeos e pede "Escrever com o
-- seu Claude". O pedido fica aqui com o tipo (roteiro, ideia, briefing_cenas,
-- fala, cena, pessoa), o contexto (campo, modelo, limite, duração) e a rotina
-- do Claude dela lê pelo conector (roteiro_pedidos), escreve no formato que o
-- modelo exige e entrega (roteiro_entregar). A tela acompanha por Realtime.
--
-- Reúne as migrations 0019–0023 (a tabela nunca entrou no seed: um Remix nascia
-- sem ela) e acrescenta tipo, contexto e saida.

create table if not exists public.roteiro_pedidos (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  status text not null default 'aberto'
    check (status in ('aberto', 'entregue', 'cancelado', 'falhou')),
  briefing text not null,
  referencias jsonb not null default '[]',
  claim jsonb,
  roteiro text,
  plano jsonb,
  erro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.roteiro_pedidos add column if not exists andamento jsonb;
alter table public.roteiro_pedidos add column if not exists conversa jsonb not null default '[]';
alter table public.roteiro_pedidos add column if not exists aguardando_pessoa boolean not null default false;
-- o que o Claude escreve: roteiro (com plano), ideia, briefing_cenas, fala, cena, pessoa
alter table public.roteiro_pedidos add column if not exists tipo text not null default 'roteiro';
-- { alvo, ferramenta, modelo, max, segundos, formato, apresentador, voz }
alter table public.roteiro_pedidos add column if not exists contexto jsonb not null default '{}';
-- entrega estruturada dos tipos curtos (briefing_cenas, cena, pessoa)
alter table public.roteiro_pedidos add column if not exists saida jsonb;

create index if not exists roteiro_pedidos_abertos_idx
  on public.roteiro_pedidos (created_at) where status = 'aberto';

-- um pedido aberto por pessoa × tipo × campo: o segundo clique mostra o primeiro
create unique index if not exists roteiro_pedidos_um_por_campo
  on public.roteiro_pedidos (created_by, tipo, coalesce(contexto->>'alvo', ''))
  where status = 'aberto';

do $$
begin
  if to_regprocedure('public.set_updated_at()') is not null
     and not exists (
       select 1 from pg_trigger
       where tgrelid = 'public.roteiro_pedidos'::regclass and not tgisinternal
         and tgfoid = 'public.set_updated_at()'::regprocedure
     ) then
    create trigger roteiro_pedidos_set_updated_at
      before update on public.roteiro_pedidos
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.roteiro_pedidos enable row level security;

drop policy if exists "roteiro_pedidos_read" on public.roteiro_pedidos;
create policy "roteiro_pedidos_read"
  on public.roteiro_pedidos for select
  to authenticated
  using (created_by = auth.uid());

-- escrita só pelas edges (service role); a tela pede por roteiro-pedido
revoke insert, update, delete on public.roteiro_pedidos from anon, authenticated;

alter table public.roteiro_pedidos replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.roteiro_pedidos;
exception when duplicate_object then null; end $$;
