// Id da criação em andamento na tela Criar: recarregar a página volta para
// ela. Sem JSX (separado do componente por causa do Fast Refresh).

export const CREATE_JOB_STORAGE_KEY = "ce-create-job";

export function readStoredCreateJob(): string | null {
  try {
    return typeof window !== "undefined"
      ? window.localStorage.getItem(CREATE_JOB_STORAGE_KEY)
      : null;
  } catch {
    return null;
  }
}

export function storeCreateJob(id: string | null) {
  try {
    if (id) window.localStorage.setItem(CREATE_JOB_STORAGE_KEY, id);
    else window.localStorage.removeItem(CREATE_JOB_STORAGE_KEY);
  } catch {
    // sem storage: só não retoma depois de recarregar
  }
}
