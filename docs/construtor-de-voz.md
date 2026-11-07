# Construtor de voz ("Criar voz")

Data: 2026-10-30. Este documento mapeia como o app usa voz hoje, todas as formas de criar uma voz no ElevenLabs e na HeyGen, e propõe a UX, o contrato do motor e as telas do "Criar voz". O modelo é o construtor de avatar (`src/components/avatars/avatar-builder.tsx`, `docs/hub-motor-contratos.md` §8).

Fontes: a OpenAPI oficial do ElevenLabs (`api.elevenlabs.io/openapi.json`) e a da HeyGen (`developers.heygen.com/openapi/external-api.json`), mais as páginas `.md` oficiais dos dois. Tudo foi baixado em 30/10. **NÃO VERIFICADO** marca o que não está nessas fontes.

## 1. Como a voz funciona hoje

| Onde | Campo / origem | Provedor | Arquivo |
|---|---|---|---|
| Voz padrão da narração | `ELEVEN_VOICE_ID` no Vault (Config → Integrações → ElevenLabs, campo de texto) | ElevenLabs | `eleven-integration.tsx`, `lib/integrations.ts` |
| Regra por gênero | `narrationVoice`: usa a configurada; se o gênero dela não bate, usa `ELEVEN_VOICE_ID_FEMALE/MALE` ou um id fixo | ElevenLabs | `director-advance/index.ts:436` |
| Voz do apresentador (narração do Diretor) | `brand_avatars.voice.elevenlabs_voice_id` (ou `voice_id` com `provider: 'elevenlabs'`) | ElevenLabs | `presenterNarrationVoice` (DA:1032) |
| Voz do apresentador (catálogo MiniMax) | `brand_avatars.voice.voice_id` = `Portuguese_*` (10 fixas) | Replicate (MiniMax) | `avatar-studio` `list_voices`/`preview_voice` |
| Voz dos vídeos HeyGen | `brand_avatars.voice.heygen_voice` `{provider: twin\|elevenlabs\|heygen, voice_id}` | os dois | §8.7 do contrato, `VoiceChoice` no construtor |
| Remake "Voz" | `voice_gender`: female · male · own (clone IVC temporário) · custom (Voice ID colado) | ElevenLabs (ou MiniMax pelo `tts_model_id`) | `remake-flow.tsx`, DA:2490-2525 |
| Clone temporário | `cloneVoice` → `POST /v1/voices/add`, fala, `deleteVoice` | ElevenLabs | DA:520-553 |
| Conferências | `voice_check` (lê `can_use_instant_voice_cloning`) · `voice_lookup` (`GET /v1/voices/{id}`) | ElevenLabs | `video-remake/index.ts:40-63` |
| Testar voz | `heygen_voice_preview` (ElevenLabs `eleven_v3` ou HeyGen `/v3/voices/speech`, com cache) | os dois | §8.6 |

O que falta hoje:
- Nenhuma tela **cria** uma voz que fique salva. O único clone é temporário: ele é feito no remake e apagado logo depois.
- A voz colada é só um texto. Ela não tem nome nem amostra e não aparece numa lista.
- Na conta do dono, o ElevenLabs está no Pay-as-you-go com `can_use_instant_voice_cloning = false`. Por isso a opção "A minha voz" do remake cai sempre na voz do gênero.
- `voice_slots_used` e `voice_limit` não são lidos em lugar nenhum.
- Narração e remake só falam ElevenLabs ou MiniMax. Uma voz HeyGen só funciona nos vídeos de avatar HeyGen.

## 2. Formas de criar uma voz (fontes oficiais)

### 2.1 ElevenLabs

| Forma | Endpoint | A pessoa fornece | O sistema preenche | Limites | Plano / custo | Fica pronta em |
|---|---|---|---|---|---|---|
| Clone instantâneo (IVC) | `POST /v1/voices/add` (multipart) → `{voice_id, requires_verification}` | o áudio e o consentimento | `name`, `files[]`, `remove_background_noise` (só se o áudio for ruidoso; em áudio limpo piora), `labels` `{language:'pt', accent:'brazilian', gender}`, `description` | ideal 1–2 min, MP3 ≥192 kbps; no app, ≥5 s por arquivo e ≥10 s no total; mais de 2–3 min quase não melhora e pode piorar. Tamanho máximo pela API: NÃO VERIFICADO | **Starter ou acima**. No Pay-as-you-go: NÃO VERIFICADO; na conta do dono, a flag vem `false`. Ocupa 1 vaga (`voice_slots_used`/`voice_limit`) | na hora |
| Clone profissional (PVC) | `POST /v1/voices/pvc` → `/samples` → `/separate-speakers` → `/captcha` (gravar o texto) ou `/verification` (manual) → `/train`; estado em `GET /v1/voices/{id}` `fine_tuning.state` | 30–180 min de áudio e uma gravação de verificação | `name`, `language`, `labels` | só a própria voz. Quem falha na verificação espera 24 h | Creator/Pro: 1 vaga; Scale: 3; Business: 10; Free e Starter: nenhuma | 3–6 h, às vezes 6–24 h |
| Desenhar voz (Voice Design) | `POST /v1/text-to-voice/design` → `previews[]` `{generated_voice_id, audio}` (3 opções), depois `POST /v1/text-to-voice` `{voice_name, voice_description, generated_voice_id}` | a descrição (20–1.000 caracteres) | `model_id: 'eleven_ttv_v3'` (o padrão é `eleven_multilingual_ttv_v2`), `text` pt-BR de 100–1.000 caracteres (ou `auto_generate_text`), `loudness` 0.5, `guidance_scale` 5, `seed` | `/create-previews` está obsoleto | cobra os caracteres do texto da prévia. Salvar ocupa 1 vaga. **Funciona no plano Free** (3 vagas). No Pay-as-you-go: NÃO VERIFICADO, provável que sim | segundos |
| Remixar voz | `POST /v1/text-to-voice/{voice_id}/remix` `{voice_description 5–1000, text?, prompt_strength?}` → prévias → salvar com `/v1/text-to-voice` | "mais grave", "mais calma"… | `guidance_scale` 2 | só vozes próprias (IVC/PVC), desenhadas, ou da biblioteca com aviso de remoção infinito | cobra pelo texto da prévia. Plano: NÃO VERIFICADO | segundos |
| Biblioteca | `GET /v1/shared-voices?language=pt&locale=pt-BR&gender=&search=` → `POST /v1/voices/add/{public_user_id}/{voice_id}` `{new_name}` | a escolha, depois de ouvir | o filtro pt-BR | algumas vozes são pagas ou multiplicam o crédito | **não ocupa vaga**. No Free, a biblioteca **não funciona pela API**. A voz da biblioteca exige Creator (o erro já é tratado em DA `free_users_not_allowed`). No Pay-as-you-go: NÃO VERIFICADO | na hora |
| Colar Voice ID | `GET /v1/voices/{id}` (o `voice_lookup` que já existe) | o ID | nome e gênero (`labels.gender`) | — | — | na hora |
| Gerenciar | `GET /v2/voices` (`category`: premade/cloned/generated/professional) · `GET`/`POST /v1/voices/{id}/settings/edit` (`stability` 0.5, `similarity_boost` 0.75, `style` 0, `use_speaker_boost`, `speed` 1.0) · `DELETE /v1/voices/{id}` · vagas em `GET /v1/user/subscription` (`voice_limit`, `voice_slots_used`, `professional_voice_limit`, `can_use_*_voice_cloning`, `tier`) | — | — | — | — | — |

Português:
- O `eleven_v3` (o que a narração usa) fala `pt`. O `multilingual_v2` cobre "Portuguese (Brazil, Portugal)".
- Não existe uma chave para escolher pt-BR. O sotaque vem da própria voz, ou seja, da amostra ou do filtro `locale` na biblioteca.

### 2.2 HeyGen

| Forma | Endpoint | A pessoa fornece | O sistema preenche | Limites | Plano / custo | Fica pronta em |
|---|---|---|---|---|---|---|
| Clone instantâneo (HeyGen Voice) | `POST /v3/models/audio/voices` `mode:'instant'` → 202 `{voice_id}`; acompanhar com `GET /v3/models/audio/voices/{id}` (PENDING → ACTIVE \| FAILED, `failure_reason`) | o áudio e o consentimento | `name` (até 64), `audio` `{url}` (URL assinada do bucket), `language:'pt'`, `similarity:'max'`, `remove_background_noise:true`, `gender`, `Idempotency-Key` | MP3/WAV; só os 3 primeiros min contam (o ideal é 1–3 min); ≤100 MiB; a URL precisa baixar em até 30 s; não dá para retreinar | **grátis durante o preview** (conta na cota de clones). No plano Free: 20 clones por dia por workspace | segundos |
| Clone de voz (catálogo) | `POST /v3/voices/clone` `{audio, voice_name, language, remove_background_noise}` → `voice_clone_id`; acompanhar com `GET /v3/voices/{id}` até `complete` | o áudio | — | — | NÃO VERIFICADO | NÃO VERIFICADO |
| Clone profissional | o mesmo endpoint do instantâneo, com `mode:'professional'` | 1–10 gravações, ≥20 min no total, ≤1,5 GB | — | sem vaga livre: `400 resource_limit_reached` | vaga paga (5 treinos por mês) | NÃO VERIFICADO |
| Voz do clone (twin) | automática no `POST /v3/avatars` `digital_twin` → `default_voice_id` | o vídeo do clone (já existe, §3) | — | a voz sobrevive quando o avatar é apagado | junto com o avatar | junto com o avatar |
| Desenhar voz | `POST /v3/voices` `{prompt ≤1000, gender, locale:'pt-BR', seed}` → até 3 vozes com `preview_audio_url` | a descrição | `locale` | a spec diz "matching voices": pode só devolver vozes do catálogo (NÃO VERIFICADO). Limite diário próprio, valor NÃO VERIFICADO | NÃO VERIFICADO | segundos |
| Catálogo | `GET /v3/voices?type=public&language=Portuguese&gender=` (já usado) · `GET /v3/models/audio/voices` (os clones) | a escolha | — | `preview_audio_url` expira | — | na hora |
| Apagar | `DELETE /v3/voices/{id}` (libera a vaga; recusa se a voz está num template) · `DELETE /v3/models/audio/voices/{id}` | — | — | — | — | — |
| Fala sem vídeo | `POST /v3/voices/speech` `{text ≤5000, voice_id, locale:'pt-BR', speed}` → `{audio_url, duration, word_timestamps}` · `POST /v3/models/audio/tts` (para clones HeyGen Voice, WAV 44,1 kHz) | — | `model:'heygen-voice-1-turbo-free'` | 30 pedidos por min | turbo-free **grátis até 30/11/2026**. Os outros preços: NÃO VERIFICADO | segundos |

Mais dois pontos:
- `POST /v3/videos` aceita `script` + `voice_id` ou `audio_url` (MP3/WAV ≤32 MB), nunca os dois. Então uma voz ElevenLabs entra na HeyGen como áudio, como já fazemos.
- Não há como importar um Voice ID do ElevenLabs para dentro da HeyGen: NÃO VERIFICADO.
- As regras de consentimento do clone de voz HeyGen não estão na documentação (NÃO VERIFICADO). Por isso a tela pede o consentimento do mesmo jeito.

### 2.3 Onde a voz criada funciona no app

| Voz | Narração do Diretor (cenas) | Remake "Mudar o que eu digo" | Vídeo de avatar HeyGen | Video Agent | Avatar Replicate |
|---|---|---|---|---|---|
| ElevenLabs (IVC, desenhada, biblioteca, colada) | sim (`ttsMp3`) | sim (`voice_gender: 'custom'`) | sim (`audio_url`, §1.4) | NÃO VERIFICADO (o `voice_id` é da HeyGen) | sim |
| HeyGen (clone, desenhada, catálogo, twin) | **só com motor novo** (§4.4) | **só com motor novo** (§4.4) | sim (`voice_id`) | sim (`voice_id`) | só com motor novo |

## 3. Decisões

### 3.1 Provedor por caminho

O servidor escolhe o provedor. A pessoa nunca escolhe "ElevenLabs ou HeyGen" para criar uma voz.

| Caminho | Padrão | Alternativa automática | Por quê |
|---|---|---|---|
| Da minha voz | ElevenLabs IVC, se `can_use_instant_voice_cloning` e houver vaga (`voice_slots_used < voice_limit`) | **HeyGen clone instantâneo** (grátis no preview). Essa é a situação real do dono: Pay-as-you-go sem IVC | o IVC funciona em todas as saídas do app; o clone HeyGen funciona nos vídeos HeyGen hoje e na narração depois do §4.4 |
| De uma descrição | ElevenLabs Voice Design (`eleven_ttv_v3`, 3 prévias) | HeyGen `POST /v3/voices` `locale: pt-BR` | o Voice Design funciona até no Free e cria uma voz nova de verdade |
| Da biblioteca | ElevenLabs `shared-voices` pt-BR | HeyGen catálogo pt (`heygen_voices`, que já existe) quando a biblioteca é recusada (`free_users_not_allowed`/403) ou o ElevenLabs não está conectado | a biblioteca não ocupa vaga; a voz do catálogo HeyGen já tem prévia pronta |
| Colar um Voice ID | ElevenLabs (`voice_lookup`) | — | quem já tem uma voz na conta |
| Fora do construtor | PVC (horas de espera, Creator+, captcha) e Remix | Remix entra depois como "Ajustar" numa voz pronta | o construtor é para coisas rápidas |

Um caminho bloqueado **não some**. A linha mostra o motivo e a saída. Por exemplo: "Sem ElevenLabs nem HeyGen conectados → Conectar".

### 3.2 Onde mora

Um modal só, `VoiceBuilderDialog`, como o `AvatarBuilderDialog`. Ele recebe `onDone(voice)` e devolve a voz criada para quem o abriu.

| Lugar | Papel | Como entra |
|---|---|---|
| **Marca → Vozes** (rota nova `/marca/vozes`; uma linha "Vozes" no hub da Marca) | a casa: a lista de vozes da marca, uma delas marcada como **voz padrão dos vídeos** (substitui o `ELEVEN_VOICE_ID` digitado) | ação primária "Criar voz" |
| Apresentador (o editor em `marca/avatares.tsx` e o passo "Voz" do construtor de avatar) | a voz daquele avatar (`voice.heygen_voice` / `elevenlabs_voice_id`) | um item "Criar voz…" no fim do seletor de voz |
| Na hora de escolher a voz: remake "Voz", os estúdios HeyGen (`heygen-studios.tsx`), o Diretor | o seletor passa a listar as vozes salvas | o mesmo item "Criar voz…" |
| Config → Integrações → ElevenLabs | continua com o campo "ID da voz" (compatibilidade) | um link "Gerenciar vozes" leva a Marca → Vozes |

Justificativa: a voz é um ativo da marca, como o avatar. Criar uma vez e reusar em todo lugar pede uma casa só. O modal inline, por sua vez, mantém a pessoa no fluxo e evita mandá-la para outra página.

Dois cuidados de nome:
- No hub, "Persona" hoje se descreve como "A voz da marca", no sentido de tom. A linha nova se chama "Vozes", com a descrição "Quem narra os vídeos".
- A Persona passa a se descrever como "Tom, vocabulário, opiniões e exemplos".

### 3.3 Registro: tabela `brand_voices` (nova)

| Campo | Tipo | Nota |
|---|---|---|
| `id` | uuid | |
| `name` | text | |
| `provider` | `elevenlabs` \| `heygen` | |
| `provider_voice_id` | text | |
| `source` | `clone` \| `design` \| `library` \| `pasted` \| `twin` | |
| `status` | `processing` \| `ready` \| `failed` | o HeyGen começa como PENDING |
| `error` | text | frase pronta para a tela |
| `gender`, `language` | text | `language` padrão `pt` |
| `sample_path` | text | `brand-assets/voices/<id>/sample.wav` (clone) |
| `preview_path` | text | a prévia em cache |
| `owned` | bool | `true` se a voz foi criada por nós (só essas são apagadas no provedor) |
| `consent_at`, `consent_by` | timestamptz, uuid | obrigatórios em `clone` |
| `is_default` | bool | no máximo uma (índice parcial). Quando é ElevenLabs, também grava `ELEVEN_VOICE_ID` no Vault, para o motor que já existe |
| `created_at` | timestamptz | |

A RLS segue `brand_avatars`: leitura para autenticados, escrita só pelo `avatar-studio`, que é admin.

## 4. UX "Construtor de voz"

### 4.1 Passos (o modal tem `max-w-lg`, o mesmo do avatar)

| Passo | Tela | Ação primária | Saídas |
|---|---|---|---|
| Escolher | título "Criar voz". Pergunta **"De onde vem a voz?"** com 3 linhas (o mesmo `ul divide-y` do `ChooseStep`, não cards): **Da minha voz** ("Grave 1 min ou suba um áudio") · **De uma descrição** ("Ex.: mulher, 30 anos, calma, sotaque paulista") · **Da biblioteca** ("Vozes prontas em português"). À direita de cada linha vai o custo do catálogo `voice_create` ("grátis", "a confirmar"). Abaixo, um link discreto: "Já tenho um Voice ID" | tocar numa linha | `EngineLine`: "Conectar ElevenLabs/HeyGen" |
| Minha voz | **Gravar** (padrão) ou "Subir áudio" (link). A gravação mostra o roteiro guiado (§4.2), o medidor de nível, o tempo e as checagens. Depois vem "Ouvir" a gravação. Checkbox "É a minha voz e eu autorizo criar o clone". Campo de nome já preenchido com o nome do apresentador ou "Minha voz" | **Criar voz** | "Gravar de novo" · "Voltar" |
| Descrição | `Textarea` (20–1.000 caracteres) com chips de exemplo (gênero, idade, ritmo). Gera 3 prévias, cada uma com o próprio botão "Ouvir" | **Gerar vozes**, depois **Usar esta** | "Gerar de novo" · "Mudar descrição" |
| Biblioteca | busca + chips Feminina/Masculina. Lista com "Ouvir" em cada linha (`preview_url`), já filtrada para pt-BR | **Usar esta** | "Ver mais" (`next_token`) |
| Voice ID | o `ElevenVoiceField` que já existe | **Usar esta** | — |
| Acompanhar | "Criando a sua voz…" (o HeyGen fica PENDING por alguns segundos; poll a cada 3 s com o modal aberto, máximo 2 min). Quando fica pronta: "Ouvir" com uma frase da marca (`heygen_voice_preview`) e o chip "Usar como voz padrão" (só na Marca) | **Usar esta voz** → `onDone(voice)` → fecha e volta para quem abriu | falhou: a frase do erro + "Gravar de novo" / "Escolher outra" |

Regras gerais:
- Cada passo tem uma ação primária só.
- O provedor só aparece numa linha curta, quando importa. Exemplo: "Clone feito na HeyGen. Vale nos vídeos de avatar." Isso continua até o §4.4 ficar pronto.
- Nada de contadores, IDs ou "modelo" na tela principal.

### 4.2 Gravação no navegador

| Item | Regra |
|---|---|
| Captura | `getUserMedia({audio:{echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:1}})` + `MediaRecorder`. O processamento do navegador fica desligado porque distorce o timbre |
| Saída | decodificar com `AudioContext.decodeAudioData` e codificar em **WAV PCM 16-bit mono 44,1 kHz** no cliente. Os dois provedores aceitam WAV; webm/opus não é garantido. 2 min dão ~10,6 MB |
| Roteiro guiado | ~150 palavras em pt-BR em 3 blocos (frase neutra, uma pergunta, uma frase com emoção), lidos "como se falasse com um cliente". O texto rola junto com o tempo |
| Silêncio inicial | "Fique 2 s em silêncio": mede o ruído de fundo (RMS) |
| Checagens antes de enviar | duração ≥ 30 s (bloqueia abaixo de 10 s; o ideal é 60–120 s; corta em 180 s, porque a HeyGen só usa 3 min e o ElevenLabs piora acima disso) · pico > −1 dBFS em mais de 0,5% das amostras = "Está estourando. Afaste um pouco o microfone" · fala média < −35 dBFS = "Está baixo. Chegue mais perto" · ruído de fundo > −50 dBFS = "Tem barulho no fundo. Procure um lugar mais quieto" (avisa, não bloqueia) · mais de 40% de silêncio = "Leia o texto até o fim" |
| Subir áudio | MP3/WAV/M4A, até 50 MB. Converte para WAV no cliente quando for M4A, e roda as mesmas checagens |
| Sem microfone / permissão negada | "O navegador bloqueou o microfone. Libere em 🔒 → Microfone ou suba um áudio." Uma saída sempre visível |

### 4.3 Estados e erros (sempre com saída)

| Estado / erro | Frase | Saída |
|---|---|---|
| nenhum provedor conectado | "Conecte o ElevenLabs ou a HeyGen para criar vozes." | Conectar |
| vagas do ElevenLabs cheias e HeyGen não conectada | "As vagas de voz do ElevenLabs estão cheias (10/10)." | "Apagar uma voz" (abre Vozes) · Conectar HeyGen |
| sem créditos (402) | "Os créditos do {provedor} acabaram." | abrir o painel do provedor |
| HeyGen INVALID_AUDIO | "Não deu para usar esse áudio. Grave de novo num lugar quieto." | Gravar de novo |
| limite diário HeyGen (429) | "Limite de clones de hoje atingido. Tente amanhã ou use outro caminho." | Escolher outro caminho |
| biblioteca bloqueada pelo plano | a lista HeyGen aparece no lugar, com a linha "Biblioteca do ElevenLabs exige plano Creator." | — |
| poll passou de 2 min | "Está demorando mais que o normal. Pode fechar: avisamos em Vozes." | Fechar |

### 4.4 Motor: voz HeyGen na narração (necessário para o dono)

Para uma voz HeyGen funcionar na narração do Diretor e no remake:
1. Criar a função `speechBytes(service, text, voice)` em `_shared/`. Ela escolhe `ttsMp3` (ElevenLabs) ou a HeyGen, conforme o provedor da voz:
   - clones HeyGen Voice: `POST /v3/models/audio/tts`, modelo `heygen-voice-1-turbo-free`, que devolve WAV;
   - vozes do catálogo: `POST /v3/voices/speech`, que devolve `audio_url` e `duration`.
2. Converter para MP3 de 128 kbps no `muxing`, ou medir pela duração do cabeçalho WAV. Hoje a checagem do remake (`speechMismatchError`) assume MP3 de 128 kbps.
3. Ordem para escolher a voz: a voz do job → a voz do apresentador → **a padrão em `brand_voices`** → `ELEVEN_VOICE_ID` → a regra por gênero.
4. A opção "A minha voz" do remake ganha um caminho alternativo: quando o IVC está bloqueado, clona temporariamente na HeyGen (e apaga depois), em vez de cair direto na voz do gênero.

## 5. Contrato do motor (ações novas do `avatar-studio`, admin, `POST`)

Seguem o §0 do contrato: nenhuma função nova, erros no formato `{error:{code,message}}` em pt-BR, e `Idempotency-Key` `voice:<brand_voice_id>:<n>` na HeyGen. O `BrandVoice` é a linha do §3.3, mais `preview_url` assinada.

| Ação | Payload | Resposta | Erros |
|---|---|---|---|
| `voice_options` | `{}` | `{ paths: { own, describe, library, paste }: { provider: 'elevenlabs'\|'heygen'\|null, blocked_reason: string\|null, cost_label }, eleven: { connected, can_clone, slots_used, slot_limit, tier }, heygen: { connected } }` | — (nunca falha; cada caminho já traz o motivo) |
| `voice_upload_url` | `{ content_type: 'audio/wav'\|'audio/mpeg' }` | `{ path: 'voices/uploads/<uuid>.wav', token }` (bucket `brand-assets`) | 400 tipo |
| `voice_clone` | `{ name ≤60, sample_path, consent: true, gender?, avatar_id? }` | `{ voice: BrandVoice }` (`ready` no ElevenLabs, `processing` na HeyGen) | 400 "Confirme que a voz é sua." · 400 "Grave pelo menos 30 s." · 409 `slots_full` · 412 · 402 · 429 `daily_limit` |
| `voice_design` | `{ description 20–1000, gender? }` | `{ previews: [{ preview_id, url }] }` (3; o áudio vai para o bucket; `preview_id` = `generated_voice_id` ou o voice_id HeyGen) | 400 descrição · 412 · 402 |
| `voice_design_save` | `{ preview_id, name, description }` | `{ voice }` | 404 "A prévia expirou. Gere de novo." · 409 `slots_full` |
| `voice_library` | `{ search?, gender?, token? }` | `{ provider, voices: [{ ref, name, gender, accent, preview_url }], next_token }` | — (troca para a HeyGen sozinho) |
| `voice_library_add` | `{ provider, ref, name? }` | `{ voice }` (ElevenLabs: `POST /v1/voices/add/{public_user_id}/{voice_id}`; HeyGen: só grava o registro) | 403 → a frase do plano |
| `voice_import` | `{ voice_id, name? }` | `{ voice }` (ElevenLabs, depois do `voice_lookup`) | 404 "Esse Voice ID não existe no ElevenLabs." |
| `voice_status` | `{ voice_id: uuid }` | `{ voice }` (lê `GET /v3/models/audio/voices/{id}`) | — |
| `voice_set_default` | `{ voice_id: uuid }` | `{ ok }` (e grava `ELEVEN_VOICE_ID` quando a voz é ElevenLabs) | — |
| `voice_delete` | `{ voice_id: uuid }` | `{ ok, deleted_at_provider: bool }` (só apaga no provedor se `owned`; o 404 do provedor conta como apagado) | 409 "Essa é a voz padrão. Escolha outra antes." |
| `heygen_voice_preview` (já existe) | aceita também `{ brand_voice_id }` | o mesmo de hoje | o mesmo de hoje |

## 6. Catálogo: linhas `video_models` capability `voice_create`

Arquivo `supabase/sql/voice-create.sql`, idempotente como o `avatar-create.sql`. As linhas servem para custo e rótulo. `cost.verified=false` mostra "preço a confirmar".

| `model_id` | provider | `limits` | custo | `experience` | ativo |
|---|---|---|---|---|---|
| `elevenlabs/voice-clone-instant` | elevenlabs | `{"duration_min":10,"duration_ideal":90,"duration_max":180}` | `{"unit":"per_run","usd":0,"verified":false,"note":"vaga do plano Starter+"}` | `own_voice` | sim (primário) |
| `heygen/voice-clone-instant` | heygen | `{"duration_max":180,"max_bytes":104857600,"daily":20}` | `{"unit":"per_run","usd":0,"verified":true,"note":"grátis no preview"}` | `own_voice` | sim (alternativa) |
| `elevenlabs/voice-design` | elevenlabs | `{"max_chars":1000,"min_chars":20,"previews":3}` | `{"unit":"per_1k_chars","verified":false}` | `voice_design` | sim (primário) |
| `heygen/voice-design` | heygen | `{"max_chars":1000,"previews":3}` | `{"verified":false}` | `voice_design` | sim |
| `elevenlabs/voice-library` | elevenlabs | `{}` | `{"usd":0,"verified":true,"note":"sem vaga; exige Creator"}` | `voice_library` | sim |
| `elevenlabs/voice-clone-pro` | elevenlabs | `{"duration_min":1800}` | `{"verified":false}` | `pro_voice` | **não** |
| `tts` · `heygen/voice-1-turbo-free` | heygen | `{"max_chars":5000,"rpm":30}` | `{"usd":0,"verified":true,"until":"2026-11-30"}` | `narration` | sim, depois do §4.4 |

## 7. O que construir, por responsável

| Responsável | Entrega |
|---|---|
| **Motor** (`supabase/functions`) | as ações do §5 no `avatar-studio`, com o cliente em `_shared/voices.ts` (ElevenLabs IVC, design, biblioteca, vagas; HeyGen instantâneo, design, status, delete) · `speechBytes` + a ordem nova da voz no `director-advance` (§4.4) · a alternativa HeyGen no "A minha voz" do remake · a migração `brand_voices` + RLS · a importação da voz atual: `ELEVEN_VOICE_ID` e o `default_voice_id` de cada twin viram linhas (`source: 'pasted'`/`'twin'`) |
| **Telas** (`src`) | `components/voices/voice-builder.tsx` (o modal: Escolher, Minha voz, Descrição, Biblioteca, Voice ID, Acompanhar) · `components/voices/voice-recorder.tsx` (MediaRecorder, WAV, checagens) · `hooks/use-voices.ts` · `routes/_app/marca/vozes.tsx` (lista: nome, origem, Ouvir, Padrão, Apagar) · um seletor só, `VoiceSelect` (vozes salvas + "Criar voz…"), usado em `VoiceChoice` (construtor de avatar), `VoicePicker` (editor do apresentador), `remake-flow.tsx` ("Outra voz" vira as vozes salvas) e `heygen-studios.tsx` · a linha "Vozes" no hub da Marca e a copy nova da Persona · o link "Gerenciar vozes" na integração do ElevenLabs |
| **Catálogo** (SQL) | `supabase/sql/voice-create.sql` (§6) e o mesmo bloco no fim do `seed-instancia.sql` |

Checagem de design:
- A lista de Vozes e as escolhas do modal usam linhas `divide-y`, como o `ChooseStep`. Não há card genérico.
- Os botões são os `Button`/`ChoiceChip` que já existem.
- O "Ouvir" é o mesmo botão em todos os lugares.

## 8. Teste antes de fechar o motor (não bloqueia o design)

Com a chave HeyGen do dono:
1. Criar um clone `POST /v3/models/audio/voices` (`instant`, pt) e confirmar que o `voice_id` funciona em `POST /v3/videos` (`script` + `voice_id`) e em `/v3/models/audio/tts`. A documentação garante o `/v3/videos` só para o `/v3/voices/clone`. Se falhar, a alternativa passa a ser o `/v3/voices/clone`.
2. Ver se a conta Pay-as-you-go do ElevenLabs aceita `text-to-voice/design` e `shared-voices` pela API. Se não aceitar, o `voice_options` já devolve a alternativa HeyGen.
