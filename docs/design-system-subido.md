# Design System SUBIDO no Content Engine

Base: pacote `design-system-subido` do Diego Malta (kit de 28/10/2026) mais as duas correções publicadas por ele em 30/10.
A referência continua sendo o My Dashboard. Aqui ficam só as decisões deste produto.

## O que vale aqui

- Canvas `--via-gray-50`, card branco plano, hairline navy a 5%, sem vidro nem sombra de card.
- Navy `#0A1F3B` é a única cor da interface. O azul existe só no "AI" do logo.
- Sidebar branca de 264px, grupos em eyebrow, item ativo em pílula navy. O grupo é o eyebrow da tela (`sectionGroup`).
- Sem barra de topo no desktop: `--via-app-header` vale 0 a partir de 768px. O sino foi para o rodapé da sidebar.
- Conteúdo em `max-w-6xl`, com 40px de respiro no desktop.
- Geist em toda a interface. Anton fica só na arte do carrossel.
- Texto mínimo de 13px: `--text-xs` vale 13px no tema; o `revenue.css` do kit garante 13px no `<main>`.

## Decisão de 04/11: kit inteiro

Em 04/11/2026 o Samuel decidiu que o Content Engine usa o **kit inteiro** da skill
`design-system-subido`, igual ao My Dashboard, inclusive onde este documento registrava desvio por
escolha. Aplicado no sistema todo na branch `ds-desempenho`.

### O que entrou do kit

| Kit | Onde ficou | Efeito |
|---|---|---|
| `revenue.css` e `subido.css` | `src/design-system/ds/`, importados sem layer em `styles.css` | Uma ação navy por tela (outline e secondary viram texto), card plano, KPI North Star, texto pequeno do `<main>` em 13px |
| `auth.css` + `AuthShell` | `src/design-system/ds/auth.css`, `src/components/auth/auth-shell.tsx` | Login, redefinir senha e a volta da conexão na moldura de acesso do kit; o palco navy guarda o `EnginePulse` |
| Logo vetorial (`subido-logo`) | `src/components/brand/` | Sidebar e telas de acesso com o logo animado do kit |
| `Metricas` (`Kpi`, `KpiRow`) | `src/components/patterns/Metricas.tsx` | Indicadores do Início e do Desempenho |
| `Configuracoes` (`SettingsLayout`) | `src/components/patterns/Configuracoes.tsx` + `components/settings/ajustes-layout.tsx` | Ajustes e Automação num menu lateral; a sidebar não repete as seções |
| Classes-gancho dos componentes | `components/ui/*` | `ds-btn`, `ds-card`, `ds-pill`, `ds-field`, `ds-float`, `ds-menu`, `ds-modal`, `ds-sheet`, `ds-overlay`, `ds-tabs-*`, `ds-table`, `ds-switch`, `ds-tooltip` |
| Selo minúsculo do kit | `components/ui/badge.tsx` | Pill 11px lowercase; padrão navy 6% + texto navy |
| Campos do kit | `input`, `textarea`, `select` | 36px, raio 14px, borda navy 16%, fundo superfície |
| Assistente de configuração | `components/setup/setup-panel.tsx` | Janela com painel navy, passos na vertical, "Sua conta X% pronta" acima de zero e "Deixar para depois" |

### Tokens que mudaram

- `--via-glass-shadow` e `--via-glass-shadow-lift` valem `none`: card sem sombra de elevação.
- `--via-success` vale navy: "deu certo" é navy + texto, nunca verde.
- `--via-navy-deep` `#02162A` e `--via-navy-darker` `#010B1A`: os valores do kit. O quase preto anterior fazia o gradiente dos botões terminar em preto.
- `.via-tile--atmos` sem a mancha radial; `.via-tile--lift` só muda a borda no hover.

### Ajustes locais sobre o kit (em `styles.css`)

- Botão desabilitado sem sombra: a sombra do primário vem sem layer e venceria o `disabled:shadow-none`.
- Texto pequeno com `leading-*` mantém a entrelinha do componente: a regra de 13px do `revenue.css`
  cortava a segunda linha em blocos de altura fixa.
- Botão outline com `aria-pressed` continua chip (opção, não ação), com fio navy no selecionado.

## Exceções que ficam (decisão do Samuel, gravada antes do kit)

| Kit | Aqui | Motivo |
|---|---|---|
| Sombra de 6px na pílula ativa da sidebar | Sem sombra | Regra do Samuel: seleção sem brilho, fio fino + tint leve |
| Foco com halo de 3px | Fio neutro de 2px com folga (`--via-shadow-focus`) | Mesma regra |
| Tema escuro | Só tema claro | Regra do Samuel para os produtos SUBIDO |
| Logo em toda menção a ferramenta | Logo uma vez por componente, no elemento principal | Regra do Samuel: sem repetir marca em rótulo, descrição ou passo pequeno de fluxo guiado |
| Sidebar sem subitens | Marca mantém subitens | Contexto, Canais, Apresentadores e Vozes são rotas próprias |
| Primeiro acesso com "pular" | Guarda do onboarding obriga a configuração mínima | Regra de negócio do produto; não mexida |
| `--via-coral` `#B85C5C` | `#B45757` | Texto branco sobre o coral do kit dá 4,45:1; o nosso dá 4,73:1 (AA) |
| `--accent: var(--via-blue)` | `--accent` cinza | Causa do bug de hover corrigido pelo Diego em 30/10 |

## Exceções medidas

- Prévias de formato e arte têm texto menor que 13px porque simulam a peça.
- Contadores, números de passo em círculo, selos e chips de filtro usam 10px ou 11px (o próprio `revenue.css` põe chip em 11px).
- A home tem saudação no lugar do eyebrow de grupo.

## Como auditar

Rode `scripts/auditar-ds.js` do pacote em cada rota. A meta é 0 graves, com e sem dado, mais o checklist manual de `references/07-auditoria.md`.
