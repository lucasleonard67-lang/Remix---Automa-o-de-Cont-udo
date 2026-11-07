# Fase de desenho — leitura obrigatória

Leia, nesta ordem: 00-briefing.md, 01-eng-front.md, 02-eng-motor.md, 03-eng-claude.md (mesma pasta).

## Síntese dos achados (os relatórios têm o detalhe com arquivo:linha)
- Não existe "regra do modelo" em lugar nenhum legível pela tela ou pelo Claude: `video_models` só tem campos/limites/custo; `notes` do seed ninguém lê; `model-notes.ts` é dicionário fixo no front sem cobrir os modelos "top"; `PromptKind` é por campo (5 tipos), não por modelo.
- Única receita de escrita real: RECEITA_DO_ROTEIRO (roteiro.ts) → só rota "avatar fala o roteiro", via conector (roteiro_pedidos). Foto, clone, Video Agent, Diretor (cenas/presenter), remake (fala nova, cenário, pessoa), reframe: texto da pessoa vai cru ou passa por `llm.ts` (gateway Gemini/OpenAI/xAI) = viola a regra 1.
- "Melhorar prompt"/"Montar briefing"/roteirista do Diretor/decupagem do Reel/sceneInEnglish do Remake → todos `_shared/llm.ts` (24 arquivos importam). Rodapé do PromptField anuncia "Gemini 2.5 Pro".
- Regra 2 (modelo + custo antes de Gerar) falha em 6 rotas; Higgsfield/HeyGen/ElevenLabs sem estimativa possível hoje.
- Hub promete modelo X e destino abre Y (style/scene, presenter, scenes); rosto do apresentador não é enviado às cenas Replicate; OmniHuman 34 s vs 15 s; Fabric ainda primário de talking_avatar.
- marca_ler lê tabela inexistente `brand_guardrails`; vozes/avatares sem appearance_prompt; nenhuma tool expõe regra por modelo.
- Caminho do conector é o molde reaproveitável: tabela `roteiro_pedidos`, edge `roteiro-pedido`, claim/lease, `conversa.ts` (aguardar_pessoa), trilha de etapas na tela, rotina trig_01P1Dfnx… já com 5 blocos por receita.

## Texto atual da rotina do Claude (trig_01P1DfnxhGaZ5phCWRKHP6hZ, modelo claude-sonnet-5-5, conector Content_Engine)
"Comece por o_que_posso_fazer e atenda tudo o que estiver aberto, nesta ordem. Cada pedido traz a própria receita: siga a receita. 1. ROTEIRO (roteiro_pedidos → roteiro_andamento → roteiro_entregar) 2. SLIDES (slide_pedidos → slide_entregar) 3. TEXTO (conteudo_pedidos → carrossel_criar) 4. ARTE (artes_pendentes → arte_enviar) 5. VÍDEO (video_pedidos → video_render → video_entregar)."
Um bloco 6 "ESCRITA" (ou a generalização do 1) é o encaixe natural.

## O que o dono quer ver no fim
Para cada ferramenta do hub (cada par experiência × modelo), quando a pessoa a escolhe: (a) uma frase do que ela faz e do que não faz; (b) só os campos que aquele modelo precisa, no formato que ele precisa; (c) um botão "Escrever com o seu Claude" que gera o texto certo (roteiro/prompt/briefing/instrução) com a marca; (d) modelo com padrão marcado + motivo e custo antes de Gerar. Leigo chega ao vídeo sem saber o que é Kling ou Avatar V.
