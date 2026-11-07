# Briefing da squad — Hub de ferramentas de vídeo do Content Engine

Repo: /Users/samuelfadanelli/Developer/subido-redes-sociais (branch main, commit d63f465). Stack: TanStack Router + React + Tailwind + shadcn, Supabase Edge Functions (Deno), Lovable sync. Idioma do produto e dos docs: português do Brasil.

## O problema, nas palavras do dono (Samuel, 04/11/2026)
"Nos vídeos tem uma lógica quebrada: cada modelo de produção audiovisual tem seus modelos de IA, e cada um deles tem uma regra de como fazer o vídeo. Quero construir essa facilidade para cada um deles — por isso o conceito de hub de ferramentas. Cada ferramenta tem uma UI; quando o usuário decidir fazer algo (ex.: usar um avatar), já deixa claro o que aquele modelo faz e como ele deve responder (o que escrever, em que formato). Usar a integração com o Claude para ajudar a escrever com base na marca dele, para agilizar para leigos."

Em outras palavras: hoje a pessoa escolhe uma rota/modelo e recebe um campo de texto genérico; a regra de prompt/roteiro de cada modelo (Kling vs Seedance vs Veo vs HeyGen Avatar vs Video Agent vs Aleph vs lipsync…) fica implícita no código ou não existe. O produto tem que (1) explicar em uma frase o que a ferramenta/modelo faz, (2) pedir só o que aquele modelo precisa, no formato que ele precisa, (3) oferecer o Claude da pessoa para escrever esse conteúdo com a marca dela.

## Regras inegociáveis (memória do dono + AGENTS.md do repo)
1. **Claude só pelo conector** (assinatura da pessoa, MCP `mcp-server` + rotina do Claude Code). NUNCA API da Anthropic, nunca propor Gemini/"IA inclusa"/outro modelo como caminho de escrita. Onde o código ainda usa `_shared/llm.ts` (lovable-gateway/openai/xai) para escrever, isso é DÍVIDA, não opção. Caminho único: pedido na fila → rotina do Claude → entrega pelo conector (ex.: `roteiro_pedidos`/`roteiro_entregar`, `slide_pedidos`, `video_pedidos`).
2. **Toda geração mostra provedor + modelo para escolher (padrão já marcado, com motivo) e o custo potencial ANTES do botão Gerar** ("Estimativa: até US$ X"; sem preço → "Sem estimativa para este modelo", nunca sumir a linha).
3. **Zero esforço cognitivo**: a pessoa entende a tela sem ler explicação; nada de rótulo técnico; avançar mantém no fluxo; toda trava tem saída no próprio lugar.
4. **Design System SUBIDO**, interface mínima: um propósito, uma ação primária; sem card genérico; reusar primitivos existentes (`ChoiceTile`, `HubRouteTile`, `Button`, `GenerationGate`...).
5. **Content Engine é o shell**: o produto instrui; quem executa é o Claude da pessoa e os provedores dela (Replicate, Higgsfield, HeyGen, ElevenLabs). Nada de infra paga nossa.
6. **Tudo dentro do produto**: nunca mandar para Concat ou outro editor.
7. Samuel decide o desenho antes do código. Esta fase é de MAPEAMENTO e OPÇÕES; nenhum agente altera código do repo.

## Estado conhecido (ponto de partida, verificar)
- Hub: `src/lib/video-hub.ts` (HUB_HAVE × HUB_ROUTES: idea/photo/video → scenes, presenter, avatar, photo_avatar, twin, agent, speech, translate, style, scene, character, captions, reframe), tela `src/components/video/video-hub.tsx`, tile `hub-route-tile.tsx`, destino `src/routes/_app/videos/novo.tsx` (Diretor: scenes/presenter), estúdios HeyGen em `src/components/video/heygen-studios.tsx`, remake em `remake-flow.tsx`, roteiro pelo Claude em `roteiro-brief.tsx` + `conversa-claude.tsx`.
- Motores: Diretor (`director_jobs`, `supabase/functions/director-advance`), Remake (`_shared/remake.ts`), Reel (`generate-video`), avatar HeyGen (`_shared/avatar-video.ts`, `heygen.ts`, `avatar-studio`), Higgsfield via MCP (`hf-mcp.ts`), Replicate (`replicate.ts`, catálogo `video-catalog.ts` + tabela `video_models` em `supabase/seed-instancia.sql` / `supabase/sql/video-engine.sql`).
- Ajuda de escrita hoje: edge `prompt-assist` ("Melhorar prompt", kinds content/video/scene/script/slide em `_shared/prompts/prompt-assist.ts`) usa `_shared/llm.ts` → gateway/OpenAI/xAI (DÍVIDA, viola a regra 1). Roteiro de avatar já vai pelo Claude da pessoa (`roteiro-pedido` edge, `_shared/roteiro.ts` RECEITA_DO_ROTEIRO, tools `roteiro_*` no `mcp-server`, `_shared/claude-rotina.ts` acorda a rotina). Marca: tool `marca_ler` no mcp-server; frases por modelo em `src/lib/model-notes.ts`.
- Docs: `docs/hub-de-video-mapa.md` (mapa de 29/10), `docs/hub-full-plano.md`, `docs/hub-motor-contratos.md`, `docs/catalogo-heygen.md`, `docs/catalogo-replicate.md`, `docs/catalogo-higgsfield.md`, `docs/13-arquitetura-agentes-video.md`, `docs/12-direcao-de-cena.md`, `docs/pendencias.md`.

## Formato de saída de cada agente
Escreva o relatório em português, direto, com caminho `arquivo:linha` para cada afirmação sobre o código. Separe sempre: CONFIRMADO (li o código) · NÃO VERIFICADO (doc diz, código não confirma) · QUEBRADO (divergência entre tela, motor e provedor). Salve o relatório no caminho indicado no seu prompt e devolva um resumo de até 25 linhas.
