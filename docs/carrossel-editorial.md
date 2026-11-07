# Carrossel editorial — o padrão da casa

O carrossel nasce como **reportagem**: manchete curta, texto corrido, uma foto ou um gráfico de apoio, muito ar. Os fundamentos abaixo são fixos; a marca personaliza cor, fonte e foto.

Medido num carrossel de referência de 1080×1350 (4:5). Os valores estão em `cqw` (1cqw = 1% da largura do slide), então valem igual no preview de 540px e no PNG de 1080px.

## Capa

- Foto sangrada ocupando o topo (61% da altura), apagando no preto a partir de 40%.
- Embaixo, a 7,4cqw das bordas laterais e 6,5cqw da inferior:
  - assinatura: avatar redondo de 7,2cqw (logo da marca inteiro; sem logo, a inicial na cor de destaque), nome em negrito 2,9cqw e @ em 2,45cqw a 62% de opacidade. O @ é o da conta do Instagram conectada; sem conta, a linha some;
  - manchete a 3,3cqw da assinatura: 4,65cqw, entrelinha 1,23; a primeira frase em peso normal e a **virada com o número forte em negrito**;
  - "Arrasta pro lado →" em negrito 2,4cqw, a 2,4cqw da manchete.

## Miolo

- Fundo papel (`--paper`), texto tinta (`--ink`). Sem cabeçalho, rodapé nem numeração.
- Margem lateral de 8,4cqw. O bloco inteiro fica **centrado na vertical**.
- Manchete: 5,68cqw, peso 700, entrelinha 1,1, espaçamento -0,025em, até ~60 caracteres, terminando em ponto.
- Texto: 3,6cqw abaixo da manchete; 3,02cqw, entrelinha 1,53; 1 a 3 parágrafos de até 2 frases, separados por 2,6cqw. **Negrito** só no número-chave ou na citação central (até 2 por slide).
- Apoio (no máximo um por slide), 4,7cqw abaixo do texto (gráfico: 4,5cqw):
  - **foto** na largura do texto, 16:9, canto de 0,5cqw; no máximo 3 no miolo e no máximo duas seguidas;
  - **gráfico de barras**: legenda em caixa alta 2,36cqw com espaçamento 0,06em na cor de apoio (`--muted`); valores em negrito acima das barras; rótulos embaixo; barras na tinta e a **última (ou a destacada) na cor de destaque** (`--accent`). Um por carrossel, só com números que estão no material, e fecha a história; depois dele vem o fecho com a chamada.

## Fecho (o último card)

Todo carrossel termina com o fecho: a tese, o próximo passo e o botão. Ele vem depois do gráfico (ou do fato mais forte) e é o único card com chamada.

- Fundo tinta (`--ink`) com o halo do destaque, como a capa fecha em preto: os dois extremos do carrossel são escuros, o miolo é papel.
- Manchete: a tese em uma frase curta (até 60 caracteres, terminando em ponto), 6,4cqw.
- Próximo passo (até 160 caracteres, na voz da marca, a partir do CTA do conteúdo): quando o canal é conversa (WhatsApp ou Direct), sai como **balão de mensagem** da marca, papel sobre tinta, canto reto embaixo à esquerda e "agora" no rodapé; para site e perfil, texto corrido.
- Bandeja de botões (arte, não clicam): o botão do canal em pílula de 9,6cqw com o ícone (WhatsApp no verde oficial `#25D366`; Direct, site e perfil na cor de destaque, texto branco ou tinta conforme o contraste) e o rótulo em 2 a 4 palavras; embaixo, os dois que o Instagram oferece, "Salvar" e "Compartilhar", em contorno.
- Assinatura pequena da marca (logo ou inicial, nome e @ da conta conectada).
- Dados: `role: 'cta'`, `title`, `paragraphs[0]`, `cta: { kind: 'whatsapp' | 'direct' | 'site' | 'perfil', label }`, `visual: 'none'`. Sem foto nem gráfico; "O que mudar neste slide" muda a tese e o passo, não o botão.
- Escritor do servidor: o modelo entrega `cta` junto com `cover` e `slides`; sem fecho inteiro o carrossel não sai (tenta de novo, depois o adapter). Pelo conector, `carrossel_criar` exige `cta` e devolve "Fecho: …" na lista de problemas.
- Peças antigas (sem `role: 'cta'`) continuam como eram: o último slide delas é miolo.

## Onde mora

- Desenho: `src/components/carousel-slide-render.tsx` (`EditorialContent`) e `src/design-system/carousel-editorial.css`. É o layout `editorial` do vocabulário de arte (`src/lib/carousel-art.ts`), agora o padrão.
- Fallback: peça do adapter (só `text`) segue no mesmo desenho. `src/lib/carousel-editorial.ts` tira a virada da capa e o número-chave do miolo. Foto só vem de `editorialPhotoIndexes`, que respeita o `visual` do escritor.
- Escrita: `supabase/functions/_shared/editorial-carousel.ts` reorganiza o core já auditado em `title`, `paragraphs`, `visual` e `chart` por slide. Os números do gráfico são conferidos no material, e o texto passa no linter da marca; se algo falhar, entra o adapter determinístico (o desenho deriva manchete e parágrafos do `text`).
- Fotos: `generate-image` gera a capa e os slides com `visual: 'photo'` (que já nascem com `photo_promoted`).
- Identidade: o layout é fixo em todas as marcas. `normalizeArt` ignora layout, moldura, textura, jogo de letras e sombra gravados no kit; a marca muda cor, fonte e foto.

## Pelo conector (Claude Code)

- `gerar_conteudo` com `canais: ["instagram_carousel"]` cria o rascunho no padrão. Canal desconhecido ou desligado responde com erro, em vez de gerar em todos os canais.
- `carrossel_criar` é o caminho em que o Claude da pessoa escreve tudo, sem API: sem conteúdo, devolve a receita medida no carrossel de referência (`_shared/carrossel-receita.ts`); com conteúdo (`cover`, `slides` e `cta`), passa pelas mesmas regras do escritor do servidor (`checkWrittenCarousel`) e grava o rascunho. A peça entra sem as auditorias de fatos e de juiz, que dependem do LLM do servidor: os chips ficam pendentes e quem revisa decide. Número de gráfico fora do `material` exige fonte, gravada em `adapted_content.fontes`.
- `carrossel_ver` mostra o que cada slide pede: apoio, cena sugerida e se já tem foto.
- `carrossel_fotos` coloca fotos por URL https (PNG, JPG ou WEBP, até 10 MB), só em rascunho. Foto de IA fica na Biblioteca, que mostra o modelo e o custo antes de gerar.

## Stories e Post

O mesmo escritor (`editorialPiece({ format })` em `supabase/functions/_shared/editorial-carousel.ts`; `editorialCarousel` continua como atalho do carrossel) escreve stories e post quando o design system ativo usa o layout `editorial`. Uma chamada LLM por formato presente nos canais da peça; o resultado substitui `frames` (stories) ou `card` (post) do adapter determinístico.

- **Stories (4 a 5 frames, 9:16)**
  - frame 0, `role: 'gancho'`: manchete de até 140 caracteres, 1–2 frases, a virada com o número em **negrito**; `image_brief` com a cena fotográfica; `visual: 'photo'` e `photo_promoted`.
  - frames 1..3, `role: 'desenvolvimento'`: `title` de até 45 caracteres terminando em ponto; 1–2 `paragraphs` de até 160 caracteres; `visual` foto, gráfico ou nada — no máximo 2 fotos, nunca duas seguidas; no máximo 1 gráfico com 3 a 5 barras, só com números que estão no material.
  - último frame, `role: 'cta'`: `title` = a tese, 1 parágrafo = o próximo passo; sem apoio visual.
  - `text` = título + parágrafos separados por quebra de linha (no gancho, a própria manchete).
- **Post (um card, 4:5)**: `title` de até 60 caracteres, 1–2 `paragraphs` de até 200 caracteres, `visual` foto, gráfico (3 a 5 barras, números conferidos no material) ou nada. `text` = título + parágrafos.
- **Em todos os formatos**: qualquer unidade com `[VERIFICAR` derruba a peça editorial; cada unidade passa no linter da marca com o `channel_type` do canal; números do gráfico são conferidos no material. Falhou qualquer regra → fica o adapter determinístico (o desenho deriva manchete e parágrafos do `text`).
- `StoryFrame` ganhou os mesmos campos editoriais de `TweetCardSlide` (`title`, `paragraphs`, `visual`, `chart`, `photo_promoted`).

### Marca nova, memória nova

- `brand_autopilot.started_at` (em `app_settings`) delimita a voz atual: a saga só usa como referência de estilo peças aprovadas com `created_at` a partir dessa data, e só calibra o juiz com feedback a partir dela. Sem leitura registrada, nada é filtrado.
- Quando uma nova leitura começa (`brand-autopilot` start), `editorial_state.state.recent` é zerado (as outras chaves ficam).
- O gate de tom gera a amostra em `instagram_carousel` se o canal estiver ligado; senão `instagram_post`. Nunca stories.
- Enquanto `brand_autopilot.status === 'running'`, `generate-content` responde `409 brand_reading` ("A marca ainda está sendo lida…"). As amostras do gate de tom não passam por essa função e seguem normais.
