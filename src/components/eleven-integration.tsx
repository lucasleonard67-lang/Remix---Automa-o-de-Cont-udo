import { CheckCircle2, KeyRound, Mic } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "@/lib/toast";

import { Badge } from "@/components/ui/badge";
import { BrandIcon } from "@/components/brand-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useSecretStatus, useStoreSecret, type StorableSecretName } from "@/hooks/use-app-settings";

// ---------------------------------------------------------------------------
// Voz do Reel (ElevenLabs) — a narração que o Diretor sintetiza sai daqui.
//
// Até então estes dois eram os únicos valores de fornecedor que não tinham
// tela: entravam por `store_vault_secret` no SQL editor, e quando ninguém
// lembrava o Diretor morria em "ELEVEN_API_KEY ausente do Vault" no meio de uma
// produção. Toda API é do cliente e se configura no onboarding — esta também.
//
// O VOICE_ID não é segredo, é identificador. Mora no Vault mesmo assim para não
// abrir um segundo caminho de escrita só para ele, e por isso aparece em campo
// de texto normal, não mascarado.
// ---------------------------------------------------------------------------

const CAMPOS: Array<{
  nome: Extract<StorableSecretName, "ELEVEN_API_KEY" | "ELEVEN_VOICE_ID">;
  rotulo: string;
  ajuda: string;
  placeholder: string;
  segredo: boolean;
}> = [
  {
    nome: "ELEVEN_API_KEY",
    rotulo: "Chave de API",
    ajuda: "No painel da ElevenLabs, em Perfil → API Keys. Sem ela, os vídeos ficam sem narração.",
    placeholder: "sk_…",
    segredo: true,
  },
  {
    nome: "ELEVEN_VOICE_ID",
    rotulo: "ID da voz",
    ajuda:
      "ID da voz clonada ou escolhida na biblioteca da ElevenLabs. Em branco, a narração usa uma voz padrão em português.",
    placeholder: "yxcG28bYeAMra6K4nj10",
    segredo: false,
  },
];

export function ElevenIntegrationCard() {
  const secretStatus = useSecretStatus();

  return (
    <Card data-testid="eleven-card">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Mic className="size-4 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="flex items-center gap-2 text-base">
            <BrandIcon name="elevenlabs" className="size-5" />
            ElevenLabs — narração
          </CardTitle>
        </div>
        <CardDescription>
          Gera a narração dos vídeos da tela Vídeos. A chave fica guardada e não aparece de novo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {CAMPOS.map((campo) => (
          <CampoDoVault
            key={campo.nome}
            campo={campo}
            configurado={secretStatus.data?.includes(campo.nome) ?? false}
            carregando={secretStatus.isLoading}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function CampoDoVault({
  campo,
  configurado,
  carregando,
}: {
  campo: (typeof CAMPOS)[number];
  configurado: boolean;
  carregando: boolean;
}) {
  const storeSecret = useStoreSecret();
  const [valor, setValor] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const limpo = valor.trim();
    if (!limpo || storeSecret.isPending) return;
    storeSecret.mutate(
      { name: campo.nome, value: limpo },
      {
        onSuccess: () => {
          setValor("");
          toast.success(`Salvo: ${campo.rotulo}`);
        },
        onError: (error) => {
          toast.error(`Não foi possível salvar: ${campo.rotulo}`, { description: error.message });
        },
      },
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm font-medium text-foreground">{campo.rotulo}</span>
        <span className="font-mono text-xs text-muted-foreground">{campo.nome}</span>
        {carregando ? (
          <Skeleton className="h-5 w-24" />
        ) : configurado ? (
          <Badge
            data-testid={`eleven-status-${campo.nome}`}
            variant="outline"
            className="gap-1 border-[0.5px] border-[var(--via-border-soft)] bg-[var(--via-navy-04)] font-medium text-[var(--via-text-primary)]"
          >
            <CheckCircle2 className="size-3" aria-hidden="true" />
            configurado
          </Badge>
        ) : (
          <Badge
            data-testid={`eleven-status-${campo.nome}`}
            variant="outline"
            className="font-normal text-muted-foreground"
          >
            não configurado
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{campo.ajuda}</p>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          type={campo.segredo ? "password" : "text"}
          value={valor}
          onChange={(event) => setValor(event.target.value)}
          placeholder={campo.placeholder}
          autoComplete="off"
          aria-label={`Valor de ${campo.nome}`}
        />
        <Button type="submit" disabled={!valor.trim() || storeSecret.isPending}>
          {storeSecret.isPending ? "Salvando…" : configurado ? "Substituir" : "Salvar"}
        </Button>
      </form>
    </div>
  );
}
