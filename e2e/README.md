# Testes end-to-end (Playwright)

Rodam contra o app REAL (banco de dev), pela perspectiva do usuário: navegam,
clicam, preenchem formulário, abrem modal e conferem o que aparece na tela.

## Rodar

```bash
cp e2e/.env.example e2e/.env    # credenciais do admin de teste (git-ignored)
npm run test:e2e                # headless, sobe o dev server sozinho
npm run test:e2e:ui             # modo interativo pra depurar
```

O `webServer` do `playwright.config.ts` reaproveita um `npm run dev` já rodando;
se não houver, ele sobe um. A sessão é autenticada uma vez em `global.setup.ts`
e reusada por todos os specs (`e2e/.auth/session.json`).

## Regra da casa: não gastar dinheiro nem sujar dado

Os specs param na **validação**. Nada aqui gera vídeo, cria peça, convida
usuário, ingere contexto ou publica — tudo isso dispara pipeline pago ou muda
dado de produção. Onde o fluxo seguiria para uma ação cara, o teste confirma o
estado (botão habilitado/desabilitado, mensagem correta) e para.

## O que cada spec cobre

| Spec | Cobre |
|---|---|
| `auth.spec.ts` | Sem sessão vai pro login preservando o destino; senha errada; login devolve ao deep link |
| `nav.spec.ts` | As 10 rotas renderizam sem erro de console; `/diretor` redireciona; navegação pela sidebar |
| `videos.spec.ts` | Biblioteca → geração dedicada; briefing/avatar/config; seleção de avatar; portão de geração (tiles de motor à vista, Recomendado marcado, estimativa, `engine`/`model_id`/`ab_model_id` no payload; catálogo e conexões vêm de fixture); validação; cancelar |
| `identidades.spec.ts` | Estúdio de Avatares: formulário e validações |
| `contexto.spec.ts` | Filtros por tipo, busca, drawer de cadastro com validação, abrir detalhe |
| `biblioteca.spec.ts` | Abas de status, lista/calendário, busca sem resultado, modal de rejeição |
| `marca-config-criar.spec.ts` | Hub da marca → 6 subpáginas; abas de config; convite; form de Criar |
| `dashboard-onboarding.spec.ts` | Atalhos do dashboard; trilha do wizard; sair do wizard |
| `design-system.spec.ts` | Design system Viver de IA medido no navegador (tokens, Geist, pílula navy, pill 11px, vidro com blur, paleta restrita, marca no shell) |

## Ao adicionar tela nova

1. Um caso em `nav.spec.ts` (renderiza sem erro de console).
2. Um caso de interação no spec da área (o que o usuário faz ali).
3. Se a tela introduzir padrão visual novo, um assert em `design-system.spec.ts`.
