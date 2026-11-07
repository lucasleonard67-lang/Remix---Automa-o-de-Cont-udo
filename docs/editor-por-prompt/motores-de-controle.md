# Motores de controle: velocidade, boca e movimento

Data: 2026-10-30. Pesquisa sem alteração de código. Nenhum render foi executado: qualidade visual e pontos de degradação são [Estimativa].

**Marcas:** [Fato] tem fonte ligada. [Estimativa] é julgamento nosso, sem medição. NÃO VERIFICADO é o que precisa de teste.
**Refaz?** `Existente` roda sobre vídeo pronto. `Refaz` gera de novo.
**Alcance hoje:** `Ligado` (o app já envia) · `Catálogo` (basta linha em `video_models`) · `Código` (integração existe, falta o campo) · `Não` (sem integração).

## 0. O que muda a decisão

1. **Nenhum motor tem parâmetro de "articulação".** A boca segue o áudio. Os controles reais são o áudio de entrada, o motor de lipsync e a expressividade ([`temperature`](https://sync.so/docs/models/lipsync), [`model_mode`](https://replicate.com/sync/react-1/api/schema)).
2. **Nosso fluxo padrão anula os controles de voz da HeyGen.** O app manda `audio_url` da ElevenLabs ([contrato](../hub-motor-contratos.md)). `voice_settings` [não vale com áudio enviado](https://developers.heygen.com/openapi/external-api.json), e a [glossary também não](https://developers.heygen.com/docs/brand-glossary.md).
3. **O app usa `eleven_v3`, sem velocidade.** O guia diz ["Speed is not available for the Eleven v3 model"](https://elevenlabs.io/docs/eleven-creative/playground/text-to-speech), e o v4 também não tem. O código manda só `stability` (`director-advance/index.ts:567`). Para controlar ritmo: `eleven_multilingual_v2`/`eleven_flash_v2_5`, ou MiniMax.
4. **Correções aos catálogos.**
   - Kling 4.0 com vídeo de entrada [cobra entrada + saída](https://replicate.com/kwaivgi/kling-v4.0): 1080p sai a ~US$ 0,282/s, não 0,141/s.
   - HeyGen filler removal [custa US$ 0,30/min, mínimo 1 min](https://developers.heygen.com/openapi/external-api.json).
   - `sync/react-1` [vai até 15 s](https://sync.so/docs/compatibility-and-tips/improving-lip-sync-quality).
   - `pollinations/rife-video-interpolation` [não roda hoje no Replicate](https://replicate.com/pollinations/rife-video-interpolation).
   - `pollinations/codeformer-video` [não pode uso comercial](https://replicate.com/pollinations/codeformer-video).

## 1. Velocidade

### Voz antes de gerar

| Motor | Parâmetro | Faixa | Custo | Refaz? | Alcance | Status |
|---|---|---|---|---|---|---|
| HeyGen `POST /v3/videos` | `voice_settings.speed`, `pitch` | 0,5–1,5 · −50 a 50 | junto do vídeo | Refaz | Código (`buildAvatarVideoBody` não envia; só com `script`) | [Fato](https://developers.heygen.com/openapi/external-api.json) |
| HeyGen `POST /v3/voices/speech` | `speed`, `<break time="1s"/>` | 0,5–2,0 · break em segundos | não publicado | Refaz | Código (só teste de voz, `heygen.ts:435`) | [Fato](https://developers.heygen.com/docs/voices/speech.md) |
| HeyGen `POST /v3/models/audio/tts` | `speed`, `pitch_shift`, `pitch_variance` | 0,75–1,25 · ±4 · 0,5–2 | não publicado | Refaz | Não. Só clone profissional; o instantâneo ignora | [Fato](https://developers.heygen.com/openapi/external-api.json) |
| ElevenLabs TTS | `voice_settings.speed` | [0,7–1,2](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices) | por caractere | Refaz | Código. Exige trocar `eleven_v3` | [Fato](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices); envio no v3/v4 NÃO VERIFICADO |
| MiniMax `speech-2.8-hd` | `speed`, `pitch`, `emotion` | [0,5–2,0 · ±12 · 10 valores](https://replicate.com/minimax/speech-2.8-hd/api/schema) | US$ 0,10/1k tokens | Refaz | Catálogo (seed fixa `1.0`) | [Fato](https://replicate.com/minimax/speech-2.8-hd/api/schema) |
| `prunaai/p-video-2-pro-avatar` | `voice_prompt` | texto livre (ritmo, tom) | US$ 0,06/s 1080p | Refaz | Catálogo. Só com `voice_script` | [Fato](https://replicate.com/prunaai/p-video-2-pro-avatar/api/schema) |

### Vídeo e áudio prontos

| Motor | Parâmetro | Faixa | Custo | Refaz? | Alcance | Status |
|---|---|---|---|---|---|---|
| ffmpeg (op `speed`) | `setpts=PTS/f` + `atempo=f` | [0,5–100; acima de 2 pula amostras](https://ffmpeg.org/ffmpeg-filters.html); menu 1,05–1,25 | zero | Existente | Ligado (`video-edit.ts:105`) | [Fato](https://ffmpeg.org/ffmpeg-filters.html) |
| ffmpeg | `rubberband=tempo=f:formant=preserved` | exige [`--enable-librubberband`](https://ffmpeg.org/ffmpeg-filters.html) | zero | Existente | Código; o sandbox pode não ter | NÃO VERIFICADO (`PROBE_COMMAND` não checa) |
| ffmpeg | `minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1` | [fps livre](https://ffmpeg.org/ffmpeg-filters.html) | zero; lento na CPU | Existente | Código | [Fato](https://ffmpeg.org/ffmpeg-filters.html); tempo NÃO VERIFICADO |
| `bytedance/video-upscaler` | `target_fps`, `processing_type` | [24, 30, 60, 120; interpola se maior que a origem](https://replicate.com/bytedance/video-upscaler/api/schema) | 1080p ≤30 fps ~0,0069/s · >30 fps ~0,0138/s | Existente | Catálogo (seed fixa 24) | [Fato](https://replicate.com/bytedance/video-upscaler/api/schema); a página mostra a unidade confusa |
| `topazlabs/video-upscale` | `target_fps` | [15–60](https://replicate.com/topazlabs/video-upscale/api/schema) | US$ 0,08/unidade | Existente | Catálogo | [Fato](https://replicate.com/topazlabs/video-upscale/api/schema) |
| `zsxkib/film-frame-interpolation-for-large-motion` | `num_interpolation_steps`, `playback_frames_per_second` | [1–50 · 1–60](https://replicate.com/zsxkib/film-frame-interpolation-for-large-motion) | ~US$ 0,28/execução | Existente | Catálogo (community, exige `version_hash`) | [Fato](https://replicate.com/zsxkib/film-frame-interpolation-for-large-motion) |
| `sync/*` | `sync_mode: remap` | [estica ou comprime o vídeo até o áudio](https://sync.so/docs/developer-guides/sync-mode) | preço do lipsync | Existente | Catálogo | [Fato](https://sync.so/docs/developer-guides/sync-mode); a própria doc avisa que muda natural |
| Higgsfield `cinematic_studio_3_0` | `speedramp` | [`auto`, `linear`, `slowmo`, `speedup`, `fast_to_slowmo`, `slowmo_to_fast`, `super_slowmo`, `impact`](https://github.com/higgsfield-ai/cli/blob/main/MODELS.md) | créditos | Refaz | Código; argumento no MCP NÃO VERIFICADO | [Fato](https://github.com/higgsfield-ai/cli/blob/main/MODELS.md) na CLI |
| Higgsfield `cinematic_studio_video_v2` | `speedramp` | [`auto`, `custom`, `linear`, `slowmo`, `speedup`, `impact`](https://github.com/higgsfield-ai/cli/blob/main/MODELS.md) | créditos | Refaz | idem | [Fato](https://github.com/higgsfield-ai/cli/blob/main/MODELS.md) na CLI |

### Onde cada um estraga a boca

Tudo aqui é [Estimativa], sem medição.

| Fator | Fala com rosto | Sem fala |
|---|---|---|
| 1,05–1,25 | Seguro. Áudio e vídeo mudam juntos, então o sincronismo não sai | Seguro |
| 1,25–1,5 | Sincroniza, mas a dicção fica corrida e a fala em PT-BR cansa | Seguro |
| 0,90–0,99 | Seguro. Pouco visível | Seguro |
| 0,85–0,90 | Limite. Boca um pouco lenta; `atempo` começa a soar artificial | Seguro |
| abaixo de 0,85 | Evitar. Boca arrasta; interpolar não resolve e pode borrar dentes | Bom com interpolação |
| só o áudio muda | Quebra sempre. Exige novo lipsync | Não se aplica |

**Regra:** para falar mais devagar, gere a fala mais lenta e faça o lipsync. Esticar o vídeo pronto é o último recurso.

## 2. Boca

### Lipsync sobre vídeo existente

| Modelo / slug | Entradas e controles | Limite | US$/s | Alcance | Status |
|---|---|---|---|---|---|
| HeyGen `POST /v3/lipsyncs` | `mode`, `start_time`/`end_time`, `enable_speech_enhancement`, `disable_music_track`, `fps_mode`, `enable_dynamic_duration` | limites gerais de mídia | não publicado na doc | Ligado, só `precision` (`remake.ts`) | [Fato](https://developers.heygen.com/openapi/external-api.json); preço direto NÃO VERIFICADO |
| `heygen/lipsync-precision` · `-speed` | `video`, `audio` + os mesmos flags, sem trecho | NÃO VERIFICADO | [0,0667](https://replicate.com/heygen/lipsync-precision/api/schema) · [0,0333](https://replicate.com/heygen/lipsync-speed/api/schema) | Catálogo (`lipsync_post`) | [Fato](https://replicate.com/heygen/lipsync-precision/api/schema) |
| `sync/lipsync-2-pro` | [`temperature` 0–1, `sync_mode`, `active_speaker`](https://replicate.com/sync/lipsync-2-pro/api/schema) | [1 a 30 min por plano](https://sync.so/docs/models/lipsync); rosto até 350 px | 0,08325 | Catálogo; template sem `temperature` | [Fato](https://sync.so/docs/models) |
| `sync/lipsync-2` | iguais | iguais | [0,05](https://replicate.com/sync/lipsync-2/api/schema) | Catálogo | [Fato](https://replicate.com/sync/lipsync-2/api/schema) |
| `sync/react-1` | [`emotion` (6), `model_mode` lips/face/head, `temperature`](https://replicate.com/sync/react-1/api/schema) | [≤15 s](https://sync.so/docs/compatibility-and-tips/improving-lip-sync-quality) | 0,167 | Catálogo | [Fato](https://replicate.com/sync/react-1/api/schema) |
| `sync-3` (API sync.so) | [`temperature` e oclusão automáticos; aceita imagem](https://sync.so/docs/openapi.json) | 1–30 min por plano | [0,1066–0,1334](https://sync.so/pricing.md) | Não; [slugs testados dão 404](https://replicate.com/sync) | [Fato](https://sync.so/pricing.md) |
| `pixverse/lipsync` | `video`, `audio` | NÃO VERIFICADO | [0,04](https://replicate.com/pixverse/lipsync/api/schema) | Catálogo | [Fato](https://replicate.com/pixverse/lipsync/api/schema) |
| `kwaivgi/kling-lip-sync` | `video_url`, `audio_file` | [2–10 s, ≤100 MB, áudio <5 MB](https://replicate.com/kwaivgi/kling-lip-sync/api/schema) | 0,014 | Catálogo | [Fato](https://replicate.com/kwaivgi/kling-lip-sync/api/schema) |
| `bytedance/latentsync` | [`guidance_scale` 0–10](https://replicate.com/bytedance/latentsync/api/schema) | NÃO VERIFICADO | [~US$ 0,095/execução](https://replicate.com/bytedance/latentsync) | Catálogo (community) | [Fato](https://replicate.com/bytedance/latentsync) |
| `tmappdev/lipsync` (MuseTalk) · `chenxwh/video-retalking` | `bbox_shift`, `fps` · `face`, `input_audio` | NÃO VERIFICADO | sem tabela | Catálogo (community) | [Fato](https://replicate.com/collections/lipsync) na lista; qualidade NÃO VERIFICADA |

**Sobre qualidade:** a doc da sync.so manda [lipsync-2 para uso geral, 2-pro para barba e dentes, sync-3 para close, perfil e obstrução](https://sync.so/docs/models/lipsync). A HeyGen só diz que [precision é a opção para fidelidade](https://developers.heygen.com/lipsync-precision.md). Não achamos teste independente em PT-BR. Para Remake, o padrão segue HeyGen precision, com A/B contra `sync/lipsync-2-pro` [Estimativa].

**`sync_mode`:** o padrão é [`loop` no Replicate](https://replicate.com/sync/lipsync-2-pro/api/schema) e [`bounce` na API](https://sync.so/docs/openapi.json). O template do catálogo propõe `cut_off`, que evita vídeo voltando.

### Gerar com fala embutida

| Motor | Parâmetro | Faixa | Custo | Alcance | Status |
|---|---|---|---|---|---|
| HeyGen `avatar_v` | `engine.type`, [`more_blinking`, `reference_look_id`](https://developers.heygen.com/openapi/external-api.json) | opt-in por look; ler `supported_api_engines` | [~US$ 0,0667–0,12/s, NÃO VERIFICADO](../catalogo-heygen.md) | Código (`pickEngine` existe; `more_blinking` não) | [Fato](https://developers.heygen.com/avatar-v.md) |
| HeyGen `avatar_iv` | `expressiveness` | [`low` padrão, `medium`, `high`; só foto e imagem](https://developers.heygen.com/avatar-iv.md) | NÃO VERIFICADO | Ligado, fixo em `medium` (`heygen.ts:507`) | [Fato](https://developers.heygen.com/avatar-iv.md) |
| HeyGen `avatar_iii` | sem `motion_prompt` nem `expressiveness` | [4K em twin/studio](https://developers.heygen.com/models.md) | NÃO VERIFICADO | Código | [Fato](https://developers.heygen.com/models.md) |
| Seedance 2.0 Replicate | `reference_audios` | [≤3, 15 s; exige imagem ou vídeo de referência](https://replicate.com/bytedance/seedance-2.0/api/schema) | 720p 0,18 · com vídeo 0,22 | Código | [Fato](https://replicate.com/bytedance/seedance-2.0/api/schema) |
| Higgsfield | `audio_references` em `seedance_2_5`, `seedance_2_0` | [modo `omni_reference`](https://github.com/higgsfield-ai/skills/blob/main/higgsfield-generate/references/media-inputs.md) | créditos | Código | [Fato](https://github.com/higgsfield-ai/skills/blob/main/higgsfield-generate/references/media-inputs.md) no SK; conta NÃO VERIFICADA |
| Kling 4.0 | fala entre aspas com idioma, tom e velocidade | [PT incluso](https://kling.ai/quickstart/kling-4-model-user-guide) | 1080p 0,235 | Catálogo | [Fato](https://kling.ai/quickstart/kling-4-model-user-guide) no guia; no Replicate NÃO VERIFICADO |
| `bytedance/omni-human-1.5` · `kwaivgi/kling-avatar-v2` | `prompt` de gesto e câmera | [<35 s](https://replicate.com/bytedance/omni-human-1.5/api/schema) · [áudio ≤5 MB](https://replicate.com/kwaivgi/kling-avatar-v2/api/schema) | 0,16 · 0,056–0,11 | Catálogo | [Fato](https://replicate.com/bytedance/omni-human-1.5/api/schema) |
| Hedra Character-3 | áudio + foto | [API por crédito](https://www.hedra.com/docs/pages/developer/guides/generate-avatar-video.md) | sem preço oficial | Não; não vale integrar agora | [Fato](https://www.hedra.com/docs/pages/developer/guides/generate-avatar-video.md) parcial |

### O que melhora a articulação, em ordem

1. **Áudio limpo.** A sync.so pede [fala sem música, ruído nem sobreposição](https://sync.so/docs/compatibility-and-tips/improving-lip-sync-quality). Hoje o `voice_clean` usa filtro simples; [Voice Isolator](https://elevenlabs.io/docs/overview/capabilities/voice-isolator) custa 1.000 caracteres por minuto e vai até 500 MB ou 1 h.
2. **Rosto legível.** [Frontal, luz uniforme, mão e microfone longe da boca, 1080p, câmera estável](https://sync.so/docs/compatibility-and-tips/improving-lip-sync-quality).
3. **Fala mais lenta na geração.** `speed` 0,9–0,95 ajuda o lipsync a separar sílabas [Estimativa, sem teste A/B].
4. **Pausa escrita.** [`<break>` até 3 s](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices) em `multilingual_v2`/flash. [v3 e v4 não aceitam](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices): use reticências e estrutura. Muitos breaks [causam instabilidade](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices).
5. **Pronúncia.** ElevenLabs tem [`pronunciation_dictionary_locators`, até 3](https://api.elevenlabs.io/openapi.json), com [phoneme só em `eleven_flash_v2`](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices). No `eleven_v4`, IPA entre barras. HeyGen tem [glossary](https://developers.heygen.com/docs/brand-glossary.md) e, no clone instantâneo, [`pronunciation_dictionary` em IPA](https://developers.heygen.com/openapi/external-api.json).
6. **Expressividade.** `temperature` 0,5 é o padrão; acima disso a boca abre mais, com risco de exagero [Estimativa].
7. **Corte em blocos.** A sync.so [perde qualidade na emenda de 30–40 s](https://sync.so/docs/compatibility-and-tips/improving-lip-sync-quality) e recomenda trechos abaixo de 2 min.

**Troca de palavra:** a sync.so tem [`/v2/dialogue-edits`](https://sync.so/docs/openapi.json), que refala só as palavras editadas com a voz clonada e aceita `pronunciation`. Chave de API depende de liberação da conta. Não integrado.

## 3. Movimento

| Motor | Parâmetro | Faixa / regra | Custo | Refaz? | Alcance | Status |
|---|---|---|---|---|---|---|
| HeyGen | `motion_prompt` | [corpo e mãos; foto nos dois motores, twin só no `avatar_v`; recusado no `avatar_iii`](https://developers.heygen.com/openapi/external-api.json). Exemplo oficial: ["walk towards the camera slowly"](https://developers.heygen.com/avatar-iv.md). Nosso teto de 500 é interno | junto do vídeo | Refaz | Ligado (`heygen.ts:505`); foto que fala usa frase fixa (`remake.ts:310`) | [Fato](https://developers.heygen.com/openapi/external-api.json) |
| HeyGen | `type: cinematic_avatar` | [`prompt`, 1–3 looks, ≤3 vídeos e ≤9 imagens, 4–15 s](https://developers.heygen.com/openapi/external-api.json) | [preço fixo por cena](https://developers.heygen.com/openapi/external-api.json), valor não publicado | Refaz | Código | [Fato](https://developers.heygen.com/openapi/external-api.json) |
| Seedance 2.0 Replicate | `reference_videos`, `[Video1]` | [≤3, 15 s no total; dança, câmera, edição](https://replicate.com/bytedance/seedance-2.0/api/schema) | 1080p 0,55 | Refaz | Catálogo | [Fato](https://replicate.com/bytedance/seedance-2.0/api/schema); junto de `image` NÃO VERIFICADO |
| Seedance 2.0 | `image` + `last_frame_image` | [não combina com `reference_images`](https://replicate.com/bytedance/seedance-2.0/api/schema) | 1080p 0,45 | Refaz | Catálogo | [Fato](https://replicate.com/bytedance/seedance-2.0/api/schema) |
| Seedance 1.5 Pro | `camera_fixed`, `last_frame_image` | [booleano](https://replicate.com/bytedance/seedance-1.5-pro/api/schema) | 1080p 0,06 | Refaz | Catálogo | [Fato](https://replicate.com/bytedance/seedance-1.5-pro/api/schema) |
| Kling 4.0 | `reference_videos`, `middle_images`, `end_image`, `base_video` | [≤5 vídeos, 30 s somados; ≤10 imagens](https://replicate.com/kwaivgi/kling-v4.0) | [0,141/s sobre entrada + saída](https://replicate.com/kwaivgi/kling-v4.0) | Refaz / Existente | Catálogo | [Fato](https://replicate.com/kwaivgi/kling-v4.0) |
| Kling 3.0 | `multi_prompt`, `end_image` | [≤6 planos](https://replicate.com/kwaivgi/kling-v3-video/api/schema) | pro 0,224 | Refaz | Catálogo | [Fato](https://replicate.com/kwaivgi/kling-v3-video/api/schema) |
| `kwaivgi/kling-v3-motion-control` | `image`, `video`, `character_orientation`, `keep_original_sound` | [`image` ≤10 s · `video` ≤30 s](https://replicate.com/kwaivgi/kling-v3-motion-control/api/schema) | std 0,07 · pro 0,12 | Refaz | Catálogo (capability nova) | [Fato](https://replicate.com/kwaivgi/kling-v3-motion-control/api/schema) |
| `bytedance/dreamactor-m2.0` | `image`, `video` | [≤30 s; transfere corpo, rosto e lábios](https://replicate.com/bytedance/dreamactor-m2.0/api/schema) | 0,05 | Refaz | Catálogo | [Fato](https://replicate.com/bytedance/dreamactor-m2.0/api/schema) |
| `prunaai/p-video-animate` | `instruction_prompt`, `target_fps` | [fonte de movimento e áudio](https://replicate.com/prunaai/p-video-animate/api/schema) | 720p 0,03 · 1080p 0,06 | Refaz | Catálogo | [Fato](https://replicate.com/prunaai/p-video-animate/api/schema) |
| `wan-video/wan-2.2-animate-animation` | `character_image`, `video`, `merge_audio` | [480/720](https://replicate.com/wan-video/wan-2.2-animate-animation/api/schema) | unidade confusa na página | Refaz | Catálogo | NÃO VERIFICADO o preço |
| Runway Act-Two | [`bodyControl`, `expressionIntensity` 1–5, `reference` 3–30 s](https://github.com/runwayml/sdk-node/blob/main/src/resources/character-performance.ts) | `ratio` 720:1280 | [5 créditos/s](https://docs.dev.runwayml.com/guides/pricing/) = US$ 0,05/s | Refaz | Não; [fora do Replicate](https://replicate.com/collections/video-editing) | [Fato](https://github.com/runwayml/sdk-node/blob/main/src/resources/character-performance.ts) |
| Higgsfield | `video_references` em `seedance_2_5` | [`omni_reference`, `video_edit`, `video_extension`](https://github.com/higgsfield-ai/skills/blob/main/higgsfield-generate/references/model-catalog.md) | créditos | Refaz | Código | [Fato](https://github.com/higgsfield-ai/skills/blob/main/higgsfield-generate/references/model-catalog.md) no SK |
| Higgsfield | Kling Motion Control e Genjutsu | [só API REST](../catalogo-higgsfield.md) | sob estimativa REST | Refaz | Não | [Fato](../catalogo-higgsfield.md) |
| `runwayml/aleph-2` | `keyframe_images`, `keyframe_positions` | [≤5; controla edição, não pessoa](https://replicate.com/runwayml/aleph-2/api/schema) | 0,336 | Existente | Ligado sem esses campos | [Fato](https://replicate.com/runwayml/aleph-2/api/schema) |
| `bytedance/video-upscaler` | `processing_type: pro`, `scene` | [pele e detalhe](https://replicate.com/bytedance/video-upscaler/api/schema) | 1080p 0,0689 a 0,1377 | Existente | Catálogo | [Fato](https://replicate.com/bytedance/video-upscaler/api/schema) |
| `tencentarc/gfpgan` · `sczhou/codeformer` | `version` · `codeformer_fidelity` | [só imagem](https://replicate.com/tencentarc/gfpgan/api/schema); CodeFormer [não comercial](https://replicate.com/pollinations/codeformer-video) | sem tabela | Existente, por quadro | Não usar | [Fato](https://replicate.com/pollinations/codeformer-video) |

**Regras de prompt:**
- **Seedance (guia do 2.5):** [termos de cinema, uma câmera coerente, ação visível em vez de emoção abstrata, sem encher poucos segundos de ações, diga o que tirar de cada referência](https://ai.byteplus.com/resources/how-to-write-better-seedance-2-5-prompts).
- **Kling:** [sujeito, ação, cenário, câmera, nessa ordem](https://replicate.com/kwaivgi/kling-v4.0). Em clipes longos, [faixas de tempo](https://kling.ai/quickstart/kling-4-model-user-guide). Para editar, ["Edit @Video1"; "Reference @Video1" pode gerar outro vídeo](https://kling.ai/quickstart/kling-4-model-user-guide). [Um movimento principal por plano](https://kling.ai/blog/kling-ai-camera-control-video-guide) e ["camera locked off"](https://kling.ai/topics/make-a-photo-move) para travar.
- **HeyGen:** [`more_blinking` com `motion_prompt` pode tirar o olhar da câmera](https://developers.heygen.com/openapi/external-api.json).

## 4. Ranking para o menu de edição

Custo para um Reel de 30 s. Esforço é [Estimativa]: P até 1 dia, M 2–4 dias, G uma semana ou mais.
As ops com modelo não cabem em `compileEdit`, que só gera ffmpeg. Elas pedem uma fase `preparing` em `video-edit-engine.ts`, antes de `rendering`, que troca `src.mp4` pelo resultado.

| # | Operação | Motor | Onde encaixa | Custo | Esforço |
|---|---|---|---|---|---|
| 1 | `speed` com faixa 0,85–1,25 (sem tipo novo) | ffmpeg | clamp em `video-edit.ts:105`, prompt em `video-edit-engine.ts:220`, teste | zero | P |
| 2 | `avatar_direction` (`calmo`, `gestos`, `energia`) | HeyGen `motion_prompt`, `avatar_v`, `expressiveness`, `more_blinking` | `AvatarVideoInput` e `buildAvatarVideoBody` em `heygen.ts`; remover o `medium` fixo | preço do vídeo; ~US$ 2–3,60 NÃO VERIFICADO | P |
| 3 | `voice_pace` (0,85–1,15) | ElevenLabs `eleven_multilingual_v2` + `speed`; MiniMax `speed` | TTS em `director-advance/index.ts:567`; `speed` no template MiniMax | caracteres do TTS | P |
| 4 | `voice_isolate` | ElevenLabs `POST /v1/audio-isolation` | fase `preparing`, antes do STT e do lipsync; `OP_TYPES`, `OP_SCHEMA` | ~500 caracteres em 30 s | M |
| 5 | `lip_fix` (`word_from`, `word_to`) | HeyGen `/v3/lipsyncs` `precision` + `start_time`/`end_time`; fallback `lipsync_post` | `heygenCreateLipsync` ganha trecho; fase `preparing` | US$ 2,00 no Replicate | M |
| 6 | `expression` (`emotion`, trecho ≤15 s) | `sync/react-1`, `model_mode: face` | `lipsync_post` com `{{emotion}}`; fase `preparing` | US$ 2,50 por 15 s | M |
| 7 | `slow_motion` (fator 0,5–0,85, só sem fala) | ffmpeg + `bytedance/video-upscaler` `target_fps: 60` | `normalizeOps` recusa faixa com palavras; linha nova `util_interpolate` | ~US$ 0,42 | M |
| 8 | `motion_ref` (vídeo de movimento + foto) | `kwaivgi/kling-v3-motion-control` pro | capability `motion_transfer` em `video-catalog.ts`; fluxo Remake | US$ 3,60 | M |

**Não entrar agora:** `sync-3` e Act-Two pedem integração nova. `minterpolate` fica como plano B do item 7. `speedramp` só vale em cena nova.

## 5. O que não prometer

- **"Corrige a dicção":** vídeo real mantém a fala gravada. Melhorar exige refazer a voz e o lipsync, e aí a voz muda.
- **Fala em câmera lenta:** abaixo de 0,85 a boca arrasta.
- **Lipsync perfeito em PT-BR, perfil ou mão na boca:** [perfil extremo piora](https://sync.so/docs/models/lipsync) e não há benchmark em PT-BR.
- **Movimento exato:** prompt orienta, não garante gesto nem momento. Twin no `avatar_iv` nem aceita `motion_prompt`.
- **Mesmo rosto em toda troca de movimento:** motion transfer e `model_mode: head` refazem pixels da pessoa.
- **Restauração de rosto:** sem opção comercial confirmada. Upscaler melhora detalhe, não reconstrói boca.
- **Custo final HeyGen:** preços do avatar e do lipsync direto seguem NÃO VERIFICADOS.
- **Velocidade em qualquer voz:** clone instantâneo da HeyGen ignora `speed`, e `eleven_v3` não tem.

## 6. Verificar antes de ligar

1. Mandar `speed` em `eleven_v3` e `eleven_v4`: ignora ou dá erro?
2. Rodar `PROBE_COMMAND` com `rubberband` e `minterpolate` acrescentados.
3. A/B de 3 clipes PT-BR: HeyGen precision × `lipsync-2-pro` × `speed` 0,9.
4. Render real em 0,85, 0,8 e 0,7 para fixar o limite da tabela da §1.
5. `models_explore` para confirmar `speedramp` e `audio_references` no MCP (sem acesso ao MCP do Higgsfield nesta pesquisa).
6. Ler `platform.heygen.com/pricing` logado e medir `cost_usd` por job.
