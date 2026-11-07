import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";

import { validateCreateSearch } from "@/components/criar/create-search";
import { Creator } from "@/components/criar/creator";
import { RecentPieces } from "@/components/criar/recent-pieces";
import { Reveal } from "@/components/dashboard/motion";
import { fetchIsAdmin } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Criar conteúdo: a área própria das peças estáticas (carrossel, post,
// stories, X, Threads, LinkedIn, Facebook). Sugestões para hoje (a melhor já
// escolhida, formato e canal marcados) → Gerar; o tema escrito é opcional e
// os ladrilhos de formato, com a amostra no design system da marca, ajustam.
// A geração acontece aqui mesmo (CreationStage). Vídeo e Reel moram em Vídeos:
// link antigo de vídeo segue para /videos/novo com o tema; quem não é admin
// (Vídeos é só de admin) fica aqui, com o tema no campo. Mesma gramática de URL
// da home: ?radar= / ?brief=&kind= / ?channel=.
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_app/criar/")({
  validateSearch: validateCreateSearch,
  beforeLoad: async ({ search }) => {
    if (!search.video) return;
    const { video: _video, ...rest } = search;
    if (await fetchIsAdmin()) {
      throw redirect({
        to: "/videos/novo",
        search: rest.brief ? { brief: rest.brief } : {},
        replace: true,
      });
    }
    throw redirect({ to: "/criar", search: rest, replace: true });
  },
  component: CreatePage,
});

function CreatePage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  // Limpar a URL não rola a página; `only: "brief"` preserva ?kind/?channel.
  const clearSearch = (only?: "brief") =>
    void navigate({
      to: "/criar",
      search: only === "brief" ? ({ brief: _brief, ...rest }) => rest : {},
      replace: true,
      resetScroll: false,
    });

  return (
    <div className="mx-auto max-w-5xl space-y-12">
      <Creator
        revealIndex={0}
        search={search}
        onClearSearch={clearSearch}
        title="Criar conteúdo"
        subtitle="Escolha uma sugestão e gere."
        picker="tiles"
      />
      <Reveal index={4}>
        <RecentPieces />
      </Reveal>
    </div>
  );
}
