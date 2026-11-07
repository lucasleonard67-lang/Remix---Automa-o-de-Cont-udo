import { expect, type Page } from "@playwright/test";

/**
 * Coleta erros reais da página (exceções + console.error), ignorando ruído
 * conhecido de dev (HMR, extensões, avisos de terceiros).
 */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  const IGNORE = [
    /Download the React DevTools/i,
    /\[vite\]/i,
    /favicon/i,
    /net::ERR_ABORTED/i, // navegação SPA cancelando fetch em voo
    /AuthSessionMissingError/i, // corrida benigna do restore de sessão no boot
  ];
  page.on("pageerror", (err) => {
    if (!IGNORE.some((re) => re.test(err.message))) errors.push(`pageerror: ${err.message}`);
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (!IGNORE.some((re) => re.test(text))) errors.push(`console.error: ${text}`);
  });
  return errors;
}

/**
 * Navega e espera a página de verdade — primeiro sair do /login, depois o
 * heading.
 *
 * A sessão vive no localStorage, então o servidor NUNCA a enxerga: toda
 * navegação direta renderiza o /login por um instante e só corrige quando o
 * client hidrata. Antes daqui a espera era só pelo heading, e isso escondia o
 * salto — o teste passava porque o heading pedido não existia na tela de login,
 * então ele esperava até a página certa chegar. Bastou a nova tela de login ter
 * um `h1` com a palavra "marca" para `{ name: "Marca" }` casar por substring
 * ali, a espera terminar cedo e a rota /marca "falhar" sem nada estar quebrado.
 *
 * A espera correta é pelo endereço: é ele que diz em que página estamos.
 */
export async function gotoAndExpectHeading(page: Page, path: string, heading: string | RegExp) {
  await page.goto(path);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Deixa a tela de login pronta para ENTRAR e devolve o botão de submit.
 *
 * Três armadilhas moram aqui, e por isso isto é um lugar só:
 *  1. A tela decide o modo depois da RPC `has_any_admin`. No SSR ela nasce em
 *     login com o submit DESABILITADO e, se o cadastro estiver aberto, troca
 *     para "criar conta". Medir antes da decisão é esperar por um elemento que
 *     vai ser substituído.
 *  2. Com o cadastro aberto, o modo padrão é CRIAR CONTA — sem clicar na aba,
 *     o teste preenche o formulário errado.
 *  3. `{ name: "Entrar" }` é ambíguo: casa com a aba e com o submit. O submit
 *     é sempre o de dentro do formulário.
 */
export async function prepararLogin(page: Page) {
  await page.waitForFunction(
    () => {
      const abas = document.querySelector("[role=tablist]");
      const submit = document.querySelector<HTMLButtonElement>(
        'form[aria-label="Entrar"] button[type="submit"]',
      );
      return Boolean(abas) || Boolean(submit && !submit.disabled);
    },
    null,
    { timeout: 15_000 },
  );

  const abaEntrar = page.getByRole("tab", { name: "Entrar" });
  if (await abaEntrar.isVisible().catch(() => false)) {
    await abaEntrar.click();
  }

  const submeter = page
    .getByRole("form", { name: "Entrar" })
    .getByRole("button", { name: "Entrar" });
  await expect(submeter).toBeEnabled({ timeout: 15_000 });
  return submeter;
}
