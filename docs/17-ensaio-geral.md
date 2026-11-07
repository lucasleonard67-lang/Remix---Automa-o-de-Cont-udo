# Ensaio geral (F5.6) — o protocolo

> Antes do primeiro cliente real, uma instância de mentira percorre o caminho
> inteiro: Remix → provisionamento → onboarding feito por alguém que interpreta
> um cliente → gate de saída → limpeza. O ensaio existe para o defeito aparecer
> aqui, e não na frente de quem paga.

O gate de saída é o do `02-escopo-mvp.md` §2, com uma correção de fato: o passo 1
lá diz que "as migrations do repo criam schema + seeds de fábrica". **Não criam.**
Medido em três Remixes: vem o schema, e nada mais. O provisionamento é
`supabase/seed-instancia.sql` + `scripts/pos-remix.sql`, conferidos por
`scripts/verificar-instancia.sql`.

---

## Quem faz o quê

Dois passos são só seus, e não por burocracia:

- **O Remix** não tem API. É clique no Lovable.
- **O cadastro do primeiro usuário** envolve criar conta e digitar senha — coisa
  que o assistente não faz, por regra.

O resto é medível e pode ser conduzido por quem estiver dirigindo o ensaio.

---

## 0. Antes de começar

- [ ] `main` empurrada e o git sync do template verde.
- [ ] Nenhuma edge function do template desatualizada. Confira comparando o
      `updated_at` do deploy com o último commit que tocou a função **ou
      qualquer `_shared` que ela importe** — foi assim que 8 funções passaram
      despercebidas rodando um `adapters/base.ts` antigo.
- [ ] Um e-mail descartável para o "cliente" (não use o seu de operação: ele
      vira o admin desta instância e some junto na limpeza).

## 1. Remix (você)

Remix do template no Lovable. Anote `project_id` e `supabase_project_id`.

**Não configure nada ainda.** O próximo passo mede o estado cru.

## 2. Medir antes de escrever

```
scripts/verificar-instancia.sql   →  duas vezes, com alguns minutos entre elas
```

A segunda leitura é a que vale (§2 do `15-runbook-remix.md` explica por quê).
Registre as duas: elas são a evidência do que o Remix leva e do que não leva, e
é o número que vai para o runbook quando o Lovable mudar de comportamento.

## 3. Provisionar

```
supabase/seed-instancia.sql   →  inteiro, do começo ao fim, sem reordenar
scripts/pos-remix.sql         →  trocando SEU_PROJECT_REF pelo ref real
```

Depois, `verificar-instancia.sql` de novo. **Esperado nesta altura:** tudo `ok`
menos brand kit, documentos da marca e acervo — que são o onboarding, e é
justamente o que o ensaio vai testar. Os segredos de cron já devem estar
verdes: a instância os gera sozinha.

Se algo além disso vier `FALHA`, **pare**. O ensaio acabou de encontrar o que
existe para encontrar; conserte no template, não na instância.

## 4. O cadastro (você)

Cadastre o e-mail descartável na instância nova.

**Evidências do passo 2 do gate:** o usuário aparece em `profiles`, tem linha
`admin` em `user_roles`, e o app abre em `/onboarding` no passo 1.

Se ele **não** virou admin, o gatilho `on_auth_user_created` não veio e o bloco
1 do seed não rodou. É a falha mais silenciosa do provisionamento.

## 5. Onboarding, interpretando um cliente — **cronômetro ligado**

Regras que fazem o ensaio valer alguma coisa:

- **Nada de SQL.** Se precisou, o produto falhou, não o ensaio.
- **Nada de atalho de quem construiu.** Se você sabe onde clicar por ter escrito
  o código, anote — é exatamente aí que o cliente vai travar.
- **Marca inventada, mas coerente.** Um nicho dos quatro templates de fábrica,
  com persona, bandeira e guardrails que se sustentem. Marca chutada gera peça
  ruim e o gate reprova por motivo errado.
- **Acervo de verdade.** Pelo menos um item indexado (`context_items.status =
  ready`), senão o grounding não tem contra o que verificar.

Passos: `boas-vindas` → `ia-e-integrações` → `contexto` → `voz` → `bandeira` →
`guardrails` → `brand-kit` → `canais` → `gate-de-tom`.

**Evidência do passo 4 do gate:** 3 peças-amostra com veredito em
`piece_feedback`.

## 6. O gate — peça multi-canal

Comando livre em `/criar`, com ≥2 canais ligados. Acompanhe a geração; aprove na
Biblioteca.

**Evidência do passo 5:** `content_pieces` com `status = 'approved'` em **2 ou
mais canais**, todas vindas de **um único** `generation_job`.

```sql
select j.id as job,
       count(distinct p.channel) as canais_aprovados,
       string_agg(distinct p.channel::text, ', ') as quais
from public.generation_jobs j
join public.content_pieces p on p.job_id = j.id
where p.status = 'approved'
group by j.id
having count(distinct p.channel) >= 2;
```

**Evidência do passo 6:** menos de 30 minutos de operação — tempo **ativo** de
quem está no teclado, sem contar processamento em background. Cronometre à mão e
confira contra `generation_jobs.timings`, que dá o tempo de máquina para subtrair.

> **Publicar não faz parte do gate**, e é bom que não faça: agendar de verdade
> exigiria uma conta Zernio, e usar a da operação numa instância de ensaio
> publicaria na conta de outra pessoa. Se quiser exercitar a publicação, use uma
> conta descartável — nunca a do template.

## 7. Limpeza

- [ ] Apague o projeto Lovable do ensaio (leva o Supabase junto).
- [ ] Confirme que nada do ensaio encostou no template: `verificar-instancia.sql`
      no template, conferência 8.5 em `ok`.
- [ ] Se algum segredo de verdade tiver sido gravado na instância de ensaio,
      **rotacione** — ele existiu num banco que vai para o lixo.

## 8. O que o ensaio produz

Não é um "passou". É:

1. os dois retratos do `verificar-instancia.sql` (cru e provisionado);
2. o tempo cronometrado, por passo do wizard;
3. **a lista de lugares onde você hesitou** — é o item mais valioso e o mais
   fácil de não anotar;
4. um defeito consertado no **template** para cada coisa que quebrou.

Ensaio que termina sem nenhum item 3 não foi ensaio: foi demonstração.
