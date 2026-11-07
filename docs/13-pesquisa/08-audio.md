# Pesquisa 08 — Áudio para vídeo profissional

> Como profissionais de som cinematográfico pensam e decidem — camadas, direção de voz, sound design,
> foley, música, mixagem, sync — e como abstrair isso num **Agente de Som** que produz a trilha completa
> de vídeos gerados por IA (TTS → SFX/foley generativo → música → mix → master por plataforma).

---

## 1. Conceitos e princípios

### 1.1 As cinco camadas do som cinematográfico (e a função narrativa de cada uma)

- **Diálogo / VO** — camada de *informação*. É a âncora do filme: tudo o mais se mixa em relação a ela. Se o diálogo não é inteligível, nada mais importa. Fonte: [Sound Radix — Mixing dialogue](https://www.soundradix.com/articles/mixing-dialogue-in-audio-storytelling/).
- **Sound design / efeitos (hard FX)** — camada de *impacto e mundo*: explosões, portas, máquinas, sons desenhados (o lightsaber de Ben Burtt). Dá fisicalidade e escala ao que a imagem mostra — ou sugere o que ela NÃO mostra (off-screen sound expande o mundo além do quadro). Fonte: [Filmustage — Role of Sound Design](https://filmustage.com/blog/the-role-of-sound-design/).
- **Foley** — camada de *presença humana*: passos, roupa, objetos manuseados. Sem foley o personagem parece "flutuar"; é o que faz um corpo parecer estar *ali*. Fonte: [Krotos — Foley in film](https://krotos.studio/blog/foley-film).
- **Ambiência / room tone** — camada de *continuidade e verossimilhança*. Todo espaço tem um "silêncio" próprio (ar-condicionado, rua distante, hum elétrico). Sua função é costurar cortes: mantém o fundo constante entre takes, esconde emendas, faz ADR/TTS "sentar" na cena e suaviza transições com fades. **Silêncio digital absoluto soa como erro** — cena sem ambiência parece quebrada. Fontes: [iZotope — Basics of Room Tone](https://www.izotope.com/en/learn/basics-of-room-tone-audio-editing); [StudioBinder — Room Tone](https://www.studiobinder.com/blog/what-is-a-room-tone/); [Film Editing Pro](https://www.filmeditingpro.com/how-to-cut-smoother-dialogue-using-room-tone-ambience/).
- **Música** — camada de *emoção e tempo*: diz ao espectador o que sentir e quando, unifica sequências, controla ritmo percebido. É a única camada que fala direto com o corpo, sem passar pela linguagem. Fonte: [Soundbridge — Spotting Session in Film](https://www.soundbridge.io/spotting-session-film).

### 1.2 Walter Murch: encoded vs embodied e a "lei dos dois e meio"

- No ensaio **"Dense Clarity — Clear Density"** (Transom, 2005), Murch organiza todo som num espectro cognitivo: num extremo o som **codificado** (fala — o cérebro decodifica linguagem), no outro o **corporificado** (música — sentido diretamente, sem decodificação); efeitos sonoros ficam no meio (foley/efeitos "linguísticos" mais perto da fala; ambiências tonais mais perto da música). Fontes: [Transom — Walter Murch](https://transom.org/2005/walter-murch/); [Hear Spot Bark — Dense Clarity](https://www.hearspotbark.com/blog/2014/9/13/walter-murch-on-dense-clarity-clear-density).
- **Lei dos dois e meio:** o ouvinte só acompanha ~2 camadas *da mesma família* simultaneamente (duas vozes, ok; três, vira "multidão"). Mas camadas de famílias **diferentes** do espectro não competem pelo mesmo circuito mental — por isso um mix pode carregar ~5 camadas e ainda soar claro **se** estiverem espalhadas pelo espectro (ex.: 2 encoded + 1 intermediária + 2 embodied). Densidade sem clareza = lama; a solução nunca é "subir tudo", é **remover ou recategorizar**.
- **Worldizing** (Murch): regravar um som (ex.: música diegética) tocando no espaço acústico real dá "desfoque acústico" — pode tocar mais alto e ainda deixar o diálogo em foco. Equivalente sonoro da profundidade de campo; em pipeline digital, o análogo é reverb/EQ convolucional para "colocar o som no espaço da cena". Fonte: [FilmSound.org — Worldizing](http://www.filmsound.org/terminology/worldizing.htm).

### 1.3 Diegético, não-diegético e silêncio

- **Diegético** = existe no mundo da história (personagens ouvem); **não-diegético** = só o espectador ouve (score, VO de narrador). A transição entre os dois é ferramenta narrativa: música diegética que vira score (ou vice-versa) muda o ponto de vista emocional da cena. Fonte: [MasterClass — Diegetic vs Non-Diegetic](https://www.masterclass.com/articles/diegetic-sound-and-non-diegetic-sound-whats-the-difference).
- **Silêncio é uma decisão, não uma ausência.** Como o mix normal é denso, o silêncio (quase) total é raríssimo e por isso enorme: marca morte, choque, vácuo, revelação (*A Quiet Place* inverte a gramática: silêncio = tensão máxima). Regra prática: silêncio funciona por **contraste** — só tem impacto se o que veio antes tinha som; e "silêncio" em cinema quase sempre = room tone + 1 detalhe, não zero absoluto. Fontes: [Screenplayology — Sound & Silence](https://www.screenplayology.com/content-sections/screenplay-form-content/3-7/); [Celtx — What is Sound Design](https://blog.celtx.com/what-is-sound-design/).
- **Mix bom é seletivo:** não se cobre tudo o que a imagem mostra; escolhe-se o que a audiência *precisa* ouvir para o efeito pretendido. Excesso de sons = distração. Fonte: [Ohio State — Intro to Film: Sound](https://ohiostate.pressbooks.pub/introfilm/chapter/sound/).

### 1.4 Direção de voz e narração

- **Brief antes de tudo:** o ator/TTS precisa saber propósito do texto, público, e o **sentimento** desejado — direção por emoção ("como quem conta um segredo") funciona melhor que direção técnica ("mais grave"). Fonte: [Voquent — Directing Voice Over Talent](https://www.voquent.com/blog/directing-voice-over-talent-proven-tips-for-success/).
- **Ritmo (pacing):** rápido = energia/urgência; moderado = explicação; lento = peso/profundidade. **Pausa é pontuação dramática** — dá tempo de absorver e cria ênfase pelo vazio. Fonte: [AudioDramaProduction — Pacing](https://audiodramaproduction.com/voiceover-and-narration-glossary/pacing/).
- **Ênfase:** marcar *quais palavras* carregam o sentido (sublinhar no script). Tom: mais grave = autoridade; médio = clareza; mais brilhante = simpatia. Fonte: [VoiceBros — Documentary Narration](https://voicebros.com/en/blog/documentary-narration-techniques).
- **Casting de voz = decisão narrativa:** idade, gênero, sotaque, textura e "temperatura" da voz devem casar com tom do conteúdo e público (voz de true crime ≠ voz de doc de natureza ≠ voz de anúncio). Fonte: [Outspoken Voices — VO in Documentary](https://www.outspokenvoices.com/blog/voice-overs-in-documentary-filmmaking-giving-depth-and-voice-to-the-story).

### 1.5 Foley profissional: o que se cobre e em que ordem

- Três categorias canônicas: **passos** (footsteps), **movimento** (cloth/roupa) e **specifics** (props: portas, armas, louça). Gravadas em passadas separadas, mantidas em tracks separadas para o mixer balancear cada uma. Fonte: [A Sound Effect — Foley Editing Guide](https://www.asoundeffect.com/ultimate-foley-editing-guide/).
- **Prioridade:** primeiro o que está em quadro e ligado à ação principal (hits de ação, passos do protagonista), depois cloth (o que separa amador de pro — dá vida contínua ao corpo), por fim detalhes. Spotting de foley = assistir marcando sync points + lista de props/superfícies/calçados. Fonte: [Krotos — Foley in film](https://krotos.studio/blog/foley-film).

### 1.6 Música: spotting, temp track, cue

- **Spotting session:** diretor + compositor + music editor assistem ao corte e decidem, cue a cue: **onde a música entra** (transição, virada emocional, realização do personagem), **onde sai** (deixar o diálogo respirar, abrir espaço para silêncio dramático), **função emocional** de cada cue e **hit points** (momentos que a música deve coincidir com a imagem). Saída: spotting notes com timecode in/out, duração e função de cada cue. Fontes: [Ken Joseph Music — Spotting Session](https://kenjosephmusic.com/what-is-a-spotting-session-and-how-does-the-workflow-work/); [Art of Composing — How to Spot a Film](https://www.artofcomposing.com/how-to-spot-a-film).
- **Regra de ouro do spotting: música precisa de motivo para entrar.** Música contínua anestesia; cada entrada deve responder "o que a música faz aqui que imagem+diálogo não fazem?". Não pontuar o óbvio (mickey-mousing não intencional); às vezes o cue certo toca o *subtexto*, contra a superfície da cena.
- **Temp track:** música provisória colada na edição para comunicar tempo/mood ao compositor — útil como referência, perigoso como vício ("temp love"). Para pipeline generativo, o temp track vira o *prompt de referência* da música. Fonte: [Wikipedia — Temp track](https://en.wikipedia.org/wiki/Temp_track).

### 1.7 Mixagem: hierarquia, níveis, loudness

- **Hierarquia: diálogo > música > efeitos** (salvo momento intencional). Mixa-se o diálogo primeiro; tudo se equilibra contra ele. Valores práticos de trabalho: diálogo em média −12 a −10 dB (picos < 0); música sob voz em −18 a −25 dB, sozinha pode subir a ~−10; SFX entre −12 e −18. Fonte: [Pixflow — Audio Mixing](https://pixflow.net/blog/audio-mixing-premiere-pro/).
- **LUFS por plataforma:** YouTube/Spotify ≈ **−14 LUFS** integrado; Apple ≈ −16; broadcast **−23 LUFS** (EBU R128) / −24 (ATSC A/85); **Netflix: diálogo em −27 LUFS (dialogue-gated)**, LRA de programa 4–18 LU e diálogo ≤ 7 LU; theatrical: diálogo ~−31 a −27 com dinâmica muito maior. Corolário: **um mix, vários masters** — o mesmo conteúdo precisa de master theatrical/streaming/social distintos (o "web mix" comprime dinâmica para fones e celular). Fontes: [Auphonic — Dialog Loudness Normalization](https://auphonic.com/blog/2020/10/08/dialog-loudness-normalization/); [Travsonic — Theatrical vs Streaming](https://www.travsonic.com/audio-for-movies-theatrical-streaming/); [Enhancing Sound — Web mix vs Theatrical](https://www.enhancingsound.com/blog/web-mix-vs-theatrical-mix).
- **Ducking (música abaixa quando a voz entra):** sidechain suave — dip de 2–4 dB (até 6; mais que isso "bomba"), attack ~10–30 ms, release 50–200 ms, ratio 2:1–4:1. O ouvinte não deve *perceber* o efeito. Fonte: [Unison — Audio Ducking 101](https://unison.audio/audio-ducking/).

### 1.8 Sincronização som-imagem

- **Sync points:** eventos visuais que exigem som exato no frame (impacto, porta, passo). **Hit points:** momentos que a *música* acentua deliberadamente. Nem todo sync point vira hit point — pontuar tudo é mickey-mousing.
- **J-cut** (áudio da próxima cena entra antes da imagem) e **L-cut** (áudio da cena anterior continua sobre a nova imagem): pontes sonoras que suavizam transições e "puxam" o espectador — o cérebro processa a cena nova antes dos olhos chegarem. Sound bridge é a categoria geral. Uso clássico: entrar na cena de diálogo já ouvindo a fala (J), sair mostrando a reação de quem ouve (L). Fontes: [FilmDaft — L-Cut and J-Cut](https://filmdaft.com/the-l-cut-and-j-cut-how-film-editors-use-audio-to-control-time/); [Filmmakers Academy — Audio Bridge](https://www.filmmakersacademy.com/glossary/audio-bridge/).

### 1.9 Áudio em vídeo curto de redes sociais

- **A maioria assiste sem som:** ~85% dos vídeos de social rodam em mute (mobile, feed). O vídeo deve **funcionar mudo** (legendas, texto na tela, narrativa visual) e **recompensar o som ligado**. Legendas: +38% engajamento, +31% retenção, ~80% mais chance de assistir até o fim; 37% ligam o som *por causa* das legendas. Fontes: [HubSpot — Videos Without Sound](https://blog.hubspot.com/marketing/videos-without-sound); [Verbit — Sound On/Off](https://verbit.ai/captioning/sound-on-sound-off-64-marketers-using-video-see-benefit-of-captions/).
- **Quando o som toca, ele decide:** 88% dos usuários de TikTok reagem ao conteúdo pelo som; Reels com trending audio ≈ 2,5× mais views e +47% saves. Trending audio é camada de *distribuição* (algoritmo), não de narrativa — em conteúdo de marca, priorizar VO forte + legendas e usar trend com critério (e atenção à licença comercial de sons em contas business). Fonte: [Outfame — Trending Sounds](https://www.outfame.com/blog/trending-sounds-boost-engagement).
- Nos 2 primeiros segundos o som precisa "fisgar" (hook sonoro) ou não atrapalhar (hook visual) — não há tempo de intro musical.

### 1.10 Como a IA participa hoje de cada camada (capacidades, não produtos)

- **TTS dirigível por emoção:** modelos atuais aceitam *audio tags* inline (`[whispers]`, `[excited]`, `[sighs]`, pausas) que dirigem entrega, emoção e ritmo momento a momento — o script vira também a *direção de voz*; substitui SSML. Multivoice para diálogo. Fonte: [ElevenLabs — Audio tags 101](https://elevenlabs.io/blog/v3-audiotags).
- **Voice cloning:** qualidade profissional para dublagem/localização; exige **consentimento explícito, escopo e compensação** (padrão pós-acordo SAG-AFTRA 2025; caso Vacker v. ElevenLabs). Pipeline responsável: só vozes licenciadas/sintéticas de catálogo ou clone com termo assinado. Fonte: [Duquesne Juris — AI Voice Cloning and Consent](https://sites.law.duq.edu/juris/2025/11/25/the-law-speaks-up-ai-voice-cloning-and-consent/).
- **Música generativa:** gera cue por prompt (mood, tempo, instrumentação, duração). Licença: planos pagos dão direito comercial **contratual** (não copyright — obra 100% IA não é registrável no US Copyright Office; autoria humana adicionada fortalece); indenização recai sobre o usuário; acordos UMG/Udio e Warner/Suno (2025) caminham para catálogos licenciados. Fontes: [Promise Legal — AI Music Copyright](https://blog.promise.legal/ai-generated-music-copyright-ownership/); [terms.law — Suno rights](https://terms.law/ai-output-rights/suno/).
- **Foley/ambiência generativa (video-to-audio):** modelos como MMAudio (CVPR 2025) sintetizam áudio **semanticamente e temporalmente alinhado** ao vídeo (+texto opcional): passos, impactos, chuva, ambiências — rápido (~1,2 s para clip de 8 s). Cobre bem ambiência e hits genéricos; falha em specifics finos e cloth sutil. Fonte: [MMAudio — paper](https://arxiv.org/abs/2412.15322).
- **Vídeo com áudio nativo:** Veo 3 e Sora 2 geram diálogo lip-synced, SFX e ambiência **no mesmo pass** da imagem. Ótimo para realismo de cena única; limitação: sem controle fino de mix, sem consistência de voz entre planos, sem stems — para vídeo profissional multi-plano ainda se gera/reconstrói a trilha por camadas. Fonte: [Wiro — Veo 3 vs Sora 2](https://wiro.ai/blog/veo-3-vs-sora-2-pro-the-new-era-of-ai-video-generation-with-sound/).
- **Separação e masterização automática:** source separation (voz/música/FX) permite re-mixar material pronto (ex.: refazer o ducking de um vídeo já renderizado); loudness normalization automática por alvo de plataforma (dialogue-gated) já é padrão de ferramenta. Fonte: [Auphonic — Dialog Loudness](https://auphonic.com/blog/2020/10/08/dialog-loudness-normalization/); [MMAudioSep](https://arxiv.org/abs/2510.09065).

---

## 2. Como o profissional decide — processo real

O pós de som segue uma sequência estável (spotting → design/edição por camada → pre-mix → mix final → masters):

1. **Spotting (com o corte travado):** assistir cena a cena e anotar, com timecode: onde precisa de música (e função), onde precisa de silêncio, quais sync points de FX/foley, quais falas precisam de ADR/regravação, que ambiência define cada locação. A pergunta-guia por cena: *"qual é a emoção-alvo e qual camada a entrega melhor?"* — som é escolhido por função, não por completude.
2. **Diálogo primeiro:** editar, limpar e nivelar o diálogo/VO antes de qualquer outra camada; preencher buracos com room tone para continuidade. O diálogo define o "teto" contra o qual tudo se equilibra.
3. **Camadas de mundo:** ambiência por locação (1–2 layers: tônica + eventual), depois hard FX nos sync points, depois foley (passos → cloth → props) só onde a câmera/ação pede presença.
4. **Música por cue:** compor/gerar cada cue com in/out e hit points do spotting; entrar *depois* do corte de cena ou sob diálogo fraco, nunca competindo com fala densa; sair antes de momento que pede silêncio.
5. **Mix:** balancear com a hierarquia voz > música > FX aplicando a lei de Murch — nunca mais que ~2 elementos da mesma família disputando atenção; se a cena está "lamacenta", **remove-se** uma camada em vez de subir outra. Ducking suave, panning conforme posição em quadro, reverb coerente com o espaço visual (worldizing digital).
6. **Master por destino:** loudness e dinâmica por plataforma (−14 LUFS social/YouTube, −27 dialog-gated Netflix, −23 broadcast); check final em mono e em fone de celular (onde o público real está).

---

## 3. Abstração para agente: o Agente de Som

### 3.1 Inputs / Outputs

- **Inputs:** roteiro/AV script (com coluna ÁUDIO), storyboard/planos renderizados (vídeo mudo ou com áudio nativo), direção criativa global (tom, gênero, referências/temp), plataforma-alvo (define LUFS, duração, sound-off-first), locações/personagens (para ambiências e casting de voz consistentes).
- **Outputs:** (a) **spotting sheet** (a "direção sonora" abaixo, por cena/plano); (b) stems por camada (VO, música, FX, foley, ambiência); (c) mix final + masters por plataforma; (d) arquivo de legendas (obrigatório para social); (e) relatório de validação.

### 3.2 Estrutura de dados — "direção sonora" por cena/plano

```yaml
scene_audio_direction:
  scene_id: "S03"
  emotional_target: "tensão crescente → alívio"   # do roteiro; guia todas as camadas
  layers:
    dialogue:
      lines: [{char: "MARIA", text: "...", delivery: "sussurro urgente",
               tags: ["[whispers]", "[pause:600ms]"], emphasis: ["nunca"]}]
      voice_id: "voz-maria-v2"    # casting fixo por personagem (consistência entre planos)
    ambience: {base: "escritório noite: hum de AC + rua distante", db_rel: -28, continuous: true}
    foley: [{event: "passos em madeira", sync_frame: 84, priority: 1},
            {event: "porta fecha", sync_frame: 152, priority: 1}]
    sfx: [{event: "celular vibra", sync_frame: 120, diegetic: true}]
    music:
      cue: {id: "M-04", in: "S03+0:02 (após 1ª fala)", out: "S04 J-cut",
            function: "sustentar tensão sob diálogo", mood: "pulso baixo, cordas",
            hit_points: [{frame: 152, action: "porta fecha", type: "acento"}],
            temp_ref: "referência estilo X", duck_under_vo_db: -3}
    silence: {use: false}          # se true: motivo narrativo + o que permanece (room tone)
  transitions: {in: "J-cut: áudio desta cena entra 12f antes", out: "L-cut: VO segue sobre S04"}
  murch_budget: {encoded: 1, mid: 2, embodied: 2}   # máx ~5 espalhadas; ≤2 por família
  mix_targets: {dialogue_lufs: -14, platform: "reels", captions: true, hook_audio_s: 2}
```

### 3.3 Validações automatizáveis

- **Níveis:** LUFS integrado e dialogue-gated dentro do alvo da plataforma (±1 LU); true peak ≤ −1 dBTP; música sob voz entre −18 e −25 dB relativos; LRA dentro da faixa do destino.
- **Hierarquia:** em trechos com fala, medir speech-to-music ratio (separação de stems torna isso trivial); alertar se música/FX mascaram voz (inteligibilidade via STOI/ASR: transcrever o mix e comparar com o script — divergência = voz mascarada ou TTS errado).
- **Presença de camadas:** nenhuma cena com "silêncio digital" não intencional (RMS de fundo > piso mínimo = room tone presente); toda cena tem ambiência; todo evento visual de prioridade 1 (detectável por visão: passos, impactos, portas) tem som dentro de ±2 frames do sync point.
- **Lei dos dois e meio:** contar camadas ativas simultâneas por família (encoded/mid/embodied) e alertar quando > 2 na mesma família ou > 5 no total.
- **Música:** cada cue tem `function` preenchida (rejeitar "música porque sim"); cue não entra em cima de fala densa; hit points batem com o frame declarado; licença/proveniência registrada por cue.
- **Social:** legendas presentes e sincronizadas; vídeo compreensível em mute (heurística: o script visual+legendas conta a história sozinho?); hook sonoro ou neutro nos 2 primeiros segundos; master em −14 LUFS.
- **Consistência:** mesmo `voice_id` por personagem em todos os planos; mesma ambiência-base por locação; room tone contínuo através de cortes internos da cena.

### 3.4 Pipeline do agente (resumo)

`spotting (LLM lê roteiro+planos → scene_audio_direction)` → `VO (TTS com tags)` → `ambiência+foley (video-to-audio condicionado por texto, por plano)` → `música (geração por cue com in/out/mood)` → `mix (ducking, reverb por locação, hierarquia)` → `masters por plataforma` → `validação (métricas acima)` → loop de correção.

---

## 4. Limites e o que não deve ser automatizado

- **A decisão de silêncio e a de NÃO pontuar.** Modelos generativos tendem a preencher; a escolha de tirar som (silêncio dramático, cena sem música) é a decisão mais autoral do som e deve vir de direção humana ou de regra explícita no spotting — nunca do default do gerador.
- **Casting de voz de marca/personagem principal:** é decisão de identidade de longo prazo; agente propõe shortlist, humano escolhe.
- **Voice cloning sem termo:** nunca clonar voz real sem consentimento escrito com escopo e compensação; nunca imitar voz de pessoa pública. Divulgar voz sintética quando relevante.
- **Música e trending audio — risco legal:** obra 100% IA não tem copyright (defensabilidade limitada) e a indenização dos ToS recai no usuário; trending sounds de social frequentemente não têm licença comercial para marcas. Registro de proveniência por cue é obrigatório; uso comercial de trend exige checagem humana.
- **Aprovação do mix final é auditiva, não métrica:** LUFS certo não garante mix bom. Máscara sutil, foley "de plástico", música emocionalmente errada — hoje só ouvido humano pega com confiabilidade. O agente entrega candidato validado + relatório; o humano dá o ok em fone de celular e em caixa boa.
- **Emoção do TTS ainda degrada em cenas longas:** tags controlam momento a momento, mas arco emocional contínuo de uma performance de minutos ainda sai "chapado"; quebrar VO em segmentos dirigidos e revisar os críticos.
- **Áudio nativo de Veo 3/Sora 2 não substitui a trilha:** serve como referência/diegese de plano único; sem stems, sem consistência entre planos e sem controle de mix — para produto profissional, tratar como temp e reconstruir por camadas.
