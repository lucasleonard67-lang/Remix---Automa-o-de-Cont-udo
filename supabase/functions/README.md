# Edge Functions — Content Engine

Todas as functions são **POST**, JSON in/out, e nenhuma é pública: cada uma revalida a
sessão com `getUser(req)` e devolve 401 sem token válido — essa checagem no código é a
barreira real, não a configuração do gateway. Deploy via Lovable MCP — nunca CLI do
Supabase direto (docs/07-contratos-backend.md §9).

**Rate limiting**: as cinco functions que gastam crédito de IA (`generate-content`,
`regenerate-piece`, `generate-image`, `ingest-context`, `search-context`) consomem uma
cota por usuário antes de qualquer trabalho caro — `_shared/rate-limit.ts` → RPC
`consume_rate_limit`. Tetos em `app_settings.rate_limits`, editáveis por admin sem
redeploy; estouro devolve 429 com o tempo de espera.

**Watchdog**: o cron do banco (`mark_stale_jobs_failed`, a cada 5 min) NÃO invoca edge
function nenhuma — ele marca jobs travados como `failed` com mensagem acionável, e a
retomada é o botão "Tentar de novo" da UI chamando `resume-job`. Foi uma decisão
deliberada para não guardar credencial de serviço no banco de cada instância; quem
implementar auto-resume no futuro precisa resolver isso sem enfraquecer o `getUser()`
(uma service role key não corresponde a um usuário e é rejeitada com 401, corretamente).

| Function | O que faz |
|---|---|
| `store-secret` | Grava API keys BYO (OpenAI/Grok/Tavily…) no Vault; admin only. A UI só vê "configurada/não configurada". |
| `ingest-context` | Pipeline RAG de um item do Conteúdo de Contexto: limpeza → chunking → embeddings → `context_chunks` (background, status via Realtime). |
| `search-context` | Busca híbrida (pgvector + FTS) para a UI de /contexto — a MESMA retrieval da saga. |
| `prompt-assist` | Campos de prompt: transcreve a fala (Scribe v2) e melhora o pedido com o provedor do papel `generator`. Sem chave, 412 `not_connected` com `details.integration`. |
| `generate-content` | Entrada da geração (/criar): cria o job, responde `{job_id, status: 'classifying'}` e roda a saga em background (Roteador → awaiting_angle OU retrieving → … → awaiting_review). |
| `resume-job` | Continua a saga: escolha de ângulo (awaiting_angle), retry de job failed (checkpoint em `timings.last_stage`) e retomada de jobs travados (watchdog). |
| `extract-voice` | Extração assistida de voz do onboarding (passo 4): modo corpus (`context_item_ids`) ou modo entrevista. Retorna APENAS o rascunho das 9 seções — nunca persiste a persona. Admin only. |
| `google-drive` | Conexão OAuth com o Drive da pessoa, varredura (`tick`) que copia e tira do storage, e volta sob demanda (`restore`). Guia: docs/google-drive.md. Deploy com `verify_jwt = false`. |
| `tone-gate` | Gate de tom do onboarding (passo 9): cria 3 `generation_jobs` de amostra e roda as sagas em background, sequencialmente. Admin only. |
| `generate-image` | Imagem de IA opcional de uma peça (`piece_id`) ou de um brief avulso (`image_brief`) no bucket privado `renders`; devolve `{path, signed_url}`. Nunca escreve em `render_path` (o tweet-card é render client-side). |
| `invite-user` | Convite de usuário pela auth admin API; o papel viaja em `raw_user_meta_data.role` e é aplicado pelo trigger `handle_new_user` no aceite. Admin only. |
| `regenerate-piece` | Regeneração guiada de uma peça: cria um job novo herdando o briefing (classificação + ângulo) restrito ao canal da peça e roda a saga com a instrução do usuário injetada no Gerador; arquiva a original só quando a nova chega a `awaiting_review`. |

`_shared/` não tem deploy próprio — cada function importa por caminho relativo e o
bundle é montado por function no deploy; mudou `_shared/`, redeploy de todas.
O runner da saga vive em `_shared/saga.ts` (não é function separada) e é executado
dentro de `generate-content`/`resume-job`/`tone-gate`/`regenerate-piece` via
`EdgeRuntime.waitUntil`. A diretiva de regeneração viaja por `RunSagaOptions.instruction`
e entra no prompt do Gerador em todas as tentativas daquela execução.
