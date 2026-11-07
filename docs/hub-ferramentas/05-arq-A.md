# 05 · ARQUITETO 1 — Opção A: receita por ferramenta como DADO

Repo lido: /Users/samuelfadanelli/Developer/subido-redes-sociais (main d63f465), somente leitura. Confirmações no código marcadas com arquivo:linha; o que vem só de doc está NÃO VERIFICADO.

## RESUMO
1. Fonte única = tabela nova `tool_recipes (experience, model_key, recipe jsonb)` com duas camadas: linha `model_key='*'` (regra da experiência: o que a pessoa escreve) e linha por modelo (`heygen/avatar-v`, `replicate/kwaivgi/kling-v4.0`, `higgsfield/seedance_2_5`) que só sobrescreve faz/não-faz/limites/custo. Não uso `video_models.recipe` porque Higgsfield, lipsync HeyGen e ElevenLabs não têm linha no catálogo e porque a mesma linha (Avatar IV) serve 3 experiências com frases diferentes.
2. A receita NÃO duplica `video_models.limits`/`cost` (mídia, duração, preço continuam lá); ela guarda só: 2 frases para leigo, campos de TEXTO tipados (id, rótulo, min/max, ajuda), regra de escrita (idioma, forma, inclua/evite, pausas, estrutura, exemplo, schema de saída), frases de limite e `custo.como` (como estimar).
3. Pedido de escrita = `roteiro_pedidos` generalizada com colunas `ferramenta, modelo, alvo, entrada jsonb, saida jsonb` + índice único parcial (um pedido aberto por pessoa × ferramenta × alvo). Edge `roteiro-pedido` aceita o pedido tipado; tools MCP novas `escrita_pedidos / escrita_entregar / escrita_mensagem`; `roteiro_*` continua para o roteiro profundo (pesquisa + plano) mas passa a receber a camada do modelo (ex.: OmniHuman ≤ 15 s ⇒ ≤ ~220 caracteres) e `conferirEntrega` usa o limite do pedido, não a constante.
4. Rotina do Claude ganha o bloco "6. ESCRITA (escrita_pedidos → escrita_entregar; precisou da pessoa, escrita_mensagem aguardar_pessoa true e pare)". `mcp-guia.ts` ganha a capacidade `escrita`. `video_criar` sem aceite devolve `receita` para o Claude escrever certo também pelo chat.
5. Tela: hook `useToolRecipe(experience, modelKey)` (merge '*' + modelo; tabela ausente ⇒ null ⇒ cópia atual). Frase faz/não-faz no ModelRail/estúdio/ladrilho; campos de texto renderizados pela receita (`RecipeTextField`); `GateEstimateLine` em todos os estúdios ("Sem estimativa para este modelo" nunca some); botão "Escrever com o seu Claude" (`EscreverComClaude`) no lugar de "Melhorar prompt" em todo campo de vídeo, reaproveitando `AndamentoDoRoteiro`/`ConversaClaude`/`PromptTools` (mic fica), "Conectar o Claude" vira modal inline.
6. CRÍTICA à própria opção: formulário 100% gerado é exagero — os campos pesados (avatar, voz, upload, consentimento, cenas/duração) ficam fixos por estúdio; a receita dirige só textos, frases e custo. Dado-dirigido também é exagero para `escrita.saida` complexa (plano do roteiro): continua em código (`roteiro.ts`).
7. prompt-assist/video-brief: kinds video/script/scene e a edge video-brief deixam de chamar LLM (410 com mensagem); "Montar o briefing" vira pedido `director_brief` não bloqueante (campos aparecem já; o Claude preenche quando entregar). Quebra: resposta passa de segundos para minutos; mitigação = estado "Com o seu Claude" + campo editável + não sobrescrever o que a pessoa digitou.
8. Fatias: F0 SQL (P) · F1 tela lê receita + estimativa (M) · F2 MCP devolve receita (P) · F3 fila de escrita (G) · F4 botão Claude nas 8 telas (M) · F5 desligar gateway nos campos de vídeo (P) · F6 motor lê limites de texto da receita (P).
9. QUEBRADOs do motor corrigidos de graça: #5, #7, #11, #16 parcial, #18, #19, #20 parcial. Precisam de fix separado: #1, #2, #3, #4, #6, #8, #9, #10, #12, #13, #14, #15, #17, #21, `marca_ler` → `guardrails` (1 linha; incluir na F3) e `director-core` via llm.ts (maior dívida escondida, fora desta rodada).
10. Riscos principais: latência assíncrona num campo de formulário; cota da rotina por pedido; receita e constantes do código divergirem (mitigação: teste Deno que confere `tool_recipes` × constantes e check em `scripts/verificar-instancia.sql`).

## 0. Tese e o que confirmei antes de desenhar

- Hoje não existe "regra do modelo" legível: `video_models` tem `cost/limits/input_template/required_inputs/notes` (supabase/seed-instancia.sql:853-857), a tela lê `HUB_COLUMNS` sem `notes` (src/hooks/use-video-models.ts:255, 352), `MODEL_NOTES` é dicionário no front (src/lib/model-notes.ts:10-31), `PromptKind` tem 5 tipos por campo (supabase/functions/_shared/prompts/prompt-assist.ts:7).
- Única receita real: `RECEITA_DO_ROTEIRO` (supabase/functions/_shared/roteiro.ts:100-139), devolvida em `roteiro_pedidos` (mcp-server/index.ts:1413), validada por `conferirEntrega` (roteiro.ts:241-252) com `ROTEIRO_MAX=5000` fixo (roteiro.ts:16).
- Molde reaproveitável: `roteiro_pedidos` (drizzle/migrations/0019–0022: status, claim, conversa, aguardando_pessoa, andamento, RLS por dono, Realtime), edge `roteiro-pedido` (insert/cancelar/responder/acordar), `requestState` (claim 10 min, 3 tentativas, 24 h; _shared/video-edit-engine.ts:822-836), `conversa.ts`, `AndamentoDoRoteiro`/`ConversaClaude` (src/components/video/roteiro-brief.tsx:257-424), `GUIA_DO_CONECTOR` + `DEFINICOES` (_shared/mcp-guia.ts).
- QUEBRADO que o desenho precisa carregar: `roteiro_pedidos` não está em `supabase/seed-instancia.sql` nem em `supabase/sql/*.sql` (grep vazio); só em drizzle. `supabase/migrations/` não existe neste repo (AGENTS.md:61-63), então `scripts/gerar-seed-instancia.py` (lê `supabase/migrations`, linha 36) não roda aqui — a prática vigente é escrever `supabase/sql/<nome>.sql` idempotente e colar o mesmo bloco no seed com cabeçalho `-- <nome>.sql (data)` (seed:851, 1158, 1189, 1317, 1390).
- Experiências do hub (src/lib/video-hub.ts:207-478): scenes, presenter_in_scenes, avatar_script, idea_to_video, photo_presenter, digital_twin, reframe_upscale, change_speech, translate, restyle (style e scene), captions, person_swap.

Tese da Opção A: a regra de cada ferramenta vira DADO numa fonte só, lida por três consumidores (tela, mcp-server para o Claude da pessoa, validador do servidor). O código continua dono do que é execução (templates, builders, pipeline); a receita é dona do que é comunicação e contrato de texto.

## 1. Modelo de dados

### 1.1 Por que tabela própria e não `video_models.recipe`
- Higgsfield não está no catálogo (seed:868 só reserva o provider; motor hardcoded DA:122-134), lipsync HeyGen direto não tem linha, ElevenLabs não tem linha. Coluna em `video_models` deixaria 5 ferramentas do hub sem receita ou obrigaria linhas-fantasma.
- A mesma linha serve várias experiências (`heygen/avatar-iv` → avatar_script, photo_presenter, digital_twin; seed:1068) e a frase "o que faz" muda por experiência.
- `HUB_COLUMNS` tem fallback por coluna ausente (`missingColumn`, use-video-models.ts:259); tabela própria tem uma query, um fallback (tabela ausente ⇒ null).

### 1.2 DDL — `supabase/sql/tool-recipes.sql` (e o mesmo bloco no `seed-instancia.sql`)
```sql
-- tool-recipes.sql (2026-11-04) · receita por ferramenta do hub (experiência × modelo)
create table if not exists public.tool_recipes (
  experience text not null,                -- slug de video_models.experience[]
  model_key  text not null default '*',    -- '*' = regra da experiência; senão 'provider/model_id'
  recipe     jsonb not null,
  version    int  not null default 1,
  active     boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (experience, model_key)
);
alter table public.tool_recipes enable row level security;
drop policy if exists tool_recipes_read on public.tool_recipes;
create policy tool_recipes_read on public.tool_recipes for select to authenticated using (true);
grant select on table public.tool_recipes to authenticated;
revoke insert, update, delete on table public.tool_recipes from anon, authenticated;
-- Regras do AGENTS.md: (1) nenhuma função nova em public → nada a revogar; (2) a tela NÃO assina
-- esta tabela (staleTime 10 min) → não entra na publicação; (3) bloco colado no seed-instancia.sql.
insert into public.tool_recipes (experience, model_key, recipe) values (...) -- §4
on conflict (experience, model_key) do update set recipe = excluded.recipe, version = public.tool_recipes.version + 1, updated_at = now();
```

### 1.3 Schema do `recipe` (jsonb) — validado em `_shared/receitas.ts` com `lerReceita(bruto)`
```jsonc
{
  "faz": "Uma frase para leigo.",
  "nao_faz": "Uma frase para leigo.",
  "entrada": [                               // SÓ campos de texto/escolha que a receita governa
    { "id": "roteiro", "rotulo": "O que o avatar vai falar", "tipo": "texto_longo",
      "min": 20, "max": 5000, "unidade": "caracteres", "ajuda": "≈ 15 caracteres por segundo de fala",
      "placeholder": "...", "escrita": true }          // escrita:true = o botão do Claude escreve este campo
    // tipos: texto_curto | texto_longo | escolha {opcoes:[{id,rotulo}]} | numero {min,max,passo}
  ],
  "escrita": {                               // regra que o Claude recebe e a tela resume
    "campo": "roteiro",
    "forma": "fala" | "briefing" | "prompt_visual" | "instrucao" | "descricao",
    "idioma": "pt-BR" | "en",
    "tamanho": "Até 5.000 caracteres; cerca de 15 por segundo de fala.",
    "estrutura": "gancho → uma ideia → fecho com a chamada do repertório da marca",
    "inclua": ["..."], "evite": ["emoji", "hashtag", "travessão", "rubrica de cena"],
    "pausas": "pontuação nas pausas; número por extenso quando ambíguo",
    "exemplo": "...",
    "saida": { "type": "object", "properties": { "roteiro": { "type": "string" } }, "required": ["roteiro"] }
  },
  "limites_visiveis": ["Até 5.000 caracteres (≈ 5 min)", "Formato 9:16"],
  "custo": { "como": "por_segundo_de_fala" | "por_segundo_de_video" | "por_1k_chars" | "por_execucao" | "creditos" | "desconhecido",
             "nota": "Pela HeyGen; valor não confirmado.", "verificado": false },
  "estado": "pronto" | "em_breve"            // em_breve = a tela mostra a frase e não deixa pedir
}
```
Merge: `receitaDe(experience, modelKey)` = linha '*' com `faz/nao_faz/limites_visiveis/custo/estado/escrita.extra` substituídos pela linha do modelo quando existirem; `entrada[]` do modelo só pode apertar `max` e trocar `ajuda`. Mesma função no front (TS) e no Deno (copiada em `_shared/receitas.ts` e `src/lib/receitas.ts`; teste que compara as duas é a F0).

### 1.4 Onde o preço e o limite numérico continuam
`video_models.cost` e `limits` seguem sendo a verdade para dinheiro e mídia; a receita diz COMO estimar (`custo.como`) e a tela multiplica: fala → chars/15 × usd/s; vídeo → duração do upload × usd/s; 1k chars → chars/1000 × usd; créditos → "saldo N" (balance DA:1275-1282); desconhecido → "Sem estimativa para este modelo". Isso é o que faltava para as 6 rotas sem linha (01-eng-front §3.1).

### 1.5 Generalização de `roteiro_pedidos` — `supabase/sql/escrita-pedidos.sql` (+ seed)
```sql
-- escrita-pedidos.sql (2026-11-04) · pedido de escrita tipado pelo Claude da assinatura
-- 1. a tabela inteira (0019–0022) entra aqui porque o seed não a tem (instância nova nasce sem ela)
create table if not exists public.roteiro_pedidos (...);   -- cópia literal de 0019 + colunas de 0020/0021 + policy de 0022
-- 2. colunas da generalização
alter table public.roteiro_pedidos add column if not exists ferramenta text not null default 'avatar_script';
alter table public.roteiro_pedidos add column if not exists modelo text;                 -- model_key ou null
alter table public.roteiro_pedidos add column if not exists alvo text;                   -- campo da tela: 'roteiro', 'ideia', 'fala_nova', 'cenario', 'instrucao', 'briefing', 'scene:<id>'
alter table public.roteiro_pedidos add column if not exists entrada jsonb not null default '{}';  -- { texto, contexto:{avatar_id?, voice_id?, duracao_s?, formato?, idioma?, video_s?} }
alter table public.roteiro_pedidos add column if not exists saida jsonb;                 -- conforme escrita.saida da receita
-- 3. um pedido aberto por pessoa × ferramenta × campo
create unique index if not exists roteiro_pedidos_um_por_campo
  on public.roteiro_pedidos (created_by, ferramenta, coalesce(alvo, '')) where status = 'aberto';
-- 4. Realtime (regra 2): replica identity full + add table, como em 0019:52-62
```
`briefing` continua NOT NULL e recebe `entrada.texto` (compatibilidade com tela e MCP atuais). Nenhuma função nova em `public` → regra 1 não se aplica.

## 2. Contrato do pedido de escrita pelo conector

### 2.1 Dois tipos de pedido, uma tabela
- `roteiro` (profundo): avatar_script/photo_presenter/digital_twin quando a pessoa quer pesquisa + plano. Tools `roteiro_*` como hoje; muda só: a tela manda `modelo` e `ferramenta`, o servidor devolve `receita = RECEITA_DO_ROTEIRO + "\n\nFERRAMENTA E MODELO\n" + receitaEmTexto(receitaDe(ferramenta, modelo))` e `conferirEntrega(roteiro, plano, maxDoPedido)` troca `ROTEIRO_MAX` pelo `entrada.roteiro.max` da receita (OmniHuman: 220; P-Video: 2.700; HeyGen: 5.000).
- `escrita` (curto, um campo): idea_to_video (ideia), scenes/presenter_in_scenes (briefing 6 campos — substitui `video-brief`), change_speech (fala nova), restyle (frase de cenário/estilo), person_swap (instrução), avatar_prompt/avatar_look (descrição), voice_design (descrição de voz), scene_fix (corrigir cena, opcional). Tools novas.

### 2.2 Edge `roteiro-pedido` (estender; mesmo auth, rate-limit, acordar)
```
POST { ferramenta, modelo?, alvo, entrada:{ texto, contexto? }, profundo?: boolean, referencias? }
 → 200 { pedido_id, acordou }            // 409 ja_aberto { pedido_id } quando o índice único bate
POST { action:'cancelar'|'responder', ... }  // iguais aos de hoje
```
Validação no servidor com a receita: `ferramenta` ∈ experiências com receita; `entrada.texto` entre `min` e `max` do campo `escrita.campo`; `modelo` sem linha ⇒ usa '*'. Chamada antiga `{briefing, referencias}` continua válida (vira `ferramenta='avatar_script', profundo=true`). Acorda a rotina com `texto: 'Escrita <id>'`.

### 2.3 Tools MCP (mcp-server/index.ts, ao lado de `roteiro_*` :335-460 e handlers :1379-1495)
- `escrita_pedidos { reservar? }` → `[{ pedido_id, ferramenta, modelo, alvo, entrada, receita:{ faz, nao_faz, escrita, limites_visiveis }, schema: escrita.saida, conversa? }]`. Handler copia o de `roteiro_pedidos` (:1379-1417): pula `aguardando_pessoa`, `requestState` com `ESCRITA_MAX_HOURS = 2`, claim condicional por `claim->>at`, até 5 por chamada, filtro `ferramenta <> 'avatar_script' or profundo = false`. `roteiro_pedidos` passa a filtrar `profundo = true`.
- `escrita_entregar { pedido_id, saida }` → `conferirEscrita(receita, saida)` devolve `{ gravado:false, problemas:[...] }` ou grava `status='entregue', saida, andamento('entregue')`. Regras genéricas: chaves obrigatórias do schema; `max` por campo; forma `fala` ⇒ sem emoji/hashtag (regex de roteiro.ts:249-250); forma `prompt_visual` ⇒ `prompt_en` só ASCII/latino sem acento pt e ≤ max, `resumo_pt` obrigatório; `briefing` ⇒ `objetivo` ∈ enum, `numero_heroi` pode ser ""; gate de guardrails: reaproveitar a leitura de `guardrails` de editar-slide.ts:321-324.
- `escrita_mensagem { pedido_id, texto, aguardar_pessoa? }` = `roteiro_mensagem` (:1436-1452) sem mudança de lógica.
- `video_criar` sem aceite (prévia): acrescentar `receita: { faz, nao_faz, escrita, limites_visiveis }` da rota × modelo. `o_que_posso_fazer`: cada capacidade de vídeo ganha `receita_resumo: { faz, nao_faz }`.
- `marca_ler`: corrigir `brand_guardrails` → `guardrails` (assistant-tools.ts:16).

### 2.4 Lease, duplicados, prazos
- Lease: `requestState` (claim 10 min, 3 tentativas) sem mudança; trilha de 3 passos para pedidos curtos: enviado → pegou → entregue.
- Duplicado: índice único parcial (created_by, ferramenta, alvo) com status aberto. A edge devolve 409 com o `pedido_id` existente; a tela mostra esse pedido em vez de erro.
- Prazos: roteiro profundo 24 h (como hoje); escrita 2 h.

### 2.5 Linha a acrescentar na rotina trig_01P1DfnxhGaZ5phCWRKHP6hZ (pelo RemoteTrigger, Samuel)
"6. ESCRITA (escrita_pedidos → escrita_entregar). Cada pedido traz a ferramenta, o modelo, o que a pessoa escreveu e a receita com o schema de saída: escreva exatamente nesse formato, dentro do limite. Precisou da pessoa, pergunte em escrita_mensagem com aguardar_pessoa true e pare."
E no bloco 1: "o pedido traz o limite do modelo escolhido: respeite-o em vez dos 5.000". Mesmo texto entra em `GUIA_DO_CONECTOR` (mcp-guia.ts:5-24) e `DEFINICOES` ganha `{ id:'escrita', ... ferramentas:['escrita_pedidos','escrita_entregar','escrita_mensagem'] }`.

## 3. Como a tela consome

### 3.1 Hook único `useToolRecipe(experience, modelKey)` — `src/hooks/use-tool-recipe.ts`
- `useQuery(['tool-recipes', experience])` lê `tool_recipes` com `experience = X and model_key in ('*', modelKey) and active`, staleTime 10 min; erro de tabela ausente ⇒ `null`. Retorna `{ receita, estimar(texto, segundos, custoDaLinha) → { label, usd|null } }`. `modelKey` sai do `ResolvedChoice.choice` (`${provider}/${id}`; use-hub-models.ts:103-114).
- Fallback quando `receita === null`: a tela mostra o que mostra hoje. Nada quebra em instância sem SQL.

### 3.2 Onde a receita aparece (reuso de primitivos)
- Ladrilho do hub (`hub-route-tile.tsx:100-107`): `faz` da linha '*' substitui `line`.
- `ModelRail` (video-hub.tsx:242-302): sob o botão escolhido, `faz` + `nao_faz` do modelo e `limites_visiveis` como chips; motivo do padrão = `faz` da linha default (substitui `ENGINE_REASON` morto).
- Estúdios HeyGen (`GenerateBar`, heygen-studios.tsx:163-210): trocar por `GateEstimateLine` alimentado por `estimar()`; "Sem estimativa para este modelo" quando `custo.verificado=false`.
- Diretor (`GenerationGate`): `modelNote` passa a ler `receita.faz` com fallback em `MODEL_NOTES`.
- Remake: `REMAKE_OPTION_COPY.*.line` (remake-options.ts:33-50) vem da receita do modelo escolhido (resolve Kling × Aleph na cópia).

### 3.3 Campos gerados — até onde vale
Gerar só os campos `entrada[]` da receita com um `RecipeTextField` que embute `PromptField` + contador + `EscreverComClaude`. Tudo que é mídia/estado (AvatarPicker, LookStrip, voz, upload, consentimento, cenas/duração/resolução, legendas) continua fixo por estúdio.

### 3.4 Componente `EscreverComClaude` — `src/components/prompt/escrever-com-claude.tsx`
Props: `{ ferramenta, modelo, alvo, contexto, value, onChange, profundo?: boolean }`. Estados:
- sem conector: texto "O seu Claude escreve este campo pela sua assinatura" + botão "Conectar o Claude" → `openIntegration("claude_editor")` (modal, como polish-strip.tsx:168-172), não navega.
- pronto: botão "Escrever com o seu Claude" + legenda "Pela sua assinatura · sem custo extra".
- aberto: `AndamentoDoRoteiro` compacto (3 etapas), "há quanto tempo", Cancelar, `ConversaClaude`, frase "Pode sair desta tela; o sino avisa".
- entregue: `saida[escrita.campo]` entra no campo se a pessoa não digitou depois do pedido (padrão `usado` + localStorage de roteiro-brief.tsx:74-90); senão botão "Usar o texto do Claude".
Hook `useEscritaPedido(ferramenta, alvo)` = `useUltimoPedidoDeRoteiro` filtrando `ferramenta/alvo` + `usePedirRoteiro` com o body novo. `RoteiroBrief` vira caso `profundo=true` do mesmo componente e passa a ser montado também em photo_avatar e twin (hoje só avatar, heygen-studios.tsx:461).

### 3.5 `PromptTools` e `prompt-assist`
- `PromptTools` ganha prop opcional `claude?: { ferramenta, modelo, alvo, contexto }`. Com ela: "Melhorar prompt" some, entra `EscreverComClaude`; mic Scribe fica; legenda vira "Scribe v2 · Pela sua assinatura do Claude".
- Telas que passam `claude`: Diretor Tema (novo.tsx:450-458), ScriptField dos 3 estúdios (heygen-studios.tsx:466, 1016, 1150), Video Agent (:1208), Remake fala nova/cenário/instrução (remake-flow.tsx:773, 720, 752), scene-edit.tsx:152 e polish-strip.tsx:377 (opcional nesta rodada).
- "Montar o briefing" (novo.tsx:460-477): deixa de ser passo bloqueante. Campos aparecem de imediato; o botão vira "Pedir o briefing ao seu Claude" e, entregue, preenche os campos vazios. `step-create.tsx` do setup usa o mesmo.
- Servidor: `prompt-assist` recusa `kind ∈ {video, script, scene}` com 410 (mantém Scribe e kinds content/slide); `video-brief` passa a 410. `use-prompt-assist.ts` trata 410 como "sem botão".
- O que quebra e como cobrir: (a) segundos → minutos: estados acima + campo editável; (b) rotina desligada → `acordou=false` mostra "Pedido guardado; peça ao seu Claude 'atenda os pedidos abertos'" e, se `connectorState().live=false` há > 10 min, aviso; (c) Criar (kind content) continua no gateway — dívida assumida, fora desta rodada.

## 4. Conteúdo inicial das receitas (seed de `tool_recipes`)

### 4.1 Linhas '*' (regra da experiência)
- avatar_script · faz: "Um apresentador da biblioteca, da sua foto ou o seu clone fala o texto que você escreve, com a voz escolhida." · não faz: "Não inventa o roteiro nem gesticula por comando: fala o que está escrito, parado, olhando para a câmera." · entrada: roteiro texto_longo 20–5.000, ajuda "≈ 15 caracteres por segundo" · escrita: forma fala, pt-BR, frases curtas ditas para o ouvido, pontuação nas pausas, número por extenso quando ambíguo, sigla como se fala, sem emoji/hashtag/travessão/rubrica, estrutura gancho → uma ideia → fecho com CTA do repertório; saída {roteiro} (ou roteiro+plano no modo profundo) · limites: "Até 5.000 caracteres (≈ 5 min)", "Vertical 9:16" · custo por_segundo_de_fala, verificado false (HeyGen).
- photo_presenter · faz: "A foto do seu apresentador ganha boca, olhos e cabeça em movimento e fala o roteiro." · não faz: "Não anda nem troca de cenário: o fundo é o da foto." · entrada/escrita = avatar_script.
- digital_twin · faz: "Seu clone, feito do seu vídeo, fala qualquer roteiro novo com a sua voz." · não faz: "Não grava cena nova nem muda roupa; precisa do consentimento gravado antes do primeiro vídeo." · limites: "Vídeo de origem de 15 s a 10 min (ideal ~2 min), uma pessoa, sem música".
- idea_to_video · faz: "Você descreve a ideia; o Video Agent da HeyGen escreve, escolhe cenas e voz e aplica as cores e o logo da marca." · não faz: "Não fala um roteiro pronto palavra por palavra e não deixa revisar antes de renderizar." · entrada: ideia texto_longo 20–10.000 (heygen.ts:561) · escrita: forma briefing, pt-BR (idioma de saída NÃO VERIFICADO), estrutura: objetivo em 1 frase, para quem, duração desejada, 3–5 pontos na ordem, o que mostrar, CTA, o que evitar; tamanho ideal 400–1.200 caracteres · limites: "Vertical 9:16", "Renderiza em 5–10× a duração", "Até 20 arquivos de apoio" · custo desconhecido.
- scenes · faz: "Um roteirista monta cenas geradas por IA a partir do seu briefing, com narração na voz da marca, trilha e legendas." · não faz: "Não mostra o seu rosto (para isso, 'Vídeo comigo nas cenas') e não usa vídeo gravado." · entrada: tema ≤600; briefing: objetivo escolha {Educar, Vender, Gerar conversa, Viralizar}, publico ≤160, mensagem ≤240, numero_heroi ≤80, cta ≤120, tom ≤60 · escrita: forma briefing, saída {objetivo, publico, smp, numero_heroi, cta, tom} · limites: "3 a 8 cenas" · custo por_segundo_de_video (Replicate) ou creditos (Higgsfield).
- presenter_in_scenes · faz: "Mesmo vídeo de cenas, com o seu apresentador aparecendo nelas." · não faz: "No Replicate o rosto vem só do quadro inicial; a semelhança não é garantida em todas as cenas." · limites: "Exige apresentador com foto".
- change_speech · faz: "Troca o que a pessoa diz no vídeo: voz nova e boca sincronizada." · não faz: "Não muda imagem, gesto nem duração: a fala nova precisa caber no tempo do vídeo (±15 %)." · entrada: fala_nova 1–600, ajuda "≈ 15 caracteres por segundo de vídeo" · escrita: forma fala, pt-BR, mesma duração do original · limites: "Vídeo de 2 a 30 s" · custo: TTS por_1k_chars (unidade NÃO VERIFICADA) + lipsync por_segundo_de_video.
- translate · faz: "O mesmo vídeo em outro idioma, com a sua voz e a boca sincronizada." · não faz: "Não muda o conteúdo nem corta; só 5 idiomas de saída nesta tela." · sem escrita · custo desconhecido.
- restyle · faz: "Refaz o visual do seu vídeo (estilo, lugar, luz, roupa) mantendo fala, gesto e câmera." · não faz: "Não troca a pessoa." · entrada: cenario ≤200 · escrita: forma prompt_visual, idioma en, uma frase visual, sem história, sem negativa, termina "keep everything else identical" (remake.ts:226-229), saída {prompt_en, resumo_pt} · limites: "Vídeo de 2 a 30 s".
- person_swap · faz: "Coloca o seu apresentador no lugar da pessoa do vídeo, mantendo fala e movimento." · não faz: "Não muda cenário nem fala; usa 1 a 3 fotos do apresentador." · entrada: instrucao ≤500 · escrita: prompt_visual en curto, saída {prompt_en, resumo_pt}.
- captions · faz: "Legendas no estilo e na cor da marca, a partir da transcrição." · não faz: "Não refaz o vídeo nem a fala." · sem escrita · custo Scribe US$ 0,0000611/s (oficial) + montagem Higgsfield (créditos).
- reframe_upscale · faz: "Vídeo 16:9 vira 9:16 e ganha nitidez." · não faz: "Ainda não está no produto." · estado em_breve.

### 4.2 Linhas por modelo (só o que sobrescreve)
- replicate/bytedance/seedance-2.0 (scenes) · faz: "Cenas de 4 a 15 s com a duração exata da fala, até 4K." · não faz: "Não recebe as fotos do apresentador junto com o quadro." · limites: "4–15 s por cena", "720p US$ 0,18/s · 1080p 0,45/s (oficial)" · escrita.extra: o movimento vai em inglês, uma ação + um movimento de câmera.
- replicate/kwaivgi/kling-v4.0 (scenes, presenter_in_scenes) · faz: "Cenas contínuas de 3 a 30 s; aceita quadro e fotos do apresentador juntos." · não faz: "Hoje o motor não envia as fotos (correção separada)." · limites: "3–30 s", "720p 0,157 · 1080p 0,235 (oficial)".
- replicate/google/veo-3.1 (scenes) · faz: "Realismo alto, clipes de 4, 6 ou 8 s." · não faz: "Cobra o bloco inteiro: fala de 5 s paga 6; não aceita fotos de referência em 9:16." · limites: "Blocos de 4/6/8 s", "US$ 0,20/s sem áudio (oficial)".
- higgsfield/seedance_2_5 (scenes) · estado em_breve · custo creditos "≈ 70 créditos por 10 s em 720p (NÃO VERIFICADO)".
- higgsfield/cinematic_studio_3_0 (scenes, presenter_in_scenes; motor atual) · faz: "Mantém o mesmo rosto entre as cenas; 4 a 15 s por cena." · não faz: "Não tem preço em dólar: desconta créditos da sua conta Higgsfield." · custo creditos (saldo).
- higgsfield/cinematic_studio_video_4_0 (presenter_in_scenes) · estado em_breve.
- heygen/avatar-iv (avatar_script, photo_presenter, digital_twin) · faz: "Motor padrão: funciona com qualquer avatar da biblioteca, foto ou clone." · não faz: "Não aceita direção de movimento no clone." · custo "~US$ 0,05/s NÃO VERIFICADO".
- heygen/avatar-v (avatar_script, digital_twin) · faz: "Rosto e gesto mais fiéis; aceita direção de movimento." · não faz: "Só nos avatares que anunciam este motor; sem controle de expressividade." · custo "US$ 0,0667–0,12/s NÃO VERIFICADO".
- heygen/avatar-iii (digital_twin) · faz: "Clone em 4K." · não faz: "Sem direção de movimento; foto só em 1080p." · custo desconhecido.
- heygen/avatar-photo (photo_presenter, criar) · limites: "1 foto frontal, luz uniforme, cabeça inteira, 1 pessoa, até 50 MB" · custo "~US$ 1 por avatar NÃO VERIFICADO".
- heygen/avatar-digital-twin (digital_twin, criar) · limites: "15 s a 10 min, ideal ~2 min, sem música, até 200 MB; consentimento gravado pelo link".
- heygen/avatar-prompt + heygen/avatar-look · entrada: descricao ≤1.000 · escrita: forma descricao, en (NÃO VERIFICADO se aceita pt), aparência, roupa, cenário, luz, enquadramento, sem nome de pessoa real.
- heygen/video-agent (idea_to_video) · = linha '*'; custo desconhecido.
- replicate/prunaai/p-video-2-pro-avatar (photo_presenter) · faz: "A foto fala até 3 minutos; 1080p a US$ 0,06/s (oficial)." · não faz: "Não gera a voz e o corpo quase não se move." · entrada.roteiro.max 2.700.
- replicate/bytedance/omni-human-1.5 (photo_presenter) · faz: "Corpo e gestos a partir da foto; o mais expressivo." · não faz: "Fala curta: até 15 s no motor hoje (≈ 220 caracteres)." · entrada.roteiro.max 220 · custo "US$ 0,16/s (oficial)".
- replicate/runwayml/aleph-2 (restyle) · faz: "Estilo, cenário ou luz novos preservando fala, gesto e câmera; 2 a 30 s." · não faz: "Devolve sem o som original (o motor religa o áudio); arquivo abaixo de 16 MB." · custo "US$ 0,336/s".
- replicate/kwaivgi/kling-v4.0 (restyle) · faz: "Mesma edição por menos: 1080p US$ 0,141/s (oficial); aceita até 300 MB."
- replicate/prunaai/p-video-replace (person_swap) · faz: "Troca a pessoa com 1 a 3 fotos e mantém o áudio." · custo "720p 0,03 · 1080p 0,06 (oficial)".
- replicate/minimax/speech-2.8-hd + replicate/heygen/lipsync-precision (change_speech) · faz: "Voz pronta em português (feminina ou masculina) e boca sincronizada." · não faz: "Não clona a sua voz." · custo "US$ 0,10 por 1k tokens NÃO VERIFICADO" + "lipsync US$ 0,0667/s (oficial)".
- elevenlabs/eleven_v3 · faz: "A voz da marca ou um clone seu; até 5.000 caracteres por pedido." · não faz: "O produto não registra o custo: cobra no seu plano ElevenLabs."
- elevenlabs/scribe-v2 (captions) · custo "US$ 0,0000611/s ≈ 0,22/h (oficial)".
- replicate/luma/reframe-video (reframe_upscale) · estado em_breve.

## 5. Ordem de entrega (fatias finas)

F0 · SQL e receitas (P) — `supabase/sql/tool-recipes.sql` + `supabase/sql/escrita-pedidos.sql` + blocos no `seed-instancia.sql`; `_shared/receitas.ts` + `src/lib/receitas.ts` com teste Deno que valida todas as linhas do seed contra o schema e confere `entrada.max` × constantes. Aceite: `select count(*) from tool_recipes` = 12 '*' + ~24 modelos; `roteiro_pedidos` existe numa instância criada só pelo seed. Deploy Lovable 103e71ae: rodar os 2 SQL; sem edge; sem Publicar.

F1 · Tela lê a receita (M) — `useToolRecipe`; frases no ladrilho/ModelRail/Gate/Remake; `GateEstimateLine` nos estúdios HeyGen e Video Agent; chips de limite; `RecipeTextField` nos campos de texto existentes. Aceite: escolher Avatar V mostra faz/não faz; OmniHuman mostra "até 15 s" e contador ≤220; as 6 rotas sem estimativa mostram a linha; instância sem a tabela continua igual a hoje. Deploy: Publicar.

F2 · MCP devolve a receita (P) — `video_criar` prévia + `o_que_posso_fazer.receita_resumo`; `roteiro_pedidos` concatena a camada do modelo; `conferirEntrega` com max do pedido; `marca_ler` → `guardrails`. Deploy: `mcp-server`.

F3 · Fila de escrita (G) — edge `roteiro-pedido` estendida; tools `escrita_pedidos/entregar/mensagem`; `conferirEscrita`; guia + DEFINICOES; linha na rotina (Samuel). Aceite: pedido `idea_to_video` criado pela tela → rotina acorda → `escrita_entregar {ideia}` grava; segundo pedido no mesmo campo → 409; entrega com emoji em `fala` → `problemas`. Deploy: `roteiro-pedido`, `mcp-server`, texto da rotina.

F4 · Botão nas telas (M) — `EscreverComClaude` + `useEscritaPedido`; montar em Video Agent, photo_avatar e twin, Remake (3 campos), Diretor briefing, setup. Deploy: Publicar.

F5 · Desligar o gateway nos campos de vídeo (P) — `prompt-assist` 410 para video/script/scene; `video-brief` 410; legenda do `PromptTools`. Deploy: `prompt-assist`, `video-brief`, Publicar.

F6 · Motor lê limites de texto da receita (P) — `validateAvatarVideo`/`validateVideoAgent`/`validateRemake` recebem `max` de `receitaDe()` com fallback nas constantes. Deploy: `director-advance`, `avatar-studio`, Publicar.

Riscos: latência assíncrona; cota da rotina por pedido; receita × código divergirem; deploy remoto do `mcp-server` atrasado (F2/F3 dependem desse redeploy); idioma do Video Agent e dos v2v (confirmar com um teste pago cada).

NÃO fazer nesta rodada: formulário 100 % gerado; migrar `director-core.ts`/Reel/`sceneInEnglish` interno para o Claude; catálogo Higgsfield dinâmico; corrigir `reference_urls`, Fabric primário, 16 MB, tokens do MiniMax, Kling 3.0 mode (fixes separados); Criar/slide `prompt-assist` (fora do hub).

## 6. QUEBRADOs do relatório do motor × este desenho
Corrigidos de graça: #5, #7, #11, #16 parcial, #18, #19, #20 parcial. Do front: #1, #2, #3, #4, #8, #9, parte do #5.
Precisam de fix separado: #1 idioma do prompt no Reel; #2 `scene-actions.ts` morto; #3 `reference_urls` não enviado; #4 Kling 3.0 `mode:pro`; #6 Fabric primário; #8 16 MB do Aleph; #9 hub Kling × primário Aleph; #10 Wan 10 s × 30 s; #12 MiniMax tokens × chars; #13 voz hardcoded no Remake; #14 regra ±15 % no Replicate; #15 CS 3.0 `audio_references`; #17 `hfSpecFor` silencioso; #21 Aleph em bancos antigos; hub × setup (`step-create.tsx:367-374`); `director-core` via llm.ts.

### Arquivos críticos
- supabase/seed-instancia.sql (+ supabase/sql/tool-recipes.sql e escrita-pedidos.sql)
- supabase/functions/_shared/roteiro.ts (+ `_shared/receitas.ts` novo)
- supabase/functions/mcp-server/index.ts
- supabase/functions/roteiro-pedido/index.ts
- src/components/video/heygen-studios.tsx, roteiro-brief.tsx, src/components/prompt/prompt-tools.tsx
