import { describe, expect, it } from "vitest";

import type { EditOp, EditWord } from "@/hooks/use-video-edit";
import { buildOps, defaultSpan, insertReady, readPanel, spanLabel } from "@/lib/edit-panel";

const words: EditWord[] = Array.from({ length: 10 }, (_, i) => ({
  text: `p${i}`,
  start: i,
  end: i + 0.9,
}));
const context = { wordCount: 10, hasMusic: false };
const typeOf = (ops: EditOp[], type: string) => ops.find((op) => op.type === type);

describe("buildOps", () => {
  it("sem mudança, devolve o mesmo plano e mantém o que o painel não controla", () => {
    const base: EditOp[] = [
      { type: "cut_words", word_idxs: [1] },
      { type: "hook_first", word_from: 4, word_to: 5 },
      { type: "punch_in", zoom: 1.08 },
      { type: "speed", ranges: [{ word_from: 2, word_to: 3, factor: 1.2 }] },
    ];
    const initial = readPanel(base, 10);
    const ops = buildOps(base, initial, initial, context);
    expect(typeOf(ops, "cut_words")).toEqual(base[0]);
    expect(typeOf(ops, "hook_first")).toEqual(base[1]);
    expect(typeOf(ops, "punch_in")).toEqual(base[2]);
    expect(typeOf(ops, "speed")).toEqual(base[3]);
    expect(ops.at(-1)).toEqual({ type: "loudness" });
  });

  it("velocidade vale do começo ao fim da fala e 1x tira a operação", () => {
    const initial = readPanel([], 10);
    const fast = buildOps([], initial, { ...initial, speed: 1.15 }, context);
    expect(typeOf(fast, "speed")).toEqual({
      type: "speed",
      ranges: [{ word_from: 0, word_to: 9, factor: 1.15 }],
    });
    const read = readPanel(fast, 10);
    expect(read.speed).toBe(1.15);
    expect(typeOf(buildOps(fast, read, { ...read, speed: 1 }, context), "speed")).toBeUndefined();
  });

  it("desligar tira a operação; música só entra se houver trilha", () => {
    const base: EditOp[] = [{ type: "captions", style: "caps", position: "bottom" }];
    const initial = readPanel(base, 10);
    const off = buildOps(base, initial, { ...initial, captionsOn: false }, context);
    expect(typeOf(off, "captions")).toBeUndefined();
    expect(typeOf(off, "music_duck")).toBeUndefined();
    const music = buildOps(
      base,
      initial,
      { ...initial, musicDb: -14 },
      {
        ...context,
        hasMusic: true,
      },
    );
    expect(typeOf(music, "music_duck")).toEqual({ type: "music_duck", volume_db: -14 });
  });

  it("insere manchete, dado, imagem e tela dividida no trecho escolhido, sem perder os antigos", () => {
    const base: EditOp[] = [
      { type: "title", items: [{ word_from: 0, word_to: 1, text: "Antiga", position: "top" }] },
    ];
    const initial = readPanel(base, 10);
    const span = { word_from: 2, word_to: 4 };
    const ops = buildOps(
      base,
      initial,
      {
        ...initial,
        inserts: [
          ...initial.inserts,
          { ...span, id: "a", kind: "title", text: "Nova", position: "bottom" },
          {
            ...span,
            id: "b",
            kind: "fact",
            value: "40%",
            label: "menos",
            source: "IBGE",
            position: "middle",
          },
          { ...span, id: "c", kind: "image", attachment_index: 1, name: "a", position: "full" },
          { ...span, id: "d", kind: "split", attachment_index: 2, name: "b", side: "top" },
        ],
      },
      context,
    );
    expect(typeOf(ops, "title")?.items).toHaveLength(2);
    expect(typeOf(ops, "fact_card")?.items).toEqual([
      { ...span, value: "40%", label: "menos", source: "IBGE", position: "middle" },
    ]);
    expect(typeOf(ops, "image_overlay")?.items).toEqual([
      { ...span, attachment_index: 1, position: "full" },
    ]);
    expect(typeOf(ops, "split_screen")?.items).toEqual([
      { ...span, attachment_index: 2, side: "top" },
    ]);
  });

  it("plano aplicado volta para a tela com os mesmos itens", () => {
    const initial = readPanel([], 10);
    const span = { word_from: 2, word_to: 4 };
    const ops = buildOps(
      [],
      initial,
      {
        ...initial,
        inserts: [{ ...span, id: "a", kind: "title", text: "Nova", position: "bottom" }],
      },
      context,
    );
    expect(readPanel(ops, 10).inserts).toEqual([
      { ...span, id: "title-0", kind: "title", text: "Nova", position: "bottom" },
    ]);
  });
});

describe("trecho", () => {
  it("pega as palavras dos primeiros segundos e para no fim do vídeo", () => {
    expect(defaultSpan(words)).toEqual({ word_from: 0, word_to: 2 });
    expect(defaultSpan(words, 9)).toEqual({ word_from: 9, word_to: 9 });
    expect(defaultSpan([])).toEqual({ word_from: 0, word_to: 0 });
  });

  it("mostra tempo e fala", () => {
    expect(spanLabel(words, { word_from: 1, word_to: 2 })).toEqual({
      time: "0:01 a 0:02",
      quote: "p1 p2",
    });
  });
});

describe("insertReady", () => {
  it("dado sem fonte não vai para o vídeo", () => {
    const base = { id: "a", word_from: 0, word_to: 1, position: "top" as const };
    expect(insertReady({ ...base, kind: "title", text: " " })).toBe(false);
    expect(insertReady({ ...base, kind: "fact", value: "1", label: "", source: "" })).toBe(false);
  });
});
