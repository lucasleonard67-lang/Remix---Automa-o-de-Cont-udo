import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

// Arte do carrossel de Instagram. A regra da casa (validada aqui, não só no
// olho): a CAPA leva foto full-bleed; do slide 2 em diante o fundo é sólido
// (branco ou preto), sem foto atrás do texto.
//
// `E2E_CAROUSEL_ID` aponta a peça usada; sem ele o spec pega a primeira peça de
// carrossel da biblioteca.

const CARD = "[data-carousel-slide]";

async function openCarousel(page: import("@playwright/test").Page) {
  const id = process.env.E2E_CAROUSEL_ID;
  if (id) {
    await page.goto(`/biblioteca/${id}`);
  } else {
    await page.goto("/biblioteca");
    const card = page.locator('a[href^="/biblioteca/"]').first();
    await card.click();
  }
  await expect(page.getByRole("heading", { name: /Instagram Carrossel/ })).toBeVisible({
    timeout: 20_000,
  });
}

/**
 * Estilos que a arte precisa expor pra regra ser verificável.
 *
 * A arte virou um CHASSI com peles trocáveis (src/design-system/
 * carousel-art.css): o texto agora é `.title` + `.body` dentro de `.mid`,
 * e a foto é uma camada `.photo > img` tratada por cada pele. O transbordo
 * verdadeiro se mede em `.mid` — é ela que segura o texto.
 */
async function readSlide(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const card = document.querySelector<HTMLElement>("[data-carousel-slide]");
    if (!card) return null;
    const cs = getComputedStyle(card);
    const title = card.querySelector<HTMLElement>(".title");
    const mid = card.querySelector<HTMLElement>(".mid");
    const foto = card.querySelector<HTMLImageElement>(".photo img");
    const fotoBox = card.querySelector<HTMLElement>(".photo");
    const cardBox = card.getBoundingClientRect();
    // "pintada" de verdade: no export a foto precisa estar decodificada
    const fotoPronta = Boolean(foto?.complete && foto.naturalWidth > 0);
    const caixa = fotoBox?.getBoundingClientRect();
    const fullBleed =
      fotoPronta &&
      Boolean(caixa) &&
      caixa!.width >= cardBox.width - 2 &&
      caixa!.height >= cardBox.height - 2;
    return {
      system: card.dataset.carouselSystem ?? "",
      kind: card.dataset.kind ?? "",
      photo: card.dataset.photo ?? "",
      bg: cs.backgroundColor,
      fullBleedPhoto: fullBleed,
      hasImg: fotoPronta,
      // Capa como PEÇA DE ARTE: a manchete está DENTRO da imagem e o chassi
      // não desenha nada. Aí não existe `.title` — e reportar fonte 0 faria o
      // teste de tamanho mínimo acusar um defeito que não existe.
      artRendered: card.dataset.artRendered === "true",
      temChassi: Boolean(card.querySelector(".pad")),
      fontSize: title ? parseFloat(getComputedStyle(title).fontSize) : null,
      color: title ? getComputedStyle(title).color : "",
      fit: parseFloat(card.style.getPropertyValue("--fit") || "1"),
      overflowsBottom: mid ? mid.scrollHeight > mid.clientHeight + 2 : false,
      overflowsRight: mid ? mid.scrollWidth > mid.clientWidth + 2 : false,
    };
  });
}

/** `photo_slot` que o design system da marca declara. */
async function lugarDaFoto(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(async () => {
    const [{ supabase }, { normalizeArt }] = await Promise.all([
      import("/src/integrations/supabase/client.ts"),
      import("/src/lib/carousel-art.ts"),
    ]);
    const { data } = await supabase
      .from("brand_kit")
      .select("content")
      .eq("status", "active")
      .maybeSingle();
    return normalizeArt((data?.content as { art?: unknown } | null)?.art).photo_slot;
  });
}

test("a capa segue o lugar da foto do design system; o miolo é sólido", async ({ page }) => {
  await openCarousel(page);
  // "capa leva foto" deixou de ser invariante do produto e virou decisão da
  // MARCA: um design system gráfico declara `photo_slot: none` e a capa é arte
  // sem fotografia. O teste tem que cobrar o que o documento manda, não a
  // composição que valia antes do vocabulário de arte existir.
  const slot = await lugarDaFoto(page);

  if (slot === "none") {
    // `none` governa a FOTOGRAFIA DO MIOLO, não a capa: um sistema gráfico
    // continua tendo capa — ela é que não é uma foto, e sim arte composta com
    // a manchete dentro. Sem essa arte, o chassi desenha.
    const cover = await readSlide(page);
    expect(cover, "card da capa não montou").not.toBeNull();
    if (cover!.artRendered) {
      expect(cover!.temChassi, "chassi não pode desenhar sobre a capa de arte").toBe(false);
    } else {
      expect(cover!.temChassi, "sem arte de capa, o chassi precisa desenhar").toBe(true);
    }
  } else {
    await expect
      .poll(async () => (await readSlide(page))?.fullBleedPhoto, { timeout: 20_000 })
      .toBe(true);
    const cover = await readSlide(page);
    if (cover!.artRendered) {
      // Capa como arte fechada: a manchete está NA imagem e o chassi não pode
      // desenhar por cima, senão sai manchete em dobro.
      expect(cover!.temChassi, "chassi não pode desenhar sobre a capa de arte").toBe(false);
    } else {
      expect(cover!.color, "título sobre foto tem que ser branco").toBe("rgb(255, 255, 255)");
    }
  }

  await page.getByRole("button", { name: "Próximo" }).click();
  const inner = await readSlide(page);
  expect(inner!.fullBleedPhoto, "miolo NÃO pode ter foto de fundo").toBe(false);
});

test("a arte segue o design system da marca — sem seletor na peça", async ({ page }) => {
  await openCarousel(page);

  // O que o Tiago cobrou: "não tem que ter seletor no carrossel, tem que
  // seguir o padrão escolhido". Nenhum controle de identidade visual aqui.
  await expect(page.getByTestId("carousel-system-open")).toHaveCount(0);
  await expect(page.getByTestId("carousel-system-gallery")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Miolo (branco|preto)/ })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /Arte definida na identidade visual/ }),
  ).toBeVisible();

  // E a arte que está na tela é a que o brand kit declara, eixo a eixo.
  const daPeca = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>("[data-carousel-slide]");
    return card
      ? {
          layout: card.dataset.layout,
          texture: card.dataset.texture,
          frame: card.dataset.frame,
          photo_slot: card.dataset.photoSlot,
          surface: card.dataset.carouselSurface,
        }
      : null;
  });
  const daMarca = await page.evaluate(async () => {
    const [{ supabase }, { normalizeArt }] = await Promise.all([
      import("/src/integrations/supabase/client.ts"),
      import("/src/lib/carousel-art.ts"),
    ]);
    const { data } = await supabase
      .from("brand_kit")
      .select("content")
      .eq("status", "active")
      .maybeSingle();
    const art = normalizeArt((data?.content as { art?: unknown } | null)?.art);
    return {
      layout: art.layout,
      texture: art.texture,
      frame: art.frame,
      photo_slot: art.photo_slot,
      surface: art.surface,
    };
  });
  expect(daPeca).toEqual(daMarca);
});

test("nenhum slide estoura a arte (texto sempre dentro)", async ({ page }) => {
  await openCarousel(page);
  const total = await page
    .getByText(/Slide 1 de \d+/)
    .textContent()
    .then((t) => Number(/de (\d+)/.exec(t ?? "")?.[1] ?? 1));

  for (let i = 0; i < total; i++) {
    const slide = await readSlide(page);
    expect(slide, `slide ${i + 1} não montou`).not.toBeNull();
    expect(slide!.overflowsBottom, `slide ${i + 1}: texto vaza embaixo`).toBe(false);
    expect(slide!.overflowsRight, `slide ${i + 1}: texto vaza na lateral`).toBe(false);
    // Sem chassi (capa de arte) não há tipo para medir — a manchete é pixel
    // dentro da imagem, e o tamanho dela é responsabilidade do modelo.
    if (slide!.fontSize !== null) {
      expect(slide!.fontSize, `slide ${i + 1}: fonte pequena demais`).toBeGreaterThanOrEqual(15);
    }
    if (i < total - 1) await page.getByRole("button", { name: "Próximo" }).click();
  }
});

test("captura os slides para inspeção visual", async ({ page }, testInfo) => {
  await openCarousel(page);
  for (const index of [0, 1, 2]) {
    await page.goto(page.url().split("?")[0]);
    await expect(page.getByText(/Slide 1 de \d+/)).toBeVisible({ timeout: 20_000 });
    for (let i = 0; i < index; i++) await page.getByRole("button", { name: "Próximo" }).click();
    const card = page.locator(CARD).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    if (index === 0) {
      await expect
        .poll(async () => (await readSlide(page))?.hasImg, { timeout: 20_000 })
        .toBe(true);
    }
    await testInfo.attach(`slide-${index + 1}`, {
      body: await card.screenshot(),
      contentType: "image/png",
    });
  }
});

test("exportar entrega um ZIP com os slides dentro", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await openCarousel(page);

  const baixando = page.waitForEvent("download", { timeout: 150_000 });
  await page.getByRole("button", { name: /Exportar carrossel/ }).click();
  const download = await baixando;
  const caminho = await download.path();
  expect(caminho, "o download não materializou").toBeTruthy();
  const bytes = await readFile(caminho!);
  expect(bytes.byteLength, "ZIP vazio").toBeGreaterThan(1000);
  // assinatura de ZIP: PK\x03\x04
  expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  await testInfo.attach("carrossel.zip", { body: bytes, contentType: "application/zip" });
});
