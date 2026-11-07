import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

// Credenciais de teste ficam FORA do repo: e2e/.env (ver e2e/.env.example).
dotenv.config({ path: "e2e/.env" });

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // app real (banco compartilhado) — sem corrida entre specs
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 45_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /global\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/session.json" },
      dependencies: ["setup"],
      // O mapa de fluxos é captura de tela, não regressão: rodar por pedido
      // (`--project=mapa`), nunca no portão de qualidade.
      testIgnore: /mapa\//,
    },
    // O mapa só entra quando pedido (MAPA=1). `testIgnore` no chromium tirava
    // o spec da regressão, mas o PROJETO continuava rodando numa execução sem
    // filtro — e o mapa foi parar dentro do portão de qualidade, que é
    // exatamente o que a separação existia para impedir.
    ...(process.env.MAPA
      ? [
          {
            name: "mapa",
            testDir: "./e2e/mapa",
            use: {
              ...devices["Desktop Chrome"],
              storageState: "e2e/.auth/session.json",
              viewport: { width: 1440, height: 900 },
            },
            dependencies: ["setup"],
          },
        ]
      : []),
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:8080",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
