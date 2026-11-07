import { splitCaptions, type StartAutopilotInput } from "@/hooks/use-brand-autopilot";

// ---------------------------------------------------------------------------
// Formulário do passo "Sua marca": valores, validação e conversão para a
// entrada do brand-autopilot. Sem componente — fica fora do fast refresh.
// ---------------------------------------------------------------------------

export interface BrandFormValues {
  site: string;
  instagram: string;
  captionsRaw: string;
  noInstagram: boolean;
  /** sem site: a marca é lida pelas legendas do Instagram */
  noSite: boolean;
}

export const EMPTY_BRAND_FORM: BrandFormValues = {
  site: "",
  instagram: "",
  captionsRaw: "",
  noInstagram: false,
  noSite: false,
};

/** O que falta para liberar "Ler minha marca" — `null` quando está tudo preenchido. */
export function brandFormMissing(values: BrandFormValues): string | null {
  const siteOk = values.noSite || (values.site.trim().length > 3 && values.site.includes("."));
  const instagramOk = values.noInstagram || values.instagram.replace(/^@/, "").trim().length > 0;
  if (values.noSite && values.noInstagram) {
    return "Sem site e sem Instagram não há o que ler. Informe um dos dois.";
  }
  if (!siteOk && !instagramOk) return "Falta o site e o @ do Instagram.";
  if (!siteOk) return "Falta o site.";
  if (!instagramOk) return "Falta o @ do Instagram.";
  return null;
}

export function brandFormToInput(values: BrandFormValues): StartAutopilotInput {
  return {
    site: values.noSite ? "" : values.site.trim(),
    instagram: values.noInstagram ? "" : values.instagram.trim(),
    captions: splitCaptions(values.captionsRaw),
  };
}

export function hostOf(site: string): string | null {
  try {
    return new URL(site.includes("://") ? site : `https://${site}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
