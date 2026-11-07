import { describe, expect, it } from "vitest";

import {
  notaDoArquivo,
  selecionarArquivos,
} from "../../supabase/functions/_shared/brand-source-files.ts";

// Lista real: o ZIP do Design System SUBIDO v1.0 (kit/css/tokens.css, preset do
// tailwind, README e referências) — o caso que motivou a leitura por listagem.
const KIT_SUBIDO = [
  "README.md",
  ".gitignore",
  "SKILL.md",
  "scripts/auditar-ds.js",
  "kit/css/subido.css",
  "kit/css/tailwind3.css",
  "kit/css/tokens.css",
  "kit/css/revenue.css",
  "kit/css/base.css",
  "kit/tailwind.preset.cjs",
  "kit/ui/button.tsx",
  "kit/public/brand/marcas/omie.png",
  "references/01-fundamentos.md",
  "references/03-componentes.md",
  "exemplos/flow-crm/LoginForm.tsx",
];

describe("selecionarArquivos", () => {
  it("acha tokens, tailwind, README e docs no kit SUBIDO, nesta ordem", () => {
    const escolha = selecionarArquivos(KIT_SUBIDO);
    expect(escolha.slice(0, 3)).toEqual([
      "kit/css/tokens.css",
      "kit/tailwind.preset.cjs",
      "kit/css/base.css",
    ]);
    expect(escolha).toContain("README.md");
    expect(escolha).toContain("references/01-fundamentos.md");
    expect(escolha).toContain("SKILL.md");
    expect(escolha).not.toContain("kit/ui/button.tsx");
    expect(escolha).not.toContain("exemplos/flow-crm/LoginForm.tsx");
  });

  it("llms.txt vem antes de tudo e node_modules nunca entra", () => {
    const escolha = selecionarArquivos([
      "node_modules/tailwindcss/tokens.css",
      "src/index.css",
      "llms.txt",
      "tailwind.config.ts",
    ]);
    expect(escolha).toEqual(["llms.txt", "tailwind.config.ts", "src/index.css"]);
  });

  it("respeita a pasta base de um link github.com/…/tree/main/pasta", () => {
    const escolha = selecionarArquivos(
      ["README.md", "packages/ds/README.md", "packages/ds/tokens.json", "packages/app/tokens.json"],
      { base: "packages/ds" },
    );
    expect(escolha).toEqual(["packages/ds/tokens.json", "packages/ds/README.md"]);
  });

  it("limita a quantidade e prefere o raso", () => {
    const escolha = selecionarArquivos(["a/b/c/tokens.css", "tokens.css", "x/tokens.css"], {
      max: 2,
    });
    expect(escolha).toEqual(["tokens.css", "x/tokens.css"]);
  });

  it("md solto sem cara de design não entra; dentro de docs/ entra", () => {
    expect(notaDoArquivo("CHANGELOG.md")).toBeNull();
    expect(notaDoArquivo("docs/qualquer-coisa.md")).toBe(5);
    expect(notaDoArquivo("DESIGN.md")).toBe(5);
  });
});
