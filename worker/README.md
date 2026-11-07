# director-worker — worker do agente-diretor

Processo Node long-running (fora do edge runtime: precisa de ffmpeg e loops de minutos)
que consome `director_jobs` e produz Reels completos: plano (edge fn `director-plan`,
gateway Gemini) → TTS ElevenLabs (durações medidas ditam os cortes) → keyframes
Nano Banana Pro com look lock + identidade por referência → vídeos Seedance 2.5
(CTA falado via `audio_references`) → montagem/master ffmpeg (-14 LUFS) → bucket
`renders/director/<job>/`.

Fundamentos: `docs/13-arquitetura-agentes-video.md` · validação: `../../poc-agente-diretor/`.

## Setup (uma vez)
```bash
cd worker
./setup-ffmpeg.sh                 # baixa ffmpeg/ffprobe estáticos p/ ./bin
cp .env.example .env              # preencha (ver comentários)
cp /caminho/hf_mcp_tokens.json hf-tokens.json   # tokens OAuth do MCP Higgsfield
node director-worker.mjs
```

Auth Higgsfield: OAuth da conta (registro dinâmico; ver `higgsfield-mcp-client/` na raiz
do workspace). O worker renova o access token pelo refresh e PERSISTE a rotação em
`hf-tokens.json` — não apague esse arquivo com o worker rodando.

## Enfileirar um job (SQL ou UI futura)
```sql
insert into director_jobs (brief, config) values (
  '{"objetivo":"Reel B2B case-study","publico":"gerentes de indústria PME",
    "smp":"automação elimina a digitação tripla","numero_heroi":"40% menos retrabalho em 3 meses",
    "tom":"sóbrio, chão de fábrica","cta":"a gente precisa conversar","duracao_alvo_s":24,
    "formato":"reels_conversion","identity_ref":"<media_id Higgsfield da ref do personagem>",
    "mandatorios":["sem logo no plano 1","sem texto em cena"]}',
  '{"max_shots":5,"auto_approve_keyframes":true,"auto_approve_audio":true,
    "skip_video":false,"budget_credits":250}');
```
`skip_video:true` = smoke barato (para nos keyframes, ~25 créditos).
Gates: com `auto_approve_*:false` o job para em `awaiting_*` e a aprovação é
`update director_jobs set status='videos' where id=...` (UI fará isso).

## Estados
`queued → planning → tts → keyframes → [awaiting_keyframe_approval] → videos →
assembling → [awaiting_audio_approval] → done` · terminais `failed|canceled`.
Checkpoints em `artifacts` (idempotente: retomada pula o que já existe); jobs órfãos
(>10min sem heartbeat) são re-claimados por qualquer worker.

## Custos (trilho de orçamento)
`costs`: `hf_credits_start/end/spent` (delta de `balance` — o MCP não expõe preço),
`eleven_chars`. Referência medida (PoC run 001): keyframe 2k ≈ 5cr · clipe 1080p/5s ≈ 40cr
· Reel de 5 shots ≈ 225cr.
