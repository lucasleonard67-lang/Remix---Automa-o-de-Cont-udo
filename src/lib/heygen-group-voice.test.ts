import { describe, expect, it, vi } from "vitest";

import { fillGroupVoices, type HeygenLook } from "../../supabase/functions/_shared/heygen";

const look = (over: Partial<HeygenLook>): HeygenLook => ({
  id: "l1",
  name: "Look",
  group_id: "g1",
  avatar_type: "digital_twin",
  preview_image_url: null,
  preview_video_url: null,
  gender: null,
  default_voice_id: null,
  supported_api_engines: [],
  preferred_orientation: null,
  status: null,
  error: null,
  ...over,
});

describe("fillGroupVoices", () => {
  it("traz a voz do grupo e não sobrescreve a da look", async () => {
    const load = vi.fn(async () => ({ default_voice_id: "grupo" }));
    const out = await fillGroupVoices(
      [look({ id: "a" }), look({ id: "b", default_voice_id: "propria", group_id: "g2" })],
      load,
    );
    expect(out.map((l) => l.default_voice_id)).toEqual(["grupo", "propria"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("pede cada grupo uma vez só", async () => {
    const load = vi.fn(async () => ({ default_voice_id: "v" }));
    await fillGroupVoices([look({ id: "a" }), look({ id: "b" })], load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("grupo que falha mantém a look e não derruba as outras", async () => {
    const load = vi.fn(async (id: string) => {
      if (id === "g1") throw new Error("429");
      return { default_voice_id: "v2" };
    });
    const out = await fillGroupVoices([look({ id: "a" }), look({ id: "b", group_id: "g2" })], load);
    expect(out.map((l) => l.default_voice_id)).toEqual([null, "v2"]);
  });

  it("look sem grupo não chama a HeyGen", async () => {
    const load = vi.fn(async () => ({ default_voice_id: "v" }));
    await fillGroupVoices([look({ group_id: null })], load);
    expect(load).not.toHaveBeenCalled();
  });
});
