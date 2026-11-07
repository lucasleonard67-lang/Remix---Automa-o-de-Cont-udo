# Contratos de Backend (Edge Functions)

Este documento especifica os contratos de TODAS as edge functions do Content Engine: método, autenticação, request/response tipados, erros, efeitos no banco e observações de implementação. Cobre também a estrutura de pastas de `supabase/functions/`, o contrato `ChannelAdapter` dos 7 formatos, a gestão de segredos, CORS e a estratégia de deploy. O modelo de dados referenciado aqui está em 04-modelo-de-dados.md; as rotas que consomem essas funções em 05-rotas-e-modulos.md; os papéis de IA e a abstração de provider em 06-arquitetura-ia.md; a ordem de construção em 09-plano-implementacao.md.

---

## 1. Princípios

1. **Backend 100% Supabase Edge Functions** (decisão do dono do produto). Toda lógica de negócio vive em edge functions. Server functions do TanStack são permitidas **apenas para SSR trivial de página** — nunca para lógica de negócio, nunca para chamar LLM, nunca para escrever no banco em nome do usuário.
2. **`verify_jwt = true` em todas as funções**, sem exceção no MVP. O gateway do Supabase rejeita chamadas sem JWT válido antes do código executar. O frontend invoca via `supabase.functions.invoke`, que anexa o token da sessão automaticamente.
3. **Checagem de role dentro da função onde indicado.** `verify_jwt` garante apenas "usuário autenticado". As funções marcadas como **admin** (`invite-user`, `store-secret`) revalidam o papel consultando `user_roles` com o client service role (mesmo predicado da função SQL `has_role()` — ver 04-modelo-de-dados.md). Guard de rota no frontend é UX, não segurança.
4. **Jobs longos = resposta rápida + processamento em background.** Funções que disparam a saga de geração respondem em poucos segundos com o `job_id` e continuam o trabalho com `EdgeRuntime.waitUntil(...)`. O frontend acompanha por **Realtime** nas tabelas `generation_jobs` e `content_pieces` — nenhum polling HTTP.
5. **Watchdog via pg_cron.** Um job de `pg_cron` re-invoca `resume-job` para jobs travados (sem update há mais de N minutos em estado de processamento). A saga é retomável a partir de qualquer estado persistido — cada etapa grava o status em `generation_jobs.status` antes de prosseguir (checkpoint).
6. **Idempotência e single-tenant.** Não existe `tenant_id` em lugar nenhum: cada instância tem seu próprio Supabase (ver 08-estrategia-template.md). Funções de reprocessamento (`ingest-context`, `resume-job`) são idempotentes: reprocessar substitui o resultado anterior, nunca duplica.
7. **Erros padronizados.** Toda função retorna erro no envelope único abaixo, com HTTP status semanticamente correto, para o frontend tratar de forma uniforme.

```ts
// Envelope de erro comum a todas as funções (proposta — validar)
type ErrorResponse = {
  error: {
    code: string;        // ex.: 'invalid_input', 'not_found', 'forbidden', 'credits_exhausted'
    message: string;     // mensagem legível, em pt-BR, segura para exibir na UI
    details?: unknown;   // payload opcional (ex.: violações de validação)
  };
};
```

| HTTP | code (típico) | Quando |
|---|---|---|
| 400 | `invalid_input` | Body malformado, campo obrigatório ausente |
| 401 | `unauthorized` | JWT ausente/inválido (rejeitado pelo gateway antes do código) |
| 402 | `credits_exhausted` | Créditos do Lovable AI Gateway esgotados (repassar 402 do gateway) |
| 403 | `forbidden` | Usuário autenticado sem papel exigido (admin) |
| 404 | `not_found` | Recurso inexistente (job, peça, item de contexto) |
| 409 | `invalid_state` | Operação incompatível com o estado atual (ex.: resume de job `done`) |
| 429 | `rate_limited` | Rate limit do provider de IA (repassar retry-after quando houver) |
| 500 | `internal_error` | Falha inesperada |
| 502 | `provider_error` | Erro do provider de IA (BYO ou gateway) não recuperável |

---

## 2. Tipos compartilhados

Tipos usados pelos contratos abaixo. Vivem em `supabase/functions/_shared/types.ts` e são espelhados no frontend (`src/lib/engine-types.ts` (proposta — validar)). Shapes de jsonb marcados como proposta seguem exatamente os campos nomeados no brief; a estrutura interna fina é derivação conservadora.

```ts
// Canais — valores idênticos ao enum channel_type do banco
export type ChannelType =
  | 'instagram_stories'
  | 'instagram_carousel'
  | 'instagram_post'
  | 'x_post'
  | 'threads_post'
  | 'linkedin_post'
  | 'facebook_post';

// Estados do job — idênticos ao enum job_status do banco
// ('researching' adicionado pela migration 202607310015 — pesquisa web reativa)
export type JobStatus =
  | 'created' | 'classifying' | 'awaiting_angle' | 'retrieving' | 'researching'
  | 'generating' | 'linting' | 'grounding' | 'judging' | 'rewriting'
  | 'adapting' | 'awaiting_review' | 'done' | 'failed' | 'cancelled';

// Tipos de item de contexto — valores idênticos ao enum context_kind do banco
export type ContextKind =
  | 'transcript' | 'post' | 'document' | 'reference' | 'case' | 'offer';

// Saída do Roteador (generation_jobs.classification)
export type AngleOption = { id: string; title: string; hook: string; rationale?: string };

export type Classification = {
  format: string | null;           // null = ambíguo
  channel_types: ChannelType[];    // canais alvo inferidos ou pedidos
  thesis: string | null;           // tese da marca que a peça sustenta
  angles: AngleOption[];           // 3-4 opções quando needs_angle_choice
  context_query: string;           // query para o retrieval
  context_filters?: { kinds?: ContextKind[]; tags?: string[] };
  needs_angle_choice: boolean;     // ÚNICO gatilho do estado awaiting_angle
};

// Pesquisa web reativa (generation_jobs.web_research) — REGISTRO da etapa `researching`
// (06-arquitetura-ia.md §5.4). A fonte do conteúdo é o context_item materializado.
export type WebSearchProvider = 'tavily' | 'firecrawl' | 'anthropic' | 'openai';

export type WebResearchSource = {
  url: string;
  title: string;
  snippet?: string;                // trecho literal retornado pelo provedor
  published?: string;              // data de publicação, quando o provedor informa
};

export type WebResearch = {
  requested: boolean;              // o usuário pediu pesquisa web neste job
  provider?: WebSearchProvider;    // driver efetivamente usado
  query?: string;                  // query enviada ao provedor
  item_id?: string;                // context_item materializado com o digest
  sources?: WebResearchSource[];
  searched_at?: string;
  skipped?: 'unavailable' | 'error';  // etapa pulada sem matar o job (degradação graciosa)
  error?: string;                  // detalhe quando skipped = 'error'
};

// Núcleo gerado pelo Gerador (content_pieces.core_content)
export type CoreContent = {
  idea: string;
  hook: { visual: string; written: string; spoken?: string };
  funnel_blocks: { layer: number; name: string; content: string }[];  // camadas 1-8 do funil narrativo
  proof: { claim: string; context_item_id: string | null; source_url?: string };
  verify_flags: string[];          // pendências marcadas [VERIFICAR: ...]
  cta: string;
  image_brief: string | null;      // brief para imagem IA, quando o formato pedir
};
// O grounding exige proof.context_item_id ∈ generation_jobs.context_ids;
// se null, a claim numérica vira flag em verify_flags.

// Resultado de auditoria (content_pieces.audit) — vira "chips" na UI da Biblioteca
export type Audit = {
  linter: {
    passed: boolean;
    violations: { rule: string; match: string; position?: number; severity: 'error' | 'warn' }[];
  };
  grounding: {
    passed: boolean;
    checked: { claim: string; source_item_id: string | null; status: 'ok' | 'divergent' | 'missing' }[];
    flagged: { claim: string; reason: string; replaced_with?: string }[];
  };
  judge: {
    verdict: 'approve' | 'rewrite';
    score: number;                 // 0-10, comparado ao cutoff_score do canal
    rules: { rule: 'novidade' | 'aplicabilidade' | 'proprietario' | 'narrativa'; passed: boolean; note?: string }[];
    voice_pass: boolean;
    bridge_logical: boolean;
    diagnosis: string[];           // alimenta a reescrita
  };
};
```

---

## 3. Contratos das funções

Convenções desta seção: todas as funções são **POST**, JSON in/JSON out, `verify_jwt = true`. "Auth: autenticado" = qualquer usuário com sessão (`admin` ou `user`); "Auth: admin" = checagem de `user_roles` dentro da função. Nomes de tabela/coluna vêm de 04-modelo-de-dados.md.

### 3.1 `generate-content`

Ponto de entrada padrão da geração por comando livre (rota `/criar` — ver 05-rotas-e-modulos.md).

| | |
|---|---|
| Método | POST |
| Auth | autenticado (`admin` ou `user`) |
| Duração | resposta rápida (classificação síncrona com modelo rápido); saga em background |

```ts
// Request
interface GenerateContentRequest {
  prompt: string;                  // comando livre do usuário, não-vazio
  channel_types?: ChannelType[];   // opcional: restringe canais alvo; default = canais enabled
  web_search?: boolean;            // true liga a etapa `researching` (pesquisa web reativa — 06 §5.4)
}

// Response (200) — sempre a mesma forma: a classificação roda em background
interface GenerateContentResponse {
  job_id: string;
  status: 'classifying';
}
```

**Fluxo interno:**
1. Valida o prompt e os canais (`channel_types` ⊆ canais com `enabled = true` em `channels`).
2. `INSERT` em `generation_jobs` com `status = 'created'`, `prompt`, `created_by`.
3. Responde **imediatamente** `{job_id, status: 'classifying'}` e roda a saga inteira dentro de `EdgeRuntime.waitUntil`, a partir da etapa `classifying`.
4. O **Roteador** grava `classification`. Se `needs_angle_choice === true`, o job para em `status = 'awaiting_angle'` e o frontend recebe as opções **por Realtime** (lendo `generation_jobs.classification.angles`), continuando via `resume-job`.
5. Se `needs_angle_choice === false`, o primeiro ângulo é auto-selecionado e a saga segue até `awaiting_review`.
6. `web_search === true` grava `web_research: {requested: true}` no INSERT do job; a saga executa a etapa `researching` entre `retrieving` e `generating` (materializa o digest como `context_item` e o appenda em `context_ids` — 06-arquitetura-ia.md §5.4). Indisponibilidade (sem key) ou falha do provedor **nunca** falha o job: a etapa registra `web_research.skipped = 'unavailable' | 'error'` e a geração segue sem pesquisa.

> **Nota de arquitetura (2026-07-30):** a versão anterior deste contrato previa classificação
> *síncrona* com resposta em união discriminada (`awaiting_angle` com `angles` no corpo). A
> implementação classifica em background — o que dá retomada de graça para jobs travados em
> `classifying` (watchdog) e mantém a resposta abaixo do timeout do gateway. O caminho de
> escolha de ângulo passou a ser Realtime, que a UI de `/criar` já consome.

**Erros:** 400 (`invalid_input`: prompt vazio/acima do limite), 402 (`credits_exhausted` na classificação), 409 (`invalid_state`: nenhum canal habilitado — orientar a ativar em `/marca/canais`), 429, 500/502.

**Efeitos no banco:** insere 1 linha em `generation_jobs`; atualiza `status`, `classification`, `timings`, `web_research` (e, com pesquisa, 1 `context_item` + chunks). Nenhuma `content_pieces` ainda (a saga cria em `adapting → awaiting_review`).

**Observações de implementação:**
- Onboarding mínimo viável (passos 3-4-5-6) precisa estar completo; caso contrário retornar 409 `invalid_state` com mensagem orientando o wizard (o guard de rota já previne isso, mas a função revalida lendo o progresso em `app_settings`).
- `timings` recebe telemetria por etapa no shape canônico de 06-arquitetura-ia.md §9 — ex.: `{classifying: {started_at, ended_at, ms, provider?, model?, input_tokens?, output_tokens?, cost_usd_est?, attempts?}, …, totals: {…}}` — para diagnóstico em `/config/instancia`.
- A classificação síncrona usa o modelo rápido do driver ativo (gateway: `google/gemini-2.5-flash` — ID verificado contra o gateway em 2026-07-30; BYO Anthropic: `claude-haiku-4-5`).

### 3.2 `resume-job`

Continua a saga do estado atual. Três chamadores: (a) o frontend, após a escolha de ângulo; (b) o **watchdog pg_cron**, para jobs travados; (c) uso operacional/diagnóstico.

| | |
|---|---|
| Método | POST |
| Auth | autenticado; o watchdog invoca com o JWT do service role (passa no `verify_jwt`) |
| Duração | resposta rápida; saga em background |

```ts
// Request
interface ResumeJobRequest {
  job_id: string;
  selected_angle?: AngleOption;    // obrigatório quando o job está em 'awaiting_angle'
}

// Response (200)
interface ResumeJobResponse {
  job_id: string;
  status: JobStatus;               // estado para o qual a saga avançou ao retomar
}
```

**Fluxo interno:**
1. Carrega o job; valida estado retomável. Estados **terminais** (`done`, `failed`, `cancelled`) → 409. `awaiting_review` → 409 (a revisão é humana, na Biblioteca). `awaiting_angle` sem `selected_angle` → 400.
2. Se veio `selected_angle`: grava em `generation_jobs.selected_angle`.
3. Retoma a saga (§4) **a partir do checkpoint** (`status` atual), em `EdgeRuntime.waitUntil`, e responde.

**Erros:** 400 (`invalid_input`: `selected_angle` ausente em `awaiting_angle`), 403 (`forbidden`: job de outro usuário e chamador não é admin nem service role (proposta — validar)), 404, 409 (`invalid_state`).

**Efeitos no banco:** atualiza `selected_angle`, `status`, `attempt`, `timings`, `error` de `generation_jobs`; ao final da saga, insere `content_pieces`.

**Observações de implementação:**
- **Idempotência por etapa**: cada etapa da saga é segura para re-execução (retrieval regrava `context_ids`; generate/adapt sobrescrevem artefatos da tentativa corrente). O watchdog pode re-invocar sem risco de duplicar peças.
- O watchdog chama via `pg_net` com header `Authorization: Bearer <service_role>` armazenado no Vault (ver §7 e §9). Nunca hardcoded na definição do cron.

### 3.3 `extract-voice`

Extração assistida de voz (onboarding passo 4 `voz`): a partir de um corpus de itens do Conteúdo de Contexto, produz o **rascunho** das 9 seções do contrato de voz. O humano aceita/edita; a gravação em `brand_persona` acontece pelo CRUD normal da tela — esta função **não escreve** a persona.

| | |
|---|---|
| Método | POST |
| Auth | autenticado (rota consumidora `/onboarding` é guarded admin; checagem de admin dentro da função é (proposta — validar)) |
| Duração | síncrona (corpus limitado; frontend exibe progresso/loading) |

```ts
// Request
interface ExtractVoiceRequest {
  context_item_ids: string[];      // itens do corpus; mínimo 1, máximo 20 (proposta — validar)
}

// Response (200)
interface ExtractVoiceResponse {
  draft: PersonaContent;           // rascunho das 9 seções — NADA é persistido
}

// As 9 seções do contrato de voz (schema canônico em 04-modelo-de-dados.md §8.1)
type PersonaContent = {
  identity: { name: string; role: string; positioning: string; audience: string };
  credenciais: { claim: string; source: string }[];   // sempre com fonte
  worldview: { summary: string; theses: string[] };   // teses alinhadas a brand_strategy
  tone_principles: string[];
  signature_lexicon: { term: string; usage: string; max_per_piece: number }[]; // dosagem máx 1-2 por peça
  calibration_heuristics: string[];
  banlist: { ref: 'guardrails' };                      // referência à fonte única em guardrails
  opinioes: { topic: string; stance: string }[];
  voice_checklist: string[];
  reference_examples: {
    good: { text: string; why: string }[];
    bad: { text: string; why: string }[];
  };
};
```

**Erros:** 400 (lista vazia/acima do limite), 404 (item inexistente), 409 (`invalid_state`: item com `status != 'ready'`), 402, 429, 502.

**Efeitos no banco:** somente leitura (`context_items`, `context_chunks`). Zero escrita.

**Observações de implementação:**
- Usa o papel **Extrator de Voz** (ver 06-arquitetura-ia.md) com structured output validado contra o schema das 9 seções.
- `banlist` no rascunho é sempre a referência `{ref: 'guardrails'}` — a fonte única de ban list é `guardrails` (nunca duplicar conteúdo na persona).
- Sem corpus (cliente novo, zero material), o wizard usa a entrevista guiada no frontend — não passa por esta função.

### 3.4 `ingest-context`

Pipeline de ingestão RAG de um item do Conteúdo de Contexto: limpeza → chunking → embeddings → `ready`. Disparada após upload/cadastro em `/contexto` e reprocessável a qualquer momento.

| | |
|---|---|
| Método | POST |
| Auth | autenticado |
| Duração | resposta rápida; processamento em `EdgeRuntime.waitUntil`; acompanhar por Realtime em `context_items.status` |

```ts
// Request
interface IngestContextRequest {
  item_id: string;
}

// Response (202) (proposta — validar; alternativa: 200)
interface IngestContextResponse {
  item_id: string;
  status: 'processing';
}
```

**Fluxo interno (background):**
1. `context_items.status = 'processing'`.
2. Resolve a fonte do texto: `body` OU arquivo em `context-files` (extração de texto conforme mime) OU `source_url` (fetch + limpeza de HTML).
3. Limpeza (boilerplate, timestamps de transcrição) → chunking (janela com overlap; parâmetros em `app_settings` sob `engine defaults` (proposta — validar)).
4. `DELETE` dos `context_chunks` antigos do item (reprocesso idempotente) → embeddings em lote via driver de embeddings (`google/gemini-embedding-001` no gateway) → `INSERT` em `context_chunks` com `embedding vector(768)`.
5. `status = 'ready'`. Em falha: `status = 'error'` (motivo em `metadata.error` (proposta — validar)).

**Erros (na resposta síncrona):** 404, 400 (`invalid_input`: item sem `body`, sem `file_path` e sem `source_url`), 409 (`invalid_state`: já em `processing` — evita corrida de reprocesso). Falhas do processamento em background nunca viram HTTP error: viram `status = 'error'` no item, visível na UI.

**Efeitos no banco:** atualiza `context_items.status`; substitui integralmente os `context_chunks` do item. A coluna gerada `search tsvector` se atualiza sozinha.

**Observações de implementação:**
- 402 de embeddings durante o background → item em `error` com motivo "créditos esgotados"; a UI de `/contexto` oferece "reprocessar".
- Itens `kind = 'case'` mantêm a metadata tipada (ver 04-modelo-de-dados.md) intacta — a ingestão só cuida de texto/embeddings.

### 3.5 `generate-image`

Gera a imagem IA de uma peça (ou de um brief avulso) via gateway (`google/gemini-2.5-flash-image`), grava no bucket `renders` e retorna o path; com `scope: 'slides'`, dirige e gera o **batch de fotos por unidade de card** em background (2026-07-31; generalizado em 2026-08-01 para os 3 canais de card — carrossel, stories e post). **Importante:** o render **tweet-card é client-side determinístico** (componente React + tokens do brand kit → PNG) — esta função gera **apenas** imagens de IA (insumo do card); nunca renderiza o card e nunca escreve em `render_path`.

| | |
|---|---|
| Método | POST |
| Auth | autenticado |
| Duração | single: síncrona (geração em segundos; frontend exibe loading); scope `'slides'`: resposta rápida + batch em background (Realtime) |

```ts
// Request — três formas
type GenerateImageRequest =
  | { piece_id: string }           // single: usa o image_brief do core_content da peça
  | { image_brief: string }        // single: brief avulso (ex.: preview no wizard)
  | { piece_id: string; scope: 'slides'; slide_indexes?: number[];
      composition?: 'background' | 'inline' };  // batch de fotos por slide (carrossel); default 'background'

// Response (200) — single (piece_id OU image_brief, nunca os dois)
interface GenerateImageResponse {
  path: string;                    // path no bucket 'renders' (privado)
  signed_url: string;              // URL assinada (1h) para exibição imediata
}

// Response (200) — scope 'slides': resposta imediata, geração em background
interface GenerateSlideImagesResponse {
  started: true;
  total: number;                   // fotos na fila (slide_indexes ou todos os slides)
  piece_id: string;
}
```

**scope `'slides'` — batch de fotos por unidade de card:**

1. Vale para os 3 canais de card (400 para os demais), com a unidade e o aspect de cada um (helper `slideTargetsFor`): `instagram_carousel` → `slides[]` (4:5), `instagram_stories` → `frames[]` (**9:16**), `instagram_post` → `card` único (aspect do adapter). A peça precisa ter as unidades adaptadas (409 `invalid_state`); o merge no banco escreve só a chave do canal (`targetPatch`: `slides`/`frames`/`card` + `slide_images_job`).
2. **`composition`** (default `'background'`) define o alvo visual do batch: `'background'` = foto full-bleed **atrás** do texto → a direção de arte pede fundos **limpos** de marca (atmosfera, poucos elementos, muito espaço negativo, baixo nível de detalhe — nada que dispute atenção com o texto sobreposto; o prompt de cada imagem reforça o uso "fundo de card"); `'inline'` = foto em bloco **próprio** abaixo do texto → cena concreta e rica em detalhe que ilustra o slide. O alvo fica registrado em `slide_images_job.composition`. **Trocar a `composition` e regerar INVALIDA os briefs e a style bible do batch anterior** (foram dirigidos ao outro alvo) — a direção de arte roda de novo no alvo certo.
3. **Direção de arte em UMA chamada LLM** (papel `generator`, structured output), dirigida pelo alvo de `composition` e pelo **aspect do canal** (a regra de retrato/quadrado entra no prompt; frames de stories levam o `role` — gancho/desenvolvimento/cta — junto do texto): devolve a `style_bible` do deck (direção comum — estilo, paleta, luz) + um brief visual por unidade, **ancorada na paleta do `brand_kit`** (descrição textual dos tokens de cor entra no prompt junto das `negative_constraints`). Briefs são salvos em `image_brief` da unidade e **reusados** nas próximas chamadas da mesma composition (retry não redireciona a arte — o LLM só roda quando falta brief ou style bible).
4. Fotos geradas em background (`EdgeRuntime.waitUntil`) com **concorrência 2**; progresso em `adapted_content.slide_images_job` (shape `SlideImagesJob`: `{status: 'running'|'done'|'error', total, done, composition, style_bible, started_at, ended_at?, error?, failed_indexes?}` — presente nos 3 canais de card); paths em `image_path` da unidade (`renders/{piece_id}/slide-{index}-{ts}.png`, mesmo padrão para slide/frame/card). O frontend acompanha por Realtime (UPDATE em `content_pieces`).
5. **Rate limit por IMAGEM**: cada foto consome 1 unidade da cota `generate-image` (teto 60/h — migration 15), não 1 por chamada. Cota estourada no meio do batch → os slides restantes entram em `failed_indexes`.
6. Um batch por vez: `slide_images_job.status = 'running'` fresco → **409** `invalid_state`; batch `running` parado há **>10 min** é considerado morto e pode ser substituído.
7. `slide_indexes` regenera só os slides pedidos (retry pontual de `failed_indexes`, ou regerar a foto de um slide).
8. Erros `credits_exhausted`/`invalid_config` numa foto **abortam o resto do batch** (os demais falhariam igual); outras falhas são pontuais e viram `failed_indexes` + `status: 'error'`.

**Erros:** 400 (nenhum ou ambos os campos no single; peça sem `image_brief`; scope `'slides'` sem `piece_id`, em canal fora dos 3 de card, com `slide_indexes` inválidos ou `composition` fora de `'background' | 'inline'`), 404 (`piece_id` inexistente), 409 (`invalid_state`: batch `running` fresco; peça sem unidades adaptadas), 402, 429, 502 (`provider_error` do modelo de imagem ou da direção de arte).

**Efeitos no banco/storage:** upload do(s) PNG(s) em `renders`; quando `piece_id` (single), grava o path em
`content_pieces.adapted_content.image_path`; no scope `'slides'`, grava `image_path` + `image_brief` nas unidades do canal (`slides[i]` / `frames[i]` / `card`) + `adapted_content.slide_images_job`.

> **Nota de arquitetura (2026-07-30):** a versão anterior deste contrato mandava atualizar
> `content_pieces.render_path`. Isso conflita com §6: `render_path` é o PNG do **tweet-card**,
> render determinístico exportado pelo frontend. A imagem de IA é um insumo *dentro* da peça
> (aparece embaixo do texto do card), por isso vive em `adapted_content.image_path` — os dois
> podem coexistir na mesma peça.

**Observações de implementação:**
- O prompt de imagem é composto por `image_brief` (+ `style_bible` no batch) + `brand_kit.negative_constraints[]` + direção visual do adapter (aspect ratio do canal) + bloco de uso da `composition` no batch (`'background'` reforça "fundo limpo para texto sobreposto") + regra dura "sem texto/letra/logo na imagem" (o texto do card é composto por cima, no frontend). A paleta do `brand_kit` ancora a **direção de arte** (entra no prompt do diretor junto das `negative_constraints`).
- Provider de imagem selecionável por papel em `app_settings` (default `google/gemini-2.5-flash-image`; alternativa Gemini Flash Image). A direção de arte do batch usa o papel `generator`.
- Esta função **nunca escreve em `render_path`** (regra do §6: `render_path` é o PNG do tweet-card, exportado pelo frontend). Regerar a imagem IA sobrescreve a **referência** — `adapted_content.image_path` (single) ou `adapted_content.slides[i].image_path` (batch) — apontando para um arquivo novo; sem versionamento de render no MVP.

### 3.6 `tone-gate`

Gate de tom (onboarding passo 9): gera as **3 peças-amostra** pelo pipeline completo, reusando a saga com flag `sample = true`. O cliente aprova ou reprova cada uma; reprovação devolve ao passo de voz. Os vereditos são gravados em `piece_feedback` pela UI de aprovação normal — ficam guardados para calibrar o juiz e servir de few-shot.

| | |
|---|---|
| Método | POST |
| Auth | autenticado (rota consumidora `/onboarding` é guarded admin; checagem de admin dentro da função é (proposta — validar)) |
| Duração | resposta rápida; 3 sagas em background; acompanhar por Realtime |

```ts
// Request
type ToneGateRequest = Record<string, never>;  // body vazio: {}

// Response (200)
interface ToneGateResponse {
  job_ids: string[];               // exatamente 3 jobs
}
```

**Fluxo interno:**
1. Monta 3 comandos-amostra derivados das teses de `brand_strategy` ativa + preset do template de nicho escolhido (proposta — validar).
2. Cria 3 `generation_jobs` marcados como amostra (a flag `sample` NÃO faz parte do shape canônico de `Classification` — onde persistir é proposta — validar) e dispara as 3 sagas via `EdgeRuntime.waitUntil`, pulando `awaiting_angle` (o Roteador roda com `needs_angle_choice = false` forçado — amostra não deve pedir interação).
3. Responde com os `job_ids`; o wizard acompanha por Realtime até as peças chegarem em `awaiting_review`.

**Erros:** 409 (`invalid_state`: passos 3-4-5-6 do onboarding incompletos — a saga exige contexto + voz + bandeira + guardrails ativos), 402, 500.

**Efeitos no banco:** 3 linhas em `generation_jobs`; peças em `content_pieces`; posteriormente vereditos em `piece_feedback` (via UI, não por esta função).

**Observações de implementação:**
- Cada amostra usa um canal habilitado diferente quando possível, para o cliente sentir a variação de formato (proposta — validar).
- Reprovação no gate NÃO apaga nada: peças reprovadas ficam com `status = 'rejected'` e o veredito em `piece_feedback` — é matéria-prima de calibração (flywheel automático é P1; o MVP só armazena).

### 3.7 `invite-user`

Cria convite de usuário via auth admin API. **Admin only.** Signup aberto existe apenas até o primeiro usuário (que vira admin via trigger `handle_new_user`); depois, entrada só por convite — o próprio trigger **rejeita** (`raise exception`) signup sem convite em `pending_invites` quando já existe admin, e o frontend `/login` esconde a opção de signup consultando `has_any_admin()` (função SQL SECURITY DEFINER com GRANT a `anon`, definida em 04-modelo-de-dados.md).

| | |
|---|---|
| Método | POST |
| Auth | **admin** (checado dentro da função contra `user_roles`) |
| Duração | síncrona |

```ts
// Request
interface InviteUserRequest {
  email: string;
  role: 'admin' | 'user';          // valores do enum app_role
}

// Response (200)
interface InviteUserResponse {
  invited: true;
  email: string;
}
```

**Erros:** 403 (`forbidden`: chamador não é admin), 400 (`invalid_input`: e-mail inválido, role fora do enum), 409 (`invalid_state`: e-mail já cadastrado), 502 (falha da auth admin API).

**Efeitos no banco:** cria o usuário convidado em `auth.users` (estado invited) via `auth.admin.inviteUserByEmail`. O papel pretendido é gravado antes em `pending_invites` (só o servidor escreve, com service_role); o trigger `handle_new_user` lê o papel **dali** pelo e-mail e apaga a linha depois de usar. **Nunca** de `raw_user_meta_data`: esse campo é preenchido por quem se cadastra (um signup com `data.role = 'admin'` virava admin; corrigido em 05/11, `supabase/sql/convite-papel-do-servidor.sql`). Regras do trigger: o primeiro usuário do banco vira admin; os seguintes SÓ entram com convite em `pending_invites`, senão `raise exception`.

**Observações de implementação:**
- Usa o client service role (`auth.admin`) — jamais expor service role fora da função.
- O e-mail de convite usa o template padrão do Supabase Auth da instância; personalização de template é pós-MVP (proposta — validar).
- Rebaixar/promover papel de usuário existente é operação da tela `/config/usuarios` via update em `user_roles` sob RLS de admin — não passa por esta função.

### 3.8 `store-secret`

Grava uma API key BYO (Anthropic/OpenAI/Tavily/Firecrawl) no **Supabase Vault**. **Admin only.** A função **nunca retorna nem loga o valor**; não existe endpoint de leitura de segredo para o frontend — a UI mostra apenas "configurada/não configurada".

| | |
|---|---|
| Método | POST |
| Auth | **admin** (checado dentro da função contra `user_roles`) |
| Duração | síncrona |

```ts
// Request
interface StoreSecretRequest {
  name: string;                    // allowlist: 'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY' | 'TAVILY_API_KEY' | 'FIRECRAWL_API_KEY'
  value: string;                   // a key; nunca ecoada de volta
}

// Response (200)
interface StoreSecretResponse {
  name: string;
  stored: true;
}
```

**Erros:** 403, 400 (`invalid_input`: nome fora da allowlist, valor vazio ou com formato obviamente inválido — prefixos esperados: `sk-ant-` Anthropic, `sk-` OpenAI, `tvly-` Tavily, `fc-` Firecrawl).

**Efeitos no banco:** upsert do segredo no Vault (cria ou substitui pelo mesmo `name`), executado pela função SQL SECURITY DEFINER restrita a admin definida em 04-modelo-de-dados.md, chamada com o client service role.

**Observações de implementação:**
- Cadeia completa dos segredos no §7. Regra de ouro: o valor entra pelo body desta função e só volta a existir dentro de edge functions via service role. **Nunca** em tabela plaintext, **nunca** em `VITE_*`, **nunca** em resposta HTTP.
- Redigir o body nos logs da função (log estruturado sem `value`).
- Após gravar, a tela `/config/ia` pode habilitar o driver correspondente em `app_settings` — passo separado, decisão do admin.
- `TAVILY_API_KEY` e `FIRECRAWL_API_KEY` habilitam a **pesquisa web reativa** na instância só-gateway (o Lovable AI Gateway não tem busca própria — 06-arquitetura-ia.md §5.4; Firecrawl raspa o conteúdo integral das páginas); as keys BYO Anthropic/OpenAI habilitam os caminhos de busca nativos dos respectivos providers.

### 3.9 `regenerate-piece`

Regeneração guiada de uma peça a partir de uma instrução humana ("mais provocador", "encurta") — a intervenção humana desejável da Biblioteca.

| | |
|---|---|
| Método | POST |
| Auth | autenticado |
| Duração | resposta rápida; regeneração em background; acompanhar por Realtime em `content_pieces` |

```ts
// Request
interface RegeneratePieceRequest {
  piece_id: string;
  instruction: string;             // instrução livre do revisor, não-vazia
}

// Response (200)
interface RegeneratePieceResponse {
  job_id: string;                  // novo job que produzirá a nova versão da peça
  piece_id: string;                // a peça original (será arquivada ao concluir) (proposta — validar)
}
```

**Fluxo interno (proposta — validar):**
1. Carrega a peça + seu job de origem (briefing, `selected_angle`, `context_ids`, versões de persona/strategy/guardrails vigentes na peça).
2. Cria um novo `generation_jobs` referenciando o mesmo contexto, com a `instruction` anexada ao briefing do Gerador.
3. Roda a sub-saga em background **apenas para o `channel_type` da peça**: generate → lint → grounding → judge → (rewrite ≤ 2) → adapt.
4. Ao concluir: insere a nova `content_pieces` (status `draft`, mesmo `channel_type`) e arquiva a original (`status = 'archived'`), preservando histórico e `piece_feedback`.

**Erros:** 400 (`invalid_input`: instrução vazia), 404, 409 (`invalid_state`: peça `archived`), 402, 429.

**Efeitos no banco:** 1 novo `generation_jobs`; 1 nova `content_pieces`; original vai a `archived`.

**Observações de implementação:**
- A nova peça carimba as versões **ativas atuais** de persona/strategy/guardrails/brand kit e o `engine_version` — se a marca mudou desde a peça original, a regeneração já sai na voz nova.
- A instrução humana entra como diretriz de reescrita no prompt do Gerador — nunca relaxa linter/grounding/juiz (o gate continua o mesmo).
- **Pesquisa web:** o novo job herda o `web_research.requested` do job original e faz busca **NOVA** na etapa `researching` — nunca reusa o digest antigo (informação fresca é parte do ponto de regenerar).

### 3.10 `search-context`

Busca do Conteúdo de Contexto para a UI do módulo `/contexto` (ver 05-rotas-e-modulos.md): busca híbrida (pgvector + FTS + filtros kind/tags) reusando `_shared/retrieval.ts` — a mesma retrieval que alimenta a saga.

| | |
|---|---|
| Método | POST |
| Auth | autenticado |
| Duração | síncrona |

```ts
// Request
interface SearchContextRequest {
  query: string;                   // texto da busca, não-vazio
  filters?: { kinds?: ContextKind[]; tags?: string[] };
  limit?: number;                  // default: match_count da retrieval (12)
}

// Response (200)
interface SearchContextResponse {
  results: {
    item_id: string;
    title: string;
    kind: ContextKind;
    excerpt: string;               // trecho do chunk mais relevante
    score: number;
  }[];
}
```

**Erros:** 400 (`invalid_input`: query vazia), 402/429/502 (falha do driver de embeddings ao embutir a query).

**Efeitos no banco:** somente leitura (`context_items`, `context_chunks`). Zero escrita.

**Observações de implementação:**
- Reusa `_shared/retrieval.ts` (busca híbrida pgvector + FTS + filtros), que chama a função SQL `match_context_chunks` (`match_count` default 12 — ver 04-modelo-de-dados.md).
- É a mesma lógica de retrieval da saga — garantia de que o que a UI encontra é o que o gerador encontraria.

---

## 4. A saga de geração (runner interno — não é function separada)

A saga vive em `_shared/saga.ts` (proposta — nome do arquivo) e é executada dentro de `generate-content`, `resume-job`, `tone-gate` e `regenerate-piece` via `EdgeRuntime.waitUntil`. Não é uma edge function própria: é o runner da máquina de estados de `generation_jobs`.

```text
created → classifying ─┬→ awaiting_angle ──(resume-job c/ ângulo)──┐
                       └──────────(comando específico)─────────────┤
                                                                   ▼
 retrieving → [researching] → generating → linting → grounding → judging ──┬→ adapting → awaiting_review → done
                                  ▲                                        │
                                  └───────── rewriting (attempt ≤ 2) ◄─────┘ (reprovação em qualquer classe)
Estados terminais: done · failed · cancelled
[researching] SÓ roda quando generation_jobs.web_research.requested = true (pesquisa web reativa — 06 §5.4)
```

Regras do runner:

1. **Checkpoint antes de cada etapa**: grava `generation_jobs.status` e o carimbo em `timings` ANTES de executar a etapa. É isso que torna `resume-job` (e o watchdog) capaz de retomar do ponto exato.
2. **Fail-fast na auditoria**: linter (Classe 1, determinístico, sem LLM) roda primeiro; reprovou, pula grounding/juiz e vai direto a `rewriting`. Grounding (Classe 2) roda em seguida; o juiz (Classe 3, **chamada LLM separada do gerador**, sempre) por último. Ordem = custo crescente.
3. **Reescrita ≤ 2**: reprovação em qualquer classe alimenta a reescrita com o diagnóstico (`Audit`); `attempt` incrementa. Após a 2ª tentativa reprovada, a saga **escala para humano**: segue para `adapting → awaiting_review` com os chips de reprovação visíveis — o gate "não publica falha" é garantido porque publicar exige aprovação humana na Biblioteca.
4. **Adapt para todos os canais alvo**: `adapting` roda o `ChannelAdapter` de cada canal do job (§6) e insere uma `content_pieces` por canal, com `core_content`, `adapted_content`, `audit` e as versões carimbadas (persona/strategy/guardrails/brand kit ativos + `engine_version`).
5. **`awaiting_review` → `done`**: o job conclui quando todas as suas peças recebem decisão humana (approved/rejected) na Biblioteca (proposta — validar; transição feita por trigger ou pela própria UI via update sob RLS).
6. **Falha irrecuperável** (exceção não tratada, 402 persistente): `status = 'failed'`, motivo em `error`. A UI de `/criar` oferece "tentar novamente" (que chama `resume-job`).
7. **`[VERIFICAR]`**: divergências de grounding não bloqueiam a saga — viram marcação `[VERIFICAR: x]` no conteúdo + flag no `audit.grounding`; a confirmação é humana, na revisão.
8. **`researching` é condicional e nunca-fatal**: só roda quando `web_research.requested = true`; indisponibilidade/falha do provedor vira `web_research.skipped` (`'unavailable' | 'error'`) e a saga segue para `generating` sem pesquisa. Retomada idempotente: digest já materializado (`web_research.item_id` com item `ready`) é reusado, sem nova busca.

Watchdog (detalhes operacionais em §9): re-invoca `resume-job` para jobs em estado de **processamento** (`created`, `classifying`, `retrieving`, `researching`, `generating`, `linting`, `grounding`, `judging`, `rewriting`, `adapting`) sem update há mais de N minutos. Estados de **espera humana** (`awaiting_angle`, `awaiting_review`) e terminais ficam fora do watchdog — não são travamento, são fricção desejável.

---

## 5. Estrutura de pastas `supabase/functions/`

Itens sem marcação vêm do brief canônico; arquivos utilitários adicionais estão marcados como proposta.

```text
supabase/functions/
├── _shared/
│   ├── llm.ts                    # abstração de provider: chat({role_hint, messages, schema?, stream?})
│   │                             #   drivers: lovable-gateway (default) · anthropic (BYO) · openai (BYO)
│   ├── linter.ts                 # Classe 1 — determinístico (regex/código, sem LLM)
│   ├── grounding.ts              # Classe 2 — diff de números/citações vs Conteúdo de Contexto
│   ├── judge.ts                  # Classe 3 — LLM-as-judge, rubrica de 4 regras + nota de corte
│   ├── funnel.ts                 # framework do funil narrativo de 8 camadas (default)
│   ├── adapters/
│   │   ├── base.ts               # contrato ChannelAdapter + helpers comuns (post+imagem+legenda)
│   │   ├── instagram_stories.ts
│   │   ├── instagram_carousel.ts
│   │   ├── instagram_post.ts
│   │   ├── x_post.ts
│   │   ├── threads_post.ts
│   │   ├── linkedin_post.ts
│   │   └── facebook_post.ts
│   ├── prompts/                  # prompts do motor, versionados com ENGINE_VERSION
│   │   ├── index.ts              # exporta ENGINE_VERSION (semver) + registro de prompts (proposta — validar)
│   │   ├── router.ts             # prompt do Roteador
│   │   ├── generator.ts          # prompt do Gerador (prefixo estável p/ prompt caching Anthropic)
│   │   ├── judge.ts              # prompt do Juiz (rubrica)
│   │   └── voice-extractor.ts    # prompt do Extrator de Voz
│   ├── saga.ts                   # runner da máquina de estados do job (proposta — validar)
│   ├── retrieval.ts              # busca híbrida pgvector + tsvector + filtros kind/tags (proposta — validar)
│   ├── web-search.ts             # pesquisa web reativa (etapa researching): drivers tavily/anthropic/openai (06 §5.4)
│   ├── secrets.ts                # leitura de keys BYO do Vault via service role (proposta — validar)
│   ├── auth.ts                   # getUser(req) + requireAdmin(req) (proposta — validar)
│   ├── db.ts                     # factory de clients: user-scoped e service role (proposta — validar)
│   ├── cors.ts                   # corsHeaders + handler de OPTIONS (proposta — validar)
│   └── types.ts                  # tipos compartilhados do §2 (proposta — validar)
├── generate-content/index.ts
├── resume-job/index.ts
├── extract-voice/index.ts
├── ingest-context/index.ts
├── generate-image/index.ts
├── tone-gate/index.ts
├── invite-user/index.ts
├── store-secret/index.ts
├── regenerate-piece/index.ts
└── search-context/index.ts
```

Notas:
- `_shared/` não é deployado sozinho: cada function importa por caminho relativo (`../_shared/llm.ts`) e o bundle é montado por function no deploy.
- `prompts/` é **motor**: muda por release do template (ver 08-estrategia-template.md), nunca por instância. O que varia por instância (persona, guardrails) entra em runtime, compilado como prefixo estável para prompt caching no driver `anthropic` (ver 06-arquitetura-ia.md).
- `linter.ts` é a fonte única das regras determinísticas; adapters só declaram `lint_overrides` — nunca duplicam regra.

---

## 6. Contrato `ChannelAdapter` e os 7 adapters

O núcleo de IA gera apenas a IDEIA e o CONTEÚDO (`core_content`); o adapter transforma para cada plataforma. Canal novo = novo arquivo em `adapters/` + linha em `channels` via migration — **não muda o núcleo**.

```ts
// _shared/adapters/base.ts
export interface ChannelAdapter {
  channel_type: ChannelType;

  limits: {
    chars?: number;                          // limite de texto principal
    caption_chars?: number;                  // limite de legenda (proposta — validar)
    slides?: { min: number; max: number };   // carrossel
    frames?: { min: number; max: number };   // stories
  };

  aspect_ratio: '4:5' | '1:1' | '9:16';

  // Função pura: núcleo → conteúdo adaptado ao canal (grava em content_pieces.adapted_content)
  structure(core_content: CoreContent): AdaptedContent;

  // Como a peça vira arte final
  render_spec: RenderSpec;

  // Overrides das regras do linter para este canal (ex.: hashtags permitidas em metadado)
  lint_overrides?: Record<string, unknown>;

  // Nota de corte do juiz para este canal (override por instância em channels.config /
  // guardrails.approval_threshold)
  cutoff_score: number;
}

// (proposta — validar) união discriminada do render
export type RenderSpec =
  | { kind: 'tweet-card'; layout: 'single' | 'slides'; aspect_ratio: '4:5' | '1:1' }
  | { kind: 'frames'; aspect_ratio: '9:16' }
  | { kind: 'image-caption' };               // foto (IA opcional) + legenda, sem card

// (proposta — validar) saída tipada por canal
export type AdaptedContent =
  | { channel_type: 'instagram_carousel'; slides: TweetCardSlide[]; caption: string;
      slide_images_job?: SlideImagesJob;   // progresso do batch de fotos (generate-image scope 'slides')
      slide_renders?: SlideRender[] }      // artes finais exportadas (PNG do card por slide)
  | { channel_type: 'instagram_post';     card: TweetCardSlide; caption: string;
      slide_images_job?: SlideImagesJob }  // batch de foto do card único
  | { channel_type: 'instagram_stories';  frames: StoryFrame[];
      slide_images_job?: SlideImagesJob; slide_renders?: SlideRender[] }  // fotos por frame + export ZIP
  | { channel_type: 'x_post';             text: string; thread?: string[]; caption?: string; image_brief?: string }
  | { channel_type: 'threads_post';       text: string; thread?: string[]; caption?: string; image_brief?: string }
  | { channel_type: 'linkedin_post';
      blocks: { hook: string; contexto: string; lista: string; insight: string; ponte: string; cta: string };
      text: string;                          // serialização final dos blocks
      image_brief?: string }
  | { channel_type: 'facebook_post';      text: string; image_brief?: string };

export interface TweetCardSlide {
  index: number;                             // posição do slide na sequência (0-based)
  text: string;                              // texto principal do card
  image_brief?: string;                      // brief da imagem IA do slide (gerado na direção de arte)
  image_path?: string;                       // foto IA do slide no bucket renders (generate-image scope 'slides')
}

// Progresso do batch de fotos por slide (adapted_content.slide_images_job) —
// atualizado a cada imagem; o frontend acompanha via Realtime (UPDATE em content_pieces)
export interface SlideImagesJob {
  status: 'running' | 'done' | 'error';
  total: number;
  done: number;
  composition?: 'background' | 'inline';     // alvo de composição do batch (§3.5; trocar invalida briefs/style bible)
  style_bible?: string;                      // direção de arte comum (consistência do carrossel)
  started_at: string;
  ended_at?: string;
  error?: string;
  failed_indexes?: number[];                 // slides cuja imagem falhou (retry pontual)
}

// Arte final exportada por slide (PNG do card no bucket renders, upload do frontend)
export type SlideRender = { index: number; path: string };

export interface StoryFrame {
  index: number;                             // posição do frame na sequência (0-based)
  role: 'gancho' | 'desenvolvimento' | 'cta';
  text: string;
  image_brief?: string;                      // brief da imagem IA do frame (direção de arte)
  image_path?: string;                       // foto IA do frame no bucket renders (scope 'slides', 9:16)
}
```

### Regras por adapter

| Adapter | Estrutura | Limites | Aspect ratio | render_spec |
|---|---|---|---|---|
| `instagram_carousel` | 7-10 slides mapeados do funil de 8 camadas + legenda; slides estilo tweet-card (texto + imagem opcional abaixo) | `slides: {min: 7, max: 10}`; legenda ≤ 2.200 chars (dado de mercado — validar) | 4:5 | `tweet-card` / `slides` |
| `instagram_post` | post padrão + legenda; modo tweet-card | 1 card; legenda ≤ 2.200 chars (dado de mercado — validar) | 4:5 ou 1:1 | `tweet-card` / `single` |
| `instagram_stories` | sequência de 3-6 frames (gancho → desenvolvimento → CTA) | `frames: {min: 3, max: 6}` | 9:16 | `frames` |
| `x_post` | texto ≤ limite + imagem opcional + legenda/thread curta | texto ≤ 280 chars (dado de mercado — validar); thread ≤ 4 posts (proposta — validar) | 1:1 (imagem, quando houver) (proposta — validar) | `image-caption` |
| `threads_post` | idem X com limites próprios | texto ≤ 500 chars (dado de mercado — validar) | 1:1 (proposta — validar) | `image-caption` |
| `linkedin_post` | post com foto + legenda; estrutura de 6 blocos: hook, contexto, lista, insight, ponte, CTA | texto ≤ 3.000 chars (dado de mercado — validar) | 1:1 (proposta — validar) | `image-caption` |
| `facebook_post` | foto + legenda | texto ≤ 5.000 chars | 1:1 (proposta — validar) | `image-caption` |

Mapeamento funil → estrutura (responsabilidade do `structure()` de cada adapter, apoiado em `funnel.ts`):
- **Carrossel**: camada 1-2 no slide de capa; 3-6 distribuídas nos slides do meio; 7-8 nos slides finais (a marca só aparece de verdade nas camadas 7-8 — regra de ouro preservada pelo adapter).
- **Stories**: frame `gancho` = camadas 1-3 comprimidas; `desenvolvimento` = 4-6; `cta` = 7-8.
- **X/Threads**: hook + virada + prova comprimidos no texto principal; thread opcional carrega ensino/moral; CTA na última unidade.
- **LinkedIn**: 6 blocos mapeiam 1-para-grupos das 8 camadas (hook←1-3, contexto←4, lista/insight←5-6, ponte←7, CTA←8).
- Os 4 adapters `x_post`/`threads_post`/`linkedin_post`/`facebook_post` compartilham a base "post+imagem+legenda" em `base.ts` (conforme 02-escopo-mvp.md).

### Divisão de responsabilidade no render (regra inegociável)

- **Tweet-card = client-side determinístico.** Componente React + tokens do `brand_kit` → PNG no browser (biblioteca de rasterização DOM→PNG (proposta — validar)). Mesmo input ⇒ mesmo pixel. O adapter apenas **define o template** via `render_spec`; nenhuma edge function desenha card.
- **Edge function só gera imagem IA.** `generate-image` produz exclusivamente a imagem-insumo (a que aparece no tweet-card — abaixo do texto ou como foto de fundo com scrim, escolha de composição do frontend —, a foto dos formatos post+imagem+legenda, ou o batch de fotos por slide do carrossel), a partir do `image_brief`. Paths de imagem IA vivem em `adapted_content.image_path` / `adapted_content.slides[i].image_path` — **nunca** em `render_path`.
- O PNG final do card, quando o usuário exporta, sobe **direto do frontend** para o bucket `renders` — política de INSERT para `authenticated` restrita ao path `renders/{piece_id}/...` (ver 04-modelo-de-dados.md §9) — sem passar por edge function; o path vai em `content_pieces.render_path`. No **export do carrossel (ZIP)**, o frontend compõe os N cards (foto de fundo + texto), baixa `01.png…NN.png` + `legenda.txt` e persiste as artes em `adapted_content.slide_renders` (uma por slide) — mesmo princípio, `render_path` ≠ `image_path`.

---

## 7. Segredos

Cadeia completa, da entrada ao consumo — nenhum segredo jamais toca o client bundle:

| Segredo | Origem | Onde vive | Quem lê |
|---|---|---|---|
| `LOVABLE_API_KEY` | injetada **automaticamente** pelo Lovable Cloud (AI Gateway ativo) | env da edge function | driver `lovable-gateway` em `llm.ts` |
| `ANTHROPIC_API_KEY` (BYO) | admin, no onboarding passo 2 ou `/config/ia` → `store-secret` | **Supabase Vault** | edge functions, via service role (`_shared/secrets.ts`) |
| `OPENAI_API_KEY` (BYO) | idem | **Supabase Vault** | idem |
| `TAVILY_API_KEY` (BYO) | admin, `/config` aba IA → `store-secret` (prefixo `tvly-`) | **Supabase Vault** | driver `tavily` em `_shared/web-search.ts` (pesquisa web reativa — caminho default da instância só-gateway) |
| `FIRECRAWL_API_KEY` (BYO) | idem (prefixo `fc-`) | **Supabase Vault** | driver `firecrawl` em `_shared/web-search.ts` (busca + conteúdo integral raspado em markdown) |
| `SUPABASE_SERVICE_ROLE_KEY` | env padrão da edge function | env | client admin em `_shared/db.ts`; e o watchdog (header da chamada `pg_net`, valor no Vault) |

Regras:

1. **Escrita** somente por `store-secret` (admin), que usa a função SQL SECURITY DEFINER restrita a admin (ver 04-modelo-de-dados.md) para upsert no Vault. Sem endpoint de leitura para o frontend; a UI só vê boolean "configurada".
2. **Leitura** somente dentro de edge functions, com service role, no momento do uso. Nunca cachear em tabela, nunca devolver em response, redigir de logs.
3. **`VITE_*` é proibido para qualquer segredo.** Variáveis `VITE_*` entram no bundle do browser. As únicas envs públicas do frontend são a URL do Supabase e a anon key (públicas por design, protegidas por RLS).
4. Keys BYO são **opcionais**: o produto funciona zero-config no driver `lovable-gateway`. A ausência de key BYO nunca bloqueia o onboarding (passo 2 permite pular).
5. Rotação = chamar `store-secret` de novo com o mesmo `name` (upsert). Sem versionamento de segredo no MVP (proposta — validar).

---

## 8. CORS e invocação pelo frontend

Toda function usa o mesmo par de helpers (`_shared/cors.ts`):

```ts
// _shared/cors.ts
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',   // single-tenant; restringir ao domínio do deploy é (proposta — validar)
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Em toda function: preflight primeiro, corsHeaders em TODA resposta (inclusive erros)
if (req.method === 'OPTIONS') {
  return new Response(null, { headers: corsHeaders });
}
```

Invocação padrão no frontend (o client de `src/integrations/supabase/client.ts` anexa o JWT da sessão sozinho):

```ts
import { supabase } from '@/integrations/supabase/client';

const { data, error } = await supabase.functions.invoke('generate-content', {
  body: { prompt: comando, channel_types: canais } satisfies GenerateContentRequest,
});

if (error) {
  // FunctionsHttpError: o envelope ErrorResponse está no body da resposta
  const payload = await error.context?.json?.();
  toast.error(payload?.error?.message ?? 'Erro inesperado');
}
```

Padrões de consumo:
- **Jobs longos**: invocar → receber `job_id` → assinar Realtime (`postgres_changes` em `generation_jobs` filtrado por `id`, e em `content_pieces` filtrado por `job_id`) → atualizar a UI de `/criar` conforme `status` transiciona. Nunca fazer polling.
- **402** (`credits_exhausted`): a UI orienta para `/config/ia` — comprar créditos Lovable ou configurar key BYO.
- Server functions TanStack **não** chamam edge functions em nome do usuário: uso delas é restrito a SSR trivial de página (decisão do dono; ver §1).

---

## 9. Deploy e operação

### Deploy via Lovable MCP

- Deploy de edge functions é feito via **Lovable MCP** (`lovable_deploy`) — nunca CLI do Supabase direto contra a instância (o Lovable Cloud é o dono do ciclo de deploy da instância).
- `verify_jwt = true` para todas as functions (configuração declarada no repo do template; nenhuma função pública no MVP).
- O código das functions vive no repo do template (git sync): instâncias recebem novas versões pelo fluxo de atualização do motor (merge do remote do template + redeploy — ver 08-estrategia-template.md). `ENGINE_VERSION` em `_shared/prompts/index.ts` é carimbada em cada peça gerada.

### Ordem de deploy (alinhada às fases de 09-plano-implementacao.md)

| Ordem | Functions | Fase | Pré-requisitos |
|---|---|---|---|
| 1 | `store-secret`, `ingest-context`, `search-context` | F1 | migrations F0 aplicadas (schema + Vault + buckets + extensões `vector`/`pg_cron`); `search-context` exige `_shared/retrieval.ts` + a função SQL `match_context_chunks` |
| 2 | `generate-content`, `resume-job` | F2 | `_shared` completo (llm, funnel, prompts, linter, grounding, judge, adapters); itens de contexto ingeríveis |
| 3 | `generate-image`, `regenerate-piece` | F3 | bucket `renders`; Biblioteca no frontend |
| 4 | `extract-voice`, `tone-gate`, `invite-user` | F4 | wizard de onboarding no frontend |
| 5 | watchdog pg_cron (não é function; é migration) | F5 | `resume-job` estável em produção |

`_shared/` não tem deploy próprio: qualquer mudança nele exige redeploy das functions que o importam (na prática, redeploy de todas — mantê-las juntas no mesmo release).

> **Migration antes do redeploy (2026-07-31):** `202607310015_web_research_and_slide_images.sql` (valor `researching` no enum `job_status`, coluna `generation_jobs.web_research`, watchdog recriado, seeds `web_search` e teto 60/h do `generate-image`) precisa estar **aplicada antes** de redeployar as functions — o runner grava o status e a coluna novos. Como `web-search.ts` vive em `_shared/`, a mudança implica redeploy de **todas** as functions (regra acima).

### Watchdog pg_cron (F5)

Migration idempotente que agenda a checagem de jobs travados. O threshold **não é hardcoded**: o SQL lê `app_settings.engine_defaults.watchdog_stale_minutes` (valor 10 — seed em 04-modelo-de-dados.md §12.3), ajustável em `/config/instancia` sem nova migration. A frequência do cron (`*/5`) é apenas a cadência de checagem (proposta — validar):

```sql
-- Watchdog: re-invoca resume-job para jobs de processamento sem update há mais de
-- app_settings.engine_defaults.watchdog_stale_minutes (10). A cada execução, seleciona
-- os travados e chama a function via pg_net com o Bearer do service role
-- (valor lido do Vault — nunca hardcoded na definição do cron).
select cron.schedule(
  'watchdog-stuck-jobs',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := (select app_url from ...) || '/functions/v1/resume-job',  -- URL da instância (proposta — validar composição)
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                               where name = 'SUPABASE_SERVICE_ROLE_KEY'),
                 'Content-Type', 'application/json'),
    body    := jsonb_build_object('job_id', j.id)
  )
  from generation_jobs j
  where j.status in ('created','classifying','retrieving','researching','generating',
                     'linting','grounding','judging','rewriting','adapting')
    and j.updated_at < now() - make_interval(mins =>
          (select (value ->> 'watchdog_stale_minutes')::int
             from app_settings where key = 'engine_defaults'));
  $$
);
```

Estados de espera humana (`awaiting_angle`, `awaiting_review`) e terminais (`done`, `failed`, `cancelled`) ficam explicitamente fora do watchdog: não são travamento. Jobs que o watchdog retomar 3 vezes sem progresso vão para `failed` com `error = 'watchdog_max_retries'` (proposta — validar).

### Smoke test pós-deploy

Após qualquer atualização do motor numa instância, rodar o **golden set** (3 briefs canônicos — ver 08-estrategia-template.md) via `generate-content` e conferir que os 3 jobs chegam a `awaiting_review` sem `failed`. É o gate mínimo de regressão do backend.

---

## Apêndice A — Integrações pós-MVP (Eixos 1-3, docs/10)

### A.1 zernio-proxy / zernio-webhook (publicação real)

`zernio-proxy` (verify_jwt=true) — POST `{action, ...}`: `connect-url`·`list-accounts`·
`setup-webhook` (admin), `publish {piece_id, mode:'now'|'schedule'}`, `get-status`,
`retry`, `update-schedule`, `cancel`, `analytics {report}` (allowlist de rotas).
Key `ZERNIO_API_KEY` do Vault; mídia SEMPRE via `/v1/media/presign` (bucket privado);
idempotência: `x-request-id = published_posts.request_id`; 409 de dedup só é adotado
com prova de posse (`metadata.piece_id`). Estado em `published_posts` (escrita só
service role; Realtime). `zernio-webhook` (verify_jwt=false, ÚNICA pública junto com
fetch-rss) valida HMAC-SHA256 do corpo cru vs `ZERNIO_WEBHOOK_SECRET` ANTES de
qualquer efeito; estados terminais (`published`/`cancelled`) nunca são rebaixados;
23505 é ack'ado (200) para não alimentar retry do Zernio.

### A.2 fetch-rss (radar)

POST sem body → `{ok, totalNew, results[]}`. Dupla auth interna: header
`x-cron-secret` (Vault `RSS_CRON_SECRET`, chamado pelo pg_cron */30 via
`invoke_fetch_rss()`) OU JWT de admin (botão "Buscar agora"). Auto-registra
`app_settings.instance_url` a cada execução (URL dinâmica do remix). Dedupe por
UNIQUE(feed_id,guid) + upsert ignoreDuplicates. Kill switch:
`app_settings.radar.fetch_enabled=false` (só afeta o cron).

### A.3 Vídeo (Reels) via Replicate — spec completa em [docs/11](11-video-replicate.md)

> O Eixo 3 original (vídeo Higgsfield) foi implementado, validado com key real e
> REVERTIDO por completo em 2026-08-17 (decisão de produto). O redesenho abaixo o
> substitui; a implementação antiga vive só no histórico do git.

**`generate-video`** (verify_jwt=true) — porta única de comando, POST `{action, …}`:
`create_storyboard {piece_id, avatar_id?}` (roda o diretor de cenas e materializa
`video_projects` + `video_scenes`), `update_scene {scene_id, patch}` (409 `scene_busy`
com predição em voo; editar a narração marca `narration_diverged`), `reorder_scenes`,
`estimate {project_id, phase}`, `start_production` (áudio + keyframes — centavos),
`approve_keyframes` (libera o vídeo — dólares; CAS a partir de `keyframes_review`),
`regenerate_scene {scene_id, from:'audio'|'keyframe'|'video'}`, `assemble` (CAS a partir
de `scenes_ready`), `cancel`, e as ações de admin `setup` (grava
`REPLICATE_WEBHOOK_SECRET` — via client do USUÁRIO, porque `store_vault_secret` exige
`auth.uid()` admin) e `validate_catalog` (confere slug, schema e existência da versão
fixada de cada modelo ativo).

**`replicate-webhook`** (verify_jwt=false) — assinatura svix (`webhook-id`/
`webhook-timestamp`/`webhook-signature`) vs `REPLICATE_WEBHOOK_SECRET`, em tempo
constante, com anti-replay de 5 min, ANTES de qualquer efeito. A URL registrada em cada
predição leva `?pid=<uuid interno>`, que permite **adotar** uma predição órfã quando o
worker morre entre o POST no Replicate e a gravação do `provider_prediction_id` — sem
isso, o retry pagaria de novo pelo mesmo vídeo. Responde 200 na hora; baixa o output
(URL efêmera de ~1h) em stream para o bucket dentro de `waitUntil`.

**`video-reconcile`** (verify_jwt=false) — `x-cron-secret` (Vault `VIDEO_CRON_SECRET`,
pg_cron */5 via `invoke_video_reconcile()`) OU JWT de admin. Consulta as predições ativas
e manda as terminais para o MESMO `settlePrediction` do webhook. Escreve só em
`last_checked_at` — nunca em `updated_at`, senão rejuvenesceria a linha e anularia o
watchdog `mark_stale_video_predictions_failed()`, que mede idade absoluta.

Estado em `video_projects` / `video_scenes` (Realtime) e `video_predictions` (ledger, uma
linha por chamada paga; regeneração marca `superseded_at` em vez de apagar, para não
apagar o custo já contabilizado). Catálogo em `video_models`, com `input_template` jsonb —
trocar e adicionar modelo é dado, não código.
