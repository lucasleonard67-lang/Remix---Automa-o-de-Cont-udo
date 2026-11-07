import { expect, test } from "@playwright/test";

import { collectPageErrors } from "./helpers";

// Fluxo de configuração (passo 1 e 2) e erro de chave nas integrações.
// Nada aqui grava dados: o fluxo abre em `?preview=1` (só visual, sem leitura
// da marca) e a chave enviada é inválida de propósito — o servidor recusa.

test.describe("passo 1 · Sua marca", () => {
  test("“Não tenho site” desliga o site, explica de onde vem a marca e abre as legendas", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto("/onboarding?preview=1&passo=1");
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 20_000 });

    // com leitura já feita, o passo 1 mostra o resumo: "Alterar" reabre o formulário
    const alterar = page.getByRole("button", { name: "Alterar site ou Instagram" });
    if (await alterar.isVisible().catch(() => false)) await alterar.click();

    const site = page.getByLabel("Site", { exact: true });
    await expect(site).toBeVisible();
    await page.getByRole("button", { name: "Não tenho site" }).click();
    await expect(site).toBeDisabled();
    await expect(page.getByText("A marca será lida pelas legendas do Instagram.")).toBeVisible();
    await expect(page.getByLabel("Legendas do Instagram (opcional)")).toBeVisible();

    // sem site e sem Instagram: o motivo aparece e o botão fica travado
    await page.getByRole("button", { name: "Não tenho Instagram" }).click();
    await expect(
      page.getByText("Sem site e sem Instagram não há o que ler. Informe um dos dois."),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("com a marca lida, “Alterar” reabre o formulário preenchido e “Cancelar” volta ao resumo", async ({
    page,
  }) => {
    await page.goto("/onboarding?preview=1&passo=1");
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 20_000 });
    const alterar = page.getByRole("button", { name: "Alterar site ou Instagram" });
    test.skip(!(await alterar.isVisible().catch(() => false)), "esta conta ainda não leu a marca");

    await alterar.click();
    await expect(page.getByLabel("Site", { exact: true })).not.toHaveValue("");
    await expect(page.getByRole("button", { name: "Ler de novo" })).toBeVisible();
    await expect(page.getByText("Ler de novo substitui a leitura atual da marca.")).toBeVisible();
    await page.getByRole("button", { name: "Cancelar" }).click();
    await expect(alterar).toBeVisible();
  });
});

test("passo 2 · conta conectada em outra aba atualiza o fluxo sem sair do passo", async ({
  page,
  context,
}) => {
  await page.goto("/onboarding?preview=1&passo=2");
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 20_000 });
  const conectar = page.getByRole("button", { name: "Conectar Instagram" });
  test.skip(!(await conectar.isVisible().catch(() => false)), "Zernio sem chave nesta conta");

  // a aba de retorno do Zernio, aberta pelo app como na autorização real
  const popup = context.waitForEvent("page");
  await page.evaluate(() =>
    window.open("/conectado?connected=instagram&username=teste_e2e", "_blank"),
  );
  await (await popup).waitForEvent("close", { timeout: 10_000 });

  await expect(page.getByText("Instagram conectado")).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding\?preview=1&passo=2/);
  await expect(page.getByRole("heading", { name: "Redes" })).toBeVisible();
});

test("chave inválida mostra o erro dentro do modal, em português", async ({ page }) => {
  await page.goto("/config?integracao=replicate");
  await expect(page).toHaveURL(/\/config/, { timeout: 20_000 });
  const campo = page.getByLabel("Token de API");
  await expect(campo).toBeVisible({ timeout: 15_000 });
  await campo.fill("token-invalido");
  await page.getByRole("button", { name: /^(Conectar|Substituir)$/ }).click();

  const erro = page.getByRole("alert");
  await expect(erro).toBeVisible({ timeout: 15_000 });
  await expect(erro).not.toContainText(/error|invalid|failed|status/i);
  await expect(page).toHaveURL(/\/config/);
});
