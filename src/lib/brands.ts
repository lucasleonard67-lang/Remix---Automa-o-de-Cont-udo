// Marcas das integrações (ícones em components/brand-icon.tsx).

export type BrandName =
  | "instagram"
  | "tiktok"
  | "x"
  | "threads"
  | "facebook"
  | "linkedin"
  | "elevenlabs"
  | "heygen"
  | "replicate"
  | "modal"
  | "zernio"
  | "higgsfield"
  | "google_drive"
  | "lovable"
  | "gemini"
  | "anthropic"
  | "claude"
  | "openai"
  | "xai"
  | "tavily"
  | "firecrawl"
  | "apify";

export const BRAND_LABEL: Record<BrandName, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  x: "X",
  threads: "Threads",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  elevenlabs: "ElevenLabs",
  heygen: "HeyGen",
  replicate: "Replicate",
  modal: "Modal",
  zernio: "Zernio",
  higgsfield: "Higgsfield",
  google_drive: "Google Drive",
  lovable: "Lovable AI",
  gemini: "Gemini",
  anthropic: "Anthropic",
  claude: "Claude",
  openai: "OpenAI",
  xai: "xAI",
  tavily: "Tavily",
  firecrawl: "Firecrawl",
  apify: "Apify",
};

/**
 * Como cada marca aparece escrita na UI (além do rótulo oficial). Os textos
 * mais longos vêm primeiro para "Lovable AI" ganhar de "Lovable".
 */
const BRAND_ALIASES: Array<[string, BrandName]> = [
  ...(Object.keys(BRAND_LABEL) as BrandName[]).map((brand): [string, BrandName] => [
    BRAND_LABEL[brand],
    brand,
  ]),
  ["Grok", "xai"] as [string, BrandName],
  ["Claude", "anthropic"] as [string, BrandName],
].sort((a, b) => b[0].length - a[0].length);

export interface BrandMention {
  brand: BrandName;
  start: number;
  end: number;
}

/**
 * Onde um texto nomeia uma marca ("Conecte o Instagram" → Instagram em 10–19).
 * Palavra inteira, sensível a maiúsculas (nomes próprios); não sobrepõe.
 */
export function findBrandMentions(text: string): BrandMention[] {
  const hits: BrandMention[] = [];
  for (const [alias, brand] of BRAND_ALIASES) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(alias)}(?![\\p{L}\\p{N}])`, "gu");
    for (const match of text.matchAll(re)) {
      const start = match.index ?? 0;
      const end = start + alias.length;
      if (hits.some((h) => start < h.end && end > h.start)) continue;
      hits.push({ brand, start, end });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

/** Primeira marca nomeada num rótulo ("Conectar Zernio" → zernio), ou nada. */
export function brandFromLabel(text: string): BrandName | undefined {
  return findBrandMentions(text)[0]?.brand;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Canal do Content Engine → marca da plataforma (sem marca: undefined). */
export function channelBrand(channelType: string): BrandName | undefined {
  if (channelType.startsWith("instagram")) return "instagram";
  if (channelType.startsWith("x_")) return "x";
  if (channelType.startsWith("threads")) return "threads";
  if (channelType.startsWith("facebook")) return "facebook";
  if (channelType.startsWith("linkedin")) return "linkedin";
  if (channelType.startsWith("tiktok")) return "tiktok";
  return undefined;
}
