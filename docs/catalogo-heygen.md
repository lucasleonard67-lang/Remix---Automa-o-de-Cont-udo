# Catálogo HeyGen (API v3) para o Content Engine

Pesquisa feita em 29/10/2026 com a documentação oficial (`developers.heygen.com`, `llms.txt` e a spec OpenAPI `openapi/external-api.json`). **NÃO VERIFICADO** marca o que não aparece numa página oficial. O que o app já usa está em `supabase/functions/_shared/remake.ts` e em `docs/hub-de-video-mapa.md` §2.3.

## 0. Fatos que valem para tudo

| Tema | Fato oficial |
|---|---|
| Base / auth | `https://api.heygen.com`, header `X-Api-Key`. Verificar a chave com `GET /v3/users/me` (devolve plano e saldo). |
| **v1/v2 morrem em 01/11/2026** | Daqui a 3 dias. Toda chamada nova deve ser v3. O app hoje usa só v3, então nada a migrar. |
| Entrada de arquivo | União `{type:"url",url}` · `{type:"asset_id",asset_id}` · `{type:"base64",media_type,data}`. URL precisa ser pública. |
| Limites de entrada (`POST /v3/videos`) | Vídeo MP4/WebM ≤100 MB e <2K · imagem JPG/PNG ≤50 MB e <2K · áudio WAV/MP3 ≤50 MB. |
| Roteiro / áudio do avatar | Roteiro ≤**5.000 caracteres** · áudio ≤**10 min** · cena ≤30 min · ≤50 cenas por vídeo (studio). |
| Saída | 25 fps com avatar · 128–4096 px por lado · padrão 1080p. |
| Upload | `POST /v3/assets` ≤32 MB · acima disso `POST /v3/assets/direct-uploads` (vídeo até 200 MB). |
| Concorrência | Pay-As-You-Go: 10 jobs simultâneos (vídeos, traduções e Video Agent) · Enterprise: 20. Acima disso: `429` com `Retry-After`. |
| Taxas | Escrita 10/s · leitura 300/min · pesadas (TTS, upload) 30/min · polling 500/min. |
| Idempotência | Header `Idempotency-Key` (replay por 24 h) em create video, avatars, lipsync, tradução, template e brand kit. |
| Webhook | Por job: `callback_url` + `callback_id`. Global: `POST /v3/webhooks/endpoints` (devolve um `secret` para verificar a assinatura, mostrado uma vez só). Eventos: `avatar_video.success/fail`, `avatar_video_caption.*`, `video_translate.*`, `video_agent.*`, `instant_avatar.*` (twin), `photo_avatar_*`, `ai_clipping.*`, `proofread_creation.*`, `live_avatar.*`. Lipsync tem `callback_url`, mas **não tem evento próprio na lista** (NÃO VERIFICADO se dispara `avatar_video.*`). |
| URLs de resultado | Pré-assinadas e com validade curta. Baixar logo para o Storage ou chamar o GET de novo. |
| Preço | A tabela self-serve só existe em `platform.heygen.com/pricing`, uma página dinâmica que não deu para ler. **Todo valor em US$ abaixo é NÃO VERIFICADO** (vem de fontes de terceiros). Oficiais: tradução cobra pela duração **da origem**; erro `402 insufficient_credit` informa os créditos que faltam. |

## 1. Avatares: catálogo e criação

Modelo: um **grupo** (a pessoa/personagem) tem várias **looks**. O `id` da look é o `avatar_id` usado no vídeo.

| Capacidade | Endpoint | Usuário fornece | Sistema preenche | Limites | Status / webhook | Custo | Experiência |
|---|---|---|---|---|---|---|---|
| Avatares de estoque (públicos, "studio avatars", 500+) | `GET /v3/avatars/looks?ownership=public` (`avatar_type=studio_avatar`), `GET /v3/avatars` (grupos) | escolha visual | paginação `limit` ≤50, `token` | — | síncrono | listar é grátis (NÃO VERIFICADO) | "avatar da biblioteca apresenta" |
| Minhas looks | `GET /v3/avatars/looks?ownership=private&group_id=` · `GET /v3/avatars/looks/{id}` | — | ler `supported_api_engines`, `preview_image_url`, `status` | — | — | — | seletor "meus apresentadores" |
| **Digital Twin** (instant avatar a partir de vídeo) | `POST /v3/avatars` `type:"digital_twin"` | vídeo da pessoa | `name`, `file`, `avatar_group_id` (opcional) | 15–600 s (ideal ~2 min), lado maior 640–4096 px, mp4/webm, 1 pessoa olhando para a câmera, fala limpa e sem música | look `processing → completed/failed` (`GET /v3/avatars/looks/{id}`); webhook `instant_avatar.success/fail` | ~US$ 1 por avatar criado (NÃO VERIFICADO) | "meu avatar fala o roteiro" |
| Consentimento do twin | `POST /v3/avatars/{group_id}/consent` (`reroute_url` opcional) | a pessoa abre o link e grava a frase pela webcam | guardar o `url` (vale 24 h) | upload de vídeo de consentimento e dispensa: só Enterprise | **sem webhook**: polling de `GET /v3/avatars/{group_id}` (`consent_status` pending/accepted/rejected) | — | obrigatório antes do 1º render do twin |
| Voz clonada do twin | automática no create (`avatar_item.default_voice_id`) | — | guardar o voice_id; `PATCH /v3/avatars/{group_id}` `default_voice_id` | a voz não é apagada junto com o avatar | — | — | o twin fala com a própria voz |
| **Photo Avatar** (persistente) | `POST /v3/avatars` `type:"photo"` | 1 foto frontal, com luz uniforme, cabeça inteira e 1 pessoa | `name`, `file`, `avatar_group_id` | ver limites de imagem; sem etapa de consentimento (a responsabilidade é nossa) | look `processing → completed`; webhooks `photo_avatar_*` | ~US$ 1 por criação (NÃO VERIFICADO) | "foto vira apresentador" reutilizável |
| Avatar por prompt | `POST /v3/avatars` `type:"prompt"` | descrição | `prompt` ≤1.000, `reference_images` ≤3, `aspect_ratio` | personagem sintético | igual photo | NÃO VERIFICADO | "crie um apresentador para a marca" |
| Nova look (roupa/cenário) | `POST /v3/avatars` `type:"prompt"` + `avatar_id` existente · Look Packs: `GET /v3/avatars/look-templates` + `POST /v3/avatars/looks` | prompt ou pacote | `avatar_id`/grupo | — | igual photo | NÃO VERIFICADO | "mesmo apresentador, outro cenário" |
| Apagar | `DELETE /v3/avatars/{group_id}` · `DELETE /v3/avatars/looks/{id}` | — | apagar também os assets e a voz | irreversível | — | — | LGPD / remoção |

## 2. Gerar vídeo com avatar (`POST /v3/videos`, polling `GET /v3/videos/{id}`)

Status: `pending → processing → completed | failed` (`failure_code` + `failure_message`). Quando termina, devolve `video_url`, `captioned_video_url`, `subtitle_url`, `thumbnail_url`, `gif_url` e `duration`. Webhook: `avatar_video.success/fail`.

| `type` | Para quê | Obrigatório | Opcional útil | Limites | Custo (NÃO VERIFICADO) | Experiência |
|---|---|---|---|---|---|---|
| `avatar` | look (estoque, twin, photo ou prompt) fala um roteiro ou um áudio | `avatar_id` + (`script` + `voice_id`) **ou** `audio_url`/`audio_asset_id`. Sem `voice_id`, usa a voz padrão do grupo | `engine`, `aspect_ratio` (`9:16`, `1:1`, `4:5`, `5:4`, `16:9`, `auto`), `resolution` (720p/1080p/4k), `background` (cor ou imagem), `remove_background`, `output_format:"webm"` (alpha), `caption`, `voice_settings` (speed 0,5–1,5; pitch; locale; ElevenLabs stability/style), `motion_prompt`, `expressiveness`, `brand_glossary_id`, `callback_url` | roteiro ≤5.000; 4k só no Avatar III com twin/studio | Avatar IV photo ~US$ 0,05/s; twin ~US$ 0,0667/s; Avatar V ~US$ 0,0667–0,12/s | "avatar da biblioteca apresenta", "meu avatar fala o roteiro" |
| `image` (o app já usa) | anima uma imagem qualquer sem cadastrar avatar (só Avatar IV) | `image` | os mesmos de cima + `motion_prompt`, `expressiveness` (padrão `low`) | rosto humano visível | ~US$ 0,05/s | "foto que fala" (uso único) |
| `cinematic_avatar` | cena gerada por prompt com 1–3 looks como referência, **sem roteiro** | `prompt` (≤10.000), `avatar_id[]` (1–3) | `model` (`seedance_2` padrão, ou `heygen_video_1`), `references` (≤3 vídeos e ≤9 imagens), `duration` 4–15 s, 720p/1080p, 16:9/9:16/1:1 | 4–15 s | seedance: preço fixo por cena (oficial, sem valor); ~US$ 7 por vídeo (NÃO VERIFICADO) | "meu avatar numa cena de cinema" (B-roll) |
| `studio` | junta até 50 cenas (`avatar_video`, `image`, `video`) num vídeo | `scenes[]` | `aspect_ratio`, `caption`, `callback_url` | ≤30 min por cena | soma das cenas | roteiro longo dividido em blocos |

**Motores** (`engine.type`; ler antes `supported_api_engines` da look, senão dá `400`):

| Motor | Quando usar | Aceita | Não aceita |
|---|---|---|---|
| `avatar_iv` (padrão) | cobertura máxima, imagem qualquer | studio, twin, photo, image, prompt; `motion_prompt` e `expressiveness` só em photo/image | `motion_prompt` em twin |
| `avatar_v` | maior fidelidade, opt-in por look | twin, studio, photo elegíveis; `motion_prompt` (inclusive em twin), `reference_look_id`, `more_blinking` | `expressiveness`, imagem avulsa |
| `avatar_iii` | twin em 4K; photo com pipeline dedicado | twin/studio (4K), photo (1080p) | `motion_prompt`, `expressiveness`, imagem avulsa |

**Legendas:** em `/v3/videos`, `caption:{file_format:"srt"}` gera só o SRT em `subtitle_url`; `caption:{style:"default"}` também queima a legenda (`captioned_video_url`). `caption:true` dá erro em v3. Nos templates é `caption:true` mais `subtitles.preset_name`. Na tradução saem `srt_caption_url` e `vtt_caption_url`.

## 3. Vozes

| Capacidade | Endpoint | Usuário fornece | Sistema preenche | Limites | Custo | Experiência |
|---|---|---|---|---|---|---|
| Catálogo (300+) | `GET /v3/voices?type=public&language=&gender=&engine=` | escolha com o player (`preview_audio_url`) | filtro por idioma da marca | `limit` ≤100 | — | seletor de voz |
| Vozes clonadas | `GET /v3/voices?type=private` · `GET/DELETE /v3/voices/{id}` | — | — | — | — | "minha voz" |
| Clonar voz (catálogo) | `POST /v3/voices/clone` | áudio | `audio`, `voice_name` ≤100, `language`, `remove_background_noise` | NÃO VERIFICADO | NÃO VERIFICADO | voz da marca na HeyGen |
| HeyGen Voice instant clone (beta) | `POST /v3/models/audio/voices` `mode:"instant"` → `ACTIVE` em segundos | 1 gravação | `similarity` (`max` para o mais fiel), `language` | usa só os 3 primeiros minutos, ≤100 MiB, MP3/WAV | **grátis durante o beta** (oficial) | "minha voz" sem slot da ElevenLabs |
| Clone profissional (beta) | igual, `mode:"professional"` | 1–10 gravações, 20+ min | — | treino assíncrono | slot pago (oficial, sem valor) | voz premium |
| Desenhar voz | `POST /v3/voices` | descrição | `gender`, `locale` (`pt-BR`), `seed` | devolve até 3 vozes | NÃO VERIFICADO | "voz para o personagem" |
| TTS catálogo | `POST /v3/voices/speech` | texto | `voice_id`, `speed` 0,5–2, `language`, `engine` (`heygen_voice`, `starfish`, `elevenlabs` + `settings.model_id` como `eleven_v4`) | 1–5.000 caracteres; `<break time="1s"/>`; devolve URL, duração e timestamps por palavra | NÃO VERIFICADO | áudio para lipsync e narração |
| TTS de clone HeyGen Voice | `POST /v3/models/audio/tts` (e `/stream` SSE) | texto | `model:"heygen-voice-1-turbo-free"` é **grátis** (capacidade compartilhada, `429` possível) | 30 req/min | grátis (turbo-free) | pré-escuta barata |

**ElevenLabs:** a HeyGen oferece vozes do **próprio catálogo** com motor ElevenLabs (`engine:"elevenlabs"`, modelos `eleven_v4`, `eleven_v3`, `multilingual_v2`, `flash`, `turbo`), cobradas pela HeyGen. A doc v3 **não tem endpoint para conectar uma conta ElevenLabs ou importar um voice_id dela** (NÃO VERIFICADO se existe só no app web). O caminho que funciona hoje: gerar o áudio na ElevenLabs (o app já faz) e mandar `audio_url` para `/v3/videos` ou `/v3/lipsyncs`. Assim a voz da marca continua a mesma em todo o produto.

## 4. Vídeo por prompt, templates e marca

| Capacidade | Endpoint | Usuário fornece | Sistema preenche | Limites | Status / webhook | Custo | Experiência |
|---|---|---|---|---|---|---|---|
| **Video Agent** (prompt → vídeo pronto) | `POST /v3/video-agents` (substitui o v1 `/v1/video_agent/generate`) | ideia / prompt | `mode:"generate"`, `avatar_id`, `voice_id`, `style_id` (`GET /v3/video-agents/styles`), `brand_kit_id`, `brand_glossary_id`, `orientation` (portrait/landscape), `files[]` ≤20 (png/jpg/mp4/webm/mp3/wav/pdf), `incognito_mode` | prompt 1–10.000 caracteres; render leva 5–10× a duração final | sessão `thinking → generating → completed/failed` (`GET /v3/video-agents/{session_id}` dá o `video_id`), depois `GET /v3/videos/{id}`; webhook `video_agent.*` | NÃO VERIFICADO | "descreva o vídeo e receba pronto" |
| Video Agent em conversa | `mode:"chat"` + `POST /v3/video-agents/{id}` (mensagem/revisão), `/stop`; editar cenas: `GET /v3/videos/{id}/scenes` + `POST /v3/videos/{id}` | pedidos de ajuste | — | — | igual | NÃO VERIFICADO | "ajuste a cena 2" |
| Templates | `GET /v3/templates` (só os que têm variáveis) · `GET /v3/templates/{id}` · `POST /v3/templates/{id}` | textos e mídias das variáveis | `variables`, `scene_ids` (escolhe, reordena e repete cenas), `caption` + `subtitles.preset_name`, `dimension`, `fps` 25/30/60, `callback_url` | o template é criado no editor web (ou `POST /v3/templates` a partir de um vídeo) | `GET /v3/videos/{id}`; `avatar_video.*` | NÃO VERIFICADO | "formato fixo da marca, troca só o texto" |
| **Brand Kit a partir do site** | `POST /v3/brand-kits` · `GET/PATCH/DELETE /v3/brand-kits/{id}` | URL do site | `name`; corrigir papéis de cor via `PATCH` | site público sem login | `loading → completed/error`, poll a cada 2–5 s (<2 min); o id já serve no Video Agent enquanto carrega | NÃO VERIFICADO | marca aplicada sozinha (casa com a regra "auto brand pelo site") |
| Glossário de marca | `POST/GET/PATCH /v3/brand-glossaries` | termos | pronúncia e "não traduzir" | — | síncrono | — | nome da marca pronunciado certo |
| HeyGen Video (modelo) | `POST /v3/models/videos` (`text_to_video`, `image_to_video`, `reference_to_video`) | prompt (+ imagem) | — | clipes de 5–30 s, com som | `GET /v3/models/videos/{id}` | NÃO VERIFICADO | B-roll gerado (concorre com Replicate/Higgsfield) |

## 5. Edição de vídeo existente (já em uso ou próximos)

| Capacidade | Endpoint | Usuário fornece | Sistema preenche | Limites | Status / webhook | Custo | Experiência |
|---|---|---|---|---|---|---|---|
| Lipsync (em uso, `precision`) | `POST /v3/lipsyncs` | vídeo + áudio novo | `mode` speed/precision, `keep_the_same_format`, `start_time`/`end_time` (trecho), `enable_speech_enhancement`, `disable_music_track` | NÃO VERIFICADO (valem os limites gerais de mídia) | `pending → running → completed/failed` (`GET /v3/lipsyncs/{id}`); `callback_url` | precision ~US$ 0,0667/s (NÃO VERIFICADO) | "troque o que eu falei" |
| Tradução (em uso, `speed`) | `POST /v3/video-translations` · idiomas: `GET /v3/video-translations/languages` | vídeo + idiomas | `output_languages[]` (vários de uma vez, 1 id por idioma), `mode` speed/precision, `speaker_num`, `translate_audio_only`, `brand_glossary_id`, `srt` próprio | 175+ idiomas; voz de estoque só Enterprise | `GET /v3/video-translations/{id}` dá `srt_caption_url`/`vtt_caption_url`; `video_translate.*` | cobra pela duração da origem (oficial); valor NÃO VERIFICADO | "meu vídeo em inglês com a minha voz" |
| Revisão da tradução | `POST /v3/video-translations/proofreads` → baixar/subir SRT → `/generate` | corrige o texto | — | speed e precision | `proofread_creation.*` | gera só depois de aprovar | "revise antes de pagar o render" |
| AI Clipping | `POST /v3/ai-clipping` | vídeo longo | `duration_types` (`30`, `60`, `180`, `long`), `aspect_ratio` (padrão portrait), `prompt` ≤500 | — | `ai_clipping.*` | ~US$ 0,15/clipe (NÃO VERIFICADO) | "corte o podcast em Reels" |
| Remover palavras de preenchimento | `POST /v3/filler-word-removals` | vídeo | — | NÃO VERIFICADO | GET por id | NÃO VERIFICADO | "tire os 'éé'" |
| Remover fundo | `POST /v3/background-removals` | vídeo | — | NÃO VERIFICADO | GET por id | NÃO VERIFICADO | apresentador sobre o layout da marca |

## 6. Tempo real (baixa prioridade)

| Capacidade | Endpoint | Nota |
|---|---|---|
| LiveAvatar (conversa) | API separada em `docs.liveavatar.com` (modos FULL e LITE; o LITE tem plugin de ElevenLabs Agent) | Fora do escopo de vídeo social. |
| Avatar Realtime (streaming de texto) | `POST /v3/avatar-realtime`, `/{stream_id}/text`, `/words`, `/cancel` | Existe na spec; uso e preço NÃO VERIFICADOS. |

## 7. Recomendação: as 5 primeiras a ligar

Critério: maior ganho de demo de vendas com o menor número de campos. O lipsync e a tradução já estão no ar e ficam como estão.

| # | Capacidade | Endpoints | A UI pede **só** | O sistema preenche |
|---|---|---|---|---|
| 1 | **Avatar da biblioteca apresenta o roteiro** | `GET /v3/avatars/looks?ownership=public` → `POST /v3/videos` `type:"avatar"` → poll/webhook | 1) apresentador (grade de fotos) · 2) roteiro (contador até 5.000) | voz: áudio ElevenLabs da marca como `audio_url` (ou `voice_id` pt-BR do catálogo), `aspect_ratio` pelo destino (9:16 para Reels), `resolution:"1080p"`, `caption:{file_format:"srt", style:"default"}`, `callback_url` |
| 2 | **Foto vira apresentador (persistente)** | `POST /v3/avatars` `type:"photo"` (uma vez) → poll da look → `POST /v3/videos` `type:"avatar"` | 1) foto (só no cadastro) · 2) roteiro | `name`, `engine` (`avatar_v` se estiver em `supported_api_engines`, senão `avatar_iv`), `motion_prompt` neutro, `expressiveness:"medium"`, voz da marca, formato e legenda como no #1. Substitui o `type:"image"` avulso quando a pessoa já está cadastrada. |
| 3 | **Meu avatar (Digital Twin) fala o roteiro** | `POST /v3/assets/direct-uploads` → `POST /v3/avatars` `type:"digital_twin"` → `POST /v3/avatars/{group_id}/consent` → poll de look e grupo → `POST /v3/videos` | Cadastro: 1) vídeo de ~2 min falando · 2) gravar o consentimento pelo link. Depois, por vídeo: só o roteiro | `name`, upload, `default_voice_id` clonado (ou o áudio ElevenLabs), engine, formato, legenda. Bloquear "Gerar" até a look estar `completed` **e** `consent_status:"accepted"` (com saída clara: "reenviar link"). |
| 4 | **Video Agent: ideia vira vídeo** | `POST /v3/video-agents` `mode:"generate"` → `GET /v3/video-agents/{id}` → `GET /v3/videos/{id}` | 1) ideia em uma frase ou mais | `avatar_id` (o padrão da marca: twin, photo ou estoque), `voice_id`, `brand_kit_id` (#5), `orientation:"portrait"`, `files` (logo e fotos da marca já no app), `callback_url` |
| 5 | **Brand Kit automático do site** | `POST /v3/brand-kits` → poll até `completed` | nada; usa a URL do site que a marca já cadastrou (se não houver: 1 campo "site") | `name`; guardar `brand_kit_id` na marca; criar o `brand_glossary` com o nome da marca para a pronúncia sair certa |

Infra comum às 5 (sem UI): um endpoint de webhook (`POST /v3/webhooks/endpoints`, guardar o `secret` no Vault) em vez de polling de 1 em 1 minuto; `Idempotency-Key` = id do job; baixar `video_url` para o Storage assim que terminar; mostrar o custo estimado antes de "Gerar", conforme a regra do produto. Os preços acima são **NÃO VERIFICADOS**: conferir no painel `platform.heygen.com/pricing` com a conta logada antes de exibir valores.

## Qualidade da voz (consultado em 30/10/2026)

Fontes: [Create Video](https://developers.heygen.com/reference/create-video), [Text to Speech](https://developers.heygen.com/docs/voices/heygen-voice-speech), [Generate Model Speech](https://developers.heygen.com/reference/generate-model-speech), [HeyGen Voice](https://developers.heygen.com/docs/models/heygen-voice), [Instant Clone](https://developers.heygen.com/docs/voices/heygen-voice-instant-clone), [Professional Clone](https://developers.heygen.com/docs/voices/professional-voice-clone), [Third Party Speech](https://developers.heygen.com/docs/voices/speech), [List Voices](https://developers.heygen.com/reference/list-voices).

| Caminho | Quem usa | O que dá para ajustar |
| --- | --- | --- |
| `POST /v3/videos` com `script` + `voice_id` | voz da HeyGen e clone da conta | `voice_settings`: `speed` 0,5–1,5, `pitch` −50 a 50, `volume` 0–1, `locale`, `engine_settings`. Não vale com `audio_url` |
| `engine_settings` `elevenlabs` | voz com esse motor | `model` (`eleven_multilingual_v2`, `eleven_turbo_v2_5`, `eleven_flash_v2_5`, `eleven_v3`, `eleven_v4`), `stability`, `similarity_boost`, `style`, `use_speaker_boost` |
| `engine_settings` `fish` | voz com esse motor | `model` (`s2-pro`, `s2.1-pro`; `s1` sai em 15/11/2026), `stability`, `similarity` |
| `engine_settings` `starfish` | voz com esse motor | só força o motor. `engine_type` diferente do motor da voz é recusado |
| `POST /v3/models/audio/tts`, clone instantâneo | `brand_voices` com `source: clone` | `expressiveness_boost` 0–1 (padrão 1,0), `model`, `output_format`. `seed`, `speed` e pitch são ignorados |
| `POST /v3/models/audio/tts`, clone profissional | não usamos | `seed`, `speed` 0,75–1,25, `pitch_shift` ±4, `pitch_variance` 0,5–2, `<break>`. Recusa `expressiveness_boost` |
| `POST /v3/voices/speech` | catálogo | `engine` (`orca`, `starfish`, `elevenlabs` + `settings.model_id`), `speed` 0,5–2, `language`, `locale`. Clones HeyGen Voice não usam este endpoint |

- **Clone instantâneo:** `similarity` `medium`, `high`, `extra_high` (padrão) ou `max`; `remove_background_noise` padrão `true`; 1 a 3 min de fala limpa; não retreina, mudar exige outro clone.
- **Clone profissional:** "highest-fidelity clone", 1 a 10 gravações com 20+ min no total. Conta precisa estar habilitada e ter slot comprado.
- **Formato do TTS:** sem `output_format`, WAV mono 44,1 kHz. MP3 aceita até 192 kbps a 44,1 kHz.
- **Recomendação oficial:** `similarity: max` + `expressiveness_boost: 0.5` para a voz mais próxima do original (padrão do Studio). Os padrões da API (`extra_high` + 1,0) lideraram o ranking da Artificial Analysis, então não há opção melhor em todos os casos.
- **Preço:** a doc não publica valor por caractere ou minuto. Instantâneo: grátis no preview, conta na cota de clones. `heygen-voice-1-turbo-free`: grátis até 30/11/2026, sem garantia de disponibilidade. Profissional: slot pago, 5 treinos por mês.
