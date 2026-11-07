import { expect, test } from "@playwright/test";

import { collectPageErrors, gotoAndExpectHeading } from "./helpers";

// Varredura de TODAS as áreas: cada rota renderiza o próprio conteúdo,
// sem erro de console e sem cair no /login (deep link autenticado).
const ROUTES: { path: string; heading: string | RegExp }[] = [
  { path: "/", heading: /^(Bom dia|Boa tarde|Boa noite)$/ },
  { path: "/criar", heading: "Criar conteúdo" },
  { path: "/desempenho", heading: "Desempenho" },
  { path: "/radar", heading: "Radar" },
  { path: "/videos", heading: "Vídeos" },
  { path: "/videos/novo", heading: "Novo vídeo" },
  { path: "/marca/avatares", heading: "Apresentadores" },
  { path: "/biblioteca", heading: "Biblioteca" },
  { path: "/contexto", heading: "Contexto" },
  { path: "/marca", heading: "Marca" },
  { path: "/config", heading: "Ajustes" },
  { path: "/automacao", heading: "Automação" },
  { path: "/ajuda", heading: "Ajuda" },
];

for (const route of ROUTES) {
  test(`rota ${route.path} renderiza sem erros`, async ({ page }) => {
    const errors = collectPageErrors(page);
    await gotoAndExpectHeading(page, route.path, route.heading);
    expect(page.url()).not.toContain("/login");
    expect(errors, `erros de página em ${route.path}:\n${errors.join("\n")}`).toHaveLength(0);
  });
}

test("rota legada /diretor redireciona pra /videos", async ({ page }) => {
  await page.goto("/diretor");
  await expect(page).toHaveURL(/\/videos$/, { timeout: 15_000 });
});

test("rota legada /identidades redireciona pra Apresentadores", async ({ page }) => {
  await page.goto("/identidades");
  await expect(page).toHaveURL(/\/marca\/avatares$/, { timeout: 15_000 });
});

// A criação mora em /criar: links antigos da home (?brief/?kind/?radar/?channel)
// seguem para lá levando os parâmetros.
test("link antigo da home com ?brief= vai para /criar com os parâmetros", async ({ page }) => {
  await page.goto("/?brief=teste%20de%20redirect&kind=post");
  await expect(page).toHaveURL(/\/criar\?brief=teste(%20|\+)de(%20|\+)redirect&kind=post$/, {
    timeout: 15_000,
  });
  await expect(page.getByRole("textbox", { name: "Tema da peça" })).toHaveValue(
    "teste de redirect",
    { timeout: 15_000 },
  );
});

test("navegação pela sidebar percorre as áreas principais", async ({ page }) => {
  await gotoAndExpectHeading(page, "/", /^(Bom dia|Boa tarde|Boa noite)$/);
  for (const item of ["Biblioteca", "Vídeos", "Radar", "Marca"]) {
    await page.getByRole("link", { name: item, exact: true }).click();
    await expect(page.getByRole("heading").first()).toBeVisible();
  }
  // dentro de Marca os subitens aparecem; sem terceiro nível
  for (const sub of ["Contexto", "Canais", "Apresentadores"]) {
    await page
      .locator('[data-sidebar="menu-sub"]')
      .getByRole("link", { name: sub, exact: true })
      .click();
    await expect(page.getByRole("heading").first()).toBeVisible();
  }
  await expect(page).toHaveURL(/\/marca\/avatares$/);
});

// Um documento só pode ter UM <main>. O SidebarInset do shadcn vem como <main>
// e aninhava com o nosso — HTML inválido, e getByRole("main") ambíguo.
test("cada página expõe exatamente um landmark main", async ({ page }) => {
  for (const rota of ["/", "/radar", "/biblioteca", "/config"]) {
    await page.goto(rota);
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("main main")).toHaveCount(0);
  }
});

// Radar → Criar: a notícia é ANEXADA no criador de /criar, não gerada num modal.
// Sem clicar em Gerar — geração real custa crédito.
test("radar manda a notícia para a tela de criação, e dá para desanexar", async ({ page }) => {
  await page.goto("/radar");
  await expect(page.getByRole("heading", { name: "Radar" }).first()).toBeVisible({
    timeout: 20_000,
  });

  // a lista chega por query — contar antes disso pularia o teste sempre
  const gerar = page.getByRole("link", { name: /Gerar peça/ }).first();
  await expect(gerar).toBeVisible({ timeout: 25_000 });
  await gerar.click();

  await expect(page).toHaveURL(/\/criar\?radar=[0-9a-f-]{36}$/, { timeout: 15_000 });
  const chip = page.getByTestId("radar-anexado");
  await expect(chip).toBeVisible({ timeout: 20_000 });
  // o briefing chega pronto para revisão — é o ponto de trazer para cá
  await expect
    .poll(async () => (await page.getByRole("textbox").first().inputValue()).length, {
      timeout: 15_000,
    })
    .toBeGreaterThan(40);

  await page.getByRole("button", { name: "Desanexar" }).click();
  await expect(chip).toHaveCount(0);
  expect(new URL(page.url()).search).toBe("");
});
