# 14 — Plano de evolução do produto (12 pontos)

> **STATUS (2026-08-30): IMPLEMENTADO — 11 dos 12 pontos.** Ondas 1 a 8 no ar
> (commits da sessão de 2026-08-30); suíte Playwright em 66 casos verdes. O ponto 1
> (carrossel de X) segue **bloqueado** aguardando os exemplos do Tiago — sem
> referência visual, reconstruir a anatomia do tweet é chute. Marcadores por ponto
> no início de cada seção.
>
> **STATUS ANTERIOR (2026-08-29): PLANO, nada implementado ainda.** Documento nasce da lista de
> 12 pontos levantada pelo Tiago. Cada ponto foi conferido contra o código e o banco
> **antes** de virar plano — onde a premissa não se confirmou, está escrito o que a
> medição mostrou. Decisões de produto tomadas nas perguntas de 2026-08-29 estão
> marcadas como **DECIDIDO**.

## Decisões já tomadas

| Tema | Decisão |
|---|---|
| Momento da imagem | Texto primeiro; **imagem só depois da aprovação humana** do texto |
| Escopo da imagem | **Capa por IA**; miolo do carrossel pelo **design system** |
| Motor automático | **Para na aprovação** — nada publica sozinho |
| Conector MCP | **Ler contexto e criar rascunho**; aprovar/publicar continua só na interface |
| Formatos análogos | **Camada de família** por cima dos tipos atuais (não renomear no banco) |
| Design system | Quatro origens (marca enviada, site, nicho, escolhas guiadas), **faseado** |

---

## 1. Carrossel de X (Twitter) não parece com o Twitter · ⛔ BLOQUEADO

**Pedido.** O modelo atual não lembra o padrão do Twitter; precisa parecer um tweet de
verdade e permitir **imagens dentro do slide**.

**Estado medido.** Os canais `instagram_carousel` e `instagram_post` usam
`config.render_template = "tweet-card"` (`channels`), renderizado por
`src/components/tweet-card-render.tsx` e `src/components/carousel-slide-render.tsx`.
Hoje o card é uma superfície com texto e avatar — não reproduz a anatomia do tweet
(handle, verificado, hora, métricas, citação, mídia embutida).

**Plano.**
1. **Bloqueado:** aguardando os exemplos que o Tiago vai mandar. Sem referência visual,
   qualquer reconstrução é chute.
2. Ao receber: extrair a anatomia (grade, tipografia, espaçamentos, elementos) e
   reescrever o `tweet-card` fiel ao padrão, incluindo **slot de mídia** dentro do card.
3. Cobrir com teste de render (o spec do carrossel já mede a arte, não só o DOM).

---

## 2. Capa de carrossel e post único: imagem inteira feita por IA · ✅ FEITO

**Pedido.** Capa não pode ser "HTML com texto e imagem de fundo" — tem que ser imagem
inteira, chamativa, gerada por modelo. Miolo pode seguir a estrutura simples.

**Estado medido — a premissa do ponto 2.1 não se confirma, e o achado é pior.**
O lote de imagens **funciona e gera todas**: nas 3 peças de carrossel mais recentes,
`slide_images_job` = `done`, `10/10`, e as 10 slides têm `image_path`.
O que acontece é outra coisa: `carousel-slide-render.tsx` tem
`useCoverPhoto = isCover && Boolean(imageUrl)` — **só a capa usa a foto dela**. As outras
9 imagens são geradas, pagas e **descartadas na renderização**. Isso é a regra "capa
full-bleed, miolo sólido" que eu mesmo implementei a pedido anterior; ela continua válida
como estética, mas hoje está sendo paga em duplicidade.

**Plano.**
1. **Parar o desperdício:** o lote passa a gerar imagem só para as unidades que de fato
   a exibem (capa, e slides promovidos manualmente — ver 2.2).
2. **Capa por IA de verdade:** nova rota de geração de capa com modelo de imagem forte,
   recebendo o texto da capa + design system (paleta, tipografia, proibições do brand kit).
   Avaliar `gpt-image` e o catálogo do Higgsfield; decidir por teste A/B com custo medido.
3. **Miolo:** permanece render do design system (barato, legível, consistente) — é o que
   o ponto 11 pede.

### 2.1 Imagens sem clique manual · ✅ FEITO

**DECIDIDO:** as imagens **não** saem junto com o texto. A saga entrega o carrossel
escrito; o texto é aprovado; **aí** a imagem é gerada. Motivo medido: nos testes reais
o juiz reprovou 2 de 3 gerações — gerar imagem antes da aprovação é pagar arte de peça
que vai ser descartada.

**Plano.** Disparo automático do lote de imagens no momento da **aprovação** da peça,
sem botão. O botão manual continua existindo para regerar.

### 2.2 Regenerar slide a slide · ✅ FEITO

**Estado medido.** A página da peça já monta o deck com todas as imagens
(`biblioteca/$pieceId.tsx`, bloco "Deck de fotos por unidade").

**Plano.** Clique na imagem → ação de regenerar **aquela** unidade, com campo opcional de
ajuste do prompt. Reaproveita o `claim_slide_images_batch` com escopo de 1 item.

---

## 3. Quadro de aprovação (hoje é uma lista vertical) · ✅ FEITO

**Pedido.** A visualização dos posts criados precisa virar uma linha de aprovação, tipo
kanban. Tiago pediu explicitamente painel de especialistas para decidir o formato.

**Estado medido.** `biblioteca/index.tsx` é lista vertical com abas de status
(`draft`/`approved`/`published`/`rejected`/`archived`) e alternância Lista | Calendário.
No banco: **33 peças** aguardando revisão, ~9 dias de acúmulo — o volume é real.
(O painel trabalhou com 23, número da consulta anterior; a fila cresceu durante a sessão.)

**Decisão do painel (13 especialistas, 4 propostas independentes, cada uma julgada por
duas lentes céticas).** Especificação completa em **`docs/14a-mesa-de-revisao.md`**.

O painel **recusou o kanban**, com dois argumentos que se sustentam:

1. **Geometria.** A largura útil é `viewport − 256 (sidebar) − 48 (padding)` = **976px a
   1280**, que é a resolução da própria suíte. Quatro colunas dariam ~230px cada — *menos*
   texto legível que o card de hoje.
2. **O funil não tem WIP.** Dos 5 status, só `draft` acumula (33 peças); `approved` é sala
   de espera e `published`/`rejected`/`archived` são saídas. Um quadro seria 1 coluna cheia
   e 4 de inventário. E arrastar não expressa nenhuma das duas transições reais: rejeitar
   exige o motivo digitado que vira `piece_feedback` (que retroalimenta o gerador), agendar
   exige data.

**O que entra no lugar: "Mesa de Revisão"** — master-detail dirigido pela URL, com a
**esteira de aprovação** horizontal no topo (a "linha" que você pediu, em 56px) e o resto
da tela devolvido à leitura: fila à esquerda agrupada por job, leitor à direita.

**Três achados do painel que valem por si**, independentemente do desenho:

- **A linha da fila mostra o texto errado.** `saga.ts:1404` grava o **mesmo `core_content`
  e a mesma `audit`** em todas as N peças de um job, e o card lê justamente daí — então
  peças irmãs aparecem com a frase idêntica e os mesmos selos. A linha deve mostrar o que
  **varia**: a primeira unidade adaptada de verdade (slide 1, primeiro beat do reel, hook
  do LinkedIn) e a miniatura da arte.
  _Ressalva medida por mim: a síntese disse "~6 ideias repetidas 4 vezes cada"; o banco diz
  33 peças, 27 ideias, média 1,22, só 9 cards em blocos repetidos. O mecanismo é real, a
  magnitude estava exagerada._
- **Auditoria é atributo de JOB, não de peça** — sobe para o cabeçalho do bloco e some das
  linhas, apagando dezenas de pílulas "ok" que não dizem nada.
- **"Aprovada sem data" é invisível hoje**: some dentro da aba Aprovadas e não entra no
  calendário, porque `useScheduledPieces` exige `scheduled_at`. Vira segmento próprio.

**Não entra na primeira versão** (com motivo): kanban com arrastar, bandas de triagem por
auditoria, aprovação em lote, e undo que apague `piece_feedback` — a tabela é append-only
por RLS, então o botão honesto é **Reabrir**, não Desfazer.

---

## 4. Radar: "gerar conteúdo" abre modal · ✅ FEITO

**Pedido.** Deve **redirecionar** para a página principal de criação com a notícia anexada,
em vez de abrir modal.

**Estado medido.** `src/routes/_app/radar.tsx:359` — `GenerateDialog`, com brief editável,
canais e pesquisa web, disparando a saga de dentro do modal.

**Plano.** Trocar o modal por navegação para `/criar` levando o item do radar anexado
(brief pré-preenchido + referência da notícia como contexto). Casa com a rota nova
`/criar/$jobId`: o usuário sai do Radar, revisa o briefing na tela de criação e acompanha
a geração na página da postagem.

---

## 5. Bug: pesquisa web quebra na OpenAI · ✅ FEITO

**Pedido.** Ter opções — usar firecrawl ou tavily quando a OpenAI não estiver disponível.

**Estado medido — as opções já existem; o defeito é outro.**
`web-search.ts` já suporta `tavily`, `firecrawl`, `anthropic` e `openai`, com modo `auto`
e ordem `tavily → firecrawl → anthropic → openai`. A instância está em `auto`
(`app_settings.web_search`). O `auto` resolve o provedor **uma única vez, pela presença
de key**, e **não cai para o próximo quando o escolhido falha em execução**. Sem key de
tavily/firecrawl, ele acerta ao escolher a OpenAI — e morre no erro dela (429
`insufficient_quota` e 401 vistos nos jobs).

**Plano.**
1. **Failover em execução:** o `auto` percorre a ordem e tenta o próximo provedor a cada
   falha, registrando qual respondeu.
2. Distinguir **falha do provedor** de **ausência de key** na mensagem que chega à UI.
3. Gravar key de Tavily ou Firecrawl (ação do Tiago) — sem nenhuma delas, o failover não
   tem para onde cair.

---

## 6. Conector MCP da plataforma · ✅ FEITO

**Pedido.** A plataforma expõe um servidor MCP com código de instalação (estilo
`claude mcp add`), URL e credenciais, para conectar qualquer modelo. Vantagens: usar o
contexto do onboarding no modelo e operar a plataforma pelo modelo.

**DECIDIDO — escopo:** o modelo **lê contexto e cria rascunho**. Aprovar, agendar e
publicar continuam exclusivos da interface.

**Plano.**
1. Edge `mcp-server` falando MCP sobre HTTP, autenticada por **token por instância**
   (gerado e revogável em Config), com escopo declarado.
2. Ferramentas de leitura: marca (persona, bandeira, guardrails, brand kit), acervo de
   contexto com a busca híbrida, peças e status.
3. Ferramentas de escrita **restritas**: criar job de geração; anexar item ao acervo.
4. Tela em Config com a linha de instalação pronta para copiar e o token.

---

## 7. Motor automático de redes sociais · ✅ FEITO

**Pedido.** Gatilho configurável — quantidade de carrosséis por dia, por rede — talvez
uma página só para isso.

**DECIDIDO:** o gatilho **gera e enfileira**; nada vai ao ar sem aprovação humana.

**Plano.**
1. Tabela de gatilhos: conta de destino, família de formato, quantidade por período,
   janela de publicação, fonte da pauta (radar, acervo, tema livre).
2. Execução por `pg_cron`, reaproveitando o mesmo `generate-content` da criação manual.
3. Página dedicada de automação com os gatilhos, próximo disparo e histórico.
4. Teto de gasto por gatilho (o Diretor de Vídeo já tem esse padrão de teto).

---

## 9. Associação entre postagem e conta · ✅ FEITO

**Pedido (esclarecido).** Hoje parece que "Reels" fica preso a **uma** conta conectada no
Zernio. O certo é o inverso: **qualquer conta conectada pode receber Reels**, se ela
suportar esse formato.

**Estado medido — confirma o problema, e há um furo concreto.**
O vínculo mora em `channels.config.zernio_account_id`: **um formato → uma conta**.
`instagram_carousel` e `instagram_post` apontam para a mesma conta;
`linkedin_post` para outra; e **`instagram_reel` está habilitado sem conta nenhuma** —
Reel gerado hoje não tem para onde publicar.

**Plano.** Inverter o modelo:
1. **Conta** passa a ser a entidade central, declarando os **formatos que suporta**
   (Instagram: reel, story, carrossel, post; X: post; LinkedIn: post; YouTube: short).
2. Uma peça de formato F pode ir para **qualquer** conta que suporte F — inclusive várias.
3. A escolha da conta acontece na publicação e no gatilho do ponto 7.
4. Migração preserva os vínculos atuais como padrão.

---

## 10. Formatos análogos entre plataformas · ✅ FEITO

**Pedido.** Reel é do Instagram, mas é a mesma coisa que Shorts; story idem. Formatos
análogos precisam de um nome comum.

**DECIDIDO:** **camada de família** por cima dos tipos atuais — sem renomear no banco.
Renomear `instagram_reel` mexeria em peças, canais e histórico já gravados, com risco que
o ganho não paga.

**Plano.**
1. Famílias: `video_curto_vertical` (reel/shorts/tiktok), `story`, `carrossel`, `post_texto`,
   `post_imagem`.
2. A peça é gerada **uma vez pela família** e adaptada por plataforma na publicação.
3. UI passa a falar em família; o tipo concreto vira detalhe da conta de destino.
4. Encaixa direto no ponto 9: conta declara famílias suportadas.

---

## 11. Design system transformando o carrossel em imagem · ✅ FEITO

**Pedido.** Depois dos escritos validados, o modelo usa o design system e transforma em
imagem boa.

**Resolvido pelas decisões acima:** é exatamente o par capa-por-IA + miolo-por-design-system
do ponto 2, disparado após a aprovação do texto (ponto 2.1). Não é um item separado de
execução — é a consequência dos dois.

**Revisão de 2026-08-31 — o miolo tinha UMA pele só.** O Tiago olhou a arte e disse: *"a
questão de design system e os carrosséis ainda tá bem pobre"*, com um artefato de dez
sistemas ao lado. Estava certo: o render era capa-com-foto + miolo sólido, uma estética
única. Trocar a paleta do brand kit mudava a cor de um fio; não mudava o mundo visual.

**O que passou a existir:**

- **Chassi + peles.** `src/components/carousel-slide-render.tsx` virou um chassi semântico
  sem estética própria (`.via-slide[data-carousel-system][data-kind] > .photo/.scrim/.deco/
  .pad{.top,.mid,.bot}`) e `src/design-system/carousel-systems.css` traz **onze peles**:
  Casa (a arte que já existia), Grid Brutalista, Cromo Y2K, Riso Zine, Alta-Costura,
  Terminal Fósforo, Memphis Neon, Sumi·Ma, Blueprint Técnico, Colagem Punk, Déco Noturno.
  Trocar o atributo troca paleta, tipografia, grade, ornamento e tratamento de foto de uma
  vez. Catálogo em `src/lib/carousel-systems.ts`.
- **Tratamento de fotografia por sistema.** Design system de verdade tem regra de foto, não
  só de tipo: a mesma foto de IA entra em P&B duro no Brutalista, em duas tintas no Riso,
  reduzida ao fósforo no Terminal, xerocada no Punk. Memphis e Déco declaram
  `photo.mode: "none"` — são gráficos, a foto brigaria com o ornamento — e por isso a UI
  **bloqueia** a geração de imagem neles (e a edge devolve `409 system_without_photo`):
  gerar ali é queimar crédito num arquivo que a arte nunca mostra.
- **A escolha vive na peça, não na tela.** `adapted_content.carousel_system` (por peça,
  via `merge_piece_adapted_content`) sobre `brand_kit.content.carousel_system` (padrão da
  marca). Precisa ser assim: a arte da capa é gerada no servidor DEPOIS da aprovação, e um
  `useState` deixaria a foto num mundo visual e a arte em outro.
- **A foto de IA passou a saber em que mundo cai.** `supabase/functions/_shared/carousel-
  systems.ts` guarda a direção FOTOGRÁFICA de cada pele e ela entra no prompt antes da
  style bible. É isto que fecha o ponto 11: sem ela, a pele mudava e a foto continuava a
  mesma foto genérica.
- **Texto vira manchete + apoio.** `src/lib/carousel-text.ts` divide a string do gerador em
  `{title, body}` de forma determinística (quebra de linha → fronteira de frase → pausa
  interna) e embrulha cada palavra em `<span class="w">`, que é o que permite a Punk trocar
  de fonte a cada palavra e a Memphis colorir por posição.
- **Ajuste medido.** Cada pele tem corpo próprio (Terminal roda em 15cqw, Sumi em 6,6cqw),
  então degrau por comprimento não basta: a arte é medida e o tipo encolhe até caber
  (`--fit`), refazendo a conta quando as fontes da pele chegam.

**Três armadilhas encontradas medindo, não supondo** (todas comentadas no código):

1. `:where(h1,h2,h3,h4){color}` e `h3{font-family}` do kit são cor e fonte DIRETAS no
   elemento — e isso ganha de herança. Sem `color: inherit` / `font: inherit` no `.title`, o
   título saía navy sobre foto escura e Punk/Blueprint saíam em Geist.
2. `document.fonts.ready` resolve antes de a folha da pele ser lida, e uma face só é
   baixada quando um elemento com layout a usa — os nodes do export ficam fora da viewport.
   Por isso `systemFontsReady()` espera o `onload` do `<link>` e chama `fonts.load()` por
   família.
3. Sem `crossorigin` no `<link>` do Google Fonts, `sheet.cssRules` lança SecurityError, o
   html-to-image engole e exporta SEM embutir as @font-face — o PNG só sai certo por sorte
   do cache. Medido: 12 erros de console no export do Punk antes da correção, zero depois.
   E `exportNodeToPng` só cai em `skipFonts` quando o chamador garante que a arte não
   depende de fonte carregada (`allowFontFallback`).

**Medido no arquivo:** export do Punk em 1080×1350, 870 KB, com Archivo Black, Bodoni
itálico, VT323 e Rock Salt embutidas — não com fonte de sistema.

**Correção de 2026-08-31 (mesma tarde) — aquilo ainda era um seletor de temas.** O Tiago
olhou o fluxo pronto e cortou certo: *"vi que tem um botão de trocar design system, tô
achando que esse bgl não tá bem amarrado na proposta. Lembra que a gente cria o design
system no onboarding — essa porra não pode ser hardcodado, ela precisa poder ser criada de
alguma forma com os inputs do usuário. Além disso não tem que ter seletor no carrossel,
tem que seguir o padrão escolhido."*

O diagnóstico, sem rodeio: o onboarding gerava `palette` e `typography` a partir do
material/site/nicho do cliente, e **dez das onze peles ignoravam isso** — tinham hex e
família LITERAIS no CSS. Uma marca com navy e dourado extraídos do próprio site via a arte
sair no azul-e-rosa-flúor do Riso. Só a pele "Casa" lia a paleta. E o seletor por peça
transformava a identidade em capricho de post.

**A separação que passou a organizar tudo:**

| | de onde vem | como chega na arte |
|---|---|---|
| **Matéria** — paleta, tipografia, logo | da MARCA, gerada no onboarding | custom properties inline (`--paper`, `--ink`, `--accent`, `--font-display`…) |
| **Forma** — composição, moldura, textura, foto, sombra, caixa, cantos, respiro, fundo | vocabulário do PRODUTO, enum fechado | `data-*` no slide, um bloco de CSS por valor |

A forma é enum porque retícula, varredura e raio de sol são gradientes e
pseudo-elementos — não cabem num token de cor. A matéria é aberta porque é do cliente.

**O que mudou no código:**

- `src/lib/carousel-art.ts` — o vocabulário (11 eixos) + `normalizeArt` + os rótulos da
  revisão guiada. `src/design-system/carousel-art.css` — **uma** pele paramétrica, sem
  nenhum hex de marca. Foram apagados `carousel-systems.ts`, `carousel-systems.css` e
  `carousel-system-gallery.tsx`.
- `brand_kit.content.art` no lugar de `carousel_system`. `adapted_content.carousel_system`
  vira LEGADO ignorado de propósito (fica declarado no tipo com o porquê, para ninguém
  reintroduzir).
- `src/lib/brand-ink.ts` — paleta de chaves livres → papéis fixos, escolhendo papel e
  tinta por CONTRASTE medido: nome de chave não é promessa de legibilidade, e uma marca
  pode chamar de "background" uma cor escura.
- `src/lib/brand-fonts.ts` — carrega a família **pelo nome livre** que o cliente/IA
  escreveu, com `crossorigin`, esperando o `onload` e pedindo `fonts.load()`.
- `src/components/brand/art-review.tsx` — a revisão guiada do passo 3: um eixo por cartão,
  prévia ao vivo na paleta e na fonte **em edição**, e alerta quando a família não existe
  no Google Fonts (detectado por medição de largura, porque `fonts.check()` mente por
  causa dos subsets). O aviso é aqui, não num toast no meio do export.
- `brand-kit-suggest` devolve o bloco `art` inteiro, eixo a eixo, com instrução de
  combinar de forma coerente e no território da marca.
- `_shared/carousel-art.ts` COMPÕE a direção fotográfica dos eixos (`photo_grade` +
  `photo_slot` + `surface`) em vez de ler um id de catálogo.
- Sumiram os dois seletores: o da peça e a galeria do Brand Kit. Galeria de onze mundos no
  Brand Kit era o mesmo catálogo, uma tela atrás. Sumiu também o botão "miolo
  branco/preto" — fundo também é identidade, virou o eixo `surface`.

**Medido no navegador:** com a paleta padrão e Cinzel/Jost, os eixos `center + double +
sunburst + ink + upper` produzem uma arte Déco de ouro sobre preto — e o ouro é o
`#D4AF37` **da marca**, não um literal do CSS. Trocar cinco eixos de forma não mexeu em
nenhuma cor; trocar a paleta mudou a arte inteira. `e2e/design-system-arte.spec.ts` trava
exatamente isso.

---

## 12. Onboarding do design system · ✅ FEITO

**Pedido.** Um modo de onboarding que gere o design system de verdade: fonte, cor, tudo.

**DECIDIDO:** as quatro origens entram — **marca enviada**, **site do cliente**, **geração
pelo nicho** e **escolhas guiadas** — mas com ressalva explícita do Tiago: *"vai com
cautela pra criar esse fluxo, pra não ficar mil coisas na tela e ninguém saber o caminho a
seguir. Tem que ser bem faseado, e a pessoa entender claramente qual caminho está seguindo."*

**Plano.**
1. **Passo 1 — escolher UM caminho de partida** (tela com quatro opções, uma escolha, sem
   configuração nenhuma visível ainda): tenho material da marca · tenho site · quero que a
   IA proponha · quero escolher manualmente.
2. **Passo 2 — o caminho escolhido roda sozinho** e produz um design system em rascunho.
3. **Passo 3 — revisão guiada**, um aspecto por vez (cor → tipografia → superfícies →
   arte), com prévia ao vivo e a possibilidade de voltar.
4. Em nenhum momento os quatro caminhos aparecem juntos depois da escolha; trocar de
   caminho é uma ação explícita, não um menu sempre presente.
5. Saída alimenta os tokens que o render do miolo (ponto 2) e a capa por IA consomem.

**Fechamento (2026-08-31).** O passo de escolha guiada ganhou o que faltava: além de cor,
tipografia e restrições, o Brand Kit agora escolhe o **sistema de carrossel** padrão da
marca (`brand_kit.content.carousel_system`) — e o caminho "quero que a IA proponha" propõe
esse sistema junto com o resto: `brand-kit-suggest` recebe o menu dos onze mundos com o
"quando usar" de cada um e devolve `carousel_system` no rascunho (id inválido cai no
padrão em vez de quebrar a tela). Sem isso a IA propunha tudo MENOS em qual mundo visual a
marca vive, e sobrava justo a decisão mais visível para o usuário fazer na mão. No Brand Kit a escolha é feita pelo par
tipográfico + paleta + "quando usar" — sem render de arte, porque ali não existe texto de
peça e um lorem em onze peles ensinaria a coisa errada. A comparação visual real acontece
na Biblioteca, onde a galeria monta **as onze artes com o texto da própria peça**, atrás de
uma única porta ("Trocar sistema") para não jogar onze artes na cara de quem só queria
revisar o texto.

---

## Ordem sugerida

A ordem respeita dependências reais, não a numeração da lista.

| Onda | Itens | Por quê |
|---|---|---|
| 1 | **5** (failover da pesquisa), **4** (radar → criação) | Defeitos pequenos e isolados; melhoram o uso diário já |
| 2 | **2 + 2.1 + 2.2 + 11** (capa por IA, imagem após aprovação, regenerar slide) | Onde está o desperdício medido e a maior queixa de qualidade |
| 3 | **3** (quadro de aprovação) | Depende do desenho do painel; independe do backend |
| 4 | **10** (famílias) → **9** (conta × formato) | 9 precisa do vocabulário de 10 |
| 5 | **7** (gatilho) | Depende de 9 para saber em qual conta postar |
| 6 | **12** (onboarding do design system) | Alimenta 2; grande e independente |
| 7 | **1** (carrossel de X) | Bloqueado nos exemplos do Tiago |
| 8 | **6** (conector MCP) | Superfície nova; nada depende dela |

## Dependências e pendências

- **Exemplos do carrossel de X** — o Tiago vai mandar; ponto 1 não começa sem.
- **Key de Tavily ou Firecrawl** — sem ela, o failover do ponto 5 não tem alternativa.
- **`instagram_reel` sem conta no Zernio** — furo atual; resolvido pelo ponto 9, mas dá
  para desbloquear antes mapeando uma conta.
- **Custo da capa por IA** — a decidir por teste com custo medido, não por preferência.
