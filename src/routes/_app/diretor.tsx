import { createFileRoute, redirect } from "@tanstack/react-router";

// A área do agente-diretor virou /videos (biblioteca) + /videos/novo (geração).
// Esta rota fica só como redirect de links antigos.
export const Route = createFileRoute("/_app/diretor")({
  beforeLoad: () => {
    throw redirect({ to: "/videos" });
  },
});
