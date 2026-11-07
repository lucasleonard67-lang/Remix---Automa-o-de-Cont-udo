import { useMemo } from "react";

import type { TweetCardBrand } from "@/components/tweet-card-render";
import { useAppSetting } from "@/hooks/use-app-settings";
import { useSignedUrl } from "@/hooks/use-storage";
import {
  normalizeBrandKitContent,
  normalizePersonaContent,
  useActiveVersion,
} from "@/hooks/use-versioned-brand";
import { useZernioAccounts } from "@/hooks/use-zernio";

/**
 * Tokens visuais da marca para o `TweetCardRender`: brand kit ativo (paleta,
 * tipografia, logo via signed URL) + nome vindo da persona ativa, com fallback
 * no `brand_name` do onboarding. Usado na Biblioteca e no gate de tom.
 */
export function useTweetCardBrand(): TweetCardBrand {
  const brandKitRow = useActiveVersion("brand_kit");
  const personaRow = useActiveVersion("brand_persona");
  const onboarding = useAppSetting<{ brand_name?: string }>("onboarding");

  const kit = useMemo(
    () => normalizeBrandKitContent(brandKitRow.data?.content ?? null),
    [brandKitRow.data],
  );
  const personaName = useMemo(
    () => normalizePersonaContent(personaRow.data?.content ?? null).identity.name,
    [personaRow.data],
  );
  const logoUrl = useSignedUrl("brand-assets", kit.logo_path);
  const accounts = useZernioAccounts();
  const handle = accounts.data
    ?.find((account) => account.platform === "instagram" && account.username)
    ?.username?.replace(/^@/, "");

  return {
    name: personaName || onboarding.data?.brand_name || "Sua marca",
    handle: handle ?? null,
    logoUrl: logoUrl.data ?? null,
    palette: kit.palette,
    typography: kit.typography,
  };
}
