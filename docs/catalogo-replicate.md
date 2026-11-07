# Catálogo Replicate: modelos de vídeo e áudio (out/2026)

**Fonte:** páginas `replicate.com/<owner>/<model>` (preço em `billingConfig`) e `/api/schema` (Input), lidas em 2026-10-29. Coleções varridas: text-to-video, image-to-video, video-editing, lipsync, text-to-speech, ai-music-generation, super-resolution, speech-to-text.
**Fora do Replicate em 2026-10-29:** `veed/fabric-1.5`, `tencent/hunyuan-video-1.5` e `runwayml/upscale-v1` (404). `google/veo-3.1-fast` não tem `reference_images`.
**Escopo:** este documento não verifica qualidade visual. Sempre que um ranking depende de qualidade, o item está marcado como NÃO VERIFICADO.

**Como ler os templates.** Formato de `input_template` em `_shared/video-catalog.ts`:
- `"{{x}}"` sozinho mantém o tipo (número, array).
- Variável ausente omite o campo.
- `{"$when":"x","value":v}` envia `v` só quando `x` existe.

Variáveis disponíveis: `prompt`, `negative_prompt`, `text`, `keyframe_url`, `audio_url`, `video_url`, `reference_urls`, `reference_url`, `duration_int`, `resolution`, `voice_id`, `language_boost`, `bitrate`.

**Regra para cenas:** o pipeline gera a narração por TTS e junta o áudio depois (`util_audio_merge`). Por isso todo modelo com áudio nativo vai com o áudio **desligado**: é mais barato e não gera dois áudios.

---

## 1. Cenas: imagem → vídeo (`scene_i2v`) e texto → vídeo (`scene_t2v`)

Preço por segundo de saída, **sem áudio**, salvo indicação. "Contínua" = qualquer inteiro na faixa (casa com a duração da fala, sem segundos mudos).

| Modelo | Duração | Resoluções / AR | Áudio nativo | Preço oficial (US$/s) | Notas do schema |
|---|---|---|---|---|---|
| **kwaivgi/kling-v4.0** | **3-30 contínua** | 720p, 1080p; AR vem da imagem | NÃO VERIFICADO (sem flag no schema) | 720p 0,157 · 1080p 0,235 | `start_image` + `reference_images` (personagem) juntos; `middle_images`, `end_image`; `base_video` (edição) |
| google/veo-3.1 | {4,6,8} | 720p, 1080p; 16:9, 9:16 | sim | 0,20 (com áudio 0,40) | `image`, `last_frame`; `reference_images` 1-3 **só em 16:9** |
| google/veo-3.1-fast | {4,6,8} | 720p, 1080p | sim | 0,10 (com áudio 0,15) | sem `reference_images` |
| google/veo-3 / veo-3-fast | {4,6,8} | 720p, 1080p | sim | 0,20 / 0,10 | substituídos pelo 3.1 |
| **bytedance/seedance-2.0** (atual) | -1, 1-15 contínua | 480p-4k; 9:16 | sim | 480p 0,08 · 720p 0,18 · 1080p 0,45 · 4k 1,00 | `reference_images` ≤9 **não combina** com `image`; `reference_audios` faz lipsync |
| bytedance/seedance-2.0-fast | -1, 1-15 | 480p, 720p | sim | 480p 0,07 · 720p 0,15 | mesmo schema, sem 1080p |
| bytedance/seedance-1.5-pro | 2-12 contínua | 480p-1080p | sim | 480p 0,013 · 720p 0,026 · 1080p 0,06 (com áudio 0,12) | `last_frame_image`, `camera_fixed` |
| bytedance/seedance-1-pro | 2-12 | 480p-1080p | não | 0,03 · 0,06 · 0,15 | — |
| bytedance/seedance-1-pro-fast | 2-12 | 480p-1080p | não | 0,015 · 0,025 · 0,06 | — |
| bytedance/seedance-1-lite (atual) | 4-12 | 480p-1080p | não | 0,018 · 0,036 · 0,072 | mais caro e mais antigo que o 1-pro-fast |
| alibaba/wan-3 | **2-30 contínua** | 480p-1080p; AR vem da imagem | NÃO VERIFICADO | 480p 0,025 · 720p 0,05 · 1080p 0,10 | `image` opcional (i2v e t2v) |
| alibaba/happyhorse-1.1 | 3-15 | 720p, 1080p | NÃO VERIFICADO | 720p 0,14 · 1080p 0,18 | `images[]` (0 = t2v, 1 = i2v, ≤9 = r2v). **Precisa de variável array para o keyframe** (ver §8) |
| alibaba/happyhorse-1.0 | 3-15 | 720p, 1080p | NÃO VERIFICADO | 0,14 · 0,28 | substituído pelo 1.1 |
| wan-video/wan-2.7-i2v | 2-15 contínua | 720p, 1080p; AR da imagem | sim (gera se não receber `audio`) | 720p 0,10 · 1080p 0,15 | `first_frame`, `audio` (3-30 s) para sincronizar |
| wan-video/wan-2.7-r2v | 2-10 | 720p, 1080p; 9:16 | NÃO VERIFICADO | 0,10 | `reference_images` / `reference_videos` do personagem |
| wan-video/wan-2.5-i2v | {5,10} | 480p-1080p | sim (via `audio`) | 0,05 · 0,10 · 0,15 | substituído pelo 2.7 |
| minimax/hailuo-2.3 (atual) | {6,10}; 1080p só 6 s | 768p, 1080p | não | por vídeo: 768p 6 s 0,28 · 10 s 0,56 · 1080p 6 s 0,49 | `first_frame_image` |
| minimax/hailuo-2.3-fast | {6,10} | 768p, 1080p | não | 0,19 · 0,32 · 0,33 por vídeo | `first_frame_image` **obrigatório** |
| kwaivgi/kling-v3-video | 3-15 contínua | `mode` standard 720p / pro 1080p / 4k | sim | std 0,168 · pro 0,224 · 4k 0,42 | `multi_prompt` (≤6 planos) |
| kwaivgi/kling-v3-omni-video | 3-15 | idem | sim | std 0,168 · pro 0,224 · 4k 0,42 | refs ≤7; vídeo de referência 3-10 s |
| kwaivgi/kling-o1 | 3-10 | `mode` std/pro | não | std 0,084 · pro 0,112 | i2v aceita só 5 ou 10 |
| kwaivgi/kling-v2.6 | {5,10} | — | sim | 0,07 (com áudio 0,14) | — |
| kwaivgi/kling-v2.5-turbo-pro (atual) | {5,10} | — | não | 0,07 | — |
| kwaivgi/kling-v2.1-master | {5,10} | — | não | 0,28 | caro e antigo |
| luma/ray-3.2 | {5,10}; com imagem só 5 | 540p, 720p, 1080p; HDR | NÃO VERIFICADO | por vídeo de 5 s: 540p 0,15 · 720p 0,30 · 1080p 1,20 (0,24/s); HDR 1080p 2,40 | `start_image`, `end_image`, `loop` |
| runwayml/gen-4.5 | {5,10} | sem campo de resolução (NÃO VERIFICADO); 9:16 | NÃO VERIFICADO | 0,12 | `image` opcional |
| pixverse/pixverse-v6-max | {5,8,10,15} | 360p-1080p (`quality`) | sim (`generate_audio_switch`) | 720p 0,11 · 1080p 0,22 | `multi_clip` |
| pixverse/pixverse-v6 (atual t2v) | {5,8,10,15} | 360p-1080p | sim | 720p 0,09 · 1080p 0,18 | `last_frame_image` |
| lightricks/ltx-2.3-pro | {6,8,10} | 1080p, 2k, 4k; 16:9, 9:16 | sim | 1080p 0,08 · 2k 0,16 · 4k 0,32 | `task` i2v / audio_to_video / retake / extend |
| lightricks/ltx-2-fast | {6..20 pares}; >10 s só 1080p | 1080p-4k; sem AR | sim | 0,04 · 0,08 · 0,16 | — |
| lightricks/ltx-2-pro | {6,8,10} | 1080p-4k; sem AR | sim | 0,06 · 0,12 · 0,24 | — |
| openai/sora-2 | {4,8,12} | 720×1280 | NÃO VERIFICADO | 0,10 | `input_reference` precisa ter o AR do vídeo |
| openai/sora-2-pro | {4,8,12} | standard 720p / high 1024p | NÃO VERIFICADO | 0,30 · 0,50 | idem |
| vidu/q3-pro | **1-16 contínua** | 540p-1080p | sim (`audio`) | 540p 0,07 · 720p 0,15 · 1080p 0,16 | `start_image`, `end_image` |
| xai/grok-imagine-video-1.5 | 1-15 contínua | 480p, 720p | NÃO VERIFICADO | 0,08 | `image` **obrigatório** |
| prunaai/p-video | 1-20 contínua | 720p, 1080p | sim (`save_audio`) | 720p 0,02 · 1080p 0,04 (draft 0,005/0,01) | `audio` dita a duração |
| prunaai/p-video-2-pro-reference | 5-15 | 480p-4k (gera em 768p e amplia) | NÃO VERIFICADO | 768p 0,025-0,035 · 1080p 0,045-0,055 + referências | `image[]` ≤9, `first_frame_image`; base MiniMax H3 |
| lightricks/ltx-video · tencent/hunyuan-video | quadros, não segundos | ≤1280 px | não | sem tabela de preço (GPU) | gerações antigas: não adicionar |

### Templates propostos (`scene_i2v`)

| Modelo | `limits` | `input_template` | `required_inputs` |
|---|---|---|---|
| kwaivgi/kling-v4.0 | `{"duration_min":3,"duration_max":30,"resolutions":["720p","1080p"],"aspect_from":"image"}` | `{"prompt":"{{prompt}}","start_image":"{{keyframe_url}}","reference_images":"{{reference_urls}}","duration":"{{duration_int}}","resolution":"{{resolution}}"}` | `["prompt"]` |
| google/veo-3.1 | `{"durations":[4,6,8],"resolutions":["720p","1080p"],"aspect_ratios":["9:16"]}` | `{"prompt":"{{prompt}}","image":"{{keyframe_url}}","duration":"{{duration_int}}","resolution":"{{resolution}}","aspect_ratio":"9:16","negative_prompt":"{{negative_prompt}}","generate_audio":false}` | `["prompt"]` |
| google/veo-3.1-fast | idem | idem | `["prompt"]` |
| alibaba/wan-3 | `{"duration_min":2,"duration_max":30,"resolutions":["480p","720p","1080p"],"aspect_from":"image"}` | `{"prompt":"{{prompt}}","image":"{{keyframe_url}}","duration":"{{duration_int}}","resolution":"{{resolution}}","negative_prompt":"{{negative_prompt}}"}` | `["prompt"]` |
| bytedance/seedance-1.5-pro | `{"duration_min":2,"duration_max":12,"resolutions":["480p","720p","1080p"]}` | `{"prompt":"{{prompt}}","image":"{{keyframe_url}}","duration":"{{duration_int}}","resolution":"{{resolution}}","aspect_ratio":"9:16","generate_audio":false}` | `["prompt"]` |
| vidu/q3-pro | `{"duration_min":1,"duration_max":16,"resolutions":["540p","720p","1080p"]}` | `{"prompt":"{{prompt}}","start_image":"{{keyframe_url}}","duration":"{{duration_int}}","resolution":"{{resolution}}","aspect_ratio":"9:16","audio":false}` | `["prompt"]` |
| wan-video/wan-2.7-i2v | `{"duration_min":2,"duration_max":15,"resolutions":["720p","1080p"]}` | `{"prompt":"{{prompt}}","first_frame":"{{keyframe_url}}","duration":"{{duration_int}}","resolution":"{{resolution}}","negative_prompt":"{{negative_prompt}}"}` | `[]` |
| kwaivgi/kling-v3-video | `{"duration_min":3,"duration_max":15}` | `{"prompt":"{{prompt}}","start_image":"{{keyframe_url}}","duration":"{{duration_int}}","mode":"pro","aspect_ratio":"9:16","negative_prompt":"{{negative_prompt}}","generate_audio":false}` | `["prompt"]` |
| pixverse/pixverse-v6-max | `{"durations":[5,8,10,15],"resolutions":["720p","1080p"]}` | `{"prompt":"{{prompt}}","image":"{{keyframe_url}}","duration":"{{duration_int}}","quality":"{{resolution}}","aspect_ratio":"9:16","negative_prompt":"{{negative_prompt}}","generate_audio_switch":false}` | `["prompt"]` |
| lightricks/ltx-2.3-pro | `{"durations":[6,8,10],"resolutions":["1080p","2k","4k"]}` | `{"task":"image_to_video","prompt":"{{prompt}}","image":"{{keyframe_url}}","duration":"{{duration_int}}","resolution":"{{resolution}}","aspect_ratio":"9:16","generate_audio":false}` | `["prompt"]` |
| luma/ray-3.2 | `{"durations":[5],"resolutions":["540p","720p","1080p"]}` | `{"prompt":"{{prompt}}","start_image":"{{keyframe_url}}","duration":5,"resolution":"{{resolution}}"}` | `["prompt"]` |
| runwayml/gen-4.5 | `{"durations":[5,10]}` | `{"prompt":"{{prompt}}","image":"{{keyframe_url}}","duration":"{{duration_int}}","aspect_ratio":"9:16"}` | `["prompt"]` |
| prunaai/p-video | `{"duration_min":1,"duration_max":20,"resolutions":["720p","1080p"]}` | `{"prompt":"{{prompt}}","image":"{{keyframe_url}}","duration":"{{duration_int}}","resolution":"{{resolution}}","aspect_ratio":"9:16","save_audio":false}` | `["prompt"]` |

`cost` no formato do código, por exemplo kling-v4.0: `{"unit":"per_second","usd":0.235,"by_resolution":{"720p":0.157,"1080p":0.235}}`. Para Veo, use o preço sem áudio: `{"unit":"per_second","usd":0.20}`.

**Cenas com o rosto do apresentador:** hoje o Replicate só herda o rosto do keyframe (mapa §3.2). O kling-v4.0 aceita `start_image` e `reference_images` **juntos**: o keyframe vira o primeiro quadro e as fotos do avatar viram referência de personagem. O Seedance 2.0 não aceita os dois juntos. O Veo 3.1 aceita referências só em 16:9. Se o prompt precisa citar `@image_2…`: NÃO VERIFICADO.

---

## 2. Apresentador falante (`talking_avatar`)

A duração sai do áudio em todos (`duration_from:"audio"`).

| Modelo | Limite | Resoluções | Preço (US$/s) | `input_template` | `required_inputs` |
|---|---|---|---|---|---|
| **prunaai/p-video-2-pro-avatar** | áudio ≤3 min (4k ≤125 s) | 480p, 768p, 1080p, 2k, 4k (≥1080p = 768p ampliado) | 480p 0,02 · 768p 0,04 · 1080p 0,06 · 2k 0,08 · 4k 0,12 | `{"image":"{{keyframe_url}}","audio":"{{audio_url}}","resolution":"{{resolution}}","prompt":"{{prompt}}"}` | `["image"]` (marcar também `audio`) |
| bytedance/omni-human-1.5 | áudio **<35 s** (erro acima) | NÃO VERIFICADO | 0,16 | `{"image":"{{keyframe_url}}","audio":"{{audio_url}}","prompt":"{{prompt}}"}` | `["image","audio"]` |
| veed/fabric-1.0 (atual) | ≤60 s | 480p, 720p | 0,08 · 0,15 | (atual) | `["image","audio"]` |
| kwaivgi/kling-avatar-v2 | áudio ≤5 MB; duração NÃO VERIFICADA | NÃO VERIFICADO | std 0,056 · pro 0,11 | `{"image":"{{keyframe_url}}","audio":"{{audio_url}}","prompt":"{{prompt}}","mode":"pro"}` | `["image","audio"]` |
| prunaai/p-video-avatar (atual) | NÃO VERIFICADO | 720p, 1080p | 0,025 · 0,045 | (atual) | `["image"]` |
| bytedance/omni-human (atual) | qualidade cai >15 s | — | 0,14 | (atual) | `["image","audio"]` |
| wan-video/wan-2.2-s2v | NÃO VERIFICADO | NÃO VERIFICADO | 0,02 | `{"prompt":"{{prompt}}","image":"{{keyframe_url}}","audio":"{{audio_url}}"}` | `["prompt","image","audio"]` |

Limites propostos:
- p-video-2-pro-avatar: `{"duration_from":"audio","max_duration_s":180,"resolutions":["480p","768p","1080p","2k","4k"]}`.
- omni-human-1.5: `{"duration_from":"audio","max_duration_s":34}`.

---

## 3. Remake: estilo e cenário (`scene_v2v`)

| Modelo | Vídeo de entrada | Preço (US$/s) | Áudio original | `input_template` | `required_inputs` |
|---|---|---|---|---|---|
| **runwayml/aleph-2** (atual) | 2-30 s, <16 MB | 0,336 | NÃO VERIFICADO | (atual) `{"video":"{{video_url}}","prompt":"{{prompt}}"}` | `["prompt","video"]` |
| **kwaivgi/kling-v4.0** (`base_video`) | 3-30 s, ≤300 MB, 700-4553 px; mantém a duração | 720p 0,094 · 1080p 0,141 | NÃO VERIFICADO | `{"prompt":"{{prompt}}","base_video":"{{video_url}}","reference_images":"{{reference_urls}}","resolution":"{{resolution}}"}` | `["prompt"]` |
| wan-video/wan-2.7-videoedit | 2-10 s | 0,10 | `audio_setting:"origin"` mantém | `{"video":"{{video_url}}","prompt":"{{prompt}}","reference_image":"{{reference_url}}","resolution":"{{resolution}}","audio_setting":"origin"}` | `["video","prompt"]` |
| luma/modify-video | ≤30 s, ≤100 MB | US$ 0,019 por milhão de pixels de saída (9:16 1080p, 24 fps ≈ US$ 0,95/s, cálculo NÃO VERIFICADO) | NÃO VERIFICADO | `{"video":"{{video_url}}","prompt":"{{prompt}}","mode":"flex_1"}` | `[]` |
| kwaivgi/kling-v3-omni-video (`base`) | 3-10 s | pro 0,224 | `keep_original_sound` | `{"prompt":"{{prompt}}","reference_video":"{{video_url}}","video_reference_type":"base","mode":"pro","keep_original_sound":true}` | `["prompt"]` |
| runwayml/gen4-aleph | usa só 5 s | 0,18 | — | — | não adicionar |

Limites:
- kling-v4.0 (v2v): `{"duration_min":3,"duration_max":30,"max_bytes":314572800,"resolutions":["720p","1080p"]}`.
- wan-2.7-videoedit: `{"duration_min":2,"duration_max":10,"resolutions":["720p","1080p"]}`.

---

## 4. Remake: trocar pessoa (`person_swap`)

| Modelo | Preço (US$/s) | Notas | `input_template` | `required_inputs` |
|---|---|---|---|---|
| **prunaai/p-video-replace** (atual) | 720p 0,03 · 1080p 0,06 | 1-3 fotos; `save_audio` mantém a fala; duração máxima NÃO VERIFICADA | (atual) | `["video","images"]` |
| wan-video/wan-2.2-animate-replace | 480 0,02 · 720 0,05 | 1 foto; `merge_audio`; resolução `"720"` sem "p" (template fixo) | `{"video":"{{video_url}}","character_image":"{{reference_url}}","resolution":"720","merge_audio":true}` | `["video","character_image"]` |
| kwaivgi/kling-v4.0 (`base_video` + `reference_images`) | 1080p 0,141 | troca guiada por prompt; resultado NÃO VERIFICADO | igual à linha v2v de §3 | `["prompt"]` |
| bytedance/dreamactor-m2.0 · prunaai/p-video-animate | 0,05 · 0,03-0,06 | o inverso: anima a foto com o movimento do vídeo (o cenário vem da foto) | — | opção futura |

---

## 5. Fala: TTS (`tts`) e lipsync (`lipsync_post`)

**Atenção ao TTS:** o código calcula a duração por `bytes*8/bitrate`, então exige MP3 CBR com bitrate fixo. Só a família MiniMax expõe `bitrate`. Qualquer outro TTS precisa medir a duração de outro jeito antes de entrar como primário.

| Modelo | PT-BR | Voz própria | Preço | `input_template` | Nota |
|---|---|---|---|---|---|
| **minimax/speech-2.8-hd** | `language_boost: Portuguese` | sim, via `minimax/voice-cloning` (US$ 3 por voz, 10 s-5 min) | 0,10/1k **tokens** | (atual) | promover a primário |
| minimax/speech-2.8-turbo | idem | idem | 0,06/1k tokens | idem ao 2.8-hd | fallback barato |
| minimax/speech-02-hd (atual) | idem | idem | 0,10/1k tokens | (atual) | geração anterior |
| elevenlabs/v3 | `language_code:"pt"` | **não**: só 26 vozes fixas, sem `voice_id` livre | 0,10/1k chars | `{"prompt":"{{text}}","voice":"Sarah","language_code":"pt"}` | sem bitrate; o clone continua na API direta |
| elevenlabs/v2-multilingual · flash-v2.5 | idem | não | 0,10 · 0,05/1k chars | idem | — |
| qwen/qwen3-tts | `Portuguese` | **clone na hora** por `reference_audio` | 0,02/1k chars | `{"text":"{{text}}","mode":"voice_clone","reference_audio":"{{audio_url}}","language":"Portuguese"}` | serve para "a minha voz" sem plano ElevenLabs; qualidade NÃO VERIFICADA |
| inworld/realtime-tts-2 | `pt` | `voice_id` clonado | 0,025/1k chars; texto ≤2.000 | `{"text":"{{text}}","voice_id":"{{voice_id}}","language":"pt","audio_format":"mp3"}` | — |
| google/gemini-3.8-flash-tts | automático | não | 0,50/M tokens de entrada + 9/M de saída | `{"text":"{{text}}","voice":"Kore","output_format":"mp3"}` | 2 vozes |

| Lipsync | Preço (US$/s) | Notas | `input_template` |
|---|---|---|---|
| **heygen/lipsync-precision** | 0,0667 | o mesmo lipsync que o Remake usa hoje pela API HeyGen, agora no Replicate; `enable_dynamic_duration` | `{"video":"{{video_url}}","audio":"{{audio_url}}","enable_dynamic_duration":true}` |
| heygen/lipsync-speed | 0,0333 | idem, mais rápido | idem |
| sync/lipsync-2-pro | 0,08325 | áudio `.wav` (MP3 NÃO VERIFICADO) | `{"video":"{{video_url}}","audio":"{{audio_url}}","sync_mode":"cut_off"}` |
| sync/react-1 | 0,167 | refaz rosto ou cabeça com emoção (`model_mode`) | `{"video":"{{video_url}}","audio":"{{audio_url}}","model_mode":"face","emotion":"neutral","sync_mode":"cut_off"}` |
| sync/lipsync-2 (atual) | 0,05 | sem uso | (atual) |
| pixverse/lipsync | 0,04 | só video + audio | `{"video":"{{video_url}}","audio":"{{audio_url}}"}` |
| kwaivgi/kling-lip-sync | 0,014 | vídeo de 2-10 s; áudio <5 MB | `{"video_url":"{{video_url}}","audio_file":"{{audio_url}}"}` |

`required_inputs`: `["video","audio"]` em todos, exceto o kling-lip-sync, que fica com `[]`.

---

## 6. Legendas, trilha e utilitários

Nenhuma destas capabilities existe hoje no enum (`stt`, `music`): adicioná-las exige código.

| Uso | Modelo | Preço | Template | Nota |
|---|---|---|---|---|
| STT com tempo por palavra | **elevenlabs/scribe-v2** | US$ 0,003667/min (0,22/h) | `{"audio":"{{audio_url}}","language_code":"pt","timestamps_granularity":"word","tag_audio_events":false}` | substitui o `scribe_v1` deprecated (mapa §1, item 6) |
| STT | openai/gpt-4o-transcribe | 6/M tokens de entrada | `{"audio_file":"{{audio_url}}","language":"pt"}` | tempo por palavra NÃO VERIFICADO |
| STT | victor-upmeet/whisperx (community) | GPU | `{"audio_file":"{{audio_url}}","language":"pt","align_output":true}` | exige `version_hash` |
| Legenda queimada | fictions-ai/autocaption (community) | GPU | `{"video_file_input":"{{video_url}}","fontsize":4,"MaxChars":10}` | estilo fixo do modelo, diverge do DS |
| Trilha | elevenlabs/music | US$ 8,30/1.000 s; 5-300 s; instrumental | `{"prompt":"{{prompt}}","force_instrumental":true}` | `music_length_ms` pede ms: não há variável |
| Trilha | google/lyria-3 | US$ 0,04 por faixa | `{"prompt":"{{prompt}}"}` | duração NÃO VERIFICADA |
| Trilha | stability-ai/stable-audio-2.5 | US$ 0,20 por faixa; 1-190 s | `{"prompt":"{{prompt}}","duration":"{{duration_int}}"}` | — |
| Trilha com letra | minimax/music-2.5 | US$ 0,15 por faixa | `lyrics` obrigatório | fora do caso de uso |
| Som a partir do vídeo | zsxkib/mmaudio (community) | GPU | `{"video":"{{video_url}}","prompt":"{{prompt}}"}` | — |
| Upscale / normalização | bytedance/video-upscaler (atual) | 1080p ≤30 fps 0,0069/s; pro 0,069/s | (atual) | manter |
| Upscale | topazlabs/video-upscale | por crédito: 720p→1080p30 ≈ 0,093 a cada 5 s; →4K30 ≈ 0,373 a cada 5 s | `{"video":"{{video_url}}","target_resolution":"1080p","target_fps":30}` | top de qualidade, NÃO VERIFICADO |
| Reenquadrar para 9:16 | luma/reframe-video | 0,06/s; ≤10 s | `{"video":"{{video_url}}","aspect_ratio":"9:16"}` | útil para vídeo enviado em 16:9 |

---

## 7. Conclusão

### (a) Linhas a adicionar, por prioridade

1. `scene_i2v` **kwaivgi/kling-v4.0**: duração contínua 3-30, keyframe e fotos do avatar juntos, 1080p a 0,235/s.
2. `scene_v2v` **kwaivgi/kling-v4.0** (`base_video`): 3-30 s, até 300 MB, 1080p a 0,141/s (42% do Aleph).
3. `talking_avatar` **prunaai/p-video-2-pro-avatar**: até 3 min, 1080p a 0,06/s.
4. `lipsync_post` **heygen/lipsync-precision**: o mesmo motor do Remake, sem chave HeyGen separada.
5. `stt` (nova) **elevenlabs/scribe-v2**: tira as legendas do `scribe_v1` deprecated.
6. `scene_i2v` **google/veo-3.1**: opção cinema, 1080p, 0,20/s sem áudio, durações {4,6,8}.
7. `scene_i2v` **alibaba/wan-3**: econômico, 2-30 contínua, 1080p a 0,10/s.
8. `scene_i2v` **bytedance/seedance-1.5-pro**: substitui o 1-lite, 1080p a 0,06/s.
9. `talking_avatar` **bytedance/omni-human-1.5**: corpo e gesto, <35 s, 0,16/s.
10. `scene_v2v` **wan-video/wan-2.7-videoedit**: barato (0,10/s), clipes ≤10 s, mantém o áudio.
11. `lipsync_post` **sync/react-1**: top de expressão (0,167/s).
12. `tts` **minimax/speech-2.8-turbo** (fallback barato) e **qwen/qwen3-tts** (clone na hora; exige outro cálculo de duração).
13. `scene_i2v` google/veo-3.1-fast, vidu/q3-pro, kwaivgi/kling-v3-video, pixverse/pixverse-v6-max, lightricks/ltx-2.3-pro, runwayml/gen-4.5, luma/ray-3.2: variedade para "todos os top", sem primário.
14. `person_swap` wan-video/wan-2.2-animate-replace: fallback barato.
15. `music` (nova) elevenlabs/music ou stable-audio-2.5; `util_*` topazlabs/video-upscale e luma/reframe-video.

### (b) Linhas a aposentar (`active=false`)

| Linha | Motivo | Substituto |
|---|---|---|
| scene_i2v / scene_t2v bytedance/seedance-1-lite | mais caro e antigo que o 1.5-pro / 1-pro-fast | seedance-1.5-pro |
| scene_i2v kwaivgi/kling-v2.5-turbo-pro | só 5/10 s (sobram segundos mudos) | kling-v4.0 (fallback do seedance-2.0) |
| scene_i2v minimax/hailuo-2.3 | {6,10}, preso em 768p, cobrado por vídeo | wan-3 / seedance-1.5-pro |
| scene_t2v pixverse/pixverse-v6 | capability sem uso (nenhum `resolveModel('scene_t2v')`) | — (aposentar a capability ou ligá-la) |
| talking_avatar bytedance/omni-human | qualidade cai >15 s | omni-human-1.5 |
| talking_avatar prunaai/p-video-avatar | substituído pela v2 pro | p-video-2-pro-avatar |
| lipsync_post sync/lipsync-2 | sem uso; o pro e o HeyGen são superiores | heygen/lipsync-precision |
| tts minimax/speech-02-hd como primário | geração anterior, mesmo preço | speech-2.8-hd primário; 02-hd vira fallback |
| avatar_identity flux-kontext-pro | fallback inalcançável (mapa, defeito 14) | corrigir o código ou desativar |

### (c) Padrão e "top" por experiência

| Experiência | Padrão | Top | Econômico |
|---|---|---|---|
| Cenas (`scene_i2v`) | bytedance/seedance-2.0 em **720p** (0,18/s; hoje sai 1080p a 0,45/s) | kwaivgi/kling-v4.0 1080p (contínua, 0,235/s); google/veo-3.1 como alternativa cinema | alibaba/wan-3 1080p (0,10/s) |
| Apresentador nas cenas | kling-v4.0 com keyframe e fotos do avatar (cena); prunaai/p-video-2-pro-avatar 1080p (fala, 0,06/s) | bytedance/omni-human-1.5 (<35 s) ou veed/fabric-1.0 720p | p-video-2-pro-avatar 768p (0,04/s) |
| Remake estilo / cenário | kwaivgi/kling-v4.0 `base_video` 1080p (0,141/s) | runwayml/aleph-2 (0,336/s, <16 MB) | wan-video/wan-2.7-videoedit (≤10 s, 0,10/s) |
| Remake pessoa | prunaai/p-video-replace 1080p (0,06/s) | NÃO VERIFICADO: kling-v4.0 `base_video` + refs (teste A/B) | wan-2.2-animate-replace 720p (0,05/s) |
| Fala (TTS + lipsync) | minimax/speech-2.8-hd + heygen/lipsync-precision | ElevenLabs direto (voz própria; no Replicate não há clone) + sync/react-1 | speech-2.8-turbo + heygen/lipsync-speed |
| Legendas (STT) | elevenlabs/scribe-v2 (`pt`, por palavra) | idem (é o top) | openai/gpt-4o-transcribe |

---

## 8. Lacunas do template (exigem código)

- **Keyframe como array:** não há variável para enviar o keyframe como array (happyhorse `images[]`, p-video-2-pro-reference `image[]`). Criar `{{keyframe_urls}}` ou suportar `["{{keyframe_url}}"]`.
- **Resolução como `mode`:** a resolução não vira `mode` (Kling v3/O1: standard/pro/4k). Hoje só dá para fixar `mode` no template.
- **Duração da trilha:** não há `{{duration_ms}}` para `elevenlabs/music`.
- **Capabilities novas:** `stt` e `music` não existem no enum `VideoCapability`.
- **Duração do TTS:** TTS sem `bitrate` (ElevenLabs, Qwen, Gemini, Inworld) quebra o cálculo de duração.
- **Áudio do vídeo editado:** em kling-v4.0 `base_video` e em aleph-2, se o áudio original é mantido: NÃO VERIFICADO. Manter `util_audio_merge` com `duration_mode: video` depois.
