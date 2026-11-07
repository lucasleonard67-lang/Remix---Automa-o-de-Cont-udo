# Editor por prompt: experiência

Data: 2026-10-30. Plano de experiência, sem código. Base: `polish-strip.tsx`, `prompt-tools.tsx`, `use-video-edit.ts`, `docs/motor-de-edicao.md` §5 e `docs/hub-motor-contratos.md` §11. **NÃO VERIFICADO** marca o que essas fontes não confirmam.

## Decisões em uma leitura

1. **Um caminho só.** Fala, texto e template terminam no mesmo campo. Tudo passa por pedido → plano → aplicar.
2. **Template é um pedido pronto.** Tocar no exemplo escreve a frase no campo. Não existe um segundo fluxo.
3. **A faixa continua no mesmo lugar.** O `PolishStrip` muda por dentro e mantém as mesmas props, então a V1 no `JobCard` não exige mudança em `job-card.tsx`.
4. **Nada é pago antes de confirmar.** "Ver o plano" custa pouco e diz quanto. "Aplicar" mostra modelo e custo da edição.
5. **O que está selecionado é o que publica.** Isso reúne ver e escolher num toque só: Original é sempre o caminho de volta.
6. **O plano muda o §5 do motor.** Lá está "nada de campo de texto" e "3 sugestões em ladrilhos". Este plano troca os dois pelo campo e pelo plano. A chave da Automação continua aplicando as recomendadas.

## 1. Pedido

A faixa fica logo abaixo do `ProductionStudio`, sem caixa própria: uma seção aberta separada por uma linha fina, como a faixa atual.

```
─────────────────────────────────────────────────────────
Editar com Claude                  Original · [Editada]
                                   (só depois da 1ª edição)

┌───────────────────────────────────────────────────────┐
│ Toque no microfone e diga o que mudar                 │
│                                                       │
│ 🎤  ✨ Melhorar prompt   Scribe v2 · Sonnet 5.5 · …    │
└───────────────────────────────────────────────────────┘

[ loop ] [ loop ] [ loop ] [ loop ] [ loop ]  →
Respiros  Legenda  Tela     Vídeo    Deixe o
limpos    animada  dividida por cima Claude escolher

[Ver o plano]   Estimativa: até US$ 0,15 · nada é aplicado ainda
```

- **Campo:** `PromptField` sem mudança visual, com um `kind` novo, `video_edit`, para o "Melhorar prompt" conhecer o menu de edição.
- **Fala:** o texto cai no campo e espera "Ver o plano". Não envia sozinho, porque a transcrição pode errar e o envio gasta. O limite da gravação é o que já existe, 2 minutos.
- **Melhorar:** é opcional. O plano sempre abre com a versão melhorada do pedido ("Entendi: …"), então ninguém precisa clicar em nada para ter o pedido melhorado.
- **Sem pedido:** "Ver o plano" fica desativado até haver texto. Quem não sabe o que pedir toca em "Deixe o Claude escolher", que substitui "Ver sugestões" e, na v1.5, "Surpreenda-me".
- **Sem chave:** "Conectar editor" aparece no lugar do campo, como já é hoje.

## 2. Plano antes de aplicar

O plano substitui o campo no mesmo lugar. Não abre modal nem muda de página.

```
Entendi: cortar os respiros, deixar a legenda palavra a
palavra e colocar o seu clipe quando você fala de preços.

[quadro]  Cortar respiros                    −6 s       ✕
[quadro]  Legenda palavra a palavra          cor da marca  ✕
[quadro]  Clipe por cima                     0:12 a 0:16   ✕
          "…no mês passado o preço…"
          [Enviar o clipe]
Fica com 41 s (era 47 s).

Não dá para fazer: trocar o fundo.  [Refazer a cena]

Modelo  [Claude Sonnet 5.5 · recomendado ▾]
Estimativa: até US$ 0,12. Depende da duração final.

[Aplicar]   Mudar o pedido
```

- **Uma frase por item:** diz o que muda e o ganho, sem termos como `punch_in` ou "ducking".
- **Remover:** o ✕ tira um item sem nova fala e atualiza o custo e a duração.
- **Dúvida:** o Claude não faz perguntas. Ele escolhe, diz o que escolheu e a pessoa corrige falando.
- **Pedido fora do menu:** vira a linha "Não dá para fazer", sempre com uma saída. O resto do plano continua valendo.
- **Trava:** faltando o clipe, o botão principal vira "Enviar o clipe". Toda trava mostra o que fazer.
- **Modelo e custo:** a escolha fica visível, com o recomendado marcado (regra do produto). Sem preço cadastrado, a linha mostra "Sem estimativa para este modelo" e nunca some.
- **Teto do mês:** o `402 video_budget_exhausted` aparece na linha do custo em português, com link para Custos.

Depois de aplicar, a faixa mostra as etapas atuais ("Editando o vídeo…", "Conferindo o resultado…"), acrescidas de "Pode sair desta tela". Se falhar, o original continua igual e "Tentar de novo" reaplica o mesmo plano, sem pagar a análise outra vez.

## 3. Templates com prévia real

**Decisão: duas camadas.** Exemplo pré-renderizado na galeria e quadro da própria pessoa no plano.

| Camada | Onde | O que mostra | Custo | Por quê |
|---|---|---|---|---|
| Exemplo | galeria | loop de 3 a 4 s, sem som, feito **pelo nosso motor**, sempre com o mesmo vídeo-base | zero por exibição | abre na hora, antes de qualquer análise, e mostra movimento. Como sai do motor, não promete o que ele não faz |
| Quadro real | plano | quadro do vídeo da pessoa com o resultado composto no navegador: legenda na fonte e na cor da marca, logo, divisão de tela, clipe por cima | zero | responde "como fica no meu vídeo" sem gastar render |

Regras:

- O mesmo vídeo-base em todos os exemplos faz a diferença entre eles ser o efeito, não a pessoa. Ele precisa de apresentador com direito de uso: pedir a Samuel qual gravação própria usar.
- Sem ilustração nem mock. Exemplo que o motor não renderizou não entra.
- Cada loop tem cerca de 360×640 e poucos KB, carrega sob demanda e toca só quando visível. Com `prefers-reduced-motion`, fica o pôster parado.
- O quadro do plano é rotulado "Prévia do quadro". O movimento só aparece no vídeo editado, e o rótulo não pode sugerir o contrário.
- A galeria é uma tira horizontal de mídia com o nome embaixo, sem caixa em volta. Selecionado usa `via-selected`.
- Tocar escreve a frase no campo. Tocar em dois soma as frases. Tocar de novo retira.
- Template que não serve para o vídeo some. Se a pessoa pedir por fala, o plano explica na linha "Não dá para fazer".

| Template | Frase no campo | Operações | Estado |
|---|---|---|---|
| Respiros limpos | Cortar respiros e vícios de fala | `trim_silences`, `cut_words` | motor pronto, não publicado |
| Ritmo | Dar ritmo com zoom nos cortes | `punch_in` | motor pronto, não publicado |
| Gancho na frente | Abrir com a melhor frase | `hook_first` | motor pronto, não publicado |
| Legenda animada | Legenda palavra a palavra na cor da marca | `captions` | motor pronto, **só em vídeo sem legenda queimada** |
| Marca | Logo no canto e encerramento com CTA | `brand_*` | motor pronto, some sem logo |
| Tela dividida | Dividir a tela com o meu vídeo | `split_screen` (nova) | falta no motor |
| Vídeo por cima | Colocar meu vídeo por cima neste trecho | `overlay_clip` (nova) | falta no motor |
| Motion | Título animado no gancho | HyperFrames | v1.5, depende do `probe` no sandbox (NÃO VERIFICADO). Fora da galeria até renderizar de verdade |
| Deixe o Claude escolher | Melhorar este vídeo para reter mais | livre, dentro do menu | motor pronto, não publicado |

Voz limpa, cor e velocidade ficam só por pedido. Na galeria, quase não se veem em 3 segundos.

## 4. Versões, ajuste e volta

```
Original · Editada · [Editada 2]        ← o selecionado é o que publica

┌ O que mudar nesta versão? ───────────────────────────┐
│ 🎤  ✨ Melhorar prompt   …                            │
└──────────────────────────────────────────────────────┘
[Menos zoom] [Sem legenda]      US$ 0,02 cada
```

- **Ver e escolher são um toque só.** O palco troca e essa passa a ser a versão publicada. Mostrar uma versão e publicar outra confundiria.
- **Voltar:** tocar em Original. Nada é apagado, e "Editada" continua ali. Isso substitui "Desfazer edição".
- **Limite:** Original mais as 3 edições mais recentes.
- **Nova fala:** o Claude recebe o pedido e as operações da versão selecionada. O plano mostra só a diferença ("Muda: legenda maior. O resto continua igual."), com o custo.
- **Sem perda de qualidade:** todo render parte do original, conforme o §11.2. Nunca edita em cima da versão editada.
- **Chips:** continuam aplicando direto, sem plano, agora com o custo ao lado. Hoje eles não mostram custo, o que contraria a regra do produto.
- **Palco:** o rótulo "Vídeo final" passa a dizer qual versão está tocando.

## 5. Vídeo por cima

O envio aparece **dentro do plano, na linha que precisa dele**. Não há botão de anexo no campo: a pessoa fala, o sistema pede o arquivo quando ele fizer falta.

```
[quadro]  Clipe por cima              0:12 a 0:16
          "…no mês passado o preço…"
          [Enviar o clipe]  MP4, MOV, PNG ou JPG

depois do envio:

[quadro + clipe]  demo.mp4 · 8 s · sem som     Trocar  ✕
```

- **Entrada:** toque ou arrastar para a linha. Valem as mesmas validações e mensagens do remake para MP4 e MOV. A imagem é um acréscimo.
- **Momento:** vem da fala, ancorado nas palavras e não no segundo. Assim continua certo depois dos cortes. A linha mostra a frase para a pessoa conferir, e corrigir é falar de novo.
- **Padrões:** clipe sem som, voz da pessoa intacta, corte central para caber. O plano mostra esses padrões, e a pessoa muda falando.
- **Clipe maior que o trecho:** usa só o começo e avisa na linha. Mais curto: o trecho encurta.
- **Link colado:** não baixa do YouTube, Instagram ou TikTok (§2 do motor). A linha pede o arquivo.
- **Limite:** até 3 clipes por edição. O tamanho máximo fica para o motor definir (NÃO VERIFICADO).
- **Depois:** o clipe enviado fica guardado na edição, para o ajuste por nova fala não pedir o arquivo de novo.

## 6. Onde aparece

| Lugar | De onde vem o vídeo | Situação |
|---|---|---|
| Vídeos, Criar, setup | `director_jobs`, pelo `JobCard` | entra com a troca do `PolishStrip` |
| Remake | `director_jobs`: o fluxo termina em `/videos` | já coberto pelo `JobCard`. Nenhuma mudança no remake |
| Estúdios de avatar e foto | terminam em `/videos` | coberto se a saída for um `director_job` (NÃO VERIFICADO no vídeo publicado) |
| Biblioteca, Reel | `video_projects`, `ReadyCard` em `reel-project-view.tsx` | **não coberto**: exige o trabalho abaixo |

A Biblioteca é a parte que falta. A tabela `video_edits` só aponta para `director_jobs`, `useLatestVideoEdit` procura por `job_id`, e `video_projects` não tem onde guardar a versão escolhida. Para funcionar, a faixa recebe uma fonte genérica (job ou projeto), a tabela aceita o Reel e a publicação usa a versão escolhida. Por isso ela fica para a fase 2.

## 7. Arquivos congelados e outras mudanças

**`job-card.tsx`: nenhuma mudança na V1.** Ele já passa `job`, `view` e `onView`, e o palco já toca `artifacts.edited.path`. Como a seleção passa a ser `artifacts.edited` no servidor, trocar de versão atualiza o palco. Uma mudança seria necessária só se a faixa precisasse aparecer antes de `done`, em `awaiting_audio_approval`, e a recomendação é não fazer isso.

| Arquivo | Mudança | Congelado? |
|---|---|---|
| `director-advance` | §11.7: editar cena depois de aprimorar deixa `artifacts.edited` velho. Sem correção, a tela pode publicar uma versão com a cena antiga | **sim, precisa de liberação** |
| `director-publish` | §11.7: publicar `artifacts.edited.path ?? artifacts.final`. **Bloqueia a entrega:** hoje a pessoa edita e publica o original | não |
| `use-director-jobs` | nenhuma, se `artifacts.edited` continuar como está | sim, não mexer |
| `generate-video`, `remake`, `step-create`, `config.toml` | nenhuma | sim, não mexer |
| `polish-strip.tsx` | passa a ser a faixa deste documento | não |
| `use-video-edit.ts` | lista de versões, plano e seleção | não |
| `prompt-assist` e `prompt-assist.ts` | `kind` novo, `video_edit` | não |
| `video-edit` | ações novas: `plan` (pedido → plano) e `select` (escolhe a versão, inclusive voltar a uma editada); operações `split_screen` e `overlay_clip`; envio de mídia | não |
| `reel-project-view.tsx` e SQL de `video_edits` | só na fase 2 (§6) | não |

Antes de abrir qualquer tela: `VIDEO_EDIT_LIVE` continua `false` até `video-edit`, `video-edits.sql` e o bloco acima estarem publicados.

## Ordem sugerida

1. **V1:** pedido, plano, versões e templates que o motor já faz. Inclui `director-publish`, `plan` e `select`.
2. **V1.1:** tela dividida e vídeo por cima, com o envio.
3. **Fase 2:** Biblioteca (Reel).
4. **v1.5:** Motion, quando o `probe` confirmar o HyperFrames no sandbox.

## Pendências

- **Samuel:** liberar `director-advance` para a correção da versão velha.
- **Samuel:** indicar a gravação própria que serve de vídeo-base dos exemplos.
- **Medição:** tempo real entre "Ver o plano" e o plano pronto. Sem esse número, não dá para decidir se a análise precisa de indicador de progresso mais detalhado.
- **Medição:** custo real do plano. A faixa de US$ 0,05 a 0,15 do §7 do motor é NÃO VERIFICADO, e os valores nos esboços são ilustrativos.
- **Teste no sandbox:** tela dividida e clipe por cima com ffmpeg ainda não foram testados. O filtro `overlay` já é usado; o empilhamento de vídeos, não.
