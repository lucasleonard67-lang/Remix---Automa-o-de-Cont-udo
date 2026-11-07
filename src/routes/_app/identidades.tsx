import { createFileRoute, redirect } from "@tanstack/react-router";

// O cadastro de avatares do Diretor virou o cadastro único de Apresentadores
// (/marca/avatares). Esta rota fica só como redirect de links antigos.
export const Route = createFileRoute("/_app/identidades")({
  beforeLoad: () => {
    throw redirect({ to: "/marca/avatares" });
  },
});
