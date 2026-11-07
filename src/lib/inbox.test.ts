import { describe, expect, it } from "vitest";

import {
  avatarStatus,
  buildInbox,
  changedItems,
  isUnread,
  unreadCount,
  type InboxItem,
} from "@/lib/inbox";

const empty = { pieces: [], videos: [], avatars: [], voices: [] };

describe("buildInbox", () => {
  it("junta os quatro tipos, do mais novo para o mais antigo", () => {
    const items = buildInbox({
      pieces: [{ id: "p", status: "done", prompt: "Tema", updated_at: "2026-10-30T10:00:00Z" }],
      videos: [
        {
          id: "v",
          status: "failed",
          brief: null,
          plan: { concept: "Conceito" },
          updated_at: "2026-10-30T12:00:00Z",
        },
      ],
      avatars: [
        {
          id: "a",
          name: "Ana",
          updated_at: "2026-10-30T11:00:00Z",
          provider_refs: { heygen: { status: "completed" } },
        },
      ],
      voices: [{ id: "z", name: "Calma", status: "ready", updated_at: "2026-10-30T09:00:00Z" }],
    });
    expect(items.map((row) => [row.kind, row.title, row.detail])).toEqual([
      ["video", "O vídeo parou", "Conceito"],
      ["avatar", "Avatar pronto", "Ana"],
      ["piece", "Peça pronta", "Tema"],
      ["voice", "Voz pronta", "Calma"],
    ]);
  });

  it("deixa de fora o que ainda está trabalhando", () => {
    expect(
      buildInbox({
        ...empty,
        pieces: [
          { id: "p", status: "generating", prompt: "x", updated_at: "2026-10-30T10:00:00Z" },
        ],
        voices: [{ id: "z", name: "x", status: "processing", updated_at: "2026-10-30T10:00:00Z" }],
      }),
    ).toEqual([]);
  });
});

describe("avatarStatus", () => {
  it("prefere a HeyGen e cai no Higgsfield", () => {
    expect(avatarStatus({ provider_refs: { heygen: { status: "failed" } } })).toBe("failed");
    expect(avatarStatus({ provider_refs: { higgsfield: { status: "ready" } } })).toBe("ready");
    expect(avatarStatus({ provider_refs: null })).toBeNull();
  });
});

describe("não lidos", () => {
  const at = "2026-10-30T10:00:00Z";
  const row = { key: "voice:z", status: "ready", at } as InboxItem;

  it("conta só o que mudou depois do carimbo", () => {
    expect(isUnread(row, "2026-10-30T09:00:00Z")).toBe(true);
    expect(unreadCount([row], "2026-10-30T11:00:00Z")).toBe(0);
  });

  it("compara por instante, não pelo texto do fuso", () => {
    expect(isUnread({ at: "2026-10-30T10:00:00+00:00" }, "2026-10-30T10:00:00.000Z")).toBe(false);
  });

  it("acha status novo e item novo, e ignora o que não mudou", () => {
    expect(changedItems([row], new Map([["voice:z", "ready"]]))).toEqual([]);
    expect(changedItems([row], new Map([["voice:z", "processing"]]))).toEqual([row]);
    expect(changedItems([row], new Map())).toEqual([row]);
  });
});
