# Estado da arte da geração de vídeo por IA — mapa de capacidades (ago/2026)

> Pesquisa para a base de conhecimento da plataforma. Foco em CAPACIDADES, não produtos.
> Fontes: docs oficiais (Google AI/Gemini API, OpenAI Cookbook, ByteDance Seed, Luma, Lightricks), agregadores de API (fal.ai, Replicate, WaveSpeed) e benchmarks (Physics-IQ, VBench-2.0).

## 1. Mapa de capacidades

### 1.1 Text-to-video (t2v) e image-to-video (i2v)
- **O quê:** gerar clipe a partir de texto puro, ou animar uma imagem tratada como primeiro frame.
- **Quem:** todos — Veo 3.1, Sora 2, Kling 2.6/3.0, Runway Gen-4, Seedance 1.0/1.5, Wan 2.2–2.6, Hunyuan, Luma Ray3, Hailuo 2.3, LTX-2, Pika. Alguns variantes são i2v-only (Hailuo 2.3-Fast).
- **Maturidade:** **produção** — é a capacidade-commodity do mercado.
- **Limites:** clipes de 4–12s como padrão; 720p–1080p (4K nativo só Veo 3.1 8s, LTX-2 e Ray3 Hi-Fi); custo típico US$0,03–0,50/s via API (Kling 2.5 Turbo ~$0,07/s, Veo 3.1 $0,10–0,40/s, Sora 2 Pro $0,30–0,50/s, Seedance ~$0,05/s). t2v puro tem variância alta; i2v é o caminho de controle padrão (imagem fixa o look, prompt define só o movimento).
- **Implicação:** pipeline profissional é **image-first**: gerar/curar keyframes como imagens (barato, iterável) e animar via i2v — nunca apostar tudo em t2v direto.

### 1.2 First frame + last frame / keyframe conditioning
- **O quê:** fornecer frame inicial e final; o modelo interpola o movimento entre os dois estados.
- **Quem:** Veo 3.1 (oficial, com áudio), Kling (start/end frame desde 1.6), Wan 2.2 FLF2V (open, trata ambos como ground truth na difusão), Luma Ray3 (keyframes primeiro/último), Pika, Vidu. **Wan 2.5/2.6 NÃO são bons nisso** (foco em t2v/i2v). Sora 2 não expõe last frame na API.
- **Maturidade:** **produção** para transições simples; **emergente** quando os dois frames são muito distantes (o modelo "teleporta" ou morfa).
- **Limites:** frames devem ser plausíveis a ~5–8s de distância; mudanças de identidade/enquadramento grandes geram morphing feio.
- **Implicação:** é o mecanismo nº1 de **continuidade entre cenas**: last frame do clipe N vira first frame do clipe N+1. O pipeline deve tratar keyframes como artefato de primeira classe.

### 1.3 Reference-to-video ("ingredients"/"elements")
- **O quê:** imagens de referência de personagem/objeto/cenário que o modelo preserva no vídeo, sem serem o primeiro frame.
- **Quem:** Veo 3.1 (até 3 imagens; **mutuamente exclusivo com first frame** — escolher um ou outro por request), Kling "Elements" (multi-referência), Runway Gen-4 References, Vidu, Ray3 character reference, Wan 2.6+ reference-to-video.
- **Maturidade:** **emergente/produção** — funciona bem para 1 personagem + 1 produto; degrada com 3+ referências ou referências conflitantes.
- **Limites:** identidade facial deriva em planos distantes; roupas/props mudam detalhes; estilo da referência "vaza" para a cena toda.
- **Implicação:** consistência de personagem multi-cena hoje = referências + i2v de keyframes gerados com o mesmo personagem (via modelo de imagem com character reference, ex. gpt-image/Nano Banana) — redundância dupla, não confiar só no ref-to-video.

### 1.4 Video-to-video (restyle / edição de vídeo existente)
- **O quê:** transformar footage existente por prompt: trocar ambiente, estação, relighting, remover/adicionar objetos, gerar novo ângulo de câmera, "próximo shot".
- **Quem:** **Runway Aleph** é o estado da arte (in-context editing com entendimento do vídeo inteiro, ~$0,15–0,18/s); Luma Ray3 Modify; Wan 2.6/2.7 video editing; LTX com controle estrutural (depth/pose via LoRA/IC).
- **Maturidade:** **emergente** — resultados impressionantes mas irregulares; edits estruturais grandes falham mais que restyle.
- **Limites:** clipes curtos (~5–10s), resolução limitada do output, custo alto por tentativa, e o edit reamostra TODO o vídeo (perde nitidez do original).
- **Implicação:** tratar como "segundo passe criativo" (fix de continuidade, mudar clima, relight), não como editor de precisão. Guardar sempre o original.

### 1.5 Extensão de cena / continuar clipe / geração autoregressiva
- **O quê:** continuar um clipe existente mantendo movimento e contexto.
- **Quem:** Veo 3.1 Extend (+7s por passo, condiciona no último 1s/24 frames; até ~20 extensões ≈ 141–148s, só 720p, 16:9/9:16); Sora 2 extend (usa o clipe inteiro como contexto; até 6 extensões, máx 120s); Kling extend; pesquisa autoregressiva em tempo real (Self-Forcing, LongLive, Rolling Forcing, CausVid).
- **Maturidade:** **produção** para +1–2 extensões; **frágil** além disso (ver §1.13 drift).
- **Limites:** cada extensão acumula erro — cor deriva, detalhe se perde, identidade escorrega. Áudio entre segmentos pode descolar.
- **Implicação:** para vídeos >15s, preferir **corte planejado** (multi-clipe com keyframe handoff) a extensão encadeada. Extensão serve para "a ação precisava de mais 5 segundos", não para longa duração.

### 1.6 Controle de câmera explícito
- **O quê:** especificar movimento de câmera de forma determinística (trajetória, preset nomeado), não só por texto.
- **Quem:** **Higgsfield** (50–100+ presets nomeados: crash zoom, whip pan, FPV drone, bullet time, dolly, crane; empilha até 3); Kling camera control (trajetórias parametrizadas + motion control por vídeo de referência, até 30s); Luma câmera concepts; Wan camera control (open); nos demais (Veo, Sora, Runway) o controle é **por linguagem** no prompt — funciona bem com vocabulário cinematográfico correto, mas é probabilístico.
- **Maturidade:** presets/paramétrico = **produção** nos que oferecem; via prompt = **produção com variância**.
- **Limites:** presets prendem você ao vendor; via prompt, movimentos compostos ("dolly-in enquanto orbita") falham com frequência; velocidade da câmera é pouco controlável.
- **Implicação:** o pipeline deve ter um **vocabulário canônico de câmera** (dolly/pan/tilt/crane/orbit/handheld/static) que o agente traduz para o dialeto de cada modelo (preset id no Higgsfield, frase no Veo/Sora).

### 1.7 Multi-shot nativo
- **O quê:** um único request gera várias cenas com cortes, mantendo personagem/luz/estilo.
- **Quem:** **Seedance 1.0/1.5** (destaque oficial: 10s com 2–3 transições wide→medium→close); **Sora 2** (personagens persistem através de cortes, aceita shot list no prompt); Veo 3.1 via Flow/Scene Builder (encadeia cenas); LTX-2 (clip longo com beats); Kling 3.0 multi-shot.
- **Maturidade:** **emergente** — cortes acontecem, mas ONDE o modelo corta não é determinístico.
- **Limites:** sem controle de timing exato do corte; 2–3 shots no máximo por geração; continuidade entre shots boa mas não perfeita.
- **Implicação:** multi-shot nativo é ótimo para conteúdo rápido (ads, social); para narrativa controlada, o pipeline deve **cortar por fora** (1 clipe = 1 shot, montagem própria) e usar multi-shot como acelerador opcional.

### 1.8 Áudio nativo na geração
- **O quê:** diálogo, foley, ambiente e música gerados sincronizados no mesmo passe do vídeo.
- **Quem:** **Veo 3/3.1** (áudio sempre ligado; cues de diálogo/SFX/ambiente no prompt), **Sora 2** (diálogo com lip sync + soundscape), Kling 2.6+, Wan 2.5+, **LTX-2** (primeiro open-source com áudio sincronizado — fala, foley, ambiência), Seedance 1.5 (com áudio). Hailuo, Runway: sem áudio nativo (mudo).
- **Maturidade:** **produção** para ambiência/SFX; **emergente** para diálogo longo (frases curtas ok; monólogos derrapam; PT-BR tem sotaque variável — Veo/Sora avaliados oficialmente só em inglês).
- **Limites:** sem stems separados (mix único difícil de editar); sem controle de voz consistente entre clipes (a voz do personagem muda de um clipe para outro!).
- **Implicação:** para narração/voz de marca, gerar voz via TTS (ElevenLabs etc.) e tratar áudio nativo como ambiência/diegese. Pipeline precisa de **política de áudio por clipe**: nativo vs. mudo+pós.

### 1.9 Lip sync e avatar (talking head)
- **O quê:** imagem + áudio → pessoa falando com lábios, expressão e gestos sincronizados.
- **Quem:** **OmniHuman 1.5** (ByteDance; LLM planeja emoção/gesto a partir da semântica do áudio, multi-personagem, câmera livre), HeyGen Avatar IV, Hedra Character, InfiniteTalk/MultiTalk (open), Kling lip sync (pós-processo sobre vídeo), Sora 2/Veo 3.1 (lip sync embutido no diálogo nativo).
- **Maturidade:** **produção** — a capacidade mais madura do mapa para o caso "apresentador".
- **Limites:** dura o que o áudio durar (minutos ok nos dedicados), mas corpo/mão ainda denuncia; ângulo frontal/meio-corpo funciona melhor; custo baixo (~$0,05–0,15/min nos dedicados).
- **Implicação:** talking head é **um trilho separado** do trilho cinematográfico: áudio TTS primeiro → avatar depois. Não usar modelo de vídeo generalista para apresentador longo.

### 1.10 Inpainting/outpainting de vídeo, remoção/adição de elementos
- **O quê:** editar região do vídeo — remover objeto/marca d'água, trocar objeto (swap), inserir elemento novo.
- **Quem:** Runway Inpainting (remoção por máscara, melhor custo/benefício), **Pika Pikaswaps/Pikadditions** (troca e inserção por seleção + prompt), Runway Aleph (por texto, sem máscara), Kling editor, Wan 2.7 edit.
- **Maturidade:** remoção = **produção**; adição/troca fotorrealista = **emergente**.
- **Limites:** oclusões e movimento rápido quebram o tracking da máscara; iluminação do elemento inserido nem sempre casa; resolução do output cai.
- **Implicação:** capacidade de **resgate**, não de criação: usar para salvar um take 90% bom em vez de regenerar. Reduz custo de regeneração no pipeline.

### 1.11 Upscaling, interpolação de frames, normalização
- **O quê:** pós-processo determinístico: 720p→4K, 24→60fps, denoise, correção de cor, conformação de fps/gamma entre clipes de modelos diferentes.
- **Quem:** Topaz Video (Starlight/Proteus/Artemis; API via parceiros), Real-ESRGAN/SeedVR (open), RIFE/FILM (interpolação open), Luma Ray3 SDR→HDR; ffmpeg para normalização.
- **Maturidade:** **produção** — tecnologia estável, disponível como API barata.
- **Limites:** upscaler inventa detalhe (pode alterar rosto/texto); interpolação cria artefatos em movimento rápido; custo/tempo não triviais em 4K.
- **Implicação:** **gerar barato em 720p, upar o corte final aprovado** — nunca gerar caro em 4K para descartar takes. Normalização (fps, cor, loudness) é etapa obrigatória quando o pipeline mistura modelos.

### 1.12 Physics/motion realism — onde os modelos quebram
- **O quê:** fidelidade física do movimento: gravidade, colisão, fluidos, permanência de objetos.
- **Evidência:** Physics-IQ (DeepMind/INSAIT, ICCV 2025): mesmo Sora/Runway/VideoPoet "geram vídeos visualmente convincentes mas falham na dinâmica física subjacente" — realismo visual ≠ entendimento físico. VBench-2.0 mede exatamente isso (commonsense, física, movimento humano).
- **Quebras típicas:** mãos e dedos em interação com objetos; texto em tela (legendas/placas viram garatuja); objetos que somem/duplicam atrás de oclusão; líquidos e vidro; multidões; instrumentos musicais; contagem ("3 maçãs"); movimentos com contato corpo-a-corpo. Sora 2 e Hailuo 2.3 são os mais fortes em física; ainda assim falham nesses casos.
- **Implicação:** o **roteirista/agente deve conhecer a lista de cenas proibidas** e reescrever em torno delas (cortar antes do contato, esconder mãos, texto via overlay na edição, não na geração). QC automático deve checar exatamente esses padrões.

### 1.13 Duração máxima real utilizável e degradação/drift
- **O quê:** o gap entre duração anunciada e duração com qualidade constante.
- **Números reais (2026):** geração única confiável = **5–10s** (quase todos); 12s (Seedance/Sora 2), 25s (Sora 2 Pro), ~20s (LTX-2), 30s (Kling motion control). Com extensão: Veo até ~148s, Sora até 120s — mas com drift.
- **O problema:** geração autoregressiva/estendida acumula erro — deriva de cor, perda de detalhe, identidade escorregando, "esquecimento" de cena (KV cache limitado descarta contexto antigo). Literatura ativa (Self-Forcing, LongLive, Rolling Forcing, FreqForcing, Context Forcing) atenua mas não resolve em produto.
- **Implicação:** a unidade atômica do pipeline é o **shot de 5–10s**. Vídeo de 60s = 6–10 shots montados, com continuidade garantida por keyframes/referências — não por um modelo "gerar 60s".

### 1.14 Estruturas de prompt — o que os guias OFICIAIS recomendam
- **Veo 3.1 (Google Cloud/Gemini API):** fórmula **[Cinematografia] + [Sujeito] + [Ação] + [Contexto] + [Estilo & Ambiente]**, prosa descritiva com adjetivos; cues de áudio explícitos ("dialogue: …", som ambiente); verbos de força para movimento (push, slam, sway) — ação vaga = movimento "flutuante". Vocabulário de câmera nomeado (dolly, tracking, crane, aerial, POV).
- **Sora 2 (OpenAI Cookbook, out/2025):** prompt em **blocos separados**: descrição da cena (prosa) → cinematografia (enquadramento, ângulo, lente, mood) → ações como **beats numerados** → **bloco de Dialogue à parte** com falas curtas e speakers rotulados. Um shot = um setup de câmera + uma ação + uma receita de luz. Evitar vago: não "cinematic look", sim "anamorphic 2.0x, shallow DOF, volumetric light"; não "rua bonita à noite", sim "asfalto molhado, faixa de pedestre, neons". Deixar algo em aberto aumenta criatividade; regenerar o mesmo prompt dá resultados diferentes (feature); refinar com **uma mudança por vez**.
- **Runway Gen-4 (help oficial):** em i2v, o prompt descreve **só o movimento** — não re-descrever a imagem; frases simples, positivas (nunca "sem X"/"não fazer Y"); iterar em cima do que funcionou.
- **Kling:** fórmula sujeito + movimento + cena + (câmera/luz); CFG controla aderência vs. liberdade.
- **Convergência:** todos pedem (a) estrutura fixa por seções, (b) vocabulário cinematográfico concreto, (c) uma ideia de movimento por shot, (d) zero negação, (e) áudio/diálogo declarado explicitamente.
- **Implicação:** o pipeline deve ter um **IR (representação intermediária) de shot** — sujeito, ação em beats, câmera, luz, paleta, áudio, diálogo — e compiladores por modelo que serializam esse IR no dialeto de cada guia. Prompt nunca é texto livre do usuário direto no modelo.

## 2. Implicações arquiteturais

**Commodity (assumir que todo modelo tem, competir por preço/fila):**
- t2v/i2v 5–10s, 720p/1080p; i2v como caminho padrão de controle.
- Áudio ambiente/SFX nativo (Veo/Sora/Kling/Wan/LTX).
- Upscaling/interpolação/normalização como pós determinístico barato.
- Lip sync a partir de imagem+áudio.

**Diferencial (escolher modelo pela capacidade, roteável por tarefa):**
- First/last frame de qualidade (Veo 3.1, Kling, Wan 2.2) → continuidade entre shots.
- Reference-to-video multi-elemento (Veo 3.1, Kling Elements, Runway References) → identidade de personagem/produto.
- Video-to-video editing (Aleph, Ray3 Modify) → segundo passe/resgate.
- Multi-shot nativo (Seedance, Sora 2) → conteúdo social rápido.
- Presets de câmera (Higgsfield, Kling motion control) → look "filmado de verdade".
- HDR/4K nativo (Ray3, LTX-2) → entregas premium.

**Evitar depender:**
- Duração longa por extensão encadeada (drift) — montar por shots.
- Voz consistente do áudio nativo entre clipes — usar TTS próprio.
- Texto legível gerado em cena — sempre overlay na edição.
- Um único vendor: preços mudam 10x entre modelos ($0,03–0,50/s), modelos são **deprecados rápido** (Sora 2 API desliga em set/2026!), e capacidades exclusivas migram entre famílias em meses. Contrato interno = IR de shot + adapters (fal.ai/Replicate como agregadores já normalizam boa parte).
- Determinismo: toda etapa generativa precisa de loop gerar→avaliar (QC vision)→regenerar, com orçamento de retries.

## 3. Matriz capacidade → etapa de produção

| Etapa | Capacidades que servem | Observação |
|---|---|---|
| Roteiro | §1.12 (lista de cenas que quebram), §1.14 (IR de shot) | roteirista escreve JÁ em shots de 5–10s, evitando física proibida |
| Storyboard | geração de imagem + character reference; §1.2 keyframes | keyframes são o storyboard executável; aprovar aqui é 10x mais barato |
| Geração | §1.1 i2v, §1.3 referências, §1.6 câmera, §1.7 multi-shot, §1.8 áudio nativo | roteamento por tarefa: diálogo→Sora/Veo; ação física→Hailuo/Kling; barato→Seedance/Wan |
| Apresentador/UGC | §1.9 avatar + TTS | trilho separado, não passa pelo trilho cinematográfico |
| Edição | §1.4 v2v, §1.10 inpainting, §1.5 extensão pontual | resgate de takes; corte/montagem é software tradicional (ffmpeg/NLE), não IA |
| Finalização | §1.11 upscale/interpolação/normalização, mix de áudio, overlay de texto | determinístico; upscale só do corte aprovado |
| QC | §1.12 benchmarks como checklist, vision-LLM avaliando cada take | gate entre toda etapa generativa e a seguinte |

## 4. Tendências 6–12 meses e blindagem

1. **Duração nativa cresce, drift diminui** (linhas Rolling/Context Forcing chegando a produto; Sora/Kling/LTX já em 12–30s). Blindagem: shot como unidade continua válido — shots ficam maiores, a montagem não morre.
2. **Áudio nativo vira default e ganha controle de voz** (voice cloning por clipe é o gap óbvio). Blindagem: manter camada de áudio própria (TTS/mix) plugável, desligável por clipe.
3. **Open-weights alcança fechado em custo/qualidade** (LTX-2/2.3 4K open, Wan 2.x) → geração em massa migra para inferência barata; modelos fechados ficam para hero shots. Blindagem: adapter para endpoints self-host/serverless GPU desde já.
4. **Churn e deprecação violentos** (Sora 2 API morre set/2026; Kling 2.x→3.0, Wan 2.2→2.7 em ~1 ano). Blindagem: nenhum nome de modelo hard-coded fora da camada de adapters; testes de regressão por capacidade (golden prompts) para requalificar modelo novo em dias.
5. **Edição por texto (Aleph-like) se generaliza** → menos regeneração, mais correção. Blindagem: guardar assets intermediários (keyframes, takes, IR) para reprocessar sem refazer.
6. **Controle converge para inputs estruturados** (referências, trajetórias, JSON de shot em vez de prosa). Blindagem: o IR de shot interno já deve ser estruturado hoje; compilar para prosa é detalhe do adapter.
7. **Física melhora mas não resolve** (Physics-IQ mostra gap conceitual, não incremental). Blindagem: manter a lista de cenas proibidas como config viva, revisada por benchmark a cada modelo novo.

### Fontes principais
Google — Veo na Gemini API (ai.google.dev/gemini-api/docs/veo) e "Ultimate prompting guide for Veo 3.1" (cloud.google.com) · OpenAI — Sora 2 Prompting Guide (developers.openai.com/cookbook) e Video generation guide · ByteDance Seed — Seedance 1.0 tech report (seed.bytedance.com) · Lightricks — LTX-2 (github.com/Lightricks/ltx-video) · Luma — Ray3 user guide (lumalabs.ai) · MiniMax — Hailuo 2.3 (minimax.io/news) · Higgsfield camera controls (higgsfield.ai) · Runway Aleph (replicate.com/runwayml/gen4-aleph, help.runwayml.com) · Physics-IQ (github.com/google-deepmind/physics-iq-benchmark, ICCV 2025) · VBench-2.0 (github.com/Vchitect/VBench) · Preços: fal.ai, Replicate, WaveSpeed, genrates.com · Drift: arXiv 2509.22622 (LongLive), 2509.25161 (Rolling Forcing), 2602.06028 (Context Forcing).
