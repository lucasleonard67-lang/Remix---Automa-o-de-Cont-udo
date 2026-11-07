# Pesquisa 04 — Storyboard e planejamento visual

> Como produções profissionais transformam roteiro em sequência visual — e como abstrair isso
> em um contrato estruturado entre agentes de IA (imagem → i2v → TTS → lipsync → montagem).

---

## 1. Conceitos e princípios

### 1.1 Storyboard: o documento que diz O QUE filmar/gerar
- Série de quadros estáticos, um por plano, como "versão em quadrinhos" da cena. É documento de **comunicação multiequipe**: o DP lê enquadramento, o AD conta setups, a arte prepara cenário/props ([Storybirdie](https://storybirdie.com/blog/storyboard-vs-animatic-difference), [Storyflow](https://storyflow.so/blog/storyboard-vs-animatic-complete-guide)).
- Cada quadro contém: personagens, cenário e objetos importantes + anotações de movimento de câmera, ação do personagem, diálogo/VO, som e iluminação ([Boords](https://boords.com/how-to-storyboard/tv-commercial)).
- **Setas** são a linguagem padrão de movimento: setas junto a personagens/objetos = movimento em cena; setas nas bordas do quadro = movimento de câmera (pan, tilt, zoom, push-in). Seta + nota escrita torna a intenção inequívoca ([StudioBinder — storyboard arrows](https://www.studiobinder.com/blog/storyboard-arrows-meaning/), [Boords — camera moves](https://boords.com/create/camera-moves)).
- John Hart (*The Art of the Storyboard*): o board comunica **continuidade** ao fotógrafo, cenógrafo e VFX; os componentes essenciais são enquadramento, colocação de figuras e ângulo de câmera — desenhados com perspectiva, luz/sombra e profundidade de campo suficientes para ler a intenção, não para serem arte final ([Focal Press](https://www.routledge.com/The-Art-of-the-Storyboard-2nd-Edition-A-Filmmakers-Introduction/Hart/p/book/9780240809601)).

### 1.2 Framed Ink: composição a serviço do corte
- Marcos Mateu-Mestre (DreamWorks/Sony) sistematiza três níveis: (1) compor uma imagem isolada; (2) compor um plano estável; (3) **compor para a continuidade entre todos os planos** — a composição de um quadro só está certa em relação ao quadro anterior e ao seguinte ([Framed Ink](https://designstudiopress.com/products/framed-ink)).
- *Framed Ink 2* adiciona a "energia do quadro": push-pull, tensão-relaxamento, equilíbrio-desequilíbrio dentro da área útil como suporte da dramaturgia. Princípio-chave para agentes: **cada plano tem uma função dramática, e a composição codifica essa função** (negativo = isolamento/medo; ângulo baixo = poder; espaço de olhar = expectativa).

### 1.3 Storyboard vs shooting board vs animatic vs previz
- **Storyboard (apresentação)**: vende a ideia; legível para leigos.
- **Shooting board (produção)**: mesmos planos com detalhe técnico — lente, movimento exato, setup — feito pelo diretor/DP depois da aprovação criativa; "o cliente vê o presentation board, a equipe vê o production board" ([Storybirdie](https://storybirdie.com/blog/how-to-storyboard-a-commercial), [Storyflow](https://storyflow.so/blog/how-to-storyboard-a-commercial-2026)).
- **Animatic / story reel**: quadros sequenciados com TEMPO — scratch dialogue, música temp, SFX. "O storyboard diz o que filmar; o animatic diz se o que você planeja funciona como filme" ([Storybirdie](https://storybirdie.com/blog/storyboard-vs-animatic-difference)). É onde o pacing é a variável de risco; em animação é inegociável porque não existe footage de fallback ([M Studio](https://mstudio.ai/blog/storyboarding/what-is-an-animatic)).
- **Previz**: versão 3D com proxies de câmera/atores/sets para ação complexa e VFX; "sandbox virtual" para staging, composição, edição e luz antes de tentar o final. Deriva em **techvis** (planejamento físico: posição de sol, gruas) e **postvis** (compor dailies com CG placeholder para continuar editando) ([The Third Floor](https://thethirdfloorinc.com/3863/virtual-visualization-series-pitchvis-previs/), [VFX Voice — The Last Jedi](https://vfxvoice.com/the-last-jedi-previs-postvis-and-techvis-explained/)).

### 1.4 Shot list profissional: campos e numeração
Campos canônicos ([StudioBinder](https://www.studiobinder.com/blog/how-to-make-a-shot-list/)):
`scene #` · `shot # (letra/número)` · `descrição` (curta e direta) · `shot size` (ECU/CU/MCU/MS/MWS/WS/EWS) · `ângulo` (eye/low/high/OTS/POV) · `movimento` (static/pan/tilt/dolly/handheld/crane) · `equipamento` · `lente/focal` · `int-ext` · `dia-noite` · `elenco no plano` · `áudio` · `notas`.
- Numeração: cenas numeradas a partir do roteiro; planos por cena com letras (Cena 4, planos 4A, 4B, 4C…). Os números **sincronizam roteiro ↔ shot list ↔ cronograma** — são a chave estrangeira da produção inteira ([StudioBinder](https://www.studiobinder.com/blog/what-is-a-shot-list-example/)).
- **Cobertura (coverage)**: o conjunto de posições de câmera que uma cena exige — master + singles + inserts — planejado para o editor ter opções. Diretor/DP preenchem a shot list quebrando a cena em coberturas ([StudioBinder](https://www.studiobinder.com/blog/how-to-make-a-shot-list/)).

### 1.5 Decupagem (découpage): o corte é decidido no papel
- Découpage tem três sentidos entrelaçados: a forma final do roteiro, a **quebra do filme em planos antes de filmar**, e a estrutura do filme pronto. É um "plano de edição" que precede a filmagem — a montagem começa como decisão de escrita, não de pós ([Film Studies For Free](https://filmstudiesforfree.blogspot.com/2014/03/on-cinematic-decoupage.html), [Beverly Boy](https://beverlyboy.com/filmmaking/understanding-the-concept-of-decoupage-in-early-film/)).
- Implicação central: **há continuidade entre roteiro e edição imposta por quem carrega o projeto do início ao fim**. Découpage "corta" o roteiro em visuais; montagem "monta" os visuais em emoção. Para agentes: o pipeline deve decidir o corte ANTES de gerar, não descobrir o corte depois.

### 1.6 Continuidade visual planejada
- Regra dos 180°, direção de tela e eyeline match são parte do "sistema de continuidade" — o modo padrão de planejar/filmar/editar para o espectador não se perder. Personagem à esquerda olha para a direita da tela e vice-versa; quebrar a linha inverte a geografia ([MasterClass](https://www.masterclass.com/articles/understanding-the-180-degree-rule-in-cinematography), [learnaboutfilm](https://learnaboutfilm.com/film-language/sequence/180-degree-rule/)).
- O storyboard é a ferramenta onde isso se verifica: alinhando painéis em ordem, confere-se direção de tela, eyelines e relações espaciais **antes** de gerar/filmar. Quando a linha é cruzada de propósito, isso "foi storyboardado e planejado" ([Frame.io](https://blog.frame.io/2016/08/01/180-degree-rule-and-when-to-break-it/)).
- Transições também são planejadas no board: cut, match cut, dissolve, wipe, J/L-cut de áudio — anotadas entre painéis, porque a transição é uma decisão narrativa, não um efeito de pós.

### 1.7 Animação: o storyboard é o documento CENTRAL
- **Pixar**: story artists "desenham o filme, redesenham, e redesenham de novo por anos". O editorial junta os boards num **story reel** frame a frame; o filme inteiro existe como reel antes de qualquer animação. O reel é exibido em screenings repetidas com notas/reescritas/redesenhos; enredo, pacing e até ângulos de câmera são refinados na fase de story ([Science Behind Pixar](https://sciencebehindpixar.org/pipeline/story-and-art), [Fuller — Pixar's Storytelling Process](https://fuller.edu/next-faithful-step/classes/cf565/pixars-storytelling-process/)).
- **Braintrust** (Catmull, *Creativity, Inc.*): a cada poucos meses, screening do reel + sessão de notas cândidas de diretores pares. Premissa: "no começo, todos os nossos filmes são ruins" — o processo existe para ir de "suck" a "not-suck" iterando o reel, quando mudar é barato ([Pixar Post — excerpt](https://pixarpost.com/2014/03/the-pixar-braintrust-excerpt-from-ed.html), [Fast Company](https://www.fastcompany.com/3027135/inside-the-pixar-braintrust)).
- **Anime (ekonte / 絵コンテ)**: o storyboard é o "roteiro visual", geralmente desenhado pelo próprio diretor do episódio. Folha padrão de 5 colunas: **nº do cut · desenho · descrição da ação/câmera · diálogo · duração em segundos+frames**. Pipeline: roteiro → ekonte → layout → genga → douga → pintura → compositing. O **layout** expande cada cut do ekonte no esqueleto real do plano (câmera + fundo + poses-chave) ([Sakuga Blog](https://blog.sakugabooru.com/glossary/storyboard/), [gengaland — terminologia](https://gengaland.blogspot.com/2021/11/anime-staff-production-terminology.html)). Nota: o ekonte já traz timing por cut — o "animatic" está embutido no board.

### 1.8 Publicidade: o board é o documento de aprovação
- "Nenhum comercial é aprovado só no roteiro — a assinatura do cliente acontece sobre o storyboard." Agências usam boards para vender o script ao cliente E para briefar a produtora ([Storyflow](https://storyflow.so/blog/how-to-storyboard-a-commercial-2026), [MakeStoryboard](https://makestoryboard.com/blog/how-to-create-storyboard-like-big-ad-agencie)).
- Fluxo típico (Boords, guia de TVC): shot list a partir do script → board com campos (Sound, Action, Lighting, Camera, Notes) → setas de movimento → **animatic com VO cronometrado** → feedback do time → aprovação escrita do cliente → shooting board técnico. Estrutura narrativa de 30s: hook → problema → solução → objeções → CTA, com o "brand beat" inconfundível e legível para leigo ([Boords](https://boords.com/how-to-storyboard/tv-commercial)).
- Racional econômico: cliente reage a visual mais rápido que a texto; mudar no board custa quase zero, mudar no set custa a diária.

### 1.9 O que reprova um board (revisão profissional)
O que se avalia num board — e os motivos típicos de reprovação:
1. **Legibilidade do staging**: se a ação não se lê em silhueta/formas grandes em 2 segundos, falhou. "Clareza de staging e pose é a chave; enfatize design composicional e formas grandes, não detalhe" ([floobynooby/Ron Doucet — comp notes](http://www.floobynooby.com/comp1.html), [Whizzy Studios](https://www.whizzystudios.com/post/what-mistakes-should-be-avoided-in-storyboarding)).
2. **Painel sobrecarregado**: informação demais num quadro mata a comunicação ([Studiovity](https://blog.studiovity.com/storyboard-rules-the-dos-and-donts-of-storyboarding/)).
3. **Fluxo narrativo**: cortes confusos, transições abruptas, painel que não leva logicamente ao próximo.
4. **Continuidade**: direção de tela invertida, eyeline errado, geografia inconsistente.
5. **Pacing** (só visível no animatic): "painéis que ficam bons no papel podem não ter o ritmo certo" — o diretor, ao cronometrar o board no animatic, muda cortes, direção de tela e nº de poses ([Toon Boom — story artists](https://www.toonboom.com/what-storyboard-artists-do-according-to-storyboard-artists), [Brown Bag Films — revisions](https://www.brownbagfilms.com/labs/entry/what-are-storyboard-revisions)).
6. **Técnica**: aspect ratio errado, safe areas ignoradas.
7. **Serve à história?** — a pergunta final do Braintrust: o plano bonito que não serve ao beat é cortado.
- Ritual: story artists **pitcham** os boards (apresentam atuando a sequência) para diretor/supervisores toda semana; notas viram redesenho; existe a função dedicada de *storyboard revisionist* em estúdios de TV ([Toon Boom](https://www.toonboom.com/what-storyboard-artists-do-according-to-storyboard-artists)).

---

## 2. Como o profissional decide — roteiro → board → animatic → aprovação

O processo real, sintetizado das fontes acima (Pixar, anime, publicidade, live-action):

1. **Quebra do roteiro em beats** — antes de desenhar qualquer coisa, o diretor/story artist lista os beats dramáticos: o que cada momento precisa comunicar e qual emoção carrega. Beat boards (1 imagem por momento-chave) em desenvolvimento.
2. **Decupagem: beats → planos** — decisão de cobertura: quantos planos o beat precisa, qual é o plano "âncora" (master/establishing), onde entram inserts e reações. A pergunta guia não é "que imagem é bonita" e sim "**de onde a audiência precisa ver isto, e por quê**". Cada corte planejado tem motivação (nova informação, reação, mudança de eixo dramático).
3. **Thumbnails** — rascunhos minúsculos e rápidos da sequência inteira, para testar o fluxo de leitura entre quadros antes de investir em desenho. Iterar aqui é quase grátis.
4. **Board limpo com anotações** — cada painel: composição legível em silhueta + setas de movimento + nota de câmera + diálogo + transição para o próximo. O par plano-a-plano é verificado: 180°, eyelines, direção de tela, variação de tamanho de plano entre cortes (cortar entre tamanhos muito próximos "pula").
5. **Pitch interno** — o artista apresenta a sequência atuando; diretor dá notas; redesenho. Repete-se semanalmente.
6. **Animatic / story reel** — editorial monta os painéis com scratch dialogue, música temp e duração por painel. Aqui se descobre a verdade sobre pacing: planos são encurtados, cortados, reordenados. Em feature animation o reel do filme INTEIRO é assistido em screening → notas do Braintrust/direção → nova iteração (Pixar faz isso por anos).
7. **Aprovação** — animação: sequência "locked" no reel libera layout/animação; publicidade: cliente assina sobre board/animatic cronometrado; live-action: shooting board + shot list técnica derivadas do board aprovado.
8. **Regra econômica que governa tudo**: cada etapa posterior é ~10x mais cara de mudar. O sistema inteiro existe para forçar as decisões criativas para a fase mais barata.

---

## 3. Abstração para agentes de IA

### 3.1 Deve existir storyboard estruturado antes da geração? SIM — é a tese central
Todas as tradições convergem: **nada caro é produzido antes de o filme existir como sequência barata aprovada**. Para um pipeline generativo, "caro" = créditos de i2v/lipsync/render + tempo. Logo:
- O storyboard estruturado é o **contrato** que precede toda geração.
- O equivalente do animatic é montável quase de graça: keyframes gerados (imagem, barata) + TTS scratch + durações → vídeo-rascunho. Validar pacing AÍ, antes de gastar i2v.
- O equivalente do "lock de sequência": nenhum agente de geração de vídeo roda sobre um plano cujo storyboard não está `approved`.

### 3.2 Estrutura de dados sugerida (storyboard/shot list digital)

```yaml
project:
  aspect_ratio: "9:16"          # validável em todos os assets
  fps: 24
  style_bible_ref: uuid          # paleta, iluminação, estética global
  characters: [{id, name, ref_images[], voice_id, wardrobe_notes}]
  locations:  [{id, name, ref_images[], lighting_notes}]

scenes:                          # numeração de cena vem do roteiro
  - scene_no: 4
    slug: "INT. COZINHA - NOITE"
    beat: "protagonista descobre a carta"      # função dramática da cena
    emotional_arc: "curiosidade -> choque"
    location_id: uuid
    shots:
      - shot_id: "4A"            # cena+letra, chave estrangeira universal
        order: 1
        intent: "estabelecer geografia; ela está só"   # POR QUE o plano existe
        shot_size: WS            # enum: ECU|CU|MCU|MS|MWS|WS|EWS
        angle: eye               # enum: eye|low|high|ots|pov|dutch|aerial
        camera_move: {type: slow_push_in, target: "carta na mesa", speed: subtle}
        composition_notes: "regra dos terços; carta no ponto de força; muito negativo à esq."
        characters_in_shot: [{char_id, screen_side: left, facing: right, eyeline: "para a carta"}]
        action: "Ela entra, para, nota a carta."
        dialogue: null           # ou {char_id, text, delivery: "sussurrado"}
        sfx: ["porta fecha"]     # som diegético
        duration_s: 4.0          # timing planejado (ekonte!)
        transition_out: cut      # cut|dissolve|match_cut|wipe|J_cut|L_cut
        continuity: {axis_line: "ela<->carta", side: A, motion_direction: "L->R"}
        lighting: "prática quente da luminária; resto frio"
        assets:                  # preenchidos pelos agentes de execução
          keyframe_image: {url, status, seed, prompt_used}
          video_clip: {url, status, model, motion_prompt}
          tts_clip: {url, status}
        status: draft|boarded|animatic_ok|approved|generated|final
        revision_notes: [{author, note, resolved}]
```

Campos-chave que NÃO podem faltar (é o que distingue board profissional de lista de prompts): `intent` (função dramática — base de qualquer revisão), `duration_s` (o corte planejado), `transition_out`, `continuity` (eixo/lado/direções), `screen_side + eyeline` por personagem, e a **numeração cena/plano como FK** entre roteiro, board, assets e timeline.

### 3.3 O storyboard como contrato entre agentes
- **Agente roteirista** escreve `scenes[].beat` + diálogo → **agente decupador** (o "diretor") converte beats em `shots[]` com intent, tamanho, ângulo, duração e transição → **agente crítico/revisor** valida o board → **agente de imagem** gera 1 keyframe por shot obedecendo `composition_notes`/`continuity` → montagem do **animatic** (keyframes + TTS + durações) → gate de aprovação (humana ou crítico) → **agentes de i2v/lipsync/música** executam plano a plano → **agente montador** corta exatamente nas `duration_s`/`transition_out` planejadas.
- Cada agente lê e escreve apenas seus campos; `status` por shot é a máquina de estados; mudanças após `approved` geram nova revisão explícita (como no estúdio: sequência re-aberta, não editada em silêncio).
- O par presentation/shooting board vira: uma **view de aprovação** (keyframes + legendas legíveis para o cliente) e a **view técnica** (prompts, seeds, modelos) sobre o mesmo dado.

### 3.4 Validações automatizáveis (lint de storyboard)
1. **180°/direção de tela**: dentro de um mesmo `axis_line`, `side` não pode inverter sem plano-ponte (neutro/POV) ou flag deliberada.
2. **Eyeline**: em campo/contracampo, `facing` dos dois personagens deve ser oposto.
3. **Salto de tamanho**: cortes entre tamanhos adjacentes demais (MS→MCU do mesmo sujeito, mesmo ângulo) → warning de jump cut.
4. **Variação**: >2 planos consecutivos com mesmo `shot_size`+`angle` → warning de monotonia.
5. **Duração vs conteúdo**: `duration_s` menor que o áudio do diálogo do plano → erro; plano de estabelecimento <1.5s → warning.
6. **Cobertura mínima da cena**: cena com diálogo sem nenhum plano de reação → warning.
7. **Órfãos**: personagem citado na ação sem `char_id` registrado; localização sem ref.
8. **Aspect ratio/técnica**: todos os assets no AR do projeto; texto/CTA dentro de safe area.
9. **Continuidade de estado**: props/figurino declarados num plano devem persistir nos seguintes da mesma cena (checável por visão sobre keyframes).
10. **Estrutura (publicidade)**: presença de hook nos primeiros N segundos e CTA no fim, quando o template exigir.

---

## 4. Limites — o que NÃO automatizar

1. **O gosto do corte**: pacing fino é julgamento assistido ("no papel parecia certo, no reel não"). O animatic existe porque humanos sentem ritmo; um agente pode propor durações, mas o gate de aprovação do animatic deve permanecer humano (ou no mínimo com override humano fácil).
2. **A nota criativa tipo Braintrust**: o valor da revisão Pixar é candor entre pares que enxergam o problema, não a solução prescrita. Um agente crítico pode apontar violações de lint e clareza; não deve reescrever a intenção dramática do "diretor" (humano ou agente-diretor) automaticamente.
3. **Quebra deliberada de regras**: cruzar os 180°, jump cuts, quebras de eixo são ferramentas expressivas quando planejadas. As validações devem ser warnings suprimíveis com justificativa (`deliberate: true` + nota), nunca bloqueios rígidos.
4. **Intent dramático**: `intent` de cada plano é a decisão autoral central — se o agente decupador o gera, um humano precisa poder editá-lo ANTES da cascata de geração, porque todo o resto deriva dele.
5. **Iteração ilimitada**: estúdios iteram reels por anos; um produto precisa de orçamento de iteração (N rodadas de board grátis, geração cara só pós-aprovação) — o processo, não a perfeição, é o que se copia.
6. **Aprovação de marca/cliente**: em uso publicitário, a assinatura sobre o board/animatic é jurídico-comercial; deve ser um checkpoint humano explícito e registrado.

---

### Fontes principais
Pixar pipeline/story reel ([Science Behind Pixar](https://sciencebehindpixar.org/pipeline/story-and-art); [Fuller](https://fuller.edu/next-faithful-step/classes/cf565/pixars-storytelling-process/)) · Braintrust ([Pixar Post/Creativity Inc.](https://pixarpost.com/2014/03/the-pixar-braintrust-excerpt-from-ed.html); [Fast Company](https://www.fastcompany.com/3027135/inside-the-pixar-braintrust)) · Ekonte/anime ([Sakuga Blog](https://blog.sakugabooru.com/glossary/storyboard/); [gengaland](https://gengaland.blogspot.com/2021/11/anime-staff-production-terminology.html)) · Shot list ([StudioBinder](https://www.studiobinder.com/blog/how-to-make-a-shot-list/)) · Setas/câmera ([StudioBinder](https://www.studiobinder.com/blog/storyboard-arrows-meaning/); [Boords](https://boords.com/create/camera-moves)) · TVC/aprovação ([Boords](https://boords.com/how-to-storyboard/tv-commercial); [Storyflow](https://storyflow.so/blog/how-to-storyboard-a-commercial-2026)) · Board vs animatic ([Storybirdie](https://storybirdie.com/blog/storyboard-vs-animatic-difference); [M Studio](https://mstudio.ai/blog/storyboarding/what-is-an-animatic)) · Previz ([The Third Floor](https://thethirdfloorinc.com/3863/virtual-visualization-series-pitchvis-previs/); [VFX Voice](https://vfxvoice.com/the-last-jedi-previs-postvis-and-techvis-explained/)) · Découpage ([Film Studies For Free](https://filmstudiesforfree.blogspot.com/2014/03/on-cinematic-decoupage.html)) · Continuidade ([MasterClass](https://www.masterclass.com/articles/understanding-the-180-degree-rule-in-cinematography); [Frame.io](https://blog.frame.io/2016/08/01/180-degree-rule-and-when-to-break-it/)) · Livros: *Framed Ink* 1–2 (Mateu-Mestre), *The Art of the Storyboard* (Hart) · Revisão ([Toon Boom](https://www.toonboom.com/what-storyboard-artists-do-according-to-storyboard-artists); [Brown Bag Films](https://www.brownbagfilms.com/labs/entry/what-are-storyboard-revisions); [Studiovity](https://blog.studiovity.com/storyboard-rules-the-dos-and-donts-of-storyboarding/)).
