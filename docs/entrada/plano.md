# Entrada: Hub de Produção de Conteúdo

Data: 2026-10-30. Plano de design e movimento para `/login`, sem código. Base: a referência hyperframes.heygen.com, capturada em 1440×900, e o código atual de `login.tsx`, `engine-pulse.tsx`, `hub-route-tile.tsx`, `hub-examples.ts` e `video-hub.ts`. **NÃO VERIFICADO** marca o que ainda precisa de medição.

## Decisões em uma leitura

1. **A entrada apresenta o produto sem atrasar quem só quer entrar.** O formulário aparece na primeira dobra, pronto antes da animação.
2. **O movimento vem da referência, a identidade não.** Mantemos peças em 3D que voam e se montam com conteúdo dentro. Trocamos os triângulos, o bege e o arco-íris pela nossa forma e pela nossa paleta.
3. **A ideia própria: a peça se monta.** O mosaico passa pelas etapas reais da produção: pauta, roteiro, vídeo, carrossel, resultado. A referência só mostra vídeos.
4. **Nenhum vídeo de usuário, por construção.** A página não consulta o banco nem o bucket de produção (§6).
5. **Exemplos próprios antes de publicar.** Os vídeos do hub são dos provedores: servem no protótipo, não na página pública (§5).

## 1. O que há na referência

| Elemento | Como funciona | O que levamos |
|---|---|---|
| Mosaico | triângulos de vidro em 3D, com vídeo contínuo atravessando todos; desmontam e remontam em ciclo | peças em 3D com um conteúdo só atravessando o conjunto |
| Revoada | peças soltas giram e entram pelo lado direito | sim, mais contida |
| Fundo | feixes de luz em arco-íris sobre bege | só a ideia do feixe, em azul-gelo |
| Tipo | nome enorme com título fino em duas linhas | contraste de escala, com a nossa fonte |
| Galeria | duas fileiras em movimento, larguras misturadas, etiqueta em pílula, pausa, abre em destaque | sim, com os nossos templates |
| Técnica | 2 `canvas` e 91 `<video>` na página | um mosaico leve e no máximo 4 vídeos tocando |

## 2. Primeira dobra

```
Subido AI

                                      HUB DE PRODUÇÃO
    ◢◤◢◤◢◤                            DE CONTEÚDO
  ◢◤◢◤◢◤◢◤◢◤     ◤ ◢                  da Viver de IA
  ◢◤ mosaico ◢◤◢      ◢◤
    ◢◤◢◤◢◤◢◤◢◤   ◢                    E-mail
        ◢◤◢◤◢◤     ◤◢                 [ voce@empresa.com     ]
                                      Senha
                                      [ Sua senha            ]
  Do tema ao post publicado.          Esqueci minha senha
                                      [ Entrar →             ]
```

- **Título:** Anton em caixa alta, sempre peso 400, como pede o kit da marca. "da Viver de IA" em Geist, bem menor.
- **Frase de apoio:** uma só, embaixo do mosaico. Ela muda junto com a etapa (§3).
- **Fundo:** claro, com o ruído do kit e um feixe largo do azul-gelo ao azul-claro da marca. Sem arco-íris e sem sombra colorida.
- **Formulário:** sem caixa, direto sobre o fundo. Reaproveita campos, botão, recuperação de senha e redirecionamento atuais.
- **Telefone:** o formulário vem primeiro, como hoje. Abaixo fica uma faixa do mosaico como imagem e, depois, a galeria.
- **Sessão já aberta:** segue direto para o app, sem animação.

## 3. Movimento: a peça se monta

**Forma:** peças de 4 lados, cortadas no ângulo da diagonal do "A" do logo, em torno de 58°. É isso que tira o mosaico do triângulo da HeyGen e o torna reconhecível como nosso.

O ciclo tem cerca de 16 s. Cada troca é uma virada em onda, peça por peça, e o verso de cada peça traz a etapa seguinte.

| Tempo | Etapa | O mosaico mostra | Frase |
|---|---|---|---|
| 0–2 s | Entrada | peças soltas chegam girando e se encaixam | Do tema ao post publicado. |
| 2–5 s | Pauta | ficha de tendência do Radar | O Radar acha o assunto. |
| 5–8 s | Roteiro | texto sendo escrito | A IA escreve na sua voz. |
| 8–11 s | Vídeo | um clipe atravessando todas as peças | Vídeo pronto, com ou sem você. |
| 11–13 s | Carrossel | slides no padrão editorial | Carrossel na sua marca. |
| 13–15 s | Resultado | gráfico de alcance subindo | Publicado e medido. |
| 15–16 s | Fecho | peças se fecham no símbolo AI, em azul, e soltam de novo | — |

- **Ritmo:** chegada com desaceleração longa, sem quique. Virada de cerca de 500 ms com atraso curto entre as peças. A referência flutua; a nossa encaixa com precisão, porque o assunto é produção.
- **Cursor:** inclina o conjunto de leve no computador. Sem efeito no toque.
- **Formulário em foco:** o mosaico desacelera. Quem está digitando não pode competir com a animação.
- **Peças soltas:** poucas, à direita, sem invadir o formulário. A referência espalha mais, mas lá não há campo para preencher.
- **Gráficos:** vêm da linguagem do `EnginePulse`, que já desenha alcance, engajamento e grade. O mural atual sai do login e passa a alimentar o mosaico e a §4.

## 4. Abaixo da dobra

**O que dá para fazer.** Duas fileiras em sentidos opostos, a de cima com vídeos e a de baixo com o restante.

```
─ O que dá para fazer ──────────────────────────────── ⏸

[9:16 vídeo][9:16 vídeo][ 16:9 ][9:16 vídeo][9:16 vídeo] →
 Avatar      Meu clone   Cenas   Tradução    Legenda

← [carrossel][gráfico][tela dividida][vídeo por cima][post]
```

- **Fileira 1, vídeo:** os mesmos caminhos da área de criar: Vídeo de cenas, Um avatar apresenta, Minha foto vira apresentador, Meu clone, Só a ideia, Traduzir e Reenquadrar.
- **Fileira 2, peças e edição:** carrossel editorial, post, gráfico de resultado e os templates do editor por prompt, em `docs/editor-por-prompt/experiencia.md`.
- **Só o que existe:** cada exemplo precisa existir em produção. Tela dividida e vídeo por cima só entram quando o motor os entregar.
- **Etiqueta:** pílula escura com uma ou duas palavras, sobre o exemplo.
- **Toque:** abre o exemplo em destaque, na própria página, com ✕. A fileira pausa. Nenhum link leva para outra página.
- **Pausa:** botão visível, como na referência. O movimento automático precisa dele por acessibilidade.
- **Vídeos:** mudos, e só tocam os que estão visíveis. O padrão de `HubRouteTile` já faz isso.

**Gráficos.** Uma tira aberta, sem caixas, com três leituras: alcance, engajamento contra o mercado e peças por semana. Cada uma leva o rótulo "Marca de exemplo". O número é ilustrativo, e uma página pública não pode parecer resultado real.

A página termina aí. O único botão de ação é "Entrar", e ninguém precisa rolar para encontrá-lo.

## 5. De onde vêm os exemplos

| Fonte | Uso | Motivo |
|---|---|---|
| `HUB_EXAMPLES` (CDN dos provedores) | **só no protótipo** | no app, cada exemplo cita a fonte. Numa vitrine pública, o vídeo de terceiro com rosto real parece resultado nosso, os direitos não foram conferidos e o link pode cair |
| Conjunto próprio feito no nosso motor | **publicação** | direitos nossos, arquivo sob controle, e prova que a plataforma faz aquilo |

Conjunto próprio: cerca de 8 clipes de 3 a 4 s, com marca fictícia e apresentador com autorização de uso ou avatar sem pessoa real por trás. O vídeo-base pode ser o mesmo dos templates do editor, para gerar uma coisa só. Produzir gasta crédito, então cada geração precisa do seu OK, com custo mostrado antes.

## 6. Garantia: nenhum vídeo de usuário

- **Lista fechada:** os exemplos ficam num arquivo estático do repositório, com caminhos locais de `public/`.
- **Sem banco:** a parte visual da entrada não consulta Supabase nem usa URL assinada. A única consulta segue sendo a do cadastro aberto, que não traz mídia.
- **Teste automático:** falha se o catálogo tiver URL externa, `supabase.co` ou `renders`, e se a página pedir qualquer mídia fora de `public/`.
- **Conferência de arquivo:** antes de entrar no repositório, cada clipe é aprovado por você. Nada de marca de cliente, @ real, rosto sem autorização ou captura de tela de conta real.
- **Sem cópia:** não usamos vídeos, formas, marca nem textos da HyperFrames. A referência é só de movimento.

## 7. Desempenho e acessibilidade

| Item | Regra |
|---|---|
| Formulário | utilizável antes de qualquer script do mosaico |
| Mosaico | código carregado depois, em arquivo separado, só em tela grande |
| Tecnologia | WebGL2 direto, sem biblioteca nova, com um único vídeo como textura. O protótipo confirmou que basta para o mosaico inteiro |
| Orçamento | até 40 KB comprimidos de código e 1,5 MB de mídia até o fim do ciclo. São metas, a medir no protótipo |
| Queda de desempenho | abaixo de 30 quadros por segundo por 2 s, troca pela imagem parada |
| Sem WebGL ou com movimento reduzido | imagem parada do mosaico montado e galeria estática |
| Aba em segundo plano | para tudo |
| Leitor de tela | mosaico decorativo, oculto. Galeria com nome em cada exemplo |
| Autopreenchimento | gerenciador de senhas e e-mail continuam funcionando, com testes `e2e` do login verdes |

## 8. Ordem

1. **Protótipo do mosaico** com etapas e exemplos provisórios, em rota de teste fora do menu. Aqui se decide o movimento, porque ele não se aprova em documento.
2. **Primeira dobra real** em `login.tsx`, com formulário preservado e imagem parada.
3. **Mosaico ligado** com orçamento medido.
4. **Galeria e gráficos.**
5. **Conjunto próprio de clipes** e teste do §6. Só então a entrada pode ir ao ar.

O trabalho só muda telas: não toca em banco, edge functions nem em arquivo congelado.

## Pendências

- **Samuel:** aprovar a produção dos clipes próprios e os custos antes de gerar.
- **Samuel:** enviar o logo da Viver de IA, se ele deve aparecer. O repositório só tem Subido AI, por isso o plano usa o nome em texto.
- **Instâncias de cliente:** o remix herda esta tela. "da Viver de IA" deve ficar num ponto só, fácil de trocar, ou aparece no login do cliente.
- **Medição:** peso real dos clipes e desempenho em notebook comum.
