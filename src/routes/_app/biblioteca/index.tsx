import { createFileRoute } from "@tanstack/react-router";

// ---------------------------------------------------------------------------
// Sem peça aberta, a lista É a página: o layout (route.tsx) desenha título,
// filtros e as linhas. Esta rota só existe para o segmento "/biblioteca/".
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_app/biblioteca/")({
  component: () => null,
});
