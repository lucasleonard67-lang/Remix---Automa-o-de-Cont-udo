# 10 — Plano de integrações: Zernio · Radar RSS · Vídeo Higgsfield

> **STATUS (2026-08-13): Eixo 1 IMPLEMENTADO** (commit `c3b44be`): migrations 18/19
> aplicadas, zernio-proxy + zernio-webhook + store-secret deployadas, UI completa
> (Integrações, PublishBlock, calendário, aba Publicadas, Desempenho). Revisão
> adversarial (25 agentes): 17 achados confirmados e corrigidos. **Pendências
> operacionais**: (1) gravar ZERNIO_API_KEY real em Config → Integrações;
> (2) conectar contas OAuth + mapear canais; (3) rodar "Configurar webhook";
> (4) E2E real — validar Stories com N mediaItems (a spec não garante N stories;
> se publicar só 1, dividir em N posts com request_id derivado por frame).
>
> **2026-08-14**: (1)-(3) FEITOS — key gravada, IG @dellanina.co + LinkedIn
> conectados e mapeados, webhook validado com teste real (200). **E2E LinkedIn
> completo**: peça publicada pelo caminho de produção, confirmada pelo webhook
> em ~4s com public_url, e despublicada. **EIXO 2 (Radar RSS) IMPLEMENTADO**:
> migrations 20/21, fetch-rss deployada, /radar no ar com 5 presets pt-BR
> semeados, cron */30 ativo. **EIXO 3 (vídeo Higgsfield) IMPLEMENTADO**
> (commit 7dab429): migration 22 (video_jobs + watchdog), generate-video com
> poll server-side + resume, VideoPanel na peça, card Higgsfield em Config →
> Integrações. Contratos das 3 integrações registrados no docs/07 Apêndice A.
> **2026-08-17 — EIXO 3 REVERTIDO por decisão de produto** (será redesenhado
> após discussão). O rollback removeu: functions generate-video/_shared
> higgsfield+video-models, migration 22 (tabela video_jobs, enum, watchdog,
> cron, seeds), VideoPanel/HiggsfieldKeyCard/hooks, keys HIGGSFIELD_* do Vault
> e os mp4s do smoke. A validação anterior (2026-08-14, DoP ~7min + Kling 2.6
> pt-BR ~5min com cena escrita pelo motor) provou a viabilidade técnica — os
> aprendizados valem para o redesenho: poll server-side + resume funcionam;
> DoP a 7min raspa no teto de ~7,5min da invocação (vídeo longo depende do
> auto-resume); a diretiva de áudio no prompt é obrigatória para pt-BR.
> Eixos 1 (Zernio) e 2 (Radar RSS) permanecem intactos e operacionais.
>
> **2026-08-17 — O EIXO 3 DESTE DOCUMENTO ESTÁ SUPERADO.** O redesenho foi feito e
> vive em **[11-video-replicate.md](11-video-replicate.md)**: geração de vídeo via
> **Replicate** (camada de acesso a modelos, catálogo como dado), com avatar
> reutilizável da marca, pipeline roteiro→cenas→voz→montagem, webhook assinado como
> caminho primário e dois portões humanos de custo. O §Eixo 3 abaixo permanece só
> como registro histórico do ciclo Higgsfield — **não implementar a partir dele**.

> Plano desenhado em 2026-08-13 a partir do gap analysis dos projetos em `../projectsex/`
> (fresh-start-project, start-clean-bloom, viverdeia-solucaodeblog) cruzado com o estado
> atual deste app. Decisão de produto: **publicação via Zernio** (não Post for Me),
> **radar de pauta via RSS** e **vídeo/Reels via Higgsfield**.
> Spec OpenAPI do Zernio: https://zernio.com/openapi.yaml · docs: https://docs.zernio.com

## Visão

Três eixos independentes que juntos fecham o ciclo da fábrica:

```
Radar RSS ──pauta──▶ Saga de geração (existente) ──peça──▶ Revisão humana
                                                              │ approved
                     Higgsfield ──Reel mp4──▶ adapted_content │
                                                              ▼
                              Zernio ──publica/agenda──▶ IG/X/Threads/LinkedIn/FB
                                                              │
                              Analytics Zernio ◀──desempenho──┘
```

- **Ordem recomendada**: Eixo 1 (Zernio) → Eixo 2 (Radar) → Eixo 3 (Vídeo).
  O Zernio é o gap mais visível (hoje nada publica); o Radar alimenta a fábrica;
  o Vídeo se encaixa por cima e publica Reels pelo Zernio já pronto.
- Cada eixo é ~2-3 sessões; são independentes entre si (podem intercalar).

## Fatos da API Zernio (verificados na spec)

- Auth: `Authorization: Bearer sk_<64hex>` — **key de servidor**, só em edge function, via Vault.
- Contas: `POST /v1/profiles` → `GET /v1/connect/{platform}?profileId=…` (URL OAuth) → `GET /v1/accounts`.
- Post: `POST /v1/posts` `{content, mediaItems[{url,type}], platforms[{platform, accountId, customContent?, platformSpecificData?}], scheduledFor?, timezone?, publishNow?}`.
  Instagram Feed/Reels/Stories via `InstagramPlatformData.contentType`.
- Idempotência: header `x-request-id` (janela 5 min → 200 com `existingPost`) + dedup por hash
  de conteúdo em 24h (**HTTP 409** com `details.existingPostId` — adotar, não é erro).
- Mídia: URL HTTPS pública OU `POST /v1/media/presign` → PUT no `uploadUrl` → `publicUrl`
  estável (até 5GB, auto-compressão por plataforma). **Nosso bucket `renders` é privado →
  sempre presign, nunca signed URL do Supabase no payload.**
- Status: `GET /v1/posts/{id}`, `/retry`, `/edit`, `/unpublish` + **webhooks** (HMAC `X-Zernio-Signature`).
- Analytics inclusos: `/v1/analytics`, `instagram/account-insights`, `follower-history`,
  `demographics`, `best-time`, `content-decay`, `posting-frequency`, `post-timeline`,
  `/v1/accounts/follower-stats` → substitui a ideia anterior de analytics via Apify.
- Preço: 2 contas grátis, depois $6/conta (1–10). Conectar os 5 canais da marca passa do free tier.

---

## EIXO 1 — Publicação e agendamento real (Zernio)

**Objetivo**: peça `approved` publica de verdade (agora ou agendada) com status de volta
na peça e no calendário; tela de contas conectadas em /config; aba Desempenho no Dashboard.
Humano no loop: só peça aprovada publica.

### Decisão de agendamento
**Delegar `scheduledFor` ao Zernio** (não pg_cron nosso chamando `publishNow`):
o watchdog (`202607290011_watchdog_cron.sql`) documenta a filosofia de não guardar token
de serviço no banco para pg_net invocar function; o Zernio já faz retry/timezone/limites.
Custo: reagendar/cancelar no `SchedulePieceBlock` precisa propagar (`update-schedule`/`cancel`)
quando já existe post no Zernio — mutation tudo-ou-nada (Zernio primeiro, depois `scheduled_at`).

### Migrations
- `..._publishing.sql`: `ALTER TYPE piece_status ADD VALUE 'published'` (**migration isolada** —
  valor novo não usável na mesma transação); enum `publish_status`
  (pending/scheduled/publishing/published/partial/failed/cancelled); tabela **`published_posts`**
  (piece_id FK, `request_id uuid default gen_random_uuid()` = x-request-id estável p/ retry,
  zernio_post_id unique parcial, platform, account_id, status, scheduled_for, published_at,
  public_url, error, raw jsonb). RLS: select authenticated; **escrita só service role**
  (padrão generation_jobs). Realtime: replica identity full + publication.
- `..._zernio_settings_seed.sql`: `app_settings.zernio = {profile_id, webhook_configured}`.
  Mapa canal→conta: `channels.config.zernio_account_id` (sem tabela nova, policy admin existente).

### Edge functions
- **`zernio-proxy`** (verify_jwt=true; key via `get_vault_secret('ZERNIO_API_KEY')`). Actions:
  `connect-url` [admin] (garante profile, trata 409 profile_name_conflict), `list-accounts`,
  `setup-webhook` [admin] (gera `ZERNIO_WEBHOOK_SECRET` → Vault + registra subscription),
  `publish {piece_id, mode now|schedule}` (baixa renders do bucket com service role → presign →
  PUT → monta post por canal do `adapted_content` → `POST /v1/posts` com x-request-id;
  trata existingPost/409 adotando o post), `get-status` (reconciliação on-demand, não polling),
  `retry`, `update-schedule`, `cancel`, `analytics {report}` (passthrough com **allowlist de rotas**).
- **`zernio-webhook`** (verify_jwt=**false** — única função pública; valida HMAC antes de
  qualquer side effect; sem secret no Vault → 401 a tudo). Eventos post.* → transições em
  `published_posts` + `content_pieces.status='published'`; UI recebe via Realtime.
- **`store-secret`**: allowlist += `ZERNIO_API_KEY` (regex `^sk_[0-9a-f]{64}$`) e
  `ZERNIO_WEBHOOK_SECRET`; trocar `EXPECTED_PREFIX` por validador-função por nome.

### Frontend
- `use-zernio.ts` + `use-published-posts.ts` (Realtime, zero polling).
- /config → aba **Integrações**: ZernioKeyCard, ConnectedAccountsCard (conectar conta abre
  URL OAuth), Select de conta Zernio por canal habilitado → `channels.config`.
- `$pieceId.tsx` → **PublishBlock** no ActionsCard: Publicar agora / Agendar no Zernio;
  badge de status Realtime; link `public_url`; Tentar de novo / Cancelar agendamento.
  `SchedulePieceBlock` propaga reagendamento. `PIECE_STATUSES`/labels ganham `published`.
- Calendário: pip distinguindo agendada-local / agendada-Zernio / publicada; aba "Publicadas".
- Dashboard → seção **Desempenho** (best-time, follower-history, post-timeline × published_posts).
  Carregar skill `dataviz` antes dos gráficos. EmptyState sem key/contas.

### Riscos-chave
Webhook não entregue (mitigar com get-status ao abrir a peça); deriva calendário↔Zernio;
IG exige conta Business (erro só em runtime — exibir error cru); 409 de dedup em peça
regenerada parecida (<24h) — distinguir retry de conteúdo repetido pelo piece_id.

### Etapas
1. Migrations → 2. store-secret + key real → 3. proxy (connect/accounts/webhook-setup) +
config.toml → 4. UI Integrações → 5. publish + get-status (testar IG + X reais) →
6. zernio-webhook + validação → 7. UI da peça → 8. calendário → 9. analytics no Dashboard →
10. `lovable-endpoint-audit` no webhook + commit/push + deploy MCP.

---

## EIXO 2 — Radar de conteúdo RSS

**Objetivo**: feeds do nicho coletados a cada 30 min com dedupe; /radar é mesa de curadoria;
"Gerar peça" compõe o brief (título+resumo+link) e dispara a **saga real** via
`useCreateGenerationJob` (`generate-content` inalterada), com `web_search=true` para
aprofundar a notícia (digest vira context_item auditável do job — máquina F2.15 pronta).
Fase 2 opcional: `auto_generate` por feed com teto diário.

### Migrations
- `..._rss_radar.sql`: `rss_feeds` (name, url unique, active, last_fetched_at, auto_generate);
  `rss_items` (feed_id FK, guid, title, link, description, published_at,
  **`used_in_job_id` FK generation_jobs** — não "used_in_piece_id": 1 job → N peças,
  dismissed_at, UNIQUE(feed_id,guid)). RLS select authenticated / escrita admin+service.
  Seed `app_settings.radar = {auto_generate_daily_cap: 3, fetch_enabled: true}`. Sem Realtime.
- `..._rss_fetch_cron.sql`: `RSS_CRON_SECRET` gerado direto no Vault pela migration
  (sem passo manual); função `invoke_fetch_rss()` security definer lê
  `app_settings.instance_url` + secret e faz `net.http_post` com header `x-cron-secret`;
  cron `*/30 * * * *` idempotente (padrão watchdog). **Nunca hardcodar URL do projeto**
  (lição do remix: `20260720000002_fix_cron_url_dynamic.sql` do fonte).

### Edge function
- **`fetch-rss`** (porta de `viverdeia-solucaodeblog/supabase/functions/fetch-rss/index.ts`):
  parser regex RSS/Atom sem dependências, cap 30 itens/feed, upsert `ignoreDuplicates` em
  (feed_id,guid). Dupla auth: JWT admin (botão "Buscar agora") OU `x-cron-secret` vs Vault.
  Exige `[functions.fetch-rss] verify_jwt = false` no config.toml com validação interna.
  **Auto-registro**: upsert `app_settings.instance_url = env SUPABASE_URL` na 1ª execução —
  runbook do template ganha o passo "clicar Buscar agora após deploy".
  `RSS_CRON_SECRET` **não** entra no store-secret (é interno máquina→máquina).

### Frontend
- Rota `/radar` (sidebar: Radar, entre Criar e Biblioteca), 2 abas:
  - **Notícias** (porte de `admin.news.tsx` reescrito no design system do alvo): filtros
    (busca/status/feed), paginação, Dialog "Gerar peça" (brief editável + canais + toggle
    pesquisa web) → `useCreateGenerationJob` → grava `used_in_job_id` → acompanha via /criar.
    Botão Dispensar.
  - **Fontes** (porte de `admin.feeds.tsx`): CRUD, presets 1-clique, "Buscar agora".
- Hook `use-rss.ts` (Query, refetch pós-ação, sem Realtime).
- Presets pt-BR (validar com curl na implementação): Tecnoblog, TecMundo, Canaltech,
  Olhar Digital, MIT Tech Review Brasil, RD Station, Rock Content, OpenAI News (EN, com badge).

### Regras que NÃO mudam
- **Não** ingerir rss_items como context_items (notícia é efêmera; decisão F2.15 de não
  contaminar o retrieval). Evergreen entra manualmente via /contexto.
- Modo automático (fase 2): claim do item + `runSaga` **in-process** dentro de fetch-rss
  (1 job/execução do cron; `generate-content` exige JWT de usuário, não ganha bypass),
  teto diário contado em generation_jobs.

### Etapas
1. Migration tabelas → 2. fetch-rss + config.toml + deploy MCP + smoke dedupe →
3. migration cron (conferir `cron.job_run_details` 200) → 4. aba Fontes + sidebar →
5. aba Notícias + E2E (notícia → peça em awaiting_review com grounding citando a fonte) →
6. (fase 2) auto_generate → 7. commit/push + atualizar docs/03 (F2.12 parcial) + runbook docs/08.

---

## EIXO 3 — Geração de vídeo (Higgsfield)

**Objetivo**: "Animar este slide" (image-to-video sobre render existente) e "Gerar vídeo do
zero" (text-to-video com direção de cena escrita pelo motor a partir de core_content + brand
kit, áudio nativo pt-BR). MP4 persiste no bucket `renders`, referenciado em
`adapted_content.video`, pronto para download e para virar mediaItem de Reel no Zernio.

### Decisões estruturais
- **Tabela irmã `video_jobs`**, não extensão de generation_jobs (acoplada à saga; ALTER TYPE
  tem gotcha de transação). Mesmo padrão: Realtime + watchdog próprio + claim.
- **Poll server-side** no `EdgeRuntime.waitUntil` (10s, tocando updated_at) — corrige o gotcha
  documentado do bloom (polling client-side para após ~2min e deixa estado preso).
  Fechar a aba não perde o vídeo.
- Worker morto → watchdog `mark_stale_video_jobs_failed` (*/5) marca failed acionável;
  **resume** (botão ou auto-resume do hook com JWT do usuário) reata pelo
  `provider_request_id`. Sem credencial de serviço no banco.
- URL do mp4 da Higgsfield é **efêmera** → worker sempre baixa os bytes e persiste no bucket.
- Vídeo **nunca** escreve em `render_path`; vive em `adapted_content.video/videos[]` via
  `merge_piece_adapted_content` (merge raso — regra do generate-image).
- Áudio pt-BR: a API não tem parâmetro de idioma — portar `buildAudioDirective` do fonte
  (diretiva em linguagem natural prefixada no prompt), senão o Reel sai em inglês.

### Migration
- `..._video_jobs.sql`: enum `video_job_status` (created/submitted/polling/downloading/
  completed/failed/cancelled); tabela `video_jobs` (piece_id, mode animate_slide|text_to_video,
  slide_index, model, params jsonb, provider_request_id, video_path, error); unique index
  parcial `(piece_id, coalesce(slide_index,-1)) where status in (ativos)` = single-flight;
  RLS select authenticated, transições só service role; Realtime; watchdog + cron; seeds
  `rate_limits."generate-video" = {max:10, window_minutes:60}` e `video_defaults`
  (kling 2.6 t2v / dop standard i2v, 5s, áudio pt-BR).

### Edge functions
- **`generate-video`** (verify_jwt=true): actions animate_slide (signed URL 1h do slide →
  i2v), text_to_video (prompt vazio → 1 chamada `chat()` role_hint 'generator' escreve a
  cena do core_content+brand kit, espelho do directArt), cancel, resume. Fluxo:
  enforceRateLimit → insert (unique index = claim, conflito 409) → resposta imediata
  {job_id} → waitUntil: submit → poll → download → upload `renders/{piece_id}/video-{job_id}.mp4`
  → merge adapted_content → completed. Keys `HIGGSFIELD_API_ID/SECRET` só do Vault
  (header `Key {id}:{secret}`); **fallback de headers x-higgsfield-* do fonte NÃO é portado**.
- **`_shared/higgsfield.ts`**: client HTTP + friendlyError + diretiva de áudio (porta de
  `start-clean-bloom/supabase/functions/higgsfield-proxy/index.ts`).
- **`store-secret`**: allowlist += HIGGSFIELD_API_ID (UUID) / HIGGSFIELD_API_SECRET (hex),
  validador por nome + `cleanHfCred` (strip de rótulo colado).

### Catálogo enxuto (`src/lib/video-models.ts` + espelho em `_shared/`)
1. **i2v default**: `higgsfield-ai/dop/standard` (5s, sem áudio, barato) — "animar slide".
2. **t2v default**: `kling-video/v2.6/pro/text-to-video` (5/10s, áudio nativo, validado) — Reels.
3. Atrás de flag: `sora-2/text-to-video` (exige allowlist na conta; 404 → mensagem amigável).
Veo 3 / Kling 3.0 fora do MVP.

### Frontend
- `use-video-jobs.ts` (Realtime + auto-resume silencioso de job polling com updated_at velho).
- `video-panel.tsx` no `$pieceId`: select modelo/duração, toggle áudio, gerar do zero,
  timeline do job, cancelar/retomar, `<video controls>` com signed URL, Baixar MP4
  (via `downloadBlob` existente; ZIP do carrossel não inclui o mp4).
- Botão "Animar" por slide no deck de fotos (habilitado se o slide tem image_path).
- Campos Higgsfield no ByoKeysCard (só configurada/não; valor nunca volta ao front).

### Contrato com o Eixo 1
Registrar em `docs/07-contratos-backend.md`: shape de `adapted_content.video/videos[]`,
regra "vídeo principal = último completed"; o publish do Zernio gera a signed URL na hora
e decide Reel vs canal novo (`instagram_reels` exigiria ALTER TYPE em migration própria —
adiado até precisar).

### Etapas
1. Migration → 2. store-secret → 3. `_shared/` (typecheck verde) → 4. generate-video +
deploy MCP (conferir lastDeployedCommit) → 5. hooks + config → 6. video-panel →
7. contrato em docs/07 → 8. `bunx tsc --noEmit` + build + smoke com key real (Kling 5s pt-BR)
+ E2E animar-slide + commit/push.

---

## Transversais

- **Deploy Lovable**: edge functions NÃO sobem no git push — declarar bloco
  `[functions.<slug>]` no `supabase/config.toml` (mesmo commit) e deploy explícito via MCP,
  conferindo `lastDeployedCommit`. Causa nº 1 de "meu fix não está no ar".
- **Funções públicas** (verify_jwt=false): só `zernio-webhook` e `fetch-rss` — ambas com
  validação interna (HMAC / x-cron-secret) antes de qualquer side effect; rodar
  `lovable-endpoint-audit` ao final de cada eixo.
- **Keys**: tudo via Vault + store-secret; nenhum header/localStorage de key vindo do client
  (padrão dos fontes multi-tenant que NÃO portamos).
- **Verificação por eixo**: `bunx tsc --noEmit` (o build não type-checka) + `bun run build`
  + smoke real + E2E do fluxo do eixo.
- **Descartado do plano anterior**: analytics via Apify (Zernio cobre com a mesma key),
  Post for Me, autopilot-run do bloom (a saga já cobre o pipeline).
