import { FunctionsClient } from "@supabase/functions-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  gateInvoke,
  installDriveGate,
  isDriveRequired,
  promptDriveConnect,
  settleDriveGate,
  subscribeDriveGate,
  withDriveGate,
} from "@/lib/drive-gate";

const blocked = () => ({
  data: null,
  error: {
    context: new Response(JSON.stringify({ error: { code: "drive_required", message: "x" } }), {
      status: 412,
    }),
  },
});
const ok = { data: { id: 1 }, error: null };

let stop: (() => void) | undefined;
afterEach(() => {
  settleDriveGate(false);
  stop?.();
  stop = undefined;
});

/** Simula a pessoa respondendo ao passo de conectar. */
function person(connected: boolean) {
  const opened = vi.fn(() => queueMicrotask(() => settleDriveGate(connected)));
  stop = subscribeDriveGate(opened);
  return opened;
}

describe("isDriveRequired", () => {
  it("reconhece o código e não consome a resposta", async () => {
    const { error } = blocked();
    expect(await isDriveRequired(error)).toBe(true);
    await expect(error.context.json()).resolves.toBeTruthy();
  });

  it("ignora outros erros", async () => {
    const other = new Response(JSON.stringify({ error: { code: "not_connected" } }), {
      status: 412,
    });
    expect(await isDriveRequired({ context: other })).toBe(false);
    expect(await isDriveRequired({ context: new Response("{}", { status: 500 }) })).toBe(false);
    expect(await isDriveRequired(null)).toBe(false);
  });
});

describe("gateInvoke", () => {
  it("conectou: a mesma chamada segue sozinha", async () => {
    const opened = person(true);
    const invoke = vi.fn().mockResolvedValueOnce(blocked()).mockResolvedValueOnce(ok);
    const result = await gateInvoke(invoke)("generate-image", { body: { piece_id: "p" } });
    expect(result).toBe(ok);
    expect(opened).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1]).toEqual(["generate-image", { body: { piece_id: "p" } }]);
  });

  it("agora não: devolve o erro original, sem repetir", async () => {
    person(false);
    const first = blocked();
    const invoke = vi.fn().mockResolvedValue(first);
    expect(await gateInvoke(invoke)()).toBe(first);
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("chamada que passou não abre nada", async () => {
    const opened = person(true);
    expect(await gateInvoke(vi.fn().mockResolvedValue(ok))()).toBe(ok);
    expect(opened).not.toHaveBeenCalled();
  });

  it("duas chamadas barradas dividem o mesmo passo", async () => {
    const opened = vi.fn();
    stop = subscribeDriveGate(opened);
    const one = promptDriveConnect();
    const two = promptDriveConnect();
    settleDriveGate(true);
    await expect(Promise.all([one, two])).resolves.toEqual([true, true]);
    expect(opened).toHaveBeenCalledOnce();
  });

  it("sem a tela montada, não trava esperando", async () => {
    await expect(promptDriveConnect()).resolves.toBe(false);
  });
});

describe("installDriveGate", () => {
  it("vale para toda instância de functions e instala uma vez", async () => {
    class Functions {
      calls = 0;
      async invoke(_name: string) {
        this.calls += 1;
        return this.calls === 1 ? blocked() : ok;
      }
    }
    person(true);
    const instance = new Functions();
    installDriveGate({ functions: instance });
    installDriveGate({ functions: new Functions() });
    expect(await instance.invoke("x")).toBe(ok);
    expect(instance.calls).toBe(2);
  });
});

describe("installDriveGate no client real", () => {
  it("o invoke mora no protótipo, senão a trava ficaria desligada em silêncio", () => {
    const client = new FunctionsClient("https://exemplo.supabase.co/functions/v1");
    expect(Object.hasOwn(Object.getPrototypeOf(client) as object, "invoke")).toBe(true);
  });

  it("não encosta em Object.prototype", () => {
    installDriveGate({ functions: { invoke: () => Promise.resolve(ok) } });
    expect("invoke" in Object.prototype).toBe(false);
  });
});

describe("withDriveGate", () => {
  it("insert barrado pelo trigger volta depois de conectar", async () => {
    person(true);
    const run = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "drive_required" } })
      .mockResolvedValueOnce({ data: { id: "j" }, error: null });
    await expect(withDriveGate(run)).resolves.toEqual({ data: { id: "j" }, error: null });
  });

  it("outro erro passa direto", async () => {
    const opened = person(true);
    const failure = { data: null, error: { message: "duplicate key" } };
    await expect(withDriveGate(vi.fn().mockResolvedValue(failure))).resolves.toBe(failure);
    expect(opened).not.toHaveBeenCalled();
  });
});
