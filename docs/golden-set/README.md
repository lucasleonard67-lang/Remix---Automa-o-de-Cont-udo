# Golden Set — smoke test de regressão do motor

Três briefs canônicos rodados numa instância **depois de todo update do motor**
(`08-estrategia-template.md` §4, item 5). Cada brief exercita um caminho diferente do
pipeline; juntos eles cobrem a saga inteira de `created` a `awaiting_review`.

- **Briefs e checagens:** [`briefs.md`](./briefs.md)
- **Checklist de release:** [`checklist-pos-update.md`](./checklist-pos-update.md)

> **Histórico — 2026-07-30.** Corrigido o defeito que aplicava o limite de caracteres do canal
> sobre o `core_content` inteiro (§3.3). Por isso os briefs migraram dos canais de limite
> folgado para os de tweet-card, que antes reprovavam por construção.

> **Nota de nomenclatura.** `08` §4 item 5 descreve o trio como "1 comando de notícia, 1 de
> case, 1 de **opinião**". Aqui o terceiro brief é **tema amplo**: é o mesmo teste com o nome
> do caminho que ele exercita. Comando de opinião é justamente o que chega solto no motor —
> vira `awaiting_angle`, e a tensão editorial que "opinião" nomeia aparece nos ângulos que o
> roteador propõe (checagem c6). O caminho testado é o mesmo; o rótulo descreve o pipeline em
> vez do gênero editorial.

## O que este teste é — e o que ele não é

| É | Não é |
|---|---|
| Smoke test de **regressão do motor**: a saga percorre os estados, as 3 classes de auditoria gravam, os adapters produzem 1 peça por canal alvo | Avaliação de **qualidade editorial** da peça |
| Verificação de contrato: shapes de `classification`, `core_content`, `audit`, `adapted_content` batem com `_shared/types.ts` | Julgamento se o texto "ficou bom", se o gancho prende, se a peça é publicável |
| Objetivo, com SQL e tabela de aprovação | Subjetivo, com leitura do operador |

**Ninguém lê a peça para aprovar o golden set.** A pergunta é sempre "o motor executou o
caminho certo e gravou o que o contrato manda?", nunca "o texto está bom?". Peça feia com
auditoria íntegra = **verde**. Peça excelente com `audit.grounding` vazio = **vermelho**.

Quem avalia qualidade editorial é o cliente, na `/biblioteca`, e o gate de tom do onboarding.

---

## 1. Pré-requisitos da instância

Sem isso o teste não é válido — não é reprovação do motor, é instância mal preparada.

### 1.1 Recheio mínimo (o que a `/criar` exige)

A rota `/criar` bloqueia o botão Gerar sem os três — checagem **client-side**
(`src/routes/_app/criar.tsx`, `useActiveVersion` nas três tabelas). O backend **não**
revalida: `generate-content` valida só prompt e enum de canais (400/401/500). Recheio
faltando vira job `failed` com
`error = "Nenhuma versão ativa de <camada>. Complete o onboarding…"` (`saga.ts`,
`requireActive`) — pré-requisito não atendido, **não** regressão.

- [ ] `brand_persona` com **versão ativa**
- [ ] `brand_strategy` (bandeira) com **versão ativa**
- [ ] `guardrails` com **versão ativa**
- [ ] `app_settings.onboarding.minimum_viable = true` — indicativo de que o onboarding
      passou do mínimo viável; quem realmente libera a geração são as três versões ativas

```sql
-- Os três precisam retornar 1 linha
select 'persona' as camada, version from brand_persona where is_active
union all select 'strategy', version from brand_strategy where is_active
union all select 'guardrails', version from guardrails where is_active;
```

### 1.2 Canais

O seed de fábrica cria os 7 canais com `enabled = false`. **Pelo menos um** precisa estar
ativo, e os canais pinados nos briefs (§ `briefs.md`) precisam estar entre os ativos —
`targetChannels` intersecta o pedido com os habilitados e cai nos habilitados se a
interseção for vazia.

```sql
select type, enabled, config->>'cutoff_score' as cutoff from channels order by type;
```

Mínimo para rodar os 3 briefs como escritos: **`instagram_carousel`, `x_post`,
`instagram_post` e `linkedin_post`** habilitados, com os `cutoff_score` de fábrica
(8, 8, 8 e 9).

> **Por que esses canais.** Os três de tweet-card concentram o trabalho dos adapters (slides
> indexados, card + legenda, 280 chars, thread) e são o coração do produto; `linkedin_post`
> traz o adapter de 6 blocos e o corte mais duro. Nenhum canal é "inseguro" desde a correção
> de 2026-07-30 — o limite de chars do canal não toca mais o núcleo (§3.3). Detalhe do
> desenho em `briefs.md`, "Cobertura resultante".

**Blindagem opcional.** O roteador pode acrescentar um canal habilitado que você não marcou.
Isso não derruba mais o job — gera só uma peça a mais (desvia a3/a6) e, se o canal extra cair
em primeiro na `channel_types`, muda o corte contra o qual o juiz comparou (leia com o SQL da
§2.4). Deixar **apenas** os canais do golden set habilitados durante a rodada elimina o ruído
(`targetChannels` filtra pelos habilitados), mas só faça isso se puder restaurar os canais do
cliente logo depois — mexer na config da instância no meio de um update é invasivo; a
alternativa é repetir a rodada quando acontecer.

**Precedência da nota de corte** (`resolveCutoff`, `saga.ts:492`):
`channels.config.cutoff_score` → `guardrails.approval_threshold.per_channel[canal]` →
`.default` → default do adapter. O seed de fábrica **popula `config.cutoff_score` nos 7
canais**, então na prática o `approval_threshold` da guardrails só entra se a instância
apagar o valor do config. Se a instância mudou os cortes, use os valores dela nas checagens
de `judge.score` — o golden set não exige os defaults, exige que o motor aplique o que está
configurado.

### 1.3 Conteúdo de Contexto — pelo menos 1 case pronto

O brief (b) diffa números contra o contexto. Um case em `status = 'processing'` **não entra
no retrieval** (só `ready` participa do `match_context_chunks`) — o grounding fica sem fonte
e o sintoma parece regressão de Classe 2 quando é ingestão pendente.

```sql
select id, title, status,
       metadata->>'metric_type'  as metric_type,
       metadata->>'metric_value' as metric_value,
       metadata->>'citation_policy' as citation_policy,
       (select count(*) from context_chunks c where c.item_id = i.id) as chunks,
       (select count(*) from context_chunks c
         where c.item_id = i.id and c.embedding is not null) as chunks_com_embedding
from context_items i
where kind = 'case'
order by created_at desc;
```

Exigido: **≥ 1 linha** com `status = 'ready'`, `chunks_com_embedding > 0` e `metric_type` +
`metric_value` preenchidos (`CaseMetadata` de `_shared/types.ts`). Anote o `id` e o
`metric_value` — o brief (b) confere que o número da peça bate com **este** case.

`chunks > 0` mas `chunks_com_embedding = 0` = ingestão parou antes do embedding (ou o modelo
de embeddings mudou): a busca semântica não acha o case e o brief (b) reprova por um motivo
que não é o motor. Reprocesse o item em `/contexto` antes de rodar.

### 1.4 Providers

- [ ] `/config/ia` com provider/modelo definidos para os papéis `router`, `generator`,
      `judge` e `embeddings`
- [ ] Créditos/keys válidos (402 `credits_exhausted` derruba o job e não é regressão)

---

## 2. Procedimento

1. Confirme os pré-requisitos da §1. Anote o `id` do case escolhido.
2. Abra `/criar`. Rode os **3 briefs de `briefs.md`, um de cada vez**, aguardando cada um
   chegar num estado de parada antes de disparar o próximo — jobs em paralelo embaralham a
   ordem de `created_at` e complicam a identificação.
   - Para cada brief, marque **exatamente os chips de canal indicados** no brief. Deixar o
     roteador escolher os canais torna a rodada não comparável com a anterior.
   - **O juiz roda uma vez por job**, contra a nota de corte do **primeiro** canal de
     `classification.channel_types` (`resolveCutoff(ctx, targetChannels(ctx)[0])`,
     `saga.ts:903-915`) — e o mesmo `audit` é copiado para todas as peças do job
     (`runAdapting`). A ordem quem define é o roteador, não a ordem em que você clicou os
     chips: **leia o primeiro canal do job** antes de conferir `judge.score` (SQL na §2.4).
3. Acompanhe a timeline do job em `/criar` (Realtime). Os rótulos de estado são os de
   `JOB_STATUS_LABELS`: `classificando → buscando contexto → gerando → auditando · linter →
   auditando · grounding → auditando · juiz → adaptando → para revisar`.
4. No brief (c), o job para em **"aguardando ângulo"**: escolha o **primeiro ângulo** e deixe
   seguir (`resume-job`). Sempre o primeiro — escolher por gosto quebra a reprodutibilidade.
5. Rode os SQLs de coleta (§3) e preencha a tabela de checagens de cada brief.
6. Aplique o veredito da §4.

Não é preciso marcar os prompts com identificadores (`[GS-1]` etc.) — o roteador leria isso
como parte do comando. Identifique as três rodadas por `created_at`.

### 2.1 Coleta — visão dos 3 jobs

Rodar via `lovable_query_sql` (mesmo caminho do runbook de `08-estrategia-template.md` §3-§4):

```sql
select id,
       left(prompt, 50)                                  as brief,
       status,
       attempt,
       coalesce(error, '—')                              as erro,
       classification->>'needs_angle_choice'             as needs_angle,
       jsonb_array_length(coalesce(classification->'angles','[]'::jsonb)) as n_angulos,
       classification->'channel_types'                   as canais_alvo,
       coalesce(array_length(context_ids, 1), 0)         as n_contexto,
       created_at
from generation_jobs
order by created_at desc
limit 3;
```

### 2.2 Coleta — peças e auditoria de um job

```sql
select channel_type,
       engine_version,
       audit->'linter'->>'passed'                                  as linter_passed,
       jsonb_array_length(audit->'linter'->'violations')            as linter_total,
       (select count(*) from jsonb_array_elements(audit->'linter'->'violations') v
         where v->>'severity' = 'error')                            as linter_errors,
       audit->'grounding'->>'passed'                                as grounding_passed,
       jsonb_array_length(audit->'grounding'->'checked')            as grounding_checked,
       jsonb_array_length(audit->'grounding'->'flagged')            as grounding_flagged,
       audit->'judge'->>'verdict'                                   as judge_verdict,
       audit->'judge'->>'score'                                     as judge_score,
       audit->'judge'->>'voice_pass'                                as voice_pass,
       audit->'judge'->>'bridge_logical'                            as bridge_logical,
       persona_version, strategy_version, guardrails_version, brand_kit_version,
       status
from content_pieces
where job_id = '<JOB_ID>'
order by channel_type;
```

### 2.3 Coleta — detalhe do grounding (brief b)

```sql
-- Claims conferidas contra o contexto
select c->>'claim' as claim, c->>'source_item_id' as source_item_id, c->>'status' as status
from content_pieces p, jsonb_array_elements(p.audit->'grounding'->'checked') c
where p.job_id = '<JOB_ID_B>' limit 1;

-- Claims sem lastro → viraram [VERIFICAR]
select f->>'claim' as claim, f->>'reason' as reason, f->>'replaced_with' as replaced_with
from content_pieces p, jsonb_array_elements(p.audit->'grounding'->'flagged') f
where p.job_id = '<JOB_ID_B>' limit 1;

-- A prova central e as flags que sobraram no núcleo
select core_content->'proof'->>'claim'           as proof_claim,
       core_content->'proof'->>'context_item_id' as proof_item_id,
       core_content->'verify_flags'              as verify_flags
from content_pieces where job_id = '<JOB_ID_B>' limit 1;
```

### 2.4 Coleta — nota de corte efetiva do job

Resolve o corte contra o qual o juiz foi comparado (primeiro canal alvo + precedência da
§1.2). É este número que entra nas checagens `a10`/`b*`/`c*` de `judge.score`:

```sql
select j.classification->'channel_types'->>0                         as canal_do_juiz,
       ch.config->>'cutoff_score'                                    as corte_config,
       g.content->'approval_threshold'->'per_channel'
         ->> (j.classification->'channel_types'->>0)                 as corte_guardrails_canal,
       g.content->'approval_threshold'->>'default'                   as corte_guardrails_default,
       (select p.audit->'judge'->>'score' from content_pieces p
         where p.job_id = j.id limit 1)                              as judge_score
from generation_jobs j
left join channels ch on ch.type::text = j.classification->'channel_types'->>0
left join guardrails g on g.is_active
where j.id = '<JOB_ID>';
```

Corte efetivo = primeira coluna não-nula na ordem `corte_config` →
`corte_guardrails_canal` → `corte_guardrails_default`.

---

## 3. Triagem de `failed` — regressão vs. sinal de recheio

**Nem todo `failed` reprova o update.** Antes de reverter qualquer coisa, leia
`generation_jobs.error`.

### 3.1 Regressão do motor — REPROVA

| Sintoma | O que quebrou |
|---|---|
| `error` = "O Roteador retornou uma classificação inválida…" | Structured output do roteador / schema |
| `error` = "O Gerador retornou um core_content inválido…" ou "…não retornou os blocos do funil" | Contrato do gerador / funil |
| `error` começa com "Estado interno inconsistente:" | Bug de máquina de estados na saga |
| `error` = "Falha ao inserir content_pieces…" / "Falha ao atualizar generation_jobs…" | Migration faltando ou schema divergente |
| `error` = "Erro inesperado na geração: …" | Exceção não tratada — sempre regressão |
| `error` ou `audit` citando **`channel_limit_chars`** | O linter voltou a aplicar o limite do canal ao núcleo — o fix de 2026-07-30 foi desfeito (§3.3) |
| `audit` sem alguma das 3 chaves (`linter`/`grounding`/`judge`) | Classe de auditoria não executou |
| Peça persistida com violação de `severity = 'error'`, `grounding.passed = false` ou `judge.verdict = 'rewrite'` | **Gate vazou** — as três são impossíveis por construção (ver notas em `briefs.md`) |
| Nº de `content_pieces` ≠ nº de canais alvo | Adapter quebrado |
| `adapted_content` fora do contrato do adapter (slide/card/post acima do limite, `index` fora de sequência, slides > 10, thread > 3) | Adapter quebrado — esses limites são garantidos por construção (notas de clamp em `briefs.md`) |
| `engine_version` nulo ou desatualizado | Carimbo quebrado (ou deploy não aplicado) |
| Erro 500/502 na chamada de `generate-content` | Function não deployada ou quebrada |
| Job parado num estado de processamento, **sem** virar `failed`, por mais de `watchdog_stale_minutes` + 5 min | Saga travada **e** watchdog quebrado (o cron roda a cada 5 min) |

### 3.2 Sinal de recheio / qualidade — NÃO reprova

| Sintoma | Leitura |
|---|---|
| `error` = "Nenhuma versão ativa de …" | Pré-requisito §1.1 não atendido — ative persona/bandeira/guardrails e rode de novo |
| `error` = "Nenhum canal habilitado…" | Pré-requisito §1.2 não atendido — habilite os canais e rode de novo |
| `error` começa com **"reprovada após 2 reescritas:"** | O motor rodou o pipeline inteiro e o conteúdo não passou nas 3 classes. É sinal de recheio fraco (persona rasa, guardrails agressivos, contexto pobre), não de regressão |
| `error` = "Processamento interrompido antes de terminar. Clique em 'Tentar de novo'…" | Watchdog matou um job travado (deploy no meio da saga é a causa comum num update). **Retome uma vez** pelo botão / `resume-job`; se repetir no mesmo brief, aí é regressão |
| `error` de reescrita citando a regra **`hashtag`** nos briefs (a)/(b) | O gerador vê `Canais alvo: instagram_*` no briefing (`prompts/generator.ts`) e escreve hashtag no núcleo. No `linting` hashtag é sempre `error`: o `lint_overrides.allow_hashtags` do adapter vale só para a legenda, e `runLinting` não o passa. É recheio/prompt, não quebra de contrato — repita uma vez; se persistir em toda instância, escale para o template |
| `judge.score` abaixo da nota de corte | Qualidade editorial — fora do escopo do golden set |
| `grounding.flagged` não-vazio / `[VERIFICAR]` na legenda | **Comportamento esperado** (é literalmente o que o brief (b) testa) |
| `linter.violations` com itens de `severity = 'warn'` (ex.: `lexicon_dosage`) | Informativo: `passed` só olha `severity = 'error'`. Peça persistida **pode** ter warns |
| `attempt > 0` com job chegando a `awaiting_review` | Loop de reescrita funcionando |
| 402 `credits_exhausted` | Créditos/keys — corrija e rode de novo |

> **Divergência conhecida (motor vs. doc).** `06-arquitetura-ia.md` §4.4 especifica que
> estourar o limite de reescritas **não** falha o job (segue para `adapting → awaiting_review`
> com chips vermelhos, escalando para o humano). A implementação atual em
> `supabase/functions/_shared/saga.ts` lança `SagaError` nesse ponto e o job vai para
> `failed` com `error = "reprovada após N reescritas: …"`.
> Consequência prática: **`failed` não é veredito por si só** — leia sempre o `error` antes
> de reverter. Enquanto a divergência existir, esse `failed` específico conta como amarelo,
> não vermelho.

### 3.3 Sentinela de regressão — `channel_limit_chars` não pode existir

Até 2026-07-30 isto era um defeito conhecido do motor: `runLinting` aplicava o limite de
caracteres do primeiro canal alvo sobre o `core_content` **inteiro** (as 8 camadas do funil +
CTA, 1.500-2.500 chars). Todo job de canal curto queimava as 2 reescritas e morria com
`reprovada após 2 reescritas: … channel_limit_chars "1847/280 chars"` — por isso os briefs
rodavam só em canais de limite folgado.

**Foi corrigido.** `runLinting` remove `text_max_chars`, `slide_max_chars` e
`caption_max_chars` da config antes de chamar `lintText`: a etapa `linting` checa só voz e
guardrails (pontuação, palavras/metáforas/CTAs banidos, emoji, hashtag, antítese, dosagem do
léxico). O limite por unidade fica com o `structure()` de cada adapter, que corta e realoca
por construção — que é o que `06-arquitetura-ia.md` §4.1 sempre mandou.

**Agora é sentinela.** `channel_limit_chars` não pode aparecer em `generation_jobs.error`
**nem** no `audit` de uma peça. Três âncoras sustentam isso — confira as três antes de
concluir qualquer outra coisa:

1. `runLinting` (`_shared/saga.ts`) desestrutura as três chaves de limite para fora do
   `coreLintConfig` que vai no `config` do `lintText`;
2. a regra 8 do linter (`_shared/linter.ts`) só dispara com
   `config.text_max_chars ?? config.slide_max_chars` — sem as chaves, é pulada;
3. `runAdapting` não roda lint nenhum pós-adaptação, então não há segunda origem possível.

Reapareceu? A causa quase certa é alguém ter devolvido o `channelConfig(...)` inteiro para o
`config` do `lintText`. É **regressão** (§3.1) — reverta, não repita a rodada.

**Onde a regressão aparece primeiro**, pelo número no `N/limite` da mensagem (seed de
fábrica):

| `N/limite` na mensagem | Primeiro canal alvo era | Leitura |
|---|---|---|
| `N/280` | `x_post`, `instagram_post` ou `instagram_carousel` (slide) | Briefs (a) e (b) — falha imediata e determinística |
| `N/500` | `threads_post` | Falha quase sempre |
| `N/3000` | `linkedin_post` | Brief (c) — o núcleo passou de 3000 chars |
| `N/5000` | `facebook_post` | Raro; só com núcleo muito longo |
| — | `instagram_stories` | Não dispara: o config não tem limite de chars, a regra era pulada mesmo antes |

---

## 4. Critério de aprovação

O golden set **passa** quando as três colunas abaixo são verdadeiras para os 3 briefs:

1. **Caminho correto.** Cada brief parou onde o brief manda parar (a: direto; b: direto;
   c: `awaiting_angle` e depois segue) e chegou a `awaiting_review` — ou, no caso de
   `failed`, o `error` cai na §3.2 e nenhum sintoma da §3.1 aparece.
2. **Auditoria íntegra.** Toda peça tem `audit.linter`, `audit.grounding` e `audit.judge`
   populados, com os shapes de `_shared/types.ts` (`Audit`). **Nenhuma violação com
   `severity = 'error'`** (warns como `lexicon_dosage` são aceitáveis), `grounding.passed =
   true` e `judge.verdict = 'approve'`. Para o brief (b), `grounding.checked` traz o
   `source_item_id` do case da §1.3.
3. **Carimbo e adaptação.** 1 `content_pieces` por canal alvo, cada uma com
   `engine_version` = a versão nova e `persona_version`/`strategy_version`/
   `guardrails_version` preenchidas.

**Reprova** se qualquer linha da §3.1 aparecer em qualquer brief, ou se qualquer item das
3 colunas acima falhar.

Reprovou → não trate como bug isolado: **revert do merge** e diagnóstico no template
(procedimento em [`checklist-pos-update.md`](./checklist-pos-update.md) §4).

### 4.1 Placar

Copie e preencha:

| Brief | Job ID | Caminho ok | Auditoria íntegra | Carimbo + peças | Veredito |
|---|---|---|---|---|---|
| (a) notícia | | ☐ | ☐ | ☐ | |
| (b) case com número | | ☐ | ☐ | ☐ | |
| (c) tema amplo | | ☐ | ☐ | ☐ | |

Resultado do golden set: ☐ verde ☐ vermelho — `ENGINE_VERSION`: ________ — data: ________
