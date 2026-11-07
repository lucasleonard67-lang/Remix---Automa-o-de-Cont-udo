# 01 · Engenharia de FRONT — inventário da tela do hub de vídeo

Repo: `/Users/samuelfadanelli/Developer/subido-redes-sociais` (leitura em 04/11/2026, nada alterado). Todo caminho é relativo a `src/` salvo quando indicado. Legenda das regras do briefing: **R1** Claude só pelo conector · **R2** provedor+modelo+custo antes do Gerar · **R3** zero esforço cognitivo / não sair do fluxo.

Separação usada em cada bloco: **CONFIRMADO** (li o código) · **NÃO VERIFICADO** (doc/comentário diz, código não prova) · **QUEBRADO** (tela × motor × provedor divergem).

---

## 0. Como o hub funciona hoje (CONFIRMADO)

- Duas perguntas: "O que você tem?" (`components/video/video-hub.tsx:110-129`, opções em `lib/video-hub.ts:125-129`) e "O que você quer?" (`video-hub.tsx:134-156`). Rotas por `HUB_ROUTES` (`lib/video-hub.ts:381-500`); as marcadas `more: true` ficam atrás de "Mais opções (N)" (`video-hub.tsx:157-169`).
- Cada ladrilho (`components/video/hub-route-tile.tsx:83-175`) mostra: vídeo-exemplo público do provedor (`lib/hub-examples.ts`), `label`, `line` e a linha "Padrão {modelo · custo · +N top}" (`hub-route-tile.tsx:100-107, 148-154`).
- Escolhida a rota, abre o trilho `ModelRail` (`video-hub.tsx:242-302`): botão por modelo com ícone do provedor, nome, selo "Padrão" (índice 0) ou "Top" (`:281-283`), e só **custo · tempo** (`:295`). Nunca mostra a nota do modelo nem o que ele faz.
- Abaixo: `route.via` (`:185`), `route.options` (`:186-188`), `route.note` (`:189-202`), "Falta conectar X" com botão que abre o modal de integração (`:203-217`), "Chega no próximo deploy." quando `STUDIO_READY` é false (`:218-222`, `lib/video-hub.ts:86-93`) e **Continuar** (`:223-230`), desligado sem provedor conectado, sem motor ou enquanto confere (`:225`).
- `Continuar` chama `onRoute(route, have, model)`. Em `/videos/novo` (`routes/_app/videos/novo.tsx:186-193`) a rota vira estado local e o formulário certo abre embaixo (`:194-210`): `RemakeFlow` (remake), `CreateVideoForm` (Diretor scenes/presenter) ou `HubStudio` (HeyGen/Higgsfield). A pessoa **não sai da página**; o hub some e sobra "← Mudar o que quero fazer" (`:178-185`).
- Segundo chamador: o onboarding `components/setup/step-create.tsx:355-371` (chip "Vídeo"): estúdio → navega para `/videos/novo?rota=&modelo=` (sai do setup, `:359-363`); remake → inline sem passar o modelo (`:373-375`); director → `onVideoChange("presenter")` ignorando se a rota era `scenes` ou `presenter` e ignorando o modelo (`:367-369`). **QUEBRADO**: o hub promete Seedance/Kling e o setup abre o briefing fixo de apresentador.
- Modelos "padrão · top" resolvidos por `hooks/use-hub-models.ts:69-136`: catálogo `video_models` com `experience[]` manda; sem ele, vale o plano hard-coded de `lib/video-hub.ts`. Estado `soon` ("em breve", desligado) quando o destino não aceita o modelo (`routeAccepts`, `lib/video-hub.ts:100-123`).
- O que a pessoa vê depois de Gerar: toast "Vídeo na fila…" + `navigate({to:"/videos"})` (`heygen-studios.tsx:221-222`, `novo.tsx:431-433`, `remake-flow.tsx:545-550`). Na galeria (`components/video/video-gallery.tsx`) a capa abre o `JobCard` num painel lateral; a régua de etapas Roteiro→Voz→Quadros→Cenas→Montagem→Pronto só existe para o Diretor (`job-card.tsx:339-375`, `if (job.config?.mode) return null`) — estúdios HeyGen e remake mostram só o status. Com o vídeo pronto: `ProductionStudio` (palco + storyboard, `production-studio.tsx:170-422`), edição de cena por prompt (`scene-edit.tsx:129-200`, `PromptField kind="scene"`, botões "Corrigir esta cena · até US$ X" / "Refazer a cena · preço a confirmar") e a faixa "Editar com Claude" (`polish-strip.tsx:174-180`), que exige o conector (`Conectar editor` → `openIntegration("claude_editor")`, `:168-172`) e tem abas Ajustes / Inserir / Pedir ao Claude (`edit-panel.tsx:545-549`).

---

## 1. Tabela-resumo — rota × (o que pede · o que explica · escolha+custo · ajuda do Claude · onde quebra)

| Rota (tenho → quero) | O que pede (ordem da tela) | O que explica sobre o modelo | R2 escolha + custo | Ajuda de escrita | Onde quebra |
|---|---|---|---|---|---|
| idea → **scenes** (Diretor) | Tema (texto, 600 via URL, sem max no campo) → "Montar o briefing" ou "Preencher à mão" → Mensagem, Número que prova, Fala final (obrig.) → Objetivo/Público/Tom (oculto) → Cenas 3–8 → Duração total ou blocos → Resolução → Legendas (+estilo/posição/cor) → Avançado (teto créditos, revisões, só quadros, comparar) → lista de modelos → Gerar | Hub: só `line` + `via` + custo/s. No Gate: nota de 1 frase por modelo (`model-notes.ts`), só para Seedance 2.0/1-lite, Kling 2.5, Hailuo, Pixverse, CS 3.0/v2; Kling 4.0, Veo 3.1, Seedance 2.5 **sem nota**. Nada sobre formato do texto, o que o modelo não faz, exemplo de prompt | **Cumpre** (única rota): `GenerationGate` com Recomendado + motivo (= nota do modelo), "até US$ X" por linha e no rodapé | `PromptField kind="video"` no Tema (Melhorar prompt + mic) e "Montar o briefing" → ambos pela edge `_shared/llm.ts` (Gemini/OpenAI/xAI) = **DÍVIDA R1**. Zero Claude pelo conector | Padrão do hub (Seedance 2.0) ≠ Recomendado do Gate (regra própria); `ENGINE_REASON` nunca aparece; sem Higgsfield não há Gate nem lista (só "Conectar Higgsfield"); Avançado expõe "Teto de créditos", "ab", resolução |
| idea → **presenter** (Diretor) | Igual + passo "Apresentador" (crachás com foto; obrig.) | Igual + `note` "Exige um apresentador com foto" e `options` "Higgsfield mantém o rosto; no Replicate o rosto vem só do quadro" | **Cumpre** (Gate) | Igual (DÍVIDA R1) | Hub padrão = Kling 4.0 Replicate; exemplo do ladrilho = Higgsfield Seedance 2.5; Gate recomenda Higgsfield quando há rosto (`generation-gate.ts:161-163`) → três respostas para "qual modelo" |
| idea → **avatar** (HeyGen) | Biblioteca / Meus avatares / Criar avatar → crachá → voz (faixa fixa) → "O que você quer produzir": briefing (20–4000) + Referências → "Criar roteiro com o seu Claude" OU roteiro direto (5.000) → Gerar | `line`, `via` "HeyGen (avatar) + voz da marca", `note` "Avatar V só nos avatares que aceitam esse motor". Nada sobre como escrever a fala, duração ideal, pausas, idioma | **Não cumpre**: `ModelRail` Avatar IV/V com "preço a confirmar · 3–8 min"; sem linha "Estimativa"; sem motivo do padrão | **Único lugar com o Claude certo** (`roteiro-brief.tsx`): pedido → `roteiro_pedidos` → rotina → entrega. Campo de roteiro também tem `PromptField kind="script"` (Melhorar prompt via `llm.ts` = R1 quebrada no mesmo campo) | "Conectar o Claude" leva para `/config#conectores` (sai do fluxo, R3); briefing só aparece se o campo estiver vazio (`roteiro-brief.tsx:169`); dois caminhos de escrita no mesmo campo |
| idea → **agent** (Video Agent) | "A ideia" (10.000 car.) → Voz (auto / clone HeyGen) → Gerar | `line` "Descreva o vídeo; o HeyGen escreve…", "A marca vai junto: cores e logo vêm do site cadastrado". Nada sobre o que o Video Agent aceita (duração, cenas, idioma, tom), nem exemplo além do placeholder | **Não cumpre**: um modelo só, "Video Agent · preço a confirmar · 5–10× a duração"; sem Estimativa | `PromptField kind="video"` (DÍVIDA R1); nenhum pedido ao Claude | `VideoAgentStudio` ignora `initialModelId` (`heygen-studios.tsx:1175`); formato fixo `portrait` sem a pessoa ver; "Voz escolhida pelo Video Agent" é rótulo técnico |
| photo → **presenter** (Diretor) | = idea→presenter (`line` diferente) | Idem | **Cumpre** | Idem | Idem |
| photo → **photo_avatar** | Apresentador (crachás com foto; auto-seleciona) → "Preparar na HeyGen" (quando via HeyGen) → Visual → voz → Roteiro (5.000) → Gerar | `line`, `via` "HeyGen (photo avatar) ou Replicate (avatar falante)". Nada sobre limites (OmniHuman "até 34 s" só no custo) nem formato da fala | **Parcial**: `ModelRail` com 3 modelos (Avatar IV "preço a confirmar"; P-Video 2 Pro US$ 0,06/s; OmniHuman US$ 0,16/s) — tem preço unitário, **não tem** "até US$ X" para a fala escrita | `PromptField kind="script"` (DÍVIDA R1). **Sem** `RoteiroBrief` | Trocar para Replicate muda a voz para ElevenLabs fixo sem aviso (`heygen-studios.tsx:961-966`); `providers: []` no hub, então "Falta conectar" só vale para o provedor do modelo |
| photo → scenes | = idea→scenes (atrás de Mais opções) | | **Cumpre** | | |
| video → **speech** (remake) | Vídeo (MP4/MOV 2–30 s) → Fala nova (600 car., contador vs. duração) → Voz (feminina/masculina/a minha/outra) → [Voice ID / voz da marca] → lista "Voz da fala nova" → autorização → Estimativa → Melhorar vídeo | Hub: `line`, `via` "Voz nova + sincronia labial HeyGen (preço a confirmar)", `options` sobre vozes. Remake: `REMAKE_OPTION_COPY.speech.line` "Voz ElevenLabs, boca HeyGen · até 600 caracteres". Dica útil "Para N s escreva ~N×15 caracteres" | **Parcial**: lista de voz só para feminina/masculina (MiniMax com preço); ElevenLabs/HeyGen "cobrado à parte" | **Nenhuma**: `Textarea` pura, sem Melhorar prompt, sem mic, sem Claude | Hub exige HeyGen conectada (`providers:["heygen"]`), remake aceita sem HeyGen via `lipsync_post` Replicate (`remake-flow.tsx:369-370`); exemplo do ladrilho = Replicate "Lipsync Precision"; hub padrão MiniMax 2.8 ≠ regra do remake (ElevenLabs preferido, `VOICE_RULE`) |
| video → **translate** | Vídeo → Idioma (5 chips) → Idioma do vídeo (3 chips) → autorização → Estimativa → Melhorar | `line` + "HeyGen · 5 idiomas" | **Não cumpre**: sem seletor; Estimativa "cobrado à parte: HeyGen" | Nenhuma (nada a escrever) | Só 5 idiomas de saída e 3 de origem sem dizer por quê |
| video → **style** | Vídeo → Estilo (6 chips: marca, cinema, anime, massinha, quadrinhos, pixel) → lista "Estilo e cenário" → autorização → Estimativa | Hub: `via` "Replicate (vídeo → vídeo)". Remake: "Runway Aleph (Replicate) · até 30 s e 16 MB". Nota do Gate só para Aleph 2 | **Cumpre** (GateOptionList + "até US$ X" por segundo de vídeo) | Nenhuma (não há texto) | **QUEBRADO**: hub diz padrão "Kling 4.0 (edição)" (`video-hub.ts:181-189`); a cópia do remake diz "Runway Aleph" (`remake-options.ts:34`) e o exemplo do ladrilho é Aleph 2 |
| video → **scene** | Vídeo → "O que mudar no cenário" (Input, 200 car.) → lista → Estimativa | Idem style; placeholder "Ex.: num escritório moderno, com luz de fim de tarde" | **Cumpre** | **Nenhuma** (Input puro) | Idem style; 200 caracteres sem explicar o que o modelo entende |
| video → **character** | Vídeo → Apresentador (chips) → "Como a pessoa deve ficar (opcional)" (500) → autorização → Estimativa | `line` "P-Video Replace (Replicate) · até 30 s"; "Vão N fotos de X como referência (aceita até M)" | **Parcial**: sem lista (modelo primário fixo, `remake-flow.tsx:235-237`); preço "US$ X/s" calculado | **Nenhuma** | Sem apresentador com foto: "Cadastre um em Apresentadores e volte aqui" (sai do fluxo, R3) |
| video → **captions** | Vídeo → Estilo (7 chips) → Idioma do vídeo → Estimativa | "Transcrição ElevenLabs, gravação Higgsfield"; "Destaque na cor da marca" | **Não cumpre**: sem seletor; Estimativa "US$ 0,00 · sem cena nova: só a montagem" | n/a | Hub exige Higgsfield+ElevenLabs; exemplo do ladrilho é HeyGen; hub custo "centavos" ≠ remake "US$ 0,00" |
| video → **reframe** | Nada: "Chega no próximo deploy." + botão desligado | Texto do que virá | **Não cumpre** | n/a | Ladrilho mostra exemplo Replicate "Luma Reframe" para rota "Higgsfield (reframe + upscale)"; o hub já nem deixa Continuar (`routeReady` false) e o ladrilho ocupa a grade |
| video → **twin** (Mais opções) | Apresentador → Seu vídeo (upload 15–600 s, consentimento) → status do clone → Roteiro (5.000; só após pronto) → Gerar | `note` "A pessoa do vídeo grava um consentimento pelo link do HeyGen" | **Não cumpre**: Avatar IV/V "preço a confirmar" | `PromptField kind="script"` (DÍVIDA R1); sem `RoteiroBrief` | Roteiro aparece só quando o clone fica pronto (minutos/horas) sem dizer o que fazer enquanto espera |

---

## 2. Detalhe por rota

### 2.1 idea → scenes · "Vídeo de cenas com narração" (Diretor)

**CONFIRMADO**
- Hub: `lib/video-hub.ts:205-215`. Padrão Seedance 2.0 "US$ 0,18/s em 720p · 10–20 min"; top Kling 4.0, Veo 3.1 (Replicate) e Seedance 2.5 (Higgsfield, "≈ 70 créditos por 10 s") (`:141-168`). `via`: "Cenas no modelo escolhido; quadros e montagem no Higgsfield; voz ElevenLabs". `options`: "No próximo passo: tema e duração. Dá para trocar o modelo das cenas lá também." (`:214`). Exige Higgsfield + ElevenLabs conectados para Continuar (`providers`, `:211`; `video-hub.tsx:89-93, 225`).
- Formulário `CreateVideoForm` (`novo.tsx:213-773`), na ordem:
  1. **Briefing** — "Tema" (`PromptField kind="video"`, 2 linhas, placeholder "ex.: como uma indústria cortou retrabalho sem contratar ninguém", `:450-458`; sem `max` no campo, mas `?brief=` corta em 600, `:88-90`). Botão primário **"Montar o briefing"** (`:460-477`) chama a edge `video-brief`; link "Preencher à mão" (`:478-482`). Só então aparecem **Mensagem** (textarea, `:486-495`), **Número que prova** (input, `:497-505`), **Fala final** (input, `:507-515`) — os três obrigatórios (`missing`, `:377-386`: "Falta a mensagem, o número e a fala final."). Disclosure "Ajustar briefing": Objetivo (padrão "Reel B2B case-study"), Público, Tom (padrão "sóbrio, direto") (`:125-132, 517-535`).
  2. **Duração e legendas** — Cenas 3–8 (chips, padrão 5, `:555-568`); Duração: chips de blocos quando o modelo cobra em blocos, senão "Duração total (s)" com faixa min–max e "(Modelo: até N s por cena)" (`DurationField`, `:882-949`); Resolução com preço por segundo por chip quando o modelo tem mais de uma (`:847-880`); switch "Legendas no vídeo" + disclosure "Estilo da legenda" com Select "Estilo e animação" (7 opções, `hooks/use-director-jobs.ts:136-144`), "Posição", "Cor de destaque" (color input, cor da marca por padrão, `:316-325`).
  3. **Avançado** (`:663-723`): "Teto de créditos" (número, padrão 320) + "Sem teto", texto "Vale só para o Higgsfield: cenas do Replicate não entram no teto…"; "Revisar os quadros antes das cenas"; "Revisar o som antes de finalizar"; "Só os quadros (teste barato)"; "Comparar dois modelos no primeiro trecho (não entra no vídeo final)".
  4. **Portão** `GenerationGate` (`:725-767`) com `task="Cenas do vídeo"`, `basis="N s de cena · M cenas"`, lista única Higgsfield + Replicate (`:253-263`), linha "Estimativa … até US$ X" e botão **"Gerar vídeo"** (desligado com `missingNote`). Sem Higgsfield confirmado, o portão inteiro é trocado por `HiggsfieldRequired` ("Conecte o Higgsfield (quadros e montagem)" + botão + Gerar desligado, `:775-812`).
- O que a tela diz do modelo: no Gate cada linha traz `provider · label`, selo (Recomendado / Mais barato / Melhor qualidade, `lib/generation-gate.ts:59-62`), "até US$ X" ou `noPriceShort` ("sem estimativa · créditos Higgsfield"), e a sublinha `modelNote` (`generation-gate.ts:410` → `lib/model-notes.ts:43-55`). Notas existentes: Seedance 2.0 ("Sem segundos mudos no fim; mantém o rosto do apresentador."), Seedance 1 Lite, Kling 2.5 Turbo Pro (blocos), Hailuo 2.3, Pixverse v6, CS 3.0, CS v2 (`model-notes.ts:12-19`). Sem nota (cai no genérico "Gera a cena em vídeo a partir do quadro."): **Kling 4.0, Veo 3.1, Seedance 2.5, Cinema Studio 4.0** — exatamente os "top" do hub.
- O que a tela NÃO diz: formato do briefing que o roteirista espera, o que cada modelo faz pior (texto em cena, rosto, movimento de câmera), quantos segundos por cena cada um gera bem, nenhum exemplo de briefing bom além dos placeholders.
- Ajuda de escrita: "Melhorar prompt" + microfone no Tema (`components/prompt/prompt-tools.tsx:147-184`). O botão chama a edge `prompt-assist` (`hooks/use-prompt-assist.ts:28`) que importa `_shared/llm.ts` (`supabase/functions/prompt-assist/index.ts:17`) — gateway Lovable/OpenAI/xAI. A regra do `kind="video"`: "tema de um vídeo curto vertical… gancho nos 2 primeiros segundos, sequência de cenas, câmera, ritmo e o fecho" (`supabase/functions/_shared/prompts/prompt-assist.ts:18-20`). A marca entra como persona + estratégia (`prompt-assist/index.ts:113-121`). "Montar o briefing" idem: `video-brief/index.ts:15` usa `chat` de `_shared/llm.ts` com persona/estratégia (`:74-85`). O rodapé do campo mostra **"Scribe v2 · Gemini 2.5 Pro · Sem estimativa para este modelo"** (`prompt-tools.tsx:203-205`; `components/ai-role-grid.tsx:79, 83-86`).
- Gerar: `useCreateDirectorJob` com `formato: "reels_conversion"` e `mandatorios` fixos (`:393-437`); sucesso → toast + `/videos`. Sem Replicate conectado e modelo Replicate escolhido, o CTA vira "Conectar Replicate" dentro do portão (`:753-757`, `generation-gate.tsx:317-321`) — não sai do fluxo.

**QUEBRADO**
- O hub marca "Padrão Seedance 2.0", mas o Diretor abre com `selection.a = initialModelId` apenas se o id existir na lista do catálogo (`:240, 269-281`); se não existir, a "Recomendada" do Gate assume por regra própria (`generation-gate.ts:368-392`) sem avisar que o modelo do hub caiu. O motivo da recomendação (`ENGINE_REASON` "Mesmo rosto em todas as cenas." / "Preço conhecido por segundo.", `generation-gate.ts:66-69`) **nunca aparece em tela** (grep: usado só dentro de `recommendEngine`).
- Exemplo do ladrilho = Kling 4.0 (`hub-examples.ts:33-39`); padrão = Seedance 2.0. A pessoa vê um e recebe outro.
- Rótulos técnicos: "Teto de créditos", "cenas do Replicate não entram no teto", "ab", "720p/1080p/4k" com preço, "reels_conversion" implícito.

**NÃO VERIFICADO**: se as linhas `video_models.experience` existem no banco da instância (o hook cai para o plano hard-coded quando a coluna falta, `use-hub-models.ts:98-131`).

### 2.2 idea/photo → presenter · "Vídeo comigo nas cenas" (Diretor)

**CONFIRMADO**
- Hub: `lib/video-hub.ts:221-232` (padrão Kling 4.0 Replicate, top Cinema Studio 4.0 Higgsfield "créditos Higgsfield"); `note` "Exige um apresentador com foto." + link "Cadastrar um apresentador" para `/marca/avatares` quando nenhum tem rosto (`video-hub.tsx:73-77, 189-202`) — **sai do fluxo** (R3). `options`: "…O Higgsfield mantém o rosto; no Replicate o rosto vem só do quadro." (`:218-219`). Na aba "Minha foto" a mesma rota com `line` "Seu apresentador nas cenas, com a narração da marca." (`:384`).
- Formulário = 2.1 + passo "Apresentador" (`AvatarPicker`, `novo.tsx:980-1071`): crachás `PresenterTile` só de quem tem rosto, auto-seleciona o padrão, botão "Novo apresentador" abre `NewAvatarDialog` no lugar (não sai), aviso "Primeira vez com X: o Higgsfield prepara o rosto…" (`:1052-1057`). Sem nenhum: "Nenhum apresentador com foto ainda. Abrir Apresentadores" (link, sai do fluxo, `:1021-1032`).

**QUEBRADO**
- Três respostas para "qual modelo": hub padrão Kling 4.0 (Replicate); ladrilho mostra exemplo Higgsfield Seedance 2.5 (`hub-examples.ts:40-45`); o Gate recomenda **Higgsfield** sempre que há apresentador (`generation-gate.ts:161-163`). A nota do hub diz que no Replicate "o rosto vem só do quadro" — ou seja, o padrão sugerido é o pior para a promessa da rota.

### 2.3 idea → avatar · "Um avatar apresenta o roteiro" (HeyGen)

**CONFIRMADO**
- Hub: `lib/video-hub.ts:234-261`. Avatar IV padrão, Avatar V top, ambos "preço a confirmar · 3–8 min" (`HEYGEN_PRICE`, `:203`). `note`: "Avatar V só nos avatares que aceitam esse motor."
- Estúdio `AvatarScriptStudio` (`components/video/heygen-studios.tsx:245-495`):
  1. `EngineLine` (`avatars/avatar-builder.tsx:107-123`): nada quando pronto; "Chega no próximo deploy do motor." ou mensagem + "Conectar HeyGen" (modal, não sai).
  2. Faixa fixa do escolhido com **Voz** (`ChosenRail` + `StudioVoice`, `:372-386, 688-730`): opções "Voz do apresentador" / "Voz do avatar" / "Voz da marca" + grupo "Vozes clonadas na HeyGen" + "Criar voz…".
  3. **"Quem apresenta"** (`:387-458`): chips Biblioteca / Meus avatares, botão "Criar avatar" (dialog), grade de `LookTile` com selo "Avatar V" quando a look aceita (`:512-516`), "Ver mais". Vazio: "Nenhum avatar seu na HeyGen ainda. Crie um em “Minha foto vira apresentador” ou “Meu clone”." (`:424`). `engineNote`: "X não aceita Avatar V: vai em Avatar IV." (`:321-327, 457`).
  4. **"O que você quer produzir"** (`:460-476`) = `RoteiroBrief` (`components/video/roteiro-brief.tsx`): sem conector → bloco "O roteiro é escrito pelo seu Claude… Conecte o Claude em Ajustes, em Conectores" + botão "Conectar o Claude" que **navega para `/config#conectores-title`** (`:112-134`). Com conector e campo vazio: textarea briefing (mín. 20, máx. 4.000, placeholder "A ideia do vídeo, para quem é, o que mostrar na tela e o que deve acontecer. Se for videoaula de um sistema, diga qual tela gravar e o que fazer nela.", `:194-201`), "Referências" (links, um por linha; "O seu Claude estuda cada um: cortes, zoom, tela dividida, textos, ritmo.", `:206-220`), botão "Criar roteiro com o seu Claude" + "Pela sua assinatura · sem custo extra" (`:222-228`). Pedido aberto → `AndamentoDoRoteiro` (trilha 7 etapas, frase do Claude, "há quanto tempo", Cancelar, `ConversaClaude`, `:257-424`). Entregue → roteiro cai no campo (`ScriptField`, 5.000 car., "≈ N s de fala", `heygen-studios.tsx:121-160`) + `PlanoResumo` ("Antes de gerar" / "Plano de produção", `roteiro-brief.tsx:427-515`) + "Pedir outro roteiro".
  5. `GenerateBar` (`:163-210`): `ModelRail` Avatar IV / Avatar V, `route.via`, `blocker` em texto ("Escolha quem apresenta." / "Escolha a voz." / "Escreva o roteiro."), botão **"Gerar vídeo"**.
- O que a tela NÃO diz: como escrever para o Avatar IV/V (tamanho ideal, pausas, pronúncia, idioma), que o avatar não faz gesto dirigido, nem o que muda de IV para V além do nome. O único "exemplo" é o placeholder "O que o avatar vai falar." (`:472`).
- Ajuda: o `ScriptField` embute `PromptField kind="script"` (regra "texto que um apresentador vai falar… gancho na primeira frase, frases curtas…", `prompts/prompt-assist.ts:24-26`) — via `llm.ts` (R1). Ou seja, **o mesmo campo tem o Claude pelo conector (roteiro) e o Gemini pelo gateway (Melhorar prompt)**, lado a lado.
- Gerar: `mode: "avatar_video"`, `look_id`, `script`, voz, `engine` conferido pela look, `aspect_ratio` do plano (`:343-365`), `plano` + `roteiro_pedido_id` seguem com o job. Toast + `/videos`.

**QUEBRADO**
- R2: não há linha "Estimativa"; o custo é "preço a confirmar" e não existe "Sem estimativa para este modelo" (o `GateEstimateLine` não é usado nos estúdios).
- R3: "Conectar o Claude" tira a pessoa da tela; `RoteiroBrief` só mostra o briefing quando `script` está vazio (`roteiro-brief.tsx:169`), então quem digitou uma palavra perde o caminho do Claude até apagar.
- O `blocker` mistura motor ("A HeyGen precisa estar pronta para gerar.") com preenchimento, no mesmo lugar e sem ação (`:329-341`).

### 2.4 idea → agent · "Só a ideia, vídeo pronto" (Video Agent, atrás de Mais opções)

**CONFIRMADO**
- Hub: `lib/video-hub.ts:263-281`: um modelo "Video Agent · preço a confirmar · 5–10× a duração"; `line` "Descreva o vídeo; o HeyGen escreve, monta e aplica a sua marca."; `via` "HeyGen Video Agent + Brand Kit do site".
- Estúdio `VideoAgentStudio` (`heygen-studios.tsx:1173-1255`): **"A ideia"** (`ScriptField` 10.000 car., `kind="video"`, sem "≈ s de fala", placeholder "ex.: um Reel de 30 s mostrando como a indústria cortou retrabalho sem contratar ninguém", `:1208-1216`); frase "A marca vai junto: cores e logo vêm do site cadastrado." (`:1217-1219`); **Voz** (`VoiceSelect` com "Voz escolhida pelo Video Agent" + clones HeyGen; outras marcadas "não vale no Video Agent", `:1220-1242`); `GenerateBar` ("Descreva o vídeo." como blocker, `:1189`). Envia `orientation: "portrait"`, `brand_kit: true` (`:1195-1202`).
- NÃO diz: que o Video Agent escreve o roteiro sozinho (então a "ideia" não é a fala), duração máxima, idioma, que o formato é vertical fixo, quanto tempo demora em minutos, custo em créditos.
- Ajuda: só "Melhorar prompt"/mic via `llm.ts` (R1). Sem Claude pelo conector.

**QUEBRADO**
- `useStudioModel(route, null)` (`:1175`) ignora o `?modelo=` do hub (inofensivo hoje, só um modelo, mas é a única rota que descarta a escolha).
- R2 não cumprida: sem Estimativa, sem motivo do padrão.

### 2.5 photo → photo_avatar · "Minha foto vira apresentador"

**CONFIRMADO**
- Hub: `lib/video-hub.ts:283-318`: `providers: []` (`:289`), padrão Avatar IV HeyGen; top P-Video 2 Pro Avatar (US$ 0,06/s em 1080p) e OmniHuman 1.5 (US$ 0,16/s · até 34 s), ambos Replicate `talking_avatar`. `via` "HeyGen (photo avatar) ou Replicate (avatar falante)".
- Estúdio `PhotoPresenterStudio` (`heygen-studios.tsx:878-1040`): **Apresentador** (`PresenterPicker`, só quem tem foto, auto-seleciona, "Novo apresentador" inline, `:989-1014`); via HeyGen: `HeygenPrepLine` ("Preparar" a foto) e `LookStrip` (visuais); faixa fixa com voz (HeyGen apenas); **Roteiro** (`ScriptField` 5.000, placeholder "O que o apresentador vai falar[, com a voz da marca]." `:1015-1029`); `GenerateBar` com `ModelRail` de 3 (`:1030-1036`).
- `blocker` (`:922-940`): "Chega no próximo deploy do motor." / "Nenhum modelo disponível para esta experiência." / "A HeyGen precisa estar pronta para gerar." / "Escolha o apresentador." / "Prepare a foto na HeyGen antes de gerar." / "Escolha a voz." / "Escreva o roteiro."
- NÃO diz: limite de 34 s do OmniHuman em segundos de fala (só no custo), que o P-Video não mexe o corpo, que a HeyGen precisa "preparar" a foto antes (aparece só como trava), o formato da fala.
- Ajuda: `PromptField kind="script"` via `llm.ts`. **Sem `RoteiroBrief`** — o Claude do conector só existe na rota `avatar`.
- Gerar via Replicate: `voice: { provider: "elevenlabs" }` fixo (`:961-966`); a faixa de voz some (`:972-987`) sem dizer que a voz passou a ser a da marca.

**QUEBRADO**
- R2 parcial: preço unitário no trilho, mas nenhum "até US$ X" para o roteiro digitado (o estúdio já calcula "≈ N s de fala" e não multiplica pelo preço/s).
- Trocar de modelo muda provedor **e** voz sem a pessoa perceber.

### 2.6 video → speech · "Mudar o que eu digo" (remake)

**CONFIRMADO**
- Hub: `lib/video-hub.ts:389-418`: `providers: ["heygen"]`; padrão **MiniMax 2.8 (Replicate tts, US$ 0,10/1k letras)**, top "ElevenLabs (voz da marca) · no plano ElevenLabs"; `via` "Voz nova + sincronia labial HeyGen (preço a confirmar)"; `options` "voz feminina, masculina, a sua voz (clone) ou qualquer Voice ID do ElevenLabs".
- `RemakeFlow` (`components/video/remake-flow.tsx`) com `initialOptions=["speech"]`:
  1. **Seu vídeo** (`VideoDrop`, `:1061-1165`): "Arraste o vídeo aqui… MP4 ou MOV, de 2 a 30 segundos[, até N MB]"; após subir: nome, "N segundos · MB", erro de duração/tamanho (`lib/remake-options.ts:101-108`), "Trocar vídeo".
  2. **Mudar o que eu digo** (título do passo 2 = `REMAKE_OPTION_COPY.speech.title`, `:915-918`) com a `line` "Fala nova com a boca sincronizada. Voz ElevenLabs, boca HeyGen · até 600 caracteres." (`remake-options.ts:45-46`). Campo **Fala nova** (`Textarea`, 600 car., placeholder "Escreva o que a pessoa vai dizer no vídeo.", `:773-781`) com a linha de ajuste: "Para N s de vídeo, escreva ~N×15 caracteres." / "Cabe no vídeo…" / "Longa demais… Corte para ~X caracteres." / "Curta…" / modo **foto que fala** ("…vamos usar um quadro do seu vídeo como foto que fala", `:782-803`, `:388-393`). **Voz** (chips Voz feminina / masculina / A minha voz (do vídeo) / Outra voz, `:117-122, 563-575`); "Outra voz" → `VoiceSelect` de Marca → Vozes ou "Colar um Voice ID do ElevenLabs" (input mono, instrução "No ElevenLabs: Voices → escolha a voz → copie o ID…", `:577-619`); "A minha voz" → conferência do plano ElevenLabs ("Seu plano do ElevenLabs não clona voz… assine o Starter" + link externo, `:621-636`), "A pessoa do vídeo é: Mulher / Homem", aviso sobre amostra < 15 s (`:637-663`). Para feminina/masculina: `GateOptionList` "Voz da fala nova" com base "N letras" (`:664-682`). "Adicionar outra melhoria" (`:930-955`).
  3. **Custo e confirmação** (`:975-1040`): checkbox "Tenho autorização das pessoas que aparecem no vídeo…", frase `blocker` ou "Leva alguns minutos e roda em segundo plano.", `GateEstimateLine` (soma do catálogo; ElevenLabs/HeyGen "cobra à parte", `:428-475`) e botão **"Melhorar vídeo"** (ou "Conectar X" quando falta só uma integração, `:1016-1021`).
- Ajuda de escrita: **nenhuma** — `Textarea` puro, sem `PromptTools`, sem mic, sem Claude (grep: `remake-flow.tsx` não importa `prompt-tools`).
- Gerar: `useCreateDirectorJob` com `config.mode = "remake"`, `brief.objetivo = remakeSummary(...)`, `formato: "remake"` (`:497-556`); toast "Melhorando o seu vídeo" + `/videos`.

**QUEBRADO**
- Hub exige HeyGen conectada para Continuar; o remake funciona sem HeyGen quando há `lipsync_post` ativo no Replicate e a fala cabe (`:369-373`, `remake-options.ts:186-199`). A pessoa é barrada no hub por uma integração que o destino dispensa.
- Hub padrão = MiniMax 2.8; a lista do remake recomenda ElevenLabs por regra (`VOICE_RULE`, `:106, 326-332`), e a lista só aparece se a pessoa escolher "Voz feminina/masculina"; `initialModelId` entra em `ttsModelId` (`:220-222`) mas é ignorado nas outras três escolhas de voz.
- Exemplo do ladrilho: Replicate "Lipsync Precision" (`hub-examples.ts:75-81`) — provedor e modelo que não aparecem em lugar nenhum da rota.
- "Voice ID", "Starter", "Scribe" são rótulos técnicos; "assine o Starter" leva para fora.

### 2.7 video → translate · "Traduzir meu vídeo"

**CONFIRMADO**: hub `lib/video-hub.ts:419-436` (Tradução HeyGen, "preço a confirmar · 5–10 min"). Remake: Idioma (Inglês, Espanhol, Francês, Italiano, Alemão, `remake-options.ts:92-98`; chips `:808-818`), "Idioma do vídeo" (Português/Inglês/Espanhol, `:146-150`, só se legendas desligadas `:820`), autorização, Estimativa "cobrado à parte: HeyGen", "Melhorar vídeo". `line`: "O mesmo vídeo em outro idioma, com voz e boca. HeyGen · 5 idiomas." (`remake-options.ts:49-50`).
**R2**: não cumpre (sem seletor, sem valor). **Ajuda**: n/a. **Onde quebra**: nada explica por que só 5 idiomas, nem que a voz clonada sai da HeyGen e não da ElevenLabs.

### 2.8 video → style · "Mudar o estilo"

**CONFIRMADO**: hub `lib/video-hub.ts:437-446` com `V2V_MODELS` (`:181-200`): padrão **"Kling 4.0 (edição)" US$ 0,141/s em 1080p**, top Aleph 2 US$ 0,336/s; `providers: []`. Remake: chips Estilo da minha marca / Cinema / Anime / Massinha / Quadrinhos / Pixel art (`remake-options.ts:83-90`; `:706-716`); `GateOptionList` "Estilo e cenário" (`:990-1005`) com nota só para Aleph 2 ("Muda estilo, cena ou pessoa mantendo fala, gesto e câmera.", `model-notes.ts:21`); estimativa "N s de vídeo"; consentimento; "Melhorar vídeo". `initialModelId` → `sceneModelId` (`:217-219`).
**R2**: cumpre. **Ajuda**: n/a (sem texto livre).
**QUEBRADO**: a cópia do passo 2 diz "Visual novo, mesma fala e gestos. **Runway Aleph (Replicate)** · até 30 s e 16 MB" (`remake-options.ts:33-34`) enquanto o hub acabou de marcar Kling 4.0 como padrão; o ladrilho mostra exemplo Aleph 2 (`hub-examples.ts:89-95`). O limite "16 MB" é do Aleph (`sizeLimit`, `remake-options.ts:119-129`) e é aplicado mesmo com Kling escolhido.

### 2.9 video → scene · "Mudar o cenário" (Mais opções)

**CONFIRMADO**: hub `lib/video-hub.ts:465-475` (mesmos modelos de style, `more: true`). Remake: `Input` "O que mudar no cenário" (200 car., placeholder "Ex.: num escritório moderno, com luz de fim de tarde", `:720-729`), mesma lista "Estilo e cenário". `line`: "Troque o lugar, a roupa ou a luz. Runway Aleph (Replicate) · até 30 s e 16 MB." (`remake-options.ts:37-38`).
**Ajuda**: **nenhuma** (Input puro). É o campo de prompt mais sensível ao modelo (Aleph/Kling v2v entendem instruções visuais curtas) e é o que menos ajuda tem.
**QUEBRADO**: igual a style (Kling × Aleph). 200 caracteres sem dizer que o modelo quer uma frase visual, não uma história.

### 2.10 video → character · "Trocar a pessoa" (Mais opções)

**CONFIRMADO**: hub `lib/video-hub.ts:476-496` (P-Video Replace US$ 0,06/s em 1080p; `options` "escolha o apresentador e, se quiser, diga como ele deve ficar"). Remake: chips de apresentador com foto (`:734-745`); "Vão N fotos de X como referência (P-Video Replace aceita até M)." (`:746-751`); `Input` "Como a pessoa deve ficar (opcional)" (500 car., placeholder "Ex.: mantenha os óculos e a camisa azul", `:752-762`); vazio → "Nenhum apresentador com foto ainda. Cadastre um em Apresentadores e volte aqui." (`:766-768`, sai do fluxo). Sem lista de modelos: usa o primário do catálogo (`:235-237`); preço por segundo calculado na Estimativa (`:446-454`); trava "Nenhum modelo de troca de pessoa ativo: ative o P-Video Replace em Config → Integrações → Replicate." (`:421`).
**R2**: parcial (valor sim, escolha não). **Ajuda**: nenhuma.

### 2.11 video → captions · "Legendas da marca"

**CONFIRMADO**: hub `lib/video-hub.ts:447-464` (`providers: ["higgsfield"]`, modelo "Scribe v2 · centavos · 1–2 min" ElevenLabs). Remake: chips de estilo (7, só o nome antes do "—", `:826-835`), "Destaque na cor da marca, embaixo do vídeo." com bolinha da cor (`:837-846`), "Idioma do vídeo" (`:686-700`), Estimativa "US$ 0,00 · sem cena nova: só a montagem" (`:470`). Exige ElevenLabs + Higgsfield (`remake-options.ts:202-205`).
**R2**: não cumpre (sem seletor; custo "centavos" no hub vs "US$ 0,00" no destino). **QUEBRADO**: exemplo do ladrilho é HeyGen "Legendas" (`hub-examples.ts:103-109`); a rota não usa HeyGen.

### 2.12 video → reframe · "Reenquadrar e melhorar" (Mais opções)

**CONFIRMADO**: `STUDIO_READY.reframe = false` (`lib/video-hub.ts:92`); hub mostra "Chega no próximo deploy." e Continuar desligado (`video-hub.tsx:218-230`); se chegar por `?rota=reframe`, `ReframeStudio` mostra "Chega no próximo deploy. Você vai subir o vídeo, escolher o formato final (9:16 já marcado) e ligar “Mais nitidez”." + Gerar desligado (`heygen-studios.tsx:1257-1273`).
**QUEBRADO**: ladrilho com exemplo Replicate "Luma Reframe" (`hub-examples.ts:110-116`) para uma rota "Higgsfield (reframe + upscale)". Ocupa um ladrilho inteiro para dizer que não existe.

### 2.13 video → twin · "Meu clone" (Mais opções; não estava na lista do prompt, está em `HUB_ROUTES.video`, `lib/video-hub.ts:497`)

**CONFIRMADO**: `TwinStudio` (`heygen-studios.tsx:1042-1171`): "De quem é o clone" (todos os apresentadores), "Seu vídeo" (`TwinUpload`, 15–600 s, consentimento, `avatar-builder.tsx:127-129`), "Clone" (status + "Novo vídeo"), **Roteiro só depois de `ref.ready`** (`:1148-1160`, placeholder "O que o seu clone vai falar."), voz "A minha voz (clonada)" / "Voz da marca"; `ModelRail` Avatar IV/V "preço a confirmar". `PromptField kind="script"` (R1). Sem `RoteiroBrief`.

---

## 3. Transversais

### 3.1 Seletor + custo (R2) — placar
- **Cumpre**: scenes, presenter (Diretor, `GenerationGate`), style, scene (remake, `GateOptionList` + `GateEstimateLine`).
- **Parcial**: photo_avatar (trilho com preço unitário, sem total), speech (lista só para 2 das 4 vozes; resto "cobra à parte"), character (valor sem escolha).
- **Não cumpre**: avatar, agent, twin, translate, captions, reframe. Nos estúdios HeyGen o padrão é marcado sem motivo e o rodapé é `label · preço a confirmar · tempo` (`heygen-studios.tsx:185-192`); a linha "Estimativa" com "Sem estimativa para este modelo" (`gate-estimate-line.tsx:148-153`) existe como componente e **não é usada** em nenhum estúdio.
- O selo "Padrão" do `ModelRail` é posicional (índice 0, `video-hub.tsx:281-283`): se o catálogo devolver outra ordem, o rótulo muda de modelo sem motivo visível.

### 3.2 Ajuda de escrita — onde está e por qual caminho
| Campo | Componente | `PromptKind` | Caminho | Marca entra? |
|---|---|---|---|---|
| Diretor · Tema | `PromptField` `novo.tsx:450-458` | `video` | edge `prompt-assist` → `_shared/llm.ts` (gateway/OpenAI/xAI) **R1 DÍVIDA** | persona + estratégia (`prompt-assist/index.ts:113-121`) |
| Diretor · "Montar o briefing" | botão `novo.tsx:460-477` | — | edge `video-brief` → `_shared/llm.ts` **R1 DÍVIDA** | persona + estratégia + material (`video-brief/index.ts:74-100`) |
| Avatar · briefing/Referências | `roteiro-brief.tsx:194-220` | — | `roteiro-pedido` → `roteiro_pedidos` → rotina do Claude → conector **R1 OK** | o Claude lê `marca_ler` (NÃO VERIFICADO aqui; a tela só manda briefing + links, `roteiro-brief.tsx:92-104`) |
| Avatar/Foto/Clone · Roteiro | `ScriptField` → `PromptField` `heygen-studios.tsx:145-153` | `script` | `llm.ts` **R1 DÍVIDA** | persona + estratégia |
| Agente · A ideia | idem, `seconds=false` | `video` | `llm.ts` **R1 DÍVIDA** | idem |
| Remake · Fala nova / cenário / como a pessoa fica | `Textarea`/`Input` puros | — | **nenhuma ajuda** | — |
| Pós-geração · corrigir cena | `scene-edit.tsx:152-160` | `scene` | `llm.ts` **R1 DÍVIDA** | idem |
| Pós-geração · Editar com Claude | `polish-strip.tsx` RequestComposer (`PromptField kind="scene"`) | `scene` | pedido vai pelo conector (`polish-strip.tsx:34-37`), mas o botão "Melhorar prompt" do mesmo campo vai por `llm.ts` | — |
- Microfone: sempre `ELEVEN_API_KEY` (Scribe v2 pela edge, `prompt-tools.tsx:29-30, 114`); sem chave, abre o modal da ElevenLabs.
- O rodapé de todo `PromptField` imprime "Scribe v2 · Gemini 2.5 Pro · Sem estimativa para este modelo" (`prompt-tools.tsx:203-205` + `ai-role-grid.tsx:83-86`) — nomeia o Gemini como o modelo de escrita, em todas as telas de vídeo (R1 + rótulo técnico).
- Nenhum `PromptKind` é por modelo de vídeo: `script` serve igual para Avatar IV, Avatar V, OmniHuman, P-Video e clone; `video` serve igual para o roteirista do Diretor (Seedance/Kling/Veo) e para o Video Agent. A "regra do modelo" não existe no prompt-assist (`prompts/prompt-assist.ts:14-31` só tem 5 regras por tipo de campo).

### 3.3 Caminho do Gerar e saídas do fluxo (R3)
- Todos os Gerar terminam com toast + redirect para `/videos`; a pessoa perde a tela e tem que achar a capa na galeria. Só o setup (`onCreated`) fica no lugar (`remake-flow.tsx:549`).
- Saem do fluxo: "Cadastrar um apresentador" (hub → `/marca/avatares`), "Abrir Apresentadores" (Diretor), "Conectar o Claude" (→ `/config`), "Cadastre um em Apresentadores e volte aqui" (remake character), "Ver planos do ElevenLabs" / "assine o Starter" (externo), "ative o P-Video Replace em Config → Integrações → Replicate" (texto sem botão). Ficam no lugar: todos os "Conectar {provedor}" (modal), "Novo apresentador", "Criar avatar", "Criar voz…".
- Sem provedor: hub desliga Continuar e mostra "Falta conectar X"; Diretor troca o portão por "Conecte o Higgsfield"; remake troca o CTA por "Conectar X" só quando falta **uma** integração (`remake-flow.tsx:1016-1021`) — faltando duas, o botão fica desligado e o motivo vai para a frase cinza.

### 3.4 Campos mortos, rótulos técnicos, explicação em vez de mostrar, CTA duplicado
- Mortos/invisíveis: `ENGINE_REASON` (`generation-gate.ts:66-69`, nunca renderizado); `route.providers: []` em photo_avatar/style/scene/character (a checagem "Falta conectar" só vê o provedor do modelo); `initialModelId` ignorado no Video Agent (`heygen-studios.tsx:1175`) e no setup (`step-create.tsx:374`); `brief.objetivo/publico/tom` do Diretor só entram como contexto e vêm com defaults em inglês ("Reel B2B case-study", `novo.tsx:126`).
- Rótulos técnicos na tela: "Teto de créditos", "cenas do Replicate não entram no teto", "720p/1080p/4k", "Voice ID", "Scribe v2", "Gemini 2.5 Pro", "Avatar IV/V", "P-Video Replace", "lipsync", "Brand Kit", "Video Agent", "preço a confirmar", "em breve", "Chega no próximo deploy (do motor)".
- Explica em vez de mostrar: `route.options` ("No próximo passo: …") e `route.via` são parágrafos cinza sob o trilho (`video-hub.tsx:185-188`); "Vale só para o Higgsfield…" (`novo.tsx:684-690`); o `PlanoResumo` é um `<details>` de texto (`roteiro-brief.tsx:464-513`).
- CTA duplicado/competição: no Diretor, "Montar o briefing" (primário) × "Preencher à mão" × "Gerar vídeo"; no estúdio de avatar, "Criar roteiro com o seu Claude" × campo de roteiro com "Melhorar prompt" × "Gerar vídeo"; no hub, "Continuar" + três links/botões de conectar.
- Hub × destino: ver tabela (Kling × Aleph; Seedance × Kling × Higgsfield; HeyGen obrigatória × lipsync Replicate; exemplos de outro provedor em 6 das 13 experiências: scenes, presenter_in_scenes, change_speech, captions, reframe_upscale, restyle).

---

## 4. Os 10 problemas mais graves (ordem de impacto)

1. **A "regra do modelo" não existe em tela nem no prompt-assist**: `PromptKind` tem 5 tipos por campo, nenhum por modelo (`lib/prompt-assist.ts:6`, `prompts/prompt-assist.ts:14-31`); `ModelRail` mostra só custo·tempo (`video-hub.tsx:295`); `MODEL_NOTES` cobre 1 frase e não cobre os "top" do hub (Kling 4.0, Veo 3.1, Seedance 2.5, CS 4.0, Avatar IV/V, Video Agent, OmniHuman, P-Video) (`model-notes.ts:10-31`).
2. **R1 violada em todo campo de vídeo**: "Melhorar prompt" (`prompt-tools.tsx:126-139` → `prompt-assist/index.ts:17` → `_shared/llm.ts`) e "Montar o briefing" (`video-brief/index.ts:15`) usam gateway/OpenAI/xAI, e o rodapé imprime "Gemini 2.5 Pro" (`prompt-tools.tsx:203-205`).
3. **O Claude pelo conector só existe na rota `avatar`** (`heygen-studios.tsx:461`); foto, clone, agente, Diretor e remake não têm `RoteiroBrief` nem pedido na fila.
4. **R2 falha em 6 rotas** (avatar, agent, twin, translate, captions, reframe): sem "Estimativa", sem motivo do padrão; `GateEstimateLine` nunca é usado nos estúdios HeyGen (`heygen-studios.tsx:163-210`).
5. **Hub promete um modelo, destino abre outro**: style/scene (hub Kling 4.0 (edição) `video-hub.ts:181-189` × cópia "Runway Aleph" `remake-options.ts:34`); presenter (hub Kling Replicate × Gate recomenda Higgsfield `generation-gate.ts:161-163`); scenes (hub Seedance 2.0 × Recomendado por regra própria, sem aviso quando o id do hub não está no catálogo, `novo.tsx:240, 269-281`).
6. **Exemplos do ladrilho são de outro provedor/modelo em 6 experiências** (`hub-examples.ts:33-45, 75-81, 89-95, 103-116`).
7. **Speech: o hub barra sem HeyGen; o remake funciona sem HeyGen** (`video-hub.ts:395` × `remake-flow.tsx:369-373`); padrão MiniMax no hub × ElevenLabs preferido no remake (`VOICE_RULE`).
8. **Remake não tem nenhuma ajuda de escrita** (Fala nova, cenário, "como a pessoa deve ficar" são `Textarea`/`Input` puros) — justamente onde o formato do prompt é mais específico do modelo (Aleph/Kling v2v).
9. **Saídas do fluxo (R3)**: "Conectar o Claude" → `/config` (`roteiro-brief.tsx:129`), "Cadastrar um apresentador" → `/marca/avatares` (`video-hub.tsx:193-199`), "Cadastre um em Apresentadores e volte aqui" (`remake-flow.tsx:767`), links externos ElevenLabs; e todo Gerar manda para `/videos` sem levar à capa do job.
10. **Setup contradiz o hub**: no onboarding a rota director vira sempre "presenter" e descarta o modelo (`step-create.tsx:367-369`); o remake inline não recebe `initialModelId` (`:374`); estúdios HeyGen tiram a pessoa do setup (`:359-363`).

Bônus (menor): rótulos técnicos espalhados (Teto de créditos, Voice ID, 720p, "Chega no próximo deploy do motor"), `ENGINE_REASON` morto, selo "Padrão" posicional, Video Agent ignora `?modelo=`, reframe ocupa ladrilho só para dizer que não existe.
