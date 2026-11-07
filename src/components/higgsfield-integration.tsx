import { ExternalLink, Loader2, RefreshCw, Unplug } from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { BrandIcon } from "@/components/brand-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useHiggsfieldConnect,
  useHiggsfieldDisconnect,
  useHiggsfieldStatus,
} from "@/hooks/use-higgsfield";
import { humanizeError } from "@/lib/humanize-error";

// ---------------------------------------------------------------------------
// Higgsfield — conta que gera keyframes, vídeos e avatares do Diretor.
// A autorização é OAuth (MCP oficial): o botão abre a tela do Higgsfield e a
// volta cai numa edge pública, que guarda os tokens no servidor.
// ---------------------------------------------------------------------------

export function HiggsfieldIntegrationCard() {
  const status = useHiggsfieldStatus();
  const connect = useHiggsfieldConnect();
  const disconnect = useHiggsfieldDisconnect();
  const [aguardando, setAguardando] = useState(false);

  const conectar = () => {
    // aba aberta no clique: depois do await o popup blocker mata window.open
    const aba = window.open("about:blank", "_blank");
    connect.mutate(undefined, {
      onSuccess: ({ authorize_url }) => {
        if (aba) aba.location.href = authorize_url;
        else window.open(authorize_url, "_blank", "noopener");
        setAguardando(true);
        toast.info("Autorize na aba que abriu", {
          description: "Depois, volte aqui e clique em “Já autorizei”.",
        });
      },
      onError: (error) => {
        aba?.close();
        toast.error("Não foi possível iniciar a conexão", { description: error.message });
      },
    });
  };

  const conferir = async () => {
    const { data } = await status.refetch();
    if (data?.connected) {
      setAguardando(false);
      toast.success("Higgsfield conectado");
    } else {
      toast.info("Ainda não conectado", {
        description:
          "Termine a autorização na aba do Higgsfield e clique em “Já autorizei” de novo.",
      });
    }
  };

  return (
    <Card data-testid="higgsfield-card">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <BrandIcon name="higgsfield" className="size-5" />
            Higgsfield
          </CardTitle>
          {status.isLoading ? (
            <Skeleton className="h-6 w-24 rounded-full" />
          ) : status.data?.connected ? (
            <Badge data-testid="higgsfield-status">Conectado</Badge>
          ) : (
            <Badge variant="outline" data-testid="higgsfield-status">
              Não conectado
            </Badge>
          )}
        </div>
        <CardDescription>
          Gera as imagens, os vídeos e os avatares da tela Vídeos. Você autoriza no site do
          Higgsfield, sem digitar chave aqui.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {status.isError ? (
          <Alert variant="destructive">
            <AlertDescription className="break-all">
              {status.error instanceof Error
                ? humanizeError(status.error.message)
                : "Não foi possível verificar a conexão. Recarregue a página."}
            </AlertDescription>
          </Alert>
        ) : null}

        {!status.isLoading && !status.data?.connected ? (
          <p className="text-sm text-muted-foreground">
            Sem essa conexão, a tela Vídeos não gera imagem nem vídeo. Clique em Conectar
            Higgsfield.
          </p>
        ) : null}

        {status.data?.connected ? (
          <p className="text-xs text-muted-foreground">
            {status.data.access_expired
              ? // Anunciar validade de uma data JÁ VENCIDA como se fosse futura
                // fazia o card mentir. Com refresh_token isso é normal: o
                // próximo uso renova — mas o texto tem que dizer isso.
                "Conexão ativa. O acesso se renova sozinho no próximo uso."
              : `Conexão ativa. O acesso se renova sozinho${
                  status.data.access_expires_at
                    ? ` · válido até ${new Date(status.data.access_expires_at).toLocaleString("pt-BR")}`
                    : ""
                }.`}
          </p>
        ) : null}

        {/* sem status ainda não dá pra saber a ação: mostrar "Conectar" para quem
            já está conectado pisca a ação errada */}
        {status.isLoading ? (
          <Skeleton className="h-9 w-44 rounded-md" />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {status.data?.connected ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={conectar}
                  disabled={connect.isPending}
                  data-testid="higgsfield-reconnect"
                >
                  {connect.isPending ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw aria-hidden="true" />
                  )}
                  Reconectar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Desconectar o Higgsfield? A tela Vídeos deixa de gerar imagens e vídeos.",
                      )
                    )
                      return;
                    disconnect.mutate(undefined, {
                      onSuccess: () => toast.success("Higgsfield desconectado"),
                      onError: (error) =>
                        toast.error("Não foi possível desconectar", {
                          description: error.message,
                        }),
                    });
                  }}
                  disabled={disconnect.isPending}
                >
                  <Unplug aria-hidden="true" /> Desconectar
                </Button>
              </>
            ) : (
              <Button
                onClick={conectar}
                disabled={connect.isPending}
                data-testid="higgsfield-connect"
              >
                {connect.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <ExternalLink aria-hidden="true" />
                )}
                Conectar Higgsfield
              </Button>
            )}
            {aguardando || status.data?.connected ? (
              <Button variant="ghost" size="sm" onClick={conferir} disabled={status.isFetching}>
                {status.isFetching ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw aria-hidden="true" />
                )}
                {status.data?.connected ? "Verificar conexão" : "Já autorizei"}
              </Button>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
