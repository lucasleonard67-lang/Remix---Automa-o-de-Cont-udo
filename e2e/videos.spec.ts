import { expect, test, type Page } from "@playwright/test";

import { gotoAndExpectHeading } from "./helpers";

// Fluxo da área de vídeos: biblioteca → experiência dedicada de geração →
// avatar → validação do formulário → volta pra biblioteca.
// IMPORTANTE: nenhum teste CRIA produção de verdade (geração real gasta
// créditos) — o submit só é exercitado até a validação.

// Catálogo e conexões fixos para o portão de geração: o teste não depende do
// que a instância tem ativo. Dois modelos Replicate com preço (um barato, um
// padrão) e os dois motores conectados.
const CATALOG_FIXTURE = [
  {
    id: "m-2",
    model_id: "bytedance/seedance-2.0",
    cost: { unit: "per_second", usd: 0.14 },
    limits: { duration_min: 4, duration_max: 15 },
    is_primary: true,
  },
  {
    id: "m-1",
    model_id: "bytedance/seedance-1-lite",
    cost: { unit: "per_second", usd: 0.036 },
    limits: { duration_min: 4, duration_max: 12 },
    is_primary: false,
  },
];

async function mockGateData(page: Page) {
  await page.route("**/rest/v1/video_models*", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(CATALOG_FIXTURE),
    });
  });
  await page.route("**/functions/v1/store-secret", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ configured: ["REPLICATE_API_TOKEN"] }),
    }),
  );
  await page.route("**/functions/v1/higgsfield-oauth", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ connected: true }),
    }),
  );
}

/** Intercepta o INSERT em director_jobs e o kick do motor: nenhum teste cria produção de verdade. */
async function captureDirectorJob(page: Page) {
  const captured: { body: Record<string, unknown> | null } = { body: null };
  await page.route("**/rest/v1/director_jobs*", async (route) => {
    if (route.request().method() === "POST") {
      captured.body = JSON.parse(route.request().postData() ?? "{}");
      await route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
      return;
    }
    await route.continue();
  });
  // depois do INSERT o front cutuca o motor (fire-and-forget): nada de tick real
  await page.route("**/functions/v1/director-advance", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ production: { advanced: 0 }, publish: { advanced: 0 } }),
    }),
  );
  return captured;
}

test("biblioteca lista produções e aponta pra geração dedicada", async ({ page }) => {
  await gotoAndExpectHeading(page, "/videos", "Vídeos");
  const cta = page.getByTestId("cta-novo-video");
  await expect(cta).toBeVisible();
  await cta.click();
  await expect(page).toHaveURL(/\/videos\/novo$/);
  await expect(page.getByRole("heading", { name: "Novo vídeo" })).toBeVisible();
  // experiência dedicada: a listagem NÃO aparece na página de geração
  await expect(page.getByTestId("cta-novo-video")).toHaveCount(0);
});

test("geração dedicada tem briefing, avatar, configurações e o portão de geração", async ({
  page,
}) => {
  await gotoAndExpectHeading(page, "/videos/novo", "Novo vídeo");
  await expect(page.getByText("Briefing").first()).toBeVisible();
  await expect(page.getByTestId("avatar-picker")).toBeVisible();
  await expect(page.getByText("Configurações").first()).toBeVisible();
  // o recibo: estimativa sempre na tela (muda de estado, nunca some) e o CTA colado nela
  const gate = page.getByTestId("generation-gate");
  await expect(gate).toBeVisible();
  await expect(gate.getByText("Estimativa", { exact: true })).toBeVisible();
  await expect(page.getByTestId("btn-gerar-video")).toBeVisible();
});

test("portão de geração: lista única com a Recomendada no topo; a escolha vai no payload", async ({
  page,
}) => {
  await mockGateData(page);
  await gotoAndExpectHeading(page, "/videos/novo", "Novo vídeo");

  // a lista inteira à vista, sem clicar em nada: provedor · modelo por linha
  const recommended = page.getByTestId("gate-option-bytedance-seedance-2.0");
  const cheapest = page.getByTestId("gate-option-bytedance-seedance-1-lite");
  const higgsfield = page.getByTestId("gate-option-cinematic_studio_3_0");
  await expect(recommended).toBeVisible();
  await expect(cheapest).toBeVisible();
  await expect(higgsfield).toBeVisible();
  // sem apresentador fixo, a Recomendada é o Seedance 2.0 e nasce marcada
  await expect(page.getByTestId("gate-option-recommended")).toBeVisible();
  await expect(recommended).toHaveAttribute("aria-checked", "true");
  await expect(cheapest).toHaveAttribute("aria-checked", "false");
  // ordem: Recomendada primeiro, depois por preço, sem preço no fim
  const gate = page.getByTestId("generation-gate");
  const ids = await gate
    .locator('[data-testid^="gate-option-"]')
    .evaluateAll((els) =>
      els
        .map((el) => el.getAttribute("data-testid"))
        .filter((id) => id !== "gate-option-recommended"),
    );
  expect(ids.slice(0, 2)).toEqual([
    "gate-option-bytedance-seedance-2.0",
    "gate-option-bytedance-seedance-1-lite",
  ]);
  expect(ids.at(-1)).toMatch(/^gate-option-cinematic_studio_/);
  // o teto em dólares está na tela antes do clique
  await expect(page.getByTestId("gate-estimate")).toContainText("até US$");
  await expect(page.getByTestId("gate-compare")).toBeVisible();

  const job = await captureDirectorJob(page);
  await page.getByLabel("Mensagem única *").fill("Teste do portão — não gerar.");
  await page.getByLabel("Número-herói *").fill("0");
  await page.getByLabel("CTA falado no final *").fill("teste");
  await page.getByTestId("btn-gerar-video").click();

  await expect.poll(() => job.body).not.toBeNull();
  const config = (
    job.body as unknown as {
      config: {
        engine: string;
        model_id: string | null;
        ab_model_id: string | null;
        ab_kling: boolean;
      };
    }
  ).config;
  // o recibo é o payload: a Recomendada, sem cena extra
  expect(config.engine).toBe("replicate");
  expect(config.model_id).toBe("bytedance/seedance-2.0");
  expect(config.ab_model_id).toBeNull();
  expect(config.ab_kling).toBe(false);
});

test("portão de geração: clicar numa linha troca o modelo; “Comparar duas” marca A e B", async ({
  page,
}) => {
  await mockGateData(page);
  await gotoAndExpectHeading(page, "/videos/novo", "Novo vídeo");

  // o Higgsfield é uma linha como qualquer outra: um clique e vira o modelo em uso
  await page.getByTestId("gate-option-cinematic_studio_3_0").click();
  await expect(page.getByTestId("gate-option-cinematic_studio_3_0")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  // sem preço, a estimativa avisa em vez de sumir
  await expect(page.getByTestId("gate-estimate")).toContainText("Sem estimativa");
  await expect(page.getByTestId("gate-estimate")).toContainText("créditos");

  // Comparar duas: as linhas viram caixas; a já marcada é A, a próxima clicada é B
  await page.getByTestId("gate-compare").click();
  await page.getByTestId("gate-option-bytedance-seedance-2.0").click();
  await expect(page.getByTestId("gate-option-cinematic_studio_3_0")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByTestId("gate-option-bytedance-seedance-2.0")).toHaveAttribute(
    "aria-checked",
    "true",
  );

  const job = await captureDirectorJob(page);
  await page.getByLabel("Mensagem única *").fill("Teste do portão — não gerar.");
  await page.getByLabel("Número-herói *").fill("0");
  await page.getByLabel("CTA falado no final *").fill("teste");
  await page.getByTestId("btn-gerar-video").click();

  await expect.poll(() => job.body).not.toBeNull();
  const config = (
    job.body as unknown as {
      config: {
        engine: string;
        model_id: string | null;
        ab_model_id: string | null;
        ab_kling: boolean;
      };
    }
  ).config;
  expect(config.engine).toBe("higgsfield");
  expect(config.model_id).toBe("cinematic_studio_3_0");
  expect(config.ab_model_id).toBe("bytedance/seedance-2.0");
  expect(config.ab_kling).toBe(true);
});

test("seletor de apresentador: sem apresentador fixo por padrão, seleção por clique", async ({
  page,
}) => {
  await gotoAndExpectHeading(page, "/videos/novo", "Novo vídeo");
  const none = page.getByRole("button", { name: /Sem apresentador fixo/ });
  await expect(none).toHaveAttribute("aria-pressed", "true");

  const tiles = page.locator('button[data-testid^="avatar-"]');
  const count = await tiles.count();
  if (count > 0) {
    await tiles.first().click();
    await expect(tiles.first()).toHaveAttribute("aria-pressed", "true");
    await expect(none).toHaveAttribute("aria-pressed", "false");
    // seleção é reversível
    await none.click();
    await expect(none).toHaveAttribute("aria-pressed", "true");
  }
  await expect(page.getByRole("button", { name: /Novo apresentador/ })).toBeVisible();
});

test("formulário valida campos obrigatórios sem criar produção", async ({ page }) => {
  await mockGateData(page);
  await gotoAndExpectHeading(page, "/videos/novo", "Novo vídeo");
  await page.getByTestId("btn-gerar-video").click();
  // validação client-side: continua na página e explica o que falta
  await expect(page.getByText(/mensagem única, o número-herói e o CTA/)).toBeVisible();
  await expect(page).toHaveURL(/\/videos\/novo$/);
});

test("teto de créditos: sem teto é opção visível e manda 0 ao backend", async ({ page }) => {
  await mockGateData(page);
  await gotoAndExpectHeading(page, "/videos/novo", "Novo vídeo");

  const budget = page.getByLabel("Teto de créditos Higgsfield");
  const semTeto = page.getByTestId("switch-sem-teto");
  await expect(semTeto).toBeVisible();
  await expect(budget).toBeEnabled();
  await expect(page.getByText(/A produção para ao passar de/)).toBeVisible();

  await semTeto.click();
  await expect(semTeto).toHaveAttribute("aria-checked", "true");
  // o campo some de cena e o texto explica o que muda
  await expect(budget).toBeDisabled();
  await expect(budget).toHaveAttribute("placeholder", "sem limite");
  await expect(page.getByText(/vai até o fim, sem parar por gasto/)).toBeVisible();

  // contrato com o backend: budget_credits <= 0 = sem limite (assertBudget
  // retorna cedo). Interceptamos o INSERT em vez de criar produção de verdade.
  const job = await captureDirectorJob(page);

  await page.getByLabel("Mensagem única *").fill("Teste de teto — não gerar.");
  await page.getByLabel("Número-herói *").fill("0");
  await page.getByLabel("CTA falado no final *").fill("teste");
  await page.getByTestId("btn-gerar-video").click();

  await expect.poll(() => job.body).not.toBeNull();
  const config = (
    job.body as unknown as { config: { budget_credits: number; model_id: string | null } }
  ).config;
  expect(config.budget_credits).toBe(0);
  // o portão sempre manda o modelo em uso
  expect(typeof config.model_id).toBe("string");
});

test("cancelar volta pra biblioteca", async ({ page }) => {
  await gotoAndExpectHeading(page, "/videos/novo", "Novo vídeo");
  await page.getByRole("link", { name: "Cancelar" }).click();
  await expect(page).toHaveURL(/\/videos$/);
  await expect(page.getByRole("heading", { name: "Vídeos" })).toBeVisible();
});
