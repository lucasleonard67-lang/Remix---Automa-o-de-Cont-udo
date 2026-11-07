import { useQuery } from "@tanstack/react-query";

import { ArchivedInDrive, signedUrl } from "@/lib/storage-restore";

/**
 * Signed URL de um objeto em bucket privado (`brand-assets`, `renders`,
 * `context-files`). Cache um pouco menor que a validade para nunca servir
 * URL expirada. Arquivo que só existe no Google Drive volta sozinho; com
 * `restore: false`, o erro é ArchivedInDrive e a tela oferece o botão.
 */
export function useSignedUrl(
  bucket: string,
  path: string | null | undefined,
  expiresIn = 3600,
  options: { restore?: boolean; preview?: boolean } = {},
) {
  return useQuery({
    // à parte: abrir a peça depois da galeria ainda precisa contar como uso
    queryKey: ["signed-url", bucket, path, ...(options.preview ? ["preview"] : [])],
    enabled: Boolean(path),
    staleTime: (expiresIn - 300) * 1000,
    gcTime: (expiresIn - 300) * 1000,
    retry: (count, error) => !options.preview && !(error instanceof ArchivedInDrive) && count < 2,
    queryFn: (): Promise<string> => signedUrl(bucket, path as string, expiresIn, options),
  });
}
