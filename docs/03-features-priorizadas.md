# Features Priorizadas (P0/P1/P2)

Este documento é o catálogo priorizado de funcionalidades do Content Engine. Ele reaproveita as 5 famílias do blueprint original (F1 Identidade, F2 Geração, F3 Qualidade e Governança, F4 Flywheel, F5 Colaboração e Distribuição), mas **repriorizada segundo as decisões do dono do produto**: não existe implementador nem super admin, então tudo que sustenta o onboarding self-serve — incluindo extração assistida de voz, BYO API keys e gate de tom — é P0; o radar/motor de ideias fica em P2 (a geração do MVP é reativa ao comando livre). O escopo consolidado do MVP está em 02-escopo-mvp.md; o detalhamento técnico das features está em 04-modelo-de-dados.md, 05-rotas-e-modulos.md, 06-arquitetura-ia.md e 07-contratos-backend.md; a ordem de construção (fases F0–F5) está em 09-plano-implementacao.md.

> **Convenção de leitura:** `Fx.y` numera **features por família** (herdado do blueprint). A coluna **Fase** usa os códigos **F0–F5 do plano de implementação** (F0 Fundação, F1 Cérebro da marca, F2 Motor de geração, F3 Biblioteca e render, F4 Onboarding, F5 Endurecimento) — são numerações independentes. Features marcadas **(NOVO)** não existiam no catálogo do blueprint. Fase "—" significa pós-MVP (sem fase alocada).

## Régua de prioridade

| Prioridade | Significado |
|---|---|
| **P0** | MVP. Sem isso o gate de saída não fecha: cliente novo faz Remix → onboarding completo sozinho → 3 peças aprovadas no gate de tom → peça multi-canal aprovada em <30 min. |
| **P1** | Primeira expansão pós-MVP: calendário editorial, anti-repetição, flywheel de calibração. O MVP já **armazena** os dados que o P1 consome (ex.: `piece_feedback`). |
| **P2** | Profundidade e automações caras: radar de pautas, publicação automática via OAuth, analytics de cobertura, vídeo/formatos longos, multi-idioma. |

## Tabela mestre

Ordenada por prioridade e, dentro dela, por família.

| Feature | Família | Prioridade | Módulo do produto | Fase | Notas |
|---|---|---|---|---|---|
| F1.1 Wizard de voz (3 entradas) + edição das 9 seções | F1 Identidade | P0 | Onboarding | F1/F4 | Contrato de voz de 9 seções; entrevista guiada quando não há corpus |
| F1.2 Extração assistida de voz (`extract-voice`) | F1 Identidade | P0 | Onboarding | F4 | Reprioritizada de P1→P0: sem implementador, a extração precisa ser self-serve |
| F1.3 Bandeira: promessa, teses, ICP (`brand_strategy`) | F1 Identidade | P0 | Marca | F1/F4 | Destino fixo da camada 8 do funil narrativo |
| F1.4 Editor de guardrails / ban list (`guardrails`) | F1 Identidade | P0 | Marca | F1/F4 | Fonte única, versionada; alimenta o linter determinístico |
| F1.5 Banco de provas/cases (kind=`case`, metadata tipada) | F1 Identidade | P0 | Conteúdo de Contexto | F1 | Métrica tipada `brl\|multiple\|percent`, `source_url`, `citation_policy` |
| F1.6 Pipeline de ingestão (`ingest-context`) | F1 Identidade | P0 | Conteúdo de Contexto | F1 | Reprioritizada de P1→P0: limpeza → chunking → embeddings é pré-requisito do RAG |
| F1.7 Catálogo de oferta (kind=`offer`) | F1 Identidade | P0 | Conteúdo de Contexto | F1 | Elevada a P0: a ponte lógica da camada 8 precisa da oferta real (proposta — validar) |
| F1.8 Brand kit versionado (`brand_kit`) | F1 Identidade | P0 | Marca | F1/F4 | Reprioritizada de P1→P0: o render tweet-card lê os tokens da marca |
| F1.11 Módulo Conteúdo de Contexto genérico (NOVO) | F1 Identidade | P0 | Conteúdo de Contexto | F1/F4 | Generaliza "transcrições": 6 kinds, tags, busca híbrida, status de ingestão |
| F1.12 Templates de nicho (4 presets + em branco) (NOVO) | F1 Identidade | P0 | Onboarding | F0/F4 | `criador-b2b`, `consultoria-financeira`, `clinica-saude`, `infoproduto`; seed por migration |
| F1.13 BYO API keys no onboarding (`store-secret` + Vault) (NOVO) | F1 Identidade | P0 | Onboarding / Config | F1/F4 | Gateway default zero-config; BYO Anthropic/OpenAI opcional no passo 2 |
| F2.1 Entrada padrão de geração por comando livre | F2 Geração | P0 | Criação | F2 | `generate-content` + roteador; ponto de entrada do fluxo |
| F2.2 Escolha de ângulo antes da peça | F2 Geração | P0 | Criação | F2 | 3-4 opções com hook quando o comando é amplo (`awaiting_angle`) |
| F2.3 Retrieval híbrido com ranking de prova | F2 Geração | P0 | Criação | F2 | pgvector + tsvector português + filtros; R$ > multiplicador > % |
| F2.4 Contrato `ChannelAdapter` + adapters Instagram (3) | F2 Geração | P0 | Criação | F2 | `instagram_stories`, `instagram_carousel`, `instagram_post` (estilo tweet-card) |
| F2.8 Render tweet-card client-side determinístico | F2 Geração | P0 | Biblioteca | F3 | Reprioritizada de P2→P0; mecanismo mudou: componente React + brand tokens → PNG, sem Chromium headless |
| F2.9 Adapters X / Threads / Facebook (NOVO) | F2 Geração | P0 | Criação | F2 | Compartilham base "post+imagem+legenda" com o `linkedin_post` |
| F2.10 Imagem IA via gateway (`generate-image`) (NOVO) | F2 Geração | P0 | Criação / Biblioteca | F3 | `google/gemini-2.5-flash-image` a partir do `image_brief`; grava no bucket `renders`. Estendida em 2026-07-31 com o scope `'slides'` (fotos por slide do carrossel + direção de arte/style bible) e em 2026-08-01 para os 3 canais de card (stories/frames 9:16 e post/card único) — F2.6/Face Lock segue P2 |
| F2.11 Regeneração guiada (`regenerate-piece`) (NOVO) | F2 Geração | P0 | Biblioteca | F3 | "mais provocador", "encurta" — instrução livre sobre peça existente |
| F3.1 Orquestração da saga (máquina de estados) | F3 Qualidade | P0 | Criação | F2/F5 | `generation_jobs` + Realtime; watchdog pg_cron entra na fase F5 |
| F3.2 Linter determinístico de ban list | F3 Qualidade | P0 | Criação | F2 | Classe 1 da auditoria: regex/código, sem LLM, com escopo por canal |
| F3.3 Verificador de grounding | F3 Qualidade | P0 | Criação | F2 | Classe 2: diff de números/citações contra o contexto; divergência → `[VERIFICAR]` |
| F3.4 Juiz semântico (LLM-as-judge) + reescrita ≤2 | F3 Qualidade | P0 | Criação | F2 | Reprioritizada de P1→P0: rubrica de 4 regras, chamada separada, nota de corte |
| F3.5 Zero-resíduo entre instâncias | F3 Qualidade | P0 | — (arquitetura) | F0/F5 | Garantido por construção (recheio 100% banco); verificação no golden set/runbook |
| F3.6 Política de citação (`citation_policy`) | F3 Qualidade | P0 | Conteúdo de Contexto | F1 | MVP: campo `named\|anonymous` por case; regras contextuais avançadas ficam P1 |
| F3.7 Gate de tom (`tone-gate`, 3 peças-amostra) | F3 Qualidade | P0 | Onboarding | F4 | Fecha o onboarding; vereditos gravados em `piece_feedback` |
| F4.4 Versionamento de motor (ENGINE_VERSION + golden set) | F4 Flywheel | P0 | Config | F0/F5 | Carimbo semver em cada peça; migrations idempotentes; golden set de 3 briefs |
| F4.5 Captura de vereditos e edições (`piece_feedback`) (NOVO) | F4 Flywheel | P0 | Biblioteca | F3 | MVP **armazena**; calibração automática (F4.3) consome depois |
| F4.6 Versionamento do recheio (append-only, draft→active) (NOVO) | F4 Flywheel | P0 | Marca | F0/F1 | `brand_persona`, `brand_strategy`, `guardrails`, `brand_kit`; versões carimbadas na peça |
| F5.1 Provisionamento por Remix do template | F5 Colaboração | P0 | — (fora do app) | F5 | Mecanismo nativo Lovable; painel de agência do blueprint foi descartado; runbook na fase F5 |
| F5.2 Papéis admin/user (`user_roles` + `has_role()`) | F5 Colaboração | P0 | Config | F0 | Primeiro usuário vira admin (trigger `handle_new_user`) |
| F5.3 Fila de aprovações na Biblioteca | F5 Colaboração | P0 | Biblioteca | F3 | Chips de auditoria, preview por canal, copy/download; export Notion desmembrado (F5.8) |
| F5.5 Registro de canais configurável (`channels`) | F5 Colaboração | P0 | Marca | F0/F1 | Seed por migration; ativação no wizard passo 8 e em /marca/canais |
| F5.7 Convite de usuários (`invite-user` + /config/usuarios) (NOVO) | F5 Colaboração | P0 | Config | F4 | Signup fecha após existir admin; entrada só por convite |
| F1.10 Anotação automática de referências virais | F1 Identidade | P1 | Conteúdo de Contexto | — | Upload simples de referências já é P0 (kind=`reference`); a anotação camada-a-camada é P1 |
| F2.15 Pesquisa web reativa (etapa `researching`) (NOVO) | F2 Geração | P1 | Criação | — | **Entregue 2026-07-31** (adendo pós-MVP): toggle em /criar → busca sobre a pauta (Tavily/Anthropic/OpenAI via `_shared/web-search.ts`), digest vira context_item auditável; explicitamente distinta do radar F2.12 (proativo, segue P2) |
| F3.8 Estado editorial anti-repetição (`editorial_state`) (NOVO) | F3 Qualidade | P1 | Criação | — | **Entregue 2026-08-01**: saga registra prova/tema via RPC `append_editorial_use` (append atômico, cap 12) e injeta a lista no gerador como regra suave; amostras do gate de tom e regenerações ficam fora |
| F4.1 Reingestão de peças que performaram | F4 Flywheel | P1 | Conteúdo de Contexto | — | **Entregue 2026-08-01** como referências de ESTILO no prompt do gerador (2 peças approved recentes) — sem reingestão como contexto: fora de `context_ids` (sem prova circular) e com números removidos dos excertos |
| F4.3 Calibração do juiz por veredito humano | F4 Flywheel | P1 | Config | — | **Entregue 2026-08-01**: 4 rejeições + 2 aprovações com notas de `piece_feedback` viram few-shot no prompt do juiz; nota de corte conservadora segue como rede |
| F5.4 Calendário editorial / agendamento | F5 Colaboração | P1 | Biblioteca | — | **Entregue 2026-08-01**: `scheduled_at` (migration 16), agendamento na peça aprovada + visão Calendário na Biblioteca; rejeitar/arquivar cancela; auto-publish segue P2 (F5.9) |
| F1.9 Face Lock (fotos → schema de identidade visual) | F1 Identidade | P2 | Marca | — | Depende de pipeline de visão; fora do MVP |
| F2.5 Cards infográficos (grid/iceberg/timeline…) | F2 Geração | P2 | Biblioteca | — | Rebaixada de P1→P2: MVP renderiza apenas tweet-card (proposta — validar) |
| F2.6 Prompts de imagem avançados (cinematografia + Face Lock) | F2 Geração | P2 | Criação | — | MVP usa `image_brief` simples via gateway (F2.10) |
| F2.7 Atomização + vídeo/Reels roteiro | F2 Geração | P2 | Criação | — | Rebaixada de P1→P2: depende dos formatos longos, que são P2 (proposta — validar) |
| F2.12 Radar de pautas / motor de ideias (NOVO) | F2 Geração | P2 | Criação | — | Decisão do brief: geração do MVP é reativa; sem tabelas `idea_signals` no MVP. Segue P2 — não confundir com a pesquisa web reativa F2.15 (entregue 2026-07-31) |
| F2.13 Formatos longos (LinkedIn/YouTube longos, SEO) | F2 Geração | P2 | Criação | — | Canal novo = novo adapter, sem mudar o núcleo |
| F2.14 Multi-idioma | F2 Geração | P2 | Config | — | MVP é português BR |
| F4.2 Medidor de cobertura da base | F4 Flywheel | P2 | Conteúdo de Contexto | — | Mapa de calor setor × objeção × tipo de métrica |
| F5.6 Canal novo por adapter | F5 Colaboração | P2 | — (dev) | — | Reenquadrada: trabalho de dev (arquivo + migration), não self-service do cliente (proposta — validar) |
| F5.8 Export Notion (NOVO desmembramento de F5.3) | F5 Colaboração | P2 | Biblioteca | — | Decisão do brief: saída do MVP é copy/download |
| F5.9 Publicação automática via OAuth (NOVO desmembramento de F5.4) | F5 Colaboração | P2 | Config | — | Meta Graph/LinkedIn/X exigem app review; fricção real de cronograma |

## F1 — Identidade e Onboarding

A família mais importante do produto: é onde o cliente constrói sozinho o "recheio" (voz, bandeira, guardrails, provas, marca). Como não há implementador, tudo que o wizard de 9 passos precisa para funcionar self-serve é P0. As rotas estão em 05-rotas-e-modulos.md; as tabelas versionadas em 04-modelo-de-dados.md.

- **F1.1 Wizard de voz (3 entradas).** O passo 4 do onboarding preenche o contrato de voz de 9 seções por três caminhos: extração assistida de um corpus subido no passo 3, entrevista guiada quando não há material, ou edição manual direta. A persona é objeto versionado append-only com `active_version`.
- **F1.2 Extração assistida de voz.** A edge function `extract-voice` lê os `context_items` selecionados e devolve um rascunho das 9 seções; o humano aceita/edita cada campo. É P0 porque é ela que substitui o implementador na etapa mais cara do setup.
- **F1.3 Bandeira (promessa, teses, ICP).** `brand_strategy` guarda a promessa de marca, o banco de teses, o inimigo, o ICP e o repertório de CTAs — o destino fixo onde toda peça aterrissa por ponte lógica (camadas 7-8 do funil).
- **F1.4 Editor de guardrails/ban list.** Fonte única e versionada de pontuação/palavras/metáforas/CTAs banidos, com overrides por canal e nota de corte. Metade vira regex do linter (F3.2) sem passar por LLM.
- **F1.5 Banco de provas/cases.** Cases entram como `context_items` de kind=`case` com metadata tipada (metric_type `brl|multiple|percent`, metric_value, client_name, sector, source_url obrigatória, quote, objection_tags, citation_policy). É o que impede o gerador de inventar "triplicou vendas".
- **F1.6 Pipeline de ingestão.** `ingest-context` roda limpeza → chunking → embeddings e marca o item como `ready`. Sem ela o RAG não existe, então subiu de P1 para P0.
- **F1.7 Catálogo de oferta.** O que o cliente vende entra como kind=`offer` no Conteúdo de Contexto, alimentando a aterrissagem comercial da camada 8 com produto real, não inventado.
- **F1.8 Brand kit.** Paleta, tipografia, logo e restrições em `brand_kit` versionado. Subiu para P0 porque o render tweet-card (F2.8) lê esses tokens.
- **F1.9 Face Lock (P2).** Upload de fotos → schema de identidade visual travada para imagens IA com o rosto da pessoa-marca. Fica para depois do MVP.
- **F1.10 Anotação de referências virais (P1).** Subir referências já funciona no MVP (kind=`reference`); a anotação automática camada-a-camada, que gera corpus de calibração, é P1.
- **F1.11 Módulo Conteúdo de Contexto genérico (NOVO).** Generalização de "transcrições" decidida no brief: um módulo único (`/contexto`) para cadastrar (upload, colar texto, URL), organizar (6 kinds, tags) e pesquisar (busca híbrida) tudo que os agentes usam como matéria-prima.
- **F1.12 Templates de nicho (NOVO no catálogo).** Quatro presets de fábrica (`criador-b2b`, `consultoria-financeira`, `clinica-saude`, `infoproduto`) + "começar em branco", populados por migration em `niche_templates`. Mitigam o cold-start de voz: o cliente nunca começa do zero.
- **F1.13 BYO API keys no onboarding (NOVO).** Passo 2 do wizard: gateway Lovable é o default zero-config; keys Anthropic/OpenAI opcionais entram via `store-secret` direto no Supabase Vault — nunca em tabela plaintext, nunca no client bundle (ver 06-arquitetura-ia.md).

## F2 — Motor de Geração

O motor é código do template, idêntico em todas as instâncias. Gera apenas a IDEIA e o CONTEÚDO núcleo; adapters transformam para cada canal. Contratos completos em 07-contratos-backend.md.

- **F2.1 Comando livre.** Textarea em `/criar`: "Faça uma postagem sobre a Copa do Mundo e como isso afeta o mercado imobiliário". O roteador classifica (formato, canais, tese, ângulos, query de contexto) e a saga dispara.
- **F2.2 Escolha de ângulo.** Comando amplo → job para em `awaiting_angle` e a UI mostra 3-4 cartões com hook; o usuário escolhe e `resume-job` continua. Maior alavanca anti-retrabalho do produto.
- **F2.3 Retrieval híbrido com ranking de prova.** pgvector (cosine) + full-text português + filtros por kind/tags; cases ranqueados por força da prova (R$ > multiplicador > %). Acha o case certo sem carregar a base toda no contexto.
- **F2.4 Contrato `ChannelAdapter` + Instagram.** Contrato único (`limits`, `aspect_ratio`, `structure()`, `render_spec`, `lint_overrides`, `cutoff_score`) com os 3 adapters Instagram: stories (3-6 frames 9:16), carrossel (7-10 slides tweet-card 4:5) e post padrão.
- **F2.5 Cards infográficos (P2).** Layouts grid/mapa mental/iceberg/timeline com tokens de marca. Fora do MVP: o render do MVP é só tweet-card.
- **F2.6 Prompts de imagem avançados (P2).** Direção de fotografia + Face Lock. No MVP a imagem sai do `image_brief` simples via gateway (F2.10).
- **F2.7 Atomização e vídeo (P2).** Peça longa → candidatos a Shorts/Reels com roteiro. Depende dos formatos longos, também P2.
- **F2.8 Render tweet-card client-side.** Componente React + brand tokens → PNG determinístico no browser, sem modelo de imagem e sem Chromium headless. Acerta a tipografia que IA de imagem erra; o adapter define o template.
- **F2.9 Adapters X/Threads/Facebook (NOVO).** Junto com `linkedin_post`, compartilham a base "post + imagem opcional + legenda" com limites próprios por canal. Sete canais no total no MVP.
- **F2.10 Imagem IA via gateway (NOVO).** `generate-image` transforma o `image_brief` da peça em imagem via `google/gemini-2.5-flash-image`, grava no bucket `renders` e retorna o path. **Estendida em 2026-07-31** com o scope `'slides'`: batch de fotos IA por slide do carrossel com direção de arte em uma chamada (style bible + brief por slide, consistência do deck); **em 2026-08-01** o batch foi generalizado para os 3 canais de card — carrossel (`slides`), stories (`frames`, 9:16) e post (`card` único) — com o mesmo painel e modos na Biblioteca. É extensão de F2.10, não antecipação de F2.6 (prompts avançados/Face Lock seguem P2).
- **F2.11 Regeneração guiada (NOVO).** `regenerate-piece` recebe instrução livre ("mais provocador", "encurta") e reprocessa a peça mantendo voz, guardrails e grounding.
- **F2.12 Radar de pautas (P2).** Motor proativo de ideias/sinais. Decisão explícita do brief: fora do MVP — a geração é reativa ao comando, e tabelas como `idea_signals` não existem no schema do MVP. Não confundir com F2.15 (pesquisa web **reativa**, já entregue): o radar sugere pauta sem comando; F2.15 pesquisa a pauta que o usuário mandou.
- **F2.13 Formatos longos (P2)** e **F2.14 Multi-idioma (P2).** LinkedIn/YouTube longos, SEO e outros idiomas entram como novos adapters/configuração depois do MVP.
- **F2.15 Pesquisa web reativa (NOVO, entregue 2026-07-31).** Etapa `researching` da saga, disparada pelo toggle "Pesquisa web" em `/criar`: busca informação fresca sobre a pauta (drivers Tavily/Anthropic/OpenAI em `_shared/web-search.ts`; `auto` resolve pela key presente no Vault) e materializa o digest como `context_item` auditável pelo grounding — sem tabela nova no schema. Falha/indisponibilidade nunca derruba o job. Specs: 06-arquitetura-ia.md §5.4, 07-contratos-backend.md §3.1.

## F3 — Qualidade e Governança

O aparato que garante qualidade de editor-chefe sem depender de talento avulso: auditoria em 3 classes, fail-fast (o gate mais barato roda primeiro), com gate "não publica falha". Detalhes do pipeline em 06-arquitetura-ia.md.

- **F3.1 Orquestração da saga.** Máquina de estados em `generation_jobs` (`created` → … → `awaiting_review`), execução em background com `EdgeRuntime.waitUntil`, acompanhamento por Realtime e watchdog pg_cron (fase F5) que re-invoca `resume-job` em jobs travados.
- **F3.2 Linter determinístico.** Classe 1: regex/código puro contra a ban list — pontuação banida, palavras, emojis, hashtags fora de metadado, CTAs proibidos, limites do canal. Zero token de LLM, com escopo por canal.
- **F3.3 Verificador de grounding.** Classe 2: extrai números e citações do output e faz diff contra o Conteúdo de Contexto selecionado; divergência vira `[VERIFICAR]` para confirmação humana. É a blindagem jurídica/reputacional do produto.
- **F3.4 Juiz semântico + reescrita.** Classe 3: LLM-as-judge em chamada separada do gerador, rubrica de 4 regras (sai com algo novo; aplicável; análise proprietária — "poderia sair em qualquer perfil? REPROVA"; embalagem narrativa) + arco + voz + nota de corte. Reprovou → reescrita automática alimentada pelo diagnóstico, máximo 2 tentativas, depois escala para humano. Subiu de P1 para P0: é parte inseparável da saga.
- **F3.5 Zero-resíduo entre instâncias.** No modelo Remix o isolamento é físico por construção: o template não contém dado de cliente algum e o recheio é 100% banco. A verificação vira item do golden set e do runbook de Remix (ver 08-estrategia-template.md).
- **F3.6 Política de citação.** Campo `citation_policy` (`named|anonymous`) por case no MVP, respeitado pelo gerador; regras contextuais avançadas (anonimizar quando a peça critica um inimigo) ficam P1.
- **F3.7 Gate de tom.** Fim do onboarding: `tone-gate` gera 3 peças-amostra pelo pipeline completo; o cliente responde "isso soa como você?". Reprovou → volta à etapa de voz. Vereditos ficam em `piece_feedback` para calibrar o juiz e servir de few-shot.
- **F3.8 Estado editorial anti-repetição (NOVO, entregue 2026-08-01).** Singleton `editorial_state` com provas/temas usados recentemente (cap 12): a saga injeta a lista no gerador como regra **suave** ("prefira prova e ângulo diferentes") e, após o adapting, registra o uso via RPC `append_editorial_use` (migration 17 — append atômico; upsert de snapshot perdia entradas das 3 sagas paralelas do tone-gate). Amostras do gate de tom e regenerações nem registram nem recebem a seção. Ver 06-arquitetura-ia.md §4.5.

## F4 — Flywheel e Versionamento

O moat de longo prazo: cada mês de uso torna a instância mais fiel. No MVP a regra é **armazenar tudo, automatizar depois** — os dados do flywheel nascem no P0, a esteira roda no P1.

- **F4.1 Reingestão de peças que performaram (entregue 2026-08-01).** Peças aprovadas realimentam a geração como **referências de estilo** no prompt do gerador (2 mais recentes; hook + camadas 4-5). Decisão de desenho: **não** viram `context_item` nem entram em `context_ids` (peça gerada não pode virar prova auditável — circularidade no grounding) e os números são removidos dos excertos (número solto copiado viraria só `[VERIFICAR]` não-bloqueante). Ver 06-arquitetura-ia.md §4.5.
- **F4.2 Medidor de cobertura (P2).** Mapa de calor setor × objeção × tipo de métrica apontando lacunas da base de provas.
- **F4.3 Calibração do juiz (entregue 2026-08-01).** Vereditos humanos calibram o juiz: as 4 rejeições + 2 aprovações mais recentes **com notas** de `piece_feedback` entram como few-shot no prompt (excerto = hook/idea da peça). Nota de corte conservadora + aprovação humana obrigatória seguem como rede enquanto o feedback é escasso. Ver 06-arquitetura-ia.md §4.5.
- **F4.4 Versionamento do motor.** `ENGINE_VERSION` (semver, constante no código) carimbada em cada peça; atualizações chegam às instâncias por merge do remote do template + migrations idempotentes; golden set de 3 briefs canônicos como smoke test pós-update.
- **F4.5 Captura de vereditos (`piece_feedback`) (NOVO).** Toda aprovação/rejeição/edição na Biblioteca (e no gate de tom) grava veredito, notas e diff. É o combustível de F4.1/F4.3 e por isso é P0.
- **F4.6 Versionamento do recheio (NOVO).** `brand_persona`, `brand_strategy`, `guardrails` e `brand_kit` são append-only (draft → ativar); cada peça carimba as versões usadas (`persona_version`, `strategy_version`, `guardrails_version`, `brand_kit_version`), garantindo reprodutibilidade e rollback.

## F5 — Colaboração e Distribuição

Como a instância nasce, quem entra nela e por onde o conteúdo sai. A grande mudança em relação ao blueprint: **não há painel de agência nem lógica própria de provisionamento** — o Remix nativo do Lovable resolve, e o inventário de instâncias vive numa planilha/CRM fora do produto (ver 08-estrategia-template.md).

- **F5.1 Provisionamento por Remix.** Remix do projeto template → novo projeto Lovable + novo Supabase + novo deploy; migrations criam schema e seeds de fábrica; o banco nasce vazio de dados de cliente. O "painel de agência" do blueprint foi descartado como tela de produto.
- **F5.2 Papéis admin/user.** Dois perfis por instância via `user_roles` + `has_role()` SECURITY DEFINER (padrão Lovable, nunca role em coluna de profiles). O primeiro usuário do banco vira admin pelo trigger `handle_new_user`.
- **F5.3 Fila de aprovações.** `/biblioteca` lista peças por status com chips de auditoria (linter/grounding/juiz), preview por canal, aprovação/rejeição e copy/download — a saída oficial do MVP.
- **F5.4 Calendário editorial / agendamento (entregue 2026-08-01).** `content_pieces.scheduled_at` (migration 16) + agendamento `datetime-local` na peça **aprovada** + visão Calendário na Biblioteca (grid mensal, toggle Lista/Calendário). Só aprovadas aparecem; rejeitar/arquivar zera o agendamento. Humano finaliza a publicação — a publicação automática via OAuth das redes segue F5.9 (P2).
- **F5.5 Registro de canais.** Tabela `channels` (enum de 7 tipos, seed por migration) com enabled + config de overrides; o cliente ativa formatos no passo 8 do wizard e ajusta em `/marca/canais`.
- **F5.6 Canal novo por adapter (P2).** Adicionar canal = novo arquivo de adapter + linha em `channels` via migration — trabalho de desenvolvimento do template, não self-service do cliente.
- **F5.7 Convite de usuários (NOVO).** Signup aberto só até existir o primeiro admin; depois, `invite-user` (admin) cria convites via auth admin API e `/config/usuarios` gerencia papéis.
- **F5.8 Export Notion (P2)** e **F5.9 Publicação automática (P2).** Integrações de saída ficam para depois: no MVP a distribuição é copy/download a partir da Biblioteca.

## Resumo da repriorização vs. blueprint

| Mudança | Motivo |
|---|---|
| Extração de voz (F1.2), ingestão (F1.6), brand kit (F1.8) → **P0** | Onboarding é self-serve: não há implementador para cobrir lacunas |
| Juiz semântico (F3.4) → **P0** | A auditoria em 3 classes é inseparável da saga do MVP |
| Render (F2.8) → **P0**, client-side | Trocou Chromium headless por componente React determinístico + brand tokens |
| Adapters X/Threads/Facebook (F2.9) → **P0** | Decisão do dono: 7 canais no MVP, 4 deles sobre base compartilhada |
| Radar/motor de ideias (F2.12) → **P2** | Geração do MVP é reativa ao comando livre |
| Painel de agência (F5.1 original) → **descartado** | Provisionamento = Remix nativo; inventário em planilha fora do produto |
| Cards infográficos (F2.5) e atomização (F2.7) → **P2** | MVP renderiza só tweet-card; formatos longos são P2 (proposta — validar) |
| Export Notion (F5.8) e auto-publish (F5.9) → **P2** | Saída do MVP é copy/download |
