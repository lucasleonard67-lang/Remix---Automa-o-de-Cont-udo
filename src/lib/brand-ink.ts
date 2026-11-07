// ---------------------------------------------------------------------------
// Paleta da marca → tokens da arte.
//
// O brand kit guarda cores com CHAVES LIVRES (o onboarding é quem nomeia:
// primary, ink, surface, accent, muted, background, text…). A arte precisa de
// papéis fixos — papel, tinta, destaque, apoio — e de variações já resolvidas
// em rgba, porque `color-mix()` no CSS não sobrevive de forma confiável ao
// clone do html-to-image no export.
//
// A escolha do papel e da tinta é por CONTRASTE medido, não por nome de chave:
// uma marca pode chamar de "background" uma cor escura, e a arte tem que
// continuar legível.
// ---------------------------------------------------------------------------

export interface ArtInk {
  paper: string;
  ink: string;
  muted: string;
  accent: string;
  accent2: string;
  /** Variações já em rgba para as texturas e molduras. */
  vars: Record<string, string>;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const limpo = hex.trim().replace(/^#/, "");
  const cheio =
    limpo.length === 3
      ? limpo
          .split("")
          .map((c) => c + c)
          .join("")
      : limpo;
  if (!/^[0-9a-fA-F]{6}$/.test(cheio)) return null;
  return [
    parseInt(cheio.slice(0, 2), 16),
    parseInt(cheio.slice(2, 4), 16),
    parseInt(cheio.slice(4, 6), 16),
  ];
}

function rgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(0,0,0,${alpha})`;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/** Luminância relativa (WCAG) — decide quem é papel e quem é tinta. */
export function luminancia(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 1;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contraste(a: string, b: string): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Mistura linear entre duas cores — usada para o texto de apoio. */
function misturar(a: string, b: string, peso: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return a;
  const canal = (i: number) => Math.round(ra[i] * (1 - peso) + rb[i] * peso);
  return `rgb(${canal(0)}, ${canal(1)}, ${canal(2)})`;
}

function primeiro(palette: Record<string, string>, chaves: string[]): string | null {
  for (const chave of chaves) {
    const valor = palette[chave];
    if (typeof valor === "string" && hexToRgb(valor)) return valor.trim();
  }
  return null;
}

/**
 * @param palette paleta livre do brand kit
 * @param inverter troca papel e tinta (o "miolo escuro" do deck)
 */
export function artInk(palette: Record<string, string> | undefined, inverter = false): ArtInk {
  const p = palette ?? {};
  let paper = primeiro(p, ["background", "surface", "paper", "canvas"]) ?? "#FFFFFF";
  let ink = primeiro(p, ["text", "ink", "foreground"]) ?? "#101828";
  const accent = primeiro(p, ["accent", "primary", "brand"]) ?? "#2563EB";
  const accent2 = primeiro(p, ["secondary", "primary", "accent"]) ?? accent;

  // Nome de chave não é promessa de contraste: se papel e tinta ficaram
  // parecidos, a arte sairia ilegível. Aí a tinta vira o extremo oposto.
  if (contraste(paper, ink) < 4.5) {
    ink = luminancia(paper) > 0.4 ? "#101828" : "#F5F6F7";
  }
  if (inverter) {
    const troca = paper;
    paper = ink;
    ink = troca;
  }

  const muted = misturar(ink, paper, 0.42);

  return {
    paper,
    ink,
    muted,
    accent,
    accent2,
    vars: {
      "--paper": paper,
      "--ink": ink,
      "--muted": muted,
      "--accent": accent,
      "--accent-2": accent2,
      "--ink-08": rgba(ink, 0.08),
      "--ink-14": rgba(ink, 0.14),
      "--ink-28": rgba(ink, 0.28),
      "--ink-45": rgba(ink, 0.45),
      "--paper-70": rgba(paper, 0.7),
      "--paper-90": rgba(paper, 0.92),
      "--accent-14": rgba(accent, 0.14),
      "--accent-35": rgba(accent, 0.35),
      "--accent-55": rgba(accent, 0.55),
    },
  };
}
