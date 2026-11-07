# Editor por prompt: viabilidade no motor atual

Data: 2026-10-30. Este documento mede o que o motor de edição consegue fazer para editar um vídeo por prompt de áudio. Foi só pesquisa: o motor não mudou e nada foi publicado.

Amostras, quadros, scripts e números crus estão em `~/Developer/editor-amostras`, fora do repositório.

## Conclusão

**O sandbox do Higgsfield comporta todos os efeitos pedidos, se tiver a versão e os recursos que o `probe` ainda precisa confirmar.** Tela dividida, picture-in-picture, B-roll, zoom lento, transições, texto animado, flash e shake rodaram em ffmpeg real, com o encode do motor e o vídeo de fala de teste.

O limite de 16k caracteres não barra o projeto. O filtro já vai pelo bucket, então o limite só alcança as URLs, e um manifesto resolve isso. Falta descobrir CPU, memória, disco e tempo máximo do sandbox.

Só exigem worker próprio os recursos que dependem de um modelo ou de navegador: acompanhar o rosto, recortar a pessoa, texto atrás dela e motion em HTML.

## Como foi medido

| Item | Valor |
|---|---|
| Máquina | Apple M1, 8 núcleos, 8 GB |
| ffmpeg | 6.0 com libass; 9.0 sem libass para os itens sem texto |
| Saída | 1080×1920, 30 fps, `libx264 veryfast crf 20`, como no `renderCommand` |
| Fala | áudio real de 22,8 s |
| Imagem | apresentador e B-rolls **sintéticos**, com o tempo gravado no quadro |
| Conferência | quadros vistos de olho, nas bordas de cada efeito, e duração por `ffprobe` |

**O que estes números não provam:**
- Nada rodou no sandbox real. O teste com 2 threads aproxima um servidor pequeno, mas o M1 tende a ser mais rápido que uma vCPU de nuvem.
- A imagem é sintética. Dá para julgar geometria, sincronia e legibilidade, mas não a aparência em pessoa real.
- O grão do vídeo de teste gera cerca de 44 Mbps. Isso aumenta tempo e tamanho de arquivo em relação a um vídeo comum, então os números são conservadores.
- Não testei vídeo de celular (HEVC, HDR, taxa de quadros variável), 4K nem efeito sonoro de transição.
- Não houve chamada real ao Claude nem ao Scribe.

## O que funcionou

Referência: re-encode puro de 22,8 s leva 14,7 s e usa 496 MB. "Velocidade" é a duração do vídeo dividida pelo tempo de render.

| Item | Tempo | Velocidade | Pico | Filtro | Qualidade | Observação |
|---|---|---|---|---|---|---|
| Tela dividida, em cima e embaixo | 17,1 s | 1,33× | 954 MB | 332 | Boa | Entra e sai no quadro certo. Com rosto real, depende do foco |
| Tela dividida, lado a lado | 16,8 s | 1,35× | 912 MB | 324 | Limitada | No 9:16 cada lado fica estreito e o B-roll perde muito |
| PiP reto, 3 cantos e 3 tamanhos | 17,9 s | 1,27× | 814 MB | 659 | Boa | Entrada deslizando funciona |
| PiP arredondado | 17,6 s | 1,29× | 822 MB | 1.295 | Boa | Máscara feita uma vez, sem custo perceptível |
| Bolha do apresentador sobre B-roll | 15,1 s (15 s de vídeo) | 1,00× | 619 MB | 438 | Boa | Círculo limpo |
| B-roll em tela cheia, 3 trechos | 18,2 s | 1,26× | 848 MB | 735 | Boa | Fade de 0,2 s; a fala não é tocada |
| B-roll horizontal com fundo desfocado | 14,6 s | 1,56× | 635 MB | 293 | Boa | Evita cortar um vídeo horizontal |
| Zoom lento com `perspective` | 18,2 s | 1,25× | 516 MB | 316 | **Ótima** | Recomendado (ver abaixo) |
| Transições fade, wipe e slide | 15,9–16,0 s | 1,44× | 685 MB | ~400 | Boa | `zoomin`, `hblur`, `circleopen`, `fadewhite` e `smoothup` também rodam |
| 11 transições em jump cut | 11,8 s (16,5 s de vídeo) | 1,40× | 1.213 MB | 3.036 | Boa | Sem desvio entre som e imagem |
| 30 transições em 105 s | 22,5 s | 4,66× | 1.690 MB | 8.505 | Boa | Imagem fácil de codificar, então vale pela memória, não pela velocidade |
| Texto animado em ASS | 13,6 s | 1,68× | 512 MB | 72 | Boa | Pop, deslizando, palavra por palavra e faixa da marca |
| Flash em ASS | 14,8 s | 1,54× | 511 MB | 70 | Boa | Um evento por flash, em branco ou na cor da marca |
| Shake | 13,2 s | 1,73× | 492 MB | 512 | Boa | Precisa de 8% de folga, que corta as bordas no vídeo inteiro se não for aplicada só no trecho |
| Shake com separação de cor | 18,3 s | 1,25× | 515 MB | 584 | Boa | Efeito de glitch |
| Motion blur com `tmix` | 10,9 s | 2,09× | 502 MB | 69 | Sem veredito | O sintético não permite julgar |
| Câmera lenta com `minterpolate` | 21,5 s (5,9 s de vídeo) | 0,27× | 1.014 MB | 92 | Sem veredito | Rodou, mas é lenta; só vale em trecho curto |

No ffmpeg 9, tela dividida, PiP, B-roll, zoom com `scale` + `crop`, fade e shake renderizaram com a mesma duração e tempos próximos. Nessas saídas conferi duração e tamanho, não os quadros.

### Zoom lento

Medi a tremedeira com um disco parado, em 6 s de 100% a 115%, comparando a posição de cada quadro com uma curva suave.

| Método | Desvio médio | Pior quadro | Quadros parados |
|---|---|---|---|
| `zoompan` | 0,41 px | 1,13 px | 55 de 179 |
| `zoompan` em 2× | 0,21 px | 0,57 px | 1 |
| `zoompan` em 4× | 0,10 px | 0,33 px | 0 |
| `scale` + `crop` | 0,58 px | 0,93 px | 36 |
| **`perspective`** | **0,006 px** | **0,02 px** | **0** |

Usar `perspective`. O `scale` + `crop` também sai descentralizado, porque o `crop` não acompanha o tamanho que muda quadro a quadro.

### Cenário cheio

Reúne cortes, punch-in, shake, B-roll, PiP, tela dividida, títulos, flashes e `loudnorm`.

| Cenário | Threads | Tempo | Velocidade | Pico | Filtro |
|---|---|---|---|---|---|
| 59 s, 18 cortes, 5 sobreposições | automático | 42,9 s | 1,39× | 1.126 MB | 8.207 |
| O mesmo | 2 | 64,3 s | 0,92× | 704 MB | 8.207 |
| 107 s, 36 cortes, 10 sobreposições | automático | 76,7 s | 1,40× | 1.276 MB | 16.177 |
| O mesmo | 2 | 121,1 s | 0,89× | 920 MB | 16.177 |
| Prévia 360p de 59 s | automático | 19,0 s | 3,12× | 882 MB | 8.093 |

Em todos, a duração de vídeo e áudio bateu dentro de 0,06 s. A prévia pesa 2,1 MB, contra 254 MB do render final, e mostra a composição certa.

## O que cabe no sandbox

| Pergunta | Resposta |
|---|---|
| Filtro | Vai por `filter.txt` no bucket. O limite é o de 128 KB por argumento no Linux, cerca de 8 vezes o cenário de 107 s |
| Comando | Com URLs assinadas de 421 caracteres e todos os recursos atuais, o `renderCommand` já usa **8.197 de 16.000** |
| Assets extras | Cada um custa 448 caracteres, o que dá cerca de **16 vídeos** a mais |
| Mais assets | Um manifesto no bucket lido com `curl -K` troca tudo por uma URL. Baixou 40 arquivos em paralelo, em teste local |
| Memória | Pede cerca de 1 GB com 2 threads e até 1,7 GB em cadeias longas de transição |

**Falta confirmar no `probe`:** versão do ffmpeg, `xfade`, `perspective`, `alphamerge`, `geq`, `rgbashift` e `boxblur`, além de `nproc`, memória, disco e tempo máximo. O `probe` atual não verifica nada disso.

**Exige worker próprio:**
- Reenquadrar seguindo o rosto, com rastreamento quadro a quadro.
- Recortar a pessoa, trocar o fundo ou pôr texto atrás dela.
- Motion em HTML com HyperFrames, se o `probe` não encontrar Node e Chrome.
- Câmera lenta suave em trechos longos.
- Vídeos longos, se o sandbox tiver tempo máximo baixo. O valor exato depende do `probe`.

## Novos tipos do menu

Tudo se vincula à fala por índice de palavra, como `hook_first` e `speed` já fazem. Assets entram por ID, nunca por URL.

```ts
type At = { word_from: number; word_to: number };
type Moment = { at_word: number };

type NewOp =
  | { type: 'broll'; at: At; asset_id: string; fit?: 'cover' | 'blur_bg'; enter?: Transition; leave?: Transition }
  | { type: 'split'; at: At; asset_id: string; layout: 'top_bottom' | 'side_by_side'; focus_y?: number }
  | { type: 'pip'; at: At; content: { asset_id: string } | 'speaker'; corner: Corner; size: 's' | 'm' | 'l';
      shape?: 'rect' | 'round' | 'circle'; enter?: 'cut' | 'slide' }
  | { type: 'zoom_slow'; at: At; to?: number; focus?: 'center' | 'face' }
  | { type: 'cut_transition'; after_word: number; kind: Transition; ms?: number }
  | { type: 'title'; at: At; text: string; style: 'pop' | 'slide' | 'word_by_word' | 'band'; position?: 'top' | 'center' | 'lower' }
  | { type: 'flash'; at: Moment; color?: 'white' | 'brand' }
  | { type: 'shake'; at: Moment; intensity?: 'light' | 'strong'; rgb_split?: boolean }
  | { type: 'template'; id: string; slots: Record<string, unknown> };

type Corner = 'tr' | 'tl' | 'br' | 'bl';
type Transition = 'cut' | 'fade' | 'wipe' | 'slide' | 'zoom' | 'blur' | 'white';
```

Um template é um atalho que vira ops comuns e passa pela mesma validação. Sugestão para começar: especialista com B-roll, tutorial em tela dividida, reação com bolha, corte dinâmico. Os mosaicos `quadros/M1.jpg` a `M4.jpg` servem de base para as miniaturas.

## Vínculo com a transcrição

Protótipo `windowOf`, em `scripts/ancora.ts`: recebe o trecho por palavra e os segmentos reais de `buildSegments`, e devolve as janelas no tempo final. Testei com o trecho "primeiro corte os respiros". As janelas bateram com a `retimeWords` da legenda em todos os casos.

| Cenário | Janela de saída | Resultado |
|---|---|---|
| Sem corte | igual ao original | ok |
| Respiros cortados | 4,380–6,230 s | ok |
| Palavra cortada dentro do trecho | 4,380–5,768 s | encolhe sozinha |
| Gancho movido para a frente | 7,900–9,750 s | acompanha |
| Trecho acelerado | 4,380–5,922 s | encurta |
| Trecho inteiro cortado | nenhuma | a op deve ser recusada |

A amostra `40_ancorado_motor_real` usa `normalizeOps`, `buildSegments` e `compileEdit` reais, com um B-roll somado no filtro gerado. O B-roll entrou e saiu no quadro previsto, e a legenda ficou por cima.

**Regras para o compilador:**
1. Ordem: efeitos por segmento, concat, sobreposições, legenda e títulos, marca. Hoje a legenda vem logo após o concat, então as sobreposições precisam entrar antes dela.
2. Janela menor que 0,4 s é descartada, e janelas a menos de 0,15 s uma da outra se juntam.
3. Se o gancho ou um corte partir o trecho, a sobreposição vira várias janelas.
4. Transição em jump cut usa a pausa cortada como folga: cada pedaço de vídeo cresce metade da transição e o áudio segue em corte seco. Sem pausa suficiente, a op é recusada.
5. Asset mais curto que a janela: recusar ou pedir confirmação, nunca esticar sem avisar.
6. Áudio e vídeo saem do mesmo concat. Com `loudnorm` numa cadeia de áudio separada, o ffmpeg 6 gerou 444 s de vídeo em vez de 59 s. O motor já faz o concat junto, e a conferência de duração pegaria esse erro.

## Do prompt ao plano validado

1. **Pedido.** O usuário grava o áudio, e o Scribe transforma em texto. Quem preferir digita.
2. **Contexto.** O Claude recebe o pedido, a transcrição com índices, duração, quadros, assets com ID e duração, templates e as ops atuais.
3. **Plano.** Usa `claude-sonnet-5-5` com `output_config.format`, como o motor atual. A resposta traz `ops` e `unsupported`, onde entra o que foi pedido e não existe no menu, com o motivo. Assim o Claude não improvisa.
4. **Validação.** `normalizeOps` confere índices, enums, limites e IDs dos assets. Se falhar, o Claude recebe os erros e tem mais uma tentativa.
5. **Confirmação.** A tela mostra cada efeito ao lado da frase em que entra, e uma prévia em 360p.
6. **Render.** Roda em 1080p com o mesmo fluxo de hoje: fila, lease, conferência e original preservado.

**Sem shell livre.** O Claude nunca escreve filtro nem comando. O compilador só usa enums, números validados e IDs conferidos no projeto. Texto livre, como `title.text`, passa apenas pelo arquivo ASS, com escape. O prompt, a transcrição e o conteúdo dos assets são dados, e nada neles vira instrução.

## Esforço

Estimativa minha: **P** até 1 dia, **M** 2 a 3 dias, **G** 1 semana ou mais, incluindo testes com ffmpeg real.

| Item | Esforço | Depende de |
|---|---|---|
| Ampliar o `probe` | P | deploy da edge |
| Manifesto de URLs | P | — |
| `flash` e `title` | P | — |
| `shake` por segmento | P | — |
| `zoom_slow` com `perspective` | P | — |
| `windowOf` e a nova ordem do compilador | M | — |
| `broll` e `pip` | M | `windowOf`, biblioteca de assets |
| `split` | M | `windowOf`, foco do rosto pelos quadros |
| Transições de B-roll | P | `broll` |
| Transições em jump cut | M | mudança do concat |
| Prompt por áudio e plano do Claude | M | menu novo |
| Tela de confirmação e prévia 360p | M | plano |
| Templates | M | ops prontas |
| Entrada de qualquer vídeo: HEVC, HDR, VFR e horizontal | M a G | amostras reais |
| Worker próprio | G | decisão de produto |

O primeiro corte útil seria: `probe`, manifesto, `windowOf`, `broll`, `pip`, `title`, plano por prompt e prévia.

## Antes de planejar

1. Rodar o `probe` ampliado no sandbox real.
2. Repetir o cenário de 107 s lá dentro.
3. Testar com vídeos reais de celular, de pessoas falando.
4. Definir de onde vêm os B-rolls: upload, cenas do hub ou vídeos gerados.
