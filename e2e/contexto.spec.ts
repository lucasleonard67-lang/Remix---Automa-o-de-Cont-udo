import { expect, test } from "@playwright/test";

import { gotoAndExpectHeading } from "./helpers";

// Base de contexto: listagem, filtros, busca e o drawer de cadastro.
// Nada aqui cria item de verdade (ingestão dispara embedding pago).

test("listagem mostra itens e filtros por tipo", async ({ page }) => {
  await gotoAndExpectHeading(page, "/contexto", "Contexto");
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Todos" })).toHaveAttribute("data-state", "active");

  await page.getByRole("tab", { name: "Case" }).click();
  await expect(page.getByRole("tab", { name: "Case" })).toHaveAttribute("data-state", "active");
  // filtro real: toda linha visível é do tipo escolhido
  const kinds = await page.locator("tbody tr td:nth-child(2)").allTextContents();
  for (const kind of kinds) expect(kind.trim()).toBe("Case");
});

test("busca filtra a listagem", async ({ page }) => {
  await gotoAndExpectHeading(page, "/contexto", "Contexto");
  const rowsBefore = await page.locator("tbody tr").count();
  await page.getByRole("textbox", { name: /Buscar no contexto/i }).fill("zzz-nao-existe-zzz");
  await expect
    .poll(async () => page.locator("tbody tr").count(), { timeout: 10_000 })
    .toBeLessThan(Math.max(rowsBefore, 1));
});

test("drawer de cadastro abre, valida e fecha", async ({ page }) => {
  await gotoAndExpectHeading(page, "/contexto", "Contexto");
  await page.getByRole("button", { name: "Adicionar" }).click();

  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Novo item de Contexto")).toBeVisible();

  // submeter vazio precisa EXPLICAR o que falta (bug caçado no sweep: era silencioso)
  await drawer.getByRole("button", { name: "Adicionar ao Contexto" }).click();
  await expect(page.getByText("Cole o texto do conteúdo antes de salvar.")).toBeVisible({
    timeout: 10_000,
  });
  await expect(drawer).toBeVisible(); // não fecha em erro de validação

  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
});

test("item da listagem abre o detalhe", async ({ page }) => {
  await gotoAndExpectHeading(page, "/contexto", "Contexto");
  const first = page.locator("tbody tr a").first();
  const title = (await first.textContent())?.trim() ?? "";
  await first.click();
  await expect(page).toHaveURL(/\/contexto\/[0-9a-f-]{36}$/);
  if (title) await expect(page.getByText(title).first()).toBeVisible({ timeout: 10_000 });
});

// Guarda da PERNA LÉXICA da retrieval. Um número distintivo é justamente onde
// o embedding é fraco e o full-text decide: quando a perna léxica estava morta
// (websearch_to_tsquery fazia AND de todos os termos), o item certo não subia —
// e era isso que fazia o Gerador provar a peça com o case errado.
test("busca por número distintivo traz o item que o contém", async ({ page }) => {
  await gotoAndExpectHeading(page, "/contexto", "Contexto");

  await page.getByLabel("Buscar no contexto").fill("18 horas");
  // debounce de 400ms + ida à edge
  await expect(page.getByRole("link", { name: /Nardelli/ }).first()).toBeVisible({
    timeout: 25_000,
  });
});
