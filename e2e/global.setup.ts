import { expect, test as setup } from "@playwright/test";

import { prepararLogin } from "./helpers";

// Autentica uma vez e persiste a sessão (storageState) pra todos os specs.
// Credenciais em e2e/.env (E2E_EMAIL / E2E_PASSWORD) — nunca no repo.
setup("autenticar", async ({ page }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    throw new Error("Defina E2E_EMAIL e E2E_PASSWORD em e2e/.env (ver e2e/.env.example).");
  }

  await page.goto("/login");
  const submeter = await prepararLogin(page);

  await page.getByLabel("E-mail").fill(email);
  await expect(page.getByLabel("E-mail")).toHaveValue(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await submeter.click();

  // Login ok = saiu do /login e o shell carregou (sidebar com Início).
  await expect(page.getByRole("link", { name: "Início" })).toBeVisible({ timeout: 15_000 });
  await page.context().storageState({ path: "e2e/.auth/session.json" });
});
