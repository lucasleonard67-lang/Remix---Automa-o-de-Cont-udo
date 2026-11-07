// _shared/carrossel-receita.ts — o carrossel de referência, medido, para o Claude da
// pessoa escrever no padrão da casa. Os limites valem em checkWrittenCarousel; aqui
// fica o que os limites não dizem: o ritmo. Layout: docs/carrossel-editorial.md.

export const CARROSSEL_RECEITA = `Carrossel no padrão da casa: uma reportagem de negócios em 10 cards, 1080×1350. O produto desenha tudo. Você escreve o texto e acha as fotos.

SEQUÊNCIA DOS 10 CARDS
1. Capa: foto real do assunto, assinatura da marca e "Arrasta pro lado →", que o produto coloca. Você escreve o gancho: duas frases, cerca de 145 caracteres. A primeira apresenta a situação; a segunda é a virada com o número mais forte, toda entre **dois asteriscos**.
2. Só texto: a origem da história.
3. Foto: o começo real.
4. Foto: como funciona na prática ou onde acontece.
5. Só texto: um fato curto e forte.
6. Foto: o produto ou a operação.
7. Só texto: a objeção que o leitor faria.
8. Só texto: como escalou.
9. Gráfico: fecha a história com os números que a provam. A última barra sai na cor de destaque.
10. Fecho (cta): a tese em uma frase, o próximo passo e o botão. O produto desenha o botão com o ícone do canal (WhatsApp, Direct, site ou perfil), os botões de salvar e compartilhar e a assinatura da marca.

Menos cards só se a história for menor: o mínimo é 5 no miolo. O fecho sempre existe.

TEXTO DE CADA CARD
- Uma ideia por card, em ordem cronológica ou de causa e efeito.
- title: manchete concreta de 23 a 38 caracteres. Ex.: "Pegou, pagou, foi embora." ou "De R$ 100 milhões pra R$ 336 milhões."
- paragraphs: 2 parágrafos curtos, de 60 a 175 caracteres, somando de 190 a 320. O card do gráfico leva 1.
- Linguagem falada: "pra", frases curtas, sem jargão. Pode abrir com uma pergunta do leitor.
- **Negrito** só no número-chave ou na citação central, no máximo 2 por card, e nem todo card precisa.
- Cite quem disse: nome e fonte do número ("segundo a empresa", "pelo ranking da ABF", "numa pesquisa da FGV").
- Sem emoji, hashtag ou travessão. Nunca invente fato, número, nome ou citação.

FOTOS
- Reais, do assunto da história: o lugar, o produto, as pessoas. Nunca banco genérico nem imagem de IA fingindo ser foto real.
- 1 na capa e 3 no miolo. Podem vir duas seguidas, nunca três. No miolo, a foto fica em 16:9 abaixo do texto; escolha horizontal.
- Na capa, a parte de baixo escurece: deixe o assunto no alto da imagem.
- Sem texto seu por cima: a tipografia é do produto.
- Em image_brief, descreva a foto que o card pede.

GRÁFICO
- 1 por carrossel, de 3 a 6 barras comparáveis, com legenda clara ("vendas das lojas, em R$ milhões").
- Número que não está em material precisa da fonte em cada barra.

FECHO (cta)
- title: a tese da história em uma frase curta, até 60 caracteres, terminando em ponto.
- paragraph: o próximo passo concreto, até 160 caracteres, na voz da marca e com a chamada do repertório dela (marca_ler mostra cta_repertoire). Sem chamada genérica.
- button.kind: "whatsapp" se a chamada é chamar, agendar ou falar no WhatsApp; "direct" se é mandar mensagem no Instagram; "site" se é um link ou a bio; "perfil" se é seguir.
- button.label: o texto do botão, 2 a 4 palavras no imperativo, até 28 caracteres. Ex.: "Chamar no WhatsApp".

COMO ENTREGAR
1. Pesquise e, se houver, use acervo_buscar. Mostre à pessoa o ângulo antes de escrever.
2. Chame carrossel_criar com tema, legenda, cover, slides e cta. Se vier a lista de problemas, corrija e chame de novo.
3. Desenhe você a arte: artes_pendentes lista cada card, com tamanho e cena. Faça um SVG acabado, com composição, luz e profundidade, nas cores da marca, sem texto nem logo, e envie em arte_enviar. Se tiver foto real que a marca possa publicar, use carrossel_fotos.
4. Confira em carrossel_ver.
5. Diga que o rascunho está na Biblioteca para revisar. Aprovar e publicar são só na tela. Fatos e nota ficam pendentes nas auditorias, porque você escreveu: avise a pessoa para conferir.`;
