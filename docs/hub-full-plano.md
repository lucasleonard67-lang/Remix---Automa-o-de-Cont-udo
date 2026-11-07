# Hub full — plano de implementação

Fontes: `docs/catalogo-heygen.md`, `docs/catalogo-replicate.md`, `docs/catalogo-higgsfield.md`, `docs/hub-de-video-mapa.md`.

Regra do hub: para cada experiência, **um padrão** (sugerido) e **a opção top** ao lado, com custo e tempo. A tela pede só os inputs do modelo escolhido. Modelo novo entra por dado (catálogo), não por código.

## Experiências (padrão · top)

| Experiência | Padrão | Top | Provedor |
|---|---|---|---|
| Vídeo de cenas | Seedance 2.0 720p | Kling 4.0 · Veo 3.1 · Seedance 2.5 (HF) | Replicate / Higgsfield |
| Vídeo comigo nas cenas | Kling 4.0 (keyframe + fotos do apresentador) | Cinema Studio 4.0 (HF) | Replicate / Higgsfield |
| **Avatar fala o roteiro** (novo) | Avatar da biblioteca, Avatar IV | Avatar V (looks elegíveis) | HeyGen |
| **Minha foto vira apresentador** (novo) | Photo avatar, Avatar IV | P-Video 2 Pro Avatar · OmniHuman 1.5 | HeyGen / Replicate |
| **Meu clone (Digital Twin)** (novo) | Digital Twin (vídeo ~2 min + consentimento) | — | HeyGen |
| **Só a ideia → vídeo pronto** (novo) | Video Agent + Brand Kit do site | — | HeyGen |
| Mudar o que eu digo | MiniMax 2.8 + heygen/lipsync-precision (Replicate) | ElevenLabs direto + HeyGen v3 | Replicate / HeyGen |
| Traduzir | HeyGen v3 translations | — | HeyGen |
| Mudar estilo / cenário | Kling 4.0 edit | Aleph 2 | Replicate |
| Trocar a pessoa | P-Video Replace | — | Replicate |
| Legendas | Scribe v2 | — | ElevenLabs / Replicate |
| Reenquadrar / upscale (novo) | HF reframe + upscale | — | Higgsfield |

## Frentes (por dono de arquivo)

**A. Catálogo (sessão -11)** — `video_models` seed + SQL patch
- Linhas novas do `catalogo-replicate.md` §(a), com `cost.by_resolution` e `limits`.
- Aposentar as linhas de §(b) (status `retired`, sem apagar).
- Template: lista de imagens (`$list`), mapa de resolução → `mode` (Kling), duração em ms.
- Capabilities novas: `stt`, `music`, `avatar_video` (HeyGen), `video_agent` (HeyGen).
- Campo por linha: `tier: 'default' | 'top' | 'alt'` e `experience[]` — o hub lê daqui.

**B. Motor (sessão e3)** — `supabase/functions/**`
- HeyGen v3: `GET /v3/avatars/looks` (biblioteca + meus), `POST /v3/avatars` (photo, digital_twin + polling de consentimento), `POST /v3/videos` type `avatar` com `supported_api_engines` conferido, `POST /v3/video-agents`, `POST /v3/brand-kits`. Idempotency-Key em todo job.
- Nova lane `avatar_video` (roteiro → áudio ElevenLabs → `audio_url` no HeyGen, ou voz HeyGen).
- Higgsfield: `models_explore` diário em `director_state.hf_catalog`; `MEDIA_URL_RE` aceita áudio/texto; testar `audio_references` no Cinema Studio 3.0+.
- Scribe v2 via capability `stt`; lipsync pelo Replicate quando não houver chave HeyGen.

**C. Telas (esta sessão)** — `src/**`
- Hub com as experiências novas e, em cada rota, "Padrão · Top" lidos do catálogo.
- Formulário por modelo: campos a partir de `required_inputs`/`limits` da linha escolhida.
- Seletor de avatar HeyGen (biblioteca + meus) com motor compatível.
- Fluxo Digital Twin (upload + link de consentimento + estado).
- Aba Vídeos (`/videos/novo`, hub): ao entrar, "O que você tem?" já vem com uma opção marcada (padrão: **Só uma ideia**), para os cards de rota aparecerem de cara. Hoje `VideoHub` abre com `have = null` e a tela fica vazia; `?modo=melhorar` continua marcando **Vídeo**.

## Ordem
1. Deploy das correções atuais (e3-motor + SQL 16fb519).
2. A e B em paralelo; C acompanha os contratos.
3. Um deploy por fase no Lovable 103e71ae; teste real de cada experiência.
