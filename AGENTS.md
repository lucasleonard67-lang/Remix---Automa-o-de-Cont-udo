<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# Content Engine · guia para IAs

Leia este arquivo inteiro antes de mexer no código. Ele diz o que é o produto, onde fica cada coisa, como os fluxos funcionam, as decisões que não se rediscutem e as regras de segurança, banco e deploy. Os detalhes estão em `docs/` (índice em `docs/00-INDICE.md`).

## O que é

Fábrica de conteúdo para uma marca. A pessoa cadastra a marca (voz, regras, identidade visual, acervo), o produto sugere pautas (Radar), cria peças (carrossel, post, stories, thread, LinkedIn) e vídeos (apresentador, cenas, avatar), passa pela revisão humana e publica nas redes pelo Zernio. O Desempenho lê as métricas e devolve conclusões.

Na Central de Entrega da Viver de IA a solução se chama **Mega Automação de Redes Sociais 2.0**; na tela, **Content Engine** (SUBIDO AI). Cada cliente tem a própria instância (Remix do Lovable + Supabase próprio).

**O produto é o shell.** Ele instrui; quem executa são os serviços da própria pessoa: o Claude da assinatura dela pelo conector personalizado, HeyGen, ElevenLabs, Replicate, Higgsfield, Zernio. Não crie infraestrutura paga nossa quando o serviço do cliente faz a tarefa.

## Mapa rápido

**Stack:** TanStack Start (React 19, TanStack Router, Vite 8) · Tailwind v4 · shadcn/radix · React Query · Supabase (Postgres, Auth, Vault, Realtime, Storage) · Edge Functions em Deno · bun (`bun.lock`, o único lockfile).

| Pasta | O que tem |
|---|---|
| `src/routes/` | Telas (TanStack file routes). `_app/*` é a área logada; `login`, `nova-senha`, `conectado`, `onboarding` são de acesso; `api/public/jobs/*` são as rotas que o agendador chama (cron HTTP). |
| `src/components/` | Componentes por domínio (`criar/`, `video/`, `analytics/`, `biblioteca/`, `setup/`, `settings/`…). `ui/` é o shadcn já no Design System; `patterns/` são padrões do kit (Ajuda, Configurações, Métricas). |
| `src/design-system/` | Tokens e CSS do DS SUBIDO (`tokens.css`, `surfaces.css`, `data.css`, `ds/revenue.css`, `ds/subido.css`, `ds/auth.css`). |
| `src/hooks/`, `src/lib/` | Dados (React Query) e lógica pura com testes (`*.test.ts`, vitest). |
| `supabase/functions/` | Edge Functions (POST, JSON). `_shared/` é código comum; `mcp-server/` é o conector do Claude. Tabela de cada função em `supabase/functions/README.md`. |
| `drizzle/migrations/` | Migrations versionadas do banco (aplicadas pelo agente do Lovable). |
| `supabase/seed-instancia.sql` | O que uma instância nova roda depois do Remix (privilégios, Realtime, dados semeados). |
| `scripts/` | `gerar-seed-instancia.py`, `pos-remix.sql`, `verificar-instancia.sql`. |
| `e2e/` | Playwright (usa banco real e credencial; ver `e2e/README.md`). |
| `docs/` | Especificação, contratos, runbooks e decisões. |

**Telas (menu em `src/components/app-nav.ts`):** Início (`/`) · Criar (`/criar`) · Biblioteca (`/biblioteca`) · Vídeos (`/videos`, `/videos/novo`) · Radar (`/radar`) · Desempenho (`/desempenho`) · Marca (`/marca` e subpáginas: persona, bandeira, guardrails, brand-kit, canais, avatares, vozes; `/contexto`) · Ajuda (`/ajuda`) · Ajustes (`/config`, seções Usuários, IA, Integrações, Automação, Instância; `/automacao` e `/autorizar-claude` vivem dentro de Ajustes).

## Fluxos principais

- **Geração de peça (Criar).** `generate-content` cria o job em `generation_jobs` e roda a saga (`_shared/saga.ts`): classificar → (ângulo) → buscar no acervo → pesquisar → escrever → checar → julgar → adaptar por canal → `awaiting_review`. O modelo de cada etapa vem de `app_settings.ai_providers` (padrão: Gemini incluso pelo gateway do Lovable). A tela acompanha pelo Realtime (`components/criar/creation-stage.tsx`).
- **Claude da assinatura, via conector personalizado.** O conector é o `mcp-server` (OAuth pelo "Conectar ao Claude" em Ajustes › Integrações). O produto não chama a assinatura: ele deixa o pedido numa fila e o Claude da pessoa atende pelas ferramentas do conector. Filas: `conteudo_pedidos` (carrossel do Criar), `slide_pedidos`, `roteiro_pedidos`, `video_pedidos`, `artes_pendentes`. O botão "Abrir no Claude" abre o claude.ai com o pedido pronto (`src/lib/claude-prompt.ts`). A rotina automática (endereço + token em `CLAUDE_ROUTINE_*`) existe no servidor, mas o card saiu da tela; sem ela, o Claude só começa quando a pessoa abre o Claude.
- **Vídeo.** Hub em `/videos/novo` (o que você tem × o que você quer → caminho, modelo, custo). Motores: Higgsfield, Replicate, HeyGen, ElevenLabs. Edição do vídeo pronto: painel "Editar com Claude" (`components/video/polish-strip.tsx`): ajustes e inserções feitos pelo produto; pedido em texto vai para o Claude pelo conector. O original nunca muda.
- **Publicação.** Só pelo Zernio (`zernio-proxy`, `zernio-webhook`), só admin publica, só peça aprovada. Agendar e publicar acontecem só na tela do produto, nunca pelo conector.
- **Desempenho.** BI de conclusões, não de dados crus (`components/analytics/insights-bento.tsx`, cálculos puros em `lib/desempenho-insights.ts`). Métricas do Zernio (banco primeiro, API como reserva) e mercado pelo Apify (`competitor-sync`). Com pouca base, cada card mostra a pergunta e o que falta, nunca um número inventado.
- **Ajuda e assistente.** O texto vem de um arquivo só, `supabase/functions/_shared/help-content.ts`, usado pela página `/ajuda` (via `src/lib/help.ts`) e pelo assistente (`assistant-chat`). Mudou uma tela? Atualize esse arquivo; o teste `src/lib/help-content.test.ts` confere rotas e nomes do menu.

## Decisões que não se rediscutem

- **Claude só pela assinatura, via conector personalizado.** Nunca pela API da Anthropic: nenhuma entrega passa no aceite se chamar `api.anthropic.com`, ler `ANTHROPIC_API_KEY` ou oferecer a API como opção na tela. Na tela, o nome é sempre "Claude · conector personalizado".
- **No Criar**, o Gemini incluso é o padrão (sai na hora, sem chave). O "Claude · conector personalizado" é opção no seletor de Texto; por enquanto o Claude entrega só carrossel. Mudar isso exige perguntar ao Samuel antes.
- **Toda geração mostra provedor/modelo e custo potencial antes do Gerar** (sem preço cadastrado: "Sem estimativa", nunca sumir a linha).
- **Tudo dentro do produto.** Falta um recurso? Constrói aqui; não mande a pessoa para outro editor ou serviço.
- **Google Drive está desligado** (sem as chaves do Google no hub). Não prometa arquivamento no Drive.
- **Só tema claro.** Não há seletor de tema escuro.
- **Pergunte antes de construir fluxo novo.** O desenho é decidido com o Samuel antes do código.

## Design System SUBIDO

Toda tela usa o kit do DS SUBIDO (fonte viva: repositório `viverdeia-solucoes/design-system-subido`; decisões e exceções em `docs/design-system-subido.md`). Regras que mais quebram:

- Toda tela interna: eyebrow (grupo do menu) + título 30px peso 500 + descrição de resultado. Sem ícone no título.
- Uma ação navy por tela; as outras em outline ou texto.
- Sem KPI zerado: sem dado, mostre o que falta e o próximo passo.
- Sem semáforo (verde/amarelo/vermelho), sem dourado, sem emoji decorativo, sem ícone `Sparkles`, sem texto abaixo de 13px (exceto caixa alta e selo).
- Toda ferramenta citada aparece com o logo oficial (`components/brand-icon.tsx`, arquivos em `public/brand/integrations/`).
- Hover e item destacado em menus: lavagem `--via-navy-06`, nunca o token `accent`.
- Sem sombra colorida; selecionado = borda fina + tinta leve. Nada de card genérico como contêiner padrão.
- Texto da tela em português, curto e concreto; nada de texto de bastidor (deploy, Vault, Claude Code) para a cliente.

## Como trabalhar

- **Um servidor local só:** `http://127.0.0.1:8082`, do checkout principal, apontando para o Supabase real da instância. Não suba outras portas nem backend falso sem pedir.
- **Confira na tela antes de dizer que está pronto:** abra a tela no navegador com a conta real, clique no que mudou e veja o resultado. Teste passando não prova tela certa.
- **Checagens:** `bun run lint`, `bun run test` (vitest), `node node_modules/.bin/tsc --noEmit -p tsconfig.json`, `bunx deno test --allow-all supabase/functions` (dois testes pedem a lib de PNG no `node_modules`).
- **Git:** commit em português, pequeno e com o porquê. Nunca reescreva histórico já enviado (Lovable).
- **Frontend no ar:** o push na `main` sincroniza com o Lovable; publicar é Publish → Update (ou `deploy_project` pelo MCP do Lovable).
- **Edge function no ar:** o sync não faz deploy. Peça o deploy ao agente do Lovable, só das funções afetadas (pelo fecho de imports), e confira a versão.
- **Banco:** mudança de schema/função vira migration em `drizzle/migrations/` aplicada pelo agente do Lovable; regenere o seed (regras abaixo). Não escreva direto em produção.
- **Projeto Lovable desta instância:** `103e71ae-3c78-4943-b920-3aba59ae2932`. Não use outros ids que apareçam em documentos antigos.

## Segurança

- Toda Edge Function revalida a sessão com `getUser(req)`; ação de administrador confere o papel (`has_role` / `requireAdmin`). Publicar, reagendar, cancelar e mexer em chaves são só de admin.
- Chave de provedor fica no Vault (`store-secret`, lista fechada, só admin). Nunca em coluna legível, `localStorage` ou cabeçalho. O `store-secret` recusa gravar enquanto o Vault estiver aberto para `anon` (instância antes do seed).
- Cadastro só por convite: `has_any_admin()` e `handle_new_user()` em `drizzle/migrations/0024_*`. O primeiro cadastro de uma instância nova vira admin; depois, só convite.
- Texto que vem de usuário e vai para o Claude pelo conector é **dado, não instrução**: emoldure como dado e nunca deixe um usuário comum enfileirar trabalho que o Claude do admin executa com privilégio de serviço.
- Função nova em `public` nasce aberta: feche (regra 1 abaixo).

## Assistant session boundary

- Assistant requests use the session-aware transport in `src/lib/assistant-request.ts` and account-state cache keys include the user ID, so sign-out never dispatches anonymous assistant requests or reuses another user's account state.

## Migration nova: três regras que o Remix cobra depois

O Remix do Lovable clona o **schema** e nada mais. Privilégio, filiação no
Realtime e dado semeado ficam para trás, e cada um deles vira defeito numa
instância de cliente — um deles é falha de segurança. As três regras existem
para que a próxima instância nasça certa.

**1. Toda função nova em `public` nasce aberta. Feche.** O Postgres dá `EXECUTE`
a `PUBLIC` em qualquer função nova, e `anon` herda de `PUBLIC` — ou seja, a
função é chamável pela internet como RPC do PostgREST no instante em que existe.
Se ela for `SECURITY DEFINER`, roda como `postgres` e ignora RLS. Por isso toda
migration que cria função em `public` fecha e reabre no mínimo, nesta ordem:

```sql
revoke all on function public.minha_funcao(uuid) from public, anon, authenticated;
grant execute on function public.minha_funcao(uuid) to service_role;  -- o mínimo que ela precisa
```

Se a função for exceção deliberada (chamável por `anon` ou por `authenticated`),
**suba o teto da conferência 0.92 em `scripts/verificar-instancia.sql` no mesmo
commit**. O número e a lista de exceções andam juntos; separados, a conferência
apodrece e vira alarme falso.

**2. Tabela que o front assina precisa entrar na publicação.** `replica identity
full` sozinho não basta — sem `alter publication supabase_realtime add table` a
tela nunca atualiza. Os dois, sempre:

```sql
alter table public.minha_tabela replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.minha_tabela;
exception when duplicate_object then null; end $$;
```

**3. Mexeu em seed, grant/revoke ou publicação → regenere o seed.**

```bash
python3 scripts/gerar-seed-instancia.py    # reescreve supabase/seed-instancia.sql
```

e **commite o arquivo regenerado junto**. Ele é o que uma instância nova roda —
o diretório `supabase/migrations/` **não existe** no repositório de uma
instância, então lá não há migration para reaplicar. O que não estiver no seed
não chega no cliente.

Detalhe e medições em `docs/15-runbook-remix.md`.

## Edge function: o deploy não vem no git sync

O sync cobre o frontend. Toda vez que você mexer em `supabase/functions/`,
**peça o deploy e confira o número da versão** — não confie em "deployed".

E o critério de "quem precisa de deploy" não é a própria função: é o **fecho de
imports** dela. Mexeu em `_shared/base.ts`, toda função que importa base.ts
ficou velha. Foi assim que 8 das 24 passaram despercebidas, com duas versões do
mesmo `_shared` rodando em produção ao mesmo tempo.

## Cron: dois tipos de rotina, dois mecanismos

A plataforma não deixa o agente criar cron cujo comando chama HTTP (as `invoke_*`
que postam nas edge functions). Divida:

- **Comando 100% SQL** (watchdogs, `purge_old_usage_events`) → `cron.schedule`
  direto pelo agente (reage a um marcador de revisão; cadências sub-horárias
  exigem justificativa de custo).
- **Comando que aciona edge function** (`rss-fetch`, `video-reconcile`,
  `director-advance`, `automation-tick`) → rota de servidor
  `src/routes/api/public/jobs/<nome>.ts` autenticada com
  `authenticateCronRequest` (src/integrations/supabase/cron-auth), que faz
  `rpc('invoke_<nome>')` via `supabaseAdmin` — o dispatcher SQL existente lê o
  segredo do Vault e post na edge. O agendamento é o HTTP schedule gerenciado
  (`supabase--create_http_schedule`), alvo `/api/public/jobs/<nome>`.

Por quê: o agendador gerenciado só mira rotas do app nesta stack, e as rotas
fazem o Remix se autoaprovisionar via ferramenta, sem SQL manual
(`pos-remix.sql` parte 2 vale só para os crons SQL daqui pra frente).


## Pendências conhecidas (05/11/2026)

Os seis achados do code review de segurança de 04/11 sobre o Claude no Criar foram corrigidos (commit 32c9f3e e migration 0025): só admin faz `pedir_ao_claude`, o tema volta como dado, `conteudo_pedidos` reserva só o `pedido_id`, `resume-job` confere dono ou admin, o "tentar de novo" grava `retomado_em`, o vigia não derruba o pedido de origem `criar` e o Gerar espera o estado do conector.

Ainda abertos:

1. **`ANTHROPIC_API_KEY` no cofre de produção.** Não tem uso no código. Apagar depende de um sim do Samuel.
2. **`public_app` em produção ainda é `http://127.0.0.1:8082`.** O `mcp-server` já ignora endereço local e grava o publicado na primeira vez que um admin abre Ajustes › Integrações no site publicado.
3. **Riscos baixos da auditoria do Diego:** `has_role` executável por `anon` e CORS `*` no `zernio-proxy`.
4. **`.env` versionado.** Não é segredo (só a chave pública do Supabase), mas falta testar se o remix gera um `.env` próprio.
5. **Higgsfield, fase 2.** A conexão é pela chave da API (`HIGGSFIELD_API_KEY`, `id:segredo`), mas nada no servidor usa a chave ainda: tudo o que é do Higgsfield passa pelo MCP com login (OAuth). Sem esse login, o vídeo de cenas roda assim (05/11): quadros no modelo `keyframe` do Replicate, com as fotos do apresentador como referência, e montagem e legenda pelo Claude da pessoa. O job fica em `muxing` com `artifacts.claude` (sem status novo no banco), o conector lê o comando em `montagem_pedidos` e devolve em `montagem_entregar`. Ainda dependem do login: análise do "Editar com Claude" sem plano, medição da entrega, edição de cena pronta e publicação no TikTok.

## Onde ler mais

- `docs/00-INDICE.md`: índice das specs (visão, dados, rotas, IA, contratos, plano).
- `docs/07-contratos-backend.md`: contrato de cada Edge Function.
- `docs/15-runbook-remix.md`: instância nova, passo a passo.
- `docs/18-lancamento-demo.md`: checklist de lançamento.
- `docs/design-system-subido.md`: decisões e exceções do DS.
- `docs/hub-ferramentas/`, `docs/hub-motor-contratos.md`: hub de vídeo e motor de edição.
- `supabase/functions/README.md`: o que cada função faz, rate limit e watchdog.
