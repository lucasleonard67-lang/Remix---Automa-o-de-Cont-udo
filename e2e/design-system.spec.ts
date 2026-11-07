import { expect, test } from "@playwright/test";

import { gotoAndExpectHeading } from "./helpers";

// O Design System SUBIDO aplicado, verificado no NAVEGADOR (computed
// style), não por leitura de código: tipografia Geist, light-first, navy como
// cor de marca, pill canônica, tokens do kit carregados e paleta restrita.

test("tokens do kit carregam e valem no documento", async ({ page }) => {
  await gotoAndExpectHeading(page, "/", /^(Bom dia|Boa tarde|Boa noite)$/);
  const tokens = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      navy: s.getPropertyValue("--via-navy").trim(),
      font: s.getPropertyValue("--via-font").trim(),
      radiusLg: s.getPropertyValue("--via-radius-lg").trim(),
      glass: s.getPropertyValue("--via-glass-card").trim(),
    };
  });
  expect(tokens.navy.toUpperCase()).toBe("#0A1F3B");
  expect(tokens.font).toContain("Geist");
  expect(tokens.radiusLg).toBe("20px");
  expect(tokens.glass).not.toContain("gradient"); // flat: card plano
});

test("tipografia é Geist e o canvas é o cinza do DS", async ({ page }) => {
  await gotoAndExpectHeading(page, "/", /^(Bom dia|Boa tarde|Boa noite)$/);
  const body = await page.evaluate(() => {
    const cs = getComputedStyle(document.body);
    return { font: cs.fontFamily, bg: cs.backgroundColor };
  });
  expect(body.font).toContain("Geist");
  expect(body.bg).toBe("rgb(247, 248, 250)");

  // a fonte precisa estar CARREGADA, não só declarada
  const loaded = await page.evaluate(() => document.fonts.check('500 16px "Geist"'));
  expect(loaded).toBe(true);
});

test("CTA primário é pílula navy com texto branco", async ({ page }) => {
  await gotoAndExpectHeading(page, "/videos", "Vídeos");
  const cta = page.getByTestId("cta-novo-video");
  const style = await cta.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      radius: cs.borderRadius,
      height: el.getBoundingClientRect().height,
      color: cs.color,
      weight: cs.fontWeight,
      image: cs.backgroundImage,
    };
  });
  // pílula: raio >= metade da altura (o Tailwind resolve rounded-full em px)
  expect(parseFloat(style.radius)).toBeGreaterThanOrEqual(style.height / 2);
  expect(style.color).toBe("rgb(255, 255, 255)");
  expect(style.weight).toBe("500"); // nunca 700 em CTA
  expect(style.image).toContain("gradient"); // navy gradient da casa
});

test("pill canônica: 11px, peso 500, sem caps lock", async ({ page }) => {
  await gotoAndExpectHeading(page, "/videos", "Vídeos");
  const badge = page
    .locator('[data-slot="badge"], .rounded-full')
    .filter({ hasText: /Concluído/ })
    .first();
  if (!(await badge.isVisible().catch(() => false))) test.skip();
  const style = await badge.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { size: cs.fontSize, weight: cs.fontWeight, transform: cs.textTransform };
  });
  expect(style.size).toBe("11px");
  expect(style.weight).toBe("500");
  expect(style.transform).toBe("none");
});

test("card de conteúdo é plano: branco, sem blur e sem sombra", async ({ page }) => {
  await gotoAndExpectHeading(page, "/videos/novo", "Novo vídeo");
  const card = page.getByTestId("avatar-picker");
  const style = await card.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { image: cs.backgroundImage, blur: cs.backdropFilter, shadow: cs.boxShadow };
  });
  expect(style.image).toBe("none");
  expect(style.blur).toBe("none");
  expect(style.shadow).toBe("none");
});

test("paleta restrita: nenhuma cor banida pintada na tela", async ({ page }) => {
  // gold/amarelo/roxo/cyan/magenta/verde-neon são banidos no DS.
  const BANNED = [
    /rgb\(199,\s*165,\s*89\)/, // gold #C7A559
    /rgb\(232,\s*199,\s*112\)/, // amarelo #E8C770
    /rgb\(123,\s*97,\s*255\)/, // roxo IA #7B61FF
    /rgb\(0,\s*188,\s*212\)/, // cyan #00BCD4
    /rgb\(255,\s*77,\s*141\)/, // magenta #FF4D8D
  ];
  for (const path of ["/", "/videos", "/biblioteca", "/radar", "/marca"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const used = await page.evaluate(() => {
      const out = new Set<string>();
      for (const el of Array.from(document.querySelectorAll("*")).slice(0, 3000)) {
        const cs = getComputedStyle(el);
        out.add(cs.color);
        out.add(cs.backgroundColor);
        out.add(cs.borderTopColor);
      }
      return Array.from(out);
    });
    for (const banned of BANNED) {
      expect(
        used.filter((c) => banned.test(c)),
        `cor banida em ${path}`,
      ).toHaveLength(0);
    }
  }
});

test("marca presente no shell (lockup, não wordmark solto)", async ({ page }) => {
  await gotoAndExpectHeading(page, "/", /^(Bom dia|Boa tarde|Boa noite)$/);
  const logos = page.locator('img[alt="Viver de IA"]');
  await expect(logos.first()).toBeVisible();
  const src = await logos.first().getAttribute("src");
  expect(src).toContain("/brand/mark-"); // lockup oficial do kit
});
