# 06 — Consistência de personagens e elementos em produção com IA (2025-2026)

> Pesquisa para a base de conhecimento dos agentes de vídeo. Foco em **capacidades e técnicas**, não em produtos.
> Convenção de status: **madura** (funciona de forma previsível em produção), **emergente** (funciona mas exige tuning/QA), **frágil** (não confiar como mecanismo principal).

---

## 1. Técnicas e capacidades

### 1.1 Character sheet / identity pack (retratos multi-ângulo) — **madura**
A base de todo workflow sério: antes de gerar qualquer frame de vídeo, cria-se um pacote de referência do personagem. Pack mínimo documentado ([Neolemon guide](https://www.neolemon.com/blog/how-to-create-consistent-characters-in-ai-videos-complete-guide/)): corpo inteiro frontal em pose neutra, 3/4, perfil, close de rosto neutro, folha de expressões (~6 emoções), 3 poses de ação, costas/mãos/variantes de roupa. O pack tem duas metades:
- **DNA textual**: idade, formato de rosto/olhos/nariz, marcas distintivas, cabelo, textura de pele, roupa-base, "style lock" (ex. 3D Pixar, live-action), paleta e uma lista *do-not-change*.
- **Pack visual**: as imagens multi-ângulo, frequentemente montadas num **composite único** (grade 2x2/3x3) que vira input de toda geração do projeto.
A [Kling recomenda oficialmente](https://kling.ai/quickstart/klingai-element-library-3-user-guide) 4 imagens limpas: frontal, 3/4 esquerda, 3/4 direita e costas.

### 1.2 Reference-guided generation (imagem) — **madura**; é o mecanismo central hoje
Consenso da comunidade: *consistência é um problema de referência, não de prompt* — texto produz variação por design. Modelos de imagem que aceitam imagens de referência:
- **Nano Banana / Nano Banana 2 (Gemini image)**: modelo multimodal nativo — **edita** a imagem em vez de redesenhar, por isso lidera em consistência. NB2 mantém semelhança de até **5 personagens e 14 objetos** num workflow ([guia](https://www.ud.hk/en/blogs/insight/article/2026-06-29-nano-banana-consistent-characters)). Prompt eficaz tem 4 partes: âncora de identidade → sujeito+ação → composição → **consistency lock** ("não altere o rosto/roupa") ([prompting.systems](https://prompting.systems/blog/nano-banana-pro-character-consistency-guide)).
- **Flux Kontext**: edição in-context; forte em relighting/blending mantendo atmosfera; par natural do Nano Banana em pipelines híbridos.
- **GPT-image**: aceita imagens de referência e instruções de edição; bom para variações de personagem estilizado.
- **Midjourney V7 omni-reference** (`--oref` + `--ow`): substitui o `--cref` do V6; peso recomendado 50–250 (default 100; >400 degrada). Muito melhor que cref em mudanças de ângulo de câmera ([guia](https://flowith.io/blog/midjourney-v7-consistent-characters-masterclass/)).
- **Kling IMAGE 3.0 / Omni**: até **10 imagens de referência**, separando sujeito / estilo / composição ([Kling blog](https://kling.ai/blog/kling-image-3-vs-omni)).

### 1.3 Ingredients / elements to video — **madura nos líderes, emergente no resto**
Vídeo direto a partir de múltiplas referências nomeadas:
- **Veo 3.1 "ingredients to video"**: até **3 imagens** (personagem, objeto, cena). O prompt deve **mapear explicitamente** cada imagem ao papel: *"a mulher da imagem 1, segurando a xícara da imagem 2, na rua da imagem 3"*. Combinatório (monta composição nova), diferente de frames-to-video (interpolativo). 2 refs fortes > 3 competindo ([guia](https://www.veo3ai.io/blog/veo-3-1-ingredients-to-video-guide-2026)).
- **Kling Elements / Element Library 3.0**: elementos persistentes (personagem/objeto/cena) criados de refs multi-ângulo e **reutilizáveis entre gerações** — "crie uma vez, use consistente" ([user guide](https://kling.ai/quickstart/klingai-element-library-3-user-guide)); Kling 3.0 adiciona multi-shot nativo com elementos.
- **Runway Gen-4 References / World Consistency**: até 3 refs (máx 720p/1280x720); mantém representação latente de personagens **e locações** na sessão; ref ideal = bem iluminada, pose neutra, expressão neutra ([guia](https://www.ud.hk/en/blogs/insight/article/2026-05-05-runway-gen4-guide)).
- **Sora 2 Cameos**: gravação de 10–30s (vídeo+áudio) vira um "character DNA profile" reutilizável, referenciado por `@nome` no prompt; o mecanismo mais confiável do Sora para identidade recorrente ([guia](https://superprompt.com/blog/openai-sora-2-complete-guide)). Limitação: preso ao ecossistema Sora, sem API completa.

### 1.4 LoRA / fine-tuning de personagem — **madura** (o padrão-ouro quando o personagem é recorrente de verdade)
DreamBooth/LoRA vinculam um identificador único ("trigger word") a um sujeito. Workflow ComfyUI documentado em 2 estágios: (1) gerar character sheet multi-pose com Flux+ControlNet/OpenPose; (2) treinar LoRA sobre a sheet; depois o trigger word reproduz o personagem em qualquer prompt ([RunComfy](https://www.runcomfy.com/comfyui-workflows/comfyui-flux-lora-training-detailed-guides), [Runflow](https://www.runflow.io/blog/comfyui-consistent-characters-flux)). Custo: dataset de 15–40 imagens, GPU (8–12GB+ p/ Flux quantizado), minutos-horas de treino. Vale para protagonistas de série/canal; não vale para personagens de um vídeo só. Variante acadêmica: multi-token DreamBooth+LoRA para elencos com estilo consistente ([arXiv 2510.09475](https://arxiv.org/pdf/2510.09475)).

### 1.5 Adapters de identidade zero-shot (papers → infra) — **emergente**
Para quem opera modelos abertos: **IP-Adapter** (cross-attention desacoplada de features de imagem), **InstantID** (ID-embedding de face encoder ArcFace + ControlNet de landmarks, 1 foto, sem treino — [paper](https://arxiv.org/pdf/2401.07519)), **PuLID** (alinhamento contrastivo, menos contaminação do prompt). Em vídeo: **ConsisID** (CVPR 2025) preserva identidade em DiT text-to-video via decomposição de frequência (global low-freq + intrínseco high-freq), tuning-free ([paper](https://arxiv.org/abs/2411.17440)); **StoryDiffusion** (NeurIPS 2024) introduz *Consistent Self-Attention* entre imagens de um batch para narrativa longa ([paper](https://arxiv.org/abs/2405.01434)). São os mecanismos por trás do que os produtos fechados oferecem como "reference".

### 1.6 Seeds e prompt anchoring — **frágil (seed) / útil como reforço (anchoring)**
Seed fixa só congela o ruído inicial — não congela modelo, scheduler, resolução nem parser; mesma seed + prompt diferente ≠ mesmo personagem; updates silenciosos do provedor quebram reprodutibilidade ([Prompting Pixels](https://www.promptingpixels.com/tutorial/seed-value), [covefox](https://covefox.com/seed-consistency-ai-image-generation/)). Uso legítimo: variações sutis do MESMO frame. Já o **prompt anchoring** funciona como reforço: nome próprio do personagem + bloco de descrição idêntico palavra-a-palavra em todo prompt do projeto; manter as ~10 primeiras palavras idênticas entre shots da mesma cena prioriza o contexto ambiental. Nunca é o mecanismo principal — sempre acompanha referência visual.

### 1.7 Keyframe chaining (frame N ancora N+1) — **madura, com drift conhecido**
Workflow padrão: extrair o último frame do clipe N e usá-lo como imagem inicial (i2v) do clipe N+1 — inclusive entre modelos diferentes (ex. Luma → Runway). First/last-frame nativo (Kling 2.5+, Veo "frames to video") interpola entre dois keyframes aprovados, o que dá mais controle que chaining cego. **Problema central: degradação acumulada** — cada elo herda os artefatos do anterior; pesquisa em long-video confirma que a corrupção se acumula ao longo dos frames ([LongVie 2](https://arxiv.org/pdf/2512.13604)). Mitigação prática: a cada 2–3 elos, voltar ao identity pack e regenerar um keyframe "limpo" via modelo de imagem com referência, em vez de continuar a corrente.

### 1.8 Face swap / face restore como pós-processo — **madura (reparo), com ressalvas**
Pipeline aberto: **ReActor / FaceFusion** sobre **InsightFace** (`inswapper_128.onnx`) trocam o rosto frame a frame no vídeo gerado, seguidos de **GFPGAN/CodeFormer** para restauração ([ComfyUI-ReActor](https://github.com/Gourieff/ComfyUI-ReActor), [guia Civitai](https://civitai.com/articles/31600/the-definitive-guide-to-face-swapping-in-2026)). Uso correto: **reparo cirúrgico** de shots onde o rosto derivou, não mecanismo primário (o inswapper é 128px — em close extremos perde textura; corpo/cabelo/roupa não são cobertos). É o "airbag" do pipeline: se o gate de identidade falhar, tenta-se swap antes de regenerar o shot inteiro.

### 1.9 Consistência de voz — **madura**
Voice cloning fixa a identidade sonora: **IVC** (instant, <2min de áudio) para protótipo, **PVC** (professional) para produção ([docs ElevenLabs](https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning)). Regras: amostras com atuação **uniforme** (não misturar animado+contido, desestabiliza o clone); um `voice_id` fixo por personagem, vinculado no banco do projeto — todo diálogo daquele personagem, em qualquer cena/idioma, usa o mesmo id (padrão "voice binding" já produtizado pelo invideo/ElevenLabs agent ([ref](https://invideo.io/ai-models/elevenlabs/))). O áudio TTS aprovado alimenta o lipsync (Sync Labs, Kling lipsync, HeyGen) — a fala aprovada é a performance que o rosto entrega. Voz é hoje o eixo MAIS fácil de manter consistente.

### 1.10 Consistência de ambiente/local — **emergente**
Técnicas: (a) **Hero frame / master reference** — gerar e aprovar um establishing shot do local; todo shot na locação referencia essa imagem (via refs do modelo de imagem ou ingredient de cena no vídeo); (b) tratar o local como **elemento** (Kling scene element, Runway location reference, 3ª ingredient do Veo); (c) bloco de descrição do ambiente idêntico em todos os prompts da cena, mudando só ação e câmera; (d) coerência de **iluminação** explícita no prompt (direção/cor da luz) para o personagem não parecer "recortado de estúdio" ([síntese](https://www.mindstudio.ai/blog/storyboards-character-sheets-ai-video-generation)). Ambiente deriva mais que rosto: geometria de fundo raramente sobrevive a mudanças grandes de ângulo — por isso produções reais usam poucos ângulos por locação.

### 1.11 Verificação automática de identidade — **emergente, viável hoje**
Três camadas usadas em benchmarks e sistemas de storyboarding ([ViStoryBench](https://www.emergentmind.com/topics/vistorybench), [CANVAS](https://arxiv.org/html/2604.13452v1)):
1. **Face embedding**: detectar rosto → **ArcFace** (512-d) → similaridade de cosseno contra a média do identity pack. Mesmo sujeito clusteriza; média alta = identidade convergente ([InsightFace](https://www.insightface.ai/research/arcface)).
2. **Sujeito/prop/ambiente**: **Grounding DINO** recorta a região do personagem/objeto → **CLIP ou DINOv2** → cosseno contra referência (cobre roupa, corpo, props e cenário — o que a face embedding não vê).
3. **VLM-as-judge**: modelo de visão compara par de imagens ("mesma pessoa? mesma roupa? mesmo local? liste divergências") — avaliadores VLM são selecionados por correlação com julgamento humano; cobre atributos semânticos (cicatriz do lado certo, cor do olho) que embeddings ignoram.

---

## 2. Como produções reais mantêm consistência hoje

**Pipeline canônico (Secret Level, Curious Refuge, criadores de GEN:48)** — convergiu para: *identidade primeiro, movimento depois*:
1. **Pré-produção**: worldbuilding, character design, DNA textual, shot list e "linguagem visual" fechados ANTES de gerar movimento ([Secret Level Academy](https://academy.secretlevel.co/) tem módulos dedicados a consistência visual e QC de imagens erradas; [Curious Refuge](https://curiousrefuge.com/advanced-ai-filmmaking) ensina rostos consistentes, consistência de locação e clonagem de voz).
2. **Identity packs**: personagens, locações e props viram packs de referência aprovados (multi-ângulo).
3. **Keyframes por shot**: cada shot do storyboard vira 1–2 imagens estáticas geradas por modelo de imagem **com referência** (Nano Banana/Kontext/Midjourney oref) — é aqui que a consistência é ganha, porque imagem estática é barata de refazer e fácil de auditar.
4. **Image-to-video**: keyframes aprovados alimentam o modelo de vídeo (i2v ou first/last frame), com prompts que descrevem **só movimento e câmera** ("keep identity and outfit unchanged"), nunca redescrevem a identidade.
5. **Pós**: face swap/restore para reparar drift pontual, upscale, color grade.

**Táticas de sala de edição** documentadas por criadores: *continuity bible* (planilha de posição de props, direção de luz, lado da cicatriz); scrub frame a frame antes de aprovar; **transition shots** (close de prop, silhueta, over-the-shoulder) para "resetar" a percepção do espectador entre cenas pesadas de personagem — esconder a costura é técnica de cinema, não de modelo; escolher histórias que toleram o limite atual (vinhetas, documentário, atmosfera) em vez de diálogo longo entre dois rostos fixos. Estatística relevante: entre artistas de vídeo generativo, **movimento consistente de personagem é a prioridade nº 1**, acima de qualidade de imagem.

**Escolha de modelo por função** (padrão multi-modelo): imagem com referência para keyframes; Kling para motion de personagem; Runway para controle de câmera; Veo para montagem por ingredients + áudio nativo; ElevenLabs para voz. Nenhuma produção séria usa text-to-video puro para personagem recorrente.

---

## 3. Abstração para agente

### 3.1 Estrutura de dados de identidade (banco)
```
identity
  id, project_id, kind ('character'|'environment'|'prop'), name, trigger_token
  dna jsonb            -- DNA textual estruturado: físico, roupa-base, style lock,
                       --   do_not_change[], palette, para env: layout/luz, para prop: material/escala
  prompt_block text    -- bloco canônico injetado verbatim em todo prompt (anchoring)
  voice_id text        -- personagens: id fixo no provedor TTS (nullable)
  lora_ref text        -- opcional: LoRA treinada (path/versão + trigger word)
  provider_refs jsonb  -- ids nativos: kling_element_id, sora_cameo, runway_ref, etc.
  status ('draft'|'approved'|'locked')

identity_asset
  id, identity_id, role ('front'|'three_quarter_l'|'three_quarter_r'|'profile'|'back'|
        'face_closeup'|'expression:<emo>'|'action:<n>'|'hero_frame'|'composite'|'voice_sample')
  url, approved bool
  face_embedding vector(512)   -- ArcFace (personagens)
  subject_embedding vector     -- DINOv2/CLIP do sujeito recortado (todos os kinds)
```
Regra: identidade `locked` é imutável — mudanças geram nova versão (o mesmo personagem com figurino novo é variante vinculada, não edição).

### 3.2 Pipeline de criação do identity pack (agente)
1. Gerar **hero portrait** a partir do DNA textual (melhor modelo de imagem disponível); aprovar (humano ou VLM-gate).
2. **Derivar ângulos por edição com referência** (Nano Banana/Kontext: "mesma pessoa, vista 3/4 esquerda, mesma roupa, fundo neutro, luz uniforme") — nunca gerar ângulos por prompt do zero.
3. **Auto-verificar coerência interna**: ArcFace par-a-par entre os assets; descartar/regerar outliers (cos < limiar); calcular embedding-médio do pack.
4. Montar composite; registrar elementos nativos nos provedores (Kling Element com as 4 vistas, etc.) e salvar ids em `provider_refs`.
5. Personagem falante: gravar/gerar amostra, criar voice clone, fixar `voice_id`.
6. Recorrente em série: disparar treino de LoRA usando o pack como dataset.

### 3.3 Como cada geração consome as referências
O agente resolve, por shot, uma **matriz capacidade×modelo**:
- *Keyframe (imagem)*: passa composite (ou 2–3 assets no ângulo mais próximo do shot) + `prompt_block` + consistency lock; Midjourney → `--oref --ow 100–250`; com LoRA → trigger token.
- *Vídeo por ingredients*: mapeia identidades → slots do modelo (Veo: máx 3, papéis nomeados no prompt "a mulher da imagem 1…"; Kling: element ids; Runway: até 3 refs ≤720p; Sora: `@cameo`). Prioridade quando há mais identidades que slots: personagem > ambiente > prop.
- *Vídeo i2v*: consome o keyframe aprovado; prompt descreve só ação+câmera ("keep identity and outfit unchanged").
- *Chaining*: last frame do clipe anterior; contador de elos — ao atingir 2–3, forçar keyframe novo derivado do pack.
- *Voz*: toda fala usa `voice_id`; áudio aprovado → lipsync.

### 3.4 Verificação automática (gates)
Para cada output, antes de aprovar:
1. **Gate facial** (personagens): detectar rosto no keyframe / em N frames amostrados do vídeo → ArcFace cos vs embedding-médio do pack. Limiar prático inicial: ≥0,55 aprova, 0,40–0,55 revisão, <0,40 reprova (calibrar por estilo — anime/estilizado precisa de limiar próprio ou só camadas 2–3).
2. **Gate de sujeito** (roupa/corpo/prop/ambiente): Grounding DINO recorta → DINOv2 cos vs `subject_embedding` de referência.
3. **Gate VLM**: comparação semântica referência×output com checklist gerado do `dna.do_not_change` ("mesma roupa? cicatriz à esquerda? mesmo local?"); saída estruturada com divergências.
4. **Política de reparo em escada**: reprovou → (a) regenerar com refs reordenadas/lock reforçado; (b) rosto só → face swap (ReActor/FaceFusion) + restore; (c) 3 falhas → escalar a humano com o diff do VLM. Registrar score de cada tentativa para telemetria de drift por modelo.

---

## 4. Limites honestos (o que ainda quebra)

- **Referência é dica, não contrato**: mesmo nos melhores modelos a ref "guia" a geração; drift aparece em movimento rápido, ângulos extremos e planos muito abertos (rosto pequeno = menos sinal de identidade).
- **Multi-personagem** é o modo de falha nº 1: rostos se fundem, roupas trocam de dono; acima de 2–3 identidades por frame a taxa de falha sobe muito (NB2 anuncia 5 personagens, na prática exige QA pesado).
- **Roupa, mãos e props pequenos** derivam mais que rosto — face embedding não os cobre, por isso o gate de sujeito/VLM é obrigatório, e ainda assim detalhes finos (estampas, joias, logos) escapam.
- **Chaining degrada**: artefatos se acumulam elo a elo; sem "re-âncora" periódica no pack, o personagem do shot 10 não é o do shot 1.
- **Seeds não são mecanismo de consistência** e quebram silenciosamente com updates de provedor.
- **Ambiente**: geometria de cenário não sobrevive a mudanças grandes de câmera; consistência real de locação hoje = poucos ângulos + hero frames por ângulo.
- **Emoção vs identidade**: expressões intensas deformam o rosto para fora do cluster de embedding — gates precisam tolerar (ou usar assets `expression:*` como referência do gate).
- **Face swap** é reparo 128px: falha em close extremo, não corrige corpo/cabelo, e herda rigidez de expressão.
- **Voz**: identidade sonora é sólida, mas **atuação** (prosódia, emoção por cena) ainda varia entre takes e exige direção/seleção humana.
- **Ecossistemas fechados**: Sora cameos sem API plena; elementos Kling/refs Runway não são portáveis entre provedores — o identity pack (imagens + embeddings + DNA) é o único formato verdadeiramente portátil, e é por isso que ele, e não o recurso nativo de cada modelo, deve ser a fonte de verdade do agente.

---

### Fontes principais
[Neolemon — guia completo](https://www.neolemon.com/blog/how-to-create-consistent-characters-in-ai-videos-complete-guide/) · [Veo 3.1 ingredients](https://www.veo3ai.io/blog/veo-3-1-ingredients-to-video-guide-2026) · [Kling Element Library](https://kling.ai/quickstart/klingai-element-library-3-user-guide) · [Kling Image 3.0/Omni](https://kling.ai/blog/kling-image-3-vs-omni) · [Runway Gen-4 world consistency](https://www.ud.hk/en/blogs/insight/article/2026-05-05-runway-gen4-guide) · [Sora 2 cameos](https://superprompt.com/blog/openai-sora-2-complete-guide) · [Nano Banana consistency](https://prompting.systems/blog/nano-banana-pro-character-consistency-guide) · [Midjourney V7 oref](https://flowith.io/blog/midjourney-v7-consistent-characters-masterclass/) · [StoryDiffusion](https://arxiv.org/abs/2405.01434) · [ConsisID (CVPR'25)](https://arxiv.org/abs/2411.17440) · [InstantID](https://arxiv.org/pdf/2401.07519) · [ArcFace/InsightFace](https://www.insightface.ai/research/arcface) · [ViStoryBench](https://www.emergentmind.com/topics/vistorybench) · [CANVAS](https://arxiv.org/html/2604.13452v1) · [Video Storyboarding (NVIDIA)](https://research.nvidia.com/labs/par/video_storyboarding/) · [ComfyUI Flux LoRA](https://www.runcomfy.com/comfyui-workflows/comfyui-flux-lora-training-detailed-guides) · [ReActor](https://github.com/Gourieff/ComfyUI-ReActor) · [Face swap 2026 (Civitai)](https://civitai.com/articles/31600/the-definitive-guide-to-face-swapping-in-2026) · [ElevenLabs voice cloning](https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning) · [Secret Level Academy](https://academy.secretlevel.co/) · [Curious Refuge](https://curiousrefuge.com/advanced-ai-filmmaking) · [Seeds e limites](https://www.promptingpixels.com/tutorial/seed-value) · [LongVie 2 (degradação acumulada)](https://arxiv.org/pdf/2512.13604)
