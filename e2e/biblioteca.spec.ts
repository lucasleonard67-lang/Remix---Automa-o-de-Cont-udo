import { expect, test, type Page } from "@playwright/test";

import {
  IDS,
  instalarBiblioteca,
  MARCA_COM_EMOJI,
  PALAVRA_SEM_ESPACO,
  pecasEmVolume,
  POR_ABA,
  TEXTO_COM_EMOJI,
  TEXTO_LONGO,
} from "./fixtures/biblioteca";
import { collectPageErrors, gotoAndExpectHeading } from "./helpers";

// Biblioteca: abas de status, busca, alternância galeria/calendário e o detalhe
// da peça com os modais de veredito e regeneração.
// Roda sem banco: a fixture responde o Supabase no navegador, então os dados são
// sempre os mesmos e nenhuma peça real é tocada. Rode com --no-deps, sem o login.

test.use({ storageState: { cookies: [], origins: [] } });

let supabase: Awaited<ReturnType<typeof instalarBiblioteca>>;

test.beforeEach(async ({ page }, info) => {
  if (!info.title.includes("60 peças")) supabase = await instalarBiblioteca(page);
});

const galeria = (page: Page) => page.getByTestId("galeria-pecas");
const cards = (page: Page) => page.getByTestId("peca-card");
const card = (page: Page, id: string) => page.locator(`[data-testid="peca-card"][href*="${id}"]`);

/** A galeria entra aos poucos: rola até não chegar mais nada. */
async function rolarAteOFim(page: Page) {
  let antes = -1;
  while ((await cards(page).count()) !== antes) {
    antes = await cards(page).count();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

test("abas de status filtram a listagem", async ({ page }) => {
  await gotoAndExpectHeading(page, "/biblioteca", "Biblioteca");
  await expect(page.getByRole("tab", { name: "Em revisão" })).toHaveAttribute(
    "data-state",
    "active",
  );
  for (const tab of ["Aprovadas", "Publicadas", "Rejeitadas", "Arquivadas"]) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("data-state", "active");
    await expect(cards(page)).toHaveCount(POR_ABA[tab as keyof typeof POR_ABA]);
  }
});

test("aba mostra a mesma contagem que a galeria", async ({ page }) => {
  await gotoAndExpectHeading(page, "/biblioteca", "Biblioteca");
  for (const [aba, total] of Object.entries(POR_ABA)) {
    await expect(page.getByRole("tab", { name: aba })).toContainText(String(total));
  }
});

test("alternar entre galeria e calendário", async ({ page }) => {
  await gotoAndExpectHeading(page, "/biblioteca", "Biblioteca");
  await page.getByRole("button", { name: "Calendário" }).click();
  await expect(galeria(page)).toBeHidden();
  await page.getByRole("button", { name: "Galeria" }).click();
  await expect(galeria(page)).toBeVisible();
});

test("busca por texto filtra as peças", async ({ page }) => {
  await gotoAndExpectHeading(page, "/biblioteca", "Biblioteca");
  await page.getByRole("textbox", { name: "Buscar peças" }).fill("zzz-nao-existe-zzz");
  // estado vazio de BUSCA é diferente do de aba vazia
  await expect(page.getByText("Nenhuma peça com esses filtros")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Limpe os filtros/)).toBeVisible();
});

test("detalhe da peça abre e valida o modal de rejeição", async ({ page }) => {
  await gotoAndExpectHeading(page, "/biblioteca", "Biblioteca");
  const firstCard = cards(page).first();
  await expect(firstCard).toBeVisible({ timeout: 15_000 });
  await firstCard.click();
  await expect(page).toHaveURL(/\/biblioteca\/[0-9a-f-]{36}$/);

  const reject = page.getByRole("button", { name: /Rejeitar/ }).first();
  if (await reject.isVisible().catch(() => false)) {
    await reject.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // rejeitar sem motivo precisa explicar (era return silencioso)
    await dialog
      .getByRole("button", { name: /Rejeitar|Confirmar/ })
      .last()
      .click();
    await expect(page.getByText(/motivo da rejeição/i)).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  }
});

// Sem peça aberta, a galeria É a página. A fila NÃO fica na frente com uma peça
// aberta — ela mais a nav global comiam ~600px antes do conteúdo, e a peça era
// lida por uma fresta. Volta pelo botão, como coluna compacta.
test("abrir a peça tira a fila da frente, e o botão devolve", async ({ page }) => {
  await gotoAndExpectHeading(page, "/biblioteca", "Biblioteca");
  await expect(galeria(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("fila-revisao")).toBeHidden();

  await cards(page).first().click();
  await expect(page).toHaveURL(/\/biblioteca\/[0-9a-f-]{36}/, { timeout: 15_000 });
  await expect(galeria(page)).toBeHidden();

  await page.getByRole("button", { name: /Ver fila/ }).click();
  await expect(page.getByTestId("fila-revisao")).toBeVisible();
  await page.getByRole("button", { name: "Ocultar fila" }).click();
  await expect(page.getByTestId("fila-revisao")).toBeHidden();
});

test("segmento Agendadas existe e separa aprovada-sem-data", async ({ page }) => {
  await gotoAndExpectHeading(page, "/biblioteca", "Biblioteca");
  const agendadas = page.getByRole("tab", { name: /Agendadas/ });
  await expect(agendadas).toBeVisible();
  await agendadas.click();
  await expect(agendadas).toHaveAttribute("data-state", "active");
  // o segmento vive na URL — recarregar não pode contradizer a tela
  await expect(page).toHaveURL(/status=agendadas/);
});

// A decisão tem que estar ao alcance: ela vivia no fim do painel e caía a 93%
// da rolagem de uma peça de 2.518px.
test("peça em revisão mostra a decisão sem precisar rolar", async ({ page }) => {
  await gotoAndExpectHeading(page, "/biblioteca", "Biblioteca");
  await cards(page).first().click();
  await expect(page).toHaveURL(/\/biblioteca\/[0-9a-f-]{36}/, { timeout: 15_000 });

  const aprovar = page.getByRole("button", { name: "Aprovar", exact: true }).first();
  await expect(aprovar).toBeInViewport({ timeout: 20_000 });
});

// ?status inválido chegava ao PostgREST (HTTP 400) e a fila ficava em skeleton.
test("segmento inválido na URL cai no padrão em vez de quebrar", async ({ page }) => {
  await page.goto("/biblioteca?status=lixo");
  await expect(galeria(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("tab", { name: /Em revisão/ })).toHaveAttribute(
    "data-state",
    "active",
  );
});

// --- Galeria ---------------------------------------------------------------

test("os oito formatos aparecem, com e sem arte", async ({ page }) => {
  await gotoAndExpectHeading(page, "/biblioteca", "Biblioteca");
  await rolarAteOFim(page);
  for (const id of [...IDS.formatos, ...IDS.semArte]) await expect(card(page, id)).toHaveCount(1);
});

test("imagem que falha não vira ícone quebrado nem erro na tela", async ({ page }) => {
  const erros = collectPageErrors(page);
  await gotoAndExpectHeading(page, "/biblioteca", "Biblioteca");
  await rolarAteOFim(page);
  for (const id of IDS.imagemFalha) {
    const alvo = card(page, id);
    await alvo.scrollIntoViewIfNeeded();
    await expect(alvo).not.toBeEmpty();
    const quebradas = await alvo
      .locator("img")
      .evaluateAll(
        (imgs) =>
          imgs.filter(
            (i) => (i as HTMLImageElement).complete && !(i as HTMLImageElement).naturalWidth,
          ).length,
      );
    expect(quebradas).toBe(0);
  }
  expect(erros.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
});

test("em revisão a capa pinta do texto; aprovada usa o PNG final", async ({ page }) => {
  await gotoAndExpectHeading(page, "/biblioteca", "Biblioteca");
  await rolarAteOFim(page);
  const revisao = card(page, IDS.pngEmRevisao);
  await revisao.scrollIntoViewIfNeeded();
  await expect(revisao.getByTestId("piece-cover")).toHaveAttribute("data-cover", "deck");
  await expect(revisao.getByTestId("piece-cover")).toContainText("Peça 42");
  expect([...supabase.baixados].filter((a) => a.startsWith("pecas/final/42-"))).toEqual([]);

  await page.getByRole("tab", { name: "Aprovadas" }).click();
  const aprovada = card(page, IDS.pngAprovada);
  await expect(aprovada.locator("img")).toHaveJSProperty("complete", true);
  expect(await aprovada.locator("img").getAttribute("src")).toContain("pecas/final/43-0.png");
});

test("Reel com vídeo mostra o quadro; sem vídeo ou com vídeo quebrado, o texto", async ({
  page,
}) => {
  await gotoAndExpectHeading(page, "/biblioteca", "Biblioteca");
  await rolarAteOFim(page);
  const comVideo = card(page, IDS.formatos[3]);
  await comVideo.scrollIntoViewIfNeeded();
  await expect(comVideo.getByTestId("piece-cover")).toHaveAttribute("data-cover", "video");
  await expect
    .poll(() => comVideo.locator("video").evaluate((v) => (v as HTMLVideoElement).readyState))
    .toBeGreaterThanOrEqual(2);

  for (const id of [IDS.semArte[3], IDS.imagemFalha[3]]) {
    const semVideo = card(page, id);
    await semVideo.scrollIntoViewIfNeeded();
    await expect(semVideo.locator("video")).toHaveCount(0);
    await expect(semVideo.getByTestId("piece-cover")).toContainText("como organizar");
  }
});

test("LinkedIn acima de 280 caracteres corta com reticências na capa", async ({ page }) => {
  await gotoAndExpectHeading(page, "/biblioteca", "Biblioteca");
  await rolarAteOFim(page);
  const capa = card(page, IDS.longos[3]).getByTestId("piece-cover");
  await capa.scrollIntoViewIfNeeded();
  await expect(capa).toContainText("Texto muito longo");
  const texto = (await capa.textContent()) ?? "";
  expect(texto.length).toBeLessThanOrEqual(400);
  expect(texto).toContain("…");
});

test("texto longo e palavra sem espaço ficam dentro do card", async ({ page }) => {
  await gotoAndExpectHeading(page, "/biblioteca", "Biblioteca");
  await rolarAteOFim(page);
  const alturas: number[] = [];
  for (const id of [...IDS.longos, IDS.semEspaco]) {
    const alvo = card(page, id);
    await alvo.scrollIntoViewIfNeeded();
    const caixa = await alvo.boundingBox();
    const li = await alvo.locator("xpath=..").boundingBox();
    expect(caixa!.width).toBeLessThanOrEqual(li!.width + 0.5);
    alturas.push(caixa!.height);
  }
  expect(Math.max(...alturas) - Math.min(...alturas)).toBeLessThanOrEqual(24);
  await expect(card(page, IDS.longos[0])).toContainText(TEXTO_LONGO.slice(0, 30));
  await expect(card(page, IDS.semEspaco)).toContainText(PALAVRA_SEM_ESPACO.slice(0, 30));
  await expect(page.locator("html")).toHaveJSProperty("scrollLeft", 0);
});

test("emoji no texto e no nome da marca", async ({ page }) => {
  await gotoAndExpectHeading(page, "/biblioteca", "Biblioteca");
  await rolarAteOFim(page);
  await expect(card(page, IDS.emoji)).toContainText(TEXTO_COM_EMOJI);
  await page.goto(`/biblioteca/${IDS.formatos[0]}`);
  await expect(page.getByText(MARCA_COM_EMOJI).first()).toBeVisible({ timeout: 20_000 });
});

test("filtro de canal reduz a galeria ao formato escolhido", async ({ page }) => {
  await gotoAndExpectHeading(page, "/biblioteca", "Biblioteca");
  await page.getByRole("combobox", { name: "Filtrar por canal" }).click();
  await page.getByRole("option", { name: /X/ }).first().click();
  await expect(card(page, IDS.formatos[4])).toBeVisible();
  await expect(card(page, IDS.formatos[0])).toHaveCount(0);
});

test("teclado chega no card e abre a peça, com foco visível", async ({ page }) => {
  await gotoAndExpectHeading(page, "/biblioteca", "Biblioteca");
  const primeiro = cards(page).first();
  await expect(primeiro).toBeVisible();
  await primeiro.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(primeiro).toBeFocused();
  const anel = await primeiro
    .locator("> span")
    .first()
    .evaluate((el) => getComputedStyle(el).boxShadow);
  expect(anel).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/biblioteca\/[0-9a-f-]{36}/);
});

for (const [largura, altura] of [
  [390, 844],
  [768, 1024],
  [1280, 800],
  [1920, 1080],
]) {
  test(`grade alinhada e sem rolagem lateral em ${largura}px`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: altura });
    await gotoAndExpectHeading(page, "/biblioteca", "Biblioteca");
    await expect(cards(page).first()).toBeVisible();
    await page.waitForTimeout(800);
    const medida = await page.evaluate(() => {
      const itens = [...document.querySelectorAll('[data-testid="peca-card"]')].map((el) =>
        el.firstElementChild!.getBoundingClientRect(),
      );
      const topo = itens[0].top;
      const linha = itens.filter((c) => Math.abs(c.top - topo) < 1);
      return {
        sobra: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        colunas: linha.length,
        larguras: new Set(itens.map((c) => Math.round(c.width))).size,
        alturas: new Set(itens.map((c) => Math.round(c.height))).size,
      };
    });
    expect(medida.sobra).toBe(0);
    expect(medida.colunas).toBeGreaterThanOrEqual(2);
    expect(medida.larguras).toBe(1);
    expect(medida.alturas).toBe(1);
  });
}

test("60 peças entram aos poucos, todas chegam e a rolagem não trava", async ({ page }) => {
  await instalarBiblioteca(page, { pecas: pecasEmVolume() });
  await gotoAndExpectHeading(page, "/biblioteca", "Biblioteca");
  await expect(cards(page).first()).toBeVisible();
  expect(await cards(page).count()).toBeLessThanOrEqual(48);

  const pior = await page.evaluate(
    () =>
      new Promise<number>((fim) => {
        let ultimo = performance.now();
        let maior = 0;
        const quadro = (agora: number) => {
          maior = Math.max(maior, agora - ultimo);
          ultimo = agora;
          window.scrollBy(0, 120);
          const noFim =
            window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
          if (noFim && document.querySelectorAll('[data-testid="peca-card"]').length >= 60)
            fim(maior);
          else requestAnimationFrame(quadro);
        };
        requestAnimationFrame(quadro);
      }),
  );
  await expect(cards(page)).toHaveCount(60);
  test.info().annotations.push({ type: "maior-quadro-ms", description: String(Math.round(pior)) });
  expect(pior).toBeLessThan(250);
});

test("a galeria só lê: nenhuma escrita ao navegar", async ({ page }) => {
  await gotoAndExpectHeading(page, "/biblioteca", "Biblioteca");
  await rolarAteOFim(page);
  expect(supabase.escritas).toEqual([]);
  expect([...supabase.semDado].filter((t) => t === "content_pieces")).toEqual([]);
});

test("excluir pede confirmação e só depois chama o servidor", async ({ page }) => {
  const pedidos: unknown[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/functions/v1/delete-content") && req.method() === "POST") {
      pedidos.push(req.postDataJSON());
    }
  });
  await page.goto(`/biblioteca/${IDS.formatos[1]}`);
  const excluir = page.getByRole("button", { name: "Excluir", exact: true });
  await expect(excluir).toBeVisible({ timeout: 20_000 });

  await excluir.click();
  await page.getByRole("button", { name: "Manter" }).click();
  expect(pedidos).toEqual([]);

  await excluir.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Excluir" }).click();
  await expect(page).toHaveURL(/\/biblioteca(\?.*)?$/);
  expect(pedidos).toEqual([{ kind: "piece", id: IDS.formatos[1] }]);
});

test("peça arquivada ainda pode ser excluída", async ({ page }) => {
  await page.goto(`/biblioteca/${IDS.arquivada}`);
  await expect(page.getByRole("button", { name: "Excluir", exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("button", { name: "Arquivar" })).toHaveCount(0);
});

async function responderEdicao(page: Page, gerar_foto = false) {
  const pedidos: Record<string, unknown>[] = [];
  await page.context().route(/functions\/v1\/edit-slide/, (route) => {
    const req = route.request();
    if (req.method() === "POST") pedidos.push(req.postDataJSON());
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" },
      body: JSON.stringify({ gerar_foto, conferir: ["30"] }),
    });
  });
  return pedidos;
}

test("pedido muda só o slide aberto", async ({ page }) => {
  const pedidos = await responderEdicao(page);
  await page.goto(`/biblioteca/${IDS.formatos[0]}`);
  const campo = page.getByLabel("O que mudar neste slide");
  await expect(campo).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Aplicar neste slide" })).toBeDisabled();

  await page.getByRole("button", { name: "Próximo" }).click();
  await campo.fill("encurte o texto");
  await page.getByRole("button", { name: "Aplicar neste slide" }).click();
  await expect(campo).toHaveValue("");
  expect(pedidos).toEqual([
    { piece_id: IDS.formatos[0], index: 1, confirmar: false, instruction: "encurte o texto" },
  ]);
});

test("foto nova gera só aquele slide", async ({ page }) => {
  await responderEdicao(page, true);
  const lotes: unknown[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/functions/v1/generate-image") && req.method() === "POST") {
      lotes.push(req.postDataJSON());
    }
  });
  await page.goto(`/biblioteca/${IDS.formatos[0]}`);
  const campo = page.getByLabel("O que mudar neste slide");
  await expect(campo).toBeVisible({ timeout: 20_000 });
  await campo.fill("troque a foto");
  await page.getByRole("button", { name: "Aplicar neste slide" }).click();
  await expect.poll(() => lotes.length).toBe(1);
  expect(lotes[0]).toEqual({ piece_id: IDS.formatos[0], scope: "slides", slide_indexes: [0] });
});

test("stories fala em quadro", async ({ page }) => {
  await page.goto(`/biblioteca/${IDS.formatos[2]}`);
  await expect(page.getByLabel("O que mudar neste quadro")).toBeVisible({ timeout: 20_000 });
});

test("peça fora da revisão pede confirmação antes de mudar", async ({ page }) => {
  const pedidos = await responderEdicao(page);
  await page.goto("/biblioteca?status=approved");
  await page.getByRole("tab", { name: "Aprovadas" }).click();
  await page.goto(`/biblioteca/${IDS.pngAprovada}`);
  const campo = page.getByLabel("O que mudar neste slide");
  await expect(campo).toBeVisible({ timeout: 20_000 });
  await campo.fill("troque o título");
  await page.getByRole("button", { name: "Aplicar neste slide" }).click();
  expect(pedidos).toEqual([]);
  await page.getByRole("alertdialog").getByRole("button", { name: "Mudar" }).click();
  await expect.poll(() => pedidos.length).toBe(1);
  expect(pedidos[0].confirmar).toBe(true);
});

test("peça arquivada não edita por slide", async ({ page }) => {
  await page.goto(`/biblioteca/${IDS.arquivada}`);
  await expect(page.getByRole("button", { name: "Excluir", exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByLabel(/O que mudar neste/)).toHaveCount(0);
});

test("Gerar segue o fluxo da tela, sem desviar para a fila do Claude", async ({ page }) => {
  const pedidos: Record<string, unknown>[] = [];
  await page.context().route(/functions\/v1\/generate-content/, (route) => {
    const req = route.request();
    if (req.method() === "POST") pedidos.push(req.postDataJSON());
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" },
      body: JSON.stringify({
        job_id: "11111111-1111-4111-8111-111111111111",
        status: "classifying",
      }),
    });
  });
  await page.goto("/criar");
  await page.getByLabel("Tema da peça").fill("Tema de teste");
  await expect(page.getByTestId("ai-choice")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Pedir ao meu Claude" })).toHaveCount(0);
  const gerar = page.getByRole("button", { name: "Gerar", exact: true });
  await expect(gerar).toBeEnabled({ timeout: 20_000 });
  await gerar.click();
  await expect.poll(() => pedidos.length).toBe(1);
  expect(pedidos[0].pedir_ao_claude).toBeUndefined();
});
