# 07 · Produto/UI/UX — o padrão de tela da ferramenta do hub

Repo lido: `/Users/samuelfadanelli/Developer/subido-redes-sociais` (main d63f465), 04/11/2026, nada alterado. Base: 00-briefing, 01-eng-front, 02-eng-motor, 03-eng-claude, AGENTS.md (global e do repo), `docs/design-system-subido.md`, skill `design-system-subido` (03-componentes, 04-telas, 06-copy). Caminhos relativos a `src/` salvo indicação.

Separação usada: **DESENHO** (decisão de produto, cabe ao front) · **PEDE MOTOR/CLAUDE** (a tela só fica certa se a camada de baixo mudar; aponta o relatório que detalha) · **NÃO VERIFICADO**.

---

## 0. As quatro decisões que valem para as 13 ferramentas

1. **Uma ferramenta = uma tela com quatro blocos fixos, na mesma ordem**: *O que esta ferramenta faz* → *Quem faz* (modelo) → *O que você precisa dar* (campos) → *Recibo* (estimativa + o único botão). O que varia por experiência e por modelo é só o conteúdo dos campos e as frases. A pessoa aprende a tela uma vez.
2. **O modelo é escolhido uma vez, na ferramenta, antes dos campos.** O trilho do hub (`video-hub.tsx:180-184`) sai: o ladrilho do hub só diz "Padrão X · a partir de US$ Y"; "Continuar" abre a ferramenta com o recomendado marcado. Fonte única = acaba a classe de defeito "hub promete X, destino abre Y" (01 §4.5). Os campos leem o modelo marcado (limite, voz, formato) e o recibo repete o nome dele ao lado do preço.
3. **Todo campo de texto tem o mesmo controle**: microfone · **Escrever com o seu Claude** · contador em unidade humana. Nunca "Melhorar prompt", nunca outro modelo de escrita. O pedido é assíncrono, o campo nunca trava, a pessoa pode sair e o sino avisa.
4. **Toda trava tem a saída no lugar**: provedor → modal da integração; apresentador → diálogo de cadastro; Claude → modal do conector. Nenhum link para `/config`, `/marca/avatares` ou site externo como única saída. Recurso que não existe não aparece (DS M18): o ladrilho "Reenquadrar" some até o motor existir.

Sem card: os blocos são separados por filetes (`border-t border-[var(--via-border-soft)]`), as opções de modelo são linhas de lista (`GateOptionList`), o andamento do Claude é a faixa com fio navy à esquerda (`border-l-2`, já usada em `roteiro-brief.tsx:115,326`), o recibo é a `GateEstimateLine`. Nenhum contêiner genérico novo.

---

## 1. Anatomia da tela da ferramenta

### 1.1 Desktop (uma coluna, `max-w-[720px]`, dentro do `max-w-6xl` da página)

```
VÍDEOS                                                          ← eyebrow do grupo (PageEyebrow, já existe)
Novo vídeo                                                      ← título da página (já existe)
← Mudar o que quero fazer                                       ← volta ao hub (já existe, novo.tsx:178-185)

Um avatar apresenta o roteiro                                   ← h2, 20px/500, = route.label
Um apresentador da HeyGen, ou um seu, fala o texto olhando      ← FAZ · 14px, text-body
para a câmera.
Não muda de cenário nem mostra outras imagens.                  ← NÃO FAZ · 14px, text-muted
────────────────────────────────────────────────────────────────
Quem faz                                        Estimativa para 1 min de fala
◉ [H] Avatar IV   recomendado                   sem estimativa
     Preço conhecido só na sua conta HeyGen; pronto em 3 a 8 min.
○ [H] Avatar V                                   sem estimativa
     Mais expressão no rosto; só nos apresentadores que aceitam.
────────────────────────────────────────────────────────────────
Quem apresenta
[ Biblioteca ] [ Meus avatares ]        Criar avatar            ← chips + ação secundária (texto)
┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                               ← grade de LookTile/PresenterTile (já existe)
│ ✓  │ │    │ │    │ │    │ │    │
└────┘ └────┘ └────┘ └────┘ └────┘
Voz   ( Voz do apresentador | Voz da marca | Outra )            ← segmentado, 1 linha; "Ouvir" ao lado

O que ele fala
┌──────────────────────────────────────────────────────────────┐
│ Escreva do seu jeito, ou só a ideia. O seu Claude            │
│ transforma no texto que este modelo precisa.                 │
│                                                              │
│ 🎙  ✦ Escrever com o seu Claude   + referência               │
└──────────────────────────────────────────────────────────────┘
0 / 5.000 letras · cabe até 5 min de fala                      ← contador em unidade humana
────────────────────────────────────────────────────────────────
Estimativa                                 Sem estimativa para este modelo    [ ▶ Gerar vídeo ]
Avatar IV · cobrado na sua conta HeyGen, em créditos · pronto em 3 a 8 min
```

### 1.2 Celular (≤ 640px)

```
← Mudar o que quero fazer
Um avatar apresenta o roteiro
Um apresentador da HeyGen, ou um seu, fala o
texto olhando para a câmera.
Não muda de cenário nem mostra outras imagens.
──────────────────────────────
Quem faz
◉ [H] Avatar IV  recomendado
   Preço só na sua conta HeyGen · 3 a 8 min
○ [H] Avatar V
   Mais expressão no rosto; só nos que aceitam.
──────────────────────────────
Quem apresenta
[Biblioteca] [Meus avatares]   Criar avatar
┌───┐ ┌───┐ ┌───┐  →  (rolagem horizontal)
Voz  (Apresentador | Marca | Outra)

O que ele fala
┌────────────────────────────┐
│ …                          │
│ 🎙 ✦ Escrever com o seu    │
│      Claude                │
└────────────────────────────┘
0 / 5.000 letras · até 5 min de fala
──────────────────────────────
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ← recibo FIXO no rodapé (sticky, fundo branco, filete em cima)
Sem estimativa · Avatar IV
[      ▶ Gerar vídeo        ]
```

Regra do rodapé fixo: só no celular; mostra valor (ou "Sem estimativa") + nome do modelo em 13px e o botão `size="lg"` largura total. A linha completa do recibo (depende de…) fica no fim da rolagem, antes do rodapé.

### 1.3 O que é fixo e o que varia

| Bloco | Fixo (igual nas 13) | Varia |
|---|---|---|
| Cabeçalho | h2 = `route.label`; 2 frases (faz / não faz); sem ícone, sem logo | as frases (§5) |
| Quem faz | `GateOptionList` com até 3 linhas visíveis + "Ver todas (N)"; 1ª = recomendado com motivo; preço à direita; sublinha = diferença + tempo | as linhas (catálogo por `experience`), se há "comparar" (nunca na ferramenta; só admin em Ajustes) |
| Campos | ordem: quem aparece/vídeo → ajustes de 1 toque (voz, idioma, estilo, duração) → texto; rótulo 14px/500 acima; ajuda 13px abaixo só quando muda a decisão | quais campos (§5) e o limite, que vem do modelo marcado |
| Recibo | `GateEstimateLine` + botão `size="lg"`; linha "depende de" nomeia o modelo | rótulo do botão (2 valores, §5), valor, estado |
| Depois de Gerar | a tela fica: campos recolhem em resumo de 1 linha cada; recibo vira "Na fila · pronto em 3 a 8 min · avisamos pelo sino" + texto "Ver em Vídeos" + ghost "Fazer outro" | — |

Textos fixos do padrão (exatos):
- Rótulo do bloco de modelo: **"Quem faz"**. Base da estimativa à direita: **"Estimativa para {base}"** (ex.: "1 min de fala", "30 s de vídeo", "45 s de cenas").
- Selos: **recomendado** · **mais barato** · **melhor imagem** (pill minúscula do kit; troca "Melhor qualidade" por "melhor imagem", que o leigo entende). Nunca "Padrão", "Top", "em breve", "default".
- Rótulo do campo de texto por experiência (§5). Placeholder único em todas: **"Escreva do seu jeito, ou só a ideia. O seu Claude transforma no texto que este modelo precisa."**
- Contador: **"{n} / {max} letras · cabe até {tempo}"** quando o texto vira fala; **"{n} / {max} letras"** quando não vira.
- Recibo: **"Estimativa"** / valor **"até US$ X"** ou **"Sem estimativa para este modelo"** / linha de baixo **"{Modelo} · {de que depende} · pronto em {tempo}"**.
- Botões: **"Gerar vídeo"** (ferramentas que criam) e **"Gerar nova versão"** (ferramentas que mexem num vídeo seu). Só esses dois.
- Linha de espera depois do clique: **"Na fila · pronto em {tempo} · avisamos pelo sino."**

Nada da lista a seguir aparece em tela: Voice ID, 720p/1080p/4k, Teto de créditos, Brand Kit, Video Agent (como rótulo técnico; o nome do modelo HeyGen vale só na linha do modelo), Scribe, Gemini, lipsync, deploy, motor, catálogo, "preço a confirmar", "em breve", "conferindo o motor".

---

## 2. O bloco "Quem faz" (modelo)

### 2.1 Estrutura de uma linha (reusa `GateOptionList`, `generation-gate.tsx:79-275`)

```
◉ [logo] Seedance 2.0   recomendado                                   até US$ 3,36
         Mantém o mesmo rosto em todas as cenas e tem preço por segundo; pronto em 10 a 20 min.
○ [logo] Kling 4.0                                                    até US$ 2,90
         Movimento mais solto; o rosto pode variar entre cenas; pronto em 10 a 20 min.
○ [logo] Veo 3.1                                                      até US$ 3,80
         Imagem mais rica; cobra em blocos de 4, 6 ou 8 s (fala de 7 s paga 8).
Ver todas as 9 opções
```

Regras:
- **Nome do modelo é o do provedor** (é o que aparece na fatura dela) com o logo oficial (`BrandIcon`) — a regra do DS "toda ferramenta com logo". O que faz a pessoa decidir é a **sublinha**, não o nome: uma frase de *diferença em relação ao recomendado*, que faça sentido sem saber o que é Kling. Padrão da frase: `{o que ganha ou perde}; {o que isso custa ou demora}`. Máximo ~90 caracteres.
- **Recomendado = 1ª linha, sempre com motivo.** O motivo é a primeira oração da sublinha ("Mantém o mesmo rosto…", "Preço conhecido por segundo", "Aceita a sua foto sem preparo"). O texto de `ENGINE_REASON` (`lib/generation-gate.ts:66-69`), hoje morto, vira esse motivo. O selo nunca é posicional (`video-hub.tsx:281-283`): vem de uma regra por experiência que o catálogo entrega.
- **Até 3 linhas visíveis** (recomendado + 2), o resto em "Ver todas as N opções". Opção que o destino não roda ou cujo motor não existe **não aparece** (nem "em breve", nem desligada).
- **Preço à direita, em três formas, nunca ausente**:
  - base conhecida (texto escrito, vídeo carregado, duração marcada): **"até US$ 3,36"** (mono, tabular);
  - base ainda não conhecida: **"US$ 0,18 por segundo"** (ou "por letra", "por imagem") em 13px muted;
  - sem preço no catálogo: **"sem estimativa"** em 13px muted.
- **Trocar o modelo recalcula o limite do campo na hora** e, se o texto já escrito passar do novo limite, o contador fica coral e o recibo bloqueia com motivo (§3.6). Trocar provedor que troca a voz (foto → Replicate usa a voz da marca, `heygen-studios.tsx:961-966`) escreve isso na sublinha da opção: "Usa a voz da marca (ElevenLabs)". Nunca em silêncio.
- Opção com provedor desconectado: linha em 60% com `StatusDot off` + botão outline "Conectar HeyGen" (já existe em `generation-gate.tsx:187-203`); clicar abre o modal, a linha acende quando a chave entra. Não some.

### 2.2 Sem preço: HeyGen, Higgsfield, ElevenLabs

A regra 2 diz "nunca sumir a linha". A linha existe; o que muda é o que se mostra como número honesto:

| Caso | Na linha da opção | No recibo (valor) | No recibo (linha de baixo) |
|---|---|---|---|
| HeyGen (Avatar IV/V, foto, clone, Video Agent, tradução, lipsync) | "sem estimativa" | **Sem estimativa para este modelo** | "Avatar IV · cobrado na sua conta HeyGen, em créditos · pronto em 3 a 8 min" |
| Higgsfield (Cinema Studio 3.0, Seedance 2.5) | "créditos Higgsfield" | **Sem estimativa para este modelo** · se o saldo existir: **"Você tem 1.240 créditos"** no lugar | "Cinema Studio 3.0 · desconta dos seus créditos Higgsfield · pronto em 10 a 20 min" |
| ElevenLabs (voz da marca) | "no seu plano ElevenLabs" | o valor das outras partes, se houver (ex.: "até US$ 1,80") | "Voz da marca no seu plano ElevenLabs; o resto estimado acima" |
| Misto (Replicate com preço + HeyGen sem) | cada linha com o seu | **até US$ 1,80** | "Mais a parte HeyGen, cobrada na sua conta" (hoje `note` "cobra à parte", `remake-flow.tsx:428-475`; manter) |

PEDE MOTOR: o saldo Higgsfield existe só no servidor (02 §2.5, `director-advance:1275-1282`); para aparecer no recibo precisa de uma leitura sem custo pela tela. Enquanto não houver, fica "Sem estimativa para este modelo". OmniHuman: a tela tem de ler o limite do catálogo (15 s, 02 #7), não a frase fixa do hub (34 s).

### 2.3 Regra de nome e frase por modelo (dado, não código)

As frases de diferença e o motivo do recomendado nascem **do catálogo** (02 §4a propõe `video_models.recipe`), nunca de `lib/model-notes.ts`. A tela e o `o_que_posso_fazer` do conector leem a mesma frase. Formato pedido ao motor por linha de modelo: `faz` (1 frase), `nao_faz` (1 frase), `diferenca` (≤ 90 chars), `motivo_recomendado` (quando é o recomendado da experiência), `tempo` ("3 a 8 min"), `limite_visivel` ("até 5 min de fala", "até 15 s de fala", "4, 6 ou 8 s por cena").

---

## 3. O bloco "Escrever com o seu Claude"

Mora **dentro do campo de texto** (barra de ferramentas do `PromptField`, `prompt-tools.tsx:211-253`), não em bloco separado. Substitui "Melhorar prompt" e o `RoteiroBrief` como caminho único. Um pedido aberto por campo (chave ferramenta + campo).

### 3.1 O que a pessoa faz

Escreve do jeito dela (ou só a ideia, ou dita no microfone) e clica **Escrever com o seu Claude**. O texto do campo vai como pedido junto com a experiência, o modelo marcado, o limite, a voz/apresentador escolhidos e as referências (se houver). O Claude dela lê a marca e devolve o texto no formato que aquele modelo precisa. O texto cai no campo, editável. Com o campo vazio o botão fica desligado e a legenda explica (§3.3, estado 0b).

### 3.2 Barra de ferramentas (estado ocioso)

```
🎙   ✦ Escrever com o seu Claude   + referência          Pela sua assinatura, sem custo extra
```
- 🎙 = ditado (já existe; `aria-label` "Falar em vez de digitar"). Sem chave ElevenLabs abre o modal da ElevenLabs (já faz, `prompt-tools.tsx:114`).
- **"+ referência"** só nas ferramentas cuja receita usa referência (avatar, foto, clone, agente, cenas): abre **uma linha** abaixo do campo: `Link de um vídeo parecido (opcional)` com um `Input`; até 10 (`roteiro.ts:18`). Nenhuma frase explicando o que o Claude faz com o link.
- Legenda à direita, 11–13px soft: **"Pela sua assinatura, sem custo extra"** (texto já existe em `roteiro-brief.tsx:180,227`). Some o rodapé "Scribe v2 · Gemini 2.5 Pro · Sem estimativa" (`prompt-tools.tsx:203-205`).

### 3.3 Estados (todos na mesma faixa sob o campo; `aria-live="polite"`; o campo continua editável em todos)

| # | Estado | O que a tela mostra (textos exatos) | Ações |
|---|---|---|---|
| 0a | Ocioso, com texto | barra da §3.2 | botão ligado |
| 0b | Ocioso, campo vazio | botão desligado; legenda: **"Escreva a ideia em poucas palavras e peça ao seu Claude."** | — |
| 1 | Pedido enviado | faixa fio-navy: `◌ Com o seu Claude · enviado · agora` / trilha de 4 pontos **Enviado · Pegou · Escrevendo · Pronto** / linha: **"Pode sair desta tela: o pedido continua e o sino avisa."** | **Cancelar** (ghost) |
| 2 | Pegou (claim) | `◌ Com o seu Claude · pegou · há 20 s` | Cancelar |
| 3 | Escrevendo | `◌ Com o seu Claude · escrevendo · há 1 min` + a última frase dele em muted (ex.: "Lendo a marca e as duas referências.") | Cancelar |
| 4 | Entregue, campo intocado desde o envio | texto entra no campo; faixa some; barra ganha **↶ Voltar ao meu texto** (ghost, ícone Undo2, já existe como "Voltar ao original") e **Pedir de novo**; toast só se a pessoa estava fora da tela: **"Texto pronto. Revise e gere o vídeo."** | — |
| 4b | Entregue, pessoa editou o campo enquanto esperava | faixa: **"O seu Claude terminou. Você mexeu no texto enquanto esperava."** | **Usar o texto do Claude** (outline) · **Manter o meu** (ghost) · texto "Ver" abre o texto numa `details` inline |
| 5a | Demorou (> 2 min sem pegar) | `◌ Com o seu Claude · enviado · há 3 min` + **"Ainda não pegou. Continua valendo; pode sair da tela."** | Cancelar |
| 5b | Parado (> 15 min sem aviso) ou `falhou` | faixa sem spinner: **"O seu Claude não respondeu."** + o `erro` do servidor se houver (frase humana) | **Pedir de novo** (outline) · Cancelar |
| 6 | Precisa de você (`aguardando_pessoa`) | `ConversaClaude` abre dentro da faixa com o fundo navy-04 (já existe, `conversa-claude.tsx:66-74`): **"O seu Claude precisa de você"** + a pergunta + campo "Responda aqui…" | Enviar |
| 7a | Sem Claude conectado (sem acesso do conector **ou** sem rotina) | barra igual; legenda vira coral-dark: **"Falta conectar o seu Claude"**; clicar no botão abre o **modal do conector** (§4.3) e não navega | botão ligado |
| 7b | Conector sim, rotina não (`acordou=false`) | faixa: **"Guardado. Abra o seu Claude e diga: “atenda os pedidos”."** | **Ligar o atendimento automático** (outline → modal `claude_routine`) · Cancelar |

Trilha: 4 etapas, não 7. O servidor marca enviado/pegou/entregue; "escrevendo" é qualquer `andamento` que o Claude mande; a frase dele aparece como texto, sem virar etapa. (A trilha de 7 do roteiro, `roteiro-brief.tsx:241-249`, era específica da pesquisa com referências; o plano de produção, quando houver, continua chegando junto e aparece como §3.5.)

### 3.4 Convivência com microfone e edição manual

- Microfone e digitação ficam ligados em todos os estados. Ditar durante o pedido = editar durante o pedido → cai no estado 4b na entrega.
- Enquanto há pedido aberto no campo, o botão "Escrever com o seu Claude" **não aparece** (a faixa está no lugar dele); só Cancelar. Impede pedido duplo no mesmo campo (risco 03 §5.3).
- "Voltar ao meu texto" guarda só o último texto anterior (como hoje `original`, `prompt-tools.tsx:58`). Um nível.
- O texto entregue entra no campo pela mesma regra de "não sobrescrever o que a pessoa editou" que já existe (`roteiro-brief.tsx:74-90`), estendida com a comparação de instantâneo (texto no clique × texto agora).

### 3.5 O que vem junto além do texto

- **Roteiro de avatar/foto/clone**: pode vir o plano de produção (telas a gravar, bastidor). Mostra **só "Antes de gerar"** (ferramentas abertas e intervenções, `roteiro-brief.tsx:434-463`), em lista, sob o campo. O "Plano de produção" completo (`:464-513`) sai da ferramenta e vai para o vídeo em Vídeos, onde é usado.
- **Cenas (Diretor)**: o Claude devolve o briefing estruturado (mensagem, número, fala final, público, tom, CTA). A pessoa vê a ideia dela no campo e um `details` **"Ver o briefing que o seu Claude montou"** com os 6 campos editáveis. Nunca obrigatórios à mão.

### 3.6 Texto entregue passa do limite do modelo

Três camadas, nesta ordem:
1. **Antes de entregar**: o limite vai no pedido e o servidor recusa entrega acima dele devolvendo `problemas`; o Claude reescreve (padrão já existe em `roteiro_entregar`, 03 §2.1). A pessoa não vê nada.
2. **Mudou o modelo depois de entregue** (ex.: Avatar IV 5.000 letras → OmniHuman 15 s ≈ 225 letras): contador em coral **"2.300 / 225 letras · passa do limite deste modelo"**; recibo bloqueado com a linha **"Encurte o texto ou escolha outro modelo."**; na barra aparece **"Encurtar com o seu Claude"** (novo pedido, mesmo fluxo, com o limite novo).
3. **Nunca cortar em silêncio.** O corte cego de `prompt-assist` (`index.ts:150`) não existe no novo caminho.

### 3.7 Sino e saída da tela

O pedido vive no servidor. Fora da tela, a entrega dispara o sino (`task-watcher.tsx:79-102`) com **"Texto pronto · {nome da ferramenta}"** e o toque leva a `/videos/novo?rota={want}` com o campo já preenchido (hoje o watcher fixa `rota: "avatar"`; PEDE FRONT: levar o `want` e o campo). Na lista de Vídeos, o pedido aberto aparece como a linha compacta já existente (`AndamentoDoRoteiro compact`).

---

## 4. Padrão de trava e erro, por lugar

Princípio: a trava aparece **onde a pessoa está olhando**, diz **o que falta** e tem **um botão** que resolve ali. Depois de resolver, a tela segue do mesmo ponto, sem recarregar.

### 4.1 Provedor desconectado (HeyGen, Higgsfield, Replicate, ElevenLabs)
- **Na linha do modelo**: `StatusDot off` + "Conectar {Provedor}" (outline, com logo). Já existe (`generation-gate.tsx:187-203`).
- **No recibo**: o botão primário vira **"Conectar {Provedor}"** com o logo (já existe `connectAction`, `generation-gate.tsx:317-322`). Valor: "Sem estimativa" com a linha "conecte o {Provedor} para calcular" (já existe, `gate-estimate-line.tsx:156-160, 202-203`).
- Faltam dois provedores: o botão conecta o **primeiro** da lista; ao fechar o modal com chave, vira o segundo. Nunca botão desligado com a razão em cinza (`remake-flow.tsx:1016-1021`).
- Modal, nunca rota. Fecha → `useSecretStatus` reavalia → a tela acende.
- Nada de "Chega no próximo deploy", "A HeyGen precisa estar pronta", "Conferindo o motor". Enquanto confere: `Skeleton` na linha do modelo; motor que não existe: a opção não aparece.

### 4.2 Apresentador sem rosto / sem apresentador
- O bloco **Quem aparece** mostra, no lugar da grade, uma linha:
  ```
  Nenhum apresentador com foto ainda.        [ Cadastrar apresentador ]
  ```
  O botão (outline, ícone UserRoundPlus) abre o `NewAvatarDialog` (já existe inline em `novo.tsx:980-1071`) com a foto obrigatória; ao salvar, o novo apresentador aparece **marcado** e a trava some.
- O mesmo em "Trocar a pessoa" (remake) e na nota do hub: saem os links "Cadastrar um apresentador" (`video-hub.tsx:193-199`), "Abrir Apresentadores" (`novo.tsx:1021-1032`) e "Cadastre um em Apresentadores e volte aqui" (`remake-flow.tsx:766-768`).
- Foto precisa ser preparada na HeyGen: linha sob o crachá **"Preparar a foto para falar"** + botão **Preparar** (já existe `HeygenPrepLine`); enquanto prepara, o resto da tela continua utilizável.

### 4.3 Claude desconectado
- Clique em "Escrever com o seu Claude" ou na legenda "Falta conectar o seu Claude" → **modal "Conectar o seu Claude"**, dois passos na mesma caixa:
  1. **Acesso do conector** — "Crie o acesso e cole no seu Claude" + botão **Criar acesso** + campo com o token e **Copiar** (hoje em `/config#conectores`).
  2. **Atendimento automático** — os dois campos da integração `claude_routine` ("Endereço da rotina", "Token da rotina") + a instrução curta já escrita em `lib/integrations.ts:86-88`.
  Botão primário do modal: **Conectar**. Fecha → a legenda volta a "Pela sua assinatura, sem custo extra" e o botão funciona. A pessoa não saiu do passo.
- PEDE FRONT: hoje são dois lugares (`openIntegration("claude_routine")` abre só o passo 2; o token do conector é criado em Config). O modal precisa juntar os dois ou abrir o segundo ao fechar o primeiro.
- Com conector e sem rotina, não é trava: é o estado 7b (§3.3) — o pedido fica guardado.

### 4.4 Outras travas que hoje mandam para fora
| Hoje | Padrão |
|---|---|
| "Seu plano do ElevenLabs não clona voz… assine o Starter" + link (`remake-flow.tsx:621-636`) | linha: **"A sua conta ElevenLabs não clona voz."** + **Usar a voz da marca** (outline, marca a opção na hora) + texto "Ver planos" (link externo, secundário) |
| "Nenhum modelo de troca de pessoa ativo: ative o P-Video Replace em Config → Integrações → Replicate." (`remake-flow.tsx:421`) | bastidor (DS C17): para quem não é admin, a ferramenta não aparece no hub; para admin, linha **"Falta ativar um modelo de troca de pessoa."** + **Verificar modelos** (abre o modal do Replicate, como `novo.tsx:742-749`) |
| Roteiro do clone só após `ref.ready` (`heygen-studios.tsx:1148-1160`) | campo sempre disponível (escrever e pedir ao Claude enquanto o clone prepara); recibo: **"Pronto quando o clone terminar: avisamos pelo sino."** e botão desligado só por isso |
| Toast + `navigate("/videos")` em todo Gerar (`heygen-studios.tsx:221-222`, `novo.tsx:431-433`, `remake-flow.tsx:545-550`) | estado "Na fila" no lugar (§1.3) |

---

## 5. As 13 experiências

Convenções: **Faz** e **Não faz** são as duas frases do cabeçalho (segunda pessoa, resultado, ≤ 110 caracteres). *Campos* na ordem da tela; **(C)** = campo com "Escrever com o seu Claude". Limite visível é o que o contador mostra; vem do modelo marcado. Botão = o único primário.

### 5.1 Vídeo de cenas com narração (`scenes` · Diretor)
- **Faz**: Transforma a sua ideia em um vídeo curto: cenas geradas, narração com a voz da marca, trilha e legendas.
- **Não faz**: Não coloca você nem outra pessoa real nas cenas.
- Campos: **A ideia** (C) · texto · "até 600 letras" → o Claude devolve o briefing (details "Ver o briefing que o seu Claude montou": Mensagem, Número que prova, Fala final, Público, Tom, Chamada final — editáveis) · **Duração** · chips 15 s / 30 s / 45 s / 60 s (padrão 30) · **Legendas** · switch ligado, "na cor da marca" · **Mais nitidez** · switch desligado, só se o modelo tiver 1080p, com "+US$ X" no rótulo.
- Saem: Cenas 3–8, Resolução por chip, Objetivo/Público/Tom à mão, Avançado inteiro (§6.3).
- Botão: **Gerar vídeo**.

### 5.2 Vídeo comigo nas cenas (`presenter` · Diretor)
- **Faz**: Coloca o seu apresentador dentro das cenas geradas, com a narração da marca por cima.
- **Não faz**: Ele não fala em sincronia: a voz é narração, não boca mexendo.
- Campos: **Quem aparece** · crachás só de quem tem foto, o padrão marcado; vazio → §4.2 · **A ideia** (C) · "até 600 letras" · **Duração** · chips · **Legendas** · switch.
- Modelo: recomendado = Higgsfield Cinema Studio 3.0 quando conectado ("Mantém o seu rosto em todas as cenas"); Replicate com a sublinha honesta "O rosto vem só do primeiro quadro e pode variar" (02 #3). Se o motor passar a enviar as fotos, a frase muda no catálogo.
- Botão: **Gerar vídeo**.

### 5.3 Um avatar apresenta o roteiro (`avatar` · HeyGen)
- **Faz**: Um apresentador da HeyGen, ou um seu, fala o texto olhando para a câmera.
- **Não faz**: Não muda de cenário nem mostra outras imagens: é só ele falando.
- Campos: **Quem apresenta** · chips Biblioteca / Meus avatares + grade + "Criar avatar" (texto) · **Voz** · segmentado Voz do apresentador / Voz da marca / Outra (+ Ouvir) · **O que ele fala** (C) · "até 5.000 letras · cabe até 5 min de fala" · **+ referência** na barra.
- Sublinha do Avatar V: "Mais expressão no rosto; só nos apresentadores que aceitam." Se o apresentador marcado não aceita, a opção V fica desligada com "Este apresentador não aceita." (em vez do `engineNote` de troca silenciosa, `heygen-studios.tsx:321-327`).
- Botão: **Gerar vídeo**.

### 5.4 Minha foto vira apresentador (`photo_avatar` · HeyGen ou Replicate)
- **Faz**: Faz a sua foto falar o texto, com a voz que você escolher.
- **Não faz**: Não muda o fundo nem o enquadramento da foto.
- Campos: **Quem apresenta** · crachás com foto (padrão marcado; sem foto → §4.2; HeyGen → linha "Preparar a foto para falar") · **Voz** · segmentado (no Replicate: fixo "Voz da marca", escrito na sublinha do modelo) · **O que ele fala** (C) · limite do modelo: Avatar IV "até 5.000 letras · cabe até 5 min de fala"; P-Video "até 3 min de fala"; OmniHuman "até 15 s de fala (≈ 225 letras)".
- Sublinhas: Avatar IV "Aceita a sua foto depois de preparar; preço só na conta HeyGen"; P-Video 2 Pro "Preço por segundo conhecido; corpo parado, só o rosto fala"; OmniHuman "Mexe corpo e mãos; só até 15 s".
- Botão: **Gerar vídeo**.

### 5.5 Meu clone (`twin` · HeyGen)
- **Faz**: Cria um clone seu a partir de um vídeo e ele grava qualquer texto com a sua voz.
- **Não faz**: Não fica pronto na hora: o clone leva um tempo para preparar e pede o seu consentimento gravado.
- Campos: **De quem é o clone** · crachás · **Seu vídeo** · upload "de 15 s a 10 min, falando para a câmera, sem música" (regra que hoje está em `video_models.notes` e ninguém lê, 02 #18) + status do clone em 1 linha · **O que o clone fala** (C) · "até 5.000 letras · cabe até 5 min de fala" · **+ referência**.
- Botão: **Gerar vídeo** (desligado até o clone ficar pronto, com a linha da §4.4).

### 5.6 Só a ideia, vídeo pronto (`agent` · HeyGen)
- **Faz**: Você descreve o vídeo e a HeyGen escreve, monta e aplica as cores e o logo da marca.
- **Não faz**: Não dá para revisar o roteiro antes: o vídeo vem pronto.
- Campos: **A ideia** (C) · "até 10.000 letras" (o Claude escreve no formato que o Agent espera: ideia, duração, o que mostrar, chamada final) · **Voz** · segmentado Voz da marca na HeyGen / Deixar a HeyGen escolher · linha fixa (não é campo): "Vertical, para Reels e Stories".
- Saem: "A marca vai junto: cores e logo vêm do site cadastrado." (já está no Faz), "Voz escolhida pelo Video Agent", "não vale no Video Agent".
- Botão: **Gerar vídeo**.

### 5.7 Mudar o que eu digo (`speech` · remake)
- **Faz**: Troca a fala do seu vídeo por um texto novo, com a boca acompanhando.
- **Não faz**: Não alonga o vídeo: a fala nova precisa caber no tempo do original.
- Campos: **Seu vídeo** · upload "MP4 ou MOV, de 2 a 30 s" · **Fala nova** (C) · limite calculado do vídeo: "até 450 letras · cabe nos 30 s do seu vídeo" (o Claude recebe esse teto) · **Voz** · segmentado A minha voz / Voz da marca / Feminina / Masculina · **Autorização** · checkbox "Tenho autorização de quem aparece no vídeo." (só quando há outra pessoa).
- Saem: "Colar um Voice ID do ElevenLabs" (`remake-flow.tsx:577-619`); "Para N s de vídeo, escreva ~N×15 caracteres" (vira o contador); exigência de HeyGen no hub (`video-hub.ts:395`) quando o Replicate resolve (01 §4.7).
- Botão: **Gerar nova versão**.

### 5.8 Traduzir meu vídeo (`translate` · HeyGen)
- **Faz**: Refaz a fala em outro idioma, com a sua voz e a boca acompanhando.
- **Não faz**: Não traduz textos que aparecem na tela.
- Campos: **Seu vídeo** · **Para qual idioma** · chips Inglês / Espanhol / Francês / Italiano / Alemão · **Idioma do vídeo** · chips Português (marcado) / Inglês / Espanhol · **Autorização** · checkbox.
- Sem campo de texto: sem botão do Claude.
- Botão: **Gerar nova versão**.

### 5.9 Mudar o estilo (`style` · remake)
- **Faz**: Dá um visual novo ao vídeo inteiro (cinema, anime, massinha…) mantendo fala, gestos e câmera.
- **Não faz**: Não muda quem aparece nem o que é dito.
- Campos: **Seu vídeo** · upload "até 30 s" (+ "até 16 MB" só quando o modelo marcado for o Aleph; o limite vem do modelo, não da cópia fixa) · **Estilo** · chips Estilo da marca / Cinema / Anime / Massinha / Quadrinhos / Pixel.
- Modelo: recomendado = o primário do catálogo com motivo "Mantém melhor o movimento" ou "Mais barato por segundo"; a cópia "Runway Aleph (Replicate) · até 30 s e 16 MB" (`remake-options.ts:33-34`) sai (02 #9).
- Botão: **Gerar nova versão**.

### 5.10 Mudar o cenário (`scene` · remake)
- **Faz**: Troca o lugar, a luz ou a roupa e mantém a pessoa, a fala e o movimento.
- **Não faz**: Não acrescenta objetos na mão da pessoa nem muda o que ela diz.
- Campos: **Seu vídeo** · **O que muda** (C) · texto · "até 200 letras · uma frase visual: lugar, luz, roupa" (o Claude devolve a frase no formato que o modelo entende; o motor traduz).
- Botão: **Gerar nova versão**.

### 5.11 Trocar a pessoa (`character` · remake)
- **Faz**: Coloca o seu apresentador no lugar de quem aparece, com o áudio original.
- **Não faz**: Não muda a fala nem o cenário.
- Campos: **Seu vídeo** · **Quem entra** · crachás com foto (vazio → §4.2) + linha "Vão 3 fotos de Ana como referência" · **Como ele deve ficar** (C) · opcional · "até 500 letras" · **Autorização** · checkbox.
- Botão: **Gerar nova versão**.

### 5.12 Legendas da marca (`captions`)
- **Faz**: Transcreve o que é dito e grava legendas na cor da marca.
- **Não faz**: Não corrige a fala nem traduz.
- Campos: **Seu vídeo** · **Estilo da legenda** · chips (7, só o nome) + bolinha da cor da marca · **Idioma do vídeo** · chips Português (marcado) / Inglês / Espanhol.
- Recibo: valor **"Centavos"** com a linha "Transcrição por segundo de áudio; a montagem não custa" (unifica "centavos" do hub × "US$ 0,00" do remake, 01 §4.11).
- Botão: **Gerar nova versão**.

### 5.13 Reenquadrar e melhorar (`reframe` · Higgsfield)
- Hoje: **não aparece no hub** (sem motor, `STUDIO_READY.reframe=false`). Some o ladrilho e o `ReframeStudio` de "Chega no próximo deploy" (`heygen-studios.tsx:1257-1273`, `video-hub.tsx:218-222`).
- Quando existir: **Faz**: Muda o formato do vídeo (vertical, quadrado ou horizontal) e aumenta a nitidez. **Não faz**: Não corta trechos nem muda o conteúdo. Campos: **Seu vídeo** · **Formato final** · chips Vertical (marcado) / Quadrado / Horizontal · **Mais nitidez** · switch. Botão: **Gerar nova versão**.

### 5.14 Resumo

| Experiência | Campo (C) | Limite visível (do modelo) | Botão |
|---|---|---|---|
| Cenas com narração | A ideia | até 600 letras | Gerar vídeo |
| Comigo nas cenas | A ideia | até 600 letras | Gerar vídeo |
| Avatar apresenta | O que ele fala | 5.000 letras · 5 min de fala | Gerar vídeo |
| Minha foto vira apresentador | O que ele fala | 5 min · 3 min · 15 s (por modelo) | Gerar vídeo |
| Meu clone | O que o clone fala | 5.000 letras · 5 min de fala | Gerar vídeo |
| Só a ideia, vídeo pronto | A ideia | 10.000 letras | Gerar vídeo |
| Mudar o que eu digo | Fala nova | letras que cabem no vídeo | Gerar nova versão |
| Traduzir | — | — | Gerar nova versão |
| Mudar o estilo | — | — | Gerar nova versão |
| Mudar o cenário | O que muda | 200 letras | Gerar nova versão |
| Trocar a pessoa | Como ele deve ficar (opcional) | 500 letras | Gerar nova versão |
| Legendas da marca | — | — | Gerar nova versão |
| Reenquadrar | — | — | Gerar nova versão (quando existir) |

---

## 6. Checklists e o que remover

### 6.1 Regressão de "card genérico" (rodar antes de validar comportamento)
- [ ] Nenhum bloco da ferramenta é um retângulo com borda + sombra + padding + título. Blocos se separam por filete (`border-t via-border-soft`) e espaço.
- [ ] As opções de modelo são **linhas** (`GateOptionList`), não caixas; o único contêiner selecionável com borda é o crachá de apresentador / ladrilho de avatar (tem identidade própria: foto + nome).
- [ ] O andamento do Claude é a faixa com fio navy à esquerda; não ganhou fundo, borda nem sombra. A única área tingida é a conversa quando ele espera resposta (navy-04, já existe).
- [ ] O campo de texto é o `PromptField` (caixa de input com a barra dentro) — é um input, não um card.
- [ ] O recibo é `GateEstimateLine` + botão; sem moldura.
- [ ] O rodapé fixo do celular é uma faixa branca com filete em cima; sem sombra.
- [ ] Teste: se trocar o conteúdo de qualquer bloco por outro assunto e ele continuar fazendo sentido visualmente, o bloco é genérico — redesenhar.

### 6.2 DS SUBIDO (skill `design-system-subido`, refs 03/04/06)
- [ ] **Um botão navy por tela**: o do recibo. "Criar avatar", "Cadastrar apresentador", "Preparar", "Conectar X" na linha do modelo, "Usar o texto do Claude" são outline/texto. O botão do recibo pode **virar** "Conectar {Provedor}" (troca, não soma).
- [ ] Botão = verbo + objeto; só dois rótulos primários (Gerar vídeo / Gerar nova versão). Sem seta.
- [ ] Todo provedor com logo oficial (`BrandIcon`) em toda linha de modelo e em todo "Conectar X". Anthropic/Claude com o logo do kit no modal.
- [ ] Texto ≥ 13px; selos em minúscula (pill do kit): recomendado · mais barato · melhor imagem · não conectado. Nunca CAPS, nunca "Padrão"/"Top".
- [ ] Sem semáforo: estado de pedido em navy/muted; erro em coral-dark só no texto ("Falta conectar o seu Claude", contador acima do limite).
- [ ] Sem bastidor na tela (C17/M18): nada de deploy, motor, catálogo, chave, Vault, "em breve". Recurso indisponível não aparece.
- [ ] Hover/selecionado = fio fino + tint leve (navy-04/06). Sem glow, sem sombra na seleção.
- [ ] Rótulo acima do campo 14px/500; ajuda abaixo 13px muted só quando muda a decisão (limite, "cabe nos 30 s").
- [ ] Celular: uma coluna, 16px de gutter, grade de crachás em rolagem horizontal, recibo fixo no rodapé, sem rolagem lateral da página.
- [ ] Copy em pt-BR, segunda pessoa, resultado antes de função, sem exclamação em erro, sem emoji.
- [ ] Skeleton com a forma do conteúdo enquanto o catálogo carrega; spinner só no botão.

### 6.3 O que REMOVER das telas atuais (arquivo:linha vindos do 01-eng-front.md)

**Caminho de escrita errado (R1)**
- `components/prompt/prompt-tools.tsx:169-184` — botão "Melhorar prompt" → vira "Escrever com o seu Claude" (pedido pelo conector).
- `components/prompt/prompt-tools.tsx:203-205` (+ `components/ai-role-grid.tsx:83-86`) — rodapé "Scribe v2 · Gemini 2.5 Pro · Sem estimativa para este modelo" → sai; entra "Pela sua assinatura, sem custo extra".
- `routes/_app/videos/novo.tsx:460-482` — "Montar o briefing" (edge `video-brief` por LLM) e "Preencher à mão" → saem; o Claude monta o briefing a partir de "A ideia" (§5.1).
- `components/video/roteiro-brief.tsx:112-134` — bloco "O roteiro é escrito pelo seu Claude… Conectar o Claude" que navega para `/config` → vira legenda + modal (§3.3 7a, §4.3).
- `components/video/roteiro-brief.tsx:169` — briefing só aparece com `script` vazio → um campo só, sempre com o botão.
- `components/video/roteiro-brief.tsx:194-220` — textarea de briefing separada + "Referências" com a frase "O seu Claude estuda cada um: cortes, zoom…" → o campo de fala é o pedido; referência vira "+ referência" (§3.2).
- `components/video/roteiro-brief.tsx:464-513` — `<details>` "Plano de produção" dentro da ferramenta → vai para o vídeo em Vídeos; fica só "Antes de gerar" (`:434-463`).

**Modelo e custo (R2)**
- `components/video/video-hub.tsx:180-184` — `ModelRail` no hub → sai; o modelo é escolhido na ferramenta.
- `components/video/video-hub.tsx:281-283` — selo "Padrão"/"Top" posicional → selo por regra com motivo (§2.1).
- `components/video/video-hub.tsx:291-295` — "em breve" / "conferindo…" no trilho → opção some / skeleton.
- `components/video/heygen-studios.tsx:163-210` (`GenerateBar`, em especial `:185-192` "label · preço a confirmar · tempo") → `GateOptionList` + `GateEstimateLine`.
- `lib/video-hub.ts:203` — `HEYGEN_PRICE = "preço a confirmar"` → "Sem estimativa para este modelo" (componente já existe, `gate-estimate-line.tsx:148-153`).
- `lib/video-hub.ts:311` — "até 34 s" do OmniHuman fixo no front → limite do catálogo (15 s).
- `lib/remake-options.ts:33-50` — linhas com nome técnico e limite fixo ("Runway Aleph (Replicate) · até 30 s e 16 MB", "P-Video Replace", "Voz ElevenLabs, boca HeyGen · até 600 caracteres", "HeyGen · 5 idiomas") → frases Faz/Não faz (§5); limites no campo, vindos do modelo.
- `lib/model-notes.ts:10-31` — dicionário de frases no front → frases vêm do catálogo (§2.3); `generation-gate.ts:66-69` `ENGINE_REASON` morto → vira o motivo do recomendado.
- `lib/hub-examples.ts:33-45, 75-81, 89-95, 103-116` — exemplos de outro provedor/modelo em 6 ladrilhos → trocar pelo exemplo do recomendado ou tirar o exemplo.
- `components/video/hub-route-tile.tsx:148-154` — "Padrão X · custo · +N top" → "Padrão X · a partir de US$ Y" ou "Padrão X · sem estimativa".

**Campos mortos e rótulos técnicos**
- `routes/_app/videos/novo.tsx:486-515` — Mensagem / Número que prova / Fala final obrigatórios à mão → details preenchido pelo Claude (§3.5).
- `routes/_app/videos/novo.tsx:125-132, 517-535` — Objetivo "Reel B2B case-study" / Público / Tom "sóbrio, direto" → saem da tela.
- `routes/_app/videos/novo.tsx:555-568` — Cenas 3–8 → sai (a duração decide).
- `routes/_app/videos/novo.tsx:847-880` — Resolução "720p/1080p/4k" com preço por chip → switch "Mais nitidez (+US$ X)" ou nada.
- `routes/_app/videos/novo.tsx:663-723` — Avançado: "Teto de créditos", "Vale só para o Higgsfield: cenas do Replicate não entram no teto…", "Revisar os quadros", "Revisar o som", "Só os quadros (teste barato)", "Comparar dois modelos" → saem da ferramenta (admin, em Ajustes do Diretor).
- `components/video/heygen-studios.tsx:1217-1219` — "A marca vai junto: cores e logo vêm do site cadastrado." → já está no Faz.
- `components/video/heygen-studios.tsx:1220-1242` — "Voz escolhida pelo Video Agent", "não vale no Video Agent" → "Deixar a HeyGen escolher"; vozes que não servem não aparecem.
- `components/video/heygen-studios.tsx:1175` — `useStudioModel(route, null)` ignora o modelo → lê o marcado.
- `components/video/remake-flow.tsx:577-619` — "Outra voz" → "Colar um Voice ID do ElevenLabs" + instrução "No ElevenLabs: Voices → …" → sai; vozes vêm de Marca › Vozes.
- `components/video/remake-flow.tsx:782-803` — "Para N s de vídeo, escreva ~N×15 caracteres" / "Longa demais… Corte para ~X" → contador "até N letras · cabe nos N s do seu vídeo".
- `components/video/remake-flow.tsx:975-1040` — passo "3 · Custo e confirmação" numerado + frase "Leva alguns minutos e roda em segundo plano." → recibo do padrão.
- `components/video/video-hub.tsx:185-188` — parágrafos `route.via` / `route.options` ("No próximo passo: …", "Cenas no modelo escolhido; quadros e montagem no Higgsfield; voz ElevenLabs") → saem.

**Travas que tiram do fluxo (R3)**
- `components/video/video-hub.tsx:189-202` — `route.note` "Exige um apresentador com foto." + link "Cadastrar um apresentador" → `/marca/avatares` → trava inline na ferramenta (§4.2).
- `components/video/video-hub.tsx:218-222` e `components/video/heygen-studios.tsx:1257-1273` — "Chega no próximo deploy." / `ReframeStudio` → ladrilho some.
- `components/video/heygen-studios.tsx:329-341` e `:922-940` — blockers em texto cinza ("A HeyGen precisa estar pronta para gerar.", "Chega no próximo deploy do motor.", "Nenhum modelo disponível para esta experiência.", "Prepare a foto na HeyGen antes de gerar.") → cada um vira trava com botão no bloco certo (§4) ou some.
- `routes/_app/videos/novo.tsx:1021-1032` — "Nenhum apresentador com foto ainda. Abrir Apresentadores" → botão "Cadastrar apresentador" inline.
- `components/video/remake-flow.tsx:766-768` — "Cadastre um em Apresentadores e volte aqui" → idem.
- `components/video/remake-flow.tsx:621-636` — "assine o Starter" + link externo → alternativa inline (§4.4).
- `components/video/remake-flow.tsx:421` — "ative o P-Video Replace em Config → Integrações → Replicate" → bastidor (§4.4).
- `components/video/remake-flow.tsx:1016-1021` — botão desligado quando faltam duas integrações → sempre "Conectar {primeiro}".
- `components/video/heygen-studios.tsx:221-222`, `routes/_app/videos/novo.tsx:431-433`, `components/video/remake-flow.tsx:545-550` — toast + `navigate("/videos")` → estado "Na fila" no lugar.
- `components/video/heygen-studios.tsx:1148-1160` — Roteiro do clone só depois de pronto → campo sempre disponível.
- `components/task-watcher.tsx:~95` — sino navega fixo para `rota: "avatar"` → levar o `want` da ferramenta.

**CTAs duplicados**
- Diretor: "Montar o briefing" × "Preencher à mão" × "Gerar vídeo" (`novo.tsx:460-482, 725-767`) → um primário.
- Avatar: "Criar roteiro com o seu Claude" (`roteiro-brief.tsx:222-225`) × "Melhorar prompt" no mesmo campo (`heygen-studios.tsx:145-153`) × "Gerar vídeo" → o botão do Claude vira ferramenta do campo (ghost); um primário.
- Hub: "Continuar" × três "Conectar X" (`video-hub.tsx:203-230`) → "Continuar" sempre ligado; a conexão é trava da ferramenta.
- Setup (`components/setup/step-create.tsx:359-375`) → usa o mesmo componente da ferramenta, com rota e modelo.

---

## 7. O que a tela precisa da camada de baixo (sem isso o padrão fica incompleto)

| Precisa | Hoje | Onde está detalhado |
|---|---|---|
| Frases por modelo (faz, não faz, diferença, motivo, tempo, limite visível) lidas pela tela e pelo conector | `model-notes.ts` fixo; `video_models.notes` que ninguém lê | 02 §4a (`recipe`), 02 #18 |
| Pedido de escrita genérico por campo (ferramenta, modelo, limite, contexto) com entrega validada pelo limite | só `roteiro_pedidos` para o roteiro de avatar | 03 §4.2 (`escrita_pedidos` ou `roteiro_pedidos` + `ferramenta`) |
| Receita por (ferramenta, modelo) que o Claude segue | só `RECEITA_DO_ROTEIRO` | 03 §4.3, 02 §1 |
| `marca_ler` com guardrails | lê tabela inexistente | 03 §3.1 (QUEBRADO) |
| Bloco "ESCRITA" na rotina do Claude | 5 blocos | 04-fase-desenho (rotina trig_01P1Dfnx…; atualizar pelo RemoteTrigger) |
| Estado "rotina ligada" distinto de "conector ligado" para o estado 7b | tela só vê token | 03 §5.2 |
| Saldo Higgsfield legível pela tela | só servidor | 02 §2.5 |
| Limite por modelo no catálogo correto (OmniHuman 15 s, Aleph 16 MB validado) | divergente | 02 #7, #8 |

NÃO VERIFICADO: tempo real do clique à entrega da rotina (03 §2.4 estima minutos; a trilha e o "pode sair da tela" assumem isso); se o `HeygenPrepLine` e o `NewAvatarDialog` devolvem o item criado para auto-marcar (a tela de hoje auto-seleciona o padrão, `novo.tsx:980-1071`).
