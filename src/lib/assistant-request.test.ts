import { describe, expect, it } from "vitest";

import { requestAssistant } from "./assistant-request";

describe("assistant session boundary", () => {
  it("does not request protected account state without a session", async () => {
    let requests = 0;

    const result = await requestAssistant({ action: "estado" }, {
      getAccessToken: async () => null,
      invoke: async () => { requests += 1; return { data: {}, error: null }; },
    });

    expect(result).toEqual({ status: "signed_out" });
    expect(requests).toBe(0);
  });

  it("sends the current session bearer with authenticated requests", async () => {
    const result = await requestAssistant({ action: "estado" }, {
      getAccessToken: async () => "test-session-token",
      invoke: async ({ headers }) => ({ data: headers.Authorization, error: null }),
    });

    expect(result).toEqual({ status: "completed", data: "Bearer test-session-token", error: null });
  });
});