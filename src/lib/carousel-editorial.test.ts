import { describe, expect, it } from "vitest";

import {
  boldKeyNumber,
  coverHeadline,
  editorialPhotoIndexes,
  splitSentences,
} from "@/lib/carousel-editorial";

describe("boldKeyNumber", () => {
  it("prefere dinheiro e porcentagem", () => {
    expect(boldKeyNumber("Em 2025 subiram 54,8%, segundo a empresa.")).toBe(
      "Em 2025 subiram **54,8%**, segundo a empresa.",
    );
    expect(boldKeyNumber("Cada um investe R$ 80 mil, e o resto vem depois.")).toBe(
      "Cada um investe **R$ 80 mil**, e o resto vem depois.",
    );
  });
  it("aceita contagem e milhar, mas não ano nem hora", () => {
    expect(boldKeyNumber("Já são 2.554 lojas.")).toBe("Já são **2.554** lojas.");
    expect(boldKeyNumber("Em 2018, às 22h, abriu.")).toBe("Em 2018, às 22h, abriu.");
  });
  it("não mexe em texto já marcado", () => {
    expect(boldKeyNumber("Foram **500 lojas** e 10%.")).toBe("Foram **500 lojas** e 10%.");
  });
});

describe("coverHeadline", () => {
  it("duas frases: a virada é a do número", () => {
    expect(coverHeadline("Dois sócios abriram. A rede tem 2.554 lojas. Sobra.")).toBe(
      "Dois sócios abriram. **A rede tem 2.554 lojas.**",
    );
  });
  it("uma frase: a virada vem depois da pausa", () => {
    expect(coverHeadline("A rede cresceu em silêncio, e vendeu R$ 336 milhões")).toBe(
      "A rede cresceu em silêncio, **e vendeu R$ 336 milhões**",
    );
  });
  it("uma frase sem pausa: negrito no número", () => {
    expect(coverHeadline("A rede vendeu R$ 336 milhões")).toBe("A rede vendeu **R$ 336 milhões**");
  });
});

describe("[VERIFICAR] na peça do adapter", () => {
  it("a pendência nunca é cortada ao meio", () => {
    expect(
      coverHeadline("A rede abriu [VERIFICAR: número exato. Ver fonte, sem chute.] lojas"),
    ).toBe("A rede abriu [VERIFICAR: número exato. Ver fonte, sem chute.] lojas");
    expect(splitSentences("Subiu [VERIFICAR: dado. Fonte.] no ano. Depois caiu.")).toEqual([
      "Subiu [VERIFICAR: dado. Fonte.] no ano.",
      "Depois caiu.",
    ]);
  });
});

describe("editorialPhotoIndexes", () => {
  it("segue a decisão do escritor: capa + slides de foto", () => {
    const slides = [
      { index: 0, visual: "photo" },
      { index: 1, visual: "none" },
      { index: 2, visual: "photo", photo_promoted: true },
      { index: 3, visual: "chart" },
      { index: 4, visual: "none" },
    ];
    expect(editorialPhotoIndexes(slides)).toEqual([0, 2]);
  });
  it("peça do adapter: capa + alternados, sem o último", () => {
    const slides = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => ({ index }));
    expect(editorialPhotoIndexes(slides)).toEqual([0, 2, 4, 6]);
  });
  it("sem slides, sem fotos", () => {
    expect(editorialPhotoIndexes([])).toEqual([]);
  });
});
