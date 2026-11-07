# Editor por prompt: entradas

Levantamento feito só pela leitura do código no `main`, em 30/10 (commit `2e87782`). Não consultei o banco nem a HeyGen, e nada foi testado rodando. Não verifiquei se o motor está publicado. No código, `VIDEO_EDIT_LIVE` segue `false`.

## Conclusão

O motor `video-edit` precisa de um único arquivo no bucket `renders`. Ele mesmo extrai os quadros, o áudio e a transcrição. Cenas não são usadas.

- Todo vídeo em `director_jobs` já pode entrar: Diretor, remake, avatar HeyGen e Video Agent.
- Reel da Biblioteca e upload puro ainda não têm entrada na tela.
- "0 cenas montadas" é bug de texto. Esses vídeos não têm cenas de verdade.
- A miniatura cinza não é arquivo quebrado: ninguém gera miniatura para esses vídeos.

## 1. Onde um vídeo pronto aparece

| Origem | Tela | Arquivo final | Transcrição guardada | Cenas | Aprimorar com IA aparece |
|---|---|---|---|---|---|
| Diretor | Vídeos | `artifacts.final` | Não | Sim: `plan.shots`, `keyframes`, `videos` | Sim |
| Remake | Vídeos | `artifacts.final` | Não | Não | Sim |
| Avatar HeyGen | Vídeos | `artifacts.final` | Não; o roteiro fica em `config.avatar_video.script` | Não | Sim |
| Video Agent | Vídeos | `artifacts.final` | Não; a ideia fica em `config.video_agent.prompt` | Não | Sim |
| Reel antigo | Biblioteca, página da peça | `video_projects.final_video_path` | Não; a narração fica em `video_scenes.narration` | Sim: `video_scenes` | Não |
| Upload | Só dentro do remake | `config.remake.source_path` (é o original) | Não | Não | Não |
| Versão A/B | Vídeos, faixa de comparação | `artifacts.ab_videos[]` (uma cena) | Não | Não se aplica | Não |

Notas:

- **Transcrição:** as palavras usadas nas legendas não são guardadas no job. O motor sempre transcreve de novo com o Scribe, e o custo entra na análise.
- **Biblioteca:** ela só lista `content_pieces`. Vídeos de `director_jobs` não aparecem lá (`src/routes/_app/biblioteca/route.tsx`).
- **Upload:** o remake exige "Marque pelo menos uma melhoria" (`src/components/video/remake-flow.tsx:393`). Não existe subir um vídeo só para editar.
- **Tela Vídeos:** é só de administrador (`src/routes/_app/videos/index.tsx:27`).
- **Reel:** ele fica dentro da peça, e não confirmei se a pessoa sem papel de administrador vê essa tela. As políticas de `video_projects` não aparecem no repositório.
- **Outros `<video>`:** `remake-flow.tsx:1102` e `hub-route-tile.tsx:221` não mostram vídeo pronto. Não entram na conta.

### "0 cenas montadas"

É bug de texto. Remake, avatar e Video Agent têm etapas próprias e nunca escrevem `plan`, `keyframes` ou `videos`. Por isso `buildScenes` volta vazio (`src/components/video/production-studio.tsx:51`), e a linha do vídeo final imprime a contagem sem conferir (`production-studio.tsx:254`).

A tela cheia tem o mesmo defeito: "O vídeo montado com todas as cenas, a narração e a trilha" (`production-studio.tsx:346`) não vale para esses vídeos.

### Miniatura cinza

São dois lugares, e os dois dependem de `keyframes`:

- `JobPoster` (`src/components/video/job-card.tsx:287`) lê o primeiro quadro.
- A linha do vídeo final (`production-studio.tsx:252`) faz o mesmo.

Sem quadro, sobra o fundo `--via-navy-06` com um ícone. O player não sofre, porque o navegador mostra o próprio vídeo. Depois de uma análise do motor existe `edits/<id>/f0.jpg`, mas nenhuma das duas telas usa esse arquivo.

Correção mais barata: usar o `artifacts.final` assinado como `<video preload="metadata">` quando não houver quadro, só nas linhas visíveis. Isso mexe em `job-card.tsx`, que está congelado, então precisa da liberação da -74.

## 2. O que o motor precisa para aceitar vídeo sem job

A tabela **não** liga só em `director_jobs`. `source_id` aceita nulo, `source_kind` já tem `'path'` (`supabase/sql/video-edits.sql:25`), e `suggest` já aceita `source.path` (`supabase/functions/video-edit/index.ts:239`). O caminho precisa estar em `renders` e terminar em `.mp4`, `.mov`, `.webm` ou `.m4v`. Para a v1 não precisa de SQL.

O que ainda depende de job:

| Ponto | Hoje | O que falta |
|---|---|---|
| Leitura na tela | `useLatestVideoEdit` filtra por `source_id` (`src/hooks/use-video-edit.ts:72` e `:107`) | Buscar por `source_id` ou `source_path` |
| Disparo | `useSuggestEdits` só manda `job_id` (`use-video-edit.ts:142`) | Aceitar uma origem genérica |
| Componente | `PolishStrip` recebe um `DirectorJob` | Receber origem e versão editada |
| Contexto | `sourceContext` devolve `objective: null` e `captionsBurned: false` para `path` (`video-edit/index.ts:67`) | O pedido informar objetivo e se já há legenda. Sem isso, o motor pode legendar por cima de legenda |
| Resultado | `markEdited` não faz nada para `path` (`video-edit/index.ts:130`) | Definir onde mora a versão editada e quem a publica. Hoje ela fica só em `video_edits.output_path` |
| Automação | `sweepAuto` só olha `director_jobs` (`video-edit/index.ts:351`) | Fora do escopo da v1 |
| Acesso | Edge e leitura da tabela são só de administrador | Decidir antes de abrir o Reel para quem não é administrador |
| Índice | Só em `source_id` | Índice em `source_path`, opcional. Exige SQL |

Falta confirmar se o filtro Realtime em `source_path` funciona com caminho. A leitura a cada 5 s durante o trabalho já cobre a tela.

### Para editar por prompt

Isso vale para qualquer origem:

- **Ação nova:** `apply` já aceita `ops` prontas, mas exige análise concluída (`video-edit/index.ts:270`). Falta uma ação que transforme o pedido em `ops`, e `normalizeOps` continua como trava.
- **Primeiro pedido:** sem análise, ele passa pelo `analyzing`, que custa até US$ 0,15 (`ANALYSIS_USD`).
- **Pedidos seguidos:** cada ajuste recomeça do original (`video-edit/index.ts:288`). O pedido novo precisa somar às `ops` do plano anterior, senão desfaz o que já foi feito.
- **Menu fechado:** só existem as 12 operações do §11.4: cortes, gancho, zoom, velocidade, legenda, voz, marca e cor. Pedidos como trocar música, inserir B-roll ou mudar o que foi dito precisam de uma resposta clara de "isso eu não faço".
- **Refazer cena:** a edição por cena vale só para o Diretor (`src/components/video/scene-edit.tsx:81`, `!job.config?.mode`).

## 3. Melhorar prompt com o tipo "edit"

O encaixe é pequeno e não pede tabela nova:

1. `supabase/functions/_shared/prompts/prompt-assist.ts`: somar `'edit'` em `PromptKind` e `PROMPT_KINDS`, e criar a regra em `KIND_RULES`.
2. `src/lib/prompt-assist.ts`: somar `"edit"` em `PromptKind`.
3. No campo novo: `<PromptField kind="edit" />`. O microfone vem junto.
4. O teste que percorre `PROMPT_KINDS` (`_shared/prompts/prompt-assist_test.ts:8`) cobre o tipo novo sozinho.

Cuidados:

- **Ordem de publicação:** a edge recusa tipo desconhecido com "Tipo de campo inválido" (`supabase/functions/prompt-assist/index.ts:98`). A edge precisa subir antes da tela. O deploy é só de `prompt-assist`, a única função que importa esse arquivo.
- **Promessa falsa:** o "Melhorar prompt" não vê o vídeo. A regra de `edit` precisa listar o que o motor faz, senão a IA reescreve o pedido com algo impossível.
- **Regra `[VERIFICAR]`:** ela ajuda em conteúdo, mas aqui viraria texto solto dentro do pedido ao motor. Para `edit`, o melhor é manter o pedido mais curto e sem marcador.
- **Busca na base:** `hybridSearch` traz material da marca a cada chamada (`prompt-assist/index.ts:116`). Para `edit`, não ajuda e pode ser pulada.
- **Provedor:** o "Melhorar prompt" usa o papel `generator`, que pode não ser Claude. O motor usa `claude-sonnet-5-5` direto. Isso não quebra nada, mas são duas configurações.

## Bugs reais

| # | Bug | Onde | Quando aparece |
|---|---|---|---|
| 1 | "0 cenas montadas" e o texto da tela cheia em vídeo sem cenas | `production-studio.tsx:254` e `:346` | Hoje |
| 2 | A versão editada não é publicada. TikTok e Instagram pegam `artifacts.final` | `director-advance/index.ts:2318` e `:2357`, `zernio-proxy/index.ts:759` | Com o motor ligado |
| 3 | Depois de editar uma cena, `artifacts.edited` segue na edição antiga. O palco abre a versão velha, e os ajustes voltam a partir do final velho | `director-advance/index.ts:3937`, `use-video-edit.ts` | Com o motor ligado |
| 4 | O objetivo do vídeo nunca chega ao Claude. `sourceContext` procura em `config`, mas o briefing está na coluna `brief`, e o roteiro e a ideia estão em `config.avatar_video` e `config.video_agent` | `video-edit/index.ts:70` | Com o motor ligado |
| 5 | O motor acha que há legenda queimada quando `config.captions` não existe (`!== false`), mas as lanes HeyGen só legendam com `=== true`. No Video Agent, que nunca grava a chave, a operação `captions` some em silêncio. O mesmo vale para avatar com legenda pedida e sem Higgsfield | `video-edit/index.ts:73`, `director-advance/index.ts:3065` e `:3396` | Com o motor ligado |

Os bugs 2 e 3 já constam no §11.7 de `docs/hub-motor-contratos.md`. A correção do bug 2 não é em `director-publish`, como o §11.7 diz: essa função só cuida de conta, OAuth e músicas. O ponto certo são os dois arquivos da tabela. O §11.6 também diz que `artifacts.final` nunca é mexido, mas a edição de cena troca esse campo.

Os bugs 2 e 3 pedem mudança em `director-advance`, que está congelado, e o bug 5 também, se a correção usar o estado da lane.

### Estado em 30/10, depois da liberação de `job-card.tsx` e `director-advance`

- Corrigidos, sem deploy: bugs 1, 2 e 3, e a miniatura de vídeo sem quadro. O bug 2 usa `publishablePath` (`_shared/publishable-video.ts`): a edição só vai ao ar se for do `final` atual.
- Abertos: bugs 4 e 5, em `video-edit/index.ts`, que tem trabalho sem commit de outra sessão.

## Só falta de recurso

- Aprimorar com IA no Reel.
- Upload só para editar.
- Editar por prompt.
- Tipo `edit` no Melhorar prompt.
- Edição por cena para remake, avatar e Video Agent, que não têm cenas guardadas.
- Vídeos do Diretor e dos estúdios na Biblioteca.
- Agendamento que chame o `tick` da automação (§11.7).
