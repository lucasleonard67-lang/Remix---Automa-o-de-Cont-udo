// ---------------------------------------------------------------------------
// Fontes da MARCA, carregadas sob demanda.
//
// Antes as famílias eram parâmetros do Google Fonts escritos à mão, um por
// pele hardcodada. Agora vêm de `brand_kit.typography`, que é texto livre
// gerado no onboarding — então o carregamento tem que funcionar para qualquer
// nome, e falhar de forma VISÍVEL quando o nome não existe.
//
// Três armadilhas medidas, todas com correção aqui:
//
//  1. `document.fonts.ready` resolve os carregamentos JÁ pendentes. Logo depois
//     de injetar o <link> não há nada pendente — a folha nem foi lida — e ele
//     resolve na hora. Por isso esperamos o `onload` do <link> e só então
//     pedimos `fonts.load()` família a família (uma face só é BUSCADA quando
//     algum elemento com layout a usa, e os nodes do export ficam fora da tela).
//  2. Sem `crossorigin` a folha do Google entra opaca: `sheet.cssRules` lança
//     SecurityError, o html-to-image engole o erro e exporta SEM embutir as
//     @font-face. O PNG só sai certo por sorte do cache.
//  3. `document.fonts.check()` não serve para detectar: o Google registra uma
//     @font-face por subset (latin, latin-ext, vietnamese…), o navegador só
//     baixa os que algum glifo pede, e o check devolve false enquanto qualquer
//     face casada estiver por baixar. A detecção honesta é por MEDIÇÃO.
// ---------------------------------------------------------------------------

const GENERICAS = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "ui-rounded",
  "inherit",
  "initial",
]);

/** Primeira família de uma pilha CSS, sem aspas. "Bodoni Moda, serif" → Bodoni Moda */
export function primeiraFamilia(pilha: string | undefined | null): string {
  const primeira =
    (pilha ?? "")
      .split(",")[0]
      ?.trim()
      .replace(/^["']|["']$/g, "") ?? "";
  return GENERICAS.has(primeira.toLowerCase()) ? "" : primeira;
}

/**
 * Famílias que o Google Fonts NÃO precisa servir: as que o app já embute.
 * Geist é self-hosted no kit (src/design-system/fonts).
 */
const JA_EMBUTIDAS = new Set(["geist", "geist mono"]);

const folhas = new Map<string, Promise<void>>();

function carregar(familia: string): Promise<void> {
  const chave = familia.toLowerCase();
  if (!familia || JA_EMBUTIDAS.has(chave)) return Promise.resolve();
  const existente = folhas.get(chave);
  if (existente) return existente;

  const promessa = new Promise<void>((resolve) => {
    if (typeof document === "undefined") return resolve();
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.crossOrigin = "anonymous";
    // itálico e três pesos: o vocabulário de arte usa versal pesado, corpo
    // regular e itálico no recorte de palavras.
    const param = `${familia.replace(/\s+/g, "+")}:ital,wght@0,400;0,600;0,700;1,400`;
    link.href = `https://fonts.googleapis.com/css2?family=${param}&display=swap`;
    link.dataset.brandFont = familia;
    // Falha de rede não pode travar o preview: resolve dos dois lados; quem
    // diz a verdade depois é `fontesFaltando`.
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });

  folhas.set(chave, promessa);
  return promessa;
}

/** Começa a carregar as famílias da marca (não espera). */
export function loadBrandFonts(...pilhas: Array<string | undefined | null>): void {
  for (const pilha of pilhas) {
    const familia = primeiraFamilia(pilha);
    if (familia) void carregar(familia);
  }
}

/** Famílias REALMENTE prontas — usar antes de rasterizar o PNG. */
export async function brandFontsReady(...pilhas: Array<string | undefined | null>): Promise<void> {
  const familias = pilhas.map(primeiraFamilia).filter(Boolean);
  if (familias.length === 0) return;

  await Promise.all(familias.map(carregar));
  if (typeof document === "undefined" || !document.fonts) return;

  await Promise.all(
    familias.flatMap((familia) =>
      [400, 700].map((peso) => document.fonts.load(`${peso} 1rem "${familia}"`).catch(() => [])),
    ),
  );
  try {
    await document.fonts.ready;
  } catch {
    // sem a API de fontes o navegador já resolveu de outro jeito
  }
}

const SONDA = "mmmwwwiii0123 ABCÇÃO";

/**
 * Famílias que o navegador NÃO está desenhando.
 *
 * Medição, não `fonts.check()`: se a família mede igual às genéricas, ela não
 * chegou. Duas genéricas porque coincidir com uma é plausível; com as duas,
 * não. Serve tanto para rede caída quanto para nome que não existe no Google
 * Fonts — que é o caso realmente perigoso, porque a IA escreve o nome.
 */
export function fontesFaltando(...pilhas: Array<string | undefined | null>): string[] {
  if (typeof document === "undefined") return [];
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return [];

  const medir = (familia: string): number => {
    ctx.font = `40px ${familia}`;
    return ctx.measureText(SONDA).width;
  };
  const genericas = ["monospace", "serif"].map((g) => [g, medir(g)] as const);

  return pilhas
    .map(primeiraFamilia)
    .filter((f): f is string => Boolean(f) && !JA_EMBUTIDAS.has(f.toLowerCase()))
    .filter((familia) =>
      genericas.every(([generica, largura]) => medir(`"${familia}", ${generica}`) === largura),
    );
}
