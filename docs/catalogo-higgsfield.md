# Catálogo Higgsfield: modelos, ferramentas e o que ligar no app

Data: 2026-10-29. Pesquisa feita sem alterar código. Complementa `docs/hub-de-video-mapa.md` §2.2.

**Fontes oficiais usadas:**

| Sigla | Fonte | Data |
|---|---|---|
| **CLI** | `github.com/higgsfield-ai/cli`, arquivo `MODELS.md`. É gerado de `higgsfield model list` / `model get`. | commit de 2026-10-17 |
| **SK** | `github.com/higgsfield-ai/skills`, arquivos `higgsfield-generate/references/model-catalog.md`, `media-inputs.md` e `workflows.md` (v0.14.0). Diz que segue a mesma lógica de mídia do MCP. | commit de 2026-10-27 |
| **API** | `docs.higgsfield.ai/docs/llms-full.txt` e `openapi.json`: API REST `api.higgsfield.ai` | baixado em 2026-10-29 |
| **BLOG** | `higgsfield.ai/blog/Generate-AI-Videos-From-Claude-with-Higgsfield-MCP` | — |

**Códigos do app:**
- **DA** = `supabase/functions/director-advance/index.ts`
- **MC** = `supabase/functions/_shared/hf-mcp.ts`
- **DP** = `supabase/functions/director-publish/index.ts`

**Regra de identificador.** Os IDs do MCP (`cinematic_studio_3_0`) são os mesmos *job set types* da CLI. A API REST usa outros IDs (`bytedance/seedance-2.5/...`) e outra autenticação (`Key id:secret`). Não há doc pública do schema das tools do MCP. Por isso, ID de MCP marcado ✔ significa "existe na CLI ou no SK, o mesmo backend do MCP". A presença na conta OAuth do app continua NÃO VERIFICADA até uma consulta ao `models_explore`.

---

## 1. Como o app usa o MCP hoje

| Tool MCP | Onde | Argumentos usados |
|---|---|---|
| `initialize` + `notifications/initialized` | MC:155-162 | protocolo `2025-03-26` |
| `generate_image` | DA:1219 | `{params:{model, aspect_ratio, count, resolution, prompt, medias:[{value, role:'image_references'}]}}` |
| `generate_video` | DA:1367, 1373, 1494 | `{params:{model, aspect_ratio, duration, prompt, medias:[{value, role:'start_image'│'audio_references'}], ...extra}}` |
| `job_status` | MC:200 | `{jobId, sync:false}`. A URL é extraída por regex `png│mp4│webp│jpg` (MC:13). |
| `balance` | MC:211 | lê `Credits: N` |
| `media_upload` + `media_confirm` | MC:216-228 | upload de áudio por PUT |
| `media_import_url` | MC:232 | `{url, type: image│video│audio}` |
| `show_reference_elements` | DA:1839, 1857 | `create` (nome ≤32, 1-3 fotos) e `get` |
| `sandbox_exec` | DA:1716-1809, 2511, 2542 | ffmpeg, comando ≤16k caracteres |
| `models_explore` | DP:66-74 | `{action:'search' (padrão), query, model_id, type, limit}` |
| `tiktok_*` (6 tools) | director-publish | publicação |

`hfGenerate` (MC:184-194) reenvia com `declined_preset_id` quando o MCP sugere um preset.

## 2. Listar modelos em runtime, sem hardcode

O MCP **expõe `models_explore`**, e o app já o chama em DP (`action:'models'`). Porém:

- O resultado só é repassado cru (`raw`, cortado em 20k caracteres) e **ninguém o consome**. O Diretor usa `HF_MODEL_DEFAULTS` mais `director_state.hf_models` e a lista fixa `HF_USER_MODELS` (DA:100-140).
- `MC` **não chama `tools/list`**. Só o servidor MCP do próprio app responde `tools/list` (`mcp-server/index.ts:295`).
- NÃO VERIFICADO: o formato da resposta de `models_explore` e os valores aceitos em `action` além de `search` (DP sugere `model_id`, o que indica um `get` com schema) e em `type`.
- Na CLI, o equivalente é `model list` / `model get <id>`. Os IDs Cinema Studio **não aparecem** em `model list`, só em `model get` (SK). Uma busca genérica pode não trazê-los.

**Proposta:** um tick diário chama `models_explore` (`search` por `type` image e video, depois `get` por id), grava em `director_state.hf_catalog` e o portão de modelos lê dali. Antes, é preciso rodar uma vez e salvar a resposta real em `docs/` para fixar o parser.

---

## 3. Vídeo (MCP / CLI)

Mídia vai em `medias[].role`. "Duração" é em segundos. ✔ = ID confirmado em CLI/SK. Cada ID está na conta? NÃO VERIFICADO, salvo os 2 em uso.

| ID MCP | Modelo | Mídia aceita | Duração | Resolução / aspecto | Áudio | Experiência que habilita |
|---|---|---|---|---|---|---|
| `seedance_2_5` ✔ (SK) | Seedance 2.5, o padrão oficial | `start_image`, `end_image`, `image_references`, `video_references`, `audio_references`. Modos `t2v`, `omni_reference`, `video_edit`, `video_extension` | 4-30 | 480p/720p/1080p | nativo; áudio de referência para lipsync | Diretor (cenas mais longas, menos cortes), CTA com fala sincronizada, Remake (editar e estender) |
| `seedance_2_0` ✔ | Seedance 2.0 | `image`, `start/end_image`, até 9 imagens, 3 vídeos, 3 áudios (máx. 12) | inteiro, padrão 5 (API: 4-15) | 480p-**4k**; modo `fast` só até 720p | `generate_audio` (padrão on) | Vídeo em 4K |
| `seedance_2_0_mini` ✔ | Seedance 2.0 Mini | igual ao 2.0 | inteiro | 480p/720p | sim | Rascunho barato |
| `seedance1_5` ✔ | Seedance 1.5 Pro | `start_image`, `end_image` | 4/8/12 | 480p-1080p | sim | Opção econômica |
| `cinematic_studio_video_4_0` ✔ (SK; ausente no MODELS.md de 17/10) | Cinema Studio 4.0 | `start/end_image` (só `omni_reference`), até 30 `image_references`, vídeo e áudio de referência | NÃO VERIFICADO no MCP (API REST: 4-30) | 480p-1080p; auto/21:9/16:9/4:3/1:1/3:4/9:16; câmera, lente, luz, gênero, paleta | nativo, padrão on | Substituto do 3.0 no Diretor |
| `cinematic_studio_3_0` ✔ **em uso** | Cinema Studio 3.0 | `start/end_image`, imagem, vídeo e **áudio de referência** (máx. 15 no total) | inteiro, padrão 5 (código: 4-15) | 480p-**4k**; `genre`, `speedramp`, `multi_shots`, `preset_id` | `generate_audio` | Vídeo principal do Diretor |
| `cinematic_studio_video_3_5` ✔ | Cinema Studio Video 3.5 | igual ao 3.0 (máx. 15) | padrão 15 | 480p-1080p; `camera_style`, `color_grading`, `light_scheme` | sim | Alternativa com grade de cor pronta |
| `cinematic_studio_video_v2` ✔ **em uso** | Cinema Studio Video V2 | `start/end_image`, `image_references`, `kling_element_ids` | inteiro, padrão 5 (código: 12) | 16:9/9:16/1:1/4:3/3:4; modo std/pro | `sound` on/off | A/B do Diretor |
| `cinematic_studio_video` ✔ | Cinema Studio Video v1 | `start/end_image` | 5/10 | — | `sound` | Legado, não ligar |
| `kling3_0` ✔ | Kling 3.0 | `start_image`, `end_image` | inteiro (API: 3-15) | std/pro/4k; 16:9/9:16/1:1 | `sound` | Opção de custo menor |
| `kling3_0_turbo` ✔ | Kling 3.0 Turbo | `start_image` | inteiro (API: 3-15) | 720p/1080p | não | Rascunho rápido |
| `kling2_6` ✔ | Kling 2.6 | `start_image` | 5/10 | 16:9/9:16/1:1 | `sound` | Legado |
| `kling_video_edit` ✔ (SK, sem perfil) | Kling video edit | NÃO VERIFICADO | — | — | — | Remake (editar trecho) |
| `veo3_1` ✔ | Veo 3.1 | `start_image` | 4/6/8 | 16:9/9:16; qualidade basic/high/ultra | — | Realismo máximo em clipe curto |
| `veo3_1_lite` ✔ | Veo 3.1 Lite | `start/end_image` (8 s se usar as duas) | 4/6/8 | 16:9/9:16/auto | `generate_audio` | Volume barato |
| `veo3` ✔ | Veo 3 | `start_image` (obrigatória) | — | 16:9/9:16 | — | Legado |
| `gemini_omni` / `gemini_omni_flash_1_1` ✔ | Gemini Omni Flash | até 7 `image_references` e 1 `video_references` | 4/6/8/10 | 720p; 16:9/9:16 | nativo (1.1) | Vídeo guiado por referências |
| `minimax_hailuo` ✔ | Hailuo 2.3 e variantes | `start/end_image` | 6/10 (1080p só em 6 s) | 512/768/1080 | não | Física barata |
| `minimax_h3`, `minimax_h3_max` ✔ (SK, sem perfil) | MiniMax H3 | NÃO VERIFICADO (API: até 9 imagens, 3 vídeos, 3 áudios) | API: 5-15 | API: 2K fixo | — | — |
| `wan2_7` ✔ | Wan 2.7 | `start/end_image`, 1 áudio | inteiro (API: 2-15) | 720p/1080p | áudio que conduz a cena | Personagem falando a partir de áudio |
| `wan2_6` ✔ | Wan 2.6 | imagem, vídeo e áudio de referência | 5/10/15 | 720p/1080p | sim | Estilizado barato |
| `wan3_0`, `wan3_0_prime` ✔ (SK, sem perfil) | Wan 3.0 | NÃO VERIFICADO (API: até 10 imagens, 5 vídeos, 5 áudios, documento ou link) | API: 2-30 | API: 480p-1080p | sim | — |
| `grok_video_v15` ✔ | Grok Video 1.5 | `start_image` (obrigatória) | inteiro (SK: 2-15) | 480p/720p | — | Estilizado |
| `grok_video` ✔ | Grok Video | `start_image` | inteiro | 16:9/9:16/1:1 | — | — |
| `happy_horse_video`, `flux_3_video`, `flux_3_video_edit` ✔ (SK, sem perfil) | — | NÃO VERIFICADO | — | — | — | — |
| `marketing_studio_video` ✔ | Marketing Studio | `image`, `start/end_image`, mais `avatars`/`avatar_ids`, `product_ids`, `web_product_ids`, `hook_id`, `setting_id`, `ad_reference_id`, `storyboard_id` | padrão 15, ≥4 | 480p-1080p; `mode` (ugc etc.) | `generate_audio` | **Anúncio/UGC a partir da URL do produto** (Click-to-Ad) |

## 4. Imagem (MCP / CLI)

| ID MCP | Modelo | Mídia | Resolução / aspecto | Experiência |
|---|---|---|---|---|
| `cinematic_studio_2_5` ✔ **em uso** | Cinema Studio Image 2.5 | até 14 `image_references` | 1k/2k/4k; `batch_size`; `mode` | Keyframe do Diretor |
| `nano_banana_2` ✔ | Nano Banana **Pro** (alias) | até 14 refs | 1k/2k/4k | Keyframe com fidelidade de rosto e produto |
| `nano_banana_flash` ✔ | Nano Banana 2 | refs repetidas | 1k/2k/4k | Edição rápida |
| `nano_banana_2_lite`, `nano_banana` ✔ | Lite / v1 | até 14 / 8 refs | 1k | Rascunho |
| `gpt_image_2_5` ✔ | GPT Image 2.5, padrão oficial | até 16 refs; variante flare/sunburst | 1k-4k; qualidade low…max | Capas, slides e texto na imagem (carrossel) |
| `gpt_image_2` ✔ | GPT Image 2 | refs; `mask`/inpaint | 1k-4k | Edição pontual |
| `text2image_soul_v2` ✔ | Soul 2.0 | 1 ref **ou** `--soul-id`; `style_id` | 1.5k/2k | Apresentador consistente (UGC, editorial) |
| `soul_cinematic` ✔ | Soul Cinema | 1 ref ou soul-id | 1.5k/2k; +21:9 | Keyframe cinematográfico com a mesma pessoa |
| `soul_cinema_studio` ✔ (SK) | Soul Cinema Studio | `style_id`, `enhance_prompt` | — | — |
| `soul_location` ✔ | Soul Location | só prompt | depende do aspecto | Cenário sem pessoa |
| `soul_cast` ✔ | Soul Cast | só prompt | só 16:9 | Não serve para 9:16 |
| `seedream_v5_pro` ✔ (SK), `seedream_v5_lite`, `seedream_v4_5` ✔ | Seedream | até 10-14 refs | 1k/1.5k/2k | Rosto a partir de fotos, character sheet |
| `marketing_studio_image` ✔ | Marketing Studio Image | até 14 refs, mais avatares e produtos | 1k-4k | Anúncio estático |
| `flux_2`, `flux_kontext`, `kling_omni_image`, `grok_image`, `openai_hazel`, `recraft_v4_1`, `z_image`, `image_auto` ✔ | vários | — | — | Recraft: logo/vetor. Z Image: rascunho. Resto: opcional. |
| `outpaint`, `image_background_remover` ✔ | utilitários | exatamente 1 imagem | — | Estender quadro para 9:16, recorte |

## 5. Áudio, voz e utilitários (MCP / CLI)

| ID / workflow | O que faz | Entradas | Experiência |
|---|---|---|---|
| `text2speech_v2` ✔ | TTS com engines `elevenlabs`, `minimax`, `seed_speech`, `vibe_voice`, `cozy_voice` | `prompt` (5k-15k caracteres conforme engine), `voice_id`, `voice_type` (preset│element) | Narração sem chave ElevenLabs própria |
| `seed_audio` ✔ | Áudio, voz, SFX e música | `prompt`, voz opcional, ≤2 áudios de referência | Trilha e SFX |
| `sonilo_music`, `mirelo_text_to_audio` ✔ | Música e SFX | `prompt`, `duration` | Trilha de fundo |
| `inworld_text_to_speech` ✔ | TTS | `prompt`, `voice` (113 vozes) | — |
| `speech2text` ✔ (só nome; schema NÃO VERIFICADO) | Transcrição | NÃO VERIFICADO | Substituir `scribe_v1` (deprecated) nas legendas |
| `video_upscale`, `bytedance_video_upscale`, `topaz_video`, `bytedance_image_upscale`, `topaz_image`, `video_deflicker`, `color_grading_lut` ✔ (só nome) | Upscale e tratamento | NÃO VERIFICADO | Remake: melhorar vídeo enviado |
| `video_background_remover` ✔ | Recorte de vídeo | 1 vídeo | Apresentador sobre fundo |
| `brain_activity` ✔ | Virality Predictor: nota de hook e retenção | 1 vídeo; retorna **texto** | Nota antes de publicar |
| workflow `reframe` (CLI) | Muda o aspecto do vídeo | vídeo, `aspect_ratio`, `resolution`, `mode` std/pro | Remake: 16:9 → 9:16 |
| workflow `draw_to_video` (CLI) | Edita o vídeo a partir de um quadro rabiscado | vídeo, sketch, timestamp, prompt | — |
| workflows `dubbing`, `voice-change` (CLI) | Dublagem e troca de voz | vídeo, idioma ou voz | Tradução de vídeo |
| `show_reference_elements` **em uso** | Element (personagem) | nome, 1-3 fotos | Apresentador do Diretor |
| `show_marketing_studio` (SK, ação `fetch`) | Importa produto por URL | `url` | Click-to-Ad |

**Workflows pelo MCP:** NÃO VERIFICADO. A CLI usa `generate workflow`; o nome da tool MCP equivalente é desconhecido.

**Não encontrados como ID em CLI, SK ou API:**
- Speak / Lipsync Studio / avatar falante (existe como produto web em `higgsfield.ai/lipsync-studio`)
- Sora 2 (existe no site)
- Kling Motion Control como ID MCP

Tudo isso fica NÃO VERIFICADO no MCP. O lipsync oficial pelo MCP é o **áudio de referência** em `seedance_2_5` / `seedance_2_0` (SK: "reference audio (lipsync)").

## 6. API REST (outra superfície, outra autenticação)

Só vale se o app voltar a usar `HIGGSFIELD_API_ID/SECRET` (docs/10). Há 83 endpoints. Os que não existem no MCP/CLI:

| Endpoint REST | Entradas-chave | Limites |
|---|---|---|
| `kling-video/v3/motion-control/{std,pro}`, `kling-video/motion-control/{std,pro}` (2.6) | `image_url`, `video_url`, `character_orientation`, `keep_original_sound` | vídeo de movimento de 3-30 s; saída com a duração da fonte |
| `higgsfield/genjutsu/{motion-transfer,object-swap,restyle}/v1.0` | `video_url`, `image_urls` (1-8), `preset_id` (restyle) | fonte de 4-30 s; até 1080p. Restyle ≈ US$ 0,318 / 0,681 / 1,632 por segundo (480p/720p/1080p) |
| `bytedance/seedance-2.5/{text,image,reference}-to-video`, `/video-edit`, `/video-extend` | URLs públicas | 4-30 s, ≤1080p, ≤30 imagens, 10 vídeos e 10 áudios |
| `higgsfield/cinema-studio/4.0` | `image_urls` ≤30, `video_urls` ≤10, `audio_urls` ≤10, controles de câmera | 4-30 s, **480p/720p** |
| `higgsfield/ads-studio/v1.0` | `prompt`, `niche`, `target_audience`, `batch_size` 1-8 | imagens 2k; ≈ US$ 0,084 por imagem |
| `POST /v1/custom-references` (Soul ID) | `name`, `model_version` v1│v2│cinema, 1-100 imagens | treino assíncrono |
| `POST /estimate/{endpoint}` | mesmo corpo da geração | devolve `usd` |

## 7. Custo

| Item | Valor | Fonte |
|---|---|---|
| Seedance 2.5, 720p, 10 s | 70 créditos (≈ US$ 3,43) | BLOG |
| Seedance 2.5, 1080p, 10 s | 160 créditos (≈ US$ 7,84) | BLOG |
| Conversão | US$ 49 = 1.000 créditos | BLOG |
| Demais modelos MCP | NÃO VERIFICADO | — |
| Falha ou NSFW | não cobra | API FAQ |
| Upscale | sem preço prévio | BLOG |

Sobre a estimativa de custo antes de gerar:
- A CLI estima com `higgsfield generate cost <id> ...`.
- A API REST estima com `/estimate/...`.
- **Uma tool de custo no MCP: NÃO VERIFICADO.** O app hoje só lê `balance`.

A regra "mostrar custo antes do Gerar" precisa dessa tool, ou de uma tabela medida pelo delta de `balance` por job.

## 8. Divergências código × catálogo oficial

1. **DA:83-84 diz que Cinema Studio "NÃO aceita" `audio_references`.** A CLI lista `--audio-references` em `cinematic_studio_3_0` e `cinematic_studio_video_3_5`. Vale testar um job com áudio e `cta_audio_ref:true` antes de concluir.
2. **Os limites de `cinematic_studio_3_0` são mais amplos que os do código.** O código usa resolução 1080p fixa e 4-15 s. A CLI aceita resolução até 4k; a duração é só "inteiro", com teto NÃO VERIFICADO.
3. **`MEDIA_URL_RE` (MC:13) só reconhece png, mp4, webp e jpg.** Saídas wav/mp3 (TTS), texto (`brain_activity`) e glb fariam `hfCheck` lançar "completed sem url".
4. **DA:81 registra que Seedance, Kling e MiniMax sumiram em 2026-08-26.** Os catálogos oficiais de outubro os listam de novo. A presença na conta do app está NÃO VERIFICADA: rodar `models_explore` antes de ligar.

---

## 9. Recomendação: o que ligar, em ordem

Princípio da tela: o sistema preenche aspecto (9:16), mídias, prompt e referências. A pessoa só decide o que muda o resultado ou o custo.

| # | O que ligar | Por quê | A UI pede | O sistema preenche |
|---|---|---|---|---|
| 1 | **Catálogo vivo:** `models_explore` → `director_state.hf_catalog`, com o portão lendo dele | Sem isso, cada modelo novo é hardcode e quebra quando o catálogo gira | nada | lista, limites e preço medido |
| 2 | **`seedance_2_5` como motor de vídeo do Diretor** (modo `omni_reference`) | Padrão oficial; 4-30 s reduz cortes; `audio_references` dá lipsync no CTA | **Duração** (4-30, pré-preenchida pelo roteiro) · **Qualidade** 720p/1080p (padrão 720p, mostrando créditos) | `start_image` = keyframe, `audio_references` = fala no CTA, `generate_audio:false`, 9:16 |
| 3 | **`cinematic_studio_video_4_0`** no lugar de `cinematic_studio_3_0` em `HF_USER_MODELS` | Versão atual do Cinema Studio | **Qualidade** 480p/720p/1080p | gênero, câmera e luz: omitir (o diretor escolhe) |
| 4 | **Keyframe trocável:** `nano_banana_2` (Pro) e `soul_cinematic` com Soul ID, mantendo `cinematic_studio_2_5` | Rosto mais fiel ao apresentador | nada novo; um seletor de modelo só no portão avançado | refs = fotos do apresentador; 2k |
| 5 | **`marketing_studio_video` com URL do produto** (Click-to-Ad) | Encaixa na prioridade "marca automática a partir do site" | **URL do produto** · **Duração** (padrão 15) | `show_marketing_studio fetch` → `product_ids`, `mode:'ugc'`, avatar = apresentador, 9:16, 720p |
| 6 | **Remake: workflow `reframe` + `video_upscale`** | Melhora o vídeo enviado sem regenerar | **Formato final** (9:16 pré-marcado) · **Melhorar nitidez** on/off | resolução 1080p, modo std |
| 7 | **`speech2text` para legendas** | Substitui `scribe_v1` (deprecated) | nada | áudio da narração (schema NÃO VERIFICADO) |
| 8 | **`brain_activity` antes de publicar** | Nota de hook e retenção ajuda a decidir | nada (botão "Avaliar"; retorna nota) | vídeo final; exige parser de texto (item 3 do §8) |
| 9 | Opções baratas no portão: `kling3_0_turbo`, `veo3_1_lite`, `seedance_2_0_mini` | Rascunho e volume | **Duração** dentro do enum do modelo | 720p, 9:16 |
| 10 | 4K sob pedido: `seedance_2_0` (`resolution:'4k'`, modo std) | Único caminho 4K documentado no Seedance | **4K** on/off com custo | — |

**Não ligar agora:**
- `cinematic_studio_video` v1, `veo3`, `kling2_6`: legado.
- `soul_cast`: só gera 16:9.
- Genjutsu e Kling Motion Control: só existem na API REST; o ID MCP está NÃO VERIFICADO.
- Speak / Lipsync Studio: nenhum ID público.

**Pré-requisito comum a todos:** gravar uma resposta real de `models_explore` (search e get) para `seedance_2_5`, `cinematic_studio_video_4_0` e `speech2text`. Essa resposta confirma, na conta do app, o ID, os enums de duração e o teto, antes de qualquer UI.
