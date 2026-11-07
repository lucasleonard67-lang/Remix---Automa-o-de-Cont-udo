# Os 3 briefs canônicos

Cada brief exercita um caminho diferente da saga. Rodar os três cobre: classificação com e
sem escolha de ângulo, retrieval, geração, as 3 classes de auditoria, o loop de reescrita e
4 dos 7 adapters — os três de tweet-card e o de blocos (o que fica de fora e por quê está em
"Cobertura resultante", no fim).

| Brief | Caminho exercitado | Canais a marcar | Nota de corte | Peças esperadas |
|---|---|---|---|---|
| (a) notícia | `needs_angle_choice = false` → saga direta; adapting multi-canal | `instagram_carousel` + `x_post` | 8 — **os dois** canais têm o mesmo corte | 2 |
| (b) case com número | Grounding (Classe 2): diff contra o case + `[VERIFICAR]` | `instagram_post` | 8 | 1 |
| (c) tema amplo | `awaiting_angle` → `resume-job` → saga até o fim | `linkedin_post` | 9 | 1 |

**Por que esses canais.** Os três adapters de tweet-card (`instagram_carousel`,
`instagram_post`, `x_post`) são os que mais transformam o núcleo: fatiam em slides indexados,
separam card de legenda, comprimem em 280 chars e montam thread. É neles que um adapter
quebrado aparece — e são o coração do produto. `linkedin_post` entra pelo motivo oposto: é o
adapter mais estruturado (6 blocos nomeados) e carrega a nota de corte mais dura (9).

**Nota de corte.** O juiz roda **uma vez por job**, contra o corte do **primeiro** canal de
`classification.channel_types` — ordem definida pelo roteador, não pelos seus cliques — e o
mesmo `audit` é copiado para todas as peças do job. Nos três briefs o corte é **o mesmo
qualquer que seja a ordem** (carrossel e X valem 8 no seed de fábrica; (b) e (c) têm canal
único). Se a instância mexeu nos `cutoff_score`, leia o corte efetivo com o SQL da §2.4 do
README antes de avaliar `judge.score`.

## Como preencher os briefs

Os comandos são **templates com slots** — o golden set roda em instâncias de nichos
diferentes, então um comando literal fixo geraria lixo fora do território da marca. Preencha
os `<SLOTS>` a partir do recheio da própria instância (bandeira, ICP, contexto) e **guarde o
texto preenchido junto com o resultado da rodada**: o mesmo texto deve ser reusado nas
próximas rodadas da mesma instância, senão você não está comparando com a rodada anterior.

Regra de ouro ao preencher: use temas **dentro da `safe_list` da bandeira** e do ICP. O
golden set testa o motor, não a capacidade do motor de escrever fora do território da marca.

---

## Brief (a) — Notícia com ângulo fechado

**Objetivo.** Provar que um comando específico passa direto pela classificação
(`needs_angle_choice = false`, 1 ângulo auto-selecionado) e percorre a saga inteira sem
parada humana, gerando 1 peça por canal alvo.

**Canais a marcar em `/criar`:** `instagram_carousel` **e** `x_post`.

### Comando

```
Escreva sobre <FATO OU NOTÍCIA RECENTE DO SETOR DO ICP> e o efeito prático disso em
<CONSEQUÊNCIA CONCRETA PARA O ICP>. O ângulo é <RECORTE ÚNICO E FECHADO, EM UMA FRASE>.
```

*Exemplo preenchido (instância de consultoria B2B):*

```
Escreva sobre a alta do custo de aquisição em canais pagos e o efeito prático disso no
orçamento de marketing de empresas B2B de médio porte. O ângulo é que cortar mídia sem
arrumar a oferta só antecipa o problema para o trimestre seguinte.
```

### O que esperar em cada etapa

| Etapa | Esperado |
|---|---|
| `classifying` | `needs_angle_choice = false`; `angles` com **1** item; `channel_types` = os 2 marcados; `thesis` não-nula |
| `awaiting_angle` | **não acontece** — o job nunca passa por aqui |
| `retrieving` | `context_ids` populado (pode ser pequeno; notícia recente legitimamente encontra pouco material próprio) |
| `generating` → `judging` | Percurso normal; `attempt` 0 no caminho feliz |
| `adapting` | **2** linhas em `content_pieces`: `instagram_carousel` e `x_post`, com o **mesmo** `audit` |
| Parada | `awaiting_review` ("para revisar" na timeline) |

### Checagens objetivas

| # | Checagem | Consulta / onde ver | Aprova se |
|---|---|---|---|
| a1 | Não parou no ângulo | `classification->>'needs_angle_choice'` | `false` |
| a2 | Ângulo auto-selecionado | `jsonb_array_length(classification->'angles')` | `1` |
| a3 | Canais alvo respeitados | `classification->'channel_types'` | contém exatamente `instagram_carousel` e `x_post` (ordem livre) |
| a4 | Estado final | `generation_jobs.status` | `awaiting_review` (ou `done`) |
| a5 | Sem erro de motor | `generation_jobs.error` | nulo — ou, se preenchido, cai no README §3.2 |
| a6 | Peça por canal alvo | `select count(*), channel_type from content_pieces where job_id = '…' group by 2` | 2 linhas, 1 por canal |
| a7 | Linter sem erro | `linter_errors` da §2.2 do README | **0** em todas as peças (warns como `lexicon_dosage` são aceitáveis — ver nota) |
| a8 | Auditoria completa | `audit ? 'linter' and audit ? 'grounding' and audit ? 'judge'` | as 3 chaves presentes em todas as peças |
| a9 | Juiz aprovou a peça persistida | `audit->'judge'->>'verdict'` | **`approve`** — ver nota abaixo |
| a10 | Gate aplicado | `audit->'judge'->>'score'` vs. corte do **primeiro** canal alvo (SQL §2.4 do README) | `score ≥ 8` (carrossel e X têm o mesmo corte, então a ordem não muda o número); `voice_pass` e `bridge_logical` = `true` |
| a11 | Carimbo | `engine_version` | igual à `ENGINE_VERSION` do merge, em todas as peças |
| a12 | Versões do recheio | `persona_version`, `strategy_version`, `guardrails_version` | todas não-nulas |
| a13 | Carrossel — teto de slides e limite por slide | SQL abaixo | `n_slides` **≤ 10** e `maior_slide` **≤ 280** (`channels.config.slides.max` / `slide_max_chars`) |
| a14 | Carrossel — slides indexados | SQL abaixo | `index` 0-based, sequencial e sem repetição: `min = 0`, `max = n_slides - 1`, `distintos = n_slides` |
| a15 | Carrossel — legenda | `length(adapted_content->>'caption')` da peça `instagram_carousel` | ≤ 2200 (`caption_max_chars`) |
| a16 | Carrossel — piso de slides | `jsonb_array_length(adapted_content->'slides')` | **≥ 7** — expectativa, não garantia; ver nota a16/a19 |
| a17 | X — texto principal | `length(adapted_content->>'text')` da peça `x_post` | ≤ 280 (`text_max_chars`) |
| a18 | X — thread | SQL abaixo | `n_thread` **≤ 3** (o `thread_max_posts` = 4 conta o texto principal) e `maior_post` ≤ 280; thread presente — ver nota a16/a19 |
| a19 | Funil completo (diagnóstico do a16/a18) | `jsonb_array_length(core_content->'funnel_blocks')` e camadas vazias | **8** blocos, nenhum com `content` vazio |

**SQL das checagens de adapter (a13-a19).** Rode com o `job_id` do brief (a):

```sql
-- a13/a14/a15/a16 — carrossel
select jsonb_array_length(p.adapted_content->'slides')      as n_slides,
       max(length(s->>'text'))                              as maior_slide,
       min((s->>'index')::int)                              as idx_min,
       max((s->>'index')::int)                              as idx_max,
       count(distinct s->>'index')                          as idx_distintos,
       length(p.adapted_content->>'caption')                as caption_chars
from content_pieces p, jsonb_array_elements(p.adapted_content->'slides') s
where p.job_id = '<JOB_ID_A>' and p.channel_type = 'instagram_carousel'
group by 1, 6;

-- a17/a18 — X (thread ausente = 0 unidades; ver nota)
select length(p.adapted_content->>'text')                                    as texto_chars,
       jsonb_array_length(coalesce(p.adapted_content->'thread','[]'::jsonb)) as n_thread,
       (select max(length(t)) from jsonb_array_elements_text(
          coalesce(p.adapted_content->'thread','[]'::jsonb)) t)              as maior_post
from content_pieces p
where p.job_id = '<JOB_ID_A>' and p.channel_type = 'x_post';

-- a19 — funil completo (diagnóstico do piso de slides e da thread)
select jsonb_array_length(core_content->'funnel_blocks')    as n_blocos,
       (select count(*) from jsonb_array_elements(core_content->'funnel_blocks') b
         where btrim(b->>'content') = '')                   as blocos_vazios
from content_pieces where job_id = '<JOB_ID_A>' limit 1;
```

> **Por que a9 exige `approve` e não "approve ou rewrite".** `judge.ts` (`enforceGate`) força
> `verdict = 'rewrite'` sempre que alguma regra falhar, `voice_pass`/`bridge_logical` falharem
> **ou** `score < corte` — e `runJudging` só devolve `adapting` quando o veredito é `approve`.
> Logo, **toda peça que existe em `content_pieces` passou pelo gate**: `verdict = 'approve'` e
> `score ≥ corte` são propriedades garantidas, não expectativas. Peça persistida com
> `verdict = 'rewrite'` ou `score` abaixo do corte significa que o gate vazou — é regressão do
> motor (README §3.1). O caso "score baixo" não aparece aqui: ele se manifesta como reescrita
> e, se estourar o limite, como o `failed` amarelo do README §3.2.

> **a7 — por que "sem erro" e não "vazio".** `linter.passed = violations.every(v =>
> v.severity !== 'error')` (`linter.ts:223`): violações `warn` **não** bloqueiam. Hoje só
> `lexicon_dosage` é `warn`, e ela sinaliza dosagem de léxico assinatura — informação para o
> editor, não falha do motor. Exigir array vazio produziria vermelho falso. Como o linter
> reprovando manda para `rewriting`, **peça persistida com violação `severity = 'error'` é
> gate vazado** — regressão.
>
> **Corolário — `channel_limit_chars` não pode aparecer em lugar nenhum.** Nem no `audit`,
> nem em `generation_jobs.error`. Três âncoras sustentam isso: (1) `runLinting` remove
> `text_max_chars`, `slide_max_chars` e `caption_max_chars` da config antes de chamar
> `lintText`; (2) a regra 8 do linter só dispara com `config.text_max_chars ??
> config.slide_max_chars` — sem eles, é pulada; (3) `runAdapting` não roda lint nenhum
> pós-adaptação. Se a regra reaparecer, alguém devolveu o `channelConfig(...)` inteiro para o
> `config` do `lintText` — regressão dura (README §3.3).

> **a3/a6 — os canais pedidos são instrução, não filtro.** Os chips viajam como
> `requested_channel_types` até o **prompt** do roteador ("use os canais pedidos pelo
> usuário"); o código só intersecta o resultado com os habilitados (`targetChannels`). Um
> canal a mais ou a menos é desvio do roteador — repita a rodada uma vez antes de marcar
> vermelho; **repetiu, é regressão** de prompt/structured output. Já um canal **desabilitado**
> aparecendo em `content_pieces` é regressão dura: o código deveria tê-lo filtrado.
>
> **Canal extra habilitado não mata mais o job.** Se o roteador acrescentar um canal
> habilitado que você não marcou, o efeito é só uma peça a mais (desvia a3/a6) — o corte do
> juiz pode mudar se ele cair em primeiro, então leia `classification->'channel_types'->>0`
> antes de avaliar a10. `failed` com `channel_limit_chars` nesse cenário **não** é efeito
> colateral esperado: é regressão (README §3.3).

> **a13, a15, a17, a18, b14 e c12 são checagens de clamp — teto garantido.** Os adapters
> cortam e fundem por construção (`clampText`, o merge do excedente no carrossel, o
> `maxPosts - 1` de `microblogThread`), então limite estourado não é "peça longa demais" — é
> adapter quebrado. Mesma lógica do a9: propriedade garantida, não expectativa. **a14 e b15
> (indexação)** entram na mesma família: o índice sai de um `map((text, index) => …)` no
> carrossel e de um literal `index: 0` no `instagram_post` — furo na sequência é código
> quebrado, não variação de conteúdo.

> **a16/a18/a19 — piso não é garantia, é sintoma do gerador.** O carrossel atinge o mínimo de
> 7 slides dividindo o slide mais longo, mas o laço **para** quando `splitInHalf` devolve
> `null` (texto com menos de 2 sentenças e menos de 4 palavras); a thread do X some quando
> camadas 6-7 e o CTA vêm vazios. Com o funil íntegro isso não acontece: capa + camadas 3-6 +
> camada 7 + CTA já dão 7 unidades. Então **menos de 7 slides ou thread ausente aponta para o
> contrato do gerador, não para o adapter** — rode o a19 antes de decidir, olhando as camadas
> **3-8**: as camadas 1-2 não alimentam o carrossel (a capa sai de `hook.written`), então
> camada 1 ou 2 vazia é problema do gerador mas **não** explica o piso furado. Funil com as
> camadas 3-8 preenchidas e ainda assim slides < 7 é **adapter** (README §3.1); camada 3-8
> vazia é o **gerador** (mesma família do "reprovada após 2 reescritas" — amarelo, §3.2).

---

## Brief (b) — Case com número (grounding)

**Objetivo.** Exercitar a Classe 2 nos dois sentidos:

1. o número que **existe** no case é conferido e amarrado à fonte
   (`grounding.checked[].source_item_id` = o `id` do case, `status = 'ok'`);
2. um número que **não existe** no contexto vira `[VERIFICAR: …]`
   (`grounding.flagged[]` + `core_content.verify_flags`), sem derrubar o job.

Por isso o comando pede **duas** grandezas: a do case (que o contexto sustenta) e uma
referência de mercado/benchmark (que o contexto não tem). Sem a segunda, `flagged[]` fica
vazio e metade da Classe 2 não foi testada.

**Canais a marcar em `/criar`:** `instagram_post` (apenas).

**Antes de rodar:** anote da §1.3 do README o `id`, o `title`, o `metric_value` e a
`citation_policy` do case que você vai usar.

### Comando

```
Escreva um post usando o case <TÍTULO OU DESCRIÇÃO CURTA DO CASE, COMO ELE ESTÁ NO CONTEXTO>
como prova, citando o resultado exato dele. Compare esse resultado com a média do mercado de
<SETOR DO CASE> para mostrar o tamanho do salto.
```

*Exemplo preenchido:*

```
Escreva um post usando o case da reestruturação comercial da indústria de embalagens como
prova, citando o resultado exato dele. Compare esse resultado com a média do mercado de
bens industriais para mostrar o tamanho do salto.
```

> Se a `citation_policy` do case for `anonymous`, **não** coloque o nome do cliente no
> comando — o grounding trata nome de cliente em case anônimo como violação estrutural e
> dispara reescrita (`06-arquitetura-ia.md` §4.2, item 5).

### O que esperar em cada etapa

| Etapa | Esperado |
|---|---|
| `classifying` | `needs_angle_choice = false`; `context_query` mencionando o case/resultado; `context_filters.kinds` provavelmente incluindo `case` |
| `retrieving` | `context_ids` **contém o `id` do case** — se não contiver, o retrieval não achou a prova e o resto do brief não é avaliável |
| `generating` | `core_content.proof.context_item_id` = o `id` do case |
| `grounding` | `checked[]` com o número do case amarrado ao `source_item_id` correto, `status = 'ok'`; `flagged[]` com a claim de mercado, `reason = 'not_found_in_context'`, `replaced_with` = `[VERIFICAR: …]` |
| `judging` → `adapting` | Segue normalmente — flags `[VERIFICAR]` **não bloqueiam** a saga |
| Parada | `awaiting_review`, com `[VERIFICAR:` visível na **legenda** da peça na `/biblioteca` (o card carrega só o gancho — ver nota do b9) |

### Checagens objetivas

| # | Checagem | Consulta / onde ver | Aprova se |
|---|---|---|---|
| b1 | Case entrou no contexto | `generation_jobs.context_ids` | contém o `id` do case da §1.3 |
| b2 | Prova central amarrada | `core_content->'proof'->>'context_item_id'` | = `id` do case (**não** nulo) |
| b3 | Sem violação estrutural | `audit->'grounding'->>'passed'` | `true` — ver nota abaixo (**não** mede a presença de `[VERIFICAR]`) |
| b4 | Número conferido contra a fonte | `grounding.checked[]` (SQL do README §2.3) | ≥ 1 entrada com `source_item_id` = `id` do case e `status = 'ok'` |
| b5 | **O número bate com o case** | comparar `checked[].claim` com o `metric_value` da §1.3 | mesma grandeza **após normalização de escala** — ver nota abaixo |
| b6 | Claim sem fonte virou flag | `jsonb_array_length(audit->'grounding'->'flagged')` | **≥ 1**, com `reason = 'not_found_in_context'` |
| b7 | Flag com motivo e substituição | `flagged[].reason` / `flagged[].replaced_with` | `reason` preenchido; `replaced_with` no formato `[VERIFICAR: …]` |
| b8 | Flag propagada ao núcleo | `core_content->'verify_flags'` | array não-vazio |
| b9 | Flag propagada ao derivado | `adapted_content->>'caption'` (a **legenda**, não o card) | contém `[VERIFICAR:` — exceções documentadas na nota do b9 |
| b10 | Flag **não** bloqueou | `generation_jobs.status` | `awaiting_review` (ou `done`) — nunca `failed` por causa da flag |
| b11 | Linter sem erro | `linter_errors` da §2.2 do README | **0** (warns aceitáveis) |
| b12 | Peça criada | `count(*) from content_pieces where job_id` | 1, `channel_type = 'instagram_post'` |
| b13 | Carimbo | `engine_version` | igual à `ENGINE_VERSION` do merge |
| b14 | Limites do canal | `length(adapted_content->'card'->>'text')` e `length(adapted_content->>'caption')` | card ≤ 280 (`text_max_chars`), legenda ≤ 2200 (`caption_max_chars`) |
| b15 | Card indexado | `adapted_content->'card'->>'index'` | `0` (post único é o slide 0 do mesmo `TweetCardSlide`) |

> **b3 — o que `passed` realmente significa.** `passed = !structuralFailure`
> (`grounding.ts:317`). Só três coisas o derrubam: número da prova divergente da fonte
> (`divergent_from_source`), mais de um case citado (`multiple_cases_cited`) e nome de
> cliente em case `anonymous` (`citation_policy_violation`). **Flag `[VERIFICAR]` não mexe em
> `passed`** — por isso b3 (`passed = true`) e b6 (`flagged ≥ 1`) convivem na mesma peça.
> E como falha estrutural retorna `rewriting`, peça persistida tem `passed = true` por
> construção: `false` ali é gate vazado (README §3.1).

> **b5 — o que conta como "bate".** O grounding normaliza escala e locale pt-BR antes de
> comparar (`SCALE_SUFFIX`/`applyScale` em `_shared/grounding.ts`; `06` §4.2 item 2). Então
> `metric_value = 1200000` escrito como **"R$ 1,2 mi"** é `ok` legítimo — não reprove por
> "arredondamento". O que você observa numa rodada verde é `status = 'ok'` com o
> `source_item_id` do case; se a grandeza confere na leitura, é verde.
>
> **Divergência não aparece na peça.** Número divergente marca `checked[].status =
> 'divergent'` **e** dispara falha estrutural → reescrita, então esse `status` nunca chega a
> uma peça persistida. Divergência se manifesta como `attempt > 0` (o motor se corrigiu — ok)
> ou como o `failed` amarelo "reprovada após 2 reescritas: …"; o diagnóstico sai de
> `generation_jobs.error`, não do `audit`.

> **b9 — por que a legenda, e quais são as exceções legítimas.** O grounding roda sobre
> `renderCoreContentText(core)`, que é **`funnel_blocks` + `cta`** — o `hook` fica de fora.
> `applyVerifyFlags` reescreve exatamente esses dois lugares. Como o `card` do
> `instagram_post` carrega só `hook.written`, **`[VERIFICAR:` nunca pode aparecer no card**:
> procure na `caption`. A legenda monta camadas 4, 5, 6, 7 + `ctaText` (camada 8 + CTA), então
> duas ausências são legítimas: (1) a claim caiu nas camadas **1-3**, que a legenda não
> carrega; (2) o núcleo ficou gordo e o `clampText(…, 2200)` cortou a cauda onde a marcação
> estava. Antes de marcar vermelho, confira `core_content->'verify_flags'` (b8) e em qual
> `funnel_blocks[].layer` a marcação está — flag presente no núcleo e ausente no derivado por
> mapeamento de camada ou por corte é **adapter**, não Classe 2, e não reprova o brief.

> **b6 vazio não é sempre regressão.** Se `flagged[]` vier vazio, primeiro confira se o
> gerador realmente escreveu uma segunda grandeza (a de mercado). Se ele ignorou o pedido de
> comparação, refaça com o slot de benchmark mais explícito. `flagged[]` vazio **com** um
> número de mercado presente no texto = regressão da Classe 2 (README §3.1).

---

## Brief (c) — Tema amplo (escolha de ângulo)

**Objetivo.** Provar o caminho de duas fases: o roteador reconhece que o tema é aberto, para
em `awaiting_angle` com 3-4 ângulos distintos, e a saga retoma corretamente por `resume-job`
até `awaiting_review`.

**Canais a marcar em `/criar`:** `linkedin_post` (apenas).

> `linkedin_post` tem a nota de corte mais dura (9) e o adapter mais complexo (6 blocos
> estruturados). É de propósito: é aqui que o adapter de blocos é exercitado. Em compensação,
> reescrita neste brief é comum com recheio raso — **`error` começando com "reprovada após 2
> reescritas" é amarelo, não vermelho** (README §3.2).
>
> Vermelho específico deste brief: `error` citando `channel_limit_chars` com `N/3000`. O
> núcleo tem 1.500-2.500 chars e o limite do canal **não** é mais aplicado ao núcleo, então
> essa mensagem só existe se o linting voltar a receber os limites do canal — regressão
> (README §3.3). Não repita a rodada esperando passar: reverta.

### Comando

```
Quero falar sobre <TEMA AMPLO DO TERRITÓRIO DA MARCA — UM SUBSTANTIVO, SEM RECORTE>.
```

*Exemplo preenchido:*

```
Quero falar sobre produtividade comercial.
```

Deixe o comando propositalmente curto e sem recorte. Qualquer complemento ("...e como isso
afeta X", "o ângulo é Y") fecha o tema e o roteador passa direto — o que **invalida** o brief.

### Fase 1 — até `awaiting_angle`

| Etapa | Esperado |
|---|---|
| `classifying` | `needs_angle_choice = true` |
| Parada | `awaiting_angle` ("aguardando ângulo"); o seletor de ângulos aparece no card do job em `/criar` |
| Ângulos | 3 a 4 opções, `id` = `a1`…`a4`, cada uma com `title` + `hook`, **distintas entre si** (não variação cosmética do mesmo recorte) |

### Fase 2 — retomada

Escolha **sempre o primeiro ângulo (`a1`)**. Escolher por gosto quebra a comparabilidade
entre rodadas.

| Etapa | Esperado |
|---|---|
| `resume-job` | `selected_angle` gravado no job com o `AngleOption` completo |
| `retrieving` → `adapting` | Percurso normal a partir do checkpoint |
| Parada | `awaiting_review`, 1 peça `linkedin_post` |

### Checagens objetivas

| # | Checagem | Consulta / onde ver | Aprova se |
|---|---|---|---|
| c1 | Parou no ângulo | `classification->>'needs_angle_choice'` | `true` |
| c2 | Estado de espera atingido | status do job na fase 1 | `awaiting_angle` |
| c3 | Quantidade de ângulos | `jsonb_array_length(classification->'angles')` | **3 ou 4** |
| c4 | IDs estáveis | `classification->'angles'` | ids distintos; o padrão pedido no prompt é `a1`…`a4` nessa ordem — ver nota |
| c5 | Ângulos completos | cada item de `angles` | `title` e `hook` não-vazios |
| c6 | Ângulos distintos | leitura rápida dos `title`/`hook` | recortes diferentes, não a mesma ideia reescrita |
| c7 | Escolha gravada | `generation_jobs.selected_angle` | objeto completo (`id`, `title`, `hook`) e `id` = o do **primeiro** ângulo da lista |
| c8 | Retomada funcionou | `generation_jobs.status` após `resume-job` | avançou de `awaiting_angle`; termina em `awaiting_review` (ou `done`) |
| c9 | Sem erro de motor | `generation_jobs.error` | nulo — ou cai no README §3.2 |
| c10 | Peça criada | `count(*) from content_pieces where job_id` | 1, `channel_type = 'linkedin_post'` |
| c11 | Blocos do adapter | `adapted_content->'blocks'` | chaves `hook`, `contexto`, `lista`, `insight`, `ponte`, `cta` presentes |
| c12 | Serialização | `adapted_content->>'text'` | não-vazio, ≤ 3000 chars |
| c13 | Auditoria completa | `audit` | as 3 chaves presentes; `linter_errors` = 0; `grounding.passed` e `judge.verdict = 'approve'` |
| c14 | Carimbo | `engine_version` | igual à `ENGINE_VERSION` do merge |
| c15 | Reescrita dentro do limite | `generation_jobs.attempt` | ≤ 2 |

> **c4 — o `a1` vem do prompt, não do schema.** O JSON schema do roteador só exige
> `id: string`; o padrão `"a1"…"a4"` é uma instrução do prompt
> (`prompts/router.ts:123`). ID fora do padrão é desvio do roteador — anote e repita uma vez,
> mas **não reprova a saga**: o que precisa funcionar é `resume-job` aceitar o id devolvido.
> Escolha sempre o **primeiro** ângulo da lista, qualquer que seja o id.

---

## Cobertura resultante

| Componente do motor | Coberto por |
|---|---|
| Roteador — caminho fechado | a1, a2 |
| Roteador — caminho aberto + ângulos | c1-c6 |
| `resume-job` / retomada por checkpoint | c7, c8 |
| Retrieval híbrido + ranking de case | b1, b2 |
| Gerador + funil de 8 camadas | a, b, c (todas as peças) |
| Classe 1 — Linter | a7, b11, c13 |
| Classe 2 — Grounding (ok) | b4, b5 |
| Classe 2 — Grounding (flag) | b6-b9 |
| Classe 3 — Juiz | a9, a10 |
| Loop de reescrita | c15 + triagem do README §3.2 |
| Contrato do funil (8 camadas preenchidas) | a19 |
| Adapters — tweet-card | `instagram_carousel` (a13-a16), `instagram_post` (b14, b15), `x_post` (a17, a18) |
| Adapters — blocos | `linkedin_post` (c11, c12) |
| Adapting multi-canal | a6 |
| Carimbo de versão | a11, a12, b13, c14 |

**O que fica de fora, e por quê.** Três adapters não aparecem nos briefs — por escolha, não
por impedimento:

- **`threads_post`** é coberto **por construção** pelo `x_post`: os dois chamam os mesmos
  `microblogMainText`/`microblogThread` de `base.ts`, diferindo só no limite de chars (500 vs.
  280) e no `channel_type` do retorno. a17/a18 exercitam o mesmo código.
- **`facebook_post`** e **`instagram_stories`** são os adapters mais simples (texto único
  concatenado; frames com papel fixo) e foram os canais das rodadas anteriores do golden set.
  Foram trocados de propósito pelos de tweet-card, onde o risco se concentra.

Se quiser cobrir os 7 numa rodada só, marque também `facebook_post` no brief (a): o corte
dele é 8 (igual aos outros dois), então a10 não muda — mas a3/a6 passam a esperar **3** peças.
