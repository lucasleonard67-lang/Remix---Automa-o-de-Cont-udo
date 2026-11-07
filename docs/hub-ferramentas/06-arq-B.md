# 06 · ARQUITETO B — Opção B: receita por ferramenta no CÓDIGO compartilhado (mínimo viável para a demo)

Repo lido em 04/11/2026 (`/Users/samuelfadanelli/Developer/subido-redes-sociais`, main d63f465), nada alterado. Baseado em 00–04 desta pasta; tudo que afirmo sobre código tem `arquivo:linha`. **NÃO VERIFICADO** marca o que vem de doc/catálogo e o código não prova.

## 0. Tese em cinco linhas

1. A "regra do modelo" hoje não existe em nenhum lugar legível (04 §síntese). A Opção B cria **um módulo TS só**, `supabase/functions/_shared/receitas-de-video.ts`, com **uma receita por experiência do hub** (13) e **variações por modelo só onde a regra muda** (limite, idioma, bloco de cobrança, o que não faz). Zero imports, para o front ler o mesmo arquivo.
2. Os formulários **continuam os que existem** (`novo.tsx` CreateVideoForm, `heygen-studios.tsx` 4 estúdios, `remake-flow.tsx`). Ganham três coisas lidas da receita: a frase "faz / não faz" + limites visíveis no topo; a linha modelo + motivo + Estimativa (reusando `GateEstimateLine`, hoje sem uso nos estúdios, 01 §3.1); e o botão **"Escrever com o seu Claude"** no lugar de "Melhorar prompt".
3. "Escrever com o seu Claude" **não cria tabela nova**: generaliza `roteiro_pedidos` com `tipo` + `contexto` + `saida` (sugestão já em 03 §4.2) e reaproveita edge `roteiro-pedido`, tools `roteiro_*`, claim/lease, conversa, Realtime e a rotina `trig_01P1Dfnx…` (bloco 1 vira "ESCRITA").
4. `prompt-assist` perde o ramo JSON (gateway); fica só a transcrição Scribe. `video-brief` deixa de chamar `chat()` e devolve só os padrões da marca que já calcula sem LLM (`video-brief/index.ts:109-116`). Roteirista de cenas (`director-core.ts`), decupagem do Reel e `sceneInEnglish` **ficam no gateway nesta rodada**, documentados como dívida com caminho de saída (§2.4).
5. É a opção que entrega a demo em dias, não semanas. Dói em dois meses quando a receita precisar variar por instância/cliente ou quando o catálogo `video_models` e a receita começarem a divergir (§5).

---

## 1. Forma da receita

### 1.1 Onde vive e como chega aos dois lados

- **Fonte única:** `supabase/functions/_shared/receitas-de-video.ts` — só `export const` e tipos, **sem nenhum import** (nem `./x.ts`, nem `npm:`), para ser válido em Deno e em Vite.
- **Front:** `src/lib/tool-recipes.ts` faz `export * from "../../supabase/functions/_shared/receitas-de-video.ts"`. Vite aceita import com extensão `.ts` quando `allowImportingTsExtensions`/`moduleResolution: bundler` está ligado — **NÃO VERIFICADO** no `tsconfig.json` deste repo e no build do Lovable. Plano B barato: cópia literal em `src/lib/tool-recipes.ts` + um teste vitest que lê os dois arquivos e falha se o texto divergir (mesma estratégia que `src/lib/remake-options.ts:1-3` já usa de forma manual com `remake.ts`).
- **Claude:** chega em dois pontos do `mcp-server`: (a) junto com cada pedido em `roteiro_pedidos` (hoje `receita: RECEITA_DO_ROTEIRO`, `mcp-server/index.ts:1413`) → passa a ser `receitaParaOClaude(tipo, contexto)`; (b) opcional, resumo em `o_que_posso_fazer` (`:1263-1269`) como `ferramentas_de_video[]` para a conversa livre no claude.ai respeitar os mesmos limites.

### 1.2 Interface

```ts
// supabase/functions/_shared/receitas-de-video.ts  (sem imports)

/** Chave = ferramenta do hub (HubWant), não a experiência do catálogo: "style" e "scene"
 *  compartilham experience "restyle" (video-hub.ts:439, 467) mas têm regra de texto diferente. */
export type FerramentaId =
  | 'scenes' | 'presenter_in_scenes' | 'avatar_script' | 'photo_presenter' | 'digital_twin'
  | 'idea_to_video' | 'change_speech' | 'translate' | 'restyle' | 'change_scene'
  | 'change_character' | 'captions' | 'reframe';

/** O que o Claude escreve. 'roteiro' é o pedido de hoje (RECEITA_DO_ROTEIRO + plano). */
export type TipoDeEscrita =
  | 'roteiro'          // fala longa + plano de produção (avatar, clone)
  | 'fala'             // só a fala, curta ou média (foto que fala, fala nova do remake)
  | 'briefing_cenas'   // os 6 campos do Diretor
  | 'ideia_agente'     // briefing para o Video Agent
  | 'instrucao_cena'   // 1 frase visual (cenário) — entrega pt-BR + en
  | 'instrucao_pessoa';// 1 frase (como a pessoa fica) — entrega pt-BR + en

export interface CampoDeTexto {
  rotulo: string;                 // "Roteiro", "Fala nova", "A ideia", "O que mudar no cenário"
  formato: string;                // o que escrever e em que forma, em 2–3 frases para a pessoa
  idioma: 'pt-BR' | 'pt-BR→en';   // o que o modelo recebe (→en = o produto traduz)
  min?: number;
  max: number;
  porSegundo?: number;            // 15 (fala); ausente = não é fala
  exemplo: string;                // vira o placeholder
}

export interface Variacao {
  modeloId: string;               // id do hub/catálogo: 'heygen/avatar-v', 'bytedance/omni-human-1.5'
  motivo: string;                 // por que escolher (sublinha do ModelRail / Recomendado)
  faz?: string; naoFaz?: string;  // só quando muda de verdade
  limites?: string[];             // substituem os da receita quando presentes
  campo?: Partial<CampoDeTexto>;  // ex.: max menor (OmniHuman 15 s ≈ 225 caracteres)
  semEstimativa?: string;         // texto da linha "Estimativa" quando não há preço
}

export interface Receita {
  id: FerramentaId;
  nome: string;
  faz: string;                    // 1 frase, para leigo
  naoFaz: string;                 // 1 frase, para leigo
  campo: CampoDeTexto | null;     // null = não há texto livre (translate, restyle, captions, reframe)
  limites: string[];              // frases curtas e visíveis
  padrao: { modeloId: string; motivo: string };
  variacoes: Variacao[];
  claude: {
    tipo: TipoDeEscrita;
    receita: string;              // o texto que vai para o Claude junto com o pedido
    saida: 'texto' | 'texto_pt_en' | 'briefing6' | 'roteiro_e_plano';
    max: number;
  } | null;
}

export const RECEITAS: Record<FerramentaId, Receita>;
/** Receita já com a variação do modelo aplicada (limites, campo, faz/naoFaz). */
export function receitaDe(id: FerramentaId, modeloId?: string | null): Receita;
/** HubWant → FerramentaId (style→restyle, scene→change_scene, character→change_character, agent→idea_to_video…). */
export const FERRAMENTA_POR_WANT: Record<string, FerramentaId>;
/** O texto que vai no pedido para o Claude: receita.claude.receita + limites + contexto (modelo, duração, alvo). */
export function receitaParaOClaude(tipo: TipoDeEscrita, contexto: ContextoDoPedido): string;
```

`ContextoDoPedido` (gravado em `roteiro_pedidos.contexto`): `{ ferramenta, modeloId, alvo, duracao_s?, max, idioma_saida?, voz?: {provider, genero?}, apresentador?: {nome, appearance_prompt?} }`. `alvo` é a chave do campo na tela (`'novo:tema'`, `'studio:photo_avatar:script'`, `'remake:<uploadId>:speech'`, `'job:<id>:scene:<n>'`) — serve para casar a entrega com o campo e para barrar pedido duplicado no mesmo campo (03 §5.3).

### 1.3 As 13 receitas (texto real)

Convenção: **faz / não faz** são as frases da tela. **Campo** é o que a pessoa escreve. **Limites** são frases visíveis. **Variações** só onde a regra muda. "Claude" é o `tipo` + o núcleo da receita do pedido. Fontes entre parênteses.

#### scenes — "Vídeo de cenas com narração" (Diretor)
- **faz:** "Escreve o roteiro, gera de 3 a 8 cenas em vídeo a partir do seu briefing e junta com a narração na voz da marca, trilha e legendas."
- **não faz:** "Não coloca você nem um avatar falando: a voz vai por cima das cenas. Não escreve texto legível na imagem nem usa logo na primeira cena." (`mcp-criar.ts:114` mandatorios; `novo.tsx:402`)
- **campo:** Tema → Briefing em 6 campos. Formato: "Mensagem: 1 ou 2 frases do que o vídeo defende. Número que prova: um só, com unidade e de onde veio. Fala final: uma frase dita olhando para a câmera. Público e tom em poucas palavras." pt-BR. max por campo 300 (proposta; hoje sem max). Exemplo: o placeholder atual `novo.tsx:455`.
- **limites:** "3 a 8 cenas" (`novo.tsx:555-568`) · "8 a 90 s no total" (`mcp-criar.ts:19-20`) · "Cada cena até N s (depende do modelo)" · "Quadros e montagem no Higgsfield: precisa estar conectado" (`video-hub.ts:211`).
- **padrão:** `bytedance/seedance-2.0` em 720p — motivo "Preço conhecido por segundo; duração contínua, sem segundos mudos no fim." (`model-notes.ts:12`, CR:28)
- **variações:** `kwaivgi/kling-v4.0` motivo "Cenas de 3 a 30 s, 1080p a US$ 0,235/s" (CR:24) · `google/veo-3.1` motivo "Visual de cinema"; limites "Cobra em blocos de 4, 6 ou 8 s: uma fala de 6,5 s paga 8" (VC:303-306; QUEBRADO #5 do motor) · `seedance_2_5` (Higgsfield) motivo "Cenas de até 30 s e fala sincronizada"; semEstimativa "Créditos Higgsfield (≈ 70 por 10 s em 720p), sem estimativa prévia" (CF §7); hoje "em breve" (`use-hub-models.ts:129-130`) · `cinematic_studio_3_0` motivo "Mesmo rosto em todas as cenas" (`generation-gate.ts:66-69` ENGINE_REASON, nunca exibido).
- **Claude:** `briefing_cenas`, saída `briefing6`. Receita = o SYSTEM de `video-brief/index.ts:33-43` reescrito para o conector: "Monte o briefing do vídeo em 6 campos a partir do tema. Leia marca_ler (persona, estratégia, repertório de CTAs) e acervo_buscar para o número que prova; use SOMENTE número que esteja no acervo, senão devolva vazio e diga em conversa que falta. objetivo ∈ Educar/Vender/Gerar conversa/Viralizar; publico: uma frase concreta; smp: 1–2 frases na voz da marca; numero_heroi com unidade e contexto; cta: uma frase falada, do repertório da marca; tom: 2–3 adjetivos. Sem emoji. Nunca invente." NÃO VERIFICADO: o texto da rotina atual não cita este tipo (04 §texto da rotina).

#### presenter_in_scenes — "Vídeo comigo nas cenas" (Diretor)
- **faz:** "O mesmo vídeo de cenas, com o seu apresentador aparecendo em parte delas e dizendo a fala final olhando para a câmera." (DC:70-73: ~40% dos shots, CTA)
- **não faz:** "Não é o apresentador falando o roteiro inteiro (para isso, 'Um avatar apresenta' ou 'Minha foto vira apresentador'). Em modelos do Replicate o rosto vem só do primeiro quadro." (`video-hub.ts:218-219`; QUEBRADO #3: `reference_urls` nunca é enviado, DA:338-345)
- **campo:** igual a scenes.
- **limites:** scenes + "Exige um apresentador com foto" (`video-hub.ts:217`) · "Primeira vez com X: o Higgsfield prepara o rosto" (`novo.tsx:1052-1057`).
- **padrão:** `cinematic_studio_3_0` (Higgsfield) — motivo "Mesmo rosto em todas as cenas." **Isto corrige o QUEBRADO "três respostas para qual modelo" (01 §2.2):** a receita manda; `video-hub.ts:169-170` (padrão Kling 4.0) passa a ler `receitaDe('presenter_in_scenes').padrao`.
- **variações:** `kwaivgi/kling-v4.0` motivo "Mais barato, com preço conhecido"; naoFaz "O rosto vem só do primeiro quadro" · `cinematic_studio_video_4_0` "em breve" (DA:176 não lista).
- **Claude:** `briefing_cenas` (igual).

#### avatar_script — "Um avatar apresenta o roteiro" (HeyGen)
- **faz:** "Um avatar da biblioteca HeyGen, ou um seu, fala exatamente o roteiro que você escrever, com a voz escolhida."
- **não faz:** "Não inventa o roteiro, não faz gesto dirigido nem muda de cenário no meio: fala só o que está no texto." (CH §2: `motion_prompt` só photo/twin-V; sem campo na tela, 02 §1)
- **campo:** Roteiro. Formato: "Frases curtas, como se fala, com pontuação nas pausas. Número por extenso quando a leitura for ambígua; sigla escrita como se fala. Sem emoji, hashtag ou travessão. Cerca de 15 letras por segundo." (`roteiro.ts:120-121`) pt-BR. min 1, **max 5.000**, porSegundo 15. Exemplo: "O que o avatar vai falar." (`heygen-studios.tsx:472`)
- **limites:** "Até 5.000 caracteres (≈ 5 min)" (`heygen.ts:463`; CH §0) · "Formato 9:16, 1080p" (`heygen.ts:488-511`) · "Avatar V só nos avatares que aceitam esse motor" (`video-hub.ts:260`).
- **padrão:** `heygen/avatar-iv` — motivo "Funciona com qualquer avatar." semEstimativa "Cobrado na conta HeyGen; preço não publicado" (CH §0: todo valor NÃO VERIFICADO).
- **variações:** `heygen/avatar-v` motivo "Mais fiel ao rosto; só em avatares que aceitam" (CH §2 motores).
- **Claude:** `roteiro`, saída `roteiro_e_plano` = `RECEITA_DO_ROTEIRO` como está (`roteiro.ts:100-139`). Única mudança: o pedido leva `contexto.voz` e `contexto.apresentador` (03 §3.3 pede).

#### photo_presenter — "Minha foto vira apresentador"
- **faz:** "A foto do seu apresentador vira um vídeo dele falando o roteiro, com a voz escolhida."
- **não faz:** "Não anima o corpo inteiro nem muda o fundo da foto; o movimento é do rosto e da cabeça." (variação OmniHuman mexe o corpo)
- **campo:** Roteiro, mesmo formato de avatar_script. max 5.000.
- **limites:** "A HeyGen precisa 'preparar' a foto uma vez antes do primeiro vídeo" (`heygen-studios.tsx` HeygenPrepLine; `notes` SI:1166 "1 foto frontal, luz uniforme, cabeça inteira, 1 pessoa" — QUEBRADO #18: a coluna existe e ninguém lê; a receita incorpora o texto).
- **padrão:** `heygen/avatar-iv` — motivo "Mantém o rosto da foto; voz HeyGen ou da marca."
- **variações:** `prunaai/p-video-2-pro-avatar` motivo "US$ 0,06/s em 1080p; até 3 min de fala"; campo.max 2.700 (180 s × 15); naoFaz "Voz fixa da marca (ElevenLabs): a faixa de voz some" (`heygen-studios.tsx:961-966`, hoje sem aviso) · `bytedance/omni-human-1.5` motivo "Corpo e gestos a partir da foto"; limites **"Fala de até 15 s (≈ 225 caracteres)"**; campo.max 225 — **fix do QUEBRADO #7**: hub diz 34 s (`video-hub.ts:311`), catálogo e motor dizem 15 (SI:981; DA:3405-3410). Decisão: a receita segue o motor (15); a frase do hub passa a vir da receita.
- **Claude:** `fala`, saída `texto`, max do modelo. Receita: "Escreva só a fala do apresentador para a foto falar. Leia marca_ler como contexto; o briefing manda. Frases curtas, como se fala, pontuação nas pausas, números por extenso, sem emoji/hashtag/travessão. Cerca de 15 letras por segundo; limite de {max} caracteres ({max/15} s). Entregue em roteiro_entregar com texto; sem plano." Pesquisa só se o briefing pedir dado.

#### digital_twin — "Meu clone"
- **faz:** "Um vídeo seu de uns 2 minutos vira um clone que fala qualquer roteiro com a sua voz clonada."
- **não faz:** "Não fica pronto na hora: a HeyGen processa e você grava um consentimento pelo link. Não troca roupa ou cenário sem um 'novo visual'."
- **campo:** Roteiro, igual a avatar_script. max 5.000.
- **limites:** "Vídeo de 15 s a 10 min (ideal ~2 min), uma pessoa olhando para a câmera, fala limpa, sem música, até 200 MB" (CH §1; `notes` SI:1171) · "Roteiro só depois do clone pronto" (`heygen-studios.tsx:1148`).
- **padrão:** `heygen/avatar-iv`. **variações:** `heygen/avatar-v` motivo "Mais fiel; aceita direção de movimento" (CH §2; sem campo na tela hoje).
- **Claude:** `roteiro` (igual a avatar_script).

#### idea_to_video — "Só a ideia, vídeo pronto" (Video Agent)
- **faz:** "Você descreve o vídeo; o HeyGen escreve o roteiro, escolhe as cenas, monta e aplica as cores e o logo do seu site."
- **não faz:** "Não fala o seu texto ao pé da letra (ele reescreve), não aceita a voz da marca do ElevenLabs, não deixa revisar antes de gerar e sai sempre na vertical." (HG:578 modo `generate`; `heygen-studios.tsx:1197, 1232-1233`)
- **campo:** A ideia. Formato: "Um briefing de 3 a 8 linhas: o que o vídeo quer alcançar, para quem, quanto tempo (ex.: 30 s), o que mostrar, o tom e a frase final. Pode citar números e nomes que o vídeo deve usar." pt-BR. max **10.000** (`heygen.ts:561`), recomendado ≤ 2.000. Exemplo: `heygen-studios.tsx:1215`.
- **limites:** "Até 10.000 caracteres" · "Render leva 5 a 10 vezes a duração do vídeo" (CH §4) · "Vertical" · "Voz: a do Video Agent ou um clone HeyGen".
- **padrão:** `heygen/video-agent` (único). semEstimativa "Cobrado na conta HeyGen; preço não publicado".
- **Claude:** `ideia_agente`, saída `texto`, max 2.000. Receita: "Escreva o briefing que o Video Agent da HeyGen recebe. Ele escreve o roteiro e monta sozinho; o seu texto é a ordem, não a fala. Inclua: objetivo, público, duração alvo, 3 a 5 coisas que devem aparecer, tom, frase final (CTA do repertório da marca). Dados só do acervo (acervo_buscar) ou do pedido; sem emoji. pt-BR. Até 2.000 caracteres."

#### change_speech — "Mudar o que eu digo" (remake)
- **faz:** "Mantém o seu rosto e o seu ambiente; troca o que você diz e a boca acompanha a fala nova."
- **não faz:** "Não encurta nem alonga o vídeo: a fala nova tem de caber no tempo dele (até 15% de diferença). Não muda gesto, roupa ou cenário." (RM:209-223)
- **campo:** Fala nova. Formato: "Uma ideia só, escrita como se fala. Para N s de vídeo, cerca de N×15 letras." (`remake-options.ts:66-81`) pt-BR. max **600** (RM:74). porSegundo 15. Exemplo: "Escreva o que a pessoa vai dizer no vídeo." (`remake-flow.tsx:779`)
- **limites:** "Vídeo de 2 a 30 s" · "Até 600 caracteres" · "Se não couber, vira 'foto que fala' (só com a HeyGen)" (RM:200-207).
- **padrão:** voz `elevenlabs` (marca/clone/ID) — motivo "A voz da marca, como nos outros vídeos" (`VOICE_RULE`, `remake-flow.tsx:106`; **fix do QUEBRADO hub padrão MiniMax**: `video-hub.ts:397-404` passa a ler a receita). Boca: HeyGen lipsync com chave; `heygen/lipsync-precision` no Replicate sem chave (DA:2636-2638) — a receita diz "Boca sincronizada pela HeyGen (direto ou via Replicate)" e **tira `providers: ["heygen"]`** do hub (`video-hub.ts:395`; QUEBRADO 01 #7).
- **variações:** `minimax/speech-2.8-hd` motivo "Voz feminina ou masculina de catálogo, US$ 0,10/1k" (unidade errada, QUEBRADO #12 — a receita diz "por mil letras ou tokens, a confirmar") · `heygen/lipsync-precision` (Replicate) limites "Mesma regra de 15%" NÃO VERIFICADO se `enable_dynamic_duration` dispensa (02 #14).
- **Claude:** `fala`, saída `texto`, max 600, contexto.duracao_s → "alvo ≈ {duracao×15} caracteres, nunca mais que {duracao×15×1,15}".

#### translate — "Traduzir meu vídeo"
- **faz:** "O mesmo vídeo em inglês, espanhol, francês, italiano ou alemão, com a sua voz clonada e a boca sincronizada."
- **não faz:** "Não traduz para português, não muda o conteúdo e a voz clonada sai da HeyGen, não da ElevenLabs." (RM:108-114; CH §5)
- **campo:** null. **limites:** "Vídeo de 2 a 30 s" · "5 idiomas de saída; origem em português, inglês ou espanhol" (`remake-options.ts:92-98, 146-150`) · "Cobra pela duração do vídeo original" (CH §0, valor NÃO VERIFICADO).
- **padrão:** `heygen/video-translation`, semEstimativa "Cobrado na conta HeyGen". **Claude:** null.

#### restyle — "Mudar o estilo"
- **faz:** "Refaz o vídeo inteiro num visual novo (cinema, anime, massinha…) mantendo movimento, gesto e boca."
- **não faz:** "Não troca a pessoa (isso é 'Trocar a pessoa') nem a fala. O modelo devolve sem som; o produto recoloca o seu áudio." (RM:151-158)
- **campo:** null (chips). **limites:** "Vídeo de 2 a 30 s" · variam por modelo (abaixo).
- **padrão:** `kwaivgi/kling-v4.0` (edição) — motivo "US$ 0,141/s em 1080p, aceita até 300 MB" (CR:112). **QUEBRADO #9:** o primário do catálogo é Aleph (SI:1091-1092) → pedido sem `scene_model_id` (MCP) paga 0,336/s. A receita manda o padrão; `remake-flow.tsx:217-219` já honra `initialModelId`; a cópia `REMAKE_OPTION_COPY.style.line` (`remake-options.ts:34`, "Runway Aleph · 16 MB") passa a vir de `receitaDe('restyle', modelo).limites`.
- **variações:** `runwayml/aleph-2` motivo "Muda estilo, cena ou pessoa mantendo fala, gesto e câmera" (`model-notes.ts:21`); limites "Menos de 16 MB" (SI:783; QUEBRADO #8: não validado no servidor) · `wan-video/wan-2.7-videoedit` limites "Até 10 s" (SI:995; QUEBRADO #10).
- **Claude:** null.

#### change_scene — "Mudar o cenário"
- **faz:** "Troca o lugar, a luz, a roupa ou um detalhe da cena, em uma frase. O resto fica igual."
- **não faz:** "Não troca a pessoa, não muda a fala e não cria uma cena nova: é uma instrução visual, não uma história."
- **campo:** O que mudar no cenário. Formato: "Uma frase concreta e visual: onde, com que luz, um detalhe. Nada de ação ou tempo ('depois', 'enquanto'). O produto traduz para o modelo." idioma **pt-BR→en** (DA:2506-2525 `sceneInEnglish`). max **200** (`remake-flow.tsx:728`). Exemplo: "num escritório moderno, com luz de fim de tarde".
- **limites/padrão/variações:** = restyle.
- **Claude:** `instrucao_cena`, saída `texto_pt_en`, max 200. Receita: "Escreva UMA instrução visual de cenário para um modelo vídeo→vídeo (Kling 4.0 edição / Runway Aleph). Em texto: a frase em pt-BR que a pessoa vê (até 200 caracteres); em texto_en: a mesma instrução em inglês, imperativa, só o que muda (lugar, luz, roupa, objeto), sem verbos de ação ou tempo, terminando por 'keep everything else identical'. Use a paleta de brand_kit se o pedido falar da marca." Com `texto_en` entregue, o motor pula `sceneInEnglish` (§2.4).

#### change_character — "Trocar a pessoa" (person_swap)
- **faz:** "Quem aparece no vídeo vira o seu apresentador, a partir de 1 a 3 fotos dele, com o áudio original."
- **não faz:** "Não muda cenário, fala ou movimento. Não funciona sem um apresentador com foto."
- **campo:** Como a pessoa deve ficar (opcional). Formato: "Uma frase sobre roupa e acessórios: o que manter ou mudar." idioma pt-BR→en — **hoje vai cru em pt-BR** (DA:2581-2586; QUEBRADO #11). max **500** (RM:75). Exemplo: "mantenha os óculos e a camisa azul".
- **limites:** "Vídeo de 2 a 30 s" · "Até 3 fotos de referência" (`remake-flow.tsx:745-751`) · "US$ 0,06/s em 1080p".
- **padrão:** `prunaai/p-video-replace` — motivo "Mantém o áudio; aceita até 3 fotos." **variações:** `wan-video/wan-2.2-animate-replace` "1 foto, 720p, mais barato".
- **Claude:** `instrucao_pessoa`, saída `texto_pt_en`, max 500. Receita análoga à de cena, com `contexto.apresentador.appearance_prompt` quando existir (03 §3.2: hoje não exposto; o pedido passa a levá-lo).

#### captions — "Legendas da marca"
- **faz:** "Transcreve a fala e queima legendas no estilo e na cor da sua marca."
- **não faz:** "Não traduz, não corrige o que foi dito e não refaz nenhuma cena."
- **campo:** null. **limites:** "Vídeo de 2 a 30 s" · "Precisa de ElevenLabs (transcrição) e Higgsfield (gravação)" (`remake-options.ts:202-205`) · "Custo: centavos de transcrição; a montagem não gera cena nova" (resolve "centavens" × "US$ 0,00").
- **padrão:** `elevenlabs/scribe-v2`. **Claude:** null.

#### reframe — "Reenquadrar e melhorar"
- **faz:** "Vai transformar um vídeo horizontal em 9:16 e aumentar a nitidez, pelo Higgsfield."
- **não faz:** "Ainda não existe: sem motor nem tela." (`video-hub.ts:92`; `util_reframe` sem chamador, 02 §2.4)
- **campo:** null. **Claude:** null. **Fix pontual:** esconder o ladrilho enquanto `STUDIO_READY.reframe === false` (`video-hub.tsx:157-169` já filtra `more`; acrescentar `routeReady`).

---

## 2. `prompt-assist` sai do gateway sem quebrar as 9 telas

### 2.1 Quem usa hoje (CONFIRMADO)
`PromptField`/`PromptTools` (`src/components/prompt/prompt-tools.tsx`) em 9 pontos: Diretor Tema `novo.tsx:451` (video); avatar/foto/clone via `ScriptField` `heygen-studios.tsx:145-153` (script) e Video Agent (`seconds=false` → video) = 4; cena `scene-edit.tsx:152` e `polish-strip.tsx:377` (scene); slide `slide-editor.tsx:189`; Criar `creator.tsx:541` (content). Todos chamam `useImprovePrompt` → edge `prompt-assist` → `_shared/llm.ts` (`prompt-assist/index.ts:17`). O microfone é Scribe direto, sem LLM (`:43-82`).

### 2.2 Proposta concreta
1. **`PromptTools` troca a prop `kind: PromptKind` por `escrever?: EscreverComClaude`** onde `EscreverComClaude = { tipo: TipoDeEscrita; alvo: string; contexto: ContextoDoPedido }`. Sem a prop, o botão de melhorar **não aparece** (fica mic + Voltar). Com a prop, o botão é **"Escrever com o seu Claude"** e o rodapé vira `Scribe v2 · Claude, pela sua assinatura` (sai "Gemini 2.5 Pro", `prompt-tools.tsx:203-205`). `PromptKind` em `src/lib/prompt-assist.ts:6` morre.
2. **Clique:** `usePedirEscrita()` chama a edge `roteiro-pedido` com `{ tipo, entrada: value, contexto }` (hoje `{briefing, referencias}`, `roteiro-pedido/index.ts:83-87`). A edge valida min/max pela receita, recusa 409 se já há pedido `aberto` com o mesmo `contexto.alvo`, insere e acorda a rotina.
3. **Enquanto espera:** o campo **continua editável**. Dentro do `PromptTools` aparece uma linha: spinner + "Com o seu Claude · há 40 s" + **Cancelar** (reuso de `AndamentoDoRoteiro compact`, `roteiro-brief.tsx:278-322`, sem a trilha de 7 etapas: para `tipo !== 'roteiro'` as etapas são só enviado→pegou→entregue). Avisos existentes valem: > 2 min "ainda não pegou", > 15 min "parece parado" (`:250-251`).
4. **Entrega não sobrescreve:** o hook guarda `entrada` do pedido. Na entrega, se `value === entrada` → substitui e liga "Voltar ao original" (estado `original` já existe, `prompt-tools.tsx:58, 185-202`); se a pessoa editou enquanto esperava → mostra "O seu Claude escreveu uma versão" com **Usar** / **Ignorar**. A chave `ce:roteiro-usado:<id>` em localStorage (`roteiro-brief.tsx:77-81`) continua evitando reentrega ao voltar à tela.
5. **Sem rotina (`acordou=false`):** no lugar do toast genérico (`roteiro-brief.tsx:98-99`), a mesma linha diz "Pedido guardado. Abra o seu Claude e diga: atenda os pedidos de escrita" + botão **"Abrir no Claude"** com `urlDoClaude()` de `src/lib/claude-prompt.ts` (hoje só na faixa Editar com Claude, 03 §2.3). Não sai do produto: abre nova aba.
6. **Sem conector (nenhum token):** botão desligado com a frase "Conecte o seu Claude em Ajustes › Conectores" e link. Continua saindo do fluxo (R3) — igual a `roteiro-brief.tsx:112-134`; corrigir isso é fora desta rodada.
7. **Edge `prompt-assist`:** o ramo JSON (`index.ts:90-153`) passa a responder `410 gone` com "A escrita é pelo seu Claude." O multipart (Scribe) fica. Importa `llm.ts` sai do arquivo. `rate_limits.prompt-assist` deixa de importar.
8. **Slide (`slide-editor.tsx:189`) e Criar (`creator.tsx:541`):** não ganham `escrever` nesta rodada — já têm o caminho pelo conector (slide: `pedirAoClaude` sempre com conector, 03 §2.5; Criar: `conteudo_pedidos`). Só perdem o botão "Melhorar prompt" e mantêm o mic. Zero regressão funcional porque o que o botão fazia era redundante com o pedido ao Claude.
9. **Cena (`scene-edit.tsx:152`, `polish-strip.tsx:377`):** ganham `escrever: { tipo: 'instrucao_cena', alvo: 'job:<id>:scene:<n>' }`. A entrega `texto_en` segue no `config` da correção para o motor não traduzir (DA:3821-3823 monta "Change only this: X"). Pequeno.

### 2.3 O que vira o quê — tabela
| Hoje | Vira | Arquivo |
|---|---|---|
| "Melhorar prompt" (gateway) | "Escrever com o seu Claude" (pedido tipado) | `prompt-tools.tsx:169-184` |
| Rodapé "Scribe v2 · Gemini 2.5 Pro · Sem estimativa…" | "Scribe v2 · Claude, pela sua assinatura" | `prompt-tools.tsx:203-205` |
| "Montar o briefing" (edge `video-brief` + Gemini) | "Montar o briefing" fica, **sem LLM** (defaults da marca) + botão "Escrever com o seu Claude" no bloco do briefing (tipo `briefing_cenas`, preenche os 6 campos na entrega, mesma lógica de `novo.tsx:349-356`) | `video-brief/index.ts:94-106` (remover `chat`), `novo.tsx:343-365, 460-477` |
| "Criar roteiro com o seu Claude" (`RoteiroBrief`) | Igual; vira o caso `tipo:'roteiro'` do mesmo hook, filtrado por tipo | `roteiro-brief.tsx:62`, `use-roteiro-pedidos.ts:104-128` |
| Remake: `Textarea`/`Input` puros (fala, cenário, pessoa) | `PromptField` com `escrever` (fala / instrucao_cena / instrucao_pessoa) + mic | `remake-flow.tsx:723-729, 756-762, 775-781` |

### 2.4 Os três roteiristas do motor: o que fazer com cada um

| Peça | Decisão nesta rodada | Por quê | Risco de ficar | Risco de virar pedido |
|---|---|---|---|---|
| **Roteirista de cenas** `generateDirectorPlan` (`director-core.ts:245-275`, `chat` em `:5, 249`) | **Fica no gateway**, com dívida registrada e um atalho: a entrega `briefing_cenas` pode trazer, opcional, `cenas[]` (`speech`, `keyframe_prompt`, `motion_prompt` em inglês, `with_character`, `sequence_group`) no formato de `PLAN_SCHEMA` (`:8-59`). Quando `brief.plano_pronto` vier, `generateDirectorPlan` pula o `chat()` e só roda `sanitizeSequenceGroups`. | Roda dentro do cron `director-advance`, sem pessoa na frente; virar pedido exige novo estado no job (`aguardando_claude`), prazo, conversa e um "e se a rotina não responder" para cada vídeo. Isso é a Opção A/C, não o mínimo da demo. | Regra 1 continua violada em "escrita automática" — o dono pode perguntar "quem escreveu as cenas?" e a resposta ainda é Gemini. Mitigação: a tela diz "Cenas planejadas pelo motor; o briefing é do seu Claude". | Cada Diretor passa a depender da rotina (minutos; 03 §5.1); falha da rotina = vídeo travado; sem fallback permitido pela regra 1. **G** e arriscado para a demo. |
| **Decupagem do Reel** (`generate-video/index.ts:374-408` + `scene-director.ts`) | **Fica.** Fora do hub (nasce da Biblioteca). | Mesmo argumento; e o Reel tem `planDecoupage` determinístico depois do LLM, que precisaria ser reproduzido na entrega do Claude. | Igual acima, menos visível. | Igual acima. Entra quando a Opção "dado" chegar, como `tipo:'decupagem_reel'`. |
| **`sceneInEnglish`** (`director-advance/index.ts:2506-2525`) | **Fica, mas só como fallback.** Se `cfg.scene_en` / `cfg.character_prompt_en` existirem (entregues pelo Claude), o motor usa e não chama `chat()`. Quem digita à mão ainda passa pelo gateway. | 20 linhas; tira a maioria dos casos do gateway sem criar dependência nova. | Texto digitado à mão continua traduzido pelo Gemini. Alternativa radical (mandar pt-BR cru) piora o resultado (RM:226-229). | Nenhum: é a mesma entrega do pedido. |

---

## 3. Mudanças mínimas por arquivo, em fatias finas

Projeto Lovable **103e71ae**: "Deploy" abaixo = precisa publicar edge(s) (o sync do git não publica funções; vale o fecho de imports, AGENTS.md). Esforço: P (≤ ½ dia), M (1–2 dias), G (3+).

### F0 · Módulo de receitas — **P** — sem deploy
- **Novo** `supabase/functions/_shared/receitas-de-video.ts` (§1.2, 13 receitas de §1.3; sem imports).
- **Novo** `src/lib/tool-recipes.ts` (re-export ou cópia + teste `src/lib/__tests__/tool-recipes.test.ts` que compara com o arquivo Deno).
- **Aceite:** `receitaDe('photo_presenter','bytedance/omni-human-1.5').campo.max === 225`; `receitaDe('restyle').padrao.modeloId === 'kwaivgi/kling-v4.0'`; `FERRAMENTA_POR_WANT.scene === 'change_scene'`; vitest verde; `deno check` da função passa.

### F1 · Telas lêem a receita — **M** — sem deploy
- **Novo** `src/components/video/receita-da-ferramenta.tsx`: bloco de 3 linhas (faz · não faz · limites como chips de texto), sem card, DS SUBIDO.
- `src/routes/_app/videos/novo.tsx:445-449`: bloco acima de "Briefing" com `receitaDe(route.want === 'presenter' ? 'presenter_in_scenes' : 'scenes', selected?.id)`. O `GenerationGate` já cumpre R2; só trocar `modelNote` por `variacao.motivo` quando existir (`generation-gate.ts:410` → `model-notes.ts` continua como fallback).
- `src/components/video/heygen-studios.tsx`: `GenerateBar` (`:163-210`) ganha `GateEstimateLine` (`src/components/generation/gate-estimate-line.tsx`) com `{ kind: 'none', reason: variacao.semEstimativa ?? 'Sem estimativa para este modelo' }` para HeyGen e `{ kind: 'catalog', maxUsd: segundos × usdPerSecond }` para P-Video/OmniHuman (o estúdio já calcula `≈ N s`, `:139`). `ModelRail` (`video-hub.tsx:242-302`) mostra `variacao.motivo` sob o nome e o selo "Padrão" passa a ser `receita.padrao.modeloId`, não índice 0 (`:281-283`). `ScriptField` recebe `max` da receita (OmniHuman 225). Cada estúdio renderiza `<ReceitaDaFerramenta>` no topo. `VideoAgentStudio` passa `initialModelId` (`:1175`, cosmético).
- `src/components/video/remake-flow.tsx`: `REMAKE_OPTION_COPY[x].line` (`remake-options.ts:31-56`) deixa de ser fixo: `title` fica, `line` = `receita.faz` e os limites vêm de `receitaDe(id, sceneModelId).limites` (resolve Kling × Aleph na cópia). `Input` do cenário com `maxLength` da receita.
- `src/lib/video-hub.ts`: `models.default` de presenter (`:169-170`), speech (`:397-404`), style/scene (`:181-189`) e `providers` de speech (`:395`) passam a derivar de `RECEITAS` (ou, mínimo, são corrigidos à mão para bater com a receita). `cost` do OmniHuman (`:311`) → "US$ 0,16/s · até 15 s".
- **Aceite:** em cada um dos 13 destinos aparecem faz/não faz/limites; em avatar/agent/twin/translate/captions aparece a linha "Estimativa … Sem estimativa para este modelo · cobrado na conta HeyGen" (hoje nada, 01 §3.1); o selo "Padrão" bate com `receita.padrao` nas 13; nenhum texto "Gemini" na tela de vídeo.

### F2 · Fila genérica (SQL + edge + MCP) — **M** — **Deploy:** `roteiro-pedido`, `mcp-server`, e todo mundo que importa `_shared/roteiro.ts` (`director-advance` usa `planoEmTexto`, `director-advance/index.ts:2429-2455`; conferir com `grep -l "_shared/roteiro.ts" supabase/functions`)
- **Novo SQL** `drizzle/migrations/0024_roteiro_pedidos_tipo.sql`: `alter table roteiro_pedidos add column if not exists tipo text not null default 'roteiro' check (tipo in ('roteiro','fala','briefing_cenas','ideia_agente','instrucao_cena','instrucao_pessoa'))`, `contexto jsonb not null default '{}'`, `saida jsonb`; índice parcial `(created_by, (contexto->>'alvo')) where status='aberto'`. Também o `0024_aplicar_…` conforme o padrão da pasta. **Regenerar o seed** (`python3 scripts/gerar-seed-instancia.py`) — e aqui aparece um QUEBRADO colateral: `roteiro_pedidos` **não está** em `supabase/seed-instancia.sql` nem em `supabase/sql/` (grep vazio; 03 §2.2). O gerador lê `supabase/migrations` (`scripts/gerar-seed-instancia.py:36`), não `drizzle/migrations` → NÃO VERIFICADO como 0019–0023 chegaram à instância; a fatia precisa colocar o DDL de `roteiro_pedidos` + colunas novas no caminho que o seed lê.
- `supabase/functions/_shared/roteiro.ts`: `PedidoDeRoteiro` ganha `tipo`, `contexto`, `saida`; novo `conferirEntregaPorTipo(tipo, args, receita)`: `roteiro` → `conferirEntrega` atual (`:241-252`); `fala`/`ideia_agente` → texto ≤ max, sem emoji/hashtag; `texto_pt_en` → `texto` ≤ max e `texto_en` não vazio, ASCII-ish; `briefing6` → 6 chaves, `objetivo` no enum (`video-brief/index.ts:36`).
- `supabase/functions/roteiro-pedido/index.ts:83-108`: aceita `{ tipo?, entrada?, contexto?, briefing?, referencias? }`; `tipo` ausente = `'roteiro'` (compatível com `RoteiroBrief`); valida min/max pela receita; 409 `ja_aberto` quando há pedido aberto com o mesmo `contexto.alvo` do mesmo `created_by`; `acordarRotina` com texto `"Escrita <tipo> <id>"`.
- `supabase/functions/mcp-server/index.ts`: `roteiro_pedidos` (`:1379-1417`) devolve `tipo`, `contexto`, `entrada` e `receita: receitaParaOClaude(tipo, contexto)` (para `roteiro`, continua `RECEITA_DO_ROTEIRO`); `roteiro_entregar` (`:396-449`, `:1476-1495`) → `required: ['pedido_id']`, aceita `texto`, `texto_en`, `briefing`, além de `roteiro`/`plano`; ramifica por `pedido.tipo`; grava `saida`. Descrição das tools menciona "cada pedido traz o tipo e a receita". `o_que_posso_fazer` (`:1263-1269`) acrescenta `ferramentas_de_video` (id, faz, naoFaz, limites, padrao) — opcional, **P**.
- `supabase/functions/_shared/mcp-guia.ts:21`: a linha de roteiro vira "Pedidos de escrita da tela Vídeos ficam em roteiro_pedidos: cada um traz o tipo (roteiro, fala, briefing de cenas, ideia para o Video Agent, instrução de cena ou de pessoa), o contexto e a receita. Siga a receita do tipo; entregue em roteiro_entregar." Capacidade `roteiro` (`:75-78`) renomeia `o_que_faz`.
- `supabase/functions/_shared/assistant-tools.ts:16`: ver F7.
- **Aceite:** `curl` da edge com `tipo:'fala'` e 20 caracteres → 200 + linha com `tipo='fala'`; segundo pedido com mesmo `alvo` → 409; pelo conector local (`content-engine`), `roteiro_pedidos` devolve a receita de `fala` e `roteiro_entregar {texto}` grava `status='entregue'` e `saida.texto`; pedido `roteiro` antigo continua passando por `conferirEntrega` (teste existente). Nota: o MCP remoto `claude_ai_Content_Engine` não expõe `roteiro_*` hoje (03 §resumo) → o deploy do `mcp-server` é pré-requisito de qualquer demo via claude.ai.

### F3 · Front: botão e hook — **M** — **Deploy:** `prompt-assist`
- `src/hooks/use-roteiro-pedidos.ts`: `useUltimoPedidoDeRoteiro(enabled, { tipo, alvo })` filtra `.eq('tipo', tipo)` e `.eq('contexto->>alvo', alvo)` (sem isso o `RoteiroBrief` pegaria um pedido de `fala`); canal Realtime por `alvo`; `usePedirRoteiro` → `usePedirEscrita` com `{tipo, entrada, contexto}`. `PedidoDeRoteiro` ganha `tipo`, `contexto`, `saida`.
- `src/components/prompt/prompt-tools.tsx`: prop `escrever?` (§2.2.1), botão, linha de espera, Usar/Ignorar, "Abrir no Claude", rodapé. Remove `useImprovePrompt`, `DEFAULT_PROVIDER`, `DRIVER_SECRET`, `useAppSetting('ai_providers')`.
- `src/hooks/use-prompt-assist.ts`: remove `useImprovePrompt`; `src/lib/prompt-assist.ts`: remove `PromptKind`, `CONNECTABLE` fica só `elevenlabs`.
- Chamadores: `heygen-studios.tsx:145-153` (`ScriptField` recebe `escrever` do estúdio: foto → `fala`, avatar/clone → sem botão porque o `RoteiroBrief` já é o caminho, agente → `ideia_agente`); `novo.tsx:451-458` (Tema: **sem botão** — o Claude escreve o briefing, não o tema; mic fica); `scene-edit.tsx:152`, `polish-strip.tsx:377` (`instrucao_cena`); `slide-editor.tsx:185-189`, `creator.tsx:541` (sem `escrever`).
- `src/components/task-watcher.tsx:96-98`: navegar por `contexto.rota` (hoje fixo `rota: 'avatar'`), senão um pedido de `fala` da foto manda a pessoa para o estúdio errado.
- `supabase/functions/prompt-assist/index.ts`: ramo JSON → 410; remove import de `llm.ts`, `hybridSearch`, persona/estratégia.
- **Aceite:** nas 9 telas não existe "Melhorar prompt"; nas 6 de vídeo com texto existe "Escrever com o seu Claude"; clicar com rotina ligada → linha "Com o seu Claude" em ≤ 2 s, campo editável; entrega sem edição → texto substituído + "Voltar ao original"; entrega após edição → Usar/Ignorar; `acordou=false` → "Abrir no Claude"; mic continua funcionando; nenhum request para `prompt-assist` com JSON (DevTools).

### F4 · Diretor: briefing pelo Claude — **P/M** — **Deploy:** `video-brief`
- `supabase/functions/video-brief/index.ts`: remove `chat`/`LlmError`/`hybridSearch`; devolve `brief` só com os defaults já codificados (`:109-116`: objetivo "Educar", publico = persona.audience, smp = tema, cta = `cta_repertoire[0]`, tom "sóbrio, direto", numero_heroi ""). Latência cai de até 45 s (`use-video-brief.ts:17`) para ms; a mensagem do hook (`:28`, "confira o provedor de IA em Config → IA") sai.
- `src/routes/_app/videos/novo.tsx:460-482`: "Montar o briefing" continua abrindo os 6 campos; abaixo deles, `PromptTools` só com botão (sem textarea) `escrever: { tipo: 'briefing_cenas', alvo: 'novo:briefing' }`; na entrega, aplica `saida.briefing` com a mesma regra "campo vazio mantém" (`:349-356`).
- `src/components/setup/setup-flow.tsx:664-678`: nada muda de código; o texto do `hint` "Montando o briefing com a voz da marca e os números do seu material (até 45 s)" (`:671`) passa a "Briefing com os padrões da marca; ajuste o número que prova." O setup **não** ganha o botão do Claude nesta rodada (onboarding não pode esperar minutos).
- **Aceite:** sem Higgsfield/Gemini configurados, "Montar o briefing" responde < 1 s; com rotina, "Escrever com o seu Claude" preenche os 6 campos; `numero_heroi` só vem preenchido se o Claude achou no acervo (receita).

### F5 · Remake: ajuda onde não havia — **P** — sem deploy (front) + opcional **P** motor
- `remake-flow.tsx:723-729` cenário → `PromptField` `escrever: instrucao_cena`, `max` da receita; `:756-762` pessoa → `instrucao_pessoa`; `:775-781` fala → `fala` com `contexto.duracao_s = seconds`.
- Opcional motor: `RemakeConfig` (`_shared/remake.ts`) ganha `scene_en?`, `character_prompt_en?`; `director-advance/index.ts` usa `cfg.scene_en ?? await sceneInEnglish(cfg.scene)` (`:2506`) e `cfg.character_prompt_en ?? cfg.character_prompt` (`:2581-2586`). Deploy `director-advance`.
- **Aceite:** os 3 campos têm mic + botão; a entrega de `instrucao_cena` mostra `texto` (pt-BR) no campo e manda `texto_en` no config; log do motor sem chamada a `sceneInEnglish` quando `scene_en` existe.

### F6 · Rotina do Claude `trig_01P1DfnxhGaZ5phCWRKHP6hZ` — **P** — pelo RemoteTrigger (Samuel), nunca "falta criar"
Texto do bloco 1 (04 §texto atual): "1. ESCRITA (roteiro_pedidos → cada pedido traz tipo, contexto e receita; siga a receita do tipo; roteiro usa roteiro_andamento; entregue em roteiro_entregar)". Sem isso, tipos novos ficam 24 h abertos e viram `falhou` (`mcp-server:1392-1398`). **Aceite:** um pedido `fala` entregue de ponta a ponta pela rotina em < 3 min (medir; 03 §2.4 diz NÃO VERIFICADO).

### F7 · Fixes pontuais baratos que entram na mesma rodada — **P cada**
| QUEBRADO (02/01/03) | Fix | Arquivo | Deploy |
|---|---|---|---|
| #7 OmniHuman 34 s × 15 s | Hub e receita dizem 15 s; `campo.max` 225 | `video-hub.ts:311`, F0 | não |
| `marca_ler` lê `brand_guardrails` inexistente (03 §3.1) | `'guardrails'` em `BRAND_TABLES` | `assistant-tools.ts:16` | `mcp-server`, `assistant-chat` |
| Hub × destino: presenter (Kling × Higgsfield), style/scene (Kling × Aleph na cópia), speech (MiniMax × ElevenLabs; HeyGen obrigatória) | padrão/providers derivam da receita (F1) | `video-hub.ts:169, 181-189, 395-404`; `remake-options.ts:31-56` | não |
| #9 primário do catálogo `scene_v2v` = Aleph (0,336) | `update video_models set is_primary` Kling 4.0 edit, Aleph false | SQL `hub-catalogo.sql` + seed | SQL na instância |
| #6 primário `talking_avatar` = Fabric | `is_primary` → P-Video 2 Pro | idem | idem |
| Ladrilho reframe ocupa a grade (01 #12) | filtrar `routeReady` na lista | `video-hub.tsx:157-169` | não |
| Exemplos do ladrilho de outro provedor em 6 experiências (01 #6) | trocar para exemplo do provedor do padrão ou `null` | `hub-examples.ts:33-45, 75-81, 89-116` | não |
| Setup descarta rota/modelo (01 #10) | passar `route.want`/`model.id` ao Diretor e `initialModelId` ao remake | `step-create.tsx:367-375` | não |
| `ENGINE_REASON` morto (01 §3.4) | vira `variacao.motivo` exibido | `generation-gate.ts:66-69, 410` | não |
| `roteiro_pedidos` fora do seed (03 §2.2) | entra em F2 | seed | SQL |

**Não entram** (caros ou arriscados): #3 rosto nas cenas Replicate (`reference_urls`), #8 validar 16 MB no servidor, #10/#4/#5 cruzamentos de duração por modelo no servidor, #12 unidade do MiniMax, #14/#15 testes com provedor, #16 custo HeyGen/Higgsfield (impossível sem tool de preço), #17 Seedance 2.5/CS 4.0 "em breve", #20 roteiristas do motor (§2.4).

### Ordem e dependências
F0 → F1 (demo visual já melhora sem backend) → F2 → F6 (rotina) → F3 → F4 → F5 → F7 em paralelo a partir de F1. Demo mínima = F0+F1+F2+F3+F6 (+F7 OmniHuman/guardrails). Total estimado: **5 a 7 dias de uma pessoa**, sendo F2+F3 o caminho crítico.

---

## 4. O que a Opção B NÃO resolve, e quando migrar para dado

1. **Receita por instância.** A receita é código: todo cliente (Remix) vê a mesma frase, o mesmo padrão e o mesmo limite. No dia em que um cliente tiver só Replicate (sem HeyGen) e quiser outro padrão, ou quando o Samuel quiser mudar a frase sem deploy, é hora de mover `faz/naoFaz/limites/padrao/variacoes` para `video_models.recipe jsonb` (ou tabela `tool_recipes`) e deixar `receitas-de-video.ts` só como semente + fallback. Gatilho concreto: a segunda vez que alguém pedir "muda o texto do OmniHuman" e a resposta for "só com deploy".
2. **Divergência catálogo × receita.** `video_models.limits/cost` (dado) e `receita.limites/campo.max` (código) podem desencontrar (ex.: alguém sobe `max_duration_s` para 34 e a receita continua 15). Mitigação barata: o teste de F0 lê `supabase/seed-instancia.sql` e confere os números citados; a migração para dado elimina o problema.
3. **Regra 1 nos roteiristas do motor** (`director-core.ts`, Reel, `sceneInEnglish` manual). Fica como dívida declarada; sai quando houver o pedido `plano_de_cenas` com estado próprio no job (Opção A/C).
4. **Custo prévio HeyGen/Higgsfield/ElevenLabs.** A receita só torna a ausência honesta ("Sem estimativa · cobrado na conta X"). Preço real exige tool de custo no MCP do Higgsfield (CF §7, NÃO VERIFICADO) e tabela verificada da HeyGen (CH §0).
5. **Variação por voz/idioma/apresentador.** A receita é por (ferramenta, modelo); não sabe que o avatar escolhido é inglês ou que a voz é clone profissional. O `contexto` do pedido leva isso ao Claude, mas a tela não adapta.
6. **Latência do Claude num campo de formulário** (03 §5.1). A UX de "pode sair, o sino avisa" resolve o roteiro longo; para uma fala de 600 caracteres a pessoa vai esperar 1–3 min olhando o campo. A opção não resolve; só não bloqueia (campo editável).
7. **Setup/onboarding** continua sem Claude e com briefing de defaults.
8. **"Só os campos que aquele modelo precisa"** (04 §o que o dono quer, b): a Opção B esconde/limita por `campo.max` e `limites`, mas a estrutura do formulário continua fixa por experiência (ex.: `motion_prompt` do Avatar V nunca aparece; resolução/teto de créditos do Diretor continuam expostos). Campos dinâmicos por modelo = Opção "dado + schema de campos".

---

## 5. Esforço, riscos e crítica honesta

### Esforço
| Fatia | Esforço | Deploy 103e71ae |
|---|---|---|
| F0 receitas | P | — |
| F1 telas lêem receita | M | — |
| F2 fila genérica | M | roteiro-pedido, mcp-server, director-advance (+ SQL + seed) |
| F3 botão + hook + prompt-assist | M | prompt-assist |
| F4 briefing do Diretor | P/M | video-brief |
| F5 remake | P (+P motor) | director-advance (opcional) |
| F6 rotina | P | RemoteTrigger |
| F7 fixes | P cada (≈ 1 dia o lote) | mcp-server, assistant-chat, SQL |

### Riscos
- **Deploy desalinhado** (AGENTS.md): F2 muda `_shared/roteiro.ts`; qualquer função que o importa e não for republicada roda com duas versões do shared. Listar com grep antes de publicar.
- **Seed/instância:** `roteiro_pedidos` nunca entrou no seed; um Remix novo não tem a tabela (03 §2.2). F2 precisa resolver isso ou a demo em instância nova quebra no primeiro clique.
- **Rotina não atende tipos novos** se F6 não for feita antes de F3 ir ao ar: pedidos ficam abertos 24 h.
- **Import cross-root** (`src` ← `supabase/functions/_shared`) pode falhar no build do Lovable (NÃO VERIFICADO) → plano B é a cópia com teste.
- **Duas sessões do Claude** (claude.ai + Code) com o mesmo conector: a reserva condicional (`mcp-server:1402-1408`) evita trabalho duplo, mas cada `acordarRotina` dispara uma execução (03 §5.3); mais tipos = mais disparos = mais cota da assinatura (03 §5.4). A tela promete "sem custo extra" (`roteiro-brief.tsx:227`): manter a frase, mas saber que é cota.
- **Pedido curto com receita longa:** se `receitaParaOClaude` para `fala` repetir pesquisa + referências, cada fala de 600 caracteres vira 5 minutos. A receita de `fala` precisa ser explicitamente curta ("sem pesquisa, sem plano").

### Onde esta opção vai doer em dois meses
1. **O arquivo vira a "tabela em código"**: 13 receitas × variações × limites × frases = 400–600 linhas que mudam toda vez que um modelo entra ou sai do catálogo. Quem mexe no `video_models` (SQL) vai esquecer de mexer na receita (TS) e vice-versa; o teste de F0 pega números, não frases.
2. **Chave por `HubWant`, não por experiência do catálogo**: `restyle`/`change_scene` dividem a experience `restyle`; `person_swap` vs `change_character`. Dois vocabulários (hub, catálogo) mais um terceiro (receita). Quando chegar a Opção "dado", a migração precisa de um mapa de três colunas.
3. **`roteiro_pedidos` carregando seis tipos** com um `tipo text` e `saida jsonb` é a tabela "sacola": validação por `switch` no servidor, tela por `switch`, rotina por `switch`. Funciona para 6; no décimo tipo (legenda, descrição de voz, avatar por prompt, `motion_prompt`) alguém vai pedir `escrita_pedidos` de verdade e a migração de nome vai ser chata (Realtime, RLS, sino, hooks, 4 edges).
4. **Receita = texto fixo em pt-BR no código** não dá para a marca ajustar ("nosso tom é X", "nunca use a palavra Y"): isso continua vindo de `marca_ler` em runtime, e a receita só diz "leia a marca". O dono vai perguntar por que a frase "o que faz" não muda para o cliente dele.
5. **Regra 1 fica 70% cumprida** (escrita da pessoa) e 30% documentada (roteiristas do motor). Se a régua do dono for "zero Gemini", a dívida de `director-core.ts` continua sendo a maior e esta opção não a toca.
6. **Formulários fixos** continuam mostrando campo que o modelo ignora (resolução no Higgsfield, teto de créditos no Replicate) e escondendo campo que o modelo aceita (`motion_prompt`). A receita explica melhor o que já existe; não muda o que existe.

---

### Critical Files for Implementation
- /Users/samuelfadanelli/Developer/subido-redes-sociais/supabase/functions/_shared/receitas-de-video.ts (novo; fonte única das 13 receitas, espelhado em /Users/samuelfadanelli/Developer/subido-redes-sociais/src/lib/tool-recipes.ts)
- /Users/samuelfadanelli/Developer/subido-redes-sociais/supabase/functions/_shared/roteiro.ts (tipos do pedido + `conferirEntregaPorTipo`; base da fila generalizada)
- /Users/samuelfadanelli/Developer/subido-redes-sociais/supabase/functions/mcp-server/index.ts (tools `roteiro_pedidos`/`roteiro_entregar` por tipo, `o_que_posso_fazer`, `marca_ler`)
- /Users/samuelfadanelli/Developer/subido-redes-sociais/src/components/prompt/prompt-tools.tsx (botão "Escrever com o seu Claude", espera, Usar/Ignorar; saída do gateway)
- /Users/samuelfadanelli/Developer/subido-redes-sociais/src/components/video/heygen-studios.tsx (4 estúdios: receita no topo, `GateEstimateLine` no `GenerateBar`, `max` por modelo)
