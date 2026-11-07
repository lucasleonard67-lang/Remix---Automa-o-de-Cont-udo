# Motor de edição com Claude ("Aprimorar com IA")

Data: 2026-10-30. Este documento mapeia as 5 ferramentas de edição (Remotion, HyperFrames, FFmpeg, Whisper e yt-dlp) e propõe como o Claude edita o vídeo antes da entrega. A edição cobre o que os modelos de geração não entregam: corte dos respiros, punch-in, legenda animada, títulos em motion e som. Junto vêm o conector e a tela em que a IA decide com o usuário.

Fontes: os READMEs oficiais (github.com/heygen-com/hyperframes, remotion.pro/license), lidos em 30/10, e o código atual (`director-advance`, `video-remake`, `store-secret`, `mcp-server`). **NÃO VERIFICADO** marca o que não está nessas fontes.

## 1. O que já existe

| Peça | Onde | Serve para |
|---|---|---|
| ffmpeg/ffprobe reais | `sandbox_exec` do Higgsfield MCP (`director-advance` :1851, :2084, :2951, :3692), em modo background com log e exit e lido no tick seguinte | a montagem já roda lá: re-encode 1080×1920, `apad`/`atrim`, `amix`, `loudnorm -14`, legenda ASS |
| Limite do sandbox | o comando tem no máximo 16k caracteres, por isso o ASS vai pelo bucket (:2076) | arquivos grandes sobem por URL assinada |
| Plano B sem Higgsfield | modelos utilitários do Replicate (`util_audio_merge`, `util_normalize`, `util_concat`) | só operações simples |
| Transcrição por palavra | `sttWords`, Scribe v2 do ElevenLabs (:586), com início e fim de cada palavra | legenda queimada |
| Chave do Claude | `store-secret` já aceita `ANTHROPIC_API_KEY` | o "cérebro" do editor |
| MCP da plataforma | `mcp-server`, com o escopo "lê e cria rascunho; nunca publica" | uma ferramenta nova, `editar_video` |

## 2. As 5 ferramentas

| Ferramenta | O que é | Licença e custo | Onde roda | Papel aqui | Veredito |
|---|---|---|---|---|---|
| **FFmpeg** | corta, junta, converte e aplica filtros | LGPL/GPL, grátis | já roda no sandbox | é o motor: cortes, zoom, velocidade, cor, som, legenda ASS | **usar (v1)** |
| **Whisper** (whisper.cpp) | transforma fala em texto com tempo de cada palavra | MIT, grátis | precisa de servidor próprio | o Scribe v2 já entrega o mesmo, com `tag_audio_events` para marcar respiração e risada (NÃO VERIFICADO no pt-BR). Whisper só como plano B, pelo Replicate | **não instalar**; manter o Scribe |
| **HyperFrames** (HeyGen) | HTML/CSS/GSAP vira MP4 determinístico, com Chrome headless e FFmpeg; CLI não interativa | Apache 2.0, sem taxa por render | Node 22+, Chrome e FFmpeg; local, Docker ou Lambda | motion graphics que o Claude escreve em HTML: título do gancho, lower third, contador, CTA animado, legenda palavra a palavra. Vem com skills prontas para o Claude Code | **usar (v1.5)**, se o sandbox tiver Node e Chrome (NÃO VERIFICADO, ver §8) |
| **Remotion** | vídeo escrito em React | **pago** para empresas com 4+ pessoas. Produto automatizado = plano Automators: US$ 0,01 por render, mínimo de **US$ 100/mês** | Node e Chrome | faz o mesmo que o HyperFrames | **não usar agora**: mesma função, só que com custo fixo |
| **yt-dlp** | baixa vídeos do YouTube, Instagram e TikTok | grátis | servidor | "estudar" vídeos de outros perfis | **não entra no produto**: baixar desses sites viola os termos deles, e num SaaS o risco é do cliente. O estudo de referência continua pelo Radar e pelos Concorrentes (texto e métricas). Vídeo próprio entra por upload |

## 3. Como o Claude edita (arquitetura)

O Claude **decide**; ele não roda shell livre. Escrever comandos à mão num sandbox com URLs assinadas é frágil e inseguro. O fluxo:

1. **Ler.** O motor junta tudo para o Claude:
   - a transcrição por palavra (Scribe v2, com os eventos de áudio);
   - o `ffprobe` (duração, fps, áudio);
   - um quadro por cena (visão, até 8);
   - o roteiro e o objetivo do post;
   - a marca (cores, fonte, tom), do Brand Kit.
2. **Planejar.** O Claude devolve um **plano de edição** em JSON, só com operações do menu (§4) e com o motivo de cada uma. A saída é estruturada (tool use): plano inválido é recusado antes de rodar.
3. **Compilar.** Código determinístico transforma o plano num comando ffmpeg e, quando há motion, numa composição HyperFrames. O Claude escreve só o HTML de cada elemento, dentro de um molde com as cores e a fonte da marca.
4. **Rodar.** O sandbox do Higgsfield executa em background, no mesmo padrão `pending_*` da montagem. O resultado vai para `renders/edits/{id}/out.mp4`.
5. **Conferir.** O motor checa no `ffprobe` duração, áudio e loudness. Depois o Claude olha 4 quadros do resultado. Se algo saiu errado (corte no meio de palavra, texto fora da área segura), ele corrige uma vez. Se o erro continuar, entrega o original e avisa.
6. **Entregar.** O original nunca é apagado. A peça ganha a versão "Editada", e "Voltar ao original" fica a um clique.

Modelo: `claude-sonnet-5-5` para planejar e conferir, e `claude-opus-5-5` só no modo "Surpreenda-me" (efeito livre em HyperFrames).

### Por que não um "Claude Code" de verdade rodando no servidor (v2)

O agente completo (Claude Agent SDK com as skills do HyperFrames) escreve e testa composições livres, mas precisa de um contêiner próprio com disco, Node e Chrome, e o sandbox do Higgsfield só aceita comandos. Fica para a v2, num worker nosso (Modal ou Fly, com custo mensal NÃO VERIFICADO). Vale a pena se o menu da v1 ficar curto.

## 4. Menu de operações (v1)

| Operação | Como | Fonte do dado |
|---|---|---|
| **Cortar respiros e silêncios** | junta os trechos de fala, deixa 80 ms de folga em cada ponta e um crossfade de áudio de 10 ms | os intervalos entre palavras do Scribe mais o `silencedetect` |
| Cortar vícios e repetições | remove "é…", "tipo", "né" e frases repetidas | o Claude marca as palavras |
| Gancho na frente | leva a melhor frase para os 2 primeiros segundos | o Claude escolhe |
| Punch-in nos cortes | alterna zoom de 100% e 112% a cada corte (jump cut) | os cortes acima |
| Legenda animada | destaca a palavra falada, na cor da marca, dentro da área segura 9:16 | o ASS que já existe, com o estilo novo |
| Título, lower third e CTA em motion | composição HyperFrames por cima | o Claude escreve o HTML no molde (v1.5) |
| Velocidade | acelera de 1,1× a 1,25× nos trechos lentos; congela o quadro no CTA | o Claude marca os trechos |
| Som | whoosh nos cortes, trilha com ducking (`sidechaincompress`) e `loudnorm -14` | SFX do ElevenLabs, que já existe |
| Voz limpa | `highpass`, `afftdn` e um de-esser leve | — |
| Cor | `eq` e uma LUT suave da marca | — |

### 4.1 Marca no vídeo

A fonte é o Brand Kit ativo: `brand_kit.content.logo_path` (bucket `brand-assets`), a `palette`, a `typography` e o @ dos canais ligados. Se o logo não tiver fundo transparente, o motor recorta antes, uma vez, e guarda o resultado como `logo_alpha_path`.

| Efeito | v1 (ffmpeg) | v1.5 (HyperFrames) |
|---|---|---|
| **Abertura com o logo** (1–1,5 s) | escala de 80% para 100%, fade e um flash na cor primária sobre um quadro desfocado do vídeo | revelação animada: traço, máscara e partículas na cor da marca |
| **Marca d'água** | logo pequeno no canto seguro, opacidade 70%, aparece depois do gancho | o mesmo |
| **Encerramento** (2 s) | logo, @perfil e CTA sobre a cor da marca, com o áudio em fade | card animado com o CTA na fonte da marca |
| **Lower third** | nome e cargo do apresentador, com faixa na cor da marca | entrada e saída animadas |
| **Transição da marca** | wipe na cor primária entre cenas | logo atravessando a tela no corte |
| **Legenda na identidade** | palavra destacada na cor da marca e na fonte de títulos | — |

O Claude sugere a combinação conforme o formato: no Reel, abertura curta, marca d'água e encerramento; no talking head, lower third e encerramento. Ele nunca põe logo nos 2 primeiros segundos de um gancho falado, porque a abertura com logo derruba a retenção. Nesse caso, o logo vai para o fim. Tudo aparece como ladrilho, com uma prévia do quadro.

Fora da v1: B-roll gerado, troca de fundo e reenquadrar pelo rosto. Para esses, o hub já tem os modelos próprios.

## 5. A IA decide com o usuário (zero digitação)

Quando o vídeo fica pronto, ele aparece com a faixa **"Aprimorar com IA"** logo abaixo:

- O Claude já analisou e mostra **3 sugestões em ladrilhos**. Cada uma tem a prévia de antes e depois (quadro e duração) e o ganho em linguagem simples, por exemplo "−6 s de respiro" ou "gancho em 1,5 s". As recomendadas já vêm marcadas.
- Um botão: **"Aplicar"**, com o custo estimado ao lado (regra do app: custo antes de gerar).
- "Surpreenda-me" é um ladrilho a mais: o Claude escolhe um efeito livre de motion.
- Nada de campo de texto. Ajuste fino só por chips ("menos zoom", "legenda maior"), que geram uma nova versão.

Automático: em Automação, a chave **"Claude edita antes de entregar"** (desligada por padrão) aplica as recomendadas sozinho em todo vídeo novo. Ela respeita o teto mensal.

Onde aparece: no fim do Diretor, no fim do remake e na Biblioteca ("Aprimorar com IA" em qualquer vídeo, inclusive enviado por upload).

## 6. Conector

- **Integrações → "Claude · editor de vídeo"**: chave `ANTHROPIC_API_KEY` (o `store-secret` já aceita). A tela mostra se o editor está pronto: Claude ligado e Higgsfield ligado (sandbox). Sem o Higgsfield, ela mostra que dá só para cortar respiros e mixar o som, pelo Replicate (NÃO VERIFICADO: depende de um modelo de corte por intervalos).
- **MCP**: a ferramenta `editar_video` `{piece_id, ops?}` cria uma versão editada como **rascunho**. Ela nunca publica, o mesmo escopo do `mcp-server`. Assim, o Claude Desktop ou o Claude Code do cliente também pede edições.

## 7. Contrato do motor (sessão e3)

Edge nova, `video-edit` (verify_jwt = true):

| action | entrada | saída |
|---|---|---|
| `suggest` | `{source: {job_id} \| {project_id} \| {path}}` | `{analysis_id, suggestions: [{id, title, gain, ops[], recommended}], cost_usd}` |
| `apply` | `{analysis_id, suggestion_ids[] \| ops[]}` | `202 {edit_id}` |
| `status` | `{edit_id}` | `{status: queued\|running\|checking\|ready\|failed, output_url?, plan, error?}` |
| `revert` | `{edit_id}` | a peça volta para o original |

- Tabela `video_edits`: `id`, `source_kind`, `source_id`, `source_path`, `analysis` jsonb, `plan` jsonb, `status`, `output_path`, `cost_usd`, `created_by`, `created_at`, com lease no mesmo padrão do diretor.
- O avanço vai pelo tick que já roda a cada minuto.
- Custo de uma edição: Claude por volta de US$ 0,05–0,15 (transcrição + 8 quadros; NÃO VERIFICADO), sandbox sem custo extra (como na montagem), Scribe já cobrado. Entra no teto mensal.

## 8. Testes antes de construir (somente leitura, sem gastar crédito)

**Estado em 30/10:** a v1 foi construída sem esperar por 1 e 2, porque só depende de ffmpeg. Os dois rodam pela action `probe` da edge, depois do deploy (§11.2 de `hub-motor-contratos.md`). O item 3 foi medido só na máquina local: 120 s com 119 cortes levaram 24 s (ffmpeg 6) e 56 s (ffmpeg 9), com pico de 1,3 GB. O contrato final é o §11; onde este plano divergir, vale o §11.

1. No sandbox: `node -v; which chromium chromium-browser google-chrome; ffmpeg -hide_banner -filters | grep -E 'ass|sidechaincompress|afftdn|silencedetect'`. Esse teste decide se o HyperFrames roda lá (v1.5) ou se ele espera o worker (v2).
2. Scribe com `tag_audio_events=true` num vídeo nosso que já existe: os respiros vêm marcados em pt-BR?
3. Corte por intervalos num vídeo de 30 s: medir quanto tempo o sandbox leva (o prazo do pending é 12 min).

## 9. Frentes e ordem

- **e3 (motor):** os testes do §8, a edge `video-edit`, o compilador do menu e a fase `polish` opcional no `director-advance` e no `video-remake`.
- **-11 (dados):** o SQL de `video_edits`, a chave da Automação e o card do conector em `lib/integrations`.
- **0c (telas):** a faixa "Aprimorar com IA" com os ladrilhos, a versão Editada/Original, "Aprimorar com IA" na Biblioteca e a ferramenta `editar_video` no MCP (junto com a e3).

Ordem:
1. Os testes do §8.
2. v1 só com ffmpeg: respiros, vícios, gancho, punch-in, legenda e som.
3. v1.5 com os elementos HyperFrames.
4. v2, o worker com o agente completo, se fizer falta.

Um deploy por fase, no Lovable 103e71ae.
