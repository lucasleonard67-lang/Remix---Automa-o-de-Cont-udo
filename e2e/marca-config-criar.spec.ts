import { expect, test, type Page } from "@playwright/test";

import { gotoAndExpectHeading } from "./helpers";

/** Seção de Ajustes no menu lateral do SettingsLayout (kit DS SUBIDO). */
const secao = (page: import("@playwright/test").Page, nome: string) =>
  page
    .getByRole("navigation", { name: "Seções" })
    .getByRole("button", { name: new RegExp(`^${nome}(\\s|$)`) });

// Marca (hub + subpáginas), Config (abas e modal de convite) e o criador da home (form de
// geração). Nada aqui dispara geração paga nem convida usuário de verdade.

const MARCA_SUBPAGES = [
  { card: "Persona", path: "/marca/persona" },
  { card: "Bandeira", path: "/marca/bandeira" },
  { card: "Regras da marca", path: "/marca/guardrails" },
  { card: "Identidade visual", path: "/marca/brand-kit" },
  { card: "Canais", path: "/marca/canais" },
  { card: "Apresentadores", path: "/marca/avatares" },
];

test("hub da marca abre cada subpágina e volta", async ({ page }) => {
  for (const sub of MARCA_SUBPAGES) {
    await gotoAndExpectHeading(page, "/marca", "Marca");
    // main, não a sidebar: os nomes se repetem na navegação
    await page
      .getByRole("main")
      .getByRole("link", { name: new RegExp(sub.card) })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`${sub.path}$`), { timeout: 15_000 });
    await expect(page.getByRole("heading").first()).toBeVisible();
  }
});

test("config lista as abas de administração", async ({ page }) => {
  await gotoAndExpectHeading(page, "/config", "Ajustes");
  await expect(page.getByRole("tablist").first()).toBeVisible();
});

test("config/IA: modelo é select por driver, com escape hatch e troca coerente", async ({
  page,
}) => {
  await gotoAndExpectHeading(page, "/config", "Ajustes");
  await secao(page, "IA").click();
  await expect(page.getByText("Provedores por papel")).toBeVisible();

  const driverGerador = page.getByLabel("Provedor do papel Gerador");
  const modeloGerador = page.getByLabel("Modelo do papel Gerador", { exact: true });
  // modelo virou SELECT (era input de texto livre: errar o ID só aparecia na geração)
  await expect(modeloGerador).toHaveRole("combobox");

  // catálogo do gateway
  await modeloGerador.click();
  await expect(page.getByRole("option", { name: /Gemini 2.5 Pro/ })).toBeVisible();
  await page.keyboard.press("Escape");

  // trocar de driver troca o catálogo e limpa modelo que não vale mais
  await driverGerador.click();
  await page.getByRole("option", { name: "Anthropic (chave própria)" }).click();
  await expect(modeloGerador).toContainText("Modelo padrão");
  await modeloGerador.click();
  await expect(page.getByRole("option", { name: /Claude Opus 5/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /Gemini/ })).toHaveCount(0);

  // escape hatch: modelo novo não trava esperando deploy
  await page.getByRole("option", { name: /Outro \(digitar ID\)/ }).click();
  await expect(page.getByLabel("ID do modelo do papel Gerador")).toBeVisible();

  // sai sem salvar — config de IA é global da instância (há um Descartar por card)
  await page.getByRole("button", { name: "Descartar" }).first().click();
});

test("convite de usuário valida o e-mail antes de enviar", async ({ page }) => {
  await gotoAndExpectHeading(page, "/config", "Ajustes");
  const invite = page.getByRole("button", { name: /Convidar/ }).first();
  if (!(await invite.isVisible().catch(() => false))) test.skip();
  await invite.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const submit = dialog.getByRole("button", { name: /Convidar|Enviar/ }).last();
  // sem e-mail o envio fica bloqueado (não deixa clicar em algo que falharia)
  await expect(submit).toBeDisabled();
  await dialog.getByRole("textbox").first().fill("convidado.teste@viverdeia.ai");
  await expect(submit).toBeEnabled();
  // NÃO enviamos: convite real cria usuário. Fecha e confirma que fechou.
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("integrações: Higgsfield tem card com status e ação de conectar", async ({ page }) => {
  await gotoAndExpectHeading(page, "/config", "Ajustes");
  await secao(page, "Integrações").click();

  const card = page.getByTestId("higgsfield-card");
  await expect(card).toBeVisible();
  await expect(card.getByText("Higgsfield", { exact: true })).toBeVisible();

  // o status vem do servidor (conectado ou não), nunca um token
  const status = page.getByTestId("higgsfield-status");
  await expect(status).toBeVisible();
  const texto = (await status.textContent())?.trim() ?? "";
  expect(["Conectado", "Não conectado"]).toContain(texto);

  // a ação existe nos dois estados: conectar quando falta, reconectar quando já tem
  const acao =
    texto === "Conectado"
      ? page.getByTestId("higgsfield-reconnect")
      : page.getByTestId("higgsfield-connect");
  await expect(acao).toBeEnabled();
  // NÃO clicamos: o clique abre a tela de autorização do provedor
});

// A volta do OAuth chega como ?higgsfield=<desfecho>: o callback da edge só
// manda o código, o texto é do app. Sem clicar em nada — é só a URL de retorno.
test("volta do OAuth do Higgsfield avisa, abre Integrações e limpa a URL", async ({ page }) => {
  await gotoAndExpectHeading(page, "/config?higgsfield=conectado", "Ajustes");

  await expect(page.locator("[data-sonner-toast]").first()).toContainText("Higgsfield conectado");
  // cai na aba certa, senão parece que a autorização não fez nada
  await expect(secao(page, "Integrações")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("higgsfield-card")).toBeVisible();
  // recarregar não pode repetir o aviso
  await expect(page).not.toHaveURL(/higgsfield=/);
});

test("volta do OAuth com falha explica o que houve", async ({ page }) => {
  await gotoAndExpectHeading(page, "/config?higgsfield=expirado", "Ajustes");
  const toast = page.locator("[data-sonner-toast]").first();
  await expect(toast).toContainText("Tempo esgotado");
  await expect(toast).toContainText(/15 minutos/);
  await expect(page).not.toHaveURL(/higgsfield=/);
});

/** /criar: o campo do tema já está à vista (opcional) com os ladrilhos abaixo. */
async function openCriarWithFormat(page: Page) {
  await gotoAndExpectHeading(page, "/criar", "Criar conteúdo");
  const tile = page.getByTestId("criar-formato-instagram_post");
  await expect(tile).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("textbox", { name: "Tema da peça" })).toBeVisible();
}

test("criar: o form aceita briefing e libera o Gerar", async ({ page }) => {
  await openCriarWithFormat(page);
  const prompt = page.getByRole("textbox", { name: "Tema da peça" });
  await prompt.fill("Teste de interface — não gerar.");
  await expect(prompt).toHaveValue("Teste de interface — não gerar.");
  // o botão Gerar existe e está habilitado com prompt preenchido
  await expect(page.getByRole("button", { name: /^Gerar/ })).toBeEnabled();
});

test("criar: sem briefing o botão Gerar fica desabilitado", async ({ page }) => {
  await openCriarWithFormat(page);
  await expect(page.getByRole("button", { name: /^Gerar/ })).toBeDisabled();
});

// Geração de post: o "Gerar" leva para a página daquela postagem, e a pesquisa
// web começa DESLIGADA. Nada aqui dispara geração (custa crédito).
test("criar: pesquisa web começa desligada e pode ser ligada", async ({ page }) => {
  await openCriarWithFormat(page);
  const chip = page.getByRole("button", { name: /Pesquisa web/ }).first();
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await expect(chip).toContainText("desligada");
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
});

// A página de UMA geração continua alcançável pela Biblioteca (Origem → Geração)
// e devolve para Criar conteúdo.
test("criar: a geração tem página própria, alcançável pela Biblioteca e com volta", async ({
  page,
}) => {
  await gotoAndExpectHeading(page, "/biblioteca", "Biblioteca");
  const peca = page.locator('a[href^="/biblioteca/"]').first();
  const temPeca = await peca
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  test.skip(!temPeca, "sem peças na Biblioteca");
  await peca.click();
  await page.getByRole("button", { name: "Origem" }).click();
  await page.getByTestId("piece-geracao-link").click();

  await expect(page).toHaveURL(/\/criar\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Postagem em criação" })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("link", { name: "Voltar para Criar" }).first().click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe("/criar");
});

test("criar: endereço de geração inválido explica em vez de girar", async ({ page }) => {
  await page.goto("/criar/nao-existe");
  await expect(page.getByText("Geração não encontrada")).toBeVisible({ timeout: 15_000 });
});

// Conector MCP: o card existe e diz o escopo. NÃO criamos token aqui —
// criar deixa credencial viva na instância.
test("integrações: conector MCP explica o escopo e oferece criar token", async ({ page }) => {
  await gotoAndExpectHeading(page, "/config", "Ajustes");
  await secao(page, "Integrações").click();

  const card = page.getByTestId("mcp-card");
  await expect(card).toBeVisible({ timeout: 20_000 });
  // o limite do escopo é parte do produto, não nota de rodapé
  await expect(card).toContainText(/Aprovar e publicar continuam só por aqui/);
  await expect(page.getByTestId("criar-token-mcp")).toBeEnabled();
});

// Automação: a página existe, promete o que o produto cumpre e valida o form.
// Nenhum gatilho é criado — gatilho vivo gera conteúdo pago sozinho.
test("automação: promete parar na aprovação e valida o gatilho", async ({ page }) => {
  await gotoAndExpectHeading(page, "/automacao", "Automação");
  await expect(page.getByText("Nada vai ao ar sem você")).toBeVisible();

  await page.getByTestId("novo-gatilho").click();
  await expect(page.getByLabel("Nome")).toBeVisible();
  // sem nome, o form explica em vez de falhar calado
  await page.getByRole("button", { name: "Criar gatilho" }).click();
  await expect(page.locator("[data-sonner-toast]").first()).toContainText(/nome ao gatilho/i);
});

test("instância: diagnóstico real, sem marcador de fase interna", async ({ page }) => {
  await gotoAndExpectHeading(page, "/config", "Ajustes");
  await secao(page, "Instância").click();

  // A aba dizia "em construção — chega na fase F5": anotação de plano interno
  // exposta a quem não sabe o que é uma fase. Não pode voltar.
  await expect(page.getByText(/em constru/i)).toHaveCount(0);
  await expect(page.getByText(/fase F\d/i)).toHaveCount(0);

  // E antes de mostrar número, a aba explica o que É uma instância.
  await expect(page.getByText(/instância dedicada/i)).toBeVisible();
  await expect(page.getByText(/Saúde do motor/)).toBeVisible();
  await expect(page.getByText(/Rotinas automáticas/)).toBeVisible();

  // Os contadores saem do banco: número de verdade, não placeholder.
  const total = await page
    .getByText("Gerações no total")
    .locator("xpath=following-sibling::*[1]")
    .textContent();
  expect(Number(total)).toBeGreaterThanOrEqual(0);
});

test("sem alteração, ativar fica indisponível — o histórico não incha", async ({ page }) => {
  // O número da versão é o que a Proveniência da peça carimba ("esta peça saiu
  // da v1"). Encher o histórico de versões idênticas faz esse número deixar de
  // significar alguma coisa, então ativar sem editar tem que ser impossível.
  await page.goto("/marca/brand-kit");
  await expect(page.getByRole("heading", { name: "Identidade visual" }).first()).toBeVisible({
    timeout: 20_000,
  });

  const ativar = page.getByRole("button", { name: "Ativar versão" }).first();
  await expect(ativar, "sem rascunho nem edição, ativar fica desabilitado").toBeDisabled();

  // Editar habilita: o botão responde ao conteúdo, não ao clique.
  await page.getByLabel(/Títulos/).fill("Cinzel");
  await expect(ativar).toBeEnabled();

  // Desfaz para não deixar rascunho para trás — teste não suja dado.
  await page.getByRole("button", { name: "Descartar" }).click();
  await page.waitForTimeout(1200);
});

test("integrações: ElevenLabs pede key e voice id, e mostra status de cada um", async ({
  page,
}) => {
  await gotoAndExpectHeading(page, "/config", "Ajustes");
  await secao(page, "Integrações").click();

  const card = page.getByTestId("eleven-card");
  await expect(card).toBeVisible();

  // Os dois valores que o Diretor lê do Vault têm campo próprio — antes só
  // entravam por SQL, e quando faltavam a produção morria no meio.
  for (const nome of ["ELEVEN_API_KEY", "ELEVEN_VOICE_ID"] as const) {
    await expect(card.getByLabel(`Valor de ${nome}`)).toBeVisible();
    const status = card.getByTestId(`eleven-status-${nome}`);
    await expect(status).toBeVisible();
    const texto = (await status.textContent())?.trim() ?? "";
    expect(["configurado", "não configurado"]).toContain(texto);
  }

  // A key é mascarada; o voice id não é segredo e aparece em texto normal.
  await expect(card.getByLabel("Valor de ELEVEN_API_KEY")).toHaveAttribute("type", "password");
  await expect(card.getByLabel("Valor de ELEVEN_VOICE_ID")).toHaveAttribute("type", "text");
});
