# 09 — Edição e montagem: como editores pensam, e como um agente avalia uma montagem

> Pesquisa para a base de conhecimento dos agentes de vídeo. Foco: extrair o raciocínio profissional
> (não ferramentas) e abstraí-lo em processo executável. Pipeline alvo: vídeos 100% gerados
> (imagem → image-to-video → TTS → lipsync → música), onde "editar" = selecionar, ordenar, durar e
> sincronizar planos gerados — com a opção única que editores de filme não têm: **regenerar o plano**.

---

## 1. Conceitos e princípios

### 1.1 Murch — a Regra dos Seis (In the Blink of an Eye)
Walter Murch define seis critérios para um corte ideal, **com pesos explícitos**:
**Emoção (51%) > História (23%) > Ritmo (10%) > Eye-trace (7%) > Planaridade 2D (5%) > Continuidade espacial 3D (4%)**.
A regra operacional: quando for preciso sacrificar algo, **abandone de baixo para cima** — nunca sacrifique
emoção por continuidade. Um corte que "quebra o eixo" mas preserva a emoção certa é um corte melhor do que
um corte tecnicamente perfeito que mata o momento. (Fontes: Murch, *In the Blink of an Eye*; StudioBinder
"Rule of Six"; Jonny Elwyn, "Walter Murch-opedia".)

Corolários de Murch:
- **Por que o corte funciona**: percebemos o mundo de forma descontínua ("editamos" a vida com piscadas e
  saltos de atenção; sonhos são justaposições abruptas). O corte imita a pontuação do pensamento.
- **Teoria da piscada**: atores bons piscam quando um pensamento termina; o ponto de corte natural coincide
  com esse "fim de pensamento". Heurística: **corte no fim de uma unidade de pensamento/emoção, não no fim
  do movimento físico**.
- **Montagem silenciosa**: Murch monta cenas de diálogo sem som ("leio lábios") para julgar se a cena
  funciona só pela imagem — se funciona muda, o áudio só melhora.

### 1.2 Escola soviética — sentido nasce da justaposição
- **Efeito Kuleshov**: o mesmo rosto neutro intercalado com sopa/caixão/criança é lido como fome/luto/ternura.
  O significado de um plano é função do plano vizinho. Consequência direta para agentes: **avaliar planos
  isoladamente é insuficiente — a unidade de avaliação é o par/sequência**. (Fontes: MasterClass "Soviet
  Montage"; estudo fMRI biorxiv 2023 confirma o efeito com filmes reais.)
- **Eisenstein — montagem intelectual**: o choque entre dois planos gera um terceiro sentido que não está em
  nenhum deles (operários metralhados ∥ boi no matadouro). Uso: quando se quer que o público **pense** uma
  ideia abstrata, não apenas sinta. Em conteúdo curto, é o mecanismo por trás de analogias visuais
  ("seu funil de vendas" ∥ imagem de peneira). (Fontes: StudioBinder; filmtheory.org.)

### 1.3 Tipos de corte e QUANDO usar cada um
| Corte | O que é | Quando usar |
|---|---|---|
| **Cut on action** | Corta no meio de um movimento que continua no plano seguinte | Default da continuidade invisível; o movimento mascara o corte. Use sempre que houver ação física entre dois ângulos |
| **Match cut** (gráfico/sonoro) | Dois planos ligados por forma, composição ou som semelhante | Transição de cena com sentido temático (osso→nave, 2001); elipse elegante de tempo/espaço |
| **Jump cut** | Corte na mesma câmera com salto temporal visível | Energia, urgência, passagem de tempo subjetiva (Godard, *Breathless*); **padrão dominante em talking-head short-form** para remover pausas e densificar fala |
| **Smash cut** | Corte abrupto com contraste violento de tom/volume | Sustos, ironia cômica (gritaria→silêncio), fim de cena em mistério |
| **J-cut** | Áudio da próxima cena entra antes da imagem | Antecipação, fluidez em diálogo e documentário; "puxa" o espectador para a cena seguinte |
| **L-cut** | Áudio da cena atual continua sobre a imagem seguinte | Mostrar reação de quem ouve; sair de cena sem cortar a fala; padrão em entrevistas |
| **Cross-cutting** | Alternância entre ações simultâneas em locais diferentes | Suspense, convergência de linhas narrativas, comparação implícita |
| **Montagem-sequência** | Série comprimida de planos cobrindo muito tempo | Elipse de processo (treino, construção, decadência), geralmente sobre música |
(Fontes: MasterClass "11 Essential Film Cuts"; Backstage; Wikipedia L-cut/Jump cut; StudioBinder.)

**Regra de motivação**: na edição de continuidade ("invisible editing", herança do cinema clássico de
Hollywood), **todo corte precisa de motivação** — uma ação, um olhar, um som, uma pergunta que o próximo
plano responde. Corte sem motivação é sentido como erro. Cortes expressivos (jump, smash, montagem
intelectual) quebram a invisibilidade **de propósito**: a violação é o efeito. O erro profissional não é
quebrar regras, é quebrá-las sem intenção legível. (Fontes: Oxford Reference "continuity editing";
StudioBinder "The Invisible Cut".)

### 1.4 Ritmo e pacing
- **O que determina a duração de um plano**: (a) tempo de leitura — quanta informação nova o quadro tem
  (plano geral denso precisa de mais tempo que um close já conhecido); (b) a emoção da cena (tensão = planos
  encurtando; contemplação = planos longos); (c) a "validade" do plano — Murch: corte quando o plano
  esgotou o que tinha a dizer, nem um frame depois; (d) a música/fala que o acompanha.
- **Baseline e desvio**: filmes modernos têm ASL (average shot length) de ~4–6s; o baseline estabelece o
  "andamento neutro" e o editor cria significado **desviando** dele — encurtando para intensificar,
  alongando para dar respiro. Extremos de referência: *2001* ASL ≈ 13s; *Bourne Supremacy* ASL ≈ 2,4s.
  Cinemetrics/Barry Salt/Bordwell: ASL médio caiu de 8–11s (pré-1960) para 2–4s hoje. Ressalva acadêmica:
  ASL sozinho esconde a variação interna — a **distribuição** e a **curva** de durações importam mais que a
  média. (Fontes: Cinemetrics/U.Chicago; Filmmakers Academy; Lightworks "Rhythm and Pace".)
- **Variação rítmica**: ritmo constante anestesia. A regra prática é alternância tensão/repouso — sequências
  rápidas ganham força por contraste com as lentas que as cercam (Schoonmaker: "it's all about timing and
  rhythm"). Em música: cortar **com** a estrutura musical (frases, viradas, downbeats) quando se quer
  impulso (*Baby Driver*), e **contra** ela quando se quer atrito. Cortar exatamente em todo beat vira
  metrônomo; editores cortam perto do beat, deixando a ação "cair" no beat.

### 1.5 Short-form e retenção (fonte: guias de plataforma + dados OpusClip/Subscribr)
- **Hook (0–3s)**: a decisão de continuar é tomada nos primeiros 1–3 segundos; o hook deve pagar a promessa
  do título/capa — mismatch gera queda imediata na curva de retenção.
- **Densidade de corte**: benchmark de 1 corte a cada 1,5–3s (TikTok), 2,5–4s (Reels), 3–5s (Shorts
  tutorial). Após ~12–15s de quadro estático (mesmo ângulo/enquadramento), a rolagem dispara.
- **Pattern interrupts**: mudança de ângulo, zoom, texto, b-roll ou som a cada ~5–8s para resetar a atenção;
  open loops (perguntas não respondidas) a cada 10–15s.
- **Buracos matam**: dead frames e silêncios são a maior causa de sangria de retenção mid-clip — todo
  segundo precisa de movimento visual OU sonoro.
- **Leitura da curva de retenção** (YouTube Analytics): queda >5pp em <20s = evento diagnosticável.
  Queda nos primeiros 30s = hook/promessa; declínio constante no meio = pacing; vale em timestamp
  específico = trecho ruim; platô/subida = padrão a replicar.

### 1.6 Relação imagem-áudio
O áudio lidera mais do que parece: J/L-cuts costuram cenas; a música define o andamento antes do primeiro
corte (muitos editores cortam "sobre" a trilha-guia); o som contínuo (room tone, música) é o que torna
cortes de imagem invisíveis — **cortar imagem e áudio no mesmo frame é o que denuncia o corte**. Em vídeo
gerado por IA, onde o áudio (TTS + música) costuma existir antes da imagem, isso vira vantagem: a narração
é a espinha rítmica e os planos são cortados contra ela.

---

## 2. Como o editor decide — o processo real

**Dailies → selects.** Editor (ou assistente) organiza o material por cena, assiste tudo, e "puxa selects":
stringouts com os melhores takes, anotando reações de primeira impressão. Schoonmaker assiste dailies **com**
Scorsese tomando notas copiosas — é onde o diretor verbaliza a intenção. Murch anota a **primeira reação
emocional** a cada take, porque ela prediz a reação do público e nunca mais se repete (o editor é a
primeira plateia; a objetividade se perde com a repetição).

**Assembly (montagem bruta).** Toda cena montada na ordem do roteiro com os takes preferidos, sem música/
efeitos, longa demais por definição. Objetivo: ver o filme inteiro existir. Não se julga qualidade aqui —
julga-se **estrutura**: a história fecha? o que é redundante?

**Rough cut.** Passes estruturais: cortar/encurtar/reordenar cenas inteiras, trocar takes conforme notas do
diretor, encontrar a duração-alvo. Pergunta dominante: **"esta cena/plano ganha o seu tempo de tela?"** É a
fase de matar darlings — cenas boas que não servem ao todo saem. O primeiro screening com o diretor é
assistido **sem interromper**, notas depois; parte do trabalho do editor é conter o pânico do diretor
diante do primeiro corte.

**Fine cut.** Decisões no nível do frame: ponto exato de cada corte, respiração de performance, J/L-cuts,
ritmo interno de cada cena, transições. A pergunta muda de "o que fica" para "**quando exatamente** corto".

**Picture lock.** Timing congelado; nada entra ou sai. Só então som, mixagem, cor e VFX finalizam sobre uma
base estável. Lição de processo para agentes: **estrutura antes de polish** — refinar frame a frame antes
de a estrutura estar aprovada é retrabalho garantido.

**Como o editor diagnostica uma edição ruim (sinais e causas):**
1. **Cena arrastada** — você sente vontade de olhar o celular; causa típica: planos que continuam após
   esgotar sua informação/emoção, entradas e saídas de cena tarde/cedo demais ("enter late, leave early").
2. **Corte que confunde geografia** — espectador perde quem está onde/olhando para quem; causas: quebra do
   eixo de 180° sem plano de transição, falta de establishing, eyelines incoerentes.
3. **Corte sem motivação** — o público "sente" o corte; nada no plano A pedia o plano B (nenhum olhar, som,
   pergunta ou ação puxando).
4. **Ritmo monótono** — durações quase iguais por muito tempo; a cena vira metrônomo, mesmo rápida.
5. **Falso raccord / continuidade quebrada sem intenção** — posição/figurino/gesto saltam entre planos
   contíguos que fingem continuidade (≠ jump cut intencional).
6. **Emoção errada no rosto** — pela lente de Kuleshov: o plano de reação escolhido reprograma o sentido da
   cena; take "bonito" com emoção errada é pior que take feio com emoção certa (Regra dos Seis aplicada).
7. **Áudio denunciando** — cortes de imagem+som no mesmo frame, saltos de room tone, música que não
   conversa com os cortes.

---

## 3. Abstração: Agente Editor/Avaliador de Montagem

Papel duplo: (a) **montador** — decide ordem, duração e transição dos planos gerados; (b) **avaliador** —
diagnostica uma timeline existente e propõe correções específicas. No pipeline gerado, o agente tem três
verbos que o editor humano tem — *recortar, reordenar, retimear* — mais um exclusivo: ***regenerar*** o
plano (novo prompt de imagem/vídeo) quando o material em si é o problema.

### Inputs
- **EDL/timeline estruturada**: lista de planos com {id, in/out, duração, prompt de origem, tipo de plano
  (close/médio/geral), sujeito, movimento de câmera, transição usada}.
- **Trilha de áudio com timestamps**: narração transcrita palavra-a-palavra (do TTS), marcação de beats e
  seções da música, mapa de silêncios.
- **Roteiro/beat sheet** com intenção emocional por beat (do agente roteirista) — é o "diretor" contra o
  qual a montagem é julgada.
- **Frames-chave por plano** (primeiro/meio/último) para análise LLM-vision.
- Opcional: **curva de retenção real** de vídeos publicados (feedback loop).

### Outputs
- Nota por critério + lista de **issues acionáveis**, cada um com: timestamp, sinal detectado, diagnóstico,
  correção proposta (uma das 4 ações) e prioridade (ordenada pela Regra dos Seis: emoção > história >
  ritmo > eye-trace > continuidade).
- Nova EDL proposta (quando em modo montador).

### Métricas computáveis (baratas, sem vision)
- **Curva de durações**: duração de cada plano em sequência. Derivar: ASL, desvio-padrão (σ≈0 por >6 planos
  = monotonia), tendência local (aceleração/desaceleração vs. intenção emocional do beat), plano-outlier
  (>2σ acima sem justificativa de beat = candidato a arrastado).
- **Densidade de corte por janela de 5s** vs. benchmark da plataforma (short-form: alerta se janela sem
  corte nem movimento >4s; se quadro estático >12s, crítico).
- **Alinhamento áudio-corte**: distância de cada corte ao limite de frase da narração e ao beat musical
  (cortes no meio de palavra = erro; 100% dos cortes em beat = metrônomo — alvo é maioria perto, não em cima).
- **Mapa de buracos**: janelas sem fala E sem movimento visual E sem evento musical = dead air.
- **Estrutura de hook**: o conteúdo dos 3 primeiros segundos entrega a promessa do título/capa? (checagem
  LLM texto: transcrição 0–3s vs. hook prometido.)
- **Taxa de variedade**: n° de planos consecutivos com mesmo enquadramento/sujeito (>2 iguais em short-form
  = pattern interrupt ausente).
- Com dados reais: **detecção de quedas >5pp/20s na curva de retenção** e correlação com o plano exibido
  naquele timestamp.

### Análise LLM-vision sobre a sequência (cara, aplicar após triagem)
Passar trincas de planos (A→B→C, frames-chave + descrição) e perguntar, por par:
1. **Motivação**: o que em A pede B? (olhar, ação, pergunta na narração, som) — se nada, corte imotivado.
2. **Kuleshov-check**: a emoção lida na justaposição A+B é a emoção que o beat sheet pede?
3. **Geografia**: sujeitos mantêm lado/eyeline coerente? há establishing quando o local muda?
4. **Eye-trace**: onde o olho está no fim de A vs. onde a informação entra em B (salto grande sem intenção
   = corte áspero)?
5. **Falso raccord**: entre planos que fingem continuidade, o sujeito/figurino/pose saltam? (Em vídeo
   gerado isso é o defeito nº1: consistência de personagem entre planos.)
Literatura de apoio: "Shot Sequence Ordering for Video Editing" (arXiv 2503.17975) formaliza classificação
de atributos de plano, next-shot selection e ordenação como tarefas de ML; "L-Storyboard" (ScienceDirect)
mostra que representar planos como descrições estruturadas de linguagem é a interface certa para LLM.

### Checklist de diagnóstico (ordem de execução)
1. Estrutura antes de frame: história fecha? beats na ordem certa? (assembly-level)
2. Hook entrega a promessa em ≤3s? primeiro frame tem movimento?
3. Cada plano ganha seu tempo? (outliers de duração × informação nova no quadro)
4. Curva de ritmo casa com a curva emocional do roteiro? há variação?
5. Todos os cortes motivados OU expressivos-com-intenção? nenhum imotivado?
6. Geografia e continuidade legíveis? (só depois de 1–5 — peso 4–5% na hierarquia de Murch)
7. Áudio: J/L-cuts onde há troca de cena? nenhum corte de imagem+som no mesmo frame? dead air zero?
8. Últimos 3–5s: CTA/fechamento sem enrolação (short-form).

### Como propor correção específica (mapear diagnóstico → ação)
- **Plano arrastado** → *recortar*: novo out-point no fim da última informação nova (âncora: fim da frase
  de narração correspondente).
- **Corte imotivado** → *retimear/reordenar*: mover o corte para um ponto de ação/piscada/fim de frase; ou
  inserir plano-ponte (b-roll gerado) que crie a motivação.
- **Emoção errada na justaposição** → *reordenar* (trocar o plano de reação) ou *regenerar* o plano com
  prompt corrigido de expressão.
- **Monotonia rítmica** → *recortar* alternando durações; inserir pattern interrupt (zoom punch-in é
  gerável por crop, custo zero).
- **Geografia confusa / falso raccord / personagem inconsistente** → *regenerar* com prompt de
  continuidade (mesma seed/referência de personagem, eixo respeitado) — a correção que só existe em
  pipeline generativo.
- **Dead air** → *recortar* o silêncio ou preencher com evento sonoro/b-roll.
- Sempre: propor **uma correção por vez** no nível mais alto da hierarquia (emoção primeiro), re-avaliar,
  iterar — espelhando os passes assembly→rough→fine, nunca "consertar tudo" num passe só.

---

## 4. Limites — o que não automatizar

- **O julgamento de emoção é o topo da hierarquia e é o menos computável.** Métricas de ritmo pegam
  monotonia, não pegam "este take tem a alma errada". LLM-vision aproxima, mas o gate final de "isso
  emociona?" deve ser humano enquanto não houver golden set com avaliação humana correlacionada.
- **Não otimizar retenção contra a intenção.** Densidade de corte máxima é ótimo local: um vídeo inteiro a
  1 corte/1,5s sem respiro cansa e nivela tudo (a própria pesquisa de plataforma nota que público mais
  velho/calmo rejeita edição frenética). Benchmarks são baseline por gênero/público, não lei.
- **Regras de continuidade não são invioláveis** — são o fundo da lista de Murch. Um agente que "corrige"
  todo jump cut e toda quebra de eixo destrói estilo. A distinção intencional/acidental exige contexto de
  intenção (beat sheet); na dúvida, **flag, não fix**.
- **Primeira impressão não se regenera.** O valor do editor-como-primeira-plateia vem de ver com olhos
  frescos; um agente que itera 40 vezes sobre a mesma timeline "vicia" igual humano. Mitigação: avaliação
  por instância limpa (sem histórico das iterações) a cada N passes.
- **Não pular fases**: polish automático (fine-cut) antes de aprovação estrutural humana (rough-cut) queima
  compute e ancora decisões erradas. O gate humano certo fica entre rough e fine.
- **Kuleshov corta nos dois sentidos**: o agente manipula leitura emocional por justaposição; em conteúdo
  factual/comercial, revisar se a justaposição não implica algo falso.

### Fontes principais
Murch, *In the Blink of an Eye* (via StudioBinder, Jonny Elwyn "Murch-opedia", ProVideo Coalition) ·
Schoonmaker: CineMontage, Fresh Air/NPR, No Film School · Soviet montage/Kuleshov: MasterClass,
filmtheory.org, biorxiv fMRI 2023 · Cortes: MasterClass "11 Essential Film Cuts", Backstage, Wikipedia ·
Workflow: Filmsupply "From Assembly to Picture Lock", Frame.io Workflow Guide, Noam Kroll · Ritmo: Lightworks,
Cinemetrics (U. Chicago), Filmmakers Academy · Retenção short-form: OpusClip, Subscribr, Shortzly, jetfuel ·
Computacional: arXiv 2503.17975 (Shot Sequence Ordering), L-Storyboard (ScienceDirect), NVIDIA VSS blueprint.
