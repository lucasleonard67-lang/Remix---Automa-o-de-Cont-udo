// A trava "sem Drive não gera", do lado da tela. O servidor decide (drive_required); aqui
// só se garante que a pessoa nunca caia num beco: toda chamada barrada abre o passo de
// conectar por cima do que ela estava fazendo e, conectado, a MESMA chamada segue
// sozinha. Nada de voltar a uma tela nem clicar em Gerar de novo.
//
// O ponto único é o `invoke` das functions. O insert direto em director_jobs, que o
// trigger barra, passa por withDriveGate.

const DRIVE_REQUIRED = "drive_required";

type Listener = () => void;
const listeners = new Set<Listener>();
let resolveOpen: ((connected: boolean) => void) | null = null;
let open: Promise<boolean> | null = null;

export function subscribeDriveGate(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Abre o passo de conectar. Chamadas juntas esperam o mesmo passo. */
export function promptDriveConnect(): Promise<boolean> {
  if (open) return open;
  if (listeners.size === 0) return Promise.resolve(false);
  open = new Promise<boolean>((resolve) => {
    resolveOpen = resolve;
  });
  listeners.forEach((listener) => listener());
  return open;
}

export function settleDriveGate(connected: boolean): void {
  resolveOpen?.(connected);
  resolveOpen = null;
  open = null;
}

interface InvokeResult {
  data: unknown;
  error: unknown;
}

/** O envelope de erro vem na Response original; lê uma cópia para o hook ainda poder ler. */
export async function isDriveRequired(error: unknown): Promise<boolean> {
  const context = (error as { context?: Response } | null)?.context;
  if (context?.status !== 412 || typeof context.clone !== "function") return false;
  const body = (await context
    .clone()
    .json()
    .catch(() => null)) as { error?: { code?: string } } | null;
  return body?.error?.code === DRIVE_REQUIRED;
}

export function gateInvoke<A extends unknown[], R extends InvokeResult>(
  invoke: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    const result = await invoke(...args);
    if (!(await isDriveRequired(result.error))) return result;
    return (await promptDriveConnect()) ? await invoke(...args) : result;
  };
}

/** Liga a trava em toda chamada de function. O client recria `functions` a cada leitura. */
export function installDriveGate(client: { functions: object }): void {
  const proto = Object.getPrototypeOf(client.functions) as {
    invoke: (...args: unknown[]) => Promise<InvokeResult>;
    __driveGate?: boolean;
  };
  // nunca mexer em Object.prototype: só o protótipo que tem o próprio invoke
  if (proto.__driveGate || !Object.hasOwn(proto, "invoke")) return;
  const original = proto.invoke;
  proto.invoke = function (this: unknown, ...args: unknown[]) {
    return gateInvoke((...call: unknown[]) => original.apply(this, call))(...args);
  };
  proto.__driveGate = true;
}

/** Para escrita direta no banco: o trigger responde com `drive_required` na mensagem. */
export async function withDriveGate<T extends { error: { message: string } | null }>(
  run: () => PromiseLike<T>,
): Promise<T> {
  const result = await run();
  if (!result.error?.message.includes(DRIVE_REQUIRED)) return result;
  return (await promptDriveConnect()) ? await run() : result;
}
