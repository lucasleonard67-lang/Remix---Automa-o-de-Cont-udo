# 08 — Estratégia de Template por Cliente (Remix)

Este documento define como o Content Engine é entregue a cada cliente: o template base (este
repositório + este projeto Lovable) é **remixado** por cliente, criando uma instância
fisicamente isolada — novo projeto Lovable, novo Supabase, novo deploy, novo repositório. Não
existe lógica própria de provisionamento: o **Remix do Lovable** é o mecanismo, por decisão do
dono do produto. Este doc cobre o ciclo de vida de uma instância, o runbook de provisionamento,
a estratégia de atualização do motor e os limites do modelo. Contexto nos irmãos:
02-escopo-mvp.md (escopo), 04-modelo-de-dados.md (migrations e seeds), 09-plano-implementacao.md
(fase F5, onde este runbook é validado).

## 1. Ciclo de vida de uma instância

```
Template base (repo + projeto Lovable "mega-automa-o-3.0")
        │  Remix (Lovable)
        ▼
Nova instância: projeto Lovable novo + Supabase novo (VAZIO) + deploy novo + repo git sync novo
        │  migrations do repo (aditivas, idempotentes)
        ▼
Schema criado + seeds de fábrica (niche_templates, channels defaults) — ZERO dado de cliente
        │  primeiro acesso
        ▼
Primeiro signup → trigger handle_new_user → vira ADMIN → redirecionado a /onboarding
        │  onboarding self-serve (9 passos)
        ▼
Recheio populado (persona, bandeira, guardrails, brand kit, contexto, keys) → gate de tom
        │
        ▼
Operação: /criar → saga de geração → /biblioteca. Atualizações do motor chegam por git.
```

## 2. Zero-resíduo por construção

No modelo antigo (copiar a squad de um cliente para outro), o risco era vazar identidade do
cliente-fonte e exigia lint de "zero resíduo". No modelo Remix isso é **garantido por
construção**, sem lint:

- O **recheio é 100% banco de dados** (ver matriz na §6). O template não contém persona,
  cases, ban list, brand kit ou qualquer dado de cliente — só código do motor e seeds de
  fábrica genéricos (templates de nicho, defaults de canais).
- O Remix cria um **Supabase vazio** e replica o **schema** do template — e só o schema.
  Medido em 2026-08-31 contra dois Remixes: a estrutura vem inteira (310 colunas, 102
  constraints, 86 índices, 49 policies, 25 funções com md5 do corpo idêntico), mas **não
  vêm os dados semeados, os PRIVILÉGIOS, a publicação do Realtime, o cron, o Vault, o
  gatilho `on_auth_user_created` nem o próprio diretório `supabase/migrations/`** (404 no
  repo da instância). A perda de privilégio é falha de segurança: sem os REVOKE, `anon`
  executa as 25 funções de `public`, incluindo `get_vault_secret`. Conserto e detalhe em
  `15-runbook-remix.md` §2; prompt pronto em `16-prompt-configuracao-instancia.md`.
- Não há nada para "limpar": os canais que o Remix trouxe vieram **limpos**, sem a conta do
  Zernio do dono do template.
- Segredos (API keys BYO) vivem no **Vault do Supabase da instância**, nunca no repo — um
  Remix jamais carrega segredos de outra instância.

Verificação de sanidade (entra no checklist da §3): após o Remix, `select count(*)` nas
tabelas de recheio (`brand_persona`, `context_items`, `content_pieces`) deve retornar 0.

## 3. Runbook de provisionamento (equipe Viver de IA)

Checklist objetivo, executado por quem entrega a implementação (a configuração da marca em si
é do cliente, no onboarding):

1. **Remix**: no projeto Lovable template, executar Remix. Nomear o projeto com o slug do
   cliente (ex.: `content-engine-acme`).
2. **Workspace/billing**: garantir que o projeto novo está no workspace correto (decidir por
   contrato: workspace do cliente — cliente paga créditos — ou workspace da Viver de IA com
   repasse). (proposta — validar modelo comercial por cliente)
3. **Git sync**: conectar o repo GitHub da instância (o Lovable cria/conecta no Remix).
   Adicionar o remote do template para updates futuros:
   `git remote add template git@github.com:MindOpsTeam/mega-automa-o-3.0.git`.
4. **Banco**: rodar `scripts/verificar-instancia.sql` **duas vezes, com alguns minutos entre
   as leituras** (a replicação é assíncrona), e semear o que ainda faltar na segunda:
   `supabase/seed-instancia.sql` (dados + o gatilho `on_auth_user_created`, que o Remix
   perde) e `scripts/pos-remix.sql` (`instance_url` + os 7 cron jobs). Esperado ao fim:
   `niche_templates` 4, `channels` 8, `app_settings` 12, `video_models` 20. Detalhe e
   armadilhas em `15-runbook-remix.md`; prompt pronto para delegar em
   `16-prompt-configuracao-instancia.md`.
5. **Edge functions**: confirmar deploy das functions (lista em 07-contratos-backend.md §3);
   em fallback, `lovable_deploy` por função.
6. **Auth**: confirmar e-mail/senha habilitado e URLs de redirect do domínio final.
7. **Domínio**: conectar domínio do cliente (Lovable → domains) quando houver. Ao conectar,
   Ao conectar, acrescente o domínio ao env `APP_ORIGIN` da edge e peça redeploy da
   `higgsfield-oauth` — sem isso o OAuth do Higgsfield não consegue voltar para o domínio
   novo (os do Lovable continuam funcionando de qualquer jeito). Ver `15-runbook-remix.md` §5.1.
8. **Zero-resíduo**: rodar a verificação da §2 (contagens = 0).
9. **Smoke test**: criar um usuário de teste descartável, verificar que virou admin e caiu em
   /onboarding; deletar o usuário e limpar (ou usar o próprio primeiro acesso do cliente como
   smoke, acompanhado).
10. **Entrega — e fechamento da janela de bootstrap (crítico)**: a regra "primeiro
    cadastro vira admin" significa que, enquanto a instância não tiver nenhum usuário,
    **qualquer pessoa que descubra a URL reivindica a instância inteira**. Portanto:
    - Entregue a URL e acompanhe o primeiro cadastro **na hora** (chamada, call, o que for)
      — não mande a URL para o cliente criar a conta "quando puder".
    - Assim que o admin existir, **desligue o signup público** no Auth do projeto
      (`disable_signup = true`). A partir daí só entra quem for convidado.
    - Confirme: `select count(*) from public.user_roles where role = 'admin';` deve ser ≥ 1.
    - Convites seguem funcionando com signup desligado (a `invite-user` usa a admin API);
      valide isso uma vez em instância de teste antes de aplicar em cliente.
11. **Inventário**: registrar a instância no inventário (§7).

> **Nota de segurança (2026-07-30).** Uma auditoria encontrou escalonamento de privilégio na
> primeira versão do trigger `handle_new_user`: o papel do convidado vinha de
> `raw_user_meta_data.role`, campo controlado pelo cliente — com signup aberto, qualquer um
> podia se cadastrar como `admin`. Corrigido na migration `202607300012`: o papel agora vem
> da tabela `pending_invites`, escrita apenas pelo service_role (a `invite-user`). Instâncias
> provisionadas antes dessa migration **precisam aplicá-la** e revisar `user_roles` em busca
> de admins inesperados.

## 4. Atualização do motor (N instâncias em sincronia)

O motor evolui no **repo do template**; cada instância tem repo próprio (git sync do Lovable).
Propagação é por **git merge**, nunca por reescrita:

1. Melhorias são commitadas no template (`main` do repo base) e recebem bump de
   `ENGINE_VERSION` (constante no código, **semver**): patch = correção de prompt/bug; minor =
   feature nova compatível (novo adapter, nova tela); major = mudança que exige migração de
   dados ou re-aprovação de tom.
2. Em cada instância: `git fetch template && git merge template/main` no repo da instância →
   push na `main` → o git sync do Lovable aplica e faz deploy. **Nunca** rebase/force-push
   (regra do Lovable — histórico publicado é imutável; ver AGENTS.md do scaffold).
3. **Migrations sempre aditivas e idempotentes** (`create table if not exists`,
   `alter table ... add column if not exists`, seeds com `on conflict do nothing`). Nunca
   `drop`/`rename` destrutivo em minor/patch; mudanças destrutivas só em major, com migração
   de dados escrita e testada.
4. Toda peça gerada carimba `engine_version` + versões do recheio
   (persona/strategy/guardrails/brand_kit) — reprodutibilidade e diagnóstico pós-update
   (ver 04-modelo-de-dados.md, tabela `content_pieces`).
5. **Golden set (smoke test pós-update)**: 3 briefs canônicos versionados no repo
   (`docs/golden-set/` — proposta — validar) rodados na instância após o merge: 1 comando de
   notícia, 1 de case, 1 de opinião. Critério: os 3 jobs chegam a `awaiting_review` sem
   `failed`, com auditoria populada. Reprovou → rollback por revert do merge (novo commit).
6. Cadência sugerida: updates em lote (todas as instâncias na mesma semana), começando por uma
   instância-canário interna. (proposta — validar)

### Conflitos de merge

Instâncias **não devem customizar código do motor** — customização de cliente é recheio
(banco). Se um cliente exigir código específico (adapter exclusivo, tela extra), isso deve
subir para o template atrás de flag/config (`app_settings`), mantendo os repos convergentes.
Instância com fork de código divergente sai da esteira padrão de updates e vira manutenção
dedicada (precificar de acordo).

## 5. Matriz motor × recheio × config de instância

| Camada | Onde vive | Exemplos | Quem muda | Como propaga |
|---|---|---|---|---|
| **Motor** | Código do repo (idêntico entre instâncias) | Saga de geração, auditoria 3 classes, adapters, wizard, telas, prompts do motor, `llm.ts`, migrations, seeds de fábrica | Dev da Viver de IA, no template | git merge template → instâncias |
| **Recheio** | Banco da instância | Persona, bandeira, guardrails, brand kit, canais ativos, Conteúdo de Contexto, peças, feedback, usuários | Cliente (admin/user), via UI | Não propaga — é do cliente |
| **Config de instância** | Vault + `app_settings` da instância | API keys BYO, seleção de provider/modelo por papel, flags, progresso do onboarding | Cliente (admin), via UI | Não propaga |

## 6. Inventário de instâncias (fora do produto)

Com bancos fisicamente isolados, não existe visão agregada dentro do produto (e não deve
existir — "seus dados são só seus" é feature). A Viver de IA mantém um inventário **externo**
(planilha ou CRM interno) com, por instância:

`cliente | project_id Lovable | ref Supabase | repo GitHub | domínio | workspace/billing |
engine_version atual | data do último update | plano/retainer | contato admin | observações`

Atualizado nos eventos do runbook (§3 passo 11) e a cada update de motor (§4). Telemetria
agregada de uso entre instâncias fica explicitamente fora do MVP; se um dia existir, será
opt-in contratual. (proposta — validar)

## 7. Limites e riscos do modelo Remix

| Risco | Impacto | Mitigação |
|---|---|---|
| Dependência do Remix/Lovable (indisponibilidade ou mudança do recurso) | Não consegue provisionar cliente novo | Runbook de fallback manual: criar projeto Lovable blank TanStack + copiar arquivos do template por git + conectar Supabase + aplicar migrations via `lovable_query_sql` + deploy das functions via `lovable_deploy` (o processo da skill interna `remove-flag` é o precedente). Testar 1x na F5. |
| Divergência de instâncias (merge não aplicado, fork de código) | Frota com versões mistas, suporte caro | `engine_version` no inventário + peças carimbadas; política da §4 (customização vira flag no template); updates em lote com canário |
| Custo de créditos Lovable por workspace (gateway de IA + hosting) | Margem do retainer | Default gateway com modelos econômicos; BYO key Anthropic/OpenAI move custo de token para o cliente; expor consumo em /config/ia |
| Migrations aplicadas parcialmente numa instância | Erro em runtime pós-update | Migrations idempotentes + verificação de versão de schema no golden set |
| Remix copiar estado indesejado no futuro (mudança de comportamento do Lovable) | Vazamento entre template e instância | Verificação zero-resíduo (§2) permanece no runbook mesmo sendo redundante hoje |
| Cliente perde acesso admin (único admin sai da empresa) | Instância órfã | Runbook de recuperação: reset via Supabase auth admin da instância (Viver de IA tem acesso ao projeto) — documentar no contrato. (proposta — validar) |

## 8. Relação com o plano

- **F0** cria as migrations idempotentes e seeds de fábrica que o Remix pressupõe.
- **F5** executa: 1 Remix de teste completo (runbook §3 de ponta a ponta), o golden set, e o
  fallback manual testado uma vez.
- O **gate de saída do MVP** (02-escopo-mvp.md) é exatamente este fluxo: Remix → onboarding
  self-serve → 3 peças aprovadas no gate de tom → peça multi-canal aprovada em <30 min.
