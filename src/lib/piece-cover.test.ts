import { describe, expect, it } from "vitest";

import type { ContentPiece } from "@/hooks/use-content-pieces";
import { DEFAULT_ART, type CarouselArt } from "@/lib/carousel-art";
import { coverPlan, coverText } from "@/lib/piece-cover";

const editorial: CarouselArt = { ...DEFAULT_ART, layout: "editorial" };
const plain: CarouselArt = { ...DEFAULT_ART, layout: "classic" as CarouselArt["layout"] };

function piece(channel_type: string, adapted_content: unknown, extra = {}): ContentPiece {
  return {
    channel_type,
    adapted_content,
    core_content: { idea: "Ideia da peça" },
    render_path: null,
    ...extra,
  } as unknown as ContentPiece;
}

describe("coverPlan", () => {
  it("carrossel sai na ordem do índice, com o PNG de cada slide", () => {
    const plan = coverPlan(
      piece("instagram_carousel", {
        slides: [
          { index: 1, text: "b", image_path: "b.png" },
          { index: 0, text: "a", cover_art_rendered: true },
        ],
        slide_renders: [{ index: 0, path: "final-0.png" }],
      }),
      plain,
    );
    if (plan.kind !== "deck") throw new Error(plan.kind);
    expect(plan.renderer).toBe("chassis");
    expect(plan.units.map((unit) => unit.text)).toEqual(["a", "b"]);
    expect(plan.units[0]).toMatchObject({ render: "final-0.png", artRendered: true });
    expect(plan.units[1]).toMatchObject({ render: null, photo: "b.png" });
  });

  it("post e stories seguem o layout da marca, como no detalhe", () => {
    const post = piece("instagram_post", { card: { index: 0, text: "x" } });
    const stories = piece("instagram_stories", { frames: [{ index: 0, text: "x" }] });
    expect(coverPlan(post, editorial)).toMatchObject({ renderer: "chassis", format: "post" });
    expect(coverPlan(post, plain)).toMatchObject({ renderer: "tweet", aspect: "4:5" });
    expect(coverPlan(stories, editorial)).toMatchObject({ renderer: "chassis", aspect: "9:16" });
    expect(coverPlan(stories, plain)).toMatchObject({ renderer: "tweet", format: "story" });
  });

  it("post usa render_path e a foto legada", () => {
    const plan = coverPlan(
      piece(
        "instagram_post",
        { card: { index: 0, text: "x" }, image_path: "legado.png" },
        { render_path: "final.png" },
      ),
      plain,
    );
    if (plan.kind !== "deck") throw new Error(plan.kind);
    expect(plan.units[0]).toMatchObject({ render: "final.png", photo: "legado.png" });
  });

  it("Reel com vídeo toca; sem vídeo, mostra o roteiro", () => {
    const script = {
      beats: [
        { index: 1, narration: "segundo" },
        { index: 0, narration: "primeiro" },
      ],
    };
    expect(coverPlan(piece("instagram_reel", { script, video: { path: "v.mp4" } }), plain)).toEqual(
      { kind: "video", path: "v.mp4", text: "primeiro\n\nsegundo" },
    );
    expect(coverPlan(piece("instagram_reel", { script }), plain)).toEqual({
      kind: "text",
      surface: "brand",
      text: "primeiro\n\nsegundo",
      photo: null,
    });
  });

  it("canais de texto mostram o próprio texto e a foto, se houver", () => {
    expect(coverPlan(piece("x_post", { text: "post", image_path: "i.png" }), plain)).toEqual({
      kind: "text",
      surface: "plain",
      text: "post",
      photo: "i.png",
    });
  });

  it("jsonb parcial nunca fica sem texto", () => {
    expect(coverPlan(piece("instagram_carousel", {}), plain)).toEqual({
      kind: "text",
      surface: "brand",
      text: "Ideia da peça",
      photo: null,
    });
    expect(
      coverPlan(piece("instagram_carousel", { slides: "x", slide_renders: 3 }), plain),
    ).toEqual({ kind: "text", surface: "brand", text: "Ideia da peça", photo: null });
    expect(coverPlan(piece("instagram_post", { card: { index: 0, text: "" } }), plain).kind).toBe(
      "text",
    );
  });
});

describe("coverPlan em revisão", () => {
  it("ignora o PNG salvo: o texto pode ter mudado depois dele", () => {
    const deck = coverPlan(
      piece(
        "instagram_carousel",
        {
          slides: [{ index: 0, text: "novo" }],
          slide_renders: [{ index: 0, path: "antigo.png" }],
        },
        { status: "draft" },
      ),
      plain,
    );
    const post = coverPlan(
      piece(
        "instagram_post",
        { card: { index: 0, text: "novo" } },
        { status: "draft", render_path: "antigo.png" },
      ),
      plain,
    );
    if (deck.kind !== "deck" || post.kind !== "deck") throw new Error("capa sem arte");
    expect(deck.units[0].render).toBeNull();
    expect(post.units[0].render).toBeNull();
  });
});

describe("texto longo", () => {
  it("corta entre palavras: no quadro da galeria o resto nem se lê", () => {
    const plan = coverPlan(piece("linkedin_post", { text: "palavra ".repeat(60) }), plain);
    if (plan.kind !== "text") throw new Error(plan.kind);
    expect(plan.text.length).toBeLessThanOrEqual(281);
    expect(plan.text.endsWith("palavra…")).toBe(true);
  });
});

describe("coverText", () => {
  it("LinkedIn sem texto usa o gancho", () => {
    expect(coverText(piece("linkedin_post", { blocks: { hook: "gancho" } }))).toBe("gancho");
  });
});
