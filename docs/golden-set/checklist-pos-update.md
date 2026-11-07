# Checklist de release — update do motor numa instância

Rodar **por instância**, na ordem, depois de `git merge template/main`. Tempo típico:
15-25 min (a maior parte é esperar os 3 jobs).

Contexto: `08-estrategia-template.md` §4 (propagação por merge) e
`07-contratos-backend.md` §9 (deploy).

---

## 1. Merge e deploy

- [ ] **1.1** `git fetch template && git merge template/main` no repo da instância.
      Conflito em código do motor → **pare**: instância com fork sai da esteira padrão
      (`08` §4, "Conflitos de merge"). Resolva no template, não aqui.
- [ ] **1.2** `git push` na `main`. **Nunca** rebase nem force-push — histórico publicado é
      imutável no Lovable (`08` §4, item 2).
- [ ] **1.3** Git sync do Lovable aplicou o commit (`lovable_gitsync_status`) e o build passou.
- [ ] **1.4** **Migrations aplicadas.** Toda migration nova de `supabase/migrations/` rodou
      no Supabase da instância. São aditivas e idempotentes — reaplicar é seguro.
      ```sql
      -- comparar com os arquivos de supabase/migrations/ (nomes = versões)
      select version from supabase_migrations.schema_migrations order by version desc limit 10;
      ```
      Fallback: aplicar os arquivos em ordem via `lovable_query_sql`.
- [ ] **1.5** **Functions deployadas.** Qualquer mudança em `_shared/` obriga redeploy de
      **todas** as functions que importam (na prática, todas) — `07` §9.
      Confira a lista com `lovable_list_functions`; deploy com `lovable_deploy`:
      `store-secret`, `ingest-context`, `search-context`, `generate-content`, `resume-job`,
      `generate-image`, `regenerate-piece`, `extract-voice`, `tone-gate`, `invite-user`.
- [ ] **1.6** Seeds de fábrica novos (se a release trouxe) chegaram:
      `select count(*) from channels;` (7) e `select count(*) from niche_templates;` (4).

## 2. Golden set

- [ ] **2.1** Pré-requisitos da instância conferidos — [`README.md`](./README.md) §1
      (persona/bandeira/guardrails ativas, `instagram_carousel` + `x_post` +
      `instagram_post` + `linkedin_post` habilitados, ≥1 case `ready` com chunks).
- [ ] **2.2** Brief (a) — notícia — **verde** ([`briefs.md`](./briefs.md), checagens a1-a19).
- [ ] **2.3** Brief (b) — case com número — **verde** (b1-b15).
- [ ] **2.4** Brief (c) — tema amplo — **verde** (c1-c15).
- [ ] **2.5** Nenhum `failed` com sintoma do README §3.1. São **amarelos** (anote e siga):
      `error` = "reprovada após 2 reescritas: …", `error` de reescrita citando a regra
      `hashtag` nos briefs de canal Instagram (README §3.2) e o `failed` do watchdog
      ("Processamento interrompido antes de terminar…"), que deve ser retomado uma vez.
- [ ] **2.6** **Sentinela:** nenhum job ou `audit` cita `channel_limit_chars` (README §3.3).
      Se citar, o fix do linting de 2026-07-30 foi desfeito — é vermelho, vá para o §4.
- [ ] **2.7** Placar do README §4.1 preenchido e arquivado junto com o registro da instância.

## 3. Carimbo e inventário

- [ ] **3.1** **`ENGINE_VERSION` nova nas peças novas.** A constante vive em
      `supabase/functions/_shared/types.ts` (`export const ENGINE_VERSION`) — confira o valor
      no repo e compare com o que as peças do golden set carimbaram:
      ```sql
      select engine_version, count(*), max(created_at) as ultima
      from content_pieces
      group by engine_version
      order by ultima desc;
      ```
      As peças criadas depois do merge devem trazer **a versão nova**. Versão antiga em peça
      nova = deploy não aplicado (volte ao 1.5).
- [ ] **3.2** Versões do recheio carimbadas nas peças novas (`persona_version`,
      `strategy_version`, `guardrails_version` não-nulas).
- [ ] **3.3** Watchdog ativo:
      ```sql
      select jobname, schedule, active from cron.job where jobname = 'content-engine-watchdog';
      ```
      Esperado: 1 linha, `schedule = '*/5 * * * *'`, `active = true`
      (`202607290011_watchdog_cron.sql`). Ele **marca** jobs travados como `failed` com uma
      mensagem acionável — não re-invoca `resume-job` sozinho.
- [ ] **3.4** Nenhum job do golden set ficou preso: 
      ```sql
      select id, status, updated_at from generation_jobs
      where status not in ('done','failed','cancelled','awaiting_review','awaiting_angle')
        and updated_at < now() - interval '15 minutes';
      ```
      (esperado: 0 linhas)
- [ ] **3.5** Inventário externo atualizado (`08` §6): `engine_version` atual + data do
      update para esta instância.
- [ ] **3.6** Peças de teste do golden set arquivadas na `/biblioteca`
      (`status = 'archived'`) para não poluir a fila de revisão do cliente.

---

## 4. Se reprovar

Golden set vermelho (qualquer sintoma do README §3.1) → **reverter, não remendar na
instância**. Instância não é lugar de hotfix: o motor é idêntico entre instâncias e conserto
local vira fork.

**Antes de reverter, descarte os amarelos** (README §3.2): pré-requisito faltando, "reprovada
após 2 reescritas", violação de `hashtag` nos canais Instagram e job morto pelo watchdog
**não** justificam revert. Reverter por causa deles joga fora um merge bom.
`channel_limit_chars`, ao contrário, **justifica** — desde a correção de 2026-07-30 ele é
sentinela de regressão, não amarelo (README §3.3).

1. **Identifique o merge:**
   ```bash
   git log --oneline --merges -5
   ```
2. **Reverta o merge como novo commit** (não `reset`, não `rebase`, não force-push):
   ```bash
   git revert -m 1 <sha_do_merge>
   git push
   ```
   `-m 1` mantém o lado da instância (`main` anterior) como parente. O revert é um commit
   novo — o histórico publicado continua intacto, como o Lovable exige.
3. **Redeploy** das functions na versão revertida (passo 1.5). Migrations **não** se
   revertem: sendo aditivas, colunas/tabelas novas ficam e são inertes para o código antigo.
   Se a release trouxe migration destrutiva, ela não deveria ser patch/minor
   (`08` §4, item 3) — escale para o dono do template.
4. **Rode o golden set de novo** na versão revertida para confirmar que voltou ao verde.
5. **Registre e escale:** abra o problema no repo do **template** com o `job_id`, o
   `generation_jobs.error` integral, o `audit` da peça e a `ENGINE_VERSION` que falhou.
   Corrija no template, não na instância.
6. **Segure a frota:** se a release estava em rollout em lote, pare as instâncias restantes
   antes de propagar a mesma regressão (por isso a canário interna vem primeiro —
   `08` §4, item 6).

### Reprovou só em uma instância?

Provavelmente **não é o motor** — é recheio ou config local. Antes de reverter, confira:

| Sintoma | Suspeita | Onde olhar |
|---|---|---|
| Só esta instância falha; as outras passaram | Recheio/config, não motor | Pré-requisitos do README §1 |
| `error` de crédito/402 ou 401 | Key BYO expirada ou créditos zerados | `/config/ia`, Vault |
| Grounding sem fonte | Case em `processing`, sem chunks, ou re-ingestão pendente | README §1.3 |
| Reescrita estourando sempre | Guardrails agressivos demais ou persona rasa | `guardrails` ativa, `/marca` |
| Embeddings vazios após update | Troca de modelo de embeddings exige **re-ingestão completa** | `06-arquitetura-ia.md` §5.1 |
