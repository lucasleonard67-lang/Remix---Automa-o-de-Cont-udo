import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Testes unitários das funções puras (src/**/*.test.ts). Separado do vite.config
// do app: o preset do Lovable sobe TanStack Start, nitro e Tailwind — nada disso
// é necessário para testar lib/.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
