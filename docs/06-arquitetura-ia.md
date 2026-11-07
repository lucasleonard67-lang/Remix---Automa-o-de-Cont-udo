# Arquitetura de IA

Este documento especifica o motor de IA do Content Engine: os princípios de orquestração, os papéis de IA e seus contratos de entrada/saída, a saga de geração estado a estado, a auditoria em 3 classes, o RAG do Conteúdo de Contexto, a abstração de provider (`_shared/llm.ts`), prompt caching, estimativa de custo e telemetria. O modelo de dados referenciado aqui está em `04-modelo-de-dados.md`; os contratos das edge functions em `07-contratos-backend.md`; as telas que consomem o pipeline em `05-rotas-e-modulos.md`; o recorte do MVP em `02-escopo-mvp.md`. Toda a lógica descrita aqui vive em Supabase Edge Functions e na lib compartilhada `supabase/functions/_shared/` — nunca em server functions do TanStack.

---

## 1. Princípios

### 1.1 Grafo de estados fixo, LLM só nos nós

O pipeline de geração **não é um agente autônomo decidindo o próprio fluxo**. É uma máquina de estados durável sobre `generation_jobs`, com sequência invariante definida em código. O LLM é chamado apenas dentro de nós específicos (classificar, gerar, julgar, extrair voz); a ordem dos nós, os gates e o loop de reescrita são determinísticos.

A autonomia real é cirúrgica e existe em exatamente três momentos:

| Momento | Onde | Por quê |
|---|---|---|
| Exploração de ângulos | Roteador, quando o comando é amplo | Requer julgamento editorial sobre o que "para o scroll" |
| Julgamento semântico | Juiz (Classe 3 da auditoria) | Só um LLM avalia "isso poderia sair em qualquer perfil?" |
| Entrevista de extração de voz | Extrator de Voz, no onboarding sem corpus | A próxima pergunta depende da resposta anterior |

Todo o resto — ordenação fail-fast da auditoria, fan-out de adapters, limite de reescritas, carimbo de versões — é regra dura em código. Isso é o que separa produto confiável de demo imprevisível: reprodutibilidade (cada peça carimba `persona_version`, `strategy_version`, `guardrails_version`, `brand_kit_version`, `engine_version`, `context_ids`) e custo previsível.

### 1.2 Regra de altitude

Cada nó do grafo declara seu **envelope de contexto**, e isso é fronteira de arquitetura, não recomendação. A regra central:

> **O Gerador só vê: voz + guardrails + briefing + contexto selecionado.** Nada mais.

- **Voz** = `content` da versão ativa de `brand_persona` (contrato de voz de 9 seções), compilado em texto de prompt.
- **Guardrails** = `content` da versão ativa de `guardrails` (ban list, regras, dosagem), compilado.
- **Briefing** = saída estruturada do Roteador (`classification` + `selected_angle` do job): formato, canais alvo, tese, ângulo escolhido. A tese chega **destilada no briefing** — o Gerador nunca lê `brand_strategy` inteira.
- **Contexto selecionado** = os chunks/itens recuperados pelo Retrieval e gravados em `generation_jobs.context_ids`, incluindo o bloco do case selecionado com metadata tipada.

Quem lê `brand_strategy` (promessa, teses, ICP, postura editorial) é o **Roteador**, para classificar e briefar. Misturar contexto de estratégia no prompt de geração dilui a peça e faz o gerador raciocinar sobre posicionamento quando deveria estar contando uma história. Bônus prático: o prompt de geração fica enxuto e cacheável (ver §7).

### 1.3 Juiz separado do Gerador

O Juiz roda **sempre em chamada de LLM separada** da geração — nunca como auto-avaliação no mesmo prompt. Auto-aprovação sofre de self-preference bias e anula o gate de qualidade. O Gerador é deliberadamente "burro e obediente": recebe briefing fechado, escreve, não seleciona case sozinho e não se aprova. O Juiz recebe a peça pronta + rubrica + contexto de grounding e devolve veredito estruturado.

### 1.4 Fail-fast por custo

A auditoria roda na ordem do gate mais barato para o mais caro: **Linter (regex, custo zero de token) → Grounding (diff determinístico) → Juiz (LLM)**. Não se gasta token de juiz numa peça que já tem travessão banido.

---

## 2. Papéis de IA (4 + 2)

O motor tem **4 papéis de LLM e 2 ferramentas não-LLM** — não "11 agentes". Os adapters de canal (`_shared/adapters/`) são configuração/código determinístico, não cérebros (ver `08-estrategia-template.md` para a implicação: canal novo = arquivo novo, não agente novo).

| Papel | Tipo | Modelo (classe) | Chamado por |
|---|---|---|---|
| **Roteador** | LLM, structured output | Rápido/barato | `generate-content` (estado `classifying`) |
| **Gerador** | LLM, structured output | Forte em escrita | Saga (estados `generating`, `rewriting`) |
| **Juiz** | LLM, structured output, chamada separada | Forte em julgamento | Saga (estado `judging`) |
| **Extrator de Voz** | LLM, structured output | Forte em análise | `extract-voice` (onboarding passo 4) |
| **Retrieval** | Ferramenta (pgvector + FTS) | — (só embeddings) | Saga (estado `retrieving`), `/contexto` |
| **Linter** | Ferramenta (regex/código puro) | — | Saga (estado `linting`), adapters |

### 2.1 Roteador

**Papel.** Transforma o comando livre do usuário (ex.: "Faça uma postagem sobre a Copa do Mundo e como isso afeta o mercado imobiliário") em um briefing executável. Classifica formato/canais/tese, gera ângulos candidatos quando o tema é amplo e produz a query de contexto para o Retrieval.

**Inputs:**
- `prompt` do job (comando do usuário) e `channel_types` opcionais informados na chamada;
- versão ativa de `brand_strategy` (teses, ICP, postura editorial, content_mix) — é o único papel de geração que a lê inteira;
- lista de canais habilitados (`channels` com `enabled = true`);
- resumo do contrato de voz (identity + teses da persona), para calibrar ângulos.

**Output** — gravado em `generation_jobs.classification` (jsonb), structured output com schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["format", "channel_types", "thesis", "angles", "context_query", "needs_angle_choice"],
  "properties": {
    "format": { "type": ["string", "null"], "description": "Formato detectado no comando; null = ambíguo" },
    "channel_types": {
      "type": "array",
      "items": { "enum": ["instagram_stories", "instagram_carousel", "instagram_post", "x_post", "threads_post", "linkedin_post", "facebook_post"] },
      "description": "Canais alvo (informados pelo usuário ou inferidos entre os habilitados)"
    },
    "thesis": { "type": ["string", "null"], "description": "Tese da marca que a peça sustenta (destilada de brand_strategy)" },
    "angles": {
      "type": "array", "minItems": 1, "maxItems": 4,
      "items": {
        "type": "object", "additionalProperties": false,
        "required": ["id", "title", "hook"],
        "properties": {
          "id": { "type": "string", "description": "Identificador estável do ângulo (AngleOption.id)" },
          "title": { "type": "string" },
          "hook": { "type": "string", "description": "Gancho/capa proposto para este ângulo" },
          "rationale": { "type": "string" }
        }
      }
    },
    "context_query": { "type": "string", "description": "Query para a busca híbrida do Retrieval" },
    "context_filters": {
      "type": "object", "additionalProperties": false,
      "properties": {
        "kinds": { "type": "array", "items": { "enum": ["transcript", "post", "document", "reference", "case", "offer"] } },
        "tags": { "type": "array", "items": { "type": "string" } }
      }
    },
    "needs_angle_choice": { "type": "boolean", "description": "true quando o comando é amplo → job vai para awaiting_angle" }
  }
}
```

**Regras de decisão:** se o comando já traz ângulo inequívoco (tema fechado + recorte claro), `needs_angle_choice = false` e `angles` tem 1 item, auto-selecionado. Se o tema vem solto, 3-4 ângulos com hook de cada — a maior alavanca anti-retrabalho do produto: o humano escolhe a capa antes de o Gerador escrever tudo. Cada ângulo é um `AngleOption` (`{ id, title, hook, rationale? }`); `selected_angle` do job guarda o `AngleOption` escolhido, e o gatilho do estado `awaiting_angle` é exclusivamente `needs_angle_choice === true` (nunca "2+ ângulos").

### 2.2 Gerador

**Papel.** Função pura: `briefing + voz + contexto → core_content`. Escreve a IDEIA e o CONTEÚDO núcleo da peça seguindo o funil narrativo de 8 camadas (framework default, `_shared/funnel.ts`). Nunca fala com o usuário, nunca escolhe case, nunca se auto-aprova. A adaptação por canal é dos adapters (código), não dele.

**Inputs (envelope de altitude — nada além disso):**
- prompts do motor (`_shared/prompts/`, versionados com `ENGINE_VERSION`): instruções do funil de 8 camadas e do formato de saída;
- voz compilada (versão ativa de `brand_persona`, 9 seções — com dosagem do `signature_lexicon`: máx 1-2 por peça);
- guardrails compilados (ban list como texto de prompt + regras duras de grounding);
- briefing: `classification` + `selected_angle` do job;
- contexto selecionado: chunks/itens de `context_ids`, com o case central e sua metadata (respeitando `citation_policy`: `named` cita o cliente, `anonymous` anonimiza);
- **anti-repetição (F3.8, 2026-08-01)**: seção "# ANTI-REPETIÇÃO" com provas/temas das peças recentes (`editorial_state.state.recent`), regra SUAVE — nunca em amostra do gate de tom nem em regeneração (ver §4.5);
- **referências de estilo (F4.1, 2026-08-01)**: seção "# REFERÊNCIAS DE ESTILO" com trechos de peças aprovadas, números removidos — calibração de tom, nunca fonte de dado (ver §4.5);
- em reescrita: o diagnóstico estruturado da auditoria reprovada (ver §4.4);
- em regeneração guiada (`regenerate-piece`): a `instruction` do usuário ("mais provocador", "encurta").

**Regras duras embutidas no prompt:** nunca inventar número/case; fonte obrigatória para todo dado; **1 prova central por peça**; dado faltante vira `[VERIFICAR: x]` no texto; a marca só aparece de verdade nas camadas 7-8 (aterrissagem por ponte LÓGICA na oferta — nunca colada).

**Output** — gravado como `core_content` (jsonb) em `content_pieces`, structured output:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["idea", "hook", "funnel_blocks", "proof", "verify_flags", "cta", "image_brief"],
  "properties": {
    "idea": { "type": "string", "description": "A IDEIA central da peça, em uma frase" },
    "hook": {
      "type": "object", "additionalProperties": false,
      "required": ["visual", "written"],
      "properties": {
        "visual": { "type": "string", "description": "Gancho visual (camada 1)" },
        "written": { "type": "string", "description": "Gancho escrito (camada 2)" },
        "spoken": { "type": "string", "description": "Gancho falado (camada 3), quando o formato pede" }
      }
    },
    "funnel_blocks": {
      "type": "array", "minItems": 8, "maxItems": 8,
      "items": {
        "type": "object", "additionalProperties": false,
        "required": ["layer", "name", "content"],
        "properties": {
          "layer": { "type": "integer", "description": "1..8 (gancho visual, gancho escrito, gancho falado, contexto/Ponto A, virada/Ponto B, ensino+prova, moral/tese, autoridade+CTA)" },
          "name": { "type": "string", "description": "Nome da camada (ex.: \"virada/Ponto B\")" },
          "content": { "type": "string" }
        }
      }
    },
    "proof": {
      "type": "object", "additionalProperties": false,
      "required": ["claim", "context_item_id"],
      "properties": {
        "claim": { "type": "string", "description": "Afirmação exata (número/quote) usada como prova central" },
        "context_item_id": { "type": ["string", "null"], "description": "uuid do context_item da prova central; deve pertencer a context_ids do job" },
        "source_url": { "type": "string", "description": "URL da fonte, quando houver" }
      },
      "description": "Prova central declarada, insumo do grounding"
    },
    "verify_flags": { "type": "array", "items": { "type": "string" }, "description": "Dados faltantes marcados [VERIFICAR: x] pelo próprio gerador" },
    "cta": { "type": "string", "description": "CTA escolhido do repertório permitido (allowed_ctas)" },
    "image_brief": { "type": ["string", "null"], "description": "Brief textual para generate-image (null quando a peça não pede imagem)" }
  }
}
```

O grounding exige `proof.context_item_id ∈ generation_jobs.context_ids`; quando `null`, a claim numérica vira flag em `verify_flags` (ver §4.2).

### 2.3 Juiz

**Papel.** LLM-as-judge, Classe 3 da auditoria. Chamada separada do Gerador, com rubrica fixa. Reprova ou aprova com nota; quando reprova, devolve diagnóstico acionável que alimenta a reescrita.

**Inputs:** peça (`core_content` renderizado como texto corrido), rubrica (`guardrails.content.qa_rubric` + rubrica default do motor), voz compilada (para julgar aderência), briefing (tese + ângulo escolhido), bloco do case selecionado (para julgar se a prova sustenta o ensino), nota de corte do canal alvo (ver §4.3) e — **em uso desde 2026-08-01 (F4.3)** — exemplos de `piece_feedback` como few-shot de calibração: 4 rejeições + 2 aprovações recentes **com notas** (excerto = hook/idea da peça), incl. vereditos do gate de tom (ver §4.5).

**Output** — gravado em `content_pieces.audit.judge`, structured output:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["verdict", "score", "rules", "voice_pass", "bridge_logical", "diagnosis"],
  "properties": {
    "verdict": { "enum": ["approve", "rewrite"] },
    "score": { "type": "number", "minimum": 0, "maximum": 10, "description": "0-10, comparado ao cutoff_score do canal (§4.3)" },
    "rules": {
      "type": "array", "minItems": 4, "maxItems": 4,
      "items": {
        "type": "object", "additionalProperties": false,
        "required": ["rule", "passed"],
        "properties": {
          "rule": { "enum": ["novidade", "aplicabilidade", "proprietario", "narrativa"] },
          "passed": { "type": "boolean" },
          "note": { "type": "string" }
        }
      }
    },
    "voice_pass": { "type": "boolean", "description": "Passa no voice_checklist da persona?" },
    "bridge_logical": { "type": "boolean", "description": "Ponte da camada 8 é lógica (não colada na oferta)?" },
    "diagnosis": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Problemas acionáveis (citando a camada do funil quando aplicável) — alimenta a reescrita"
    }
  }
}
```

A rubrica das 4 regras e a mecânica da nota de corte estão detalhadas em §4.3.

### 2.4 Extrator de Voz

**Papel.** Usado no onboarding (passo 4, `/onboarding` → `voz`) via edge function `extract-voice`. A partir do corpus inicial do Conteúdo de Contexto, produz um **rascunho** das 9 seções do contrato de voz. O humano aceita/edita cada seção — nunca aceita cego. Sem corpus, o mesmo passo vira entrevista guiada (frontend conduz; o Extrator gera a próxima pergunta em função das respostas — este é um dos três nós com autonomia real).

**Inputs:** `context_item_ids[]` (transcrições/posts do corpus — recomendação de UI: 5-10 transcrições ou 15-20 posts), template de nicho escolhido (`niche_templates.payload`, para pré-popular arquétipos e postura quando o corpus é fraco).

**Output** — rascunho do `content` de `brand_persona` (que só vira versão `active` após edição/aprovação humana):

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["identity", "credenciais", "worldview", "tone_principles", "signature_lexicon",
               "calibration_heuristics", "banlist", "opinioes", "voice_checklist", "reference_examples"],
  "properties": {
    "identity": { "type": "object", "required": ["name", "role", "positioning", "audience"], "additionalProperties": false,
      "properties": { "name": { "type": "string" }, "role": { "type": "string" },
        "positioning": { "type": "string" }, "audience": { "type": "string" } } },
    "credenciais": {
      "type": "array",
      "items": { "type": "object", "required": ["claim", "source"], "additionalProperties": false,
        "properties": { "claim": { "type": "string" }, "source": { "type": "string" } } }
    },
    "worldview": { "type": "object", "required": ["summary", "theses"], "additionalProperties": false,
      "properties": { "summary": { "type": "string" },
        "theses": { "type": "array", "items": { "type": "string" }, "description": "Teses candidatas detectadas no corpus" } } },
    "tone_principles": { "type": "array", "items": { "type": "string" } },
    "signature_lexicon": {
      "type": "array",
      "items": { "type": "object", "required": ["term", "usage", "max_per_piece"], "additionalProperties": false,
        "properties": { "term": { "type": "string" }, "usage": { "type": "string", "description": "Quando/como usar" },
          "max_per_piece": { "type": "integer", "description": "Dosagem: máx 1-2" } } }
    },
    "calibration_heuristics": { "type": "array", "items": { "type": "string" } },
    "banlist": { "type": "object", "required": ["ref"], "additionalProperties": false,
      "properties": { "ref": { "type": "string", "enum": ["guardrails"] } },
      "description": "Referência à fonte única em guardrails — o extrator só SUGERE adições (fora deste campo), nunca duplica" },
    "opinioes": { "type": "array",
      "items": { "type": "object", "required": ["topic", "stance"], "additionalProperties": false,
        "properties": { "topic": { "type": "string" }, "stance": { "type": "string" } } } },
    "voice_checklist": { "type": "array", "items": { "type": "string" } },
    "reference_examples": { "type": "object", "required": ["good", "bad"], "additionalProperties": false,
      "properties": {
        "good": { "type": "array", "items": { "type": "object", "required": ["text", "why"], "additionalProperties": false,
          "properties": { "text": { "type": "string" }, "why": { "type": "string" } } } },
        "bad": { "type": "array", "items": { "type": "object", "required": ["text", "why"], "additionalProperties": false,
          "properties": { "text": { "type": "string" }, "why": { "type": "string" } } } } } }
  }
}
```

### 2.5 Retrieval (ferramenta, não-LLM)

Não raciocina: recupera. Busca híbrida sobre `context_items`/`context_chunks` (pgvector + FTS + filtros), com ranking especial para `kind = 'case'`. Único uso de modelo é o embedding da query (papel `embeddings` do provider). Detalhes em §5.

**Input:** `{ query, filters?: { kinds?, tags? }, limit? }` (vindo de `classification.context_query`/`context_filters`, ou da busca manual em `/contexto`).
**Output:** lista ranqueada de `{ item_id, chunk_index?, content, kind, metadata, score }`; a saga grava os `item_id` distintos em `generation_jobs.context_ids`.

### 2.6 Linter (ferramenta, não-LLM)

`_shared/linter.ts` — Classe 1 da auditoria, regex/código puro, zero token. Roda no estado `linting` e é reutilizado pelos adapters (`lint_overrides` por canal). Regras em §4.1.

**Input:** texto da peça + guardrails ativos + `channel_scope_overrides` + limites do canal (do adapter).
**Output:** `{ passed: boolean, violations: [{ rule, match, position?, severity: 'error' | 'warn' }] }` — gravado em `content_pieces.audit.linter`.

---

## 3. Saga de geração — estado a estado

A saga é executada pelo runner do job dentro das edge functions `generate-content` e `resume-job` (com `EdgeRuntime.waitUntil` para processar em background após responder rápido com o `job_id`). O frontend acompanha por Realtime nas tabelas `generation_jobs` e `content_pieces`. Um watchdog em pg_cron re-invoca `resume-job` para jobs travados (>N min sem update). Estados são o enum `job_status` de `generation_jobs` (ver `04-modelo-de-dados.md`).

```text
                         POST generate-content {prompt, channel_types?}
                                        │
                                     created
                                        │
                                   classifying ──── Roteador (LLM rápido, structured output)
                                        │
                        needs_angle_choice = true?
                        │                          │
                       sim                        não
                        │                          │
                  awaiting_angle                   │
          (retorna 3-4 ângulos c/ hook;            │
           usuário escolhe → resume-job            │
           {job_id, selected_angle})               │
                        └──────────┬───────────────┘
                                   │
                               retrieving ───── Retrieval (busca híbrida; grava context_ids)
                                   │
                             [researching] ──── Pesquisa web reativa (§5.4) — SÓ quando o job pediu
                                   │            (web_research.requested); digest vira context_item
                                   │            e entra em context_ids; falha NUNCA derruba o job
                               generating ───── Gerador (core_content; altitude: voz+guardrails+briefing+contexto)
                                   │
                                linting ─────── Linter (Classe 1, regex, fail-fast)
                                   │ falhou ──────────────┐
                                   │                      │
                               grounding ────── Diff de números/citações → [VERIFICAR] (Classe 2)
                                   │ falha dura ──────────┤
                                   │                      │
                                judging ─────── Juiz (Classe 3, chamada separada, nota de corte)
                                   │ verdict = rewrite ───┤
                                   │                      ▼
                                   │                  rewriting  (attempt += 1; diagnóstico → Gerador)
                                   │                      │ attempt ≤ 2 → volta a generating
                                   │                      │ attempt > 2 → segue adiante (escala p/ humano
                                   │                      │              com chips vermelhos)
                                   │◄─────────────────────┘
                                   │
                                adapting ────── Adapters determinísticos (1 content_piece por canal alvo)
                                   │
                             awaiting_review ── Peças em /biblioteca (aprovação humana, [VERIFICAR], chips)
                                   │
                                  done

        Estados terminais alternativos: failed (erro em generation_jobs.error) · cancelled
```

O que cada estado consome e produz:

| Estado | Executor | Consome | Produz |
|---|---|---|---|
| `created` | `generate-content` | `{prompt, channel_types?}` | Linha em `generation_jobs`; resposta imediata com `job_id` |
| `classifying` | Roteador | prompt + `brand_strategy` ativa + canais habilitados | `classification` jsonb (formato, canais alvo, tese, ângulos[], context_query) |
| `awaiting_angle` | humano (via `/criar`) | `classification.angles` | `selected_angle` jsonb (via `resume-job {job_id, selected_angle}`) |
| `retrieving` | Retrieval | `context_query` + `context_filters` | `context_ids uuid[]` + chunks em memória do runner |
| `researching` | `_shared/web-search.ts` + runner (condicional: `web_research.requested`) | `context_query` (fallback: prompt) + config `app_settings.web_search` + key no Vault | `context_item` materializado (kind `reference`, tag `pesquisa-web`) appendado em `context_ids`; registro em `generation_jobs.web_research` (§5.4) |
| `generating` | Gerador | envelope de altitude (§1.2); em volta de reescrita, + diagnóstico | `core_content` jsonb |
| `linting` | Linter | texto da peça + guardrails + limites | `audit.linter` (`passed`, `violations[]`) |
| `grounding` | `_shared/grounding.ts` | texto + `context_ids` + metadata dos cases | `audit.grounding` (checks, flags, texto com `[VERIFICAR]`) |
| `judging` | Juiz | peça + rubrica + voz + case + nota de corte do canal | `audit.judge` (rules, score, verdict, diagnosis) |
| `rewriting` | runner | diagnóstico consolidado das 3 classes | `attempt += 1`; retorna a `generating` |
| `adapting` | adapters (`_shared/adapters/`) | `core_content` + `channels.config` + brand kit | 1 linha em `content_pieces` por canal alvo (`adapted_content`, versões carimbadas) |
| `awaiting_review` | humano (via `/biblioteca`) | peças + chips de auditoria + flags `[VERIFICAR]` | `status` da peça (`approved`/`rejected`) + `piece_feedback` |
| `done` | runner | — | Job encerrado; `timings` consolidado |
| `failed` | runner/watchdog | exceção ou 402 do gateway | `error` text preenchido |
| `cancelled` | usuário | — | Job abortado |

Notas:

- **`tone-gate`** reusa exatamente esta saga com flag `sample=true`, gerando as 3 peças-amostra do onboarding (passo 9). Os vereditos do cliente vão para `piece_feedback` e calibram o Juiz.
- **`regenerate-piece`** reentra na saga no estado `generating` com a `instruction` do usuário anexada ao envelope (proposta — validar: reusa o mesmo job com novo `attempt`, mantendo `context_ids`).
- A etapa **`researching` é condicional ao pedido do usuário** (toggle "Pesquisa web" em `/criar` → `generate-content {web_search: true}`): sem o pedido, `retrieving` vai direto a `generating`. Detalhes, drivers e degradação graciosa em §5.4.
- A renderização visual não faz parte da saga: o tweet-card é render determinístico client-side (componente React + brand tokens → PNG) e a imagem IA é `generate-image` sob demanda a partir do `image_brief` — nenhum modelo de imagem no caminho crítico da saga. O mesmo vale para o carrossel com fotos por slide: a **direção de arte** (style bible + brief por slide) e o batch de fotos rodam dentro de `generate-image` (scope `'slides'`, 07-contratos-backend.md §3.5), sob demanda, fora da saga.

---

## 4. Auditoria em 3 classes

Gate "não publica falha", em ordem fail-fast. Resultado integral fica em `content_pieces.audit` (`linter{}`, `grounding{}`, `judge{}`) e vira chips na UI da `/biblioteca` — o operador vê que o QA aconteceu sem precisar conhecer o método.

### 4.1 Classe 1 — Linter determinístico (`_shared/linter.ts`)

Regex/código, sem LLM, custo zero. Fonte única de regras: versão ativa de `guardrails` (nunca duplicar ban list em prompts de canal — os adapters recebem `lint_overrides`, não cópias). Regras do MVP:

| Regra | Fonte em `guardrails.content` | Verificação |
|---|---|---|
| Pontuação banida | `banned_punctuation[]` | Ocorrência literal (ex.: travessão) em qualquer bloco |
| Palavras banidas | `banned_words[]` | Match case-insensitive com fronteira de palavra |
| Metáforas banidas | `banned_metaphors[]` | Match de expressão |
| Emojis | regra do motor + override | Nenhum emoji no corpo (salvo canal que libere via override) |
| Hashtags fora de metadado | `channel_scope_overrides{}` | Hashtag proibida no corpo; liberada onde o canal declarar campo de metadado |
| CTAs proibidos | `banned_ctas[]` | CTA da peça não pode estar na lista; deve vir de `allowed_ctas[]` |
| Limites do canal | `channels.config` + adapter (`limits`) | Chars por peça/slide, nº de slides (7-10 carrossel), nº de frames (3-6 stories) |
| Dosagem de léxico | `dosage_rules{}` | Termos do `signature_lexicon` no máx 1-2 por peça |
| CAPS LOCK / antítese "não é X e Y" | preset de `niche_templates` → guardrails | (proposta — validar) regex herdada do método de referência, ativada pelo template de nicho |

O Linter roda **pós-geração** no estado `linting` e novamente **pós-adaptação** dentro de cada adapter (com `lint_overrides` do canal) — um derivado não escapa da ban list por ser derivado.

### 4.2 Classe 2 — Verificador de grounding (`_shared/grounding.ts`)

A adição de maior valor jurídico/reputacional: garante que nenhum número ou citação foi inventado ou alterado. Implementação determinística (sem LLM no MVP):

1. **Extração de claims do output.** Regex sobre o texto da peça captura: valores monetários (`R$ 1,2 mi`, `US$ 40k`), percentuais (`37%`), multiplicadores (`3x`, `dobrou`), números com contexto (`em 90 dias`), e trechos entre aspas (quotes atribuídas).
2. **Normalização.** Locale pt-BR (separadores de milhar/decimal), unidades (`mi`/`milhões`), arredondamentos declarados.
3. **Diff contra o contexto selecionado.** Cada claim é comparada com: (a) a metadata tipada dos itens `kind = 'case'` em `context_ids` (`metric_type`, `metric_value`, `quote`); (b) o texto de `context_items.body` dos itens selecionados. Match exato ou tolerante (mesma grandeza, mesmo arredondamento explícito) → `ok`.
4. **Divergência ou ausência de fonte** → o claim é substituído no texto por `[VERIFICAR: <claim>]` e registrado em `audit.grounding.flagged[]`. **Número parafraseado/arredondado sem base também falha** — regra "nunca alterar número".
5. **Regras estruturais:** exatamente **1 prova central por peça** (mais de um case citado = falha, volta para reescrita); `proof.context_item_id` deve pertencer a `context_ids` (quando `null`, a claim numérica vira flag em `verify_flags`); `citation_policy = 'anonymous'` com nome do cliente no texto = falha.

Saída (`audit.grounding`):

```json
{
  "passed": true,
  "checked": [{ "claim": "R$ 1,2 mi em 90 dias", "source_item_id": "…", "status": "ok" }],
  "flagged": [{ "claim": "40% de aumento", "reason": "not_found_in_context", "replaced_with": "[VERIFICAR: 40% de aumento]" }]
}
```

Flags `[VERIFICAR]` **não bloqueiam** a saga (o dado faltante segue sinalizado até `awaiting_review`, onde a confirmação humana é obrigatória antes de aprovar); violações estruturais (case inventado, número alterado, >1 prova) **bloqueiam** e disparam reescrita. (proposta — validar) Uma passada opcional de extração assistida por LLM leve — papel `router` — pode complementar a regex para claims não numéricas; fica atrás de flag em `app_settings` e desligada por default.

### 4.3 Classe 3 — Juiz semântico

Chamada separada (§1.3), structured output (§2.3). A rubrica avalia **as 4 regras editoriais**, cada uma com `passed` + `note`:

1. **Novidade** (`novidade`) — o leitor sai com algo novo (informação, ângulo ou síntese que ele não tinha).
2. **Aplicabilidade** (`aplicabilidade`) — é acionável/aplicável para o ICP; não é abstração vazia.
3. **Análise proprietária** (`proprietario`) — a pergunta-guilhotina: *"essa peça poderia ter saído em qualquer perfil? Se sim, REPROVA."* É a defesa central contra AI-slop genérico: exige leitura da tese/opinião da marca no texto.
4. **Embalagem narrativa** (`narrativa`) — a história é interessante sozinha (sem a marca); o arco prende do gancho à moral.

Além das 4 regras, o Juiz verifica: **voz** (`voice_pass` — passa no `voice_checklist`: "soa como o dono da marca falando?") e **ponte lógica** (`bridge_logical` — camada 8 aterrissa na oferta por lógica, não colada; ponte colada dispara reescrita da ponte, não entrega). Arco incompleto (camadas ausentes ou fora de ordem) entra como item de `diagnosis`.

**Nota de corte por canal.** O `score` (0-10) é comparado ao `approval_threshold` da versão ativa de `guardrails`, com override por canal em `channels.config.cutoff_score` (contrato `ChannelAdapter` expõe `cutoff_score`). Defaults de fábrica (seed por migration — o seed de `04-modelo-de-dados.md` §12.1 usa exatamente estes valores):

| Canal | Nota de corte default |
|---|---|
| `linkedin_post` | 9 |
| `instagram_carousel` | 8 |
| `instagram_post`, `x_post`, `threads_post`, `facebook_post` | 8 |
| `instagram_stories` | 7 |

`verdict = rewrite` sempre que qualquer regra falhar, `voice_pass` ou `bridge_logical` falharem **ou** `score < nota de corte`. A calibração por veredito humano (F4.3) está **ativa desde 2026-08-01**: a saga injeta no prompt do juiz os exemplos recentes de `piece_feedback` com notas (ver §4.5); enquanto o feedback é escasso, a nota de corte conservadora e a aprovação humana obrigatória seguem sendo a rede — o Juiz reduz retrabalho, não substitui o humano (mitigação do risco "qualidade do juiz sem calibração", ver `01-visao-produto.md`).

### 4.4 Loop de reescrita (≤ 2)

Qualquer classe reprovando → estado `rewriting`, `attempt += 1`, e o runner monta um **diagnóstico estruturado consolidado** para o Gerador:

```json
{
  "attempt": 2,
  "failures": [
    { "class": "linter", "violations": [{ "rule": "banned_words", "match": "disruptivo" }] },
    { "class": "grounding", "flagged": [{ "claim": "40% de aumento", "reason": "not_found_in_context" }] },
    { "class": "judge", "diagnosis": [
      "Camada 8: ponte colada na oferta — aterrissar pela consequência lógica da moral, não pelo produto"
    ]}
  ]
}
```

O Gerador reescreve **com o mesmo envelope de altitude + este diagnóstico** (não recebe histórico de conversa — cada tentativa é função pura de novo). A peça reescrita passa pela auditoria completa de novo (lint → grounding → judge). Limite duro: **máximo 2 reescritas** (`attempt ≤ 2`, campo `attempt` em `generation_jobs`). Estourou o limite → a saga **não** falha o job: segue para `adapting` → `awaiting_review` com os chips de auditoria vermelhos e a peça marcada como reprovada pelo motor — **escala para humano** decidir (editar, regenerar guiado ou rejeitar). Isso preserva o princípio "não publica falha" sem jogar trabalho fora.

### 4.5 Flywheel P1 na geração e no julgamento (2026-08-01)

Três features P1 do flywheel ativadas na saga — todas carregadas no preâmbulo do runner (junto com persona/estratégia/guardrails) e **não-fatais** (falha de leitura vira lista vazia, nunca derruba o job):

**F3.8 — Anti-repetição editorial.** A saga lê `editorial_state.state.recent` (provas/temas das últimas peças, cap 12 — 04-modelo-de-dados.md §6.12) e injeta no user prompt do Gerador a seção **"# ANTI-REPETIÇÃO"** com regra **SUAVE**: "prefira prova e ângulo diferentes; repetir prova recente só é aceitável se o contexto não oferecer alternativa equivalente — e mesmo assim, mude o ângulo". Após o `adapting`, o job registra `{proof_claim, proof_item_id, theme (título do ângulo), thesis, used_at}` via RPC **`append_editorial_use`** (migration `202607310017`) — **append atômico** com prepend + cap num único UPDATE: o tone-gate roda 3 sagas em paralelo de propósito, e um upsert de snapshot perdia entradas concorrentes. Exclusões deliberadas: amostras do gate de tom (`timings.sample`) e regenerações (`timings.regenerated_from`) **nem registram nem recebem** a seção — a regeneração é obrigada ao ângulo/prova herdados do briefing; mandar "evite este ângulo" contradiria o próprio job.

**F4.1 — Referências de estilo aprovado.** As 2 peças `approved` mais recentes viram excertos (hook escrito + camadas 4-5, teto 420 chars) na seção **"# REFERÊNCIAS DE ESTILO"** do user prompt do Gerador — calibração de tom, ritmo e altitude com o que o dono já aprovou. Duas decisões de desenho importantes: (a) os refs **NÃO viram `context_item` nem entram em `context_ids`** — peça gerada não pode virar prova auditável de peça nova (circularidade no grounding); (b) os **números são REMOVIDOS** dos excertos (`stripNumbers` → `[valor]`/`[número]`) — número solto copiado de um ref não estaria na proof declarada e viraria apenas `[VERIFICAR]` **não-bloqueante**; sem número no excerto, não há o que copiar: o ref calibra estilo, nunca dado.

**F4.3 — Calibração do juiz por veredito humano.** `loadFeedbackExamples` puxa de `piece_feedback` as 4 rejeições + 2 aprovações mais recentes **com notas** (excerto = hook escrito ou idea da peça, verdict + nota) e preenche o `feedback_examples` do prompt do Juiz — a seção já existia no prompt desde o MVP; agora é alimentada. Rejeições pesam mais (ensinam o que reprova); as aprovações ancoram o "bom desta marca".

---

## 5. RAG do Conteúdo de Contexto

O módulo Conteúdo de Contexto (`/contexto`, tabelas `context_items` + `context_chunks`) é a memória da marca: transcrições, postagens, documentos, referências, cases e catálogo de oferta. O RAG serve dois consumidores: a saga (estado `retrieving`) e a busca da UI.

### 5.1 Ingestão (`ingest-context`)

Disparada após upload/cadastro de um `context_item` (e reprocessável). Pipeline:

1. **Limpeza** — extração de texto (arquivo em `context-files` via signed URL, texto colado ou URL), strip de HTML/boilerplate, normalização de whitespace. `status = 'processing'`.
2. **Chunking** — (proposta — validar) janelas de ~800-1200 caracteres com overlap de ~150, quebrando preferencialmente em fronteiras de parágrafo/sentença; itens `kind = 'case'` e `kind = 'offer'` são curtos e viram tipicamente 1 chunk + metadata íntegra.
3. **Embeddings** — via papel `embeddings` do provider (default gateway: `google/gemini-embedding-001`), gravados em `context_chunks.embedding vector(768)` com index ivfflat/hnsw.
4. **FTS** — a coluna gerada `search tsvector` (portuguese) em `context_items` é mantida pelo próprio Postgres.
5. `status = 'ready'` (ou `'error'` com detalhe para a UI de `/contexto`).

**Atenção à dimensão:** `vector(768)` é a dimensão do modelo do gateway. Trocar o modelo de embeddings em `/config/ia` exige **re-ingestão completa** (re-embedding de todos os chunks) e, se a dimensão mudar, migração da coluna. Recomendação do motor: manter embeddings no gateway mesmo com BYO keys para gerador/juiz (proposta — validar).

### 5.2 Busca híbrida

Implementada como função SQL (RPC) chamada pelo Retrieval: `match_context_chunks` (definida no DDL de `04-modelo-de-dados.md`):

- **Semântica:** cosine similarity pgvector entre o embedding da query e `context_chunks.embedding`.
- **Léxica:** `ts_rank` sobre `context_items.search` (tsvector portuguese) com a query em `websearch_to_tsquery('portuguese', …)`.
- **Filtros:** `kind` (enum `context_kind`) e `tags` (overlap de array), vindos de `classification.context_filters` ou dos filtros da UI.
- **Fusão:** (proposta — validar a técnica com o golden set) Reciprocal Rank Fusion (RRF) entre os dois rankings, k=60, retornando top-N (`match_count`, default **12** chunks) com dedupe por `item_id`.

Apenas itens `status = 'ready'` participam. O resultado da saga é persistido em `generation_jobs.context_ids` — é esse conjunto (e só ele) que o Gerador vê e contra o qual o grounding diffa.

### 5.3 Ranking de cases por força de prova

Itens `kind = 'case'` têm metadata tipada: `metric_type` (`brl|multiple|percent`), `metric_value`, `client_name`, `sector`, `quote`, `source_url`, `objection_tags[]`, `citation_policy` (`named|anonymous`). Quando a query pede prova (todo briefing de geração pede), o Retrieval aplica um boost determinístico sobre o score híbrido:

| Critério | Efeito no ranking |
|---|---|
| `metric_type = 'brl'` (R$ absoluto) | Boost máximo — dinheiro é a prova mais forte |
| `metric_type = 'multiple'` (2x, 5x) | Boost intermediário |
| `metric_type = 'percent'` | Boost menor |
| `sector` compatível com o tema/ICP do briefing | Boost aditivo (proposta — validar) |
| `objection_tags[]` interceptando o ângulo escolhido | Boost aditivo (proposta — validar) |

O case top-ranqueado vira a **prova central** da peça (regra "1 prova por peça"). Anti-repetição de provas/temas entre peças consecutivas (`editorial_state`, F3.8) está **ativa desde 2026-08-01** como regra suave no prompt do Gerador (ver §4.5) — o ranking híbrido + escolha de ângulo seguem sendo a primeira fonte de variação.

### 5.4 Pesquisa web reativa (etapa `researching`, 2026-07-31)

Complemento do RAG para pautas que pedem informação **fresca** da internet: a etapa `researching` da saga (entre `retrieving` e `generating`) busca na web sobre a pauta e injeta o resultado no mesmo trilho do contexto interno. Módulo: `_shared/web-search.ts`; contratos em 07-contratos-backend.md §3.1 (request `web_search`) e §2 (shape `WebResearch`).

**Não confundir com o radar F2.12.** Isto é pesquisa **reativa**, disparada job a job pelo comando do usuário (toggle "Pesquisa web" em `/criar` → `generate-content {web_search: true}` → `generation_jobs.web_research.requested = true`). O radar de pautas/motor de ideias proativo (F2.12) segue **P2**, e a decisão "sem tabelas de sinais (`idea_signals`) no schema" segue de pé — a feature não criou tabela nova.

**Drivers (4) e resolução.** Config em `app_settings.web_search` — `{enabled, provider: 'auto' | 'tavily' | 'firecrawl' | 'anthropic' | 'openai' | 'off', max_results (1-10, default 5), models?: {anthropic?, openai?}}`:

| Driver | Mecanismo | Key (Vault) | Quando |
|---|---|---|---|
| `tavily` | Tavily Search API (search dedicada) | `TAVILY_API_KEY` (`tvly-`) | **Caminho default da instância só-gateway** — o Lovable AI Gateway NÃO expõe web search/grounding (verificado nas docs do Lovable) |
| `firecrawl` | Firecrawl `/search` com scrape em markdown (2026-07-31) | `FIRECRAWL_API_KEY` (`fc-`) | Busca + **conteúdo integral** das páginas — mais texto literal para o grounding verificar, em troca de mais latência/custo por busca |
| `anthropic` | server tool `web_search_20250305` da API Anthropic (modelo leve conduz o loop de busca) | `ANTHROPIC_API_KEY` (BYO) | Caminho nativo com key BYO Anthropic |
| `openai` | Responses API com tool `web_search` | `OPENAI_API_KEY` (BYO) | Caminho nativo com key BYO OpenAI |

`provider: 'auto'` resolve pela **primeira key presente no Vault** na ordem `tavily → firecrawl → anthropic → openai` (search APIs dedicadas primeiro — baratas e previsíveis; tavily é a mais rápida, firecrawl traz conteúdo integral); provider forçado exige a key correspondente. Timeout duro de **90 s** por chamada de provedor — a saga não fica presa na busca.

**Digest e materialização (altitude e grounding preservados).** O retorno é um digest textual — trechos **literais** + URL por fonte (+ resumo, nos drivers LLM), teto ~6.000 chars — que a saga materializa como `context_item` (kind `reference`, tags `['pesquisa-web']`, `metadata.web_research = {job_id, provider, query, sources, searched_at}`) pelo mesmo pipeline do `ingest-context` (limpeza → chunking → embeddings; **falha de embedding não bloqueia** — a perna FTS da busca híbrida cobre) e appenda em `generation_jobs.context_ids`. Consequência de arquitetura: o conteúdo web entra no Gerador como **"contexto selecionado"** (regra de altitude, §1.2 — nenhum canal lateral de prompt) e números da web viram **prova auditável pelo grounding** (§4.2) em vez de `[VERIFICAR]`. Snippets entram verbatim justamente porque trecho literal é o que o grounding consegue verificar. `generation_jobs.web_research` (shape `WebResearch`) é o **registro** da etapa para UI/timeline — a fonte do conteúdo é o `context_item`.

**Degradação graciosa e retomada.** Falha ou indisponibilidade **nunca derruba o job**: sem provedor resolvível → `web_research.skipped = 'unavailable'`; erro do provedor (timeout, HTTP, resposta vazia) → `skipped = 'error'` + `error`, e a geração segue só com o acervo interno (mesmo padrão do filtro de retrieval, §2.5). Retomada é idempotente: digest já materializado (`web_research.item_id` com item `ready`) é **reusado**, sem nova busca. `regenerate-piece` herda o `requested` do job original e faz busca **nova** (não reusa o digest — informação fresca é parte do ponto).

---

## 6. Abstração de provider

### 6.1 Interface (`supabase/functions/_shared/llm.ts`)

Lib compartilhada com interface única. Nenhuma edge function fala com API externa diretamente: `llm.ts` (LLM, embeddings, imagem) e `web-search.ts` (pesquisa web reativa, §5.4) são os **dois únicos módulos autorizados** a sair da instância — todo o resto passa por eles:

```ts
// supabase/functions/_shared/llm.ts
export type RoleHint = 'router' | 'generator' | 'judge' | 'voice_extractor' | 'embeddings' | 'image';

export interface ChatParams {
  role_hint: RoleHint;              // resolve provider+modelo via app_settings
  messages: ChatMessage[];          // system + user (+ diagnóstico em reescrita)
  schema?: Record<string, unknown>; // JSON Schema → structured output do driver
  stream?: boolean;
}

export interface ChatResult {
  content: string;                  // texto ou JSON string validada contra schema
  parsed?: unknown;                 // objeto quando schema foi passado
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  provider: 'lovable-gateway' | 'anthropic' | 'openai';
  model: string;
}

export async function chat(params: ChatParams): Promise<ChatResult>;
export async function embed(texts: string[]): Promise<number[][]>;   // papel embeddings
export async function image(brief: string): Promise<{ path: string }>; // papel image (usado por generate-image)
```

Responsabilidades do `llm.ts`: resolver `{provider, model}` a partir de `role_hint` + `app_settings`; ler keys BYO do Supabase Vault (via service role — nunca no client bundle, nunca em tabela plaintext; escrita só pelo admin via `store-secret`); normalizar structured output (nativo em cada driver); normalizar `usage` para a telemetria (§9); mapear erros (402 do gateway → erro amigável "créditos do workspace esgotados", 429 → retry com backoff).

### 6.2 Os três drivers

| Driver | Ativação | Auth | Observações |
|---|---|---|---|
| `lovable-gateway` | **DEFAULT, zero-config** | `LOVABLE_API_KEY` automática nas edge functions | Billing em créditos Lovable do workspace da instância (grant mensal + créditos gerais; 402 quando esgota). Streaming suportado. |
| `anthropic` | BYO key (onboarding passo 2 ou `/config/ia`) | Key no Vault | **Recomendado para Gerador e Juiz.** Prompt caching (§7) e structured outputs via `output_config.format`. Juiz nunca na mesma chamada do Gerador. |
| `openai` | BYO key, opcional | Key no Vault | Paridade de interface; modelos a configurar em `/config/ia`. |

### 6.3 Seleção por papel em `app_settings`

A seleção é **por papel** (roteador, gerador, juiz, embeddings, imagem), editável em `/config/ia` (admin). Formato (key/value jsonb em `app_settings`):

```json
{
  "key": "ai_providers",
  "value": {
    "router":     { "driver": "lovable-gateway", "model": "google/gemini-2.5-flash" },
    "generator":  { "driver": "anthropic",       "model": "claude-sonnet-5" },
    "judge":      { "driver": "anthropic",       "model": "claude-sonnet-5" },
    "voice_extractor": { "driver": "anthropic",  "model": "claude-sonnet-5" },
    "embeddings": { "driver": "lovable-gateway", "model": "google/gemini-embedding-001" },
    "image":      { "driver": "lovable-gateway", "model": "google/gemini-2.5-flash-image" }
  }
}
```

`voice_extractor` herda a configuração do `generator` quando não definido explicitamente (fallback em runtime no `llm.ts`). Misturar drivers por papel é suportado e esperado — ex.: roteador barato no gateway + gerador/juiz na Anthropic BYO.

### 6.4 Modelos default por papel e driver

IDs do gateway **verificados contra o próprio gateway em 2026-07-30** (a família é `gemini-2.5`,
não `3.5` — os nomes comerciais dos docs da Lovable, tipo "Gemini 3.6 Flash", NÃO são os IDs de
API). Se um ID for recusado, o gateway devolve `400` com a allowlist completa no corpo do erro —
é a forma mais rápida de redescobrir a lista. IDs e preços Anthropic são os atuais
(USD por MTok input/output).

| Papel | `lovable-gateway` (default) | `anthropic` (BYO, recomendado p/ gerador+juiz) | `openai` (BYO, opcional) |
|---|---|---|---|
| Roteador / classificação | `google/gemini-2.5-flash` *(verificado)* | `claude-haiku-4-5` — $1 / $5 | modelo leve GPT-5.x *(proposta — validar)* |
| Gerador | `google/gemini-2.5-pro` *(verificado)* | `claude-sonnet-5` — $3 / $15 *(intro $2 / $10 até 2026-08-31)* | modelo forte GPT-5.x *(proposta — validar)* |
| Juiz (chamada separada) | `google/gemini-2.5-pro` *(verificado)* | `claude-sonnet-5` — $3 / $15 | idem *(proposta — validar)* |
| Peças-âncora (opcional) | — | `claude-opus-5` — $5 / $25 | — |
| Extrator de Voz | `google/gemini-2.5-pro` *(verificado)* | `claude-sonnet-5` | idem *(proposta — validar)* |
| Embeddings | `google/gemini-embedding-001` (768d, default) | — (mantém gateway) | `text-embedding-3` *(indicativo)* |
| Imagem | `google/gemini-2.5-flash-image` (default do gateway) | — | — |

Lembrete do motor: o estilo tweet-card usa **render determinístico client-side**, não modelo de imagem — o papel `image` só é acionado por `generate-image` quando a peça pede foto/arte a partir do `image_brief`. Isso inclui o batch de fotos por slide do carrossel (`generate-image` scope `'slides'`, 07 §3.5): a **direção de arte** do deck (style bible + brief por slide, em UMA chamada) usa o papel `generator` e as fotos usam o papel `image` — tudo sob demanda, dentro de `generate-image`, nunca na saga.

---

## 7. Prompt caching (driver `anthropic`)

O driver `anthropic` usa prompt caching para reduzir drasticamente o custo de input do Gerador e do Juiz, explorando o fato de que o prefixo do prompt é estável entre gerações da mesma instância.

**Layout do prompt (ordem importa — cache é prefix-match):**

```text
┌──────────────────────────────────────────────────────────────┐
│ PREFIXO ESTÁVEL (cache_control: ephemeral no último bloco)   │
│ 1. Prompts do motor (_shared/prompts/, versionados com       │
│    ENGINE_VERSION): funil de 8 camadas, formato de saída,    │
│    regras duras de grounding                                 │
│ 2. Persona ativa compilada (brand_persona.content, 9 seções) │
│ 3. Guardrails ativos compilados (ban list, dosagem, rubrica) │
├──────────────────────────────────────────────────────────────┤
│ SUFIXO VARIÁVEL (nunca cacheado)                             │
│ 4. Briefing (classification + selected_angle)                │
│ 5. Contexto RAG (chunks + case selecionado)                  │
│ 6. Comando do usuário / diagnóstico de reescrita             │
└──────────────────────────────────────────────────────────────┘
```

Regras de implementação no driver:

- `cache_control: {type: "ephemeral"}` no **último bloco do prefixo estável** (guardrails compilados). TTL default de 5 min cobre bem a saga (gerador → juiz → reescritas usam o mesmo prefixo em minutos). Economia: escrita de cache custa 1,25× o input; leitura ~0,1× — a partir da segunda chamada com o mesmo prefixo (o Juiz reaproveita parte, e reescritas reaproveitam tudo do Gerador), o input do prefixo cai ~90%.
- **Serialização determinística**: persona/guardrails compilados com chaves ordenadas, sem timestamps, sem UUIDs — qualquer byte diferente no prefixo invalida o cache silenciosamente. Verificação: `usage.cache_read_input_tokens` persistido na telemetria (§9); zero recorrente = invalidador silencioso.
- Mínimo cacheável do `claude-sonnet-5` é 1024 tokens de prefixo — o bundle motor+persona+guardrails de uma instância configurada fica confortavelmente acima disso (proposta — validar com a persona média real).
- **Invalidação esperada e correta:** ativar uma **nova versão** de `brand_persona` ou `guardrails` (fluxo draft → ativar em `/marca/*`) muda o prefixo → a primeira geração seguinte paga cache frio e re-escreve o cache. O mesmo vale para bump de `ENGINE_VERSION` (update do template, ver `08-estrategia-template.md`). Isso é aceitável: versões mudam raramente; comandos mudam sempre — por isso ficam no sufixo.
- Gerador e Juiz compartilham os blocos 1-3? **Parcialmente**: o Juiz tem prompt de sistema próprio (rubrica), então mantém **seu próprio prefixo cacheado** (rubrica + persona + guardrails). Dois caches quentes por instância, ambos estáveis (proposta — validar granularidade na implementação).
- Drivers `lovable-gateway`/`openai`: sem gestão explícita de cache no MVP (o gateway pode cachear internamente; não contamos com isso no custo).

---

## 8. Custo estimado por peça

Ordem de grandeza para dimensionar preço e monitorar drift — **não** é SLA. Premissas explícitas:

- 1 job = 1 `core_content` (adapters são código, não geram custo de token) distribuído para N canais;
- Roteador: ~2.000 tokens in / ~400 out. Gerador: ~9.000 in (≈6.000 de prefixo cacheável + 3.000 de briefing/contexto) / ~1.800 out. Juiz: ~7.000 in / ~900 out;
- Embeddings de query: desprezível (<1% do total). Imagem IA (`generate-image`) fora da conta — é sob demanda;
- "Caminho feliz" = 0 reescritas; "pior caso" = 2 reescritas (3× gerador + 3× juiz).

**Driver `anthropic`** (preço cheio Sonnet 5 $3/$15; Haiku 4.5 $1/$5):

| Cenário | Sem cache | Com cache quente |
|---|---|---|
| Roteador (Haiku 4.5) | ~US$ 0,004 | ~US$ 0,004 |
| Gerador (Sonnet 5) | ~US$ 0,054 | ~US$ 0,038 |
| Juiz (Sonnet 5) | ~US$ 0,035 | ~US$ 0,022 |
| **Peça, caminho feliz** | **~US$ 0,09** | **~US$ 0,06** |
| **Peça, pior caso (2 reescritas)** | **~US$ 0,27** | **~US$ 0,17** |

Com o preço introdutório do Sonnet 5 ($2/$10 até 2026-08-31), tudo cai ~⅓. Peça-âncora com `claude-opus-5` no Gerador+Juiz: ~1,7× o valor de tabela (≈ US$ 0,10-0,45). Gate de tom (3 peças-amostra): ~3× o custo de uma peça.

**Driver `lovable-gateway`:** cobrado em **créditos Lovable** do workspace da instância (grant mensal + créditos gerais), não em USD direto. Com Gemini Flash no roteador e Gemini Pro no gerador/juiz, o custo por token tende a ficar na mesma ordem de grandeza ou abaixo do cenário Anthropic (proposta — validar a conversão exata créditos↔tokens na implementação e publicar no runbook). Comportamento em esgotamento: gateway retorna **402** → job vai a `failed` com `error` claro; o uso fica exposto em `/config` (mitigação do risco de custo, ver brief §13). BYO key transfere o custo direto para o cliente.

**Driver `openai`:** depende do modelo escolhido em `/config/ia`; mesma ordem de grandeza (proposta — validar quando os modelos default forem fixados).

Conclusão de dimensionamento: **uma peça multi-canal custa centavos de dólar (US$ 0,05-0,30)** — o custo de LLM não é o driver econômico do produto; o gargalo de valor é aprovação sem edição, não token.

---

## 9. Telemetria de uso

Todo consumo de LLM é registrado **por job** em `generation_jobs.timings` (jsonb), alimentado pelo `usage` normalizado que o `llm.ts` devolve em cada chamada. Estrutura (proposta — validar campos exatos):

```json
{
  "classifying": {
    "started_at": "2026-07-29T14:03:11Z", "ended_at": "2026-07-29T14:03:14Z",
    "driver": "anthropic", "model": "claude-haiku-4-5",
    "input_tokens": 1980, "output_tokens": 412,
    "cache_read_input_tokens": 0, "cost_usd_est": 0.004
  },
  "retrieving": { "started_at": "…", "ended_at": "…", "embedding_tokens": 96, "chunks_returned": 8 },
  "generating": {
    "attempts": [
      { "attempt": 0, "driver": "anthropic", "model": "claude-sonnet-5",
        "input_tokens": 9120, "output_tokens": 1770,
        "cache_read_input_tokens": 6030, "cost_usd_est": 0.036 }
    ]
  },
  "linting":  { "duration_ms": 12, "violations": 0 },
  "grounding":{ "duration_ms": 40, "flagged": 1 },
  "judging":  { "attempts": [ { "attempt": 0, "model": "claude-sonnet-5", "input_tokens": 7050, "output_tokens": 880, "score": 8.5, "cost_usd_est": 0.022 } ] },
  "totals": { "input_tokens": 18150, "output_tokens": 3062, "cost_usd_est": 0.062, "attempts": 1, "wall_ms": 41200 }
}
```

Regras:

- O runner grava o bloco do estado **ao concluir cada estado** (mesmo update que muda `status` — o Realtime da UI de `/criar` pega os dois juntos e mostra progresso + consumo ao vivo).
- `cost_usd_est` é calculado pelo driver com a tabela de preços do modelo (para `lovable-gateway`, registrar tokens e deixar `cost_usd_est` nulo ou em créditos — proposta — validar).
- `cache_read_input_tokens` persistido por chamada é o instrumento de auditoria do §7: zero recorrente com prefixo teoricamente estável = invalidador silencioso a caçar.
- Agregações (uso por dia, por papel, por provider) são consultas sobre `timings` exibidas em `/config/ia` e `/config/instancia` (admin) — sem tabela nova no MVP. Se o volume justificar, materializar em P1 (proposta — validar).
- Jobs `failed` por 402 registram o estado em que morreram + `error` — é o insumo do alerta "créditos esgotando" no `/config`.

---

*Documentos relacionados: `04-modelo-de-dados.md` (schema das tabelas citadas), `07-contratos-backend.md` (edge functions e saga), `05-rotas-e-modulos.md` (telas que consomem o pipeline), `08-estrategia-template.md` (ENGINE_VERSION e updates do motor), `09-plano-implementacao.md` (F2 — Motor de geração).*
