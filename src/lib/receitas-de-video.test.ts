import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  camadaDoModelo,
  conferirEscrita,
  FERRAMENTAS,
  ferramentaDe,
  lerContexto,
  LETRAS_POR_SEGUNDO,
  receitaDeEscrita,
} from "@/lib/receitas-de-video";

describe("receitas-de-video", () => {
  it("é a mesma cópia do servidor", () => {
    const raiz = resolve(__dirname, "../..");
    const front = readFileSync(resolve(raiz, "src/lib/receitas-de-video.ts"), "utf8");
    const edge = readFileSync(
      resolve(raiz, "supabase/functions/_shared/receitas-de-video.ts"),
      "utf8",
    );
    expect(front).toBe(edge);
  });

  it("toda ferramenta com campo aponta um tipo de escrita e uma frase de faz/não faz", () => {
    for (const f of Object.values(FERRAMENTAS)) {
      expect(f.faz.length).toBeGreaterThan(20);
      expect(f.nao_faz.length).toBeGreaterThan(10);
      if (f.campo) expect(f.campo.rotulo).toBeTruthy();
    }
    expect(ferramentaDe("avatar_script")?.campo?.tipo).toBe("roteiro");
    expect(ferramentaDe("nada")).toBeNull();
  });

  it("a receita carrega o limite e a duração do contexto", () => {
    const r = receitaDeEscrita("fala", { segundos: 20, max: 345 });
    expect(r).toContain("20 segundos");
    expect(r).toContain(`${20 * LETRAS_POR_SEGUNDO} caracteres`);
    expect(r).toContain("Até 345 caracteres");
    expect(camadaDoModelo({ modelo: "heygen/avatar-v", max: 225 })).toContain("225 caracteres");
    expect(camadaDoModelo({})).toBe("");
  });

  it("lê só o contexto que a receita usa", () => {
    expect(lerContexto({ alvo: "roteiro", max: 300.4, formato: "4:3", chave: "x" })).toEqual({
      alvo: "roteiro",
      max: 300,
    });
  });

  it("confere a entrega de cada tipo curto", () => {
    expect(conferirEscrita("fala", { segundos: 10 }, "Oi, tudo bem? 😀", null).problemas).toEqual([
      "texto: sem emoji.",
    ]);
    expect(conferirEscrita("fala", { segundos: 2 }, "x".repeat(100), null).problemas[0]).toMatch(
      /cabe até/,
    );
    const briefing = conferirEscrita("briefing_cenas", {}, "Ideia", {
      objetivo: "Vender",
      publico: "donos de PME",
      smp: "dá para cortar retrabalho",
    });
    expect(briefing.problemas).toEqual([]);
    expect(briefing.saida?.numero_heroi).toBe("");
    expect(conferirEscrita("cena", {}, "num escritório à tarde", {}).problemas).toEqual([
      "saida.resumo_pt: a instrução em português, em uma frase.",
      "texto: a instrução vai em inglês (o modelo lê inglês); o português fica em saida.resumo_pt.",
    ]);
  });
});
