import { expect, test } from "@playwright/test";

import { gotoAndExpectHeading } from "./helpers";

// Dashboard (atalhos e leituras) e wizard de onboarding.
// O wizard é percorrido em modo leitura — nada de salvar configuração de marca.

// O Início é o painel: ações rápidas, produção, conectores, custos e o resumo
// de desempenho e mercado. Criar conteúdo mora em /criar (e2e/criar.spec.ts).
test("início é o painel: Criar conteúdo abre as quatro escolhas e cada uma leva ao fluxo", async ({
  page,
}) => {
  await gotoAndExpectHeading(page, "/", /^(Bom dia|Boa tarde|Boa noite)$/);
  await expect(page.getByTestId("acoes-rapidas")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Tema da peça" })).toHaveCount(0);
  const destinos: [string, RegExp][] = [
    ["acao-estatico", /\/criar$/],
    ["acao-video", /\/videos\/novo$/],
    ["acao-avatar", /\/marca\/avatares$/],
    ["acao-voz", /\/marca\/vozes$/],
  ];
  for (const [id, url] of destinos) {
    await gotoAndExpectHeading(page, "/", /^(Bom dia|Boa tarde|Boa noite)$/);
    await page.getByTestId("acao-conteudo").click();
    await page.getByTestId(id).click();
    await expect(page).toHaveURL(url, { timeout: 15_000 });
  }
});

test("chip de conectores lista o que falta e abre a conexão no próprio Início", async ({
  page,
}) => {
  await gotoAndExpectHeading(page, "/", /^(Bom dia|Boa tarde|Boa noite)$/);
  const chip = page.getByTestId("conectores");
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await chip.click();
  const falta = page.locator('[data-testid^="conector-"]').first();
  const temFalta = await falta
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  test.skip(!temFalta, "tudo conectado nesta instância");
  await falta.click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
  expect(new URL(page.url()).pathname).toBe("/");
});

test("uma ideia de hoje leva ao Criar com o tema", async ({ page }) => {
  await gotoAndExpectHeading(page, "/", /^(Bom dia|Boa tarde|Boa noite)$/);
  const criar = page
    .getByTestId("ideias")
    .getByRole("link", { name: /^Criar:/ })
    .first();
  const temIdeia = await criar
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  test.skip(!temIdeia, "sem ideias para hoje");
  await criar.click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe("/criar");
  await expect
    .poll(
      async () => (await page.getByRole("textbox", { name: "Tema da peça" }).inputValue()).length,
      { timeout: 15_000 },
    )
    .toBeGreaterThan(10);
});

test("o resumo de redes leva ao Desempenho completo", async ({ page }) => {
  await gotoAndExpectHeading(page, "/", /^(Bom dia|Boa tarde|Boa noite)$/);
  await page.getByRole("link", { name: /Desempenho e mercado/ }).click();
  await expect(page.getByRole("heading", { name: "Desempenho", level: 1 })).toBeVisible({
    timeout: 15_000,
  });
});

test("faixa de primeiros passos leva ao passo pendente", async ({ page }) => {
  await gotoAndExpectHeading(page, "/", /^(Bom dia|Boa tarde|Boa noite)$/);
  const strip = page.getByTestId("primeiros-passos");
  // a faixa depende de várias queries — espera resolver antes de decidir
  const shown = await strip
    .waitFor({ state: "visible", timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  test.skip(!shown, "instância já configurada — sem primeiros passos");
  await strip
    .getByRole("button", { name: /Continuar/ })
    .or(strip.getByRole("link", { name: /Continuar/ }))
    .click();
  // o passo pendente abre o fluxo de configuração (modal) ou, no último
  // ("Revise e publique"), leva à Biblioteca — nunca fica parado na raiz sem modal
  await expect
    .poll(
      async () =>
        (await page
          .getByTestId("setup-flow")
          .isVisible()
          .catch(() => false)) || new URL(page.url()).pathname !== "/",
      { timeout: 15_000 },
    )
    .toBe(true);
});

test("fluxo de configuração abre em modo visual", async ({ page }) => {
  await page.goto("/onboarding?preview=1");
  const flow = page.getByTestId("setup-flow");
  await expect(flow).toBeVisible({ timeout: 15_000 });
  await expect(flow.getByRole("list", { name: /Passos da configuração/ })).toBeVisible();
});

test("wizard mostra a trilha de passos e permite navegar entre concluídos", async ({ page }) => {
  await page.goto("/onboarding?modo=manual");
  await expect(page.getByText(/PASSO \d+ DE \d+/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/passos concluídos/)).toBeVisible();

  // voltar a um passo já concluído não pode quebrar a tela
  const done = page.getByRole("button", { name: /Boas-vindas/ }).first();
  if (await done.isVisible().catch(() => false)) {
    await done.click();
    await expect(page.getByText(/PASSO \d+ DE \d+/i)).toBeVisible();
  }
});

test("sair do wizard devolve pro app", async ({ page }) => {
  await page.goto("/onboarding?modo=manual");
  await expect(page.getByText(/PASSO \d+ DE \d+/i)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Salvar e sair/ }).click();
  // Host cravado quebrava o spec sempre que a suíte roda fora da 8080
  // (E2E_BASE_URL). O que importa é ter voltado para a raiz do app.
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe("/");
});
