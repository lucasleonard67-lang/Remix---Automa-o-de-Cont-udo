# Escopo do MVP

Este documento define o que o MVP do **Content Engine** entrega, o que fica deliberadamente de fora (e para quando), as premissas operacionais, os riscos do recorte e os critérios de aceite mensuráveis. Ele desdobra as decisões de escopo do dono do produto e serve de contrato entre visão (ver 01-visao-produto.md) e execução (ver 09-plano-implementacao.md). Detalhes de features, dados e contratos estão em 03-features-priorizadas.md, 04-modelo-de-dados.md, 05-rotas-e-modulos.md, 06-arquitetura-ia.md, 07-contratos-backend.md e 08-estrategia-template.md.

## 1. Objetivo do MVP e o momento "aha"

O MVP existe para provar **uma única tese**: um cliente novo, sem super admin e sem implementador, consegue sozinho transformar o template em uma fábrica de conteúdo com a voz da própria marca — e sair com peças aprovadas.

O momento "aha" é concreto e cronometrável:

> O cliente recebe a instância (Remix do template Lovable), faz o **onboarding wizard self-serve** de ponta a ponta, aprova 3 peças-amostra no **gate de tom** e, na sequência, digita um comando livre em `/criar` e recebe uma peça multi-canal **aprovada, na própria voz**, em **menos de 30 minutos de operação**.

Tudo que entra no MVP serve a esse momento. Tudo que não serve diretamente a ele fica para P1/P2. Duas consequências práticas:

- **O onboarding é a peça central**, não um formulário acessório. Sem super admin (decisão inegociável), o wizard é o único caminho para configurar identidade, contexto, tom de voz e forma de produção — se ele falhar, o produto inteiro falha.
- **A geração é reativa ao comando.** O MVP não sugere pautas nem monitora tendências; ele responde com excelência ao que o cliente pede. Proatividade (radar de ideias) é P2.

## 2. Gate de saída do MVP

O MVP só é considerado pronto quando o cenário completo abaixo roda de ponta a ponta, com um cliente que **não é** a equipe de desenvolvimento:

| # | Etapa | Evidência de aprovação |
|---|-------|------------------------|
| 1 | Cliente novo faz **Remix** do template Lovable | Novo projeto + novo Supabase + novo deploy criados. **Corrigido em 2026-08-31, medido em três Remixes:** o Remix traz o SCHEMA e mais nada — não há replay de migrations (`supabase/migrations/` nem existe no repo da instância). Seeds, privilégios, Realtime, cron e o gatilho de auth entram por `supabase/seed-instancia.sql` + `scripts/pos-remix.sql`; evidência é `scripts/verificar-instancia.sql` verde. Protocolo em `17-ensaio-geral.md` |
| 2 | Primeiro signup vira admin e cai no `/onboarding` | Trigger `handle_new_user` promove o primeiro usuário a `admin`; wizard abre no passo 1 |
| 3 | Cliente completa o **onboarding sozinho** (9 passos, sem suporte) | Progresso registrado em `app_settings`; passos 3-4-5-6 destravam a geração, 7-9 completam |
| 4 | **3 peças-amostra aprovadas no gate de tom** | Vereditos gravados em `piece_feedback` |
| 5 | Cliente gera **peça multi-canal aprovada** por comando livre | `content_pieces` com `status = approved` em ≥2 canais, a partir de um único `generation_job` |
| 6 | Tudo isso em **< 30 min de operação** | Tempo ativo do cliente (excluindo processamento em background), medido via `timings` do job e progresso do wizard (proposta — validar critério de medição) |

Se qualquer etapa exigir intervenção da Viver de IA (suporte, ajuste manual no banco, deploy manual), o gate **não** foi atingido.

## 3. O que ENTRA no MVP (P0)

Cada item abaixo é P0 porque remove um bloqueio direto do gate de saída. A fase de construção referida é a de 09-plano-implementacao.md.

### 3.1 Onboarding wizard completo (9 passos, retomável) com extração assistida de voz e gate de tom

Rota `/onboarding`, guarded para admin, com os passos `boas-vindas` → `ia-e-integracoes` → `contexto` → `voz` → `bandeira` → `guardrails` → `brand-kit` → `canais` → `gate-de-tom`. É a materialização da decisão "sem super admin": todo o recheio da instância nasce aqui, pelo próprio cliente. A extração assistida de voz (`extract-voice`) e o gate de tom (`tone-gate`, 3 peças-amostra aprovadas/reprovadas) são o que transforma um formulário em construção de identidade — sem eles, o cliente configuraria campos sem validar que a máquina fala como ele. Progresso retomável em `app_settings` porque onboarding self-serve interrompido e perdido significa churn antes do primeiro valor. Fase F4.

### 3.2 Módulo Conteúdo de Contexto com ingestão RAG e busca

Rotas `/contexto` e `/contexto/$itemId` + edge function `ingest-context` + tabelas `context_items`/`context_chunks`. É o alicerce do grounding: sem corpus (transcrições, postagens, documentos, cases, ofertas), o gerador não tem prova nem voz de onde partir e a Classe 2 da auditoria não tem contra o que verificar. A busca híbrida (pgvector + full-text português + filtros por kind/tags) garante que o contexto certo chegue à peça certa. UX de cadastro/organização excepcional é requisito do dono do produto, não polimento. Fase F1.

### 3.3 Entrada padrão de geração por comando livre

Rota `/criar` com textarea de comando + acompanhamento em tempo real (Realtime sobre `generation_jobs`). É o ponto de entrada único do fluxo de geração definido pelo dono do produto ("Faça uma postagem sobre a Copa do Mundo e como isso afeta o mercado imobiliário"). Comando livre elimina a necessidade de o cliente aprender uma taxonomia de briefing antes de extrair valor — o Roteador classifica formato, canais, tese e ângulos por ele. Fase F2.

### 3.4 Saga de geração com auditoria em 3 classes + reescrita ≤ 2

Edge functions `generate-content` + `resume-job` com a saga retrieve → generate → lint → grounding → judge → (rewrite ≤2) → adapt → awaiting_review. A auditoria fail-fast (linter determinístico, verificador de grounding, juiz semântico em chamada separada) é o que diferencia o produto de um wrapper de LLM: é a garantia de que "não publica falha" e de que a marca só recebe peças dentro dos guardrails. A reescrita automática limitada a 2 tentativas, alimentada pelo diagnóstico, mantém custo previsível e escala para humano em vez de loopar. Fase F2.

### 3.5 Escolha de ângulo

Quando o comando é amplo, o job entra em `awaiting_angle` e o cliente escolhe entre 3-4 opções com hook, inline em `/criar`. É a fricção desejável de menor custo com maior impacto: uma decisão humana barata no início evita peças inteiras geradas na direção errada — mais barato que regenerar depois e essencial para a sensação de coautoria (o cliente dirige, a máquina executa). Fase F2.

### 3.6 Os 7 adapters de canal

`instagram_stories`, `instagram_carousel`, `instagram_post`, `x_post`, `threads_post`, `linkedin_post`, `facebook_post`, todos implementando o contrato `ChannelAdapter`. Materializam a decisão arquitetural "núcleo gera IDEIA e CONTEÚDO; adapter transforma por plataforma". Os 4 últimos compartilham a base "post+imagem+legenda", então o custo marginal de cada um é baixo e o ganho de percepção ("uma peça, todos os canais") é alto — é o que faz a demonstração multi-canal do gate de saída funcionar. Fase F2.

### 3.7 Render tweet-card client-side + imagem IA via gateway

Componente React determinístico (brand tokens → PNG) para carrossel/post estilo "tweet do X", + edge function `generate-image` (`google/gemini-2.5-flash-image` via gateway) gravando em `renders`. O render determinístico garante consistência visual de marca sem depender de modelo de imagem para tipografia (onde modelos falham); a imagem IA cobre o visual ilustrativo opcional. Sem render, a Biblioteca entregaria texto cru — o "aha" exige peça pronta para uso. Fase F3.

### 3.8 Biblioteca com aprovação, chips de auditoria, regeneração guiada, copy/download

Rotas `/biblioteca` e `/biblioteca/$pieceId`: peças por status, chips de auditoria (linter/grounding/judge com notas e diagnósticos), aprovação/rejeição, regeneração guiada ("mais provocador", "encurta"), copy/download. É onde a intervenção humana final acontece (aprovação obrigatória no MVP) e onde a saída do produto vive — já que publicação automática é P2, copy/download **é** o mecanismo de entrega. Os chips tornam a auditoria visível e auditável, construindo confiança no motor. Fase F3.

### 3.9 Papéis admin/user + convites

Enum `app_role` (`admin`, `user`) via `user_roles` + `has_role()`, trigger `handle_new_user` (primeiro usuário = admin), edge function `invite-user` e tela `/config/usuarios`. Fecha o modelo de acesso da instância: signup aberto só até existir admin; depois, entrada por convite. Sem isso, a instância single-tenant ficaria aberta a signup de terceiros ou dependeria de gestão manual de usuários — ambos incompatíveis com self-serve seguro. Fases F0 (first-admin) e F4 (convites).

### 3.10 Providers gateway default + BYO Anthropic/OpenAI

Abstração `supabase/functions/_shared/llm.ts` com drivers `lovable-gateway` (default, zero-config via `LOVABLE_API_KEY`), `anthropic` (BYO, recomendado para gerador e juiz) e `openai` (BYO, opcional); seleção por papel em `app_settings`, keys no Supabase Vault via `store-secret`. O gateway garante que o onboarding funcione sem nenhuma key (zero-config no passo 2); o BYO transfere custo de tokens para o cliente e destrava modelos melhores para gerador/juiz. Fases F1 (store-secret, /config/ia) e F2 (drivers). 

### 3.11 Versionamento de persona/strategy/guardrails/brand kit

Tabelas `brand_persona`, `brand_strategy`, `guardrails`, `brand_kit` append-only (`version`, `status` in `draft`/`active`/`archived`, uma linha active), editáveis em `/marca/*` (editar cria draft → ativar). Cada peça carimba `persona_version`, `strategy_version`, `guardrails_version`, `brand_kit_version` — é o que permite responder "com qual voz essa peça foi gerada?" e evoluir a marca sem quebrar o histórico. Reprovação no gate de tom volta à etapa de voz, o que já exige versionar desde o dia 1. Fases F0 (schema) e F1 (telas).

### 3.12 Quatro templates de nicho

`niche_templates` populada por migration (dado de fábrica = motor) com `criador-b2b`, `consultoria-financeira`, `clinica-saude`, `infoproduto` + opção "começar em branco". Presets de ban list, arquétipos, famílias de hook e postura editorial atacam diretamente o risco de cold-start: o cliente nunca começa do zero no passo 1 do onboarding, o que encurta o caminho até o gate de tom e reduz abandono do wizard. Fase F0 (seed).

## 4. O que FICA FORA — com justificativa e destino

Regra do recorte: se o item não bloqueia o gate de saída, ele sai — mesmo que seja valioso. P1 = primeira onda pós-MVP (itens cujo dado o MVP **já coleta**); P2 = ondas seguintes.

| Item | Fase | Por que fica fora | O que o MVP já prepara |
|------|------|-------------------|------------------------|
| Calendário editorial | **P1** | O "aha" é comando → peça aprovada; agendar/organizar produção é valor de operação contínua, não de primeira prova. | Peças com status e timestamps em `content_pieces` já dão a matéria-prima. |
| `editorial_state` anti-repetição | **P1** | Repetição de provas/temas só dói com volume acumulado — problema que o cliente do MVP ainda não tem. | Tabela prevista no schema (singleton jsonb) para ativação sem migração destrutiva. |
| Flywheel de calibração automática do juiz | **P1** | Calibrar exige massa de vereditos que só existe após uso real; automatizar antes seria calibrar com ruído. | MVP **armazena** todos os vereditos em `piece_feedback` (incluindo os do gate de tom) — o dado do flywheel nasce no dia 1. |
| Radar/motor de ideias (pautas proativas, `idea_signals` etc.) | **P2** | Decisão explícita: geração no MVP é reativa ao comando. Proatividade é outro produto dentro do produto — descoberta, fontes, ranking. | Sem tabelas de radar no schema do MVP, por decisão. |
| Publicação automática via OAuth das redes | **P2** | OAuth de 5 plataformas = custo enorme de integração, revisão de apps e manutenção, sem afetar a prova de valor (saída é copy/download). | `adapted_content` e `render_path` já são o payload pronto para publicação futura. |
| Export Notion | **P2** | Conveniência de workflow, não bloqueio; copy/download cobre o essencial. | Estrutura de `content_pieces` é serializável para qualquer export. |
| Analytics de cobertura | **P2** | Medir mix/cobertura editorial pressupõe produção acumulada e calendário — dependências que são P1. | `content_pieces` carimbadas com canal, versões e engine_version. |
| Vídeo/Reels roteiro | **P2** | Formato com pipeline próprio (roteiro, cenas, timing) que não reusa os adapters atuais; diluiria o foco dos 7 canais. | Arquitetura de adapters: canal novo = novo adapter, sem mudar o núcleo. |
| LinkedIn/YouTube longos | **P2** | Long-form tem estrutura e auditoria distintas do funil de 8 camadas aplicado a social curto. | Mesmo caminho: novo adapter + linha em `channels` via migration. |
| Multi-idioma | **P2** | O produto nasce PT-BR (FTS `portuguese`, prompts, linter); internacionalizar cedo multiplicaria o custo de cada regra editorial. | Abstração de prompts do motor em `_shared/prompts/` versionados facilita futura parametrização. |

## 5. Premissas e dependências

O escopo acima assume as condições a seguir. Se alguma cair, o plano de implementação (ver 09-plano-implementacao.md) precisa ser revisto.

1. **Lovable AI Gateway ativo na instância** (`is_used: true`): edge functions recebem `LOVABLE_API_KEY` automaticamente. É o que viabiliza o onboarding zero-config (passo 2 sem nenhuma key). Modelos disponíveis: chat Gemini 3.x/2.5 (Flash/Pro) e GPT-5.x, imagem GPT Image 2 e Gemini Flash Image, embeddings `google/gemini-embedding-001` — **sem Claude no gateway**; Claude só via BYO Anthropic.
2. **Remix disponível no Lovable**: todo o provisionamento depende do Remix (novo projeto + novo Supabase + novo deploy). Não há lógica própria de clonagem — decisão inegociável. Indisponibilidade do Remix bloqueia onboarding de clientes novos (mitigação em §6).
3. **Créditos do workspace da instância**: billing do gateway consome créditos Lovable do workspace (grant mensal + créditos gerais; HTTP 402 quando esgota). O MVP precisa tratar 402 com mensagem acionável e expor uso em `/config`.
4. **Recursos do Supabase da instância**: pgvector (habilitar), Vault para segredos, Realtime, Storage, pg_cron e Edge Functions com deploy via Lovable MCP (`lovable_deploy`).
5. **Scaffold do template pronto**: TanStack Start + Router + Query, React 19, Vite 8, Tailwind v4, shadcn/ui, `src/integrations/supabase/` (client, client.server, auth-middleware/attacher) — reusar, não reescrever (ver 08-estrategia-template.md).
6. **Auth da instância**: e-mail/senha habilitado com confirmação de e-mail ativa; signup aberto apenas até existir o primeiro admin.
7. **Corpus mínimo do cliente** (proposta — validar): o fluxo com extração de voz assume que o cliente traga algum material próprio (transcrições, posts, documentos) no passo 3. Sem corpus, o caminho é a entrevista guiada + templates de nicho — funcional, mas com gate de tom potencialmente mais lento.

## 6. Riscos do escopo e mitigações

| Risco | Impacto no MVP | Mitigação (dentro do escopo P0) |
|-------|----------------|----------------------------------|
| **Cold-start de voz** — cliente sem corpus ou com corpus fraco não produz persona convincente | Gate de tom reprova repetidamente; onboarding trava no passo 4/9 | Templates de nicho pré-populando arquétipos e postura; entrevista guiada sem corpus; edição manual das 9 seções da persona; reprovação no gate de tom volta à etapa de voz (loop desenhado, não bug) |
| **Alucinação** — número/case inventado chega à marca | Perda de confiança irreversível no motor | Verificador de grounding (Classe 2) com diff contra o Conteúdo de Contexto; regras duras: fonte obrigatória, 1 prova central por peça, dado faltante vira `[VERIFICAR: x]` com confirmação humana |
| **Custo de tokens** — créditos do gateway esgotam (402) no meio do uso | Geração para; cliente percebe produto "quebrado" | Tratamento explícito de 402 com mensagem acionável; exposição de uso em `/config`; BYO key (Anthropic/OpenAI) transfere o custo para o cliente; modelos rápidos/baratos no papel de roteador |
| **Qualidade do juiz sem calibração inicial** — juiz reprova bom conteúdo ou aprova ruim | Frustração no gate de tom e na Biblioteca | Nota de corte conservadora (`approval_threshold` por canal em `guardrails`); aprovação humana obrigatória em toda peça; vereditos armazenados em `piece_feedback` desde o dia 1 para calibração futura (P1) |
| **Drift de instâncias** — instâncias divergem do template e updates quebram | Custo de manutenção explode com cada cliente novo | `ENGINE_VERSION` (semver) carimbada em cada peça; migrations aditivas idempotentes, nunca destrutivas; golden set de 3 briefs canônicos como smoke test pós-update |
| **Dependência do Remix/Lovable** — Remix indisponível ou com regressão | Não é possível provisionar clientes novos | Runbook manual de fallback (criação de projeto + aplicação de migrations documentadas) na fase F5; zero lógica própria de clonagem mantém a superfície de dependência mínima |
| **Escopo do onboarding subestimado** (proposta — validar) — 9 passos self-serve é a maior superfície de UX do MVP | F4 atrasa e trava o gate de saída | Ordenação de fases já mitiga: F4 costura módulos que F1-F3 entregaram prontos e testados isoladamente; passos 3-4-5-6 como "mínimo viável" permitem destravar geração antes do wizard completo |

## 7. Critérios de aceite mensuráveis do MVP

Lista objetiva e testável. O MVP passa quando **todos** os itens abaixo forem verificados numa instância provisionada por Remix (não no projeto de desenvolvimento).

### 7.1 Provisionamento e acesso

- [ ] Remix do template gera instância funcional: migrations criam o schema completo (§ de 04-modelo-de-dados.md), seeds de `niche_templates` (4 presets) e `channels` (7 canais com defaults), buckets `context-files`, `brand-assets`, `renders` privados.
- [ ] Primeiro signup vira `admin` automaticamente (trigger `handle_new_user`); segundo signup direto é bloqueado — novos usuários só entram por convite (`invite-user`) e nascem como `user`.
- [ ] Usuário `user` não acessa `/config/*` nem `/onboarding`; usuário não autenticado é redirecionado para `/login`; usuário autenticado com onboarding incompleto (abaixo do mínimo viável 3-4-5-6) é redirecionado para `/onboarding`.
- [ ] Nenhuma API key aparece no client bundle nem em tabela plaintext; keys BYO só existem no Supabase Vault e `store-secret` nunca retorna valor.

### 7.2 Onboarding

- [ ] Os 9 passos do wizard completam de ponta a ponta sem intervenção externa; progresso persiste em `app_settings` e o wizard retoma do passo onde parou após logout/login.
- [ ] `extract-voice` produz rascunho das 9 seções da persona a partir de ≥1 item de contexto; o cliente consegue aceitar/editar cada seção.
- [ ] Onboarding funciona **sem nenhuma key BYO** (gateway default) e **sem corpus** (caminho de entrevista guiada + template de nicho).
- [ ] `tone-gate` gera 3 peças-amostra pelo pipeline completo; aprovar conclui o onboarding, reprovar retorna à etapa de voz; vereditos ficam gravados em `piece_feedback`.

### 7.3 Geração e auditoria

- [ ] Comando livre em `/criar` cria `generation_job` e o estado percorre a máquina (`created` → … → `awaiting_review`) com atualização em tempo real na UI (Realtime).
- [ ] Comando amplo leva o job a `awaiting_angle` com 3-4 opções de ângulo com hook; a escolha retoma a saga via `resume-job`.
- [ ] Peça com termo da ban list é reprovada pelo linter (Classe 1) **sem chamada de LLM**; número sem fonte no contexto vira `[VERIFICAR]` (Classe 2); o juiz (Classe 3) roda em chamada separada do gerador e registra notas/diagnóstico em `content_pieces.audit`.
- [ ] Reprovação dispara reescrita automática alimentada pelo diagnóstico, no máximo 2 tentativas (`attempt ≤ 2`); na terceira falha o job escala para revisão humana em vez de loopar.
- [ ] Um job com múltiplos canais alvo gera uma `content_piece` por `channel_type`, cada uma respeitando limites e estrutura do respectivo adapter (7 adapters verificáveis individualmente).
- [ ] Job travado (>N min sem update) é retomado pelo watchdog pg_cron via `resume-job` (proposta — validar valor de N).

### 7.4 Biblioteca e saída

- [ ] `/biblioteca` lista peças por status com chips de auditoria (linter/grounding/judge); `/biblioteca/$pieceId` mostra preview por canal, incluindo render tweet-card em PNG para os formatos que o usam.
- [ ] Aprovar/rejeitar altera `content_pieces.status` e grava `piece_feedback`; regeneração guiada (`regenerate-piece`) produz nova versão da peça a partir da instrução.
- [ ] Copy e download funcionam para toda peça aprovada; `generate-image` grava PNG no bucket `renders` e a peça referencia o path em `adapted_content.image_path` (a imagem IA é insumo da peça; `render_path` é o PNG do tweet-card exportado pelo frontend — 07-contratos-backend.md §6).
- [ ] Toda peça carrega `persona_version`, `strategy_version`, `guardrails_version`, `brand_kit_version` e `engine_version` preenchidos.

### 7.5 Métricas do gate (medidas com cliente piloto)

- [ ] **Onboarding self-serve concluído sem suporte** por pelo menos 1 cliente novo real (nenhum ticket/intervenção durante o fluxo).
- [ ] **Tempo comando → peça aprovada < 30 min** de operação no cenário do gate de saída (§2).
- [ ] **> 60% das peças aprovadas sem edição** no período piloto (baseline da North Star: peças aprovadas sem edição por semana por instância).
- [ ] **Concordância juiz×humano > 85%** nos vereditos do período piloto (comparando `content_pieces.audit.judge` com `piece_feedback`).
- [ ] Golden set: os 3 briefs canônicos rodam de ponta a ponta com sucesso na instância recém-provisionada (smoke test da F5).

## 8. Resumo do recorte

O MVP é estreito em superfície e profundo em qualidade: um único fluxo (onboarding → comando → auditoria → aprovação), sete canais de saída, governança editorial completa desde a primeira peça. Ele não agenda, não publica, não sugere pautas — mas tudo que ele gera passa por linter, grounding e juiz, carrega versão de voz e de motor, e sai aprovado por um humano. A aposta é que essa combinação — self-serve real + governança visível — é o que nenhum wrapper de LLM entrega, e é exatamente o que o gate de saída mede.

## 9. Adendo pós-MVP (2026-07-31 / 2026-08-01)

Features entregues após o fechamento do escopo acima — registradas aqui sem reescrever o recorte histórico:

1. **Pesquisa web reativa (etapa `researching` da saga).** Toggle "Pesquisa web" em `/criar` → `generate-content {web_search: true}`; o digest (trechos literais + fontes) vira `context_item` auditável pelo grounding. A geração continua **reativa ao comando** — isto **não** é o radar de pautas (F2.12, segue P2) e nenhuma tabela nova entrou no schema. Specs: 06-arquitetura-ia.md §5.4, 07-contratos-backend.md §3.1, 03-features-priorizadas.md F2.15.
2. **Carrossel com fotos IA por slide + export final.** `generate-image` scope `'slides'` (direção de arte do deck em 1 chamada + batch de fotos em background) e export **"Exportar carrossel (ZIP)"** com as artes finais compostas client-side (`01.png…NN.png` + `legenda.txt`). A regra do render é preservada: card 100% client-side determinístico, nenhuma edge function desenha card. Specs: 07-contratos-backend.md §3.5, 05-rotas-e-modulos.md §4.2.
3. **Driver Firecrawl na pesquisa web (2026-07-31).** Quarto driver da etapa `researching`: Firecrawl `/search` com scrape em markdown — busca + conteúdo integral das páginas (mais texto literal para o grounding), key `FIRECRAWL_API_KEY` (`fc-`); entra no `auto` entre tavily e anthropic. Specs: 06-arquitetura-ia.md §5.4.
4. **Lote P1 (2026-08-01)** — quatro itens do catálogo P1 entregues + uma generalização:
   - **Fotos IA multi-canal**: o scope `'slides'` passou a cobrir os 3 canais de card — carrossel (`slides`), stories (`frames`, 9:16) e post (`card` único) — com o painel "Fotos da peça", modos "Fundo de marca"/"Foto de fundo" e export ZIP também para stories (07 §3.5, 05 §4.2).
   - **F3.8 anti-repetição**: `editorial_state` ativo — a saga registra prova/tema por peça (RPC `append_editorial_use`, append atômico) e o gerador recebe a lista como regra suave (06 §4.5).
   - **F4.3 calibração do juiz**: vereditos humanos com notas (`piece_feedback`) viram few-shot no prompt do juiz (06 §4.5).
   - **F4.1 estilo aprovado**: trechos de peças aprovadas calibram o tom do gerador — fora de `context_ids` (sem prova circular) e com números removidos (06 §4.5).
   - **F5.4 calendário editorial**: `scheduled_at` + agendamento na peça aprovada + visão Calendário na Biblioteca; **sem auto-publish** (F5.9 segue P2) — a saída do produto continua sendo copy/download (04 §6.10, 05 §4.2).
