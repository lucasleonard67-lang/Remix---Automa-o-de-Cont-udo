# Runbook de Remix — provisionar uma instância nova

> **F5.5 do plano de implementação.** Passo a passo para transformar o template
> numa instância de cliente, a verificação que prova que deu certo, e o que
> fazer quando o Remix não replica alguma coisa.
>
> A parte que dá para delegar ao agente do Lovable está pronta para colar em
> **`16-prompt-configuracao-instancia.md`**. Este runbook é o que você precisa
> saber para julgar o que ele devolve.

## O que é uma instância

Uma implementação inteira do Content Engine para **um** cliente: projeto Lovable,
banco Supabase e deploy próprios. Não há multi-tenant — o isolamento é físico,
não por `tenant_id`. Instância nova nasce de um **Remix** do template.

Consequência prática: **nada do cliente A pode aparecer para o cliente B porque
não existe cliente B no banco.** Em compensação, cada correção de motor precisa
ser propagada instância a instância (ver `08-estrategia-template.md`).

---

## 0. Antes de começar

Reúna, do cliente:

| Item                                           | Para quê                                                 | Obrigatório?          |
| ---------------------------------------------- | -------------------------------------------------------- | --------------------- |
| Nome da marca e nicho                          | passo 1 do onboarding                                    | sim                   |
| Material de marca (transcrições, posts, cases) | acervo do RAG — sem ele o gerador escreve bonito e vazio | **sim**               |
| Site no ar                                     | extração de paleta e tipografia                          | não                   |
| API key do Zernio                              | publicar e agendar                                       | só se for publicar    |
| Token do Replicate                             | Reels (TTS, keyframes, montagem)                         | só se for fazer vídeo |
| Conta Higgsfield                               | keyframes e avatares do Diretor                          | só se for fazer vídeo |
| Key de Tavily **ou** Firecrawl                 | pesquisa web na geração                                  | não                   |

O que **não** precisa: key de LLM. O gateway da Lovable já vem ligado e cobre
roteador, gerador, juiz, extrator de voz, embeddings e imagem.

---

## 1. Remix do template

1. Abra o projeto template na Lovable e faça **Remix**.
2. Nomeie como o cliente (o nome vira o slug do projeto — escolha com cuidado,
   trocar depois é trabalhoso).
3. Confirme que o **Lovable Cloud** subiu junto: o projeto novo tem que ter
   Supabase próprio. Sem isso, pare aqui.

O Remix leva o código e as migrations. **Ele não leva dado, nem segredo, nem
cron.** Os passos 2 a 5 existem por causa disso.

---

## 2. Banco — o que o Remix leva e o que não leva

**Meça, não presuma — e meça duas vezes.** Num Remix, `channels` e
`niche_templates` apareceram com 0 linhas numa leitura e com 8 e 4 alguns
minutos depois, sem nada ter sido rodado no meio. No Remix seguinte isso **não
se repetiu**: as mesmas tabelas ficaram em 0 por doze minutos e só encheram
quando o seed rodou. Não sabemos qual dos dois é a regra. A disciplina de ler
duas vezes custa dois minutos e cobre os dois casos, então é ela que vale.

A autoridade aqui não é uma tabela em prosa, é um script rodado **duas vezes,
com alguns minutos entre uma e outra**:

```
scripts/verificar-instancia.sql   →  cole no SQL editor da instância nova
```

Semeie o que ainda faltar na **segunda** leitura:

```
supabase/seed-instancia.sql   →  dados semeados pelas migrations + o gatilho de auth
scripts/pos-remix.sql         →  instance_url + os crons de SQL (os de rota vão pelo agendador do Lovable)
```

`seed-instancia.sql` é gerado por `scripts/gerar-seed-instancia.py` a partir das
migrations. Se você acrescentar um seed numa migration nova, regenere o arquivo —
senão a próxima instância nasce sem ele.

### O que se perde e nunca volta sozinho

**1. O gatilho `on_auth_user_created`, no schema `auth`.** A função
`handle_new_user` vem junto; o gatilho, não. Sem ele quem se cadastra não vira
perfil nem ganha papel: o primeiro usuário não vira admin e **a instância nasce
sem dono**. Nada na tela denuncia isso. Ele é criado por migration e mesmo assim
se perde — não adianta esperar que a próxima migration o traga. Está no bloco 1
do `seed-instancia.sql`.

> **Sobre o mecanismo: não sabemos, e não precisamos saber.** A instância nova
> não tem `supabase_migrations.schema_migrations`, então não há registro de
> migrations aplicadas para consultar. Por outro lado os 8 canais chegaram
> **limpos** — sem o `config.zernio_account_id` que as 3 linhas do template
> carregam —, então também não foi uma cópia dos dados do template: vieram do
> seed do repositório. O que dá para afirmar é o comportamento: a população é
> **assíncrona e parcial**. Meça; não presuma. E é exatamente por isso que o
> seed mora no repositório, e não numa cópia do banco do template: o que o
> Remix carrega sozinho já vem limpo.

**2. Os PRIVILÉGIOS — e esta é a falha de segurança.** MEDIDO: a instância nova
nasce com o grant padrão do Supabase, que dá `EXECUTE` a **`anon`** em *todas*
as funções de `public`. O template tem 9 funções abertas a anon; um Remix cru
tem **25**, das quais 18 são `SECURITY DEFINER` (rodam como `postgres` e ignoram
RLS). Entre elas:

- **`get_vault_secret(text)`** — `SECURITY DEFINER`, corpo é um `select
  decrypted_secret from vault.decrypted_secrets where name = _name`, sem nenhuma
  checagem de papel. A ACL era a única barreira. Exposta no schema `public`, o
  PostgREST a publica como RPC: `POST /rest/v1/rpc/get_vault_secret
  {"_name":"REPLICATE_API_TOKEN"}` com a chave *publishable* (que vai no bundle
  do front) devolve o segredo em texto claro. **Vazamento total do Vault.**
- **`invoke_fetch_rss`, `invoke_video_reconcile`, `invoke_director_advance`,
  `invoke_automation_tick`** — cada uma lê o cron secret do Vault e faz
  `net.http_post` na edge já autenticada. O atacante não precisa saber o
  segredo: a função o injeta por ele. Anônimo em laço = pipeline pago rodando de
  graça na conta do cliente.
- **`consume_rate_limit(uuid, text)`** — a vítima vem por parâmetro, não de
  `auth.uid()`. Anônimo queima a cota de qualquer usuário.
- **`pending_invites`** — a tabela que decide quem vira admin recupera os grants
  de `anon` e `authenticated`. Hoje a RLS sem policy ainda nega, mas a defesa em
  profundidade some.

Os `REVOKE` moram em migration, e o Remix não replica migration. Estão no
`seed-instancia.sql`.

**3. O REALTIME.** O `alter table ... replica identity full` migra; o `alter
publication supabase_realtime add table`, **não**. A publicação nasce existindo e
**vazia** — o que engana, porque parece configurada. Sem ela nenhum
INSERT/UPDATE entra no WAL lógico e as 6 telas que assinam `postgres_changes`
(geração, biblioteca, vídeo, diretor, identidades, publicações) nunca atualizam
sozinhas. `use-director-jobs.ts` não tem fallback de polling: fica parada para
sempre. Também está no `seed-instancia.sql`.

**4. O que vive fora das tabelas.** `cron.job` e os segredos do Vault não têm
como vir — não são schema nem dado de tabela do `public`.

**5. `supabase/migrations/` não vem no repositório da instância.** Confirmado:
o arquivo que existe no template devolve 404 no projeto novo. Ou seja, dentro de
uma instância recém-nascida *não dá* para "reaplicar a migration X" — ela não
está lá. É por isso que o seed precisa ser um arquivo próprio, versionado no
template, e não uma instrução para reexecutar migrations.

### O que veio, medido num Remix real

| O quê                       | Chegou? | Conferência                        |
| --------------------------- | ------- | ---------------------------------- |
| 31 tabelas, 10 enums, 4 ext | sim     | `verificar-instancia.sql` ordem 1  |
| 49 policies, 23 triggers    | sim     | ordem 0.5 e 0.8                    |
| 25 funções em `public`      | sim     | ordem 0.7                          |
| 3 buckets privados          | sim     | ordem 4                            |
| 24 edge functions           | sim     | §5                                 |
| `channels` (8)              | tarde   | ordem 2                            |
| `niche_templates` (4)       | tarde   | ordem 3                            |
| `app_settings`              | **não** | ordem 2.3 e 2.4                    |
| `video_models` (20)         | **não** | ordem 2.5 e 2.6                    |
| gatilho de `auth`           | **não** | ordem 0                            |
| **privilégios (REVOKE)**    | **não** | **ordem 0.91 a 0.93 — segurança**  |
| **Realtime (publicação)**   | **não** | **ordem 0.94**                     |
| `cron.job` (12)             | **não** | ordem 5 e 6                        |
| Vault (10 segredos)         | **não** | ordem 7 a 9                        |
| `supabase/migrations/`      | **não** | 404 no repo da instância           |

Use a tabela para saber **o que conferir**, não para decidir o que semear. Quem
decide é a segunda leitura do script.

### O seed pode chegar cortado — confira o rodapé antes de rodar

**Aconteceu de verdade em 2026-08-31.** Um Remix entregou
`supabase/seed-instancia.sql` com **2.447 dos 48.093 caracteres**: cabeçalho
completo, bloco 1 (o gatilho de auth) completo, e o arquivo simplesmente
acabava. A cópia no template estava íntegra, então não foi o git sync — foi o
Remix. Quinze minutos depois continuava cortado, então também não era
replicação assíncrona.

E não é tamanho nem tipo de conteúdo: no MESMO Remix, `verificar-instancia.sql`
(310 linhas), `video-pipeline.ts` (1.363 linhas), `routeTree.gen.ts`,
`carousel-art.css` e os dois docs vieram todos inteiros. Só esse arquivo cortou.
É falha pontual, e é a pior categoria: silenciosa. O arquivo abre, parece um
arquivo, e quem rodar o pedaço fica com uma instância sem dado, sem privilégio e
sem Realtime **achando que semeou**.

**Por isso o arquivo se declara.** A última linha é uma sentinela:

```
-- FIM DO SEED — 94 statements (29 de dado, 49 de privilegio, 14 de realtime, 2 de segredo)
```

Antes de executar, olhe o fim do arquivo. Não terminou nessa linha? **Não rode o
pedaço.** Pegue a cópia íntegra do projeto template — ela está lá — e rode essa.

### A ordem do seed não é decorativa

`video_models` tem índice único de *um primário por capability*. Semear só os
INSERTs, agrupados por tabela, falha com
`duplicate key value violates unique constraint "video_models_one_primary"`.
Os UPDATEs que despromovem o primário anterior fazem parte do seed e precisam
cair entre os INSERTs. E cada `GRANT` de exceção vem logo depois do `REVOKE` que
o precede — inverter os dois deixa a função aberta. É por isso que
`seed-instancia.sql` é um replay em ordem de migration (91 statements: 28 de
dado, 49 de privilégio, 14 de Realtime), e não uma lista agrupada por tabela.
**Rode o arquivo inteiro, do começo ao fim, sem reordenar.**

---

## 3. Segredos — todos são do cliente, e todos entram pelo onboarding

**Regra: a instância não usa credencial de terceiro.** Toda conta de fornecedor
é do cliente, e todas se configuram na tela — no passo *IA e integrações* do
onboarding, ou depois em `Config → Integrações`, que usa exatamente os mesmos
componentes. **Nenhum segredo precisa de SQL.**

### O que o cliente informa

| Nome no Vault                               | Onde                     | Sem ele                                   |
| ------------------------------------------- | ------------------------ | ----------------------------------------- |
| `ZERNIO_API_KEY`                            | card do Zernio           | não publica nem agenda                    |
| `REPLICATE_API_TOKEN`                       | card do Replicate        | vídeo responde `replicate_not_configured` |
| `ELEVEN_API_KEY` + `ELEVEN_VOICE_ID`        | card da ElevenLabs       | o Reel sai mudo                           |
| `HF_MCP_CLIENT_ID`                          | botão de OAuth do Higgsfield | sem keyframe e sem avatar             |
| `TAVILY_API_KEY` **ou** `FIRECRAWL_API_KEY` | card de keys BYO         | pesquisa web degrada (não quebra)         |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`       | card de keys BYO         | só se quiser sair do gateway do Lovable   |

### O que a instância resolve sozinha — não peça a ninguém

| Nome no Vault              | Quem grava                                                    |
| -------------------------- | ------------------------------------------------------------- |
| `RSS_CRON_SECRET`          | `seed-instancia.sql`, com `gen_random_bytes(32)`               |
| `VIDEO_CRON_SECRET`        | idem                                                           |
| `ZERNIO_WEBHOOK_SECRET`    | o `setup-webhook` do `zernio-proxy`, ao conectar o Zernio      |
| `REPLICATE_WEBHOOK_SECRET` | o `action: 'setup'` do `generate-video`, ao conectar o Replicate |

Os `*_CRON_SECRET` são fiação interna: a função `invoke_*` lê o valor do Vault e
manda no header `x-cron-secret`, e a edge lê o **mesmo** valor do Vault e
compara. Não existe outro lado para configurar — por isso não faz sentido pedir
a um humano, e por isso a instância os gera. Os `*_WEBHOOK_SECRET` têm outro
lado, mas quem cadastra lá é o próprio `setup` da integração.

> Historicamente esses quatro eram a maior armadilha do provisionamento: não
> tinham tela, não tinham aviso, e quando faltavam o cron rodava sem fazer nada
> e o webhook devolvia 401 em silêncio. Hoje a conferência 7 acusa, e o seed
> resolve antes de alguém precisar olhar.

**Você nunca digita valor de credencial em nome do cliente.** Se o cliente pedir
ajuda, mande o link da tela.

---

**Exceção: Google Drive.** As chaves do Google ficam só no hub. Antes de entregar a instância, inclua o endereço dela em `drive_hub_instances`, como em `docs/google-drive.md`. Sem isso, Conectar mostra que a instância não foi liberada.

## 4. Cron — precisa ser recriado à mão

O Remix não leva `cron.job`. Sem isto, **tudo o que roda sozinho para de
existir** e ninguém percebe: o Radar não busca, a automação não dispara, geração
travada nunca é retomada.

Esperado na instância (confira com `select jobname, schedule, active from cron.job`):

| Job                               | Cadência       | O que faz                      |
| --------------------------------- | -------------- | ------------------------------ |
| `content-engine-watchdog`         | `*/5 * * * *`  | retoma geração travada         |
| `content-engine-rss-fetch`        | `*/30 * * * *` | busca notícia nos feeds        |
| `automation-tick`                 | `7 * * * *`    | dispara os gatilhos            |
| `google-drive-tick`               | `*/5 * * * *`  | copia materiais para o Drive |
| `content-engine-director-advance` | `* * * * *`    | avança produções de vídeo      |
| `content-engine-director-watchdog`| `*/5 * * * *`  | falha vídeo parado há 20 min   |
| `content-engine-video-reconcile`  | `*/5 * * * *`  | confere o que o webhook perdeu |
| `content-engine-video-watchdog`   | `*/5 * * * *`  | destrava produção parada       |
| `content-engine-purge-usage`      | `17 4 * * *`   | limpa contadores vencidos      |

**Atualização (2026-11-05): o template tem 12 rotinas.** 4 de comando SQL
(`content-engine-watchdog`, `content-engine-video-watchdog`,
`content-engine-video-edit-watchdog`, `content-engine-purge-usage`) e 8 de rota
de app pelo HTTP schedule gerenciado, alvo `/api/public/jobs/<nome>`:
`rss-fetch` (`*/30`), `content-engine-video-reconcile` (`*/5`),
`content-engine-director-advance` (`* * * * *`), `automation-tick` (`7 * * * *`),
`content-engine-video-edit-tick` (`* * * * *`), `content-engine-google-drive-tick`
(`*/5`), `metrics-sync` (`*/15`) e `market-sync` (`45 3 * * *`). Num Remix novo,
confira as 12 por nome contra esta lista; o remix de 05/11 nasceu com 6.

**Atualização (2026-10-26): os 7 agora se recriam por ferramenta, sem SQL manual.**
Os 3 de comando SQL (`content-engine-watchdog`, `content-engine-video-watchdog`,
`content-engine-purge-usage`) o agente cria com `cron.schedule` direto. Os 4 que
acionam edge function (`rss-fetch`, `video-reconcile`, `director-advance`,
`automation-tick`) viraram rotas de app em `src/routes/api/public/jobs/<nome>.ts`
(autenticadas com `authenticateCronRequest`, relay em `rpc('invoke_<nome>')`)
agendadas pelo HTTP schedule gerenciado com alvo `/api/public/jobs/<nome>` —
`scripts/pos-remix.sql` parte 2 só sobra para os 3 crons SQL. Ver
`AGENTS.md` (Cron: dois tipos de rotina, dois mecanismos). As rotas vêm no sync
do frontend; num Remix novo, recriar os 7 agendamentos é operação de ferramenta,
não de SQL editor.

Cada um chama a edge por `net.http_post` com o `x-cron-secret` do Vault. Agendar
antes de completar o Vault é seguro: as funções `invoke_*` conferem
`instance_url` e o segredo antes de postar, registram no log e retornam 0 sem
disparar requisição nenhuma. O motor só fica dormindo até as credenciais
chegarem.

> **A ordem que importa é outra: o seed vem ANTES do Vault.** Enquanto
> `seed-instancia.sql` não rodar, `get_vault_secret` está aberta para `anon` e
> qualquer segredo gravado é legível por quem tiver a chave publishable. Rode o
> seed primeiro, confirme a ordem 0.91 da verificação, e só então grave o
> primeiro segredo. Se você já gravou antes — **rotacione**: o segredo esteve
> exposto.

---

## 5. Edge functions — deploy e `verify_jwt`

**Medido neste Remix: as 24 funções vieram**, todas em `version 1`, `ACTIVE`, com
o `verify_jwt` já correto. Então aqui o passo é **conferir, não deployar** — e
conferir mesmo assim, porque uma divergência de `verify_jwt` é silenciosa até
alguém tentar publicar.

(O que continua valendo é para *mudanças posteriores*: **edge function não sobe
no git sync**, o sync cobre só o frontend. Ao propagar correção de motor, peça o
deploy explicitamente e confira o número da versão.)

> **Quem fica para trás é o TEMPLATE, não a instância.** Medido em 2026-08-31: o
> Remix deploya a partir do repositório no momento em que nasce, então uma
> instância nova sai com o código atual. O template continua servindo o que foi
> deployado por último — e como ninguém olha, ele envelhece calado. Achamos 8 das
> 24 funções assim, três delas no caminho de geração (`regenerate-piece`,
> `resume-job`, `tone-gate`) rodando um `adapters/base.ts` antigo enquanto o
> `generate-content` já rodava o novo: duas versões do mesmo `_shared` em
> produção ao mesmo tempo.
>
> **Como conferir**, e é aqui que o olho engana: não basta comparar o deploy com
> o último commit da própria função. Uma função fica velha quando **qualquer
> `_shared` que ela importa** muda. O fecho de imports é o que decide.

```bash
# desatualizadas = deploy mais antigo que o ultimo commit no fecho de imports
git log -1 --format=%ct -- supabase/functions/<nome> supabase/functions/_shared
```

`verify_jwt` **tem que bater** com `supabase/config.toml`. As públicas (que
recebem webhook ou cron) são `false`; todas as outras, `true`:

```
false → zernio-webhook · fetch-rss · replicate-webhook · video-reconcile
        director-advance · higgsfield-oauth · automation-tick · mcp-server
        metrics-sync · competitor-sync
true  → todas as demais (20)
```

Uma função de escrita com `verify_jwt: false` é buraco de segurança; uma pública
com `true` simplesmente não funciona — o webhook bate e leva 401.


### 5.1 `APP_ORIGIN` — para onde o OAuth do Higgsfield pode voltar

**Quem decide o destino é a própria página onde o usuário está.** O front manda
`window.location.origin` no `start`, então preview volta para o preview e
publicado volta para o publicado, sem ninguém configurar nada. `APP_ORIGIN` não
substitui isso: ela só **acrescenta** origens que o Lovable não hospeda — na
prática, o domínio próprio do cliente. Se a instância vive só nos domínios do
Lovable, você nunca precisa tocar nela.

O fluxo, para quando algo der errado:

1. Admin clica **Conectar** no card do Higgsfield. O front manda
   `return_origin: window.location.origin`.
2. A edge passa isso por `allowedOrigin()`. Aprovado, guarda junto do PKCE;
   reprovado, guarda `null`.
3. O usuário autoriza lá no Higgsfield, que chama de volta a URL de callback —
   fixa e nossa, não configurável.
4. O callback lê a origem guardada, **valida de novo** e redireciona para
   `<origem>/config?higgsfield=<desfecho>`.
5. Sem origem aprovada, o passo 4 não redireciona: entrega uma página de texto
   puro. Do ponto de vista do usuário, "conectei e caí numa tela branca".

**O que é aceito, em ordem:**

| Origem                                                         | Passa?               |
| -------------------------------------------------------------- | -------------------- |
| `http://localhost`, `http://127.0.0.1`                           | sempre — é o dev     |
| `*.lovable.app`, `*.lovableproject.com`, `*.lovable.dev`         | sempre               |
| o que estiver em `APP_ORIGIN`, por igualdade exata de origem     | sim, e **soma** com as de cima |
| qualquer outra                                                   | não                  |

**Aceita mais de uma**, separadas por vírgula. Cada entrada é normalizada para
origin (barra sobrando não derruba nada) e entrada inválida é ignorada com log,
em vez de invalidar a lista inteira:

```
APP_ORIGIN=https://app.cliente.com,https://conteudo.cliente.com
```

Onde se seta: painel de secrets do Lovable Cloud do projeto — é env de edge
function, não vai no repositório. **Mexeu no valor, precisa redeploy** da
`higgsfield-oauth`: env de edge não recarrega sozinho.

> **Por que validar, se a origem vem do próprio usuário?** É guarda de
> open-redirect e o valor chega do navegador. Mas o risco aqui é baixo, e vale
> registrar para ninguém apertar demais: o `start` exige admin autenticado (é
> Bearer, não cookie — não há CSRF) e o redirect carrega só o desfecho, nenhum
> token. A troca do código acontece server-side e o resultado vai para o Vault.
> A lista é defesa em profundidade, não a única barreira — por isso ela pode ser
> aditiva sem culpa.

---

## 6. Onboarding — o cliente configura, não você

Com a infra de pé, o resto é o produto. Entre como admin e percorra os 9 passos.
O que **não** dá para pular:

- **Passo 3 (contexto)** — sem acervo o gerador não tem o que dizer. É o passo
  que mais define a qualidade do resto.
- **Passo 4 (voz)** — extraída de material real, não escolhida numa lista.
- **Passo 7 (brand kit)** — sem versão ativa, a arte sai no padrão e a
  Proveniência das peças mostra `Brand kit —`.
- **Passo 9 (gate de tom)** — três peças de amostra e o veredito do cliente.
  Reprovar volta para a Voz. É o que separa "configurado" de "afinado".

---

## 7. Verificação pós-Remix

Rode primeiro o script, que confere de uma vez tudo o que o Remix costuma não
replicar:

```
scripts/verificar-instancia.sql   →  cole no SQL editor da instância nova
```

Ele devolve uma linha por conferência com esperado, encontrado e veredito:
`ok` segue, `FALHA` conserta antes de entregar, `aviso` funciona sem mas com
recurso a menos. Checklist que se lê ninguém lê; este se executa.

Depois abra **Config → Instância**, que é a mesma conferência pela interface:

- **Identidade** — a marca é a certa? o projeto Supabase é o novo?
- **Saúde do motor** — travadas em 0?
- **Rotinas automáticas** — as 7 estão listadas? (a tela lista o que _deveria_
  rodar; confirme no `cron.job` que elas existem de fato)

Depois, o teste de ponta a ponta:

```bash
npm run test:e2e     # 76 casos, contra a instância nova
```

E o gate de saída, que é o que realmente prova: **gerar uma peça multi-canal,
aprovar e agendar, em menos de 30 minutos de operação**, sem tocar em SQL.

---

## 8. Quando o Remix não replica

| Sintoma                       | Causa provável                  | Conserto                                                                  |
| ----------------------------- | ------------------------------- | ------------------------------------------------------------------------- |
| Tela de Canais vazia          | seeds não vieram                | reler daqui a 5 min; se persistir, `supabase/seed-instancia.sql`          |
| Config → IA sem provedores    | `app_settings` vazia            | `supabase/seed-instancia.sql`                                             |
| Vídeo diz "sem modelo"        | `video_models` vazia            | `supabase/seed-instancia.sql` **inteiro, na ordem**                       |
| Ninguém vira admin ao entrar  | gatilho de `auth` perdido       | bloco 1 do `supabase/seed-instancia.sql`                                  |
| Nada roda sozinho             | `cron.job` vazio                | `scripts/pos-remix.sql`                                                   |
| Cron roda e não faz nada      | `instance_url` ausente          | `scripts/pos-remix.sql` (trocando o placeholder)                          |
| Tela não atualiza sozinha     | publicação do Realtime vazia    | `supabase/seed-instancia.sql` (bloco de Realtime)                        |
| **Vault legível por qualquer um** | REVOKEs perdidos no Remix   | `supabase/seed-instancia.sql` **antes de pôr qualquer segredo no Vault** |
| Webhook devolve 401           | `verify_jwt: true` numa pública | corrigir `config.toml` e redeployar                                       |
| Edge com código velho         | deploy não aconteceu            | pedir deploy e **conferir o número da versão** — não confie no "deployed" |
| `Brand kit —` na peça         | nenhuma versão ativa            | rodar o passo 7 do onboarding                                             |
| Radar não busca               | `RSS_CRON_SECRET` ausente       | gerar e gravar no Vault                                                   |
| Imagem sem tipografia na capa | modelo de imagem fraco          | já vem no seed desde a migration `202608310039`; se acusar, `Config → IA` → `google/gemini-3-pro-image-preview` |

---

## 9. Registro

Instância provisionada entra no inventário **fora do produto** (planilha ou CRM):
nome do cliente, projeto Lovable, ref do Supabase, data, versão do motor e quais
integrações foram ligadas.

Isso não é burocracia: quando sair correção de motor, é essa lista que diz onde
ela precisa ser aplicada.
