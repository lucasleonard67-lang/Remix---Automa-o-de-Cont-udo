import { IntegrationGrid } from "@/components/integration-grid";
import { ZernioAccountsList } from "@/components/zernio-integration";
import type { NetworksReadiness } from "@/components/setup/use-setup-readiness";

// ---------------------------------------------------------------------------
// Passo 2 · Redes — ladrilho do Zernio e, com a chave salva, a conta do
// Instagram onde as peças vão sair. Outras redes ficam para Config.
// ---------------------------------------------------------------------------

export interface StepNetworksProps {
  readiness: NetworksReadiness;
  /** Rota para onde o Zernio devolve o usuário depois do OAuth. */
}

export function StepNetworks({ readiness }: StepNetworksProps) {
  return (
    <div className="space-y-6">
      <IntegrationGrid ids={["zernio"]} className="sm:grid-cols-2 lg:grid-cols-2" />

      {readiness.zernioKey ? (
        <section className="space-y-3" aria-labelledby="setup-networks-accounts">
          <div className="flex items-baseline justify-between gap-3">
            <h3
              id="setup-networks-accounts"
              className="text-sm font-medium text-[var(--via-text-primary)]"
            >
              Conta do Instagram
            </h3>
            <span className="text-xs text-[var(--via-text-muted)]">
              Outras redes depois, nas Integrações
            </span>
          </div>
          {/* pré-requisito que mais trava a conexão: conta pessoal não publica pela API */}
          <p className="text-sm text-[var(--via-text-muted)]">
            A conta precisa ser profissional (Empresa ou Criador de conteúdo). Se for pessoal,
            troque no app do Instagram em Configurações › Tipo de conta e volte aqui.
          </p>
          <ZernioAccountsList platforms={["instagram"]} />
        </section>
      ) : (
        <p className="text-sm text-[var(--via-text-muted)]">
          Clique em Zernio e cole a chave. Em seguida você autoriza a conta do Instagram aqui.
        </p>
      )}
    </div>
  );
}
