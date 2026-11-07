# 13 — Arquitetura do Agente Profissional de Criação de Vídeos

> Síntese do programa de pesquisa de 2026-08-19 (12 pesquisadores especialistas + auditoria cética).
> Base de evidência: `docs/13-pesquisa/01–12` (roteiro, direção, cinematografia, storyboard, arte,
> consistência IA, continuidade, áudio, edição, capacidades de modelos, processo de produção,
> sistemas multi-agente) + `docs/13-pesquisa/00-auditoria-cetica.md` (contradições resolvidas,
> claims rebaixados, lacunas). Relação com a produção atual: esta arquitetura **generaliza** o
> pipeline de Reels em produção (`docs/11` + `docs/12`) — o pipeline atual é uma instância
> especializada dela (short-form 9:16, diretor único), não um sistema a ser descartado.
>
> Convenção de citação: `[P04 §3.2]` = doc de pesquisa 04, seção 3.2; `[AUD C3]` = auditoria,
> contradição 3; `[D12 §5.5]` = docs/12-direcao-de-cena.

---

## 0. Veredito em uma página

**A tese central, unânime em todas as tradições pesquisadas (Pixar, anime, publicidade, live-action)
e em todos os sistemas multi-agente que funcionaram:** nada caro é produzido antes de o filme
existir como sequência barata aprovada. A arquitetura inteira é uma **escada de custo com portões**:

```
texto (centavos) → keyframes (centavos) → animatic (quase grátis) → vídeo (dólares) → pós/mix
        ↑ gate            ↑ gate                ↑ GATE HUMANO            ↑ gate QC        ↑ gate specs
```

O que muda em relação ao "prompt → vídeo": o vídeo passa a existir primeiro como **dado estruturado**
(brief → conceito → roteiro → bíblia visual → storyboard/shot specs → animatic), e cada transição é
validada — barato — antes da próxima. A geração de pixels é a ÚLTIMA etapa, não a primeira.

**As decisões estruturais (todas justificadas no corpo do doc):**

1. **5 papéis de agente, não 9** — Produtor/Orquestrador, Roteirista, Diretor (dono único do shot
   spec), Direção de Arte (dona única da bíblia visual), Editor/Finalizador. Cinematografia,
   continuidade, storyboard e crítico NÃO são agentes: são vocabulário, serviço de QC, artefato e
   função, respectivamente [AUD §6, C1].
2. **Handoff por artefato tipado, nunca conversa** — um IR (representação intermediária) único de
   shot, com compiladores por modelo [P12 §4, P10 §1.14].
3. **Shot de 5–10s é a unidade atômica**; duração longa = montagem, nunca extensão encadeada [P10 §1.13].
4. **Identidade é infraestrutura**: identity packs portáteis (imagens + embeddings + DNA textual)
   como fonte de verdade; recursos nativos dos vendors (Elements, ingredients, cameos) são cache [P06].
5. **QC unificado com severidade à Murch**: identidade facial e anatomia em close bloqueiam;
   continuidade espacial avisa; warnings agregam score por cena [P07 §3.2, AUD §3.3].
6. **Humano em 4 portões**: brief, escolha de conceito/visão, aprovação do animatic + pacote
   pré-geração, sign-off final. Nunca por micro-etapa [P11 §3, P12 §4].
7. **Loops de crítica com orçamento**: best-of-N + 1 refine no estágio caro; VLM-judge só para
   ranking par-a-par e falha grosseira, nunca nota absoluta [P12 §3].
8. **Model-agnostic por construção**: catálogo de modelos como dado + adapters; nenhum nome de
   modelo fora da camada de adapter (o pipeline atual já faz isso com `video_models`) [P10 §4].

---

## 1. Conceitos fundamentais extraídos da pesquisa

Os princípios abaixo são as âncoras com melhor evidência [AUD §5]. Cada um vira mecanismo concreto
(seção indicada).

| # | Princípio | Origem | Vira (nesta arquitetura) |
|---|---|---|---|
| 1 | **A cena é a unidade mínima de mudança** — cena que não vira a carga de um valor é "não-evento" e sai (McKee) | P01 §1.2 | Lint `cena-vira` no roteiro estruturado (§8.2) |
| 2 | **Frase-tema / spine**: toda decisão deriva de "sobre o que é este filme" em 1 frase (Lumet) | P02 §1.1 | Campo `theme` do conceito; escolha humana no portão 2 |
| 3 | **O significado está na justaposição, não no plano** (Kuleshov/Mamet); prompts descrevem fatos visuais, nunca emoção abstrata | P02 §1.2–1.3, P09 §1.2 | Schema de performance sem campo "emotion" (verbo + ação física); QC avalia trincas A→B→C, não frames isolados |
| 4 | **Tamanho no quadro ∝ importância dramática** (Hitchcock); o close é moeda cara, gasto no clímax | P02 §1.5, P03 §1.1 | Regra de derivação beat importance → shot scale + orçamento de closes |
| 5 | **Regra dos Seis de Murch como ORDENAÇÃO** (emoção > história > ritmo > eye-trace > 2D > 3D) — os percentuais são retóricos, a ordem é a política | P09 §1.1, AUD §2 | Política de severidade do QC (§7.2): sacrificar de baixo para cima |
| 6 | **Direção jogável, não de resultado** (Weston): verbos e tarefas físicas, nunca adjetivos | P02 §1.11 | Validação de schema: performance = `verb + physical` |
| 7 | **Coerência visual nasce de restrição**, não de acúmulo: poucas regras proibitivas + bloco de look literal (show LUT da era generativa) | P03 §1.10, P05 §1.9, D12 §3.9 | Bíblia visual pequena e proibitiva; look_lock verbatim em todo prompt |
| 8 | **Luz motivada** (Deakins): toda luz tem fonte física nomeada na cena | P03 §1.6 | Campo `lighting_source` obrigatório; linter de "cinematic lighting" solto |
| 9 | **Color script** (Pixar): cor/luz mapeadas ao arco emocional ANTES de produzir qualquer frame | P05 §1.8 | Seção `color_script` da bíblia, consumida por todo keyframe |
| 10 | **O corte é decidido no papel** (découpage/ekonte): duração, transição e sequência são decisão de pré-produção | P04 §1.5 | Storyboard estruturado com `duration_s` + `transition_out` antes de gerar |
| 11 | **O animatic é o teste de verdade do pacing** — o filme inteiro existe barato antes de existir caro (story reel Pixar, boardomatic de agência) | P04 §1.7, P11 §1.3 | Portão 3: animatic = keyframes + TTS + durações, montado por centavos |
| 12 | **Identidade é problema de referência, não de prompt** | P06 §1.2 | Identity packs (§9.1); prompt anchoring só como reforço |
| 13 | **Image-first**: keyframe aprovado → i2v com prompt SÓ de movimento; t2v puro é loteria | P10 §1.1, P06 §2, D12 §5.3 | Keyframe como artefato de primeira classe; validação barata acontece na imagem |
| 14 | **Física proibida**: mãos+objetos, texto em cena, líquidos, oclusões, multidões — o roteirista escreve DESVIANDO delas (MAViS: "escrever para as limitações do gerador") | P10 §1.12, P12 §1 | Lista de cenas proibidas como config viva, aplicada no roteiro E no QC |
| 15 | **Som em 5 camadas com orçamento de Murch** (≤2 por família encoded/mid/embodied, ≤5 no total); silêncio digital = erro; room tone costura cortes | P08 §1.1–1.2 | Spotting sheet por cena; validador de camadas e LUFS |
| 16 | **Voz = TTS próprio com voice_id fixo**; áudio nativo dos modelos de vídeo é ambiência/temp (a voz muda entre clipes) | P06 §1.9, P08 §1.10, P10 §1.8 | Política de áudio por clipe; trilho de avatar separado |
| 17 | **Estrutura antes de polish** (assembly → rough → fine → lock): refinar antes de aprovar estrutura é retrabalho garantido | P09 §2 | Fases do Editor; gate humano entre rough e fine |
| 18 | **Lints são warnings anuláveis com justificativa** — quebra deliberada de regra é decisão autoral (Ozu quebra 180°, Godard jump-cuta) | P01–P05, P09 §4 | `deliberate: true + justification` suprime warning; nunca bloqueio rígido fora dos inegociáveis |
| 19 | **Gramática é condicional ao formato**: establishing obrigatório em narrativa é nocivo em short-form de conversão | AUD C4 | Perfis de formato (§8.1) parametrizam os validadores |
| 20 | **Crítico fraco é pior que nenhum** (StoryAgent/LAION): dá falsa confiança | P12 §3 | Todo check tem versão determinística/embedding primeiro; VLM só onde agrega |

---

## 2. O processo profissional abstraído para IA

A indústria converge num funil de portões onde **cada portão converte ambiguidade em compromisso
documentado e nenhum portão reabre o anterior** sem change order explícito [P11 §2]. A economia
subjacente (curva de custo de defeito): problema de história custa reescrita na pré, "reshoot" na
produção, buraco insanável na pós. Em IA o "reshoot" custa centavos — **mas o portão do animatic
continua valendo**, porque evita desperdício de geração E de atenção do usuário [P11 §3].

Mapeamento indústria → plataforma:

| Portão da indústria | Equivalente na plataforma | Quem aprova |
|---|---|---|
| 1. Brief criativo | Brief estruturado (elicitado por agente, campos canônicos) | **Humano** |
| 2. Conceito + roteiro/storyboard | 2–3 conceitos gerados → escolha; roteiro validado por lints | **Humano** escolhe conceito; lints validam roteiro |
| 3. Award (treatment do diretor) | 2–3 "treatments" (direções visuais da bíblia) → escolha | **Humano** (fundido com portão 2 em formatos simples) |
| 4. PPM (pre-production meeting) | **Pacote pré-geração**: bíblia aprovada + identity packs + storyboard + animatic + custo estimado | **Humano** — o portão mais valioso da plataforma |
| 5. Takes no set (video village) | Geração + QC automático por take; best-of-N | Agente (QC); humano só se escalado |
| 6. Offline / picture lock | Corte montado conforme animatic; notas do usuário | **Humano** (notas → deltas estruturados) |
| 7. Online / sign-off | Masters por formato + QC de specs | **Humano** (sign-off final) |

**Síntese**: o humano fica com 4 momentos de decisão (brief, conceito/visão, pacote pré-geração,
sign-off) — exatamente os portões 1, 2/3, 4 e 6/7 que a indústria levou 70 anos para descobrir.
Todo o resto (breakdown, decupagem, geração, continuidade, conform, QC) é agente + modelo com
validação automática [P11 §3]. Em modo "piloto automático" (conteúdo recorrente de baixo risco,
como o Reels atual), os portões humanos podem ser rebaixados a "notificar + prosseguir" por
configuração — mas continuam existindo como pontos de inspeção.

---

## 3. Pipeline recomendado

```
F0 BRIEF        agente elicita/estrutura → humano aprova (portão 1)
F1 CONCEITO     N conceitos (logline+tema+abordagem) → humano escolhe (portão 2)
F2 ROTEIRO      roteiro estruturado (formato AV) → lints editoriais → aprovação leve
F3 BÍBLIA       direção de arte: bíblia visual + color script + identity packs
                → verificação interna de coerência → humano aprova identidades-chave (portão 3)
F4 DECUPAGEM    diretor: cenas → shot specs (IR único) → lints de decupagem (custo zero)
F5 KEYFRAMES    1–2 keyframes por shot (imagem com referências do pack)
                → QC de identidade/look/composição (barato, na imagem)
F6 ANIMATIC     keyframes + TTS real + durações medidas → validador de ritmo
                → HUMANO APROVA animatic + custo estimado (portão 4 — o PPM da plataforma)
F7 GERAÇÃO      i2v por shot (prompt só de movimento) + avatar/lipsync no trilho próprio
                → QC por take (identidade, anatomia, aderência) → best-of-N + reparo em escada
F8 MONTAGEM     corte conforme animatic (EDL) → avaliação de montagem (ritmo, motivação, kuleshov)
                → rough cut → notas humanas (portão 6) → ajustes/regeneração dirigida
F9 SOM          spotting → VO final → ambiência/foley → música por cue → mix → masters LUFS
F10 FINALIZAÇÃO upscale do corte aprovado, legendas, safe zones, versões por formato
                → QC de specs → sign-off humano (portão 7)
```

Propriedades do pipeline:

- **Escada de custo estrita**: F0–F4 custam tokens de LLM; F5 custa centavos de imagem; F6 custa
  TTS; só F7 custa dólares de vídeo. Erro descoberto em F7 que era detectável em F5 é falha de
  arquitetura [P12 §4].
- **F5/F6 são o coração**: o keyframe é o storyboard executável — é ali que consistência,
  composição e look são ganhos e auditados, porque imagem é barata de refazer [P06 §2]. O animatic
  com TTS **medido** (não estimado) é onde o ritmo é validado de verdade [D12 §1.11].
- **Paralelização**: shots são independentes dado o plano + refs → F5 e F7 rodam em paralelo por
  shot. O que NUNCA paraleliza: o plano (F2–F4, fonte única de consistência) e a suavização de
  fronteiras entre shots [P12 §4].
- **O feedback também sobe** (lacuna apontada em [AUD §4]): QC reprova take → regenera (F7);
  N falhas no mesmo shot → Diretor reescreve o shot spec (F4); shot irrecuperável (física proibida
  detectada tarde) → Roteirista substitui o beat (F2), com invalidação em cascata explícita e
  custo-consciente (§7.4).

---

## 4. Arquitetura de agentes

### 4.1 Por que 5 papéis, e não 9

A soma ingênua das pesquisas produz 8–10 agentes (roteirista, diretor, DP, decupador, arte,
continuidade, som, editor, crítico). A evidência real aponta contra [AUD §6]: nenhum sistema
multi-agente bem-sucedido separa DP de diretor [P12 §1]; três docs propuseram o MESMO serviço de
QC de identidade três vezes [AUD §3.3]; e "crítico" como agente conversacional é o padrão que
falhou (StoryAgent) — crítica funciona como **função com critérios claros**, não como persona.
Regra de decisão: **papel de agente = caneta própria sobre um artefato próprio**. Quem não escreve
artefato é serviço, validador ou vocabulário.

### 4.2 Os cinco agentes

**A1 — Produtor/Orquestrador** *(determinístico + LLM para exceções)*
- **Dono de**: `project` (máquina de estados dos portões), `budget_ledger`, fila de jobs.
- **Faz**: avança o pipeline; monta o pacote pré-geração (o "PPM book"); estima e trava custo
  antes de F7; aplica a política econômica (§7.4); roteia falha terminal para o agente certo
  (replanejamento para cima); registra approvals.
- **Não faz**: nenhuma decisão criativa. É o 1º AD + producer: autoridade logística, não autoral
  [P11 §1.2]. A maior parte dele é código, não LLM — como o orquestrador reentrante atual
  (`video-pipeline.ts`).

**A2 — Roteirista**
- **Dono de**: `concept` (propõe N), `script` (roteiro estruturado formato AV).
- **Inputs**: brief aprovado, perfil de formato, identity packs existentes (personagens
  recorrentes), lista de cenas fisicamente proibidas (config viva), telemetria de performance.
- **Faz**: logline → beat sheet → cenas com valor em jogo/virada → linhas AV sincronizadas
  (visual ‖ áudio). Escreve **para as limitações do gerador**: 1 ação por shot futuro, frases
  curtas (o teto de planos = nº de frases [D12]), zero interioridade não-filmável, desvio das
  cenas proibidas [P12/MAViS, P10 §1.12].
- **Processo interno**: escreve de trás para frente (payoff → setups → hook) [P01 §2.4].

**A3 — Diretor** *(dono único do shot spec — resolução da maior contradição da pesquisa [AUD C1])*
- **Dono de**: `scene_intent` + `shot` (a decupagem completa: escala, ângulo, lente, movimento,
  blocking, atenção, eixo, performance jogável, duração, transição).
- **Inputs**: roteiro aprovado, bíblia visual (consome, nunca altera), perfil de formato.
- **Faz**: análise cena a cena (função, conflito, fulcro, subtexto, imagem-síntese) → decupagem
  por beat com regras de derivação (importância → escala; poder → ângulo; curva de tensão →
  duração/escala; movimento só com motivação) [P02 §2–3]. Marca pares de contraste, junções
  `flow` vs `cut`, frases-âncora de avatar. O storyboard É o output do Diretor (artefato), não um
  agente separado. O "Agente de Cinematografia" vive aqui como **vocabulário fechado + regras de
  derivação** [P03 §3] — enums pequenos, porque enum grande faz o LLM sortear termo bonito [D12 §5.1].
- **Não faz**: não escreve nem reescreve fala (escolhe frases por índice — invariante de produção
  comprovado [D12]); não altera a bíblia; não gera pixels.

**A4 — Direção de Arte** *(dona única da bíblia visual [AUD C2])*
- **Dono de**: `visual_bible` (versionada) — style prompt + negative prompt, paleta master com
  papéis, shape language, color script por cena, personagens/ambientes/props canônicos com
  identity packs, look_lock serializado, period rules/proibições.
- **Faz**: 2–3 direções visuais (treatments) para escolha humana; cria e mantém identity packs
  (§9.1); deriva a paleta por cena do arco emocional (color script); fornece os fragmentos de
  prompt que TODOS os geradores concatenam. Mudança de regra = nova versão da bíblia com política
  de invalidação explícita (§7.4).
- **Não faz**: não roda gate próprio de QC — define o cânone que o serviço de QC usa [AUD §3.3].

**A5 — Editor/Finalizador**
- **Dono de**: `cut` (EDL: animatic, rough, fine, masters — mesmo modelo de dado), spotting sheet
  de som, specs de entrega.
- **Faz**: monta o animatic (F6) e o corte (F8) conforme durações planejadas; **avalia** a
  montagem (métricas de ritmo baratas → LLM-vision em trincas só após triagem [P09 §3]);
  diagnostica → propõe UMA correção por vez na ordem de Murch, com os 4 verbos: recortar,
  reordenar, retimear, **regenerar** (o verbo que só existe em pipeline generativo); dirige o som
  (spotting → camadas → mix → masters por plataforma [P08 §3]); produz entregáveis por formato.
- **Restrição herdada da produção**: retimear fino só existe onde há primitiva de trim; sem ela,
  corte em fronteira de frase [AUD C8, D12].

### 4.3 Serviços (não-agentes)

- **QC/Continuidade** *(o serviço unificado — três docs o propuseram em triplicado [AUD §3.3])*:
  roda o checklist C1–C16 de [P07 §3.1] com os mecanismos e limiares de [P06 §3.4], contra o
  cânone da bíblia. Três camadas por custo: (1) regras sobre metadados (custo zero — eixo,
  elipse, direção declarada); (2) embeddings (ArcFace para rosto, DINOv2/CLIP para
  sujeito/ambiente — rodam sempre); (3) LLM-vision estruturado (1 chamada por keyframe extrai
  JSON de figurino/props/olhar/luz/anomalias; os checks comparam JSONs, não fazem novas
  chamadas). Emite veredito com severidade (§7.2).
- **Compiladores de prompt / adapters de modelo**: serializam o IR de shot no dialeto de cada
  modelo (§10). Determinísticos.
- **Montador de mídia**: concat, mux, normalização, upscale, legendas, loudness — determinístico.
- **Telemetria**: hook rate/retenção por vídeo publicado realimentando validadores e golden set.

---

## 5. Comunicação entre agentes: artefatos tipados e o IR único

**Regra absoluta: handoff por artefato estruturado versionado, nunca conversa livre** [P12 §4].
Os cinco schemas de shot propostos pelas pesquisas [AUD §6] colapsam num **IR único**:

```yaml
# ---- nível projeto ----
project: {id, type, format_profile, status: <portão>, budget_cap, spent}
brief:   {objective, audience, smp, key_messages[], tone, mandatories[],
          deliverables[], approved_at/by}          # axioma do projeto; herdado por toda validação
concept: {logline, theme, premise, selected}        # theme = frase-tema de Lumet, escolhida por humano

# ---- roteiro (formato AV estruturado) ----
script:
  version, duration_target_s, promise, cta
  characters: [{identity_id, want, need, arc}]
  scenes:
    - id, beat, slugline: {int_ext, location_id, time_of_day, story_day}
      scene_goal, conflict, value_at_stake, charge_open, charge_close, turn   # McKee: cena vira
      av_lines: [{idx, visual, audio: {vo|dialogue|sfx|music_cue}, on_screen_text}]
      setups: [], payoffs: []

# ---- bíblia visual (dona: Arte) ----
visual_bible:
  version, style: {medium, era, style_prompt, negative_prompt, camera_texture, shape_language}
  palette_master: [{hex, role, share}]              # 60-30-10 com papéis
  look_lock: "<bloco literal colado em todo keyframe prompt>"
  color_script: [{scene_id, beat_emotion, palette, light, saturation}]
  identities: [-> identity]                          # §9.1

# ---- decupagem (dono: Diretor) — O IR DE SHOT ----
scene_intent:
  scene_id, function, change: {from, to}, pov, conflict, subtext,
  fulcrum, beats: [{id, event, tactic, importance}], key_image, tension_curve[]
  screen_direction: {axis_line, side}, light_direction     # herdados por todos os shots da cena

shot:
  id: "4A"                    # cena+letra = chave estrangeira universal (roteiro↔board↔assets↔timeline)
  scene_id, order, beat_ref
  intent: str                 # POR QUE o plano existe — obrigatório, base de toda revisão
  role: hook|proof|retention|cta|narrative           # papel editorial (perfil de formato)
  # câmera (vocabulário fechado; subset permitido definido pela bíblia)
  scale, angle, lens_mm, dof, movement, move_motivation, composition
  camera_style: premium|handheld_doc                 # por tipo de plano [D12 §3.12]
  # conteúdo
  characters: [{identity_id, screen_side, facing, eyeline, performance: {verb, physical}}]
  scene_action: {peak_frame_desc, continuation_desc}  # par keyframe/movimento [D12 §4.2]
  second_beat: str|null       # o que muda no segundo 3 (planos ≥3s)
  props_in_frame: [identity_id], hero_object_state: str|null
  visual_correlate: str|null  # número falado → objeto contável
  relation_to_line: illustrate|juxtapose|metaphor
  # luz e look (herdados/derivados da bíblia)
  lighting_source: str        # fonte diegética NOMEADA
  visual_intensity: 1-5       # curva de Block = tension_curve = um só campo [AUD §3.7]
  # montagem planejada (découpage)
  speech_line_idxs: [int]     # frases por ÍNDICE — nunca texto novo
  duration_s, transition_out: cut|flow|match_cut|J|L
  exit_motion, entry_motion   # cutting on action
  interrupt: bool             # re-hook
  # áudio
  audio_policy: native_ambience|mute_post|avatar_track
  # execução (preenchido pelos serviços)
  assets: {keyframes[], takes[], tts, selected_take}
  status: draft → boarded → keyframed → animatic_ok → approved → generated → qc_passed → final
  overrides: [{rule, deliberate: true, justification, author}]

take: {shot_id, model, params, cost, url, qc_result: json, status, superseded_at}
cut:  {kind: animatic|rough|fine|master, edl: [{take|keyframe, in, out, transition}], audio_tracks}
approval: {project, gate, artifact+version, approver, ts, notes}
```

Regras de comunicação:

1. Cada agente lê e escreve **apenas seus campos**; `status` do shot é a máquina de estados.
2. Mudança em artefato aprovado = nova versão + ciclo explícito (o "change order"), nunca edição
   silenciosa [P04 §3.3, P11 §2].
3. **Rastreabilidade descendente**: todo take aponta take → shot → cena → script → concept → brief
   — qualquer validador consegue checar qualquer frame contra o brief [P11 §4].
4. Conversa livre entre agentes só existe DENTRO de uma fase criativa de texto (ex.: debate de
   conceitos), sempre com juiz e rodadas limitadas [P12 §1/FilmAgent] — nunca como handoff.

---

## 6. Perfis de formato (a gramática é condicional)

Descoberta da auditoria [AUD C4]: regras "universais" de cinema colidem com short-form
(establishing obrigatório vs proibido; densidade de corte; re-hook). A resolução é o **perfil de
formato** — um objeto de configuração que parametriza validadores e regras de derivação:

```yaml
format_profile:
  id: reels_conversion | reels_brand | youtube_narrative | ad_30s | institutional | series_episode
  aspect, duration_range, platform_specs: {safe_zones, loudness_lufs, captions_required}
  grammar:
    opening: in_media_res | establishing_allowed     # C4
    pacing: {min_shot_s, max_shot_s, shots_range}    # D12: 2.5–6s, 7–10 planos p/ reels
    rehook_window_s: [9,13] | null
    cta: required | optional | forbidden
    close_budget, avatar_max_share, structure: hook_body_close | three_act | story_circle
  proibições: [...]                                  # lista NUNCA do formato
```

O pipeline de Reels atual é o perfil `reels_conversion` já calibrado em produção — os ~60
princípios do D12 são a instância desse perfil, não regras da plataforma inteira.

---

## 7. Sistema de revisão e qualidade

### 7.1 Um gate por transição, na camada mais barata possível

| Transição | Gate | Mecanismo | Custo |
|---|---|---|---|
| brief → conceito | campos canônicos completos | schema | ~0 |
| conceito → roteiro | logline completa (personagem+objetivo+conflito+stakes) | LLM-judge c/ rubrica | centavos |
| roteiro → decupagem | lints editoriais: cena-vira, filmabilidade, duração, setup/payoff, SMP única, cenas proibidas | regex + LLM-judge | centavos |
| decupagem → keyframes | lints de decupagem: intent obrigatório, 180°/eyeline declarativo, delta de escala (30°), motivação de movimento, cobertura de frases, performance sem adjetivo | **puro código sobre enums** | 0 |
| keyframe → animatic | QC de imagem: identidade (ArcFace), look (presença literal do look_lock + ΔE de paleta vs color script), composição/safe zones, anomalias | embeddings + 1 chamada VLM/keyframe | centavos |
| animatic → geração | ritmo sobre durações TTS **medidas**; curva de escala vs curva emocional; **aprovação humana + custo travado** | código + humano | TTS |
| take → seleção | QC de vídeo: C1–C16 (identidade intra/inter-clipe, figurino, props, luz, eixo, anatomia, flicker, lipsync) | embeddings sempre; VLM em keyframes amostrados | ~5–10% do custo do take |
| corte → fine | avaliação de montagem: curva de durações, densidade, alinhamento áudio-corte, dead air, motivação por trinca | métricas baratas → VLM só após triagem | baixo |
| master → entrega | specs: resolução, duração, LUFS, legendas, mandatórios do brief, textless | determinístico | ~0 |

### 7.2 Política de severidade (Murch como política, não como score)

- **Bloqueiam sempre (inegociáveis)**: identidade facial trocada/derivada (C1/C2/C5 — "trocar o
  ator no meio da cena" é falha de produto, não de continuidade); anatomia grotesca em plano
  próximo (C13); specs técnicos de entrega; estouro de orçamento.
- **Bloqueiam por contexto**: eyeline em shot/reverse de diálogo; duração < áudio do plano;
  figurino trocando de peça na mesma cena.
- **Avisam (warning anulável)**: TODA continuidade espacial (180°, direção de tela, raccord) —
  Murch manda sacrificá-la primeiro [P07 §3.2]; monotonia; luz variando; props periféricos.
- **Ponderação por atenção** (change blindness): o mesmo defeito é erro em rosto/mãos/objeto da
  ação em plano fechado, warning na periferia de plano aberto. O VLM responde também "onde está a
  atenção neste frame".
- **Score por cena**: 1 warning passa; ≥3 warnings na mesma cena escalam para regeneração ou
  revisão humana — deslizes pequenos juntos quebram a ilusão [P07 §3.2.5].
- **Falso positivo nº 1 previsto**: mudança diegética legítima (tirou o casaco, bebeu o copo).
  Mitigação: as ações do roteiro entram no prompt do VLM ("a mudança é explicada por ação?").

### 7.3 Loops de geração-avaliação com orçamento

- **Texto**: iteração barata, mas com rodadas limitadas e saída demarcada (o padrão
  Critique-Correct-Verify do FilmAgent, aplicado só na fase de texto).
- **Keyframes**: best-of-2/3 + 1 refine; reprovou identidade → regenerar com refs reordenadas.
- **Vídeo (caro)**: **best-of-N (N=1–2 default) + escada de reparo**: (a) regenerar com delta de
  prompt dirigido pelo report do QC (o continuísta que avisa antes do take: "reforçar: jaqueta
  verde, caneca na mão esquerda"); (b) defeito só de rosto → face swap + restore (reparo 128px,
  não mecanismo primário); (c) defeito localizado → inpainting/v2v de resgate; (d) 3 falhas →
  **replanejamento para cima** (§7.4). Warping/movimento ruim → retry com um degrau a menos de
  `motion_energy` [D12 §5.4].
- **VLM-judge**: ranking par-a-par entre takes e detecção de falha grosseira. **Nunca nota
  absoluta fina** — falha admitida na literatura [P12 §3].
- **Olhos frescos**: avaliação de montagem por instância limpa (sem histórico das iterações) a
  cada N passes — o editor-como-primeira-plateia não se regenera [P09 §4].

### 7.4 Os canais que a pesquisa não cobriu (decisões desta arquitetura)

*(lacunas de [AUD §4], fechadas aqui como proposta)*

- **Replanejamento para cima**: falha terminal de take → Diretor recebe o dossiê de QC e decide:
  reescrever o shot spec (novo ângulo/ação que desvia da falha) OU degradar (plano estático de
  keyframe com movimento de câmera sintético) OU escalar ao Roteirista (substituir o beat). Cada
  subida atravessa um gate e registra custo já gasto.
- **Política econômica**: teto por projeto (budget_ledger, já existe) + teto por shot (múltiplo do
  custo unitário do modelo primário); escalonamento barato→caro (rascunho no modelo econômico,
  hero shots no premium); "bom o suficiente" = passa gates bloqueantes + score de warnings abaixo
  do limiar do perfil — perfeição não é critério de parada, orçamento é.
- **Invalidação em cascata custo-consciente**: bíblia v2→v3 invalida por dependência declarada
  (mudou paleta → keyframes/takes que a violam entram em fila de regeneração RANQUEADA por
  visibilidade do defeito × custo; o Produtor propõe o pacote de regeneração, humano aprova se
  estourar teto). Fork de projeto = branch de `cut`+overrides com assets compartilhados (A/B de
  hook é o caso primeiro).
- **Nota humana → delta estruturado**: toda nota do portão 6 é classificada pelo Produtor em
  {patch de bíblia | patch de shot spec | rejeição de take | mudança de roteiro} com escopo e
  custo estimado ANTES de executar — nota ambígua volta como pergunta, não vira regeneração cega.
- **Aprendizado**: telemetria (hook rate, retenção, escolhas humanas entre variantes) alimenta
  (a) calibração de limiares (ArcFace por estilo, benchmarks de ritmo por nicho — os números da
  pesquisa são chute inicial, a telemetria é o juiz [AUD §2]); (b) golden set de
  roteiros/decupagens aprovados como few-shot; (c) RAG de "receitas que funcionaram" por
  nicho/formato (padrão AesopAgent).

---

## 8. Consistência entre cenas

### 8.1 Identity packs (a fonte de verdade portátil)

```
identity        (kind: character | environment | prop)
  dna jsonb     -- DNA textual: físico, roupa-base, do_not_change[], paleta; env: layout/luz; prop: material/escala/tier
  prompt_block  -- bloco canônico injetado VERBATIM em todo prompt (anchoring como reforço)
  voice_id      -- personagens: voz clonada/fixa no provedor TTS
  lora_ref      -- opcional (personagem recorrente de série)
  provider_refs -- cache: kling_element_id, veo_ingredient, runway_ref, sora_cameo...
identity_asset  (role: front | 3q_l | 3q_r | profile | back | face_closeup | expression:* | hero_frame | composite)
  face_embedding vector(512), subject_embedding vector
```

Pipeline de criação [P06 §3.2]: hero portrait do DNA → **derivar ângulos por edição com referência**
(nunca gerar ângulos do zero) → auto-verificação ArcFace par-a-par (descartar outliers) → composite
→ registrar elementos nativos nos provedores → voz. Identidade `locked` é imutável; figurino novo é
variante vinculada, não edição.

### 8.2 Mecanismos em camadas (redundância deliberada)

1. **Bíblia + look_lock verbatim**: o color grade sem pós — string idêntica em todo keyframe
   [D12 §3.9, comprovado em produção].
2. **Referências visuais em toda geração**: 2–4 refs com atribuição explícita ("a mulher da
   imagem 1..."), mesmo quando o modelo aceita 10 — capacidade anunciada ≠ prática [AUD C9].
3. **Keyframe chaining com re-âncora**: last frame → first frame para junções `flow`; máximo 2–3
   elos, depois keyframe limpo regenerado do pack (drift acumula [P06 §1.7]).
4. **Gate de verificação**: ArcFace ≥ limiar calibrado (0,55 é chute inicial, calibrar por estilo)
   + DINOv2 para roupa/prop/ambiente + VLM com checklist do `do_not_change`.
5. **Voz**: `voice_id` fixo por personagem; áudio aprovado alimenta o lipsync.
6. **Técnicas de sala de edição**: transition shots (close de prop, silhueta) para resetar a
   percepção entre cenas pesadas de personagem; poucos ângulos por locação (geometria de ambiente
   não sobrevive a mudança grande de câmera) [P06 §2, §4].
7. **Seeds NÃO são mecanismo de consistência** — só variação sutil do mesmo frame [AUD C6].

---

## 9. Estratégia multi-modelo

- **IR de shot + compiladores**: o shot spec é serializado no dialeto de cada modelo (Veo: prosa
  por seções + cues de áudio; Sora: blocos com beats numerados e Dialogue à parte; Runway i2v: só
  movimento; Kling: fórmula própria). Convergência oficial dos guias: seções fixas, vocabulário
  cinematográfico concreto, 1 movimento por shot, zero negação [P10 §1.14]. Prompt nunca é texto
  livre do usuário direto no modelo.
- **Catálogo como dado** (padrão já em produção): tabela de modelos com input_template +
  required_inputs + **capability tags** (i2v, flf, refs, multi-shot, áudio nativo, câmera
  paramétrica, v2v, avatar) + custo/s + limites. Trocar/adicionar modelo = dado, não código.
- **Roteamento por tarefa**: keyframes → imagem com referência; motion de personagem e diálogo →
  famílias fortes nisso; b-roll barato → modelos econômicos; hero shots → premium; avatar → trilho
  dedicado (imagem+áudio, o mais maduro do mapa); resgate → v2v/inpainting. Snapshot de
  preços/nomes é config viva com data — nada disso é constante de arquitetura [AUD §2].
- **Requalificação**: golden prompts por capacidade re-rodados a cada modelo novo/atualizado;
  telemetria de drift por modelo (score de QC por tentativa).
- **Pós determinístico obrigatório** ao misturar modelos: normalização de dims/fps/cor/loudness
  antes de concat (defeito já vivido em produção: concat reenquadra).

---

## 10. Automação vs intervenção humana

**Automatizado com validação** (agente decide, gates conferem): breakdown, decupagem, keyframes,
geração de takes, QC, continuidade, montagem conforme animatic, som, conform, masters, QC de
entrega.

**Humano decide** (os 4 portões + inegociáveis):
1. Brief (o axioma do projeto).
2. Conceito/tema + direção visual (a autoria: frase-tema e tese estética são juízo de valor).
3. **Animatic + pacote pré-geração + custo** (o PPM — maior alavancagem por real gasto).
4. Sign-off final (o nome do cliente vai ao ar — sem exceção).
   Além disso: rostos/vozes de marca (casting), claims regulatórios, quebras deliberadas de regra
   (override com justificativa), decisão de silêncio/não-pontuar no som, voice cloning (sempre com
   termo), notas estruturais no rough cut.

**Configurável por confiança**: perfis recorrentes de baixo risco rebaixam portões 2–3 para
"notificar + prosseguir" (modo atual do Reels); conteúdo novo/cliente novo mantém todos. O sistema
deve degradar para MAIS supervisão quando o score de QC do projeto piora.

---

## 11. Boas práticas de produção com IA (condensado operacional)

1. Image-first sempre; t2v puro nunca para personagem/marca.
2. Prompt de i2v descreve SÓ movimento (redescrever a cena causa morphing).
3. 1 ação principal por clipe; 2 ações = 2 planos.
4. Escrever roteiro desviando da física proibida (mãos+objetos, texto em cena, líquidos,
   multidões, contato corpo-a-corpo); texto legível = overlay na edição, nunca geração.
5. Duração longa = montagem de shots de 5–10s; extensão encadeada só para "+5s de ação".
6. 2–4 referências com atribuição; re-âncora a cada 2–3 elos de chaining.
7. Voz por TTS próprio com voice_id; áudio nativo do modelo de vídeo = ambiência/temp.
8. Gerar barato (720p/modelo econômico), upar só o corte aprovado.
9. Todo movimento de câmera com motivação; tokens raros (dutch, dolly zoom) com orçamento.
10. Mudar UMA variável por iteração (a "uma nota por vez" do set, válida para regeneração).
11. Medir o ARQUIVO, não o log (lição de produção: dims/duração/frames extraídos pegam o que
    status nunca pega).
12. Room tone em 100% da duração; mix voz > música > FX; masters por plataforma.
13. Legendas queimadas por padrão em social; safe zones validadas por visão.
14. Registrar proveniência/licença por asset (música, voz, likeness); disclosure de sintético
    conforme plataforma — lacuna a fechar com política própria [AUD §4].

---

## 12. Do estado atual ao produto (caminho de generalização)

O pipeline em produção já implementa: escada de custo parcial (roteiro → decupagem → keyframes →
portão humano → vídeo), catálogo como dado, orquestrador reentrante por webhook, ledger de custo,
diretor-LLM com gramática fechada, look_lock, avatar com identity pack embrionário
(`brand_avatars`), invariantes de montagem sem trim. O delta para esta arquitetura, em ordem de
valor:

| Onda | Entrega | O que generaliza |
|---|---|---|
| 1 | **IR de shot único** + perfis de formato | O schema atual de `video_scenes` vira o IR §5; os lints do D12 viram o perfil `reels_conversion` |
| 2 | **Bíblia visual + identity packs** como tabelas de 1ª classe (`identity`/`identity_asset` com embeddings) | Generaliza `brand_avatars` para personagens/ambientes/props; look_lock passa a ser serialização da bíblia |
| 3 | **QC unificado** (camada embeddings + VLM estruturado + severidade Murch) | Substitui validadores esparsos por serviço único com score por cena |
| 4 | **Animatic como portão formal** (keyframes + TTS medido montados) + pacote pré-geração com custo travado | Hoje o portão é "aprovar keyframes"; o animatic valida ritmo antes do i2v |
| 5 | **Editor/avaliador de montagem** + trilha de voz contínua + camada de som S1→S5 | Roadmap P4/P5 do anexo D12 já aprovado — é a mesma direção |
| 6 | **Replanejamento para cima + política econômica + invalidação em cascata** | Novos; fecham as lacunas operacionais da auditoria |
| 7 | **Telemetria fechando o loop** (P7 do anexo) + golden set + calibração de limiares | Transforma os números "direcionais" da pesquisa em constantes calibradas próprias |
| 8 | Multi-formato (16:9, longo, série com identidades entre projetos) | Novos perfis + identity packs cross-project |

Riscos a vigiar (da auditoria): inflação de validações ("pipeline que nunca fica verde") —
começar com os gates bloqueantes mínimos e promover warnings a gates só com evidência de
telemetria; dependência de VLM-judge — todo check nasce determinístico primeiro; snapshot de
modelos como fundação — capability tags e adapters desde o dia 1.

---

## 13. Referências

Evidência completa, com fontes primárias por afirmação, nos arquivos de pesquisa:
`13-pesquisa/00-auditoria-cetica.md` (ler primeiro) · `01-roteiro-narrativa` · `02-direcao` ·
`03-cinematografia` · `04-storyboard-planejamento` · `05-direcao-de-arte` · `06-consistencia-ia` ·
`07-continuidade` · `08-audio` · `09-edicao` · `10-capacidades-ia` (snapshot ago/2026 — config
viva) · `11-processo-producao` · `12-sistemas-multiagente`. Craft de produção vigente:
`12-direcao-de-cena.md` + `12-anexo-entregaveis.md`.
