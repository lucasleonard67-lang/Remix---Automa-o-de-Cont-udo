# 18 · Lançamento da demo — o que publicar depois do git sync

O git sync do Lovable só leva o frontend. Tudo abaixo precisa ser feito à mão no Lovable (ou pelo agente dele) depois do push, **nesta ordem**. Confira o número da versão de cada função depois do deploy.

## 1. SQL (aplicar antes do deploy das funções)

| Arquivo | O que faz | Obrigatório? |
|---|---|---|
| `supabase/sql/radar.sql` | Colunas de nota em `rss_items` (`relevance`, `virality`, `topics`, `score_reason`, `scored_at`, `priority` gerada) e estado por fonte em `rss_feeds` (`last_ok_at`, `last_error`, `last_error_at`, `last_item_count`) | **Sim** — sem ele o Radar funciona, mas sem notas nem motivo de erro por fonte |
| `supabase/sql/video-engine.sql` | Policy de leitura de `video_models` para `authenticated` (a tela de Vídeos lista o catálogo do Replicate) | **Sim** para o ladrilho Replicate mostrar modelos |
| `supabase/sql/market.sql` | Tabelas `competitors` e `competitor_posts` (Mercado: concorrentes lidos pelo Apify) | **Sim** para o módulo Mercado |
| `supabase/sql/analytics.sql` | Tabelas `post_metrics_daily` e `account_metrics_daily` (colunas novas: `username`, `likes…clicks`, `published_at`, `content`, `url`) que a `metrics-sync` preenche | **Sim** para a rotina diária de métricas e o período "1 ano" no Desempenho |
| `supabase/sql/metrics-sync.sql` | Segredos `METRICS_CRON_SECRET` e `MARKET_CRON_SECRET` no Vault, `app_settings.metrics_sync`, RPCs `invoke_metrics_sync()` e `invoke_market_sync()` (só `service_role`) | **Sim** para os dois crons diários (aplicar depois de `analytics.sql` e `market.sql`) |
| `supabase/sql/director-cron.sql` | Versiona `invoke_director_advance()` (só `service_role`), cria `VIDEO_CRON_SECRET` se faltar, watchdog `mark_stale_director_jobs_failed()` (job de vídeo parado 20 min vira `failed` com motivo) e os crons `content-engine-director-advance` (1 min) e `content-engine-director-watchdog` (5 min) | **Sim** — sem motor agendado o vídeo fica "Na fila" para sempre (aplicar depois de `scripts/pos-remix.sql`, que grava `instance_url`) |

## 2. Edge functions (deploy)

| Função | Motivo |
|---|---|
| `brand-autopilot` | **Nova** — onboarding automático (site + Instagram → marca). `verify_jwt = true` |
| `assistant-chat` | **Nova** — assistente de IA. `verify_jwt = true` |
| `competitor-sync` | **Nova** — Mercado: lê concorrentes no Apify, pontua e compara com os seus posts. Ganhou o caminho de cron (`x-cron-secret` = `MARKET_CRON_SECRET`, roda `sync` até `remaining = 0`, grava `last_run_at` em `app_settings.market`). **`verify_jwt = false`** (a validação é interna: segredo do cron OU JWT de admin) |
| `metrics-sync` | **Nova** — rotina diária que lê o Zernio (seguidores, soma do dia, posts dos últimos 90 dias) e grava em `account_metrics_daily`/`post_metrics_daily`; cursor em `app_settings.metrics_sync`. `verify_jwt = false` (o cron manda `x-cron-secret` = `METRICS_CRON_SECRET`) |
| `brand-kit-suggest` | Identidade visual por 4 origens (site, arquivo, repositório, IA) |
| `store-secret` | Allowlist ganhou `APIFY_TOKEN` e `XAI_API_KEY` (Grok) (ladrilho Apify em Integrações) |
| `fetch-rss` | Reescrita: parser, motivo de erro por fonte, notas. `verify_jwt = false` (o cron manda `x-cron-secret`) |
| `zernio-proxy` | Relatórios de analytics novos (`daily-metrics`, `tiktok-insights`, `youtube-insights`, `content-decay`, `demographics`) |
| `director-plan`, `director-advance` | Escolha de motor/modelo (Higgsfield × Replicate) e driver Replicate nas cenas |
| `mcp-server` | Passou a importar `_shared/assistant-tools.ts` |
| `automation-tick` | Correção do gatilho Radar (coluna `description`) + fecho de imports de `_shared/web-search.ts` |
| `generate-content`, `regenerate-piece`, `resume-job`, `tone-gate` | Fecho de imports de `_shared/web-search.ts` (ganhou `firecrawlScrape`/`firecrawlMap`) |

`_shared/llm.ts` mudou de forma aditiva (papel `assistant`, driver `xai`/Grok, override de provedor por chamada); as demais funções que o importam seguem funcionando sem redeploy.

## 3. Agendamentos (HTTP schedules gerenciados)

Todos com `Authorization: Bearer <LOVABLE_CRON_SECRET>`; cada rota chama o RPC `invoke_*()`, que lê `app_settings.instance_url` + o segredo do Vault e posta na edge com `x-cron-secret`.

| Cron | Rota | RPC → edge | Segredo do Vault |
|---|---|---|---|
| `*/30 * * * *` | `POST /api/public/jobs/rss-fetch` | `invoke_fetch_rss()` → `fetch-rss` | `RSS_CRON_SECRET` |
| `*/15 * * * *` | `POST /api/public/jobs/metrics-sync` | `invoke_metrics_sync()` → `metrics-sync` | `METRICS_CRON_SECRET` |
| `45 3 * * *` | `POST /api/public/jobs/market-sync` | `invoke_market_sync()` → `competitor-sync` (caminho de cron) | `MARKET_CRON_SECRET` |
| `* * * * *` | `POST /api/public/jobs/director-advance` | `invoke_director_advance()` → `director-advance` | `VIDEO_CRON_SECRET` |
| `*/5 * * * *` | `POST /api/public/jobs/video-reconcile` | `invoke_video_reconcile()` → `video-reconcile` | `VIDEO_CRON_SECRET` |
| `7 * * * *` | `POST /api/public/jobs/automation-tick` | `invoke_automation_tick()` → `automation-tick` | `VIDEO_CRON_SECRET` |

O motor de vídeo tem rede dupla: o front cutuca `director-advance` com o JWT do admin ao criar e ao retomar um vídeo, e `supabase/sql/director-cron.sql` agenda o mesmo RPC pelo `pg_cron` (rodar os dois juntos é seguro: a edge faz claim por lease). Conferência: `select jobname, schedule, active from cron.job` e as últimas linhas de `net._http_response` (200 = autenticou; 401 = segredo divergente ou `verify_jwt = true` na função).

A tela do Radar assume 30 min. `app_settings.instance_url` é registrado por qualquer execução de `fetch-rss` ou `metrics-sync` — se os RPCs reclamarem da URL ausente, rode "Atualizar agora" no Radar uma vez. Sem `ZERNIO_API_KEY` a `metrics-sync` sai com `skipped`; sem `APIFY_TOKEN` o cron do Mercado idem. Estado das rotinas: `app_settings.metrics_sync` (`last_run_at`, `last_ok_at`, `last_error`, `cursor`) e `app_settings.market.last_run_at`.

## 4. Roteiro da demo (aluno novo)

1. **Config → Instância → "Resetar onboarding"** (zera `brand_autopilot` e `onboarding`; as versões da marca ficam).
2. `/onboarding`: colar o site e o @ → "Ler minha marca". Acompanhar o stepper (1–3 min; o teste de tom é a etapa longa). Sem Firecrawl o site é lido por fetch simples; sem Zernio, o Instagram fica "não lido" com o motivo ou usa legendas coladas.
3. Revisão em uma página → "Começar a criar" → Dashboard com "O que você quer criar hoje?", sugestões do Radar, primeiros passos.
4. Digitar um tema → Criar já preenchido; ou **Vídeo** → escolher Higgsfield ou Replicate e o modelo.
5. Assistente (botão no canto): "O que falta para publicar?" → botões para a tela certa; "Monte 3 posts para esta semana" → "Criar esta peça".
6. Dashboard → Mercado → "Concorrentes": adicionar 2–3 @ públicos; o módulo mostra "Você × mercado", os 6 posts com melhor desempenho, a nota da IA e "Criar a minha versão".
7. Com Zernio conectado: Desempenho no Dashboard (pulso da semana, gráfico de seguidores × posts, melhor peça, tabela) e "Resultado" na peça publicada.

## 5. Chaves que fazem diferença na demo

- `FIRECRAWL_API_KEY` (Config → IA → Suas chaves de IA): leitura completa do site em sites feitos em React/Wix.
- `ZERNIO_API_KEY` + conta Instagram conectada: leitura dos posts no onboarding, publicação e métricas.
- `REPLICATE_API_TOKEN` + "Verificar modelos": ladrilho Replicate em Vídeos.
- `XAI_API_KEY` (Config → IA → Grok): Grok como provedor de texto.
- `APIFY_TOKEN` (Config → Integrações → Apify): módulo Mercado com os posts dos concorrentes (gasta créditos do Apify).
- Higgsfield conectado: vídeos pelo motor padrão.

## 6. Fora desta entrega

- Refazer um vídeo enviado (vídeo → vídeo): o catálogo não tem modelo com essa capacidade ativo; desenho em `supabase/sql/video-engine.sql`.
- A tabela de publicações do Desempenho ainda lê o Zernio ao vivo; `post_metrics_daily` já é preenchida pela `metrics-sync`, mas nada a lê na tela (fica para o histórico por peça).
- Logo do site no onboarding fica só na revisão (`review.logo_url`), não é baixado para o bucket.
- Página única "Perfil da marca" e entrevista com a IA (fase 3 do plano).
