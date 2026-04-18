import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  testIgnore: ["**/uat/**"],
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: process.env.APP_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "dotenv -e .env.e2e -- npm run db:e2e:setup && dotenv -e .env.e2e -- npm run build && dotenv -e .env.e2e -- npm run start",
    url: process.env.APP_URL ?? "http://127.0.0.1:3000",
    reuseExistingServer: false,
    timeout: 240_000,
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

