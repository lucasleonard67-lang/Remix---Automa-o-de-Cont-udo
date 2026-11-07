# 07 — Continuidade cinematográfica → Agente de Continuidade

> Pesquisa: como profissionais (script supervisors/continuístas) pensam continuidade, e como isso vira
> validação automática num pipeline de vídeo 100% gerado por IA (imagem → image-to-video → TTS → lipsync → música).
> Fontes principais: Pat P. Miller *Script Supervising and Film Continuity* (Routledge/Focal), Avril Rowlands *The Continuity Supervisor*,
> Walter Murch *In the Blink of an Eye*, SetHero, Celtx, StudioBinder, EditMentor, Wikipedia, VBench (CVPR 2024), VideoPhy-2, Oxford VGG.

---

## 1. Conceitos e princípios

### 1.1 Continuidade = ilusão de espaço-tempo contínuo
Continuity editing ("edição invisível") constrói a ilusão de que uma cena — filmada em dezenas de takes, em dias diferentes,
fora de ordem — aconteceu num espaço e tempo únicos e contínuos. Qualquer detalhe que contradiga essa ilusão (roupa, luz, posição,
direção de movimento) tira o espectador da história. [Wikipedia: Continuity editing; Soundstripe "The Invisible Editor"]

### 1.2 Regra dos 180° (eixo de ação)
Linha imaginária ligando os dois sujeitos principais da cena ("the line" / axis of action). A câmera fica de UM lado dessa linha
durante toda a cena; assim o personagem A olha sempre para a direita da tela e B sempre para a esquerda, e o público entende quem
está onde. Cruzar o eixo sem transição inverte as posições aparentes e desorienta. [Wikipedia: 180-degree rule; StudioBinder; MasterClass]
Formas legítimas de cruzar: (a) travelling contínuo que atravessa a linha em quadro (o público vê a mudança); (b) shot neutro
"em cima da linha" (frontal ou nuca) que reseta o eixo; (c) cutaway sem orientação estabelecida; (d) o próprio personagem cruza
a linha em plano contínuo; (e) quebra intencional para desorientar (ex.: *Requiem for a Dream*). [EditMentor; StudioBinder]

### 1.3 Screen direction (direção de tela e de deslocamento)
Movimento deve manter a mesma direção de tela entre cortes: quem sai do quadro pela direita entra no próximo plano pela esquerda;
quem viaja "para a direita" continua para a direita em todos os planos da jornada, até que um plano neutro (movimento em direção
à câmera ou se afastando dela) resete a direção. Inversão sem plano neutro lê como "voltou". Esquerda→direita tende a ler como
progresso (convenção ligada à direção de leitura). [Wikipedia: Screen direction; Videomaker; StudioBinder]

### 1.4 Eyeline match (direção do olhar)
Personagem olha para fora do quadro → o próximo plano é lido como "o que ele vê". Em diálogo shot/reverse-shot: A olha
screen-right, B olha screen-left, alturas de olhar compatíveis com a diferença de altura/posição dos personagens. Eyeline errado
(os dois olhando para o mesmo lado, ou olhar alto demais) quebra a geografia da cena instantaneamente. [Wikipedia: Eyeline match; EditMentor; StudioBinder]

### 1.5 Match on action (cortar no movimento)
Cortar no meio de uma ação e continuá-la no plano seguinte cria corte invisível — o olho segue o movimento e perdoa pequenos
erros de matching. É a ferramenta nº 1 para esconder descontinuidade física. Implicação de produção: a ação é filmada com
sobreposição (overlapping action) nos dois ângulos para o editor ter onde cortar. [Wikipedia: Cutting on action; Filmsupply; EditMentor]

### 1.6 Continuidade de figurino, props, cabelo/maquiagem, cenário
Tudo que aparece em quadro deve estar idêntico entre planos da mesma cena: roupa (peça, cor, estado — amassada/molhada/rasgada,
botões, zíper), acessórios (relógio, brinco, óculos — e em qual mão/lado), props (qual objeto, em qual mão, nível do copo/prato,
cigarro queimado até onde), cabelo (lado do risco, sobre qual ombro), maquiagem/ferimentos (evolução de sangue/suor/sujeira),
posição de objetos no set e blocking dos atores. [Miller, *Script Supervising and Film Continuity*; StudioBinder; Saturation.io]

### 1.7 Continuidade de luz e hora do dia
Luz natural muda até ~3000K de temperatura de cor ao longo do dia; cenas filmadas em horários diferentes precisam parecer o mesmo
minuto diegético — direção da luz, dureza das sombras, temperatura de cor, clima (nublado/sol) e o que se vê pelas janelas devem
bater. Dia→noite entre dois planos da MESMA cena é erro; entre cenas, é elipse. Nota profissional: match de luz não precisa ser
100% — "melhor quebrar continuidade do que ter um plano feio". [No Film School; SmartTVMag; Beverly Boy; LinkedIn/cinematography]

### 1.8 Continuidade temporal: elipse legítima vs. erro
Elipse (pular tempo) é legítima e onipresente — o que a separa do erro é SINALIZAÇÃO: dissolve, fade, cartela ("3 anos depois"),
cutaway, mudança clara de cena/figurino/luz. Dentro de uma cena, o público assume tempo real; um salto não sinalizado (jump cut
acidental, prop que "avança" sozinho) lê como erro. Jump cut deliberado é recurso estilístico (Godard), mas precisa ser padrão
consistente, não acidente isolado. [Fiveable: Temporal continuity; Wikipedia: Jump cut; MasterClass]

### 1.9 A hierarquia de Murch: a emoção manda
Walter Murch (*In the Blink of an Eye*), "Rule of Six" — prioridades de um corte: Emoção 51% > História 23% > Ritmo 10% >
Eye-trace 7% > Plano 2D da tela 5% > Espaço 3D (continuidade espacial) 4%. "Se tiver que sacrificar algo, sacrifique de baixo
para cima": continuidade espacial é o PRIMEIRO item a ser abandonado quando conflita com emoção, história ou ritmo. Continuidade
perfeita com emoção errada é um corte ruim; emoção certa com raccord imperfeito é um corte bom. [StudioBinder: Rule of Six; ProVideo Coalition]

### 1.10 Por que erros escapam: change blindness
~58% das pessoas não veem erros de continuidade (change blindness): o cérebro processa o essencial (rostos, ação, intenção) e
"preenche" o resto; se o corte redireciona a atenção, a mudança passa. Casos célebres que sobreviveram ao corte final:
*Pretty Woman* (croissant vira panqueca), *Pulp Fiction* (buracos de bala na parede ANTES dos tiros), *Star Wars* (stormtrooper
bate a cabeça na porta). Lição de projeto: erro em área de atenção (rosto, mãos, objeto da ação) é grave; erro periférico raramente
é percebido. [Genetic Literacy Project; Fstoppers; AIP Inside Science; IndieWire; Cracked]

---

## 2. Como o script supervisor trabalha — processo e artefatos

**Prep (pré-produção)** — continuity breakdown do roteiro: numeração de cenas, divisão em oitavos de página, timeline da história
(story days: que dia diegético é cada cena), mapa de personagem×cena×figurino×props, flags de risco ("cenas 12 e 47 são o mesmo
dia da história, filmadas com 3 semanas de diferença"). [Miller; Rowlands caps. "Out of Sequence Shooting"; Saturation.io]

**No set, por take** — o continuísta anota: slate (cena/take), lente e filtro, duração cronometrada, descrição da ação e do
enquadramento, comentário do diretor (print/NG e por quê), falas ditas errado, e notas de matching ("caneca na mão esquerda,
2/3 cheia", "cabelo sobre ombro esquerdo", "saiu de quadro pela direita"). Cronometra tudo para estimar duração do filme. [Miller; SetHero; Wikipedia: Script supervisor]

**Fotos de referência** — ao fim de cada setup, fotografa figurino, cabelo/maquiagem, props e set dressing; essas fotos são a
fonte de verdade quando a cena é retomada dias depois. Wardrobe/makeup/props mantêm seus próprios binders de continuidade
sincronizados com o do continuísta. [StudioBinder; Toronto Film School; Grokipedia: Script supervisor]

**Lined script** — cópia do roteiro com uma linha vertical por take cobrindo o trecho filmado; linha reta = ator em quadro
(rosto visível), linha ondulada (squiggly) = fala/ação fora de quadro naquele ângulo. O editor abre o lined script e vê, para
cada linha de diálogo, exatamente quais ângulos existem. Facing pages carregam as notas de take. [Celtx; EditStock; StudioBinder]

**Relatórios diários** — Daily Progress Report (horários, cenas completadas, páginas em oitavos, setups, tempo de tela rodado,
retakes, wild tracks) + Editor's Log (takes preferidos do diretor) + continuity log. O continuísta é o canal formal
diretor→montagem. [SetHero; NFI; Kinolime]

**Postura profissional** — o continuísta previne no set (avisa ANTES de rodar: "ela estava sem o casaco na saída da cena
anterior"), mas não trava a produção por detalhe periférico: julga se o erro vai ler em tela, considerando tamanho do plano e
foco de atenção. É triagem por severidade, não perfeccionismo. [That Continuity Guy; Rowlands]

---

## 3. Abstração: o Agente de Continuidade

Posição no pipeline: roda **depois** da geração de cada clipe (e dos keyframes), **antes** da montagem/render final.
Entradas: (a) blueprint da cena (metadados: personagens, figurino canônico, props, locação, story day, hora diegética, direção
de movimento planejada, posição no eixo); (b) character sheet / imagens canônicas de cada personagem e locação; (c) keyframes
extraídos de cada clipe (primeiro, meio, último frame no mínimo); (d) clipes vizinhos na timeline. O equivalente digital do
"binder de fotos de referência" é o **asset canônico versionado** — a comparação nunca é clipe-contra-clipe solta, é sempre
clipe-contra-cânone + clipe-contra-vizinho.

### 3.1 Checklist de validações

| # | Check | Mecanismo | Compara | Severidade | Ação |
|---|-------|-----------|---------|------------|------|
| C1 | Identidade facial do personagem | Embedding facial (ArcFace/CLIP-face) entre frame e retrato canônico; distância acima de limiar | frames do clipe × character sheet | **ERRO** | Bloquear/regerar. Rosto trocado é o defeito nº 1 de IA e o público SEMPRE vê (atenção vai ao rosto) |
| C2 | Deriva de identidade DENTRO do clipe | Embedding facial primeiro×último frame do mesmo clipe | intra-clipe | **ERRO** | Regerar clipe (identity drift acumulativo) |
| C3 | Figurino: peça e cor | LLM-vision descreve vestuário por frame (JSON: peças, cores, estado) e compara com figurino canônico da story-day | keyframes × metadados de figurino | **ERRO** se peça/cor muda na mesma cena; **WARNING** se só tonalidade/detalhe | Bloquear troca de peça; aceitar variação tonal (luz muda cor percebida) |
| C4 | Props: presença, mão, estado | LLM-vision: inventário de objetos em quadro + em qual mão + estado (copo cheio/vazio) vs. lista de props da cena | keyframes consecutivos + metadados | **ERRO** se prop da ação some/teleporta de mão; **WARNING** se prop periférico varia | Objeto que o personagem manipula = crítico; fundo = tolerável |
| C5 | Cabelo/marcas físicas | LLM-vision: comprimento/cor de cabelo, barba, cicatriz, óculos vs. character sheet | keyframes × cânone | **ERRO** (é identidade) | Regerar |
| C6 | Ambiente/locação consistente | Embedding de cena (CLIP/DINOv2) do fundo entre clipes da mesma locação; LLM-vision confirma elementos fixos (janela, porta, quadro) | clipes da mesma cena × keyframe canônico da locação | **ERRO** se arquitetura muda; **WARNING** se set dressing periférico varia | "Ambiente muda sozinho" é falha típica de i2v longo |
| C7 | Luz e hora do dia | LLM-vision classifica: direção da luz, dureza, temperatura (quente/fria), dia/noite/golden hour vs. metadado `time_of_day` da cena | keyframes × blueprint | **ERRO** dia↔noite na mesma cena; **WARNING** mudança de direção/temperatura | Warning porque cinema real também tolera (seção 1.7) |
| C8 | Regra dos 180° / posição no eixo | Regra sobre metadados: blueprint declara lado do eixo por shot; LLM-vision verifica em qual lado da tela cada personagem está e para onde olha | shots adjacentes da mesma cena | **WARNING** (bloquear só em diálogo shot/reverse) | Se A e B trocam de lado sem shot neutro entre eles → flag; permitir se blueprint marca `axis_break: intentional` |
| C9 | Eyeline em diálogo | LLM-vision: direção do olhar (screen-left/right/camera) por personagem por shot; regra: em shot/reverse, olhares devem ser opostos | par de shots de diálogo | **ERRO** em diálogo (quebra imediata); **WARNING** fora | Olhar direto para a câmera não planejado também é flag |
| C10 | Direção de movimento | Metadado `travel_direction` por sequência + LLM-vision/fluxo óptico detecta direção real do deslocamento | clipes de uma sequência de jornada | **WARNING**; **ERRO** se inverte sem plano neutro declarado | Regra: inversão exige `neutral_shot` entre os clipes |
| C11 | Raccord entre fim de clipe N e início de N+1 | LLM-vision compara último frame de N com primeiro de N+1 (mesma cena, corte direto): pose, props, posição | frames de fronteira | **WARNING** | Match on action perdoa muito (seção 1.5); só bloquear se pose/posição contradiz grosseiramente |
| C12 | Elipse sinalizada | Regra sobre metadados: mudança de `story_day`/`time_of_day`/locação entre clipes exige transição declarada (corte de cena, fade, cartela) | timeline | **WARNING** | Puramente estrutural, sem visão |
| C13 | Anatomia e física | LLM-vision com prompt de anomalia (mãos com dedos errados, membros extras, morphing, objeto atravessando objeto, física impossível) + métricas VBench-like (motion smoothness, temporal flickering) | frames amostrados do clipe | **ERRO** anatomia em plano próximo; **WARNING** em plano aberto | Anomalia anatômica em close = regerar sempre |
| C14 | Objetos piscando (blink in/out) | Contagem de objetos por LLM-vision em 3+ frames amostrados do mesmo clipe; objeto presente→ausente→presente = flicker | intra-clipe | **ERRO** se objeto da ação; **WARNING** periférico | Padrão típico: anel, botão, alça de bolsa |
| C15 | Texto em tela | LLM-vision/OCR: letreiros, rótulos, legendas dentro da imagem — IA gera texto corrompido | keyframes | **WARNING** (ERRO se texto é plot-relevante) | Texto ilegível em prop de fundo pode passar em plano aberto |
| C16 | Lipsync × áudio | Duração da fala TTS vs. movimento labial detectado; personagem errado com boca mexendo | clipe + faixa de áudio | **ERRO** | Check de sincronia, não de visão pura |

### 3.2 Política de decisão (quando bloquear vs. aceitar)

1. **Hierarquia Murch como política de gate**: o agente NUNCA bloqueia por continuidade espacial pura (C8, C10, C11) se o
   diretor-agente marcou o corte como intencional — emoção/história > espaço 3D. Esses checks emitem warning revisável.
2. **Identidade é inegociável**: C1/C2/C5 bloqueiam sempre. Personagem com outro rosto não é "erro de continuidade", é falha
   de produto — equivale a trocar o ator no meio da cena.
3. **Atenção pondera severidade** (change blindness, 1.10): o mesmo defeito é ERRO se está no foco de atenção (rosto, mãos,
   objeto manipulado, centro do quadro, plano fechado) e WARNING se periférico em plano aberto. Implementação: LLM-vision
   também responde "onde está a atenção neste frame?" e o defeito é cruzado com essa região.
4. **Erro → regeração dirigida**: o report do agente vira delta de prompt para a regeração ("mesmo prompt + reforçar: jaqueta
   verde-oliva, caneca na mão esquerda, luz de fim de tarde pela janela à direita"), imitando o continuísta que avisa o set
   antes do próximo take.
5. **Warnings acumulam score por cena**: 1 warning passa; N warnings na mesma cena (ex.: ≥3) escalam para revisão humana ou
   regeração — vários deslizes pequenos juntos quebram a ilusão mesmo que nenhum sozinho quebrasse.
6. **Artefatos persistidos** (o "lined script" do agente): por cena, um JSON de continuidade — figurino/props/luz canônicos,
   resultado por check por clipe, versão aprovada de cada clipe. É insumo do agente de montagem e auditoria do que foi aceito.

### 3.3 Mecanismos — resumo por tipo
- **Embeddings** (barato, objetivo, roda sempre): identidade facial (C1, C2), similaridade de locação/fundo (C6). Limiar calibrado com golden set.
- **LLM-vision estruturado** (JSON schema por frame: personagens, vestuário, objetos+mão, olhar, luz, anomalias): C3–C5, C7–C9, C13–C15. Um prompt único por keyframe extrai tudo; os checks são comparações sobre o JSON, não novas chamadas.
- **Regras sobre metadados** (sem visão, custo zero): C8/C10/C12 estrutural — o blueprint da cena declara eixo, direção de viagem e story day; o agente valida coerência declarativa antes mesmo de olhar pixels.
- **Sinal temporal**: fluxo óptico/motion smoothness e flicker (C13, C14) — métricas do estilo VBench (subject consistency, background consistency, temporal flickering, motion smoothness) são o análogo automatizável direto. [VBench, CVPR 2024; VBench-2.0; VideoPhy-2]

---

## 4. Limites e falsos positivos esperados

- **Luz engana cor** (falso positivo em C3/C5): a mesma jaqueta verde parece cinza em luz azulada. Mitigar comparando descrição
  semântica ("jaqueta militar") e não RGB; tolerância maior quando C7 detecta mudança de luz intencional.
- **Ângulo e oclusão** (C4, C14): prop "sumido" pode estar só fora de quadro ou atrás do corpo. O agente deve distinguir
  "ausente" de "não visível" — LLM-vision responde `visible | occluded | absent`, e só `absent` com o objeto esperado em quadro flagra.
- **Embedding facial em ângulo extremo/perfil/baixa luz** dá distância alta para o MESMO personagem → falso positivo em C1.
  Mitigar: múltiplos retratos canônicos (frontal, 3/4, perfil) e amostrar vários frames antes de condenar o clipe.
- **Direção de olhar é difícil em plano aberto** (C9): com rosto pequeno, LLM-vision erra screen-left/right. Só rodar eyeline
  check quando o rosto ocupa área mínima do quadro.
- **Estilização**: cenas não-realistas (sonho, flashback estilizado, animação) quebram os priors dos checks de luz e física.
  O blueprint deve poder marcar `style_exception` por cena.
- **Mudança diegética legítima ≠ erro**: personagem TIRA o casaco em cena, copo esvazia porque ele bebeu. Sem entender a ação,
  o diff flagra evolução legítima. Mitigar: o script da cena (ações descritas) entra no prompt do LLM-vision — "a mudança X é
  explicada por alguma ação do roteiro?". Este é o maior gerador de falsos positivos previsto.
- **Custo/latência**: rodar C1–C16 em todo frame é inviável; amostragem (3–5 keyframes/clipe) perde flickers rápidos. Aceitar:
  embeddings em mais frames (barato), LLM-vision só em keyframes, e check denso apenas quando um warning barato pede confirmação.
- **Limite honesto**: mesmo humanos profissionais deixam passar erros (seção 1.10) e mesmo VBench-2.0 admite que fidelidade
  intrínseca (física, senso comum) segue problema aberto. O agente reduz drasticamente a taxa de defeito visível; não a zera.
  Meta realista: zero erros de identidade (C1/C2) e zero anatomia grotesca em close (C13); o resto é gestão de risco por severidade.

---

### Fontes
Miller, *Script Supervising and Film Continuity* (3ª ed., Routledge) · Rowlands, *The Continuity Supervisor* (4ª ed., Focal) ·
Murch, *In the Blink of an Eye* (Rule of Six — via StudioBinder/ProVideo Coalition) · SetHero "Script Supervisor Report Explained" ·
Celtx "How to Line a Script" · EditStock "How to Read a Lined Script" · Wikipedia: Script supervisor, 180-degree rule, Eyeline match,
Screen direction, Cutting on action, Continuity editing, Jump cut, Change blindness · EditMentor Continuity series ·
StudioBinder (180°, screen direction, eyeline, continuity editing) · No Film School / SmartTVMag (continuidade de luz) ·
Genetic Literacy Project / Fstoppers / AIP (change blindness) · IndieWire/Cracked (erros famosos) ·
Oxford VGG "Visual Continuity Errors in Movies" (ACM CIVR 2009) · patente US 11.423.654 (detecção automática de erros de continuidade) ·
VBench (CVPR 2024) + VBench-2.0 · VideoPhy-2 · LTX/Kling/GetStream (temporal drift em vídeo gerado por IA).
