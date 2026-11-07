# Centro de custos: gasto por vídeo

Data: 2026-10-30. Planejamento para fazer depois, sem código. Pedido do Samuel: guardar o valor gasto em cada vídeo gerado e mostrar no centro de custos quanto foi gasto para fazer X vídeos, quais custaram mais e quais modelos foram usados. **NÃO VERIFICADO** marca o que ainda precisa de conferência.

## Decisões em uma leitura

1. **Começa pelo que já existe.** O app já guarda boa parte do custo por vídeo. A primeira entrega só lê esses dados, inclusive o histórico, sem SQL e sem arquivo congelado.
2. **Depois vem a base definitiva.** Uma tabela de lançamentos guarda cada geração com modelo, valor e etapa, e sobrevive se o vídeo for apagado.
3. **Todo valor é estimativa até ser conferido.** A fatura final continua sendo a do provedor, e a tela diz isso.
4. **Crédito não vira dólar sem preço confirmado.** Enquanto não houver conversão, o total aparece como "US$ 41,20 + 900 créditos".
5. **Vídeo que falhou também aparece.** Dinheiro gasto em tentativa perdida é parte da resposta.

## O que já existe

| Dado | Onde está | Por vídeo? | Modelo? | Limite |
|---|---|---|---|---|
| Diretor, Remake e estúdios: Replicate, HeyGen, créditos Higgsfield, letras ElevenLabs | `director_jobs.costs` | sim | em `config` (`model_id`, `scene_model_id`, `person_model_id`, `tts_model_id`) | estimativa; só entra no total do mês |
| Reel | `video_predictions`, com custo e modelo por chamada | sim, e por chamada | sim | só o card do Reel mostra; `actual_cost_usd` nunca é gravado |
| Edição com Claude | `video_edits.cost_usd` | sim | fixo no motor | apagar o job apaga o custo junto |
| Tela de Custos | `credits-section.tsx`, com dados de `provider-credits` | não | não | saldo por conta e total do mês |

**Três defeitos na base atual**

- **Créditos do Higgsfield:** o gasto de um vídeo é a diferença do saldo entre início e fim. Com dois vídeos rodando juntos, um pega o gasto do outro. Até a base definitiva, esse valor aparece como "aproximado".
- **Vídeo que falhou:** o job do Higgsfield que falha não fecha o saldo, então sai "Parcial". Um vídeo do Replicate também pode receber crédito de outro job simultâneo, e vai marcado como aproximado.
- **Letras do ElevenLabs:** `eleven_chars` nunca é gravado, então esse dado não existe no histórico.
- **Sem preço do crédito:** nenhum documento do repositório confirma quanto vale um crédito em dólar.
- **Custos ausentes:** análise e roteiro feitos pelo Claude na produção não aparecem em `costs` (NÃO VERIFICADO). Sem isso, o custo por vídeo fica menor que o real.

## Tela

Continua no painel **Custos** do Início, que ganha uma ação: **Ver por vídeo**. Ela abre um painel lateral na mesma tela, sem mudar de página.

```
Custos por vídeo                   [Este mês] 30 dias  Tudo

US$ 41,20 + 900 créditos   em 23 vídeos · média US$ 1,79
Falharam: 2 vídeos, US$ 3,10          Estimativa do app

Vídeos   Modelos
──────────────────────────────────────────────────────────
▢  Lançamento da turma     Seedance 2.0 · ElevenLabs   US$ 4,80
▢  Remake do gancho        Kling 4.0                   US$ 3,10
▢  Avatar: aviso semanal   Avatar IV                   US$ 0,90
▢  Teste de cena  Falhou   Seedance 2.0                US$ 1,40
```

```
Vídeos   Modelos
──────────────────────────────────────────────────────────
Seedance 2.0     12 vídeos   US$ 21,60   US$ 1,80 por vídeo
Kling 4.0         6 vídeos   US$ 12,40   US$ 2,07 por vídeo
Avatar IV         5 vídeos    US$ 3,20   US$ 0,64 por vídeo
```

- **Vídeos:** ordenado do mais caro para o mais barato, o que responde "quais custaram mais".
- **Modelos:** responde quais modelos foram usados e quanto custa cada um por vídeo. Um vídeo com dois modelos entra nos dois, dividido pelo valor de cada etapa quando houver esse dado.
- **Detalhe do vídeo:** um toque abre as etapas no próprio painel: cenas, voz, avatar, edição, tentativas repetidas. Dali também se abre o vídeo.
- **Dados incompletos:** a linha mostra "Parcial", e o total nunca finge precisão.
- **Sem dados:** uma frase e nenhum zero falso.
- **Acesso:** só administrador, como o painel atual.

**No próprio vídeo:** a linha "Vídeo final" do storyboard ganha o valor ("3 cenas montadas · US$ 1,42"). Essa linha fica em `production-studio.tsx`, que não está congelado, então o `JobCard` não precisa mudar. O Reel já mostra o custo.

## Base definitiva

Tabela nova de lançamentos, só com inclusão. Cada geração grava uma linha:

| Campo | Conteúdo |
|---|---|
| vídeo | tipo e id da origem, **sem cascata**, mais uma cópia do título |
| etapa | cena, voz, avatar, legenda, edição, análise, roteiro |
| provedor e modelo | o que realmente rodou, depois de fallback |
| quantidade | valor e unidade: segundos, créditos, letras, tokens |
| valor | US$ estimado e, quando conferido, US$ real |
| resultado | sucesso, falha ou repetição |
| quando e quem | data e usuário |

- **Por que sem cascata:** apagar um vídeo não pode apagar o histórico de gasto.
- **Créditos Higgsfield:** o provedor informa o gasto de cada geração? Se sim, a medida por saldo sai de cena (NÃO VERIFICADO).
- **Dinheiro:** a soma do teto mensal passa a vir dessa tabela. `video_month_spend_usd()` continua no ar até a troca ser conferida.
- **Regras do repositório:** RLS só para administrador, escrita só pelo service role e bloco no `seed-instancia.sql`, antes do marcador de fim.

## Arquivos congelados

| Arquivo | Etapa 1 | Etapa 2 |
|---|---|---|
| `director-advance` | não muda | **precisa de liberação** |
| `generate-video` | não muda | **precisa de liberação** |
| `job-card.tsx`, `use-director-jobs` | não mudam | não mudam |

Sem a liberação, a etapa 2 fica incompleta: o histórico por vídeo continua, mas sem o custo real por etapa.

## Ordem e sessões

| Etapa | Entrega | Sessão | Publicação |
|---|---|---|---|
| 1 | leitura de `costs`, `video_projects` e `video_edits` por vídeo, em ação administrativa da `provider-credits` | dados | deploy da edge |
| 1 | painel "Ver por vídeo", abas Vídeos e Modelos, valor na linha "Vídeo final" | telas | sync do Lovable |
| 2 | tabela de lançamentos e gravação nas três edges de geração | motor | SQL e deploy, com OK do Samuel |
| 2 | conversão do crédito e custo do Claude na produção | motor | deploy |
| 3 | conferir valor estimado contra as faturas | dados | sem deploy |

A etapa 1 pode andar em paralelo por duas sessões, depois de fechar o formato da resposta da edge. A etapa 2 começa só depois da liberação dos arquivos congelados.

## Pendências

- **Samuel:** liberar `director-advance` e `generate-video` quando a etapa 2 for começar.
- **Samuel:** informar quanto custa o crédito do Higgsfield no seu plano. Sem isso, o total continua separado.
- **Conferência:** se o Claude da produção tem custo registrado e se o Higgsfield informa o gasto por geração.
