import { useSecretStatus } from "@/hooks/use-app-settings";
import { useHiggsfieldStatus } from "@/hooks/use-higgsfield";
import { useZernioAccounts } from "@/hooks/use-zernio";

// ---------------------------------------------------------------------------
// O que cada passo do fluxo de configuração cobra, lido do estado real da
// conta (chaves salvas, contas do Zernio, Higgsfield autorizado).
// ---------------------------------------------------------------------------

export interface NetworksReadiness {
  loading: boolean;
  /** Chave do Zernio salva. */
  zernioKey: boolean;
  /** Pelo menos uma conta Instagram autorizada no Zernio. */
  instagram: boolean;
}

export function useNetworksReadiness(): NetworksReadiness {
  const secrets = useSecretStatus();
  const zernioKey = secrets.data?.includes("ZERNIO_API_KEY") ?? false;
  const accounts = useZernioAccounts(zernioKey);
  const instagram = (accounts.data ?? []).some((account) => account.platform === "instagram");
  return {
    loading: secrets.isLoading || (zernioKey && accounts.isLoading),
    zernioKey,
    instagram,
  };
}

export interface MediaReadiness {
  loading: boolean;
  /** Algum motor de vídeo/voz ligado (Higgsfield, ElevenLabs ou Replicate). */
  any: boolean;
}

export function useMediaReadiness(): MediaReadiness {
  const secrets = useSecretStatus();
  const higgsfield = useHiggsfieldStatus();
  const any =
    Boolean(higgsfield.data?.connected) ||
    (secrets.data?.includes("ELEVEN_API_KEY") ?? false) ||
    (secrets.data?.includes("REPLICATE_API_TOKEN") ?? false);
  return { loading: secrets.isLoading || higgsfield.isLoading, any };
}
