# 12 — Sistemas multi-agente para criação de vídeo + avaliação automática (2024–2026)

> Pesquisa primária (arXiv + docs de produto) sobre quem já tentou construir "squad de IA que faz vídeo":
> quais papéis funcionaram, como os agentes conversam, o que quebra, e como avaliar automaticamente.

---

## 1. Sistemas existentes (acadêmicos)

### FilmAgent (HIT/PolyU, arXiv 2501.12909, SIGGRAPH Asia 2024)
- **Agentes**: diretor, roteirista, atores, cinematógrafo — operando em espaços 3D virtuais pré-construídos.
- **Etapas**: desenvolvimento de ideia → roteiro (diálogo + ações por cena) → cinematografia (setup de câmera por shot).
- **Comunicação**: duas estratégias explícitas de colaboração — **Critique-Correct-Verify** (crítico aponta, autor corrige, verificador confirma) e **Debate-Judge** (dois agentes debatem, juiz decide). Iteração de feedback verifica scripts intermediários e reduz alucinação.
- **Resultados**: 3.98/5 em avaliação humana, supera baselines single-agent (inclusive o1 usando só GPT-4o) — evidência de que **colaboração > modelo maior** nesse domínio.
- **Falhas admitidas**: restrito a cenários 3D pré-construídos (não gera pixels); "work in progress"; os autores discutem que Sora e FilmAgent têm forças complementares (Sora gera imagem livre mas sem controle narrativo; FilmAgent controla narrativa mas preso ao asset 3D).
- Fonte: https://arxiv.org/abs/2501.12909 · https://filmagent.github.io/

### VideoDirectorGPT (UNC, COLM 2024, arXiv 2309.15091)
- **Arquitetura em 2 estágios**: LLM planner (GPT-4) expande 1 prompt num **"video plan"** estruturado — descrição de cenas, entidades com layouts (bounding boxes), background, e **grupos de consistência de entidades**; depois um gerador (Layout2Vid) executa com controle espacial explícito.
- **Lição-chave**: o handoff é um **artefato estruturado** (plano JSON-like), não conversa. Consistência entre cenas vem de agrupar entidades no plano, não de sorte na geração.
- **Falhas**: gerador fraco pelos padrões atuais; layout 2D não captura movimento de câmera; plano é one-shot (sem loop de correção).
- Fonte: https://arxiv.org/abs/2309.15091 · https://videodirectorgpt.github.io/

### Anim-Director (HITsz, SIGGRAPH Asia 2024, arXiv 2408.09787)
- **Agente único LMM (GPT-4V) como diretor** orquestrando ferramentas geradoras (Midjourney, Pika). 3 estágios: história coerente → script de diretor (perfis de personagem, cenários) → produção imagem+prompt → vídeo (Image+Text→Image/Video).
- **Mecanismo central**: o LMM **refina, avalia e seleciona** outputs das ferramentas geradoras (self-reflection sobre as imagens candidatas antes de animar) — generator-critic com o crítico multimodal embutido.
- **Falhas**: dependente de ferramentas externas fechadas; consistência de personagem por prompt-engineering (frágil); sem áudio.
- Fonte: https://arxiv.org/abs/2408.09787 · https://github.com/HITsz-TMG/Anim-Director

### Mora (Lehigh/Microsoft, arXiv 2403.13248)
- **5 agentes em pipeline sequencial**: (A1) seleção/enriquecimento de prompt (GPT-4) → (A2) text-to-image (SDXL/SD3) → (A3) image-to-image (InstructPix2Pix) → (A4) image-to-video → (A5) conexão de vídeos (transições por keyframes).
- **Comunicação**: cada agente recebe o output do anterior + um **"modulation embedding"** aprendido (fine-tuning multi-agente com fator de auto-modulação) que ajusta a influência de cada agente — coordenação treinada, não só prompt. Humano pode repetir cada estágio (**máx. 3 iterações por estágio** — loop com budget).
- **Resultados**: VBench Quality 0.800 vs Sora 0.797 em T2V; 6 tarefas (T2V, I2V, extend, edit, connect, simulação).
- **Falhas admitidas**: gap holístico grande vs Sora; 12s vs 60s de duração; custo computacional alto; filtragem de dados exige intervenção humana quando MLLMs discordam (gargalo de escala).
- Fonte: https://arxiv.org/abs/2403.13248

### DreamFactory (arXiv 2408.11788)
- **Agentes**: CEO, Diretor, Produtor, Roteirista, Filmmaker, Reviewer — "empresa virtual de cinema" (estilo ChatDev), cada um com prompt de Job/Task/Requirements.
- **Comunicação**: fases estruturadas (definição de tarefa → estilo → história → script → keyframes), cada fase é uma conversa com **rodadas fixas** e conclusão marcada por token `<INFO>` que vira memória local da fase seguinte.
- **Key Frames Iteration Design**: consistência longa vira sucessão de consistências curtas — cada keyframe é gerado referenciando o **Base Frame** (estilo/personagem/fundo) + o frame anterior; um agente **Monitor** revisa cada frame gerado (memória curta).
- **Resultados**: FID 6.57–7.15 vs 9.15–11.23 dos baselines; CSFD 0.89 vs 0.68–0.77.
- **Falhas admitidas**: (1) agentes seguem prompt mas **não têm mérito artístico** ao inventar tramas; (2) resultado é "mera montagem de clipes" sem fluidez de transição; (3) consumo de recursos alto.
- Fonte: https://arxiv.org/abs/2408.11788

### MovieAgent (ShowLab, arXiv 2503.07314)
- **Hierarquia de 3 níveis**: Director Agent (decompõe script em unidades narrativas) → Scene Plan Agent (cenas com personagens, tom, estilo visual) → Shot Plan Agent (câmera, luz, tipo de shot, legendas). Entrada = roteiro + **banco de personagens** (fotos de referência).
- **CoT interno em 5 passos** por agente: análise da estrutura narrativa → extração de elementos → definição de fronteiras → refino cinematográfico → planejamento técnico.
- **Ferramentas**: StoryDiffusion/AutoStory/Magic-Me (imagem com identidade), CogVideoX (vídeo), VALL-E X (voz), Hallo2/EdTalk (talking head).
- **Resultados**: SOTA em fidelidade ao script (3.89/5) e consistência de personagem (4.04/5); motion smoothness 97.8%.
- **Falhas admitidas (taxonomia útil)**: distorção facial; confusão de identidade entre frames; falha em ações compostas (falar+andar); transições abruptas entre cenas; violações de física/anatomia. Avaliação humana só com 3 filmes (custo).
- Fonte: https://arxiv.org/abs/2503.07314 · https://github.com/showlab/MovieAgent

### StoryAgent (arXiv 2411.04925)
- **5 agentes**: Agent Manager (orquestrador LLM que decide o próximo agente), Story Designer, Storyboard Generator (gera→remove sujeito por segmentação→redesenha personagem com AnyDoor fine-tunado), Video Creator (LoRA-BE: LoRA + 16 embeddings por módulo de cross-attention para identidade intra-shot), **Observer** (avaliador).
- **Lição honesta**: o Observer usa LAION aesthetic predictor e os próprios autores admitem que é **pouco confiável** — sugerem que o usuário prefira avaliação humana. Crítico automático fraco = loop inútil.
- **Falhas**: shots longos, humanos customizados e múltiplos sujeitos coerentes seguem sem solução.
- Fonte: https://arxiv.org/abs/2411.04925

### VideoGen-of-Thought / VGoT (arXiv 2412.02259, NeurIPS 2025 wksp)
- **Pipeline training-free em 4 módulos**: (1) storyline dinâmico — prompt vira drafts de shot expandidos em **5 domínios** (dinâmica de personagem, continuidade de fundo, evolução de relações, câmera, iluminação HDR) **com self-validation** que rejeita candidatos violando princípios cinematográficos; (2) keyframes com **embeddings de identidade (IPP tokens)** que preservam quem é o personagem mas permitem envelhecer/mudar expressão; (3) vídeo por shot; (4) suavização cross-shot com reset de latentes na fronteira.
- **Resultados**: +20.4% consistência facial intra-shot, +17.4% consistência de estilo; 66.7% "Good" em consistência cross-shot.
- **Falhas**: limitado pelos modelos-base (DynamiCrafter falha em trajetórias de câmera complexas); transições só entre shots adjacentes.
- Fonte: https://arxiv.org/abs/2412.02259

### AesopAgent (Alibaba, arXiv 2403.07952)
- História→vídeo em 2 camadas: **Horizontal Layer** — sistema evolutivo **RAG-based** que acumula experiência de especialistas e otimiza os prompts/workflow ao longo do tempo (o sistema "aprende" receitas); **Utility Layer** — utilitários de imagem consistente, áudio, efeitos e montagem.
- **Lição**: memória de expertise (RAG de "o que funcionou") como mecanismo de melhoria contínua do pipeline, ortogonal ao loop de crítica por item.
- Fonte: https://arxiv.org/abs/2403.07952

### MAViS (arXiv 2508.08487) — o mais próximo de um blueprint de produto
- **6 estágios sequenciais**: roteiro → shot design (7 elementos: fundo, pose, ação, props, posição/movimento de câmera, luz) → modelagem de personagem (treina LoRA por personagem) → keyframes (T2I) → animação (I2V) → áudio.
- **Princípio 3E em todo estágio**: **Explore** (gera N candidatos) → **Examine** (revisores especializados em paralelo — no roteiro: Structure/Content/Style Reviewers) → **Enhance** (refina o candidato de maior score). Itera até satisfazer a especificação.
- **Guidelines de roteiro conscientes das limitações do gerador** (grande insight): evitar shots sucessivos no mesmo fundo, 1 ação simples por shot, minimizar transições espaciais complexas, excluir detalhes visuais finíssimos — ou seja, **o roteirista escreve para o que o gerador consegue fazer**.
- **Resultados**: 69.4% de preferência vs VGoT/Mora/MovieAgent; CLIP score 34.22.
- **Falhas admitidas**: paradigma T2I+I2V limita diversidade de shots; sem diálogo/interação entre personagens; **avaliadores multimodais não confiáveis** limitam deploy; **~13.6h em 2×H100** por vídeo longo.
- Fonte: https://arxiv.org/abs/2508.08487

**Padrão transversal dos papers**: todos convergem para (1) hierarquia script→cena→shot; (2) keyframe barato antes de vídeo caro; (3) identidade de personagem como problema nº1 (resolvido com referência visual/LoRA/embedding, nunca só com prompt); (4) crítico multimodal como elo mais fraco reconhecido.

---

## 2. Como produtos comerciais decompõem a produção e onde põem o humano

| Produto | Decomposição | Controles expostos | Humano no loop |
|---|---|---|---|
| **LTX Studio** | Script → cenas → shots → timeline. Cola um roteiro e ele quebra em cenas, gera thumbnail de storyboard por shot | Framing, ângulo, movimento de câmera (crane, tracking, órbita 3D), cast persistente (aparência/figurino por personagem), estilo global do projeto | Humano edita **no storyboard barato** (imagem estática) antes de renderizar vídeo; timeline final editável. É o produto mais próximo do pipeline acadêmico |
| **Google Flow (Veo 3.x)** | Projeto → clipes → **SceneBuilder** (estende shot preservando movimento, "jump to") | **Ingredients** (personagens/objetos/cenários reutilizáveis, criados via Imagen ou upload) combinados por geração; controles de câmera explícitos; Gemini interpreta direção | Humano cura os ingredients, escolhe takes, estende/corta no SceneBuilder; iteração por variantes |
| **Sora (OpenAI)** | **Storyboard**: timeline onde o usuário posiciona cards de caption em pontos no tempo; cada card descreve o que acontece | Remix (variação dirigida), Re-cut, Blend, Loop, presets de estilo; no app Sora 2, "cameos" (identidade do usuário inserida) | Humano escreve/reordena os cards e seleciona variações — direção por edição de plano, não por prompt único |
| **Runway (Gen-4)** | Shot a shot com **referências visuais**: 1 imagem de referência gera personagem/lugar consistente em qualquer ângulo/luz ("coverage" de uma cena de vários ângulos) | Referências de sujeito/estilo/lugar + descrição da composição; Act-One (performance facial dirigida por vídeo do usuário) | Humano fornece as referências (âncora de consistência) e monta a sequência fora ou no editor |
| **Higgsfield** | Suite agregadora: imagem → animação → EditLayers (pós) → montagem | **1500+ presets** de câmera/efeito (explosões, transições) — controle por catálogo, não por prompt livre; agrega modelos de terceiros (Seedance, Nano Banana); MCP/CLI para orquestrar via Claude | Humano escolhe preset + asset; projetos são inspecionáveis (prompts e assets visíveis) para remix |
| **Kling** | Multi-elements/referências para consistência; Kling 3.0 anuncia storyboard inteligente multi-shot com áudio nativo e consistência de personagem entre shots | Elementos (personagem/objeto) reutilizáveis, extensão de vídeo, controle de câmera | Humano define elementos e aprova shots |
| **InVideo / Pictory (classe "artigo→vídeo")** | Script/artigo → cenas com mídia (stock ou gerada) + narração + legendas, uma cena por sentença/parágrafo | Edição por comando de texto ("troca a cena 3"), templates, voz | Humano revisa cena a cena; automação alta, ambição visual baixa |

**Convergência comercial**: (1) todo mundo expõe a hierarquia **projeto→cena/shot→take**; (2) consistência via **asset de referência curado pelo humano** (ingredient/cast/reference/element) — nenhum produto confia em prompt textual para identidade; (3) o humano é posto no loop **no ponto mais barato**: storyboard estático ou seleção de variantes, nunca "aprova o vídeo final de 5 min"; (4) ninguém vende autonomia total — vendem *controle* (câmera, casting, timeline).

---

## 3. Avaliação automática: o que funciona

**Benchmarks de dimensões (métricas especializadas por eixo)**
- **VBench** (CVPR 2024, arXiv 2311.17982): 16 dimensões, cada uma com método dedicado — consistência de sujeito (features DINO frame a frame), consistência de fundo (CLIP), flickering temporal, motion smoothness (RAFT/optical flow), dynamic degree, estética (LAION aesthetic predictor), qualidade de imagem (MUSIQ/IQA-PyTorch), aderência semântica (objetos via RAM/GRiT, ação, cor, relação espacial, estilo via ViCLIP). **VBench++** adiciona I2V, vídeo longo e trustworthiness. Insight de design: **decompor "qualidade" em dimensões, cada uma com o detector certo — não um score único**.
- **VBench-2.0** (arXiv 2503.21755): 18 capacidades em 5 eixos (fidelidade humana, controlabilidade, criatividade, **física**, senso comum) usando **generalistas (VLMs/LLMs) + especialistas (detectores de anomalia)** — o estado da arte em detecção de artefatos: anatomia errada, violação de física, incoerência de senso comum.
- **EvalCrafter** (CVPR 2024, arXiv 2310.11440): 17 métricas objetivas em 4 grupos (visual, conteúdo, movimento, alinhamento texto-vídeo), com **coeficientes regredidos contra opinião humana** — média ponderada calibrada correlaciona mais que média simples.

**Modelos-juiz treinados (o que usar como gate barato)**
- **VideoScore** (arXiv 2406.15252): MLLM (Mantis) fine-tunado no VideoFeedback (37.6K vídeos com notas humanas multi-aspecto); Spearman 77.1 com humanos (~50 pts acima das métricas anteriores). Serve como **avaliador e como reward para RLHF** — o juiz vira sinal de treino/seleção.
- **MLLM-as-a-Judge** (ICML 2024, arXiv 2402.04788) e **VideoJudge** (arXiv 2509.21451): juízes multimodais alinham melhor em **comparação par-a-par do que em nota absoluta**; escalar supervisão via bootstrapping. Caveat consistente na literatura (e admitido por StoryAgent e MAViS): juiz multimodal genérico ainda é pouco confiável para score absoluto — usar para *ranking entre candidatos* e *detecção de falha grosseira*, não como nota fina.

**Métricas de consistência (baratas, determinísticas — rodar sempre)**
- **Identidade facial**: embedding de face (ArcFace/insightface) entre keyframes/cenas — formalizado no DreamFactory como **Cross-Scene Face Distance (CSFD)**.
- **Estilo**: classificação de estilo por VLM por keyframe + proporção do estilo dominante (**CSSC**, DreamFactory); ou CLIP/DINO similarity entre frames.
- **Aderência ao plano**: CLIP score entre keyframe e descrição da cena (barato, roda antes de animar).

**Padrão generator-critic / evaluator-optimizer**
- **Anthropic (Building Effective Agents)**: evaluator-optimizer compensa quando há **critérios de avaliação claros** e o refino iterativo agrega valor mensurável; caso contrário é custo sem ganho.
- **Self-Refine** (arXiv 2303.17651): ~20% de melhoria média com o próprio modelo criticando — mas em vídeo o crítico precisa ser **multimodal e olhar o artefato gerado**, não o prompt (Anim-Director e MAViS fazem isso; quem critica só texto não pega artefato visual).
- Implementações no domínio: Critique-Correct-Verify e Debate-Judge (FilmAgent, na fase de texto); Monitor por frame (DreamFactory); 3E com revisores paralelos especializados (MAViS); Observer (StoryAgent — falhou por crítico fraco).

---

## 4. Padrões de orquestração recomendados para pipeline de geração cara

**Topologia: híbrido "pipeline hierárquico com loops locais bounded" — não blackboard, não swarm.**
- Todos os sistemas que funcionaram são **pipelines lineares com hierarquia de planejamento** (script→cena→shot) e loops de crítica *dentro* de cada estágio. Nenhum sistema de vídeo bem-sucedido usa blackboard/negociação livre — a "conversa" do DreamFactory funciona, mas com rodadas fixas e output demarcado (`<INFO>`), o que na prática é um pipeline disfarçado. Orchestrator-workers (Anthropic) se aplica no nível do plano: o diretor decide *quantos* shots e delega, porque o número de subtarefas depende do input.

**Handoff por artefato estruturado, nunca por conversa.**
- Os handoffs que funcionam são documentos tipados: video plan com entidades e grupos de consistência (VideoDirectorGPT), shot spec de 7 elementos (MAViS), scene/shot plan (MovieAgent), 5 domínios com self-validation (VGoT). Conversa livre entre agentes só aparece na fase criativa de texto (FilmAgent debate) — e mesmo lá com juiz. **Schema de shot recomendado**: id, cena, descrição da ação (1 ação simples), personagens (refs), fundo, câmera (posição+movimento), luz, duração, dependências de continuidade.

**Escada de custo: gerar barato → validar → só então gerar caro.**
- Padrão universal: texto (centavos) → keyframe T2I (~centavos) → **validar identidade/estilo/CLIP no keyframe** → I2V (caro) → validar vídeo → montagem/áudio. LTX Studio vende exatamente isso (aprovação humana no storyboard estático). Nunca deixar erro de roteiro ser descoberto no vídeo renderizado — cada estágio tem gate próprio. Corolário do MAViS: **o roteirista deve conhecer as limitações do gerador** (guidelines anti-falha embutidas no prompt do agente de script reduzem retries caros lá na frente).

**Loops de crítica com budget explícito.**
- Mora: máx 3 iterações/estágio; DreamFactory: rodadas fixas; MAViS: gera N candidatos, refina só o melhor. Sem budget, loop com juiz ruidoso diverge e queima crédito. Regra prática: **best-of-N + 1 rodada de refine** no estágio caro; iteração ilimitada só em texto.
- Critérios por gate em ordem de custo: (1) determinístico (duração, resolução, presença de personagem via face-detect, CLIP vs plano); (2) embedding (ArcFace CSFD, DINO estilo); (3) VLM-judge para ranking par-a-par entre takes e detecção de artefato grosseiro. Não usar VLM para nota absoluta fina (falha admitida por StoryAgent/MAViS).

**Paralelizar geração, não planejamento.**
- Shots são independentes dado o plano + refs de identidade → gerar em paralelo (keyframes e clipes). Revisores também paralelizam (MAViS: Structure/Content/Style simultâneos). O que NÃO paraleliza: o plano (fonte única de consistência) e a suavização cross-shot (dependência sequencial de fronteira).

**Consistência é infraestrutura, não prompt.**
- Adotar o padrão comercial: **banco de assets/ingredients** (referência visual por personagem/local, opcionalmente LoRA/embedding por personagem como MAViS/VGoT) criado uma vez no início do projeto e injetado em toda geração. Grupos de consistência declarados no plano (VideoDirectorGPT).

**Humano no loop no ponto de maior alavancagem.**
- Dois pontos comprovados: (1) aprovação do storyboard/keyframes antes do render caro (LTX, prática dos papers); (2) seleção entre variantes do resultado caro (Sora remix, Flow). Evitar: pedir aprovação por micro-etapa (mata o valor) ou só no final (desperdício).

**O que evitar (falhas recorrentes admitidas)**
- Crítico estético fraco como gate (StoryAgent/LAION) — pior que não ter gate, dá falsa confiança.
- Esperar criatividade narrativa emergente dos agentes (DreamFactory admite que não vem) — investir no input humano/brief criativo.
- Ações compostas num shot (MovieAgent falha em "falar andando") — o planner deve decompor em shots de 1 ação.
- Pipeline sem estimativa de custo: MAViS gasta ~13.6h/2×H100 por vídeo longo; Mora admite inviabilidade de acesso. Orçar tokens+GPU por shot e expor isso no plano antes de executar.
- Complexidade especulativa: Anthropic — começar com prompt chaining simples e só adicionar agente/loop quando a métrica justificar.

### Fontes principais
FilmAgent arXiv:2501.12909 · VideoDirectorGPT arXiv:2309.15091 · Anim-Director arXiv:2408.09787 · Mora arXiv:2403.13248 · DreamFactory arXiv:2408.11788 · MovieAgent arXiv:2503.07314 · StoryAgent arXiv:2411.04925 · VGoT arXiv:2412.02259 · AesopAgent arXiv:2403.07952 · MAViS arXiv:2508.08487 · VBench arXiv:2311.17982 / VBench++ 2411.13503 / VBench-2.0 2503.21755 · EvalCrafter arXiv:2310.11440 · VideoScore arXiv:2406.15252 · MLLM-as-a-Judge arXiv:2402.04788 · VideoJudge arXiv:2509.21451 · Self-Refine arXiv:2303.17651 · anthropic.com/engineering/building-effective-agents · ltx.io/studio · blog.google (Flow/Veo) · runway.com (Gen-4) · higgsfield.ai · kling.ai
