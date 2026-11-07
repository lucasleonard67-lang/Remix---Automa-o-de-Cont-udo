# Prompt pré-montado — configurar uma instância nova

O Remix entrega um projeto que **parece** pronto: as telas abrem, o schema está
lá, as edge functions respondem. O que falta é invisível na tela — e o que falta
é justamente o que faz o produto funcionar.

Este documento é o texto que se cola no chat do Lovable **do projeto novo**,
logo depois do Remix. Ele não substitui o runbook (`15-runbook-remix.md`): é a
parte que dá para delegar. O que envolve credencial fica de fora, de propósito,
e está na seção "O que você faz à mão" no fim.

> **Antes de colar**, tenha em mãos o `supabase_project_id` da instância nova.
> Ele sai do MCP do Lovable (`lovable_cloud_config`) ou do painel do Supabase.
> É a única coisa que você precisa trocar no texto abaixo.
>
> ⚠ **Rode isto ANTES de gravar qualquer segredo no Vault.** Um Remix cru nasce
> com `get_vault_secret` aberta para `anon` — qualquer segredo gravado antes do
> PASSO 2 é legível por quem tiver a chave publishable, que vai no bundle do
> front. Se você já gravou, rotacione.

---

## O prompt

Cole tudo o que está dentro do bloco, trocando `SEU_PROJECT_REF` pelo ref do
Supabase desta instância.

```text
Você está configurando uma instância NOVA deste produto, recém-criada por Remix.
O Remix trouxe o código e o schema, mas NÃO trouxe parte dos dados nem nada que
viva fora das tabelas. Sua tarefa é fechar essas lacunas. Trabalhe direto no
banco por SQL; não altere código de aplicação.

CONTEXTO IMPORTANTE — a replicação do Remix é ASSÍNCRONA. Tabelas que estavam
vazias agora podem estar populadas daqui a alguns minutos. Por isso: MEÇA antes
de cada passo e só escreva o que estiver faltando. Tudo que você vai rodar é
idempotente, então rodar de novo não duplica nada — mas não conclua "está
faltando" a partir de uma medição só.

PASSO 1 — Medir o estado atual.
Rode e me mostre o resultado:

  select 'app_settings' as tabela, count(*)::int as linhas from public.app_settings
  union all select 'video_models',    count(*)::int from public.video_models
  union all select 'channels',        count(*)::int from public.channels
  union all select 'niche_templates', count(*)::int from public.niche_templates
  union all select 'storage.buckets', count(*)::int from storage.buckets
  union all select 'cron.job',        count(*)::int from cron.job
  union all select 'vault.secrets',   count(*)::int from vault.secrets
  union all select 'trigger de auth', count(*)::int from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal and n.nspname = 'auth'
      and t.tgname = 'on_auth_user_created'
  order by 1;

PASSO 2 — Semear o banco.

ANTES DE EXECUTAR, CONFIRA SE O ARQUIVO CHEGOU INTEIRO. Abra
`supabase/seed-instancia.sql` e olhe a ÚLTIMA linha. Ele tem que terminar com um
rodapé assim:

  -- FIM DO SEED — 94 statements (...)

Se o arquivo NÃO termina nesse rodapé, ele chegou TRUNCADO no Remix — isso já
aconteceu de verdade, um Remix entregou 2.447 dos 48.093 caracteres e nada
avisou: o arquivo abre, tem cabeçalho, tem o gatilho de auth e simplesmente
acaba. NÃO rode o pedaço: você teria uma instância sem dado, sem privilégio e
sem Realtime achando que semeou. Me avise e peça a cópia íntegra do projeto
template.

Com o rodapé no lugar, execute o arquivo na íntegra e em uma transação só. Ele
repõe quatro coisas que o Remix perde: o gatilho de cadastro, os dados semeados
pelas migrations, os PRIVILÉGIOS (os REVOKE que fecham 16 funções para `anon` —
sem eles `get_vault_secret` é uma RPC pública que devolve o Vault em texto
claro) e a filiação das 7 tabelas na publicação do Realtime.

A ORDEM DOS STATEMENTS DENTRO DO ARQUIVO IMPORTA, por dois motivos: o catálogo
de vídeo tem índice único de "um modelo primário por capability", e os UPDATEs
que despromovem o primário anterior precisam cair entre os INSERTs; e cada GRANT
de exceção vem logo depois do REVOKE que o precede — inverter os dois deixa a
função aberta. Rode o arquivo do começo ao fim, sem reordenar, sem agrupar por
tabela e sem pular statement.

PASSO 3 — Registrar o endereço da instância e ligar as rotinas.
Execute `scripts/pos-remix.sql`, trocando o placeholder pelo ref real:

  SEU_PROJECT_REF

Esse arquivo grava `app_settings.instance_url` e agenda os 7 cron jobs. As
funções `invoke_*` são defensivas: sem `instance_url` ou sem o segredo do Vault
elas não disparam nada e só registram no log. Então pode agendar antes de o
Vault estar completo — o motor fica dormindo até as credenciais chegarem.

PASSO 4 — Conferir as edge functions.
NÃO faça deploy. Só confira e me diga quantas existem e quantas estão com
verify_jwt = false. Esperado: 30 funções, 10 delas públicas —
zernio-webhook, fetch-rss, replicate-webhook, video-reconcile, director-advance,
higgsfield-oauth, automation-tick, mcp-server, metrics-sync, competitor-sync.
Todas as outras 20 com
verify_jwt = true. Se alguma divergir de `supabase/config.toml`, me avise em vez
de corrigir sozinho.

PASSO 5 — NÃO copie nada do projeto template.
Isto é uma instância de OUTRO cliente. Estes campos precisam ficar vazios ou ser
preenchidos pelo próprio cliente no onboarding — se você copiar do template, esta
instância publica na conta de outra pessoa:
  · app_settings.zernio  → profile_id e webhook_id devem ficar null
  · app_settings.zernio_account_formats → deve ficar {}
  · channels.zernio_account_id → deve ficar null em todas as 8 linhas
  · qualquer secret do Vault
Se algum deles vier preenchido, me avise ANTES de mexer.

PASSO 6 — Relatório final.
Rode `scripts/verificar-instancia.sql` e me devolva a tabela inteira, sem
resumir. Depois me confirme, item por item:
  · app_settings: 12 chaves (11 do seed + instance_url). Vira 13 sozinho depois
    que a reconciliação de vídeo rodar pela primeira vez, que grava
    `video_reconcile_heartbeat` — o template tem 13 por isso, não por ter algo a
    mais. 12 numa instância recém-provisionada está certo.
  · video_models: 20 linhas, exatamente 1 primário para cada uma das 10 capabilities
  · channels: 8   ·   niche_templates: 4   ·   storage.buckets: 3 (todos privados)
  · cron.job: 7 jobs, todos active
  · gatilho on_auth_user_created: presente
  · instance_url apontando para SEU_PROJECT_REF
  · edge functions: 30, com 10 em verify_jwt = false
  · SEGURANÇA — get_vault_secret NÃO executável por anon, no máximo 9 funções de
    public abertas a anon, e pending_invites sem grant para anon
  · REALTIME — 7 tabelas na publicação supabase_realtime (a publicação existe
    mesmo vazia, então conte as TABELAS, não a publicação)
Onde a verificação der FALHA, diga qual e por quê — não conserte por conta
própria fora dos passos acima.
```

---

## O que fica de fora do prompt

**Segredos — e a boa notícia é que não há passo manual.** A regra é que **toda
API seja do cliente e se configure na tela**: passo *IA e integrações* do
onboarding, ou `Config → Integrações` depois. Cards do Zernio, do Replicate, da
ElevenLabs, o OAuth do Higgsfield e o card de keys BYO cobrem tudo o que um
fornecedor cobra.

O que sobra a instância resolve sozinha: os dois `*_CRON_SECRET` saem do próprio
`seed-instancia.sql` (`gen_random_bytes(32)`), e os dois `*_WEBHOOK_SECRET` são
gravados pelo `setup` de cada integração quando o cliente conecta a conta. Nada
disso passa por SQL, e **nada disso deve ser pedido a um humano**.

Nenhum valor de credencial entra no prompt, no chat ou no repositório — e você
não digita credencial em nome do cliente. Se ele precisar de ajuda, mande o link
da tela.

**Onboarding.** Marca, voz, guardrails e canais são do cliente, não seus. Não
pré-preencha "para adiantar": o onboarding é onde o design system nasce, e uma
marca chutada por você contamina toda a geração daquela instância.

---

## Por que o prompt é assim

Três coisas foram medidas neste Remix e explicam cada escolha acima.

**O que se perde de pior não é dado — é privilégio.** Comparando um Remix limpo
contra o template dimensão a dimensão, o schema bateu inteiro: 310 colunas, 102
constraints, 86 índices, 49 policies, 25 funções com md5 do corpo idêntico,
todas mantendo `SECURITY DEFINER` e `search_path`. O que divergiu foi a camada
de baixo: o Remix nasce com o grant padrão do Supabase e **as 25 funções de
`public` ficam executáveis por `anon`** (o template abre 9), 18 delas
`SECURITY DEFINER`. `get_vault_secret` é uma delas, e o corpo não tem checagem
nenhuma — a ACL era a barreira inteira. E a publicação `supabase_realtime` nasce
existindo e com **zero** tabelas, o que é pior do que não existir: parece
configurada. Nada disso aparece em tela, em log ou em typecheck. É por isso que
o PASSO 6 cobra essas duas conferências pelo nome.

**Medir duas vezes custa dois minutos.** Num Remix, `channels` e
`niche_templates` apareceram com 0 numa leitura e com 8 e 4 minutos depois, sem
nada ter rodado no meio. No Remix seguinte isso não se repetiu — ficaram em 0
por doze minutos e só encheram com o seed. Não sabemos qual é a regra; a
disciplina de ler duas vezes cobre os dois casos.

**O que se perde não aparece na tela.** O gatilho `on_auth_user_created` some do
schema `auth` embora a função `handle_new_user` venha junto — e ele é criado por
migration, então não adianta esperar que a próxima migration o traga. Sem esse
gatilho ninguém que se cadastra vira admin: a instância nasce sem dono, e a tela
de cadastro não reclama de nada.

(O mecanismo é conhecido o bastante para a decisão que importa: o repositório da
instância nova **não tem `supabase/migrations/`** — o arquivo que existe no
template devolve 404 lá. Não há migration para reaplicar dentro de uma
instância, e é por isso que o conserto precisa ser um arquivo próprio,
versionado no template. Também não é cópia do banco do template: os 8 canais
chegaram sem a conta do Zernio que as 3 linhas do template carregam.)

**A ordem do seed não é decorativa.** O catálogo de vídeo tem índice único de um
primário por capability. Semear só os INSERTs, agrupados por tabela, falha com
`duplicate key value violates unique constraint "video_models_one_primary"` —
foi exatamente o que aconteceu na primeira tentativa. Os UPDATEs que despromovem
o primário anterior fazem parte do seed e precisam cair no meio.
