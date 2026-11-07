import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import { BrandIcon } from "@/components/brand-icon";
import { PageEyebrow } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { approveConnector, redirectHost, useConnectorRequest } from "@/hooks/use-mcp-tokens";
import { toast } from "@/lib/toast";

// ---------------------------------------------------------------------------
// Tela de autorização do conector: o Claude abre aqui, a pessoa vê quem pede o
// quê e autoriza. O código só volta para o endereço registrado pelo cliente.
// ---------------------------------------------------------------------------

interface AuthorizeSearch {
  client_id?: string;
  redirect_uri?: string;
  state?: string;
  code_challenge?: string;
}

const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);

export const Route = createFileRoute("/_app/autorizar-claude")({
  validateSearch: (search: Record<string, unknown>): AuthorizeSearch => ({
    client_id: text(search.client_id),
    redirect_uri: text(search.redirect_uri),
    state: text(search.state),
    code_challenge: text(search.code_challenge),
  }),
  component: AuthorizeClaudePage,
});

const CAN = ["Ler a marca e o acervo", "Criar peças como rascunho", "Editar vídeos em nova versão"];

function AuthorizeClaudePage() {
  const search = Route.useSearch();
  const { isAdmin } = useIsAdmin();
  const [pending, setPending] = useState(false);
  const confirmed = useConnectorRequest(search);
  // os botões dependem da confirmação do servidor; dentro de um quadro, nada aparece
  const valid = confirmed.data === true && window.top === window.self;

  const authorize = async () => {
    setPending(true);
    try {
      window.location.assign(await approveConnector(search));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não deu para autorizar.");
      setPending(false);
    }
  };

  const deny = () => {
    if (!valid || !search.redirect_uri) return;
    const back = new URL(search.redirect_uri);
    back.searchParams.set("error", "access_denied");
    if (search.state) back.searchParams.set("state", search.state);
    window.location.assign(back.toString());
  };

  return (
    <div className="mx-auto max-w-md space-y-6 py-10">
      <span className="inline-flex size-16 items-center justify-center rounded-[var(--via-radius-md)] bg-[var(--via-navy-04)]">
        <BrandIcon name="claude" label="Claude" className="size-9" />
      </span>

      <div>
        <PageEyebrow />
        <h1 className="text-3xl font-medium tracking-[-0.025em] text-[var(--via-text-primary)]">
          Autorizar Claude
        </h1>
        <p className="mt-1 text-sm text-[var(--via-text-muted)]">
          Ele vai usar a Automação de Redes Sociais pela sua conta do Claude.
        </p>
      </div>

      {!isAdmin ? (
        <p className="text-sm text-[var(--via-text-body)]">
          Só um administrador pode autorizar. Entre com a conta de administrador.
        </p>
      ) : confirmed.isLoading ? (
        <Loader2
          className="size-5 animate-spin text-[var(--via-text-muted)]"
          aria-label="Conferindo"
        />
      ) : !valid ? (
        <p className="text-sm text-[var(--via-text-body)]">
          Este pedido não é válido. Comece de novo pelo Claude.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-[var(--via-border-soft)] border-y border-[var(--via-border-soft)]">
            {CAN.map((item) => (
              <li key={item} className="py-2.5 text-sm text-[var(--via-text-primary)]">
                {item}
              </li>
            ))}
          </ul>
          <p className="text-xs text-[var(--via-text-muted)]">
            Aprovar e publicar continuam só por aqui. Volta para {redirectHost(search.redirect_uri)}
            .
          </p>
          <div className="flex flex-wrap gap-2">
            <Button className="rounded-full" onClick={() => void authorize()} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Autorizar
            </Button>
            <Button variant="ghost" className="rounded-full" onClick={deny} disabled={pending}>
              Cancelar
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
