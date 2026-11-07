# 11 — Arquitetura: geração de vídeo (Reels) via Replicate

> **STATUS (2026-08-18): DOIS DEFEITOS DE QUALIDADE CORRIGIDOS (migration 0029),
> ambos achados olhando o vídeo frame a frame — nenhum aparecia em log ou status.**
> (1) `seedance-1-lite` **alucina**: num plano cujo keyframe era só um monitor, o
> vídeo materializou um homem sentado à mesa, apesar do prompt proibir pessoas
> novas. Trocado por `kwaivgi/kling-v2.5-turbo-pro`, que devolveu a cena limpa.
> (2) O **concat reenquadrava**: cada modelo devolve um tamanho diferente (fabric
> 736×1312, omni-human 800×1472, p-video-avatar 704×1280, seedance 1088×1920,
> kling 1072×1928) e o `bfirsh/concatenate-videos` adota a dimensão do PRIMEIRO
> clipe, escalando os outros para preencher e CORTANDO — o rosto do avatar chegava
> ao vídeo final muito mais fechado do que no keyframe aprovado. Corrigido com
> `bytedance/video-upscaler` como normalizador (alinha largura e fps; sobra ~1% de
> altura, invisível). **As duas correções foram UPDATE no catálogo, sem deploy.**
> Não existe redimensionador simples no Replicate — só upscalers de IA; o
> `lucataco/video-merge`, que tem width/height, devolveu vídeo corrompido.
> **Correção de custo (auditoria)**: o normalizador cobra por segundo de output
> mas era estimado com basis vazio — US$ 0,00 no ledger, escondendo ~US$ 1,50
> por passada de montagem. O ledger real do Reel decupado é US$ 5,07, não os
> US$ 3,56 antes registrados. `cost_actual_usd` nunca era escrito (o teto mensal
> somava um campo que não existia); a estimativa persistida parava na fase prep
> (US$ 0,35 contra US$ 3,55 de real). Tudo corrigido em 39fc089+.
>
> **Ferramenta de inspeção**: `fofr/toolkit` com `extract_frames_from_input`
> devolve um ZIP de frames — é assim que se AUDITA vídeo sem ffmpeg local. Foi só
> olhando frame a frame que os dois defeitos apareceram.
>
> **STATUS (2026-08-18): DECUPAGEM NO AR (migration 0028).** O bloco de fala
> deixou de ser um plano único: `video_scenes` passa a ter uma linha por PLANO,
> agrupada por `beat_index`, com escala/ângulo/lente/movimento dirigidos. O
> diretor virou diretor de FOTOGRAFIA e não toca no texto — o código numera as
> frases e ele escolhe por índice, então "a soma dos planos é a fala auditada" é
> invariante estrutural (verificado em produção: idêntico byte a byte nos 3
> blocos). `_shared/decoupage.ts` valida em código o que o LLM erra (escala
> repetida, eixo atravessado, enquadramento que o lipsync não sustenta, descrição
> de tempo no prompt de imagem).
>
> **Teto honesto de planos = número de FRASES do roteiro.** Sem ffmpeg não há como
> fatiar um mp3 já gerado e não existe modelo de trim no Replicate, então cada
> plano precisa do próprio TTS e o corte só cai em fronteira de frase. Medido: o
> mesmo orçamento de 30s rende 4 planos com frases longas e 7 com frases curtas.
> A alavanca que falta é o gerador escrever frases mais curtas para Reel.
>
> **Verificado com clipe real antes de virar regra:** o `veed/fabric-1.0` sustenta
> três-quartos sem deriva de enquadramento (frame 1 vs frame 14 idênticos), então
> o avatar pode ser decupado em {médio, meio-close, close} × {frontal, 3/4 esq,
> 3/4 dir}. Movimento de câmera no avatar é impossível — o modelo não aceita
> prompt; a riqueza vem do CORTE entre enquadramentos.
>
> **STATUS (2026-08-17): F1 E F2 NO AR E VALIDADAS COM SMOKE E2E REAL.**
> Dois Reels completos produzidos pelo caminho de produção: um só de b-roll
> (25,34 s) e um **com avatar falante** (33,88 s), ambos 720p 9:16 com vídeo e
> áudio, montados por normalize→concat e com o ponteiro gravado na peça.
> A F2 entregou `avatar-studio`, a tela `/marca/avatares` e o caminho
> `talking_avatar` (`veed/fabric-1.0`): o identity pack manteve o MESMO rosto
> entre o retrato canônico e a cena de outro vídeo — que é a promessa do avatar
> reutilizável. Falta: assistir e julgar a QUALIDADE do lipsync (verificação
> estrutural apenas) e trocar o modelo de cena (é `UPDATE` em `video_models`).
>
> **STATUS ANTERIOR (2026-08-17): F1 CONSTRUÍDA.** Banco aplicado (migrations 0022/0023/0024:
> 5 tabelas com RLS, 18 modelos verificados no catálogo, 2 crons, Realtime, cotas e
> orçamento), key `r8_` no Vault, backend completo e compilando (`_shared/replicate.ts`,
> `video-catalog.ts`, `video-pipeline.ts`, `prompts/scene-director.ts`, adapter
> `instagram-reel`, functions `generate-video` / `replicate-webhook` / `video-reconcile`).
> Pendente: deploy (commit + push + deploy das functions via MCP) e o smoke E2E real —
> **nada foi publicado ainda**.
>
> **STATUS ANTERIOR (2026-08-17): SPEC APROVADA PARA IMPLEMENTAR.**
> Este documento substitui o §Eixo 3 do [docs/10](10-plano-integracoes.md) (vídeo via
> Higgsfield), revertido em `82a3951` por decisão de produto. Produzido por workflow de
> 9 agentes (PM, arquiteto, AI/LLM, 3 pesquisadores de modelos, UX, dev sênior, crítico
> adversarial) + verificação primária dos schemas de input direto das páginas públicas do
> Replicate (Apêndice A — os slugs e enums deste doc NÃO são suposição).
>
> **BLOQUEIO OPERACIONAL**: não existe `REPLICATE_API_TOKEN` no Vault desta instância.
> A F1 pode ser escrita, mas **não pode ser validada E2E** sem a key do Tiago. Preço por
> modelo é o único dado que as páginas públicas não entregam — os `cost` do seed são
> estimativas humanas até rodarem por `validate_catalog` (§4.7) com o token real.
>
> **Aprendizados herdados do ciclo Higgsfield (lei neste desenho, não opinião):**
> poll em invocação viva raspa no teto de ~7,5 min; URL de output de provider é efêmera;
> pt-BR não vem do áudio nativo dos modelos de vídeo; tabela irmã, nunca extensão de
> `generation_jobs`; `alter type add value` em migration isolada.

---

## 0. Visão e princípios

Vídeo é um **canal nativo** (`instagram_reel`) do mesmo fluxo `/criar` → saga → `/biblioteca`
→ Zernio. Mas a **renderização é uma fase de produção separada, cara e explícita**, que só
começa depois da aprovação editorial do roteiro. O Replicate é uma **camada de acesso**: a
orquestração pede uma *capability*, o catálogo resolve modelo e input.

```
/criar (chip Reel) ──▶ saga existente (roteiro em beats, auditado: linter/grounding/juiz)
                              │ awaiting_review — ZERO segundo de vídeo gerado, custo zero
                              ▼
/biblioteca/$pieceId ── diretor de cenas (1 chamada LLM) ──▶ storyboard editável de graça
                              │ [Gerar cenas] — portão de custo nº 1
                              ▼
        por cena:  TTS pt-BR ──▶ keyframe 9:16
                              │ [Aprovar keyframes] — portão de custo nº 2 (centavos travam dólares)
                              ▼
                    vídeo da cena (talking avatar | i2v/t2v + mux do VO)
                              ▼
        montagem: normalize → concat  (predições Replicate; ffmpeg não roda na edge)
                              ▼
        mp4 720p no bucket `renders` → aprovação humana → PublishBlock → Zernio (Reel)
```

Cinco regras estruturais, cada uma amarrada a um fato verificado:

1. **Nenhuma invocação espera vídeo renderizar.** Webhook do Replicate é o caminho primário;
   reconciliação por poll é a rede de segurança. (Teto de ~7,5 min da edge function.)
2. **Output do Replicate expira em ~1h** — o handler baixa e persiste no bucket na hora.
3. **A fala é sempre TTS próprio entregue como input.** Nunca áudio nativo do modelo de vídeo
   (Kling declara "best in English and Chinese"). Consequência feliz e verificada: `veed/fabric-1.0`
   e `bytedance/omni-human` recebem só `image` + `audio` — **a duração da cena de avatar sai
   do áudio automaticamente**, sem probe de duração.
4. **Uma resolução por projeto, fixada em 720p no MVP.** O normalizador disponível
   (`fofr/toolkit`) converte container/codec mas **não** reescala nem corta: resolução mista
   quebra o concat, então isso se previne na geração, não na montagem. 720p também derruba o
   risco de OOM no download do master.
5. **Tudo que custa dinheiro passa por claim atômico e confirmação explícita.** Duplo clique
   nunca paga duas vezes.

---

## 1. Camada Replicate

### 1.1 `_shared/replicate.ts` — client HTTP (fetch puro, Deno, sem SDK)

Sétimo módulo autorizado a falar com API externa. Token `REPLICATE_API_TOKEN` (`r8_…`) lido
**exclusivamente** do Vault por `get_vault_secret`, resolvido pelo caller e passado por
parâmetro (padrão do `higgsfield.ts` do ciclo anterior).

```ts
const API = 'https://api.replicate.com/v1';

export type PredictionStatus =
  | 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled' | 'aborted';

export interface Prediction {
  id: string;
  status: PredictionStatus;
  version: string | null;   // versão EFETIVA — official roda sempre a latest; gravar sempre
  output: unknown;          // string (uri) na maioria; array em alguns modelos
  error: string | null;
  metrics?: { predict_time?: number };
}

export interface CreateOpts {
  input: Record<string, unknown>;
  webhookUrl: string;                 // SEMPRE — inclui ?pid=<uuid interno> (§3.4)
  webhookEvents?: ('completed')[];    // só 'completed': é o único com retry garantido
  preferWaitSeconds?: number;         // ≤60, só utilitários CPU/TTS — otimização, não substituto
}

export function createOfficialPrediction(token, owner, name, opts): Promise<Prediction>;
  // POST /v1/models/{owner}/{name}/predictions — official, billing por output, sem version
export function createVersionedPrediction(token, versionHash, opts): Promise<Prediction>;
  // POST /v1/predictions {version, input, webhook, webhook_events_filter} — community pinnado
export function getPrediction(token, id): Promise<Prediction>;
export function cancelPrediction(token, id): Promise<void>;
export function fetchWebhookSigningSecret(token): Promise<string>;  // GET /v1/webhooks/default/secret
export function streamToBucket(service, url, bucket, path, contentType): Promise<{path; bytes}>;
export function classifyReplicateError(status, body): {
  code: 'auth' | 'input' | 'moderation' | 'transient' | 'unknown';
  message: string;   // pt-BR acionável
};
```

Regras do client:

- **Headers**: `Authorization: Bearer ${token}`, `Content-Type: application/json`.
- **`Prefer: wait=n`** (1–60s) só para utilitários CPU e TTS, que respondem em segundos. É
  otimização de latência: **todo create leva `webhook` mesmo assim**, porque o wait pode
  expirar e devolver `processing`.
- **Retry na criação**: 3 tentativas com backoff (1s/4s/10s) apenas em rede/5xx/429.
- **Classes de erro** (`classifyReplicateError`) — a distinção que evita a cascata mentirosa:
  - `auth` (401/402/403): **pausa o projeto inteiro** com `error_code='replicate_auth'` e CTA
    "reconfigurar a key em /config". **Não consome tentativa nem fallback** — key revogada com
    6 cenas em voo queimaria 18 tentativas dizendo "input inválido".
  - `input` (400/422): terminal na cena, sem retry (pagar de novo falha igual).
  - `moderation` (NSFW): terminal com mensagem própria.
  - `transient` (5xx/429/rede/`aborted`): elegível a retry e fallback.
- **`version` efetiva** de toda predição vai para `video_predictions.provider_version`.
- **Inputs de arquivo**: sempre **signed URL do bucket privado com 24h de validade** (sobrevive
  a fila e retries). Nunca base64 para mídia; Files API não é usada.
- **Download**: `streamToBucket` faz `fetch` → repassa o `ReadableStream` direto ao endpoint de
  Storage (nunca `arrayBuffer()`), com guarda de `content-length`: acima do teto configurado
  (default 200 MB) a predição vira `failed` com erro acionável em vez de derrubar o worker.
  Download com 404 → `failed` com "o arquivo gerado expirou antes de ser salvo", **sem loop**.

### 1.2 Validação da assinatura do webhook (padrão svix)

Mesma filosofia do `zernio-webhook`: HMAC antes de qualquer efeito colateral, falha fechada.

1. Headers `webhook-id`, `webhook-timestamp` (epoch em segundos), `webhook-signature` (lista
   separada por espaço, itens `v1,<base64>`). Faltou algum → 401.
2. **Anti-replay**: `|agora − timestamp| > 300s` → 401.
3. `signedContent = ${webhookId}.${webhookTimestamp}.${rawBody}` — **corpo cru**, antes de
   qualquer `JSON.parse`.
4. Chave HMAC = **base64-decode do que vem depois de `whsec_`** no `REPLICATE_WEBHOOK_SECRET`.
5. `crypto.subtle.importKey('raw', …, {name:'HMAC', hash:'SHA-256'})` → `sign` → base64.
6. Comparação em **tempo constante** contra **cada** assinatura do header (sem o prefixo `v1,`);
   uma bater basta.
7. Sem secret no Vault → 401 a tudo.

**Idempotência é obrigatória**: o Replicate retenta o `completed` com backoff repetindo o
`webhook-id`. Redelivery é no-op (§3.4).

### 1.3 `_shared/video-catalog.ts` — o catálogo como dado

A orquestração **nunca** cita um modelo pelo nome: pede uma capability e recebe modelo + input
montado. Trocar `veed/fabric-1.0` por `bytedance/omni-human` é `UPDATE` numa linha.

```ts
export type VideoCapability =
  | 'avatar_identity'   // gerar/variar o retrato canônico do avatar (imagem)
  | 'keyframe'          // keyframe 9:16 da cena, com o identity pack como referência
  | 'talking_avatar'    // imagem + áudio → vídeo falado (lipsync embutido)
  | 'scene_i2v'         // keyframe → vídeo de cena
  | 'scene_t2v'         // texto → vídeo (b-roll sem keyframe)
  | 'tts'               // texto → mp3 pt-BR
  | 'util_normalize'    // → MP4 H.264 padrão (pré-concat)
  | 'util_concat'       // [vídeos] → MP4
  | 'util_audio_merge'; // vídeo + áudio → MP4
```

**Como um modelo novo entra sem deploy** (requisito 2 do Tiago levado a sério): o mapeamento de
input é um **template declarativo** em `video_models.input_template` (jsonb), com placeholders
resolvidos pelo motor:

```jsonc
// veed/fabric-1.0 — talking_avatar
{ "image": "{{keyframe_url}}", "audio": "{{audio_url}}", "resolution": "720p" }

// bytedance/seedance-1-lite — scene_i2v
{ "prompt": "{{prompt}}", "image": "{{keyframe_url}}", "aspect_ratio": "9:16",
  "resolution": "720p", "duration": "{{duration_int}}" }
```

Placeholders suportados: `{{prompt}}`, `{{negative_prompt}}`, `{{keyframe_url}}`,
`{{audio_url}}`, `{{video_url}}`, `{{reference_urls}}` (array), `{{duration_int}}`
(já resolvido ao bucket permitido do modelo), `{{duration_bucket}}`, `{{text}}`.
Só modelo com schema excêntrico ganha `InputMapper` em código. Assim **trocar é dado e
adicionar também é dado** — deploy só para o caso raro.

`limits` guarda o que a §A1 verificou e que o motor precisa para não tomar 422:

```jsonc
{ "durations": [5, 10],           // enum discreto (kling) — ausente = contínuo
  "duration_min": 4, "duration_max": 12,   // faixa contínua (seedance)
  "aspect_ratios": ["9:16"], "resolutions": ["720p"], "max_refs": 14 }
```

**Seleção default do MVP** (existência de todos os slugs verificada — Apêndice A; **preço a
confirmar por `validate_catalog`**):

| capability | primário | fallback | por quê |
|---|---|---|---|
| `tts` | `minimax/speech-02-hd` | `minimax/speech-2.8-hd` | `language_boost: "Portuguese"` confirmado no schema; os dois slugs existem com input idêntico — `validate_catalog` decide qual é o corrente |
| `keyframe` | `google/nano-banana-2` | `google/nano-banana-pro` | `image_input` (array de refs) + `aspect_ratio: "9:16"` confirmados — é o que dá o mesmo avatar em N cenas |
| `avatar_identity` | `google/nano-banana-2` | `black-forest-labs/flux-kontext-pro` | kontext edita preservando rosto (`input_image` + `match_input_image`) |
| `talking_avatar` | `veed/fabric-1.0` | `bytedance/omni-human` | input `image`+`audio` puro, até 60s, resolução 480p/720p; pt-BR perfeito porque o áudio é nosso |
| `scene_i2v` | `bytedance/seedance-1-lite` | `kwaivgi/kling-v2.5-turbo-pro` | seedance aceita **duração contínua 4–12s** (casa com o áudio); kling só 5 ou 10 |
| `scene_t2v` | `bytedance/seedance-1-lite` | `pixverse/pixverse-v6` | mesmo modelo sem `image`; 9:16 confirmado nos dois |
| `util_normalize` | `fofr/toolkit` (`task: convert_input_to_mp4`) | — | community: **pinnar `version_hash`** |
| `util_concat` | `bfirsh/concatenate-videos` | — | community: **pinnar `version_hash`** |
| `util_audio_merge` | `lucataco/video-audio-merge` | — | `duration_mode: 'audio'` resolve descasamento áudio/vídeo |

Regra dura: **official model no caminho feliz** (billing por output, sem cold start); community
só nos três utilitários CPU, sempre pinnados por `version_hash`. Os utilitários são de
mantenedores individuais e **não têm fallback** — risco aceito e registrado (§9).

---

## 2. Modelo de dados

### 2.1 Enums e canal (três migrations — a ordem importa)

```sql
-- Migration A (ISOLADA — alter type não convive com uso do valor na mesma transação)
alter type public.channel_type add value if not exists 'instagram_reel';

-- Migration B: o canal precisa EXISTIR como linha, senão a saga e a UI não o enxergam
-- (targetChannels()/enabledChannels() derivam tudo de `channels`; seed é por migration).
insert into public.channels (type, enabled, config)
values ('instagram_reel', false, '{"aspect_ratio":"9:16","cutoff_score":8,
         "target_duration_s":30,"resolution":"720p"}'::jsonb)
on conflict (type) do nothing;

-- Migration B (continuação): enums do domínio de vídeo
do $$ begin create type public.video_project_status as enum (
  'storyboard',         -- cenas roteirizadas; edição livre e gratuita
  'generating_audio',   -- TTS + keyframes em produção (centavos)
  'keyframes_review',   -- PORTÃO HUMANO: aprovar os keyframes antes de gastar em vídeo
  'generating_scenes', 'scenes_ready', 'assembling',
  'ready',              -- mp4 final no bucket, aguardando aprovação editorial
  'attention',          -- ≥1 cena failed e nada em voo — CTA por cena, o resto preservado
  'paused',             -- classe auth: key inválida/sem crédito; retomável sem perder nada
  'failed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin create type public.video_scene_status as enum (
  'planned','generating_audio','generating_keyframe','keyframe_ready',
  'generating_video','ready','stale','failed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin create type public.video_prediction_kind as enum (
  'tts','keyframe','avatar_identity','scene_video','normalize','concat','audio_merge');
exception when duplicate_object then null; end $$;

do $$ begin create type public.video_prediction_status as enum (
  'queued','submitted','processing','downloading','succeeded','failed','canceled');
exception when duplicate_object then null; end $$;
```

`aborted` do Replicate (deadline estourado antes de rodar) **mapeia para `failed` transiente** —
elegível a retry, sem valor próprio no enum.

### 2.2 `brand_avatars` — ativo da marca (gerar 1x, usar em N vídeos)

Entidade múltipla (N avatares nomeados), não o shape versionado append-only das 4 tabelas de
marca.

```sql
create table if not exists public.brand_avatars (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' check (status in ('active','archived')),
  is_default boolean not null default false,
  reference_image_path text,                          -- brand-assets: avatars/{id}/reference.png
  identity_pack_paths text[] not null default '{}',   -- 2-4 imagens canônicas (entram como refs)
  appearance_prompt text,                             -- descrição textual, entra nos prompts
  voice jsonb not null default '{}'::jsonb,
  -- { provider:'replicate'|'elevenlabs', voice_id:'…', language_boost:'Portuguese',
  --   speed:1.0, emotion:'auto' }
  provider_refs jsonb not null default '{}'::jsonb,
  versions jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists brand_avatars_one_default
  on public.brand_avatars (is_default) where is_default and status = 'active';
-- RLS: select authenticated; escrita admin (padrão brand_kit). Trigger updated_at padrão.
```

### 2.3 `video_projects` — camada de produção da peça Reel

```sql
create table if not exists public.video_projects (
  id uuid primary key default gen_random_uuid(),
  piece_id uuid not null unique references public.content_pieces(id) on delete cascade,
  status public.video_project_status not null default 'storyboard',
  avatar_id uuid references public.brand_avatars(id) on delete set null,
  style_bible text,
  resolution text not null default '720p',       -- FIXA por projeto (regra 4 da §0)
  settings jsonb not null default '{}'::jsonb,
  final_video_path text,
  final_meta jsonb not null default '{}'::jsonb,
  estimated_cost_usd numeric(10,4),
  actual_cost_usd numeric(10,4) not null default 0,
  error text,
  error_code text,                                -- 'replicate_auth' | 'budget' | …
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- RLS: select authenticated; toda transição via service role. Realtime: replica identity full.
```

### 2.4 `video_scenes` — a unidade de regeneração parcial

```sql
create table if not exists public.video_scenes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.video_projects(id) on delete cascade,
  scene_index int not null,
  beat_index int not null,                       -- rastreabilidade com o roteiro auditado
  role text not null check (role in ('hook','desenvolvimento','cta')),
  type text not null check (type in ('avatar','broll')),   -- text_motion CORTADO do MVP (§8 D5)
  narration text not null,
  narration_hash text,                           -- decide reuso do TTS
  narration_diverged boolean not null default false,  -- editada à mão → auditoria não cobre mais
  on_screen_text text,                           -- ARMAZENADO, não renderizado no MVP (§9)
  visual_prompt text not null,
  duration_target_s numeric(5,2) not null,
  audio_duration_s numeric(5,2),                 -- calculada do mp3 CBR (§3.3)
  continuity jsonb not null default '{}'::jsonb,
  model_overrides jsonb not null default '{}'::jsonb,   -- coluna existe; UI não expõe no MVP
  status public.video_scene_status not null default 'planned',
  keyframe_path text, audio_path text, video_path text, final_path text,
  cost_usd numeric(10,4) not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint video_scenes_order unique (project_id, scene_index) deferrable initially immediate
);
-- RLS: select authenticated; escrita service role. Realtime habilitado.
```

O `unique` é **`deferrable`** de propósito: reordenar cenas com updates diretos viola a
constraint no meio da operação. `reorder_scenes` roda numa RPC com `set constraints … deferred`.

### 2.5 `video_predictions` — ledger e máquina de retomada (1 linha por chamada paga)

```sql
create table if not exists public.video_predictions (
  id uuid primary key default gen_random_uuid(),
  -- EXATAMENTE um alvo: projeto (montagem), cena, ou avatar (avatar-studio não tem projeto)
  project_id uuid references public.video_projects(id) on delete cascade,
  scene_id uuid references public.video_scenes(id) on delete cascade,
  avatar_id uuid references public.brand_avatars(id) on delete cascade,
  constraint video_predictions_one_target check (
    (project_id is not null)::int + (avatar_id is not null)::int = 1
    and (scene_id is null or project_id is not null)),
  kind public.video_prediction_kind not null,
  provider text not null default 'replicate' check (provider in ('replicate','elevenlabs')),
  model_id text not null,
  provider_prediction_id text unique,
  provider_version text,
  input jsonb not null default '{}'::jsonb,      -- paths, NUNCA signed URLs (elas expiram)
  input_fingerprint text,                        -- narration_hash + prompt hash congelados
  status public.video_prediction_status not null default 'queued',
  output_path text, error text, error_code text,
  attempt int not null default 1,
  fallback_of uuid references public.video_predictions(id),
  cost_estimated_usd numeric(10,4),
  cost_actual_usd numeric(10,4),
  submitted_at timestamptz,                      -- watchdog mede DAQUI (nunca de updated_at)
  last_checked_at timestamptz,                   -- o reconciliador escreve AQUI
  superseded_at timestamptz,                     -- montagem invalidada por regeneração
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- SINGLE-FLIGHT: um job ativo por alvo+etapa. 23505 no insert = 409, não erro.
create unique index if not exists video_predictions_active_scene
  on public.video_predictions (scene_id, kind)
  where scene_id is not null and status in ('queued','submitted','processing','downloading');
create unique index if not exists video_predictions_active_project
  on public.video_predictions (project_id, kind)
  where scene_id is null and project_id is not null
    and status in ('queued','submitted','processing','downloading');
create unique index if not exists video_predictions_active_avatar
  on public.video_predictions (avatar_id, kind)
  where avatar_id is not null and status in ('queued','submitted','processing','downloading');

-- 'queued' ENTRA no predicado: claim criado + POST falho deixava a cena presa para sempre.
create index if not exists video_predictions_watchdog_idx
  on public.video_predictions (created_at)
  where status in ('queued','submitted','processing','downloading');
-- RLS: select authenticated; escrita service role. Sem Realtime (a UI observa scenes/projects).
```

**Regenerar supera, nunca apaga.** Ao regerar uma cena, a montagem anterior deixa de valer — mas
as predições de `concat`/`normalize` concluídas recebem `superseded_at` em vez de serem deletadas.
Elas somem das buscas de "esta etapa já está pronta" e **continuam contando no gasto do mês**, que
é o correto: o dinheiro foi gasto. Apagá-las faria o teto mensal esquecer o que já foi pago a cada
regeneração.

### 2.6 `video_models` — o catálogo

```sql
create table if not exists public.video_models (
  id uuid primary key default gen_random_uuid(),
  capability text not null,
  model_id text not null,
  kind text not null check (kind in ('official','community')),
  version_hash text,                     -- obrigatório para community (validado no código)
  cost jsonb not null,                   -- {unit:'per_second'|'per_run'|'per_image'|'per_1k_chars', usd}
  cost_verified_at timestamptz,          -- null = estimativa humana, NÃO confiar (§6.3)
  limits jsonb not null default '{}'::jsonb,
  input_template jsonb not null default '{}'::jsonb,   -- §1.3 — o que torna "adicionar" um dado
  fallback_model_id text,
  active boolean not null default true,
  is_primary boolean not null default false,
  last_validated_at timestamptz,         -- preenchido por validate_catalog
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (capability, model_id)
);
create unique index if not exists video_models_one_primary
  on public.video_models (capability) where is_primary and active;
-- RLS: select authenticated (UI monta estimativas); escrita admin.
```

### 2.7 Ponte com `content_pieces` e publicação

- O **editorial** (`script.beats[]` + `caption`) sai da saga e vive em `adapted_content` do canal
  `instagram_reel`. A **produção** vive nas tabelas acima — cenas não são duplicadas no jsonb.
- Quando a montagem conclui, `merge_piece_adapted_content` grava **um ponteiro**:
  ```jsonc
  "video": { "path":"video/{project_id}/final-{ts}.mp4", "duration_s":34,
             "project_id":"uuid", "resolution":"720p", "generated_at":"…" }
  ```
- `render_spec` ganha `kind: 'reel'` (a union é fechada — editar `_shared/render-spec.ts`).
- **Publicação não é "só mapping"** (achado do dev sênior): `zernio-proxy` hoje fixa
  `contentType: 'image/png'` no upload e `type: 'image'` nos `mediaItems`, e `buildPostBody` tem
  switch exaustivo por `ChannelType`. Reel exige: ler `adapted_content.video.path`, presign com
  `video/mp4`, `mediaItem type:'video'` e o `InstagramPlatformData.contentType` correto — cujo
  vocabulário (`'Reels'`? `'reels'`?) **precisa ser conferido na spec do Zernio antes de fixar**
  (o código atual usa `'story'` minúsculo). Isso é tarefa própria da F3, com E2E real.

### 2.8 Cotas e orçamento

```sql
update public.app_settings set value = value
  || '{"video-scene":   {"max": 30, "window_minutes": 60}}'::jsonb
 where key = 'rate_limits' and not (value ? 'video-scene');
update public.app_settings set value = value
  || '{"video-project": {"max": 5,  "window_minutes": 1440}}'::jsonb
 where key = 'rate_limits' and not (value ? 'video-project');
update public.app_settings set value = value
  || '{"avatar-studio": {"max": 10, "window_minutes": 60}}'::jsonb
 where key = 'rate_limits' and not (value ? 'avatar-studio');

insert into public.app_settings (key, value) values ('video_budget', '{
  "monthly_cap_usd": 100, "max_download_mb": 200, "max_total_duration_s": 60
}'::jsonb) on conflict (key) do nothing;
```

O guard `and not (value ? 'chave')` é a regra da casa: re-aplicar migration não pode sobrescrever
tuning do admin.

**O teto mensal soma `video_predictions`, não `usage_events`** — `usage_events` não tem coluna de
custo e é purgada às 24h; um somatório mensal ali nunca funcionaria:

```sql
select coalesce(sum(coalesce(cost_actual_usd, cost_estimated_usd)), 0)
  from public.video_predictions
 where created_at >= date_trunc('month', now());
```

`$100/mês` como default vem da aritmética real: um Reel de 30s com avatar custa da ordem de
$3–6; $25 daria 3 vídeos/mês contra um rate limit que permite 5 projetos/dia — as duas camadas
se contradiriam.

---

## 3. Orquestração assíncrona

### 3.1 Princípio: orquestrador reentrante

O motor é `advance()` em `_shared/video-pipeline.ts` — puro, idempotente, sem LLM, sem espera.
Olha o estado persistido, decide o **próximo artefato faltante** e cria **uma** predição para ele
(claim por índice único; `23505` = outro gatilho chegou primeiro → no-op). Três gatilhos chamam a
mesma função: dispatch do usuário, webhook e reconciliador.

```ts
export async function advanceScene(service, token, sceneId): Promise<void>;
export async function advanceProject(service, token, projectId): Promise<void>;
export async function settlePrediction(service, token, p: Prediction): Promise<void>;
export async function recomputeProjectStatus(service, projectId): Promise<void>;
```

### 3.2 Máquina de estados da cena

```
planned
  └─▶ generating_audio     TTS (reusa o mp3 se narration_hash não mudou)
        └─▶ generating_keyframe   keyframe 9:16 com identity pack como referência
              └─▶ keyframe_ready  ══ PORTÃO HUMANO do projeto (keyframes_review) ══
                    └─▶ generating_video
                          ├─ type=avatar: talking_avatar (keyframe + mp3) ─────────▶ ready
                          └─ type=broll:  scene_i2v (mudo) → audio_merge do VO ────▶ ready
falha: 2 tentativas no primário → 1 no fallback → failed acionável
edição pós-render → stale (o vídeo antigo é preservado até regenerar)
```

**Áudio antes de tudo** é regra: a duração real do áudio é a duração-verdade da cena.

**Status do projeto**, com a regra que fechava o buraco do limbo: `recomputeProjectStatus` roda a
cada `settlePrediction` com `UPDATE … WHERE status = <esperado>` (tolerante a corrida), e
**zero predições ativas + ≥1 cena `failed` → projeto vai para `attention`** (nunca fica girando
spinner, nunca perde as cenas prontas).

### 3.3 Duração: como é resolvida sem ffprobe

O TTS retorna **apenas a URL do mp3** — verificado no schema de output, sem campo de duração. E a
edge function não tem ffprobe. A solução é determinística porque **nós escolhemos os parâmetros**:
pedimos `audio_format: 'mp3'` com `bitrate: 128000` (CBR), então

```
audio_duration_s ≈ (bytes × 8) / 128000
```

`streamToBucket` devolve `bytes` **contados durante o pipe**, não lidos do `content-length` — o
header é opcional e uma resposta chunked devolveria zero, colapsando a duração de toda cena de
b-roll. É também durante o pipe que o teto de tamanho é aplicado de verdade. Margem de erro de
fração de segundo, suficiente para escolher a duração do clipe. Três consequências:

- **Cena de avatar**: `veed/fabric-1.0` e `omni-human` recebem só `image` + `audio` — a duração sai
  do áudio sozinha. Nada a calcular.
- **Cena de b-roll**: `seedance-1-lite` aceita duração **contínua 4–12s** → `ceil(audio + 0,4s)`,
  respeitando `limits`. Em modelo de duração discreta (kling: 5 ou 10) escolhe-se o **menor bucket
  ≥ áudio**.
- **Descasamento residual**: o mux usa `lucataco/video-audio-merge` com `duration_mode: 'audio'`
  e `replace_audio: true` — o vídeo sempre nasce ≥ o áudio e é o áudio que define o corte, então a
  fala nunca é cortada no meio.

### 3.4 `replicate-webhook` (verify_jwt=false, HMAC)

A URL registrada em toda predição é
`{SUPABASE_URL}/functions/v1/replicate-webhook?pid=<uuid interno>`.
O `pid` existe por um motivo caro: se a function morre entre o `POST` no Replicate (dinheiro já
comprometido) e o `UPDATE` que grava o `provider_prediction_id`, o webhook chegaria com um id
desconhecido e seria descartado — e o retry pagaria de novo por um vídeo que já foi gerado.

Fluxo:

1. Corpo cru → `verifyReplicateSignature` (§1.2). Falhou → 401, zero efeitos. Cap de corpo 2 MB
   (o payload `completed` traz `input` e `logs`; rejeitar por tamanho perderia o vídeo).
2. Resolver a linha por `provider_prediction_id`; se não achar, **por `pid`** — e nesse caso
   **adotar** a predição gravando o id. Nada resolvido → **200** (ack; nunca alimentar retry).
   Já terminal → **200** (redelivery é no-op).
3. Responder **200 na hora**; trabalho pesado em `EdgeRuntime.waitUntil`:
   - `succeeded` → `downloading` → `streamToBucket` → grava `output_path`, `provider_version`,
     `cost_actual_usd` → `succeeded` → `settlePrediction` avança e cria a próxima predição.
   - `failed`/`canceled`/`aborted` → classe do erro (§1.1) decide retry, fallback, pausa do
     projeto ou cena `failed`.
4. Estado terminal **nunca** é rebaixado por redelivery atrasada (regra do `zernio-webhook`).
5. Antes de marcar `ready`, comparar o `input_fingerprint` congelado na predição com o estado
   atual da cena: se o usuário editou a narração durante a geração, a cena vai para **`stale`**,
   não para `ready` — nunca se aprova um Reel que diz coisa diferente do roteiro.

### 3.5 Rede de segurança (dois mecanismos que não se anulam)

1. **`video-reconcile`** (edge function, `verify_jwt=false` + `x-cron-secret` do Vault **ou** JWT
   de admin — mesmo predicado do `fetch-rss`): cron `*/5`. Pega predições ativas com
   `last_checked_at` velho, faz `GET /v1/predictions/{id}` (cap 20 por execução) e manda terminais
   para o **mesmo `settlePrediction`** do webhook. Escreve **só em `last_checked_at`**.
2. **`mark_stale_video_predictions_failed()`** (pg_cron): compara com **`created_at`/`submitted_at`**,
   nunca `updated_at`. Se o reconciliador tocasse `updated_at`, ele rejuvenesceria a linha a cada
   5 min e o watchdog **nunca dispararia** — os dois mecanismos se anulariam. Teto: 35 min
   (o timeout duro do Replicate é 30 min + margem); `queued` tem teto curto de 10 min.

O cron precisa de `app_settings.instance_url`, que hoje **só o `fetch-rss` auto-registra**: o
`video-reconcile` e o `setup` também fazem esse upsert a partir de `SUPABASE_URL`, senão o
`pg_net` vira no-op silencioso e a rede de segurança inteira não existe.

Heartbeat: o reconciliador grava `app_settings.video_reconcile_heartbeat`; a UI de /config alerta
se parou há mais de 15 min — é o detector de "webhook secret errado depois que o cliente trocou de
conta Replicate", em que todos os webhooks passam a dar 401 em silêncio.

### 3.6 Retry, fallback e concorrência

- Transiente: mesma predição recriada (`attempt+1`) até 2x.
- 2 falhas no primário → predição no `fallback_model_id` com o mesmo envelope; `fallback_of`
  encadeia. Falhou também → cena `failed` acionável.
- `input`/`moderation` → terminal, sem retry.
- `auth` → **projeto `paused`**, sem consumir tentativas.
- Cancelar propaga `POST /v1/predictions/{id}/cancel`.
- **Orçamento**: o check do teto mensal soma `video_predictions` antes de cada lote. **Não há
  advisory lock na F1** — dois `start_production` disparados no mesmo instante podem passar
  juntos e estourar o cap por um lote. É aceito conscientemente porque o cap é *advisório*
  (repousa em preços não verificados) e o guard duro é o `consume_rate_limit`, que conta
  invocações e é atômico no banco. Serializar o check é P1.
- **`assemble` é CAS**: `UPDATE video_projects SET status='assembling' WHERE id=$1 AND
  status='scenes_ready'`. E `regenerate_scene` responde 409 enquanto o projeto está `assembling` —
  senão o concat pega um `final_path` sendo substituído.
- **`update_scene` responde 409** quando há predição ativa naquela cena.

### 3.7 Montagem

Edge function não roda ffmpeg. A montagem é ela própria uma cadeia de predições, com os mesmos
webhook, watchdog e ledger:

1. **Mux por cena** (`lucataco/video-audio-merge`, `duration_mode:'audio'`): só cenas `broll` — as
   de avatar já saem faladas. Resultado = `final_path` da cena.
2. **Normalize** (`fofr/toolkit`, `task: convert_input_to_mp4`): **sempre**, em todas as cenas.
   Codec divergente é a causa nº 1 de concat quebrado. Ele **não reescala** — por isso a resolução
   é fixada em 720p na geração (§0, regra 4).
3. **Concat** (`bfirsh/concatenate-videos`): lista ordenada por `scene_index` → mp4 único.
4. Download → `renders/video/{project_id}/final-{ts}.mp4` → ponteiro em `adapted_content` → `ready`.

Custo da montagem: centavos. Regenerar uma cena re-roda os passos dela e o concat; as outras cenas
não são tocadas.

---

## 4. Contratos das edge functions

### 4.1 `generate-video` (verify_jwt=true) — porta única de comando

```ts
type GenerateVideoRequest =
  | { action:'create_storyboard'; piece_id: string; avatar_id?: string }
  | { action:'update_scene'; scene_id: string; patch: {
        narration?: string; visual_prompt?: string; duration_target_s?: number;
        type?: 'avatar'|'broll' } }
  | { action:'reorder_scenes'; project_id: string; order: string[] }
  | { action:'add_scene' | 'delete_scene'; /* … */ }
  | { action:'estimate'; project_id: string; scene_ids?: string[] }        // sem efeitos
  | { action:'start_production'; project_id: string; confirmed_cost_usd: number }
  | { action:'approve_keyframes'; project_id: string; confirmed_cost_usd: number }
  | { action:'regenerate_scene'; scene_id: string; from: 'audio'|'keyframe'|'video';
      redirect?: boolean; instruction?: string; confirmed_cost_usd: number }
  | { action:'assemble'; project_id: string }
  | { action:'cancel'; project_id: string }
  | { action:'setup' }              // admin: valida r8_, grava REPLICATE_WEBHOOK_SECRET
  | { action:'validate_catalog' };  // admin: confere slug/schema/preço de cada modelo ativo
```

Três decisões embutidas nesse contrato:

- **`start_production` gera só áudio + keyframes** (centavos). O gasto em vídeo exige um segundo
  ato humano, `approve_keyframes`, depois de ver os quadros. É o portão mais barato do desenho.
- **`regenerate_scene` tem `from`**: o caso real mais comum é "o vídeo saiu ruim, o áudio e o
  keyframe estão ótimos". O pipeline já é por artefato; `from` só escolhe o ponto de reentrada.
- **`update_scene` e a narração**: editar a narração é permitido, roda o `lintText` completo
  (guardrails reais, como a saga) e marca `narration_diverged = true`, exibido na revisão. A
  auditoria editorial (grounding, juiz) vale para o texto aprovado — quando o humano edita, o
  produto **diz** que aquela cena saiu da cobertura, em vez de fingir que continua auditada.

Erros: `409 video_in_flight` (23505), `402 video_budget_exhausted`, `409 verify_flags_pending`
(peça com `[VERIFICAR]` não vira áudio), `400 replicate_not_configured`, `409 project_busy`,
`503 replicate_auth` (projeto pausado).

### 4.2 `replicate-webhook` (verify_jwt=false) — §3.4
### 4.3 `video-reconcile` (verify_jwt=false + `x-cron-secret` ou JWT admin) — §3.5

São a **3ª e a 4ª** functions públicas do projeto. O comentário do `supabase/config.toml` diz hoje
"Exceção ÚNICA: zernio-webhook" — precisa ser reescrito. Rodar `lovable-endpoint-audit` ao fim de
cada fase.

### 4.4 `avatar-studio` (verify_jwt=true, admin)

CRUD de `brand_avatars` + `generate_identity` (descrição → 4 candidatos via `nano-banana-2`),
`bootstrap_from_photo`, `set_default`, `archive`. Usa a mesma máquina de `video_predictions`
(alvo `avatar_id`) e entra na cota `avatar-studio` e no teto mensal — são ações pagas.

### 4.5 Saga e adapters (sem mudança estrutural)

- Novo adapter **determinístico** `_shared/adapters/instagram-reel.ts` (funil de 8 camadas →
  `script.beats[]`, duração ≈ palavras/2,5, `cutoff_score: 8`), registrado no `buildRegistry()`.
  A saga termina em `awaiting_review` como sempre; **nenhum modelo de mídia no caminho do texto**.
- Diretor de cenas e `scene-linter` rodam **dentro de `generate-video`**, nunca na saga, com
  `role_hint: 'generator'` (o `RoleHint` do `llm.ts` é união fechada — reusar 'generator', como o
  `directArt` do `generate-image` já faz).

### 4.6 `store-secret`

Allowlist += `REPLICATE_API_TOKEN` (`^r8_[A-Za-z0-9_-]{20,}$`) e `ELEVENLABS_API_KEY` (BYO
opcional). `REPLICATE_WEBHOOK_SECRET` é gravado pelo `setup`; `VIDEO_CRON_SECRET` nasce por
`vault.create_secret` na migration (padrão do `RSS_CRON_SECRET`).

**Gotcha que mata o `setup` se ignorado**: `store_vault_secret` exige `has_role(auth.uid(),'admin')`
e **lança exceção** — com service client `auth.uid()` é null e falha sempre. O `setup` tem que
chamar a RPC via `createUserClient(req)` com o JWT do admin.

### 4.7 `validate_catalog` — o que fecha o requisito "não assumir modelos"

Para cada linha ativa de `video_models`, com o token real: `GET /v1/models/{owner}/{name}` →
confirma que o slug existe, extrai o `openapi_schema` dos inputs, confere que todo placeholder do
`input_template` corresponde a um campo real e que os `limits` batem com os enums do schema;
grava `last_validated_at` e devolve um relatório. **É o gate de saída da F1** — nenhum modelo entra
em produção sem passar por ele. Preço continua sendo dado humano (`cost_verified_at`).

---

## 5. Fluxo de UI

- **`/criar`**: chip `🎬 Reel` como 8º canal + Collapsible "Opções do Reel" (avatar e voz, default
  de `brand_avatars`). `JobsFeed` inalterado. **O canal nasce `enabled: false` de propósito**
  (§2.1): `enabledChannels()` filtra por `enabled`, então o chip só aparece depois que um admin
  liga o Reel em Marca → Canais. É o interruptor que impede uma instância sem key do Replicate de
  oferecer um formato que não consegue produzir — não é bug.
- **`/biblioteca/$pieceId`**: quando `channel_type === 'instagram_reel'`, renderiza
  `<ReelProjectView>` na mesma rota — lista vertical de `SceneCard` (fala editável, prompt em
  Collapsible, custo por cena), o portão de geração (`GenerationGate` em modo fixo: tile do motor,
  modelo primário do catálogo, estimativa do servidor como teto "até US$ X" e o botão colado a ela) com
  `AlertDialog` de confirmação final, `Progress` durante a geração, **galeria de keyframes com
  [Aprovar e gerar vídeos]**, e no fim player 9:16 +
  Aprovar + `PublishBlock`. Cena `failed` mostra CTA própria; projeto `paused` mostra o banner de
  key. Nada se perde ao fechar a aba: todo progresso é estado de banco alimentado por webhook.
- **`/marca/avatares`**: novo AreaCard no hub `/marca`; grid de avatares, dialog de criação (upload
  de foto | gerar por descrição), preview de voz, `is_default`.
- **Hooks**: `use-video-project(pieceId)` (Realtime em `video_projects` + `video_scenes`, com
  fallback de polling do TanStack Query), `use-avatars`, `use-video-models`.

---

## 6. Segurança e custo

1. **Segredos** — `REPLICATE_API_TOKEN` (BYO do cliente), `ELEVENLABS_API_KEY` (opcional),
   `REPLICATE_WEBHOOK_SECRET`, `VIDEO_CRON_SECRET`: todos no Vault, nunca em resposta HTTP nem em
   `VITE_*`. A UI só vê "configurada".
2. **Funções públicas** — `replicate-webhook` (HMAC svix + anti-replay de 5 min + cap de corpo) e
   `video-reconcile` (cron-secret ou admin), com validação **antes de qualquer efeito colateral**.
3. **Tetos em camadas, do mais duro ao mais frouxo**: single-flight por índice único (duplo clique
   não paga duas vezes) → `consume_rate_limit` por contagem (**o guard duro**) → teto mensal em USD
   (**advisory**, porque depende de preços não verificados) → dois portões humanos (storyboard e
   keyframes).
4. **Paths sempre resolvidos no servidor** a partir do banco; o client nunca aponta arquivo.
   Buckets privados; signed URL só como input de provider (24h) e exibição (1h).
5. **Teto de download** (200 MB) e de duração total (60s) no MVP, com streaming no upload.

---

## 7. Fases

> **Numeração das migrations**: a última no repo é `202608140021`; a `202608140022` foi apagada
> pelo revert e não dá para inspecionar `supabase_migrations` por este proxy. As novas usam a data
> de hoje — `202608170022_reel_channel.sql` (só o `ALTER TYPE`), `202608170023_video_pipeline.sql`
> (seed do canal, enums, tabelas, RLS, Realtime, watchdog, cron, cotas) e
> `202608170024_video_models_seed.sql` — então **não há colisão de `version` mesmo que a linha da
> 22 antiga ainda esteja registrada** no banco.
>
> **Já escrito nesta sessão**: `_shared/replicate.ts` (client, classes de erro, validação svix,
> download em stream, duração do mp3) — `deno check` verde, 18 asserts passando em teste real
> (HMAC válido/adulterado/replay/rotação, contagem de bytes sem `content-length`, teto, 404
> terminal × 503 retentável). Pendente de prova só o comportamento de runtime do
> `storage.upload()` com `ReadableStream` — o tipo é compatível, o efeito real precisa de banco.

**F1 — Fundação (entrega: Reel de b-roll E2E, sem avatar).** Migrations 22/23/24 → `store-secret`
(`r8_`) → `_shared/replicate.ts` + `video-catalog.ts` + `video-pipeline.ts` → adapter
`instagram_reel` + registry + `types.ts` + `render-spec.ts` → `generate-video`
(storyboard/estimate/start/approve_keyframes/cancel/setup/validate_catalog) + `replicate-webhook`
+ `video-reconcile` + `config.toml` → regenerar `src/integrations/supabase/types.ts` via MCP →
`ReelProjectView` mínima.
**Aceite:** comando → roteiro auditado → storyboard → TTS + keyframes → aprovação → 3 cenas
b-roll → concat → mp4 tocando no player, **com a aba fechada durante toda a geração**.
Gate de saída: `validate_catalog` verde + `bunx tsc --noEmit` + `bun run build` +
`lovable-endpoint-audit`.

**F2 — Avatar e fala (entrega: Reel falado).** `brand_avatars` + `/marca/avatares` +
`avatar-studio` → capability `talking_avatar` → keyframes com identity pack → `regenerate_scene`
com `from` → cadeia de fallback ativa.
**Aceite:** o mesmo avatar em 2 vídeos sem reconfigurar; regenerar a cena 3 não toca 1-2-4 e cobra
só a cena 3.

**F3 — Publicação e polimento.** Reel no `zernio-proxy` (upload `video/mp4`, `mediaItem type
video`, `contentType` conferido na spec) com E2E real publicado → re-montagem incremental para
cenas `stale` → ETA por telemetria → docs (este arquivo, 07 Apêndice A, 04, 05).

---

## 8. Decisões

**D1 — Webhook primário; poll só como reconciliação.** Inverte o desenho Higgsfield, cujo poll em
`waitUntil` raspava no teto de ~7,5 min. Custo: duas functions públicas a mais, mitigado por HMAC
em tempo constante + anti-replay + idempotência.

**D2 — Catálogo como dado, com template de input.** Trocar modelo é `UPDATE`; **adicionar** modelo
também, graças ao `input_template` com placeholders. Mapper em código só para schema excêntrico.
Official no caminho feliz; community só nos 3 utilitários, pinnados por hash.

**D3 — Editorial no jsonb, produção em tabelas.** Beat é decisão editorial (auditada); cena é
decisão de produção (regenerável). Narração editada à mão marca `narration_diverged` em vez de
fingir que a auditoria ainda cobre.

**D4 — Voz sempre TTS próprio como input.** pt-BR via `language_boost: "Portuguese"`. Duração
calculada do mp3 CBR a 128 kbps; cena de avatar nem precisa disso (o modelo deriva do áudio).

**D5 — Cortes conscientes do MVP.** Fora: `text_motion` (renderizar no browser contradiz a
montagem server-side e as policies do bucket), `draft_mode`, `keyframe_edit`, `lipsync_post`
(o caminho de fala é `talking_avatar`, com lipsync embutido), override de modelo por cena na UI
(a coluna fica; a superfície de suporte não vale no MVP) e o tier "premium" inteiro do catálogo.
`on_screen_text` é **armazenado e não renderizado** — está no schema para o dia em que houver
legenda queimada, e o doc diz isso para ninguém vender como pronto.

**D6 — Dois portões humanos.** Storyboard (grátis, edição livre) e keyframes (centavos travando
dólares). O segundo é a melhor relação custo/benefício do desenho inteiro.

**D7 — Uma resolução por projeto (720p).** Consequência direta do normalizador disponível não
reescalar. Também corta o risco de OOM no master.

**D8 — Watchdog mede `created_at`, reconciliador escreve `last_checked_at`.** Sem essa separação
os dois se anulam e a rede de segurança não existe. `queued` entra no predicado.

**D9 — `?pid=` na URL do webhook.** Cinco linhas que impedem pagar duas vezes pelo mesmo vídeo
quando a function morre entre o POST e o UPDATE.

**D10 — Classe de erro `auth` pausa o projeto.** Key revogada não vira cascata de "cena falhou".

**D11 — Canal `instagram_reel` (singular)**, coerente com `instagram_post`, com **linha semeada em
`channels`** — sem ela o canal não existe para a saga nem para a UI. TikTok/Shorts não são canais
próprios no MVP.

**D13 — O diretor de cenas NÃO escreve a fala (decidido na implementação, melhora a D3).**
A spec original mandava o LLM devolver a narração e um linter conferir se ela era verbatim.
Implementando, ficou claro que a porta certa é não existir: o diretor recebe os beats já
auditados e devolve **apenas a direção visual** (`style_bible`, `type`, `visual_prompt`,
`continuity`); a narração é copiada por código, palavra por palavra. Com isso o grounding e o
veredito do juiz continuam valendo por construção — nenhum linter precisa defender isso — e a
única forma de a fala divergir do editorial é edição humana explícita, que marca
`narration_diverged` e aparece na revisão. Elimina uma classe inteira de deriva silenciosa.

**D12 — Registro de dívida arquitetural: `video_projects.piece_id` é `NOT NULL UNIQUE`.** Certo
para "um Reel por peça" hoje, errado para a evolução que o Tiago já pediu (novos formatos e
destinos querem *um projeto, N peças*, mesmo mp4 com captions diferentes). Quando isso chegar, a
FK inverte (a peça aponta para o projeto). **Não construir UI que dependa dessa unicidade.**

---

## 9. Riscos aceitos e pendências

| # | Risco / pendência | Mitigação |
|---|---|---|
| 1 | **Sem `REPLICATE_API_TOKEN` no Vault** — nada da F1 pode ser validado E2E | Tiago cadastra em /config → Integrações; `validate_catalog` é o primeiro comando a rodar |
| 2 | **Preços não verificáveis publicamente** | `cost_verified_at` null = estimativa; a cota por contagem é o guard duro, o USD é advisory |
| 3 | Os 3 utilitários de montagem são community sem fallback | `version_hash` pinnado; se sumirem, a montagem cai — monitorar no `validate_catalog` |
| 4 | `concatenate-videos` não documenta limite de N inputs nem de tamanho | Teto de 60s/projeto no MVP; testar na F1 com 5 cenas |
| 5 | `fofr/toolkit` não reescala nem corta | Resolução fixa na geração (D7) |
| 6 | Vocabulário de Reels do Zernio não confirmado | Conferir na spec antes da F3; hoje o código usa `'story'` minúsculo |
| 7 | `on_screen_text` sem renderização | Declarado no doc; não vender como pronto |
| 8 | Política exata de retry do webhook do Replicate | Se a janela for curta, o reconciliador de 5 min vira o caminho comum — o desenho já tolera |
| 9 | `storage.upload()` com `ReadableStream` não foi exercido contra banco real | Tipo compatível verificado; primeiro teste da F1 é justamente persistir um mp3 do TTS |

---

## 10. Runbook de deploy e smoke (F1)

Ordem obrigatória — o banco já está aplicado; falta publicar o código.

1. **Commit + push na `main`.** Antes: `git pull --no-rebase` (o agente do Lovable faz commits
   próprios; rebase/force é proibido neste projeto).
2. **Deploy das edge functions** via MCP do Lovable — o git sync cobre SÓ o frontend. Publicar:
   `generate-video`, `replicate-webhook`, `video-reconcile` e a `store-secret` (allowlist ganhou
   `REPLICATE_API_TOKEN`). Conferir com `lovable_function_detail` se o `lastDeployedCommit` bate.
   Confirmar no `supabase/config.toml` que as duas públicas subiram com `verify_jwt = false` e o
   resto com `true` (o Lovable já subiu function pública como privada uma vez).
3. **`setup`** (admin, em Config → Integrações): grava `REPLICATE_WEBHOOK_SECRET` no Vault.
   **Sem este passo o webhook devolve 401 a tudo** (falha fechada) e o pipeline só anda pelo
   reconciliador de 5 em 5 minutos.
4. **`validate_catalog`** (admin): tem que voltar `broken: 0`. É o gate de saída.
5. **Ligar o canal** em Marca → Canais (`instagram_reel` nasce desligado de propósito).
6. **Smoke E2E**: gerar uma peça de Reel em `/criar` → storyboard → "Gerar áudio e keyframes" →
   conferir os keyframes → aprovar → montar. **Fechar a aba no meio da geração** e confirmar que
   o vídeo termina mesmo assim (é o teste que prova o desenho de webhook). Verificar no banco:
   `video_predictions` com `provider_prediction_id` e `output_path` preenchidos, `cost_actual_usd`
   somando, e o mp4 em `renders/video/{project_id}/`.

> **Enquanto o passo 2 não acontece**: `app_settings.instance_url` já está registrada (o radar RSS
> a gravou), então o cron do reconciliador faz um POST a cada 5 min para uma função que ainda não
> existe — `net._http_response` acumula 404. É inofensivo e para sozinho no deploy.

## Apêndice A — schemas de input verificados (fonte primária)

Extraídos em 2026-08-17 de `https://replicate.com/{slug}/api/schema` (páginas públicas). **Todos os
slugs abaixo existem** — verificado contra controles negativos. Preço não é exposto nessas páginas.

| slug | required | campos que a arquitetura usa |
|---|---|---|
| `veed/fabric-1.0` | `image`, `audio` | `resolution` ∈ {480p, **720p**}. Sem `duration`: **a duração vem do áudio** |
| `bytedance/omni-human` | `image`, `audio` | idem — só os dois campos |
| `bytedance/seedance-1-lite` | `prompt` | `image`; `duration` **contínua 4–12**; `resolution` ∈ {480p,**720p**,1080p}; `aspect_ratio` inclui **9:16**; `reference_images`; `last_frame_image` |
| `kwaivgi/kling-v2.5-turbo-pro` | `prompt` | `start_image`/`image`/`end_image`; `duration` **enum {5,10}**; `aspect_ratio` ∈ {16:9,**9:16**,1:1}; `negative_prompt` |
| `kwaivgi/kling-v2.6` | `prompt` | `start_image`; `duration` {5,10}; `generate_audio` (não usamos); 9:16 |
| `bytedance/seedance-2.0` | `prompt` | `reference_images`/`reference_audios`/`reference_videos`; `duration` −1..15; até 4K; 9:16 |
| `google/veo-3.1-fast` | `prompt` | `image`, `last_frame`; `duration` **enum {4,6,8}**; `aspect_ratio` ∈ {16:9,9:16}; `generate_audio` |
| `minimax/hailuo-2.3` | `prompt` | `first_frame_image`; `duration` {6,10}; `resolution` {768p,1080p} — **sem `aspect_ratio`** (segue a imagem) |
| `pixverse/pixverse-v6` | `prompt` | `image`, `last_frame_image`; `duration` {5,8,10,15}; `quality` {360p…1080p}; 9:16 |
| `wan-video/wan-2.2-i2v-fast` | `prompt`, `image` | `num_frames` 81–121, `frames_per_second` 5–30, `resolution` {480p,720p} — duração indireta |
| `minimax/speech-02-hd` · `speech-2.8-hd` · `speech-02-turbo` | `text` | `voice_id`; **`language_boost` inclui "Portuguese"**; `emotion`; `speed` 0.5–2; `audio_format` {mp3,wav,flac,pcm}; `bitrate` {32k,64k,**128k**,256k}; `subtitle_enable`. **Output: só a URI — sem duração** (§3.3) |
| `google/nano-banana-2` · `nano-banana-pro` | `prompt` | **`image_input` (array de refs)**; `aspect_ratio` inclui **9:16**; `resolution` {1K,2K,4K}; `output_format` |
| `black-forest-labs/flux-kontext-pro` | `prompt` | `input_image`; `aspect_ratio` com `match_input_image`; `safety_tolerance` |
| `sync/lipsync-2` | `video`, `audio` | **`sync_mode` ∈ {loop,bounce,cut_off,silence,remap}** — trata descasamento de duração |
| `kwaivgi/kling-lip-sync` | — | `video_url`/`video_id` + `audio_file` **ou** `text` + `voice_id` (vozes `en_*` — pt-BR não evidente) |
| `bfirsh/concatenate-videos` | `videos` (array) | único campo |
| `lucataco/video-audio-merge` | — | `video_file`, `audio_file`, **`duration_mode` ∈ {video,audio}**, `replace_audio`, `audio_codec`, `video_codec` |
| `fofr/toolkit` | `task`, `input_file` | `task: convert_input_to_mp4` (+ `extract_frames_from_input`, `reverse_video`…), `fps`. **Não reescala nem corta** |

Slugs pesquisados que **não** entram no MVP mas existem: `kwaivgi/kling-v3-video`,
`prunaai/p-video-avatar`, `ideogram-ai/ideogram-character`, `elevenlabs/v3`, `jaaari/kokoro-82m`,
`google/nano-banana`.

## Apêndice B — mecânica da API do Replicate

- **Criação**: official → `POST /v1/models/{owner}/{name}/predictions` (sem version, roda a
  latest); community → `POST /v1/predictions` com `version` hash.
- **Ciclo**: `starting` → `processing` → `succeeded`|`failed`|`canceled`; `aborted` = deadline
  antes de iniciar. **Timeout duro de 30 min.**
- **Webhooks**: `webhook` + `webhook_events_filter` por predição; **só `completed` tem retry
  garantido** (backoff até ~1 min após concluir); assinatura svix; secret por conta em
  `GET /v1/webhooks/default/secret` (`whsec_…`).
- **Outputs expiram em ~1h** (`replicate.delivery`); input/output/logs também são removidos.
- **`Prefer: wait[=n]`** ≤60s — útil só para TTS e utilitários.
- **Inputs de arquivo**: URL HTTPS (signed URL do Supabase funciona), data URI ≤256 KB, ou Files
  API (expira em 24h).
- **Rate limit**: 600 criações/min. **Billing**: official por output; community por tempo de
  hardware (falha em modelo público não cobra).
- **Sem SDK**: REST + `Bearer`, `fetch` e `crypto.subtle` do Deno cobrem tudo.
