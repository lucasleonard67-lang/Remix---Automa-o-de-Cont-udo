# 14a — Mesa de Revisão (anexo do ponto 3)

> Especificação produzida por painel de 13 especialistas (4 propostas independentes,
> cada uma julgada por duas lentes céticas — uso diário e engenharia — e sintetizada).
> Notas: `redacao-editorial` 7 e 8 (vencedora) · `produto-saas` 5,5 e 7 ·
> `densidade-informacao` 7 e 7,5 · `kanban-ops` 6 e 7.
>
> **Ressalva do Claude, medida depois:** a síntese justifica a escolha dizendo que a
> Biblioteca mostra "~6 ideias repetidas 4 vezes cada". O mecanismo existe e está no
> código (`saga.ts:1404` grava o MESMO `core_content` e a MESMA `audit` nas N peças do
> job; `pieceHeadline` lê `core.hook.written`), mas a magnitude foi exagerada. Medido no
> banco: **33 peças em revisão, 27 ideias distintas, média de 1,22 card por ideia, apenas
> 9 cards em blocos repetidos, maior bloco = 5**. A duplicação morde quando um job atinge
> vários canais, não a tela inteira. As decisões de desenho seguem válidas; a premissa é
> que precisa ser lida com esse número na mão.

## Desenho escolhido

Mesa de Revisão — master-detail dirigido pela URL (fila agrupada por JOB à esquerda + leitor à direita), com a "linha de aprovação" como esteira horizontal de 6 segmentos no topo. Base: a proposta `redacao-editorial` (notas 7 e 8, o melhor par), reestruturada por três descobertas verificadas no código e enxertada com o melhor das outras três.

## Por que

Escolhi a Mesa porque foi a única proposta cujas afirmações sobre o código eu consegui verificar uma a uma, e porque o gargalo real é ler+decidir, não coordenar estágios. Mas a razão decisiva veio de uma leitura que NENHUMA das quatro propostas fez, e que muda o diagnóstico: `pieceHeadline` (use-content-pieces.ts:276) prefere `core.hook.written` → `core.idea`, os dois vindos do `core_content`, que é IDÊNTICO nas N peças de um job (saga.ts:1409, `rows = targets.map(...)` com o mesmo `core`). Ou seja: a Biblioteca de hoje renderiza blocos de 3-4 cards com exatamente a mesma frase, dentro de um grid de 3 colunas com `line-clamp-3` e três chips que quase sempre dizem "ok". O dono não está olhando 23 peças — está olhando ~6 ideias repetidas 4 vezes cada, sem nenhuma imagem. Isso é, ao pé da letra, "um grande coco", e nenhum kanban conserta: mover cards duplicados entre colunas continua sendo cards duplicados. O conserto é (a) a linha da fila mostrar o que VARIA por peça (a unidade adaptada real + a miniatura da arte) e (b) a ideia e a auditoria subirem para o cabeçalho do job, que é a altitude verdadeira dos dois. Um quadro de 4 colunas também é geometricamente impossível aqui: a largura útil é `viewport − 256 (sidebar) − 48 (p-6)`, ou 976px a 1280 — quatro colunas dariam ~230px cada, MENOS texto legível que o card de hoje. E a esteira horizontal entrega o que o dono pediu de fato ("uma linha de aprovação") em 56px de altura, devolvendo o resto da tela para leitura.

## Especificação

## 1. Rota e arquitetura

- Novo `src/routes/_app/biblioteca/route.tsx` (layout route). Container `mx-auto max-w-[1600px]`. Renderiza: `PageHeader title="Biblioteca"` (move para cá, para `gotoAndExpectHeading` seguir resolvendo e o heading sobreviver na URL de detalhe), a esteira, o ViewToggle, a fila e `<Outlet/>`. NÃO pode introduzir um segundo `<main>` (`nav.spec.ts:43` assere `main`=1 e `main main`=0).
- `validateSearch` sobe para o layout: `{ status?: PieceStatus | "agendadas"; view?: "calendario" }`. O nome `status` fica como está para o deep link de `/criar` continuar valendo; "agendadas" entra como sexto valor.
- `setStatus` para de reconstruir o search como `{}` quando o valor é `draft` — passa a mesclar (`search: (prev) => ({ ...prev, status })`), senão apaga `view`.
- `index.tsx` vira só o estado vazio do leitor.
- `$pieceId.tsx` vira o leitor, SEM refatoração das 1825 linhas: troca `mx-auto max-w-6xl` por `w-full` (o layout passa a dono da largura) e o grid interno vira `@container` + `@3xl:grid-cols-[minmax(0,1fr)_360px]`.
- Todo `<Link to="/biblioteca/$pieceId">` leva `search: (prev) => prev`, senão o escopo da fila cai silenciosamente para draft.

## 2. Esteira de aprovação (a "linha" que o dono pediu)

Faixa horizontal de ~56px, largura total, UM único `<Tabs>` root (dois roots quebrariam o `data-state` compartilhado do teste 1), com 6 `TabsTrigger` e uma barra fina proporcional sob cada segmento:

`Em revisão (23)` → `Aprovadas (4)` → `Agendadas (2)` → `Publicadas (17)` | à direita, visualmente demovidos: `Rejeitadas` · `Arquivadas`.

- Em revisão = `status='draft'`; Aprovadas = `approved && scheduled_at IS NULL`; Agendadas = `approved && scheduled_at IS NOT NULL`; Publicadas = `status='published'` (com `limit: 20`).
- Os 5 nomes acessíveis atuais ficam idênticos — o teste 1 passa sem edição.
- Contagens de um `usePieceStageCounts()` novo (um `select("status, scheduled_at")` contado no cliente; volume single-tenant).
- "Aprovadas sem data" é o gargalo que hoje é invisível nas duas telas: some dentro da aba "Aprovadas" junto com as agendadas e não entra em `useScheduledPieces`, que exige `.gte('scheduled_at', …)`.

## 3. A fila (esquerda, 340px, xl+) — agrupada por JOB

Ordenação: job mais antigo primeiro (acúmulo de 9 dias). Dentro do job, ordem canônica de canal.

**Cabeçalho de bloco (sticky):**
- `pieceHeadline(piece)` em 2 linhas — aqui está correto, porque é atributo do job.
- `há 9 dias` · `4 canais`.
- Faixa de auditoria rotulada: **"Auditoria do job — vale para as 4 peças"**. Renderiza por AUSÊNCIA: linter e grounding limpos não desenham nada. Aparecem só `2 violações` (warn), `1 flag sem base` e a nota `Juiz 8` em Geist Mono. Sem "ok", sem "(corte N)", sem coral.

**Linha de peça (72-80px, `<Link>` de verdade):**
1. Miniatura 48×60 (4:5). Path: `slide_renders[0].path` → `slides[0].image_path` → `card.image_path` → `frames[0].image_path` → `image_path` → poster do reel. Sem arte: card tipográfico sobre `--via-navy-04` com a primeira linha em 13px — esse é o caminho PADRÃO e bonito, não um retângulo cinza.
2. Pílula do canal (11px/500) + forma do formato: `8 slides`, `42s`, `thread 4`.
3. **A primeira unidade ADAPTADA** (2 linhas), nunca `pieceHeadline` — é o que conserta os cards idênticos. Novo helper `pieceRowExcerpt(piece)`: carousel→`slides[0].text`; post→`card.text`; stories→`frames[0].text`; reel→`script.beats[0].narration`; x/threads/facebook→`text`; linkedin→`blocks.hook ?? text`.
4. Estado da arte (`slide_images_job.status`, `N/M artes`) e contador de `[VERIFICAR]` no texto adaptado (esse SIM varia por peça).
5. Em Aprovadas/Agendadas, a data (`qui 04/09 · 09:00`) e o estado Zernio (reusa o `chipClasses` do calendário).
6. `data-channel={piece.channel_type}` no link (ver §8).
- Peça lida na sessão marcada por COR (`--via-text-muted`), nunca por opacity.

## 4. O leitor (`$pieceId`, intocado + 3 adições)

1. Faixa de auditoria no topo, `AuditChips` não-compact (com popover), rotulada como do JOB, mais pills clicáveis das peças irmãs do mesmo job (`Carrossel · X · LinkedIn · Post`) — ler o core uma vez e conferir as N adaptações em sequência.
2. Barra de decisão sticky no rodapé (`--via-glass-bar`): `Aprovar` · `Aprovar e agendar` · `Rejeitar` · `Regenerar` · `Arquivar`.
3. `[VERIFICAR]` destacado no texto adaptado por busca literal de substring. NUNCA `violation.position`.

**Teclado** (guarda obrigatória contra `input`/`textarea`/`contenteditable`/`isComposing` — a busca "Buscar peças" continua na tela): `J/K` anda na fila, `A` aprova, `R` abre o dialog de rejeição com foco no textarea, `S` aprova e agenda, `G` regenera, `E` arquiva, `Esc` volta pra fila, `?` abre a folha de atalhos.

**Avanço:** `nextId` é calculado a partir do array ordenado da fila ANTES de disparar a mutation, e a navegação vai no `onMutate`. Sem isso, `invalidatePieces` remove a peça decidida e o avanço cai em lugar nenhum — 23 de 23 vezes. Foco vai para o `h1` do leitor novo (`aria-live="polite"` na contagem "3 de 23").

## 5. Ações

- **Aprovar**: 1 clique, sem modal, **só no leitor** (a peça está na tela: você leu). Toast 8s: "Aprovada · **Reabrir**".
- **Reabrir** (`useReopenPiece`): `status='draft'`. Não escreve em `piece_feedback` (append-only por RLS). Documentar no hook: o corpus lê o último veredito por peça e confere contra o status atual.
- **Rejeitar**: `VerdictDialog` que já existe, motivo obrigatório. Chips de motivo de 1 clique ("fora da voz", "claim sem base", "gancho fraco", "repetida", "CTA fraco") DENTRO do dialog, pré-preenchendo `notes` — barateia o motivo sem matar o loop de `piece_feedback` nem quebrar o e2e.
- **Agendar**: `SchedulePieceBlock` no leitor + no calendário (§7).
- **Sem drag-and-drop** (rejeitar exige texto, agendar exige data; e `dnd-kit` seria dependência nova). **Sem aprovar em lote.** Único lote: "Arquivar selecionadas", apenas em Rejeitadas/Arquivadas.

## 6. Estados vazios

- Por segmento: mantém `EMPTY_COPY` (draft mantém o CTA "Criar conteúdo").
- Busca: "Nada encontrado" + "…bate com os filtros…" **verbatim** (teste 3 depende dos dois textos).
- Leitor sem seleção (`/biblioteca` puro em xl+): "Escolha uma peça na fila" + botão "Revisar a mais antiga".
- Bloco de job sem peças no segmento: o bloco não renderiza.

## 7. Calendário

`ViewToggle` continua com os rótulos **"Lista"** e **"Calendário"** exatos (teste 2; e renomear mantendo o nome acessível violaria WCAG 2.5.3). "Calendário" navega para `/biblioteca?view=calendario`. A esteira continua visível. O calendário ganha um rail estreito à esquerda com a pilha "Aprovadas sem data" — o mesmo conjunto do segmento 2: clica na peça, clica no dia → `useSchedulePiece`. É a resposta natural para "aprovei, e agora?".

## 8. Suíte Playwright

- `biblioteca.spec.ts` 1-4 passam sem edição: 6 triggers num Tabs root com os nomes atuais; "Lista"/"Calendário" preservados; textos de busca verbatim; Dialog de rejeição mantido.
- `carrossel.spec.ts:20`: o fallback `a[href^="/biblioteca/"]).first()` fica indeterminado com a nova ordenação. Correção de 1 atributo + 1 linha: `data-channel` na linha da fila, e o fallback do spec vira `a[data-channel="instagram_carousel"]`.
- `nav.spec.ts`: layout route sem `<main>` novo.
- `design-system.spec.ts`: painéis em `--via-glass-card`, barra em `--via-glass-bar`, pílulas 11px/500 sem caps, paleta restrita.
- Novo `e2e/biblioteca-fila.spec.ts`: agrupamento por job (2 linhas do mesmo job com excerpts DIFERENTES — é a regressão que importa), J/K, avanço após decisão.

## 9. Geometria (largura útil = viewport − 256 sidebar − 48 p-6)

| viewport | útil | arranjo |
|---|---|---|
| < xl (1280) | ≤ 976 | fila OU leitor, nunca os dois — exatamente o comportamento de hoje |
| xl | 976 | fila 340 + gap 24 + leitor 612; rail de 360 do leitor EMPILHADO sob o preview |
| ≥ ~1600 | ≥ 1288 | leitor ≥ 924 → rail volta ao lado (`@3xl`) |

O `PreviewFrame`/`CarouselDeck` tem base de 540px e `scale = min(1, container/540)`, então a 612px o deck renderiza sem escala — a geometria que `carrossel.spec.ts` mede não muda.

## 10. Hooks e helpers novos

- `useSignedUrls(bucket, paths[], expiresIn)` sobre `storage.createSignedUrls(paths)` (plural, existe no SDK e não é usado em lugar nenhum), semeando as MESMAS keys `['signed-url', bucket, path]` que `useSignedUrl` e `useGenerateImage` já usam. Uma requisição para a fila inteira, em vez de ~40 round-trips no primeiro paint.
- `usePieceStageCounts()`.
- `useReopenPiece()`.
- `PieceFilters` ganha `sort?: "newest" | "oldest"` e `limit?: number`, ambos no `queryKey`, com defaults que preservam `step-tone-gate.tsx`.
- `pieceRowExcerpt(piece)` e `pieceThumbPath(piece)` em `use-content-pieces.ts`.

## 11. Design system

Navy only. Coral **só** em Rejeitar/Arquivar (ação destrutiva) — nunca para "abaixo do corte", que é caso inalcançável. Desabilitado por COR (`--via-text-disabled`), nunca por opacity. Idade ganha PESO tipográfico acima de 7 dias (`--via-text-primary`), não rampa de cor: `--via-chart-5 → --via-chart-1` inverte de sentido no `[data-theme="dark"]` (chart-1 vira #6E8CB4, chart-5 vira #E0E7F1). Nada de dourado, âmbar, roxo, ciano ou Sparkles; ícones `List`/`CalendarDays` que já estão em uso.

## 12. Fases — custo **ALTO**, não médio

- **F1 (é o que responde a queixa):** layout route + esteira + fila agrupada por job com excerpt adaptado e miniatura + `useSignedUrls` + `@container` no leitor.
- **F2:** teclado + avanço + Reabrir + chips de motivo no dialog.
- **F3:** rail de agendamento no calendário + lote de arquivar.

Antes de calibrar a proporção do card, medir no banco quantas das 23 têm arte (`slide_renders`/`image_path`) — não consegui acesso de leitura ao projeto `qzntuqeystiztsmikesc` por esta sessão, e se a maioria não tiver arte o fallback tipográfico é o visual dominante, não a exceção.

## O que veio de cada proposta

**De `kanban-ops` (Esteira de aprovação):** (1) a MINIATURA como conserto direto de "a visualização ta um grande coco" — foi o melhor diagnóstico do lote, e virou o item 1 da linha da fila; (2) o hook `useSignedUrls` em lote, que a própria proposta identificou como pré-requisito escondido (`useSignedUrl` é 1 round-trip por path e o quadro monta dezenas frio); (3) o split `approved` × `scheduled_at IS NULL`, insight ancorado no schema. NÃO trouxe: as bandas "Passou limpo / Precisa olhar / Abaixo do corte" nem o "Aprovar as N" — são estruturalmente vazias e o botão em lote seria "aprovar o que a máquina já auto-aprovou" com o selo de segurança de uma checagem que não separou nada.

**De `densidade-informacao` (fila densa × leitor):** (1) a auditoria por AUSÊNCIA — silêncio = passou, chip só quando tem o que dizer; aplicada na altitude certa (cabeçalho de job) rende ainda mais: some com 69 pílulas "ok"; (2) a correção de ordenação `created_at DESC` → mais antigo primeiro, com `sort` no `queryKey` para não afetar `step-tone-gate.tsx`; (3) a guarda de foco nos atalhos, com o detalhe concreto de que o campo "Buscar peças" continua na tela e o e2e digita "zzz-nao-existe-zzz" (que tem "a" em "nao"); (4) a esteira horizontal com o gargalo como maior segmento — é a leitura mais literal de "linha de aprovação". NÃO trouxe: o medidor nota-vs-corte (44px para 10 pontos é ornamento, lê `channels.config` VIVO e editável, e contradiz o veredito já gravado) nem o grupo "Verificar primeiro", que brigava com a própria ordenação por idade.

**De `produto-saas` (bandas de auditoria):** (1) as 4 raias DERIVADAS como esteira em vez do enum cru — "Agendada" não é status, é `approved` com data, e é isso que faz o Calendário virar a mesma esteira em outro eixo em vez de uma terceira tela solta; (2) o Calendário como superfície de AGENDAMENTO, com o rail "Aprovadas sem data" (hoje o `EditorialCalendar` só exibe); (3) o corte da raia Publicada em ~20 + "ver todas", que virou o `limit` no `PieceFilters` — o hook não tem cap e puxaria `select('*')` com todo o jsonb de toda peça publicada, para sempre; (4) o marcador de formato no card (`8 slides`, `42s`), dado que o card de hoje joga fora. NÃO trouxe: as 3 bandas por veredito da máquina (2 de 3 vazias por construção) nem o undo que segura a escrita por 5s (navegar ou recarregar dentro da janela perde a escrita em silêncio: o card sumiu, o banco não mudou).

**Da própria base, o que sobreviveu intacto:** a seleção ser a URL (é o que mantém `a[href^="/biblioteca/"]` + `toHaveURL(/[0-9a-f-]{36}$/)` passando e o permalink valendo), o agrupamento por job, a recusa fundamentada ao kanban de 5 colunas, e a rejeição barata com chips de motivo.

## Falha grave endereçada

A Mesa recebeu uma falha grave de cada lente; endereço as duas, mais os subitens que as sustentavam.

FALHA 1 (lente 1) — "a auditoria como roteiro de leitura é contradita pelo pipeline". Confirmei os quatro fatos: (i) `runAdapting` (saga.ts:1393) monta UM `const audit` e espalha nas N linhas — auditoria é atributo de JOB; (ii) `runLinting`:1284, `runGrounding`:1311 e `runJudging`:1356 desviam para `'rewriting'` na falha e `runRewriting`:1374 estoura `SagaError` antes do insert — logo toda peça em `draft` passou nos três portões, e `enforceGate` (judge.ts:71-83) só devolve 'approve' com todas as rules ok + voice_pass + bridge_logical + `score >= cutoff`; (iii) o lint roda em `renderCoreContentText(core)`, pré-adapter, então `violation.position` é lixo contra o texto exibido; (iv) o gate rodou com `resolveCutoff(ctx, firstChannel)` — o corte de UM canal.
CORREÇÃO, e não é remendo: a auditoria deixa de ser selo de linha e sobe para o cabeçalho do bloco de job, rotulada "Auditoria do job — vale para as N peças". Isso transforma um sinal falso (constante dentro do grupo, fingindo variar) em um sinal verdadeiro na altitude certa, e de quebra apaga 69 pílulas "ok" da tela. Some com isso: nada de bandas de triagem por auditoria (seriam 2 de 3 vazias por construção), nada de "aprovar as N limpas", nada de medidor nota-vs-corte, nada de `useChannels` no caminho de segurança, nada de coral por "abaixo do corte" (caso inalcançável), e nada de motor de marcação de violações do linter sobre 8 formatos de `adapted_content`. Sobra a marcação de `[VERIFICAR]`, que é honesta e barata: `applyVerifyFlags` (saga.ts:644) escreve o token DENTRO de `core.funnel_blocks`/`cta` ANTES dos adapters, então ele sobrevive à adaptação por construção e se acha por busca literal de substring, sem posições.

FALHA 2 (lente 2) — "o undo não existe como descrito". Confirmei as três pernas e uma quarta: `piece_feedback.verdict` tem `check (verdict in ('approved','rejected'))` (migration 202607290008:103); `UpdatePieceStatusInput.status` é `Extract<..., "approved"|"rejected"|"archived">`; o update faz `scheduled_at: null` incondicional (use-content-pieces.ts:519); e — a que fecha a questão — a tabela tem policies só de SELECT e INSERT, com o comentário "Sem update/delete: feedback é registro histórico (append-only)" (linha 123). Não existe undo que apague, e não vou inventar um.
CORREÇÃO: nada de janela de 5s segurando a escrita (perder a escrita ao navegar é pior que o modal) e nada de "feedback corretivo". A escrita é imediata e o botão do toast se chama "Reabrir", não "Desfazer" — `useReopenPiece` devolve `status='draft'` e NÃO grava nada em `piece_feedback`. A linha `approved` fica no log porque é um fato histórico; o consumidor do corpus lê o ÚLTIMO veredito por peça e confere contra o status atual, e isso vai documentado no hook. Em troca da rede de segurança mais fraca, Aprovar em 1 clique só existe DENTRO DO LEITOR, com a peça na tela — nunca na linha da fila. E Rejeitar continua no Dialog com motivo obrigatório, o que também mantém `biblioteca.spec.ts:47-58` passando (a troca por campo inline, que a proposta original pedia, quebrava esse teste — foi a única quebra que ela mesma causava e não listou).

SUBITENS das duas críticas, todos endereçados no desenho: avanço automático com `nextId` capturado ANTES da mutation (senão `invalidatePieces` remove a peça e o alvo se perde nas 23 de 23 vezes); `sort` como parâmetro no queryKey para não afetar `step-tone-gate.tsx:67`, que consome o mesmo `useContentPieces`; `validateSearch` subindo para o layout route e o `setStatus` parando de reconstruir o search como `{}` (index.tsx:80); coral restrito a ação destrutiva; e a medida de leitura, que NÃO encolhe — a 1280 o detalhe de hoje já é 976−360−24 = 592px, e a Mesa entrega 612px.

BLOQUEIO NOVO que eu mesmo achei e que nenhuma crítica pegou: `$pieceId.tsx:391` usa `lg:grid-cols-[minmax(0,1fr)_360px]`, e `lg:` é media query de VIEWPORT, não do container. Dentro de um outlet de 612px o rail de 360 dispararia assim mesmo e o preview cairia para 228px — o carrossel a 42% de escala, recriando a queixa do dono dentro do conserto dela. Solução: `@container` do Tailwind v4 no wrapper do leitor, com `@3xl:grid-cols-[minmax(0,1fr)_360px]`. O rail empilha sozinho a 612 e volta para o lado acima de ~1600 de viewport.

## Fora de escopo na primeira versão

**Não entra na primeira versão, com o motivo:**

1. **Kanban de 4-5 colunas com arrastar.** Geometria impossível (976px úteis a 1280 → ~230px por coluna, menos texto legível que o card de hoje); com 9 dias de fila as colunas 2-4 estariam vazias por definição; e arrastar não expressa nenhuma das duas transições reais (rejeitar exige texto de motivo que vira `piece_feedback`, agendar exige data). `dnd-kit` seria dependência nova. Vou dizer isso ao dono com a esteira já na tela: ela É a linha de aprovação que ele pediu.
2. **Bandas de triagem por auditoria e "Aprovar as N limpas".** Estruturalmente vazias e perigosas — ver `falha_enderecada`.
3. **Medidor / rótulo nota-vs-corte ("8.4 / 8").** O corte exibido nunca seria o corte aplicado. O dado honesto (`judge.diagnosis`, que `enforceGate` escreve com o corte realmente resolvido) só existe quando houve rewrite, que não chega à Biblioteca.
4. **Motor de marcação das violações do linter sobre o texto adaptado.** Era o item mais caro do painel e mira o texto errado (`violation.position` indexa o core pré-adapter). Fica só o `[VERIFICAR]`, por substring literal.
5. **Undo que apaga o `piece_feedback`.** Impossível sem migration (RLS sem update/delete, por desenho). Fica o "Reabrir", que é honesto.
6. **Refatoração das 1825 linhas do `$pieceId`.** O leitor entra inteiro no outlet; o que muda é o container e um `@container` no grid. `CarouselDeck`, `ReelProjectView`, export ZIP, `PublishBlock`, realtime e os 5 dialogs ficam exatamente onde estão.
7. **Virtualização.** ~6 blocos de job não justificam a dependência; acima de 8 blocos, "carregar mais".
8. **Aprovar em lote, e rejeitar em lote com motivo compartilhado.** O texto do motivo é o ativo mais valioso da tela — retroalimenta o gerador. Único lote: "Arquivar selecionadas" em Rejeitadas/Arquivadas.
9. **Régua de idade por rampa cromática.** `--via-chart-5 → --via-chart-1` inverte de sentido no dark. Idade por peso tipográfico.

**Fallback de fase 0** (se o rail de 360px brigar mais que o previsto com o estúdio, ou se a `@container` não cobrir algum caso): manter `/biblioteca` como página única, sem layout route, e entregar só (a) a fila agrupada por job com excerpt adaptado + miniatura e (b) o revisor serial no `$pieceId` intocado — `J/K/A/R` com `nextId` capturado antes da mutation. Isso preserva a maior parte do ganho de vazão a uma fração do custo. É plano B do mesmo desenho, não um desenho concorrente.
