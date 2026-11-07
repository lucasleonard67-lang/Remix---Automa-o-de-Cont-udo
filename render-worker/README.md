# render-worker

Render do editor por prompt. Recebe um plano em JSON e devolve um MP4. Roda no Modal, com HyperFrames fixado em 0.8.221.

## Efeitos do plano

`hook`, `lower_third`, `split_screen`, `picture_in_picture`, `captions`, `end_card`, `cutout` e `fact_card`. O `fact_card` só entra com `source`; `cutout` usa uma das imagens PNG sem fundo do job. Título, lower third e legenda aceitam `position`, para não cobrir o rosto. O campo `music` liga a trilha, que abaixa na fala; o áudio final sai em -14 LUFS. O `compose.py` valida o plano e gera o HTML; o Claude nunca escreve HTML neste fluxo.

## Testar sem Modal

Precisa de Node 22+ e FFmpeg.

```bash
cd render-worker
npm ci
python3 -m unittest
python3 render_local.py plano.json source.mp4 broll.mp4 musica.mp3 saida.mp4 imagem1.png
```

## Publicar

Opcional: hoje o Claude da pessoa renderiza pelo conector (`video_render`). Este worker sai pelo GitHub Actions (`.github/workflows/deploy-render-worker.yml`), no botão Run workflow. Nada roda na máquina de ninguém.

1. Crie o token em modal.com, Settings → API Tokens.
2. Grave `MODAL_TOKEN_ID` e `MODAL_TOKEN_SECRET` nos secrets do repositório.
3. Rode o workflow. A URL do app aparece no log e no painel do Modal.
4. Crie o proxy token em modal.com, Settings → Proxy Auth Tokens.
5. A URL do app e o proxy token vão em Integrações → Render de vídeo (`RENDER_WORKER_URL` e `RENDER_WORKER_TOKEN`).

O Dockerfile ainda não foi construído: a primeira execução do workflow é o teste dele.

## Contrato

Autenticação: `Authorization: Bearer <token_id>.<token_secret>` (proxy token do Modal).

`POST /submit`

```json
{
  "job_id": "uuid",
  "plan": { "duration": 30, "layers": [] },
  "assets": { "source_url": "https://…supabase.co/…", "broll_url": "https://…", "music_url": "https://…", "image_urls": ["https://…"] },
  "upload_url": "https://…supabase.co/…",
  "frame_upload_urls": ["https://…"]
}
```

Resposta: `{ "call_id": "…" }`.

`GET /status?call_id=…` devolve `running`, `failed` ou `ready` com `duration`, `has_audio` e `lufs`.

## Segurança

- O render roda com `block_network=True`, e os arquivos já estão no Volume.
- URLs só em HTTPS e nos hosts de `RENDER_ASSET_HOSTS` (padrão `.supabase.co`), sem seguir redirecionamento.
- A pasta do job é apagada no fim.
- **Limite:** o render enxerga o Volume inteiro. Para HTML escrito por IA, usar um Volume por job antes de ligar.
