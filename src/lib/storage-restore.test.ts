import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSignedUrl: vi.fn(),
  invoke: vi.fn(),
  rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: { from: () => ({ createSignedUrl: mocks.createSignedUrl }) },
    functions: { invoke: mocks.invoke },
    rpc: mocks.rpc,
  },
}));

import { settleDriveGate, subscribeDriveGate } from "@/lib/drive-gate";
import { ArchivedInDrive, mayBeArchived, restoreFromDrive, signedUrl } from "@/lib/storage-restore";

const found = { data: { signedUrl: "https://link" }, error: null };
const notFound = { data: null, error: { message: "Object not found" } };

beforeEach(() => {
  mocks.createSignedUrl.mockReset();
  mocks.invoke.mockReset();
});

describe("signedUrl", () => {
  it("arquivo no storage nem pergunta ao Drive", async () => {
    mocks.createSignedUrl.mockResolvedValue(found);
    await expect(signedUrl("renders", "a.mp4")).resolves.toBe("https://link");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("traz do Drive e assina de novo", async () => {
    mocks.createSignedUrl.mockResolvedValueOnce(notFound).mockResolvedValueOnce(found);
    mocks.invoke.mockResolvedValue({ data: { status: "ready" }, error: null });
    await expect(signedUrl("renders", "b.mp4")).resolves.toBe("https://link");
  });

  it("com restore false, só avisa que está no Drive", async () => {
    mocks.createSignedUrl.mockResolvedValue(notFound);
    mocks.invoke.mockResolvedValue({ data: { status: "archived" }, error: null });
    await expect(signedUrl("renders", "c.mp4", 60, { restore: false })).rejects.toBeInstanceOf(
      ArchivedInDrive,
    );
    expect(mocks.invoke.mock.calls[0][1].body.dry_run).toBe(true);
  });

  it("prévia assina sem contar como uso", async () => {
    mocks.rpc.mockClear();
    mocks.createSignedUrl.mockResolvedValue(found);
    await expect(signedUrl("renders", "p.png", 60, { preview: true })).resolves.toBe(
      "https://link",
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("prévia de arquivo fora do storage não consulta a edge", async () => {
    mocks.createSignedUrl.mockResolvedValue(notFound);
    await expect(signedUrl("renders", "q.png", 60, { preview: true })).rejects.toThrow(
      "Object not found",
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("fora do Drive, mantém o erro do storage", async () => {
    mocks.createSignedUrl.mockResolvedValue(notFound);
    mocks.invoke.mockResolvedValue({ data: { status: "absent" }, error: null });
    await expect(signedUrl("renders", "d.mp4")).rejects.toThrow("Object not found");
  });

  it("function ainda não publicada não muda nada", async () => {
    mocks.createSignedUrl.mockResolvedValue(notFound);
    mocks.invoke.mockResolvedValue({ data: null, error: new Error("404") });
    await expect(signedUrl("renders", "e.mp4")).rejects.toThrow("Object not found");
  });

  it("logo e miniatura nunca perguntam", async () => {
    mocks.createSignedUrl.mockResolvedValue(notFound);
    await expect(signedUrl("brand-assets", "logo.png")).rejects.toThrow("Object not found");
    await expect(signedUrl("renders", "thumbs/a.jpg")).rejects.toThrow("Object not found");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

describe("restoreFromDrive", () => {
  it("frase clara quando não dá para trazer", async () => {
    mocks.invoke.mockResolvedValue({
      data: { status: "unavailable", message: "Este arquivo não está mais no seu Google Drive." },
      error: null,
    });
    await expect(restoreFromDrive("renders", "f.mp4")).rejects.toThrow("não está mais");
  });

  it("Drive desconectado: abre o passo e repete a volta", async () => {
    let answer = true;
    const stop = subscribeDriveGate(() => queueMicrotask(() => settleDriveGate(answer)));
    const noDrive = {
      data: { status: "unavailable", code: "no_drive", message: "Conecte em Integrações." },
      error: null,
    };
    mocks.invoke
      .mockResolvedValueOnce(noDrive)
      .mockResolvedValueOnce({ data: { status: "ready" }, error: null });
    await expect(restoreFromDrive("renders", "h.mp4")).resolves.toBe(true);

    answer = false;
    mocks.invoke.mockReset();
    mocks.invoke.mockResolvedValue(noDrive);
    await expect(restoreFromDrive("renders", "i.mp4")).rejects.toThrow("Conecte em Integrações.");
    expect(mocks.invoke).toHaveBeenCalledOnce();
    stop();
  });

  it("vídeo grande: repete até ficar pronto", async () => {
    vi.useFakeTimers();
    mocks.invoke
      .mockResolvedValueOnce({ data: { status: "restoring" }, error: null })
      .mockResolvedValueOnce({ data: { status: "ready" }, error: null });
    const done = restoreFromDrive("renders", "g.mp4");
    await vi.advanceTimersByTimeAsync(2500);
    await expect(done).resolves.toBe(true);
    vi.useRealTimers();
  });
});

describe("mayBeArchived", () => {
  it("espelha a regra do servidor", () => {
    expect(mayBeArchived("renders", "director/j/final.mp4")).toBe(true);
    expect(mayBeArchived("context-files", "u/a.pdf")).toBe(true);
    expect(mayBeArchived("brand-assets", "avatars/a/ref.jpg")).toBe(false);
    expect(mayBeArchived("renders", "director/assets/fonts/a.ttf")).toBe(false);
  });
});
