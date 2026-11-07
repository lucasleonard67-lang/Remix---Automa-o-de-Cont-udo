-- ============================================================================
-- VERIFICAÇÃO PÓS-REMIX — F5.5 / F5.6
--
-- Roda no SQL editor da instância NOVA e devolve uma linha por conferência,
-- com o esperado, o encontrado e o veredito. Nada aqui escreve: é diagnóstico.
--
-- Checklist que se lê, ninguém lê. Isto é o mesmo checklist, mas que se
-- executa — e que falha alto quando o Remix não replicou alguma coisa.
--
--   ok    → pode seguir
--   FALHA → conserto obrigatório antes de entregar a instância
--   aviso → funciona sem, mas com recurso a menos
-- ============================================================================

with conferencias as (

  -- ── O que o Remix NÃO leva, e mata a instância se ninguém olhar ──────────
  --
  -- RODE ESTE ARQUIVO DUAS VEZES, com alguns minutos entre uma e outra. Num
  -- Remix, `channels` e `niche_templates` estavam com 0 linhas numa leitura e
  -- com 8 e 4 minutos depois, sem nada ter sido rodado no meio; no Remix
  -- seguinte isso não se repetiu — ficaram em 0 por doze minutos e só encheram
  -- com o seed. Não se sabe qual dos dois é a regra. Ler duas vezes custa dois
  -- minutos e cobre os dois casos: semeie o que ainda faltar na SEGUNDA leitura.
  --
  -- O Remix clona o SCHEMA e para aí. Cinco perdas nunca se resolvem sozinhas:
  --
  --  1. o gatilho `on_auth_user_created` no schema AUTH. A função
  --     `handle_new_user` vem junto, mas sem o gatilho ninguém que se cadastra
  --     vira perfil nem ganha papel — o primeiro usuário não vira admin e a
  --     instância nasce sem dono. Nada na tela denuncia isso. (Ele é criado por
  --     migration e mesmo assim se perde — não espere que a próxima migration o
  --     traga: `supabase/migrations/` nem existe no repo da instância.)
  --  2. os PRIVILÉGIOS. A instância nasce com o grant padrão do Supabase, que dá
  --     EXECUTE a `anon` nas 25 funções de `public` — o template abre 9.
  --     `get_vault_secret` é SECURITY DEFINER e não checa papel: exposta, ela é
  --     uma RPC pública que devolve o Vault em texto claro. Conferências 0.91
  --     a 0.93. RODE O SEED ANTES DE GRAVAR QUALQUER SEGREDO.
  --  3. a filiação na publicação do Realtime. O `replica identity full` migra; o
  --     `add table`, não. A publicação nasce existindo e VAZIA — parece
  --     configurada e nenhuma tela atualiza sozinha. Conferência 0.94.
  --  4. o dado semeado por migration.
  --  5. o que vive fora das tabelas: cron.job e os segredos do Vault.
  --
  -- O conserto de tudo o que este arquivo acusa está em dois lugares:
  -- `supabase/seed-instancia.sql` (1 a 4) e `scripts/pos-remix.sql`
  -- (instance_url + cron). O Vault é passo humano.
  select 0 as ordem, 'Gatilho de cadastro (auth)' as conferencia,
         'on_auth_user_created em auth.users' as esperado,
         case when count(*) > 0 then 'presente'
              else 'AUSENTE — ninguem vira admin ao se cadastrar' end as encontrado,
         case when count(*) > 0 then 'ok' else 'FALHA' end as veredito
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and n.nspname = 'auth' and t.tgname = 'on_auth_user_created'

  union all
  -- `information_schema.triggers` só mostra o que o papel corrente possui: numa
  -- instância nova ele devolve ZERO e parece que tudo se perdeu. `pg_trigger`
  -- é a fonte que enxerga.
  select 0.5, 'Gatilhos de updated_at', '23 no schema public',
         count(*)::text || ' presentes',
         case when count(*) >= 23 then 'ok' else 'FALHA' end
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and n.nspname = 'public'

  union all
  -- idem: `information_schema.routines` esconde função por privilégio.
  select 0.7, 'Funções do banco', '25 em public',
         count(*)::text || ' presentes',
         case when count(*) >= 25 then 'ok' else 'FALHA' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'

  union all
  select 0.8, 'Políticas de RLS', '49 em public',
         count(*)::text || ' presentes',
         case when count(*) >= 49 then 'ok' else 'FALHA' end
  from pg_policies where schemaname = 'public'

  union all
  -- ── Estrutura: o que o Remix DEVE ter trazido ────────────────────────────
  select 1, 'Extensões do banco',
         'vector, pg_cron, pg_net, supabase_vault',
         coalesce(string_agg(extname, ', ' order by extname), '(nenhuma)'),
         case when count(*) = 4 then 'ok' else 'FALHA' end
  from pg_extension where extname in ('vector','pg_cron','pg_net','supabase_vault')

  union all
  select 2, 'Seed de canais', '8 canais',
         count(*)::text || ' canais',
         case when count(*) >= 8 then 'ok' else 'FALHA' end
  from channels

  union all
  select 3, 'Seed de nichos', '4 templates',
         count(*)::text || ' templates',
         case when count(*) >= 4 then 'ok' else 'FALHA' end
  from niche_templates

  union all
  select 4, 'Buckets privados', 'brand-assets, context-files, renders (todos privados)',
         coalesce(string_agg(id || case when public then ' (PÚBLICO!)' else '' end, ', ' order by id), '(nenhum)'),
         case when count(*) filter (where not public) = 3 then 'ok' else 'FALHA' end
  from storage.buckets where id in ('brand-assets','context-files','renders')

  -- ── Rotinas: o Remix NÃO traz cron ───────────────────────────────────────
  union all
  select 5, 'Rotinas automáticas (cron)', '7 jobs ativos',
         count(*) filter (where active)::text || ' ativos de ' || count(*)::text,
         case when count(*) filter (where active) >= 7 then 'ok' else 'FALHA' end
  from cron.job

  union all
  select 6, 'Watchdog do motor', 'presente e ativo',
         coalesce(max(case when active then 'ativo (' || schedule || ')' else 'INATIVO' end), 'AUSENTE'),
         case when count(*) filter (where active) > 0 then 'ok' else 'FALHA' end
  from cron.job where jobname like '%watchdog%' and jobname not like '%video%'

  -- ── Segredos: o Remix NÃO traz Vault ─────────────────────────────────────
  union all
  select 7, 'Segredos de cron no Vault', 'RSS_CRON_SECRET e VIDEO_CRON_SECRET',
         coalesce(string_agg(name, ', ' order by name), '(nenhum)'),
         case when count(*) = 2 then 'ok' else 'FALHA' end
  from vault.secrets where name in ('RSS_CRON_SECRET','VIDEO_CRON_SECRET')

  union all
  select 8, 'Publicação (Zernio)', 'ZERNIO_API_KEY',
         case when count(*) > 0 then 'configurada' else 'ausente' end,
         case when count(*) > 0 then 'ok' else 'aviso' end
  from vault.secrets where name = 'ZERNIO_API_KEY'

  union all
  select 9, 'Vídeo (Replicate)', 'REPLICATE_API_TOKEN',
         case when count(*) > 0 then 'configurado' else 'ausente' end,
         case when count(*) > 0 then 'ok' else 'aviso' end
  from vault.secrets where name = 'REPLICATE_API_TOKEN'

  union all
  select 10, 'Pesquisa web', 'TAVILY_API_KEY ou FIRECRAWL_API_KEY',
         case when count(*) > 0 then 'configurada' else 'ausente (a geração segue sem)' end,
         case when count(*) > 0 then 'ok' else 'aviso' end
  from vault.secrets where name in ('TAVILY_API_KEY','FIRECRAWL_API_KEY')

  -- ── Configuração do produto ──────────────────────────────────────────────
  union all
  select 11, 'Modelo de imagem', 'gemini-3-pro-image (tipografa a capa)',
         coalesce(max(value->'image'->>'model'), '(não configurado)'),
         case when max(value->'image'->>'model') like '%gemini-3-pro-image%' then 'ok'
              when max(value->'image'->>'model') is not null then 'aviso'
              else 'FALHA' end
  from app_settings where key = 'ai_providers'

  union all
  select 12, 'Brand kit ativo', '1 versão ativa',
         case when count(*) > 0 then 'v' || max(version)::text else 'NENHUMA' end,
         case when count(*) > 0 then 'ok' else 'FALHA' end
  from brand_kit where status = 'active'

  -- Os documentos versionados são quatro: brand_persona (que carrega o contrato
  -- de voz), brand_strategy (bandeira), guardrails e brand_kit. Não existe
  -- tabela `brand_voice` — a voz mora dentro da persona.
  union all
  select 13, 'Documentos da marca', 'persona, bandeira e guardrails ativos',
         (select count(*) from brand_persona where status='active')::text || ' persona, ' ||
         (select count(*) from brand_strategy where status='active')::text || ' bandeira, ' ||
         (select count(*) from guardrails where status='active')::text || ' guardrails',
         case when (select count(*) from brand_persona where status='active') > 0
               and (select count(*) from brand_strategy where status='active') > 0
               and (select count(*) from guardrails where status='active') > 0
              then 'ok' else 'FALHA' end

  union all
  select 14, 'Acervo indexado', 'ao menos 1 item pronto',
         count(*) filter (where status='ready')::text || ' pronto(s), ' ||
         count(*) filter (where status='processing')::text || ' processando',
         case when count(*) filter (where status='ready') > 0 then 'ok' else 'FALHA' end
  from context_items

  -- ── Saúde ────────────────────────────────────────────────────────────────
  union all
  select 15, 'Gerações travadas', 'nenhuma',
         count(*)::text,
         case when count(*) = 0 then 'ok' else 'FALHA' end
  from generation_jobs
  where status in ('created','classifying','retrieving','researching','generating',
                   'linting','grounding','judging','rewriting','adapting')
    and updated_at < now() - interval '15 minutes'
  -- ── Dados que o Remix costuma deixar para trás ──────────────────────────
  -- MEDIDO: `channels` e `niche_templates` chegaram; `app_settings` e
  -- `video_models` chegaram VAZIAS. Se estas duas falharem, rode
  -- supabase/seed-instancia.sql inteiro (na ordem em que ele está).
  union all
  -- 12 = as 11 do seed + `instance_url`. Vira 13 sozinha na primeira passada da
  -- reconciliação de vídeo, que grava `video_reconcile_heartbeat` — é por isso
  -- que o template mostra 13, não porque tenha configuração a mais.
  select 2.3, 'Configuração do motor (app_settings)', '12 chaves (13 com o heartbeat)',
         count(*)::text || ' chaves',
         case when count(*) >= 12 then 'ok'
              when count(*) >= 11 then 'aviso' else 'FALHA' end
  from app_settings

  union all
  select 2.4, 'Tetos de uso (rate_limits)', '10 rotas com teto',
         coalesce((select count(*)::text from app_settings, jsonb_object_keys(value)
                   where key = 'rate_limits'), '0') || ' rotas',
         case when coalesce((select count(*) from app_settings, jsonb_object_keys(value)
                             where key = 'rate_limits'), 0) >= 10 then 'ok' else 'FALHA' end

  union all
  select 2.5, 'Catálogo de vídeo', '20 modelos',
         count(*)::text || ' modelos',
         case when count(*) >= 20 then 'ok' else 'FALHA' end
  from video_models

  union all
  -- O índice único video_models_one_primary garante NO MÁXIMO um primário por
  -- capability; o que ele não garante é que exista UM. Uma capability sem
  -- primário faz o motor não achar modelo e a produção morre sem explicação.
  select 2.6, 'Um modelo primário por capability', '10 capabilities com primário',
         count(*) filter (where tem_primario)::text || ' de ' || count(*)::text,
         case when count(*) filter (where tem_primario) = count(*) and count(*) >= 10
              then 'ok' else 'FALHA' end
  from (select capability, bool_or(is_primary) as tem_primario
        from video_models group by capability) as caps

  -- ── Endereço da própria instância ────────────────────────────────────────
  -- Sem isto os crons rodam e não fazem nada: as funções invoke_* checam
  -- instance_url, registram no log e retornam 0 sem disparar requisição.
  union all
  select 4.5, 'Endereço da instância', 'instance_url apontando para este projeto',
         coalesce((select value ->> 'url' from app_settings where key = 'instance_url'),
                  '(não configurado)'),
         case
           when (select value ->> 'url' from app_settings where key = 'instance_url') is null
             then 'FALHA'
           when (select value ->> 'url' from app_settings where key = 'instance_url')
                like '%SEU_PROJECT_REF%' then 'FALHA'
           else 'ok'
         end

  -- ── Contaminação: dados de OUTRO cliente vindos do template ──────────────
  -- No template, 3 canais carregam `config.zernio_account_id` — as contas do
  -- DONO do template. Numa instância recém-provisionada isso tem que estar
  -- vazio: o cliente conecta a conta dele no onboarding. Se vier preenchido
  -- antes disso, veio junto do template e esta instância publica na conta de
  -- outra pessoa. Depois do onboarding o aviso é esperado — mas aí confira que
  -- a conta é a DESTE cliente.
  union all
  select 8.5, 'Contas do Zernio nos canais',
         'vazio antes do onboarding; a conta DESTE cliente depois',
         count(*) filter (where config ? 'zernio_account_id')::text
           || ' de ' || count(*)::text || ' canais com conta',
         case when count(*) filter (where config ? 'zernio_account_id') = 0
              then 'ok' else 'aviso' end
  from channels

  -- ── O que o clone de schema NÃO carrega e nenhuma tela denuncia ──────────
  -- MEDIDO em 2026-08-31, num Remix limpo: o schema veio inteiro (310 colunas,
  -- 102 constraints, 86 índices, 49 policies, 25 funções com md5 do corpo
  -- idêntico) — mas os PRIVILÉGIOS e a filiação na publicação do Realtime não.
  -- A instância nasce com o grant padrão do Supabase, que dá EXECUTE a `anon`
  -- em TODAS as funções de public. Como o REVOKE mora em migration e o Remix
  -- não replica migration, ele se perde.
  union all
  select 0.91, 'Vault fechado para anon',
         'get_vault_secret NÃO executável por anon',
         case when has_function_privilege('anon','public.get_vault_secret(text)','EXECUTE')
              then 'ABERTA — qualquer um lê o Vault com a chave publishable'
              else 'fechada' end,
         case when has_function_privilege('anon','public.get_vault_secret(text)','EXECUTE')
              then 'FALHA' else 'ok' end

  union all
  -- `get_vault_secret` é SECURITY DEFINER e não tem checagem no corpo: a ACL é
  -- a única barreira. Exposta, um POST /rest/v1/rpc/get_vault_secret devolve
  -- REPLICATE_API_TOKEN, ZERNIO_API_KEY, os *_CRON_SECRET — tudo em texto claro.
  -- As invoke_* são o mesmo problema em outra forma: rodam como postgres e
  -- injetam o cron secret por conta própria.
  select 0.92, 'Funções abertas a anon', 'no máximo 9 (as exceções documentadas)',
         count(*)::text || ' abertas, ' || count(*) filter (where p.prosecdef)::text || ' delas SECURITY DEFINER',
         case when count(*) <= 9 then 'ok' else 'FALHA' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')

  union all
  select 0.93, 'Convites fechados para anon', 'pending_invites sem grant para anon',
         case when has_table_privilege('anon','public.pending_invites','SELECT')
              then 'ABERTA — anon tem grant na tabela que decide quem vira admin'
              else 'fechada' end,
         case when has_table_privilege('anon','public.pending_invites','SELECT')
              then 'FALHA' else 'ok' end

  union all
  -- O `replica identity full` migra no clone; o `alter publication ... add
  -- table`, não. A publicação nasce existindo e VAZIA — o que engana: parece
  -- configurada. Sem ela nenhum INSERT/UPDATE entra no WAL lógico e as 6 telas
  -- que assinam postgres_changes nunca atualizam sozinhas.
  select 0.94, 'Realtime (publicação)', '7 tabelas em supabase_realtime',
         count(*)::text || ' tabelas',
         case when count(*) >= 7 then 'ok' else 'FALHA' end
  from pg_publication_tables where pubname = 'supabase_realtime'

)
select
  case veredito when 'FALHA' then '✗' when 'aviso' then '!' else '✓' end as " ",
  conferencia, esperado, encontrado, veredito
from conferencias order by ordem;
