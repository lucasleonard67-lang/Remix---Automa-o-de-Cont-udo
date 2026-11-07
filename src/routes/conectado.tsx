import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AuthShell } from "@/components/auth/auth-shell";
import { BrandIcon } from "@/components/brand-icon";
import { announceDriveReturn, DRIVE_OUTCOME } from "@/lib/drive-return";
import { channelBrand } from "@/lib/brands";
import { announceZernioConnected } from "@/lib/zernio-return";

// ---------------------------------------------------------------------------
// Aba de volta da autorização do Zernio. Não é uma página para usar: avisa a
// aba do app que a conta entrou (o fluxo atualiza sozinho e segue no mesmo
// passo) e se fecha. Se o navegador não deixar fechar, mostra só o resultado e
// a saída de volta.
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/conectado")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { connected?: string; username?: string; drive?: string } => ({
    ...(typeof search.drive === "string" ? { drive: search.drive } : {}),
    ...(typeof search.connected === "string" ? { connected: search.connected } : {}),
    ...(typeof search.username === "string" ? { username: search.username } : {}),
  }),
  component: ConectadoPage,
});

const LABELS: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  threads: "Threads",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  twitter: "X",
};

function ConectadoPage() {
  const { connected, username, drive } = Route.useSearch();
  const driveOk = drive === "conectado";
  const [closing, setClosing] = useState(Boolean(connected) || Boolean(drive));
  const rede = driveOk ? "Google Drive" : connected ? (LABELS[connected] ?? connected) : null;
  const marca = driveOk
    ? "google_drive"
    : connected
      ? channelBrand(connected === "twitter" ? "x_" : connected)
      : undefined;

  useEffect(() => {
    if (!connected && !drive) return;
    if (drive) announceDriveReturn(drive);
    else announceZernioConnected({ platform: connected!, username: username ?? null });
    // a aba foi aberta pelo app (window.open), então o navegador deixa fechar
    const timer = window.setTimeout(() => {
      window.close();
      setClosing(false);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [connected, username, drive]);

  // Tela fora do app: a moldura de acesso do kit (AuthShell), como o login.
  return (
    <AuthShell
      eyebrow={rede ? "Conexão" : "Conexão não concluída"}
      title={
        rede ? (
          <>
            {marca ? (
              <BrandIcon name={marca} className="mr-3 inline-block size-9 align-[-0.12em]" />
            ) : null}
            {rede} conectado.
          </>
        ) : (
          "A conexão não foi concluída."
        )
      }
      lead={
        rede
          ? closing
            ? `${username ? `@${username} entrou. ` : ""}Voltando para a Automação de Redes Sociais…`
            : `${username ? `@${username} entrou. ` : ""}Pode fechar esta aba: a outra já foi atualizada e o fluxo continua de onde você parou.`
          : drive && DRIVE_OUTCOME[drive]
            ? DRIVE_OUTCOME[drive]
            : "Feche esta aba e clique de novo em Conectar na tela anterior."
      }
    >
      <div role="status" aria-live="polite">
        {!closing ? (
          <Link to="/" className="lsf-btn">
            Voltar à Automação de Redes Sociais
          </Link>
        ) : null}
      </div>
    </AuthShell>
  );
}
