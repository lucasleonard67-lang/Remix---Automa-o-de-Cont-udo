# Mapa de Módulos → Rotas TanStack

Este documento mapeia os módulos do Content Engine para a árvore de rotas file-based do TanStack Start (`src/routes/`), define a convenção de guards, descreve o wireframe textual das telas-chave, e lista os componentes compartilhados e hooks de dados a criar. O escopo funcional de cada módulo vem de 02-escopo-mvp.md e 03-features-priorizadas.md; as tabelas citadas aqui estão especificadas em 04-modelo-de-dados.md; as edge functions invocadas pelas telas estão em 07-contratos-backend.md; a ordem de construção está em 09-plano-implementacao.md.

---

## 1. Convenções de roteamento do template

O scaffold usa TanStack Start com **file-based routing**: todo `.tsx` em `src/routes/` vira rota. Não existem `src/pages/` nem convenções Next.js/Remix. Regras relevantes (ver `src/routes/README.md` do repo):

| Arquivo | URL / papel |
| --- | --- |
| `index.tsx` | `/` |
| `criar.tsx` | `/criar` |
| `biblioteca/$pieceId.tsx` | `/biblioteca/:pieceId` (dinâmico — `$` puro, sem chaves) |
| `_app.tsx` + pasta `_app/` | **layout pathless**: envolve os filhos com `<Outlet />` sem adicionar segmento na URL |
| `config.tsx` + pasta `config/` | layout **com** segmento: `config.tsx` envolve `/config/*` |
| `__root.tsx` | shell da aplicação — único layout raiz; preservar `<Outlet />` |

`routeTree.gen.ts` é gerado — nunca editar à mão.

---

## 2. Árvore de rotas completa

Estrutura completa de `src/routes/` no MVP. A rota placeholder atual (`src/routes/index.tsx`) é substituída por `_app/index.tsx` — a home passa a exigir sessão.

```text
src/routes/
├── __root.tsx                    # (scaffold — reusar) shell HTML, QueryClientProvider,
│                                 #   errorComponent + notFoundComponent; ajustar <title>/meta
├── login.tsx                     # /login — LoginPage (e-mail/senha; signup condicional)
│
├── onboarding.tsx                # layout do wizard — OnboardingLayout + WizardShell
│                                 #   guard: sessão + role admin
├── onboarding/
│   ├── index.tsx                 # /onboarding — redirect para o passo atual (retomável)
│   ├── boas-vindas.tsx           # passo 1 — StepWelcome
│   ├── ia-e-integracoes.tsx      # passo 2 — StepAiIntegrations
│   ├── contexto.tsx              # passo 3 — StepContext
│   ├── voz.tsx                   # passo 4 — StepVoice
│   ├── bandeira.tsx              # passo 5 — StepStrategy
│   ├── guardrails.tsx            # passo 6 — StepGuardrails
│   ├── brand-kit.tsx             # passo 7 — StepBrandKit
│   ├── canais.tsx                # passo 8 — StepChannels
│   └── gate-de-tom.tsx           # passo 9 — StepToneGate
│
├── _app.tsx                      # layout autenticado — AppLayout (sidebar shadcn)
│                                 #   guard: sessão + onboarding mínimo viável
└── _app/
    ├── index.tsx                 # / — DashboardPage
    ├── criar.tsx                 # /criar — CreatePage (entrada padrão de geração)
    ├── biblioteca/
    │   ├── index.tsx             # /biblioteca — LibraryPage
    │   └── $pieceId.tsx          # /biblioteca/:pieceId — PieceDetailPage
    ├── contexto/
    │   ├── index.tsx             # /contexto — ContextListPage
    │   └── $itemId.tsx           # /contexto/:itemId — ContextItemPage
    ├── marca/
    │   ├── index.tsx             # /marca — BrandHubPage (hub de cards)
    │   ├── persona.tsx           # /marca/persona — PersonaEditorPage
    │   ├── bandeira.tsx          # /marca/bandeira — StrategyEditorPage
    │   ├── guardrails.tsx        # /marca/guardrails — GuardrailsEditorPage
    │   ├── brand-kit.tsx         # /marca/brand-kit — BrandKitEditorPage
    │   └── canais.tsx            # /marca/canais — ChannelsPage
    ├── config.tsx                # layout /config — ConfigLayout (guard extra: role admin)
    └── config/
        ├── index.tsx             # /config — redirect para /config/usuarios (proposta — validar)
        ├── usuarios.tsx          # /config/usuarios — ConfigUsersPage
        ├── ia.tsx                # /config/ia — ConfigAiPage
        ├── integracoes.tsx       # /config/integracoes — ConfigIntegrationsPage
        └── instancia.tsx         # /config/instancia — ConfigInstancePage
```

Decisões de estrutura:

- **Um arquivo por passo do wizard**, usando exatamente os slugs do brief (`boas-vindas` … `gate-de-tom`), em vez de rota dinâmica `$step` (proposta — validar). Justificativa: cada passo tem formulário e validação próprios; arquivos separados mantêm cada passo pequeno, com code-splitting natural e URL estável para retomada.
- **`/onboarding` fora do `_app`**: o wizard tem layout próprio (sem sidebar), conforme o brief.
- **`config.tsx` como layout aninhado dentro de `_app/`**: herda sidebar e guard de sessão do `_app`, e adiciona o guard de role admin uma única vez para todos os filhos.

### 2.1 Tabela rota → guard → dados principais

| Rota | Guard | Tabelas/funções que a tela consome |
| --- | --- | --- |
| `/login` | nenhum (redireciona para `/` se já autenticado) | `supabase.auth`; checagem "existe admin?" (ver §3.4) |
| `/onboarding/*` | sessão + admin | `app_settings`, `niche_templates`, `context_items`, `brand_persona`, `brand_strategy`, `guardrails`, `brand_kit`, `channels`; `extract-voice`, `ingest-context`, `store-secret`, `tone-gate` |
| `/` | sessão + onboarding mínimo | `content_pieces` (recentes), `generation_jobs` (ativos), versões ativas de marca |
| `/criar` | sessão + onboarding mínimo | `generation_jobs` (+ Realtime), `channels`, `context_items`; `generate-content`, `resume-job` |
| `/biblioteca`, `/biblioteca/$pieceId` | sessão + onboarding mínimo | `content_pieces` (+ Realtime), `piece_feedback`, `generation_jobs`; `regenerate-piece`, `generate-image`; bucket `renders` |
| `/contexto`, `/contexto/$itemId` | sessão + onboarding mínimo | `context_items`, `context_chunks` (status); `ingest-context`, `search-context`; bucket `context-files` |
| `/marca/*` | sessão + onboarding mínimo | `brand_persona`, `brand_strategy`, `guardrails`, `brand_kit`, `channels`; bucket `brand-assets` |
| `/config/*` | sessão + onboarding mínimo + admin | `profiles`, `user_roles`, `app_settings`; `invite-user`, `store-secret` |

---

## 3. Convenção de guards (`beforeLoad`)

Três guards compõem toda a proteção de rota, implementados como helpers em `src/lib/guards.ts` (proposta — validar) e aplicados via `beforeLoad` dos arquivos de layout — nunca repetidos em rotas folha.

```ts
// src/lib/guards.ts (proposta — validar)
import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/** Guard 1 — sessão. Sem sessão → /login. */
export async function requireSession() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    throw redirect({ to: "/login" });
  }
  return data.session;
}

/** Guard 2 — role admin (lê user_roles do próprio usuário; RLS permite). */
export async function requireAdmin(queryClient: QueryClient) {
  const roles = await queryClient.ensureQueryData(userRolesQuery());
  if (!roles.includes("admin")) {
    throw redirect({ to: "/" });
  }
}

/** Guard 3 — onboarding mínimo viável (passos 3-4-5-6 concluídos). */
export async function requireOnboardingMinimum(queryClient: QueryClient) {
  const onboarding = await queryClient.ensureQueryData(onboardingQuery());
  if (!onboarding.minimum_viable) {
    throw redirect({ to: "/onboarding" });
  }
}
```

Aplicação nos layouts:

```ts
// src/routes/_app.tsx
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context }) => {
    const session = await requireSession();
    await requireOnboardingMinimum(context.queryClient);
    return { session };
  },
  component: AppLayout,
});

// src/routes/_app/config.tsx — guard adicional de admin para todo /config/*
export const Route = createFileRoute("/_app/config")({
  beforeLoad: async ({ context }) => requireAdmin(context.queryClient),
  component: ConfigLayout,
});

// src/routes/onboarding.tsx — sessão + admin; se completo, redireciona para /
export const Route = createFileRoute("/onboarding")({
  beforeLoad: async ({ context }) => {
    await requireSession();
    await requireAdmin(context.queryClient);
    const onboarding = await context.queryClient.ensureQueryData(onboardingQuery());
    if (onboarding.completed) throw redirect({ to: "/" }); // (proposta — validar)
  },
  component: OnboardingLayout,
});
```

Notas:

1. **Progresso do onboarding vive em `app_settings`** (decisão do brief). Key: `onboarding`, value jsonb com o shape canônico de 04-modelo-de-dados.md §8.9 (snake_case): `{ current_step, completed_steps, minimum_viable, completed, brand_name, niche_template_slug }`.
2. **Mínimo viável = passos 3 (`contexto`), 4 (`voz`), 5 (`bandeira`) e 6 (`guardrails`) concluídos** — destravam a geração; 7-9 completam o onboarding (brief §7). O guard do `_app` cobra apenas o mínimo viável, para o admin poder usar `/criar` antes de fechar o gate de tom.
3. **Usuário com role `user` numa instância sem onboarding mínimo**: cai no redirect para `/onboarding`, que por sua vez o rejeita (não é admin). Tratamento: `/onboarding` renderiza para não-admins uma tela estática "aguarde o administrador concluir a configuração" em vez de loop de redirects (proposta — validar).
4. **Signup condicional no `/login`**: signup fica aberto apenas enquanto não existe admin (primeiro acesso pós-Remix). Como a checagem precisa rodar sem sessão, existe a função `has_any_admin()` — SECURITY DEFINER, exposta via RPC a `anon`, retornando somente um boolean de existência (definida em 04-modelo-de-dados.md; citada em 07-contratos-backend.md). Com `true`, o `/login` esconde o formulário de signup e mostra apenas login por convite.
5. `getSession()` no cliente é barato (não faz round-trip quando o token está em memória); os guards 2 e 3 usam `queryClient.ensureQueryData`, então o custo é uma query cacheada por sessão de navegação.

---

## 4. Wireframes textuais das telas-chave

Descrições de layout por zonas (topo → base, esquerda → direita). Todos os componentes visuais vêm do shadcn/ui já presente no scaffold (`src/components/ui/`, 47 componentes, tema new-york, tokens oklch em `src/styles.css`).

### 4.1 `/criar` — entrada padrão de geração

Página de coluna única centralizada (max-w ~3xl), foco absoluto no comando.

- **Zona 1 — Comando.** `Textarea` grande com placeholder exemplificando o uso ("Faça uma postagem sobre a Copa do Mundo e como isso afeta o mercado imobiliário"). Abaixo, em linha: chips de canais ativos (pré-marcados; origem `channels.enabled`) para restringir `channel_types` opcionalmente; botão secundário "Anexar contexto" abre o `ContextPicker` (busca + seleção de `context_items` para forçar contexto específico); toggle **"Pesquisa web"** (pill ligada/desligada, default **ligada**; visível só quando `app_settings.web_search` habilita o recurso na instância — a presença de key no Vault não é visível ao usuário comum: se faltar, a saga pula a etapa com aviso); botão primário **Gerar**. Submit → `generate-content` `{prompt, channel_types?, web_search?}` → recebe `job_id` → a zona 2 assume.
- **Zona 2 — Job ativo (Realtime).** `JobTimeline`: linha de etapas com os estados da máquina do job (`created → classifying → retrieving → [researching] → generating → linting → grounding → judging → adapting → awaiting_review`; o passo **"Pesquisa"** só aparece quando o job pediu pesquisa web — `web_research.requested`), estado atual pulsando, tempos por etapa via `timings`. Estados especiais:
  - Passo "Pesquisa" concluído: mostra "N fontes" no passo e um card **"Fontes da pesquisa web"** com os links (`web_research.sources[]`, título + URL + provider); etapa pulada (`web_research.skipped`) vira aviso com o motivo — a peça foi gerada só com o acervo interno.
  - `awaiting_angle` (gatilho: `classification.needs_angle_choice === true`): a timeline pausa e abre o **`AngleSelector`** inline — 3-4 cards de ângulo vindos de `classification.angles[]`, cada um com hook proposto e resumo de abordagem; clique → `resume-job` `{job_id, selected_angle}` e a timeline retoma.
  - `rewriting`: badge "reescrevendo (tentativa N/2)" com o diagnóstico do juiz resumido.
  - `awaiting_review`/`done`: cards `PieceCard` das peças criadas com link para `/biblioteca/$pieceId`.
  - `failed`: alerta com `error` e botão "Tentar retomar" (`resume-job`).
- **Zona 3 — Jobs em andamento e recentes.** Lista compacta (prompt truncado, status badge, idade, canais alvo); jobs `awaiting_angle` de sessões anteriores reabrem o seletor ao clique. Fonte: `generation_jobs` ordenado por `created_at`, com subscription Realtime na tabela para a lista se atualizar sozinha.

### 4.2 `/biblioteca` e `/biblioteca/$pieceId`

**Lista (`/biblioteca`).** Header com filtros: tabs por `piece_status` (`draft` — rotulada "Para revisar" —, `approved`, `rejected`, `archived`), select por `channel_type`, busca por texto. Grid de `PieceCard` (miniatura do render ou primeiro bloco de texto, canal, status, mini-`AuditChips`, data). Clique → detalhe. Toggle **Lista/Calendário** (F5.4, 2026-08-01): a visão **Calendário** (`EditorialCalendar`, date-fns) é um grid mensal seg-dom navegável com as peças **aprovadas** que têm `scheduled_at` no intervalo (query por range no índice parcial), cada uma linkando ao detalhe — organização com humano no loop, sem auto-publish.

**Detalhe (`/biblioteca/$pieceId`).** Duas colunas (empilha no mobile — `use-mobile` do scaffold):

- **Coluna esquerda — preview por canal.** No topo, tabs com as peças-irmãs do mesmo `job_id` (uma tab por `channel_type` gerado) para navegar a entrega multi-canal sem sair da tela. O corpo renderiza o `adapted_content` no formato do canal:
  - `instagram_post`, `x_post`, `threads_post`: **`TweetCardRender`** (render determinístico client-side com tokens do `brand_kit`) + legenda abaixo.
  - `instagram_carousel`: deck navegável de slides tweet-card + legenda.
  - `instagram_stories`: deck navegável de 3-6 frames 9:16 (gancho → desenvolvimento → cta).
  - Painel **"Fotos da peça"** (2026-08-01: nos 3 canais de card — carrossel/`slides`, stories/`frames` 9:16, post/`card` único; `generate-image` scope `'slides'` — 07-contratos-backend.md §3.5): botão "Gerar fotos (N)"/"Regerar todas" dispara o batch (direção de arte em 1 chamada + fotos em background), barra de progresso via Realtime (`adapted_content.slide_images_job`), "Tentar os N que falharam" (`failed_indexes`) e "Regerar esta foto". Dois modos, e o toggle **comanda a geração** (vira `composition` no batch): **"Fundo de marca"** (default — o fundo do card é gradiente **determinístico** da paleta do brand kit, nada de foto aleatória atrás do texto; a foto IA **detalhada** ilustra o texto no bloco abaixo → `composition: 'inline'`) / **"Foto de fundo"** (foto **atmosférica** full-bleed atrás do texto, com scrim de leitura → `composition: 'background'`). Trocar de modo + regerar redireciona a arte (briefs e style bible anteriores são invalidados); o preview acompanha a composição do batch mais recente (`slide_images_job.composition`). A imagem única legada (`adapted_content.image_path`, caminho single antigo) aparece como **fallback** quando a unidade não tem foto própria. O card continua 100% client-side determinístico — a foto é insumo (`image_path` da unidade), nunca contém texto.
  - `linkedin_post`, `facebook_post`: imagem (de `render_path` ou `generate-image`) + legenda em bloco copiável.
- **Coluna direita — auditoria e proveniência.**
  - **`AuditChips`**: três chips (Linter · Grounding · Juiz) com cor por resultado; expandir mostra o diagnóstico completo do `audit` jsonb (`linter.violations`, `grounding.checked`/`grounding.flagged`, `judge.verdict` e `judge.score` comparados à nota de corte do canal, notas por regra em `judge.rules`).
  - **Marcações `[VERIFICAR]`**: lista das pendências (`core_content.verify_flags` + `audit.grounding.flagged`) com ação "confirmar dado" (edita o texto) ou "remover trecho" — gate para aprovar.
  - **Proveniência**: versões carimbadas (`persona_version`, `strategy_version`, `guardrails_version`, `brand_kit_version`, `engine_version`) e lista dos `context_ids` usados, com link para `/contexto/$itemId`.
- **Barra de ações (rodapé fixo).** **Aprovar** / **Rejeitar** (atualiza `content_pieces.status` e grava `piece_feedback` com veredito + notas opcionais); **Regenerar** (dialog com instrução livre — "mais provocador", "encurta" — → `regenerate-piece {piece_id, instruction}`); **Copiar texto**; **Baixar PNG** (signed URL de `render_path`, ou exporta o tweet-card client-side); **Exportar carrossel (ZIP)** / **Exportar stories (ZIP)** (carrossel e stories): renderiza os N cards client-side com a composição escolhida, baixa `01.png…NN.png` + `legenda.txt` (quando houver), sobe as artes para o bucket `renders` e persiste `adapted_content.slide_renders` (merge sobre a versão fresca da peça, para não sobrescrever o `slide_images_job` do batch); **Arquivar**. Em peça **aprovada**, bloco **"Agendar publicação"** (F5.4, 2026-08-01): input `datetime-local` grava `content_pieces.scheduled_at` (Agendar/Reagendar/remover) — a peça aparece na visão Calendário da Biblioteca; **rejeitar/arquivar zera o agendamento**; sem auto-publish (F5.9 segue P2 — publicar continua sendo copiar/exportar).

### 4.3 `/contexto` e `/contexto/$itemId` — Conteúdo de Contexto

**Lista (`/contexto`).** A UX deste módulo é prioridade explícita do produto (brief §1.6).

- **Header**: input de busca full-width (busca híbrida — ver nota abaixo), filtro por `kind` (tabs: Todos · `transcript` · `post` · `document` · `reference` · `case` · `offer`), filtro por tags (multi-select das tags existentes).
- **Ação "Adicionar"**: abre `Sheet` com três modos — **upload de arquivo** (dropzone → bucket `context-files`), **colar texto** (textarea + título), **URL** (`source_url`). Campos comuns: `kind`, tags; quando `kind = case`, formulário de metadata tipada (metric_type `brl|multiple|percent`, metric_value, client_name, sector, source_url, quote, objection_tags[], citation_policy `named|anonymous`). Salvar → insert em `context_items` (status `processing`) → `ingest-context {item_id}`.
- **Corpo**: tabela/lista com título, badge de `kind`, tags, **status de ingestão** (`processing` com spinner, `ready`, `error` com botão reprocessar), data. Realtime ou refetch em foco para o status virar `ready` sem reload (proposta — validar canal Realtime em `context_items`).
- **Detalhe (`/contexto/$itemId`)**: corpo do item (texto completo ou preview do arquivo com signed URL), edição de título/tags/metadata, contagem de `context_chunks` gerados, botão "Reprocessar" (`ingest-context`), botão excluir (com aviso se `context_ids` de peças referenciam o item — proposta — validar).

> **Nota — busca híbrida na UI**: filtros por `kind`/tags e full-text (`search tsvector` português) rodam direto via supabase-js. A parte semântica (pgvector) exige embedding da query no servidor: é a edge function **`search-context`** (ver 07-contratos-backend.md), que reusa o Retrieval de `_shared/retrieval.ts` (busca híbrida pgvector + FTS + filtros).

### 4.4 Wizard de onboarding (`/onboarding/*`)

Layout próprio (`OnboardingLayout` + `WizardShell`): coluna esquerda estreita com stepper vertical dos 9 passos (estados: concluído ✓, atual, bloqueado), logo e botão "Salvar e sair"; área principal com o passo corrente; rodapé com "Voltar" / "Continuar". Cada "Continuar" valida, grava e atualiza a key `onboarding` de `app_settings` (`current_step` + `completed_steps`) — o wizard é retomável de qualquer sessão (`onboarding/index.tsx` redireciona ao passo atual).

| # | Passo (rota) | Mostra | Valida | Grava |
| --- | --- | --- | --- | --- |
| 1 | `boas-vindas` | Boas-vindas, input do nome da marca, cards dos 4 templates de nicho (`criador-b2b`, `consultoria-financeira`, `clinica-saude`, `infoproduto`) + "começar em branco", com resumo do que cada preset pré-popula | nome não vazio; um template (ou em branco) escolhido | `brand_name` e `niche_template_slug` na key `onboarding` de `app_settings`; payload do `niche_templates` escolhido aplicado como **drafts iniciais** de `guardrails`/`brand_strategy` (proposta — validar mecânica de aplicação) |
| 2 | `ia-e-integracoes` | Card "Lovable AI Gateway — ativo, zero-config" como default; opção de expandir BYO keys (Anthropic recomendado p/ gerador e juiz, OpenAI opcional) com `SecretInput` write-only; seleção opcional de provider/modelo por papel (defaults pré-selecionados) | keys, se informadas, aceitas pelo `store-secret`; nada é obrigatório (gateway é default) | seleção por papel em `app_settings`; keys no Vault via `store-secret` (nunca voltam ao client) |
| 3 | `contexto` | Mini-versão do módulo `/contexto`: adicionar por upload/texto/URL, lista com status de ingestão em tempo real; orientação de que quantidade/qualidade aqui define a voz | ≥ 1 item com status `ready` (proposta — validar mínimo) | `context_items` (+ `ingest-context` por item) |
| 4 | `voz` | Dois caminhos: (a) **extração assistida** — `ContextPicker` seleciona itens do corpus → `extract-voice` → rascunho das 9 seções do contrato de voz em formulário editável (identity, credenciais[], worldview/teses, tone_principles, signature_lexicon, calibration_heuristics, banlist-ref, opinioes, voice_checklist, reference_examples); (b) **entrevista guiada** sem corpus — perguntas sequenciais que preenchem as mesmas seções | seções obrigatórias preenchidas (identity, tone_principles, voice_checklist no mínimo — proposta — validar) | `brand_persona` v1 `active` |
| 5 | `bandeira` | Formulário de `brand_strategy`: brand_promise, theses[], enemy, safe_list[], icp (perfil + desejos[]), editorial_stance, content_mix, cta_repertoire — pré-populado pelo template de nicho quando houver | brand_promise + ≥ 1 tese + icp preenchido (proposta — validar) | `brand_strategy` v1 `active` |
| 6 | `guardrails` | Listas editáveis (chips): banned_punctuation, banned_words, banned_metaphors, banned_ctas, allowed_ctas; nota de corte (approval_threshold) com default conservador; dosage_rules — tudo pré-populado pelo template | listas coerentes (allowed ∩ banned ctas = ∅ — proposta) | `guardrails` v1 `active` → **destrava a geração (mínimo viável)** |
| 7 | `brand-kit` | Paleta (color pickers), tipografia, upload de logo e fotos (bucket `brand-assets`), negative_constraints[] | logo opcional; paleta com defaults | `brand_kit` v1 `active` |
| 8 | `canais` | `ChannelToggleList`: toggle por `channel_type` dos 7 formatos, cada um com miniatura ilustrativa do formato e limites do adapter | ≥ 1 canal ativo | `channels.enabled` |
| 9 | `gate-de-tom` | Botão "Gerar amostras" → `tone-gate` gera 3 peças-amostra pelo pipeline completo (Realtime de progresso); cada amostra renderizada com `TweetCardRender` + `AuditChips`; aprovar/reprovar por peça com campo de motivo | 3 amostras avaliadas | vereditos em `piece_feedback`; **reprovação → volta ao passo `voz`** com o diagnóstico; aprovação → `onboarding.completed = true` → redirect `/` |

### 4.5 `/marca/*` — edição versionada (draft → ativar)

`/marca` (hub) é uma grade de cards — Persona, Bandeira, Guardrails, Brand Kit, Canais — cada um mostrando versão ativa, data da ativação e botão "Editar".

As quatro telas versionadas (`persona`, `bandeira`, `guardrails`, `brand-kit`) compartilham o mesmo padrão via componente **`VersionedEditor`**:

- **Modo leitura** (default): renderiza o `content` da linha `active`, com `VersionBadge` ("v3 · ativa desde 12/07") e histórico de versões (lista lateral; selecionar mostra versão `archived` em read-only).
- **"Editar"** → cria linha `draft` (cópia da active, `version + 1`) e abre o formulário do documento (o mesmo formulário do passo correspondente do onboarding — reuso direto dos componentes de passo).
- **Ações no draft**: "Salvar rascunho" (persiste sem ativar; badge "rascunho não ativado" fica visível no hub) e **"Ativar"** (draft→`active`, anterior→`archived` — transação; peças novas passam a carimbar a nova versão). "Descartar rascunho" disponível.
- Aviso fixo: alterações não afetam peças já geradas (versões são carimbadas por peça).

`/marca/canais` não é versionada: lista dos 7 canais com toggle `enabled` e edição do `config` jsonb (overrides de limites/template/nota de corte) num painel por canal.

### 4.6 `/config/*` — administração (admin only)

Layout com tabs horizontais no topo da área de conteúdo (Usuários · IA · Integrações · Instância).

- **`/config/usuarios`** — tabela de `profiles` + role (`user_roles`): nome, e-mail, papel, data. Ações: convidar (`InviteUserDialog` → `invite-user {email, role}`), alterar papel, remover acesso. Aviso quando só existe 1 admin (não permitir remover o último — proposta — validar).
- **`/config/ia`** — matriz de seleção provider/modelo por **papel** (Roteador, Gerador, Juiz, Embeddings, Imagem), gravada em `app_settings`; card **"Pesquisa web"** (`app_settings.web_search`: provedor `auto | tavily | firecrawl | anthropic | openai | off` + resultados por busca 1-10; "Automático" usa a 1ª key do Vault na ordem tavily → firecrawl → anthropic → openai — sem key nenhuma, a etapa é pulada com aviso no job, pois o gateway não tem busca própria); gestão de keys BYO incluindo **`TAVILY_API_KEY`** e **`FIRECRAWL_API_KEY`** (`SecretInput` write-only + status "configurada em DD/MM" — valor nunca retorna; Tavily/Firecrawl habilitam a pesquisa web na instância só-gateway, Firecrawl com conteúdo integral raspado); indicador de consumo/créditos do gateway com aviso do erro 402 quando esgotar.
- **`/config/integracoes`** — no MVP, gestão genérica de segredos de integração via `store-secret` (nome + valor, write-only) e placeholders desabilitados para publicação OAuth (P2) (proposta — validar conteúdo mínimo desta tela no MVP).
- **`/config/instancia`** — diagnóstico: `ENGINE_VERSION`, versões ativas dos documentos de marca, checagens de saúde (extensões `vector`/`pg_cron`, buckets, ping das edge functions), contadores (peças, jobs, itens de contexto), status do watchdog.

---

## 5. Componentes compartilhados (`src/components/`)

Componentes de domínio ficam em `src/components/` (raiz), separados do `src/components/ui/` do shadcn (que não se edita). Nomes de arquivos em kebab-case, componentes em PascalCase (proposta — validar convenção).

| Componente | Usado em | Descrição |
| --- | --- | --- |
| `AppSidebar` | layout `_app` | Sidebar shadcn (`components/ui/sidebar.tsx`) com navegação (Dashboard, Criar, Biblioteca, Contexto, Marca, Config-se-admin), usuário logado e logout |
| `WizardShell` | `/onboarding/*` | Stepper vertical dos 9 passos + área do passo + navegação Voltar/Continuar; lê/grava a key `onboarding` de `app_settings` |
| `JobTimeline` | `/criar`, dashboard, gate de tom | Linha de etapas da máquina de estados do job com estado atual, tentativas de reescrita e `timings`; alimentada por Realtime |
| `AngleSelector` | `/criar` | Cards de 3-4 ângulos (`classification.angles[]`) com hook; seleção dispara `resume-job` (proposta — validar nome) |
| `PieceCard` | `/biblioteca`, dashboard, `/criar` (zona 2) | Card de peça: miniatura/preview, canal, status, mini-chips de auditoria |
| `AuditChips` | detalhe da peça, `PieceCard`, gate de tom | Chips Linter/Grounding/Juiz com cor por resultado e popover/accordion de diagnóstico do `audit` jsonb |
| `TweetCardRender` | previews, gate de tom, export PNG | Render determinístico do estilo tweet-card (texto principal + imagem opcional abaixo) com tokens do `brand_kit`; exporta PNG client-side (lib tipo `html-to-image` — proposta — validar) |
| `StoriesFramesPreview` | detalhe da peça | Strip de frames 9:16 do adapter `instagram_stories` (proposta) |
| `ContextPicker` | `/criar`, onboarding passo `voz` | Dialog de busca+seleção múltipla de `context_items` (filtro por kind/tags) |
| `ContextItemForm` | `/contexto`, onboarding passo `contexto` | Sheet de cadastro (upload/texto/URL) incl. metadata tipada de `case` (proposta) |
| `UploadDropzone` | contexto, brand-kit | Dropzone para buckets privados com progresso (proposta) |
| `VersionedEditor` + `VersionBadge` | `/marca/*` | Padrão leitura/draft/ativar/histórico sobre as 4 tabelas versionadas |
| `ChannelToggleList` | `/marca/canais`, onboarding passo `canais` | Toggles por canal com limites do adapter (proposta) |
| `VerifyMarkList` | detalhe da peça | Lista das marcações `[VERIFICAR]` com confirmação/edição (proposta) |
| `SecretInput` | onboarding passo 2, `/config/ia`, `/config/integracoes` | Input write-only de segredo: envia ao `store-secret`, mostra apenas "configurada", nunca lê valor (proposta) |
| `InviteUserDialog` | `/config/usuarios` | Dialog e-mail + papel → `invite-user` (proposta) |
| `EmptyState`, `PageHeader` | todas | Utilitários de layout consistente (proposta) |

Os formulários dos passos do wizard (`StepVoice`, `StepStrategy`, `StepGuardrails`, `StepBrandKit`) são construídos como componentes reutilizáveis (ex.: `PersonaForm`, `StrategyForm`, `GuardrailsForm`, `BrandKitForm` em `src/components/brand/` — proposta), pois as telas `/marca/*` reusam exatamente os mesmos formulários dentro do `VersionedEditor`.

---

## 6. Hooks de dados (`src/hooks/`)

Padrão: **TanStack Query sobre supabase-js** para todas as leituras/escritas de tabela (direto via PostgREST, dentro do RLS), `supabase.functions.invoke` para toda lógica de negócio (edge functions — decisão do brief §8), e **Realtime para jobs e peças**. Nomes abaixo são proposta — validar.

| Hook (arquivo) | Expõe | Fonte |
| --- | --- | --- |
| `use-session.ts` | `useSession()` — sessão + `onAuthStateChange` (limpa cache no logout) | `supabase.auth` |
| `use-roles.ts` | `useUserRoles()`, `useIsAdmin()` (controla visibilidade do item Config na sidebar) | `user_roles` |
| `use-app-settings.ts` | `useAppSetting(key)`, `useOnboardingProgress()` + mutation de progresso | `app_settings` |
| `use-generation.ts` | `useCreateJob()` (→ `generate-content`), `useJob(jobId)` **com subscription Realtime**, `useResumeJob()`, `useActiveJobs()` | `generation_jobs` + functions |
| `use-pieces.ts` | `usePieces(filters)`, `usePiece(id)`, `useSiblingPieces(jobId)`, `useApprovePiece()`/`useRejectPiece()` (status + `piece_feedback`), `useRegeneratePiece()` (→ `regenerate-piece`), `useGenerateImage()` | `content_pieces`, `piece_feedback` + functions |
| `use-context.ts` | `useContextItems(search, filters)`, `useContextItem(id)`, `useCreateContextItem()` (+ upload), `useIngestContext()` | `context_items` + `ingest-context` + Storage |
| `use-versioned-doc.ts` | `useVersionedDoc(table)` genérico — `active`, `draft`, `history`, `saveDraft()`, `activate()` — para `brand_persona`/`brand_strategy`/`guardrails`/`brand_kit` | 4 tabelas versionadas |
| `use-channels.ts` | `useChannels()`, `useToggleChannel()`, `useUpdateChannelConfig()` | `channels` |
| `use-users-admin.ts` | `useMembers()`, `useInviteUser()` (→ `invite-user`), `useChangeRole()` | `profiles`, `user_roles` + function |
| `use-storage.ts` | `useSignedUrl(bucket, path)` para `renders`/`brand-assets`/`context-files` | Storage |

Convenção de query keys (proposta): `['session']`, `['roles']`, `['app-settings', key]`, `['jobs']` / `['job', id]`, `['pieces', filters]` / `['piece', id]`, `['context-items', filters]` / `['context-item', id]`, `['doc', table, 'active' | 'draft' | 'history']`, `['channels']`.

### 6.1 Padrão Realtime dos jobs

O frontend nunca faz polling da saga: assina mudanças no Postgres e invalida as queries. Um canal por job em foco + um canal de lista quando `/criar` ou `/biblioteca` estão montadas.

```ts
// dentro de useJob(jobId) — (proposta — validar)
useEffect(() => {
  if (!jobId) return;
  const channel = supabase
    .channel(`job-${jobId}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "generation_jobs", filter: `id=eq.${jobId}` },
      () => queryClient.invalidateQueries({ queryKey: ["job", jobId] }),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "content_pieces", filter: `job_id=eq.${jobId}` },
      () => queryClient.invalidateQueries({ queryKey: ["pieces", { jobId }] }),
    )
    .subscribe();
  return () => void supabase.removeChannel(channel);
}, [jobId]);
```

Requer as tabelas `generation_jobs` e `content_pieces` na publication do Realtime (migration em F0 — ver 09-plano-implementacao.md). O RLS vale também para Realtime, então o cliente só recebe linhas que pode ler.

---

## 7. O que se reusa do scaffold (não recriar)

| Item do scaffold | Papel no produto |
| --- | --- |
| `src/routes/__root.tsx` | Shell HTML + `QueryClientProvider` + `errorComponent`/`notFoundComponent` prontos. Manter; ajustar apenas `<title>`/meta para a marca da instância |
| `src/integrations/supabase/client.ts` | Client browser tipado (`Database`) — base de todos os hooks do §6 |
| `src/integrations/supabase/client.server.ts` | Client admin (service role) — quase não usado no frontend, já que lógica de negócio é edge function; permitido só em SSR trivial (brief §8) |
| `src/integrations/supabase/auth-middleware.ts` + `auth-attacher.ts` | Middleware global que anexa o bearer token a todo serverFn (registrado em `src/start.ts`). Fica registrado, mesmo com serverFns restritas a SSR trivial |
| `src/integrations/supabase/types.ts` | Tipos gerados do banco — **regenerar após cada migration** (F0 em diante) |
| `src/components/ui/*` (47 shadcn new-york) | Toda a UI: `sidebar`, `sheet`, `dialog`, `tabs`, `table`, `carousel`, `command` (base do `ContextPicker`), `form`, `sonner` (toasts), `progress`, `badge` etc. Não editar; compor em `src/components/` |
| `src/styles.css` | Tokens de design em oklch (Tailwind v4) — base do tema; o `TweetCardRender` consome os tokens do `brand_kit` por CSS variables sobre essa base |
| `src/hooks/use-mobile.tsx` | Breakpoint para colapsar sidebar e empilhar colunas do detalhe da peça |
| `src/lib/utils.ts` (`cn`) + `src/lib/*error*` | Utilitário de classe + captura/report de erros já plugada no `__root.tsx` |
| Auth Lovable Cloud (e-mail/senha, confirmação ativa) | `/login` usa o fluxo nativo; sem provider OAuth no MVP |

O que **não** existe no scaffold e será criado neste doc e nos irmãos: todas as rotas além de `__root.tsx`/placeholder, `src/components/` de domínio (§5), `src/hooks/` de dados (§6), `src/lib/guards.ts`, migrations e edge functions (04-modelo-de-dados.md, 07-contratos-backend.md).

---

## 8. Resumo de rastreabilidade

- Rotas, slugs de passos, guards e módulos: brief canônico §7 (integral, nomes exatos).
- Máquina de estados exibida no `JobTimeline`: enum `job_status` do brief §6.
- Ações da Biblioteca e chips: brief §3 (auditoria 3 classes) e §11 (escopo P0).
- Tudo marcado com "(proposta — validar)" é derivação conservadora deste doc — consolidar decisões no 00-INDICE.md quando validadas.
