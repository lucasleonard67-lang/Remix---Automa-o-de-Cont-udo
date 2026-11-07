# Visão de Produto — Content Engine (one-pager estendido)

Este documento é a visão de produto do **Content Engine**: o problema que ele resolve, para quem, como funciona em três atos, por que é defensável e como gera receita. É o "porquê" que ancora todos os demais documentos da spec — o escopo detalhado está em 02-escopo-mvp.md, a priorização em 03-features-priorizadas.md, o modelo de dados em 04-modelo-de-dados.md, rotas e módulos em 05-rotas-e-modulos.md, a arquitetura de IA em 06-arquitetura-ia.md, os contratos de backend em 07-contratos-backend.md, a estratégia de template/provisionamento em 08-estrategia-template.md e o plano de implementação em 09-plano-implementacao.md (índice geral em 00-INDICE.md).

---

## 1. O produto em uma frase

> **Content Engine é uma fábrica de conteúdo com governança editorial, entregue como produto single-tenant**: cada cliente tem seu próprio projeto Lovable + Supabase + deploy (provisionado por **Remix** do template) e configura a própria marca num **onboarding wizard self-serve**, que é a peça central da solução.

Não há super admin nem implementador obrigatório. O cliente constrói identidade, contexto, tom de voz e forma de produção no onboarding — o que torna a plataforma genérica e reutilizável para qualquer marca. A squad de conteúdo do Yago Martins é a **referência de domínio** que originou o método (funil narrativo, auditoria, contrato de voz), nunca uma dependência: o produto existe para novos clientes.

---

## 2. O problema

Criadores e empresas que vivem de conteúdo enfrentam três dores que nenhuma ferramenta de "IA que escreve" resolve:

| Dor | Como ela se manifesta | Por que as soluções atuais falham |
|---|---|---|
| **Inconsistência de voz** | Cada peça sai com um tom; o feed parece escrito por três pessoas diferentes. Um mês inspirado, outro genérico. | LLM cru + prompt exige que o cliente seja o próprio orquestrador; "brand voice" de ferramentas genéricas é um campo de texto raso, não um contrato operável. |
| **Falta de governança factual e editorial** | Números inventados, cases distorcidos, CTAs fora da estratégia, conteúdo que "poderia sair em qualquer perfil". | Geradores de copy não têm gate: nada reprova, nada reescreve, nada exige fonte. O resultado é o "AI-slop" que corrói a marca. |
| **Dependência de agência/freelancer** | Qualidade acoplada a uma pessoa específica; caro, lento, sem memória versionada da marca; trocar de fornecedor é recomeçar do zero. | O conhecimento da marca vive na cabeça de terceiros, não num ativo do cliente. |

A consequência é sempre a mesma: **volume sem confiança**. O cliente ou publica pouco (porque revisar tudo custa caro) ou publica genérico (porque delegou sem governança). O que ele quer não é "mais texto" — é **não soar genérico e não alucinar um case**, em escala.

---

## 3. ICP — o cliente final da implementação

O cliente do Content Engine é quem opera a instância: **criadores e empresas B2B brasileiras com marca pessoal forte**, que já produzem (ou querem produzir) conteúdo de autoridade em redes sociais e têm material bruto acumulado (transcrições, posts antigos, documentos, cases).

**Perfil típico:**

- Fundador/especialista com opinião própria, teses e um "inimigo" retórico — a marca é a pessoa (ou uma marca corporativa com editorial forte).
- Já tem provas: resultados de clientes, números, depoimentos — mas espalhados e sem uso sistemático.
- Publica (ou quer publicar) em Instagram, X, Threads, LinkedIn e Facebook.
- Sente na pele o custo da inconsistência: já contratou agência/freelancer e se frustrou, ou faz tudo sozinho e não escala.

**Sinais de qualificação:** possui corpus mínimo para extração de voz (posts, transcrições) ou aceita a entrevista guiada do onboarding; tem oferta clara para o CTA aterrissar; valoriza governança mais do que volume.

Os quatro **templates de nicho** de fábrica do MVP desenham o alvo inicial com precisão: `criador-b2b`, `consultoria-financeira`, `clinica-saude` e `infoproduto` (além da opção "começar em branco"). Cada template pré-popula ban list, arquétipos, famílias de hook e postura editorial para o cliente nunca começar do zero.

---

## 4. Proposta de valor

> **"Uma fábrica de conteúdo com a governança editorial da SUA marca, com dados só seus."**

Três pilares sustentam a promessa:

1. **É a sua voz, não "uma voz".** O onboarding extrai do seu corpus um contrato de voz de 9 seções (identidade, credenciais com fonte, teses, princípios de tom, léxico assinatura, heurísticas de calibração, ban list, opiniões, checklist e exemplos bom vs. ruim) — versionado, editável e aplicado em toda geração.
2. **Nada publica falhando.** Toda peça passa por um gate de auditoria em 3 classes (linter determinístico → verificação de grounding contra a sua base → juiz semântico com rubrica editorial), com reescrita automática e escalada para humano. Número sem fonte vira `[VERIFICAR]`, nunca vira post.
3. **Dados só seus, por construção.** A instância é um projeto Lovable + Supabase + deploy exclusivos do cliente. Não existe banco compartilhado, não existe `tenant_id`, não existe acesso da Viver de IA aos dados. O corpus, as peças, os vereditos e as chaves de API vivem — e ficam — na instância.

---

## 5. Como funciona — em 3 atos

### Ato 1 — O onboarding constrói o cérebro da marca

No primeiro acesso pós-Remix, o primeiro usuário cadastrado vira admin e cai no wizard de `/onboarding` — 9 passos, retomável, self-serve: `boas-vindas` (nome da marca + template de nicho) → `ia-e-integracoes` (provider default do gateway; keys BYO opcionais, gravadas no Vault) → `contexto` (carga inicial do Conteúdo de Contexto) → `voz` (extração assistida do contrato de 9 seções a partir do corpus, ou entrevista guiada) → `bandeira` (promessa, teses, ICP) → `guardrails` (ban list, regras) → `brand-kit` → `canais` → **`gate-de-tom`**: o sistema gera 3 peças-amostra pelo pipeline completo e o cliente aprova ou reprova (reprovou, volta à etapa de voz). Os passos 3-4-5-6 já destravam a geração (mínimo viável); 7-9 completam a configuração. Ao final, a marca deixou de ser tácita: virou dados versionados no banco da instância.

### Ato 2 — Um comando livre gera

A entrada padrão de geração é `/criar`: uma caixa de comando em linguagem natural — *"Faça uma postagem sobre a Copa do Mundo e como isso afeta o mercado imobiliário"*. O roteador classifica (formato, canais, tese, query de contexto); se o comando é amplo, o sistema oferece 3-4 **ângulos** com hook para o cliente escolher (fricção desejável). A saga então recupera contexto por busca híbrida (RAG), gera o conteúdo-núcleo pelo funil narrativo de 8 camadas na voz contratada, e os **adapters** transformam o núcleo em cada formato ativo (Stories, carrossel, post estilo tweet-card, X, Threads, LinkedIn, Facebook) — tudo acompanhado em tempo real na tela.

### Ato 3 — O gate de auditoria garante

Antes de qualquer peça chegar à Biblioteca, ela atravessa o gate fail-fast: **Classe 1** — linter determinístico (pontuação e palavras banidas, emojis, hashtags, CTAs proibidos, limites do canal); **Classe 2** — verificador de grounding (todo número e citação sofre diff contra o Conteúdo de Contexto selecionado; divergência vira `[VERIFICAR]`); **Classe 3** — juiz semântico (LLM-as-judge em chamada separada do gerador, rubrica de 4 regras editoriais + arco narrativo + voz + nota de corte). Reprovou → reescrita automática alimentada pelo diagnóstico, no máximo 2 tentativas, depois escala para humano. Na `/biblioteca`, o cliente vê os chips de auditoria, aprova, rejeita ou pede regeneração guiada ("mais provocador", "encurta") — e cada veredito é armazenado em `piece_feedback` para calibrar o sistema.

---

## 6. Diferencial defensável

O Content Engine não compete na qualidade bruta de um parágrafo (qualquer LLM de fronteira gera um bom parágrafo). Compete em **fidelidade a uma identidade específica sob governança auditável**. A defensabilidade não está no gerador — está no que o cerca:

| Camada de defesa | O que é | Por que um wrapper de prompt não copia |
|---|---|---|
| **Gate de 3 classes** | Linter determinístico + grounding + juiz semântico com loop reprovar-reescrever | Exige codificar rubrica editorial, diff factual e calibração do juiz — o "não publica falha" é produto, não prompt |
| **Grounding com fonte obrigatória** | Base de provas com metadata tipada (métrica, cliente, setor, fonte), ranking por força da prova e `[VERIFICAR]` para dado não lastreado | Depende de dado proprietário do cliente que o concorrente não tem; blinda contra o "genérico convincente" |
| **Voz versionada** | Contrato de 9 seções extraído do corpus, append-only com versão ativa, carimbado em cada peça | Extração assistida de voz é pipeline de produto; um campo "brand voice" não produz reprodutibilidade |
| **Isolamento físico dos dados** | Instância própria (projeto + banco + deploy do cliente); zero banco compartilhado | O corpus e o histórico não saem da instância — vira custo de troca real, não cláusula de contrato |
| **Flywheel de vereditos** | Cada aprovação/rejeição (incluindo o gate de tom) fica em `piece_feedback`, pronto para calibrar o juiz e alimentar few-shot | O dataset rotulado da marca se aprofunda com o uso, dentro da instância; concorrente não tem como espelhar |

Em uma frase: **é uma plataforma de governança editorial com geração plugada, não um gerador de conteúdo**. O gerador qualquer um copia; o gate que bloqueia, o onboarding que extrai a voz, a base de provas que impede a alucinação e o flywheel que calibra dentro de cada instância são o fosso — e ele aprofunda com o uso e com a cobertura de verticais (templates de nicho).

Com o modelo self-serve, a defesa ganha um vetor extra: como o onboarding é o produto (e não um serviço manual), **cada melhoria no wizard beneficia todas as futuras instâncias por Remix** — a Viver de IA acumula método no template, não horas de consultoria.

---

## 7. Modelo de entrega e receita

### Entrega

1. **Provisionamento por Remix**: novo projeto Lovable + novo Supabase + novo deploy a partir do template. O banco nasce vazio; migrations criam schema e seeds de fábrica. Zero-resíduo por construção (ver 08-estrategia-template.md).
2. **Onboarding self-serve**: o próprio cliente configura marca, contexto, voz e canais no wizard — sem implementador obrigatório, sem super admin.
3. **Operação contínua**: o cliente gera, audita e aprova; a Viver de IA evolui o motor no template e propaga por merge + migrations idempotentes.

### Receita

O valor capturável está no **recheio e na governança contínua, nunca no motor** (o motor é o veículo de entrega). Com o onboarding self-serve, a composição do setup muda de "serviço de implementação manual" para "provisionamento + acompanhamento":

| Componente | O que cobre | Recorrência |
|---|---|---|
| **Fee de implementação (setup)** | Remix e provisionamento da instância (projeto, banco, deploy, repo com git sync), kickoff e acompanhamento do onboarding self-serve até o gate de tom aprovado | Única, por instância |
| **Retainer de operação** | Atualização contínua do motor na instância (merge do template + migrations, golden set pós-update), suporte, evolução de adapters e governança | Mensal, por instância |
| **Fee por instância adicional** | Agências/parceiros com várias marcas: cada marca é uma nova instância isolada, com seu próprio setup e retainer | Por instância |

**Custo variável é do cliente, por design**: a instância consome os **próprios créditos Lovable** do workspace dela (gateway default, zero-config) ou as **próprias keys BYO** (Anthropic/OpenAI) — a Viver de IA não intermedia custo de token, o que mantém o retainer previsível e o incentivo alinhado (ninguém lucra com volume descartável). O uso fica exposto em `/config` para o admin da instância.

Add-ons naturais de expansão (proposta — validar): onboarding assistido "white-glove" (extração de voz conduzida por especialista, para quem preferir serviço ao self-serve), ativação de canais extras conforme novos adapters entram no motor, e governança premium para contas maiores. Não se cobra por palavra gerada — isso incentivaria volume, contra a própria North Star.

O gancho de conversão é o próprio **gate de tom**: o cliente que chega a 3 peças-amostra aprovadas dentro do onboarding já experimentou o valor central antes de operar de verdade.

---

## 8. North Star e métricas-guarda

| Métrica | Definição | Alvo |
|---|---|---|
| **North Star** | Peças aprovadas **sem edição** por semana, por instância | Crescente |
| Guarda 1 | Conclusão do onboarding self-serve **sem suporte** | Sim (por instância) |
| Guarda 2 | % de peças aprovadas sem edição | > 60% |
| Guarda 3 | Concordância juiz × humano | > 85% |
| Guarda 4 | Tempo comando → peça aprovada | < 30 min |

A North Star mede exatamente a promessa: conteúdo que sai fiel e auditado, sem retrabalho humano. As guardas impedem otimização perversa — volume sem qualidade (Guarda 2), juiz frouxo (Guarda 3), fricção excessiva (Guarda 4) e dependência de mão de obra da Viver de IA (Guarda 1).

O **gate de saída do MVP** operacionaliza tudo isso num teste único: um cliente novo faz Remix → completa o onboarding sozinho → aprova 3 peças no gate de tom → gera uma peça multi-canal aprovada, em menos de 30 minutos de operação (ver 09-plano-implementacao.md).

### Riscos principais (resumo)

| Risco | Mitigação |
|---|---|
| Cold-start de voz (cliente sem corpus) | Templates de nicho + entrevista guiada + edição manual da persona |
| Alucinação factual | Grounding com fonte obrigatória + `[VERIFICAR]` + 1 prova central por peça |
| Custo de tokens (402 do gateway) | Uso exposto em `/config`; BYO key transfere custo ao cliente |
| Juiz sem calibração inicial | Nota de corte conservadora + aprovação humana obrigatória + vereditos armazenados |
| Drift entre instâncias | `ENGINE_VERSION` carimbada nas peças + migrations idempotentes + golden set |
| Dependência do Remix/Lovable | Runbook manual de fallback de provisionamento |

---

## 9. Anti-visão — o que o Content Engine NÃO é

- **Não é SaaS multi-tenant.** Não existe banco compartilhado, não existe `tenant_id`, não existe painel central da Viver de IA sobre os dados dos clientes. Uma instância por cliente, isolamento físico, ponto final.
- **Não é "mais um wrapper de GPT".** O gerador é a menor parte do produto. Sem o contrato de voz versionado, o grounding com fonte obrigatória e o gate de 3 classes, o output seria indistinguível de qualquer ferramenta de copy — e é exatamente isso que o produto existe para impedir.
- **Não é agendador de posts.** O MVP não publica nas redes (saída é copy/download; publicação via OAuth é P2), não tem calendário editorial (P1) e não compete com Buffer/Hootsuite. O produto termina onde a peça está aprovada e fiel — a distribuição é etapa posterior.
- **Não é um serviço de agência disfarçado.** Não há implementador obrigatório nem operação humana da Viver de IA dentro da instância; o onboarding self-serve é a peça central justamente para que o cliente seja dono da própria operação.
- **Não é (ainda) um motor proativo de ideias.** No MVP a geração é reativa ao comando do cliente; radar de pautas e motor de ideias são P2 (ver 02-escopo-mvp.md e 03-features-priorizadas.md).
