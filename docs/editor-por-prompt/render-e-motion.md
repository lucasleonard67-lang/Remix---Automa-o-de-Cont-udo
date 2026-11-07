# Render e motion do editor por prompt

Data: 30/10/2026. Pesquisa para o plano do editor por prompt de áudio. Nada aqui foi executado: nenhum render, nenhuma chamada paga e nenhum teste no sandbox do Higgsfield.

**Como ler:** **[Fato]** vem de fonte listada no fim. **[Estimativa]** é conta nossa, com a premissa à vista. **[Não verificado]** ainda precisa de teste.

## Recomendação

1. **Base:** HyperFrames, com a versão fixada dentro de uma imagem nossa. Remotion fica fora: em empresa com 4 ou mais pessoas, o produto automatizado tem piso de US$ 100/mês.
2. **Plano:** saída estruturada com `claude-sonnet-5-5`. O Claude escolhe um template do catálogo e preenche as variáveis.
3. **Render:** worker próprio no Modal, um contêiner por vídeo e sem saída de rede. O sandbox do Higgsfield continua no ffmpeg da v1.
4. **HTML livre:** só numa segunda etapa, com Agent SDK, Modal Sandbox e validação antes do render.
5. **Antes de fechar o provedor:** repetir no Modal o render de 30 s (seções 7 e 8). Hoje o tempo de render é a maior incerteza.

Custo esperado por vídeo com template: **US$ 0,10 a 0,34 em 30 s** e **US$ 0,12 a 0,41 em 60 s** (seção 4). Quase tudo é Claude; o render custa centavos.

## 1. O que o HyperFrames entrega

**Por que ele é o melhor apoio**

| Critério | HyperFrames | Remotion |
| --- | --- | --- |
| Licença **[Fato]** | Apache 2.0 | Própria. Grátis até 3 pessoas; 4+ precisa de licença |
| Custo em produto automatizado **[Fato]** | Sem taxa por render | Automators: US$ 0,01 por render, mínimo US$ 100/mês. A licença cita editores de vídeo e apps de prompt para vídeo |
| Autoria **[Fato]** | HTML, CSS e animação com seek, sem build | React, com bundler |
| Agentes **[Fato]** | 7 skills: 4 centrais, 3 sob demanda | 13 skills, incluindo `remotion-saas` e `remotion-captions` |
| Catálogo **[Fato]** | 456 itens: 238 componentes, 210 blocos, 8 exemplos | Sem catálogo equivalente encontrado **[Não verificado]** |
| Maturidade na nuvem **[Fato]** | O próprio README diz que o Lambda do Remotion é mais maduro | Mais tempo de produção |
| Ritmo **[Fato]** | Versão `v0.8.221`, publicada em 30/10; 223 issues abertas | Versão 4.x |

Comparativo de velocidade: **não existe benchmark neutro**. Os dois relatos públicos se contradizem e não têm fonte primária. Remotion no Lambda é a opção a medir só se o HyperFrames falhar no teste.

Conclusão: o HyperFrames serve melhor porque o Claude gera HTML sem build, o catálogo cobre os efeitos pedidos e não há piso mensal. O risco real é ser `0.x` e mudar todo dia. Por isso a versão fica fixa, sem `npx` em produção.

**Efeitos pedidos** **[Fato: nomes no `registry.json`]**

| Pedido | O que já existe |
| --- | --- |
| Motion e títulos | Dezenas de itens de legenda, zoom e transição, entre eles `caption-kinetic-slam`, `caption-pill-karaoke`, `cinematic-zoom`, `parallax-zoom` |
| Lower third | `lower-third-bild`, `yt-lower-third` |
| Tela dividida | `comparison-split`, `before-after-wipe`, `grade-split-reveal`, `gooey-split` |
| Vídeo por cima | Sem bloco de picture-in-picture encontrado pelo nome. A composição aceita `<video>` em camadas, então seria um template nosso **[Estimativa: esforço pequeno]** |
| Transições | `transitions-push`, `transitions-blur`, `transitions-3d`, `zoom-through-transition` e outras |

**Templates com prévia**
- **[Fato]** Um template é uma composição com variáveis declaradas; o mesmo projeto gera vários vídeos, um a um ou em lote JSONL.
- **[Fato]** Cada componente do catálogo traz um `demo.html`, e `<hyperframes-player>` toca a composição no navegador.
- **Sugestão:** pré-renderizar cada template em MP4 curto, com dados de exemplo, e mostrar esse vídeo no ladrilho. Prévia em vídeo evita rodar HTML na nossa tela.

**Cuidados**
- **[Fato]** A skill `/media-use` oferece caminhos pagos da HeyGen. `--local-only` evita provedores de rede.
- **[Fato]** A CLI manda telemetria ao PostHog. Desligar com `HYPERFRAMES_NO_TELEMETRY=1` ou `DO_NOT_TRACK=1`.
- **[Não verificado]** A licença de cada fonte e asset dos blocos. Apache cobre o código do repositório; revisar antes de levar um bloco ao produto.

## 2. Onde renderizar

**Velocidade de partida**
- **[Fato]** Doc oficial: 300 quadros 1920×1080 levaram 9,8 s e 25 s, na mesma composição com uma mudança de CSS. Máquina não informada.
- **[Fato]** O passo mais lento pode ser extrair o vídeo de origem. Editar vídeo real tende a custar mais que motion puro.
- **[Estimativa]** Premissa do cálculo: de 1× a 6× a duração do vídeo. O limite de cima vem de um relato não confirmado (30 s em cerca de 3 min).

| Opção | Custo por minuto de vídeo | Tempo para 60 s | Limites | Operação |
| --- | --- | --- | --- | --- |
| **Sandbox Higgsfield** | **[Não verificado]** Sem preço público; o doc do motor o trata como sem custo extra | Desconhecido | **[Fato, código]** Comando até 16k caracteres, prazo de 12 min no pending. Node e Chrome **[Não verificado]** | Já integrado, mas depende de o cliente ter Higgsfield. Isolamento e rede desconhecidos |
| **Modal Function** | **[Estimativa]** US$ 0,004 a 0,025 (4 núcleos, 8 GiB) | **[Estimativa]** 1 a 6 min | **[Fato]** Cobra por segundo; Starter sem mensalidade, US$ 30/mês de crédito | Baixa: imagem + função. Sem servidor parado |
| **Modal Sandbox** | **[Estimativa]** US$ 0,013 a 0,076 (3× o preço) | Igual | **[Fato]** Controle de rede de saída | Baixa a média. É o lugar para HTML gerado por IA |
| **Fly Machines** | **[Estimativa]** US$ 0,003 a 0,018 (`performance-4x` estimada como o dobro da 2x) | **[Estimativa]** 1 a 6 min | **[Fato]** Por segundo; parada custa US$ 0,15/GB/mês; saída US$ 0,02–0,12/GB | Média: orquestrar máquinas e fila |
| **AWS Lambda oficial** | **[Estimativa]** cerca de US$ 0,08, a partir do exemplo oficial de 480 quadros por US$ 0,0214. Composição do exemplo desconhecida | Menor, em paralelo; sem número oficial | **[Fato]** 15 min por fase, sem webhook, só SDR, 10.240 MB e `/tmp` até 10.240 MB | Média a alta: AWS, Step Functions, S3 e ECR. É o caminho mais suportado pelo projeto |

Observações:
- **[Fato]** Há também pacote para Cloud Run e template para Vercel Sandbox. Não entraram na conta.
- **[Fato]** Remotion no Lambda: 1 min de vídeo por US$ 0,017 a 0,021 em composição simples, mais licença.
- **[Não verificado]** Peso de vídeo de entrada, egress e armazenamento. Não entram nos custos acima.

**Decisão:** Modal para começar. Cada render dura minutos, o volume inicial é baixo e não há AWS no projeto. Lambda volta à mesa se a fila ou vídeos longos exigirem paralelismo.

**Ponto a decidir:** cada cliente tem instância própria, mas o worker seria central. Isso exige separar clientes por job, com credencial curta e bucket por instância.

## 3. Como rodar o Claude com as skills

| | Saída estruturada | Claude Agent SDK | Managed Agents |
| --- | --- | --- | --- |
| O que é | Uma chamada `output_config.format` | Claude Code como biblioteca, com shell e arquivos | Anthropic hospeda o loop e o sandbox |
| Onde roda | Edge function atual | Contêiner nosso (**[Fato]** ponto de partida: 1 GiB, 5 GiB de disco, 1 CPU) | Sandbox da Anthropic ou próprio |
| Como usa as skills | Resumo do catálogo no prompt, cacheado | Lê as skills, escreve, roda `check`, faz render de rascunho e corrige | Skills e bash nativos |
| Custo extra | Nenhum | Contêiner, cerca de US$ 0,05/h **[Fato]** | US$ 0,08 por hora de sessão ativa **[Fato]** |
| Risco | Baixo: sem shell | Alto: exige a seção 5 inteira | Médio: beta, sem ZDR **[Fato]** |

**Quando cada um compensa**
- **Saída estruturada:** quando o pedido cabe em template mais variáveis. Dá para validar o plano antes de gastar render, e é o padrão já usado no `video-edit`.
- **Agent SDK:** quando o pedido exige composição nova. Sugestão de gatilho: mais de 20% dos pedidos reais sem template adequado **[Estimativa]**.
- **Managed Agents:** alternativa ao Agent SDK se não quisermos operar o contêiner. Falta testar Chrome e FFmpeg no sandbox deles **[Não verificado]**.

**[Fato]** Claude Sonnet 5.5 recusa `tool_choice` forçado, e Opus 5.5 não aceita thinking desligado. Em Sonnet 5.5, Opus 5.5 e similares, a Anthropic pede tratar `stop_reason: "refusal"`.

**[Fato]** O Agent SDK não tem timeout de sessão: limitar com `maxTurns`. Em ambiente compartilhado, usar `settingSources: []`, `cwd` por cliente e `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.

## 4. Custo por vídeo

Preços **[Fato]**: Sonnet 5.5 a US$ 2 de entrada, US$ 2,50 de escrita de cache, US$ 0,10 de leitura e US$ 10 de saída por MTok. Opus 5.5 custa o dobro.

Tudo abaixo é **[Estimativa]**, sem medição real.

**Premissas de tokens**
- Plano: 30 mil tokens de entrada (catálogo, marca, transcrição, 8 quadros) e 5 mil de saída, cerca de US$ 0,12.
- Conferência: 4 quadros, cerca de US$ 0,03.
- HTML livre: cerca de 20 turnos, 900 mil tokens em leitura de cache e 30 mil de saída, cerca de US$ 0,55.

| Caminho | 30 s | 60 s |
| --- | --- | --- |
| Só ffmpeg no Higgsfield (Claude; render não verificado) | US$ 0,10–0,30 | US$ 0,12–0,33 |
| **Template no Modal Function** | **US$ 0,10–0,31** | **US$ 0,12–0,36** |
| Template no Modal Sandbox | US$ 0,11–0,34 | US$ 0,13–0,41 |
| Template no Lambda (composição simples a 3× mais pesada) | US$ 0,14–0,42 | US$ 0,20–0,57 |
| HTML livre com Agent SDK e Sonnet 5.5, render no Sandbox | US$ 0,45–1,65 | US$ 0,65–2,30 |
| O mesmo com Opus 5.5 | US$ 0,90–3,30 | US$ 1,30–4,60 |

Não entram: transcrição do comando de voz e do vídeo, som, geração de B-roll, egress e storage.

Pela regra da casa, a tela mostra modelo e estimativa antes de gerar. Sugestão de teto: US$ 0,50 com template e US$ 2,50 com HTML livre, até termos medição.

## 5. Riscos do HTML gerado por IA

**Por que é sério**
- **[Fato]** O Puppeteer diz que `--no-sandbox` é só para conteúdo em que se confia totalmente.
- **[Fato]** No Lambda, o caminho padrão usa `@sparticuz/chromium`; o código do projeto descreve esses argumentos como "single-process, no-sandbox".
- **[Não verificado]** Render local e no Docker: os argumentos reais não foram confirmados. Conferir no processo em execução.
- **[Fato]** O contrato da skill proíbe chamadas de rede na composição. **[Não verificado]** Se o render bloqueia: só encontramos interceptação de requisições no caminho de captura, não no de render. Tratar como não bloqueado.
- **[Fato]** O projeto recebeu um pedido para isolar HTML escrito por LLM no player, com a opção `opaque-origin`. A issue está fechada; falta confirmar a versão e o uso.

| Risco | Exemplo | Defesa |
| --- | --- | --- |
| Acesso à rede interna ou metadados | `<img src="http://169.254.169.254/">` | Sem saída de rede no render. Todos os assets entram antes |
| Leitura de arquivo | `file://` em iframe | Contêiner sem segredos e só com arquivos do job |
| Injeção de prompt | Texto na transcrição, no vídeo ou em legenda | Plano validado por schema; conteúdo do usuário tratado como dado |
| Vazamento de segredos | Chave em variável de ambiente | Proxy injeta a chave fora do contêiner (`ANTHROPIC_BASE_URL`) |
| Escape do Chrome | Falha do navegador | gVisor ou microVM, imagem atualizada, usuário sem privilégio |
| Consumo excessivo | Laço infinito, milhares de elementos | Timeout, memória, `pids-limit`, teto de duração e de custo |
| Mistura de clientes | Arquivo de outro cliente no disco | Um contêiner por job, descartado no fim |
| Cadeia de suprimentos | `npx` baixa versão nova | Versão fixa em imagem; atualizar com teste |
| XSS na nossa tela | Prévia de HTML no app | Mostrar MP4. Se houver HTML, iframe em outro domínio, sem `allow-same-origin` |

**Isolamento recomendado**
1. Separar duas zonas: **escrita** (agente, com rede só via proxy para a Anthropic) e **render** (sem rede).
2. Entre as zonas, validar o HTML: `hyperframes check`, proibir `<script src>`, `<iframe>`, `fetch`, `WebSocket` e URLs absolutas, e aceitar assets só de `assets/`.
3. Assets chegam por URL assinada de vida curta, baixados por código nosso antes do render. O render nunca recebe a URL.
4. Saída: só o MP4, conferido com `ffprobe` e com os 4 quadros antes de entregar.
5. Template com variáveis é mais seguro que HTML livre, mas as variáveis também são escapadas e têm limite de tamanho.

**[Fato]** A Anthropic orienta: proxy externo para credenciais, sistema de arquivos só leitura, `--network none`, sem capacidades Linux, usuário sem privilégio. gVisor e VMs têm isolamento mais forte que contêiner comum. O Modal diz usar primitivas como gVisor ou microVMs.

## 6. Plano sugerido

| Etapa | Entrega | Depende de |
| --- | --- | --- |
| 1 | Medição no Modal (seção 8) | OK para gastar poucos centavos |
| 2 | 5 a 8 templates de marca, com prévia em MP4 | Medição aprovada e revisão de licenças |
| 3 | Comando por áudio vira plano estruturado | Sessão da experiência (`experiencia.md`) |
| 4 | Worker com fila, retorno por tick e custo real gravado | Conta Modal e decisão sobre worker central |
| 5 | HTML livre com Agent SDK | Gatilho da seção 3 |

## 7. O que já foi medido

**[Fato, medido em 30/10]** Render local com HyperFrames 0.8.221, num Mac M1 de 8 GB, com GPU do Mac. Vídeos sintéticos de 30 s a 10 Mbit/s. A composição tinha título, lower third, tela dividida, vídeo por cima, legenda e encerramento.

| Medida | Resultado |
| --- | --- |
| Tempo total | 2min01 a 2min10, cerca de 4× a duração do vídeo |
| Maior etapa | Captura, 1min23 a 1min27 |
| Extração dos vídeos | 27 a 28 s |
| Arquivo final | 42 MB, 1080×1920, com áudio |

No Modal, 134 s custariam cerca de US$ 0,01 **[Estimativa]**. O Modal não tem a GPU do Mac, então o tempo real ainda pode mudar.

**[Fato]** O projeto criado por `hyperframes init` carrega o GSAP de CDN. Para rodar sem rede, o `render-worker` usa a cópia que vem no pacote.

## 8. O que falta testar

1. Rodar a action `probe` já pronta no sandbox do Higgsfield: Node, Chrome e `hyperframes_ready`.
2. Repetir o render no Modal: tempo, memória e custo. Depois, com um vídeo real e com fonte de vídeo pesada.
3. Conferir os argumentos do Chrome e se uma imagem externa é bloqueada com a rede fechada.
4. Medir tokens reais em 5 pedidos.
5. Rodar um conjunto de prompts maliciosos contra a validação do HTML.

## Fontes

**HyperFrames**
- [Repositório e README](https://github.com/heygen-com/hyperframes)
- [Licença](https://github.com/heygen-com/hyperframes/blob/main/LICENSE)
- [Catálogo: registry.json](https://github.com/heygen-com/hyperframes/blob/main/registry/registry.json)
- [Skill principal](https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/SKILL.md)
- [Skill media-use](https://github.com/heygen-com/hyperframes/blob/main/skills/media-use/SKILL.md)
- [Telemetria](https://github.com/heygen-com/hyperframes/blob/main/skills/media-use/references/meta.md)
- [Desempenho](https://github.com/heygen-com/hyperframes/blob/main/docs/guides/performance.mdx)
- [Render](https://github.com/heygen-com/hyperframes/blob/main/docs/guides/rendering.mdx)
- [Deploy](https://github.com/heygen-com/hyperframes/blob/main/docs/guides/deploy.mdx)
- [AWS Lambda](https://github.com/heygen-com/hyperframes/blob/main/docs/deploy/aws-lambda.mdx)
- [Templates no Lambda](https://github.com/heygen-com/hyperframes/blob/main/docs/deploy/templates-on-lambda.mdx)
- [Argumentos do Chromium no Lambda](https://github.com/heygen-com/hyperframes/blob/main/packages/aws-lambda/src/chromium.ts)
- [Política de segurança](https://github.com/heygen-com/hyperframes/blob/main/SECURITY.md)
- [Issue 3491](https://github.com/heygen-com/hyperframes/issues/3491)

**Remotion**
- [Licença e preços](https://www.remotion.pro/license)
- [Custo no Lambda](https://www.remotion.dev/docs/lambda/cost-example)
- [Skills](https://www.remotion.dev/docs/ai/skills)

**Render**
- [Modal: preços](https://modal.com/pricing)
- [Modal: segurança](https://modal.com/docs/guide/security)
- [Fly: preços](https://docs.fly.io/about/pricing)
- [AWS Lambda: preços](https://aws.amazon.com/lambda/pricing/)
- [AWS Lambda: limites](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)

**Claude**
- [Preços](https://platform.claude.com/docs/en/about-claude/pricing)
- [Hospedar o Agent SDK](https://code.claude.com/docs/en/agent-sdk/hosting)
- [Deploy seguro](https://code.claude.com/docs/en/agent-sdk/secure-deployment)
- [Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview)

**Segurança**
- [Puppeteer: troubleshooting](https://pptr.dev/troubleshooting)
- [Headless browsers: SSRF e arquivos locais (guia de terceiros)](https://book.jorianwoltjer.com/web/client-side/headless-browsers.md)

**Comparativos sem medição própria (só contexto)**
- [Wireflow](https://www.wireflow.ai/blog/hyperframes-vs-remotion)
- [Review de andrew.ooo](https://andrew.ooo/posts/hyperframes-heygen-html-video-agents-review/)
