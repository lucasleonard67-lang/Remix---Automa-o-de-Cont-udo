import { expect, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// A ARTE É DA MARCA.
//
// Este spec trava a correção que o Tiago cobrou: antes existia um catálogo de
// onze peles com hex e fonte LITERAIS no CSS, escolhidas peça a peça — a marca
// podia ter a paleta extraída do próprio site que a arte saía nas cores da
// pele. Agora a MATÉRIA (paleta, tipografia) vem do brand kit e só a FORMA
// (composição, textura, moldura) é vocabulário do produto.
//
// A asserção que importa: mexer num eixo de FORMA muda a forma e NÃO muda a
// cor. Se algum dia alguém reintroduzir um hex numa regra de textura, este
// teste cai.
// ---------------------------------------------------------------------------

/**
 * Abre a revisão da arte com uma TIPOGRAFIA conhecida.
 *
 * Não mexe na paleta de propósito: a versão anterior clicava em "Usar paleta
 * padrão", botão que só existe com a paleta vazia — e no dia em que a instância
 * ganhou um brand kit ativo os 5 testes caíram de uma vez. Teste de app real
 * não pode depender de a marca estar por configurar; o que ele afere é a
 * RELAÇÃO entre o documento e a arte, qualquer que seja o documento.
 */
async function abrirArte(page: import("@playwright/test").Page) {
  await page.goto("/marca/brand-kit");
  await expect(page.getByTestId("eixos-de-arte")).toBeVisible({ timeout: 20_000 });
  await page.getByLabel(/Títulos/).fill("Cinzel");
  await page.getByLabel(/Corpo/).fill("Jost");
  await expect(page.locator(".via-slide")).toBeVisible();
}

/** Accent que o brand kit em edição declara — a verdade contra a qual medir. */
async function accentDoDocumento(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const [{ supabase }, { artInk }] = await Promise.all([
      import("/src/integrations/supabase/client.ts"),
      import("/src/lib/brand-ink.ts"),
    ]);
    const { data } = await supabase
      .from("brand_kit")
      .select("content")
      .eq("status", "active")
      .maybeSingle();
    const palette = (data?.content as { palette?: Record<string, string> } | null)?.palette;
    return artInk(palette).accent.toUpperCase();
  });
}

/** Tokens que a arte está de fato usando, do computed style. */
async function tokens(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const s = document.querySelector<HTMLElement>(".via-slide");
    if (!s) return null;
    const cs = getComputedStyle(s);
    const t = getComputedStyle(s.querySelector(".title")!);
    return {
      paper: cs.backgroundColor,
      ink: cs.color,
      accent: cs.getPropertyValue("--accent").trim(),
      fonte: t.fontFamily,
      eixos: {
        layout: s.dataset.layout,
        frame: s.dataset.frame,
        texture: s.dataset.texture,
        surface: s.dataset.carouselSurface,
      },
    };
  });
}

test("a arte é pintada com a paleta e a tipografia da marca", async ({ page }) => {
  await abrirArte(page);
  const arte = await tokens(page);
  expect(arte).not.toBeNull();
  // A arte tem que usar o accent DO DOCUMENTO, seja ele qual for — é isso que
  // separa design system de tema hardcodado.
  expect(arte!.accent.toUpperCase()).toBe(await accentDoDocumento(page));
  expect(arte!.fonte).toContain("Cinzel");
});

test("trocar eixo de FORMA não mexe na cor da marca", async ({ page }) => {
  await abrirArte(page);
  const antes = await tokens(page);

  for (const eixo of ["edge-round", "density-airy"]) {
    await page.getByTestId(`arte-${eixo}`).click();
  }
  const depois = await tokens(page);

  // a estrutura é fixa em toda marca
  expect(depois!.eixos.layout).toBe("editorial");
  expect(depois!.eixos.frame).toBe("none");
  // …e a matéria, não.
  expect(depois!.paper).toBe(antes!.paper);
  expect(depois!.ink).toBe(antes!.ink);
  expect(depois!.accent).toBe(antes!.accent);
  expect(depois!.fonte).toBe(antes!.fonte);
});

test("o eixo Fundo inverte papel e tinta DA MARCA, sem cor nova", async ({ page }) => {
  await abrirArte(page);
  const claro = await tokens(page);
  await page.getByTestId("arte-surface-ink").click();
  const escuro = await tokens(page);

  expect(escuro!.eixos.surface).toBe("ink");
  // inverteu de verdade
  expect(escuro!.paper).toBe(claro!.ink);
  expect(escuro!.ink).toBe(claro!.paper);
  // e o destaque continua sendo o da marca
  expect(escuro!.accent).toBe(claro!.accent);
});

test("família inexistente no Google Fonts é denunciada na revisão", async ({ page }) => {
  await abrirArte(page);
  await page.getByLabel(/Títulos/).fill("Fonte Que Nao Existe Xyz");
  // a detecção é por MEDIÇÃO (fonts.check mente por causa dos subsets)
  await expect(page.getByTestId("fontes-faltando")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("fontes-faltando")).toContainText("Fonte Que Nao Existe Xyz");
});

test("nenhuma combinação de eixos estoura a arte", async ({ page }) => {
  test.setTimeout(120_000);
  await abrirArte(page);

  // Varre cada eixo por inteiro; a cada valor a arte tem que continuar cabendo.
  const eixos = await page.evaluate(async () => {
    const { EIXOS_DE_ARTE } = await import("/src/lib/carousel-art.ts");
    return EIXOS_DE_ARTE.map((e: { chave: string; opcoes: Array<{ valor: string }> }) => ({
      chave: e.chave,
      valores: e.opcoes.map((o) => o.valor),
    }));
  });

  const estouros: string[] = [];
  for (const eixo of eixos) {
    for (const valor of eixo.valores) {
      await page.getByTestId(`arte-${eixo.chave}-${valor}`).click();
      await page.waitForTimeout(350);
      const fora = await page.evaluate(async () => {
        const { midOverflow } = await import("/src/lib/carousel-fit.ts");
        return Math.round(midOverflow(document.querySelector(".via-slide")).worst);
      });
      if (fora > 2) estouros.push(`${eixo.chave}=${valor} (${fora}px)`);
    }
  }
  expect(estouros, "combinação de eixos com texto vazando").toEqual([]);
});
