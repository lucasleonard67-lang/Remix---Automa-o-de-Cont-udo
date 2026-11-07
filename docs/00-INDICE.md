# Content Engine — Specs do Produto (Índice)

Specs geradas em 2026-07-29 a partir do kickoff + decisões do dono do produto. O produto:
**fábrica de conteúdo com governança editorial, single-tenant, provisionada por Remix do
Lovable, com onboarding self-serve como peça central**. Método editorial (funil narrativo de 8
camadas, auditoria em 3 classes, contrato de voz) destilado da squad Yago Martins — que é
referência, nunca dependência.

## Documentos

| Doc | Conteúdo | Responde |
|---|---|---|
| [01-visao-produto.md](01-visao-produto.md) | Problema, ICP, proposta de valor, diferencial, modelo de entrega/receita, North Star, anti-visão | "Por que este produto existe?" |
| [02-escopo-mvp.md](02-escopo-mvp.md) | O "aha", gate de saída, o que entra/fica fora com justificativa, premissas, riscos, critérios de aceite | "O que é o MVP?" |
| [03-features-priorizadas.md](03-features-priorizadas.md) | ~50 features nas 5 famílias do blueprint, repriorizadas (P0/P1/P2), mapeadas a módulo e fase | "O que vem primeiro e por quê?" |
| [04-modelo-de-dados.md](04-modelo-de-dados.md) | DDL completo (tabelas, enums, RLS, triggers, índices), schemas jsonb documentados, buckets, seeds, Vault | "Como o banco é modelado?" |
| [05-rotas-e-modulos.md](05-rotas-e-modulos.md) | Árvore de rotas TanStack, guards, wireframes textuais das telas, componentes e hooks | "Como o app é navegado e montado?" |
| [06-arquitetura-ia.md](06-arquitetura-ia.md) | Papéis de IA, saga de geração, auditoria 3 classes, RAG, abstração de provider (gateway default + BYO), custos | "Como a IA funciona por dentro?" |
| [07-contratos-backend.md](07-contratos-backend.md) | Contrato de cada edge function, _shared, os 7 adapters, segredos, deploy | "Qual é a API interna?" |
| [08-estrategia-template.md](08-estrategia-template.md) | Remix, zero-resíduo, runbook de provisionamento, atualização do motor (git + migrations + ENGINE_VERSION), inventário | "Como nascem e se atualizam as instâncias?" |
| [09-plano-implementacao.md](09-plano-implementacao.md) | Fases F0-F5 com tarefas, caminho crítico, marcos de validação, estimativa, definição de pronto | "Em que ordem construir?" |
| [10-plano-integracoes.md](10-plano-integracoes.md) | Publicação real via Zernio, radar RSS de pautas, vídeo/Reels via Higgsfield — designs, migrations, edge functions, riscos e etapas | "Como fechar o ciclo publicar/pautar/vídeo?" |
| [11-video-replicate.md](11-video-replicate.md) | Infra de geração de vídeo via Replicate: catálogo de modelos como dado, avatar reutilizável, pipeline roteiro→cenas→voz→montagem, webhook + reconciliação, portões de custo. **Substitui o Eixo 3 do doc 10** | "Como o vídeo vira capacidade nativa do produto?" |
| [12-direcao-de-cena.md](12-direcao-de-cena.md) | Base de craft da direção de cena: estrutura narrativa, montagem/ritmo, fotografia/luz (LOOK LOCK industrial), blocking/ação, técnicas de AI-video (flow/first-last frame), retenção e som — cada princípio com fonte e "como o pipeline aplica" | "Por que o diretor-LLM decide assim?" |
| [12-anexo-entregaveis.md](12-anexo-entregaveis.md) | Entregáveis do programa de pesquisa: system prompt novo e completo do diretor de cenas (pronto para colar) + roadmap de features P1-P8 detalhado | "O que implementar com o docs/12?" |
| [13-arquitetura-agentes-video.md](13-arquitetura-agentes-video.md) | Arquitetura do agente profissional de criação de vídeos: pipeline briefing→entrega em escada de custo com portões, 5 agentes (Produtor, Roteirista, Diretor, Arte, Editor), IR único de shot, QC unificado com severidade Murch, identity packs, perfis de formato, estratégia multi-modelo e caminho de generalização do pipeline atual | "Como o vídeo vira produção profissional orientada por agentes?" |
| [13-pesquisa/](13-pesquisa/00-auditoria-cetica.md) | Base de evidência do doc 13: 12 pesquisas especialistas (roteiro, direção, cinematografia, storyboard, arte, consistência IA, continuidade, áudio, edição, capacidades de modelos ago/2026, processo de produção, sistemas multi-agente) + auditoria cética (00) | "Qual a fonte de cada decisão do doc 13?" |
| [14-plano-evolucao-produto.md](14-plano-evolucao-produto.md) | Plano de evolução em 12 pontos, com marcador de status por ponto | "O que falta amadurecer no produto?" |
| [14a-mesa-de-revisao.md](14a-mesa-de-revisao.md) | Especificação da Mesa de Revisão (anexo do ponto 3 do doc 14) | "Como o humano revisa a fila?" |
| [15-runbook-remix.md](15-runbook-remix.md) | Provisionar instância nova a partir do Remix: o que a replicação leva, o que se perde, seeds, Vault, cron, verificação executável e gate de saída | "Como nasce uma instância de cliente?" |
| [16-prompt-configuracao-instancia.md](16-prompt-configuracao-instancia.md) | O prompt pré-montado para colar no chat do Lovable da instância nova, com o que fica de fora (segredos) e por quê | "O que dá para delegar ao agente no provisionamento?" |
| [17-ensaio-geral.md](17-ensaio-geral.md) | Protocolo do ensaio geral (F5.6): Remix de teste, provisionamento, onboarding interpretando um cliente, gate de saída com as consultas de evidência e limpeza de resíduos | "Como provar que o template está pronto antes do primeiro cliente?" |

## Decisões estruturais (registro)

**Do dono do produto (2026-07-29):** sem super admin — onboarding wizard self-serve é a peça
central; provisionamento por Remix do Lovable; backend 100% Supabase Edge Functions;
arquitetura de adapters (Instagram stories/carrossel/post estilo tweet-card, X, Threads,
LinkedIn, Facebook); módulo genérico "Conteúdo de Contexto"; 2 papéis por instância
(admin/user); Yago como referência de método apenas.

**De arquitetura (nesta rodada, consolidadas nos docs):** IA com Lovable AI Gateway como
default zero-config (sem Claude no gateway) + BYO key Anthropic/OpenAI opcional no onboarding
(Vault); contratos canônicos congelados para `classification`, `core_content`, `audit`,
`adapted_content`, persona (9 seções) e telemetria; papéis de IA em inglês (`router`,
`generator`, `judge`, `voice_extractor`, `embeddings`, `image`); trigger `handle_new_user`
bloqueia signup direto quando já há admin (entrada por convite com papel no metadata) +
`has_any_admin()` para o /login; watchdog lê `watchdog_stale_minutes` (10) de settings;
`search-context` como edge function da busca do /contexto; export do tweet-card sobe do
frontend direto ao bucket `renders`; notas de corte default: LinkedIn 9, Stories 7, demais 8;
`editorial_state` criada na F0, feature P1.

**Adendo pós-MVP (2026-07-31):** duas features entregues — **pesquisa web reativa** (etapa
`researching` da saga; toggle em `/criar`; drivers Tavily/Firecrawl/Anthropic/OpenAI em
`_shared/web-search.ts`; distinta do radar F2.12, que segue P2) e **carrossel com fotos IA por
slide + export ZIP** (`generate-image` scope `'slides'` com direção de arte; card segue
client-side determinístico). Ver 02 §9, 03 (F2.15), 04 (§4/§6.9/§8.6-§8.9/§11/§12),
05 (§4.1/§4.2/§4.6), 06 (§3/§5.4/§6) e 07 (§2/§3.1/§3.5/§3.8/§4/§7/§9).

**Lote P1 (2026-08-01):** fotos IA generalizadas para os 3 canais de card (carrossel/stories/post,
modos "Fundo de marca" × "Foto de fundo"), **F3.8 anti-repetição** (`editorial_state` ativo via
RPC `append_editorial_use`), **F4.3 calibração do juiz** (feedback humano como few-shot),
**F4.1 estilo aprovado** (referências de tom fora de `context_ids`, números removidos) e
**F5.4 calendário editorial** (`scheduled_at` + visão Calendário na Biblioteca; sem auto-publish).
Ver 02 §9 (item 4), 03 (tabela P1), 04 (§6.10/§8.6), 05 (§4.2), 06 (§4.5) e 07 (§3.5).

## Pendências consolidadas

Os docs marcam propostas com "(proposta — validar)". Consolidado e triado:

### A. Decisões fechadas pelo dono do produto (2026-07-29)

Preço, packaging, billing, piloto e prazo: fora de escopo de discussão — o dono decide e
faz o deploy quando o escopo funcionar. Decisões registradas: **/marca editável só por
admin** (user comum só visualiza — RLS do 04 já reflete); **catálogo de oferta (kind=offer)
confirmado no MVP**; cards infográficos e atomização seguem P2; escopo completo mantido
(7 adapters), sem corte de prazo.

### B. Técnicas — validar na implementação (não bloqueiam aprovação das specs)

| # | Pendência | Onde |
|---|---|---|
| B1 | IDs exatos dos modelos do Lovable AI Gateway (docs usam indicativos) + modelos default do driver openai | 04, 06, 07, 09 |
| B2 | ~~Replay das migrations no Remix~~ **RESPONDIDO (2026-08-31, medido em dois Remixes):** não há replay — o diretório `supabase/migrations/` nem existe no repo da instância nova (404), nem o ledger `schema_migrations`. Vem só o schema. **Não vêm:** dados semeados, PRIVILÉGIOS (sem os REVOKE, `anon` executa as 25 funções de `public`, `get_vault_secret` inclusive — falha de segurança), publicação do Realtime (nasce vazia), `cron.job`, Vault e o gatilho `on_auth_user_created`. Passo manual: `supabase/seed-instancia.sql` (91 statements) + `scripts/pos-remix.sql`, conferidos por `scripts/verificar-instancia.sql` (28 conferências). | 08, 09, **15**, **16** |
| B3 | Lib de rasterização DOM→PNG do tweet-card (html-to-image ou equivalente) | 05, 07 |
| B4 | Parâmetros do RAG (chunking, RRF, top-N) validados com o golden set; conversão créditos↔tokens do gateway para telemetria | 06 |
| B5 | Limites por canal (280/500/3000/5000/2200) e aspect ratios contra as regras reais das plataformas | 07 |
| B6 | Semânticas de UX: cancelamento de job (policy de update vs function), regenerate-piece (arquiva original?), exclusão de context_item referenciado por peça, transição de job para `done`, resposta 202 do ingest-context | 04, 07 |
| B7 | Hardening: allowlist de nomes no store-secret, exposição mascarada de "key configurada" no /config/ia, checagem de admin dentro de extract-voice/tone-gate, Realtime em context_items | 04, 05, 07 |
| B8 | Validações mínimas por passo do wizard e mecânica de aplicação do niche_template como drafts iniciais | 05 |
| B9 | Prefixo cacheável (motor+persona+guardrails) acima do mínimo de 1024 tokens do claude-sonnet-5 em instância real | 06 |

## Como usar estas specs

1. **Aprovação**: concluída em 2026-07-29 — desenvolvimento autorizado ("só desenvolve").
2. **Construção**: seguir 09 (fases F0-F5), com 04/06/07 como referência técnica de cada fase.
3. **Operação**: 08 é o manual da equipe para provisionar e atualizar instâncias.

Regra de manutenção: estes docs são a fonte de verdade do template. Mudou uma decisão → PR
atualizando o doc correspondente + este índice.
