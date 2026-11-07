import { describe, expect, it } from "vitest";

import { INTEGRATION_GROUPS, VIDEO_EDIT_AUTO_LIVE, VIDEO_EDIT_LIVE } from "@/lib/integrations";

describe("liberação do editor de vídeo", () => {
  it("o card do editor acompanha VIDEO_EDIT_LIVE", () => {
    const ids = INTEGRATION_GROUPS.flatMap((group) => group.ids);
    expect(ids.includes("claude_editor")).toBe(VIDEO_EDIT_LIVE);
  });

  it("a chave automática continua escondida enquanto nada dispara a edição", () => {
    expect(VIDEO_EDIT_AUTO_LIVE).toBe(false);
  });
});
