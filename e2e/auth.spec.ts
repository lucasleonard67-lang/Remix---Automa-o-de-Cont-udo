import { expect, test } from "@playwright/test";

import { prepararLogin } from "./helpers";

// Fluxos de autenticação rodam SEM a sessão salva.
test.use({ storageState: { cookies: [], origins: [] } });

test("sem sessão, rota protegida manda pro /login preservando o destino", async ({ page }) => {
  await page.goto("/videos");
  await expect(page).toHaveURL(/\/login\?redirect=%2Fvideos/, { timeout: 15_000 });
  await prepararLogin(page);
});

test("senha errada mostra erro e não navega", async ({ page }) => {
  await page.goto("/login");
  const submeter = await prepararLogin(page);
  await page.getByLabel("E-mail").fill("teste.claude@viverdeia.ai");
  await page.getByLabel("Senha", { exact: true }).fill("senha-errada-123");
  await submeter.click();
  await expect(page.getByText("Não foi possível entrar")).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/login/);
});

test("login devolve o usuário pro deep link original", async ({ page }) => {
  const email = process.env.E2E_EMAIL!;
  const password = process.env.E2E_PASSWORD!;
  await page.goto("/videos/novo");
  await expect(page).toHaveURL(/\/login\?redirect=/, { timeout: 15_000 });
  const submeter = await prepararLogin(page);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await submeter.click();
  await expect(page).toHaveURL(/\/videos\/novo$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Novo vídeo" })).toBeVisible();
});
