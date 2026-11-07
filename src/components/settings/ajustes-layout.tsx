import { useNavigate } from "@tanstack/react-router";
import { Cpu, Plug, Server, Users, Zap } from "lucide-react";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { SettingsLayout, type Secao } from "@/components/patterns/Configuracoes";

// ---------------------------------------------------------------------------
// Ajustes no padrão do kit (SettingsLayout): o menu das seções fica ao lado do
// conteúdo, nunca em abas no topo. Automação é uma rota própria, mas mora no
// mesmo menu — quem abre Ajustes vê tudo o que se configura num lugar só.
// ---------------------------------------------------------------------------

export type AjustesSecao = "usuarios" | "ia" | "integracoes" | "automacao" | "instancia";

const SECOES: Secao<AjustesSecao>[] = [
  { id: "usuarios", label: "Usuários", hint: "Quem tem acesso e o papel de cada um.", icon: Users },
  { id: "ia", label: "IA", hint: "Quem faz cada etapa e as suas chaves.", icon: Cpu },
  {
    id: "integracoes",
    label: "Integrações",
    hint: "Redes, vídeo, voz e o conector do Claude.",
    icon: Plug,
  },
  {
    id: "automacao",
    label: "Automação",
    hint: "Gatilhos que geram peças todo dia para você revisar.",
    icon: Zap,
  },
  {
    id: "instancia",
    label: "Instância",
    hint: "Dados desta instalação e a demonstração.",
    icon: Server,
  },
];

export function AjustesLayout({ ativa, children }: { ativa: AjustesSecao; children: ReactNode }) {
  const navigate = useNavigate();
  const trocar = (id: AjustesSecao) =>
    id === "automacao"
      ? void navigate({ to: "/automacao" })
      : void navigate({ to: "/config", search: { aba: id } });

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title="Ajustes"
        description="Convide pessoas, escolha os modelos de IA e conecte as integrações."
      />
      <SettingsLayout secoes={SECOES} ativa={ativa} onTrocar={trocar}>
        {children}
      </SettingsLayout>
    </div>
  );
}
