import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ADMIN_ITEMS, NAV_ITEMS } from "@/components/app-nav";

import {
  buscarAjuda,
  buscarDuvidas,
  DUVIDAS,
  HELP,
  ROTAS_SO_ADMIN,
} from "../../supabase/functions/_shared/help-content";

// A ajuda é lida pela página Ajuda e pelo assistente: estes testes seguram o
// texto preso ao app de verdade (rotas, menu, papéis) e ao formato que a
// página desenha.

const RAIZ = resolve(__dirname, "../..");
const MENU = [...NAV_ITEMS, ...ADMIN_ITEMS];

function rotaExiste(rota: string): boolean {
  const base = resolve(RAIZ, "src/routes/_app", rota === "/" ? "" : rota.slice(1));
  return [
    rota === "/" ? resolve(base, "index.tsx") : `${base}.tsx`,
    resolve(base, "index.tsx"),
    resolve(base, "route.tsx"),
  ].some((arquivo) => existsSync(arquivo));
}

function textos(): string[] {
  return [
    ...HELP.flatMap((h) => [h.menu, h.caminho ?? "", h.resumo, ...h.passos, ...h.erros]),
    ...DUVIDAS.flatMap((d) => [d.pergunta, d.resposta]),
  ];
}

describe("help-content", () => {
  it("toda entrada aponta uma tela que existe", () => {
    for (const h of HELP) expect(rotaExiste(h.rota), h.rota).toBe(true);
    expect(new Set(HELP.map((h) => h.rota)).size).toBe(HELP.length);
  });

  it("menu é um item do menu lateral e o caminho começa nele", () => {
    const titulos = MENU.map((item) => item.title);
    for (const h of HELP) {
      expect(titulos, h.rota).toContain(h.menu);
      if (h.caminho) expect(h.caminho.startsWith(`${h.menu} → `), h.rota).toBe(true);
    }
    // todo item do menu tem ajuda, menos a própria Ajuda
    for (const item of MENU.filter((i) => i.to !== "/ajuda")) {
      expect(
        HELP.some((h) => h.menu === item.title && !h.caminho),
        item.title,
      ).toBe(true);
    }
  });

  it("subitens do menu têm entrada com o mesmo nome", () => {
    for (const item of MENU) {
      for (const filho of item.children ?? []) {
        const entrada = HELP.find((h) => h.rota === filho.to);
        expect(entrada?.caminho, filho.to).toBe(`${item.title} → ${filho.title}`);
      }
    }
  });

  it("telas de administrador ficam marcadas", () => {
    expect(ROTAS_SO_ADMIN).toEqual(expect.arrayContaining(["/config", "/automacao", "/videos"]));
    for (const h of HELP.filter((x) => ADMIN_ITEMS.some((i) => i.title === x.menu))) {
      expect(h.admin, h.rota).toBe(true);
    }
  });

  it("todo erro vem como “sintoma: o que fazer”", () => {
    for (const h of HELP) {
      for (const erro of h.erros) expect(erro.indexOf(": "), erro).toBeGreaterThan(0);
    }
  });

  it("não promete o que o app não tem nem usa nome antigo", () => {
    const antigos = [
      /dashboard/i,
      /\bconfig\b/i,
      /criar peça/i,
      /hashtag/i,
      /google drive/i,
      /\bdrive\b/i,
    ];
    for (const texto of textos()) {
      for (const termo of antigos) expect(texto, texto).not.toMatch(termo);
    }
  });

  it("a busca acha a tela e a dúvida certas", () => {
    expect(buscarAjuda("como publico uma peça agendada")[0]?.rota).toBe("/biblioteca");
    expect(buscarAjuda("gatilho todo dia")[0]?.rota).toBe("/automacao");
    expect(buscarAjuda("onde adiciono transcrição")[0]?.rota).toBe("/contexto");
    expect(buscarDuvidas("quanto estou gastando")[0]?.pergunta).toBe("Quanto estou gastando?");
    expect(buscarAjuda("")).toEqual([]);
  });
});
