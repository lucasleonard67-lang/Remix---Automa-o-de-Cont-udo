import { describe, expect, it } from "vitest";

import {
  clean,
  compileMotion,
  factIsGrounded,
  finalTime,
  placeLayers,
  wordSpan,
  type MotionPlan,
} from "../../supabase/functions/_shared/video-motion";

const WORDS = Array.from({ length: 10 }, (_, i) => ({ text: `w${i}`, start: i, end: i + 0.8 }));
const WHOLE = [{ start: 0, end: 10, speed: 1 }];
const CUT = [
  { start: 0, end: 3, speed: 1 },
  { start: 6, end: 10, speed: 2 },
];

const compile = (plan: Partial<MotionPlan>, over: Record<string, unknown> = {}) =>
  compileMotion({
    plan: { layers: [], music: false, ...plan },
    words: WORDS,
    retimed: WORDS,
    segs: WHOLE,
    offset: 0,
    duration: 10,
    captionsBurned: false,
    sourceAudio: true,
    attachments: [],
    sources: [],
    brand: { primary: "#111111", accent: "#ff0000" },
    ...over,
  });

const source = {
  title: "OMS",
  url: "https://www.who.int/x",
  text: "Foram 19,8 milhões de mortes, 32%.",
};

describe("tempo final", () => {
  it("desconta cortes e velocidade", () => {
    expect(finalTime(2, CUT)).toBe(2);
    expect(finalTime(8, CUT)).toBe(4);
    expect(finalTime(4, CUT)).toBeNull();
    expect(finalTime(2, CUT, 1.5)).toBe(3.5);
  });

  it("trecho só com palavras cortadas some; duração mínima é respeitada", () => {
    expect(wordSpan(3, 5, WORDS, CUT, 0, 10)).toBeNull();
    const span = wordSpan(1, 1, WORDS, WHOLE, 0, 10)!;
    expect(span.end - span.start).toBeCloseTo(1.5);
  });

  it("nunca passa do fim do vídeo", () => {
    expect(wordSpan(9, 9, WORDS, WHOLE, 0, 9.5)?.end).toBe(9.5);
  });
});

describe("texto", () => {
  it("nunca corta emoji no meio e prefere cortar entre palavras", () => {
    expect(clean("😀😀😀", 2)).toBe("😀😀");
    expect(clean("uma frase bem comprida", 15)).toBe("uma frase bem");
  });
});

describe("lugar na tela", () => {
  const at = (type: string, position: string, start = 0, end = 4) => ({ type, position, start, end });

  it("efeito no mesmo lugar e tempo muda de lugar", () => {
    const out = placeLayers([at("hook", "middle"), at("fact_card", "middle")], []);
    expect(out.map((l) => l.position)).toEqual(["middle", "top"]);
  });

  it("sem lugar livre, sai e avisa", () => {
    const dropped: string[] = [];
    const out = placeLayers([at("hook", "top"), at("fact_card", "top"), at("lower_third", "top"), at("hook", "top")], dropped);
    expect(out).toHaveLength(3);
    expect(dropped).toHaveLength(1);
  });

  it("tempos diferentes podem usar o mesmo lugar; legenda reserva o dela", () => {
    expect(placeLayers([at("hook", "top", 0, 2), at("fact_card", "top", 3, 5)], []).map((l) => l.position)).toEqual(["top", "top"]);
    const out = placeLayers([at("hook", "bottom"), { type: "captions", position: "bottom" }], []);
    expect(out[0].position).toBe("top");
  });
});

describe("card de informação", () => {
  it("todo número precisa estar na fonte", () => {
    expect(factIsGrounded("19,8 milhões", "32% do total", source)).toBe(true);
    expect(factIsGrounded("19.8 milhões", "", source)).toBe(true);
    expect(factIsGrounded("25 milhões", "", source)).toBe(false);
    expect(factIsGrounded("1 em 3", "", undefined)).toBe(false);
    expect(factIsGrounded("30%", "", { ...source, text: "Meta para 2030." })).toBe(false);
    expect(factIsGrounded("muitos", "casos", source)).toBe(false);
  });

  it("sem confirmação o card sai e a tela é avisada", () => {
    const card = {
      type: "fact_card",
      word_from: 0,
      word_to: 1,
      value: "99%",
      label: "x",
      source_index: 0,
      position: "middle",
    } as const;
    const { worker, dropped } = compile({ layers: [card] }, { sources: [source] });
    expect(worker.layers).toHaveLength(0);
    expect(dropped[0]).toContain("fonte");
  });

  it("confirmado, leva o site como fonte", () => {
    const card = {
      type: "fact_card",
      word_from: 0,
      word_to: 1,
      value: "32%",
      label: "das mortes",
      source_index: 0,
      position: "middle",
    } as const;
    expect(compile({ layers: [card] }, { sources: [source] }).worker.layers[0].source).toBe(
      "who.int",
    );
  });
});

describe("compileMotion", () => {
  it("legenda sai se já está queimada", () => {
    const { worker, dropped } = compile(
      { layers: [{ type: "captions", position: "bottom" }] },
      { captionsBurned: true },
    );
    expect(worker.layers).toHaveLength(0);
    expect(dropped).toHaveLength(1);
  });

  it("efeito sem anexo do tipo certo vira aviso", () => {
    const split = { type: "split_screen", word_from: 0, word_to: 2, attachment_index: 0 } as const;
    const wrong = [{ path: "a.png", kind: "image" as const }];
    expect(compile({ layers: [split] }, { attachments: wrong }).dropped).toHaveLength(1);
  });

  it("liga anexos a arquivos e números do worker", () => {
    const attachments = [
      { path: "v.mp4", kind: "video" as const },
      { path: "a.png", kind: "image" as const },
      { path: "m.mp3", kind: "audio" as const },
    ];
    const { worker, assets, dropped } = compile(
      {
        music: true,
        layers: [
          {
            type: "picture_in_picture",
            word_from: 0,
            word_to: 2,
            attachment_index: 0,
            corner: "top_left",
          },
          { type: "cutout", word_from: 3, word_to: 4, attachment_index: 1, spot: "right" },
          { type: "end_card", text: "Siga", seconds: 3 },
        ],
      },
      { attachments },
    );
    expect(dropped).toEqual([]);
    expect(assets).toEqual({ broll_path: "v.mp4", music_path: "m.mp3", image_paths: ["a.png"] });
    expect(worker.music).toEqual({ volume: 0.3 });
    expect(worker.layers[1].image).toBe(1);
    expect(worker.layers[2]).toMatchObject({ start: 7, end: 10 });
  });

  it("encerramento não cobre vídeo curto", () => {
    const { worker } = compile({ layers: [{ type: "end_card", text: "Siga", seconds: 3 }] }, { duration: 2 });
    expect(worker.layers[0]).toMatchObject({ start: 1.2, end: 2 });
  });

  it("texto vazio não derruba o job", () => {
    const { worker, dropped } = compile({
      layers: [{ type: "hook", word_from: 0, word_to: 1, text: "  ", emphasis: "", position: "top" }],
    });
    expect(worker.layers).toEqual([]);
    expect(dropped).toHaveLength(1);
  });

  it("sete imagens: fica em seis e avisa; a mesma imagem não conta duas vezes", () => {
    const attachments = Array.from({ length: 7 }, (_, i) => ({ path: `${i}.png`, kind: "image" as const }));
    const cutout = (attachment_index: number) =>
      ({ type: "cutout", word_from: 0, word_to: 1, attachment_index, spot: "left" }) as const;
    const { assets, dropped } = compile(
      { layers: [0, 1, 2, 3, 4, 5, 0, 6].map(cutout) },
      { attachments },
    );
    expect(assets.image_paths).toHaveLength(6);
    expect(dropped.filter((d) => d.includes("imagens"))).toHaveLength(1);
  });

  it("cor inválida da marca cai no padrão", () => {
    const { worker } = compile({}, { brand: { primary: "red", accent: "x" } });
    expect(worker.brand.accent).toBe("#ff5a3c");
  });
});
