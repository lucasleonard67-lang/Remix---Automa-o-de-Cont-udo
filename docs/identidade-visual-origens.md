# Identidade visual: de onde vem

Tela Marca → Identidade visual, bloco "De onde vem a sua identidade visual?".
Quatro origens, cada uma num modal; a proposta volta como rascunho e só
"Ativar versão" coloca em produção. Edge: `brand-kit-suggest`.

## Casos cobertos

| Origem | Entrada | O que é lido |
|---|---|---|
| Do seu site | URL pública | HTML da página: cores e fontes declaradas, texto |
| De um arquivo | .json, .css, .scss, .md, .txt, .svg, .js, .ts; logo .png/.jpg/.webp/.svg; **.zip** | Tokens e docs; do ZIP, os arquivos de design (tokens, tailwind, README, docs) e o primeiro `logo*.svg/png` |
| De um repositório | `github.com/dono/repo`, `…/tree/ramo/pasta`, `…/blob/ramo/arquivo`, site do design system ou `…/llms.txt` | Listagem do ramo e leitura de tokens, tailwind, tema/CSS global, README e docs de design (`_shared/brand-source-files.ts`) |
| Gerado pela IA | Três frases, provedor à escolha | Persona e bandeira salvas, mais o Contexto se marcado |

## Erros com saída no próprio modal

- Repositório privado ou inexistente: diz que não achou o repositório público e manda baixar o ZIP e enviar em "De um arquivo". Botão troca de origem sem fechar.
- Repositório sem arquivos de design: diz o que procurou e oferece "De um arquivo".
- Site que não responde: mostra o status e oferece "De um arquivo".
- ZIP sem texto legível: avisa antes de chamar a edge.
- Qualquer falha fica escrita no modal, abaixo do título, até a pessoa tentar de novo.

## Fora do escopo (ainda)

GitLab e Bitbucket, PDF, Figma por link. Repositório privado só pelo ZIP.
