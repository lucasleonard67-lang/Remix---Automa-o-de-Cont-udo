# 08 · CTO — revisão da squad (hub de ferramentas de vídeo)

Lido: 00 → 07 nesta pasta. Repo `/Users/samuelfadanelli/Developer/subido-redes-sociais` (main d63f465), só leitura. Cada afirmação que pesa na decisão foi reconferida no código; a lista está em §1.1. Legenda: **R1** Claude só pelo conector · **R2** modelo + custo antes de Gerar · **R3** zero esforço cognitivo · **DS** Design System SUBIDO.

---

## 1. Veredito sobre o diagnóstico

**Os três relatórios estão certos no essencial.** As cinco afirmações críticas se confirmam no código; o que encontrei de errado são nuances e duas omissões que mudam o plano (§1.2 e §1.3).

### 1.1 Verificações pontuais (CONFIRMADO no código)

| # | Afirmação | Veredito | Prova |
|---|---|---|---|
| 1 | `roteiro_pedidos` não está no seed nem em `supabase/sql` | **Certo, e pior**: a tabela só existe em `drizzle/migrations/0019…0023`; `grep roteiro_pedidos supabase/seed-instancia.sql supabase/sql/*.sql` é vazio. O gerador `scripts/gerar-seed-instancia.py:36` lê `supabase/migrations`, **que não existe no repo** (`ls` falha; `AGENTS.md:61-63` do repo diz o mesmo). Logo o seed é mantido à mão e a instrução da Opção B "regenerar o seed com o script" (06 F2) **não executa**. A Opção A acertou o procedimento (bloco colado à mão no seed, 05 §0). | `supabase/seed-instancia.sql`, `scripts/gerar-seed-instancia.py:36`, `drizzle/migrations/0020_aplicar_0019_roteiro_pedidos.sql` |
| 2 | `marca_ler` lê `brand_guardrails` inexistente | **Certo.** `BRAND_TABLES` tem `'brand_guardrails'` (`supabase/functions/_shared/assistant-tools.ts:16`) e o flag `regras` também (`:213`). A tabela real é `guardrails` (`src/integrations/supabase/types.ts:988`; `editar-slide.ts:321-352`; `brand-autopilot/index.ts:1148`). `maybeSingle` em tabela inexistente devolve erro sem `data` → silenciado. O Claude nunca recebe palavras/CTAs proibidos. | arquivos citados |
| 3 | `prompt-assist` roda no gateway | **Certo.** `prompt-assist/index.ts:17` importa `chat, resolveProvider` de `_shared/llm.ts`; `:104` `resolveProvider('generator')`; `:132` `chat(...)`. Padrão do papel `generator` = `lovable-gateway` + `google/gemini-2.5-pro` (`_shared/llm.ts:125`). `llm.ts:30` só conhece `lovable-gateway | openai | xai`. A legenda da tela imprime o nome (`prompt-tools.tsx:204-205` + `ai-role-grid.tsx:84`: "Gemini 2.5 Pro"). | arquivos citados |
| 4 | Rosto do apresentador não é enviado às cenas Replicate | **Certo.** `submitReplicateClip` (`director-advance/index.ts:329-345`) renderiza o template só com `prompt, negative_prompt, keyframe_url, duration_int, duration_ms, resolution`; `video-pipeline.ts:497-505` idem. `reference_urls` só aparece em `director-advance:2584` (troca de pessoa) e `:3419` (foto falante). O template do Kling 4.0 tem `"reference_images":"{{reference_urls}}"` (`seed-instancia.sql:901`) e a nota "Aceita o keyframe e as fotos do apresentador juntos" (`:903`): placeholder sem valor some (`video-catalog.ts`), então a promessa da experiência `presenter_in_scenes` no Replicate é falsa hoje. | arquivos citados |
| 5 | `GateEstimateLine` não aparece nos estúdios HeyGen | **Certo.** Usos: `remake-flow.tsx:1013`, `generation-gate.tsx:343`, `reel/cost-gate-dialog.tsx:78`. Zero em `heygen-studios.tsx`; `GenerateBar` (`:163-210`) mostra `label · cost · time` e `route.via`. Com `HEYGEN_PRICE = "preço a confirmar"` (`video-hub.ts:203`) a regra 2 está descumprida em avatar, foto (HeyGen), clone e Video Agent. | arquivos citados |
| 6 | OmniHuman: tela 34 s × catálogo/motor 15 s | **Certo.** `video-hub.ts:311` "até 34 s"; `seed-instancia.sql:981` `max_duration_s:15`; `director-advance:3405-3410` recusa acima do `max`. A pessoa escreve 30 s de fala e o motor devolve erro depois de gerar o áudio no ElevenLabs (custo já pago). | arquivos citados |
| 7 | Primários do catálogo erram o bolso | **Certo.** `talking_avatar`: Fabric `is_primary=true` (`seed:590-597`), P-Video 2 Pro `false` (`:973-977`); `seed:1133-1134` só troca o fallback. `scene_v2v`: Aleph `is_primary=true` (`seed:779-795`; o `on conflict` não toca `is_primary`), Kling 4.0 edição `false` (`:987-991`). Pedido sem `model_id` (MCP `video_criar` rota foto, `mcp-criar.ts:49-60`; `video_melhorar`) cai no Fabric (60 s/720p) e no Aleph (US$ 0,336/s = 2,4× o Kling). | arquivos citados |
| 8 | Hub × destino divergem | **Certo.** `video-hub.ts:395` exige HeyGen para "Mudar o que eu digo" enquanto `remake-flow.tsx:369-370` resolve pelo Replicate sem HeyGen; padrão MiniMax (`:397-404`) × `VOICE_RULE` ElevenLabs; `V2V_MODELS.default` Kling (`:181-189`) × primário Aleph; `recommendEngine` manda Higgsfield quando há apresentador (`generation-gate.ts:161-163`) × hub Kling. | arquivos citados |
| 9 | Caminho do conector: claim, prazos, última-linha-só | **Certo.** `requestState` 10 min / 3 tentativas / 24 h (`video-edit-engine.ts:822-836`); reserva condicional por `claim->>at` (`mcp-server/index.ts:1402-1408`); `useUltimoPedidoDeRoteiro` lê **só a última linha da pessoa** (`use-roteiro-pedidos.ts:118-124`, `limit(1)`) — qualquer pedido de outro tipo na mesma tabela sequestra o `RoteiroBrief` se não houver filtro. `acordarRotina` = 1 POST por pedido/resposta, 15 s, só `console.warn` em falha (`claude-rotina.ts:24-46`). | arquivos citados |
| 10 | Saídas do fluxo e setup | **Certo.** "Conectar o Claude" navega para `/config` (`roteiro-brief.tsx:129`); briefing só com campo vazio (`:169`); setup descarta rota e modelo (`step-create.tsx:359-369`: estúdio navega para fora, remake sem `initialModelId`, director vira sempre `presenter`); sino fixa `rota: "avatar"` (`task-watcher.tsx:97`). | arquivos citados |

### 1.2 O que está exagerado ou impreciso

- **01 §2.1 "`ENGINE_REASON` nunca aparece"**: verdade para a constante (só `lib/` e teste), mas o portão **renderiza** um motivo na linha recomendada quando há `fallbackReason` (`generation-gate.tsx:207`). O problema real é que o motivo do recomendado não é sempre exibido, não que o portão não tenha onde exibir.
- **02 #16 "custo antes do Gerar impossível para HeyGen"**: o seed **tem** números (`avatar-iv` 0,05/s, `avatar-v` 0,12/s, `verified:false`, `seed:1064-1075`). Não é "impossível", é "não verificado". Isso muda a pergunta ao dono (§6, P3).
- **06 §2.2.8 "zero regressão" ao tirar "Melhorar prompt" de Criar e slide**: regressão funcional existe (um botão que funcionava some); o que é verdade é que o caminho correto já existe. Chame de regressão aceita, não de zero.
- **06 F4 "Montar o briefing sem LLM, só defaults"**: `numero_heroi` e `cta` são **obrigatórios** para o Gerar (`novo.tsx:374-376`); `video-brief` sem `chat()` devolve `numero_heroi: ""` (`video-brief/index.ts:109-116`). Resultado: o Diretor fica travado até o Claude entregar ou a pessoa digitar o número. Para a demo isso é pior do que hoje, salvo se o número virar opcional. Nenhum dos dois arquitetos viu.
- **06 §1.1 import cross-root**: `tsconfig.json` tem `moduleResolution: "Bundler"` e `allowImportingTsExtensions: true`, então o re-export é plausível; mas não há **nenhum** precedente no repo (`src/lib/remake-options.ts:1-3` escolheu cópia espelhada + comentário). Build do Lovable segue NÃO VERIFICADO; plano B (cópia + teste) é o caminho seguro.

### 1.3 O que faltou nos três (e pesa)

1. **O MCP remoto do claude.ai está atrás do repo.** Nesta sessão, o servidor `claude_ai_Content_Engine` não expõe `roteiro_*`, `slide_*`, `video_mensagem` nem `atendente_registrar`; o `content-engine` local expõe. `docs/pendencias.md:35-37` lista o redeploy do `mcp-server` como pendente. **A rotina `trig_01P1Dfnx…` roda com o conector do claude.ai** (04): hoje ela provavelmente não enxerga `roteiro_pedidos`. Qualquer demo "pelo Claude" começa por esse deploy, antes de qualquer fatia.
2. **Gerador de seed quebrado para este repo** (§1.1 #1): toda fatia com SQL precisa de bloco colado à mão no seed, e `AGENTS.md` do repo ainda fala em `supabase/migrations` enquanto o repo usa `drizzle/migrations`. Drift de processo que vai morder a próxima instância.
3. **Contador obrigatório do Diretor** (§1.2): define se "Montar o briefing" pode perder o LLM.
4. **O que acontece ao cancelar com o Claude no meio**: `roteiro_entregar` em pedido `cancelado` — ninguém descreveu o retorno; a rotina pode trabalhar 5 min e receber erro. Barato de tratar na entrega (devolver "pedido cancelado, pare").
5. **Mobile**: `remake-flow.tsx` e `hub-route-tile.tsx` não têm um único breakpoint; nenhum rodapé fixo existe nos fluxos de vídeo (só `production-studio.tsx:261`). O 07 desenha celular; A e B não orçam. Para demo de vendas em desktop, dá para adiar; tem que ser dito.

---

## 2. Comparação A × B

| Critério | A (receita como dado: `tool_recipes` + `escrita_*`) | B (receita em código: `receitas-de-video.ts` + `roteiro_*` por tipo) | Leitura do CTO |
|---|---|---|---|
| Cumpre R1 (escrita da pessoa) | Sim: vídeo/script/scene → 410; `video-brief` → pedido não bloqueante | Sim: idem; `video-brief` sem LLM; roteiristas do motor ficam | **Consenso**: ambos tiram a escrita da pessoa do gateway e deixam `director-core`/Reel/`sceneInEnglish` como dívida. Nenhum chega a "zero Gemini". |
| Cumpre R2 | `GateEstimateLine` em todos os estúdios + `custo.como` para multiplicar (fala × US$/s) | `GateEstimateLine` + `semEstimativa` por variação; P-Video/OmniHuman via catálogo | **Consenso** no componente; A é mais preciso na regra de multiplicação, B mais simples. Nenhum resolve HeyGen/Higgsfield de verdade (só torna a ausência honesta). |
| Risco de regressão | Médio-alto: tabela nova + 3 tools novas + dois merges (TS e Deno) + fallback `null` em toda tela; `roteiro_pedidos` passa a filtrar `profundo` | Médio: tabela "sacola" com `switch` por tipo; filtro por `tipo/alvo` no hook (se esquecer, sequestra o `RoteiroBrief`) | B tem menos superfície. Risco comum e subestimado pelos dois: **fan-out de deploy** de `_shared/roteiro.ts` (mcp-server, roteiro-pedido, director-advance, video-edit) e de `assistant-tools.ts` (mcp-server, assistant-chat). |
| Esforço até a demo | Não estimado em dias; 7 fatias com F3 "G"; ~2 semanas | 5–7 dias de uma pessoa, F2+F3 críticas | B é 2× mais rápido. Para "features funcionando valem mais que polimento", pesa. |
| Manutenção em 2 meses | Melhor: frase/limite/padrão mudam por SQL, por instância; teste contra constantes | Pior: 400–600 linhas TS; vocabulário triplo (hub/catálogo/receita); divergência com `video_models` | A ganha. Mas o próprio B lista o gatilho de migração (segunda vez que "mudar a frase" exigir deploy). |
| Dependência do Lovable (SQL/edges) | 2 SQL + mcp-server, roteiro-pedido, prompt-assist, video-brief, director-advance, avatar-studio + Publicar | 1 SQL + roteiro-pedido, mcp-server, director-advance, video-edit, prompt-assist, video-brief, assistant-chat + Publicar | Quase igual (7 × 7). A diferença é a **ordem**: B entrega valor visual (F0+F1) **sem nenhum deploy**; A precisa do SQL antes da primeira frase aparecer (fallback `null` = tela igual a hoje). |
| Casa com o padrão do 07 | Mais perto: `entrada[]` tipado ≈ "só os campos que o modelo precisa"; modal do conector inline (R3); "Montar o briefing" vira pedido não bloqueante | Mais longe: formulários fixos; mantém link para `/config` (R3, admitido); mantém "Montar o briefing" | **Nenhum dos dois** tira o `ModelRail` do hub (decisão 2 do 07) nem faz a trilha de 4 pontos; ambos ficam em 3 etapas (ok). |
| Receita para o Claude | Texto montado da receita + `RECEITA_DO_ROTEIRO` com camada do modelo; `conferirEntrega` com `max` do pedido | `receitaParaOClaude(tipo, contexto)`; `conferirEntregaPorTipo` | **Consenso** no mecanismo. |
| Um pedido aberto por campo | Índice único parcial `(created_by, ferramenta, alvo)` + 409 | Índice parcial `(created_by, contexto->>alvo)` + 409 | **Consenso**. |
| Rotina | Bloco 6 "ESCRITA" novo | Bloco 1 vira "ESCRITA" | Detalhe; ver §4.5 (a rotina devia ser fina). |

---

## 3. Recomendação única: **Opção C** (B como esqueleto desta rodada, com quatro peças da A e duas do 07)

Não é "um pouco de cada": é a Opção B com cinco correções que a A e o 07 já desenharam e que custam menos de um dia somadas. O que fica da A para depois é a tabela `tool_recipes` e as tools `escrita_*`, com o tipo TS da receita já no formato do `recipe` jsonb da A, para a migração para dado ser copiar JSON, não reescrever.

### 3.1 O que vem de onde

| Peça | Origem | Decisão |
|---|---|---|
| Fonte da receita: módulo TS sem imports `supabase/functions/_shared/receitas-de-video.ts` + espelho em `src/lib` | B §1 | **Sim**, com o schema de campos da A (§1.3 de 05: `faz`, `nao_faz`, `entrada[]`, `escrita`, `limites_visiveis`, `custo.como`, `estado`). Regra dura: **a receita não carrega número que exista em `video_models.limits/cost`**; `max` de caracteres é derivado em runtime (`max_duration_s × 15`), não digitado (evita o 225 da B divergir do 15 do seed). Espelho por cópia + teste (precedente `remake-options.ts`); tentar o re-export só se o build do Lovable passar. |
| Fila: `roteiro_pedidos` generalizada (`tipo`, `contexto`, `saida`, índice parcial, 409) | B §2 / A §1.5 (consenso) | **Sim**, nas tools `roteiro_*` existentes (B). **Com a tabela inteira no seed e em `supabase/sql/roteiro-pedidos.sql`** (A), colada à mão. Prazo de 2 h para tipos curtos (A §2.4). |
| Botão "Escrever com o seu Claude" dentro do `PromptTools`; campo editável; Usar/Ignorar; "Abrir no Claude" (`urlDoClaude` já existe, `claude-prompt.ts:43`) | B §2.2 (= 07 §3) | **Sim**. |
| "Conectar o Claude" como **modal** (`openIntegration`), não `/config` | A §3.4 / 07 §4.3 | **Sim** (R3). Verificar que o modal `claude_editor` cria o token; senão abrir `claude_routine` e manter o link como segunda saída. |
| `GateEstimateLine` em `GenerateBar` + motivo do recomendado + selo por regra | consenso (01 §3.1, 07 §2) | **Sim**. |
| Tirar o `ModelRail` do hub; escolha só na ferramenta | 07 decisão 2 | **Sim, se o dono aprovar (P4)**. Elimina a classe "hub promete X, destino abre Y". Os destinos já têm seletor (`GenerationGate`, `GateOptionList`, `GenerateBar`). |
| "Montar o briefing" do Diretor | A (pedido não bloqueante) × B (defaults sem LLM) | **Nenhum dos dois como está.** Ver P2. Minha recomendação: `video-brief` perde o `chat()` **e** `numero_heroi`/`cta` deixam de ser obrigatórios (`novo.tsx:374-376`), com o botão do Claude preenchendo; o roteirista do Diretor fica no gateway nesta rodada. |
| `prompt-assist` → 410 nos kinds de vídeo | consenso | **Sim.** `content`/`slide`: P1. |
| Rotina | B F6 | **Sim, mas fina** (§4.5): o texto da rotina passa a ser "comece por `o_que_posso_fazer` e siga o guia do servidor"; o guia (`mcp-guia.ts`) carrega a ordem e os tipos, e é deployável. |
| Não entra: `tool_recipes`, `escrita_*`, formulário gerado, migrar `director-core`/Reel, saldo Higgsfield na tela, `motion_prompt`, mobile sticky, setup com Claude, Video Agent `mode: chat` | — | Depois da demo, nesta ordem: (1) migrar receita para dado quando houver 2ª instância com padrão diferente; (2) `briefing_cenas` com `cenas[]` → `director-core` pula o `chat()`; (3) mobile; (4) setup usa o mesmo componente da ferramenta. |

### 3.2 Ordem das fatias para a demo (caminho crítico marcado)

0. **Pré-requisito, antes de qualquer código**: redeploy do `mcp-server` atual no Lovable 103e71ae e confirmação de que a rotina enxerga `roteiro_pedidos` (uma chamada manual). Sem isso, nada "pelo Claude" demonstra.
1. **C0 · Receitas em código** (½ dia, sem deploy): módulo + espelho + teste que confere os números citados contra `seed-instancia.sql`.
2. **C1 · Telas leem a receita + fixes de bolso** (1–2 dias, só Publicar): faz/não faz no topo; `GateEstimateLine` nos 4 estúdios; motivo do recomendado; selo por regra; limite do OmniHuman; cópia do remake pela receita; defaults do hub derivados; ladrilho reframe some; legenda "Gemini" some; §5 inteiro. **Demo visual já melhora aqui, sem backend.**
3. **C2 · SQL** (½ dia + Samuel roda): `supabase/sql/roteiro-pedidos.sql` com a tabela completa (0019–0023) + `tipo/contexto/saida` + índice parcial + Realtime; mesmo bloco no seed; `is_primary` do catálogo (§5).
4. **C3 · Edge + MCP por tipo** (1–2 dias; deploy roteiro-pedido, mcp-server, director-advance, video-edit, assistant-chat): 409 `ja_aberto`; `receitaParaOClaude`; `conferirEntregaPorTipo`; `marca_ler` → `guardrails`; guia; entrega em pedido cancelado devolve "pare". **Crítico.**
5. **C4 · Rotina fina** (Samuel, RemoteTrigger, 10 min) + **medir** um pedido `fala` do clique à entrega. Se passar de 3 min, a UX de "pode sair, o sino avisa" vira a principal e o estado "Com o seu Claude" precisa aparecer em ≤ 2 s.
6. **C5 · Botão nas telas** (1–2 dias; deploy prompt-assist): `PromptTools.escrever`; foto → `fala`; agente → `ideia_agente`; remake (fala, cenário, pessoa); hook filtrado por `tipo/alvo`; sino pelo `contexto.rota`; modal do conector; `prompt-assist` 410 nos kinds de vídeo.
7. **C6 · Diretor** (½–1 dia; deploy video-brief): conforme P2.
8. **C7 · Hub sem trilho** (½ dia, só Publicar): conforme P4.

Demo mínima = 0 + C0 + C1 + C2 + C3 + C4 + C5 (foto, avatar, agente, remake). Diretor e hub sem trilho entram se sobrar tempo. Total: 5–7 dias de uma pessoa, igual ao da B, porque as peças da A escolhidas são baratas.

---

## 4. Furos (o que ninguém cobriu e vai doer)

1. **Cota e latência da rotina da pessoa.** Cada pedido e cada "responder" disparam uma execução (`claude-rotina.ts:24-46`; `roteiro-pedido:78-79`). Com 6 tipos e botão em 8 campos, a conta de execuções multiplica por campo e por tentativa; a tela promete "sem custo extra" (`roteiro-brief.tsx:227`), que é verdade em dinheiro e falsa em cota. Ninguém mediu o tempo real. Mitigação nesta rodada: índice de um pedido por campo (consenso), **não acordar a rotina se já houver execução viva** (guardar `acordou_em` e não disparar de novo em < 60 s), e a receita de `fala`/`instrucao` dizendo "sem pesquisa, sem plano" (B viu). Medir em C4.
2. **Duas sessões do Claude no mesmo conector.** A reserva condicional resolve o trabalho duplo (`mcp-server:1402-1408`), mas as duas são acordadas e a segunda gasta uma execução para ver "nenhum pedido". Aceitável; registrar.
3. **MCP remoto desatualizado** (§1.3.1): bloqueador zero da demo. E a divergência local × remoto vai se repetir a cada rodada: colocar "versão do mcp-server" em `o_que_posso_fazer` e mostrar em Integrações, para o Samuel ver se o deploy pegou.
4. **Receita divergindo do catálogo.** Os dois propõem teste; o teste pega número, não frase. Regra de desenho (§3.1): receita sem números do catálogo. O que sobra de divergência é prosa, e prosa errada não cobra dinheiro.
5. **Texto da rotina fora do repo.** Hoje a rotina carrega a ordem dos 5 blocos; cada feature nova exige o Samuel editar o trigger. Inverter: rotina fina ("siga o guia do servidor"), ordem e tipos em `mcp-guia.ts` (deployável, versionado). O texto exato da rotina vai para `docs/` com data, e a capacidade `escrita` entra em `DEFINICOES`.
6. **Instância de cliente nascida por Remix sem a tabela.** C2 resolve para a próxima; para as existentes, `roteiro-pedido` deve responder erro humano quando a tabela não existe (42P01 → "Esta instância ainda não tem a fila de pedidos; rode o SQL em Integrações"), e `task-watcher.tsx:79-82` consulta `roteiro_pedidos` ao abrir o app — conferir que o erro é engolido e não quebra o sino.
7. **Setup/onboarding.** `step-create.tsx:359-369` já contradiz o hub; nenhuma opção o conserta de verdade (B diz "fora", A diz "usa o mesmo componente"). Para esta rodada: o chip "Vídeo" do setup leva **sempre** para `/videos/novo?rota=&modelo=` (uma regra só, sem perder o modelo), e o setup não ganha Claude assíncrono (onboarding não espera minutos).
8. **Mobile.** Sem breakpoints no remake e no ladrilho; sem rodapé fixo. Decisão explícita: demo é desktop; celular entra depois da demo com o 07 §1.2 como spec.
9. **Cancelar no meio** (§1.3.4) e **pedido entregue depois de a pessoa trocar o modelo** (07 §3.6 camada 2): o segundo caso precisa do contador em coral + "Encurtar com o seu Claude"; B não cobre, A cobre parcialmente. Entra em C5 como regra de contador; o novo pedido é o mesmo fluxo.
10. **Exceção já existente à R1 que vai confundir a demo**: a saga de carrossel cai no gateway quando a rotina não responde (`claude-rotina.ts:5`, `saga.ts:909-911`). Em vídeo não haverá fallback (correto), então a mesma pergunta "e se o Claude não responder?" tem duas respostas no produto. Registrar na decisão do dono; não mexer agora.

---

## 5. Fixes pontuais da mesma rodada

### 5.1 Entram (baratos, protegem o bolso ou cumprem regra inegociável)

| Fix | Arquivo:linha | Por quê | Deploy |
|---|---|---|---|
| `scene_v2v` primário → Kling 4.0 edição; Aleph `is_primary=false` (`update` explícito; o `on conflict` do Aleph não toca `is_primary`) | `supabase/seed-instancia.sql:779-795, 987-991` + `supabase/sql/hub-catalogo.sql` | pedido sem modelo paga 0,336 em vez de 0,141/s | SQL |
| `talking_avatar` primário → P-Video 2 Pro; Fabric `false` | `seed-instancia.sql:590-597, 973-977` | pedido sem modelo cai em 60 s/720p | SQL |
| OmniHuman "até 34 s" → "até 15 s" e `max` do `ScriptField` = `max_duration_s × 15` | `src/lib/video-hub.ts:311`; `src/components/video/heygen-studios.tsx:1015-1029` | áudio ElevenLabs pago e motor recusa (`director-advance:3405-3410`) | Publicar |
| `brand_guardrails` → `guardrails` | `supabase/functions/_shared/assistant-tools.ts:16, 213` | Claude escreve sem as regras; `slide_entregar` recusa depois | mcp-server, assistant-chat |
| `GateEstimateLine` com "Sem estimativa para este modelo" nos 4 estúdios | `heygen-studios.tsx:163-210` | R2 | Publicar |
| Legenda "Scribe v2 · Gemini 2.5 Pro · …" sai agora, antes mesmo do botão novo | `src/components/prompt/prompt-tools.tsx:204-205` | R1 visível na demo | Publicar |
| Nota de blocos para Veo 3.1 / PixVerse Max / Gen-4.5 / Ray ("cobra o bloco inteiro: 6,5 s paga 8") | `src/lib/model-notes.ts:10-31` | pessoa paga bloco sem saber (`video-catalog.ts:303-306`) | Publicar |
| `providers: ["heygen"]` → `[]` em "Mudar o que eu digo" | `src/lib/video-hub.ts:395` | hub barra o que o remake resolve sem HeyGen (`remake-flow.tsx:369-370`) | Publicar |
| Padrão do hub = regra do portão: presenter → Higgsfield CS 3.0 quando conectado | `src/lib/video-hub.ts:169-170` × `src/lib/generation-gate.ts:161-163` | três respostas para "qual modelo" | Publicar |
| Ladrilho "Reenquadrar" some enquanto `STUDIO_READY.reframe=false` | `src/components/video/video-hub.tsx:157-169`; `src/lib/video-hub.ts:92` | ocupa a grade para dizer que não existe | Publicar |
| Exemplos de outro provedor em 6 ladrilhos → exemplo do padrão ou `null` | `src/lib/hub-examples.ts:33-45, 75-81, 89-116` | vê um, recebe outro | Publicar |
| Setup: chip "Vídeo" sempre navega com `rota` + `modelo` | `src/components/setup/step-create.tsx:359-369` | descarta a escolha | Publicar |
| "Conectar o Claude" → modal | `src/components/video/roteiro-brief.tsx:129` (usar `openIntegration`, como `polish-strip.tsx:150`) | R3 | Publicar |
| Entrega em pedido `cancelado` devolve "pare" em vez de erro genérico | `supabase/functions/mcp-server/index.ts:1476-1495` | rotina não insiste | mcp-server (já no C3) |

### 5.2 NÃO entram nesta rodada

- `reference_urls` nas cenas Replicate (02 #3): exige teste pago por modelo; a tela passa a dizer a verdade ("rosto só do primeiro quadro") em vez de consertar o motor.
- Validar 16 MB do Aleph e 10 s do Wan no servidor (02 #8, #10): falha antes de cobrar; é UX, não bolso.
- Unidade do MiniMax (02 #12), `audio_references` do CS 3.0 (#15), `enable_dynamic_duration` (#14): dependem de provedor; marcar "a confirmar" na receita.
- `hfSpecFor` silencioso (#17): caminho só por `?modelo=`/MCP com id fora da lista; raro.
- Migrar `director-core.ts`, decupagem do Reel, `sceneInEnglish` para o Claude (02 #20): a maior dívida; precisa de estado novo no job e não tem fallback permitido. Depois da demo, pelo atalho `briefing_cenas.cenas[]`.
- `tool_recipes` + `escrita_*` (A): quando houver a 2ª instância com padrão diferente.
- Remoções do formulário do Diretor (07 §6.3: Cenas 3–8, Resolução, Avançado, Objetivo/Público/Tom): M–G e mexem em contrato do motor; demo não depende.
- Saldo Higgsfield na tela, `motion_prompt`, Video Agent em `mode: chat`, mobile, Criar/slide `prompt-assist` (P1).

---

## 6. Perguntas que só o dono responde

**P1 · "Melhorar prompt" síncrono fica em algum lugar?**
Recomendação: **não nos campos de vídeo** (410 nos kinds `video/script/scene`, mic fica). Em Criar (`content`) e slide, a função some junto, porque a legenda nomeia Gemini e a memória diz "nunca propor outro modelo"; o caminho correto (`conteudo_pedidos`, `slide_pedidos`) já existe. Se escolher manter em Criar/slide por mais uma rodada: a legenda vira "IA inclusa", sem nome de modelo, e nenhuma tela de vídeo a mostra. Custo da escolha: zero código a mais; só a frase.

**P2 · Diretor e Reel continuam escrevendo cenas no gateway nesta rodada?**
Recomendação: **sim**, com dívida registrada e o atalho `briefing_cenas.cenas[]` desenhado para a próxima. Para "Montar o briefing": tirar o `chat()` de `video-brief` e tornar `numero_heroi`/`cta` opcionais no Gerar (`novo.tsx:374-376`), com o botão do Claude preenchendo os 6 campos. Se escolher migrar o roteirista agora: +1 semana, estado `aguardando_claude` no job, sem fallback → o Diretor fica fora da demo.

**P3 · HeyGen sem preço verificado: "Sem estimativa" ou número com aviso?**
Recomendação: **"Sem estimativa para este modelo · cobrado na sua conta HeyGen"** (regra 2 literal), e calibrar com uma geração real antes da demo: `recordHeygenCost` já registra segundos; uma fatura de teste vira `verified:true` no seed. Se escolher mostrar os 0,05/0,12 do seed como "≈ US$ X (estimado)": a demo de vendas pode prometer preço errado; ao menos marcar `verified:false` em texto e não somar no total.

**P4 · Modelo escolhido na ferramenta (07) em vez de no hub?**
Recomendação: **sim**. Tirar o `ModelRail` do hub (`video-hub.tsx:180-184`), ladrilho com "Padrão X · a partir de US$ Y / sem estimativa", escolha no destino com motivo e preço (componentes já existem). Mata a classe de defeito em vez de três instâncias. Se escolher manter no hub: os fixes do §5 consertam presenter/speech/style de hoje e o próximo modelo que entrar recria a divergência; `?modelo=` continua valendo nos dois cenários.

---

## 7. Critérios de aceite da rodada (o que o Samuel confere)

1. Na tela: nenhum texto "Gemini", "preço a confirmar", "em breve", "Voice ID" nas 13 ferramentas; ladrilho "Reenquadrar" ausente.
2. Em avatar, foto, clone e agente aparece a linha "Estimativa … Sem estimativa para este modelo · cobrado na sua conta HeyGen"; em foto com P-Video/OmniHuman aparece "até US$ X" calculado da fala.
3. Escolher OmniHuman mostra "até 15 s" e o contador bloqueia em `max_duration_s × 15`; escolher Avatar V mostra faz/não faz e o motivo do recomendado.
4. Todo campo de texto de vídeo tem mic + "Escrever com o seu Claude"; clicar com rotina ligada mostra "Com o seu Claude" em ≤ 2 s e o campo continua editável; pedido duplo no mesmo campo não cria linha nova (409 → mostra o aberto).
5. Pedido `fala` do estúdio de foto entregue de ponta a ponta pela rotina em tempo medido (meta ≤ 3 min); entrega com emoji devolve `problemas` e o Claude reescreve.
6. Editar o campo enquanto espera → "Usar o texto do Claude / Manter o meu"; sem edição → texto entra e "Voltar ao meu texto" funciona.
7. Sem rotina: "Pedido guardado" + "Abrir no Claude" (nova aba); sem conector: modal, sem sair da tela.
8. No conector (Claude Code local **e** claude.ai): `roteiro_pedidos` devolve `tipo`, `contexto` e `receita`; `marca_ler` devolve `guardrails`; `o_que_posso_fazer` mostra a versão do `mcp-server`.
9. DevTools: nenhuma chamada JSON a `prompt-assist` a partir das telas de vídeo; `video-brief` responde < 1 s.
10. Catálogo: `select capability, model_id from video_models where is_primary` mostra Kling 4.0 edição em `scene_v2v` e P-Video 2 Pro em `talking_avatar`.
11. Instância criada só pelo seed tem `roteiro_pedidos` com `tipo/contexto/saida` e está na publicação Realtime.
12. Checklist de card genérico do 07 §6.1 passa em cada estúdio (blocos por filete, opções em lista, faixa do Claude com fio navy, sem moldura nova).
