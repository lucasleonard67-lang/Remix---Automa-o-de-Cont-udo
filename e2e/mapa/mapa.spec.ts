import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// MAPA DE FLUXOS — captura, não regressão.
//
// Percorre a plataforma inteira, tira um print de cada tela e de cada ação que
// muda o que se vê, e escreve um índice em JSON com o que havia na tela
// (títulos, abas, botões). O documento é montado a partir desse índice.
//
// Roda por pedido: `npx playwright test --project=mapa`. Fica FORA do portão
// de qualidade (testIgnore no projeto chromium) — spec de screenshot que
// quebra o gate ensina o time a ignorar o gate.
//
// REGRA DESTA PASSAGEM: nada de escrever no banco. O wizard de onboarding é
// percorrido em LEITURA (avança pelos passos, nunca salva), porque ele grava
// documentos de marca de verdade e a instância está com o brand kit vazio.
// ---------------------------------------------------------------------------

const SAIDA = path.resolve("mapa-de-fluxos");
const PRINTS = path.join(SAIDA, "attachments");

interface Tela {
  id: string;
  titulo: string;
  rota: string;
  print: string;
  h1: string[];
  abas: string[];
  acoes: string[];
  nota?: string;
  erro?: string;
}

const telas: Tela[] = [];

/** O que está na tela, na linguagem de quem olha (não do DOM). */
async function inventario(page: Page) {
  return page.evaluate(() => {
    const texto = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
    const visivel = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const unicos = (xs: string[]) => [...new Set(xs.filter((x) => x && x.length < 60))];
    return {
      h1: unicos([...document.querySelectorAll("h1, h2")].filter(visivel).map(texto)).slice(0, 8),
      abas: unicos(
        [...document.querySelectorAll('[role="tab"], [role="tablist"] button')]
          .filter(visivel)
          .map(texto),
      ).slice(0, 12),
      acoes: unicos(
        [...document.querySelectorAll("button, a[href]")]
          .filter(visivel)
          .map(texto)
          .filter((t) => t.length > 1),
      ).slice(0, 24),
    };
  });
}

/**
 * O app é SSR e redireciona para /login antes de a sessão ser restaurada no
 * cliente. Esperar tempo fixo capturava a tela de login no lugar da rota —
 * aconteceu em 5 das 26 telas da primeira passagem, e todas tinham o mesmo
 * tamanho de arquivo, que foi como o defeito apareceu. Agora espera o caminho.
 */
async function chegarEm(page: Page, rota: string) {
  await page.goto(rota);
  await page
    .waitForFunction((alvo) => window.location.pathname === alvo, rota, { timeout: 25_000 })
    .catch(() => {});
}

async function capturar(
  page: Page,
  id: string,
  titulo: string,
  opcoes: { nota?: string; espera?: string | RegExp } = {},
) {
  const print = `${id}.png`;
  const tela: Tela = {
    id,
    titulo,
    rota: new URL(page.url()).pathname,
    print,
    h1: [],
    abas: [],
    acoes: [],
    nota: opcoes.nota,
  };
  try {
    if (opcoes.espera) {
      await expect(page.getByText(opcoes.espera).first()).toBeVisible({ timeout: 20_000 });
    }
    // deixa fonte/imagem/animação assentarem antes do clique do obturador
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1200);
    Object.assign(tela, await inventario(page));
    await page.screenshot({ path: path.join(PRINTS, print), fullPage: true });
  } catch (err) {
    tela.erro = err instanceof Error ? err.message.split("\n")[0] : String(err);
    await page.screenshot({ path: path.join(PRINTS, print), fullPage: true }).catch(() => {});
  }
  telas.push(tela);
}

test.beforeAll(async () => {
  await mkdir(PRINTS, { recursive: true });
});

test.afterAll(async () => {
  await writeFile(path.join(SAIDA, "indice.json"), JSON.stringify(telas, null, 2), "utf-8");
});

// ── 1. Porta de entrada ────────────────────────────────────────────────────
test("01 · login", async ({ browser }) => {
  // sessão limpa de propósito: é a tela de quem ainda não entrou
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.waitForTimeout(2500);
  await mkdir(PRINTS, { recursive: true });
  await page.screenshot({ path: path.join(PRINTS, "01-login.png"), fullPage: true });
  telas.push({
    id: "01-login",
    titulo: "Login",
    rota: "/login",
    print: "01-login.png",
    h1: ["Content Engine"],
    abas: [],
    acoes: ["Entrar"],
    nota: "Entrada única da instância. Sem cadastro aberto: novos usuários entram por convite.",
  });
  await ctx.close();
});

// ── 2. Onboarding (leitura) ────────────────────────────────────────────────
const PASSOS_ONBOARDING = [
  "Boas-vindas",
  "IA e integrações",
  "Conteúdo de contexto",
  "Voz",
  "Bandeira",
  "Guardrails",
  "Brand kit",
  "Canais",
  "Gate de tom",
];

test("02 · onboarding passo a passo", async ({ page }) => {
  await chegarEm(page, "/onboarding");
  await expect(page.getByText(/PASSO \d+ DE \d+/i)).toBeVisible({ timeout: 25_000 });

  // O passo é estado LOCAL do componente (não vai na URL), então a única
  // navegação possível é clicar na trilha — e a trilha só habilita passo já
  // concluído. Por isso esta passagem exige `completed_steps` destravado.
  for (let i = 0; i < PASSOS_ONBOARDING.length; i++) {
    const nome = PASSOS_ONBOARDING[i];
    const botao = page.getByRole("button", { name: new RegExp(`^${nome}`, "i") }).first();
    if (!(await botao.isVisible().catch(() => false))) continue;
    await botao.click().catch(() => {});
    await page.waitForTimeout(1400);
    const slug = nome
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    await capturar(
      page,
      `02-onboarding-${String(i + 1).padStart(2, "0")}-${slug}`,
      `Onboarding · passo ${i + 1} — ${nome}`,
      i === 0
        ? {
            nota: "Wizard de 9 passos, retomável. Percorrido em LEITURA nesta passagem: nenhum documento foi salvo.",
          }
        : {},
    );
  }
});

// ── 3. Telas do app ────────────────────────────────────────────────────────
const ROTAS: Array<{ id: string; rota: string; titulo: string; espera?: RegExp; nota?: string }> = [
  {
    id: "03-dashboard",
    rota: "/",
    titulo: "Início",
    nota: "A criação mora aqui: briefing livre + canais + pesquisa web opcional, ideias e desempenho.",
  },
  { id: "05-radar", rota: "/radar", titulo: "Radar", nota: "Notícias por RSS que viram pauta." },
  {
    id: "06-biblioteca",
    rota: "/biblioteca",
    titulo: "Biblioteca",
    nota: "Esteira de revisão. A fila fica grudada à esquerda.",
  },
  {
    id: "10-contexto",
    rota: "/contexto",
    titulo: "Contexto",
    nota: "Acervo que alimenta o RAG: transcrições, cases, referências.",
  },
  {
    id: "12-marca",
    rota: "/marca",
    titulo: "Marca",
    nota: "Hub dos documentos de marca, todos versionados.",
  },
  { id: "13-marca-persona", rota: "/marca/persona", titulo: "Marca · Persona" },
  { id: "14-marca-bandeira", rota: "/marca/bandeira", titulo: "Marca · Bandeira" },
  {
    id: "15-marca-brand-kit",
    rota: "/marca/brand-kit",
    titulo: "Marca · Brand Kit",
    nota: "ESTADO ATUAL: nenhuma versão ativa no banco, então a prévia da arte aparece no padrão.",
  },
  { id: "16-marca-canais", rota: "/marca/canais", titulo: "Marca · Canais" },
  { id: "17-marca-guardrails", rota: "/marca/guardrails", titulo: "Marca · Guardrails" },
  { id: "18-marca-avatares", rota: "/marca/avatares", titulo: "Apresentadores" },
  { id: "19-videos", rota: "/videos", titulo: "Vídeos", nota: "Biblioteca de produções." },
  { id: "20-videos-novo", rota: "/videos/novo", titulo: "Vídeos · Nova produção" },
  {
    id: "21-identidades",
    rota: "/identidades",
    titulo: "Avatares (redirect)",
    nota: "Rota legada: redireciona para Apresentadores.",
  },
  {
    id: "22-automacao",
    rota: "/automacao",
    titulo: "Automação",
    nota: "Motor que gera sozinho e PARA na aprovação.",
  },
  {
    id: "23-config",
    rota: "/config",
    titulo: "Ajustes",
    nota: "IA, integrações (Zernio, Higgsfield, MCP) e usuários.",
  },
];

for (const r of ROTAS) {
  test(`03 · ${r.titulo}`, async ({ page }) => {
    await chegarEm(page, r.rota);
    await capturar(page, r.id, r.titulo, { nota: r.nota, espera: r.espera });
  });
}

// ── 4. Fluxos que só existem clicando ──────────────────────────────────────
test("04 · biblioteca: abas e calendário", async ({ page }) => {
  await chegarEm(page, "/biblioteca");
  await page.waitForTimeout(1500);
  for (const aba of ["Aprovadas", "Agendadas", "Publicadas"]) {
    const b = page.getByRole("tab", { name: new RegExp(aba) }).first();
    if (!(await b.isVisible().catch(() => false))) continue;
    await b.click().catch(() => {});
    await capturar(page, `07-biblioteca-${aba.toLowerCase()}`, `Biblioteca · ${aba}`);
  }
  const cal = page.getByRole("button", { name: /Calend/ }).first();
  if (await cal.isVisible().catch(() => false)) {
    await cal.click().catch(() => {});
    await capturar(page, "08-biblioteca-calendario", "Biblioteca · Calendário", {
      nota: "Mesma esteira vista por data de agendamento.",
    });
  }
});

test("04 · peça aberta e a fila recolhível", async ({ page }) => {
  await chegarEm(page, "/biblioteca");
  // A fila carrega assíncrona: esperar tempo fixo fazia o clique não achar o
  // card e a tela MAIS IMPORTANTE do produto ficava fora do mapa, calada.
  const card = page.locator('a[href^="/biblioteca/"]').first();
  await expect(card).toBeVisible({ timeout: 25_000 });
  await card.click();
  await expect(page).toHaveURL(/\/biblioteca\/[0-9a-f-]{36}/, { timeout: 20_000 });
  await page.waitForTimeout(3000);

  await capturar(page, "09-peca", "Peça aberta · revisão", {
    nota: "Decisão no topo, preview do canal à esquerda, ações e auditoria abaixo. A arte segue o design system da marca — não há seletor por peça. A fila sai da frente para o leitor ocupar a tela.",
  });

  const verFila = page.getByRole("button", { name: /Ver fila/ }).first();
  if (await verFila.isVisible().catch(() => false)) {
    await verFila.click();
    await page.waitForTimeout(1500);
    await capturar(page, "09b-peca-com-fila", "Peça aberta · fila trazida de volta", {
      nota: "O botão devolve a fila para pular de peça em peça sem voltar à lista.",
    });
  }
});

test("04 · abas de Config", async ({ page }) => {
  // O mapa capturava só a aba Usuários — e é nas outras que mora o que mais
  // importa (modelo de IA por papel, Zernio, Higgsfield, conector MCP).
  await chegarEm(page, "/config");
  // Esperar a rota não basta: as abas só existem depois que o componente
  // monta. Sem isto o laço achava tudo invisível, dava `continue` em todas e o
  // teste passava sem gravar print nenhum — verde mentiroso.
  // Ajustes usa o menu lateral do kit (SettingsLayout), não abas no topo.
  const secoes = page.getByRole("navigation", { name: "Seções" });
  await expect(secoes.getByRole("button", { name: /^Usuários/ })).toBeVisible({ timeout: 25_000 });
  for (const [i, aba] of ["IA", "Integrações", "Instância"].entries()) {
    const alvo = secoes.getByRole("button", { name: new RegExp(`^${aba}(\\s|$)`, "i") }).first();
    await expect(alvo, `aba ${aba} não apareceu`).toBeVisible({ timeout: 10_000 });
    await alvo.click();
    await page.waitForTimeout(1500);
    const slug = aba
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-");
    await capturar(page, `23${String.fromCharCode(98 + i)}-config-${slug}`, `Config · ${aba}`);
  }
});

test("04 · item de contexto aberto", async ({ page }) => {
  await chegarEm(page, "/contexto");
  await page.waitForTimeout(1500);
  const item = page.locator('a[href^="/contexto/"]').first();
  if (!(await item.isVisible().catch(() => false))) return;
  await item.click();
  await page.waitForTimeout(2500);
  await capturar(page, "11-contexto-item", "Contexto · item aberto");
});

test("04 · geração em andamento", async ({ page }) => {
  // o trilho "Gerações recentes" da home só existe quando há geração aberta
  await chegarEm(page, "/");
  await page.waitForTimeout(1500);
  const link = page.getByTestId("geracoes-recentes").locator('a[href^="/criar/"]').first();
  if (!(await link.isVisible().catch(() => false))) return;
  await link.click();
  await page.waitForTimeout(3000);
  await capturar(page, "24-geracao", "Início · acompanhamento da geração", {
    nota: "A saga expõe cada etapa: roteamento, recuperação, pesquisa, geração, linter, grounding e juiz.",
  });
});
