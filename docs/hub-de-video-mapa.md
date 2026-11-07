# Hub de vídeo: mapa de modelos, inputs e experiências

Data: 2026-10-29. Este documento só mapeia o que existe; nenhum código foi alterado.

**Siglas de arquivo:**
- **DA** = `supabase/functions/director-advance/index.ts`
- **VC** = `supabase/functions/_shared/video-catalog.ts`
- **VP** = `supabase/functions/_shared/video-pipeline.ts`
- **GV** = `supabase/functions/generate-video/index.ts`
- **AS** = `supabase/functions/avatar-studio/index.ts`
- **RM** = `supabase/functions/_shared/remake.ts`
- **SI** = `supabase/seed-instancia.sql`
- **VE** = `supabase/sql/video-engine.sql`
- **GG** = `src/lib/generation-gate.ts`
- **NV** = `src/routes/_app/videos/novo.tsx`
- **RF** = `src/components/video/remake-flow.tsx`
- **RPV** = `src/components/reel/reel-project-view.tsx`
- **HUB** = `src/lib/video-hub.ts`

**Fontes oficiais:**
- Replicate: schema e preço embutidos em `replicate.com/<owner>/<name>/api/schema`, baixados em 2026-10-29.
- HeyGen: `developers.heygen.com/openapi/external-api.json`.
- ElevenLabs: `api.elevenlabs.io/openapi.json`, `elevenlabs.io/docs/overview/models` e `elevenlabs.io/pricing`.
- Higgsfield: não tem doc pública dos IDs usados.

---

## 1. Resumo

O Hub tem 10 experiências rodando sobre **três motores**:

- **Diretor**, para criar do zero: tabela `director_jobs`, passos em DA:2565-2580.
- **Remake**, para melhorar um vídeo enviado: também usa `director_jobs`, com `config.mode='remake'` e passos em DA:2557-2563.
- **Reel da Biblioteca**: `generate-video`, com tabelas `video_projects`/`video_scenes` (GV:299-305, 452, 521). Não usa `director_jobs`.

Os modelos Replicate vêm do catálogo `video_models` (VC:126-173). Higgsfield, HeyGen e ElevenLabs têm modelos fixos no código.

**Maiores riscos:**
1. **O Diretor exige Higgsfield sempre** (DA:1107-1114), mesmo quando as cenas são do Replicate. O portão recomenda o Replicate quando o Higgsfield está off (GG:136-141). Em `/videos/novo` o CTA vira "Conectar Higgsfield" (NV:223-225, 562-563), mas o onboarding troca o motor para Replicate (`setup-flow.tsx:318-321`) e o botão "Gerar vídeo" não é desabilitado (`setup-flow.tsx:661`, só um aviso em `step-create.tsx:334-345`): o job falha no 1º passo, antes de pagar roteiro e narração.
2. **O remake visual (Aleph) envia `reference_image`, que não existe no schema oficial** (VE:70). O "Trocar pessoa" perde a referência.
3. **O custo do Seedance 2.0 (cena primária) está ~3× abaixo do real em 1080p:** o código usa US$ 0,14/s, o oficial é US$ 0,45/s.
4. **A fila é serial:** 1 job de produção por tick de 1 min, sempre o mais antigo (DA:2615, DA:2625-2633).
5. **Há campos mortos ou enganosos na tela:** a narração editável do Reel é recusada pelo servidor, e os portões do Reel e da Tradução não fazem nada.
6. **As legendas dependem do `scribe_v1`, que está deprecated** (DA:540).

---

## 2. Catálogo por capability

**Legenda:**
- **Pessoa:** o que a pessoa fornece na tela.
- **Sistema:** o que o código preenche sozinho.
- **Status:** status no seed (SI/VE). O estado real no banco está em NÃO VERIFICADO (§6).
- **Custo cód.:** o valor de `cost` no seed.
- **Oficial:** preço Replicate de 2026-10-29.

### 2.1 Replicate (catálogo `video_models`)

| Capability | Modelo | Pessoa | Sistema | Limites oficiais | Custo cód. → oficial | Status | Divergência |
|---|---|---|---|---|---|---|---|
| tts | minimax/speech-02-hd (SI:531-540) | texto (Remake), voz (apresentador) | voice_id, language_boost=Portuguese, bitrate 128k, mp3/32k/mono/neutral/1.0 | texto ≤10.000; bitrates 32k-256k | 0,10/1k chars → 0,10/1k **tokens** | primário | unidade de custo |
| tts | minimax/speech-2.8-hd (SI:542-550) | idem | idem | schema idêntico | 0,10/1k tokens | fallback | — |
| keyframe | google/nano-banana-2 (SI:554-561) | nada (prompt vem do plano) | prompt, image_input = foto do avatar + keyframe anterior, 9:16, 1K | até 14 refs; 1K/2K/4K | 0,08 → **1K 0,067** · 2K 0,101 · 4K 0,151 | primário (só Reel) | superestimado |
| keyframe | google/nano-banana-pro (SI:563-569) | — | idem | idem | 0,14 → **1K/2K 0,15** · 4K 0,30 | fallback | subestimado |
| avatar_identity | google/nano-banana-2 (SI:571-577) | descrição ou instrução de retrato | refs ≤6 (AS:291) | idem | 0,08 → 0,067 | primário | — |
| avatar_identity | black-forest-labs/flux-kontext-pro (SI:579-586) | — | prompt; `input_image←{{keyframe_url}}` **não é passado** em AS:273-276 | — | 0,04 → 0,04 | fallback **inalcançável** (VP:1254) | defeito 14 |
| talking_avatar | veed/fabric-1.0 (SI:590-596) | foto e voz do apresentador | image, audio, resolution = project.resolution (VP:493) | ≤60 s; 480p/720p | 0,15/s → **480p 0,08** · 720p 0,15 | primário (Reel, cena avatar) | 60 s não aplicado; resolução não validada |
| talking_avatar | prunaai/p-video-avatar (SI:598-603) | idem | image, audio | 720p/1080p; audio opcional | 0,025/s → 720p 0,025 · 1080p 0,045 | fallback | `version_hash` desatualizado (8a54… vs b474…) |
| talking_avatar | bytedance/omni-human (SI:605-610) | idem | image, audio | **qualidade degrada >15 s de áudio** | 0,14/s → 0,14 | sem uso direto | sem teto de 15 s |
| scene_i2v | **bytedance/seedance-2.0** (SI:736-745) | escolha no portão (Diretor) | prompt, image=keyframe, duration 4-15, resolution = `pickResolution` → **1080p** (DA:239-246) | 4-15 s; 480p-4k; `reference_images` não combina com `image` | **0,14/s → 480p 0,08 · 720p 0,18 · 1080p 0,45 · 4k 1,00** | **primário** | **custo 3,2× abaixo em 1080p** |
| scene_i2v | bytedance/seedance-1-lite (SI:615-623) | idem | idem, 4-12 s | 480p/720p/1080p | 0,036/s → 480p 0,018 · 720p 0,036 · **1080p 0,072** | ativo | custo fixo, recebe 1080p |
| scene_i2v | kwaivgi/kling-v2.5-turbo-pro (SI:625-631) | idem | start_image, duration **{5,10}** (arredonda para cima, VC:201-214), negative_prompt | 5/10 s; aspect ignorado com imagem | 0,07/s → 0,07 | ativo | — |
| scene_i2v | minimax/hailuo-2.3 (SI:633-639) | idem | first_frame_image, duration {6,10}, resolution **fixa 768p** | 10 s só em 768p; 1080p só 6 s | 0,06/s → 768p: 6 s 0,28 (≈0,047/s), 10 s 0,56 (0,056/s); 1080p 6 s 0,49 | ativo | `limits` declara 1080p, mas o template fixa 768p |
| scene_t2v | pixverse/pixverse-v6 (SI:650-656), seedance-1-lite (SI:641-648) | — | — | — | 0,09/s; 0,036/s | **sem uso** (nenhum `resolveModel('scene_t2v')`) | catálogo morto |
| scene_v2v | runwayml/aleph-2 (**só VE:64-73**) | estilo, frase de cena, apresentador (foto) | prompt (RM:158-180), video, `reference_image` | **2-30 s e <16 MB**; obrigatórios só `prompt` e `video`; `keyframe_images[]` (≤5) + `keyframe_positions[]` ('first', 'last' ou segundos) controlam quadros, não são referência de pessoa | 0,336/s → 0,336 | primário, mas **ausente do SI/drizzle** | **`reference_image` não existe** |
| lipsync_post | sync/lipsync-2 (SI:660-665) | — | — | — | 0,04 → 0,05/s | **sem uso** (o lipsync vai pela HeyGen) | catálogo morto |
| util_normalize | bytedance/video-upscaler (SI:762-774) | — | 1080p/24fps/aigc/standard | — | **0,05/s → ~0,0069/s** (6,887/1000 s) | primário (Reel) | superestimado ~7× |
| util_normalize | fofr/toolkit (SI:669-675) | — | convert_input_to_mp4 | saída é array | 0,0004/run | fallback | — |
| util_concat | bfirsh/concatenate-videos (SI:677-682) | — | videos[] | — | 0,002/run | primário (Reel) | — |
| util_audio_merge | lucataco/video-audio-merge (SI:684-690) | — | video_file, audio_file; duration_mode audio (Reel) ou **video** (Remake, DA:2494) | — | 0,002/run | primário | `required_inputs=[]` |

### 2.2 Higgsfield (MCP, fixo em DA:100-122; sobrescrito por `director_state.hf_models`, DA:114-118, sem seed)

| Papel | Modelo | Pessoa | Sistema | Limites | Custo | Status |
|---|---|---|---|---|---|---|
| keyframe do Diretor (sempre) | cinematic_studio_2_5 | — | 9:16, 2k, prompt + element (DA:1219-1226) | NÃO VERIFICADO | créditos HF, NÃO VERIFICADO | obrigatório |
| vídeo principal | cinematic_studio_3_0 | escolha no portão | duração da unidade, 1080p (retry em 720p sem crédito, DA:1371-1374) | 4-15 s (código) | créditos | padrão |
| vídeo alternativo / A/B | cinematic_studio_video_v2 | escolha no portão | herda `ab_extra` (multi_shots, sound off), sem resolution (DA:133-137) | 12 s (código) | créditos | opcional |
| apresentador (element) | show_reference_elements | 1-3 fotos e nome | — | 3 fotos, nome ≤32 (DA:1834-1844) | — | ativo |
| montagem, legendas, merge | `sandbox_exec` (ffmpeg) | — | DA:1716-1809, DA:2511 | comando ≤16k chars (DA:1771) | grátis | obrigatório no Diretor e nas legendas |

### 2.3 HeyGen v3 (RM:182-294; chave em DA:2132-2141)

| Uso | Endpoint | Pessoa | Sistema | Limites oficiais | Custo | Divergência |
|---|---|---|---|---|---|---|
| lipsync (fala nova) | POST /v3/lipsyncs | — | mode precision, keep_the_same_format, sem watermark | — | precision ~US$ 0,0667/s (**NÃO VERIFICADO**, página dinâmica) | — |
| tradução | POST /v3/video-translations | idioma (en/es/fr/it/de, RM:88-94) | mode speed | idiomas só via GET /v3/video-translations/languages | NÃO VERIFICADO | nomes "Spanish", "French", "Italian" e "German" NÃO VERIFICADOS |
| foto que fala | POST /v3/videos type image (RM:253-269) | — (o quadro é tirado pelo navegador, RF:376-381) | image url, audio_url, motion_prompt, expressiveness medium, 1080p, aspect auto | required só `type` e `image`; `VideoStatus` = pending/processing/completed/failed | NÃO VERIFICADO | não quebra (o código só checa completed/failed) |

### 2.4 ElevenLabs (DA:370-557)

| Uso | Modelo / endpoint | Pessoa | Sistema | Limite oficial | Divergência |
|---|---|---|---|---|---|
| TTS (Diretor e Remake) | eleven_v3, mp3_44100_128 (DA:515-523) | texto (Remake), voz (gênero, própria ou ID) | stability 0.5 | **5.000 caracteres/request**; v3 é a "previous generation" (o flagship é v4) | sem corte em 5.000 (Diretor) |
| clone (A minha voz) | /v1/voices/add (DA:480-506) | amostra = o próprio vídeo; gênero de quem aparece (`person_gender`) | pré-checagem `voice_check` lê `can_use_instant_voice_cloning` de `/v1/user/subscription` (`video-remake/index.ts:44-54`) e a tela bloqueia (RF:132, 308-309); se o clone falhar mesmo assim, usa a voz do `person_gender` (DA:2260-2273); apaga a voz depois (DA:2279) | **plano Starter ou acima**; slots limitados | não checa `voice_slots_used` |
| STT (legendas) | **scribe_v1** (DA:540), language_code `pt` fixo (DA:541) | — | — | **deprecated** (página de modelos; o openapi baixado não tem mais `scribe_v1`, só `scribe_v2`/`scribe_v2_turbo`) | defeito 9 |
| trilha de fundo | /v1/sound-generation (DA:529, 1673) | — | min(22, s), prompt fixo "industrial" (DA:1670-1673) | 0,5-**30** s | teto antigo; prompt fixo de fábrica |

---

## 3. Experiências

As rotas do Hub ficam em HUB:54-162. "Provedores exigidos" é o que o **servidor** de fato exige, não só o que o Hub declara.

### 3.1 Vídeo de cenas (idea/photo → scenes → Diretor, `CreateVideoForm`)
- **Deve mostrar:**
  - Mensagem única (smp), número-herói e CTA: os três obrigatórios (NV:255).
  - Duração-alvo e nº de cenas, limitados a 8-90 s e 3-8 cenas (NV:186-188).
  - Motor/modelo.
  - Legendas on/off.
- **Genéricos/mortos:**
  - `objetivo`, `publico` e `tom` só entram como JSON cru no planner (`director-core.ts:206`).
  - `formato` e `mandatorios` são fixos.
  - "Comparar duas" (A/B) só aparece no AbStrip e nunca no vídeo final.
  - O teto de créditos não se aplica a cenas Replicate (DA:1314-1315).
  - O roteirista e a trilha são fixos em "fábrica B2B" (`director-core.ts:61-97`, DA:1670-1673).
- **Dependem do modelo:**
  - Duração por unidade: HF 3.0 até 15 s, Video 2 até 12 s; Kling em blocos 5/10, Hailuo 6/10, Seedance 4-15 contínuo, 1-lite 4-12. A UI tira da lista o modelo cujo máximo é menor que a cena (GG:347-349), e o servidor divide em unidades (DA:745-770).
  - Teto de créditos: só HF.
  - Custo: tabela §2.1.
- **Provedores:** Higgsfield **sempre** (DA:1109), ElevenLabs (narração), e Replicate se o motor = replicate.

### 3.2 Vídeo comigo nas cenas (idea/photo → presenter)
- **Deve mostrar:** os mesmos campos de 3.1, **mais o apresentador com foto, obrigatório**.
- **Genéricos/mortos:**
  - A rota é duplicada: NV:153-158 ignora `hubRoute.want` e abre o mesmo formulário sem pré-selecionar nada.
  - O picker aceita "Sem apresentador" (NV:619-638), embora a nota da rota diga que é obrigatório.
- **Dependem do modelo:** só o HF mantém o rosto (element); no Replicate, o rosto vem apenas do keyframe HF.
- **Provedores:** Higgsfield (keyframe + element), ElevenLabs. A voz escolhida (MiniMax) chega ao Diretor só como gênero (DA:970-978). `voice.elevenlabs_voice_id` é lido em DA:973, mas nada grava esse campo.

### 3.3 Mudar o que eu digo (video → speech, Remake)
- **Deve mostrar:**
  - Arquivo de 2-30 s.
  - Texto ≤600 caracteres (RM:53-55).
  - Voz, obrigatória (RF:284, 304): feminina/masculina, "a minha voz" (exige `person_gender` e plano que clona, conferido antes por `voice_check`) ou Voice ID colado (conferido por `voice_lookup`, `video-remake/index.ts:56-62`).
  - Consentimento.
- **Genéricos/mortos:**
  - O seletor de voz aparece duas vezes (RF:541-552 e RF:771-778).
  - O portão "Voz da fala nova" (`tts_model_id`) só tem efeito com voz female/male **e** uma linha Replicate; com voz própria ou ID colado, é cosmético.
- **Dependem do modelo:** com MiniMax, o portão usa vozes fixas Portuguese_ConfidentWoman/CalmLeader (DA:2341-2345).
- **Provedores:**
  - HeyGen: lipsync, ou "foto que fala" (POST /v3/videos type image) a partir de um quadro tirado no navegador. A tela só tira o quadro quando a fala estimada (15 caracteres/s) não cabe e a fala é a única mudança, sem estilo/cena/pessoa/tradução (RF:288-294, 383-388). No servidor, com ElevenLabs, o mp3 é medido: diferença >15% usa o quadro, ou para com erro se não houver quadro (DA:2291-2312). Com MiniMax, o quadro presente vai direto para a foto que fala, sem medir (DA:2248-2255).
  - ElevenLabs (voz padrão, clone e Voice ID) **ou** Replicate (MiniMax, quando `tts_model_id` vem preenchido): com MiniMax, o RF não exige ElevenLabs (`remake-options.ts:86-89`).

### 3.4 Traduzir (video → translate)
- **Deve mostrar:** arquivo, idioma (5) e consentimento.
- **Genéricos/mortos:** o portão "Tradução" tem uma linha só e `onSelect={() => undefined}` (RF:826).
- **Dependem do modelo:** nada.
- **Provedores:** HeyGen.

### 3.5 Mudar estilo (video → style)
- **Deve mostrar:** arquivo e estilo (6 presets, RM:60-85; `marca` usa as cores do brand kit).
- **Genéricos/mortos:**
  - O portão `scene_model_id` tem 1 opção só (Aleph).
  - O `brief` do remake só serve como título (RF:395-404).
- **Dependem do modelo:** Aleph exige 2-30 s **e <16 MB**; não há checagem de tamanho no RF.
- Legendas marcadas exigem Higgsfield e ElevenLabs também aqui: o RF bloqueia com "Falta conectar" (`remake-options.ts:93-96`; RF:313-314).
- **Provedores:**
  - Replicate (Aleph).
  - Áudio original: sandbox HF ou Replicate `util_audio_merge` quando HF está off (DA:2485-2496, verificado).

### 3.6 Mudar cenário (video → scene)
- **Deve mostrar:** arquivo e frase do cenário. A frase é obrigatória quando marcada (RF:281) e é traduzida por LLM (DA:2154-2174).
- **Mortos/dependências/provedores:** como em 3.5.

### 3.7 Trocar pessoa (video → character)
- **Deve mostrar:** arquivo, apresentador com foto (RF:148-150) e consentimento.
- **Defeito:** a foto vai para `reference_image` (VE:70; DA:2219-2226), campo que **não existe** no Aleph-2. O schema não tem campo de referência de pessoa: `keyframe_images` + `keyframe_positions` fixam como fica um quadro (first/last/segundos), então mandar um retrato ali não equivale a "trocar a pessoa" e pode forçar o enquadramento do retrato. A troca provavelmente não acontece; NÃO VERIFICADO se o Replicate ignora o campo ou responde 422.
- **Provedores:** Replicate.

### 3.8 Legendas (video → captions)
- **Deve mostrar:** arquivo e estilo (padrão karaoke).
- **Genéricos/mortos:** `position` e `accent` não são enviados, então ficam bottom e `#FFD400` (DA:564-567), ignorando a cor da marca.
- **Provedores:**
  - ElevenLabs `scribe_v1`, com idioma **fixo `pt`** (DA:540): erra em vídeo traduzido ou em outra língua.
  - Higgsfield `sandbox_exec` para queimar a legenda (DA:1795). Qualquer remake com legendas exige HF.

### 3.9 Reel da Biblioteca (peça `instagram_reel` → RPV, pipeline `generate-video`)
- **Deve mostrar:** "Quem apresenta" (ou "só imagens") e, opcionalmente, a descrição da imagem por cena.
- **Genéricos/mortos:**
  - A narração da cena é editável, mas o servidor devolve 409 `narration_locked` (GV:500-511); a dica da tela promete o contrário (`scene-storyboard-card.tsx:98`).
  - `duration_target_s` (3-12) só vale sem áudio (VP:466).
  - Os portões de preparação e de vídeo têm `onSelect={() => undefined}` (RPV:332, RPV:387) e mostram só o primário de keyframe/scene_i2v, mesmo quando a cena é avatar (RPV:124-139).
- **Dependem do modelo:**
  - Resolução: Fabric aceita só 480p/720p e recebe `project.resolution` sem validação (VP:493).
  - Hailuo é fixo em 768p.
- **Provedores:** Replicate (tts, keyframe, talking_avatar ou scene_i2v + merge, normalize, concat). **Não usa** Higgsfield nem ElevenLabs. Não entra na fila do Diretor (verificado).

### 3.10 Apresentador (`/marca/avatares`, `new-avatar-dialog.tsx`, AS)
- **Deve mostrar:** nome e 1-3 fotos **ou** descrição (`new-avatar-dialog.tsx:49-50`). A voz é opcional: sem escolha, o servidor usa `VOICES[0]` (AS:154).
- **Genéricos/mortos:**
  - `bootstrap_from_photo` não tem tela (AS:97).
  - A voz MiniMax só vale no Reel; no Diretor e no Remake vira gênero.
- **Dependem do modelo:**
  - Retrato gerado: nano-banana-2, refs ≤6.
  - Element HF: até 3 fotos, criado sob demanda pelo tick (DA:2612, `stepPresenters`).
- **Provedores:** Replicate (retrato e prévia de voz), Higgsfield (element, para usar no Diretor).

---

## 4. Matriz experiência × modelo (inputs exigidos pela combinação)

| Experiência | Modelo(s) que servem | Inputs exigidos pela combinação |
|---|---|---|
| Vídeo de cenas | HF cinematic_studio_3_0 (padrão) | smp, número, CTA; unidade 4-15 s; créditos HF |
| | HF cinematic_studio_video_v2 | idem; unidade ≤12 s; sem resolution/generate_audio |
| | Replicate seedance-2.0 / 1-lite | idem + token Replicate **e** HF conectado (keyframes e montagem); 4-15 s ou 4-12 s; 1080p |
| | Replicate kling-v2.5-turbo-pro | idem; duração em blocos 5/10 (arredonda para cima, cobra o bloco) |
| | Replicate hailuo-2.3 | idem; blocos 6/10; sempre 768p |
| Vídeo comigo nas cenas | HF 3.0 / Video 2 (rosto consistente via element) | + apresentador com foto; o element é criado pelo tick e as cenas com personagem esperam até 30 min ele ficar `ready` (DA:812, 1172-1190, 1956-1964) |
| | Replicate scene_i2v | + apresentador; o rosto só vem do keyframe HF (consistência menor) |
| Mudar o que eu digo | ElevenLabs eleven_v3 + HeyGen lipsync | texto ≤600 e voz; "a minha voz" exige `person_gender` + plano que clona (`voice_check`); Voice ID exige `voice_lookup` ok |
| | MiniMax speech-02-hd/2.8-hd + HeyGen | texto, gênero (female/male) e token Replicate; ElevenLabs não é exigido |
| | HeyGen foto que fala | `speech_frame_path` (quadro tirado só quando a fala é a única mudança); com ElevenLabs, entra se a diferença medida passar de 15%; com MiniMax, sempre que houver quadro |
| Traduzir | HeyGen video-translations | idioma ∈ {en, es, fr, it, de} |
| Mudar estilo / cenário / pessoa | Replicate runwayml/aleph-2 (único) | vídeo 2-30 s e <16 MB; prompt; pessoa = foto (campo errado hoje) |
| (áudio original do v2v) | HF sandbox ffmpeg **ou** Replicate lucataco/video-audio-merge | automático; o Replicate só entra quando HF está off |
| Legendas | ElevenLabs scribe_v1 + HF sandbox | áudio no master; idioma fixo pt |
| Reel da Biblioteca, b-roll | nano-banana-2 → seedance-2.0 (+ fallback kling) → audio-merge → upscaler → concat | storyboard; voz MiniMax |
| Reel da Biblioteca, avatar | nano-banana-2 → fabric-1.0 (fallback p-video-avatar) | apresentador com foto; resolução 480p/720p; áudio ≤60 s |
| Apresentador | nano-banana-2 (retrato), MiniMax (prévia), HF element | nome + fotos ou descrição |
| (nenhuma) | pixverse-v6, seedance-1-lite t2v, sync/lipsync-2, omni-human | catálogo sem consumidor |

---

## 5. Defeitos e divergências

| # | Sev. | Defeito | Evidência no código | Fonte oficial / verificação |
|---|---|---|---|---|
| 1 | High | O portão recomenda o Replicate com HF off, mas o Diretor exige HF no 1º passo. Em `/videos/novo` o CTA vira "Conectar Higgsfield"; no onboarding o motor vira Replicate e o botão continua ativo, então o job falha (antes de pagar roteiro/narração). | DA:1107-1114; GG:136-141; NV:223-225; `setup-flow.tsx:316-321, 661`; `step-create.tsx:334-345` | verificado no código |
| 2 | **Blocker** | Aleph-2 recebe `reference_image`, campo inexistente: "Trocar pessoa" não usa a foto. | VE:70; DA:2219-2228 | schema `runwayml/aleph-2`: required `prompt`, `video`; opcionais `keyframe_images[]`/`keyframe_positions[]` (controle de quadro, não referência de pessoa); 0 ocorrências de `reference_image` |
| 3 | **Blocker** (em instância nova) | Aleph-2 só existe em VE:64-73, não no SI nem nas migrations drizzle: instância remixada fica sem `scene_v2v`, e estilo/cenário/pessoa falham. | `grep aleph` em SI/drizzle/scripts = 0 | verificado |
| 4 | High | Custo do Seedance 2.0 fixo em 0,14/s; em 1080p (o que `pickResolution` manda) o oficial é 0,45/s. Orçamento e débito ficam ~3,2× abaixo. | SI:736-745; DA:239-246, 316-317 | schema seedance-2.0: non_video_in 1080p = US$ 0,45 |
| 5 | High | Fila serial: 1 produção por tick (1 min), sempre a mais antiga (`order created_at limit 1`). Um job longo atrasa todos, e cada passo de cada job espera ≥1 min. | DA:2615, 2625-2633; `scripts/pos-remix.sql:44` (cron `* * * * *`); `src/routes/api/public/jobs/director-advance.ts` (via HTTP) | verificado |
| 6 | High | Rota "Vídeo comigo nas cenas" duplicada: `want` é ignorado e o apresentador não é exigido. | NV:153-158, 619-638; HUB:70-94 | verificado |
| 7 | High | Narração do Reel editável na tela, mas o servidor recusa (409). | GV:500-511; `scene-storyboard-card.tsx:89,98` | verificado |
| 8 | High | Remake não valida o limite de 16 MB do Aleph antes de enviar. | RF (sem checagem de tamanho); RM:129-150 | schema aleph-2: "<16MB" |
| 9 | Medium | STT `scribe_v1` está deprecated, com idioma fixo `pt`. | DA:535-541 | openapi ElevenLabs baixado: `scribe_v1` some, exemplos só com `scribe_v2`; o "deprecated" explícito vem da página de modelos (não baixada) |
| 10 | Medium | Portões decorativos (`onSelect` vazio) no Reel e na Tradução; o portão do Reel ignora `talking_avatar`. | RPV:124-139, 332, 387; RF:826 | verificado |
| 11 | Medium | Voz do apresentador não chega ao Diretor (só o gênero); `elevenlabs_voice_id` nunca é gravado. | DA:970-978; AS:201 | verificado (grep: só leitura em DA:973) |
| 12 | Medium | omni-human sem teto de 15 s. | SI:605-610 | schema: "after 15 seconds the video quality will begin to degrade" |
| 13 | Medium | Fabric: `max_duration_s 60` e resoluções 480p/720p não são validados; recebe `project.resolution`. | VP:493; VC:202 | schema fabric-1.0 |
| 14 | Medium | Fallback de `avatar_identity` (flux-kontext) inalcançável e sem `input_image`. | VP:1254, 1287-1289; AS:273-276 | — |
| 15 | Medium | Roteirista e trilha fixos em "fábrica B2B"; `objetivo`, `publico` e `tom` não orientam o planner. | `director-core.ts:61-97, 206`; DA:1670-1673 | — |
| 16 | Medium | Custo fixo por segundo onde o oficial varia por resolução: fabric, seedance-1-lite e p-video-avatar. | SI:590-623 | schemas Replicate |
| 17 | Medium | eleven_v3 sem corte em 5.000 caracteres no Diretor. | DA:1122-1137 | docs ElevenLabs (página de modelos; o limite não está no openapi baixado) |
| 18 | Low | Upscaler superestimado (0,05 → ~0,0069/s), lipsync-2 0,04 → 0,05, nano-banana-pro 0,14 → 0,15, nano-banana-2 0,08 → 0,067. | SI:563-569, 660-665, 762-774 | schemas Replicate |
| 19 | Low | Hailuo: `limits` lista 1080p, mas o template fixa 768p; se um dia mandar 1080p, só aceita 6 s. | SI:633-639 | schema hailuo-2.3 |
| 20 | Low | `p-video-avatar` com `version_hash` desatualizado; `required_inputs` sem audio. | SI:598-603, 704 | schema (latest b474…) |
| 21 | Low | Catálogo morto: `scene_t2v` (pixverse primário), `lipsync_post`. `model-notes.ts:15` tem nota para `kwaivgi/kling-v2.6`, que não está em nenhum seed (nota órfã). | VC:22,25; `src/lib/model-notes.ts:15` | se o modelo existe no Replicate: NÃO VERIFICADO |
| 22 | Low | Legendas do Remake ignoram a cor e a posição da marca. | DA:564-567; RF:693-701 | — |
| 23 | Low | Trilha de fundo limitada a 22 s; o oficial agora permite 30 s, com `loop`. | DA:529, 1673 | ElevenLabs openapi |
| 24 | Low | Custo na UI multiplica preço × duração total; o servidor cobra por unidade, com piso de 4 s e +1 s por unidade (UI subestima). | GG:242-256; DA:735-738 | — |
| 25 | Low | Máximos dos modelos HF fixos na UI (15/12 s), enquanto o servidor lê `hf_models` editável. | `src/hooks/use-video-models.ts:61-78`; DA:114-118 | — |
| 26 | Low | Imagem 9:16 gerada em 1024x1536 (2:3); a UI rotula gemini-3-pro como recomendado, mas o padrão do servidor é gemini-2.5-flash-image. | `generate-image/index.ts:72`; `use-app-settings.ts:238-242`; `_shared/llm.ts:127` | — |

---

## 6. Pontos NÃO VERIFICADOS e como verificar

| Ponto | Por que não foi verificado | Como verificar |
|---|---|---|
| `active` / `is_primary` reais em `video_models` | Os seeds usam `on conflict do nothing` e o default de `active` não está no repo | `select capability, model_id, active, is_primary from video_models order by 1;` |
| Overrides em `director_state` chave `hf_models` | Nenhum seed; editável em runtime | `select value from director_state where key = 'hf_models';` (DA:115) |
| IDs, limites e custo dos modelos Higgsfield (cinematic_studio_2_5 / 3_0 / video_v2) | Sem doc pública; terceiros citam "Cinema Studio 3.5" | Listar os modelos pelo MCP do Higgsfield, conectado |
| Aleph-2 com `reference_image`: o campo é ignorado ou dá 422? | Não foi executado | 1 predição de teste com o input atual; ler `prediction.input` e o erro |
| Nomes de idioma HeyGen "Spanish", "French", "Italian" e "German" (o openapi só traz "English" e "Spanish (Spain)" como exemplo) | O endpoint de lista exige chave | `GET /v3/video-translations/languages` com `HEYGEN_API_KEY` |
| Preços HeyGen (lipsync, tradução, foto que fala) | Página de preços dinâmica | Painel `platform.heygen.com/pricing` logado |
| Cron ativo na instância | `pos-remix.sql:44` agenda, mas é aplicado manualmente | `select jobname, schedule, active from cron.job where jobname like '%director%';` |
| Comportamento do omni-human > 15 s em produção | Não está em nenhum fluxo hoje | Só relevante se virar fallback |

---

## Revisão (29/10)

Revisão adversarial: cada referência file:line dos pontos abaixo foi reaberta; preços e campos foram conferidos nos schemas baixados (Replicate `rep/*.html`, HeyGen `hg/ext.json`, ElevenLabs `el/openapi.json`).

**Correções feitas:**

1. **Defeito 1 / risco 1, Blocker → High.** Antes: "a UI recomenda e permite o Replicate com HF off". Na verdade, `/videos/novo` não permite: `missingEngine` cai em `higgsfield` quando ele está off (NV:223-225) e o CTA vira "Conectar" (NV:562-563). Só o onboarding cria o job: o motor vira Replicate (`setup-flow.tsx:318-321`) e o botão de `setup-flow.tsx:661` não olha `videoBlocked`, que só gera um aviso (`step-create.tsx:334-345`). O job falha no `stepPlanning` antes de pagar qualquer coisa (DA:1106-1113, comentário em DA:1107-1108), por isso a severidade baixou.
2. **Aleph-2 (2.1, 3.7, defeito 2).** `reference_image` realmente não existe (0 ocorrências; required = `prompt`, `video`). Mas o doc dava `keyframe_images` + `keyframe_positions` como o campo "oficial" para a foto. O schema descreve esses campos como controle de quadro ("more precise control over edits", posição 'first'/'last'/segundos), não como referência de pessoa. Trocar o nome do campo não resolve "Trocar pessoa".
3. **Voz do remake (2.4, 3.3, matriz).** O doc omitia as checagens prévias. `voice_check` lê `can_use_instant_voice_cloning` (`video-remake/index.ts:44-54`) e a tela bloqueia (RF:132, 308-309). `voice_lookup` confere o Voice ID (`video-remake/index.ts:56-62`; RF:302-307). "A minha voz" exige `person_gender` (RF:286, 310-311), e quando o clone falha em runtime o servidor usa a voz desse gênero em vez de falhar (DA:2260-2273). A voz é obrigatória na tela (RF:284, 304).
4. **Provedores do remake de fala.** Antes: "ElevenLabs, e Replicate só se MiniMax". Na verdade é um **ou** outro: com `tts_model_id`, `remakeRequirements` pede Replicate no lugar de ElevenLabs (`remake-options.ts:86-89`).
5. **Foto que fala (2.3, 3.3, matriz).** Antes: "automático quando a fala difere >15% ou há `speech_frame_path`". Na verdade, o quadro só é tirado no navegador quando a fala estimada (15 caracteres/s) não cabe **e** é a única mudança, sem estilo/cena/pessoa/tradução (RF:288-294, 376-381). Com ElevenLabs, o servidor mede o mp3: >15% usa o quadro, ou dá erro sem ele (DA:2291-2312). Com MiniMax, o quadro vai direto, sem medir (DA:2248-2255). O payload foi conferido no openapi HeyGen (`CreateVideoFromImage`: required `type`, `image`; `audio_url`, `motion_prompt`, `expressiveness` high/medium/low, `resolution` 1080p, `aspect_ratio` auto; `VideoStatus` inclui `processing`).
6. **Apresentador (3.10).** Antes, a voz aparecia como campo exigido. Ela é opcional: `canSubmit` só exige nome e foto ou descrição (`new-avatar-dialog.tsx:49-50`), e o servidor cai em `VOICES[0]` (AS:154).
7. **Vídeo comigo nas cenas (matriz).** O element `ready` não é um input da pessoa. O tick cria o element, e as cenas com personagem esperam até 30 min (DA:812, 1172-1190).
8. **Hailuo (2.1).** Faltava o custo do código: é 0,06/s (SI:633-639). O oficial, por vídeo, é 768p 6 s 0,28, 10 s 0,56 e 1080p 6 s 0,49. O ponto de §6 sobre a faixa de 0,49 foi removido: o `criteria` do schema diz `1080P` + `6` explicitamente.
9. **§6, consulta de `hf_models`.** Antes: `select hf_models from director_state`. A tabela é chave/valor (DA:115): `select value from director_state where key='hf_models'`.
10. **§6, legendas no remake sem HF.** O ponto deixou de ser NÃO VERIFICADO: `remakeRequirements` pede higgsfield + elevenlabs com legendas (`remake-options.ts:93-96`), e o RF bloqueia com "Falta conectar" (RF:313-314). Isso foi acrescentado em 3.5 e o ponto saiu de §6.
11. **HeyGen, idiomas.** "Spanish" entrou na lista de não verificados: o openapi só traz "English" e "Spanish (Spain)" como exemplo.
12. **scribe_v1 e eleven_v3 (2.4, defeitos 9 e 17).** O doc atribuía ao openapi o "substituto scribe_v2". No openapi baixado, `scribe_v1` simplesmente não aparece mais (os exemplos são `scribe_v2`/`scribe_v2_medical`), e não há limite de 5.000 caracteres. As duas afirmações vêm da página de modelos, que não foi baixada.
13. **kling-v2.6 (defeito 21).** Antes: "que não existe". Sem schema baixado, não dá para afirmar. O que se confirma é uma nota órfã em `model-notes.ts:15`, sem linha em seed algum.
14. **Linhas desatualizadas:** RF:144-146 → 148-150 (`readyIdentities`); DA:740-760 → 745-770 (`videoUnits`); a frase "a UI corta pelo máximo" virou "tira da lista" (GG:347-349 filtra, não corta).

**Conferido e mantido:**
- HF obrigatório em todo job do Diretor: `stepPlanning` lança `NotConnectedError` (DA:1109), `stepKeyframes` sempre chama `hfGenerate` (DA:1219) e a montagem é `sandbox_exec` (DA:1716). O remake não passa por `stepPlanning` (DA:2557-2563, 2649).
- Seedance 2.0: `non_video_in` 1080p = US$ 0,45/s (480p 0,08, 720p 0,18, 4k 1,00); o seed tem 0,14 (SI:736-745); `pickResolution` → 1080p (DA:239-246). A razão é 3,2×.
- Upscaler: standard 1080p ≤30 fps = US$ 6,887 por 1.000 s. Fabric 480p 0,08 / 720p 0,15. p-video-avatar 720p 0,025 / 1080p 0,045, latest `b474…` vs seed `8a54…`. nano-banana-2 1K 0,067; nano-banana-pro 1K/2K 0,15. lipsync-2 0,05/s. speech-02-hd e 2.8-hd 0,10 por 1.000 **tokens**. omni-human "after 15 seconds the video quality will begin to degrade".
- Aleph-2: 0,336/s, "between 2 and 30 seconds and less than 16MB".
- Fila serial (DA:2615, 2625-2633; cron `* * * * *` em `pos-remix.sql:44`), narração 409 (GV:500-511), Aleph só em VE (grep), `onSelect={() => undefined}` (RPV:332, 387; RF:826), fallback de `avatar_identity` inalcançável (VP:1254 retorna sem `scene_id`; VP:1287-1288 mapeia para `keyframe`).
- As listas mínimas de 3.4 a 3.8 batem com `incomplete`/`blocker` do RF (RF:279-317): o consentimento só é exigido para pessoa, fala e tradução (`touchesPeople`, RF:278). Tirar qualquer campo listado quebraria um input exigido.

**Não confirmado:**
- O limite de 15% da HeyGen no lipsync não está no openapi (nenhum `duration_mismatch`). Ele vem do comentário do código (DA:2291-2293) e de uma falha observada.
- Possível lacuna: com MiniMax e sem quadro, o servidor manda o lipsync sem medir o áudio. A tela bloqueia só a fala longa demais sem foto que fala (RF:301), não a curta demais (`tooShort`). O HeyGen pode recusar. Não testado.
- O default de `active` em `video_models`, os preços da HeyGen, os IDs e limites do Higgsfield e o comportamento do Aleph com campo desconhecido continuam como em §6.
