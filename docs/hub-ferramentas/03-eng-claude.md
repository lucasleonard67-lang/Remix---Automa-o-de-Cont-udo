# 03 · Integração Claude/marca — como o produto ajuda a escrever hoje e o que existe pelo conector

Repo: `/Users/samuelfadanelli/Developer/subido-redes-sociais` (main, d63f465). Nada foi alterado. Tudo abaixo é CONFIRMADO no código, salvo onde marcado NÃO VERIFICADO ou QUEBRADO.

---

## 1. Ajuda de escrita atual (DÍVIDA: viola a regra 1)

### 1.1 Dois caminhos de ajuda, ambos pelo gateway `llm.ts`

| Caminho | Edge | Quem escreve | Telas |
|---|---|---|---|
| "Melhorar prompt" (componente `PromptTools`/`PromptField`) | `prompt-assist` | `chat({ role_hint: 'generator' })` → lovable-gateway/OpenAI/xAI | 6 telas (abaixo) |
| "Montar briefing" do Diretor (tema → 6 campos) | `video-brief` | `chat({ role_hint: 'generator' })` | `src/routes/_app/videos/novo.tsx:343-365` e setup (`src/components/setup/step-create.tsx:36`) |
| Edição de slide SEM Claude conectado | `edit-slide` (`editar`) | `chat({ role_hint: 'generator' })` | `src/components/biblioteca/slide-editor.tsx` (botão desligado sem conector: `:195`) |

### 1.2 `prompt-assist` — o que faz
- Entrada `{ text, kind, max? }` → saída `{ text, provider, model }`: `supabase/functions/prompt-assist/index.ts:5-6`, `:90-153`. Multipart = transcrição Scribe v2 do ElevenLabs direto (sem LLM): `:43-82`.
- Provedor: `resolveProvider('generator')` (`:104`); sem chave BYO → 412 `not_connected` apontando a integração openai/xai (`:105-110`). Padrão do papel `generator` é `lovable-gateway` + `google/gemini-2.5-pro`: `supabase/functions/_shared/llm.ts:125`.
- Marca que entra (é pouca): `brand_persona.identity` (nome, papel, posicionamento, público) + `brand_strategy.theses[0..4]` (`:112-125`) + 4 trechos do acervo via `hybridSearch(text, undefined, 4)` cortados em 700 chars, total 5.000 (`:115`, `:126-129`). Não entra: guardrails, léxico assinatura, tom, CTAs, brand kit, vozes, avatares.
- Prompt: `supabase/functions/_shared/prompts/prompt-assist.ts:33-40` (sistema: editor, não inventa fato, `[VERIFICAR]`) + regra por `kind` (`:14-31`). Teto de entrada 6.000 chars (`:12`); `max` padrão 1.500 (`index.ts:101-102`), a tela passa o `max` do campo.
- Saída JSON `{text}` com schema (`index.ts:138-143`); resposta é cortada em `max` (`:150`).
- Rate limit: `enforceRateLimit(user.id, 'prompt-assist')` (`:164`) — teto fica em `app_settings.rate_limits` (`_shared/rate-limit.ts:7-8`); valor NÃO VERIFICADO (não está no repo).

### 1.3 Kinds e quem usa cada um (tela de vídeo)

| `kind` | Regra (`prompts/prompt-assist.ts`) | Tela / campo | `max` |
|---|---|---|---|
| `video` | tema de vídeo curto: gancho, cenas, câmera, ritmo, fecho (`:18-20`) | Diretor, campo Tema: `src/routes/_app/videos/novo.tsx:451-458`; Video Agent "A ideia" (`seconds={false}` → `video`): `src/components/video/heygen-studios.tsx:148`, `:1208-1216` | Agent: 10.000 |
| `script` | fala do apresentador, para o ouvido, só a fala (`:24-26`) | Estúdios HeyGen avatar/foto/twin via `ScriptField` (`seconds` true → `script`): `heygen-studios.tsx:121-160`, chamadas `:466-474`, `:1016-1025`, `:1150-1157` | 5.000 (`AVATAR_SCRIPT_MAX`, `src/hooks/use-heygen-studio.ts:520`) |
| `scene` | corrigir UMA cena já gerada; só o que muda (`:21-23`) | `src/components/video/scene-edit.tsx:152-155`; `src/components/video/polish-strip.tsx:377-378` | — |
| `content` | tema de peça estática (`:15-17`) | Criar: `src/components/criar/creator.tsx:541` | — |
| `slide` | instrução curta no imperativo para UM slide (`:27-30`) | `src/components/biblioteca/slide-editor.tsx:185-189` | `PEDIDO_MAX` |

Não há `kind` para: prompt de cena Kling/Seedance/Veo (t2v/i2v), briefing estruturado do Diretor (6 campos), instrução de troca (`character_prompt` do Aleph, `_shared/mcp-criar.ts:147`), tradução/legenda. O `kind` `video` serve de "genérico" para tema e para a ideia do Video Agent.

### 1.4 O componente (`src/components/prompt/prompt-tools.tsx`)
- Linha de ferramentas: mic (Scribe), "Melhorar prompt", "Voltar ao original" e a legenda `Scribe v2 · <modelo do papel generator> · Sem estimativa para este modelo` (`:203-205`). Com o padrão, a legenda mostra "Gemini 2.5 Pro" (`src/components/ai-role-grid.tsx:83-90`) — a tela anuncia Gemini como o escritor (contra a memória "Só Claude no Content Engine").
- Sem chave do driver escolhido, abre a integração (admin) ou pede a um admin (`:79-86`, `:126-128`).
- Latência: chamada síncrona `useMutation` (`src/hooks/use-prompt-assist.ts:52-59`), spinner no botão; segundos. Custo: gateway Lovable (crédito da instância, "até 8× mais" segundo `src/lib/integrations.ts:61`) ou chave BYO OpenAI/xAI da pessoa. Nunca a assinatura do Claude.

### 1.5 `llm.ts`: confirmado que não há Claude
- Drivers: `'lovable-gateway' | 'openai' | 'xai'` (`supabase/functions/_shared/llm.ts:30-32`); cabeçalho diz "O Claude NUNCA entra por API" (`:6-8`). SQL `drizzle/migrations/0017_claude_so_pelo_conector.sql:1-3` tirou o driver `anthropic` dos papéis.
- `semApiPaga` (`:135-145`): o que o mcp-server ainda gera no servidor cai no gateway incluso, nunca em chave BYO.
- 24 arquivos importam `llm.ts` (lista completa em §5.6).

---

## 2. Caminho pelo conector (o que já existe, de ponta a ponta)

### 2.1 Peças
- **Edge `roteiro-pedido`** (`supabase/functions/roteiro-pedido/index.ts`): `POST {briefing, referencias?}` grava em `roteiro_pedidos` e acorda a rotina (`:83-108`); `action:'cancelar'` (`:39-46`); `action:'responder'` põe a resposta da pessoa na conversa (roteiro **ou** `video_edits`), tira `aguardando_pessoa`, zera `claim` e acorda a rotina (`:48-81`). "Nada aqui chama LLM" (`:11`). Rate limit reaproveita a chave `'regenerate-piece'` (`:91`). Briefing 20–4.000 chars (`:84-85`, `_shared/roteiro.ts:17`), até 10 referências https (`roteiro.ts:18`, `:283-295`).
- **Receitas** (`_shared/roteiro.ts`): `RECEITA_DO_ROTEIRO` (`:100-139`) — "O BRIEFING MANDA, a marca (marca_ler) é contexto" (`:102-103`), passos `conceito`/`tela` com ações na fração da fala (`:111-121`), plano com bastidor (`:123-130`), "SE PRECISAR DA PESSOA → roteiro_mensagem aguardar_pessoa" (`:132-133`), "AVISE O ANDAMENTO" (`:135-136`), entrega (`:138-139`). `RECEITA_DA_MONTAGEM` (`:141-150`). Tipos: `PedidoDeRoteiro` (`:85-98`), `PlanoDeProducao` (`:54-67`), etapas `enviado→pegou→pesquisa→referencias→roteiro→plano→entregue` (`:70-73`). Validador `conferirEntrega` (`:241-252`): roteiro ≤ 5.000 (`ROTEIRO_MAX`, `:16`), sem emoji/hashtag, plano conferido campo a campo (`:210-238`).
- **Acordar a rotina** (`_shared/claude-rotina.ts`): segredos do Vault `CLAUDE_ROUTINE_URL`/`CLAUDE_ROUTINE_TOKEN` (`:9-10`), `POST {text}` no Fire URL com `anthropic-version: 2026-10-21`, timeout 15 s, devolve `r.ok` (`:24-46`). Cadastro em Integrações › "Claude · assinatura" (`src/lib/integrations.ts:64-90`), validação do URL `…/routines/trig_\w+/fire` e token `sk-ant-oat01-` (`supabase/functions/store-secret/index.ts:88-92`). Quem acorda: roteiro-pedido (`:79`, `:104`), edit-slide (`:84`), video-edit (`:297`), saga carrossel (`_shared/saga.ts:909`) e artes (`:1487`).
- **Conversa** (`_shared/conversa.ts`): mensagens `{de:'claude'|'pessoa', texto, em}` em `roteiro_pedidos.conversa` ou `video_edits.analysis.conversa`, 2.000 chars, 60 mensagens (`:8-29`).
- **`conector-interno.ts`**: o mcp-server chama edges admin (`avatar-studio`, `generate-image`) com `x-cron-secret` + `x-conector-usuario` (admin) (`:8-38`). Não participa da escrita.
- **Tools MCP** (`supabase/functions/mcp-server/index.ts`): definições `slide_pedidos` `:307`, `slide_entregar` `:320`, `roteiro_pedidos` `:335`, `roteiro_andamento` `:348`, `roteiro_mensagem` `:364`, `video_mensagem` `:380`, `roteiro_entregar` `:396` (schema completo do plano), `video_pedidos` `:464`, `video_entregar` `:514`, `marca_ler` `:587`, `o_que_posso_fazer` `:99`. Handlers: `roteiro_pedidos` `:1379-1417` (ignora `aguardando_pessoa`, expira por `requestState`, reserva com escrita condicional no `claim`, devolve `{pedido_id, briefing, referencias, conversa?, receita}`); `roteiro_andamento` `:1419-1434` (renova o claim); `roteiro_mensagem` `:1436-1452`; `roteiro_entregar` `:1476-1495` (confere, grava `entregue`); `slide_pedidos` `:1325-1357`; `slide_entregar` `:1359-1377`; `video_pedidos` `:1526-1562`; `marca_ler` `:1599-1600`.
- **Guia da rotina** (`_shared/mcp-guia.ts:5-24`): é o texto que o Claude recebe como instrução do servidor MCP (igual ao que aparece nas instruções do servidor `content-engine` nesta sessão); capacidade `roteiro` (`:75-78`) e `slide_editar` (`:71-74`) sem `perguntar`.
- **Prazos**: claim 10 min, 3 tentativas, pedido vence em 24 h (`_shared/video-edit-engine.ts:822-836`) para roteiro e vídeo; slide: reserva 15 min, 3 tentativas, 24 h (`_shared/editar-slide.ts:264-276`).

### 2.2 Tabelas
- `roteiro_pedidos`: `drizzle/migrations/0019_roteiro_pedidos.sql:7-22` (status aberto/entregue/cancelado/falhou, briefing, referencias, claim, roteiro, plano, erro) + `andamento` (0020) + `conversa`, `aguardando_pessoa` (`0021_roteiro_conversa.sql:4-5`); RLS leitura só do dono (`0022_roteiro_pedidos_dono.sql:3-7`); escrita só por service role (`0019:49-50`); Realtime ligado (`0019:52-62`). **Não está** em `supabase/seed-instancia.sql` nem em `supabase/sql/*.sql` (só em `drizzle/migrations`): instância nova via seed fica sem a tabela — `roteiro-pedido/index.ts:97-100` só tolera falta da coluna `andamento`, não da tabela.
- Pedido de slide: não tem tabela; vive em `content_pieces.adapted_content.pedido_claude` (`editar-slide.ts:254-262`, `edit-slide/index.ts:80-82`).
- Pedido de montagem: `video_edits` com `status='suggested'`, `analysis.external=true`, `analysis.request`, `analysis.plano`, `analysis.claim/conversa/aguardando_pessoa` (`mcp-server:1527-1530`, `video-edit/index.ts:290-299`; DDL `supabase/sql/video-edits.sql:23`).
- Pedido de carrossel: `generation_jobs.timings.pedido_claude` (`saga.ts:903-906`).

### 2.3 Front
- `src/hooks/use-roteiro-pedidos.ts`: `useUltimoPedidoDeRoteiro` (Realtime em `roteiro_pedidos` + polling 8 s enquanto aberto, janela de 24 h, `:85-129`), `usePedirRoteiro` (`:137-150`), `useCancelarRoteiro`, `useResponderClaude` (`:166-185`).
- `src/hooks/use-mcp-tokens.ts`: tokens do conector (hash no banco, `:11-16`), refetch 30 s (`:42`). `src/lib/mcp-connector-state.ts:14-27`: `off | waiting | on | live` (live = uso há < 10 min). A tela só usa "há token ativo" (`roteiro-brief.tsx:61`, `slide-editor.tsx:61`), não `live`.
- `src/components/video/roteiro-brief.tsx`: sem token → "Conectar o Claude" (`:112-135`); aberto → `AndamentoDoRoteiro` com trilha de 7 etapas, última frase, "há quanto tempo", `ConversaClaude` e Cancelar (`:257-424`); avisos: > 2 min sem pegar (`:250`, `:274`), > 15 min sem aviso = "parece parado" (`:251`, `:275`, `:417`); entregue → roteiro cai no campo e `toast "Roteiro pronto"` uma vez por pedido (`:74-90`), `PlanoResumo` (`:427-516`). Sem rotina (`acordou=false`): toast "Pedido guardado. Peça ao seu Claude: 'atenda os pedidos de roteiro'" (`:98-99`).
- `src/components/video/conversa-claude.tsx`: chat dentro do pedido; quando `aguardando`, destaque e foco (`:43-45`, `:62-72`).
- `src/lib/claude-prompt.ts`: `promptDeEdicao` + `urlDoClaude` (`https://claude.ai/new?q=`) — só usado na faixa "Editar com Claude" do vídeo (`src/components/video/polish-strip.tsx:104`, `:234`). É o único "abrir no Claude com prompt pronto"; não existe para roteiro nem slide.
- Sino: `src/components/task-watcher.tsx:79-102` ouve `roteiro_pedidos` e navega para `/videos/novo?rota=avatar`; `src/hooks/use-inbox.ts:61`.

### 2.4 Ciclo de vida de um pedido de roteiro (tempos medidos no código, não em produção)
1. Clique "Criar roteiro com o seu Claude" → `roteiro-pedido` insere a linha com `andamento('enviado')` e chama o Fire URL (até 15 s de timeout) → responde `{pedido_id, acordou}`. A tela já mostra a trilha em "Enviado" com "O seu Claude foi acordado…" ou "Aguardando o seu Claude pegar o pedido." (`index.ts:104-107`).
2. Rotina sobe na nuvem da Anthropic, chama `roteiro_pedidos reservar:true` → `andamento('pegou')`. Se não pegar em 2 min a tela diz "ainda não pegou" (`roteiro-brief.tsx:274`).
3. Claude pesquisa (acervo + web), baixa e estuda referências (vídeo, transcrição, quadros), escreve passos e plano; a cada etapa `roteiro_andamento` renova o claim. Sem aviso por 10 min o claim vence e outra sessão pode pegar (`video-edit-engine.ts:822`); sem aviso por 15 min a tela diz "parece parado" (`roteiro-brief.tsx:251`).
4. Dúvida que trava → `roteiro_mensagem aguardar_pessoa:true`: pedido sai da fila (`:1446`), tela destaca a conversa; resposta → `roteiro-pedido action:'responder'` → volta à fila e acorda a rotina de novo (`:60-63`, `:78-79`).
5. `roteiro_entregar` → `status='entregue'`; Realtime invalida a query; roteiro entra no campo, plano fica em `config.avatar_video.plano` do job (`roteiro-brief.tsx:87-88`; `docs/hub-motor-contratos.md:22`).
6. Avatar pronto → `director-advance` abre o pedido de montagem em `video_edits` via `video-edit action:'plan' via:'connector'` com `planoEmTexto` (`director-advance/index.ts:2429-2455`); `video-edit` acorda a rotina (`:290-299`); mesmo Claude monta e entrega por `video_render`/`video_entregar`.

Tempo total do clique à entrega: NÃO VERIFICADO em produção. Pelo desenho (pesquisa web + baixar vídeos de referência + extrair quadros 1/s + escrever até 120 passos), a ordem de grandeza é de **vários minutos** (a própria tela só alarma aos 15 min). É um fluxo de "pode sair da tela, o sino avisa" (`roteiro-brief.tsx:420`), não de campo de formulário.

Sem rotina ligada: o pedido fica `aberto` até 24 h (`REQUEST_MAX_HOURS`, `video-edit-engine.ts:824`) esperando a pessoa abrir o Claude e dizer "atenda os pedidos de roteiro"; depois vira `falhou` com "O pedido venceu sem o seu Claude atender." (`mcp-server:1392-1398`). A tela não diferencia "rotina não cadastrada" de "rotina cadastrada e não respondeu": só o toast do passo 1 (`roteiro-brief.tsx:98-99`) e o texto do andamento.

### 2.5 Pedido de slide (o segundo pedido tipado)
`edit-slide` com `pedir_ao_claude:true` grava `pedido_claude {index, instrucao, pedido_em}` na peça e acorda a rotina (`edit-slide/index.ts:70-85`); recusa segundo pedido na mesma peça (`:77-79`). `slide_pedidos` devolve `{pedido_id, slide, pedido, receita:{instrucoes, pedido, schema}}` (`mcp-server:1348-1352`; `editar-slide.ts:284-301`); `slide_entregar` aplica `entregarEdicao` com gate de guardrails + léxico da persona e trava de `updated_at` (`editar-slide.ts:335-385`). A tela mostra "Com o seu Claude · '<pedido>'" + Cancelar (`slide-editor.tsx:159-181`). Com conector, a tela manda **sempre** `pedirAoClaude: claude` (`slide-editor.tsx:95`): o caminho `editar` por LLM só roda sem conector — e o botão está desligado sem conector (`:195`), logo o LLM de slide é código morto na prática.

---

## 3. Marca disponível pelo conector

### 3.1 O que `marca_ler` devolve
`lerMarca` lê `content, version` da linha `status='active'` de 4 tabelas: `brand_persona`, `brand_strategy`, `brand_guardrails`, `brand_kit` (`supabase/functions/_shared/assistant-tools.ts:16-30`).

**QUEBRADO**: a tabela chama-se `guardrails`, não `brand_guardrails` (types gerados: `src/integrations/supabase/types.ts:988` tem `guardrails`; não existe `brand_guardrails`; quem lê regras usa `from('guardrails')`: `editar-slide.ts:321-324`, `brand-autopilot/index.ts:1148`). Resultado: `marca_ler` **nunca devolve guardrails** (o `maybeSingle` em tabela inexistente volta erro silenciado) e `assistant-tools.ts:213` sempre marca `regras: false`. A rotina escreve roteiro sem a lista de palavras/CTAs proibidos, e o `slide_entregar` depois recusa pelo gate (`editar-slide.ts:359-364`) — retrabalho garantido quando há guardrail.

Conteúdo das tabelas (`_shared/types.ts`):
- `brand_persona.content` (`:305-356`): identity (nome, papel, posicionamento, público), credenciais com fonte, worldview + teses, `tone_principles`, `signature_lexicon` com dosagem, heurísticas, opiniões citáveis, `voice_checklist`, exemplos bom/ruim.
- `brand_strategy.content` (`:360-372`): promessa, teses, inimigo, `safe_list`, ICP (perfil, desejos), postura editorial, `content_mix`, `cta_repertoire`.
- `guardrails.content` (`:376-400`): pontuação/palavras/metáforas/CTAs proibidos, CTAs permitidos, overrides por canal, rubrica do juiz, dosagem (emoji, hashtag).
- `brand_kit.content` (`:402-410`): paleta, tipografia, `logo_path`, `negative_constraints` (visual), `photo_paths`.

### 3.2 O que a marca tem e `marca_ler` NÃO devolve
- Vozes (`brand_voices`: nome, provedor, `provider_voice_id`, gênero, origem, padrão — `supabase/seed-instancia.sql:1318-1341`) e avatares (`brand_avatars`: `appearance_prompt`, gênero, `reference_image_path`, `provider_refs`, `voice` — `src/integrations/supabase/types.ts:192-207`) só saem em `o_que_posso_fazer` (`mcp-server:921-928`), e sem `appearance_prompt`/`reference_image_path`.
- Acervo: só por `acervo_buscar` (`assistant-tools.ts:42-53`, até 20 trechos de 900 chars, exclui `pesquisa-web`).
- Notas por modelo (`src/lib/model-notes.ts:10-31`) e regras de prompt por motor vivem só no front e nos docs; nenhuma tool do conector as expõe.

### 3.3 O que seria útil por tipo de escrita (e o que falta)

| Escrita | Da marca, útil | Já chega ao Claude? | Falta |
|---|---|---|---|
| Roteiro de avatar (fala ≤ 5.000) | identity, tone_principles, léxico+dosagem, `cta_repertoire`, guardrails (palavras/pontuação), voice_checklist, exemplos bom/ruim; voz escolhida (gênero/idioma para escrever "como se fala") | persona, estratégia, brand_kit via `marca_ler`; guardrails NÃO (quebrado) | guardrails; qual voz/avatar a pessoa escolheu na tela; limite de 5.000 explícito já está na receita (`roteiro.ts:121`) |
| Prompt de cena (Kling/Seedance/Veo/Higgsfield) | `brand_kit` (paleta, `negative_constraints`, logo), `appearance_prompt` e `reference_image_path` do apresentador, `mandatorios` do Diretor ("sem logo no plano 1", `mcp-criar.ts:112`) | brand_kit sim; aparência do avatar NÃO; regras do modelo NÃO | regra por modelo (duração por cena, blocos de cobrança, i2v vs t2v, o que o modelo entende: câmera, luz, ação), idioma do prompt (inglês?) |
| Briefing do Video Agent (ideia ≤ 10.000, `AGENT_PROMPT_MAX`, `heygen.ts:561`) | promessa, ICP, teses, CTA, tom; `brand_kit: true` já manda cor/logo pelo HeyGen (`mcp-criar.ts:80`) | persona/estratégia sim | o formato que o Agent espera (ideia + duração + orientação + o que mostrar), limite de arquivos (20, `heygen.ts:562`) |
| Briefing do Diretor (6 campos: objetivo, público, smp, número-herói, tom, cta) | persona.identity.audience, estratégia (promessa, teses, cta_repertoire), acervo para o número-herói | hoje é a edge `video-brief` por Gemini (`video-brief/index.ts:33-40`); pelo conector o Claude tem de preencher os 6 campos de `pedidoDeCenas` (`mcp-criar.ts:93-95`) sem receita | receita do briefing (a de `video-brief:33-40` serve de base) exposta como pedido |
| Instrução de edição (`scene`, troca de pessoa, legenda) | `negative_constraints`, paleta para cartelas | brand_kit sim | vocabulário aceito pelo motor (`OP_SCHEMA`/`planSystem` de `video-edit-engine.ts`) só chega quando há um `video_edits` aberto |

---

## 4. Padrão generalizável: "pedido de escrita por ferramenta"

### 4.1 O que os dois pedidos tipados têm em comum (contrato de fato)
1. **Fila tipada** com dono, status, `claim {at, attempts}`, prazo (24 h), erro legível ("Peça de novo").
2. **Receita** fixa do servidor entregue junto com o pedido (`RECEITA_DO_ROTEIRO`; `receitaDaEdicao → {instrucoes, pedido, schema}`).
3. **Schema de saída** validado no servidor, com lista de `problemas` para o Claude corrigir e tentar de novo (`roteiro_entregar:1484-1485`; `slide_entregar` devolve "Não entrou: …").
4. **Acordar a rotina** no insert e em cada resposta; `acordou` volta para a tela.
5. **Tela**: estado "Com o seu Claude" + Cancelar; Realtime/polling; entrega cai no campo; sem conector, aponta Ajustes › Conectores.
6. **Conversa** (só no roteiro e na montagem; slide não tem).
7. **Marca**: a receita manda ler `marca_ler` como contexto ("o briefing manda").

### 4.2 Contrato proposto para `escrita_pedidos` (genérico, um por campo de ferramenta)

```
EscritaPedido {
  id, created_by, status: aberto|entregue|cancelado|falhou, claim, erro, created_at, updated_at
  ferramenta: 'avatar_script' | 'agent_idea' | 'scene_prompt' | 'director_brief' | 'edit_instruction' | …   -- qual campo
  provedor + modelo: ex. 'heygen/avatar_iv', 'replicate/bytedance/seedance-2.0', 'higgsfield/cinematic_studio_3_0' -- o modelo escolhido na tela
  entrada: { texto_da_pessoa, contexto: { avatar_id?, voice_id?, duracao_s?, formato?, idioma?, cena_atual? } }
  limites: { max_chars (5.000 HeyGen, 10.000 Agent, …), idioma, proibicoes }                 -- vêm do catálogo
  receita: texto do servidor por (ferramenta, modelo): o que o modelo faz em 1 frase, o que escrever, em que formato, erros comuns
  retorno: schema JSON por ferramenta (ex. { texto } ou { objetivo, publico, smp, numero_heroi, tom, cta } ou { prompt, negative_prompt, camera })
  conversa, aguardando_pessoa     -- quando faltar algo (ex.: "qual o número que prova isso?")
  andamento?                       -- opcional; para escrita curta basta aberto/entregue
}
```

Tools MCP: `escrita_pedidos(reservar)` → `[{pedido_id, ferramenta, modelo, entrada, limites, receita, schema, conversa?}]`; `escrita_entregar(pedido_id, saida)` → confere limites/schema/guardrails e grava; `escrita_mensagem(pedido_id, texto, aguardar_pessoa)`. Alternativa sem tabela nova: generalizar `roteiro_pedidos` com uma coluna `ferramenta` + `saida jsonb` (a tabela já tem dono, claim, conversa, andamento, RLS e Realtime).

### 4.3 Reaproveitável × tem de nascer

| Camada | Reaproveita | Nasce |
|---|---|---|
| Tabela | `roteiro_pedidos` (0019–0022) se ganhar `ferramenta`, `modelo`, `entrada jsonb`, `saida jsonb` | ou `escrita_pedidos` nova; em ambos os casos SQL também em `supabase/sql`/seed (hoje só em drizzle) |
| Edge | `roteiro-pedido` (insert, cancelar, responder, acordar) vira `escrita-pedido` com `ferramenta` | validação por ferramenta (limites do catálogo `video_models`) |
| Receitas | `RECEITA_DO_ROTEIRO` (fala), `video-brief/index.ts:33-40` (briefing), `prompts/prompt-assist.ts:14-31` (regras por kind), `model-notes.ts` (frases por modelo), `docs/catalogo-*.md` | um `_shared/receitas-de-escrita.ts` por (ferramenta, modelo) — hoje a regra de prompt de Kling/Seedance/Veo/Aleph não está em texto nenhum do servidor |
| MCP | `requestState`, claim condicional, `comMensagem`, padrão `*_pedidos/*_entregar/*_mensagem`, `marca_ler`, `acervo_buscar` | 3 tools novas; capacidade `escrita` em `mcp-guia.ts` DEFINICOES; linha no `GUIA_DO_CONECTOR` |
| Rotina `trig_01P1DfnxhGaZ5phCWRKHP6hZ` | texto atual (NÃO VERIFICADO no repo: o repo só guarda o guia do servidor e a nota "atenda os pedidos abertos", `integrations.ts:86-88`) | acrescentar "atenda `escrita_pedidos`" — pelo RemoteTrigger, nunca "falta criar" (memória) |
| Hooks | `useUltimoPedidoDeRoteiro` (Realtime+polling), `usePedirRoteiro`, `useResponderClaude`, `useMcpTokens`/`acessosDoClaude` | `useEscrita(ferramenta)` parametrizado; filtro por `ferramenta` e pelo campo da tela |
| Componente | `PromptTools` (mic Scribe, Voltar ao original, `onBusyChange`), `AndamentoDoRoteiro` compact, `ConversaClaude`, bloco "Conectar o Claude" | botão "Escrever com o seu Claude" no lugar de "Melhorar prompt"; estado "Com o seu Claude" dentro do campo; legenda "Pela sua assinatura · sem custo extra" (já existe em `roteiro-brief.tsx:180`, `slide-editor.tsx:215`) |
| Marca | `marca_ler` | corrigir `brand_guardrails`→`guardrails`; expor avatar/voz escolhidos no `contexto` do pedido |

---

## 5. Riscos

### 5.1 Assíncrono num campo de formulário
O roteiro foi desenhado para "saia da tela, o sino avisa". Um "Melhorar prompt" pelo conector tem: 15 s só para o Fire URL responder (`claude-rotina.ts:37`), subida da rotina na nuvem (NÃO VERIFICADO: segundos a minutos), execução e entrega. Expectativa realista: 1–3 min para texto curto, mais com pesquisa. Hoje a pessoa vê o resultado em segundos. Mitigação já disponível no código: o estado "Com o seu Claude" + Cancelar (`slide-editor.tsx:159-181`) e a frase "pode sair desta tela" (`roteiro-brief.tsx:420`); o campo tem de ficar editável enquanto espera, e a entrega não pode sobrescrever o que a pessoa digitou (padrão `usado`/`localStorage` em `roteiro-brief.tsx:74-90`).

### 5.2 Rotina desligada ou sem resposta
- Sem `CLAUDE_ROUTINE_URL/TOKEN`: `acordou=false`, pedido fica 24 h aberto; a pessoa precisa abrir o Claude e pedir. Em um campo de formulário isso é bloqueio total. A tela só sabe "há token do conector", não "há rotina" (`roteiro-brief.tsx:61`); `connectorState().live` (`mcp-connector-state.ts:24`) existe e não é usado nas telas de pedido.
- Rotina cadastrada mas recusando (401/limite de execuções): `acordarRotina` só loga `console.warn` (`claude-rotina.ts:40`) e devolve `false`; a tela recebe o mesmo `acordou=false` sem causa. Para a saga de carrossel há fallback para o gateway (`claude-rotina.ts:5`, `saga.ts:909-911`); para roteiro e slide não há (e não deve haver, pela regra 1).

### 5.3 Pedidos duplicados
- Roteiro: nada impede dois pedidos abertos da mesma pessoa; a tela só mostra o último (`use-roteiro-pedidos.ts:121-123`) e o Claude vê até 5 por chamada (`mcp-server:1400`). Slide: um por peça (`edit-slide:77-79`). Montagem: idempotente por `artifacts.montagem.edit_id` (`director-advance:2434`). Um pedido por campo precisa de chave `(ferramenta, alvo)` com "já há um pedido aberto neste campo".
- Duas sessões do Claude (claude.ai + Claude Code) no mesmo conector: a reserva condicional (`:1405-1409`) evita trabalho duplo, mas cada chamada do Fire URL dispara uma execução nova da rotina; `responder` dispara de novo (`roteiro-pedido:78-79`).

### 5.4 Custo da rotina para a pessoa
A tela promete "Pela sua assinatura · sem custo extra" (`roteiro-brief.tsx:227`). Cada pedido é uma execução de rotina (cota da assinatura/plano do Claude Code da pessoa; limites NÃO VERIFICADOS). Transformar cada "melhorar" em execução multiplica isso por campo e por tentativa. O produto não mostra quantas execuções já disparou nem o estado da rotina.

### 5.5 Limite de 5.000 do HeyGen
- Conferido em três lugares: tela (`AVATAR_SCRIPT_MAX=5000`, `use-heygen-studio.ts:520`, `maxLength` no `PromptField`), receita + validador (`roteiro.ts:16`, `:248`) e cliente HeyGen (`heygen.ts:463`; TTS corta em 5.000, `:438`). `prompt-assist` aceita 6.000 de entrada e corta a saída em `max` (`index.ts:150`) — corte cego no meio da frase. O Claude pelo conector recebe `problemas` e reescreve (`roteiro_entregar`), que é o comportamento certo; a receita diz "cerca de 15 por segundo de fala" (`roteiro.ts:121`), a tela mostra `≈ N s` (`heygen-studios.tsx:139`, `:156`). Video Agent é 10.000 (`heygen.ts:561`).

### 5.6 Aplicar a regra 1 na ajuda de escrita: o que quebra
Se `prompt-assist` e `video-brief` deixarem de chamar `chat()`:
- Quebram de imediato (ficam sem "Melhorar prompt"): Diretor Tema (`novo.tsx:451`), 3 estúdios de avatar (`heygen-studios.tsx:466`, `:1016`, `:1150`), Video Agent (`:1208`), cena (`scene-edit.tsx:152`, `polish-strip.tsx:377`), slide (`slide-editor.tsx:185`), Criar (`creator.tsx:541`). O mic Scribe continua (não é LLM).
- "Montar briefing" do Diretor (`novo.tsx:343`) e do setup (`setup-flow.tsx:49`) ficam sem preenchimento automático dos 6 campos.
- Continuam no gateway, fora do escopo "escrita da pessoa" mas ainda `llm.ts`: saga/generate-content, judge, retrieval/embeddings, director-core (roteiro do Diretor), remake, generate-image, assistant-chat, brand-autopilot, brand-kit-suggest, extract-voice, market-score, fetch-rss, web-search, ingest/search-context, video-edit (plano de edição). Lista pelos imports: 24 arquivos (`grep -l _shared/llm.ts`). O Diretor escreve o roteiro das cenas pelo gateway em `director-core.ts` — é a maior dívida escondida se "escrita = só Claude".
- `edit-slide` sem Claude conectado já está desligado na UI; a remoção do `editar` por LLM não muda nada visível.

---

## Resumo do que está CONFIRMADO / NÃO VERIFICADO / QUEBRADO
- CONFIRMADO: todo o fluxo de `prompt-assist`, `video-brief`, `roteiro-pedido`, tools MCP, receitas, prazos, telas e hooks citados acima; `llm.ts` sem driver Claude.
- NÃO VERIFICADO: tempo real do clique à entrega da rotina; texto atual da rotina `trig_01P1Dfnx…`; teto de `rate_limits.prompt-assist`; estado de deploy das edges (`docs/pendencias.md:35-37` lista redeploys pendentes). Observação: nesta sessão o servidor MCP `claude_ai_Content_Engine` (claude.ai) não expõe `roteiro_*`/`slide_*`, enquanto `content-engine` (local) expõe — sugere que o deploy remoto do `mcp-server` está atrás do repo.
- QUEBRADO: `marca_ler` lê `brand_guardrails`, tabela inexistente (`assistant-tools.ts:16`); guardrails nunca chegam ao Claude. `roteiro_pedidos` só existe em `drizzle/migrations`, não no seed/sql de instância. A legenda do `PromptTools` anuncia "Gemini 2.5 Pro" como escritor (`prompt-tools.tsx:204`), contra a regra 1.
