# 12 — Direção de cena: base de conhecimento de craft

> Consumidores deste doc: (1) o system prompt do diretor de cenas (gemini-2.5-pro), (2) os
> validadores de shot list e keyframe, (3) o motor editorial (campos que o roteiro precisa
> entregar), (4) humanos revisando golden files. Cada princípio traz: enunciado, fonte e
> **como o pipeline aplica** (prompt, validador ou feature). Princípio sem "vira" não entra.
>
> Origem: pesquisa de craft (montagem, fotografia, publicidade, AI-video, plataforma, som)
> auditada pelo parecer do cético em 2026-08-19. Contradições internas já resolvidas aqui;
> o registro do que foi cortado está na §9.
>
> Invariantes do pipeline que este doc NUNCA revoga: o diretor não escreve nem reescreve a
> fala (escolhe frases por índice); gramática fechada de escala/ângulo/lente/movimento;
> corte só em fronteira de frase; avatar = fabric-1.0 (câmera parada, MEIO_CLOSE/CLOSE);
> b-roll sempre com movimento; sem ffmpeg — todo "look" nasce no keyframe, todo som é
> mixado por modelos do Replicate.

---

## 0. Sumário executivo

Programa de pesquisa de craft (estrutura narrativa, montagem, fotografia, AI-video, retenção, som e avatar), auditado pelo parecer do cético em 2026-08-19: schemas load-bearing verificados no Replicate, 4 contradições internas resolvidas, 12 itens cortados. Resultado: ~60 princípios com fonte e "vira" — a maioria entra **já** no prompt do diretor e nos validadores (custo zero por vídeo); 8 viram features priorizadas.

### Os 5 achados de maior impacto

1. **Look lock verbatim** — um bloco fixo de look (film stock, luz motivada far-side 4:1, paleta 60-30-10 com a cor da marca em 10%) colado literalmente em todo keyframe é o color grade sem pós: coerência entre 6-8 clipes gerados independentemente é o que separa "dirigido" de "colagem de IA". Custo zero. (No Film School, Wolfcrow, In Depth Cine, guia oficial Nano Banana.)
2. **Legendas queimadas** — 85% assiste mudo no Facebook (WordStream) e captions dão +80% de conversão no TikTok (Creative Codes); `fictions-ai/autocaption` custa ~US$0,025/run e o transcript já existe (é o roteiro).
3. **Camada de som S1→S5** — room tone + trilha + foley matam o "TTS no vácuo", sinal nº 1 de amadorismo (Kukarella); 93% assiste com som no TikTok (TikTok/Kantar). Mecanismo verificado: `lucataco/video-audio-merge` com `replace_audio: false` mixa. ~US$0,50/reel.
4. **Contrast cut com composição espelhada** — o par antes/depois usa mesma escala/ângulo/lente com o hero_object mudando de estado; nasce no keyframe (keyframe A como referência do B), não na pós. (MasterClass, StudioBinder, Slack Story.)
5. **Trilha de voz contínua + fabric só nas frases-âncora** — única mudança estrutural: a voz atravessa os cortes (L-cut real — Epidemic Sound, FilmDaft), destrava o cutaway ≤8s e reduz o custo de fabric.

### O que muda já (prompt + validador, sem feature nova)

No prompt do diretor: conceito concreto + `hero_object`, look lock, `screen_direction` por cena, função→emoção→escala antes de câmera, `scene_action` em frame de pico, luz com fonte diegética nomeada, `relation_to_line` com quota de juxtapose, `visual_correlate` para todo número, cutting on action (`exit/entry_motion`), ritmo 7-10 planos/2,5-6s, in medias res, re-hook 9-13s, avatar ≤40% e nunca consecutivo, CTA olho no olho. Nos validadores: presença literal do look lock, linter de tokens proibidos ("8k", "evenly lit"…), regra dos 30° sobre enums, check 20/30/50 sobre duração medida do TTS, anti-wallpaper, safe zones Meta 14/35/6.

### O que vira feature (ordem)

P1 legendas queimadas (S) · P2 first/last frame para `flow` e match cut via `return_last_frame` do seedance (S) · P3 validador de look/grade (S) · P4 trilha de voz contínua (M, pré-requisito de P5) · P5 som S1→S5 (M) · P6 validador técnico de saída + safe zones (S) · P7 telemetria de hook rate/retenção (M, fecha o loop) · P8 variantes A/B de hook (M). P1-P3 e P6 são paralelizáveis.

### Pesquisado e descartado

- J-cut com offset de −300/−600ms — exige trim sub-segundo; não existe sem ffmpeg.
- "Avatar fala o parágrafo inteiro, mostramos trechos" — exige trim do clipe fabric.
- Delayed reveal como lint — contradiz results-first (evidência mais forte); virou variante A/B.
- Extrair último frame via modelo utilitário — seedance já expõe `return_last_frame`.
- `bpm = 240/duração` — matematicamente errado; corrigido para `clamp(480/dur, 85, 115)`.
- Safe zone "rodapé 20-25%" e legenda a 65-70% — substituídos pelo guia oficial Meta (14/35/6; legenda a ~58-62%).
- Custo autocaption US$0,12 — real ~US$0,025.
- Tags [excited] e "1-2 gestos/min" — controles de HeyGen/VEED que minimax+fabric não expõem.
- Ranking fechado de ROI de SFX — juízo editorial sem fonte.
- "Sem catchlight o fabric não anima o olho" — sem fonte; rebaixado a hipótese de teste.
- Stats "89% completion" e "25-40% creator-style" — fontes fracas; rebaixados a direcionais.
- Alvo 26-34s — contradiz a spec do produto; virou 30-34s.

---

## 1. Estrutura narrativa — o formato, beat a beat

### 1.1 Results-first: o número é o hook
O resultado numérico principal é FALADO na primeira frase; o bloco 1 tem ≤2 frases e
contém dígito; o plano 1 nunca é logo nem establishing.
Fontes: [Factors.ai](https://www.factors.ai/blog/linkedin-ad-copy-best-practices), [AdKit](https://adkit.so/resources/ads-examples/b2b-ad-examples), [TikTok Creative Codes](https://ads.tiktok.com/business/en/creative-codes).
**Pipeline:** lint do motor editorial (bloco 1: ≤2 frases + regex de dígito); lint do
diretor (plano 1 ≠ AMPLO_VERTICAL de ambiente, ≠ logo). "Delayed reveal" (dado-herói a
~70%) NÃO é lint — é variante deliberada de teste A/B (decisão do cético: results-first é
o default por evidência mais forte).

### 1.2 Arco Hook–Body–Close com CTA verbal explícito
Estrutura fixa: gancho (dor/resultado) → corpo (prova) → fechamento com CTA dito em voz.
CTA explícito = +152% conversão.
Fontes: [TikTok](https://ads.tiktok.com/business/en-US/blog/creative-that-drives-conversions), [Creative Codes](https://ads.tiktok.com/business/en/creative-codes).
**Pipeline:** schema do auditor de roteiro exige papel `hook|body|close` por bloco e CTA
verbal no último; quando a feature de legenda queimada existir, o CTA também vira texto
no último plano.

### 1.3 Demonstração > afirmação — `prova_visual` por bloco
Toda frase de claim precisa de algo que a câmera VÊ provando a frase: sujeito + verbo de
trabalho + objeto tangível; ≥1 demonstração física do processo por vídeo.
Fontes: [Ogilvy — How to Create Advertising That Sells](https://gundir.com/resource/how-to-create-advertising-that-sells-by-david-ogilvy/), [Honda Cog](https://www.campaignlive.co.uk/article/feature-making-honda-cog/181579), [Volvo Live Tests](https://www.contagious.com/news-and-views/insight-strategy-live-tests).
**Pipeline:** campo `prova_visual` obrigatório por bloco de fala no roteiro; o diretor
transforma em plano de prova; validador rejeita bloco `body` sem prova_visual.

### 1.4 Before/after = contrast cut com composição espelhada
O par "estado A / estado B" usa a MESMA escala, ângulo e lente; o corte cai na fronteira
"antes.../hoje...". É o corte mais "de diretor" que o pipeline alcança porque nasce no
keyframe, não na pós.
Fontes: [MasterClass — match cut](https://www.masterclass.com/articles/how-to-use-a-match-cut-transition-when-editing-a-film), [StudioBinder — smash cut](https://www.studiobinder.com/blog/what-is-a-smash-cut-definition/), [Slack Story](https://www.slackstory.com/p/so-yeah-we-tried-slack).
**Pipeline:** o diretor marca o par com `contrast_pair`; na geração, o keyframe A entra
como imagem de referência do nano-banana-2 ao gerar o keyframe B (mesmas refs + frase de
composição idêntica). Ver §5.6 para a versão com first/last frame.

### 1.5 Número vira objeto contável — `visual_correlate`
Todo número falado tem correlato físico contável no quadro (11 pastas → 2 pastas; 14
etapas → 3 post-its). Concretude é o que fixa memória.
Fontes: [Made to Stick](https://en.wikipedia.org/wiki/Made_to_Stick), [Caterpillar Jenga](https://www.fastcompany.com/3029197/caterpillar-plays-jenga-with-600-pound-blocks-and-massive-machines).
**Pipeline:** campo `visual_correlate` obrigatório no plano que cobre frase com dígito;
validador rejeita plano de prova cujo visual_prompt não contém o correlato.

### 1.6 Hero object + packshot final
Um objeto físico do caso é o protagonista: campo `hero_object` no blueprint; aparece em
≥3 planos; está nos DOIS lados do contrast cut (é ele que muda de estado); penúltimo ou
último plano = close dele no estado "depois" (tableau/button).
Fontes: [Ogilvy — Make the Product the Hero](https://www.thebigad.com/2019/02/19/make-the-product-the-hero-david-ogilvy/), [hero prop](https://movieproprentals.net/what-is-a-hero-prop/), [hero shot](https://digitalartthatrocks.com/blog/2022/1/19/what-is-a-hero-shot-in-commercial-advertising-photography).
**Pipeline:** `hero_object` no output do diretor; still do objeto entra no asset pack e
nas referências do nano-banana-2 em todo plano em que ele aparece; validador conta ≥3
ocorrências e checa o tableau final.

### 1.7 Proporção 20/30/50 (problema/solução/resultado)
O tempo de tela pende para resultado, não para o problema.
Fontes: [Storimatic](https://www.storimaticstudio.com/blog/testimonial-video-b2b/), [Dock](https://www.dock.us/revenue-archives/testimonial-videos).
**Pipeline:** check aritmético sobre a duração MEDIDA (TTS real) dos blocos, com
tolerância ±10 p.p.; auditor sugere corte no bloco de problema quando estoura.

### 1.8 Um filme = uma ideia
Um claim central por vídeo; o segundo número é kicker no fechamento, nunca abertura.
Fonte: [Volvo Live Tests](https://www.contagious.com/news-and-views/insight-strategy-live-tests).
**Pipeline:** lint do motor editorial rejeita roteiro com >1 claim central.

### 1.9 Dois níveis de leitura
A ação principal é legível por leigo; a camada de fundo carrega detalhe técnico correto
(EPI certo, tela de ERP crível, O.S. na prancheta) que compra o especialista.
Fonte: [Volvo Live Tests](https://www.contagious.com/news-and-views/insight-strategy-live-tests).
**Pipeline:** instrução do diretor: todo keyframe de ambiente industrial declara 1
detalhe técnico crível na camada de fundo, nunca competindo com a ação principal.

### 1.10 Calma sobre espetáculo
Intensidade da voz e intensidade da imagem nunca sobem juntas; a narração fica MAIS
pausada nos planos de maior ação (Epic Split: voz calma sobre feito absurdo).
Fontes: [Epic Split](https://www.contagious.com/news-and-views/insight-strategy-live-tests), [Honda Cog](https://www.thedrum.com/news/2022/06/14/world-s-best-ads-ever-1-the-honda-spot-started-chain-reaction).
**Pipeline:** validador cruza direção de emoção do TTS (parâmetros minimax por bloco) com
`visual_intensity` do plano; pico visual + pico vocal simultâneos = warning.

### 1.11 Pacing verbal: o gate é o TTS medido
Word count (30s ≈ 65-80 palavras) é só pré-filtro barato no motor editorial; o gate real
é a duração medida do áudio TTS por bloco — o pipeline gera TTS antes do corte, então usa
o número real, nunca estimativa.
Fontes (fracas, só pré-filtro): [Ghostwriting LLC](https://ghostwritingllc.com/blog/how-to-write-a-script-for-a-30-second-commercial-step-by-step-guide/), [Cybertize](https://cybertizemedia.com/blog/ad-film/how-to-write-a-script-for-a-30-second-ad/).
**Pipeline:** pré-filtro de word count no roteiro; validador de duração real pós-TTS.

### 1.12 Duração-alvo: 30-34s
Interseção da faixa oficial TikTok (21-34s, +280%) com a spec do produto (30-40s).
Fontes: [TikTok](https://ads.tiktok.com/business/en-US/blog/creative-that-drives-conversions), [Dataslayer/Mosseri](https://www.dataslayer.ai/blog/instagram-algorithm-2025-complete-guide-for-marketers).
**Pipeline:** validador ANTES do TTS (estimativa) e depois dele (medido); em 38s o
auditor corta bloco redundante em vez de aceitar.

### 1.13 Beat sheet canônico de 8 planos (golden file)
Formato-referência (ajustado ao teto de 6s/plano, §2.7):
1. Hook in medias res com o número (avatar CLOSE ou detalhe de prova) · 2. Prova do
problema (b-roll DETALHE, visual_correlate "antes") · 3. Avatar MEIO_CLOSE apresenta o
caso · 4. Processo em ação (b-roll com scene_action) · 5. Contrast cut → estado "depois"
(composição espelhada de 2) · 6. Re-hook 9-13s: mudança de cenário/escala · 7. Resultado
+ kicker (b-roll prova, o plano mais longo, 5-6s) · 8. Avatar CLOSE olho-no-olho, CTA +
tableau do hero_object (eco do cenário do plano 1).
**Pipeline:** golden files em `docs/golden-set/`; nenhum plano acima de 6s.

### 1.14 Lista NUNCA (lint negativo do roteiro/decupagem)
Nunca: logo/branding no plano 1 · establishing genérico de fachada/escritório ·
"há 30 anos no mercado" como abertura · jargão sem tradução física · voz e imagem
redundantes o filme inteiro (wallpaper) · watermark · informação essencial fora da safe
zone (topo 14% / fundo 35% / laterais 6%, §6.4).
Fontes: [1827 Marketing](https://1827marketing.com/smart-thinking/why-your-b2b-video-marketing-strategy-is-failing-and-how-to-correct-it), [Dan Salva](https://www.dansalva.com/blog/2025/1/17/your-brand-needs-a-manifesto-movie), [Behaviour Digital — Meta safe zone 2026](https://behaviour.digital/post/meta-reels-safe-zone-14-top-35-bottom-6-sides-the-2026-official-guide).
**Pipeline:** lint. (Item "número entregue cedo demais" foi REMOVIDO — contradizia §1.1.)

---

## 2. Montagem e ritmo

### 2.1 Regra dos Seis (Murch) com hierarquia de severidade
A ordem de prioridade de um corte: emoção > história > ritmo > eixo/continuidade. Corte
que não muda estado emocional/informacional = *error*; violação de continuidade =
*warning*. Nunca rejeitar um plano emocionalmente certo por pecado de continuidade.
Fontes: Murch, *In the Blink of an Eye*; [StudioBinder](https://www.studiobinder.com/blog/walter-murch-rule-of-six/), [No Film School](https://nofilmschool.com/2016/11/6-rules-good-cutting-according-oscar-winning-editor-walter-murch).
**Pipeline:** campo `emotional_beat` obrigatório por plano; validador com dois níveis de
severidade nessa ordem.

### 2.2 1 frase = 1 ideia
Frase com duas ideias é quebrada em dois blocos → dois planos. Como o corte só existe em
fronteira de frase, isso alinha o corte com a "blink theory" de graça.
Fonte: [PremiumBeat — blink theory](https://www.premiumbeat.com/blog/when-and-where-to-make-the-cut-inspired-by-walter-murchs-in-the-blink-of-an-eye/).
**Pipeline:** lint do motor editorial quebra frases compostas antes de numerá-las.

### 2.3 Trilha de voz contínua + L-cut (a única mudança estrutural)
A voz atravessa os cortes — o que separa filme de slideshow sonoro. Operacionalização
viável SEM trim de vídeo: (1) narração como faixa contínua (concatenar os áudios TTS por
bloco); (2) fabric gerado APENAS para as frases-âncora, cada uma com seu próprio segmento
de áudio (lip-sync garantido: a faixa contínua é a concatenação dos mesmos segmentos);
(3) frases do meio viram b-roll seedance mudo; (4) concatena o vídeo mudo e deita a faixa
contínua por cima com `lucataco/video-audio-merge`. Resultado: L-cut real, cutaway
barato, custo de fabric cai. J-cut fino (offset de -300/600ms) fica para quando existir
primitiva de trim — hoje é impossível.
Fontes: [Epidemic Sound](https://www.epidemicsound.com/blog/j-cuts-and-l-cuts/), [TechSmith](https://www.techsmith.com/blog/how-to-edit-videos-l-cuts-and-j-cuts/), [FilmDaft](https://filmdaft.com/the-l-cut-and-j-cut-how-film-editors-use-audio-to-control-time/).
**Pipeline:** FEATURE (roadmap P4); o diretor já marca quais frases são âncora de avatar.

### 2.4 Cutting on action — `exit_motion`/`entry_motion`
O movimento no fim do plano A continua ou responde no início do plano B; proibido
`none`→`none`; proibida inversão brusca de vetor de câmera entre planos contíguos
(dolly-in → pan reverso), exceto "hit" deliberado da curva de ritmo; o keyframe do plano
B descreve o gesto na FASE SEGUINTE, nunca em repouso.
Fontes: [cutting on action](https://en.wikipedia.org/wiki/Cutting_on_action), [Filmsupply](https://www.filmsupply.com/articles/cutting-on-action-editing/), [Hailuo — trajectory matching](https://hailuoai.video/pages/knowledge/trajectory-matching-seamless-ai-video-cuts).
**Pipeline:** campos `exit_motion`/`entry_motion` por plano; validador de pares.

### 2.5 Direção de tela por cena
`screen_direction`/`axis_side` e `light_direction` são herdados por todos os planos da
mesma cena; o prompt declara o lado ("subject facing frame-right"); flip de eixo só com
plano neutro (frontal ou detalhe) entre os dois.
Fontes: [StudioBinder](https://www.studiobinder.com/blog/what-is-screen-direction-in-film/), [Hailuo — shot-reverse-shot](https://hailuoai.video/pages/knowledge/director-guide-shot-reverse-shot-spatial-logic).
**Pipeline:** atributo de cena no output do diretor; compilador de keyframe injeta a
frase de lado; validador de flip.

### 2.6 Regra dos 30° / delta mínimo entre planos vizinhos
Par consecutivo com mesma escala E ângulo similar do mesmo sujeito = jump cut acidental.
Fonte: convenção de continuidade (léxico MIT, [EditMentor](https://editmentor.com/)).
**Pipeline:** o check mais barato de todos — puro código sobre os enums, sem LLM.

### 2.7 Ritmo: 7-10 planos; piso 2,5s; teto duro 6s (regra reconciliada)
5+ cenas = +171% conversão; plano estático >5s mata retenção; MAS corte rápido demais é
anti-persuasão em B2B (spots de 1-5 planos = +36% persuasão vs 20+; planos <1,5s
prejudicam reconhecimento). A variação importa mais que a velocidade: durações
decrescentes rumo ao clímax; o plano mais longo dentro do teto (5-6s) é o da
prova/tableau final — nunca a introdução.
Fontes: [MacLachlan & Logan](https://www.thefreelibrary.com/Camera+shot+length+in+TV+commercials+and+their+memorability+and...-a013980912), [TikTok](https://ads.tiktok.com/business/en-US/blog/creative-that-drives-conversions), [PremiumBeat](https://www.premiumbeat.com/blog/cutting-commercials-editing-15-30-and-60-second-spots/), [StudioBinder — rhythm](https://www.studiobinder.com/blog/how-does-an-editor-control-the-rhythm-of-a-film/), [Aibrify](https://aibrify.com/blog/youtube-shorts-retention-curve-playbook).
**Pipeline:** validador sobre as durações TTS medidas por plano; avatar tem teto técnico
adicional de 9s (fabric), mas o alvo editorial é o mesmo 6s.

### 2.8 Escala segue a curva emocional
O close mais fechado do vídeo cai no clímax; não "gastar" o close antes sem escalada.
Fontes: [Learn About Film](https://learnaboutfilm.com/film-language/picture/shotsize/), [Frontiers in Neuroscience — ERP](https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2023.1173704/full).
**Pipeline:** validador compara a série de escalas com a posição do clímax do roteiro.

### 2.9 Montagem intelectual (Eisenstein)
Imagem que só ilustra a fala desperdiça o corte. Campo `relation_to_line:
illustrate|juxtapose|metaphor`; quota ≥2 planos juxtapose/metaphor por vídeo (no problema
e no clímax).
Fontes: Eisenstein, *Film Form*; [media-studies.com](https://media-studies.com/eisenstein-montage/), [Fiveable](https://fiveable.me/introduction-to-film-theory/unit-7/eisensteins-theories-intellectual-montage/study-guide/7r5XrGSZCScveH3j).
**Pipeline:** campo por plano + quota no validador.

### 2.10 Anti-wallpaper
B-roll que repete literalmente os substantivos da frase é papel de parede. Overlap
literal alto + `illustrate` → exigir especificidade ou reclassificar; b-roll consecutivo
forma micro-sequência com progressão (não dois planos soltos do mesmo assunto).
Fontes: [Desktop Documentaries](https://www.desktop-documentaries.com/5-broll-mistakes-to-avoid.html), [Inside The Edit](https://www.insidetheedit.com/blog/b-roll-editing-structure).
**Pipeline:** validador semântico compara substantivos frase×keyframe.

### 2.11 Contraste/afinidade + primeiro corte antes dos 4s
`visual_intensity` alvo por posição na curva; o clímax contrasta com os vizinhos em ≥2
componentes (escala, movimento, luz, cor); plano 1 in medias res com contraste interno
alto; o primeiro corte acontece antes dos 4s.
Fontes: Bruce Block, *The Visual Story* ([Taylor & Francis](https://www.taylorfrancis.com/chapters/mono/10.4324/9781315794839-2/contrast-affinity-bruce-block)), [OpusClip — hooks](https://www.opus.pro/blog/instagram-reels-hook-formulas).
**Pipeline:** campo `visual_intensity: 1-5` por plano + curva-alvo no validador.

### 2.12 "O que muda no segundo 3?"
Todo plano ≥3s declara a informação nova interna (ação secundária, entrada em
profundidade, revelação) — conecta com o blocking em 3 profundidades (§4.1).
Fonte: [PremiumBeat](https://www.premiumbeat.com/blog/cutting-commercials-editing-15-30-and-60-second-spots/).
**Pipeline:** campo `second_beat` do plano; alimenta o prompt de movimento i2v.

---

## 3. Fotografia e luz

### 3.1 Luz motivada — fonte diegética nomeada
Nunca "cinematic lighting" solto: toda luz tem fonte física nomeada na cena (janela alta
de galpão, luminária de bancada, painel da máquina, poça de sol de clarabóia).
Fontes: [Roger Deakins forums](https://www.rogerdeakins.com/forums/topic/lighting/), [Deakins — Jesse James](https://www.rogerdeakins.com/jesse-james-x-3/), [Pixflow](https://pixflow.net/blog/lighting-for-cinematography/).
**Pipeline:** campo `lighting_source` obrigatório por plano; validador rejeita prompt com
"lighting" sem fonte física na frase.

### 3.2 Far-side key + catchlight (rosto)
Key do lado OPOSTO ao que o rosto mostra à câmera (short key), sombra na bochecha
próxima, catchlight nos olhos.
Fontes: [unfilmschool](https://unfilmschool.com/production/the-hollywood-lighting-technique-that-will-completely-transform-your-cinematography-and-how-to-master-it-in-about-5-minutes/), [Neil Oseman](https://neiloseman.com/introduction-short-key-lighting/), [Catch light](https://en.wikipedia.org/wiki/Catch_light).
**Pipeline:** frases fixas no compilador de keyframe de avatar. Ressalva do cético: "sem
catchlight o fabric não anima o olho" é HIPÓTESE sem fonte — testar A/B, não tratar como
fato.

### 3.3 Ratio ~4:1 + blacklist de luz chapada
Contraste de retrato comercial premium ≈ 4:1. Blacklist: `evenly lit`, `bright and
airy`, `well-lit office`, `flat lighting`, `soft even illumination`.
Fontes: [Wandering DP](https://wanderingdp.com/cinematography/cinematography-school-lighting-ratios-101/), [Indie Cinema Academy](https://indiecinemaacademy.com/academy/how-to-cinematically-light-a-corporate-video/), [In Depth Cine](https://www.indepthcine.com/videos/natural-vs-cinematic-lighting).
**Pipeline:** linter de tokens no visual_prompt; ratio vive dentro do bloco LOOK (§3.8).

### 3.4 Negative fill
O lado escuro do rosto/objeto é o respiro visual do quadro 9:16 — não preencher.
Fontes: [Deakins — negative fill](https://www.rogerdeakins.com/forums/topic/a-soft-warm-light-source-with-strong-falloff/), [FilmLocal](https://filmlocal.com/filmmaking/roger-deakins-cinematography-style/).
**Pipeline:** frase do bloco LOOK ("the unlit side falling into soft darkness").

### 3.5 Fundo ~2 stops abaixo + prática acesa
Todo talking head declara: nível do fundo (mais escuro que o sujeito) + ≥1 ponto de luz
prática nele (painel, luminária, janela ao longe). É o que separa "YouTube" de "cinema".
Fontes: [Indie Cinema Academy](https://indiecinemaacademy.com/academy/how-to-cinematically-light-a-corporate-video/), [DIY Photography](https://www.diyphotography.net/watch-and-learn-the-difference-between-youtube-lighting-vs-cinematic-lighting/).
**Pipeline:** validador de keyframe de avatar; frase no bloco LOOK.

### 3.6 Haze fino industrial
Haze é crível em fábrica e dá profundidade: `thin/subtle haze` em plano de pessoa,
`visible light shafts` só em plano de ambiente.
Fontes: [ASC Shot Craft](https://theasc.com/articles/shot-craft-smoke-and-fog), [Zacuto](https://zacuto.com/blogs/blog/volumetric-lighting-part-2-atmospheric-effects), [Filmmakers Academy](https://www.filmmakersacademy.com/smoke-haze/).
**Pipeline:** regra por escala no compilador de keyframe.

### 3.7 Composição 9:16 — 3 camadas obrigatórias
Olhos no terço superior, headroom justo; toda composição tem FG oclusor (fora de foco) /
sujeito / fundo com luz; wide é raro e só com FG + linha vertical forte.
Fontes: [AXIS AI Studios](https://www.axisaistudios.com/blog/how-to-shoot-for-the-vertical-frame-a-cinematography-guide), [Tone Production](https://toneproduction.net/shooting-vertical-video-framing-9-16-2/), [Vidu](https://www.vidu.com/blog/9-16-video).
**Pipeline:** instrução do diretor + frases do compilador; conecta com blocking (§4.1).

### 3.8 Mapa escala→lente (declarado, 1 lente por keyframe)
CU/MCU = 85mm f/2 · MS = 50mm f/2.8 · ambiente = 35mm · detalhe = 100mm macro.
Fontes: [DIY Photography — 85mm](https://www.diyphotography.net/85mm-portrait-lens-guide/), [Fstoppers](https://fstoppers.com/gear/50mm-vs-85mm-vs-135mm-ultimate-portrait-lens-comparison-714921), [Google Cloud — Nano Banana guide](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana).
**Pipeline:** tabela no compilador (enum SHOT_LENS → frase de lente); validador: 1 lente,
coerente com a escala.

### 3.9 Paleta 60-30-10 + look_lock verbatim — o color grade sem pós
Paleta com proporções amarrada em OBJETOS físicos; `{BRAND_COLOR}` na fatia de 10%, num
único objeto por quadro; a string do bloco LOOK é IDÊNTICA em todos os keyframes do
vídeo. Coerência de cor/luz entre 6-8 clipes gerados independentemente é O que separa
"dirigido" de "colagem de IA" — e custa zero (é string fixa).
Fontes: [No Film School — 60-30-10](https://nofilmschool.com/60-30-10-color-rule), [Wolfcrow](https://wolfcrow.com/why-great-movies-use-the-60-30-10-percent-color-rule/), [In Depth Cine — colour](https://www.indepthcine.com/videos/colour-palette), [MasterClass](https://www.masterclass.com/articles/how-to-create-a-film-color-palette).
**Pipeline:** o diretor escreve o `look_lock` uma vez; o compilador cola LITERALMENTE em
todo keyframe prompt; auditor verifica presença literal do bloco.

### 3.10 BLOCO LOOK INDUSTRIAL (pronto — colar como base do look_lock)
Framing positivo (regra do guia oficial Nano Banana: nunca "no X"); as três negações do
rascunho original já foram reescritas. O diretor pode trocar objetos/locação, nunca a
estrutura:

```text
LOOK LOCK — cole idêntico em todos os keyframes deste vídeo:
Shot on a digital cinema camera with vintage glass: subtle film grain, gentle
halation on bright edges, highlights roll off softly just below pure white.
Single-source motivated lighting — one {FONTE: tall factory window / workbench
lamp / machine panel} as warm key from the far side, contrast around 4:1, the
unlit side falling into soft darkness (negative fill). Background sits about two
stops darker than the subject, with one practical light visible in depth; thin
industrial haze. Palette 60-30-10: 60% desaturated steel-gray and concrete, 30%
warm worn-metal and oxide tones, 10% {BRAND_COLOR} carried by a single physical
object; every other tone in frame desaturated and neutral. Honest textures:
scuffed floor paint, fingerprints on metal, frayed high-vis straps.
```

### 3.11 Specular controlado em máquina/metal
Reflexo em metal: gradiente longo e suave + UM bite duro de highlight; o material é
sempre nomeado (aço escovado, inox, alumínio fundido).
Fontes: [Beverly Boy](https://beverlyboy.com/film-technology/specular-highlights-make-products-pop-on-camera/), [Replica Surfaces](https://www.replicasurfaces.com/blogs/q-as/how-to-photograph-shiny-or-metallic-products-without-glare).
**Pipeline:** frase condicional do compilador quando o keyframe tem máquina/hero metálico.

### 3.12 Premium vs handheld — por tipo de plano
Tensão resolvida (look comercial premium × creator-style que a plataforma premia):
avatar e hero shot = premium (tripé, luz §3.1-3.5); b-roll de processo = handheld
documental (`HANDHELD_SUTIL` default). Proibido "perfect studio lighting / corporate
stock look" no b-roll.
Fontes: [Creative Codes](https://ads.tiktok.com/business/en/creative-codes), [guia algoritmo IG](https://creatorflow.so/blog/instagram-algorithm-2026/).
**Pipeline:** default de `camera_style` por `type` do plano.

---

## 4. Blocking e ação

### 4.1 Blocking em 3 profundidades (plano de correção vigente)
Todo quadro tem ação em FG/MG/BG: oclusor fora de foco na frente, sujeito trabalhando no
meio, vida no fundo (pessoa passando, máquina ciclando, luz de solda pulsando). É o que
alimenta o "segundo 3" (§2.12).
**Pipeline:** frases do compilador de keyframe; o `scene_action` descreve a camada ativa.

### 4.2 `scene_action`: par keyframe/movimento (invariante do plano de correção)
Cada plano de b-roll carrega UMA ação física em duas fases: o keyframe congela a ação a
~60% do gesto (frame de pico), e o prompt i2v descreve a continuação/conclusão do MESMO
gesto. Exatamente 1 ação principal por clipe — 2 ações no bloco → 2 planos.
Fontes: [Segmind — one change per stage](https://blog.segmind.com/the-official-seedance-2-5-prompt-guide-bytedances-six-part-formula-explained-with-examples/), [Genra](https://genra.ai/blog/why-ai-videos-look-fake-how-to-fix).
**Pipeline:** campo `scene_action` obrigatório em b-roll; validador rejeita clipe com 2
verbos de ação principal.

### 4.3 Avatar = Interrotron (eye-line frontal na lente)
fabric-1.0 é câmera parada — exatamente o setup Errol Morris. Gaze direto = +59% 3s-view.
Campo `gaze: direct|off` (b-roll pode ser off; avatar do hook e do CTA = direct).
Fontes: [The Broadcast Bridge](https://www.thebroadcastbridge.com/content/entry/1804/errol-morriss-interrotron-works-wonders-for-documentary-interviews), [VidMob](https://www.globenewswire.com/news-release/2021/12/14/2352024/0/en/VidMob-Research-Reveals-That-Creative-Choices-Like-A-Model-s-Eye-Gaze-Have-Measurable-Impact-on-Ad-Performance.html).
**Pipeline:** campo por plano; validador de hook/CTA.

### 4.4 Avatar como personagem no ambiente
Cenário de trabalho reconhecível, adereço na mão, mãos visíveis (em repouso — controle de
gesto fino não existe no fabric), micro-atitude no rosto; ≤~40% do filme em avatar; nunca
dois planos de avatar consecutivos.
Fontes: [Slack Story](https://www.slackstory.com/p/so-yeah-we-tried-slack), [1827marketing](https://1827marketing.com/smart-thinking/why-your-b2b-video-marketing-strategy-is-failing-and-how-to-correct-it).
**Pipeline:** validador de sequência (avatar→avatar proibido) + quota de 40% sobre
durações medidas.

### 4.5 Testemunho crível
1ª pessoa + cargo dito em voz + UM detalhe operacional específico; depoimento sem
substantivo concreto de processo é bloqueado.
Fontes: [Ogilvy](https://www.shortform.com/pdf/ogilvy-on-advertising-pdf-david-ogilvy), [OneIMS](https://oneims.com/blog/b2b-case-studies-a-guide-to-meaningful-compelling-customer-testimonials-with-examples).
**Pipeline:** auditor do motor editorial.

### 4.6 Cutaway ≤8s sobre avatar
Nenhum trecho de avatar >8s sem b-roll por cima; o avatar volta nos momentos
olho-no-olho (hook e CTA). Depende da trilha de voz contínua (§2.3).
Fontes: [AIR](https://air.io/en/youtube-hacks/advanced-retention-editing-cutting-patterns-that-keep-viewers-past-minute-8), [Captions](https://captions.ai/blog/practical-guide-b-roll-video).
**Pipeline:** regra do diretor na distribuição de frases-âncora; validador de duração.

### 4.7 Direção de entrega da fala (heurísticas transferíveis)
Frases de 12-15 palavras e pausas entre ideias (guias HeyGen — produto análogo, validar
no fabric). Direção de EMOÇÃO vai nos parâmetros do TTS minimax por bloco — o fabric
anima o corpo a partir da energia do áudio (mecanismo sourced). Tags [excited] no script
e "1-2 gestos/min" são controles de VEED/HeyGen que nosso par minimax+fabric não expõe.
Fontes: [HeyGen Academy](https://www.heygen.com/academy/scripting), [Adam Holter — Fabric workflow](https://adam.holter.com/veed-fabric-1-0-on-fal-ai-image%E2%80%91to%E2%80%91talking%E2%80%91video-api-formats-limits-pricing-and-workflow-tips/).
**Pipeline:** heurística no motor editorial; emoção = params minimax; gesto = keyframe
com mãos em repouso.

---

## 5. Técnicas de AI-video

### 5.1 Léxico cinematográfico fechado (enum)
Poucos termos de propósito; o compilador renderiza frases curtas declarativas; validador
rejeita prompt de movimento sem termo do léxico. Enum grande faz o LLM sortear termo
bonito.
Fontes: [invideo](https://invideo.io/faq/what-cinematography-terms-work-best-in-ai-video-prompts/), [ScreenWeaver](https://www.screenweaver.ai/tools/camera-movement-prompts) (SEO, mas convergem com o guia oficial abaixo).
**Pipeline:** já implementado em `scene-director.ts`; manter enums pequenos.

### 5.2 Ordem oficial de 6 slots do Seedance
Prompt de vídeo em 2-3 frases máx., na ordem oficial da ByteDance, preenchida
deterministicamente do JSON do plano.
Fonte: [Segmind — guia oficial Seedance](https://blog.segmind.com/the-official-seedance-2-5-prompt-guide-bytedances-six-part-formula-explained-with-examples/).
**Pipeline:** template fixo no compilador i2v.

### 5.3 i2v = SÓ movimento (20-40 palavras)
Redescrever a cena no prompt de vídeo causa morphing — o keyframe já é a cena; o prompt
descreve apenas o que SE MOVE.
Fontes: [Runway Gen-4 guide (oficial)](https://help.runwayml.com/hc/en-us/articles/39789879462419-Gen-4-Video-Prompting-Guide), [VEED — Kling guide](https://www.veed.io/learn/kling-ai-prompting-guide).
**Pipeline:** validador rejeita prompt de vídeo que repete substantivos de
cenário/figurino do keyframe.

### 5.4 `motion_energy` + retry com degrau a menos
`motion_energy: low|med|high` por plano; `camera_fixed` é escolha deliberada (CTA);
warping no clipe → retry automático com um degrau a menos de energia.
Fontes: [Ambience — Kling](https://www.ambienceai.com/tutorials/kling-prompting-guide), [fal.ai — Seedance](https://fal.ai/learn/devs/seedance-1-5-prompt-guide).
**Pipeline:** campo por plano + política de retry no orquestrador.

### 5.5 Junção `flow`: encadeamento por last frame (VERIFICADO)
O seedance-2.0 no Replicate expõe `return_last_frame` e aceita first+last frame nativos —
sem modelo utilitário extra. O pipeline pede o last frame na geração do clipe N e o
injeta como first frame do N+1: os dois clipes viram "uma tomada contínua".
Fontes: [Replicate — bytedance/seedance-2.0](https://replicate.com/bytedance/seedance-2.0), [Comfy — Seedance FLF2V](https://comfy.org/workflows/api_seedance2_0_flf2v-dc1311a65bc4/), [Medium — chaining](https://medium.com/@shrutisaagar13/first-frame-last-frame-how-i-chain-ai-clips-into-one-continuous-shot-e6649434e689).
**Pipeline:** FEATURE (roadmap P2); o diretor marca a junção com `transition:
flow|cut`.

### 5.6 Match cut dirigido (2 keyframes + prompt de trajetória)
Para o plano de virada: nano-banana gera frames A e B com as MESMAS referências; o
seedance recebe A como first e B como last frame; o prompt descreve a VIAGEM entre eles,
não o conteúdo; luz/paleta próximas entre A e B. Mesmo mecanismo do contrast cut (§1.4) —
implementar uma vez, servir os dois.
Fontes: [seedanceprompts](https://seedanceprompts.com/guides/seedance-first-last-frame-prompts), [Higgsfield](https://higgsfield.ai/blog/Kling-Start-End-Frames), [Google Cloud — Veo 3.1](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1).
**Pipeline:** mesmo `transition: flow` + `contrast_pair`.

### 5.7 Anti-drift
O modelo não tem memória: MESMAS referências de personagem/local em TODA geração; gate
LLM-visão no last frame antes de promovê-lo a first frame do próximo; máx. 3 elos `flow`
consecutivos, depois corte franco.
Fontes: [Kling — fix drift](https://kling.ai/blog/fix-ai-video-drift-consistency-guide), [OCDevel](https://gnothiai.com/series/ai-video-generation/091f7362-02ec-4afa-a4ff-e30e004db6db).
**Pipeline:** regra do orquestrador + gate de visão.

### 5.8 Asset pack + atribuição de referências (2-4 refs)
Fase 0 do vídeo: folha de personagem (3 ângulos) + stills de ambiente/produto. Por
keyframe: 2-4 referências (mais degrada — medido pela ByteDance; o nano-banana-2 aceitar
14 não significa usar 14), cada uma com frase de atribuição/exclusão (`use: "face+hair",
exclude: "clothing,background"`).
Fontes: [Apiyi](https://help.apiyi.com/en/nano-banana-pro-ai-video-storyboard-character-consistency-guide-en.html), [Flowith](https://flowith.io/blog/nano-banana-consistent-characters-storyboard/), [Segmind](https://blog.segmind.com/the-official-seedance-2-5-prompt-guide-bytedances-six-part-formula-explained-with-examples/).
**Pipeline:** etapa de asset pack no orquestrador; compilador de refs.

### 5.9 Anti-"AI look" — linter de tokens proibidos
Proibidos: "8k", "ultra realistic", "perfect", "masterpiece". O realismo vem do bloco de
imperfeições/film stock dentro do look_lock (grão, halation, texturas honestas — §3.10).
Fontes: [Miraflow](https://miraflow.ai/blog/how-to-make-ai-images-look-like-real-photos-prompt-tricks), [AVB](https://aivideobootcamp.com/blog/photorealistic-ai-prompts-guide-2026/), [Promptaa](https://www.promptaa.com/blog/prompt-key-words-to-make-images-less-fake-looking).
**Pipeline:** linter puro-código sobre visual_prompt e look_lock.

### 5.10 Mãos, texto e física por direção
`hands_in_close: false` default (mão em close é onde a IA quebra); texto diegético
legível ≤1 palavra; exatamente 1 ação principal por clipe (§4.2).
Fontes: [Genra](https://genra.ai/blog/why-ai-videos-look-fake-how-to-fix), [Nemo](https://www.nemovideo.com/blog/why-ai-videos-look-fake-how-to-fix).
**Pipeline:** defaults do compilador + linter.

### 5.11 Papel editorial → tratamento visual
`hook|retention|proof|cta` por bloco: hook = o plano mais dinâmico do vídeo, nunca avatar
parado; cta = `camera_fixed` + composição central. Futuro: 2-3 hooks alternativos por
reel (só o plano 1 muda).
Fontes: [AdCreate](https://adcreate.com/blog/vertical-video-ads-complete-guide), [Hailuo — vertical ads](https://hailuoai.video/pages/knowledge/optimizing-ai-video-vertical-ads), [Trezalabs](https://www.trezalabs.com/blog/how-to-build-an-ai-video-generation-pipeline).
**Pipeline:** herda o papel do bloco do roteiro; regras no diretor.

---

## 6. Retenção e plataforma

### 6.1 Plano 1 in medias res, sem branding
Keyframe de "frame de pico" (ação a ~60% do gesto); primeira frase nomeia dor/resultado.
O stat "+89% completion" é de fonte fraca — direcional; o princípio se sustenta nos
benchmarks de hook rate.
Fontes: [AdSights — thumbstop](https://www.adsights.ai/resources/glossary/metrics/thumbstop-rate-tsr), [Sepia Lab](https://sepia-lab.com/en/blog/hook-rate-benchmarks), [TikTok Creative Codes](https://ads.tiktok.com/business/en/creative-codes), [Stackmatix](https://www.stackmatix.com/blog/tiktok-hook-first-3-seconds).
**Pipeline:** regra do diretor (plano 1) + lint (§1.14).

### 6.2 Re-hook aos 10-12s
Um plano com `interrupt: true` na janela 9-13s: mudança de cenário OU salto de escala;
sinal de payoff até os 10s.
Fontes: [Aibrify](https://aibrify.com/blog/youtube-shorts-retention-curve-playbook), [Retention Rabbit](https://www.retentionrabbit.com/blog/2025-youtube-audience-retention-benchmark-report), [Joyspace](https://joyspace.ai/pattern-interrupt-reset-attention-span).
**Pipeline:** campo `interrupt` + validador de janela sobre durações medidas.

### 6.3 Legendas queimadas (a evidência mais forte do material)
85% do vídeo no Facebook roda mudo; captions = +80% conversão TikTok, +12% viewership.
93% sound-on no TikTok NÃO contradiz: são plataformas/contextos diferentes — projetar
para os dois (legenda cobre o mudo, som cobre o sound-on).
Fontes: [WordStream](https://www.wordstream.com/blog/ws/2016/04/25/facebook-video-ads), [3Play — +12%](https://www.3playmedia.com/blog/captions-increase-viewership-for-facebook-video-ads/), [TikTok — Evolution of Sound](https://ads.tiktok.com/business/en-US/blog/evolution-of-sound-volume-1).
**Pipeline:** FEATURE (roadmap P1): `fictions-ai/autocaption` pós-concatenação
(~US$0,025/run — custo verificado; checar `transcript_file_input` no schema antes de
fixar, para usar o roteiro como transcript e eliminar erro de ASR pt-BR).

### 6.4 Safe zones (guia oficial Meta 2026, números unificados)
Topo 14% / fundo 35% / laterais 6%; ponto focal na região central; legenda queimada a
~58-62% da altura (65-70% cairia dentro da zona coberta pela UI).
Fontes: [Behaviour Digital — Meta oficial 2026](https://behaviour.digital/post/meta-reels-safe-zone-14-top-35-bottom-6-sides-the-2026-official-guide), [Ignite](https://www.ignitesocialmedia.com/content-creation/what-are-the-safe-zones-for-tiktoks-and-instagram-reels/), [AdManage](https://admanage.ai/blog/tiktok-ad-specs).
**Pipeline:** validador LLM-vision sobre o keyframe; parâmetro de posição no autocaption.

### 6.5 Validador técnico de saída
1080x1920 sem letterbox; nitidez do keyframe; zero watermark (inelegibilidade FYP /
limite de reach no IG); proibir "border/frame/vignette forte" no prompt.
Fontes: [TikTok](https://ads.tiktok.com/business/en-US/blog/creative-that-drives-conversions), [Social Media Today — logo ok, watermark não](https://www.socialmediatoday.com/news/instagram-clarifies-including-your-own-logo-on-a-reel-is-ok/730852/).
**Pipeline:** checks de código + linter de prompt.

### 6.6 Loop fechado + insight encaminhável
Último plano ecoa o CENÁRIO/enquadramento do plano 1 (o tableau do hero_object continua
sendo o button — compatíveis quando o plano 1 nasce no mesmo cenário do fechamento);
última frase encadeia com a primeira; 1 insight "manda pro teu gerente" por roteiro.
Fontes: [Retention Rabbit](https://www.retentionrabbit.com/blog/2025-youtube-audience-retention-benchmark-report), [Aibrify](https://aibrify.com/blog/youtube-shorts-retention-curve-playbook).
**Pipeline:** regra do diretor (cenário do plano 1 = cenário do fechamento) + auditor de
roteiro.

### 6.7 Telemetria — fecha o loop
Coletar hook rate (3s views/reach) e retenção por vídeo publicado; realimentar o motor
editorial. Sem isso, todo o resto é fé.
**Pipeline:** FEATURE (roadmap P7).

---

## 7. Som

### 7.1 Feature-chain S1→S5 (mecanismo central VERIFICADO)
S1: direção sonora no JSON do diretor (ambiência da cena, 1 foley-âncora por plano, hits
de hook/CTA). S2: trilha via `stability-ai/stable-audio-2.5` na duração exata do vídeo.
S3: foley por clipe de b-roll via `tencent/hunyuanvideo-foley` (`neg_prompt: "music,
speech, singing"`); clipe de avatar PULA foley (alucina boca) ou recebe só room tone.
S4: mixagem em 3 passadas com `lucataco/video-audio-merge` — `replace_audio: false` MIXA
o áudio novo com o existente (verificado no schema e no repo cog). Trilha sempre sobre o
vídeo CONCATENADO, nunca por clipe (não há parâmetro de offset). S5: validador de som.
Custo ~US$0,50-0,55/reel.
Fontes: [Replicate — video-audio-merge](https://replicate.com/lucataco/video-audio-merge), [GitHub — cog-video-audio-merge](https://github.com/lucataco/cog-video-audio-merge), [hunyuanvideo-foley](https://replicate.com/tencent/hunyuanvideo-foley), [stable-audio-2.5](https://replicate.com/stability-ai/stable-audio-2.5).
**Pipeline:** FEATURE (roadmap P5).

### 7.2 BPM da trilha (fórmula corrigida)
`bpm = clamp(round(480 / duração_média_do_plano_s), 85, 115)` — ≈2 compassos por plano;
planos de 5s → 96 BPM. (A fórmula original 240/duração dava 48 BPM — errada contra a
própria análise.) Honestidade: sem editar o vídeo pela música, a sincronia é estatística.
Fontes: [ClipMusic](https://clipmusic.ai/blog/bpm-video-editing-guide), [Artlist](https://artlist.io/blog/music-bpm/).
**Pipeline:** cálculo no gerador do prompt de trilha.

### 7.3 Níveis: voz âncora, trilha -15/-20 dB, master -14 LUFS
Voz a 1.0; trilha 15-20 dB abaixo (constante `MUSIC_VOLUME ≈ 0.14`, calibrada UMA vez em
dev contra o loudness do TTS minimax); soma das camadas extras ≤ ~0.4; master -14 LUFS /
-1 dBTP (TikTok in-feed não normaliza — vídeo baixo fica baixo). Sem ducking dinâmico
(aceitável: a narração é contínua).
Fontes: [Think Branded Media](https://thinkbrandedmedia.com/blog/tips-for-perfect-audio-balance-preventing-background-music-from-overpowering-dialogue/), [Humanize — -14 LUFS](https://www.humanize.app.br/blog/en/mastering-for-reels-tiktok-youtube-lufs-14), [APU Software](https://apu.software/tiktok-instagram-reels-loudness/).
**Pipeline:** constantes da feature de som; golden-file semanal contra regressão de
loudness.

### 7.4 SFX diegético > decorativo
Room tone/ambiência em 100% da duração (mata o "TTS no vácuo" — sinal nº 1 de
amadorismo); todo foley tem âncora visual obrigatória no keyframe; hit sonoro no hook e
no CTA; whoosh ≤2/reel.
Fontes: [Kukarella](https://www.kukarella.com/resources/ai-audio-engineering/how-to-mix-ai-voiceovers-with-music-and-sound-effects), [TikTok — Power of Creative Elements](https://ads.tiktok.com/business/creativecenter/quicktok/online/Power_Creative_Elements/pc/en).
**Pipeline:** validador de som (S5) + regra no gerador de direção sonora (S1).

### 7.5 Licença é feature
MusicGen e MMAudio têm pesos CC-BY-NC — **blocklist no código**. Trilha própria via
Stable Audio 2.5 (ou Lyria 2, 30s fixos) elimina risco cross-plataforma; conta business
não usa música popular. Antes do launch: confirmar preços no dashboard e o LICENSE do
hunyuanvideo-foley (teto de MAU); fallback `mirelo/video-to-sfx-v1.5`.
Fontes: [audiocraft #198](https://github.com/facebookresearch/audiocraft/issues/198), [MMAudio](https://github.com/hkchengrex/MMAudio), [CML](https://brands.joinstatus.com/tiktok-commerical-music-library), [lyria-2](https://replicate.com/google/lyria-2).
**Pipeline:** blocklist de modelos no catálogo.

### 7.6 Limitações honestas
Stable Audio não faz fade-out confiável — pedir "resolves cleanly" no prompt; foley em
avatar alucina som de boca — pular; sincronia música×corte é estatística, não frame-exata.
**Pipeline:** documentado aqui para ninguém "consertar" o que é limite de modelo.

---

## 8. Papel do diretor-LLM: o schema é um shooting board
O output do diretor é um shooting board completo, não uma lista de imagens: por plano,
`{beat, frases (índices), função, emotional_beat, câmera (escala/ângulo/lente/movimento),
scene_action, lighting_source, relation_to_line, hero_object/visual_correlate quando
aplicável}` + `concept`, `look_lock`, `hero_object` e direção de tela por cena no topo.
Fontes: [Boords](https://boords.com/how-to-storyboard/tv-commercial), [StudioBinder — shooting board](https://www.studiobinder.com/examples/storyboard-examples/tv-commercial-storyboard-examples/), [Domestika](https://www.domestika.org/en/blog/4820-what-s-a-storyboard-and-what-s-a-shooting-board).
O system prompt vigente vive em `supabase/functions/_shared/prompts/scene-director.ts`.

---

## 9. Registro de decisões do cético (o que caiu e por quê)
1. J-cut com offset de -300/600ms — impossível sem trim de vídeo (sem ffmpeg; duração de
   clipe i2v é inteira). Princípio preservado como L-cut viável (§2.3).
2. "Avatar fala o parágrafo inteiro e mostramos só trechos" — exige trim do clipe fabric.
   Substituído por fabric-por-frase-âncora (§2.3).
3. Lint "número só a ~70%" (delayed reveal como regra) — contradizia results-first;
   rebaixado a variante A/B (§1.1).
4. "Extrair último frame via modelo utilitário" — desnecessário: seedance tem
   `return_last_frame` (§5.5).
5. Ranking fechado de ROI de SFX + "impressora 3D genérica" — juízo sem fonte (§7.4 cobre).
6. Fórmula `bpm = 240/duração` — matematicamente errada (§7.2).
7. Safe zone "rodapé 20-25%" e legenda a 65-70% — substituídos pelo guia oficial Meta (§6.4).
8. Custo autocaption US$0,12 — real ~US$0,025 (§6.3).
9. Tags [excited] no script e "1-2 gestos/min" — controles de HeyGen/VEED que
   minimax+fabric não expõem (§4.7).
10. Stats de fonte fraca ("+89% completion", "25-40% creator-style") — rebaixados a
    direcionais; princípios mantidos por fontes oficiais (§6.1, §3.12).
11. "Catchlight ou o fabric não anima o olho" — hipótese de teste, não fato (§3.2).
12. Alvo 26-34s — contradizia a spec 30-40s; virou 30-34s (§1.12).
