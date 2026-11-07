import { supabase } from "@/integrations/supabase/client";
import { promptDriveConnect } from "@/lib/drive-gate";

// Link assinado de um arquivo que pode estar só no Google Drive. O caminho comum não
// muda: assina direto. Só quando o arquivo não está no storage é que pergunta à edge
// google-drive, que traz de volta para o mesmo bucket e path.

/** Está no Drive e a tela preferiu não trazer sozinha (lista, galeria). */
export class ArchivedInDrive extends Error {
  constructor() {
    super("Este arquivo está no seu Google Drive.");
    this.name = "ArchivedInDrive";
  }
}

/** Espelha mayBeArchived de _shared/drive-policy.ts: o resto nem pergunta. */
export function mayBeArchived(bucket: string, path: string): boolean {
  if (bucket !== "renders" && bucket !== "context-files") return false;
  return !path.startsWith("director/assets/") && !path.startsWith("thumbs/");
}

interface RestoreReply {
  status: "absent" | "archived" | "ready" | "restoring" | "unavailable";
  code?: string;
  message?: string;
}

const MAX_ROUNDS = 8;
const WAIT_MS = 2000;

async function askDrive(bucket: string, path: string, dryRun: boolean): Promise<RestoreReply> {
  const { data, error } = await supabase.functions.invoke("google-drive", {
    body: { action: "restore", bucket, path, dry_run: dryRun },
  });
  // sem a function publicada, vale o erro original do storage
  if (error || !data) return { status: "absent" };
  return data as RestoreReply;
}

/** Traz do Drive; a edge para perto do limite de tempo e a próxima rodada continua. */
export async function restoreFromDrive(bucket: string, path: string): Promise<boolean> {
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const reply = await askDrive(bucket, path, false);
    if (reply.status === "ready") return true;
    if (reply.status === "absent") return false;
    // Drive desconectado tem saída: o mesmo passo de conectar, e a volta recomeça sozinha
    if (
      reply.status === "unavailable" &&
      reply.code === "no_drive" &&
      (await promptDriveConnect())
    ) {
      continue;
    }
    if (reply.status === "unavailable") {
      throw new Error(reply.message ?? "Não deu para trazer o arquivo do Google Drive.");
    }
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
  }
  throw new Error("O arquivo ainda está voltando do Google Drive. Tente de novo em instantes.");
}

const touched = new Set<string>();

/** "7 dias sem uso": abrir na tela conta como uso. Uma vez por sessão basta. */
function touch(bucket: string, path: string): void {
  if (!mayBeArchived(bucket, path)) return;
  const key = `${bucket}/${path}`;
  if (touched.has(key)) return;
  touched.add(key);
  const client = supabase as unknown as {
    rpc(name: string, args: Record<string, string>): PromiseLike<unknown>;
  };
  void Promise.resolve(client.rpc("google_drive_touch", { _bucket: bucket, _path: path })).catch(
    () => undefined,
  );
}

async function sign(bucket: string, path: string, expiresIn: number) {
  return await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
}

/**
 * `restore: false` não traz nada: falha com ArchivedInDrive e a tela oferece o botão.
 * É o que evita abrir uma galeria e devolver todos os vídeos ao storage.
 * `preview` só assina o que está no storage: rolar uma galeria não conta como uso,
 * senão nada sairia para o Drive, e arquivo arquivado não gera consulta à edge.
 */
export async function signedUrl(
  bucket: string,
  path: string,
  expiresIn = 3600,
  options: { restore?: boolean; preview?: boolean } = {},
): Promise<string> {
  const first = await sign(bucket, path, expiresIn);
  if (first.data?.signedUrl) {
    if (!options.preview) touch(bucket, path);
    return first.data.signedUrl;
  }
  const fallback = first.error?.message ?? "Não foi possível abrir o arquivo. Recarregue a página.";
  if (options.preview || !mayBeArchived(bucket, path)) throw new Error(fallback);

  if (options.restore === false) {
    const reply = await askDrive(bucket, path, true);
    if (reply.status === "archived") throw new ArchivedInDrive();
    throw new Error(fallback);
  }
  if (!(await restoreFromDrive(bucket, path))) throw new Error(fallback);
  const second = await sign(bucket, path, expiresIn);
  if (!second.data?.signedUrl) throw new Error(fallback);
  return second.data.signedUrl;
}
