# Hub full: contratos do motor (frente B)

Data: 2026-10-29. Este documento é o contrato entre o motor (`supabase/functions/**`) e as telas (`src/**`). Cada experiência nova diz qual edge ou tabela a tela usa, o payload exato, a resposta, como acompanhar o estado e quais erros ela mostra.

Fontes: `docs/hub-full-plano.md` (frente B), `docs/catalogo-heygen.md`, `docs/catalogo-replicate.md`, `docs/catalogo-higgsfield.md`, `docs/hub-de-video-mapa.md`. Os campos HeyGen foram conferidos na spec oficial `developers.heygen.com/openapi/external-api.json`, baixada em 29/10. **TODO** marca o que a spec não confirma.

## 0. Regras comuns

- **Nada de função nova.** Avatares, looks, vozes e brand kit da HeyGen são ações novas do `avatar-studio`. Os vídeos (avatar e Video Agent) são `director_jobs` com um `config.mode` novo, avançados pelo `director-advance`. O upload do vídeo do Digital Twin reusa o `video-remake` (`upload_url`).
- **Quem chama:** só admin, como hoje (`avatar-studio` e `video-remake` checam `has_role`). Toda edge é `POST` com JSON.
- **Erro de edge:** `{ error: { code, message } }`. O `message` já vem em pt-BR e pronto para a tela. A tela usa `getFunctionErrorMessage`, como faz hoje.
- **Erro de job:** `director_jobs.status = 'failed'` e `director_jobs.error` com uma frase que diz o que fazer. O botão "Retomar" volta o status para o anterior, como no Remake. Os textos que citam "HeyGen", "ElevenLabs", "Replicate" ou "Higgsfield" casam com o `IntegrationTarget` do `job-card.tsx`, que já mostra o atalho "Conectar".
- **Chave HeyGen:** a mesma de hoje, `HEYGEN_API_KEY` no Vault (Config → Integrações → HeyGen). Sem ela, as ações HeyGen respondem `412 not_connected`: "A HeyGen ainda não está conectada. Salve a chave em Config → Integrações → HeyGen."
- **Idempotência:** toda criação na HeyGen manda `Idempotency-Key`, derivado do id do job ou do apresentador mais o número da tentativa (§7). Um retry de rede não paga duas vezes.
- **Acompanhamento:** `director_jobs` já está no Realtime, e a tela assina como hoje (`use-director-jobs.ts`). `brand_avatars` **não** está no Realtime: o estado do avatar HeyGen vem da ação `heygen_status`, que a tela chama a cada 10 s enquanto ele estiver em processamento.
- **Status do job:** os mesmos de hoje (`queued → tts → videos → muxing → done | failed`). Não há status novo, então nada muda na constraint nem no `RUNNABLE`.

## 1. Avatar fala o roteiro (biblioteca HeyGen)

### 1.0 O roteiro nasce do Claude da pessoa

A tela não pede o roteiro: pede **o que a pessoa quer produzir** (ideia, o que mostrar, referências em link). O pedido vai para `roteiro_pedidos` (edge `roteiro-pedido`, que acorda a rotina do Claude dela); o Claude lê pelo conector (`roteiro_pedidos`, com a receita de `_shared/roteiro.ts`), pesquisa, estuda as referências no ambiente dele e entrega (`roteiro_entregar`) o **plano de produção**: o roteiro em passos (`conceito` em tela cheia, `tela` narrada na hora da ação com as ações na fração da fala, `ao_vivo` para o que só humano opera, `legenda` para termo novo), gravações de tela, o **mapa de bastidor** (ferramentas a deixar logadas, intervenções da pessoa, dados de teste a apagar), efeitos, modelos extras e fontes. O roteiro da fala sai dos passos. O método é o das aulas com avatar, só em regras gerais (`RECEITA_DO_ROTEIRO` e `RECEITA_DA_MONTAGEM` em `_shared/roteiro.ts`). O briefing manda; a marca é contexto. O roteiro cai no campo, editável; o plano segue em `config.avatar_video.plano`. Quando o job fica `done`, `director-advance` abre um pedido de montagem no editor (`video-edit`, `action: plan`, `via: connector`, texto de `planoEmTexto`) com o plano inteiro em `analysis.plano`; `video_pedidos` devolve o plano e a receita de montagem, e o editor acorda a rotina quando o pedido fica aberto: o mesmo Claude grava as telas, une ao avatar, aplica os efeitos e entrega o MP4 por `video_render`/`video_entregar`. Quem atende é a **rotina do Claude** da pessoa, na nuvem da Anthropic (`claude-rotina.ts`): o produto a dispara a cada pedido e a cada resposta na conversa; ela lê a fila pelo conector, conversa pelo app, grava sites públicos liberados na rede dela e monta com ffmpeg; cenas com login a pessoa grava e anexa. Sem a rotina ligada, as telas dizem isso ao administrador e o pedido espera.


### 1.1 Listar avatares: `avatar-studio`, `action: 'heygen_looks'`

```jsonc
// pedido
{
  "action": "heygen_looks",
  "ownership": "public" | "private",   // obrigatório. public = biblioteca; private = meus (photo/twin)
  "avatar_type": "studio_avatar" | "digital_twin" | "photo_avatar", // opcional
  "group_id": "string",                // opcional: looks de um grupo
  "limit": 24,                         // opcional, 1-50, padrão 24
  "token": "string"                    // opcional: cursor da próxima página
}
// resposta 200
{
  "looks": [{
    "id": "string",                    // é o avatar_id do vídeo (look_id)
    "name": "string",
    "group_id": "string" | null,
    "avatar_type": "studio_avatar" | "digital_twin" | "photo_avatar",
    "preview_image_url": "string" | null,
    "preview_video_url": "string" | null,
    "gender": "string" | null,
    "default_voice_id": "string" | null,
    "supported_api_engines": ["avatar_v" | "avatar_iv" | "avatar_iii"],
    "preferred_orientation": "portrait" | "landscape" | "square" | null,
    "status": "processing" | "pending_consent" | "completed" | "failed" | null // só nos privados
  }],
  "next_token": "string" | null        // null = não há mais páginas
}
```

O motor não guarda a lista: as URLs de prévia da HeyGen expiram. A tela pede de novo quando abre o seletor.

### 1.2 Listar vozes HeyGen (só se a pessoa escolher "voz HeyGen"): `action: 'heygen_voices'`

```jsonc
{ "action": "heygen_voices", "language": "Portuguese", "gender": "female" | "male", "type": "public" | "private", "limit": 50, "token": "string" }
// 200
{ "voices": [{ "voice_id", "name", "language", "gender", "preview_audio_url" }], "next_token": "string" | null }
```

`language` vai como texto livre para a HeyGen. **TODO:** o formato que a HeyGen aceita ("Portuguese" ou "pt-BR") não está na spec. O padrão da tela é **não** listar vozes HeyGen e usar a voz da marca (ElevenLabs).

### 1.3 Criar o vídeo: `insert` em `director_jobs`

A tela insere o job como faz hoje e chama `kickDirector()` se for admin.

```jsonc
{
  "brief": { "title": "string" },             // obrigatório (a coluna é not null); só vira título
  "config": {
    "mode": "avatar_video",
    "captions": true,                          // opcional, padrão false (§1.5)
    "avatar_video": {
      "provider": "heygen",                    // "heygen" (padrão) | "replicate" (§2.2)
      "look_id": "string",                     // look da biblioteca (1.1). Obrigatório se não houver presenter_id
      "presenter_id": "uuid",                  // apresentador da marca com avatar HeyGen pronto (§2, §3). Exclui look_id
      "script": "string",                      // obrigatório, 1-5.000 caracteres
      "voice": {
        "provider": "elevenlabs" | "heygen",   // padrão elevenlabs (voz da marca)
        "voice_id": "string"                   // opcional (§1.4)
      },
      "engine": "avatar_v" | "avatar_iv" | "avatar_iii", // opcional; preferência, conferida no servidor
      "aspect_ratio": "9:16",                  // opcional: 9:16 (padrão) | 1:1 | 4:5 | 16:9
      "resolution": "1080p",                   // opcional: 720p | 1080p (padrão) | 4k (só avatar_iii)
      "motion_prompt": "string"                // opcional, ≤500; só photo avatar (e twin no avatar_v)
    }
  }
}
```

**Validação no servidor** (o job falha no 1º tick com a frase entre aspas):

| Regra | Mensagem |
|---|---|
| `script` vazio ou com mais de 5.000 caracteres | "O roteiro precisa ter de 1 a 5.000 caracteres." |
| nem `look_id` nem `presenter_id` | "Escolha quem apresenta o vídeo." |
| `aspect_ratio` ou `resolution` fora da lista | "Formato de vídeo inválido. Escolha de novo." |
| `voice.provider = 'heygen'` sem `voice_id` e o look sem `default_voice_id` | "Escolha uma voz para o apresentador." |

### 1.4 Voz

- **`elevenlabs` (padrão):** usa a mesma resolução de voz do Diretor (`presenterNarrationVoice`). Ordem: `voice.voice_id` do pedido (um Voice ID ElevenLabs), depois a voz ElevenLabs do apresentador (`presenter_id`), depois a voz da marca pelo gênero do apresentador, depois a `ELEVEN_VOICE_ID`. O áudio é gerado com `eleven_v3`, sobe para `renders/director/<job>/avatar-voice.mp3` e vai para a HeyGen como `audio_url`. O lipsync é da HeyGen.
- **`heygen`:** manda `script` + `voice_id` (o do pedido ou o `default_voice_id` do look). Não usa ElevenLabs.

### 1.5 Motor (`engine`)

Antes de mandar, o servidor lê `GET /v3/avatars/looks/{look_id}` e confere `supported_api_engines`:
- `engine` pedido e suportado: usa esse.
- Não suportado ou ausente: `avatar_iv` se estiver na lista, senão o primeiro da lista.
- Lista vazia: não manda `engine` (a HeyGen usa o padrão dela).

O motor efetivo fica em `artifacts.avatar.engine`. `resolution: '4k'` só passa com `avatar_iii`; nos outros cai para `1080p`. `motion_prompt` só vai para photo avatar, ou para twin com `avatar_v`. `expressiveness: 'medium'` só vai para photo avatar com `avatar_iv`.

### 1.6 Estados (o que a tela mostra)

| `status` | `artifacts.avatar` | Frase sugerida |
|---|---|---|
| `queued` | `wait_since` existe = esperando o avatar ficar pronto (twin/photo) | "Preparando o apresentador" |
| `tts` | — | "Gravando a voz" |
| `videos` | `pending: { provider, id, submitted_at }` | "O apresentador está gravando" (a HeyGen leva de 2 a 10 min) |
| `muxing` | — | "Finalizando" (legendas, quando ligadas) |
| `done` | `artifacts.final` = `director/<job>/final.mp4` (bucket `renders`) | o vídeo |
| `failed` | `error` | a frase do erro e o botão "Retomar" |

Os campos extras de `artifacts.avatar`: `engine`, `look_id`, `audio_path` (com voz ElevenLabs), `video_id`, `duration_s`, `attempt`, `captions_by` (`heygen` | `sandbox` | null) e `captions_note` (frase para o cartão quando a legenda não pôde sair). O custo fica em `costs.heygen_usd_est` (§7.3) e `costs.heygen_seconds`.

**Legendas** (`captions: true`):
- Com o Higgsfield conectado, usa o mesmo burn das legendas da marca (Scribe e ffmpeg no sandbox), igual ao Remake.
- Sem o Higgsfield, pede à HeyGen `caption: { file_format: 'srt', style: 'default' }` e entrega o `captioned_video_url`. A legenda sai no estilo da HeyGen, não no da marca.

`captions: false` (o padrão deste modo) entrega o vídeo da HeyGen sem passar pelo sandbox.

### 1.7 Erros do job (`director_jobs.error`)

| Situação | Mensagem |
|---|---|
| sem chave HeyGen | "A HeyGen ainda não está conectada. Salve a chave em Config → Integrações → HeyGen e clique em \"Retomar do checkpoint\"." |
| `402 insufficient_credit` | "A HeyGen está sem créditos para este vídeo. Recarregue em app.heygen.com e clique em \"Retomar do checkpoint\"." |
| `429` (10 jobs simultâneos) | não falha: espera o próximo tick por até 20 min, depois "A HeyGen está com o limite de vídeos simultâneos ocupado…" |
| `400` de engine | "Este apresentador não aceita o motor escolhido. Escolha outro apresentador ou deixe o motor automático." |
| `failed` no vídeo | "A HeyGen não conseguiu gerar o vídeo [failure_code]: failure_message." |
| look privado `failed` | "O avatar “Nome” falhou no preparo da HeyGen (motivo). Crie de novo em Apresentadores." |
| esperou o avatar por mais de 30 min | "O avatar ainda não ficou pronto na HeyGen. Confira em Apresentadores e clique em \"Retomar\"." |
| prazo de 40 min sem terminar | "A HeyGen passou de 40 min sem terminar o vídeo. Clique em \"Retomar do checkpoint\"." (o retomar volta a consultar o mesmo id e não paga de novo) |

## 2. Minha foto vira apresentador

### 2.1 HeyGen Photo Avatar (padrão): `avatar-studio`, `action: 'heygen_photo_avatar'`

O apresentador já existe em `brand_avatars`, criado com foto pelo fluxo atual (`create`). Esta ação cadastra a foto principal dele na HeyGen **uma vez**.

```jsonc
{ "action": "heygen_photo_avatar", "avatar_id": "uuid" }  // id de brand_avatars
// 200
{ "heygen": HeygenRef }
```

O `HeygenRef` fica gravado em `brand_avatars.provider_refs.heygen`:

```jsonc
{
  "type": "photo" | "digital_twin",
  "group_id": "string",
  "look_id": "string",                 // o avatar_id do vídeo
  "status": "processing" | "pending_consent" | "completed" | "failed",
  "consent_status": "pending" | "accepted" | "rejected" | null, // só twin
  "consent_url": "string" | null,      // só twin; vale 24 h
  "consent_url_at": 1730000000000,     // ms, quando o link foi gerado
  "engines": ["avatar_iv", ...],       // supported_api_engines da look
  "default_voice_id": "string" | null, // voz clonada pela HeyGen (twin)
  "error": "string" | null,
  "ready": true | false,               // look completed e, no twin, consentimento que não esteja pending nem rejected
  "updated_at": "ISO"
}
```

- Chamar de novo com `heygen.status` em `processing` ou `completed` devolve o mesmo ref, sem criar outro. Com `failed`, cria de novo (nova tentativa, nova Idempotency-Key).
- Erros: `400 invalid_input` "Este apresentador não tem foto." · `404` "Apresentador não encontrado." · `412 not_connected` (sem chave).
- Depois, `config.avatar_video.presenter_id = <uuid>` no §1.3. O Gerar só deve ficar ativo com `heygen.ready = true`. Se a pessoa gerar antes, o job espera até 30 min em `queued`.

### 2.2 Replicate (top: P-Video 2 Pro Avatar, OmniHuman 1.5), sem cadastro na HeyGen

É o mesmo `insert` do §1.3, com:

```jsonc
"avatar_video": {
  "provider": "replicate",
  "presenter_id": "uuid",      // obrigatório: a foto é o reference_image_path dele
  "model_id": "owner/name",    // opcional: linha ativa de talking_avatar; sem ele, a primária
  "script": "string",          // 1-5.000
  "voice": { "provider": "elevenlabs", "voice_id": "opcional" } // só elevenlabs aqui
}
```

O servidor gera o áudio ElevenLabs e cria a predição pelo catálogo (`resolveModel('talking_avatar', model_id)`, template com `{{keyframe_url}}` = foto e `{{audio_url}}`). O custo vai para `costs.replicate_usd_est`, igual às cenas. Os estados são os do §1.6, com `pending.provider = 'replicate'`. Uma linha com `limits.max_duration_s` recusa o áudio mais longo antes de pagar: "O roteiro dá N s e este modelo aceita até M s. Encurte o roteiro ou escolha outro modelo."

## 3. Meu clone (Digital Twin)

O cadastro tem quatro passos. A tela segue o `heygen.status` de cada um.

1. **Subir o vídeo:** `video-remake` `{ action: 'upload_url', content_type: 'video/mp4' }` → `{ path, token }`. O upload vai por `uploadToSignedUrl` no bucket `renders`, como no Remake. Só MP4: a HeyGen aceita MP4 e WebM, e o MOV é recusado. O vídeo precisa ter de 15 a 600 s (ideal ~2 min), 1 pessoa olhando para a câmera, fala limpa e sem música. A tela confere a duração antes de enviar.
2. **Criar o twin:** `avatar-studio` `{ action: 'heygen_twin', avatar_id: uuid, video_path: 'director/uploads/<uuid>.mp4' }` → `{ heygen: HeygenRef }`. Ele faz `POST /v3/avatars` `type: 'digital_twin'` e já pede o link de consentimento (`POST /v3/avatars/{group_id}/consent`). Na volta, `status = 'processing'` e `consent_url` vem preenchido.
3. **Consentimento:** a tela mostra o `consent_url` (abrir em nova aba, ou copiar e mandar para a pessoa). O link vale 24 h e aceita uma gravação só. Para gerar outro: `{ action: 'heygen_consent_link', avatar_id }` → `{ heygen }`, com novo `consent_url` e `consent_url_at`.
4. **Acompanhar:** `{ action: 'heygen_status', avatar_id }` → `{ heygen }`, a cada 10 s enquanto `ready = false` e a tela estiver aberta. Ele lê a look (`status`, `supported_api_engines`) e o grupo (`consent_status`, `default_voice_id`) e grava no `provider_refs`. Não há webhook de consentimento na HeyGen, então é polling.

Estados para a tela:

| `heygen` | Frase sugerida | Ação |
|---|---|---|
| `status: 'processing'`, `consent_status: 'pending'` | "Preparando o seu clone e esperando a sua autorização" | link de consentimento |
| `status: 'pending_consent'` | "Falta gravar a autorização" | link (se `consent_url_at` passou de 24 h: botão "Gerar novo link") |
| `consent_status: 'rejected'` | "A autorização foi recusada. Grave de novo pelo novo link." | `heygen_consent_link` |
| `status: 'completed'`, `consent_status: 'accepted'` (`ready: true`) | "Clone pronto" | habilita o Gerar |
| `status: 'failed'` | `error` | "Enviar outro vídeo" (volta ao passo 1) |

Depois, cada vídeo é o §1.3 com `presenter_id`. Com `voice.provider = 'heygen'` sem `voice_id`, o twin fala com a voz clonada (`default_voice_id`). Com `elevenlabs`, fala com a voz da marca.

Erros do `heygen_twin`:
- `400` "Envie o vídeo em MP4." (path que não termina em `.mp4` ou que está fora de `director/uploads/`)
- `404` "Apresentador não encontrado."
- `412` sem chave
- `402` sem créditos: a mesma frase do §1.7, sem o "Retomar"

**Regra de pronto do twin:** a look precisa estar `completed` e o `consent_status` não pode ser `pending` nem `rejected`. Enquanto falta a autorização, a própria look fica em `pending_consent` (AvatarStatus da spec), o que cobre o caso em que o grupo devolve `consent_status` nulo.

**TODO:** a spec não confirma o `consent_status` que o grupo devolve quando o consentimento é aceito. A spec diz só "string | null". O motor trata `accepted`, `approved` e `completed` como aceito, e `rejected` ou `declined` como recusado. Conferir com um twin real.

## 4. Só a ideia → vídeo pronto (Video Agent)

### 4.1 Brand Kit HeyGen: `avatar-studio`, `action: 'heygen_brand_kit'`

```jsonc
{ "action": "heygen_brand_kit", "refresh": false }   // refresh: true recria a partir do site atual
// 200
{ "brand_kit": { "id": "string", "status": "loading" | "completed" | "error", "site": "https://…", "colors_synced": true | false } | null,
  "reason": "string" | null }   // null + reason quando a marca não tem site
```

- O site vem do onboarding (`app_settings.brand_autopilot.input.site`). A HeyGen lê o site (`POST /v3/brand-kits`). Quando o kit fica `completed`, o motor sobrescreve as cores com a paleta do brand kit do app (`PATCH color_roles` com primary/secondary/accent), para o vídeo usar as mesmas cores do resto do produto.
- O estado fica em `director_state` chave `heygen_brand_kit`. A tela não precisa chamar esta ação: o job do Video Agent garante o kit sozinho. Ela serve para mostrar o estado em Config, se a tela quiser.

### 4.2 Criar o vídeo: `insert` em `director_jobs`

```jsonc
{
  "brief": { "title": "string" },
  "config": {
    "mode": "video_agent",
    "captions": false,                // opcional; true = legendas da marca por cima (exige Higgsfield)
    "video_agent": {
      "prompt": "string",             // obrigatório, 1-10.000 caracteres
      "presenter_id": "uuid",         // opcional: apresentador com heygen.ready
      "look_id": "string",            // opcional: look da biblioteca (exclui presenter_id)
      "voice_id": "string",           // opcional: voz HeyGen; sem ela, a do avatar ou a escolha do agente
      "orientation": "portrait",      // portrait (padrão) | landscape
      "style_id": "string",           // opcional (GET /v3/video-agents/styles; sem ação de lista por enquanto)
      "brand_kit": true,              // padrão true: usa/gera o kit do §4.1
      "file_paths": ["renders:director/uploads/x.jpg", "brand-assets:logo.png"] // opcional, ≤20: "<bucket>:<path>"
    }
  }
}
```

Validação: prompt vazio ou acima de 10.000 → "Descreva o vídeo em até 10.000 caracteres." · mais de 20 arquivos → "Anexe até 20 arquivos." · bucket fora de `renders`/`brand-assets` → "Arquivo anexado inválido."

### 4.3 Estados

| `status` | `artifacts.agent` | Frase sugerida |
|---|---|---|
| `queued` | `wait_since` = esperando o avatar; `brand_kit_note` = frase quando a marca não pôde ser aplicada (o vídeo sai mesmo assim) | "Preparando a marca" (garante o brand kit) |
| `videos` | `session_id`, `session_status` (`thinking` · `generating` · `reviewing` · `waiting_for_input`), `progress` (0-100), `video_id` | "O agente está escrevendo o roteiro" (thinking) · "Gerando o vídeo — N%" (generating) |
| `muxing` / `done` / `failed` | como no §1.6 | |

O render leva de 5 a 10 vezes a duração final, e o prazo do passo é 60 min. `waiting_for_input` não acontece no modo `generate` em condições normais. Se aparecer, o job falha com "O Video Agent pediu uma decisão que este fluxo não oferece. Reescreva a ideia com mais detalhes e gere de novo."

Erros: os do §1.7. A falha da sessão usa `error.message` da HeyGen: "O Video Agent não conseguiu gerar o vídeo: <motivo>."

## 5. Lipsync sem chave HeyGen ("Mudar o que eu digo")

O contrato da tela **não muda**: é o Remake de sempre (`config.mode = 'remake'`, `remake.speech`). Muda só o servidor, e só quando falta a chave HeyGen:
- **Com `HEYGEN_API_KEY`:** igual a hoje (HeyGen `/v3/lipsyncs`, ou foto que fala).
- **Sem a chave**, com uma linha ativa em `lipsync_post` no catálogo: o lipsync vai pelo Replicate (`resolveModel('lipsync_post', remake.lipsync_model_id)`, template com `{{video_url}}` e `{{audio_url}}`). O custo vai para `costs.replicate_usd_est`.
- **Campo novo opcional:** `remake.lipsync_model_id: "owner/name"` força a linha do Replicate mesmo com a chave HeyGen. Sem ele, a HeyGen tem prioridade.
- **Sem a chave e com fala maior que o vídeo** (a foto que fala é só HeyGen): "A fala nova não cabe no vídeo, e a foto que fala precisa da HeyGen. Encurte a fala para uns N caracteres ou conecte a HeyGen."
- **Tradução:** continua exigindo HeyGen.

Para a tela: `remakeRequirements` pode aceitar "Replicate **ou** HeyGen" para a fala quando houver uma linha `lipsync_post` ativa (a tela já lê o catálogo por `useReplicateVideoModels`).

## 6. Legendas: Scribe v2 pela capability `stt`

O contrato da tela **não muda** (`captions: true`, `captions_style`, etc.). No servidor, o passo de legendas:
1. Com uma linha ativa em `stt` e o token Replicate: cria a predição (template com `{{audio_url}}` = master e `{{language_code}}`), guarda `artifacts.pending_stt` e lê as palavras com tempo quando ela termina. O custo vai para `costs.replicate_usd_est`.
2. Sem linha `stt`, ou se a saída não trouxer palavras com tempo: usa o Scribe v2 direto do ElevenLabs, como hoje. Os erros do ElevenLabs são os de hoje.

**TODO:** o formato da saída de `elevenlabs/scribe-v2` no Replicate não foi baixado. O parser aceita `words[]` com `start`/`end` ou `chunks[]` com `timestamp`; fora disso, cai no ElevenLabs direto.

## 6b. Resolução das cenas (Vídeo de cenas, Replicate)

Campo novo no `insert` do Diretor: `config.resolution`, com `'720p'`, `'1080p'` ou `'4k'`. É opcional; sem ele, o padrão é **720p** (antes era 1080p fixo).

O servidor ajusta o valor ao que o modelo aceita (`limits.resolutions`), pela regra do `fitResolution`: usa a resolução pedida, ou a maior abaixo dela, ou a menor acima. Um modelo sem lista de resoluções não recebe o campo. O custo estimado (`costs.replicate_usd_est`) usa o preço dessa resolução quando a linha tem `cost.by_resolution`.

As cenas do Higgsfield **não mudam**: elas continuam com a resolução de `director_state.hf_models`.

## 6c. Retomar

A tela não precisa de regra nova. Para esses dois modos, o `useRetryDirectorJob` de hoje devolve `queued` (eles não têm `arts.tts` nem `arts.videos`), ou `muxing` quando já há `master`/`final`. O passo `queued` de cada modo pula sozinho para onde o job parou: com uma criação em voo (`pending` ou `session_id`), volta a consultar a mesma e não paga de novo.

Modelo escolhido que foi aposentado no catálogo (override inativo) não derruba mais o job: o motor avisa no log e usa o primário da capability.

## 7. Referência técnica

### 7.1 Endpoints HeyGen usados (todos v3, `X-Api-Key`)

| Uso | Endpoint | Idempotency-Key |
|---|---|---|
| looks (lista / uma) | `GET /v3/avatars/looks` · `GET /v3/avatars/looks/{id}` | — |
| grupo (consentimento, voz) | `GET /v3/avatars/{group_id}` | — |
| photo / twin | `POST /v3/avatars` | `avatar:<brand_avatar_id>:<type>:<n>` |
| link de consentimento | `POST /v3/avatars/{group_id}/consent` | `consent:<group_id>:<n>` |
| vídeo de avatar | `POST /v3/videos` `type: 'avatar'` · `GET /v3/videos/{id}` | `<job_id>:avatar_video:<n>` |
| Video Agent | `POST /v3/video-agents` · `GET /v3/video-agents/{session_id}` | `<job_id>:video_agent:<n>` (TODO: a spec não lista o header neste endpoint; o checkpoint do `session_id` é a proteção real) |
| brand kit | `POST /v3/brand-kits` · `GET`/`PATCH /v3/brand-kits/{id}` | `brand_kit:<hash do site>:<n>` |
| vozes | `GET /v3/voices` | — |

`<n>` é a tentativa: ela só sobe quando a anterior falhou de fato. Assim, um retry depois de um timeout de rede reaproveita a mesma criação (a HeyGen devolve a resposta original por 24 h), e um "Retomar" depois de uma falha real cria outra.

### 7.2 Arquivos

- `_shared/heygen.ts`: cliente v3 compartilhado (pedido, erro, chave, looks, avatares, vídeo, Video Agent, brand kit, vozes) e as funções puras testadas (`pickEngine`, `idempotencyKey`, `buildAvatarVideoBody`, normalização de look/grupo).
- `_shared/remake.ts`: mantém o lipsync, a tradução e a foto que fala; agora importa o pedido de `heygen.ts` (o comportamento não muda).
- `_shared/avatar-video.ts`: validação e decisões puras das lanes `avatar_video` e `video_agent`.
- `_shared/stt.ts`: o parser da saída STT.
- `director-advance`: `AVATAR_STEPS` e `AGENT_STEPS` ao lado de `REMAKE_STEPS`, escolhidos por `config.mode`. Os modos `remake` e o padrão (cenas) não mudam.

### 7.3 Custo

- **Linhas HeyGen no catálogo** (`provider = 'heygen'`): o motor procura `avatar_video` com `model_id` `heygen/avatar-iv`, `heygen/avatar-v` ou `heygen/avatar-iii` (o motor efetivo, com `_` trocado por `-`) e, sem essa linha, o primário HeyGen da capability. Para `video_agent`, procura `heygen/video-agent`. O `input_template` dessas linhas **não** é usado para montar o pedido: o corpo sai do `buildAvatarVideoBody`, que aplica as regras de compatibilidade entre look e motor (engine só se suportado, 4k só no avatar_iii, motion_prompt e expressiveness por tipo). As linhas servem para custo, `tier` e `label`.
- **HeyGen:** os preços **não estão verificados** (`catalogo-heygen.md` §0). O motor estima pela linha do catálogo `video_models` da capability `avatar_video` (por motor) ou `video_agent`, como faz com o Replicate. Sem a linha, grava só `costs.heygen_seconds` e deixa `heygen_usd_est` como `null`. A tela mostra "custo a confirmar".
- **ElevenLabs:** o motor não registra custo, igual a hoje.

### 7.4 Higgsfield: `director_state.hf_catalog`

Uma vez por dia, no tick do `director-advance` e só com o Higgsfield conectado, o motor chama `models_explore` (`search` para `video` e `image`) e grava:

```jsonc
{ "fetched_at": "ISO", "results": { "video": "<texto cru, ≤20k>", "image": "<texto cru, ≤20k>" }, "error": "string" | null }
```

Ninguém consome isso ainda. O formato da resposta do `models_explore` não está verificado (`catalogo-higgsfield.md` §2), por isso fica cru até alguém salvar uma resposta real e fixar o parser. A falha não afeta o tick.

## 8. Construtor de avatar

Um apresentador (`brand_avatars`) tem **um** avatar HeyGen, criado de uma destas três formas: foto (§2.1), clone (§3) ou descrição (§8.2). Depois, ele pode ganhar visuais novos (§8.4), ser apagado na HeyGen (§8.5) e ter a voz testada (§8.6). Todas as ações são do `avatar-studio` (admin, `POST`). Os erros seguem o §0: `412 not_connected` sem chave, e `502 heygen_error` com a frase pronta (sem créditos, chave recusada, limite ocupado).

Fonte: `docs/catalogo-heygen.md` §1, conferida na spec v3 (`CreatePromptAvatarRequest`, `CreateAvatarLooksRequestBody`, `LookTemplateItem`, `DELETE /v3/avatars/{group_id}`, `DELETE /v3/voices/{voice_id}`, `CreateSpeechV3Request`).

### 8.1 O registro: `brand_avatars.provider_refs.heygen`

As três formas gravam no **mesmo** registro, com este formato:

```jsonc
{
  // base (o que todo consumidor lê)
  "group_id": "string" | null,
  "look_id": "string",                       // look principal = avatar_id do vídeo
  "status": "processing" | "pending_consent" | "completed" | "failed",
  "supported_api_engines": ["avatar_v" | "avatar_iv" | "avatar_iii"],
  "preview_image_url": "string" | null,      // URL da HeyGen, expira; a cópia fica em reference_image_path (§8.10)
  "default_voice_id": "string" | null,       // twin: a voz clonada; foto/descrição: a voz padrão do grupo
  // extras
  "type": "photo" | "digital_twin" | "prompt",
  "consent_status": "pending" | "accepted" | "rejected" | null,   // só twin
  "consent_url": "string" | null, "consent_url_at": 1730000000000, // só twin
  "error": "string" | null,
  "ready": true | false,
  "looks": [{ "id", "status", "preview_image_url", "supported_api_engines", "source": "prompt" | "look_pack" | "template" }], // visuais extras (§8.4)
  "attempt": 0, "consent_attempt": 0, "updated_at": "ISO",
  // só type 'prompt': o pedido da criação, reaproveitado pelo "gerar de novo" (§8.2)
  "prompt": "string", "reference_paths": ["avatars/…"], "aspect_ratio": "9:16"
}
```

O formato antigo (de 29/10) usava `engines` no lugar de `supported_api_engines` e não tinha `preview_image_url`. A leitura aceita os dois formatos, e a próxima gravação (qualquer ação ou o `heygen_status`) já sai no formato novo.

`ready` é verdadeiro quando a look está `completed`. No twin, o consentimento também não pode estar `pending` nem `rejected` (§3).

### 8.2 Avatar por descrição: `action: 'heygen_prompt_avatar'`

```jsonc
{
  "action": "heygen_prompt_avatar",
  "avatar_id": "uuid",                 // obrigatório: o apresentador já criado (create)
  "prompt": "string",                  // opcional, ≤1.000; sem ele, usa o appearance_prompt do apresentador
  "reference_paths": ["avatars/<id>/ref-1.jpg"], // opcional, ≤3, caminhos no bucket brand-assets (vão como URL assinada)
  "aspect_ratio": "9:16"               // opcional: auto | 16:9 | 9:16 (padrão) | 1:1 | 4:5 | 5:4
}
// 200
{ "heygen": HeygenRef }                // type 'prompt', status 'processing'
```

A ação é idempotente como as outras: um ref que não falhou volta como está (409 se for de outro tipo).

**Gerar de novo:** com `"regenerate": true`, o motor faz três coisas:
- Reaproveita `prompt`, `reference_paths` e `aspect_ratio` salvos na criação anterior. Um campo mandado no pedido substitui o salvo.
- Apaga o avatar antigo na HeyGen (o mesmo procedimento do §8.5) e cria outro, com a Idempotency-Key da próxima tentativa (`heygen_next_attempt`).
- Se a foto do cadastro era a preview antiga (`…/heygen-preview.*`), ela sai, e a preview nova entra quando ficar pronta (§8.10).

Sem descrição salva e sem `prompt` no pedido, a resposta é `400` "Não encontramos a descrição usada antes. Descreva o apresentador para gerar de novo."

Erros:
- `400` "Descreva o apresentador em até 1.000 caracteres." (sem prompt e sem appearance_prompt, ou acima do limite)
- `400` "Use até 3 fotos de referência." ou "Foto de referência inválida." (caminho fora de `avatars/` ou com `..`)
- `404` "Apresentador não encontrado."

### 8.3 Acompanhar: `heygen_status` (o mesmo do §3)

`{ action: 'heygen_status', avatar_id }` → `{ heygen }`. A tela chama a cada 10 s enquanto `ready` for falso ou algum item de `looks` estiver `processing`. A ação lê a look principal, o grupo (no twin) e cada look extra ainda em processamento. Quando a look principal fica `completed`, ela também copia a preview para o bucket (§8.10).

### 8.4 Visual novo do mesmo avatar: `action: 'heygen_new_look'`

Exige um avatar HeyGen `completed`. Há dois modos.

**Por descrição** (`POST /v3/avatars` `type: 'prompt'`, com `avatar_id` = look principal e `avatar_group_id` = grupo):

```jsonc
{ "action": "heygen_new_look", "avatar_id": "uuid", "mode": "prompt", "prompt": "string ≤1000", "aspect_ratio": "9:16" }
```

**Por pacote** (`POST /v3/avatars/looks`, `type` `look_pack` ou `template`, com `reference_look_id` = look principal):

```jsonc
{ "action": "heygen_new_look", "avatar_id": "uuid", "mode": "look_pack" | "template", "template_id": "string ≤128", "aspect_ratio": "16:9" | "9:16" }
```

A lista de pacotes vem de `{ action: 'heygen_look_templates', type?: 'look_pack' | 'template', gender?: 'male' | 'female', limit?: 1-50, token? }`, que responde `{ templates: [{ id, type, name, gender, preview_image_url, looks_count }], next_token }`. O `type` do pedido tem de ser o `type` do item escolhido.

As duas formas respondem `{ heygen, new_look_ids: ["…"] }`. As looks novas entram em `heygen.looks` com `status: 'processing'`; o `heygen_status` acompanha. Para usar uma look extra num vídeo, a tela manda `config.avatar_video.look_id = <id>` (§1.3).

Erros:
- `400` "Este apresentador ainda não tem avatar pronto na HeyGen."
- `400` "Descreva o visual em até 1.000 caracteres."
- `400` "Escolha um pacote de visuais."

**TODO:** a spec não diz se `template` aceita `aspect_ratio` (ela documenta o campo só no `look_pack`). O motor manda `aspect_ratio` só no `look_pack`.

### 8.5 Apagar na HeyGen: `action: 'heygen_delete'`

```jsonc
{ "action": "heygen_delete", "avatar_id": "uuid" }
// 200
{ "ok": true, "deleted": { "group": "id" | null, "look": "id" | null, "voice": "id" | null } }
```

- Apaga o grupo inteiro (`DELETE /v3/avatars/{group_id}`), com todas as looks. Sem `group_id`, apaga a look (`DELETE /v3/avatars/looks/{id}`).
- A voz (`DELETE /v3/voices/{id}`) só é apagada no twin, porque é o clone. Em foto e descrição, a voz padrão é do catálogo da HeyGen e não é nossa.
- `404` da HeyGen conta como já apagado.
- Limpa `provider_refs.heygen`. O registro `brand_avatars`, as fotos, o `reference_image_path` e o `provider_refs.higgsfield` ficam.
- Erros: `404` "Apresentador não encontrado." · `400` "Este apresentador não tem avatar na HeyGen."

### 8.6 Testar a voz: `action: 'heygen_voice_preview'`

```jsonc
{
  "action": "heygen_voice_preview",
  "voice": { "provider": "elevenlabs" | "heygen" | "twin", "voice_id": "string" }, // voice_id é dispensável em twin
  "avatar_id": "uuid",               // obrigatório em twin (lê heygen.default_voice_id)
  "text": "string"                   // opcional, ≤200; padrão: frase curta fixa da marca
}
// 200
{ "url": "https://… (assinada, 1 h)", "path": "avatars/voice-previews/<hash>.mp3", "cached": true | false }
```

- `elevenlabs`: TTS `eleven_v3` com a chave do workspace.
- `heygen` e `twin`: `POST /v3/voices/speech` (`language: 'pt'`). O áudio é baixado para o bucket `brand-assets`.
- O mesmo provedor, voz e texto reaproveitam o arquivo (`cached: true`), sem pagar de novo.
- Erros:
  - `400` "Escolha uma voz para testar."
  - `400` "O texto de teste pode ter até 200 caracteres."
  - `400` "Este apresentador não tem voz clonada na HeyGen." (twin sem `default_voice_id`)
  - `412` sem chave (ElevenLabs ou HeyGen, conforme o provedor)
- **TODO:** a spec diz que "professional voice clones" usam outro endpoint (`/v3/models/audio/tts`). Não confirma que a voz do twin (clone instantâneo) passa no `/v3/voices/speech`. Conferir com um twin real.

### 8.7 Voz padrão do avatar: `brand_avatars.voice.heygen_voice`

A voz é gravada pelo `update` que já existe, com `{ action: 'update', avatar_id, voice: { heygen_voice, elevenlabs_voice_id? } }`. O `avatar-studio` junta isso com o que já estava salvo.

```jsonc
"heygen_voice": { "provider": "twin" | "elevenlabs" | "heygen", "voice_id": "string" } // voice_id dispensável em twin
```

No caso ElevenLabs, a tela grava o mesmo id também em `voice.elevenlabs_voice_id`, que é o campo que o Diretor de cenas já lê. Um valor inválido responde `400` "Voz padrão inválida. Escolha de novo." (provedor fora da lista, Voice ID ElevenLabs fora do formato, ou HeyGen sem `voice_id`). `null` apaga a voz padrão.

**Ordem de precedência** nas lanes `avatar_video` e `video_agent`:
1. **Voz do job:** `voice.voice_id` (ou `video_agent.voice_id`).
2. **`heygen_voice` do apresentador:** twin usa a voz clonada (`heygen.default_voice_id`); `elevenlabs` gera o áudio pela ElevenLabs; `heygen` manda o `voice_id` para a HeyGen.
3. **O comportamento de antes:** o provedor do job; HeyGen sem id usa a voz da look; ElevenLabs sem id usa a regra da marca.

Mais três regras:
- Um job que escolheu só o **provedor** (por exemplo `voice: { provider: 'heygen' }`) não recebe a voz salva de **outro** provedor: a voz `elevenlabs` salva não entra num job HeyGen, e vice-versa.
- O apresentador vem de `presenter_id` ou do grupo HeyGen da look (`look_id` de um visual dele).
- No `provider: 'replicate'` só vale voz ElevenLabs.

A decisão fica em `artifacts.avatar.voice_provider`, `voice_source` (`job` · `avatar` · `default`), `voice_id` ou `eleven_voice_id`.

### 8.8 Escolher o visual no vídeo: `config.avatar_video.look_id`

O campo continua sendo `look_id`, sem outro nome.
- **Só `look_id`:** qualquer look (da biblioteca ou um visual de um apresentador).
- **`presenter_id` + `look_id`:** o visual tem de ser a look principal do apresentador ou um item de `provider_refs.heygen.looks[]`. Fora disso, o job falha com "Esse visual não é de “Nome”. Escolha um dos visuais dele e crie o vídeo de novo."
- **Visual extra ainda em processamento:** o job espera até 30 min, como o avatar.
- **Visual `failed`:** "O visual escolhido de “Nome” falhou na HeyGen (…). Escolha outro."
- **Só `presenter_id`:** a look principal, como antes.

O motor (`engine`) é sempre conferido no `supported_api_engines` da look **escolhida** (§1.5).

Esta regra também vale para o `video_agent` (`presenter_id` + `look_id`).

### 8.9 Trocar a foto do apresentador: `update` com `reference_image_path`

Não existe ação nova: o `update` que já existe passou a aceitar foto nova.

```jsonc
{ "action": "update", "avatar_id": "uuid",
  "reference_image_path": "avatars/uploads/<arquivo>.jpg",          // foto nova já enviada ao bucket brand-assets
  "identity_pack_paths": ["avatars/uploads/a.jpg", "avatars/<id>/ref-1.jpg"] } // opcional, 1-3: troca o pack inteiro
// 200 { "ok": true }
```

Cada caminho tem de vir de um destes três lugares:
- do pack atual (curadoria, como antes);
- da pasta do próprio avatar (`avatars/<id>/…`, conferida no bucket);
- de um upload novo (`avatars/uploads/…`, o mesmo prefixo do `create`). O motor move o upload para `avatars/<id>/ref-<ts>.<ext>`.

Qualquer outro caminho (outro avatar, `..`, fora do bucket) responde `400` "Essa foto não pertence a este avatar." Uma foto nova vira a principal e entra no início do pack (máximo 3).

Ao trocar o rosto, o element do Higgsfield é solto, e o Diretor prepara outro na próxima vez que usar a pessoa (`updatePresenterFace`, como antes). O avatar HeyGen não muda: para a HeyGen usar a foto nova, é preciso apagar o avatar (§8.5) e criar de novo (§2.1).

### 8.10 Outros provedores com o mesmo apresentador

Os provedores não se misturam. Cada job lê só o ref do seu provedor: `heygen` nas lanes HeyGen, `higgsfield` no Diretor de cenas e as fotos do cadastro no Replicate.

- **Replicate:** as referências são `reference_image_path` e `identity_pack_paths`, como hoje. Quando a look principal fica `completed` e o apresentador não tem `reference_image_path`, o motor baixa a preview da HeyGen para `brand-assets/avatars/<id>/heygen-preview.<ext>` e grava esse caminho. Isso vale para descrição e foto; o twin também ganha a foto quando falta. Assim, o avatar criado por descrição já serve para Replicate e Higgsfield.
- **Higgsfield:** o element continua **sob demanda**, como hoje. Ele não é criado junto com o avatar: só nasce quando um job do Diretor de cenas usa a pessoa pela primeira vez (`resolveIdentity` pede, `stepPresenters` cria, e o job espera até 30 min). As fotos são as do cadastro. Sem nenhuma foto, o motor usa a preview da HeyGen (relida na HeyGen para não usar uma URL vencida).

## 9. Construtor de voz

Fonte: `docs/construtor-de-voz.md` (§3.3, §4.4 e §5), com os campos conferidos na OpenAPI do ElevenLabs e na spec v3 da HeyGen, baixadas em 30/10. Todas as ações são do `avatar-studio` (admin, `POST`) e seguem o §0: erro em `{error:{code,message}}` com a frase pronta, `412 not_connected` quando falta a chave do provedor, e `Idempotency-Key` `voice:<brand_voice_id>:<n>` em toda criação na HeyGen. **Nenhuma ação foi testada contra os provedores** (§9.6).

### 9.1 O registro: tabela `brand_voices` (`supabase/sql/brand-voices.sql`)

Os campos são os de `docs/construtor-de-voz.md` §3.3, mais `attempt` (tentativa da Idempotency-Key), `created_by` e `updated_at`. A RLS segue `brand_avatars`: leitura para `authenticated` e escrita só pelo service role, ou seja, pelo `avatar-studio`. O índice único parcial `brand_voices_one_default` garante no máximo uma voz `is_default`.

Toda resposta de voz traz um `BrandVoice`:

```jsonc
{
  "id": "uuid", "name": "string",
  "provider": "elevenlabs" | "heygen",
  "provider_voice_id": "string" | null,   // null só enquanto o clone HeyGen é criado
  "source": "clone" | "design" | "library" | "pasted" | "twin",
  "status": "processing" | "ready" | "failed",
  "error": "string" | null,               // frase pronta quando failed
  "gender": "female" | "male" | null, "language": "pt",
  "owned": true | false,                  // criada por nós: só essas são apagadas no provedor
  "is_default": true | false,
  "preview_url": "string" | null,         // assinada, 1 h (cache em preview_path)
  "created_at": "ISO"
}
```

### 9.2 Ações

| Ação | Payload | Resposta | Erros |
|---|---|---|---|
| `voice_options` | `{}` | `{ paths: { own, describe, library, paste }: { provider: 'elevenlabs'\|'heygen'\|null, blocked_reason: string\|null, cost_label: string }, eleven: { connected, can_clone: bool\|null, slots_used, slot_limit, tier }, heygen: { connected } }` | nunca falha. `blocked_reason` vem pronto, ex.: "Conecte o ElevenLabs ou a HeyGen para criar vozes." |
| `voice_upload_url` | `{ content_type: 'audio/wav' \| 'audio/mpeg' }` | `{ path: 'voices/uploads/<uuid>.wav\|mp3', token }` (bucket `brand-assets`, `uploadToSignedUrl`) | 400 "Envie o áudio em WAV ou MP3." |
| `voice_clone` | `{ name ≤60, sample_path: 'voices/uploads/…', consent: true, gender?: 'female'\|'male', duration_s?: number, avatar_id?: uuid }` | `{ voice }`: `ready` pelo ElevenLabs (IVC) ou `processing` pela HeyGen (clone instantâneo) | 400 "Confirme que a voz é sua." · 400 "Grave pelo menos 30 s." (abaixo de 10 s; WAV medido pelo cabeçalho, MP3 pelo `duration_s` da tela) · 409 `slots_full` "As vagas de voz do ElevenLabs estão cheias (N/M)." · 412 · 402 "Os créditos do {provedor} acabaram." · 429 `daily_limit` "Limite de clones de hoje atingido. Tente amanhã ou use outro caminho." |
| `voice_design` | `{ description: 20–1000, gender? }` | `{ provider, previews: [{ preview_id, url }] }` (até 3; `preview_id` é opaco) | 400 "Descreva a voz com 20 a 1.000 caracteres." · 412 · 402 |
| `voice_design_save` | `{ preview_id, name ≤60, description }` | `{ voice }` (`source: 'design'`) | 404 "A prévia expirou. Gere de novo." · 409 `slots_full` |
| `voice_library` | `{ search?, gender?, token? }` | `{ provider, voices: [{ ref, name, gender, accent, preview_url }], next_token, notice: string\|null }` | nunca falha por plano: a biblioteca do ElevenLabs recusada (403, `free_users_not_allowed`) ou sem chave vira o catálogo pt da HeyGen, com `notice` "Biblioteca do ElevenLabs exige plano Creator." |
| `voice_library_add` | `{ provider, ref, name? }` | `{ voice }` (`source: 'library'`). ElevenLabs: `POST /v1/voices/add/{public_user_id}/{voice_id}`; HeyGen: só grava a linha | 403 "Esta voz da biblioteca exige o plano Creator do ElevenLabs." |
| `voice_import` | `{ voice_id, name? }` | `{ voice }` (ElevenLabs, `source: 'pasted'`, depois de `GET /v1/voices/{id}`) | 404 "Esse Voice ID não existe no ElevenLabs." |
| `voice_import` (de Integrações) | `{ from_settings: true }` | `{ voice }`: o `ELEVEN_VOICE_ID` do Vault vira uma linha (`source: 'pasted'`). O nome vem de `GET /v1/voices/{id}`, com reserva "Voz da marca". É idempotente: se a linha com esse Voice ID já existe, ela volta como está | 400 "Nenhuma voz da marca configurada em Integrações." |
| `voice_status` | `{ voice_id: uuid }` | `{ voice }`. Lê `GET /v3/models/audio/voices/{id}` enquanto o clone HeyGen está `processing` (PENDING → ACTIVE \| FAILED) | 404 "Voz não encontrada." |
| `voice_set_default` | `{ voice_id: uuid }` | `{ ok: true, eleven_voice_id_synced: bool }` | 400 "A voz ainda não está pronta." · 404 |
| `voice_delete` | `{ voice_id: uuid }` | `{ ok: true, deleted_at_provider: bool }` | 409 "Essa é a voz padrão. Escolha outra antes." · 404 |
| `heygen_voice_preview` (já existe) | aceita também `{ brand_voice_id: uuid }` no lugar de `voice` | a mesma de hoje (`{url, path, cached}`) | 400 "A voz ainda não está pronta." · os de hoje |

### 9.3 Como cada caminho escolhe o provedor (`voice_options`)

| Caminho | Primeiro | Depois | Bloqueado quando |
|---|---|---|---|
| `own` (clone) | ElevenLabs IVC, se `can_use_instant_voice_cloning` e `voice_slots_used < voice_limit` | HeyGen clone instantâneo (`POST /v3/models/audio/voices`, `mode: 'instant'`, `language: 'pt'`, `similarity: 'max'`) | nenhum dos dois conectado, ou ElevenLabs sem IVC/vagas e HeyGen desconectada |
| `describe` | ElevenLabs Voice Design (`eleven_ttv_v3`, 3 prévias, texto pt-BR fixo) | HeyGen `POST /v3/voices` (`locale: 'pt-BR'`). A spec diz "matching voices": devolve vozes **do catálogo** parecidas com a descrição, não uma voz nova | nenhum conectado |
| `library` | ElevenLabs `GET /v1/shared-voices` (`language: 'pt'`, `locale: 'pt-BR'`) | catálogo HeyGen (`GET /v3/voices`, Portuguese) | nenhum conectado |
| `paste` | ElevenLabs | — | ElevenLabs desconectado |

O `voice_clone` decide de novo no servidor, e não só pelo `voice_options`: se o IVC recusar (plano ou permissão) e a HeyGen estiver conectada, o clone vai para a HeyGen. `cost_label` vem das linhas `video_models` `voice_create` (§6 do doc da voz): verificado com US$ 0 vira "grátis", não verificado vira "a confirmar". Sem linha, o texto é fixo.

### 9.4 Estados e polling

- **ElevenLabs** (IVC, design, biblioteca, colar): a voz nasce `ready`.
- **Clone HeyGen**: nasce `processing`. A tela chama `voice_status` a cada 3 s com o modal aberto, por no máximo 2 min. Depois disso mostra "Está demorando mais que o normal. Pode fechar: avisamos em Vozes." `voice_status` também serve depois, na lista de Vozes.
- **Falhas do clone HeyGen** (`failure_reason`):
  - `INVALID_AUDIO` / `INSUFFICIENT_AUDIO`: "Não deu para usar esse áudio. Grave de novo num lugar quieto."
  - outros: "A HeyGen não conseguiu criar a voz ({código}). Tente de novo."

### 9.5 Onde a voz vale (motor)

**Ordem da voz da narração** (Diretor de cenas, remake e voz ElevenLabs dos vídeos de avatar):
1. a voz do job: `config.brand_voice_id` no Diretor, `remake.brand_voice_id` (ou o Voice ID colado de hoje) no remake;
2. a voz ElevenLabs do apresentador (`voice.elevenlabs_voice_id`, como hoje);
3. **a voz padrão de `brand_voices`** (`is_default`, `ready`);
4. `ELEVEN_VOICE_ID`;
5. a regra por gênero.

A troca por gênero continua valendo nos passos 3 e 4: uma voz padrão de gênero conhecido que contradiz o personagem cede para a voz do gênero, como acontece hoje com a `ELEVEN_VOICE_ID`. Sem nenhuma linha em `brand_voices` (ou sem a tabela), o caminho é o de hoje.

**Vídeos de avatar HeyGen** (§8.7): a ordem fica voz do job → `heygen_voice` do apresentador → **voz padrão de `brand_voices`** (quando cabe no provedor do job) → o comportamento de antes. `voice.brand_voice_id` no job conta como voz do job. Quando a voz vem do `heygen_voice` do apresentador (`provider: 'heygen'`) e o `voice_id` é de um **clone HeyGen Voice** em `brand_voices` (`source: 'clone'`, pronto), ela segue pela rota de áudio, nos ramos HeyGen e Replicate. Uma voz de catálogo continua indo como `voice_id`.

**`speechBytes`** (`_shared/voices.ts`) gera o áudio pelo provedor da voz:
- ElevenLabs: `eleven_v3`, como hoje.
- Clone HeyGen Voice (`source: 'clone'`): `POST /v3/models/audio/tts`, `heygen-voice-1`, pedindo **MP3 de 128 kbps a 44,1 kHz** (`output_format`). Assim a medição de duração que o remake já faz (MP3 de 128 kbps) continua certa.
- Voz do catálogo HeyGen (design, biblioteca, twin): `POST /v3/voices/speech`, que devolve a duração pronta.

Nos vídeos de avatar, uma voz HeyGen de catálogo vai como `voice_id`. Um clone HeyGen Voice vai como áudio (`audio_url`), porque a spec só garante o `voice_id` desses clones no TTS próprio.

**`voice_set_default`** marca a linha e, quando a voz é do ElevenLabs, também grava `ELEVEN_VOICE_ID` no Vault pelo `store_vault_secret` com o JWT de quem chamou, que precisa ser admin. É o mesmo valor que Config → Integrações já mostra e que `narrationVoice` lê. Falhar nessa gravação não desfaz a marcação: a resposta volta com `eleven_voice_id_synced: false`.

**Remake, "A minha voz"**: quando o IVC do ElevenLabs é recusado e a HeyGen está conectada, o motor faz um clone HeyGen temporário (`remake-<job>`). Ele espera o clone ficar `ACTIVE` por até 30 s, fala pelo TTS em MP3 de 128 kbps e apaga o clone no fim, mesmo quando dá erro. Se a HeyGen falhar ou demorar, vale a voz do gênero, como hoje. O cartão recebe a nota de qual voz foi usada.

### 9.6 Testes pendentes (depois do deploy, com as chaves do dono)

Os itens do `docs/construtor-de-voz.md` §8 continuam **pendentes**: não temos as chaves localmente e nenhuma chamada real foi feita.
1. Criar um clone HeyGen (`POST /v3/models/audio/voices`, `instant`, `pt`) e conferir:
   - `GET .../{id}` chega a `ACTIVE`;
   - o `voice_id` fala em `/v3/models/audio/tts` (MP3 128 kbps);
   - o `voice_id` funciona em `POST /v3/videos` (`script` + `voice_id`). Se não funcionar, a regra de mandar como `audio_url` já cobre.
2. Na conta Pay-as-you-go do ElevenLabs, ver se `POST /v1/text-to-voice/design` e `GET /v1/shared-voices` funcionam pela API. Se forem recusados, o `voice_options` e o `voice_library` já trocam para a HeyGen.
3. Conferir que o clone instantâneo do twin fala em `/v3/voices/speech` (TODO do §8.6).
4. Conferir o formato do áudio de `/v3/voices/speech`. A spec não diz; o motor usa a `duration` devolvida, não o tamanho do arquivo.

## 10. Editar uma cena de um vídeo pronto

Vale para os vídeos do **Diretor de cenas** (`director_jobs` sem `config.mode`) com `status: 'done'`. Avatar HeyGen, Video Agent e Remake não têm cenas: o `edit_modes` deles volta vazio, com o motivo (§10.2). Nenhuma chamada real foi feita.

### 10.1 Onde fica e por quê

- **Ações:** na edge **`video-remake`**. Ela já é a porta da tela para mexer em vídeo pronto, já exige JWT e já confere admin (`has_role`). A checagem de "workspace" é a mesma de todas as edges: a instância é o workspace, só admin chama, e o job precisa existir nesta instância.
  - O `director-advance` não serve para isso: ele é o motor do cron e aceita o segredo do cron.
  - O `avatar-studio` também não, porque cuida de avatares e vozes.
- **O trabalho:** roda no **`director-advance`**, num terceiro slot por tick. Ele pega um job `done` com `artifacts.final_rebuilding = true`, com o mesmo lease dos outros slots. Cada tick faz um passo, como o resto do motor.
- **Sem status novo:** o job continua `done` o tempo todo. O vídeo pronto continua válido e assistível durante a edição, e uma edição que falha **nunca** muda o status para `failed`: a falha fica só em `scene_edits[shot]`.
- **Sinal de remontagem:** é `artifacts.final_rebuilding: true`, e não um status. Assim a constraint de `status` não muda, as listas de "prontos" continuam iguais, e o `final` antigo segue servindo até o novo ficar pronto.

### 10.2 Ler (artifacts do job, via Realtime)

**`edit_modes`** é gravado pelo motor quando a tela chama `scene_edit_options` e é atualizado ao fim de cada edição. A chave é o número da cena (`shot.idx`, em string no JSON):

```jsonc
"edit_modes": {
  "3": {
    "edit": { "available": true, "usd": 0.85, "model_id": "kwaivgi/kling-v4.0", "reason": null },
    "redo": { "available": true, "usd": 1.12, "reason": null },
    "scope": [3, 4]                        // cenas afetadas (o grupo multi-cena inteiro)
  }
},
"edit_modes_at": "ISO"
```

| Campo | Regra |
|---|---|
| `scope` | os `members` do clipe que contém a cena. Uma cena fora de grupo tem `[shot]`. Num grupo multi-cena, editar ou refazer **uma** cena refaz o clipe do grupo inteiro: as cenas do grupo dividem um clipe só (`videos[].members`), e não dá para trocar só um trecho dele sem refazer as outras |
| `edit.available` | existe uma linha ativa `scene_v2v` do Replicate (`provider = 'replicate'`) cujos `limits` aceitam a duração do clipe (`duration_min`/`duration_max`/`max_duration_s`), **e** o Replicate está conectado. O modelo é escolhido pelo catálogo, sem lista fixa no código: o primário, se couber; senão o mais barato que couber. Exemplos do catálogo de hoje: Kling 4.0 (3–30 s), Wan 2.7 Edit (2–10 s), Aleph 2 |
| `edit.usd` | `estimateCostUsd(linha, {duration_s: duração do clipe, resolution})`. Sem preço → `null` |
| `redo.available` | Para refazer, o quadro e o clipe são gerados de novo no motor do job: Higgsfield conectado (o quadro é sempre do Higgsfield) e, se o motor do job for o Replicate, o token do Replicate e uma linha `scene_i2v` ativa |
| `redo.usd` | motor Replicate: o custo do clipe (`scene_i2v`, duração da unidade, resolução de `config.resolution`); o quadro é crédito Higgsfield e fica fora. Motor Higgsfield: `null` (crédito, sem preço em US$) |
| `reason` | frase pronta quando `available: false`. Exemplos: "Editar com texto precisa do Replicate conectado." · "A cena tem 14 s; os modelos de edição aceitam até 10 s." · "Refazer precisa do Higgsfield conectado." · "Vídeo de avatar não tem cenas: gere de novo pelo hub." |

O custo vai para a tela no formato do GenerationGate: "Estimativa: até US$ X". Com `usd: null`, a tela mostra o aviso "Preço a confirmar" e **não bloqueia**.

**`scene_edits`** guarda uma entrada por cena tocada:

```jsonc
"scene_edits": {
  "3": { "status": "running" | "done" | "failed", "kind": "edit" | "redo" | "undo", "prompt": "string",
         "error": "string" | null, "can_undo": true, "scope": [3, 4], "started_at": 0, "finished_at": 0 }
}
```

O clipe novo entra em `artifacts.videos` no lugar do anterior, e só **quando o final novo fica pronto**. O anterior é guardado em `artifacts.video_versions["<âncora>"]`, uma pilha de `VideoArt` (o mesmo formato de `videos[]`). `can_undo` é verdadeiro quando essa pilha não está vazia. Quem está no meio de uma edição fica em `artifacts.edit_active`, um estado interno do motor que a tela só precisa ler para mostrar a fase (`keyframe` · `video` · `assemble` · `captions`).

**`final_rebuilding`** fica `true` do pedido até o fim da remontagem, com sucesso ou falha. Enquanto isso, `artifacts.final` aponta para o vídeo anterior. Quando a edição dá certo, `master` e `final` passam a apontar para os arquivos novos (`director/<job>/master-e<n>.mp4`, `final-e<n>.mp4`); os antigos ficam no bucket.

### 10.3 Chamar (`video-remake`, `POST`, admin)

| Ação | Payload | Resposta | Erros |
|---|---|---|---|
| `scene_edit_options` | `{ job_id }` | `{ edit_modes, edit_modes_at }` (também grava em `artifacts`) | 404 "Vídeo não encontrado." |
| `scene_edit` | `{ job_id, shot, kind: 'edit' \| 'redo', prompt }`. `prompt`: em `edit` é obrigatório (3–500), o que mudar no clipe; em `redo` é opcional (até 500), um ajuste somado ao prompt original da cena | `{ ok: true, scope, estimate: { usd, label } }`. `label` = "Estimativa: até US$ X" ou "Preço a confirmar" | 404 vídeo/cena · 409 "O vídeo ainda não está pronto." · 409 "Já há uma edição em andamento neste vídeo. Espere terminar." · 400 o `reason` do `edit_modes` · 400 "Diga o que mudar na cena." |
| `scene_undo` | `{ job_id, shot }` | `{ ok: true, scope }` | 409 os mesmos de cima · 400 "Não há versão anterior desta cena." |

Fluxo depois do pedido: o tick monta a cena e remonta o final. A tela acompanha só pelo Realtime de `director_jobs`.

### 10.4 O que cada operação faz

- **Editar com texto (`edit`):** o prompt é traduzido para uma instrução curta em inglês, como no remake, com "mantenha o resto igual". O `scene_v2v` roda sobre o clipe atual da cena (`base_video`/`video` pelo template da linha), na mesma duração (os modelos do catálogo preservam a duração; um clipe fora dos limites já sai bloqueado no `edit_modes`) e na resolução que o modelo aceita perto de 1080p. O resultado substitui o clipe da âncora e o final é remontado. Roteiro, voz, quadros e trilha não mudam.
- **Refazer (`redo`):** gera um quadro novo para a âncora da unidade (Higgsfield, o mesmo prompt + `look_lock` + o apresentador já resolvido no job, mais o ajuste quando a cena pedida é a âncora). Depois gera um clipe novo da unidade inteira no motor do job, com a mesma duração e o prompt de movimento de sempre, mais o ajuste marcado com o número da cena dentro do grupo. Em seguida remonta o final. Narração e trilha não mudam. O áudio nativo de CTA (`cta_audio_ref`) não é refeito: o CTA refeito entra narrado.
- **Desfazer (`undo`):** volta o clipe anterior da pilha da âncora e remonta.
- **Remontagem:** é a mesma montagem do sandbox (mux, trilha e loudnorm), gerando arquivos novos.
  - Com legendas ligadas (`config.captions !== false`), o STT roda de novo sobre o master novo, porque a duração do clipe pode mudar alguns décimos, e a legenda é queimada.
  - Sem legendas, o final é cópia do master, como hoje.
- **Falha em qualquer fase:** `scene_edits[shot] = failed` com a frase, `edit_active` limpo e `final_rebuilding: false`. O vídeo e os artifacts de antes continuam intactos. Uma predição paga que estoura o prazo (40 min no Replicate, 12 min no Higgsfield) também conta como falha da edição.

### 10.5 TODO (não confirmado nos catálogos)

- **Edição pelo Higgsfield:** `seedance_2_5` (modo `video_edit`) e `kling_video_edit` existem na CLI/SK, mas o schema das tools no MCP **não está verificado** (`catalogo-higgsfield.md` §3). Por isso o motor ainda não edita pelo Higgsfield: `edit` usa só as linhas `scene_v2v` do Replicate. Quando o schema for confirmado, entra como linha de catálogo com `provider: 'higgsfield'`.
- **Avatar HeyGen ("só refazer"):** sem cenas, o refazer equivale a gerar o vídeo de novo, o que já é o "Retomar" ou um job novo. Não há ação própria.
- **`max_bytes` do modelo de edição** (ex.: Kling 4.0 aceita até 300 MB): o tamanho do clipe não é conferido antes de enviar. Os clipes do Diretor ficam bem abaixo disso.

## 11. Aprimorar com IA (`video-edit`)

Plano: `docs/motor-de-edicao.md`. Esta seção é o contrato que vale para tela, SQL e motor. A v1 é só ffmpeg, no sandbox do Higgsfield. O Claude **escolhe operações de um menu fechado**; ele não escreve comando. O vídeo de origem nunca é alterado nem apagado.

### 11.1 Tabela `video_edits` (SQL da -11, em `supabase/sql/video-edits.sql`)

```sql
create table if not exists public.video_edits (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('job', 'path')),
  source_id uuid references public.director_jobs(id) on delete cascade, -- source_kind = 'job'
  source_path text not null,            -- objeto no bucket renders que foi analisado
  status text not null default 'analyzing' check (status in
    ('analyzing', 'suggested', 'queued', 'rendering', 'checking', 'ready', 'failed', 'reverted')),
  analysis jsonb not null default '{}', -- transcrição, ffprobe, quadros, sugestões (11.3)
  plan jsonb,                           -- operações escolhidas no apply (11.4)
  artifacts jsonb not null default '{}',-- estado interno do motor (pending_*, tentativas de QA)
  output_path text,                     -- renders/edits/<id>/out.mp4 quando ready
  qa jsonb,                             -- { ok, checks[], notes } do QA (11.5)
  cost_usd numeric(10,4) not null default 0,
  error text,                           -- frase humana; nunca código/inglês
  auto boolean not null default false,  -- criado pela chave da Automação
  created_by uuid references auth.users(id) on delete set null,
  claimed_by text,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists video_edits_source_idx on public.video_edits (source_id, created_at desc);
create index if not exists video_edits_active_idx on public.video_edits (status)
  where status in ('analyzing', 'queued', 'rendering', 'checking');
-- trigger set_updated_at() igual ao de brand_voices
alter table public.video_edits enable row level security;
create policy "video_edits_admin_read" on public.video_edits for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));
revoke all on table public.video_edits from public, anon;
grant select on table public.video_edits to authenticated;
grant all on table public.video_edits to service_role;
alter publication supabase_realtime add table public.video_edits;  -- idempotente: envolver em do $$ … exception
```

Escrita só pelo `video-edit` (service role). Chave da Automação: `app_settings` key `video_edit`, value `{"auto": boolean}`, desligada por padrão (-11, `supabase/sql/video-edit-setting.sql`).

### 11.2 Ações (`video-edit`, `POST`, JWT de admin; o tick usa `x-cron-secret`)

| action | entrada | saída | erros |
|---|---|---|---|
| `suggest` | `{ source: { job_id } \| { path } }` | `202 { edit_id }`. A análise roda no tick; a tela acompanha `status` `analyzing → suggested` pelo Realtime. Se já existe análise `suggested` do mesmo vídeo, devolve `200 { edit_id }` dela | 404 "Vídeo não encontrado." · 409 "O vídeo ainda não está pronto." · 400 "Conecte o Claude em Integrações." · 400 "Conecte o Higgsfield para editar." |
| `apply` | `{ edit_id, suggestion_ids: string[] }` ou `{ edit_id, ops: Op[] }` (chips de ajuste fino) | `202 { edit_id, estimate: { usd, label } }`. `status → queued` | 409 "Já há uma edição em andamento neste vídeo." · 400 "Escolha ao menos uma sugestão." · 400 "Operação inválida." |
| `status` | `{ edit_id }` | `{ status, suggestions?, plan?, output_url?, qa?, error?, cost_usd }`. `output_url` assinada por 6 h | 404 |
| `revert` | `{ edit_id }` | `{ ok: true }`. `status → reverted`; a peça mostra o original | 404 |
| `probe` | `{ scribe?: boolean, job_id? }` | `{ sandbox: { node, chrome, ffmpeg, filters, hyperframes_ready, raw }, scribe?: { events: string[], types: string[], sample } }` | só admin. `scribe:true` gasta ~US$ 0,01 e só roda com OK do Samuel |
| `tick` | `{ edit_id? }` | `202 { ok: true }`. Com `edit_id`, retoma aquela edição; sem ele, retoma a parada há mais tempo e aplica a chave da Automação (11.6) | JWT de admin ou `x-cron-secret` (`VIDEO_CRON_SECRET`) |

Uma edição por vídeo de cada vez. Reaplicar com outros chips cria **uma edição nova** (linha nova) a partir do mesmo original, nunca da versão editada.

### 11.3 Formato de `analysis.suggestions` (os ladrilhos)

```ts
type Suggestion = {
  id: 'clean' | 'tight' | 'hook' | 'brand' | 'sound' | 'surprise';
  title: string;            // "Cortar respiros", curto, verbo no infinitivo
  gain: string;             // "−6 s de respiro", "gancho em 1,5 s", "logo e encerramento"
  why: string;              // 1 frase do Claude, mostrada só ao abrir o ladrilho
  recommended: boolean;     // já vem marcado
  ops: Op[];                // o que será aplicado (a tela não precisa ler)
  preview: {
    before: { thumb_url: string; duration_s: number };
    after:  { thumb_url?: string; duration_s: number }; // after.thumb_url só quando há quadro de marca (abertura/encerramento) gerado na análise
  };
  usd: number;              // custo desta sugestão isolada (Claude da renderização + QA)
};
analysis = { suggestions: Suggestion[]; duration_s: number; words: number; cost_usd: number /* análise já gasta */ };
```

No máximo 4 sugestões. `surprise` só existe na v1.5 (HyperFrames). Estimativa da tela: soma de `usd` das marcadas; texto "Estimativa: até US$ X".

### 11.4 Menu de operações (`Op`, v1)

| `type` | campos | o que o compilador faz |
|---|---|---|
| `trim_silences` | `pad_ms` (40–200, padrão 80), `min_gap_ms` (250–1500, padrão 400) | mantém só os trechos com fala (palavras do Scribe), com folga e crossfade de 10 ms |
| `cut_words` | `word_idxs: number[]`, `reason` | remove vícios e repetições marcados pelo Claude |
| `hook_first` | `word_from`, `word_to` | leva essa frase para o começo (≤ 4 s) |
| `punch_in` | `zoom` (1.05–1.2, padrão 1.12) | alterna 100% e `zoom` a cada corte |
| `speed` | `ranges: {word_from, word_to, factor (1.05–1.25)}[]` | acelera trechos lentos |
| `captions` | `style` (`caps` \| `karaoke`), `position` (`bottom` \| `center` \| `top`) | legenda nova, retimada aos cortes, com a palavra falada na cor de destaque da marca. Só quando a origem não tem legenda queimada: job com `config.captions = false`, ou vídeo por `path` |
| `voice_clean` | — | `highpass=f=80`, `afftdn`, de-esser leve |
| `music_duck` | `volume_db` (−24 a −12) | **fora do menu do Claude na v1.** O `final` do job já vem com a trilha mixada, então não há faixa separada. O compilador está pronto para quando houver (trilha nova do ElevenLabs) |
| `loudness` | — | `loudnorm` −14 LUFS (sempre ligado no fim) |
| `brand_intro` | `seconds` (1–1.5) | logo com fade e flash na cor primária sobre quadro desfocado. Nunca com fala nos 2 s iniciais: a validação recusa |
| `brand_watermark` | `corner` (`tr`\|`tl`\|`br`\|`bl`), `opacity` (0.5–0.85) | logo a 14% da largura, depois do gancho |
| `brand_outro` | `seconds` (1.5–3), `cta` (≤ 40 caracteres) | logo + @perfil + CTA sobre a cor primária, áudio em fade |
| `lower_third` | `name`, `role`, `at_s` | faixa na cor da marca, 3 s |
| `color` | `preset`: `neutral` \| `warm` \| `cool` \| `punch` | `eq` suave; LUT da marca na v1.5 |

Logo: `brand_kit.content.logo_alpha_path` se existir, senão `logo_path` (bucket `brand-assets`), em PNG, JPG ou WebP. SVG conta como sem logo. Logo sem alfa: o fundo é recortado na hora (`colorkey` pela cor do canto), sem gravar arquivo novo; funciona para fundo liso. Sem logo: as `brand_*` somem das sugestões. Limite conhecido: logo da mesma cor da primária some no encerramento, que usa a primária de fundo.

Textos (nome, cargo, @, CTA) vão em ASS, nunca no filtro nem no shell: o libass já roda no sandbox e o `drawtext` não existe em toda build.

### 11.5 Fases (lease igual ao do Diretor; prazo de 12 min por pending)

A própria edge avança: `suggest` e `apply` respondem na hora e seguem em background; perto de 100 s ela chama a si mesma (`tick`) com o mesmo `Authorization`. Não depende do `director-advance`. Se o runtime cair no meio, o watchdog `mark_stale_video_edits_failed` (`video-edits.sql`) marca `failed` depois de 20 min parada.

1. `analyzing`: o sandbox tira ffprobe, 8 quadros e o áudio leve; o Scribe v2 transcreve (`tag_audio_events`). Claude `claude-sonnet-5-5` responde em saída estruturada (`output_config.format`; esse modelo recusa `tool_choice` forçado) e `normalizeOps` valida cada operação → `suggested`.
2. `queued → rendering`: o compilador gera o filtro (vai pelo bucket, como o ASS; `-filter_complex "$(cat filter.txt)"` serve para ffmpeg 6 e 7+) e o sandbox roda em background → `renders/edits/<id>/out.mp4`. Até 300 cortes por vídeo.
3. `checking`: medidas no sandbox (duração esperada ± 0,3 s ou 0,04 s por corte, tem áudio, loudness entre −16 e −12 quando há fala) e 4 quadros conferidos pelo Claude (texto fora da tela, legenda sobreposta, logo ilegível). Uma correção automática no máximo; se falhar de novo, `failed` com "A edição não passou na conferência. O vídeo original continua igual." → `ready`.

### 11.6 Na tela

- O job ganha `artifacts.edited = { edit_id, path, source_final }` quando `ready`, e perde o campo no `revert`. A versão "Editada" é essa; "Original" é `artifacts.final`, que o motor de edição nunca mexe.
- O que vai ao ar vem de `publishablePath` (`_shared/publishable-video.ts`), no TikTok (`director-advance`) e no Instagram (`zernio-proxy`): `edited.path` só quando `source_final` é o `final` atual e não há remontagem. Editar ou desfazer uma cena gera um `final` novo: `artifacts.edited` sai do job e as edições `suggested` e `ready` viram `reverted`.
- Automação: com `video_edit.auto = true`, cada `tick` sem `edit_id` pega um vídeo pronto nas últimas 6 h, ainda sem edição, e aplica as recomendadas (`auto: true`), respeitando o teto mensal. **Ainda não há agendamento chamando esse `tick`** (11.7).
- Teto: `video_month_spend_usd()` + `video_edits.cost_usd` do mês contra `video_budget.monthly_cap_usd`; estourou, `402 video_budget_exhausted`.

### 11.7 Falta fora da edge

- A chave da Automação precisa de quem chame `tick`: uma linha no fim do `director-advance`, ou rota `/api/public/jobs/video-edit` com `invoke_video_edit`.
- `provider-credits` ainda não soma `video_edits.cost_usd`.
