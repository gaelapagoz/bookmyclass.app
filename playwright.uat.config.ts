import { defineConfig } from "@playwright/test";

const uatBaseUrl = process.env.BASE_URL ?? process.env.UAT_BASE_URL ?? "https://demo.bookmyclass.app";

export default defineConfig({
  testDir: "./test/e2e/uat",
  timeout: 45_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: uatBaseUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  reporter: process.env.CI ? [["line"], ["html", { outputFolder: "playwright-report" }]] : "list",
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
