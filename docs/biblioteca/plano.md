# Biblioteca em galeria

Pedido do Samuel (2026-10-30): a Biblioteca está em lista e não dá para ver o material. Vira
galeria de cards com a prévia real de cada peça.

## Divisão

Branch `biblioteca-galeria`, nunca o `main`. Quem integra e sobe é a `samuelfadanelli-bf`.

| Parte | Quem | Arquivos |
| --- | --- | --- |
| Galeria, card, filtros | bf | `src/components/biblioteca/piece-tile.tsx`, `piece-gallery.tsx`, `src/routes/_app/biblioteca/route.tsx`, `src/components/review-queue.tsx` |
| Prévia por formato | 62 | `src/components/biblioteca/piece-cover.tsx`, `src/lib/piece-cover.ts` e teste |
| Dados de teste, e2e e conferência visual | 50 | `e2e/biblioteca.spec.ts`, `e2e/fixtures/biblioteca.ts` |

Cada um mexe só nos seus arquivos.

## Contrato da prévia

`<PieceCover piece brand art active className />`, em `piece-cover.tsx`.

- Ocupa 100% do quadro do pai. O card fixa `aspect-[4/5]` para a grade alinhar.
- `brand` e `art` chegam prontos da galeria. A capa não busca marca.
- `active` é mouse ou foco: Reel toca mudo, carrossel passa os slides devagar.
- Nada pesa fora da tela: arte, URL assinada e vídeo só depois de aparecer.
- A escolha do renderer é a mesma do detalhe (`src/routes/_app/biblioteca/$pieceId.tsx`).

## Regras de produto

- A prévia é a peça de verdade, nunca texto de exemplo.
- Sem arte, a capa mostra o texto da peça no renderer do formato. Nunca quadro vazio.
- Falha ao carregar a imagem cai no mesmo texto, sem ícone quebrado e sem erro na tela.
- Sem novo acesso ao banco nem migration.
- Só tema claro, sem glow colorido, efeitos só do design system.
- Logo uma vez por componente.
