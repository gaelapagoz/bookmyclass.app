import { defineConfig } from "@playwright/test";
import { config as loadEnvFile } from "dotenv";

loadEnvFile({ path: ".env.e2e", override: true });

const appUrl = process.env.APP_URL ?? "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./test/e2e",
  testIgnore: ["**/uat/**"],
  // Shared E2E database is mutable; run one worker by default to avoid cross-worker DB contention.
  workers: Number(process.env.PLAYWRIGHT_E2E_WORKERS ?? "1"),
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: appUrl,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/e2e-local-start-server.mjs",
    url: `${appUrl}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        viewport: { width: 1366, height: 900 },
      },
    },
  ],
});

