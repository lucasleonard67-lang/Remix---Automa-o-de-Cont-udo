# Content Engine · Automação de Redes Sociais

Fábrica de conteúdo com governança editorial para uma marca. A partir da marca cadastrada, o produto sugere pautas, cria posts, carrosséis, stories e vídeos com apresentador, passa tudo pela revisão humana e publica nas redes pelo Zernio. O Desempenho transforma as métricas em conclusões.

Na Central de Entrega da Viver de IA a solução se chama **Mega Automação de Redes Sociais 2.0**. Cada cliente tem a própria instância (Remix do Lovable, Supabase próprio).

O produto é o **shell**: ele instrui, e quem executa são os serviços da própria pessoa. O Claude da assinatura dela entra pelo **conector personalizado** (MCP), e HeyGen, ElevenLabs, Replicate, Higgsfield e Zernio entram com as chaves dela.

> **Para IAs e agentes:** leia o [`AGENTS.md`](AGENTS.md) antes de mexer no código. Ele tem o mapa da aplicação, os fluxos, as decisões de produto, as regras de segurança, banco e deploy, e as pendências conhecidas.

## Telas

| Tela | Rota | Para quê |
|---|---|---|
| Início | `/` | Resumo do dia: redes, produção, custos, ideias e primeiros passos. |
| Criar | `/criar` | Tema ou sugestão do Radar → peça na voz da marca (texto pelo Gemini incluso ou pelo Claude via conector personalizado). |
| Biblioteca | `/biblioteca` | Revisar, aprovar, editar slides, agendar e publicar. |
| Vídeos | `/videos`, `/videos/novo` | Hub de vídeo (cenas, apresentador, avatar) e edição do vídeo pronto. |
| Radar | `/radar` | Notícias das fontes com nota de marca e de tendência. |
| Desempenho | `/desempenho` | BI de conclusões: crescimento, mercado, formato, horário, constância. |
| Marca | `/marca`, `/contexto` | Persona, bandeira, regras, identidade visual, canais, apresentadores, vozes e acervo. |
| Ajuda | `/ajuda` | Como usar cada tela e o que fazer quando algo trava. |
| Ajustes | `/config` | Usuários, IA, Integrações (inclusive o conector do Claude), Automação e Instância. Só admin. |

## Stack

- **Front:** TanStack Start (React 19, TanStack Router, Vite 8), Tailwind v4, shadcn/radix, React Query, Design System SUBIDO (`src/design-system`).
- **Back:** Supabase (Postgres, Auth, Vault, Realtime, Storage) e Edge Functions em Deno (`supabase/functions`).
- **Conector do Claude (MCP):** `supabase/functions/mcp-server`.
- **Pacotes:** bun (`bun.lock` é o único lockfile).

## Rodar local

```sh
bun install
cp .env.example .env   # URL e chave pública do Supabase da instância
bun run dev -- --host 127.0.0.1 --port 8082
```

Abra `http://127.0.0.1:8082/login`. O primeiro cadastro de uma instância vira administrador; depois disso só entra quem for convidado em Ajustes › Usuários.

## Checagens

```sh
bun run lint
bun run test                                     # vitest
node node_modules/.bin/tsc --noEmit -p tsconfig.json
bunx deno test --allow-all supabase/functions    # testes das edge functions
bun run test:e2e                                 # playwright (banco real; ver e2e/README.md)
```

## Publicar

- **Frontend:** o push na `main` sincroniza com o Lovable; publique em Publish → Update.
- **Edge Functions:** o sync não faz deploy. Peça ao agente do Lovable o deploy só das funções afetadas e confira a versão.
- **Banco:** migrations em `drizzle/migrations/`, aplicadas pelo agente do Lovable; regenere `supabase/seed-instancia.sql` junto (`python3 scripts/gerar-seed-instancia.py`).

Nunca reescreva histórico já enviado: o Lovable perde o histórico do projeto.

## Instância nova (Remix)

O Remix clona só o schema. Tudo o que uma instância precisa além disso está em `supabase/seed-instancia.sql` (privilégios, Realtime, dados semeados, funções de auth) e no runbook `docs/15-runbook-remix.md`. Ordem: seed → chaves em Ajustes › Integrações → cron (`scripts/pos-remix.sql`) → conferência (`scripts/verificar-instancia.sql`).

## Onde ler mais

- [`AGENTS.md`](AGENTS.md): guia para quem mexe no código (pessoas e IAs).
- `docs/00-INDICE.md`: índice das specs do produto (visão, dados, rotas, IA, contratos, plano).
- `docs/18-lancamento-demo.md`: checklist de lançamento.
- `docs/design-system-subido.md`: decisões e exceções do Design System.
- `docs/hub-ferramentas/`: mapa e desenho do hub de vídeo.
- `supabase/functions/README.md`: o que cada Edge Function faz.
