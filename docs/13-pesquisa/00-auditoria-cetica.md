# 00 — Auditoria cética do programa de pesquisa (docs 01–12 + doc 12-direcao-de-cena)

> Auditoria de 2026-08-19. Referências: `01`–`12` = docs desta pasta; `D12` = `docs/12-direcao-de-cena.md`
> (pipeline de Reels EM PRODUÇÃO — a arquitetura generaliza ele, não o contradiz).
> Veredito geral: conjunto forte e convergente no processo (escada de custo, gates, artefatos tipados),
> mas com 3 agentes disputando a mesma caneta, ~60 validações propostas com redundância pesada,
> e lacunas sérias de operação (custo, falha terminal, feedback humano estruturado).

---

## 1. Contradições entre documentos

**C1. Quem escreve o shot spec — 02 vs 03 vs 04.** O doc 02 (§3) dá ao Agente Diretor a decupagem
completa (escala, ângulo, movimento, blocking, luz implícita); o doc 03 (§3) dá ao Agente de
Cinematografia a "especificação visual por plano" com os mesmos campos; o doc 04 (§3.3) dá ao
"agente decupador (o 'diretor')" a conversão beat→shot. Três donos do mesmo artefato.
*Evidência mais forte:* doc 12 (§4) — nenhum sistema que funcionou tem DP separado de diretor; D12
opera em produção com UM diretor-LLM. *Resolução:* o Diretor é o único autor do shot spec; a
"cinematografia" vira o **Look System** (restrições herdadas, doc 03 §3) dentro da bíblia visual, e o
storyboard é o artefato de saída do Diretor, não um agente.

**C2. Dono da paleta/look — 03 vs 05 vs D12.** Doc 03 põe a paleta no Look System do agente de
cinematografia; doc 05 declara a Direção de Arte "único agente autorizado a alterar a bíblia" (com
palette_master); D12 tem o `look_lock` escrito pelo diretor. *Resolução:* bíblia visual do doc 05 é o
superset correto e deve ser a única fonte; o Look System do 03 é uma seção dela; o `look_lock` do D12
é a sua serialização em prompt. Um dono (Arte), dois consumidores.

**C3. Severidade da regra dos 180° — 02/03 vs 07.** Doc 02 (lint) e doc 03 (validações) tratam quebra
de eixo como **erro**; doc 07 (C8) trata como **warning**, bloqueando só em shot/reverse de diálogo,
citando Murch (espaço 3D = 4%, o primeiro a sacrificar) e change blindness. *Evidência mais forte:*
doc 07 — é o doc especialista no tema e a posição é consistente com 09 e com a política do D12 §2.1.
*Resolução:* 180°/eyeline = warning com override; erro apenas em diálogo shot/reverse.

**C4. Establishing shot obrigatório vs proibido — 03 vs D12.** Doc 03: "primeira aparição de um
espaço → plano de estabelecimento antes de closes" (erro se faltar). D12 §1.1/§1.14 (produção,
auditado): plano 1 NUNCA é establishing; abre in medias res. *Resolução:* a regra do 03 vale para
formato narrativo; em short-form de conversão ela é ativamente nociva. Toda gramática dessa família
precisa ser **condicional ao formato** — a arquitetura deve ter perfis de formato, não regras globais.

**C5. Densidade de corte — 09 vs D12.** Doc 09 §1.5: benchmark 1 corte/1,5–3s (TikTok), pattern
interrupt a cada 5–8s. D12 §2.7 (reconciliado com evidência contrária: cortes <1,5s prejudicam
reconhecimento; 1–5 planos = +36% persuasão B2B): piso 2,5s, teto 6s, 7–10 planos. *Resolução:* D12
vence para o produto atual; os números do 09 (fontes OpusClip/Subscribr, SEO) são baseline por
gênero/plataforma — o próprio 09 admite isso nos limites. Re-hook: 01 diz "a cada 5–10s", 09 "5–8s",
D12 "janela única 9–13s" — adotar D12, rebaixar os demais a direcionais.

**C6. Seed como mecanismo de consistência — 03/04 vs 06.** Doc 03 cita "seed lock" como estratégia e
o schema do 04 persiste `seed` como se reproduzisse o take. Doc 06 §1.6 (especialista): seed é
**frágil**, quebra silenciosamente com updates, não é mecanismo de identidade. *Resolução:* 06 vence;
seed só para variação sutil do mesmo frame; remover "seed lock" do vocabulário dos outros docs.

**C7. Grade/LUT pós-geração — 03 vs D12.** Doc 03 (estratégia 4) manda unificar com LUT na pós; D12 é
invariante "sem ffmpeg — todo look nasce no keyframe". *Resolução:* não é contradição de princípio, é
de capacidade: o look-lock verbatim é o mecanismo enquanto não existe camada de pós; a arquitetura
deve modelar pós de cor como **slot opcional** que, quando existir, assume o papel do show LUT.

**C8. Quem decide o corte: antes ou depois de gerar — 04 vs 09.** Doc 04 §1.5: "decidir o corte ANTES
de gerar" (découpage/ekonte, timing no board); doc 09 dá ao Agente Editor os verbos
recortar/reordenar/retimear pós-geração, com fine cut ao nível do frame. Além disso o retimear fino
contradiz o invariante D12 "corte só em fronteira de frase, sem trim". *Resolução:* o corte planejado
(animatic com durações do TTS medido) é o default econômico; o Editor do 09 opera como **avaliador +
regenerador dirigido**, e só ganha trim fino quando/onde a primitiva de trim existir. Os dois papéis
são fases, não agentes concorrentes.

**C9. Quantas referências por geração — 06 vs D12.** Doc 06 destaca capacidades anunciadas (Kling 10
refs, NB2 "5 personagens e 14 objetos"); D12 §5.8 e o próprio 06 (§1.3 Veo: "2 refs fortes > 3
competindo"; §4: multi-personagem é o modo de falha nº 1) apontam degradação acima de 2–4.
*Resolução:* default 2–4 refs com atribuição explícita; capacidade anunciada ≠ prática.

---

## 2. Afirmações fracas ou suspeitas (rebaixar a "direcional" ou cortar)

- **Pesos de Murch (51/23/10/7/5/4)** — 02, 07, 09 citam como se fossem dados; são números
  meio-jocosos do próprio Murch. Manter como **ordenação** de prioridade; nunca usar os percentuais
  literalmente em score. (Alto impacto: 3 docs constroem política de gate sobre eles.)
- **"~58% não veem erros de continuidade"** (07 §1.10) — estudo pequeno via imprensa de divulgação.
  O princípio (atenção pondera severidade) fica; o número é direcional.
- **Estatísticas de legenda/som** (08 §1.9): "+38% engajamento, +31% retenção, ~80%, 37%, 2,5× views
  com trending audio, +47% saves" — fontes de marketing (HubSpot/Verbit/Outfame). D12 §6.3 já fez a
  triagem certa (85% Facebook mudo + 93% sound-on TikTok, por plataforma). Cortar os números do 08 e
  apontar para D12. O 08 ainda generaliza "85% de social roda em mute" — é stat do Facebook.
- **Benchmarks de retenção do 09** ("1 corte/1,5–3s", "rolagem dispara após 12–15s estáticos",
  "queda >5pp/20s") — fontes SEO (OpusClip, Subscribr) ou sem fonte. Direcionais; a telemetria
  própria (D12 P7) é quem os calibra.
- **Janelas de hook por plataforma** (01 §1.4: "TikTok ~1–1,5s, Shorts ~2s") — fontes SEO. Direcional.
- **Limiar ArcFace 0,55/0,40** (06 §3.4) — o doc diz "prático inicial", mas nada o sustenta; é chute
  de partida que EXIGE calibração por estilo antes de virar gate bloqueante.
- **"Movimento consistente é a prioridade nº 1 entre artistas"** (06 §2) — afirmação sem fonte inline. Cortar ou sourcear.
- **Preços, durações e deprecações do doc 10** ($/s, "Sora 2 API desliga set/2026", 5–10s confiáveis)
  — snapshot ago/2026 de agregadores; corretos hoje, podres em 6 meses. Tratar como config viva com
  data, nunca constantes de arquitetura (o próprio 10 §4 recomenda isso).
- **Regra 1-10-100 / "10x por etapa"** (04 §2.8, 11 §2) — folclore de engenharia (Boehm
  popularizado); a direção é certa, o fator é retórico.
- **"Colaboração > modelo maior"** (12, FilmAgent 3.98/5) — avaliação humana pequena, domínio 3D
  pré-construído; evidência sugestiva, não prova. Não usar para justificar N agentes.

---

## 3. Sobreposições de responsabilidade (unificar)

1. **Shot spec** — 02+03+04 (ver C1). Dono: **Diretor**. Cinematografia e storyboard não são agentes.
2. **Paleta/look/bíblia** — 03 Look System + 05 bíblia + D12 look_lock (ver C2). Dono: **Arte/Bíblia
   Visual**; validação de paleta ΔE está duplicada em 03 e 05 — implementar uma vez.
3. **Identidade e continuidade visual** — 05 (QA facial/figurino), 06 (gates ArcFace/DINOv2/VLM +
   escada de reparo), 07 (C1–C16) propõem O MESMO serviço três vezes. Dono: **um serviço de QC/
   Continuidade** que roda o checklist do 07 com os mecanismos e thresholds do 06; o 05 define o
   cânone (insumo), não roda gate próprio.
4. **180°/eyeline/direção de tela** — lintado em 02, 03, 04 e 07. Rodar UMA vez como regra declarativa
   sobre metadados no storyboard (custo zero, 07 §3.3) + confirmação visual só no QC pós-geração.
5. **Hook/retenção** — 01 (lint 9), 09 (checklist 2), D12 (§6.1–6.2). Dono: validador editorial único
   (o do D12, que já existe).
6. **Ritmo/duração** — 01 (lint 4), 04 (lint 5), 09 (métricas), D12 §2.7. Um validador de ritmo sobre
   durações TTS **medidas** (princípio D12 §1.11: nunca estimativa quando há medida).
7. **Curva de intensidade** — `tension_curve` (02), curva de Block (03), `visual_intensity` (D12
   §2.11): mesmo conceito, três nomes. Um campo no IR.
8. **"Filmabilidade" para IA** — 01 (verbos de interioridade) e 10 §1.12 (cenas fisicamente proibidas)
   e 12/MAViS (guidelines anti-falha) são o mesmo lint de "gerabilidade" espalhado em três docs.
   Dono: Roteirista/Diretor com a lista de cenas proibidas como config viva.

---

## 4. Lacunas — o que nenhum doc cobriu

- **Branching/variantes e invalidação em cascata.** 11 versiona brief/script/cut e 05 versiona a
  bíblia, mas ninguém define: fork de projeto (A/B além do hook), diff/merge de versões, e a
  política de invalidação custo-consciente quando a bíblia muda (v2→v3: regerar o quê, aceitar o quê?).
- **Política econômica de decisão.** 11 tem `budget_ledger` e 12 manda "orçar antes", mas nenhum doc
  define a política: teto por shot vs por projeto, escalonamento modelo barato→caro, quando aceitar
  um take "bom o suficiente" vs regenerar, custo do QC vs custo da geração (o 07 admite que rodar
  C1–C16 denso é inviável, mas ninguém fecha a conta).
- **Falha terminal e replanejamento.** 06 (§3.4) e 12 param em "3 falhas → escalar a humano". E
  depois? Nenhum doc define o caminho de replanejamento PARA CIMA: QC reprovou N vezes → Diretor
  reescreve o shot → ou Roteirista reescreve o beat → ou o plano é substituído/degradado. O feedback
  só desce; a arquitetura precisa do canal de subida atravessando gates.
- **Feedback humano em linguagem natural → delta estruturado.** "Deixa mais escuro" é patch na
  bíblia, no shot spec ou no take? Nenhum doc modela a tradução de nota humana em mudança tipada com
  escopo — e esse é o loop de revisão mais frequente do produto real.
- **Aprendizado com resultados.** D12 §6.7 (telemetria) e 12/AesopAgent (RAG de receitas) acenam, mas
  não há schema do loop: o que se aprende (por cliente? nicho? modelo?), como evolui o golden set,
  como evitar sobreajuste à métrica de retenção (risco que 01 §4 e 09 §4 apontam sem resolver).
- **Multi-formato de verdade.** 01 lista formatos e 11 lista deliverables (16:9/1:1/cutdowns), mas
  todo o downstream (D12, retenção, safe zones) é 9:16 curto. Nada sobre 16:9 longo, série
  multi-episódio (identity packs entre projetos — 06 só tangencia via LoRA), reframe automático.
- **Direitos além de música/voz.** 08 cobre bem voz/música; faltam: likeness de rosto gerado parecido
  com pessoa real, direitos sobre referências enviadas pelo usuário, disclosure de conteúdo sintético
  (C2PA/labels por plataforma), proveniência por asset visual.
- **Operação:** moderação/brand safety do que se gera; idempotência e retomada de pipeline após
  crash; fila/concorrência/latência; requalificação contínua de modelos (10 §4 menciona golden
  prompts — ninguém especifica); permissões multi-aprovador no fluxo de gates do 11.

---

## 5. Os 10 princípios mais fortes (âncoras da arquitetura)

1. **Escada de custo com gates**: texto → keyframe → animatic → i2v → pós; nada caro antes de o
   barato ser aprovado (04, 10, 11, 12 — convergência unânime; é o modelo Pixar e o padrão de todos
   os papers e produtos).
2. **Handoff por artefato estruturado tipado, nunca conversa** entre agentes (12 §4, 04 §3.3, 10
   §1.14 — um IR de shot com compiladores por modelo).
3. **Hierarquia projeto→cena→shot; shot de 5–10s é a unidade atômica**; duração longa = montagem,
   nunca extensão encadeada (10 §1.13, 12, D12).
4. **Identidade é infraestrutura, não prompt**: identity pack portátil (imagens + embeddings + DNA)
   como fonte de verdade, refs nativas dos vendors como cache (06 — o doc mais sólido do conjunto; 12
   §convergência comercial: "nenhum produto confia em prompt para identidade").
5. **Murch como política de severidade**: emoção/história bloqueiam, continuidade espacial avisa;
   exceção inegociável = identidade facial e anatomia em close (07 §3.2 — a melhor síntese).
6. **Image-first**: keyframe é o storyboard executável; prompt i2v descreve SÓ movimento (10 §1.1,
   06 §2, D12 §5.3 — verificado em produção).
7. **Lints são warnings anuláveis com justificativa registrada; quebra deliberada é decisão
   autoral** (unânime: 01–05, 09; sem isso o sistema só produz fórmula).
8. **Humano em 4 portões de alavancagem**: brief, escolha de conceito/visão, animatic+pacote
   pré-geração, sign-off final — e nunca por micro-etapa (11 §3, 12 §4).
9. **Coerência por restrição**: bíblia visual pequena e proibitiva + bloco de look verbatim em todo
   prompt (03 §1.10, 05 §1.9, D12 §3.9 — já provado no pipeline real, custo zero).
10. **Loops bounded + best-of-N; VLM-judge só para ranking par-a-par e falha grosseira, nunca nota
    absoluta** (12 §3 — falha admitida do StoryAgent; 06 §3.4 escada de reparo com orçamento).

Menção honrosa (quase-âncora): roteirista escreve para as limitações do gerador — lista de cenas
fisicamente proibidas como config viva (10 §1.12 + MAViS); voz = TTS próprio com `voice_id` fixo,
áudio nativo do modelo de vídeo = ambiência (06 §1.9, 08 §1.10, 10 §1.8).

---

## 6. Riscos da arquitetura implícita

- **Inflação de agentes.** Cada pesquisador propôs "seu" agente — somando dá 8–10 (Roteirista,
  Diretor, DP, Decupador, Arte, Continuidade, Som, Editor, Crítico…). A evidência real (12 §4, D12)
  aponta para ~4–5 papéis num pipeline linear: Roteirista, Diretor (dono do shot spec), Arte/Bíblia,
  Produção+QC, Som/Finalização. Validador não é agente — é função determinística ou chamada de VLM.
- **Inflação de validações.** O conjunto propõe 60+ lints; o 07 prevê que o maior gerador de falsos
  positivos é mudança diegética legítima, e o 12 mostra que crítico fraco é PIOR que nenhum (falsa
  confiança). Risco: pipeline que nunca fica verde. Mitigação: pouquíssimos gates bloqueantes
  (identidade, anatomia em close, specs técnicos, duração), o resto warnings agregados por score de
  cena (mecanismo do 07 §3.2.5).
- **Dependência do elo mais fraco.** Dezenas de checks assumem VLM-judge confiável; a literatura do
  próprio conjunto (12) diz que não é. Todo check deve ter versão determinística/embedding primeiro.
- **Schemas concorrentes.** 01, 02, 03, 04 e 10 trazem cinco schemas de shot incompatíveis. Se o IR
  único não for definido ANTES da arquitetura, a integração vira tradução N×N.
- **Snapshot como fundação.** Preços, durações, nomes de modelo e capacidades (10, 06) datam em
  meses. Nada disso pode virar constante — camada de adapters + tabela de capacidades viva.
- **Sobre-otimização de métricas.** Um vídeo "lint-verde" com re-hook a cada 5s pode ser
  criativamente morto (01 §4, 09 §4). Benchmarks de retenção são baseline por gênero, telemetria
  própria é o juiz; a função-objetivo final é humana.
- **Idealismo vs invariantes de produção.** Vários docs propõem o que o pipeline atual não pode
  fazer (trim fino, J-cut de -300ms, LUT pós, tags de emoção no TTS). A arquitetura deve declarar
  explicitamente quais capacidades destravam quais princípios (como D12 §9 já faz) — senão os docs
  viram lista de desejos que contradiz a produção.
