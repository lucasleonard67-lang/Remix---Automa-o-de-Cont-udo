import { expect, test } from "@playwright/test";

import { collectPageErrors, gotoAndExpectHeading } from "./helpers";

// Criar conteúdo (/criar): sugestões para hoje (a melhor já escolhida) →
// Gerar; o campo do tema é opcional e os ladrilhos de formato ajustam.

test("criar: campo à vista, ladrilhos com os fatos e o formato vira toggle", async ({ page }) => {
  const errors = collectPageErrors(page);
  await gotoAndExpectHeading(page, "/criar", "Criar conteúdo");
  await expect(page.getByTestId("criar-formatos")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("textbox", { name: "Tema da peça" })).toBeVisible();
  await expect(page.getByTestId("criar-estimativa")).toBeVisible();
  const carrossel = page.getByTestId("criar-formato-instagram_carousel");
  await expect(carrossel).toContainText(/slides/);
  test.skip(await carrossel.isDisabled(), "carrossel desligado nesta instância");
  const before = await carrossel.getAttribute("aria-pressed");
  test.skip(before === null, "canal do carrossel desligado nesta instância");
  await carrossel.click();
  await expect(carrossel).toHaveAttribute("aria-pressed", before === "true" ? "false" : "true");
  expect(errors).toHaveLength(0);
});

test("criar: escolher uma sugestão deixa só o Gerar", async ({ page }) => {
  await gotoAndExpectHeading(page, "/criar", "Criar conteúdo");
  const ideas = page.getByTestId("criar-sugestao");
  await expect(page.getByTestId("criar-formatos")).toBeVisible({ timeout: 15_000 });
  test.skip((await ideas.count()) === 0, "sem sugestões pontuadas nesta instância");
  await ideas.first().click();
  await expect(ideas.first()).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("textbox", { name: "Tema da peça" })).toHaveValue("");
  await expect(page.getByTestId("criar-tema")).toBeVisible();
});

test("criar: ?brief= preenche o campo direto em /criar", async ({ page }) => {
  await page.goto("/criar?brief=teste%20de%20brief&kind=post");
  await expect(page.getByRole("heading", { name: "Criar conteúdo" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("textbox", { name: "Tema da peça" })).toHaveValue("teste de brief", {
    timeout: 15_000,
  });
});
